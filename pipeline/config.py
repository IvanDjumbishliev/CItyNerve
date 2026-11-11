"""Shared settings for the FloodNerve data pipeline.

Select the study area with the REGION environment variable (default: sofia):
    REGION=pernik python fetch_dem.py
"""
import os
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parent
REGIONS = {
    # Sofia: the city, Vitosha foothills and the Iskar. Rain point = city centre.
    "sofia": {"bbox": (23.18, 42.60, 23.50, 42.78), "center": (23.32, 42.69), "sub": "", "city": "Sofia"},
    # Pernik: the city, the Struma valley up to Studena dam, Golo Bardo foothills.
    "pernik": {"bbox": (22.92, 42.50, 23.20, 42.68), "center": (23.04, 42.60), "sub": "pernik", "city": "Pernik"},
}
REGION = os.environ.get("REGION", "sofia")
_r = REGIONS[REGION]
RAW = ROOT / "raw" / _r["sub"]         # downloaded source data (git-ignored)
WORK = ROOT / "work" / _r["sub"]       # intermediate rasters (git-ignored)
OUT = ROOT.parent / "public" / "data" / _r["sub"]   # files the web app loads
for p in (RAW, WORK, OUT):
    p.mkdir(parents=True, exist_ok=True)

BBOX = _r["bbox"]                      # west, south, east, north
CENTER = _r["center"]
CITY = _r["city"]

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
