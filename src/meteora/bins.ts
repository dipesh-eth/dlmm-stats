// @ts-nocheck
import DLMM from '@meteora-ag/dlmm';
import { Connection, PublicKey } from '@solana/web3.js';

const rpcConnection = new Connection(
  process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
  'confirmed',
);
const poolCache = new Map();
const DLMMClass = DLMM?.default || DLMM;

function parseBigIntAmount(value) {
  const raw = value?.toString?.() ?? String(value || '0');
  const integerPart = raw.split('.')[0].replace(/\D/g, '').replace(/^0+/, '');
  return integerPart ? BigInt(integerPart) : 0n;
}

function bigintRatio(value, max) {
  if (!value || !max) return 0;
  return Number((value * 1_000_000n) / max) / 1_000_000;
}

async function getDlmmPool(poolAddress) {
  if (!poolCache.has(poolAddress)) {
    poolCache.set(poolAddress, DLMMClass.create(rpcConnection, new PublicKey(poolAddress)));
  }
  return poolCache.get(poolAddress);
}

// This is intentionally token-value agnostic. Meteora's positionLiquidity is the
// only value used for chart height, avoiding false spikes from token decimals/value.
export async function getPositionLiquidityProfile(position) {
  if (!position.poolAddress || !position.owner || !position.position) return null;

  const [lowerBinId, upperBinId, activeBinId] = (position.range || []).map(Number);
  if (![lowerBinId, upperBinId, activeBinId].every(Number.isFinite)) return null;

  const rangeSize = Math.max(1, upperBinId - lowerBinId);
  const paddingBins = Math.max(8, Math.ceil(rangeSize * 0.25));
  const chartLowerBin = lowerBinId - paddingBins;
  const chartUpperBin = upperBinId + paddingBins;
  const dlmmPool = await getDlmmPool(position.poolAddress);
  const [{ activeBin, bins }, { userPositions }] = await Promise.all([
    dlmmPool.getBinsBetweenLowerAndUpperBound(chartLowerBin, chartUpperBin),
    dlmmPool.getPositionsByUserAndLbPair(new PublicKey(position.owner)),
  ]);

  const activeId = Number(activeBin?.binId ?? activeBin ?? activeBinId);
  const userPosition = userPositions.find(item => item.publicKey?.toBase58?.() === position.position);
  const userBins = new Map(
    (userPosition?.positionData?.positionBinData || []).map(bin => [bin.binId, bin]),
  );
  const withLiquidity = bins.map(bin => ({
    binId: Number(bin.binId),
    price: Number(bin.pricePerToken || bin.price || 0),
    liquidity: parseBigIntAmount(userBins.get(bin.binId)?.positionLiquidity),
  }));
  const maxLiquidity = withLiquidity.reduce(
    (max, bin) => bin.liquidity > max ? bin.liquidity : max,
    0n,
  );

  return {
    lowerBinId,
    upperBinId,
    activeBinId: activeId,
    minPrice: Number(position.priceRange?.[0] || 0),
    maxPrice: Number(position.priceRange?.[1] || 0),
    currentPrice: withLiquidity.find(bin => bin.binId === activeId)?.price
      || Number(position.raw?.poolActivePrice || 0),
    bins: withLiquidity.map(bin => ({
      binId: bin.binId,
      price: bin.price,
      liquidity: bigintRatio(bin.liquidity, maxLiquidity),
      side: bin.binId < activeId ? 'left' : 'right',
    })),
  };
}
