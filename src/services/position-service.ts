// @ts-nocheck
import MeteoraClient from '../meteora/client.js';

export class PositionService {
  constructor(client = new MeteoraClient()) {
    this.client = client;
  }

  getOpenPositions(wallet) {
    return this.client.getOpenPositions(wallet);
  }

  getPosition(positionId, wallet) {
    return this.client.getPositionDetails(positionId, { wallet });
  }
}
