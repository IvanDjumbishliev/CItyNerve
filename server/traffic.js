import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { DEFAULT_CITY, pointAhead } from '../src/operations/engine.js';
import { demoBoards } from '../src/operations/boards.js';
import { normalizeTraffic, TRAFFIC_CACHE_MS } from '../shared/traffic.js';

function serverKey() {
  if (process.env.TOMTOM_API_KEY) return process.env.TOMTOM_API_KEY;
  try { return parseEnv(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')).TOMTOM_API_KEY; } catch { return ''; }
}
export function createTrafficService({ key = serverKey, fetchImpl = fetch, now = Date.now, boards = demoBoards(DEFAULT_CITY), spacingMs = 300 } = {}) {
  let cached = null, pending = null;
  return async function snapshot() {
    if (cached && now() - cached.at < TRAFFIC_CACHE_MS) return cached.data;
    if (pending) return pending;
    const apiKey = key();
    if (!apiKey) return { configured: false, city: 'sofia', rows: [], error: 'TomTom key is not configured on the server.' };
    pending = (async () => {
      const rows = await Promise.all(boards.map(async (board, index) => {
        // Stagger requests to stay below the provider's typical per-second limit.
        if (index && spacingMs) await new Promise(resolve => setTimeout(resolve, index * spacingMs));
        const point = pointAhead(board, .2);
        try {
          const url = new URL('https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/16/json');
          url.search = new URLSearchParams({ key: apiKey, point: `${point.latitude},${point.longitude}`, unit: 'kmph', thickness: '1' });
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
          if (!response.ok) {
            const error = new Error('Provider request failed'); error.status = response.status; throw error;
          }
          return normalizeTraffic(await response.json(), board, point, now());
        } catch (error) {
          // Never expose request URLs, credentials or upstream error bodies.
          const reason = [401, 403].includes(error.status) ? 'TomTom denied traffic access for this key.' : error.status === 429 ? 'TomTom request quota or rate limit reached.' : 'Traffic provider unavailable for this road.';
          return { boardId: board.id, cityId: board.cityId, number: board.number, status: 'unavailable', reason };
        }
      }));
      const data = { configured: true, city: 'sofia', fetchedAt: new Date(now()).toISOString(), refreshAfterMs: TRAFFIC_CACHE_MS, rows, attribution: '© TomTom' };
      cached = { at: now(), data };
      return data;
    })();
    try { return await pending; } finally { pending = null; }
  };
}
export function createTrafficMiddleware(service = createTrafficService()) {
  return function trafficMiddleware(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/traffic') return next();
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (req.method !== 'GET') return send(405, { error: 'Use GET.' });
    // Fixed demo network prevents arbitrary requests against the account quota.
    if (url.searchParams.get('city') !== 'sofia') return send(400, { error: 'Live traffic is configured for the Sofia demo network.' });
    return service().then(data => send(200, data)).catch(() => send(503, { error: 'Traffic service unavailable.' }));
  };
}
export const trafficMiddleware = createTrafficMiddleware();
export const trafficPlugin = {
  name: 'traffic-service',
  configureServer(server) { server.middlewares.use(trafficMiddleware); },
  configurePreviewServer(server) { server.middlewares.use(trafficMiddleware); },
};
