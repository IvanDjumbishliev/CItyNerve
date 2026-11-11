"""Hourly rainfall and soil wetness for Sofia from NASA POWER.

NASA POWER serves NASA GMAO MERRA-2 reanalysis (which assimilates satellite
observations). No login is needed. Parameters:
  PRECTOTCORR — bias-corrected total precipitation, mm/h
  GWETTOP     — surface soil wetness (0 = dry, 1 = saturated)
  T2M         — air temperature at 2 m, °C (separates rain from snow)
"""
import json
from datetime import date, timedelta
from config import CENTER, START_DATE, END_DATE, RAW, http_get

API = "https://power.larc.nasa.gov/api/temporal/hourly/point"


def chunks(start, end):
    cur = start
    while cur <= end:
        nxt = min(date(cur.year, 12, 31), end)
        yield cur, nxt
        cur = nxt + timedelta(days=1)


def main():
    series = {"PRECTOTCORR": {}, "GWETTOP": {}, "T2M": {}}
    for a, b in chunks(START_DATE, END_DATE):
        f = RAW / f"power3_{a:%Y%m%d}_{b:%Y%m%d}.json"
        if not f.exists():
            params = {"parameters": "PRECTOTCORR,GWETTOP,T2M", "community": "AG",
                      "longitude": CENTER[0], "latitude": CENTER[1],
                      "start": f"{a:%Y%m%d}", "end": f"{b:%Y%m%d}",
                      "format": "JSON", "time-standard": "UTC"}
            r = http_get(API, params=params, timeout=300)
            f.write_text(r.text)
            print("fetched", a, b)
        p = json.loads(f.read_text())["properties"]["parameter"]
        for k in series:
            series[k].update(p[k])
    fill = -999
    keys = sorted(series["PRECTOTCORR"])
    rain = [max(0.0, series["PRECTOTCORR"][k]) if series["PRECTOTCORR"][k] != fill else None for k in keys]
    wet = [series["GWETTOP"][k] if series["GWETTOP"][k] != fill else None for k in keys]
    temp = [series["T2M"][k] if series["T2M"][k] != fill else None for k in keys]
    out = {"hours": keys, "rain_mm_h": rain, "soil_wetness": wet, "t2m_c": temp,
           "source": "NASA POWER hourly (MERRA-2): PRECTOTCORR, GWETTOP, T2M", "location": CENTER}
    (RAW / "power_hourly.json").write_text(json.dumps(out))
    valid = [r for r in rain if r is not None]
    print(f"{len(keys)} hours, {len(valid)} valid, total {sum(valid):.0f} mm, max {max(valid):.1f} mm/h")


if __name__ == "__main__":
    main()
