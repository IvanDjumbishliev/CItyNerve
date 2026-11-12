import { distanceKm, freshOperatorParking } from './engine.js';

const nameKey = name => (name ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Only merge an exact meaningful name nearby. Proximity alone cannot identify a facility.
export function combineParking(live, inventory) {
  const used = new Set();
  const rows = live.map(p => {
    const name = nameKey(p.name);
    const matches = inventory.filter(q => !used.has(q.id) && q.cityId === p.cityId && name && !['parking', 'unnamedparking', 'паркинг'].includes(name) && nameKey(q.name) === name && distanceKm(p, q) <= .1);
    const osm = matches.length === 1 ? matches[0] : null;
    if (osm) used.add(osm.id);
    return { ...p, osm, key: `live:${p.id}` };
  });
  return [...rows, ...inventory.filter(p => !used.has(p.id)).map(p => ({ ...p, key: `osm:${p.id}` }))];
}

export function parkingReading(p, now, stale = false, blocked = false) {
  if (blocked) return { label: 'Access disrupted · demo', free: null, color: '#dc6b60', kind: 'blocked' };
  if (p.live) {
    if (p.status === 'closed') return { label: 'Closed by operator', free: null, color: '#dc6b60', kind: 'closed' };
    if (stale || !freshOperatorParking(p, now)) return { label: 'Availability unavailable', free: null, color: '#7c8997', kind: 'unknown' };
    return { label: p.free === 0 ? 'Full · 0 spaces' : `${p.free} spaces reported`, free: p.free, color: p.free === 0 ? '#dc6b60' : '#26977c', kind: 'live' };
  }
  if (p.simulated && Number.isFinite(p.capacity) && Number.isFinite(p.occupied)) {
    const free = Math.max(0, p.capacity - p.occupied);
    return { label: `${free} spaces · simulated`, free, color: '#a780d6', kind: 'demo' };
  }
  return { label: 'Availability unknown', free: null, color: '#5988bc', kind: 'inventory' };
}

export const TRAFFIC_COLORS = { flow: '#26977c', congestion: '#f4af46', closure: '#e16d66', unavailable: '#7c8997' };
export function trafficPresentation(row) {
  if (row?.status !== 'ok') return { kind: 'unavailable', color: TRAFFIC_COLORS.unavailable, label: row?.status === 'stale' ? 'Expired reading' : row?.status === 'unmatched' ? 'Unmatched reading' : 'No usable reading' };
  return { kind: row.kind, color: TRAFFIC_COLORS[row.kind], label: row.kind === 'closure' ? 'Closure reported' : row.kind === 'congestion' ? 'Slow traffic' : 'No slowdown detected' };
}

export function trafficFeatures(rows) {
  return { type: 'FeatureCollection', features: rows.filter(b => b.traffic?.status === 'ok' && b.traffic.coordinates?.length >= 2).map(b => ({
    type: 'Feature', properties: { id: b.id, color: trafficPresentation(b.traffic).color },
    geometry: { type: 'LineString', coordinates: b.traffic.coordinates },
  })) };
}
