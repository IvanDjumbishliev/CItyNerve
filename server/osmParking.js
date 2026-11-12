import { normalizeParking } from '../src/operations/engine.js';
export const PARKING_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
export async function fetchOverpassParking(city, signal, { fetchImpl = fetch, endpoints = PARKING_ENDPOINTS, timeoutMs = 25000, onProgress = () => {} } = {}) {
  if (!Number.isFinite(city.latitude) || Math.abs(city.latitude) > 90 || !Number.isFinite(city.longitude) || Math.abs(city.longitude) > 180) throw new Error('Select a city with valid coordinates before loading parking.');
  const query = `[out:json][timeout:20];nwr["amenity"="parking"](around:3500,${city.latitude},${city.longitude});out center tags;`;
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
      const response = await fetchImpl(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'CityNerve/0.1 (https://github.com/IvanDjumbishliev/Flood; parking inventory)' } });
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

// OSM locations change slowly; retain successful inventories across server restarts.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const cacheDir = resolve('.cache/osm-parking');
const DAY = 24 * 60 * 60 * 1000;
export function createInventoryService({ load = fetchOverpassParking, now = Date.now, readCache = async () => null, writeCache = async () => {} } = {}) {
  const cache = new Map(), pending = new Map();
  return async function inventory(city) {
    if (!Number.isFinite(city.latitude) || Math.abs(city.latitude) > 90 || !Number.isFinite(city.longitude) || Math.abs(city.longitude) > 180) {
      throw Object.assign(new Error('Valid latitude and longitude are required.'), { status: 400 });
    }
    const key = `${city.latitude.toFixed(4)}_${city.longitude.toFixed(4)}`;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 8) throw Object.assign(new Error('Parking inventory is busy. Please retry shortly.'), { status: 503 });
    const task = (async () => {
      const previous = cache.get(key) ?? await readCache(key).catch(() => null);
      const age = previous ? now() - Date.parse(previous.fetchedAt) : Infinity;
      if (previous && age >= 0 && age < DAY) return { ...previous, cached: true, stale: false };
      try {
        const parking = await load(city);
        const result = { parking, fetchedAt: new Date(now()).toISOString(), cached: false, stale: false };
        cache.delete(key);
        cache.set(key, result);
        if (cache.size > 100) cache.delete(cache.keys().next().value);
        await writeCache(key, result).catch(() => {});
        return result;
      } catch (error) {
        if (previous && age >= 0 && age < 7 * DAY) return { ...previous, cached: true, stale: true };
        throw error;
      }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}
const inventory = createInventoryService({
  readCache: async key => {
    const data = JSON.parse(await readFile(resolve(cacheDir, `${key}.json`), 'utf8'));
    return Array.isArray(data.parking) && Number.isFinite(Date.parse(data.fetchedAt)) ? data : null;
  },
  writeCache: async (key, data) => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(resolve(cacheDir, `${key}.json`), JSON.stringify(data));
  },
});
export function createOsmParkingMiddleware(service = inventory) {
  return function osmParkingMiddleware(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/osm-parking') return next();
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); send(405, { error: 'Use GET for parking inventory.' }); return; }
    const latitude = url.searchParams.get('latitude'), longitude = url.searchParams.get('longitude');
    if (latitude === null || longitude === null || !latitude.trim() || !longitude.trim()) { send(400, { error: 'Latitude and longitude are required.' }); return; }
    service({ latitude: Number(latitude), longitude: Number(longitude) })
      .then(data => send(200, data))
      .catch(error => send(error.status || 503, { error: error.message }));
  };
}
export const osmParkingMiddleware = createOsmParkingMiddleware();
