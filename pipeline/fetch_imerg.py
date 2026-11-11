"""Daily NASA GPM IMERG precipitation for Sofia, via NASA POWER (no login).

IMERG_PRECTOT          — GPM IMERG daily precipitation, mm/day (0.1° satellite product)
IMERG_PRECLIQUID_PROB  — probability that precipitation was liquid (rain), %
The model spreads each IMERG daily total over the hours of that day using the
NASA MERRA-2 hourly rain pattern (temporal disaggregation).
"""
import json
from config import CENTER, START_DATE, END_DATE, RAW, http_get


def main():
    r = http_get("https://power.larc.nasa.gov/api/temporal/daily/point", params={
        "parameters": "IMERG_PRECTOT,IMERG_PRECLIQUID_PROB", "community": "AG",
        "longitude": CENTER[0], "latitude": CENTER[1],
        "start": f"{START_DATE:%Y%m%d}", "end": f"{END_DATE:%Y%m%d}",
        "format": "JSON", "time-standard": "UTC"}, timeout=300)
    j = r.json()
    p = j["properties"]["parameter"]
    (RAW / "imerg_daily.json").write_text(json.dumps({"precip": p["IMERG_PRECTOT"], "liquid_prob": p["IMERG_PRECLIQUID_PROB"],
                                                      "source": "GPM IMERG via NASA POWER daily"}))
    vals = [v for v in p["IMERG_PRECTOT"].values() if v is not None and v >= 0]
    missing = sum(1 for v in p["IMERG_PRECTOT"].values() if v is None or v < 0)
    print(f"IMERG days {len(p['IMERG_PRECTOT'])}, missing {missing}, total {sum(vals):.0f} mm, max day {max(vals):.1f} mm")


if __name__ == "__main__":
    main()
