import { TOWNS } from "../../shared/towns.js";

export const HEAT_TOWNS = TOWNS;

export function coverageOf(buildings) {
  const points = buildings.features.flatMap((b) => b.geometry.coordinates[0]);
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}
export function boundary([west, south, east, north]) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

export async function loadNeighborhood([lon, lat], signal) {
  // A small buffered window limits the OSM response size and rendering work.
  const bounds = [lon - 0.012, lat - 0.008, lon + 0.012, lat + 0.008];
  const response = await fetch(
    "https://api.openstreetmap.org/api/0.6/map?bbox=" + bounds.join(","),
    { signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) },
  );
  if (!response.ok)
    throw Error("Building service unavailable (" + response.status + "). Try again shortly.");
  const xml = new DOMParser().parseFromString(await response.text(), "text/xml");
  if (xml.querySelector("parsererror")) throw Error("Building service returned invalid data.");
  const nodes = new Map(
    Array.from(xml.querySelectorAll("node"), (n) => [
      n.getAttribute("id"),
      [Number(n.getAttribute("lon")), Number(n.getAttribute("lat"))],
    ]),
  );
  const features = [];
  for (const way of xml.querySelectorAll("way")) {
    const tags = Object.fromEntries(
      Array.from(way.querySelectorAll("tag"), (t) => [t.getAttribute("k"), t.getAttribute("v")]),
    );
    if (!tags.building || tags.building === "no") continue;
    const ids = Array.from(way.querySelectorAll("nd"), (n) => n.getAttribute("ref"));
    if (ids.length < 4 || ids[0] !== ids.at(-1) || ids.some((id) => !nodes.has(id))) continue;
    const measured = Number.parseFloat(tags.height),
      levels = Number.parseFloat(tags["building:levels"]);
    const heightM = measured > 0 ? measured : levels > 0 ? levels * 3 : 9;
    features.push({
      type: "Feature",
      properties: {
        heightM,
        heightBasis: measured > 0 ? "OSM height" : levels > 0 ? "OSM levels × 3 m" : "Assumed 9 m",
      },
      geometry: { type: "Polygon", coordinates: [ids.map((id) => nodes.get(id))] },
    });
  }
  if (!features.length)
    throw Error("No mapped building outlines in this area. Move to a built-up neighborhood.");
  return { buildings: { type: "FeatureCollection", features }, bounds };
}
