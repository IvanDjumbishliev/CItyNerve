import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CITY, boardMessage, pointAhead } from '../src/operations/engine.js';
import { airAtBoard, AIR_MAX_AGE, airTownFor } from '../src/operations/boardAir.js';
import { demoBoards } from '../src/operations/boards.js';
const now = Date.parse('2026-11-12T10:30:00Z');
const [board] = demoBoards(DEFAULT_CITY);
function snapshot(value = 60) {
  return { cityId: DEFAULT_CITY.id, town: { id: 'sofia' }, time: ['2026-11-12T09:00:00Z', '2026-11-12T10:00:00Z', '2026-11-12T11:00:00Z'],
    lattice: { lons: [23.1, 23.5], lats: [42.5, 42.9] },
    cams: { status: 'ok', fetchedAt: new Date(now).toISOString(), values: Object.fromEntries(['pm25', 'pm10', 'no2', 'o3', 'so2'].map(key => [key, [Array(4).fill(500), Array(4).fill(key === 'pm25' ? value : 0), Array(4).fill(999)]])) } };
}
test('current-hour air estimates use existing EEA bands and retain model provenance', () => {
  const air = airAtBoard(board, snapshot(), now);
  assert.equal(air.label, 'Poor');
  assert.equal(air.dominant, 'pm25');
  assert.ok(Math.abs(air.values.pm25 - 60) < 1e-9);
  assert.equal(air.message, 'HIGH AIR POLLUTION\nUSE PUBLIC TRANSPORT');
  assert.equal(air.evidence, 'modelled');
  assert.equal(air.expiresAt, '2026-11-12T11:00:00.000Z');
  assert.equal(airAtBoard(board, snapshot(0), now).label, 'Good');
});
test('stale, missing, wrong-city, outside-grid and old-hour data never becomes a clean-air message', () => {
  for (const mutate of [
    s => { s.cams.status = 'stale'; },
    s => { s.cams.fetchedAt = new Date(now - AIR_MAX_AGE).toISOString(); },
    s => { s.cams.fetchedAt = new Date(now + 3600000).toISOString(); },
    s => { s.cityId = 'pernik'; },
    s => { s.time = ['2020-01-01T00:00:00Z']; },
    s => { s.lattice.lons = [24, 25]; },
    s => { s.cams.values = {}; },
  ]) { const s = snapshot(); mutate(s); assert.equal(airAtBoard(board, s, now), null); }
  assert.equal(airAtBoard(board, null, now), null);
});
test('missing pollutants stay unknown and produce an explicitly partial index', () => {
  const s = snapshot(); delete s.cams.values.pm10;
  const air = airAtBoard(board, s, now);
  assert.equal(air.values.pm10, null);
  assert.equal(air.partial, true);
  assert.equal(air.evidence, 'modelled');
});
test('different board positions sample different model values without using sensor snapshots', () => {
  const s = snapshot(); s.cams.values.pm25[1] = [0, 100, 0, 100];
  s.sensors = { items: [{ pm25: 9999 }] };
  const west = airAtBoard({ ...board, longitude: 23.1 }, s, now);
  const east = airAtBoard({ ...board, longitude: 23.5 }, s, now);
  assert.equal(west.label, 'Good'); assert.equal(east.label, 'Very poor');
});
test('air messaging respects emergencies, parking priority, city and board identity, and expiry', () => {
  const air = airAtBoard(board, snapshot(), now);
  const parking = [{ ...pointAhead(board), id: 'p', cityId: board.cityId, simulated: true, name: 'Lot', capacity: 50, occupied: 20 }];
  assert.equal(boardMessage(board, [], parking, now, air).air, air);
  const good = airAtBoard(board, snapshot(0), now);
  assert.match(boardMessage(board, [], parking, now, good).message, /SPACES/);
  assert.equal(boardMessage(board, [], [], now, good).evidence, 'routine');
  const flood = { ...pointAhead(board), id: 'f', cityId: board.cityId, radiusKm: 3, type: 'flood', status: 'published', expiresAt: new Date(now + 60000).toISOString(), message: 'FLOOD AHEAD', evidence: 'simulation' };
  assert.equal(boardMessage(board, [flood], parking, now, air).incident.id, 'f');
  for (const bad of [{ ...air, boardId: 'another' }, { ...air, cityId: 'another' }, { ...air, expiresAt: new Date(now).toISOString() }]) assert.equal(boardMessage(board, [], [], now, bad).evidence, 'routine');
});
test('city matching supports geocoded Sofia and never substitutes Sofia for Pernik', () => {
  assert.equal(airTownFor({ ...DEFAULT_CITY, id: 'geo:sofia' }).id, 'sofia');
  assert.equal(airTownFor({ latitude: 42.59, longitude: 23.055 }), null);
});
