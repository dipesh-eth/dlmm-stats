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
    // Meteora returns these as already-formatted percentage values (0.31 means 0.31%).
    pnlPercent: number(position.pnl?.percentNative),
    feeTvl24hPercent: Number.isFinite(position.fee24hTvlPercent) ? position.fee24hTvlPercent : feeTvl24hPercent,
    inRange: Boolean(position.inRange),
    minPrice: number(position.priceRange?.[0]),
    maxPrice: number(position.priceRange?.[1]),
    currentPrice: liquidity?.currentPrice || 0,
    binStep: number(position.poolInfo?.tickSpacing),
    poolFeePercent: number(position.poolInfo?.fee),
    liquidityTokens: {
      token0: { symbol: position.tokenName0, amount: number(position.current?.amount0Adjusted), amountSol: number(position.current?.amount0Sol) },
      token1: { symbol: position.tokenName1, amount: number(position.current?.amount1Adjusted), amountSol: number(position.current?.amount1Sol) },
    },
    feeTokens: {
      token0: { symbol: position.tokenName0, amount: number(position.unclaimedFees?.token0?.amount), amountSol: number(position.unclaimedFees?.token0?.amountSol) },
      token1: { symbol: position.tokenName1, amount: number(position.unclaimedFees?.token1?.amount), amountSol: number(position.unclaimedFees?.token1?.amountSol) },
    },
    liquidity,
  };
}
