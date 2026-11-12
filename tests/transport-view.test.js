import test from 'node:test';
import assert from 'node:assert/strict';
import { combineParking, parkingReading, trafficFeatures, trafficPresentation } from '../src/operations/transportView.js';
import { trafficForBoard } from '../shared/traffic.js';
const now = Date.parse('2026-11-12T20:00:00Z');
const live = { id: 'operator:1', name: 'Central Garage', cityId: 'sofia', latitude: 42.69, longitude: 23.33, live: true, free: 0, capacity: 50, status: 'unknown', fetchedAt: new Date(now).toISOString() };
const osm = { ...live, id: 'way/1', name: 'Central garage', live: false };

test('parking combines a unique nearby named facility without fabricating spatial matches', () => {
  const merged = combineParking([live], [osm]);
  assert.equal(merged.length, 1); assert.equal(merged[0].free, 0); assert.equal(merged[0].osm.id, osm.id);
  assert.equal(combineParking([live], [{ ...osm, name: 'Different garage' }]).length, 2);
  assert.equal(combineParking([live], [{ ...osm, latitude: 43 }]).length, 2);
  assert.equal(combineParking([live], [osm, { ...osm, id: 'way/2' }]).length, 3);
  assert.equal(combineParking([{ ...live, name: 'Parking' }], [{ ...osm, name: 'Parking' }]).length, 2);
  assert.equal(combineParking([live], [{ ...osm, cityId: 'pernik' }]).length, 2);
});

test('parking distinguishes full, stale, closed, unknown, simulated and disrupted facilities', () => {
  assert.equal(parkingReading(live, now).free, 0);
  assert.equal(parkingReading(live, now, true).free, null);
  assert.equal(parkingReading(live, now + 5 * 60000).free, null);
  assert.equal(parkingReading({ ...live, status: 'closed', free: 20 }, now).kind, 'closed');
  assert.equal(parkingReading({ ...osm, simulated: false }, now).free, null);
  assert.equal(parkingReading({ ...osm, simulated: true, occupied: 10 }, now).kind, 'demo');
  assert.equal(parkingReading(live, now, false, true).kind, 'blocked');
});

test('only fresh matched traffic geometry is drawn; expired and unmatched rows are unknown', () => {
  const board = { id: 'board:1', cityId: 'sofia', number: 1 };
  const row = { number: 1, status: 'ok', kind: 'congestion', coordinates: [[23.33, 42.69], [23.34, 42.70]], fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString() };
  const snapshot = { cityId: 'sofia', rows: [row] };
  const fresh = trafficForBoard(board, snapshot, now);
  const stale = trafficForBoard(board, snapshot, now + 60000);
  const features = trafficFeatures([{ ...board, traffic: fresh }, { id: 'expired', traffic: stale }, { id: 'unmatched', traffic: { ...row, status: 'unmatched' } }]);
  assert.equal(features.features.length, 1);
  assert.deepEqual(features.features[0].geometry.coordinates, row.coordinates);
  assert.equal(trafficPresentation(stale).kind, 'unavailable');
  assert.equal(trafficPresentation(null).kind, 'unavailable');
  assert.equal(trafficForBoard(board, { ...snapshot, rows: [{ ...row, expiresAt: 'invalid' }] }, now).status, 'stale');
});
