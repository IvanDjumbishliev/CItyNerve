"""Daily air temperature for the heat record from NASA POWER (MERRA-2, no login).

T2M_MAX / T2M_MIN / T2M — 2 m air temperature, °C, daily, at the city centre.
ALLSKY_SFC_SW_DWN — incoming solar energy at the surface, kWh/m²/day.
"""
import json
from config import CENTER, START_DATE, END_DATE, RAW, http_get

API = "https://power.larc.nasa.gov/api/temporal/daily/point"
PARAMS = "T2M_MAX,T2M_MIN,T2M,ALLSKY_SFC_SW_DWN"


def main():
    f = RAW / "power_heat_daily.json"
    if not f.exists():
        r = http_get(API, params={"parameters": PARAMS, "community": "RE", "longitude": CENTER[0], "latitude": CENTER[1],
                                  "start": f"{START_DATE:%Y%m%d}", "end": f"{END_DATE:%Y%m%d}", "format": "JSON"}, timeout=300)
        f.write_text(r.text)
    p = json.loads(f.read_text())["properties"]["parameter"]
    days = sorted(p["T2M_MAX"])
    hot = [d for d in days if p["T2M_MAX"][d] != -999 and p["T2M_MAX"][d] >= 30]
    print(f"{len(days)} days; {len(hot)} days >=30 C; max {max(v for v in p['T2M_MAX'].values() if v != -999):.1f} C")


if __name__ == "__main__":
    main()
