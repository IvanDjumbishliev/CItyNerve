"""Space lidar over the study area: what is tall — trees or buildings — and how tall.

Two NASA lidars, both through the public SlideRule service (no login):
  GEDI L2A (ISS, 25 m footprints, 2019–2023 + 2024 onward) — ground (lowest mode)
      and highest return give the height of whatever stands in the footprint.
  ICESat-2 ATL08 (532 nm photon counting, PhoREAL 40 m segments, 2021–2026) —
      relative canopy height h_canopy (98th percentile of canopy photons above ground).
Landsat NDVI later separates vegetation (green, tall = tree shade) from roofs.
"""
import numpy as np
from sliderule import sliderule, icesat2, gedi
from config import BBOX, RAW


def region():
    w, s, e, n = BBOX
    return [{"lon": w, "lat": s}, {"lon": e, "lat": s}, {"lon": e, "lat": n}, {"lon": w, "lat": n}, {"lon": w, "lat": s}]


def retry(fn, parms, tries=3):
    for i in range(tries):
        try:
            return fn(parms)
        except Exception as e:  # noqa: BLE001
            print("  retry", i + 1, e)
    return None


def fetch_gedi():
    out = RAW / "gedi_l2a.npy"
    if out.exists():
        print("GEDI cached", len(np.load(out))); return
    rows = []
    for y in range(2019, 2027):
        d = retry(gedi.gedi02ap, {"poly": region(), "degrade_filter": True, "l2_quality_filter": True,
                                  "t0": f"{y}-01-01T00:00:00Z", "t1": f"{y}-12-31T23:59:59Z"})
        if d is None or not len(d):
            print("GEDI", y, 0); continue
        h = (d["elevation_hr"] - d["elevation_lm"]).to_numpy()
        t = d.index.astype("int64").to_numpy() // 10**9
        a = np.column_stack([d.geometry.x.to_numpy(), d.geometry.y.to_numpy(), h, t])
        a = a[np.isfinite(h) & (h >= 0) & (h < 150)]
        rows.append(a); print("GEDI", y, len(a))
    arr = np.concatenate(rows) if rows else np.zeros((0, 4))
    np.save(out, arr)
    print(f"GEDI L2A shots kept: {len(arr)}")


def fetch_atl08():
    out = RAW / "atl08_canopy.npy"
    if out.exists():
        print("ATL08 cached", len(np.load(out))); return
    rows = []
    for y in range(2021, 2027):
        d = retry(icesat2.atl08p, {"poly": region(), "t0": f"{y}-01-01T00:00:00Z", "t1": f"{y}-12-31T23:59:59Z",
                                   "cnf": 0, "srt": icesat2.SRT_LAND, "len": 40, "res": 20,
                                   "atl08_class": ["atl08_ground", "atl08_canopy", "atl08_top_of_canopy"],
                                   "phoreal": {"binsize": 1.0, "geoloc": "center", "above_classifier": True}})
        if d is None or not len(d):
            print("ATL08", y, 0); continue
        h = d["h_canopy"].to_numpy().astype(float)
        t = d.index.astype("int64").to_numpy() // 10**9
        a = np.column_stack([d.geometry.x.to_numpy(), d.geometry.y.to_numpy(), h, t, d["veg_ph_count"].to_numpy(), d["gnd_ph_count"].to_numpy()])
        a = a[np.isfinite(h) & (h >= 0) & (h < 60)]
        rows.append(a); print("ATL08", y, len(a))
    arr = np.concatenate(rows) if rows else np.zeros((0, 6))
    np.save(out, arr)
    print(f"ICESat-2 ATL08 segments kept: {len(arr)}")


if __name__ == "__main__":
    sliderule.init(verbose=False)
    fetch_gedi()
    fetch_atl08()
