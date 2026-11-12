import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CITY, boardMessage, isAhead, pointAhead } from '../src/operations/engine.js';
import { demoBoards, boardDemoLocation } from '../src/operations/boards.js';
const now = Date.now();
const boards = demoBoards(DEFAULT_CITY);
const [inbound, outbound] = boards;
const incident = (overrides = {}) => ({
  ...boardDemoLocation(inbound), id: 'flood', cityId: DEFAULT_CITY.id, type: 'flood', evidence: 'simulation', source: 'Demo',
  status: 'published', expiresAt: new Date(now + 60000).toISOString(), message: 'FLOOD AHEAD', ...overrides,
});

test('Sofia has independent paired approaches and inner-city boards, including geocoded city selection', () => {
  assert.equal(boards.length, 12);
  for (const kind of ['entrance', 'exit', 'urban']) assert.equal(boards.filter(b => b.kind === kind).length, 4);
  assert.equal(new Set(boards.map(b => b.id)).size, 12);
  assert.ok(boards.every(b => !b.parkingId));
  const searched = demoBoards({ ...DEFAULT_CITY, id: 'geo:sofia' });
  assert.equal(searched.length, 12);
  assert.ok(searched.every(b => b.cityId === 'geo:sofia'));
});

test('a local flood ahead warns inbound traffic but not outbound or every other sign', () => {
  const e = incident();
  assert.equal(boardMessage(inbound, [e], [], now).incident.id, e.id);
  assert.equal(boardMessage(outbound, [e], [], now).evidence, 'routine');
  const affected = boards.filter(b => boardMessage(b, [e], [], now).incident);
  assert.ok(affected.length > 0 && affected.length < boards.length);
  for (const status of ['draft', 'resolved']) assert.equal(boardMessage(inbound, [incident({ status })], [], now).evidence, 'routine');
  assert.equal(boardMessage(inbound, [e], [], now + 120000).evidence, 'routine');
});

test('every per-board demo places a report inside that board coverage', () => {
  for (const b of boards) {
    const e = incident({ ...boardDemoLocation(b) });
    assert.equal(boardMessage(b, [e], [], now).incident?.id, e.id, b.name);
  }
});

test('directional relevance rejects behind, cross-street and out-of-range reports', () => {
  assert.equal(isAhead(inbound, pointAhead(inbound, -.7)), false);
  assert.equal(isAhead(inbound, pointAhead({ ...inbound, heading: inbound.heading + 90 })), false);
  assert.equal(isAhead(inbound, pointAhead(inbound, 6)), false);
  const north = { ...DEFAULT_CITY, heading: 355, rangeKm: 3 };
  assert.equal(isAhead(north, pointAhead({ ...north, heading: 5 })), true);
});

test('city-area forecasts can reach both directions while local reports win a same-type tie', () => {
  const forecast = incident({ ...DEFAULT_CITY, id: 'weather', evidence: 'forecast', radiusKm: 15 });
  assert.equal(boardMessage(inbound, [forecast], [], now).incident.id, 'weather');
  assert.equal(boardMessage(outbound, [forecast], [], now).incident.id, 'weather');
  assert.equal(boardMessage(inbound, [forecast, incident()], [], now).incident.id, 'flood');
});

test('parking is selected by proximity and direction without moving boards; blocked and other-city lots are excluded', () => {
  const original = JSON.stringify(boards);
  const p = { ...pointAhead(inbound, .8), id: 'lot', cityId: DEFAULT_CITY.id, name: 'Demo parking', simulated: true, capacity: 20, occupied: 8 };
  assert.match(boardMessage(inbound, [], [p], now).message, /12 SPACES/);
  assert.equal(boardMessage(outbound, [], [p], now).evidence, 'routine');
  assert.equal(boardMessage(inbound, [], [{ ...p, cityId: 'elsewhere' }], now).evidence, 'routine');
  const closure = incident({ ...pointAhead(inbound, -.7), id: 'closure', type: 'closure', parkingId: p.id });
  assert.equal(boardMessage(inbound, [closure], [p], now).evidence, 'routine');
  assert.equal(JSON.stringify(demoBoards(DEFAULT_CITY)), original);
});
