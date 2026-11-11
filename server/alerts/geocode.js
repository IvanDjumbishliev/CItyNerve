import { fetchText } from "./sources.js";

const normalize = (text) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

export function resolveCandidate(city, place, features) {
  if (
    [city.name, city.localName].filter(Boolean).some((name) => normalize(name) === normalize(place))
  )
    return null;
  const [west, south, east, north] = city.bounds;
  const matches = features.filter((feature) => {
    const [lon, lat] = feature.geometry?.coordinates || [];
    const properties = feature.properties || {};
    const names = [properties.name, properties.street].filter(Boolean);
    return (
      lon >= west &&
      lon <= east &&
      lat >= south &&
      lat <= north &&
      names.some((name) => normalize(name) === normalize(place))
    );
  });
  const unique = [
    ...new Map(
      matches.map((feature) => [
        `${feature.properties.osm_type}/${feature.properties.osm_id}`,
        feature,
      ]),
    ).values(),
  ];
  if (unique.length !== 1) return null;
  const feature = unique[0];
  const neighborhood = ["suburb", "quarter", "neighbourhood", "district"].includes(
    feature.properties.osm_value,
  );
  return {
    coordinates: feature.geometry.coordinates,
    precision: neighborhood ? "Approximate neighborhood" : "Approximate named place",
    radiusM: neighborhood ? 1000 : 150,
    name: feature.properties.name || feature.properties.street,
    source: "OpenStreetMap via Photon",
  };
}

export async function locateIncidents(city, incidents, previous = {}) {
  const locations = { ...previous };
  const output = [];
  for (const incident of incidents) {
    if (!incident.place) {
      output.push(incident);
      continue;
    }
    const key = normalize(incident.place);
    let cached = locations[key];
    if (!cached || Date.now() - cached.checkedAt > 7 * 86400000) {
      try {
        // Six queries at most per city per analysis, spaced to respect the demo service.
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const url = new URL("/api/", process.env.PHOTON_URL || "https://photon.komoot.io");
        url.search = new URLSearchParams({
          q: `${incident.place}, ${city.localName || city.name}, ${city.country}`,
          bbox: city.bounds.join(","),
          limit: "5",
        });
        const response = JSON.parse(await fetchText(url, 8000));
        if (!Array.isArray(response.features)) throw new Error("Invalid geocoder response");
        cached = {
          checkedAt: Date.now(),
          location: resolveCandidate(city, incident.place, response.features),
        };
        locations[key] = cached;
      } catch {
        output.push({
          ...incident,
          locationIssue: "Location lookup unavailable",
        });
        continue;
      }
    }
    output.push({ ...incident, location: cached.location });
  }
  return { incidents: output, locations };
}
