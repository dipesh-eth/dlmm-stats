// @ts-nocheck
export function toCompactPosition(position, liquidity, feeTvl24hPercent = null) {
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    id: position.position,
    poolAddress: position.poolAddress,
    pair: { base: position.tokenName0, quote: position.tokenName1 },
    totalBalanceSol: number(position.currentValueNative),
    investedSol: number(position.inputNative),
    collectibleFeesSol: number(position.unCollectedFeeNative),
    pnlSol: number(position.pnl?.valueNative),
    pnlPercent: number(position.pnl?.percentNative) * 100,
    feeTvl24hPercent,
    inRange: Boolean(position.inRange),
    minPrice: number(position.priceRange?.[0]),
    maxPrice: number(position.priceRange?.[1]),
    currentPrice: liquidity?.currentPrice || 0,
    liquidity,
  };
}
