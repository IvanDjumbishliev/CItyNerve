export const FORECAST_TTL = 45 * 60 * 1000;
export const DEFAULT_CITY = { id: 'sofia', label: 'Sofia', country: 'Bulgaria', latitude: 42.692, longitude: 23.326 };
export const CITY_PRESETS = [DEFAULT_CITY, { id: 'pernik', label: 'Pernik', country: 'Bulgaria', latitude: 42.59, longitude: 23.055 }];
export const RULES = { rainHour: 10, rainDay: 30, visibility: 1000, apparentTemperature: 35 };
export function distanceKm(a, b) {
  const rad = x => x * Math.PI / 180;
  const dlat = rad(b.latitude - a.latitude), dlon = rad(b.longitude - a.longitude);
  const v = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(1 - v));
}
export function forecastEvents(city, payload, now = Date.now()) {
  const h = payload.hourly;
  if (!h?.time?.length) throw new Error('Weather response has no hourly forecast.');
  const start = Math.floor(now / 3600000) * 3600000;
  const indices = h.time.map((t, i) => ({ t: Date.parse(t + 'Z'), i })).filter(x => x.t >= start && x.t < start + 24 * 3600000);
  if (!indices.length) throw new Error('No forecast covers the next 24 hours.');
  const values = key => indices.map(x => h[key]?.[x.i]).filter(Number.isFinite);
  const rain = values('precipitation'), visibility = values('visibility'), heat = values('apparent_temperature');
  const stats = { rainPeak: rain.length ? Math.max(...rain) : null, rainTotal: rain.length ? rain.reduce((a, b) => a + b, 0) : null, visibilityMin: visibility.length ? Math.min(...visibility) : null, heatMax: heat.length ? Math.max(...heat) : null, validFrom: new Date(indices[0].t).toISOString(), validTo: new Date(indices.at(-1).t + 3600000).toISOString() };
  const triggers = [
    ['flood', rain.length && (stats.rainPeak >= RULES.rainHour || stats.rainTotal >= RULES.rainDay), 'Heavy-rain / potential flood-risk advisory', 'HEAVY RAIN EXPECTED\nFLOOD RISK · DRIVE WITH CARE'],
    ['fog', visibility.length && stats.visibilityMin < RULES.visibility, 'Low visibility forecast', 'LOW VISIBILITY EXPECTED\nDRIVE WITH CARE'],
    ['heat', heat.length && stats.heatMax >= RULES.apparentTemperature, 'High apparent temperature forecast', 'HEAT ADVISORY\nPLAN COOLER TRAVEL TIMES'],
  ];
  return { stats, events: triggers.filter(x => x[1]).map(([type, , title, message]) => ({ id: `forecast:${city.id}:${type}`, cityId: city.id, type, title, message, source: 'Open-Meteo forecast', evidence: 'forecast', severity: 'advisory', status: 'published', latitude: city.latitude, longitude: city.longitude, radiusKm: 15, observedAt: new Date(now).toISOString(), expiresAt: new Date(now + FORECAST_TTL).toISOString(), validFrom: stats.validFrom, validTo: stats.validTo, scope: 'City-area model forecast; local conditions may differ.' })) };
}
export function reconcileForecast(previous, events, cityId, now = Date.now()) {
  const ids = new Set(events.map(e => e.id));
  return [...events.map(e => { const old = previous.find(x => x.id === e.id); return { ...e, createdAt: old?.createdAt ?? e.observedAt }; }), ...previous.filter(e => !ids.has(e.id)).map(e => e.cityId === cityId && e.evidence === 'forecast' && e.status === 'published' ? { ...e, status: 'resolved', resolvedAt: new Date(now).toISOString() } : e)].slice(0, 200);
}
export const isActive = (event, now = Date.now()) => event.status === 'published' && Date.parse(event.expiresAt) > now;
export function boardMessage(board, incidents, parking, now = Date.now()) {
  const ranks = { closure: 4, flood: 3, fog: 2, heat: 1 };
  const incident = incidents.filter(e => e.cityId === board.cityId && isActive(e, now) && distanceKm(board, e) <= e.radiusKm).sort((a, b) => (ranks[b.type] ?? 0) - (ranks[a.type] ?? 0))[0];
  if (incident) return { message: incident.message, incident, evidence: incident.evidence, source: incident.source };
  const p = parking.find(x => x.id === board.parkingId);
  if (p?.simulated && Number.isFinite(p.capacity)) return { message: `${p.name}\n${Math.max(0, p.capacity - p.occupied)} SPACES · SIMULATED`, evidence: 'simulation', source: 'Parking simulator' };
  return { message: 'CITY INFORMATION\nNO ACTIVE LOCAL ADVISORY', evidence: 'routine', source: 'CityNerve' };
}
export function normalizeParking(elements) {
  return elements.filter(e => e.tags?.amenity === 'parking' && !['private', 'no', 'customers', 'permit'].includes(e.tags.access)).map(e => {
    const t = e.tags, capacity = /^\d+$/.test(t.capacity ?? '') ? Number(t.capacity) : null;
    return { id: `${e.type}/${e.id}`, name: t.name || 'Unnamed parking', latitude: e.lat ?? e.center?.lat, longitude: e.lon ?? e.center?.lon, capacity, access: t.access ?? 'unknown', capacitySource: capacity === null ? 'Unknown' : 'OpenStreetMap', simulated: false, occupied: 0 };
  }).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
}

// Refresh geographic metadata without discarding the operator's demo state.
export function mergeParking(previous, rows, cityId) {
  const oldById = new Map(previous.filter(p => p.cityId === cityId).map(p => [p.id, p]));
  return [...previous.filter(p => p.cityId !== cityId), ...rows.map(p => {
    const old = oldById.get(p.id);
    if (!old?.simulated) return { ...p, cityId };
    const assumed = old.capacitySource?.startsWith('Demo assumption');
    const capacity = assumed && p.capacity === null ? old.capacity : p.capacity;
    return { ...p, cityId, capacity, capacitySource: assumed && p.capacity === null ? old.capacitySource : p.capacitySource, simulated: capacity !== null, occupied: capacity === null ? 0 : Math.max(0, Math.min(old.occupied, capacity)) };
  })];
}
