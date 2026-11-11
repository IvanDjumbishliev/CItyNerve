"""ICESat-2 lidar ground heights over Sofia via the public SlideRule service.

NASA ICESat-2 ATL03 photons are processed server-side by SlideRule into 40 m
surface segments (ATL06-SR) using only photons ATL08 classifies as *ground*.
Output heights are ellipsoidal (WGS84); the model removes the geoid offset by
comparing against the DEM, so no local geoid file is needed.
"""
import numpy as np
from sliderule import sliderule, icesat2
from config import BBOX, RAW, START_DATE, END_DATE


def main():
    w, s, e, n = BBOX
    region = [{"lon": w, "lat": s}, {"lon": e, "lat": s}, {"lon": e, "lat": n}, {"lon": w, "lat": n}, {"lon": w, "lat": s}]
    sliderule.init(verbose=False)
    import pandas as pd
    frames = []
    for year in range(START_DATE.year, END_DATE.year + 1):
        t0 = max(START_DATE, START_DATE.replace(year=year, month=1, day=1))
        t1 = min(END_DATE, END_DATE.replace(year=year, month=12, day=31))
        part = fetch(region, t0, t1)
        print(year, 0 if part is None else len(part))
        if part is not None and len(part):
            frames.append(part)
    if not frames:
        raise SystemExit("No ICESat-2 segments returned")
    gdf = pd.concat(frames)
    save(gdf)


def fetch(region, t0, t1):
    parms = {
        "poly": region,
        "srt": icesat2.SRT_LAND,
        "cnf": icesat2.CNF_SURFACE_LOW,
        "atl08_class": ["atl08_ground"],
        "len": 40.0, "res": 20.0,
        "ats": 5.0, "cnt": 5,
        "t0": f"{t0:%Y-%m-%d}T00:00:00Z",
        "t1": f"{t1:%Y-%m-%d}T23:59:59Z",
    }
    for attempt in range(3):
        try:
            return icesat2.atl06p(parms)
        except Exception as e:  # noqa: BLE001
            print("retry", attempt + 1, e)
    return None


def save(gdf):
    lon = gdf.geometry.x.to_numpy(); lat = gdf.geometry.y.to_numpy()
    h = gdf["h_mean"].to_numpy(); sig = gdf["h_sigma"].to_numpy() if "h_sigma" in gdf else np.zeros_like(h)
    t = gdf.index.astype("int64").to_numpy() // 10**9
    keep = np.isfinite(h) & (sig < 1.0)
    arr = np.column_stack([lon, lat, h, sig, t])[keep]
    np.save(RAW / "icesat2_ground.npy", arr)
    tr = np.unique(gdf["rgt"]) if "rgt" in gdf else []
    print(f"ICESat-2 ground segments: {len(arr)} (of {len(gdf)}), tracks: {len(tr)}, "
          f"dates {np.datetime64(int(arr[:,4].min()), 's')} → {np.datetime64(int(arr[:,4].max()), 's')}")


if __name__ == "__main__":
    main()
