// AirNerve pure logic shared by the browser, the Node server and the tests.
// No DOM, no network: index banding, lattice interpolation and sensor screening.

/* ── European Air Quality Index (EEA) ──
   Bands, colours and health messages copied from https://airindex.eea.europa.eu
   ("About the European Air Quality Index"), read on 2026-11-12. Upper limits are
   µg/m³; a value belongs to the first band whose upper limit it does not exceed
   after rounding to a whole number, as in the EEA table (0-5, 6-15, …). */
export const BANDS = [
  {
    id: "good",
    label: "Good",
    colour: [80, 240, 230],
    general: "The air quality is good. Enjoy your usual outdoor activities.",
    sensitive: "The air quality is good. Enjoy your usual outdoor activities.",
  },
  {
    id: "fair",
    label: "Fair",
    colour: [80, 204, 170],
    general: "Enjoy your usual outdoor activities",
    sensitive: "Enjoy your usual outdoor activities",
  },
  {
    id: "moderate",
    label: "Moderate",
    colour: [240, 230, 65],
    general: "Enjoy your usual outdoor activities",
    sensitive: "Consider reducing intense outdoor activities, if you experience symptoms.",
  },
  {
    id: "poor",
    label: "Poor",
    colour: [255, 80, 80],
    general:
      "Consider reducing intense activities outdoors, if you experience symptoms such as sore eyes, a cough or sore throat",
    sensitive:
      "Consider reducing physical activities, particularly outdoors, especially if you experience symptoms.",
  },
  {
    id: "very-poor",
    label: "Very poor",
    colour: [150, 0, 50],
    general:
      "Consider reducing intense activities outdoors, if you experience symptoms such as sore eyes, a cough or sore throat",
    sensitive:
      "Reduce physical activities, particularly outdoors, especially if you experience symptoms.",
  },
  {
    id: "extremely-poor",
    label: "Extremely poor",
    colour: [125, 33, 129],
    general: "Reduce physical activities outdoors.",
    sensitive: "Avoid physical activities outdoors.",
  },
];
export const NO_DATA_COLOUR = [111, 111, 111];

// `limits` are the upper bounds of Good, Fair, Moderate, Poor and Very poor.
// `field` is the Open-Meteo hourly variable name.
export const POLLUTANTS = {
  pm25: { label: "PM2.5", name: "Fine particles", field: "pm2_5", limits: [5, 15, 50, 90, 140] },
  pm10: { label: "PM10", name: "Coarse particles", field: "pm10", limits: [15, 45, 120, 195, 270] },
  no2: {
    label: "NO₂",
    name: "Nitrogen dioxide",
    field: "nitrogen_dioxide",
    limits: [10, 25, 60, 100, 150],
  },
  o3: { label: "O₃", name: "Ozone", field: "ozone", limits: [60, 100, 120, 160, 180] },
  so2: {
    label: "SO₂",
    name: "Sulphur dioxide",
    field: "sulphur_dioxide",
    limits: [20, 40, 125, 190, 275],
  },
};
export const POLLUTANT_KEYS = Object.keys(POLLUTANTS);
export const UNIT = "µg/m³";

/* ── Guideline and limit values (µg/m³) ──
   WHO: Global air quality guidelines 2021, Table 3.26 (AQG levels).
   EU: Directive 2008/50/EC limit values as listed by the European Commission
   ("EU air quality standards"), read on 2026-11-12. */
export const GUIDELINES = {
  who2021: {
    source: "WHO global air quality guidelines 2021",
    pm25: { day: 15, year: 5 },
    pm10: { day: 45, year: 15 },
    no2: { day: 25, year: 10 },
  },
  eu2008: {
    source: "Directive 2008/50/EC",
    pm10: { day: 50, allowedDays: 35, year: 40 },
    pm25: { year: 25 },
    no2: { hour: 200, allowedHours: 18, year: 40 },
  },
};

/** Parse a provider value. Missing, empty or non-numeric becomes null; 0 stays 0. */
export function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Index band 0 (Good) … 5 (Extremely poor), or null when there is no valid value. */
export function bandIndex(pollutant, value) {
  const spec = POLLUTANTS[pollutant];
  if (!spec || value === null || value === undefined || !Number.isFinite(value) || value < 0)
    return null;
  const rounded = Math.round(value);
  const index = spec.limits.findIndex((limit) => rounded <= limit);
  return index === -1 ? spec.limits.length : index;
}

export function bandOf(pollutant, value) {
  const index = bandIndex(pollutant, value);
  return index === null ? null : BANDS[index];
}

/** Overall index: the worst band among the pollutants that have a value. */
export function airIndex(values) {
  let worst = null;
  for (const key of POLLUTANT_KEYS) {
    const band = bandIndex(key, values?.[key] ?? null);
    if (band === null) continue;
    if (!worst || band > worst.band) worst = { band, dominant: key, value: values[key] };
  }
  return worst;
}

/** Band colour with a short blend just below each limit, so contours look smooth. */
export function colourFor(pollutant, value) {
  const index = bandIndex(pollutant, value);
  if (index === null) return null;
  const limits = POLLUTANTS[pollutant].limits;
  if (index >= limits.length) return BANDS[index].colour;
  const low = index === 0 ? 0 : limits[index - 1];
  const fraction = (Math.min(value, limits[index]) - low) / (limits[index] - low);
  const blend = Math.max(0, (fraction - 0.8) / 0.2);
  if (blend <= 0) return BANDS[index].colour;
  const from = BANDS[index].colour;
  const to = BANDS[index + 1].colour;
  const mix = blend * blend * (3 - 2 * blend) * 0.5;
  return [
    Math.round(from[0] + (to[0] - from[0]) * mix),
    Math.round(from[1] + (to[1] - from[1]) * mix),
    Math.round(from[2] + (to[2] - from[2]) * mix),
  ];
}

/* ── CAMS lattice ── */
const GRID_STEP = 0.1; // CAMS European grid served by Open-Meteo
const tenth = (value) => Math.round(value * 10) / 10;

/** Study box around a town: west, south, east, north. Sofia uses the pipeline BBOX. */
export function townBbox(town) {
  if (town.id === "sofia") return [23.18, 42.6, 23.5, 42.78];
  const [lon, lat] = town.center;
  return [lon - 0.15, lat - 0.1, lon + 0.15, lat + 0.1];
}

/** 0.1° lattice that encloses a box. Points are ordered south→north, west→east. */
export function latticeFor([west, south, east, north]) {
  const lons = [];
  const lats = [];
  for (let lon = Math.floor(west * 10 + 1e-9) / 10; lon < east + GRID_STEP - 1e-9; lon += GRID_STEP)
    lons.push(tenth(lon));
  for (let lat = Math.floor(south * 10 + 1e-9) / 10; lat < north + GRID_STEP - 1e-9; lat += GRID_STEP)
    lats.push(tenth(lat));
  return { lons, lats };
}

export function latticePoints({ lons, lats }) {
  const points = [];
  for (const lat of lats) for (const lon of lons) points.push([lon, lat]);
  return points;
}

/**
 * Bilinear interpolation on the lattice. `values` is flat, in latticePoints order.
 * Outside the lattice the edge value is used. Null corners are skipped and the
 * remaining weights renormalised; null is returned only when no corner has a value.
 */
export function bilinear(lattice, values, lon, lat) {
  const { lons, lats } = lattice;
  if (!values || !lons.length || !lats.length) return null;
  const place = (axis, value) => {
    if (axis.length === 1 || value <= axis[0]) return [0, 0, 0];
    const last = axis.length - 1;
    if (value >= axis[last]) return [last, last, 0];
    let low = 0;
    while (low < last - 1 && axis[low + 1] <= value) low += 1;
    return [low, low + 1, (value - axis[low]) / (axis[low + 1] - axis[low])];
  };
  const [x0, x1, tx] = place(lons, lon);
  const [y0, y1, ty] = place(lats, lat);
  const width = lons.length;
  let total = 0;
  let weight = 0;
  for (const [x, y, w] of [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x1, y0, tx * (1 - ty)],
    [x0, y1, (1 - tx) * ty],
    [x1, y1, tx * ty],
  ]) {
    const value = values[y * width + x];
    if (w <= 0 || value === null || value === undefined) continue;
    total += value * w;
    weight += w;
  }
  return weight > 0 ? total / weight : null;
}

/* ── Citizen sensor screening ──
   sensor.community nodes are low-cost optical counters (mostly SDS011). They are
   indicative, not reference-grade, so readings are screened before use. */
export const SENSOR_QC = {
  // SDS011 data sheet range is 0.0–999.9 µg/m³; the top of the range means saturated.
  maxPm: 999.9,
  // PM2.5 is a subset of PM10. Allow 1 µg/m³ of rounding noise.
  ratioTolerance: 1,
  // Above this relative humidity droplets are counted as particles (over-reading in fog).
  // Readings stay visible on the map but are marked and left out of any estimate.
  humidityMax: 85,
  // This many identical consecutive PM2.5 readings (≥ 30 min) marks a stuck sensor.
  stuckRun: 6,
};
const PM_TYPES = /^(SDS0\d\d|PMS\d+|SPS30|HPM|NextPM|SEN5\d|PPD42NS)/i;

/** "2026-11-12 10:24:01" (UTC) → ISO string, or null. */
export function sensorTime(stamp) {
  if (typeof stamp !== "string") return null;
  const date = new Date(stamp.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Normalise the sensor.community "airrohr/v1/filter" response.
 * One item per particulate sensor, using its newest record, joined to the newest
 * humidity/temperature record that shares the same location id.
 */
export function normalizeSensors(records) {
  if (!Array.isArray(records)) throw Error("Invalid sensor response");
  const newest = new Map();
  for (const record of records) {
    const id = record?.sensor?.id;
    const time = sensorTime(record?.timestamp);
    if (id === undefined || !time || !record.location) continue;
    const previous = newest.get(id);
    if (!previous || time > previous.time) newest.set(id, { record, time });
  }
  const climate = new Map();
  for (const { record, time } of newest.values()) {
    const values = Object.fromEntries(
      (record.sensordatavalues ?? []).map((item) => [item.value_type, num(item.value)]),
    );
    if (values.humidity === null || values.humidity === undefined) continue;
    const previous = climate.get(record.location.id);
    if (!previous || time > previous.time)
      climate.set(record.location.id, {
        time,
        humidity: values.humidity,
        temperature: values.temperature ?? null,
      });
  }
  const items = [];
  for (const { record, time } of newest.values()) {
    const type = record.sensor?.sensor_type?.name ?? "";
    const values = Object.fromEntries(
      (record.sensordatavalues ?? []).map((item) => [item.value_type, num(item.value)]),
    );
    if (!PM_TYPES.test(type) && values.P2 === undefined && values.P1 === undefined) continue;
    const local = climate.get(record.location.id);
    items.push({
      id: record.sensor.id,
      locationId: record.location.id,
      type,
      lon: num(record.location.longitude),
      lat: num(record.location.latitude),
      indoor: Number(record.location.indoor) === 1,
      pm25: values.P2 ?? null,
      pm10: values.P1 ?? null,
      humidity: local?.humidity ?? null,
      temperature: local?.temperature ?? null,
      time,
    });
  }
  return items;
}

/** True when the newest readings repeat the same value `stuckRun` times in a row. */
export function isStuck(series, run = SENSOR_QC.stuckRun) {
  if (!Array.isArray(series) || series.length < run) return false;
  const tail = series.slice(-run);
  return tail.every((value) => value !== null && value === tail[0]);
}

/**
 * Screen one normalised reading.
 * status: "ok" | "humid" (kept, flagged) | "indoor" | "invalid" | "stuck" (dropped).
 * `fallbackHumidity` is modelled humidity used when the node has no humidity sensor.
 */
export function screenSensor(item, { fallbackHumidity = null, recent = null } = {}) {
  const fail = (status, reason) => ({ ...item, status, reason });
  if (item.indoor) return fail("indoor", "Indoor sensor");
  if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat) || (item.lon === 0 && item.lat === 0))
    return fail("invalid", "No usable position");
  if (item.pm25 === null && item.pm10 === null) return fail("invalid", "No particulate reading");
  for (const value of [item.pm25, item.pm10]) {
    if (value !== null && (value < 0 || value >= SENSOR_QC.maxPm))
      return fail("invalid", "Outside the sensor's measuring range");
  }
  if (item.pm25 !== null && item.pm10 !== null && item.pm25 > item.pm10 + SENSOR_QC.ratioTolerance)
    return fail("invalid", "PM2.5 above PM10");
  if (recent && isStuck(recent)) return fail("stuck", "Value has not changed");
  const measured = item.humidity !== null && item.humidity >= 0 && item.humidity <= 100;
  const humidity = measured ? item.humidity : fallbackHumidity;
  const humiditySource = measured ? "sensor" : fallbackHumidity === null ? null : "model";
  if (humidity !== null && humidity > SENSOR_QC.humidityMax)
    return {
      ...item,
      status: "humid",
      reason: "High humidity: optical sensors over-read in fog",
      humidityUsed: humidity,
      humiditySource,
    };
  return { ...item, status: "ok", reason: null, humidityUsed: humidity, humiditySource };
}

/* ── Regular raster sampling (local factor and confidence rasters) ──
   grid = { width, height, data, bounds: [west, south, east, north] }, row 0 is the
   northern edge. Bilinear between cell centres; `fallback` outside the raster. */
export function sampleGrid(grid, lon, lat, fallback = null) {
  if (!grid) return fallback;
  const [west, south, east, north] = grid.bounds;
  if (lon < west || lon > east || lat < south || lat > north) return fallback;
  const x = Math.min(grid.width - 1, Math.max(0, ((lon - west) / (east - west)) * grid.width - 0.5));
  const y = Math.min(grid.height - 1, Math.max(0, ((north - lat) / (north - south)) * grid.height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const at = (col, row) => grid.data[row * grid.width + col];
  return (
    at(x0, y0) * (1 - tx) * (1 - ty) +
    at(x1, y0) * tx * (1 - ty) +
    at(x0, y1) * (1 - tx) * ty +
    at(x1, y1) * tx * ty
  );
}

/** Screening estimate at a point: CAMS (bilinear) × local factor. Null when CAMS is missing. */
export function surfaceAt(lattice, field, factor, lon, lat) {
  const background = bilinear(lattice, field, lon, lat);
  if (background === null) return null;
  return background * sampleGrid(factor, lon, lat, 1);
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
/** 16-point compass name for the direction the wind comes from. */
export function compass(degrees) {
  if (degrees === null || degrees === undefined) return null;
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

export function median(values) {
  const sorted = values.filter((value) => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Daily means from an hourly series; a day needs at least `minHours` values. */
export function dailyMeans(times, values, minHours = 18) {
  const days = new Map();
  times.forEach((time, index) => {
    const value = values[index];
    if (value === null || value === undefined) return;
    const day = time.slice(0, 10);
    const entry = days.get(day) ?? { sum: 0, count: 0 };
    entry.sum += value;
    entry.count += 1;
    days.set(day, entry);
  });
  return [...days.entries()]
    .filter(([, entry]) => entry.count >= minHours)
    .map(([day, entry]) => ({ day, mean: entry.sum / entry.count }));
}
