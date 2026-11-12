import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInventoryService, createOsmParkingMiddleware } from '../server/osmParking.js';
import { fetchParking } from '../src/operations/api.js';
const city = { latitude: 42.692, longitude: 23.326 };
const DAY = 86400000;

test('inventory deduplicates simultaneous requests, caches locations and bounds stale fallback', async () => {
  let time = Date.now(), calls = 0, fail = false;
  const service = createInventoryService({ now: () => time, load: async () => {
    calls++;
    if (fail) throw Error('Provider offline');
    return [{ id: 'node/1', fetchedAt: new Date(time).toISOString() }];
  } });
  const [first, second] = await Promise.all([service(city), service(city)]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  time += 60000;
  assert.equal((await service(city)).cached, true);
  assert.equal(calls, 1);
  time += DAY; fail = true;
  const stale = await service(city);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.equal(stale.parking[0].fetchedAt, first.parking[0].fetchedAt);
  time += 7 * DAY;
  await assert.rejects(service(city), /Provider offline/);
});

test('saved inventory works after service restart without an upstream request', async () => {
  let saved;
  const service = createInventoryService({ load: async () => [], writeCache: async (key, data) => { saved = data; } });
  await service(city);
  const restarted = createInventoryService({ readCache: async () => saved, load: () => assert.fail('cache should satisfy request') });
  assert.deepEqual((await restarted(city)).parking, []);
  assert.equal((await restarted(city)).cached, true);
});

test('same-origin API serves client, rejects invalid coordinates and reports upstream failures', async t => {
  const middleware = createOsmParkingMiddleware(createInventoryService({ load: async point => {
    if (point.latitude === 0) throw Error('Providers unavailable');
    return [{ id: 'way/1', capacity: null, simulated: false }];
  } }));
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetchImpl = (url, options) => fetch(base + url, options);
  const rows = await fetchParking(city, undefined, { fetchImpl });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].simulated, false);
  assert.equal(rows[0].capacity, null);
  assert.equal((await fetch(base + '/api/osm-parking?latitude=91&longitude=23')).status, 400);
  assert.equal((await fetch(base + '/api/osm-parking?longitude=23')).status, 400);
  assert.equal((await fetch(base + '/api/osm-parking?latitude=&longitude=23')).status, 400);
  assert.equal((await fetch(base + '/api/osm-parking', { method: 'POST' })).status, 405);
  await assert.rejects(fetchParking({ latitude: 0, longitude: 0 }, undefined, { fetchImpl }), /Providers unavailable/);
});
