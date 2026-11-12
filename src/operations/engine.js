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
  stats.hours = indices.map(({ t, i }) => ({ time: t, temperature: Number.isFinite(h.temperature_2m?.[i]) ? h.temperature_2m[i] : null, visibility: Number.isFinite(h.visibility?.[i]) ? h.visibility[i] : null, code: h.weather_code?.[i] ?? null }));
  const triggers = [
    ['flood', rain.length && (stats.rainPeak >= RULES.rainHour || stats.rainTotal >= RULES.rainDay), 'Heavy-rain / potential flood-risk advisory', 'HEAVY RAIN FORECAST\nWATCH FOR SURFACE WATER'],
    ['fog', stats.hours.some(x => [45, 48].includes(x.code) || (x.visibility !== null && x.visibility < RULES.visibility)), 'Fog / low visibility forecast', 'LOW VISIBILITY EXPECTED\nREDUCE SPEED'],
    ['heat', heat.length && stats.heatMax >= RULES.apparentTemperature, 'High apparent temperature forecast', 'HIGH TEMPERATURES\nCARRY DRINKING WATER'],
  ];
  return { stats, events: triggers.filter(x => x[1]).map(([type, , title, message]) => ({ id: `forecast:${city.id}:${type}`, cityId: city.id, type, title, message, ...(type === 'fog' ? { hazardHours: stats.hours.filter(x => [45, 48].includes(x.code) || (x.visibility !== null && x.visibility < RULES.visibility)) } : {}), source: 'Open-Meteo forecast', evidence: 'forecast', severity: 'advisory', status: 'published', latitude: city.latitude, longitude: city.longitude, radiusKm: 15, observedAt: new Date(now).toISOString(), expiresAt: new Date(now + FORECAST_TTL).toISOString(), validFrom: stats.validFrom, validTo: stats.validTo, scope: 'City-area model forecast; local conditions may differ.' })) };
}
export function reconcileForecast(previous, events, cityId, now = Date.now()) {
  const ids = new Set(events.map(e => e.id));
  return [...events.map(e => { const old = previous.find(x => x.id === e.id); return { ...e, createdAt: old?.createdAt ?? e.observedAt }; }), ...previous.filter(e => !ids.has(e.id)).map(e => e.cityId === cityId && e.evidence === 'forecast' && e.status === 'published' ? { ...e, status: 'resolved', resolvedAt: new Date(now).toISOString() } : e)].slice(0, 200);
}
export const isActive = (event, now = Date.now()) => event.status === 'published' && Date.parse(event.expiresAt) > now;
export function bearingDegrees(a, b) {
  const rad = x => x * Math.PI / 180;
  const lat1 = rad(a.latitude), lat2 = rad(b.latitude), delta = rad(b.longitude - a.longitude);
  return (Math.atan2(Math.sin(delta) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta)) * 180 / Math.PI + 360) % 360;
}
// Straight-line demonstration geometry, not a road routing or lane model.
export function pointAhead(board, km = .7) {
  const angle = board.heading * Math.PI / 180;
  return { latitude: board.latitude + Math.cos(angle) * km / 111.195, longitude: board.longitude + Math.sin(angle) * km / (111.195 * Math.cos(board.latitude * Math.PI / 180)) };
}
export function isAhead(board, point, rangeKm = board.rangeKm ?? 3) {
  const distance = distanceKm(board, point);
  if (distance > rangeKm) return false;
  if (!Number.isFinite(board.heading) || distance < .08) return true;
  const difference = Math.abs(((bearingDegrees(board, point) - board.heading + 540) % 360) - 180);
  return difference <= (board.halfAngle ?? 40);
}
export function boardWeather(board, weather, now = Date.now()) {
  if (!weather || weather.cityId !== board.cityId || !Number.isFinite(weather.fetchedAt) || now - weather.fetchedAt >= FORECAST_TTL || weather.fetchedAt > now + 60000) return null;
  const hour = weather.hours?.find(x => x.time <= now && now < x.time + 3600000);
  if (!hour) return null;
  return { ...hour, temperature: Number.isFinite(hour.temperature) ? Math.round(hour.temperature) : null, source: 'Open-Meteo · city-area hourly forecast', fetchedAt: weather.fetchedAt };
}
export function freshOperatorParking(p, now = Date.now()) {
  const fresh = stamp => { const time = Date.parse(stamp); return Number.isFinite(time) && time <= now + 60000 && now - time < 5 * 60000; };
  return p.live === true && p.status !== 'closed' && fresh(p.fetchedAt) && (p.measuredAt == null || fresh(p.measuredAt)) && Number.isInteger(p.free) && p.free >= 0 && (p.capacity == null || (Number.isInteger(p.capacity) && p.capacity >= p.free));
}
const nearFogHours = (event, now) => event.hazardHours?.filter(x => x.time + 3600000 > now && x.time <= now + 3 * 3600000);
function roadMessage(event, now) {
  if (event.evidence === 'forecast') {
    if (event.type === 'fog') {
      const hours = nearFogHours(event, now);
      const fog = hours?.some(x => [45, 48].includes(x.code));
      return `${fog ? 'FOG EXPECTED' : 'LOW VISIBILITY EXPECTED'}\nNEXT 3 HOURS\nREDUCE SPEED`;
    }
    return event.message;
  }
  return ({ closure: 'ROAD CLOSED AHEAD\nFLOODING\nDO NOT PROCEED', flood: 'FLOODING AHEAD\nREDUCE SPEED', fog: 'FOG AHEAD\nREDUCE SPEED\nINCREASE GAP', congestion: 'QUEUE AHEAD\nREDUCE SPEED\nPREPARE TO STOP' })[event.type] ?? event.message;
}
export function boardMessage(board, incidents, parking, now = Date.now(), air = null, traffic = null) {
  const ranks = { closure: 5, flood: 4, fog: 3, congestion: 2, heat: 1 };
  const incident = incidents.filter(e => e.cityId === board.cityId && isActive(e, now) && distanceKm(board, e) <= e.radiusKm && (e.evidence === 'forecast' || isAhead(board, e)) && !(e.evidence === 'forecast' && e.type === 'fog' && e.hazardHours && !nearFogHours(e, now).length))
    .sort((a, b) => (ranks[b.type] ?? 0) - (ranks[a.type] ?? 0) || Number(a.evidence === 'forecast') - Number(b.evidence === 'forecast') || distanceKm(board, a) - distanceKm(board, b))[0];
  const liveTraffic = traffic?.status === 'ok' && traffic.boardId === board.id && traffic.cityId === board.cityId && Date.parse(traffic.fetchedAt) <= now + 60000 && Date.parse(traffic.expiresAt) > now;
  const trafficRank = liveTraffic ? traffic.kind === 'closure' ? 5 : traffic.kind === 'congestion' ? 2 : 0 : 0;
  const trafficMessage = () => ({ message: traffic.message, traffic, evidence: 'traffic', source: 'TomTom Traffic' });
  if (trafficRank > 0 && (!incident || trafficRank > (ranks[incident.type] ?? 0))) return trafficMessage();
  if (incident) return { message: roadMessage(incident, now), incident, evidence: incident.evidence, source: incident.source };
  const freshAir = air?.boardId === board.id && air.cityId === board.cityId && Date.parse(air.validFrom) <= now && Date.parse(air.expiresAt) > now;
  const airMessage = () => ({ message: air.message, air, evidence: air.evidence, source: air.source });
  if (freshAir && air.band >= 3) return airMessage();
  const p = parking.filter(x => x.cityId === board.cityId && (x.live ? freshOperatorParking(x, now) : x.simulated && Number.isFinite(x.capacity)) && isAhead(board, x, x.live ? board.rangeKm ?? 3 : board.parkingRangeKm ?? 1.5) && !incidents.some(e => e.cityId === board.cityId && e.type === 'closure' && e.parkingId === x.id && isActive(e, now)))
    .sort((a, b) => Number(!!b.live) - Number(!!a.live) || Number(a.free === 0) - Number(b.free === 0) || distanceKm(board, a) - distanceKm(board, b))[0];
  if (p?.live) return { message: `${p.name.toUpperCase()}\n${p.free === 0 ? 'CAR PARK FULL' : `${p.free} SPACES`}`, evidence: 'reported', source: p.source, parking: p };
  if (p) return { message: `${p.name.toUpperCase()}\n${Math.max(0, p.capacity - p.occupied)} SPACES`, evidence: 'simulation', source: 'Nearby parking demo', parking: p };
  if (liveTraffic) return trafficMessage();
  return { message: board.routineMessage ?? 'DRIVE SAFELY\nKEEP A SAFE DISTANCE', evidence: 'routine', source: 'CityNerve' };
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
