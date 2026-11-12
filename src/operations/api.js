import { normalizeParking } from './engine.js';
async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Data service returned HTTP ${response.status}.`);
  return response.json();
}
export async function fetchWeather(city, signal) {
  const q = new URLSearchParams({ latitude: city.latitude, longitude: city.longitude, hourly: 'precipitation,visibility,apparent_temperature,temperature_2m', forecast_days: '3', timezone: 'GMT' });
  return getJson(`https://api.open-meteo.com/v1/forecast?${q}`, signal);
}
export async function searchCities(name, signal) {
  const q = new URLSearchParams({ name, count: '8', language: 'en', format: 'json' });
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${q}`, signal);
  return (data.results ?? []).map(c => ({ id: `geo:${c.id}`, label: c.name, country: c.country ?? '', admin: c.admin1, latitude: c.latitude, longitude: c.longitude }));
}
export const PARKING_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
export async function fetchParking(city, signal, { fetchImpl = fetch, endpoints = PARKING_ENDPOINTS, timeoutMs = 9000, onProgress = () => {} } = {}) {
  if (!Number.isFinite(city.latitude) || Math.abs(city.latitude) > 90 || !Number.isFinite(city.longitude) || Math.abs(city.longitude) > 180) throw new Error('Select a city with valid coordinates before loading parking.');
  const query = `[out:json][timeout:7];nwr["amenity"="parking"](around:3500,${city.latitude},${city.longitude});out center tags;`;
  const errors = [];
  for (const [index, endpoint] of endpoints.entries()) {
    if (signal?.aborted) throw new DOMException('Parking request cancelled.', 'AbortError');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, timeoutMs);
    const host = new URL(endpoint).hostname;
    onProgress(`Contacting parking provider ${index + 1}/${endpoints.length} (${host})…`);
    try {
      const response = await fetchImpl(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        const reason = [429, 502, 503, 504].includes(response.status) ? 'busy or rate-limited' : 'request rejected';
        throw new Error(`${reason} (HTTP ${response.status})`);
      }
      const data = await response.json();
      if (data.remark) throw new Error('incomplete response');
      if (!Array.isArray(data.elements)) throw new Error('invalid parking response');
      const rows = normalizeParking(data.elements).slice(0, 100);
      const fetchedAt = new Date().toISOString();
      return rows.map(p => ({ ...p, fetchedAt, provider: host }));
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Parking request cancelled.', 'AbortError');
      errors.push(`${host}: ${controller.signal.aborted ? 'timed out' : error instanceof SyntaxError ? 'invalid response' : error.message}`);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  throw new Error(`Parking providers are unavailable. ${errors.join('; ')}. Previously loaded parking is retained. Please retry later.`);
}
