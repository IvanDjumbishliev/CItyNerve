"""Download terrain for Sofia.

Source: AWS Terrain Tiles (terrarium encoding). For this region at z12 the
values come from NASA/NGA SRTM 1-arc-second elevation. The grid stays in Web
Mercator so it can be overlaid on the map without resampling.
"""
import io, json, math
import numpy as np
from PIL import Image
from config import BBOX, DEM_ZOOM, RAW, WORK, http_get

URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile_to_lonlat(x, y, z):
    n = 2 ** z
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def main():
    w, s, e, n = BBOX
    z = DEM_ZOOM
    x0f, y0f = lonlat_to_tile(w, n, z)
    x1f, y1f = lonlat_to_tile(e, s, z)
    tx0, ty0, tx1, ty1 = int(x0f), int(y0f), int(x1f), int(y1f)
    cache = RAW / "terrarium"
    cache.mkdir(exist_ok=True)
    rows = []
    for ty in range(ty0, ty1 + 1):
        row = []
        for tx in range(tx0, tx1 + 1):
            f = cache / f"{z}_{tx}_{ty}.png"
            if not f.exists():
                r = http_get(URL.format(z=z, x=tx, y=ty))
                f.write_bytes(r.content)
            a = np.asarray(Image.open(f).convert("RGB")).astype(np.float64)
            row.append(a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768)
        rows.append(np.hstack(row))
    mosaic = np.vstack(rows)

    # crop to bbox in pixel space
    px0 = int((x0f - tx0) * 256); py0 = int((y0f - ty0) * 256)
    px1 = int(math.ceil((x1f - tx0) * 256)); py1 = int(math.ceil((y1f - ty0) * 256))
    dem = mosaic[py0:py1, px0:px1].astype(np.float32)

    west, north = tile_to_lonlat(tx0 + px0 / 256, ty0 + py0 / 256, z)
    east, south = tile_to_lonlat(tx0 + px1 / 256, ty0 + py1 / 256, z)
    lat_c = (north + south) / 2
    cell = 40075016.686 * math.cos(math.radians(lat_c)) / (256 * 2 ** z)

    np.save(WORK / "dem.npy", dem)
    meta = {"zoom": z, "west": west, "east": east, "north": north, "south": south,
            "rows": int(dem.shape[0]), "cols": int(dem.shape[1]), "cell_m": cell,
            "tile_origin": [tx0 + px0 / 256, ty0 + py0 / 256],
            "source": "AWS Terrain Tiles (terrarium) — SRTM 1\" (NASA/NGA) for this area"}
    (WORK / "grid.json").write_text(json.dumps(meta, indent=2))
    print(f"DEM {dem.shape} cell≈{cell:.1f} m, elev {dem.min():.0f}–{dem.max():.0f} m")


if __name__ == "__main__":
    main()
