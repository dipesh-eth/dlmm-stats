// @ts-nocheck
export function toCompactPosition(position, liquidity) {
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    id: position.position,
    poolAddress: position.poolAddress,
    pair: { base: position.tokenName0, quote: position.tokenName1 },
    totalBalanceUsd: number(position.currentValue),
    collectibleFeesUsd: number(position.unCollectedFee),
    pnlUsd: number(position.pnl?.value),
    pnlPercent: number(position.pnl?.percent) * 100,
    inRange: Boolean(position.inRange),
    minPrice: number(position.priceRange?.[0]),
    maxPrice: number(position.priceRange?.[1]),
    currentPrice: liquidity?.currentPrice || 0,
    liquidity,
  };
}
