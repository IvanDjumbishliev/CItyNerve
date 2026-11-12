// Upstream adapters for AirNerve. Every source is free and needs no key.
import { POLLUTANTS, POLLUTANT_KEYS, latticePoints, num, sensorTime } from "../shared/air.js";

export const USER_AGENT = "FloodNerve-hackathon-prototype/0.1";
export const HOUR = 3600000;
export const PAST_HOURS = 48;
export const FUTURE_HOURS = 96;

export const airUrls = {
  cams: "https://air-quality-api.open-meteo.com/v1/air-quality",
  weather: "https://api.open-meteo.com/v1/forecast",
  sensors: "https://data.sensor.community/airrohr/v1/filter/area=",
  archive: "https://archive.sensor.community/",
};
export const airAttribution = [
  {
    kind: "modelled",
    name: "CAMS European air quality forecast (ENSEMBLE)",
    by: "Copernicus Atmosphere Monitoring Service",
    url: "https://atmosphere.copernicus.eu/",
  },
  {
    kind: "modelled",
    name: "Open-Meteo Air Quality and Weather APIs",
    by: "Open-Meteo · CC BY 4.0",
    url: "https://open-meteo.com/",
  },
  {
    kind: "measured",
    name: "Citizen particulate sensors",
    by: "Sensor.Community contributors · ODbL",
    url: "https://sensor.community/",
  },
  {
    kind: "map",
    name: "Base map and place data",
    by: "© OpenStreetMap contributors · ODbL",
    url: "https://www.openstreetmap.org/copyright",
  },
];

export async function download(url, { timeout = 20000, maxBytes = 6000000 } = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json,text/csv,*/*" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw Error("Upstream answered " + response.status);
  const body = await response.text();
  if (body.length > maxBytes) throw Error("Response too large");
  return body;
}

/** The fixed hourly axis every live series is aligned to: now−48 h … now+96 h (UTC). */
export function timeAxis(now = Date.now()) {
  const start = Math.floor(now / HOUR) * HOUR - PAST_HOURS * HOUR;
  return Array.from({ length: PAST_HOURS + FUTURE_HOURS + 1 }, (_, index) =>
    new Date(start + index * HOUR).toISOString(),
  );
}
const hourKey = (stamp) => stamp.slice(0, 13); // "2026-11-12T10"

function locations(payload, expected) {
  const list = Array.isArray(payload) ? payload : [payload];
  if (list.length !== expected || list.some((item) => !item?.hourly?.time))
    throw Error("Unexpected Open-Meteo response");
  return list;
}

export function camsUrl(lattice) {
  const points = latticePoints(lattice);
  const fields = POLLUTANT_KEYS.map((key) => POLLUTANTS[key].field).join(",");
  return (
    airUrls.cams +
    "?latitude=" + points.map((point) => point[1]).join(",") +
    "&longitude=" + points.map((point) => point[0]).join(",") +
    "&hourly=" + fields +
    "&past_days=3&forecast_days=5&domains=cams_europe&timezone=UTC"
  );
}

/**
 * Open-Meteo air-quality payload → { values: { pm25: [hour][point], … }, lastIndex }.
 * Hours the model does not cover stay null (never 0).
 */
export function normalizeCams(payload, lattice, axis) {
  const points = latticePoints(lattice);
  const list = locations(payload, points.length);
  const values = {};
  let lastIndex = -1;
  for (const key of POLLUTANT_KEYS) {
    const field = POLLUTANTS[key].field;
    const byPoint = list.map((location) => {
      const lookup = new Map();
      location.hourly.time.forEach((stamp, index) =>
        lookup.set(hourKey(stamp), num(location.hourly[field]?.[index])),
      );
      return lookup;
    });
    values[key] = axis.map((stamp, hour) => {
      const row = byPoint.map((lookup) => lookup.get(hourKey(stamp)) ?? null);
      if (row.some((value) => value !== null)) lastIndex = Math.max(lastIndex, hour);
      return row;
    });
  }
  if (lastIndex < 0) throw Error("CAMS returned no values for this window");
  return { values, lastIndex };
}

export function weatherUrl(lattice) {
  const points = latticePoints(lattice);
  return (
    airUrls.weather +
    "?latitude=" + points.map((point) => point[1]).join(",") +
    "&longitude=" + points.map((point) => point[0]).join(",") +
    "&hourly=wind_speed_10m,wind_direction_10m,relative_humidity_2m" +
    "&past_days=3&forecast_days=5&wind_speed_unit=ms&timezone=UTC"
  );
}

/** Wind speed (m/s), direction the wind comes from (°) and humidity (%), as [hour][point]. */
export function normalizeWeather(payload, lattice, axis) {
  const list = locations(payload, latticePoints(lattice).length);
  const series = (field) => {
    const byPoint = list.map((location) => {
      const lookup = new Map();
      location.hourly.time.forEach((stamp, index) =>
        lookup.set(hourKey(stamp), num(location.hourly[field]?.[index])),
      );
      return lookup;
    });
    return axis.map((stamp) => byPoint.map((lookup) => lookup.get(hourKey(stamp)) ?? null));
  };
  return {
    speed: series("wind_speed_10m"),
    direction: series("wind_direction_10m"),
    humidity: series("relative_humidity_2m"),
  };
}

export function yearUrl(town, year, lastDay) {
  return (
    airUrls.cams +
    "?latitude=" + town.center[1] + "&longitude=" + town.center[0] +
    "&hourly=pm2_5,pm10&start_date=" + year + "-01-01&end_date=" + lastDay +
    "&domains=cams_europe&timezone=" + encodeURIComponent(town.timeZone)
  );
}

/** sensor.community daily archive CSV → [{ time, pm25, pm10 }]. */
export function parseArchiveCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift()?.split(";") ?? [];
  const at = (name) => header.indexOf(name);
  const [timeAt, p1At, p2At] = [at("timestamp"), at("P1"), at("P2")];
  if (timeAt < 0 || p2At < 0) throw Error("Unexpected archive format");
  return lines.flatMap((line) => {
    const cells = line.split(";");
    const time = sensorTime(cells[timeAt]?.replace("T", " "));
    return time ? [{ time, pm25: num(cells[p2At]), pm10: num(cells[p1At]) }] : [];
  });
}

export function archiveUrl(day, type, sensorId) {
  return airUrls.archive + day + "/" + day + "_" + type.toLowerCase() + "_sensor_" + sensorId + ".csv";
}
