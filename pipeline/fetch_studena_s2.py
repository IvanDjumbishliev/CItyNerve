"""Studena reservoir water surface area over 5 years from Sentinel-2 (no login).

Sentinel-2 L2A Cloud-Optimised GeoTIFFs on AWS Open Data, found via the
Element 84 Earth Search STAC API. For every scene we read only a small window
around the reservoir: green (B03), NIR (B08) and the scene classification
(SCL, for clouds / snow). Water = NDWI > 0.
"""
import json
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom
from rasterio.windows import from_bounds
from shapely.geometry import shape, mapping
from config import RAW, START_DATE, END_DATE
import requests

STAC = "https://earth-search.aws.element84.com/v1/search"
ENV = dict(GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
           CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", AWS_NO_SIGN_REQUEST="YES")


def search(bbox):
    body = {"collections": ["sentinel-2-l2a"], "bbox": bbox, "limit": 200,
            "datetime": f"{START_DATE}T00:00:00Z/{END_DATE}T23:59:59Z",
            "query": {"eo:cloud_cover": {"lt": 60}}}
    items, url = [], STAC
    while url:
        r = requests.post(url, json=body, timeout=120); r.raise_for_status(); j = r.json()
        items += j["features"]
        nxt = [l for l in j.get("links", []) if l.get("rel") == "next"]
        if not nxt: break
        url = nxt[0]["href"]; body = nxt[0].get("body", body)
    return items


def measure(item, res_geom):
    try:
        a = item["assets"]
        with rasterio.Env(**ENV):
            with rasterio.open(a["green"]["href"]) as g:
                crs = g.crs
                geom = transform_geom("EPSG:4326", crs, mapping(res_geom))
                buf = shape(geom).buffer(150)
                win = from_bounds(*buf.bounds, g.transform).round_offsets().round_lengths()
                green = g.read(1, window=win).astype(np.float32); tr = g.window_transform(win)
            with rasterio.open(a["nir"]["href"]) as n:
                nir = n.read(1, window=from_bounds(*buf.bounds, n.transform).round_offsets().round_lengths(), out_shape=green.shape).astype(np.float32)
            with rasterio.open(a["scl"]["href"]) as s:
                scl = s.read(1, window=from_bounds(*buf.bounds, s.transform).round_offsets().round_lengths(), out_shape=green.shape)
        inside = rasterize([(mapping(buf), 1)], out_shape=green.shape, transform=tr).astype(bool)
        if green[inside].max() == 0:
            return None                                         # outside swath / nodata
        bad = np.isin(scl, [0, 1, 3, 8, 9, 10, 11]) & inside
        if bad.sum() > 0.03 * inside.sum():
            return None                                         # clouds, shadow or snow/ice over the lake
        ndwi = (green - nir) / np.maximum(green + nir, 1)
        water = (ndwi > 0.0) & inside
        area_km2 = water.sum() * abs(tr.a * tr.e) / 1e6
        return {"date": item["properties"]["datetime"][:10], "area_km2": round(float(area_km2), 4),
                "cloud": item["properties"].get("eo:cloud_cover"), "id": item["id"]}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:120], "id": item["id"]}


def main():
    fc = json.loads((RAW / "studena_osm.geojson").read_text(encoding="utf-8"))
    res = shape(next(f for f in fc["features"] if f["properties"]["kind"] == "reservoir")["geometry"])
    items = search(list(res.bounds))
    print(f"{len(items)} Sentinel-2 scenes over the reservoir")
    with ThreadPoolExecutor(8) as ex:
        out = list(ex.map(lambda it: measure(it, res), items))
    ok = [o for o in out if o and "area_km2" in o]
    errs = [o for o in out if o and "error" in o]
    by_date = {}
    for o in ok:                                                # one value per day (overlapping tiles)
        by_date.setdefault(o["date"], []).append(o["area_km2"])
    series = [{"date": d, "area_km2": round(float(np.median(v)), 4)} for d, v in sorted(by_date.items())]
    (RAW / "studena_s2.json").write_text(json.dumps({"series": series, "scenes": len(items), "used": len(ok), "errors": len(errs),
                                                     "source": "Sentinel-2 L2A via Earth Search (AWS Open Data), NDWI > 0"}))
    a = [s["area_km2"] for s in series]
    print(f"clear observations: {len(series)} days (errors {len(errs)}); area {min(a):.3f}–{max(a):.3f} km²; OSM polygon {res.area * 111.32**2 * 0.736:.3f} km²")
    if errs: print("sample error:", errs[0])


if __name__ == "__main__":
    main()
