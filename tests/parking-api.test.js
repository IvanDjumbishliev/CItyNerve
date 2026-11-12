import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOverpassParking as fetchParking } from '../server/osmParking.js';
import { mergeParking } from '../src/operations/engine.js';
const city = { latitude: 42.692, longitude: 23.326 };
const endpoints = ['https://first.example/api', 'https://second.example/api'];
const element = { type: 'node', id: 1, lat: 42.69, lon: 23.32, tags: { amenity: 'parking', capacity: '30', name: 'Test fixture' } };
const success = () => Response.json({ elements: [element] });
test('busy provider falls back, reports progress and returns source metadata', async () => {
  const calls = [], progress = [];
  const rows = await fetchParking(city, undefined, { endpoints, onProgress: x => progress.push(x), fetchImpl: async url => { calls.push(url); return calls.length === 1 ? new Response('busy', { status: 502 }) : success(); } });
  assert.equal(calls.length, 2); assert.equal(rows[0].provider, 'second.example'); assert.equal(rows[0].capacity, 30); assert.equal(progress.length, 2);
  assert.match(decodeURIComponent(calls[0]), /around:3500,42.692,23.326/);
});
test('invalid JSON and incomplete query results do not masquerade as empty parking', async () => {
  let count = 0;
  await assert.rejects(fetchParking(city, undefined, { endpoints, fetchImpl: async () => ++count === 1 ? new Response('<html>error</html>') : Response.json({ remark: 'Query timed out', elements: [] }) }), /invalid response.*incomplete response/);
});
test('network errors fall back; a valid empty response is accepted', async () => {
  let count = 0;
  const rows = await fetchParking(city, undefined, { endpoints, fetchImpl: async () => { if (++count === 1) throw new TypeError('Failed to fetch'); return Response.json({ elements: [] }); } });
  assert.deepEqual(rows, []); assert.equal(count, 2);
});
test('per-provider timeout advances to the next provider', async () => {
  let count = 0;
  const rows = await fetchParking(city, undefined, { endpoints, timeoutMs: 5, fetchImpl: async (url, { signal }) => {
    if (++count === 2) return success();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError'))));
  } });
  assert.equal(rows.length, 1); assert.equal(count, 2);
});
test('cancelled requests never fall back or publish a result', async () => {
  const controller = new AbortController(); let count = 0;
  await assert.rejects(fetchParking(city, controller.signal, { endpoints, fetchImpl: async () => { count++; controller.abort(); throw new DOMException('Cancelled', 'AbortError'); } }), { name: 'AbortError' });
  assert.equal(count, 1);
});
test('malformed coordinates are rejected before a network request', async () => {
  await assert.rejects(fetchParking({ ...city, latitude: 95 }, undefined, { fetchImpl: () => assert.fail('network should not run') }), /valid coordinates/);
});
test('refresh preserves simulation and other cities, clamps occupancy to new capacity', () => {
  const previous = [{ id: 'node/1', cityId: 'sofia', simulated: true, capacity: 50, capacitySource: 'OpenStreetMap', occupied: 45 }, { id: 'node/2', cityId: 'pernik' }];
  const rows = mergeParking(previous, [{ id: 'node/1', capacity: 30, capacitySource: 'OpenStreetMap' }], 'sofia');
  assert.equal(rows[0].cityId, 'pernik'); assert.equal(rows[1].occupied, 30); assert.equal(rows[1].simulated, true);
});
test('assumed capacity survives only when source capacity remains unknown', () => {
  const previous = [{ id: 'p', cityId: 'sofia', simulated: true, capacity: 50, occupied: 20, capacitySource: 'Demo assumption: 50 spaces' }];
  const unknown = mergeParking(previous, [{ id: 'p', capacity: null, capacitySource: 'Unknown' }], 'sofia')[0];
  assert.equal(unknown.capacity, 50); assert.match(unknown.capacitySource, /Demo assumption/);
  const known = mergeParking(previous, [{ id: 'p', capacity: 10, capacitySource: 'OpenStreetMap' }], 'sofia')[0];
  assert.equal(known.capacity, 10); assert.equal(known.capacitySource, 'OpenStreetMap'); assert.equal(known.occupied, 10);
});
