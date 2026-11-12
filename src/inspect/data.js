import { REGIONS } from "../data.js";
import { HEAT_TOWNS, coverageOf } from "../heat/towns.js";
import { buildingShadows, sunPosition } from "../heat/shadows.js";
import { contains, gridCell, inBounds } from "./geometry.js";

const cache = new Map();
const shadowCache = new WeakMap();
const base = `${import.meta.env.BASE_URL}data/`;

function cached(key, load) {
  if (cache.has(key)) {
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }
  const promise = load().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  if (cache.size > 16) cache.delete(cache.keys().next().value);
  return promise;
}

function json(path) {
  return cached(path, async () => {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Dataset unavailable");
    return response.json();
  });
}

function raster(path) {
  return cached(
    path,
    () =>
      new Promise((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(() => {
          image.src = "";
          reject(new Error("Raster timed out"));
        }, 15000);
        image.onload = () => {
          clearTimeout(timer);
          try {
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(image, 0, 0);
            resolve({
              width: image.width,
              height: image.height,
              pixels: ctx.getImageData(0, 0, image.width, image.height).data,
            });
          } catch (error) {
            reject(error);
          }
        };
        image.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Raster unavailable"));
        };
        image.src = base + path;
      }),
  );
}

async function sample(point, grid, path) {
  const cell = gridCell(point, grid);
  if (!cell) return null;
  const image = await raster(path);
  if (image.width !== grid.cols || image.height !== grid.rows)
    throw new Error("Dataset dimensions do not match its grid");
  const offset = cell.index * 4;
  if (!image.pixels[offset + 3]) return null;
  return image.pixels[offset];
}

const missing = (
  title,
  detail = "Data unavailable here. This location is outside the available coverage.",
) => ({ title, status: "unavailable", detail });
const period = (summary) => `${summary.period.start} to ${summary.period.end}`;

export async function inspectFlood(selection, context) {
  const region = REGIONS[selection.cityId];
  if (!region) return missing("Flood");
  const summary = await json(region.base + "summary.json");
  const chosen = context?.flood;
  const event = chosen?.eventId ? summary.events.find((item) => item.id === chosen.eventId) : null;
  const path = region.base + (event?.png || summary.max5y.png);
  const value = await sample(selection.point, summary.grid, path);
  if (value === null) return missing("Flood");
  // This is an event maximum raster. Playback multiplies it for visualization;
  // it is not a separately modeled hourly depth at this cell.
  return {
    title: "Flood",
    status: "available",
    value:
      value === 0
        ? "Below mapped flood threshold"
        : `${value === 255 ? "At least " : ""}${(value / 50).toFixed(2)} m`,
    detail:
      "Modeled maximum depth at this grid cell. Not a live flood measurement or an hourly hydraulic result.",
    source:
      "SRTM / ICESat-2 terrain, IMERG rainfall, MERRA-2, ESA WorldCover; local screening model",
    date: event ? `Storm: ${event.start.slice(0, 10)}` : `Historical maximum: ${period(summary)}`,
    resolution: `${summary.grid.cell_m} m grid; drainage capacity is assumed. Zero does not establish safety.`,
  };
}

export async function inspectHeat(selection, context) {
  if (selection.cityId !== "sofia") return missing("Summer heat");
  const summary = await json("heat/summary.json");
  const scene = context?.heat?.sceneId
    ? summary.scenes.find((item) => item.id === context.heat.sceneId)
    : null;
  const raw = await sample(selection.point, summary.grid, scene?.png || summary.rasters.suhi);
  if (raw === null || raw === 0)
    return missing(
      "Summer heat",
      "No valid satellite sample here. Water, clouds, or coverage gaps can leave a cell unavailable.",
    );
  const value = summary.encoding.suhi.lo + (raw - 1) / summary.encoding.suhi.scale;
  return {
    title: "Summer heat",
    status: "available",
    value: `${value > 0 ? "+" : ""}${value.toFixed(1)} °C vs countryside`,
    detail:
      "Satellite surface heat difference. This describes roofs, ground, or canopy - not pedestrian air temperature.",
    source: "Landsat 8/9 Collection 2 Level-2 via Microsoft Planetary Computer",
    date: scene
      ? `Satellite pass: ${scene.date}`
      : `Summer composite: ${period(summary)} (${summary.composite.passes} passes)`,
    resolution: `${summary.grid.cell_m} m output grid; native thermal observations are approximately 100 m.`,
  };
}

export async function inspectFog(selection) {
  if (selection.cityId !== "sofia") return missing("Fog context");
  const summary = await json("fog_summary.json");
  const raw = await sample(selection.point, summary.grid, summary.grid.raster);
  if (raw === null) return missing("Fog context");
  const factor = (raw / 255) * 1.4;
  return {
    title: "Fog context",
    status: "available",
    value: `${factor.toFixed(2)}× terrain adjustment`,
    detail:
      "Relative terrain-proneness factor used by the fog model. It is neither local visibility nor a probability of fog.",
    source: "SRTM terrain and ESA WorldCover; station calibration at Sofia Airport (LBSF)",
    date: `Observation record: ${period(summary)}`,
    resolution: `${summary.grid.cell_m} m grid. Airport observations do not measure conditions on this street.`,
  };
}

export async function inspectShade(selection, context, day, hour) {
  const town = HEAT_TOWNS.find((item) => item.id === selection.cityId);
  if (!town) return missing("Building shade");
  const loaded = context?.shade;
  const buildings = loaded?.buildings || (await json(town.id + "-shade-buildings.geojson"));
  const bounds = loaded?.bounds || coverageOf(buildings);
  if (!inBounds(selection.point, bounds))
    return missing(
      "Building shade",
      "Outside the loaded building area. Open Heat Live and load buildings around this place.",
    );
  const date = loaded?.day || day;
  const time = loaded?.hour ?? hour;
  const solarTown = loaded?.solarTown || town;
  const building = buildings.features.find((item) => contains(selection.point, item.geometry));
  const night = sunPosition(date, time, solarTown).altitude <= 0;
  let shadows = loaded?.shadows;
  if (!shadows && !night && !building) {
    const key = `${date}:${time}:${solarTown.center.join(",")}`;
    let saved = shadowCache.get(buildings);
    if (saved?.key !== key) {
      saved = { key, data: buildingShadows(buildings, date, time, solarTown) };
      shadowCache.set(buildings, saved);
    }
    shadows = saved.data;
  }
  const shaded = shadows?.features.some((item) => contains(selection.point, item.geometry));
  return {
    title: "Building shade",
    status: "available",
    value: building
      ? "Inside a building footprint"
      : night
        ? "Nighttime"
        : shaded
          ? "Estimated building shade"
          : "Estimated direct sun",
    detail: building
      ? "This point intersects a building footprint. Pedestrian shade is not evaluated inside the building."
      : "Calculated for the selected time, using available building heights. Trees, clouds and terrain shade are not included.",
    source: "OpenStreetMap-derived building geometry and heights; SunCalc solar position",
    date: `${date}, ${String(Math.floor(time)).padStart(2, "0")}:${String(Math.round((time % 1) * 60)).padStart(2, "0")} (${town.timeZone})`,
    resolution:
      "Coverage follows the loaded building area; missing buildings and assumed heights can change the result.",
  };
}

export async function inspectPlace(selection, context, day, hour, onResult) {
  const adapters = [
    ["Flood", () => inspectFlood(selection, context)],
    ["Summer heat", () => inspectHeat(selection, context)],
    ["Building shade", () => inspectShade(selection, context, day, hour)],
    ["Fog context", () => inspectFog(selection)],
  ];
  return Promise.all(
    adapters.map(async ([title, run], index) => {
      let result;
      try {
        result = await run();
      } catch {
        result = missing(
          title,
          "This dataset could not be loaded. Other results remain available; retry to check again.",
        );
      }
      onResult?.(index, result);
      return result;
    }),
  );
}
