// Pipeline rasters use the Web Mercator tile grid, not evenly spaced latitude rows.
const mercatorY = (latitude) => Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));

export function gridCell(point, grid) {
  if (!grid?.bounds || !point?.every(Number.isFinite)) return null;
  const [[west, north], [east], , [, south]] = grid.bounds;
  const [lon, lat] = point;
  if (lon < west || lon >= east || lat <= south || lat > north) return null;
  const column = Math.floor(((lon - west) / (east - west)) * grid.cols);
  const row = Math.floor(
    ((mercatorY(north) - mercatorY(lat)) / (mercatorY(north) - mercatorY(south))) * grid.rows,
  );
  if (row < 0 || row >= grid.rows || column < 0 || column >= grid.cols) return null;
  return { column, row, index: row * grid.cols + column };
}

export function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function contains(point, geometry) {
  const polygons =
    geometry?.type === "Polygon"
      ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return polygons.some(
    ([outer, ...holes]) => inRing(point, outer) && !holes.some((hole) => inRing(point, hole)),
  );
}

export function inBounds([lon, lat], bounds) {
  return Boolean(
    bounds && lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3],
  );
}

export function readSelection(hash) {
  const params = new URLSearchParams(hash.split("?")[1] || "");
  const raw = params.get("inspect");
  if (!raw) return null;
  const point = raw.split(",").map(Number);
  if (
    point.length !== 2 ||
    !point.every(Number.isFinite) ||
    Math.abs(point[0]) > 180 ||
    Math.abs(point[1]) > 85
  )
    return null;
  return { point, cityId: params.get("city") || "sofia", name: "Selected place" };
}

export function readInspectionTime(hash) {
  const params = new URLSearchParams(hash.split("?")[1] || "");
  const day = params.get("day");
  const hour = Number(params.get("hour") ?? 15);
  return {
    day:
      /^\d{4}-\d{2}-\d{2}$/.test(day || "") && Number.isFinite(Date.parse(day))
        ? day
        : "2026-07-15",
    hour: Number.isFinite(hour) && hour >= 0 && hour <= 23.5 ? hour : 15,
  };
}
