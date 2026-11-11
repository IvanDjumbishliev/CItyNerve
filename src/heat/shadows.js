import SunCalc from "suncalc";

// The slider uses Sofia summer civil time (UTC+3), independent of browser timezone.
export function sunPosition(day, hour) {
  return SunCalc.getPosition(
    new Date(day + "T00:00:00+03:00").getTime() + hour * 3600000,
    42.692,
    23.338,
  );
}

export function buildingShadows(buildings, day, hour) {
  const sun = sunPosition(day, hour);
  if (sun.altitude <= 0) return { type: "FeatureCollection", features: [] };
  const features = [];
  for (const building of buildings.features) {
    const ring = building.geometry.coordinates[0];
    const length = building.properties.heightM / Math.tan(sun.altitude);
    const lat = (ring[0][1] * Math.PI) / 180;
    const dx = (Math.sin(sun.azimuth) * length) / (111320 * Math.cos(lat));
    const dy = (Math.cos(sun.azimuth) * length) / 111320;
    const shifted = ring.map(([x, y]) => [x + dx, y + dy]);
    const polygons = [[shifted]];
    for (let i = 0; i < ring.length - 1; i++)
      polygons.push([[ring[i], ring[i + 1], shifted[i + 1], shifted[i], ring[i]]]);
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "MultiPolygon", coordinates: polygons },
    });
  }
  return { type: "FeatureCollection", features };
}

export function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function inShade(point, shadows) {
  return shadows.features.some((feature) =>
    feature.geometry.coordinates.some((polygon) => inRing(point, polygon[0])),
  );
}
