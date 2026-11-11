"""Landsat 8/9 summer surface temperature, vegetation and albedo on the DEM grid.

Source: USGS/NASA Landsat Collection 2 Level-2 (ST_B10 surface temperature from
the TIRS thermal sensor, surface reflectance from OLI), read as Cloud-Optimised
GeoTIFFs from the Microsoft Planetary Computer STAC catalogue. No login: the
free anonymous SAS token endpoint signs the blob URLs.

For every clear-sky daytime pass (≈10:10 UTC, 12:10 local summer time) between
1 June and 15 September 2022–2026 whose footprint covers the whole study area,
the scene is warped onto the 28 m Web-Mercator DEM grid and saved as:
  lst  — land surface temperature, °C   (ST_B10 × 0.00341802 + 149.0 − 273.15)
  ndvi — (NIR − red) / (NIR + red) from surface reflectance
  alb  — broadband shortwave albedo (Liang 2001, Landsat-8 coefficients)
  clear — QA_PIXEL: no fill, dilated cloud, cirrus, cloud, shadow or snow
"""
import json
import math
import time
from datetime import date

import numpy as np
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from shapely.geometry import box, shape

from config import BBOX, RAW, WORK, USER_AGENT

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsateuwest/landsat-c2"
YEARS = range(2022, 2027)
SEASON = ("06-01", "09-15")
MIN_CLEAR = 0.6           # keep a pass only if ≥60 % of the study grid is cloud-free
SCENES = WORK / "heat"
SCENES.mkdir(parents=True, exist_ok=True)
R_EARTH = 6378137.0

ST_SCALE, ST_OFFSET = 0.00341802, 149.0
SR_SCALE, SR_OFFSET = 0.0000275, -0.2
QA_BAD = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)   # fill, dilated, cirrus, cloud, shadow, snow


def grid_transform(grid):
    """Affine transform of the DEM grid in EPSG:3857 (cells are 1/256 of a z-tile)."""
    n = 2 ** grid["zoom"]
    world = 2 * math.pi * R_EARTH
    px = world / (n * 256)
    x0 = grid["tile_origin"][0] / n * world - world / 2
    y0 = world / 2 - grid["tile_origin"][1] / n * world
    return from_origin(x0, y0, px, px)


def search():
    items = []
    for y in YEARS:
        body = {"collections": ["landsat-c2-l2"], "bbox": list(BBOX),
                "datetime": f"{y}-{SEASON[0]}T00:00:00Z/{y}-{SEASON[1]}T23:59:59Z",
                "query": {"eo:cloud_cover": {"lt": 60}, "platform": {"in": ["landsat-8", "landsat-9"]}},
                "limit": 100}
        r = requests.post(STAC, json=body, headers={"User-Agent": USER_AGENT}, timeout=90)
        r.raise_for_status()
        items += r.json()["features"]
    study = box(*BBOX)
    whole = [f for f in items if shape(f["geometry"]).contains(study)]
    print(f"Landsat C2 L2 summer scenes: {len(items)} touching, {len(whole)} covering the whole study area")
    return sorted(whole, key=lambda f: f["properties"]["datetime"])


def token():
    r = requests.get(TOKEN, headers={"User-Agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    return r.json()["token"]


def read(href, sas, transform, shape_, resampling):
    with rasterio.open(f"/vsicurl/{href}?{sas}") as src:
        with WarpedVRT(src, crs="EPSG:3857", transform=transform, width=shape_[1], height=shape_[0],
                       resampling=resampling, src_nodata=src.nodata if src.nodata is not None else 0, nodata=0) as vrt:
            return vrt.read(1)


def main():
    grid = json.loads((WORK / "grid.json").read_text())
    transform = grid_transform(grid)
    shp = (grid["rows"], grid["cols"])
    items = search()
    sas, sas_time = token(), time.time()
    catalogue = []
    env = dict(GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
               CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".TIF,.tif", VSI_CACHE="TRUE")
    with rasterio.Env(**env):
        for f in items:
            p = f["properties"]
            day = p["datetime"][:10]
            sid = f["id"]
            out = SCENES / f"{sid}.npz"
            meta = {"id": sid, "date": day, "time_utc": p["datetime"][11:16], "platform": p["platform"],
                    "path_row": f"{p.get('landsat:wrs_path')}/{p.get('landsat:wrs_row')}",
                    "scene_cloud_pct": round(p["eo:cloud_cover"], 1)}
            if out.exists():
                z = np.load(out)
                meta["clear_share"] = round(float(z["clear"].mean()), 3)
                catalogue.append(meta)
                continue
            if time.time() - sas_time > 40 * 60:
                sas, sas_time = token(), time.time()
            a = f["assets"]
            try:
                qa = read(a["qa_pixel"]["href"], sas, transform, shp, Resampling.nearest)
                clear = (qa != 0) & ((qa & QA_BAD) == 0)
                share = float(clear.mean())
                meta["clear_share"] = round(share, 3)
                if share < MIN_CLEAR:
                    print(f"{day} {sid}: {share:.0%} clear — skipped")
                    continue
                st = read(a["lwir11"]["href"], sas, transform, shp, Resampling.bilinear).astype(np.float32)
                lst = np.where(st > 0, st * ST_SCALE + ST_OFFSET - 273.15, np.nan)
                bands = {}
                for k in ("blue", "red", "nir08", "swir16", "swir22"):
                    raw = read(a[k]["href"], sas, transform, shp, Resampling.bilinear).astype(np.float32)
                    bands[k] = np.where(raw > 0, raw * SR_SCALE + SR_OFFSET, np.nan)
            except Exception as e:  # noqa: BLE001
                print(f"{day} {sid}: read failed ({e}) — skipped")
                continue
            red, nir = bands["red"], bands["nir08"]
            with np.errstate(invalid="ignore", divide="ignore"):
                ndvi = (nir - red) / (nir + red)
            alb = (0.356 * bands["blue"] + 0.130 * red + 0.373 * nir + 0.085 * bands["swir16"]
                   + 0.072 * bands["swir22"] - 0.0018)
            clear &= np.isfinite(lst) & (lst > -20) & (lst < 80)
            np.savez_compressed(out, lst=np.where(clear, lst, np.nan).astype(np.float16),
                                ndvi=np.where(clear, ndvi, np.nan).astype(np.float16),
                                alb=np.where(clear, alb, np.nan).astype(np.float16), clear=clear)
            catalogue.append(meta)
            print(f"{day} {sid}: {share:.0%} clear · LST median {np.nanmedian(lst[clear]):.1f} °C")
    kept = [m for m in catalogue if m.get("clear_share", 0) >= MIN_CLEAR]
    (RAW / "landsat_heat.json").write_text(json.dumps({
        "source": "USGS/NASA Landsat Collection 2 Level-2 via Microsoft Planetary Computer",
        "fetched": date.today().isoformat(), "scenes": kept}, indent=1))
    print(f"{len(kept)} clear summer passes saved")


if __name__ == "__main__":
    main()
