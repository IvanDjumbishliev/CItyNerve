"""FloodNerve Sofia — flood screening model on real NASA inputs.

Inputs (all real, downloaded by the fetch_*.py scripts):
  • Terrain: SRTM 1" (NASA/NGA) via AWS Terrain Tiles, ≈28 m grid
  • Lidar:   NASA ICESat-2 ground heights (ATL03 → ATL06-SR, ATL08 ground class) via SlideRule
  • Rain:    NASA POWER hourly precipitation (MERRA-2), 5 years
  • Soil:    NASA POWER hourly surface soil wetness (MERRA-2)
  • Land:    ESA WorldCover 10 m (built-up / vegetation / water)

Method (a screening model, deliberately transparent — NOT a full 2D hydrodynamic run):
  1. Lidar correction: regress ICESat-2 − SRTM on built-up and tree cover to remove
     SRTM's roof/canopy bias; report vertical accuracy before/after.
  2. Hydrology: priority-flood depression filling (+ε), D8 flow, flow accumulation,
     stream network (≥1 km² upstream), HAND (height above nearest drainage).
  3. Storm events: split the NASA hourly record into events; keep the largest.
  4. Runoff: SCS Curve Number per cell from land cover, adjusted for antecedent
     soil wetness on the event day.
  5. River overflow: event peak discharge (triangular hydrograph) → Manning stage,
     minus bankfull stage (median annual-max storm) → overbank depth via HAND.
  6. Ponding: runoff exceeding assumed sewer capacity fills terrain depressions
     (volume-limited water level per depression).
  7. Duration, 5-year maximum, frequency and ranked hotspots.
"""
import heapq, json, math, time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import numpy as np
from PIL import Image
from scipy import ndimage
from config import WORK, RAW, OUT, START_DATE, END_DATE, CITY, http_get

SOFIA_TZ = ZoneInfo("Europe/Sofia")
# ── tunable assumptions (documented in the UI) ──
STREAM_KM2 = 1.0          # upstream area that starts a drainage line (for HAND)
RIVER_KM2 = 10.0          # only channels this large overflow (small gullies are piped in Sofia)
MAP_STREAM_KM2 = 3.0      # streams drawn on the map
SEWER_MM_H = 6.0          # assumed storm-sewer capacity on built-up land (mm/h over catchment)
DITCH_MM_H = 1.5          # ditches / culverts on non-built catchment (mm/h)
MANNING_N = 0.035
MIN_DEPTH = 0.10          # depth shown as flooded (m)
N_EVENTS = 8
EVENT_MIN_MM = 12.0
N_REAL = 20               # stochastic DEM realisations
DEP_PROB = 0.6            # keep depressions present in ≥60% of realisations


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ───────────────────────── grid helpers ─────────────────────────
grid = json.loads((WORK / "grid.json").read_text())
R, C = grid["rows"], grid["cols"]
CELL = grid["cell_m"]
CELL_A = CELL * CELL
TX0, TY0 = grid["tile_origin"]
NT = 2 ** grid["zoom"]


def rc_to_lonlat(r, c):
    x = TX0 + (np.asarray(c) + 0.5) / 256
    y = TY0 + (np.asarray(r) + 0.5) / 256
    lon = x / NT * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y / NT))))
    return lon, lat


def lonlat_to_rc(lon, lat):
    x = (np.asarray(lon) + 180) / 360 * NT
    y = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * NT
    return (y - TY0) * 256 - 0.5, (x - TX0) * 256 - 0.5


# ───────────────────────── 1. lidar correction ─────────────────────────
def lidar_correct(dem, built, tree):
    pts = np.load(RAW / "icesat2_ground.npy")
    r, c = lonlat_to_rc(pts[:, 0], pts[:, 1])
    inside = (r >= 0) & (r < R - 1) & (c >= 0) & (c < C - 1)
    pts, r, c = pts[inside], r[inside], c[inside]
    dem_at = ndimage.map_coordinates(dem, [r, c], order=1)
    b_at = ndimage.map_coordinates(built, [r, c], order=1)
    t_at = ndimage.map_coordinates(tree, [r, c], order=1)
    diff = pts[:, 2] - dem_at                    # ellipsoid − orthometric ≈ geoid + SRTM error
    keep = np.abs(diff - np.median(diff)) < 15
    for _ in range(4):
        X = np.column_stack([np.ones(keep.sum()), b_at[keep], t_at[keep]])
        coef, *_ = np.linalg.lstsq(X, diff[keep], rcond=None)
        res = diff - (coef[0] + coef[1] * b_at + coef[2] * t_at)
        mad = np.median(np.abs(res[keep])) * 1.4826
        keep = np.abs(res) < 3 * max(mad, 0.5)
    geoid, b_bias, t_bias = coef
    before = diff[keep] - np.median(diff[keep])
    after = res[keep]
    rmse = lambda v: float(np.sqrt(np.mean(v ** 2)))
    built_mask = b_at[keep] > 0.5
    stats = {
        "segments_used": int(keep.sum()), "segments_total": int(len(diff)),
        "geoid_offset_m": round(float(geoid), 2),
        "built_bias_m": round(float(b_bias), 2), "tree_bias_m": round(float(t_bias), 2),
        "rmse_before_m": round(rmse(before), 2), "rmse_after_m": round(rmse(after), 2),
        "rmse_built_before_m": round(rmse(before[built_mask]), 2) if built_mask.any() else None,
        "rmse_built_after_m": round(rmse(after[built_mask]), 2) if built_mask.any() else None,
        "first": str(np.datetime64(int(pts[:, 4].min()), "s"))[:10],
        "last": str(np.datetime64(int(pts[:, 4].max()), "s"))[:10],
    }
    corrected = dem + b_bias * built + t_bias * tree
    # export a light sample of lidar points (residual after correction) for the map
    idx = np.flatnonzero(keep)[:: max(1, keep.sum() // 12000)]
    feats = [{"type": "Feature", "properties": {"r": round(float(res[i]), 2)},
              "geometry": {"type": "Point", "coordinates": [round(float(pts[i, 0]), 5), round(float(pts[i, 1]), 5)]}} for i in idx]
    (OUT / "icesat2.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))
    return corrected.astype(np.float64), stats


# ───────────────────────── 2. hydrology ─────────────────────────
NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def priority_flood(dem):
    """Barnes et al. 2014 Priority-Flood+ε. Returns ε-filled DEM and plain filled DEM."""
    z = dem.ravel()
    N = z.size
    fe = z.copy(); f0 = z.copy()
    closed = np.zeros(N, bool)
    heap = []
    for r in range(R):
        for c in (0, C - 1):
            i = r * C + c; closed[i] = True; heap.append((z[i], i))
    for c in range(1, C - 1):
        for r in (0, R - 1):
            i = r * C + c; closed[i] = True; heap.append((z[i], i))
    heapq.heapify(heap)
    eps = 1e-4
    zl, fel, f0l, cl = z.tolist(), fe.tolist(), f0.tolist(), closed.tolist()
    while heap:
        e, i = heapq.heappop(heap)
        r, c = divmod(i, C)
        for dr, dc in NB:
            rr, cc = r + dr, c + dc
            if rr < 0 or rr >= R or cc < 0 or cc >= C:
                continue
            j = rr * C + cc
            if cl[j]:
                continue
            cl[j] = True
            if zl[j] <= fel[i]:
                fel[j] = fel[i] + eps
            else:
                fel[j] = zl[j]
            f0l[j] = max(zl[j], f0l[i])
            heapq.heappush(heap, (fel[j], j))
    return np.array(fel).reshape(R, C), np.array(f0l).reshape(R, C)


def priority_flood_plain(dem):
    """Fast plain fill (no ε) using the same algorithm; returns (None, filled)."""
    z = dem.ravel(); N = z.size
    f = z.copy(); fl = f.tolist(); cl = [False] * N; heap = []
    for r in range(R):
        for c in (0, C - 1):
            i = r * C + c; cl[i] = True; heap.append((fl[i], i))
    for c in range(1, C - 1):
        for r in (0, R - 1):
            i = r * C + c; cl[i] = True; heap.append((fl[i], i))
    heapq.heapify(heap)
    while heap:
        e, i = heapq.heappop(heap)
        r, c = divmod(i, C)
        for dr, dc in NB:
            rr, cc = r + dr, c + dc
            if 0 <= rr < R and 0 <= cc < C:
                j = rr * C + cc
                if not cl[j]:
                    cl[j] = True
                    if fl[j] < e:
                        fl[j] = e
                    heapq.heappush(heap, (fl[j], j))
    return None, np.array(fl).reshape(R, C)


def d8(fe):
    best = np.zeros((R, C)); down = -np.ones((R, C), np.int64)
    rr, cc = np.mgrid[0:R, 0:C]
    for dr, dc in NB:
        dist = CELL * (math.sqrt(2) if dr and dc else 1)
        r2, c2 = rr + dr, cc + dc
        ok = (r2 >= 0) & (r2 < R) & (c2 >= 0) & (c2 < C)
        drop = np.full((R, C), -np.inf)
        drop[ok] = (fe[ok] - fe[r2[ok], c2[ok]]) / dist
        better = drop > best
        best[better] = drop[better]
        down[better] = (r2 * C + c2)[better]
    return down.ravel(), best.ravel()


def accumulate(order, down, w):
    acc = w.copy()
    for i in order:
        d = down[i]
        if d >= 0:
            acc[d] += acc[i]
    return acc


# ───────────────────────── 3. events ─────────────────────────
def load_power():
    p = json.loads((RAW / "power_hourly.json").read_text())
    t = [datetime.strptime(h, "%Y%m%d%H").replace(tzinfo=timezone.utc) for h in p["hours"]]
    rain = np.array([x if x is not None else 0.0 for x in p["rain_mm_h"]])
    wet = np.array([x if x is not None else np.nan for x in p["soil_wetness"]])
    wet = np.where(np.isnan(wet), np.nanmedian(wet), wet)
    temp = np.array([x if x is not None else 5.0 for x in p["t2m_c"]])
    merra = rain

    # GPM IMERG daily totals (satellite), disaggregated to hours with the MERRA-2 pattern
    im = json.loads((RAW / "imerg_daily.json").read_text())
    days = [h[:8] for h in p["hours"]]
    rain = np.zeros_like(merra)
    liquid_frac = np.where(temp > 0.5, 1.0, 0.0)
    imerg_days = 0
    for d in sorted(set(days)):
        idx = [k for k, x in enumerate(days) if x == d]
        m = merra[idx]; tot = im["precip"].get(d)
        if tot is None or tot < 0:                     # IMERG missing → keep MERRA-2
            rain[idx] = m; continue
        imerg_days += 1
        rain[idx] = tot * (m / m.sum() if m.sum() > 0.1 else np.full(len(idx), 1 / len(idx)))
        lp = im["liquid_prob"].get(d)
        if lp is not None and lp >= 0:
            liquid_frac[idx] = lp / 100.0
    liquid = rain * liquid_frac                        # snow does not run off during the event
    era = json.loads((RAW / "era5_hourly.json").read_text())
    emap = dict(zip(era["hours"], era["precip_mm_h"]))
    era5 = np.array([emap.get(h) or 0.0 for h in p["hours"]])
    log(f"rain input: GPM IMERG on {imerg_days} days, MERRA-2 fallback on {len(set(days)) - imerg_days}")
    return t, liquid, wet, rain, era5


def find_events(t, rain):
    wet = rain >= 0.1
    events, i, n = [], 0, len(rain)
    while i < n:
        if not wet[i]:
            i += 1; continue
        j, dry = i, 0
        while j < n and dry < 6:
            dry = 0 if wet[j] else dry + 1
            j += 1
        end = j - dry
        tot = rain[i:end].sum()
        if tot >= EVENT_MIN_MM:
            seg = rain[i:end]
            m3 = max(seg[k:k + 3].sum() for k in range(max(1, len(seg) - 2)))
            srt = np.sort(seg)[::-1]
            deff = int(np.searchsorted(np.cumsum(srt), 0.8 * tot) + 1)   # hours holding 80% of the rain
            events.append({"i0": i, "i1": end, "total": float(tot), "peak": float(seg.max()), "max3h": float(m3), "deff": deff})
        i = end + 1
    return events


# ───────────────────────── 4. runoff ─────────────────────────
CN_CLASS = {10: 70, 20: 77, 30: 74, 40: 81, 50: 74, 60: 86, 70: 98, 80: 98, 90: 85, 95: 85, 100: 77}


def base_cn(cls, built):
    cn = np.vectorize(lambda k: CN_CLASS.get(int(k), 77))(cls).astype(np.float64)
    return built * 94 + (1 - built) * cn


def amc_adjust(cn, wetness):
    cn1 = cn / (2.281 - 0.01281 * cn)
    cn3 = cn / (0.427 + 0.00573 * cn)
    if wetness <= 0.5:
        a = np.clip((wetness - 0.25) / 0.25, 0, 1); return cn1 + (cn - cn1) * a
    a = np.clip((wetness - 0.5) / 0.25, 0, 1); return cn + (cn3 - cn) * a


def scs_runoff(P, cn):
    S = 25400.0 / np.clip(cn, 30, 99.5) - 254.0
    Ia = 0.2 * S
    return np.where(P > Ia, (P - Ia) ** 2 / (P + 0.8 * S), 0.0)


# ───────────────────────── 5-6. flooding ─────────────────────────
def manning_stage(Q, slope):
    Q = np.maximum(Q, 1e-6)
    W = 2.5 * np.sqrt(Q) + 2.0
    return (Q * MANNING_N / (W * np.sqrt(slope))) ** 0.6


def pond_levels(labels, nlab, dem, fill_depth, inflow_at_outlet, outlet_idx):
    """Volume-limited water level inside each depression."""
    depth = np.zeros(dem.size); vols = np.zeros(nlab + 1)
    flat_lab = labels.ravel()
    order = np.argsort(flat_lab)
    bounds = np.searchsorted(flat_lab[order], np.arange(1, nlab + 2))
    zf = dem.ravel(); fd = fill_depth.ravel()
    for k in range(1, nlab + 1):
        cells = order[bounds[k - 1]:bounds[k]]
        if cells.size == 0:
            continue
        V = inflow_at_outlet[k]
        if V <= 0:
            continue
        z = np.sort(zf[cells]); spill = (zf[cells] + fd[cells]).max()
        cap = np.sum(spill - zf[cells]) * CELL_A
        if V >= cap:
            level = spill
        else:
            # cumulative volume when water reaches z[m]
            cum = np.cumsum(z); m = np.arange(1, len(z) + 1)
            vol_at = (m * z - cum) * CELL_A
            m_i = np.searchsorted(vol_at, V)
            m_i = max(1, min(m_i, len(z)))
            level = z[m_i - 1] + (V - vol_at[m_i - 1]) / (m_i * CELL_A)
        depth[cells] = np.maximum(0, level - zf[cells])
        vols[k] = min(V, cap)
    return depth, vols


def main():
    log("load inputs")
    dem_raw = np.load(WORK / "dem.npy").astype(np.float64)
    cls = np.load(WORK / "landcover.npy")
    built = np.load(WORK / "built_frac.npy").astype(np.float64)
    tree = ndimage.uniform_filter((cls == 10).astype(np.float64), 3)
    water = ndimage.binary_dilation(cls == 80, iterations=1)

    log("lidar correction with ICESat-2")
    dem_c, lidar = lidar_correct(dem_raw, built, tree)
    log("lidar", lidar)
    dem = ndimage.gaussian_filter(dem_c, 0.8)

    log("priority flood")
    fe, f0 = priority_flood(dem)
    fill = f0 - dem
    down, slope_local = d8(fe)
    order = np.argsort(-fe.ravel(), kind="stable")          # upstream → downstream
    log("accumulate area")
    area = accumulate(order, down, np.full(R * C, CELL_A))  # m²
    stream = area >= STREAM_KM2 * 1e6

    log("HAND")
    dz = dem.ravel()
    drain = -np.ones(R * C, np.int64)
    for i in order[::-1]:
        if stream[i]:
            drain[i] = i
        else:
            d = down[i]
            drain[i] = drain[d] if d >= 0 else -1
    hand = np.where(drain >= 0, np.maximum(0, dz - dz[np.maximum(drain, 0)]), np.inf)

    # reach slope: elevation drop over ~10 cells downstream
    slope = np.full(R * C, 0.002)
    fez = fe.ravel()
    for i in np.flatnonzero(stream):
        j, steps, dist = i, 0, 0.0
        while steps < 10 and down[j] >= 0:
            k = down[j]; rj, cj = divmod(j, C); rk, ck = divmod(k, C)
            dist += CELL * (math.sqrt(2) if (rj != rk and cj != ck) else 1)
            j = k; steps += 1
        if dist > 0:
            slope[i] = max(0.002, (fez[i] - fez[j]) / dist)
    tc_h = 0.6 * np.power(area / 1e6, 0.38)                 # time of concentration (h)

    log("events from NASA POWER")
    t, rain, wet, rain_all, era5 = load_power()
    events = find_events(t, rain)
    for e in events:
        e["era5"] = float(era5[e["i0"]:e["i1"]].sum())
        e["confirmed"] = e["era5"] >= 0.5 * e["total"]
    n_found = len(events)
    events = [e for e in events if e["confirmed"]]
    log(f"events: {n_found} rain events ≥{EVENT_MIN_MM} mm, {len(events)} confirmed by ERA5")
    # bankfull reference: median of annual-maximum event totals
    by_year = {}
    for e in events:
        y = t[e["i0"]].year; by_year[y] = max(by_year.get(y, 0), e["total"])
    p_bf = float(np.median(list(by_year.values())))
    d_bf = float(np.median([e["deff"] for e in events]))
    biggest = {id(e) for e in sorted(events, key=lambda e: e["total"], reverse=True)[:N_EVENTS]}
    top = sorted(events, key=lambda e: e["i0"])

    cn0 = base_cn(cls, built)
    q_bf = scs_runoff(p_bf, cn0).ravel() / 1000 * CELL_A
    V_bf = accumulate(order, down, q_bf)
    Qbf = 2 * V_bf / (3600 * (d_bf + 2 * tc_h))
    h_bf = manning_stage(Qbf, slope)

    # Stochastic depression analysis (Lindsay & Creed 2005): perturb the DEM with
    # spatially-correlated error of the size measured against ICESat-2 and keep
    # only depressions that persist in most realisations.
    log(f"stochastic depressions ({N_REAL} realisations, σ={lidar['rmse_after_m']} m)")
    rng = np.random.default_rng(42)
    persist = np.zeros((R, C))
    for _ in range(N_REAL):
        noise = ndimage.gaussian_filter(rng.standard_normal((R, C)), 2.0)
        noise *= lidar["rmse_after_m"] / noise.std()
        _, f0n = priority_flood_plain(dem + noise)
        persist += (f0n - (dem + noise)) > 0.05
    persist /= N_REAL
    np.save(WORK / "depression_probability.npy", persist)
    labels, nlab = ndimage.label((fill > 0.05) & (persist >= DEP_PROB) & ~water, structure=np.ones((3, 3)))
    # drop depressions that sit on big rivers (handled by the river model) or are tiny/shallow
    lab_flat = labels.ravel()
    max_fill = ndimage.maximum(fill, labels, index=np.arange(nlab + 1))
    size = np.bincount(lab_flat, minlength=nlab + 1)
    max_area = ndimage.maximum(area.reshape(R, C), labels, index=np.arange(nlab + 1))
    valid = (max_fill >= 0.5) & (size >= 4) & (max_area < 5e6)
    valid[0] = False
    labels = np.where(valid[labels], labels, 0)
    outlet = np.zeros(nlab + 1, np.int64)
    acc_lab = ndimage.maximum_position(area.reshape(R, C), labels, index=np.arange(nlab + 1))
    for k in range(1, nlab + 1):
        if valid[k]:
            outlet[k] = acc_lab[k][0] * C + acc_lab[k][1]
    log(f"depressions kept: {valid.sum()} of {nlab}; bankfull P={p_bf:.1f} mm over {d_bf:.0f} h")

    lab_flat_v = labels.ravel()
    lab_area = np.bincount(lab_flat_v, minlength=nlab + 1) * CELL_A
    built_acc = accumulate(order, down, built.ravel() * CELL_A)
    catch_built = np.where(valid, built_acc[outlet], 0)
    catch_area = np.where(valid, area[outlet], 0)
    # basin drains through: sewers on built catchment, ditches/culverts elsewhere, infiltration on its floor
    drain_m3_h = (SEWER_MM_H * catch_built + DITCH_MM_H * (catch_area - catch_built) + 3.0 * lab_area) / 1000
    all_depths, all_dates = [], []
    results = []
    depth_max = np.zeros(R * C); dur_max = np.zeros(R * C); freq = np.zeros(R * C)
    cause_max = np.zeros(R * C, np.uint8)
    for e in top:
        i0, i1 = e["i0"], e["i1"]
        P = e["total"]; seg = rain[i0:i1]; w0 = float(wet[i0])
        cn = amc_adjust(cn0, w0)
        q = scs_runoff(P, cn).ravel()                       # mm
        V = accumulate(order, down, q / 1000 * CELL_A)      # m³ upstream
        D = e["deff"]                                       # effective rain duration (h)
        Tb = D + 2 * tc_h
        Qp = 2 * V / (3600 * Tb)
        stage = np.maximum(0, manning_stage(Qp, slope) - h_bf)
        stage[area < RIVER_KM2 * 1e6] = 0
        st_d = np.where(drain >= 0, stage[np.maximum(drain, 0)], 0)
        Tb_d = np.where(drain >= 0, Tb[np.maximum(drain, 0)], 0)
        d_river = np.where(stream | (hand < st_d), np.maximum(0, st_d - np.where(np.isfinite(hand), hand, 1e9)), 0)
        d_river[water.ravel()] = 0                          # permanent water is not flood
        dur_river = np.where(d_river > 0, Tb_d * (1 - np.clip(hand / np.maximum(st_d, 1e-6), 0, 1) ** (5 / 3)), 0)

        # Hour-by-hour basin storage: runoff arrives following the event's own
        # hourly NASA rain (SCS cumulative excess), while sewers / ditches drain.
        cn_c = float(np.mean(cn)); S_c = 25400 / cn_c - 254
        cumP = np.cumsum(seg)
        exc = np.where(cumP > 0.2 * S_c, (cumP - 0.2 * S_c) ** 2 / (cumP + 0.8 * S_c), 0)
        frac_t = exc / exc[-1] if exc[-1] > 0 else np.zeros_like(exc)
        inflow = np.zeros(nlab + 1)
        inflow[valid] = V[outlet[valid]]
        hours_t = np.arange(1, len(seg) + 1)
        stor = (inflow[:, None] * frac_t[None, :] - drain_m3_h[:, None] * hours_t[None, :]).max(axis=1)
        stor = np.maximum(stor, 0)
        d_pond, vols = pond_levels(labels, nlab, dem, fill, stor, outlet)
        dur_lab = np.where(vols > 0, vols / np.maximum(drain_m3_h, 1e-6), 0)
        dur_pond = np.where(d_pond > 0, dur_lab[lab_flat_v], 0)

        depth = np.maximum(d_river, d_pond)
        depth[depth < MIN_DEPTH] = 0
        cause = np.where(depth == 0, 0, np.where(d_river >= d_pond, 1, 2)).astype(np.uint8)
        dur = np.where(cause == 1, dur_river, np.where(cause == 2, dur_pond, 0))
        dur = np.where(depth > 0, np.maximum(dur, 1), 0)

        freq += depth > 0
        all_depths.append(np.clip(np.round(depth * 50), 0, 255).astype(np.uint8))
        all_dates.append(t[i0].astimezone(SOFIA_TZ).strftime("%Y-%m-%d"))
        if id(e) not in biggest:
            continue
        upd = depth > depth_max
        cause_max[upd] = cause[upd]
        depth_max = np.maximum(depth_max, depth); dur_max = np.maximum(dur_max, dur)
        n = len(results)
        write_png(f"event_{n}.png", depth, dur, cause)

        # water-level curve: linear reservoir (k = 3 h) of hourly excess rain, city average CN
        w_s = max(0, i0 - 6); w_e = min(len(rain), i1 + 24)
        hours = rain[w_s:w_e]
        cn_city = float(np.mean(cn)); S = 25400 / cn_city - 254
        cum = np.cumsum(hours); Qc = np.where(cum > 0.2 * S, (cum - 0.2 * S) ** 2 / (cum + 0.8 * S), 0)
        inc = np.diff(np.concatenate([[0], Qc])); store = 0.0; lvl = []
        for x in inc:
            store += x - store / 3.0; lvl.append(store)
        lvl = np.array(lvl); lvl = lvl / lvl.max() if lvl.max() > 0 else lvl
        flooded = depth > 0
        start_local = t[i0].astimezone(SOFIA_TZ)
        results.append({
            "id": f"e{n}", "png": f"event_{n}.png",
            "start": start_local.isoformat(timespec="minutes"),
            "end": t[i1 - 1].astimezone(SOFIA_TZ).isoformat(timespec="minutes"),
            "window_start": t[w_s].astimezone(SOFIA_TZ).isoformat(timespec="minutes"),
            "duration_h": int(i1 - i0), "effective_h": int(D), "total_mm": round(P, 1), "peak_mm_h": round(e["peak"], 1),
            "max3h_mm": round(e["max3h"], 1), "soil_wetness": round(w0, 2), "era5_mm": round(e["era5"], 1),
            "runoff_city_mm": round(float(np.mean(q)), 1),
            "flooded_km2": round(float(flooded.sum() * CELL_A / 1e6), 2),
            "built_flooded_km2": round(float((built.ravel() * flooded).sum() * CELL_A / 1e6), 3),
            "max_depth_m": round(float(depth.max()), 2),
            "rain": [round(float(x), 2) for x in hours], "level": [round(float(x), 3) for x in lvl],
        })
        log(f"event {start_local:%Y-%m-%d} P={P:.0f}mm peak={e['peak']:.1f} wet={w0:.2f} flooded={results[-1]['flooded_km2']} km²")

    write_png("max5y.png", depth_max, dur_max, cause_max)
    hotspots = make_hotspots(depth_max, dur_max, freq, cause_max, built, area, events, all_depths, all_dates)
    streams = trace_streams(down, area, area >= MAP_STREAM_KM2 * 1e6)
    (OUT / "streams.geojson").write_text(json.dumps(streams, separators=(",", ":")))

    # daily totals for the 5-year record (timeline of the composite view)
    days = {}
    for ti, r in zip(t, rain_all):
        k = ti.astimezone(SOFIA_TZ).strftime("%Y-%m-%d"); days[k] = days.get(k, 0) + r
    yearly = {}
    for k, v in days.items():
        yearly[k[:4]] = yearly.get(k[:4], 0) + v
    wettest = max(days.items(), key=lambda kv: kv[1])
    summary = {
        "generated": datetime.now(SOFIA_TZ).isoformat(timespec="minutes"),
        "period": {"start": START_DATE.isoformat(), "end": END_DATE.isoformat()},
        "grid": {"rows": R, "cols": C, "cell_m": round(CELL, 1),
                 "bounds": [[grid["west"], grid["north"]], [grid["east"], grid["north"]], [grid["east"], grid["south"]], [grid["west"], grid["south"]]]},
        "dem": {"min_m": round(float(dem_raw.min())), "max_m": round(float(dem_raw.max()))},
        "lidar": lidar,
        "rain": {"hours": len(rain), "total_mm": round(float(rain_all.sum())), "annual_mean_mm": round(float(rain_all.sum()) / 5),
                 "max_hourly_mm": round(float(rain.max()), 1), "events_found": n_found, "events_confirmed": len(events),
                 "snow_mm": round(float(rain_all.sum() - rain.sum())), "era5_total_mm": round(float(era5.sum())),
                 "wettest_day": {"date": wettest[0], "mm": round(wettest[1], 1)},
                 "yearly_mm": {k: round(v) for k, v in sorted(yearly.items())},
                 "bankfull_event_mm": round(p_bf, 1)},
        "landcover": {"built_share": round(float((built > 0.5).mean()), 3)},
        "model": {"stream_km2": STREAM_KM2, "river_km2": RIVER_KM2, "sewer_mm_h": SEWER_MM_H, "ditch_mm_h": DITCH_MM_H, "manning_n": MANNING_N, "min_depth_m": MIN_DEPTH,
                  "stream_cells": int(stream.sum()), "depressions": int(valid.sum()), "realisations": N_REAL, "depression_prob": DEP_PROB},
        "max5y": {"png": "max5y.png", "flooded_km2": round(float((depth_max > 0).sum() * CELL_A / 1e6), 2),
                  "built_flooded_km2": round(float((built.ravel() * (depth_max > 0)).sum() * CELL_A / 1e6), 3),
                  "max_depth_m": round(float(depth_max.max()), 2)},
        "daily": [[k, round(v, 1)] for k, v in sorted(days.items())],
        "events": results,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, separators=(",", ":")))
    (OUT / "hotspots.json").write_text(json.dumps(hotspots, indent=1))
    log(f"done: {len(results)} events, {len(hotspots)} hotspots, 5y flooded {summary['max5y']['flooded_km2']} km²")


def write_png(name, depth, dur, cause):
    img = np.zeros((R, C, 4), np.uint8)
    img[..., 0] = np.clip(np.round(depth.reshape(R, C) * 50), 0, 255)
    img[..., 1] = np.clip(np.round(dur.reshape(R, C)), 0, 255)
    img[..., 2] = cause.reshape(R, C)
    img[..., 3] = 255
    Image.fromarray(img, "RGBA").save(OUT / name, optimize=True)


def make_hotspots(depth, dur, freq, cause, built, area, events, all_depths, all_dates):
    stack = np.stack(all_depths)            # events × cells, depth in 2 cm units
    d2 = depth.reshape(R, C); b2 = built
    mask = (d2 >= 0.3) & (b2 >= 0.3)
    mask = ndimage.binary_closing(mask, structure=np.ones((3, 3)))
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    cands = []
    for k in range(1, n + 1):
        cells = np.flatnonzero(lab.ravel() == k)
        if cells.size < 3:
            continue
        dd = depth[cells]
        built_m2 = float((built.ravel()[cells] * (dd > 0)).sum() * CELL_A)
        r, c = divmod(int(cells[np.argmax(dd)]), C)
        lon, lat = rc_to_lonlat(r, c)
        per_event = stack[:, cells].max(axis=1) / 50.0
        hit = np.flatnonzero(per_event >= 0.3)
        fr = float(hit.size)
        dates = [all_dates[k] for k in hit]
        worst = all_dates[int(np.argmax(per_event))]
        cz = cause[cells][dd > 0]
        cands.append({"cells": cells, "lon": float(lon), "lat": float(lat), "max_depth": float(dd.max()),
                      "mean_depth": float(dd[dd > 0].mean()), "area_m2": float((dd > 0).sum() * CELL_A),
                      "built_m2": built_m2, "events": int(fr), "duration_h": float(dur[cells].max()),
                      "cause": "river" if (cz == 1).sum() >= (cz == 2).sum() else "ponding",
                      "upstream_km2": float(area[cells].max() / 1e6), "dates": dates, "worst": worst})
    if not cands:
        return []
    mb = max(c["built_m2"] for c in cands); mf = max(c["events"] for c in cands)
    for c in cands:
        c["score"] = round(100 * (0.35 * min(1, c["max_depth"] / 1.5) + 0.4 * c["events"] / mf + 0.25 * math.sqrt(c["built_m2"] / mb)))
    cands.sort(key=lambda c: c["score"], reverse=True)
    top = []
    for c in cands:                      # keep spots at least 400 m apart
        kx = math.cos(math.radians(c["lat"]))
        if all(math.hypot((c["lon"] - o["lon"]) * kx, c["lat"] - o["lat"]) * 111320 > 400 for o in top):
            top.append(c)
        if len(top) == 12:
            break
    # which events flooded each hotspot (re-read PNGs is wasteful; use per-event depth via frequency only) → worst event by total rain among those that flood it
    geo = load_geocode_cache()
    out = []
    for i, c in enumerate(top):
        name, district = reverse_geocode(c["lat"], c["lon"], geo)
        fix = ("Check river channel and culvert capacity here; consider widening or raising banks and upstream detention."
               if c["cause"] == "river" else
               f"Low point collecting runoff from ≈{c['upstream_km2']:.1f} km²: add storm-sewer inlets / pumping, retention and permeable surfaces upstream.")
        out.append({"id": f"H-{i + 1:02d}", "name": name, "district": district, "coord": [round(c["lon"], 5), round(c["lat"], 5)],
                    "score": c["score"], "depth": round(c["max_depth"], 2), "mean_depth": round(c["mean_depth"], 2),
                    "area_m2": round(c["area_m2"]), "built_m2": round(c["built_m2"]), "events": c["events"],
                    "events_total": len(events), "per_year": round(c["events"] / 5, 1), "duration_h": round(c["duration_h"]), "cause": c["cause"],
                    "worst_event": c["worst"], "recent_dates": c["dates"][-6:],
                    "upstream_km2": round(c["upstream_km2"], 2), "fix": fix})
    save_geocode_cache(geo)
    return out


def load_geocode_cache():
    f = RAW / "geocode.json"
    return json.loads(f.read_text()) if f.exists() else {}


def save_geocode_cache(g):
    (RAW / "geocode.json").write_text(json.dumps(g, ensure_ascii=False, indent=1))


def reverse_geocode(lat, lon, cache):
    key = f"{lat:.4f},{lon:.4f}"
    if key not in cache:
        try:
            time.sleep(1.1)  # Nominatim usage policy: max 1 request/second
            r = http_get("https://nominatim.openstreetmap.org/reverse",
                         params={"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 17, "accept-language": "en"}, timeout=30)
            cache[key] = r.json().get("address", {})
        except Exception:  # noqa: BLE001
            cache[key] = {}
    a = cache[key]
    road = (a.get("road") or a.get("pedestrian") or a.get("square") or a.get("amenity") or a.get("industrial")
            or a.get("retail") or a.get("commercial") or a.get("neighbourhood") or a.get("hamlet") or "Unnamed street")
    district = a.get("suburb") or a.get("quarter") or a.get("city_district") or a.get("neighbourhood") or a.get("village") or CITY
    import re
    if re.fullmatch(r"[A-Za-z]{0,4}\s*\d+[A-Za-z]?", road.strip()):   # road reference such as "6", "603", "PER3124"
        road = f"{district} · road {road.strip()}"
    elif road == "Unnamed street":
        road = f"{district} · unnamed street"
    return road, district


def trace_streams(down, area, stream):
    """Turn stream cells into polylines (one line per link, split at junctions)."""
    n_up = np.zeros(R * C, np.int32)
    s_idx = np.flatnonzero(stream)
    for i in s_idx:
        d = down[i]
        if d >= 0 and stream[d]:
            n_up[d] += 1
    starts = [i for i in s_idx if n_up[i] != 1]
    feats = []
    for s in starts:
        path = [s]; j = s
        while True:
            d = down[j]
            if d < 0 or not stream[d]:
                break
            path.append(d)
            if n_up[d] != 1:
                break
            j = d
        if len(path) < 3:
            continue
        rr, cc = np.divmod(np.array(path), C)
        lon, lat = rc_to_lonlat(rr, cc)
        coords = [[round(float(x), 5), round(float(y), 5)] for x, y in zip(lon, lat)][::2] + [[round(float(lon[-1]), 5), round(float(lat[-1]), 5)]]
        feats.append({"type": "Feature", "properties": {"km2": round(float(area[path[-1]] / 1e6), 1)},
                      "geometry": {"type": "LineString", "coordinates": coords}})
    return {"type": "FeatureCollection", "features": feats}


if __name__ == "__main__":
    main()
