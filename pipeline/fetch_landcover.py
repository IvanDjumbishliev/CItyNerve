"""Land cover (built-up / vegetation / water) on the DEM grid.

Source: ESA WorldCover 2021 v200, 10 m, derived from Sentinel-1/2 satellites.
Used in place of NASA HLS, which needs an Earthdata login.
Classes: 10 tree, 20 shrub, 30 grass, 40 crop, 50 built-up, 60 bare,
         80 water, 90 wetland, 95 mangrove, 100 moss.
"""
import json, math
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from config import BBOX, WORK, RAW

URL = "/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N42E021_Map.tif"


def main():
    grid = json.loads((WORK / "grid.json").read_text())
    cache = RAW / "worldcover_sofia.npy"
    w, s, e, n = grid["west"], grid["south"], grid["east"], grid["north"]
    if cache.exists():
        lc = np.load(cache); meta = json.loads((RAW / "worldcover_sofia.json").read_text())
    else:
        with rasterio.Env(GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            with rasterio.open(URL) as src:
                win = from_bounds(w, s, e, n, src.transform).round_offsets().round_lengths()
                lc = src.read(1, window=win)
                t = src.window_transform(win)
        meta = {"west": t.c, "north": t.f, "dx": t.a, "dy": t.e}
        np.save(cache, lc); (RAW / "worldcover_sofia.json").write_text(json.dumps(meta))

    # sample at DEM cell centres (DEM grid is Web Mercator)
    rows, cols, z = grid["rows"], grid["cols"], grid["zoom"]
    tx0, ty0 = grid["tile_origin"]
    nt = 2 ** z
    xs = (tx0 + (np.arange(cols) + 0.5) / 256) / nt * 360 - 180
    ys = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (ty0 + (np.arange(rows) + 0.5) / 256) / nt))))
    ci = np.clip(((xs - meta["west"]) / meta["dx"]).astype(int), 0, lc.shape[1] - 1)
    ri = np.clip(((ys - meta["north"]) / meta["dy"]).astype(int), 0, lc.shape[0] - 1)

    # majority class within each 28 m cell would be nicer; use built-up fraction from a 3x3 sample
    off = [-1, 0, 1]
    built = np.zeros((rows, cols), np.float32)
    for dy in off:
        for dx in off:
            r = np.clip(ri + dy, 0, lc.shape[0] - 1); c = np.clip(ci + dx, 0, lc.shape[1] - 1)
            built += (lc[np.ix_(r, c)] == 50)
    built /= 9
    cls = lc[np.ix_(ri, ci)]
    np.save(WORK / "landcover.npy", cls.astype(np.uint8))
    np.save(WORK / "built_frac.npy", built)
    print(f"landcover {cls.shape}; built-up share {(built > 0.5).mean():.1%}; water cells {(cls == 80).sum()}")


if __name__ == "__main__":
    main()
