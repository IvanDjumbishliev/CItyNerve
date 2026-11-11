import { XMLParser } from "fast-xml-parser";

export const providerUrls = {
  sofia: "https://www.sofiatraffic.bg/bg/parking/parkings/update",
  basel: "https://data.bs.ch/api/explore/v2.1/catalog/datasets/100088/records?limit=100",
  ghent:
    "https://data.stad.gent/api/explore/v2.1/catalog/datasets/bezetting-parkeergarages-real-time/records?limit=100",
  stgallen:
    "https://daten.stadt.sg.ch/api/explore/v2.1/catalog/datasets/freie-parkplatze-in-der-stadt-stgallen-pls/records?limit=100",
  zurich: "https://www.pls-zh.ch/plsFeed/rss",
};
export const attribution = {
  sofia: "Sofia Urban Mobility Centre",
  basel: "Basel-Stadt · CC BY 4.0",
  ghent: "City of Ghent · Open Data",
  stgallen: "City of St. Gallen · Open Data",
  zurich: "PLS Parkleitsystem Zürich · CC0; geometry via ParkenDD",
};
export async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error("Provider unavailable");
  const body = await response.text();
  if (body.length > 2000000) throw Error("Response too large");
  return body;
}
function status(value) {
  if (["open", "offen", 1, true].includes(value)) return "open";
  if (["closed", "geschlossen", 0, false].includes(value)) return "closed";
  return "unknown";
}
export function normalizeRows(city, raw) {
  const rows = city === "sofia" ? raw : raw.results;
  if (!Array.isArray(rows)) throw Error("Invalid provider response");
  return rows.map((r) => {
    if (city === "sofia")
      return {
        id: city + "-" + r.id,
        name: r.name_english || r.name,
        lon: r.longitude,
        lat: r.latitude,
        free: r.spaces,
        capacity: null,
        measuredAt: null,
        status: "unknown",
      };
    if (city === "ghent")
      return {
        id: city + "-" + r.id,
        name: r.name,
        lon: r.location?.lon,
        lat: r.location?.lat,
        free: r.availablecapacity,
        capacity: r.totalcapacity,
        measuredAt: r.lastupdate,
        status: r.temporaryclosed === 1 ? "closed" : status(r.isopennow),
      };
    if (city === "stgallen")
      return {
        id: city + "-" + r.ph_id,
        name: r.ph_name,
        lon: r.koordinaten?.lon,
        lat: r.koordinaten?.lat,
        free: r.frei,
        capacity: r.anzahl_parkplatze,
        measuredAt: r.letzte_aktualisierung,
        status: status(r.ph_status),
      };
    return {
      id: city + "-" + r.id,
      name: r.title,
      lon: r.geo_point_2d?.lon,
      lat: r.geo_point_2d?.lat,
      free: r.free,
      capacity: r.total,
      measuredAt: r.published,
      status: status(r.status),
    };
  });
}
export function normalizeZurich(xml, metadata) {
  const feed = new XMLParser({ processEntities: true }).parse(xml);
  const items = feed.rss?.channel?.item;
  if (!items || !Array.isArray(metadata.lots)) throw Error("Invalid Zürich feed");
  const key = (name) =>
    String(name)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const lots = new Map(metadata.lots.map((l) => [key(l.name), l]));
  return (Array.isArray(items) ? items : [items]).flatMap((item) => {
    const match = String(item.description).match(/^(open|closed|unbestimmt)\s*\/\s*(\d+)\s*$/);
    const name = String(item.title)
      .split("/")[0]
      .trim()
      .replace(/^(Parkhaus|Parkplatz)\s+/i, "");
    const lot = lots.get(key(name));
    if (!match || !lot) return [];
    return [
      {
        id: "zurich-" + lot.id,
        name: lot.name,
        lon: lot.coords?.lng,
        lat: lot.coords?.lat,
        free: Number(match[2]),
        capacity: lot.total > 0 ? lot.total : null,
        measuredAt: item["dc:date"] || item.pubDate,
        status: status(match[1]),
      },
    ];
  });
}
export function validFacilities(rows) {
  return rows.filter(
    (r) =>
      typeof r.name === "string" &&
      r.name.trim() &&
      Number.isFinite(r.lon) &&
      Math.abs(r.lon) <= 180 &&
      Number.isFinite(r.lat) &&
      Math.abs(r.lat) <= 90 &&
      Number.isInteger(r.free) &&
      r.free >= 0 &&
      (r.capacity === null || (Number.isInteger(r.capacity) && r.capacity >= r.free)),
  );
}
