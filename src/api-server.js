import http from 'node:http';
import { getPositionLiquidityProfile } from './position-liquidity.js';

const cache = new Map();
const CACHE_MS = 20_000;

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function compactPosition(position, liquidity) {
  return {
    id: position.position,
    poolAddress: position.poolAddress,
    pair: {
      base: position.tokenName0,
      quote: position.tokenName1,
    },
    totalBalanceUsd: toNumber(position.currentValue),
    collectibleFeesUsd: toNumber(position.unCollectedFee),
    pnlUsd: toNumber(position.pnl?.value),
    pnlPercent: toNumber(position.pnl?.percent) * 100,
    inRange: Boolean(position.inRange),
    minPrice: toNumber(position.priceRange?.[0]),
    maxPrice: toNumber(position.priceRange?.[1]),
    currentPrice: liquidity?.currentPrice || 0,
    liquidity,
  };
}

export function startApiServer(meteora) {
  const token = process.env.API_TOKEN;
  if (!token) {
    console.log('[API] Disabled. Set API_TOKEN to enable the phone/widget API.');
    return null;
  }

  const port = Number(process.env.API_PORT || 3000);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, { ok: true });
    }

    if (request.headers.authorization !== `Bearer ${token}`) {
      return sendJson(response, 401, { error: 'Unauthorized' });
    }
    if (request.method !== 'GET' || url.pathname !== '/api/positions') {
      return sendJson(response, 404, { error: 'Not found' });
    }

    const wallet = url.searchParams.get('wallet');
    if (!wallet) return sendJson(response, 400, { error: 'wallet is required' });
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 5), 1), 15);
    const cacheKey = `${wallet}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < CACHE_MS) return sendJson(response, 200, cached.data);

    try {
      const result = await meteora.getOpenPositions(wallet);
      const positions = result.data.slice(0, limit);
      const data = {
        wallet,
        updatedAt: new Date().toISOString(),
        totalPositions: result.count,
        positions: await Promise.all(positions.map(async position => {
          try {
            return compactPosition(position, await getPositionLiquidityProfile(position));
          } catch (error) {
            console.warn(`[API] Could not load bins for ${position.position}: ${error.message}`);
            return compactPosition(position, null);
          }
        })),
      };
      cache.set(cacheKey, { createdAt: Date.now(), data });
      return sendJson(response, 200, data);
    } catch (error) {
      console.error('[API] Failed to load positions:', error);
      return sendJson(response, 502, { error: 'Could not load Meteora positions' });
    }
  });

  server.listen(port, '0.0.0.0', () => console.log(`[API] Widget API listening on port ${port}`));
  return server;
}
