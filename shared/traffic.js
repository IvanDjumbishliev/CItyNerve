import { bearingDegrees, distanceKm } from '../src/operations/engine.js';

export const TRAFFIC_CACHE_MS = 5 * 60000;
export const TRAFFIC_MAX_AGE = 6 * 60000;
export function normalizeTraffic(payload, board, point, now = Date.now()) {
  const f = payload?.flowSegmentData;
  const numeric = ['currentSpeed', 'freeFlowSpeed', 'currentTravelTime', 'freeFlowTravelTime', 'confidence'];
  if (!f || numeric.some(k => !Number.isFinite(f[k]) || f[k] < 0) || f.confidence > 1 || typeof f.roadClosure !== 'boolean') throw Error('Invalid traffic response');
  const geometry = f.coordinates?.coordinate;
  if (!Array.isArray(geometry) || geometry.length < 2 || geometry.some(p => !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180)) throw Error('Invalid road geometry');
  let nearest = null;
  const lonScale = 111.195 * Math.cos(point.latitude * Math.PI / 180);
  for (let i = 1; i < geometry.length; i++) {
    const a = geometry[i - 1], b = geometry[i];
    const dx = (b.longitude - a.longitude) * lonScale, dy = (b.latitude - a.latitude) * 111.195;
    if (dx * dx + dy * dy < 1e-10) continue;
    const t = Math.max(0, Math.min(1, ((point.longitude - a.longitude) * lonScale * dx + (point.latitude - a.latitude) * 111.195 * dy) / (dx * dx + dy * dy)));
    const projected = { latitude: a.latitude + t * (b.latitude - a.latitude), longitude: a.longitude + t * (b.longitude - a.longitude) };
    const distance = distanceKm(point, projected);
    if (!nearest || distance < nearest.distance) nearest = { distance, heading: bearingDegrees(a, b) };
  }
  const difference = nearest ? Math.abs(((nearest.heading - board.heading + 540) % 360) - 180) : 180;
  const matched = nearest && nearest.distance <= .075 && difference <= 45;
  const usable = matched && f.confidence >= .7 && (f.roadClosure || f.freeFlowSpeed > 0);
  const ratio = f.freeFlowSpeed > 0 ? f.currentSpeed / f.freeFlowSpeed : null;
  const delaySeconds = Math.max(0, f.currentTravelTime - f.freeFlowTravelTime);
  const kind = f.roadClosure ? 'closure' : ratio <= .6 && delaySeconds >= 15 ? 'congestion' : 'flow';
  return { boardId: board.id, cityId: board.cityId, number: board.number,
    status: usable ? 'ok' : 'unmatched', reason: !matched ? 'Nearby road does not match this board position and direction.' : f.confidence < .7 ? 'Traffic confidence is too low.' : !usable ? 'No usable free-flow reference.' : null,
    currentSpeed: f.currentSpeed, freeFlowSpeed: f.freeFlowSpeed, delaySeconds,
    confidence: f.confidence, roadClosure: f.roadClosure, kind, ratio,
    coordinates: geometry.map(p => [p.longitude, p.latitude]),
    fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + TRAFFIC_MAX_AGE).toISOString(),
    source: 'TomTom Traffic', evidence: 'traffic',
    message: kind === 'closure' ? 'CLOSURE REPORTED\nCHECK LOCAL SIGNS' : kind === 'congestion' ? 'SLOW TRAFFIC AHEAD\nREDUCE SPEED' : `TRAFFIC MOVING\n${Math.round(f.currentSpeed)} KM/H AVG`,
  };
}
export function trafficForBoard(board, snapshot, now = Date.now()) {
  if (!snapshot || snapshot.cityId !== board.cityId) return null;
  const row = snapshot.rows?.find(r => r.number === board.number);
  if (!row) return null;
  if (row.status === 'ok' && (Date.parse(row.expiresAt) <= now || !Number.isFinite(Date.parse(row.fetchedAt)) || Date.parse(row.fetchedAt) > now + 60000)) return { ...row, status: 'stale', reason: 'Traffic reading expired.' };
  return { ...row, boardId: board.id, cityId: board.cityId };
}
