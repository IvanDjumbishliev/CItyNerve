"""Prepare the Studena dam-break scenario for the in-browser 2D flood simulation.

Real inputs: SRTM terrain, OSM dam + reservoir outline, ESA built-up share,
Sentinel-2 water area (2021–2026), published dam facts (55 m high, 25.2 Mm³).

Steps:
  1. Rasterise reservoir and dam wall onto the 28 m grid.
  2. Full-supply level (FSL) = shoreline elevation from the DEM; SRTM only sees
     the water surface, so the bed is synthesised: deepest at the wall
     (wall height 55 m), shallow at the shore, scaled so volume at FSL = 25.2 Mm³.
  3. Sentinel-2 area → water level → stored volume for every clear date.
  4. Breach parameters from Froehlich (2008) and reference peak outflow
     from Froehlich (1995) — standard dam-break screening equations.
Output: public/data/pernik/{terrain.bin, masks.bin, pernik.json, studena.geojson}
"""
import json, math, os
import numpy as np
from scipy import ndimage
import shapely
from shapely.geometry import shape
from config import RAW, WORK, OUT

DAM_HEIGHT = 55.0          # m (Freyssinet case study)
CAPACITY = 25.2e6          # m³ (BTA / ВиК Перник)
PERNIK = (23.035, 42.605)  # city centre
PERNIK_BOX = (22.99, 42.575, 23.10, 42.625)
G = 9.81

out_dir = OUT / "pernik"; out_dir.mkdir(exist_ok=True)
grid = json.loads((WORK / "pernik_grid.json").read_text())
R, C, CELL = grid["rows"], grid["cols"], grid["cell_m"]
A = CELL * CELL
TX0, TY0 = grid["tile_origin"]; NT = 2 ** grid["zoom"]
dem = np.load(WORK / "pernik_dem.npy").astype(np.float64)
built = np.load(WORK / "pernik_built.npy")


def centres():
    lon = (TX0 + (np.arange(C) + 0.5) / 256) / NT * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (TY0 + (np.arange(R) + 0.5) / 256) / NT))))
    return np.meshgrid(lon, lat)


def to_rc(lon, lat):
    x = (lon + 180) / 360 * NT
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * NT
    return int((y - TY0) * 256), int((x - TX0) * 256)


def main():
    fc = json.loads((RAW / "studena_osm.geojson").read_text(encoding="utf-8"))
    res_geom = shape(next(f for f in fc["features"] if f["properties"]["kind"] == "reservoir")["geometry"])
    dam_lines = [shape(f["geometry"]) for f in fc["features"] if f["properties"]["kind"] == "dam"]
    LON, LAT = centres()
    res = shapely.contains_xy(res_geom, LON, LAT)
    res = ndimage.binary_fill_holes(res)

    # dam wall cells: sample the OSM line every 5 m
    dam = np.zeros((R, C), bool)
    for ln in dam_lines:
        L = ln.length * 111320 * 0.736
        for t in np.linspace(0, 1, max(2, int(L / 5))):
            p = ln.interpolate(t, normalized=True)
            r, c = to_rc(p.x, p.y)
            if 0 <= r < R and 0 <= c < C:
                dam[r, c] = True
    dam = ndimage.binary_dilation(dam, iterations=1) & ~res
    dam_len = max(ln.length for ln in dam_lines) * 111320 * 0.736

    ring = ndimage.binary_dilation(res, iterations=2) & ~res & ~dam
    fsl = float(np.percentile(dem[ring], 15))               # shoreline elevation ≈ full-supply level
    crest = max(float(dem[dam].max()), fsl + 2.0)
    bed_at_dam = crest - DAM_HEIGHT
    dmax = fsl - bed_at_dam

    # synthetic bathymetry: depth ∝ distance-from-shore × proximity-to-wall, volume = capacity
    d_shore = ndimage.distance_transform_edt(res); d_shore /= d_shore.max()
    dam_dist = ndimage.distance_transform_edt(~dam); dd = np.where(res, dam_dist, np.nan)
    prox = 1 - (dam_dist - np.nanmin(dd)) / (np.nanmax(dd) - np.nanmin(dd))
    s = np.where(res, np.clip(d_shore, 0, 1) ** 0.6 * (0.25 + 0.75 * np.clip(prox, 0, 1)), 0)
    s /= s[res].max()
    lo, hi = 0.05, 8.0
    for _ in range(60):
        a = (lo + hi) / 2
        vol = (dmax * s[res] ** a).sum() * A
        lo, hi = (a, hi) if vol > CAPACITY else (lo, a)
    depth = np.where(res, dmax * s ** a, 0)
    bed = np.where(res, fsl - depth, dem)
    area_full = res.sum() * A

    # hypsometry: level → (area, volume)
    levels = np.linspace(bed[res].min(), fsl, 400)
    areas = np.array([(bed[res] < L).sum() * A for L in levels])
    vols = np.array([np.maximum(0, L - bed[res]).sum() * A for L in levels])

    # Sentinel-2 observed area → (calibrated to official МОСВ volumes) → volume → level
    s2 = json.loads((RAW / os.environ.get("S2_FILE", "studena_s2.json")).read_text())
    raw_series = s2["series"]
    a_all = np.array([x["area_km2"] for x in raw_series])
    keep = np.ones(len(a_all), bool)                         # drop outliers (ice, cloud edges, swath gaps)
    for i in range(len(a_all)):
        nb = a_all[max(0, i - 3):i + 4]
        keep[i] = abs(a_all[i] - np.median(nb)) <= 0.25 * np.median(nb)
    s2s = [x for x, k in zip(raw_series, keep) if k]
    days = np.array([np.datetime64(x["date"]).astype("datetime64[D]").astype(int) for x in s2s])
    area_s2 = np.array([x["area_km2"] for x in s2s])

    official = []
    off_file = RAW / "studena_official.json"
    if off_file.exists():
        for o in json.loads(off_file.read_text(encoding="utf-8")):
            if not o.get("ref_date"):
                continue
            d = np.datetime64(o["ref_date"]).astype("datetime64[D]").astype(int)
            near = np.abs(days - d).min()
            if near <= 20:
                official.append({**o, "s2_area": float(np.interp(d, days, area_s2))})
    if len(official) >= 3:
        Aa = np.array([o["s2_area"] for o in official]); Vv = np.array([o["total_mm3"] for o in official])
        b, la = np.polyfit(np.log(Aa), np.log(Vv), 1)        # V = a · A^b
        fit = lambda A: np.exp(la) * np.power(A, b)
        resid = Vv - fit(Aa)
        calib = {"method": "V = a·A^b fitted to official volumes", "a": round(float(np.exp(la)), 3), "b": round(float(b), 3),
                 "points": len(official), "rmse_mm3": round(float(np.sqrt(np.mean(resid ** 2))), 2)}
    else:
        ref = np.percentile(area_s2, 98)
        fit = lambda A: np.interp(np.interp(np.minimum(1, A / ref) * area_full, areas, levels), levels, vols) / 1e6
        calib = {"method": "uncalibrated (synthetic bathymetry)", "points": len(official)}

    series = []
    for x in s2s:
        V = float(np.clip(fit(x["area_km2"]), 0.5, CAPACITY / 1e6)) * 1e6
        L = float(np.interp(V, vols, levels))
        series.append({"date": x["date"], "area_km2": x["area_km2"], "level_m": round(L, 2),
                       "volume_mm3": round(V / 1e6, 2), "fill_pct": round(100 * V / CAPACITY, 1)})
    official_out = [{"date": o["ref_date"], "volume_mm3": o["total_mm3"], "fill_pct": round(100 * o["total_mm3"] / (CAPACITY / 1e6), 1),
                     "source": o["bulletin"]} for o in official]
    print("calibration:", calib, f"(S2 dates kept {len(s2s)} of {len(raw_series)})")

    # breach (Froehlich 2008) and reference peak outflow (Froehlich 1995), at full volume
    Hw = fsl - bed_at_dam
    B = 0.27 * 1.0 * CAPACITY ** 0.32 * DAM_HEIGHT ** 0.04
    tf = 63.2 * math.sqrt(CAPACITY / (G * DAM_HEIGHT ** 2))
    qp_ref = 0.607 * CAPACITY ** 0.295 * Hw ** 1.24
    # breach cells: the part of the wall above the lowest downstream ground, centred on the deepest point
    down = ndimage.binary_dilation(dam, iterations=3) & ~dam & ~res
    toe = float(np.percentile(dem[down], 5))
    rr, cc = np.nonzero(dam)
    near = ndimage.binary_dilation(res, iterations=2)
    dam_cells = [(r, c) for r, c in zip(rr, cc)]
    deepest = min(dam_cells, key=lambda rc: dem[rc] + (0 if near[rc] else 50))
    breach = np.zeros((R, C), bool)
    for r, c in dam_cells:
        if math.hypot(r - deepest[0], c - deepest[1]) * CELL <= B / 2 + CELL:
            breach[r, c] = True

    # terrain for the solver: reservoir bed carved, wall at crest
    z = bed.copy(); z[dam] = crest
    np.asarray(z, np.float32).tofile(out_dir / "terrain.bin")
    masks = (res.astype(np.uint8) | (dam.astype(np.uint8) << 1) | (breach.astype(np.uint8) << 2))
    np.asarray(masks, np.uint8).tofile(out_dir / "masks.bin")
    np.asarray(np.clip(built * 255, 0, 255), np.uint8).tofile(out_dir / "built.bin")

    pr0, pc0 = to_rc(PERNIK_BOX[0], PERNIK_BOX[3]); pr1, pc1 = to_rc(PERNIK_BOX[2], PERNIK_BOX[1])
    dam_c = dam_lines[0].centroid
    meta = {
        "grid": {"rows": R, "cols": C, "cell_m": round(CELL, 2),
                 "bounds": [[grid["west"], grid["north"]], [grid["east"], grid["north"]], [grid["east"], grid["south"]], [grid["west"], grid["south"]]]},
        "dam": {"name": "Studena", "name_bg": "яз. Студена", "coord": [round(dam_c.x, 5), round(dam_c.y, 5)],
                "height_m": DAM_HEIGHT, "capacity_mm3": CAPACITY / 1e6, "in_service": 1953, "river": "Struma",
                "crest_m": round(crest, 1), "fsl_m": round(fsl, 1), "bed_at_dam_m": round(bed_at_dam, 1), "toe_m": round(toe, 1),
                "length_m": round(dam_len), "breach_width_m": round(B), "breach_time_s": round(tf), "breach_cells": int(breach.sum()),
                "qp_froehlich_m3s": round(qp_ref), "area_full_km2": round(area_full / 1e6, 3)},
        "pernik": {"coord": PERNIK, "box_rc": [min(pr0, pr1), min(pc0, pc1), max(pr0, pr1), max(pc0, pc1)]},
        "levels": series,
        "official": official_out,
        "calibration": calib,
        "sources": {"terrain": "SRTM 1\" via AWS Terrain Tiles", "outline": "OpenStreetMap ways 25236640, 242807133",
                    "levels": s2["source"] + "; calibrated to МОСВ monthly bulletins", "facts": "Freyssinet (height 55 m), BTA/ВиК Перник (25.2 Mm³)",
                    "method": "Breach: Froehlich 2008; reference Qp: Froehlich 1995; solver: local-inertial 2D (Bates 2010)"},
    }
    (out_dir / "pernik.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
    (out_dir / "studena.geojson").write_text(json.dumps(fc, ensure_ascii=False))
    print(f"reservoir {area_full/1e6:.2f} km², FSL {fsl:.1f} m, crest {crest:.1f}, bed@dam {bed_at_dam:.1f}, toe {toe:.1f}, "
          f"bathymetry exponent {a:.2f}, dam length {dam_len:.0f} m")
    print(f"breach {B:.0f} m ({breach.sum()} cells), formation {tf/60:.0f} min, reference Qp {qp_ref:.0f} m³/s")
    f = [x["fill_pct"] for x in series]
    print(f"levels: {len(series)} dates, fill {min(f):.0f}–{max(f):.0f}%  first {series[0]}  last {series[-1]}")


if __name__ == "__main__":
    main()
