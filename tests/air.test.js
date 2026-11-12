import test from "node:test";
import assert from "node:assert/strict";
import {
  BANDS, POLLUTANTS, SENSOR_QC,
  airIndex, bandIndex, bilinear, colourFor, compass, dailyMeans, isStuck, latticeFor, latticePoints,
  median, normalizeSensors, num, sampleGrid, screenSensor, sensorTime, surfaceAt, townBbox,
} from "../shared/air.js";
import { TOWNS } from "../shared/towns.js";
import { normalizeCams, normalizeWeather, parseArchiveCsv, timeAxis } from "../server/airProviders.js";

test("index bands follow the EEA table, including the edges", () => {
  // PM2.5: 0-5 Good, 6-15 Fair, 16-50 Moderate, 51-90 Poor, 91-140 Very poor, >140 Extremely poor
  const expected = [[0, 0], [5, 0], [5.4, 0], [5.6, 1], [15, 1], [16, 2], [50, 2], [51, 3], [90, 3], [91, 4], [140, 4], [141, 5], [900, 5]];
  for (const [value, band] of expected) assert.equal(bandIndex("pm25", value), band, "PM2.5 " + value);
  assert.equal(bandIndex("pm10", 45), 1);
  assert.equal(bandIndex("pm10", 46), 2);
  assert.equal(bandIndex("no2", 10), 0);
  assert.equal(bandIndex("no2", 151), 5);
  assert.equal(bandIndex("o3", 120), 2);
  assert.equal(bandIndex("so2", 276), 5);
  for (const spec of Object.values(POLLUTANTS)) assert.equal(spec.limits.length, BANDS.length - 1);
});

test("missing values never become a band, and zero is a valid Good reading", () => {
  assert.equal(bandIndex("pm25", null), null);
  assert.equal(bandIndex("pm25", undefined), null);
  assert.equal(bandIndex("pm25", Number.NaN), null);
  assert.equal(bandIndex("pm25", -1), null);
  assert.equal(bandIndex("unknown", 10), null);
  assert.equal(bandIndex("pm25", 0), 0);
  assert.equal(colourFor("pm25", null), null);
  assert.deepEqual(colourFor("pm25", 0), BANDS[0].colour);
  assert.deepEqual(colourFor("pm25", 500), BANDS[5].colour);
});

test("the overall index is the worst pollutant and ignores missing ones", () => {
  assert.deepEqual(airIndex({ pm25: 4, pm10: 130, no2: null, o3: 20 }), { band: 3, dominant: "pm10", value: 130 });
  assert.equal(airIndex({ pm25: null, pm10: null }), null);
  assert.equal(airIndex({ pm25: 0 }).band, 0);
});

test("provider numbers: zero is kept, empty and junk become null", () => {
  assert.equal(num("0.00"), 0);
  assert.equal(num(0), 0);
  assert.equal(num("12.50"), 12.5);
  assert.equal(num(""), null);
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num("nan"), null);
  assert.equal(num("unknown"), null);
  assert.equal(sensorTime("2026-11-12 10:24:01"), "2026-11-12T10:24:01.000Z");
  assert.equal(sensorTime("not a time"), null);
});

const record = (sensorId, type, locationId, timestamp, values, location = {}) => ({
  sensor: { id: sensorId, sensor_type: { name: type } },
  timestamp,
  location: { id: locationId, latitude: "42.678", longitude: "23.288", indoor: 0, ...location },
  sensordatavalues: Object.entries(values).map(([value_type, value]) => ({ value_type, value })),
});

test("sensor.community records are normalised per sensor and joined to humidity by location", () => {
  const items = normalizeSensors([
    record(1, "SDS011", 10, "2026-11-12 10:20:00", { P1: "40.00", P2: "20.00" }),
    record(1, "SDS011", 10, "2026-11-12 10:24:00", { P1: "0.00", P2: "0.00" }), // newest wins, zero kept
    record(2, "DHT22", 10, "2026-11-12 10:24:01", { temperature: "7.20", humidity: "69.90" }),
    record(3, "SDS011", 11, "2026-11-12 10:23:00", { P1: "", P2: "12.50" }, { indoor: 1 }),
    record(4, "BME280", 12, "2026-11-12 10:23:00", { temperature: "5", humidity: "80", pressure: "95000" }),
    { sensor: { id: 9 }, timestamp: "bad" },
  ]);
  assert.equal(items.length, 2);
  const first = items.find((item) => item.id === 1);
  assert.equal(first.pm25, 0);
  assert.equal(first.pm10, 0);
  assert.equal(first.humidity, 69.9);
  assert.equal(first.time, "2026-11-12T10:24:00.000Z");
  assert.equal(first.lon, 23.288);
  const second = items.find((item) => item.id === 3);
  assert.equal(second.pm10, null); // missing, not zero
  assert.equal(second.pm25, 12.5);
  assert.equal(second.humidity, null);
  assert.equal(second.indoor, true);
  assert.throws(() => normalizeSensors({ error: "x" }));
});

test("sensor screening drops indoor, non-physical and stuck readings and flags humid ones", () => {
  const base = { id: 1, lon: 23.3, lat: 42.7, indoor: false, pm25: 10, pm10: 20, humidity: 50 };
  assert.equal(screenSensor(base).status, "ok");
  assert.equal(screenSensor({ ...base, pm25: 0, pm10: 0 }).status, "ok");
  assert.equal(screenSensor({ ...base, indoor: true }).status, "indoor");
  assert.equal(screenSensor({ ...base, pm25: -1 }).status, "invalid");
  assert.equal(screenSensor({ ...base, pm25: SENSOR_QC.maxPm }).status, "invalid");
  assert.equal(screenSensor({ ...base, pm10: 1999 }).status, "invalid");
  assert.equal(screenSensor({ ...base, pm25: 30, pm10: 20 }).status, "invalid");
  assert.equal(screenSensor({ ...base, pm25: 20.5, pm10: 20 }).status, "ok"); // rounding noise
  assert.equal(screenSensor({ ...base, pm25: null, pm10: null }).status, "invalid");
  assert.equal(screenSensor({ ...base, pm10: null }).status, "ok");
  assert.equal(screenSensor({ ...base, lon: null }).status, "invalid");
  assert.equal(screenSensor({ ...base, lon: 0, lat: 0 }).status, "invalid");
  assert.equal(screenSensor({ ...base, humidity: SENSOR_QC.humidityMax + 1 }).status, "humid");
  assert.equal(screenSensor({ ...base, humidity: SENSOR_QC.humidityMax }).status, "ok");
  // No humidity sensor: fall back to the modelled value, and say so.
  const fallback = screenSensor({ ...base, humidity: null }, { fallbackHumidity: 97 });
  assert.equal(fallback.status, "humid");
  assert.equal(fallback.humiditySource, "model");
  assert.equal(screenSensor({ ...base, humidity: null }).status, "ok");
  assert.equal(screenSensor({ ...base, humidity: null }).humidityUsed, null);
  // A humidity value outside 0–100 is a broken humidity sensor, not a reason to trust it.
  assert.equal(screenSensor({ ...base, humidity: 140 }, { fallbackHumidity: 40 }).humiditySource, "model");
  assert.equal(screenSensor(base, { recent: [7, 7, 7, 7, 7, 7] }).status, "stuck");
  assert.equal(screenSensor(base, { recent: [7, 7, 7, 7, 7, 8] }).status, "ok");
  assert.equal(isStuck([7, 7, 7]), false);
  assert.equal(isStuck([null, null, null, null, null, null]), false);
});

test("the lattice snaps to the 0.1 degree CAMS grid and encloses every town", () => {
  const sofia = latticeFor(townBbox(TOWNS[0]));
  assert.deepEqual(sofia.lons, [23.1, 23.2, 23.3, 23.4, 23.5]);
  assert.deepEqual(sofia.lats, [42.6, 42.7, 42.8]);
  assert.deepEqual(latticePoints(sofia)[0], [23.1, 42.6]);
  assert.deepEqual(latticePoints(sofia)[5], [23.1, 42.7]);
  for (const town of TOWNS) {
    const [west, south, east, north] = townBbox(town);
    const { lons, lats } = latticeFor([west, south, east, north]);
    assert.ok(lons[0] <= west && lons.at(-1) >= east, town.id + " longitude");
    assert.ok(lats[0] <= south && lats.at(-1) >= north, town.id + " latitude");
    assert.ok(lons.length * lats.length <= 30, town.id + " lattice stays small");
  }
});

test("bilinear interpolation is exact at nodes, linear between them and null-aware", () => {
  const lattice = { lons: [23.0, 23.1], lats: [42.0, 42.1] };
  const values = [10, 20, 30, 40]; // south row first
  assert.equal(bilinear(lattice, values, 23.0, 42.0), 10);
  assert.equal(bilinear(lattice, values, 23.1, 42.1), 40);
  assert.ok(Math.abs(bilinear(lattice, values, 23.05, 42.05) - 25) < 1e-9);
  assert.ok(Math.abs(bilinear(lattice, values, 23.05, 42.0) - 15) < 1e-9);
  assert.equal(bilinear(lattice, values, 22.0, 41.0), 10); // clamped outside
  assert.equal(bilinear(lattice, values, 24.0, 43.0), 40);
  assert.ok(Math.abs(bilinear(lattice, [10, null, 30, 40], 23.05, 42.0) - 10) < 1e-9); // null corner skipped
  assert.equal(bilinear(lattice, [null, null, null, null], 23.05, 42.05), null);
  assert.equal(bilinear(lattice, [0, 0, 0, 0], 23.05, 42.05), 0); // zero is a value
  assert.equal(bilinear(lattice, null, 23.05, 42.05), null);
});

test("raster sampling and the fused surface", () => {
  const grid = { width: 2, height: 2, data: [1, 2, 3, 4], bounds: [0, 0, 2, 2] }; // row 0 is north
  assert.equal(sampleGrid(grid, 0.5, 1.5), 1);
  assert.equal(sampleGrid(grid, 1.5, 0.5), 4);
  assert.equal(sampleGrid(grid, 1, 1), 2.5);
  assert.equal(sampleGrid(grid, 5, 5, 1), 1); // outside → fallback
  assert.equal(sampleGrid(null, 1, 1, 1), 1);
  const lattice = { lons: [0, 2], lats: [0, 2] };
  assert.equal(surfaceAt(lattice, [10, 10, 10, 10], grid, 0.5, 1.5), 10);
  assert.equal(surfaceAt(lattice, [10, 10, 10, 10], grid, 1.5, 0.5), 40);
  assert.equal(surfaceAt(lattice, [10, 10, 10, 10], null, 1, 1), 10); // no factor: CAMS only
  assert.equal(surfaceAt(lattice, [null, null, null, null], grid, 1, 1), null);
});

test("CAMS and weather payloads align to the hourly axis and keep gaps as null", () => {
  const lattice = { lons: [23.3], lats: [42.7] };
  const axis = timeAxis(Date.parse("2026-11-12T10:30:00Z"));
  assert.equal(axis.length, 145);
  assert.equal(axis[48], "2026-11-12T10:00:00.000Z");
  const hourly = (extra) => ({ hourly: { time: ["2026-11-12T09:00", "2026-11-12T10:00", "2026-11-12T11:00"], ...extra } });
  const cams = normalizeCams(hourly({
    pm2_5: [0, 12.3, null], pm10: [5, null, null], nitrogen_dioxide: [1, 2, null], ozone: [3, 4, null], sulphur_dioxide: [null, null, null],
  }), lattice, axis);
  assert.deepEqual(cams.values.pm25[47], [0]); // a real zero
  assert.deepEqual(cams.values.pm25[48], [12.3]);
  assert.deepEqual(cams.values.pm25[49], [null]); // beyond the model run
  assert.deepEqual(cams.values.pm25[0], [null]); // not covered by the payload
  assert.deepEqual(cams.values.pm10[48], [null]);
  assert.equal(cams.lastIndex, 48);
  assert.throws(() => normalizeCams(hourly({ pm2_5: [null, null, null] }), lattice, axis));
  assert.throws(() => normalizeCams([hourly({}), hourly({})], lattice, axis)); // wrong number of points
  const weather = normalizeWeather(hourly({
    wind_speed_10m: [0, 2.5, 3], wind_direction_10m: [0, 180, 270], relative_humidity_2m: [100, 90, null],
  }), lattice, axis);
  assert.deepEqual(weather.speed[47], [0]);
  assert.deepEqual(weather.direction[48], [180]);
  assert.deepEqual(weather.humidity[49], [null]);
});

test("archive CSV parsing keeps zeros and blanks apart", () => {
  const rows = parseArchiveCsv(
    "sensor_id;sensor_type;location;lat;lon;timestamp;P1;durP1;ratioP1;P2;durP2;ratioP2\n" +
    "21091;SDS011;10704;42.678;23.288;2026-11-10T00:02:33;44.10;;;26.40;;\n" +
    "21091;SDS011;10704;42.678;23.288;2026-11-10T00:05:18;0.00;;;;;\n",
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { time: "2026-11-10T00:02:33.000Z", pm25: 26.4, pm10: 44.1 });
  assert.equal(rows[1].pm10, 0);
  assert.equal(rows[1].pm25, null);
  assert.throws(() => parseArchiveCsv("<html>Not found</html>"));
});

test("small helpers: median, daily means and compass names", () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([null]), null);
  assert.equal(median([0]), 0);
  const times = Array.from({ length: 48 }, (_, hour) => `2026-01-0${1 + Math.floor(hour / 24)}T${String(hour % 24).padStart(2, "0")}:00`);
  const values = times.map((_, index) => (index < 24 ? 20 : index < 30 ? 99 : null)); // day 2 has only 6 hours
  const days = dailyMeans(times, values);
  assert.deepEqual(days, [{ day: "2026-01-01", mean: 20 }]);
  assert.equal(compass(0), "N");
  assert.equal(compass(225), "SW");
  assert.equal(compass(359), "N");
  assert.equal(compass(null), null);
});
