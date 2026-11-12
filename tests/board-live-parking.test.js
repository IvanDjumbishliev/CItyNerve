import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CITY, boardMessage, pointAhead, freshOperatorParking } from '../src/operations/engine.js';
import { demoBoards } from '../src/operations/boards.js';
import { operatorParkingRows, parkingCityFor } from '../src/operations/liveParking.js';
const now = Date.now(), [board, opposite] = demoBoards(DEFAULT_CITY);
const position = pointAhead(board, 2);
const snapshot = { stale: false, fetchedAt: new Date(now).toISOString(), attribution: 'Test operator', facilities: [
  { id: 'operator-1', name: 'Park and ride', lat: position.latitude, lon: position.longitude, free: 12, capacity: null, measuredAt: null, status: 'unknown' },
] };
const rows = operatorParkingRows(DEFAULT_CITY, snapshot);

test('operator feed becomes an attributed directional board message without assuming unknown capacity', () => {
  const result = boardMessage(board, [], rows, now);
  assert.equal(result.message, 'PARK AND RIDE\n12 SPACES');
  assert.equal(result.evidence, 'reported'); assert.equal(result.source, 'Test operator');
  assert.equal(result.parking.capacity, null); assert.equal(result.parking.measuredAt, null);
  assert.equal(boardMessage(opposite, [], rows, now).evidence, 'routine');
  assert.deepEqual(operatorParkingRows(DEFAULT_CITY, { ...snapshot, stale: true }), []);
});
test('stale fetches, outdated observations, closed facilities and malformed counts are withheld', () => {
  for (const changes of [
    { fetchedAt: new Date(now - 300000).toISOString() }, { fetchedAt: 'invalid' },
    { measuredAt: new Date(now - 300000).toISOString() }, { measuredAt: 'invalid' },
    { measuredAt: new Date(now + 120000).toISOString() }, { status: 'closed' },
    { free: -1 }, { free: 1.5 }, { capacity: 5 }, { cityId: 'pernik' },
  ]) assert.equal(boardMessage(board, [], [{ ...rows[0], ...changes }], now).evidence, 'routine');
  assert.equal(freshOperatorParking(rows[0], now), true);
});
test('zero is a full facility, and nearby available live parking is preferred', () => {
  const full = { ...rows[0], free: 0 };
  assert.match(boardMessage(board, [], [full], now).message, /CAR PARK FULL/);
  const available = { ...rows[0], ...pointAhead(board, 2.5), id: 'other', free: 5 };
  assert.equal(boardMessage(board, [], [full, available], now).parking.id, 'other');
});
test('live beats simulated parking, while warnings and explicit access closures retain priority', () => {
  const demo = { ...pointAhead(board), cityId: board.cityId, id: 'demo', name: 'Demo', simulated: true, capacity: 10, occupied: 3 };
  assert.equal(boardMessage(board, [], [demo, ...rows], now).evidence, 'reported');
  const event = { ...pointAhead(board), cityId: board.cityId, id: 'flood', type: 'flood', evidence: 'simulation', status: 'published', radiusKm: 4, expiresAt: new Date(now + 60000).toISOString() };
  assert.equal(boardMessage(board, [event], rows, now).incident.id, 'flood');
  const behind = { ...event, ...pointAhead(board, -.5), type: 'closure', parkingId: rows[0].id };
  assert.equal(boardMessage(board, [behind], rows, now).evidence, 'routine');
});
test('provider city matching accepts geocoded Sofia and never substitutes a feed for Pernik', () => {
  assert.equal(parkingCityFor({ ...DEFAULT_CITY, id: 'geo:sofia' }), 'sofia');
  assert.equal(parkingCityFor({ latitude: 42.59, longitude: 23.055 }), null);
});
