"""Fetch AirNerve inputs: CAMS history, weather, citizen-sensor archive sample, EEA reference.

All sources are free and need no key. Every download is cached in RAW so a rerun
only fetches what is missing.

  CAMS European air quality (Open-Meteo)  hourly PM2.5, PM10, NO2, O3, SO2 on the 0.1° lattice
  ERA5 via Open-Meteo archive              hourly 10 m wind and relative humidity on the lattice
  Sensor.Community                         daily CSV archive for a sample of Sofia sensors
  EEA Air Quality Download Service         official station hourly PM2.5 / PM10 (independent check)
"""
import csv
import io
import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import requests

from config import BBOX, CENTER, END_DATE, RAW, START_DATE, USER_AGENT, http_get

AIR = RAW / "air"
ARCHIVE = AIR / "sensor_archive"
for folder in (AIR, ARCHIVE):
    folder.mkdir(parents=True, exist_ok=True)

CAMS_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WEATHER_URL = "https://archive-api.open-meteo.com/v1/archive"
SENSOR_AREA_URL = "https://data.sensor.community/airrohr/v1/filter/area={lat},{lon},{km}"
ARCHIVE_URL = "https://archive.sensor.community/"
EEA_URLS = "https://eeadmz1-downloads-api-appservice.azurewebsites.net/ParquetFile/urls"
EEA_METADATA = "https://ereporting.blob.core.windows.net/downloadservice/metadata.csv"

CAMS_FIELDS = "pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide"
CAMS_FIRST_DAY = date(2013, 1, 1)          # the API rejects earlier start dates (verified 2026-11-12)
SENSOR_RADIUS_KM = 15
MAX_SAMPLE_SENSORS = 40
# Sample days: winter and summer of 2026, inside the EEA up-to-date (E2a) period.
SAMPLE_DAYS = [date(2026, 1, d) for d in (8, 22)] + [date(2026, 2, d) for d in (5, 19)] + \
              [date(2026, 7, d) for d in (2, 16, 30)] + [date(2026, 8, 13)]
ARCHIVE_WORKERS = 2                         # the archive slows sharply with more parallel requests
PM_TYPES = ("SDS011", "SDS021", "PMS1003", "PMS3003", "PMS5003", "PMS6003", "PMS7003", "SPS30", "HPM", "NEXTPM")
HUMIDITY_TYPES = ("BME280", "DHT22", "SHT30", "SHT31", "SHT35", "HTU21D", "SHT85")


def lattice():
    west, south, east, north = BBOX
    lons = [round(x / 10, 1) for x in range(math.floor(west * 10 + 1e-9), math.ceil(east * 10 - 1e-9) + 1)]
    lats = [round(y / 10, 1) for y in range(math.floor(south * 10 + 1e-9), math.ceil(north * 10 - 1e-9) + 1)]
    return lons, lats


def year_chunks(first):
    current = max(first, START_DATE)
    while current <= END_DATE:
        stop = min(date(current.year, 12, 31), END_DATE)
        yield current, stop
        current = stop + timedelta(days=1)


def fetch_points(url, fields, extra, name):
    """One request per calendar year for every lattice point; cached per year."""
    lons, lats = lattice()
    points = [(lon, lat) for lat in lats for lon in lons]
    files = []
    for first, last in year_chunks(CAMS_FIRST_DAY):
        path = AIR / f"{name}_{first.isoformat()}_{last.isoformat()}.json"
        if not path.exists():
            payload = http_get(url, params={
                "latitude": ",".join(str(p[1]) for p in points),
                "longitude": ",".join(str(p[0]) for p in points),
                "hourly": fields, "start_date": first.isoformat(), "end_date": last.isoformat(),
                "timezone": "UTC", **extra,
            }, timeout=300).json()
            payload = payload if isinstance(payload, list) else [payload]
            if len(payload) != len(points):
                raise RuntimeError(f"{name}: expected {len(points)} points, got {len(payload)}")
            path.write_text(json.dumps({"lons": lons, "lats": lats, "points": [
                {"lon": p[0], "lat": p[1], "model_lon": item["longitude"], "model_lat": item["latitude"],
                 "hourly": item["hourly"]} for p, item in zip(points, payload)]}, separators=(",", ":")))
            time.sleep(1)
        files.append(path.name)
        print(f"{name}: {first} → {last} cached", flush=True)
    return files


def current_sensors():
    """Sofia sensors reporting now, with a humidity sensor at the same location when present."""
    path = AIR / "sensors_now.json"
    if not path.exists():
        url = SENSOR_AREA_URL.format(lat=CENTER[1], lon=CENTER[0], km=SENSOR_RADIUS_KM)
        path.write_text(http_get(url, timeout=60).text)
    records = json.loads(path.read_text())
    by_location = {}
    for record in records:
        location = record["location"]
        if int(location.get("indoor") or 0):
            continue
        entry = by_location.setdefault(location["id"], {"location": location["id"], "lat": float(location["latitude"]),
                                                        "lon": float(location["longitude"]), "pm": None, "humidity": None})
        kind = record["sensor"]["sensor_type"]["name"].upper()
        if kind in PM_TYPES and not entry["pm"]:
            entry["pm"] = {"id": record["sensor"]["id"], "type": kind}
        elif kind in HUMIDITY_TYPES and not entry["humidity"]:
            entry["humidity"] = {"id": record["sensor"]["id"], "type": kind}
    usable = [item for item in by_location.values() if item["pm"]]
    paired = [item for item in usable if item["humidity"]]
    # Prefer nodes with their own humidity sensor, spread over the city.
    paired.sort(key=lambda item: (round(item["lat"], 2), round(item["lon"], 2)))
    step = max(1, len(paired) // MAX_SAMPLE_SENSORS)
    sample = paired[::step][:MAX_SAMPLE_SENSORS]
    return usable, sample


_local = threading.local()


def session():
    """One keep-alive connection per worker thread."""
    if not hasattr(_local, "session"):
        _local.session = requests.Session()
        _local.session.headers["User-Agent"] = USER_AGENT
    return _local.session


def archive_path(day, sensor):
    return ARCHIVE / f"{day.isoformat()}_{sensor['type'].lower()}_sensor_{sensor['id']}.csv"


def fetch_archive_file(day, sensor):
    """Recent days live at the archive root, earlier years under /<year>/. Missing → empty marker."""
    path = archive_path(day, sensor)
    if path.exists():
        return path.stat().st_size > 0
    name = f"{day.isoformat()}_{sensor['type'].lower()}_sensor_{sensor['id']}.csv"
    for prefix in (f"{day.isoformat()}/", f"{day.year}/{day.isoformat()}/"):
        try:
            response = session().get(ARCHIVE_URL + prefix + name, timeout=60)
        except requests.RequestException:
            continue
        if response.status_code == 200 and response.text.startswith("sensor_id"):
            path.write_text(response.text)
            return True
    path.write_text("")
    return False


def fetch_sensor_archive():
    usable, sample = current_sensors()
    jobs = [(day, node[kind]) for node in sample for kind in ("pm", "humidity") for day in SAMPLE_DAYS]
    started = time.time()
    with ThreadPoolExecutor(ARCHIVE_WORKERS) as pool:
        found = list(pool.map(lambda job: fetch_archive_file(*job), jobs))
    size = sum(path.stat().st_size for path in ARCHIVE.glob("*.csv"))
    manifest = {
        "source": "Sensor.Community daily archive (archive.sensor.community)",
        "radius_km": SENSOR_RADIUS_KM, "reporting_outdoor_nodes": len(usable),
        "sample_nodes": sample, "days": [day.isoformat() for day in SAMPLE_DAYS],
        "files_requested": len(jobs), "files_found": sum(found),
        "megabytes": round(size / 1e6, 1), "seconds": round(time.time() - started),
        "note": "Nodes are today's reporting outdoor nodes that have their own humidity sensor; "
                "a node that did not exist on a sample day simply has no file.",
    }
    (AIR / "sensor_archive.json").write_text(json.dumps(manifest, indent=1))
    print(f"Sensor archive: {manifest['files_found']}/{len(jobs)} files, {manifest['megabytes']} MB, "
          f"{manifest['seconds']} s", flush=True)


def fetch_eea():
    """Official hourly PM2.5 and PM10 for Sofia stations (E2a, up-to-date, unverified)."""
    import pyarrow.parquet as pq

    result = {"source": "EEA Air Quality Download Service, dataset 1 (E2a up-to-date, not yet verified)",
              "status": "unavailable", "stations": [], "reason": None}
    try:
        metadata_path = AIR / "eea_metadata_bg.tsv"
        if not metadata_path.exists():
            text = http_get(EEA_METADATA, timeout=300).text
            metadata_path.write_text("\n".join(line for i, line in enumerate(text.splitlines())
                                               if i == 0 or line.startswith("BG\t")))
        meta = {row["SamplingPoint"]: row for row in csv.DictReader(io.StringIO(metadata_path.read_text()), delimiter="\t")}
        for pollutant in ("PM2.5", "PM10"):
            response = requests.post(EEA_URLS, json={
                "countries": ["BG"], "cities": ["Sofia"], "pollutants": [pollutant], "dataset": 1,
                "dateTimeStart": f"{START_DATE.year}-01-01T00:00:00Z", "dateTimeEnd": f"{END_DATE.isoformat()}T23:00:00Z",
                "aggregationType": "hour", "source": "API",
            }, headers={"User-Agent": USER_AGENT}, timeout=120)
            response.raise_for_status()
            urls = [line.strip() for line in response.text.lstrip("﻿").splitlines()[1:] if line.strip()]
            for url in urls:
                point = url.rsplit("/", 1)[-1].replace(".parquet", "")
                path = AIR / f"eea_{point}.parquet"
                if not path.exists():
                    path.write_bytes(http_get(url, timeout=300).content)
                table = pq.read_table(path).to_pydict()
                info = meta.get(point, {})
                zone = (info.get("Timezone") or "").rsplit("/", 1)[-1] or "UTC+01"
                offset = int(zone.replace("UTC", "") or 0)
                values = [
                    [(start - timedelta(hours=offset)).strftime("%Y-%m-%dT%H"), float(value)]
                    for start, value, validity in zip(table["Start"], table["Value"], table["Validity"])
                    if value is not None and validity is not None and int(validity) >= 1
                ]
                result["stations"].append({
                    "sampling_point": point, "pollutant": pollutant, "station": info.get("AirQualityStationEoICode"),
                    "type": info.get("AirQualityStationType"), "area": info.get("AirQualityStationArea"),
                    "altitude_m": info.get("Altitude"), "longitude": info.get("Longitude"), "latitude": info.get("Latitude"),
                    "timezone": zone, "hours": len(values), "values": values,
                })
        result["status"] = "available" if result["stations"] else "unavailable"
        if not result["stations"]:
            result["reason"] = "The download service returned no files for Sofia."
    except Exception as exc:  # noqa: BLE001 - optional independent check
        result["reason"] = str(exc)
    (AIR / "eea_reference.json").write_text(json.dumps(result, separators=(",", ":")))
    print(f"EEA reference: {result['status']}, {len(result['stations'])} series; {result['reason'] or ''}", flush=True)


def main():
    fetch_points(CAMS_URL, CAMS_FIELDS, {"domains": "cams_europe"}, "cams")
    fetch_points(WEATHER_URL, "wind_speed_10m,wind_direction_10m,relative_humidity_2m", {"wind_speed_unit": "ms"}, "weather")
    fetch_sensor_archive()
    fetch_eea()


if __name__ == "__main__":
    main()
