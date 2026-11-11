const cache = new Map(),
  pending = new Map();
const urls = {
  sofia: "https://www.sofiatraffic.bg/bg/parking/parkings/update",
  basel: "https://data.bs.ch/api/explore/v2.1/catalog/datasets/100088/records?limit=100",
};
export async function availability(city) {
  if (!urls[city]) throw Error("Unknown city");
  const previous = cache.get(city);
  if (previous && Date.now() - Date.parse(previous.fetchedAt) < 60000) return previous;
  if (pending.has(city)) return pending.get(city);
  const task = (async () => {
    try {
      const response = await fetch(urls[city], { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error("Provider unavailable");
      const body = await response.text();
      if (body.length > 2000000) throw Error("Response too large");
      const raw = JSON.parse(body),
        rows = city === "sofia" ? raw : raw.results;
      if (!Array.isArray(rows)) throw Error("Invalid response");
      const facilities = rows
        .map((r) => ({
          id: city + "-" + r.id,
          name: r.name_english || r.title,
          lon: city === "sofia" ? r.longitude : r.geo_point_2d?.lon,
          lat: city === "sofia" ? r.latitude : r.geo_point_2d?.lat,
          free: city === "sofia" ? r.spaces : r.free,
          capacity: city === "sofia" ? null : r.total,
          measuredAt: r.published || null,
          status:
            city === "sofia"
              ? "unknown"
              : r.status === "offen"
                ? "open"
                : r.status === "geschlossen"
                  ? "closed"
                  : "unknown",
        }))
        .filter(
          (r) =>
            typeof r.name === "string" &&
            Number.isFinite(r.lon) &&
            Number.isFinite(r.lat) &&
            Number.isInteger(r.free) &&
            r.free >= 0 &&
            (r.capacity === null || (Number.isInteger(r.capacity) && r.capacity >= r.free)),
        );
      if (!facilities.length) throw Error("No valid observations");
      const result = {
        facilities,
        fetchedAt: new Date().toISOString(),
        stale: false,
        source: urls[city],
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
  const match = req.url?.match(/^\/api\/parking\/(sofia|basel)$/);
  if (!match) return next();
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
