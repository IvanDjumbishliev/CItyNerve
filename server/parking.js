import { osmParkingMiddleware } from './osmParking.js';
import {
  providerUrls,
  attribution,
  download,
  normalizeRows,
  normalizeZurich,
  validFacilities,
} from "./parkingProviders.js";
const cache = new Map(),
  pending = new Map();
let zurichGeometry;
async function load(city) {
  if (city !== "zurich") return normalizeRows(city, JSON.parse(await download(providerUrls[city])));
  const [xml, metadata] = await Promise.all([
    download(providerUrls.zurich),
    zurichGeometry
      ? Promise.resolve(zurichGeometry)
      : download("https://api.parkendd.de/Zuerich").then(JSON.parse),
  ]);
  const result = normalizeZurich(xml, metadata);
  if (!result.length) throw Error("Zürich geometry could not be matched");
  zurichGeometry = metadata;
  return result;
}
export async function availability(city) {
  if (!Object.hasOwn(providerUrls, city)) throw Error("Unknown city");
  const previous = cache.get(city);
  if (previous && Date.now() - Date.parse(previous.fetchedAt) < 60000) return previous;
  if (pending.has(city)) return pending.get(city);
  const task = (async () => {
    try {
      const facilities = validFacilities(await load(city));
      if (!facilities.length) throw Error("No valid observations");
      const result = {
        facilities,
        fetchedAt: new Date().toISOString(),
        stale: false,
        source: providerUrls[city],
        attribution: attribution[city],
      };
      cache.set(city, result);
      return result;
    } catch (error) {
      if (previous) return { ...previous, stale: true };
      throw error;
    } finally {
      pending.delete(city);
    }
  })();
  pending.set(city, task);
  return task;
}
export function parkingMiddleware(req, res, next) {
  const match = req.url?.match(/^\/api\/parking\/([a-z]+)$/);
  if (!match) return osmParkingMiddleware(req, res, next);
  if (!Object.hasOwn(providerUrls, match[1])) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unsupported parking city" }));
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }
  availability(match[1])
    .then((data) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(data));
    })
    .catch(() => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Parking provider unavailable. Please retry." }));
    });
}
export const parkingPlugin = {
  name: "parking-service",
  configureServer(server) {
    server.middlewares.use(parkingMiddleware);
  },
  configurePreviewServer(server) {
    server.middlewares.use(parkingMiddleware);
  },
};
