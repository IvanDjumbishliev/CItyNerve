"""HeatNerve: urban heat island screening from Landsat thermal data + space lidar.

Inputs (all fetched by the fetch_* scripts, nothing invented):
  work/heat/*.npz        Landsat 8/9 C2 L2 clear summer passes on the 28 m grid
  raw/landsat_heat.json  scene catalogue
  raw/gedi_l2a.npy       GEDI L2A shots: lon, lat, height above ground (m), time
  raw/atl08_canopy.npy   ICESat-2 ATL08 PhoREAL segments: lon, lat, h_canopy, time, veg/ground photons
  raw/power_heat_daily.json  NASA POWER daily T2M_MAX / T2M_MIN
  work/dem.npy, landcover.npy, built_frac.npy  SRTM + ESA WorldCover on the grid

Method
  1. Rural reference per pass: median surface temperature of vegetated, non-built
     cells within ±100 m of the city's median elevation (removes the lapse-rate
     cooling of Vitosha / Lyulin, which would otherwise exaggerate the island).
  2. Surface urban heat island (SUHI) = LST − rural reference, per pass and median.
  3. Drivers: Landsat NDVI (vegetation), albedo (how dark the surface is),
     WorldCover built-up share, lidar heights split into trees (green) vs roofs.
  4. City-own regression SUHI ~ NDVI + albedo + built → local cooling estimates.
  5. Hotspots: smoothed SUHI over built-up land, greedy pick with 800 m spacing,
     ranked by intensity, how often the place is hot, and built-up land affected.
"""
import json
import math
import time
from datetime import date, datetime, timezone

import numpy as np
from PIL import Image
from scipy import ndimage

from config import RAW, WORK, OUT, CITY, START_DATE, END_DATE, http_get

HEAT_OUT = OUT / "heat"
HEAT_OUT.mkdir(parents=True, exist_ok=True)
HOT_UHI = 6.0           # °C above the countryside: "hot" for frequency counting
TOP_N = 15
SPACING_M = 800
RADIUS_M = 250
VEG_CLASSES = (10, 20, 30, 40)   # WorldCover tree, shrub, grass, crop


def load_grid():
    g = json.loads((WORK / "grid.json").read_text())
    g["bounds"] = [[g["west"], g["north"]], [g["east"], g["north"]], [g["east"], g["south"]], [g["west"], g["south"]]]
    return g


def cell_lonlat(g):
    n = 2 ** g["zoom"]
    tx0, ty0 = g["tile_origin"]
    lon = (tx0 + (np.arange(g["cols"]) + 0.5) / 256) / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (ty0 + (np.arange(g["rows"]) + 0.5) / 256) / n))))
    return lon, lat


def lonlat_to_rc(g, lon, lat):
    n = 2 ** g["zoom"]
    tx0, ty0 = g["tile_origin"]
    x = ((np.asarray(lon) + 180) / 360 * n - tx0) * 256
    lr = np.radians(np.asarray(lat))
    y = ((1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / np.pi) / 2 * n - ty0) * 256
    return np.floor(y).astype(int), np.floor(x).astype(int)


def encode(arr, lo, scale):
    """uint8 PNG: 0 = no data, 1..255 = lo + (v-1)/scale."""
    v = np.where(np.isfinite(arr), np.clip(np.round((arr - lo) * scale) + 1, 1, 255), 0).astype(np.uint8)
    return Image.fromarray(v, "L")


def nan_smooth(a, sigma):
    m = np.isfinite(a)
    num = ndimage.gaussian_filter(np.where(m, a, 0), sigma)
    den = ndimage.gaussian_filter(m.astype(np.float32), sigma)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(den > 0.3, num / den, np.nan)


def disk(shape, r, c, radius_cells):
    rr, cc = np.ogrid[:shape[0], :shape[1]]
    return (rr - r) ** 2 + (cc - c) ** 2 <= radius_cells ** 2


def main():
    g = load_grid()
    R, C = g["rows"], g["cols"]
    cell = g["cell_m"]
    lon, lat = cell_lonlat(g)
    dem = np.load(WORK / "dem.npy")
    lc = np.load(WORK / "landcover.npy")
    built = np.load(WORK / "built_frac.npy")
    city_elev = float(np.median(dem[built > 0.5]))

    # ---------- 1–2. per-pass rural reference and SUHI ----------
    cat = load_catalogue()
    power = json.loads((RAW / "power_heat_daily.json").read_text())["properties"]["parameter"]
    rural_base = (built == 0) & np.isin(lc, VEG_CLASSES) & (np.abs(dem - city_elev) < 100)
    urban = built >= 0.5
    scenes, uhi_stack, lst_stack, ndvi_stack, alb_stack = [], [], [], [], []
    for m in cat:
        f = WORK / "heat" / f"{m['id']}.npz"
        if not f.exists():
            continue
        z = np.load(f)
        lst = z["lst"].astype(np.float32); ndvi = z["ndvi"].astype(np.float32); alb = z["alb"].astype(np.float32)
        rural = rural_base & np.isfinite(lst) & (ndvi > 0.3)
        if rural.sum() < 3000 or np.isfinite(lst[urban]).mean() < 0.6:
            print(f"{m['date']}: too little rural/urban coverage — skipped")
            continue
        ref = float(np.median(lst[rural]))
        uhi = lst - ref
        key = m["date"].replace("-", "")
        tmax = power["T2M_MAX"].get(key); tmin = power["T2M_MIN"].get(key)
        scenes.append({**m, "rural_ref_c": round(ref, 1),
                       "urban_lst_c": round(float(np.nanmedian(lst[urban])), 1),
                       "city_uhi_c": round(float(np.nanmedian(uhi[urban])), 2),
                       "hot_share": round(float(np.nanmean(uhi[urban] >= HOT_UHI)), 3),
                       "max_lst_c": round(float(np.nanpercentile(lst[urban], 99.5)), 1),
                       "air_tmax_c": round(tmax, 1) if tmax not in (None, -999) else None,
                       "air_tmin_c": round(tmin, 1) if tmin not in (None, -999) else None})
        uhi_stack.append(uhi); lst_stack.append(lst); ndvi_stack.append(ndvi); alb_stack.append(alb)
    if len(scenes) < 3:
        raise SystemExit("Fewer than 3 usable Landsat passes — run fetch_landsat_heat.py first")
    U = np.stack(uhi_stack); L = np.stack(lst_stack)
    with np.errstate(all="ignore"):
        n_valid = np.isfinite(U).sum(0)
        uhi = np.nanmedian(U, 0)
        lst = np.nanmedian(L, 0)
        lst_hot = np.nanpercentile(L, 90, axis=0)
        ndvi = np.nanmedian(np.stack(ndvi_stack), 0)
        alb = np.nanmedian(np.stack(alb_stack), 0)
        freq = np.where(n_valid > 0, (U >= HOT_UHI).sum(0) / np.maximum(n_valid, 1), np.nan)
    ok = n_valid >= 3
    for a in (uhi, lst, lst_hot, ndvi, alb, freq):
        a[~ok] = np.nan
    water = lc == 80
    print(f"{len(scenes)} passes · city median SUHI {np.nanmedian(uhi[urban]):.1f} °C · "
          f"p95 built {np.nanpercentile(uhi[urban], 95):.1f} °C · rural cells {rural_base.sum()}")

    # ---------- 3. lidar: what stands on the ground ----------
    def sample(a, rr, cc):
        inside = (rr >= 0) & (rr < R) & (cc >= 0) & (cc < C)
        out = np.full(len(rr), np.nan, np.float32)
        out[inside] = a[rr[inside], cc[inside]]
        return out, inside

    gedi = np.load(RAW / "gedi_l2a.npy") if (RAW / "gedi_l2a.npy").exists() else np.zeros((0, 4))
    atl = np.load(RAW / "atl08_canopy.npy") if (RAW / "atl08_canopy.npy").exists() else np.zeros((0, 6))
    gr, gc = lonlat_to_rc(g, gedi[:, 0], gedi[:, 1])
    g_ndvi, g_in = sample(ndvi, gr, gc)
    gedi, gr, gc, g_ndvi = gedi[g_in], gr[g_in], gc[g_in], g_ndvi[g_in]
    g_kind = np.where(gedi[:, 2] < 3, 0, np.where(g_ndvi >= 0.45, 1, np.where(g_ndvi < 0.3, 2, 3)))  # 0 low, 1 tree, 2 roof, 3 mixed
    ar, ac = lonlat_to_rc(g, atl[:, 0], atl[:, 1])
    _, a_in = sample(ndvi, ar, ac)
    atl, ar, ac = atl[a_in], ar[a_in], ac[a_in]
    # rasterise tree-shot share for the regression/city stats (GEDI only; dense 25 m shots)
    tree_hits = np.zeros((R, C), np.float32); all_hits = np.zeros((R, C), np.float32)
    np.add.at(tree_hits, (gr, gc), (g_kind == 1).astype(np.float32)); np.add.at(all_hits, (gr, gc), 1)
    print(f"lidar: GEDI {len(gedi)} shots ({(g_kind == 1).sum()} tree, {(g_kind == 2).sum()} roof) · ATL08 {len(atl)} segments")

    # ---------- 4. the city's own cooling relationships ----------
    sel = np.isfinite(uhi) & np.isfinite(ndvi) & np.isfinite(alb) & (built > 0.1) & ~water
    idx = np.flatnonzero(sel.ravel())
    rng = np.random.default_rng(7)
    idx = rng.choice(idx, min(80000, len(idx)), replace=False)
    X = np.column_stack([np.ones(len(idx)), ndvi.ravel()[idx], alb.ravel()[idx], built.ravel()[idx]])
    y = uhi.ravel()[idx]
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    r2 = 1 - np.sum((y - X @ beta) ** 2) / np.sum((y - y.mean()) ** 2)
    reg = {"intercept": round(float(beta[0]), 2), "ndvi": round(float(beta[1]), 2), "albedo": round(float(beta[2]), 2),
           "built": round(float(beta[3]), 2), "r2": round(float(r2), 3), "cells": int(len(idx))}
    print("regression SUHI ~ NDVI + albedo + built:", reg)
    # GEDI: SUHI of urban cells with trees vs without
    gu = uhi[gr, gc]; gb = built[gr, gc]
    m_urb = (gb >= 0.3) & np.isfinite(gu)
    tree_cool = float(np.nanmedian(gu[m_urb & (g_kind != 1)]) - np.nanmedian(gu[m_urb & (g_kind == 1)])) if m_urb.any() else None

    # ---------- 5. hotspots ----------
    sm = nan_smooth(np.where(water, np.nan, uhi), sigma=3)
    cand = np.where((built >= 0.35) & np.isfinite(sm), sm, -np.inf)
    order = np.argsort(cand.ravel())[::-1]
    picks = []
    sp_cells = SPACING_M / cell
    for i in order:
        if not np.isfinite(cand.flat[i]) or len(picks) >= TOP_N * 2:
            break
        r, c = divmod(int(i), C)
        if all((r - pr) ** 2 + (c - pc) ** 2 > sp_cells ** 2 for pr, pc in picks):
            picks.append((r, c))
    rad = RADIUS_M / cell
    alb_p25 = float(np.nanpercentile(alb[urban], 25))
    rows = []
    for r, c in picks:
        d = disk((R, C), r, c, rad) & ~water
        bh = d & (built >= 0.35)
        u = uhi[d]
        gm = ((gr - r) ** 2 + (gc - c) ** 2) <= (rad * 1.2) ** 2
        am = ((ar - r) ** 2 + (ac - c) ** 2) <= (rad * 1.6) ** 2
        k = g_kind[gm]
        tall = k[k > 0]
        rows.append({
            "r": r, "c": c, "lon": float(lon[c]), "lat": float(lat[r]),
            "uhi": float(np.nanmean(u)), "uhi_peak": float(np.nanpercentile(u[np.isfinite(u)], 95)),
            "lst": float(np.nanmean(lst[d])), "lst_hot": float(np.nanmean(lst_hot[d])),
            "freq": float(np.nanmean(freq[bh])) if bh.any() else float(np.nanmean(freq[d])),
            "ndvi": float(np.nanmean(ndvi[d])), "alb": float(np.nanmean(alb[d])), "built": float(np.mean(built[d])),
            "hot_built_ha": float(((uhi >= HOT_UHI) & d).sum() * cell * cell * np.mean(built[d]) / 1e4),
            "gedi_n": int(gm.sum()), "tree_share": float((k == 1).mean()) if len(k) else None,
            "roof_h": float(np.median(gedi[gm][k == 2, 2])) if (k == 2).sum() >= 3 else None,
            "tall_n": int(len(tall)),
            "atl_n": int(am.sum()), "atl_canopy": float(np.median(atl[am, 2])) if am.sum() >= 3 else None,
        })
    def norm(v, lo, hi):
        return max(0.0, min(1.0, (v - lo) / (hi - lo)))
    for h in rows:
        h["score"] = round(100 * (0.5 * norm(h["uhi"], 3, 13) + 0.25 * norm(h["freq"], 0.2, 1.0) + 0.25 * norm(h["hot_built_ha"], 2, 15)))
    rows.sort(key=lambda h: -h["score"])
    rows = rows[:TOP_N]

    geo = load_cache()
    hotspots = []
    city_ndvi = float(np.nanmedian(ndvi[urban])); city_alb = float(np.nanmedian(alb[urban]))
    for i, h in enumerate(rows):
        name, district, place = reverse_geocode(h["lat"], h["lon"], geo)
        cause = classify(h, place, alb_p25)
        h.update(cause=cause, place_kind=place)
        acts = actions(h, reg)
        hotspots.append({
            "id": f"UH-{i + 1:02d}", "name": name, "district": district, "place_kind": place,
            "coord": [round(h["lon"], 5), round(h["lat"], 5)], "score": h["score"], "cause": cause,
            "uhi_c": round(h["uhi"], 1), "uhi_peak_c": round(h["uhi_peak"], 1),
            "lst_c": round(h["lst"], 1), "lst_hot_c": round(h["lst_hot"], 1),
            "hot_share": round(h["freq"], 2), "ndvi": round(h["ndvi"], 2), "albedo": round(h["alb"], 3),
            "built_share": round(h["built"], 2), "hot_built_ha": round(h["hot_built_ha"], 1),
            "lidar": {"gedi_shots": h["gedi_n"], "tree_share": None if h["tree_share"] is None else round(h["tree_share"], 2),
                      "roof_height_m": None if h["roof_h"] is None else round(h["roof_h"], 1),
                      "atl08_segments": h["atl_n"], "atl08_canopy_m": None if h["atl_canopy"] is None else round(h["atl_canopy"], 1)},
            "problems": problems(h, city_ndvi, city_alb, len(scenes)),
            "actions": acts,
        })
    save_cache(geo)

    # ---------- outputs ----------
    encode(uhi, -10, 8).save(HEAT_OUT / "suhi_median.png", optimize=True)
    encode(ndvi, -0.2, 210).save(HEAT_OUT / "ndvi.png", optimize=True)
    enc_scenes = sorted(scenes, key=lambda s: -s["clear_share"])
    keep_ids = {s["id"] for s in enc_scenes if s["clear_share"] >= 0.9}
    out_scenes = []
    for s, u in zip(scenes, uhi_stack):
        if s["id"] in keep_ids:
            s["png"] = f"heat/pass_{s['date']}_{s['platform'][-1]}.png"
            encode(np.where(water, np.nan, u), -10, 8).save(OUT / s["png"], optimize=True)
        out_scenes.append(s)
    lidar_geojson(gedi, g_kind, atl, built[ar, ac] >= 0.3)
    days = sorted(power["T2M_MAX"])
    daily = [[f"{d[:4]}-{d[4:6]}-{d[6:]}", power["T2M_MAX"][d], power["T2M_MIN"][d]] for d in days if power["T2M_MAX"][d] != -999]
    waves = heatwaves(daily)
    summary = {
        "generated": datetime.now(timezone.utc).astimezone().isoformat(timespec="minutes"),
        "city": CITY, "period": {"start": START_DATE.isoformat(), "end": END_DATE.isoformat()},
        "grid": {"rows": R, "cols": C, "cell_m": round(cell, 1), "bounds": g["bounds"]},
        "encoding": {"suhi": {"lo": -10, "scale": 8}, "ndvi": {"lo": -0.2, "scale": 210}},
        "rasters": {"suhi": "heat/suhi_median.png", "ndvi": "heat/ndvi.png", "lidar": "heat/lidar.geojson"},
        "city_elev_m": round(city_elev), "hot_threshold_c": HOT_UHI,
        "composite": {
            "passes": len(scenes), "city_uhi_c": round(float(np.nanmedian(uhi[urban])), 1),
            "p95_uhi_c": round(float(np.nanpercentile(uhi[urban], 95)), 1),
            "max_uhi_c": round(float(np.nanmax(sm[urban])), 1),
            "hot_built_km2": round(float(((uhi >= HOT_UHI) & urban).sum() * cell * cell / 1e6), 1),
            "urban_lst_c": round(float(np.nanmedian(lst[urban])), 1),
            "rural_ref_c": round(float(np.median([s["rural_ref_c"] for s in scenes])), 1),
            "urban_ndvi": round(city_ndvi, 2), "urban_albedo": round(city_alb, 3),
            "urban_km2": round(float(urban.sum() * cell * cell / 1e6), 1),
        },
        "regression": reg,
        "lidar": {"gedi_shots": int(len(gedi)), "gedi_tree": int((g_kind == 1).sum()), "gedi_roof": int((g_kind == 2).sum()),
                  "gedi_first": iso(gedi[:, 3].min()) if len(gedi) else None, "gedi_last": iso(gedi[:, 3].max()) if len(gedi) else None,
                  "atl08_segments": int(len(atl)), "atl08_first": iso(atl[:, 3].min()) if len(atl) else None,
                  "atl08_last": iso(atl[:, 3].max()) if len(atl) else None,
                  "tree_cooling_c": None if tree_cool is None else round(tree_cool, 1)},
        "air": {"source": "NASA POWER daily (MERRA-2) T2M_MAX / T2M_MIN at the city centre",
                "hot_days": sum(1 for d in daily if d[1] >= 30), "very_hot_days": sum(1 for d in daily if d[1] >= 35),
                "tropical_nights": sum(1 for d in daily if d[2] >= 20), "max_c": round(max(d[1] for d in daily), 1),
                "max_day": max(daily, key=lambda d: d[1])[0], "heatwaves": waves, "daily": daily},
        "scenes": out_scenes,
    }
    (HEAT_OUT / "summary.json").write_text(json.dumps(summary, separators=(",", ":")), encoding="utf-8")
    (HEAT_OUT / "hotspots.json").write_text(json.dumps(hotspots, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(hotspots)} hotspots, {sum(1 for s in out_scenes if s.get('png'))} pass rasters → {HEAT_OUT}")
    for h in hotspots:
        print(f"  {h['id']} {h['score']:3d} {h['uhi_c']:5.1f}°C {h['cause']:14s} {h['name']} · {h['district']} ({h['place_kind']})")


def load_catalogue():
    """Scene list from fetch_landsat_heat.py; falls back to the cached scene files (partial download)."""
    f = RAW / "landsat_heat.json"
    if f.exists():
        return json.loads(f.read_text())["scenes"]
    out = []
    for p in sorted((WORK / "heat").glob("L*.npz")):
        sid = p.stem
        d = sid.split("_")[3]
        out.append({"id": sid, "date": f"{d[:4]}-{d[4:6]}-{d[6:]}", "time_utc": "09:10", "platform": f"landsat-{int(sid[2:4])}",
                    "path_row": f"{sid.split('_')[2][:3]}/{sid.split('_')[2][3:]}", "clear_share": float(np.load(p)["clear"].mean())})
    return out


def iso(t):
    return datetime.fromtimestamp(float(t), timezone.utc).date().isoformat()


def heatwaves(daily, thr=30.0, min_len=3):
    out, run = [], []
    for d in daily + [["", -99, -99]]:
        if d[1] >= thr:
            run.append(d)
        else:
            if len(run) >= min_len:
                out.append({"start": run[0][0], "end": run[-1][0], "days": len(run),
                            "peak_c": max(x[1] for x in run), "warmest_night_c": max(x[2] for x in run)})
            run = []
    return out


def lidar_geojson(gedi, kind, atl, atl_urban):
    """Map sample: GEDI tree/roof shots + ICESat-2 canopy segments over built-up land (kept small for the web)."""
    rng = np.random.default_rng(3)
    names = {1: "tree", 2: "roof", 3: "mixed"}
    gi = np.flatnonzero(kind > 0)
    gi = rng.choice(gi, min(9000, len(gi)), replace=False) if len(gi) else gi
    ai = np.flatnonzero(atl_urban & (atl[:, 2] >= 3))
    ai = rng.choice(ai, min(4000, len(ai)), replace=False) if len(ai) else ai
    feats = [{"type": "Feature", "properties": {"h": round(float(gedi[i, 2]), 1), "k": names[int(kind[i])], "s": "GEDI"},
              "geometry": {"type": "Point", "coordinates": [round(float(gedi[i, 0]), 5), round(float(gedi[i, 1]), 5)]}} for i in gi]
    feats += [{"type": "Feature", "properties": {"h": round(float(atl[i, 2]), 1), "k": "canopy", "s": "ICESat-2"},
               "geometry": {"type": "Point", "coordinates": [round(float(atl[i, 0]), 5), round(float(atl[i, 1]), 5)]}} for i in ai]
    (HEAT_OUT / "lidar.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")


# ---------- interpretation ----------
INDUSTRIAL = {"industrial", "retail", "commercial", "warehouse", "parking", "construction", "railway", "brownfield", "airport"}
PLACE_TEXT = {"industrial": "industrial land", "commercial": "commercial land", "retail": "retail land (malls, big-box stores)",
              "railway": "railway land", "construction": "a construction site", "brownfield": "brownfield", "parking": "parking", "airport": "airport land"}


def classify(h, place, alb_p25):
    if h["built"] < 0.4 and h["ndvi"] < 0.3:
        return "bare_ground"
    if place in INDUSTRIAL or (h["roof_h"] is not None and h["roof_h"] < 12 and h["built"] >= 0.6 and h["ndvi"] < 0.2):
        return "large_roofs"
    if h["alb"] <= alb_p25:
        return "dark_surfaces"
    return "no_shade"


def problems(h, city_ndvi, city_alb, n):
    p = [f"Surface runs {h['uhi']:.1f} °C hotter than the surrounding countryside at midday, "
         f"{h['lst_hot']:.0f} °C on the hottest 10% of passes."]
    if h.get("place_kind") in PLACE_TEXT:
        p.append(f"OpenStreetMap maps this as {PLACE_TEXT[h['place_kind']]}: wide roofs, yards and paved lots with little shade.")
    p.append(f"Above +{HOT_UHI:.0f} °C on {round(h['freq'] * 100)}% of {n} clear summer Landsat passes, so this is a persistent problem, not a single hot day.")
    if h["tree_share"] is not None and h["tall_n"] >= 5:
        p.append(f"GEDI lidar: only {round(h['tree_share'] * 100)}% of {h['gedi_n']} laser shots here hit tree canopy"
                 + (f"; roofs stand ≈{h['roof_h']:.0f} m tall." if h["roof_h"] is not None else "."))
    if h["ndvi"] < city_ndvi:
        p.append(f"Vegetation index {h['ndvi']:.2f} is below the city's built-up median ({city_ndvi:.2f}).")
    if h["alb"] < city_alb:
        p.append(f"Surfaces reflect only {h['alb'] * 100:.0f}% of sunlight (city median {city_alb * 100:.0f}%): dark asphalt and roofing absorb the rest.")
    return p


def actions(h, reg):
    """Concrete measures with cooling estimated from Sofia's own satellite data (association, not a guarantee)."""
    b_ndvi, b_alb = reg["ndvi"], reg["albedo"]
    green = max(0.0, -b_ndvi * min(0.15, max(0.05, 0.6 - h["ndvi"])))       # street trees: NDVI +0.15 at most
    regreen = max(0.0, -b_ndvi * min(0.25, max(0.05, 0.6 - h["ndvi"])))     # bare land turned to irrigated green
    cool = max(0.0, -b_alb * min(0.10, max(0.0, 0.30 - h["alb"])))           # raise albedo by up to 0.10
    out = []
    if h["cause"] == "bare_ground":
        out.append({"title": "Green the open ground", "detail": "Replace dry, compacted or sealed open land with irrigated meadow, tree belts on the edges and permeable surfaces; depave unused tarmac.", "cooling_c": round(regreen, 1), "lever": "vegetation"})
    if h["cause"] == "large_roofs":
        out.append({"title": "Cool or green roofs on large buildings", "detail": "Reflective (white) membranes or extensive green roofs on warehouses, malls and halls; pair with rooftop solar.", "cooling_c": round(cool, 1), "lever": "albedo"})
        out.append({"title": "Shade car parks", "detail": "Tree rows every 4–5 bays or solar carports over open parking; permeable paving.", "cooling_c": round(green * 0.6, 1), "lever": "vegetation"})
    if h["cause"] == "dark_surfaces":
        out.append({"title": "Cool pavements and light roofs", "detail": "High-albedo coatings on asphalt squares, sidewalks and flat roofs during scheduled resurfacing.", "cooling_c": round(cool, 1), "lever": "albedo"})
    if h["cause"] in ("no_shade", "dark_surfaces", "large_roofs"):
        out.append({"title": "Plant street trees and pocket parks", "detail": "Continuous canopy along streets and in courtyards; trees shade pavement and cool by evaporation.", "cooling_c": round(green, 1), "lever": "vegetation"})
    out.append({"title": "Heat-health protection", "detail": "Drinking fountains, shaded bus stops, cooling centres and check-ins for elderly residents during NASA POWER-recorded heatwaves (≥3 days ≥30 °C).", "cooling_c": None, "lever": "people"})
    return out


# ---------- naming ----------
def load_cache():
    f = RAW / "heat_geocode.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def save_cache(c):
    (RAW / "heat_geocode.json").write_text(json.dumps(c, ensure_ascii=False, indent=1), encoding="utf-8")


BG = dict(zip("абвгдежзийклмнопрстуфхцчшщъьюяАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ",
              ["a","b","v","g","d","e","zh","z","i","y","k","l","m","n","o","p","r","s","t","u","f","h","ts","ch","sh","sht","a","y","yu","ya",
               "A","B","V","G","D","E","Zh","Z","I","Y","K","L","M","N","O","P","R","S","T","U","F","H","Ts","Ch","Sh","Sht","A","Y","Yu","Ya"]))
ZONE = {"НПЗ": "industrial zone", "СПЗ": "industrial zone", "ПЗ": "industrial zone", "SPZ": "industrial zone", "NPZ": "industrial zone"}


def latin(text):
    """Bulgarian streamlined transliteration; expands industrial-zone abbreviations (НПЗ/СПЗ)."""
    if not text:
        return text
    parts = text.split(" ", 1)
    if parts[0] in ZONE and len(parts) == 2:
        return f"{latin(parts[1])} {ZONE[parts[0]]}"
    return "".join(BG.get(ch, ch) for ch in text)


LANDUSE_KIND = {"industrial": "industrial", "commercial": "commercial", "retail": "retail", "railway": "railway",
                "construction": "construction", "brownfield": "brownfield", "garages": "parking"}


OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter"]


def landuse_at(lat, lon, cache):
    """OSM areas containing the point (Overpass is_in): land use, airport, parking, with names.
    Optional: public Overpass servers are often at capacity, so one quick try per mirror and,
    after a total failure, no more attempts this run (failures are not cached)."""
    import requests
    key = f"{lat:.4f},{lon:.4f}"
    if key in cache:
        return cache[key]
    if not OVERPASS:
        return []
    q = (f"[out:json][timeout:20];is_in({lat},{lon})->.a;"
         "(area.a[landuse];area.a[aeroway];area.a[amenity=parking];area.a[industrial];);out tags;")
    for ep in OVERPASS:
        try:
            r = requests.get(ep, params={"data": q}, headers={"User-Agent": "FloodNerve-hackathon-prototype/0.1"}, timeout=25)
            r.raise_for_status()
            cache[key] = [e.get("tags", {}) for e in r.json().get("elements", [])]
            return cache[key]
        except Exception:  # noqa: BLE001
            continue
    print("  Overpass unavailable — land use from Nominatim district names only", flush=True)
    OVERPASS.clear()
    return []


def reverse_geocode(lat, lon, cache):
    key = f"{lat:.4f},{lon:.4f}"
    if key not in cache:
        try:
            time.sleep(1.1)  # Nominatim policy: ≤1 request/s
            r = http_get("https://nominatim.openstreetmap.org/reverse",
                         params={"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 17, "accept-language": "en"}, timeout=30)
            j = r.json()
            cache[key] = {"address": j.get("address", {}), "name": j.get("name"), "category": j.get("category"), "type": j.get("type")}
        except Exception:  # noqa: BLE001
            cache[key] = {"address": {}}
    e = cache[key]
    a = e.get("address", {})
    areas = landuse_at(lat, lon, cache.setdefault("_landuse", {}))
    place, area_name = None, None
    for t in areas:
        kind = ("airport" if t.get("aeroway") in ("aerodrome", "apron", "terminal") else
                "parking" if t.get("amenity") == "parking" else LANDUSE_KIND.get(t.get("landuse")) or
                ("industrial" if t.get("industrial") else None))
        if kind and not place:
            place = kind
        if kind and not area_name:
            area_name = t.get("name:en") or t.get("name")
    district = latin(a.get("suburb") or a.get("quarter") or a.get("city_district") or a.get("neighbourhood")
                     or a.get("hamlet") or a.get("village") or CITY)
    district = district.lstrip(". ,") or CITY
    if not place and ("industrial zone" in district or a.get("industrial")):
        place = "industrial"
    road = e.get("name") or a.get("road") or a.get("pedestrian") or a.get("square")
    zone = a.get("industrial") or a.get("retail") or a.get("commercial") or area_name
    if road:
        name = latin(road)
    elif zone:
        name = latin(zone)
    else:
        name = {"industrial": "Industrial yards", "airport": "Airport apron & runways", "parking": "Car park",
                "railway": "Railway yard", "retail": "Retail park", "commercial": "Commercial block"}.get(place, "Built-up block")
    return name, district, place


if __name__ == "__main__":
    main()
