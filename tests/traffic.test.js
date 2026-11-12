import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { normalizeTraffic, trafficForBoard, TRAFFIC_CACHE_MS, TRAFFIC_MAX_AGE } from '../shared/traffic.js';
import { createTrafficService, createTrafficMiddleware } from '../server/traffic.js';
import { DEFAULT_CITY, boardMessage, pointAhead } from '../src/operations/engine.js';
const now = Date.parse('2026-11-12T20:00:00Z');
const board = { ...DEFAULT_CITY, id: 'board:sofia:test', cityId: 'sofia', number: 1, heading: 0, rangeKm: 3 };
const point = pointAhead(board, .2);
function payload(changes = {}) {
  return { flowSegmentData: { currentSpeed: 10, freeFlowSpeed: 50, currentTravelTime: 200, freeFlowTravelTime: 40, confidence: .95, roadClosure: false,
    coordinates: { coordinate: [pointAhead(board, .1), pointAhead(board, .3)] }, ...changes } };
}
test('matched slow segment produces live congestion, with segment-only delay and provenance', () => {
  const row = normalizeTraffic(payload(), board, point, now);
  assert.equal(row.status, 'ok'); assert.equal(row.kind, 'congestion');
  assert.equal(row.delaySeconds, 160); assert.equal(row.source, 'TomTom Traffic');
  assert.match(boardMessage(board, [], [], now, null, row).message, /SLOW TRAFFIC AHEAD/);
});
test('opposite, distant and low-confidence segments cannot drive signs', () => {
  for (const changes of [
    { coordinates: { coordinate: [pointAhead(board, .3), pointAhead(board, .1)] } },
    { coordinates: { coordinate: [{ latitude: 43, longitude: 24 }, { latitude: 43.1, longitude: 24 }] } },
    { confidence: .5 },
  ]) {
    const row = normalizeTraffic(payload(changes), board, point, now);
    assert.equal(row.status, 'unmatched');
    assert.equal(boardMessage(board, [], [], now, null, row).evidence, 'routine');
  }
  assert.throws(() => normalizeTraffic(payload({ currentSpeed: null }), board, point, now));
  assert.throws(() => normalizeTraffic(payload({ roadClosure: 'false' }), board, point, now));
});
test('traffic thresholds do not confuse naturally slow roads with congestion', () => {
  assert.equal(normalizeTraffic(payload({ currentSpeed: 15, freeFlowSpeed: 15, currentTravelTime: 40 }), board, point, now).kind, 'flow');
  assert.equal(normalizeTraffic(payload({ currentTravelTime: 50 }), board, point, now).kind, 'flow');
  assert.equal(normalizeTraffic(payload({ currentSpeed: 0, roadClosure: true }), board, point, now).kind, 'closure');
});
test('traffic expires, respects city identity and yields to local flood warnings', () => {
  const row = normalizeTraffic(payload(), board, point, now);
  const snapshot = { cityId: 'sofia', rows: [row] };
  assert.equal(trafficForBoard(board, snapshot, now + TRAFFIC_MAX_AGE).status, 'stale');
  assert.equal(trafficForBoard({ ...board, cityId: 'pernik' }, snapshot, now), null);
  assert.equal(boardMessage(board, [], [], now + TRAFFIC_MAX_AGE, null, row).evidence, 'routine');
  const flood = { ...point, cityId: 'sofia', id: 'flood', type: 'flood', status: 'published', radiusKm: 3, expiresAt: new Date(now + 60000).toISOString(), evidence: 'simulation' };
  assert.equal(boardMessage(board, [flood], [], now, null, row).incident.id, 'flood');
  const closure = normalizeTraffic(payload({ roadClosure: true }), board, point, now);
  assert.equal(boardMessage(board, [flood], [], now, null, closure).traffic.kind, 'closure');
});
test('shared traffic cache deduplicates callers and refreshes after five minutes', async () => {
  let calls = 0, clock = now;
  const service = createTrafficService({ key: () => 'test-secret', now: () => clock, boards: [board], spacingMs: 0, fetchImpl: async url => {
    calls++; assert.equal(new URL(url).searchParams.get('key'), 'test-secret');
    return Response.json(payload());
  } });
  const [a, b] = await Promise.all([service(), service()]);
  assert.equal(calls, 1); assert.deepEqual(a, b); await service(); assert.equal(calls, 1);
  clock += TRAFFIC_CACHE_MS; await service(); assert.equal(calls, 2);
  assert.equal(JSON.stringify(a).includes('test-secret'), false);
});
test('missing keys and provider failures do not leak credentials or reuse old speeds', async () => {
  const missing = createTrafficService({ key: () => '', fetchImpl: () => assert.fail('no network') });
  assert.equal((await missing()).configured, false);
  for (const status of [403, 429, 503]) {
    const service = createTrafficService({ key: () => 'test-secret', boards: [board], spacingMs: 0, fetchImpl: async () => new Response('upstream test-secret', { status }) });
    const data = await service(); assert.equal(data.rows[0].status, 'unavailable');
    assert.equal(JSON.stringify(data).includes('test-secret'), false);
  }
});
test('HTTP service restricts queries to Sofia and GET, with a usable same-origin response', async t => {
  const middleware = createTrafficMiddleware(async () => ({ city: 'sofia', configured: true, rows: [] }));
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/traffic?city=sofia')).status, 200);
  assert.equal((await fetch(base + '/api/traffic?city=pernik')).status, 400);
  assert.equal((await fetch(base + '/api/traffic?city=sofia', { method: 'POST' })).status, 405);
});
