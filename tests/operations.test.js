import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CITY as city, forecastEvents, reconcileForecast, boardMessage, normalizeParking, FORECAST_TTL } from '../src/operations/engine.js';
const now = Date.parse('2026-11-12T08:30:00Z');
function forecast(overrides = {}) {
  return { hourly: { time: Array.from({ length: 48 }, (_, i) => new Date(Date.parse('2026-11-12T00:00:00Z') + i * 3600000).toISOString().slice(0, 16)), precipitation: Array(48).fill(0), visibility: Array(48).fill(10000), apparent_temperature: Array(48).fill(15), ...overrides } };
}
const board = { ...city, cityId: city.id };
const event = { id: 'one', cityId: city.id, ...city, type: 'flood', status: 'published', expiresAt: new Date(now + 60000).toISOString(), radiusKm: 3, message: 'FLOOD WARNING', evidence: 'simulation' };
test('calm weather produces no incidents and exactly 24 forecast hours', () => {
  const r = forecastEvents(city, forecast({ precipitation: Array(48).fill(1) }), now);
  assert.equal(r.stats.rainTotal, 24); assert.equal(r.events.length, 0);
});
test('rain, visibility and heat create forecast advisories with expiry, not closures', () => {
  const { events } = forecastEvents(city, forecast({ precipitation: Array(48).fill(11), visibility: Array(48).fill(500), apparent_temperature: Array(48).fill(36) }), now);
  assert.deepEqual(events.map(e => e.type), ['flood', 'fog', 'heat']);
  for (const e of events) { assert.equal(e.evidence, 'forecast'); assert.equal(Date.parse(e.expiresAt), now + FORECAST_TTL); assert.ok(!e.message.includes('ROAD CLOSED')); }
});
test('missing weather values are unknown rather than zero', () => {
  const result = forecastEvents(city, forecast({ precipitation: Array(48).fill(null), visibility: Array(48).fill(null), apparent_temperature: Array(48).fill(null) }), now);
  assert.equal(result.stats.rainTotal, null); assert.equal(result.events.length, 0);
});
test('stale forecast dates fail validation', () => assert.throws(() => forecastEvents(city, forecast(), now + 4 * 86400000)));
test('refresh deduplicates alerts, resolves cleared hazards and preserves other cities', () => {
  const { events } = forecastEvents(city, forecast({ visibility: Array(48).fill(100) }), now);
  const other = { ...events[0], id: 'other', cityId: 'pernik' };
  const once = reconcileForecast([other], events, city.id, now);
  const twice = reconcileForecast(once, events, city.id, now);
  assert.equal(twice.length, 2);
  const cleared = reconcileForecast(twice, [], city.id, now);
  assert.equal(cleared.find(e => e.cityId === city.id).status, 'resolved');
  assert.equal(cleared.find(e => e.cityId === 'pernik').status, 'published');
});
test('boards ignore draft, expired, distant and other-city incidents', () => {
  for (const changes of [{ status: 'draft' }, { expiresAt: new Date(now - 1).toISOString() }, { longitude: 25 }, { cityId: 'pernik' }, { status: 'resolved' }]) {
    assert.equal(boardMessage(board, [{ ...event, ...changes }], [], now).evidence, 'routine');
  }
});
test('published closures take precedence and expiry restores parking', () => {
  const parking = [{ ...city, cityId: city.id, id: 'p', name: 'Public lot', simulated: true, capacity: 50, occupied: 40 }];
  const b = { ...board, parkingId: 'p' };
  const closure = { ...event, id: 'closure', type: 'closure', message: 'ROAD CLOSED' };
  assert.equal(boardMessage(b, [event, closure], parking, now).message, 'ROAD CLOSED');
  assert.match(boardMessage(b, [event, closure], parking, now + 120000).message, /10 SPACES/);
});
test('OSM parking excludes restricted facilities and preserves unknown capacity', () => {
  const elements = ['yes', 'private', 'customers', 'no', 'permit', undefined].map((access, id) => ({ type: 'node', id, lat: 42, lon: 23, tags: { amenity: 'parking', access } }));
  const rows = normalizeParking(elements); assert.equal(rows.length, 2); assert.equal(rows[0].capacity, null); assert.equal(rows[1].access, 'unknown');
});
