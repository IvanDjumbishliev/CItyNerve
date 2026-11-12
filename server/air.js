// AirNerve live service: GET /api/air?town=<id> and GET /api/air/history?town=<id>&sensor=<id>.
// Upstream responses are cached in memory; when an upstream fails the last good
// copy is served and marked stale with the time it was fetched.
import { TOWNS } from "../shared/towns.js";
import {
  GUIDELINES,
  dailyMeans,
  latticeFor,
  latticePoints,
  median,
  normalizeSensors,
  screenSensor,
  townBbox,
} from "../shared/air.js";
import {
  HOUR,
  PAST_HOURS,
  airAttribution,
  airUrls,
  archiveUrl,
  camsUrl,
  download,
  normalizeCams,
  normalizeWeather,
  parseArchiveCsv,
  timeAxis,
  weatherUrl,
  yearUrl,
} from "./airProviders.js";

const TTL = {
  sensors: 5 * 60000, // sensor.community publishes every 5 minutes: never poll faster
  cams: HOUR,
  weather: HOUR,
  year: 6 * HOUR,
  archive: 6 * HOUR,
};
const SENSOR_RADIUS_KM = 15;
const cache = new Map();
const pending = new Map();
const recent = new Map(); // sensor id → readings collected since the server started

/** Cached loader. Returns { value, fetchedAt, stale, error }; value is null if never loaded. */
async function cached(key, ttl, load) {
  const previous = cache.get(key);
  if (previous && Date.now() - previous.at < ttl) return { ...previous.entry, stale: false };
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    try {
      const entry = { value: await load(), fetchedAt: new Date().toISOString(), error: null };
      cache.set(key, { at: Date.now(), entry });
      return { ...entry, stale: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upstream unavailable";
      if (previous) return { ...previous.entry, stale: true, error: message };
      return { value: null, fetchedAt: null, stale: false, error: message };
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, task);
  return task;
}

const status = (part) => (part.value === null ? "unavailable" : part.stale ? "stale" : "ok");

function remember(items) {
  const cutoff = Date.now() - 26 * HOUR;
  for (const item of items) {
    const series = recent.get(item.id) ?? [];
    if (!series.length || series.at(-1).time < item.time)
      series.push({ time: item.time, pm25: item.pm25, pm10: item.pm10 });
    while (series.length && Date.parse(series[0].time) < cutoff) series.shift();
    recent.set(item.id, series);
  }
}

function yearStats(payload, town) {
  const hourly = payload?.hourly;
  if (!hourly?.time) throw Error("Unexpected Open-Meteo response");
  const pm25 = dailyMeans(hourly.time, hourly.pm2_5 ?? []);
  const pm10 = dailyMeans(hourly.time, hourly.pm10 ?? []);
  return {
    year: Number(hourly.time[0].slice(0, 4)),
    through: hourly.time.at(-1).slice(0, 10),
    timeZone: town.timeZone,
    daysWithData: pm25.length,
    pm25DaysAboveWho: pm25.filter((day) => day.mean > GUIDELINES.who2021.pm25.day).length,
    pm10DaysAboveWho: pm10.filter((day) => day.mean > GUIDELINES.who2021.pm10.day).length,
    pm10DaysAboveEuLimit: pm10.filter((day) => day.mean > GUIDELINES.eu2008.pm10.day).length,
    pm25Mean: pm25.length ? pm25.reduce((sum, day) => sum + day.mean, 0) / pm25.length : null,
    basis: "CAMS model at the town centre, 24 h means of local calendar days",
  };
}

export async function airSnapshot(townId) {
  const town = TOWNS.find((item) => item.id === townId);
  if (!town) throw Error("Unknown town");
  const bbox = townBbox(town);
  const lattice = latticeFor(bbox);
  const axis = timeAxis();
  const axisKey = axis[0];
  const yesterday = new Date(Date.now() - 24 * HOUR).toISOString().slice(0, 10);
  const [cams, weather, sensors, year] = await Promise.all([
    cached("cams:" + town.id + ":" + axisKey, TTL.cams, async () =>
      normalizeCams(JSON.parse(await download(camsUrl(lattice))), lattice, axis),
    ),
    cached("weather:" + town.id + ":" + axisKey, TTL.weather, async () =>
      normalizeWeather(JSON.parse(await download(weatherUrl(lattice))), lattice, axis),
    ),
    cached("sensors:" + town.id, TTL.sensors, async () =>
      normalizeSensors(
        JSON.parse(
          await download(
            airUrls.sensors + town.center[1] + "," + town.center[0] + "," + SENSOR_RADIUS_KM,
          ),
        ),
      ),
    ),
    cached("year:" + town.id + ":" + yesterday, TTL.year, async () =>
      yearStats(
        JSON.parse(await download(yearUrl(town, yesterday.slice(0, 4), yesterday))),
        town,
      ),
    ),
  ]);

  // Modelled humidity at the lattice point nearest the centre, for nodes without a humidity sensor.
  const points = latticePoints(lattice);
  const centreIndex = points.reduce(
    (best, point, index) =>
      Math.hypot(point[0] - town.center[0], point[1] - town.center[1]) <
      Math.hypot(points[best][0] - town.center[0], points[best][1] - town.center[1])
        ? index
        : best,
    0,
  );
  const modelHumidity = weather.value?.humidity[PAST_HOURS]?.[centreIndex] ?? null;

  let sensorPart = { status: status(sensors), fetchedAt: sensors.fetchedAt, error: sensors.error };
  if (sensors.value) {
    if (!sensors.stale) remember(sensors.value);
    const screened = sensors.value.map((item) =>
      screenSensor(item, {
        fallbackHumidity: modelHumidity,
        recent: recent.get(item.id)?.map((reading) => reading.pm25),
      }),
    );
    const count = (name) => screened.filter((item) => item.status === name).length;
    sensorPart = {
      ...sensorPart,
      radiusKm: SENSOR_RADIUS_KM,
      items: screened
        .filter((item) => item.status === "ok" || item.status === "humid")
        .map(({ indoor, ...item }) => item),
      counts: {
        reported: screened.length,
        shown: count("ok") + count("humid"),
        usable: count("ok"),
        humid: count("humid"),
        indoor: count("indoor"),
        invalid: count("invalid"),
        stuck: count("stuck"),
      },
      medianPm25: median(screened.filter((item) => item.status === "ok").map((item) => item.pm25)),
    };
  }

  return {
    town: { id: town.id, name: town.name, center: town.center, timeZone: town.timeZone, bbox },
    generatedAt: new Date().toISOString(),
    lattice,
    time: axis,
    nowIndex: PAST_HOURS,
    cams: cams.value
      ? { status: status(cams), fetchedAt: cams.fetchedAt, error: cams.error, ...cams.value }
      : { status: "unavailable", fetchedAt: null, error: cams.error },
    wind: weather.value
      ? { status: status(weather), fetchedAt: weather.fetchedAt, error: weather.error, ...weather.value }
      : { status: "unavailable", fetchedAt: null, error: weather.error },
    sensors: sensorPart,
    year: year.value
      ? { status: status(year), fetchedAt: year.fetchedAt, ...year.value }
      : { status: "unavailable", fetchedAt: null, error: year.error },
    attribution: airAttribution,
  };
}

/** Last 24 h for one sensor: hourly medians from the public archive plus what this server saw. */
export async function sensorHistory(townId, sensorId) {
  const sensors = cache.get("sensors:" + townId)?.entry.value;
  const sensor = sensors?.find((item) => String(item.id) === String(sensorId));
  if (!sensor) throw Error("Unknown sensor");
  const now = Date.now();
  const days = [now - 24 * HOUR, now].map((time) => new Date(time).toISOString().slice(0, 10));
  const files = await Promise.all(
    days.map((day) =>
      cached("archive:" + day + ":" + sensor.id, TTL.archive, async () =>
        parseArchiveCsv(await download(archiveUrl(day, sensor.type, sensor.id), { timeout: 15000 })),
      ),
    ),
  );
  const readings = [...files.flatMap((file) => file.value ?? []), ...(recent.get(sensor.id) ?? [])];
  const start = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
  const hours = Array.from({ length: 24 }, (_, index) => {
    const from = start + index * HOUR;
    const inHour = readings.filter((reading) => {
      const time = Date.parse(reading.time);
      return time >= from && time < from + HOUR;
    });
    return {
      time: new Date(from).toISOString(),
      pm25: median(inHour.map((reading) => reading.pm25)),
      pm10: median(inHour.map((reading) => reading.pm10)),
    };
  });
  return {
    sensor: sensor.id,
    hours,
    archiveDays: days.filter((_, index) => files[index].value),
    note: "Hourly medians. The public archive is published once a day, so hours since midnight UTC come only from readings collected while this server has been running.",
  };
}

function send(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function airMiddleware(req, res, next) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/air" && url.pathname !== "/api/air/history") return next();
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const townId = url.searchParams.get("town") ?? "sofia";
  if (!TOWNS.some((town) => town.id === townId))
    return send(res, 404, { error: "Unsupported town" });
  if (url.pathname === "/api/air/history") {
    const sensorId = url.searchParams.get("sensor") ?? "";
    if (!/^\d{1,9}$/.test(sensorId)) return send(res, 400, { error: "Invalid sensor id" });
    return sensorHistory(townId, sensorId)
      .then((data) => send(res, 200, data))
      .catch((error) =>
        send(res, error.message === "Unknown sensor" ? 404 : 503, {
          error: error.message === "Unknown sensor" ? "Unknown sensor" : "Sensor history unavailable.",
        }),
      );
  }
  return airSnapshot(townId)
    .then((data) => send(res, 200, data))
    .catch(() => send(res, 503, { error: "Air data unavailable. Please retry." }));
}

export const airPlugin = {
  name: "air-service",
  configureServer(server) {
    server.middlewares.use(airMiddleware);
  },
  configurePreviewServer(server) {
    server.middlewares.use(airMiddleware);
  },
};
