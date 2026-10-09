// @ts-nocheck
import http from 'node:http';
import { TimedCache } from '../services/cache-service.js';
import { PositionService } from '../services/position-service.js';
import { getPositionsResponse } from './routes/positions.js';

// @ts-nocheck
const cache = new TimedCache(20_000);

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

export function startApiServer(meteora) {
  const token = process.env.API_TOKEN;
  if (!token) {
    console.log('[API] Disabled. Set API_TOKEN to enable the phone/widget API.');
    return null;
  }

  const port = Number(process.env.API_PORT || 3000);
  const positionService = new PositionService(meteora);
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
    if (cached) return sendJson(response, 200, cached);

    try {
      const data = await getPositionsResponse(positionService, wallet, limit);
      cache.set(cacheKey, data);
      return sendJson(response, 200, data);
    } catch (error) {
      console.error('[API] Failed to load positions:', error);
      return sendJson(response, 502, { error: 'Could not load Meteora positions' });
    }
  });

  server.listen(port, '0.0.0.0', () => console.log(`[API] Widget API listening on port ${port}`));
  return server;
}
