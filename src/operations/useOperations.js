import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CITY, FORECAST_TTL, forecastEvents, reconcileForecast, mergeParking } from './engine.js';
import { fetchWeather, fetchParking } from './api.js';
const KEY = 'citynerve:operations:v1';
function restore() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s?.version === 1 && Array.isArray(s.incidents) && Array.isArray(s.parking) && Number.isFinite(s.city?.latitude) && Number.isFinite(s.city?.longitude)) return s; } catch { /* storage unavailable */ }
  return { version: 1, city: DEFAULT_CITY, incidents: [], parking: [] };
}
export function useOperations() {
  const [state, setState] = useState(restore);
  const [weather, setWeather] = useState(null), [weatherError, setWeatherError] = useState(''), [loading, setLoading] = useState(false);
  const [parkingError, setParkingError] = useState(''), [parkingLoading, setParkingLoading] = useState(false);
  const [parkingProgress, setParkingProgress] = useState('');
  const [revision, setRevision] = useState(0), [now, setNow] = useState(Date.now());
  const [storageError, setStorageError] = useState('');
  const parkingRequest = useRef(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); setStorageError(''); } catch { setStorageError('Browser storage unavailable; changes will last only for this session.'); } }, [state]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let controller = null, running = false, alive = true;
    setWeather(null); setWeatherError('');
    async function refresh() {
      if (running) return; running = true; setLoading(true); controller = new AbortController();
      const request = controller;
      const timeout = setTimeout(() => request.abort(), 25000);
      try {
        const payload = await fetchWeather(state.city, request.signal);
        const fetchedAt = Date.now(), result = forecastEvents(state.city, payload, fetchedAt);
        if (!alive || request.signal.aborted) return;
        setWeather({ ...result.stats, fetchedAt, cityId: state.city.id }); setWeatherError('');
        setState(s => s.city.id !== state.city.id ? s : ({ ...s, incidents: reconcileForecast(s.incidents, result.events, s.city.id, fetchedAt) }));
      } catch (e) { if (alive) setWeatherError(request.signal.aborted ? 'Weather request timed out. Retry or wait for the next automatic refresh.' : e.message); }
      finally { clearTimeout(timeout); running = false; if (alive) setLoading(false); }
    }
    refresh(); const timer = setInterval(refresh, 15 * 60000);
    return () => { alive = false; controller?.abort(); clearInterval(timer); };
  }, [state.city.id, revision]);
  useEffect(() => () => parkingRequest.current?.abort(), []);
  function selectCity(city) {
    parkingRequest.current?.abort(); parkingRequest.current = null; setParkingLoading(false); setParkingError(''); setParkingProgress('');
    setState(s => ({ ...s, city }));
  }
  async function loadParking() {
    parkingRequest.current?.abort(); const controller = new AbortController(); parkingRequest.current = controller;
    const city = state.city; setParkingLoading(true); setParkingError(''); setParkingProgress('Requesting parking locations…');
    const timeout = setTimeout(() => controller.abort(), 80000);
    try {
      const rows = await fetchParking(city, controller.signal, { onProgress: message => { if (parkingRequest.current === controller) setParkingProgress(message); } });
      if (!controller.signal.aborted) {
        setState(s => s.city.id === city.id ? { ...s, parking: mergeParking(s.parking, rows, city.id) } : s);
        setParkingProgress(rows.length ? `Loaded ${rows.length} parking areas from OpenStreetMap.${rows.some(p => p.stale) ? ' Using older cached locations while providers are unavailable.' : ''}` : 'No eligible parking areas were returned for this location.');
      }
    } catch (e) { if (parkingRequest.current === controller) setParkingError(controller.signal.aborted ? 'Parking request timed out or was cancelled. Retry to load real locations.' : e.message); }
    finally { clearTimeout(timeout); if (parkingRequest.current === controller) { setParkingLoading(false); parkingRequest.current = null; } }
  }
  function updateParking(id, changes) { setState(s => ({ ...s, parking: s.parking.map(p => p.id === id && p.cityId === s.city.id ? { ...p, ...changes } : p) })); }
  function scenario(type, location = null, targetCity = state.city) {
    const point = location ?? state.parking.find(p => p.cityId === targetCity.id) ?? targetCity;
    const at = new Date().toISOString();
    const incident = { id: `demo:${crypto.randomUUID()}`, cityId: targetCity.id, type, latitude: point.latitude, longitude: point.longitude, radiusKm: 3, title: type === 'closure' ? 'Demo: flood-related road closure' : 'Demo: local flood report', message: type === 'closure' ? 'ROAD CLOSED AHEAD\nFLOODING · CHECK LOCAL DIVERSION' : 'FLOODING REPORTED AHEAD\nPROCEED WITH CAUTION', evidence: 'simulation', source: location?.historical ? 'Simulated event at historical model hotspot' : 'Simulated field report', context: location?.historical ? location.name : null, parkingId: point.id && !location?.historical ? point.id : null, severity: 'warning', status: 'draft', createdAt: at, observedAt: at, expiresAt: new Date(Date.now() + 60 * 60000).toISOString() };
    setState(s => ({ ...s, incidents: [incident, ...s.incidents].slice(0, 200) }));
  }
  function setIncidentStatus(id, status) { setState(s => ({ ...s, incidents: s.incidents.map(e => e.id === id ? { ...e, status, ...(status === 'published' ? { expiresAt: new Date(Date.now() + 60 * 60000).toISOString(), approvedAt: new Date().toISOString() } : { resolvedAt: new Date().toISOString() }) } : e) })); }
  return { ...state, now, weather, weatherError, loading, parkingError, parkingLoading, parkingProgress, storageError, selectCity, refresh: () => setRevision(x => x + 1), loadParking, updateParking, scenario, setIncidentStatus, stale: !weather || now - weather.fetchedAt > FORECAST_TTL };
}
