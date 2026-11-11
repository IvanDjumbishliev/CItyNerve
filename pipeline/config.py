"""Shared settings for the FloodNerve Sofia data pipeline."""
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"            # downloaded source data (git-ignored)
WORK = ROOT / "work"          # intermediate rasters (git-ignored)
OUT = ROOT.parent / "public" / "data"   # files the web app loads
for p in (RAW, WORK, OUT):
    p.mkdir(parents=True, exist_ok=True)

# Sofia study area (lon/lat). Covers the city, Vitosha foothills and the Iskar.
BBOX = (23.18, 42.60, 23.50, 42.78)   # west, south, east, north
CENTER = (23.32, 42.69)

# Terrain tiles zoom: z12 ≈ 28 m cells here, matching SRTM 1-arc-second (30 m) source data.
DEM_ZOOM = 12

# Rain record: the last 5 years only.
END_DATE = date(2026, 11, 10)
START_DATE = END_DATE - timedelta(days=5 * 365)

USER_AGENT = "FloodNerve-hackathon-prototype/0.1"


def http_get(url, params=None, timeout=120, tries=5):
    """GET with retries (DNS/network hiccups are common on long downloads)."""
    import time, requests
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=timeout)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise last
