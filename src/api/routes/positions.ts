// @ts-nocheck
import { getPositionLiquidityProfile } from '../../services/chart-data-service.js';
import { toCompactPosition } from '../../meteora/positions.js';
import { recordFeeSnapshotAndGet24hRate } from '../../database.js';

export async function getPositionsResponse(positionService, wallet, limit) {
  const result = await positionService.getOpenPositions(wallet);
  const positions = result.data.slice(0, limit);
  const compactPositions = await Promise.all(positions.map(async position => {
    const totalFeeNative = Number(position.collectedFeeNative || 0) + Number(position.unCollectedFeeNative || 0);
    const feeTvl24hPercent = await recordFeeSnapshotAndGet24hRate(
      position.position,
      wallet,
      totalFeeNative,
      Number(position.currentValueNative || 0),
    );
    try {
      return toCompactPosition(position, await getPositionLiquidityProfile(position), feeTvl24hPercent);
    } catch (error) {
      console.warn(`[API] Could not load bins for ${position.position}: ${error.message}`);
      return toCompactPosition(position, null, feeTvl24hPercent);
    }
  }));
  return {
    wallet,
    updatedAt: new Date().toISOString(),
    totalPositions: result.count,
    summary: {
      investedSol: result.data.reduce((total, position) => total + Number(position.inputNative || 0), 0),
      currentFeesSol: result.data.reduce((total, position) => total + Number(position.unCollectedFeeNative || 0), 0),
      currentPnlSol: result.data.reduce((total, position) => total + Number(position.pnl?.valueNative || 0), 0),
    },
    positions: compactPositions,
  };
}
