import { airIndex, BANDS, bilinear, POLLUTANT_KEYS } from '../../shared/air.js';
import { TOWNS } from '../../shared/towns.js';
import { distanceKm } from './engine.js';

export const AIR_MAX_AGE = 90 * 60000;
const HOUR = 3600000;
export function airTownFor(city) {
  return TOWNS.find(t => distanceKm(city, { latitude: t.center[1], longitude: t.center[0] }) < 3) ?? null;
}

// Use the current hourly CAMS surface only. Historical playback, sensor snapshots
// and the AirNerve fused historical layer never become live board messages.
export function airAtBoard(board, snapshot, now = Date.now()) {
  // Boards may be on the outskirts: compare the snapshot to the selected city ID
  // supplied by the hook, then enforce its actual lattice coverage below.
  if (!snapshot || snapshot.cityId !== board.cityId || snapshot.cams?.status !== 'ok') return null;
  const fetched = Date.parse(snapshot.cams.fetchedAt);
  if (!Number.isFinite(fetched) || fetched > now + 60000 || now - fetched >= AIR_MAX_AGE) return null;
  const hour = Math.floor(now / HOUR) * HOUR;
  const index = snapshot.time?.findIndex(t => Date.parse(t) === hour) ?? -1;
  const { lons, lats } = snapshot.lattice ?? {};
  if (index < 0 || !lons?.length || !lats?.length || board.longitude < lons[0] || board.longitude > lons.at(-1) || board.latitude < lats[0] || board.latitude > lats.at(-1)) return null;
  const values = Object.fromEntries(POLLUTANT_KEYS.map(key => {
    const row = snapshot.cams.values?.[key]?.[index];
    const clean = row?.map(v => Number.isFinite(v) && v >= 0 ? v : null);
    return [key, bilinear(snapshot.lattice, clean, board.longitude, board.latitude)];
  }));
  const result = airIndex(values);
  if (!result) return null;
  const reading = { ...result, boardId: board.id, cityId: board.cityId, label: BANDS[result.band].label, values,
    partial: POLLUTANT_KEYS.some(key => values[key] === null), evidence: 'modelled',
    source: 'CAMS via Open-Meteo · regional model (~11 km)',
    validFrom: new Date(hour).toISOString(), expiresAt: new Date(Math.min(hour + HOUR, fetched + AIR_MAX_AGE)).toISOString(),
    fetchedAt: snapshot.cams.fetchedAt };
  return { ...reading, message: airBoardMessage(board, reading) };
}

export function airBoardMessage(board, air) {
  const advice = board.kind === 'entrance' ? 'USE PUBLIC TRANSPORT' : 'SWITCH ENGINE OFF\nWHEN PARKED';
  return `HIGH AIR POLLUTION\n${advice}`;
}
