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
// Same-origin service works in dev, preview, and npm start.
export async function fetchParking(city, signal, { fetchImpl = fetch, onProgress = () => {} } = {}) {
  onProgress('Loading OSM parking inventory (cached locations or public providers)…');
  const query = new URLSearchParams({ latitude: city.latitude, longitude: city.longitude });
  const response = await fetchImpl(`/api/osm-parking?${query}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Parking inventory is unavailable. Please retry.');
  if (!Array.isArray(data.parking)) throw new Error('Invalid parking inventory response.');
  return data.parking.map(p => ({ ...p, stale: data.stale, cached: data.cached }));
}
