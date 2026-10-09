// @ts-nocheck
import { getPositionLiquidityProfile } from '../../services/chart-data-service.js';
import { toCompactPosition } from '../../meteora/positions.js';

export async function getPositionsResponse(positionService, wallet, limit) {
  const result = await positionService.getOpenPositions(wallet);
  const positions = result.data.slice(0, limit);
  return {
    wallet,
    updatedAt: new Date().toISOString(),
    totalPositions: result.count,
    positions: await Promise.all(positions.map(async position => {
      try {
        return toCompactPosition(position, await getPositionLiquidityProfile(position));
      } catch (error) {
        console.warn(`[API] Could not load bins for ${position.position}: ${error.message}`);
        return toCompactPosition(position, null);
      }
    })),
  };
}
