"""Independent cross-check of rainfall: ECMWF ERA5 via the Open-Meteo archive API.

Used only to confirm NASA MERRA-2 storm events (reanalyses can disagree on
single events); the model's rainfall input remains NASA POWER.
"""
import json
from config import CENTER, START_DATE, END_DATE, RAW, http_get


def main():
    r = http_get("https://archive-api.open-meteo.com/v1/archive", params={
        "latitude": CENTER[1], "longitude": CENTER[0],
        "start_date": START_DATE.isoformat(), "end_date": END_DATE.isoformat(),
        "hourly": "precipitation", "timezone": "GMT"}, timeout=300)
    h = r.json()["hourly"]
    keys = [t.replace("-", "").replace("T", "")[:10] for t in h["time"]]
    out = {"hours": keys, "precip_mm_h": h["precipitation"], "source": "ERA5 via Open-Meteo archive"}
    (RAW / "era5_hourly.json").write_text(json.dumps(out))
    vals = [v for v in h["precipitation"] if v is not None]
    print(f"ERA5 {len(keys)} hours, total {sum(vals):.0f} mm")


if __name__ == "__main__":
    main()
