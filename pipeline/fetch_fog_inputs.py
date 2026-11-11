"""Fetch Sofia station observations and hourly fog meteorology.

Observed fog episodes use METAR visibility/weather codes from the Iowa
Environmental Mesonet. Open-Meteo ERA5 supplies the hourly spatial-model
predictors; NASA POWER is retained as a tested secondary meteorology source.
"""
import csv
import io
import json
import requests
from datetime import date, timedelta

from config import CENTER, END_DATE, FOG_VISIBILITY_M, RAW, START_DATE, http_get

IEM_URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive"
POWER_URL = "https://power.larc.nasa.gov/api/temporal/hourly/point"
STATION = "LBSF"
OPEN_METEO_HOURLY = (
    "temperature_2m,dew_point_2m,relative_humidity_2m,"
    "wind_speed_10m,cloud_cover_low"
)
POWER_PARAMETERS = "T2M,T2MDEW,RH2M,WS2M"


def fetch_metar():
    response = http_get(IEM_URL, params={
        "station": STATION, "data": "all",
        "year1": START_DATE.year, "month1": START_DATE.month, "day1": START_DATE.day,
        "year2": END_DATE.year, "month2": END_DATE.month, "day2": END_DATE.day,
        "format": "comma", "latlon": "no", "elev": "no", "missing": "empty",
        "trace": "T", "direct": "no", "report_type": [1, 2],
    }, timeout=300)
    rows = csv.DictReader(line for line in io.StringIO(response.text) if not line.startswith("#"))
    hourly = {}
    for row in rows:
        try:
            stamp = row["valid"][:13].replace("-", "").replace(" ", "")
            visibility = float(row["vsby"]) * 1609.344
        except (KeyError, TypeError, ValueError):
            continue
        if not (START_DATE.strftime("%Y%m%d") <= stamp[:8] <= END_DATE.strftime("%Y%m%d")):
            continue
        codes = (row.get("wxcodes") or "").upper()
        observed_fog = visibility < FOG_VISIBILITY_M or any(code in codes for code in ("FG", "BR", "FZFG"))
        item = hourly.setdefault(stamp, {
            "visibility_m": visibility, "fog": False, "weather_codes": [],
            "temperature_c": None, "dewpoint_c": None, "wind_kt": None,
            "reports": 0,
        })
        item["visibility_m"] = min(item["visibility_m"], visibility)
        item["fog"] = item["fog"] or observed_fog
        item["weather_codes"] = sorted(set(item["weather_codes"] + codes.split()))
        item["reports"] += 1
        for field, column in (("temperature_c", "tmpf"), ("dewpoint_c", "dwpf"), ("wind_kt", "sknt")):
            try:
                value = float(row[column])
                item[field] = value if item[field] is None else (item[field] + value) / 2
            except (KeyError, TypeError, ValueError):
                pass
    result = [{"time": stamp, **hourly[stamp]} for stamp in sorted(hourly)]
    if not result:
        raise RuntimeError(f"IEM returned no usable METAR observations for {STATION}")
    return result


def date_chunks():
    current = START_DATE
    while current <= END_DATE:
        stop = min(date(current.year, 12, 31), END_DATE)
        yield current, stop
        current = stop + timedelta(days=1)


def fetch_open_meteo():
    records = {}
    for first, last in date_chunks():
        response = http_get(OPEN_METEO_URL, params={
            "latitude": CENTER[1], "longitude": CENTER[0],
            "start_date": first.isoformat(), "end_date": last.isoformat(),
            "hourly": OPEN_METEO_HOURLY, "timezone": "UTC",
        }, timeout=300)
        payload = response.json()
        hourly = payload.get("hourly", {})
        for index, stamp in enumerate(hourly.get("time", [])):
            key = stamp.replace("-", "").replace("T", "").replace(":", "")[:10]
            records[key] = {
                "temperature_c": hourly["temperature_2m"][index],
                "dewpoint_c": hourly["dew_point_2m"][index],
                "relative_humidity": hourly["relative_humidity_2m"][index],
                "wind_kmh": hourly["wind_speed_10m"][index],
                "low_cloud_pct": hourly["cloud_cover_low"][index],
            }
    if not records:
        raise RuntimeError("Open-Meteo returned no hourly records")
    return [{"time": stamp, **records[stamp]} for stamp in sorted(records)]


def fetch_nasa_power():
    records = {}
    for first, last in date_chunks():
        response = http_get(POWER_URL, params={
            "parameters": POWER_PARAMETERS, "community": "AG",
            "longitude": CENTER[0], "latitude": CENTER[1],
            "start": first.strftime("%Y%m%d"), "end": last.strftime("%Y%m%d"),
            "format": "JSON", "time-standard": "UTC",
        }, timeout=300)
        parameters = response.json()["properties"]["parameter"]
        for stamp, temp in parameters["T2M"].items():
            def value(key):
                number = parameters[key].get(stamp)
                return None if number is None or number == -999 else number
            records[stamp] = {
                "temperature_c": temp if temp != -999 else None,
                "dewpoint_c": value("T2MDEW"),
                "relative_humidity": value("RH2M"),
                "wind_ms": value("WS2M"),
            }
    return [{"time": stamp, **records[stamp]} for stamp in sorted(records)]


def main():
    metar = fetch_metar()
    print(f"IEM {STATION}: {len(metar)} observed hourly records, "
          f"{sum(bool(x['fog']) for x in metar)} fog hours", flush=True)

    meteo, meteo_source, meteo_error = [], None, None
    try:
        meteo = fetch_open_meteo()
        meteo_source = "ERA5 via Open-Meteo archive API"
    except (RuntimeError, ValueError, KeyError, OSError, requests.RequestException) as exc:
        meteo_error = str(exc)
        print(f"Open-Meteo unavailable: {exc}; trying NASA POWER", flush=True)
    if not meteo:
        meteo = fetch_nasa_power()
        meteo_source = "NASA POWER MERRA-2 (cloud cover unavailable)"

    (RAW / "fog_metar.json").write_text(json.dumps({
        "station": STATION, "source": "Iowa Environmental Mesonet ASOS archive",
        "period": {"start": START_DATE.isoformat(), "end": END_DATE.isoformat()},
        "records": metar,
    }, separators=(",", ":")))
    (RAW / "fog_meteorology.json").write_text(json.dumps({
        "source": meteo_source, "fallback_reason": meteo_error, "records": meteo,
    }, separators=(",", ":")))
    print(f"Hourly meteorology: {len(meteo)} records from {meteo_source}", flush=True)

    power_error = None
    try:
        power = fetch_nasa_power()
    except (RuntimeError, ValueError, KeyError, OSError, requests.RequestException) as exc:
        power = []
        power_error = str(exc)
        print(f"Optional NASA POWER series unavailable: {exc}", flush=True)
    (RAW / "fog_power.json").write_text(json.dumps({
        "source": "NASA POWER hourly MERRA-2: " + POWER_PARAMETERS,
        "reason": power_error,
        "records": power,
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
