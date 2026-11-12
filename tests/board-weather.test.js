import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CITY, FORECAST_TTL, boardMessage, boardWeather, forecastEvents, pointAhead } from '../src/operations/engine.js';
import { demoBoards } from '../src/operations/boards.js';
const now = Date.parse('2026-11-12T10:30:00Z');
const [board, opposite] = demoBoards(DEFAULT_CITY);
function payload() {
  return { hourly: { time: Array.from({ length: 24 }, (_, i) => new Date(Date.parse('2026-11-12T10:00:00Z') + i * 3600000).toISOString().slice(0, 16)), precipitation: Array(24).fill(0), visibility: Array(24).fill(10000), temperature_2m: Array(24).fill(8.4), apparent_temperature: Array(24).fill(8), weather_code: Array(24).fill(0) } };
}
test('temperature is current-hour air temperature, preserves zero and expires without leaking between cities', () => {
  const p = payload(); p.hourly.temperature_2m[0] = 0; p.hourly.temperature_2m[1] = 30;
  const weather = { ...forecastEvents(DEFAULT_CITY, p, now).stats, fetchedAt: now, cityId: 'sofia' };
  assert.equal(boardWeather(board, weather, now).temperature, 0);
  assert.equal(boardWeather(board, { ...weather, cityId: 'pernik' }, now), null);
  assert.equal(boardWeather(board, weather, now + FORECAST_TTL), null);
  p.hourly.temperature_2m[0] = null;
  const missing = { ...weather, ...forecastEvents(DEFAULT_CITY, p, now).stats };
  assert.equal(boardWeather(board, missing, now).temperature, null);
});
test('fog code activates near-term forecast warning even without visibility; distant fog stays off signs', () => {
  const p = payload(); p.hourly.visibility[1] = null; p.hourly.weather_code[1] = 45;
  const { events } = forecastEvents(DEFAULT_CITY, p, now);
  assert.equal(events[0].type, 'fog');
  assert.match(boardMessage(board, events, [], now).message, /^FOG EXPECTED\nNEXT 3 HOURS/);
  p.hourly.weather_code[1] = 0; p.hourly.weather_code[12] = 45;
  const distant = forecastEvents(DEFAULT_CITY, p, now).events;
  assert.equal(distant.length, 1);
  assert.equal(boardMessage(board, distant, [], now).evidence, 'routine');
});
test('low visibility alone is not labelled confirmed fog', () => {
  const p = payload(); p.hourly.visibility[0] = 300;
  const result = boardMessage(board, forecastEvents(DEFAULT_CITY, p, now).events, [], now);
  assert.match(result.message, /^LOW VISIBILITY EXPECTED/);
});
test('published queue is directional, expires and yields to fog, flood and closure', () => {
  const queue = { ...pointAhead(board), id: 'queue', cityId: board.cityId, type: 'congestion', evidence: 'simulation', status: 'published', radiusKm: 3, expiresAt: new Date(now + 60000).toISOString() };
  assert.equal(boardMessage(board, [queue], [], now).message, 'QUEUE AHEAD\nREDUCE SPEED\nPREPARE TO STOP');
  assert.equal(boardMessage(opposite, [queue], [], now).evidence, 'routine');
  assert.equal(boardMessage(board, [{ ...queue, status: 'draft' }], [], now).evidence, 'routine');
  assert.equal(boardMessage(board, [queue], [], now + 60000).evidence, 'routine');
  for (const type of ['fog', 'flood', 'closure']) assert.equal(boardMessage(board, [queue, { ...queue, id: type, type }], [], now).incident.type, type);
});
