"""Pernik / Studena dam area: terrain, land cover, dam and reservoir geometry.

  • Terrain:    SRTM 1" via AWS Terrain Tiles (same source as Sofia), ≈28 m
  • Land cover: ESA WorldCover 2021 (built-up share → exposure in Pernik)
  • Geometry:   OpenStreetMap — dam wall (way 242807133) and reservoir „яз. Студена“ (way 25236640)
"""
import json, math
import numpy as np
from PIL import Image
import rasterio
from rasterio.windows import from_bounds
from config import RAW, WORK, http_get
from fetch_dem import URL as DEM_URL, lonlat_to_tile, tile_to_lonlat

BBOX = (22.98, 42.50, 23.20, 42.65)   # Struma valley: Studena dam → Pernik → downstream
Z = 12
OVERPASS = "https://overpass-api.de/api/interpreter"
WC_URL = "/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N42E021_Map.tif"


def dem():
    w, s, e, n = BBOX
    x0f, y0f = lonlat_to_tile(w, n, Z); x1f, y1f = lonlat_to_tile(e, s, Z)
    tx0, ty0, tx1, ty1 = int(x0f), int(y0f), int(x1f), int(y1f)
    cache = RAW / "terrarium"; cache.mkdir(exist_ok=True)
    rows = []
    for ty in range(ty0, ty1 + 1):
        row = []
        for tx in range(tx0, tx1 + 1):
            f = cache / f"{Z}_{tx}_{ty}.png"
            if not f.exists():
                f.write_bytes(http_get(DEM_URL.format(z=Z, x=tx, y=ty)).content)
            a = np.asarray(Image.open(f).convert("RGB")).astype(np.float64)
            row.append(a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768)
        rows.append(np.hstack(row))
    m = np.vstack(rows)
    px0 = int((x0f - tx0) * 256); py0 = int((y0f - ty0) * 256)
    px1 = int(math.ceil((x1f - tx0) * 256)); py1 = int(math.ceil((y1f - ty0) * 256))
    d = m[py0:py1, px0:px1].astype(np.float32)
    west, north = tile_to_lonlat(tx0 + px0 / 256, ty0 + py0 / 256, Z)
    east, south = tile_to_lonlat(tx0 + px1 / 256, ty0 + py1 / 256, Z)
    cell = 40075016.686 * math.cos(math.radians((north + south) / 2)) / (256 * 2 ** Z)
    grid = {"zoom": Z, "west": west, "east": east, "north": north, "south": south, "rows": int(d.shape[0]), "cols": int(d.shape[1]),
            "cell_m": cell, "tile_origin": [tx0 + px0 / 256, ty0 + py0 / 256]}
    np.save(WORK / "pernik_dem.npy", d)
    (WORK / "pernik_grid.json").write_text(json.dumps(grid, indent=2))
    print(f"Pernik DEM {d.shape}, {d.min():.0f}–{d.max():.0f} m, cell {cell:.1f} m")
    return grid


def landcover(grid):
    w, s, e, n = grid["west"], grid["south"], grid["east"], grid["north"]
    with rasterio.Env(GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open(WC_URL) as src:
            win = from_bounds(w, s, e, n, src.transform).round_offsets().round_lengths()
            lc = src.read(1, window=win); t = src.window_transform(win)
    R, C = grid["rows"], grid["cols"]; tx0, ty0 = grid["tile_origin"]; nt = 2 ** Z
    xs = (tx0 + (np.arange(C) + 0.5) / 256) / nt * 360 - 180
    ys = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (ty0 + (np.arange(R) + 0.5) / 256) / nt))))
    ci = np.clip(((xs - t.c) / t.a).astype(int), 0, lc.shape[1] - 1)
    ri = np.clip(((ys - t.f) / t.e).astype(int), 0, lc.shape[0] - 1)
    built = np.zeros((R, C), np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            built += lc[np.ix_(np.clip(ri + dy, 0, lc.shape[0] - 1), np.clip(ci + dx, 0, lc.shape[1] - 1))] == 50
    np.save(WORK / "pernik_built.npy", built / 9)
    print(f"Pernik built-up share {(built / 9 > 0.5).mean():.1%}")


def geometry():
    q = '[out:json][timeout:60];(way(242807133);way(1443881908);way(25236640););out geom;'
    j = http_get(OVERPASS, params={"data": q}, timeout=120).json()
    feats = []
    for el in j["elements"]:
        coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
        t = el.get("tags", {})
        kind = "dam" if t.get("waterway") == "dam" else "reservoir"
        geom = {"type": "Polygon", "coordinates": [coords]} if kind == "reservoir" else {"type": "LineString", "coordinates": coords}
        feats.append({"type": "Feature", "properties": {"kind": kind, "osm_id": el["id"], "name": t.get("name", "")}, "geometry": geom})
    (RAW / "studena_osm.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False))
    for f in feats:
        c = f["geometry"]["coordinates"]; c = c[0] if f["geometry"]["type"] == "Polygon" else c
        print(f["properties"], len(c), "points")


if __name__ == "__main__":
    g = dem(); landcover(g); geometry()
