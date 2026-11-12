"""AirNerve screening model for Sofia.

  1. Episodes and yearly exceedance counts from the CAMS European model at the city centre.
  2. A static local-enhancement factor on a ~250 m grid from citizen sensors
     (long-term sensor/CAMS ratio, interpolated), with a confidence raster.
  3. Leave-one-sensor-out validation, CAMS-versus-sensor agreement and an
     independent comparison with the official EEA urban-background station.
  4. Hotspots and a risk register using OpenStreetMap sensitive sites.

The fused surface is a screening estimate, not an official air-quality assessment.
"""
import csv
import io
import json
import math
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import requests
from PIL import Image

from config import BBOX, CENTER, CITY, END_DATE, OUT, RAW, START_DATE, http_get

AIR = RAW / "air"
TZ = ZoneInfo("Europe/Sofia")
UTC = timezone.utc

# ── Thresholds (µg/m³), each with its source ──
THRESHOLDS = {
    "who_pm25_24h": {"value": 15, "source": "WHO global air quality guidelines 2021, Table 3.26 (AQG level, 24-hour)"},
    "who_pm25_year": {"value": 5, "source": "WHO global air quality guidelines 2021, Table 3.26 (AQG level, annual)"},
    "who_pm10_24h": {"value": 45, "source": "WHO global air quality guidelines 2021, Table 3.26 (AQG level, 24-hour)"},
    "who_pm10_year": {"value": 15, "source": "WHO global air quality guidelines 2021, Table 3.26 (AQG level, annual)"},
    "who_no2_24h": {"value": 25, "source": "WHO global air quality guidelines 2021, Table 3.26 (AQG level, 24-hour)"},
    "who_no2_year": {"value": 10, "source": "WHO global air quality guidelines 2021, Table 3.26 (AQG level, annual)"},
    "eu_pm10_24h": {"value": 50, "allowed_per_year": 35, "source": "Directive 2008/50/EC limit value (European Commission, EU air quality standards)"},
    "eu_pm10_year": {"value": 40, "source": "Directive 2008/50/EC limit value"},
    "eu_pm25_year": {"value": 25, "source": "Directive 2008/50/EC limit value"},
    "eu_no2_year": {"value": 40, "source": "Directive 2008/50/EC limit value"},
}
EEA_BANDS = {  # upper limits of Good, Fair, Moderate, Poor, Very poor (airindex.eea.europa.eu, read 2026-11-12)
    "pm2_5": [5, 15, 50, 90, 140], "pm10": [15, 45, 120, 195, 270],
    "nitrogen_dioxide": [10, 25, 60, 100, 150], "ozone": [60, 100, 120, 160, 180],
    "sulphur_dioxide": [20, 40, 125, 190, 275],
}

# ── Tunable assumptions ──
MIN_HOURS_PER_DAY = 18
MAX_EPISODES = 12
EPISODE_WINDOW_DAYS = 7          # hours exported per episode, centred on the worst day
GRID_CELL_M = 250
SENSOR_MAX_PM = 999.9            # SDS011 range; the top of the range is saturation
SENSOR_RATIO_TOLERANCE = 1.0     # PM2.5 may exceed PM10 only by rounding noise
HUMIDITY_MAX = 85.0              # above this, optical sensors over-read (droplets): discard
STUCK_RUN = 6                    # identical consecutive PM2.5 readings
MIN_READINGS_PER_HOUR = 3
MIN_HOURS_PER_SENSOR = 48
KERNEL_SIGMA_M = 1500            # interpolation length scale for the local factor
SHRINK_WEIGHT = 1.5              # pulls sparse estimates back towards CAMS (factor 1)
CONFIDENCE_RADIUS_M = 2000
MIN_SENSORS_IN_RADIUS = 3        # fewer than this → CAMS-only
FULL_SENSORS_IN_RADIUS = 5
FACTOR_CLIP = (0.5, 2.0)
MODEL_ONLY_BELOW = 0.34          # same threshold the map uses for hatching
HOTSPOT_SPACING_M = 800
MAX_HOTSPOTS = 12
SITE_RADIUS_M = 500
HEATING_EVENING_RATIO = 1.5      # winter 17–23 h vs 11–15 h local, sensor medians
MIN_SPATIAL_SKILL = 0.3          # leave-one-out r needed before the local factor is used at all
AGREE_RADIUS_M = 1000            # a measured hotspot is "medium" confidence if a neighbour agrees


def metres(lon1, lat1, lon2, lat2):
    scale = math.cos(math.radians((lat1 + lat2) / 2))
    return np.hypot((np.asarray(lon2) - lon1) * 111320 * scale, (np.asarray(lat2) - lat1) * 111320)


def utc_hour(stamp):
    return datetime.strptime(stamp[:13], "%Y-%m-%dT%H").replace(tzinfo=UTC)


# ── inputs ──
def load_points(prefix, fields):
    files = sorted(AIR.glob(f"{prefix}_*.json"))
    if not files:
        raise SystemExit(f"No {prefix} files in {AIR}. Run fetch_air_inputs.py first.")
    times, data, lons, lats = [], {field: [] for field in fields}, None, None
    for path in files:
        payload = json.loads(path.read_text())
        lons, lats = payload["lons"], payload["lats"]
        points = payload["points"]
        times += points[0]["hourly"]["time"]
        for field in fields:
            data[field].append(np.array([[np.nan if v is None else v for v in p["hourly"][field]] for p in points],
                                        dtype=np.float32).T)
    index = {stamp: i for i, stamp in enumerate(times)}
    return {"time": times, "index": index, "lons": lons, "lats": lats,
            **{field: np.concatenate(data[field]) for field in fields}}


def weights_at(lons, lats, lon, lat):
    """Bilinear weights on the lattice (points ordered south→north, west→east)."""
    def place(axis, value):
        if value <= axis[0]:
            return 0, 0, 0.0
        if value >= axis[-1]:
            return len(axis) - 1, len(axis) - 1, 0.0
        low = max(i for i in range(len(axis) - 1) if axis[i] <= value)
        return low, low + 1, (value - axis[low]) / (axis[low + 1] - axis[low])
    x0, x1, tx = place(lons, lon)
    y0, y1, ty = place(lats, lat)
    width = len(lons)
    w = np.zeros(len(lons) * len(lats), dtype=np.float64)
    for x, y, weight in ((x0, y0, (1 - tx) * (1 - ty)), (x1, y0, tx * (1 - ty)), (x0, y1, (1 - tx) * ty), (x1, y1, tx * ty)):
        w[y * width + x] += weight
    return w


def at(series, w):
    """Series (T, P) at a location with weights w; nan-aware."""
    valid = ~np.isnan(series)
    total = np.where(valid, series, 0) @ w
    weight = valid.astype(np.float64) @ w
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(weight > 0, total / weight, np.nan)


def local_daily(times, values, min_hours=MIN_HOURS_PER_DAY):
    """Local calendar-day means from an hourly UTC series (any trailing axes)."""
    days = defaultdict(list)
    for i, stamp in enumerate(times):
        days[utc_hour(stamp).astimezone(TZ).date()].append(i)
    keys = sorted(days)
    out = np.full((len(keys),) + values.shape[1:], np.nan, dtype=np.float64)
    for d, key in enumerate(keys):
        rows = values[days[key]]
        count = np.sum(~np.isnan(rows), axis=0)
        with np.errstate(invalid="ignore"):
            mean = np.nanmean(rows, axis=0) if rows.size else np.nan
        out[d] = np.where(count >= min_hours, mean, np.nan)
    return keys, out


# ── 1. episodes and yearly counts ──
def episodes(cams, weather, centre_w):
    pm25 = at(cams["pm2_5"], centre_w)
    days, daily = local_daily(cams["time"], pm25[:, None])
    daily = daily[:, 0]
    limit = THRESHOLDS["who_pm25_24h"]["value"]
    runs, current = [], []
    for day, value in zip(days, daily):
        if not np.isnan(value) and value > limit and (not current or day - current[-1][0] == timedelta(days=1)):
            current.append((day, value))
        else:
            if current:
                runs.append(current)
            current = [(day, value)] if not np.isnan(value) and value > limit else []
    if current:
        runs.append(current)
    runs.sort(key=lambda run: -sum(v - limit for _, v in run))
    keep = sorted(runs[:MAX_EPISODES], key=lambda run: run[0][0])
    fields = {"pm25": "pm2_5", "pm10": "pm10", "no2": "nitrogen_dioxide", "o3": "ozone"}
    out = []
    for n, run in enumerate(keep):
        peak_day, peak = max(run, key=lambda item: item[1])
        first = max(run[0][0], peak_day - timedelta(days=EPISODE_WINDOW_DAYS // 2))
        last = min(run[-1][0] + timedelta(days=1), first + timedelta(days=EPISODE_WINDOW_DAYS - 1))
        start = datetime(first.year, first.month, first.day, tzinfo=TZ).astimezone(UTC)
        stop = datetime(last.year, last.month, last.day, 23, tzinfo=TZ).astimezone(UTC)
        idx = [cams["index"][stamp] for stamp in cams["time"] if start <= utc_hour(stamp) <= stop]
        widx = [weather["index"].get(cams["time"][i]) for i in idx]
        round_rows = lambda rows: [[None if np.isnan(v) else round(float(v), 1) for v in row] for row in rows]
        evening, midday = [], []
        for i in idx:
            hour = utc_hour(cams["time"][i]).astimezone(TZ).hour
            (evening if 17 <= hour <= 23 else midday if 11 <= hour <= 15 else []).append(pm25[i])
        winds = [float(np.nanmean(weather["wind_speed_10m"][j])) for j in widx if j is not None]
        mean_wind = float(np.mean(winds)) if winds else None
        hints = []
        if peak_day.month in (11, 12, 1, 2, 3) and evening and midday and np.nanmedian(evening) >= HEATING_EVENING_RATIO * np.nanmedian(midday):
            hints.append("Winter evening peaks in the model suggest domestic heating.")
        if mean_wind is not None and mean_wind < 2.0:
            hints.append(f"Light winds (mean {mean_wind:.1f} m/s) limited dispersion.")
        out.append({
            "id": f"AE-{n + 1:02d}", "start": run[0][0].isoformat(), "end": run[-1][0].isoformat(),
            "days": len(run), "peak_day": peak_day.isoformat(), "peak_day_pm25": round(float(peak), 1),
            "mean_pm25": round(float(np.mean([v for _, v in run])), 1),
            "excess": round(float(sum(v - limit for _, v in run)), 1),
            "window": {"start": cams["time"][idx[0]], "hours": len(idx),
                       "note": f"{len(idx) // 24}-day window around the worst day" if len(run) > EPISODE_WINDOW_DAYS else "whole episode plus one day"},
            "time": [cams["time"][i] + ":00Z" for i in idx],
            "lattice": {"lons": cams["lons"], "lats": cams["lats"]},
            "values": {key: round_rows(cams[field][idx]) for key, field in fields.items()},
            "wind": {
                "speed": round_rows([weather["wind_speed_10m"][j] if j is not None else np.full(len(cams["lons"]) * len(cams["lats"]), np.nan) for j in widx]),
                "direction": round_rows([weather["wind_direction_10m"][j] if j is not None else np.full(len(cams["lons"]) * len(cams["lats"]), np.nan) for j in widx]),
            },
            "mean_wind_ms": None if mean_wind is None else round(mean_wind, 1),
            "cause_hints": hints,
        })
    return out, len(runs)


def yearly(cams, centre_w):
    series = {key: at(cams[key], centre_w) for key in ("pm2_5", "pm10", "nitrogen_dioxide")}
    days, daily = local_daily(cams["time"], np.stack([series["pm2_5"], series["pm10"], series["nitrogen_dioxide"]], axis=1))
    rows = {}
    for day, (pm25, pm10, no2) in zip(days, daily):
        row = rows.setdefault(day.year, {"year": day.year, "days": 0, "pm25": [], "pm10": [], "no2": []})
        if np.isnan(pm25):
            continue
        row["days"] += 1
        row["pm25"].append(pm25)
        row["pm10"].append(pm10)
        row["no2"].append(no2)
    out = []
    for year in sorted(rows):
        row = rows[year]
        pm25, pm10, no2 = (np.array(row[k]) for k in ("pm25", "pm10", "no2"))
        out.append({
            "year": year, "days_with_data": row["days"], "complete": row["days"] >= 330,
            "pm25_days_above_who": int(np.sum(pm25 > THRESHOLDS["who_pm25_24h"]["value"])),
            "pm10_days_above_who": int(np.sum(pm10 > THRESHOLDS["who_pm10_24h"]["value"])),
            "pm10_days_above_eu_limit": int(np.sum(pm10 > THRESHOLDS["eu_pm10_24h"]["value"])),
            "no2_days_above_who": int(np.sum(no2 > THRESHOLDS["who_no2_24h"]["value"])),
            "pm25_mean": round(float(np.mean(pm25)), 1) if pm25.size else None,
            "pm10_mean": round(float(np.mean(pm10)), 1) if pm10.size else None,
            "no2_mean": round(float(np.nanmean(no2)), 1) if no2.size else None,
        })
    return out


# ── 2. citizen sensors ──
def read_csv(path):
    text = path.read_text()
    return list(csv.DictReader(io.StringIO(text), delimiter=";")) if text.strip() else []


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def sensor_hours(node, weather, rh_weights):
    """Screened hourly medians for one node. Returns {utc_hour: pm25} and a QC tally."""
    tally = defaultdict(int)
    pm_rows, rh_rows = [], []
    for path in sorted(AIR.joinpath("sensor_archive").glob(f"*_{node['pm']['type'].lower()}_sensor_{node['pm']['id']}.csv")):
        pm_rows += read_csv(path)
    for path in sorted(AIR.joinpath("sensor_archive").glob(f"*_{node['humidity']['type'].lower()}_sensor_{node['humidity']['id']}.csv")):
        rh_rows += read_csv(path)
    humidity = defaultdict(list)
    for row in rh_rows:
        value = number(row.get("humidity"))
        if value is not None and 0 <= value <= 100:
            humidity[row["timestamp"][:13]].append(value)
    readings = defaultdict(list)
    run_value, run = None, []
    for row in pm_rows:
        tally["readings"] += 1
        p2, p1 = number(row.get("P2")), number(row.get("P1"))
        if p2 is None:
            tally["missing"] += 1
            continue
        if p2 < 0 or p2 >= SENSOR_MAX_PM or (p1 is not None and (p1 >= SENSOR_MAX_PM or p2 > p1 + SENSOR_RATIO_TOLERANCE)):
            tally["non_physical"] += 1
            continue
        hour = row["timestamp"][:13]
        if p2 == run_value:
            run.append(hour)
        else:
            run_value, run = p2, [hour]
        if len(run) == STUCK_RUN:  # drop the whole run, then every further repeat
            for stuck_hour in run[:-1]:
                if readings[stuck_hour]:
                    readings[stuck_hour].pop()
            tally["stuck"] += STUCK_RUN
            continue
        if len(run) > STUCK_RUN:
            tally["stuck"] += 1
            continue
        rh = np.median(humidity[hour]) if humidity.get(hour) else None
        if rh is None:
            j = weather["index"].get(hour + ":00")
            rh = float(weather["relative_humidity_2m"][j] @ rh_weights) if j is not None else None
            tally["humidity_from_model"] += 1
        if rh is not None and rh > HUMIDITY_MAX:
            tally["humid"] += 1
            continue
        readings[hour].append(p2)
    hourly = {hour: float(np.median(values)) for hour, values in readings.items() if len(values) >= MIN_READINGS_PER_HOUR}
    tally["hours"] = len(hourly)
    return hourly, dict(tally)


def sensor_stats(cams, weather):
    manifest = json.loads((AIR / "sensor_archive.json").read_text())
    nodes, totals = [], defaultdict(int)
    for node in manifest["sample_nodes"]:
        w = weights_at(cams["lons"], cams["lats"], node["lon"], node["lat"])
        hourly, tally = sensor_hours(node, weather, w)
        for key, value in tally.items():
            totals[key] += value
        pairs = [(hour, value, float(at(cams["pm2_5"][[cams["index"][hour + ":00"]]], w)[0]))
                 for hour, value in hourly.items() if hour + ":00" in cams["index"]]
        pairs = [p for p in pairs if not np.isnan(p[2])]
        if len(pairs) < MIN_HOURS_PER_SENSOR:
            continue
        sensor = np.array([p[1] for p in pairs])
        model = np.array([p[2] for p in pairs])
        winter_evening, winter_midday = [], []
        for hour, value, _ in pairs:
            local = utc_hour(hour).astimezone(TZ)
            if local.month in (12, 1, 2):
                if 17 <= local.hour <= 23:
                    winter_evening.append(value)
                elif 11 <= local.hour <= 15:
                    winter_midday.append(value)
        nodes.append({
            "id": node["pm"]["id"], "lon": node["lon"], "lat": node["lat"], "hours": len(pairs),
            "log_ratio": float(np.median(np.log((sensor + 1) / (model + 1)))),
            "pairs": pairs, "weights": w,
            "winter_evening_ratio": (float(np.median(winter_evening) + 1) / float(np.median(winter_midday) + 1))
            if len(winter_evening) >= 6 and len(winter_midday) >= 6 else None,
        })
    return nodes, dict(totals), manifest


def grid_spec():
    west, south, east, north = BBOX
    lat0 = (south + north) / 2
    width = int(round((east - west) * 111320 * math.cos(math.radians(lat0)) / GRID_CELL_M))
    height = int(round((north - south) * 111320 / GRID_CELL_M))
    lons = west + (np.arange(width) + 0.5) * (east - west) / width
    lats = north - (np.arange(height) + 0.5) * (north - south) / height
    return width, height, *np.meshgrid(lons, lats)


def kernel_field(nodes, lon, lat, residual, exclude=None):
    """Gaussian-weighted mean of residual log ratios, its total weight and the count within the radius."""
    keep = [i for i in range(len(nodes)) if i != exclude]
    xs = np.array([nodes[i]["lon"] for i in keep])
    ys = np.array([nodes[i]["lat"] for i in keep])
    rs = np.array([residual[i] for i in keep])
    lon, lat = np.asarray(lon, dtype=np.float64), np.asarray(lat, dtype=np.float64)
    scale = math.cos(math.radians(CENTER[1]))
    distance = np.hypot((lon[..., None] - xs) * 111320 * scale, (lat[..., None] - ys) * 111320)
    weight = np.exp(-0.5 * (distance / KERNEL_SIGMA_M) ** 2)
    total = weight.sum(axis=-1)
    mean = np.where(total > 1e-9, (weight * rs).sum(axis=-1) / np.maximum(total, 1e-9), 0)
    count = (distance <= CONFIDENCE_RADIUS_M).sum(axis=-1)
    return mean, total, count


def confidence_of(total, count):
    by_count = np.clip((count - (MIN_SENSORS_IN_RADIUS - 1)) / (FULL_SENSORS_IN_RADIUS - MIN_SENSORS_IN_RADIUS + 1), 0, 1)
    return by_count * total / (total + SHRINK_WEIGHT)


def factor_of(mean, total, count):
    return np.clip(np.exp(mean * confidence_of(total, count)), *FACTOR_CLIP)


def scores(predicted, observed, min_n=10):
    predicted, observed = np.asarray(predicted), np.asarray(observed)
    if len(observed) < min_n:
        return None
    return {"n": int(len(observed)), "mae": round(float(np.mean(np.abs(predicted - observed))), 2),
            "bias": round(float(np.mean(predicted - observed)), 2),
            "r": round(float(np.corrcoef(predicted, observed)[0, 1]), 3)}


def validation(nodes, residual):
    cams_pred, fused_pred, observed, spatial = [], [], [], []
    for i, node in enumerate(nodes):
        mean, total, count = kernel_field(nodes, node["lon"], node["lat"], residual, exclude=i)
        factor = float(factor_of(mean, total, count))
        spatial.append((float(mean * confidence_of(total, count)), residual[i]))
        for _, value, model in node["pairs"]:
            cams_pred.append(model)
            fused_pred.append(model * factor)
            observed.append(value)
    xs, ys = zip(*spatial) if spatial else ((), ())
    return {
        "method": "Leave-one-sensor-out: each sensor's local factor is rebuilt from the other sensors only, "
                  "then the fused hourly estimate (CAMS × factor) is compared with that sensor's screened hourly medians.",
        "sensors": len(nodes),
        "cams_vs_sensor": scores(cams_pred, observed),
        "fused_vs_sensor_loso": scores(fused_pred, observed),
        "spatial_pattern_r": round(float(np.corrcoef(xs, ys)[0, 1]), 3) if len(xs) > 5 and np.std(xs) > 0 else None,
        "units": "µg/m³ PM2.5, hourly",
    }


def reference_check(cams, centre_w, nodes):
    path = AIR / "eea_reference.json"
    if not path.exists():
        return {"status": "unavailable", "reason": "Reference fetch has not run."}
    reference = json.loads(path.read_text())
    if reference.get("status") != "available":
        return {"status": "unavailable", "reason": reference.get("reason")}
    centre = {"PM2.5": at(cams["pm2_5"], centre_w), "PM10": at(cams["pm10"], centre_w)}
    cams_days, cams_daily = local_daily(cams["time"], np.stack([centre["PM2.5"], centre["PM10"]], axis=1))
    cams_by_day = {day: row for day, row in zip(cams_days, cams_daily)}
    # City-wide sensor median per local day (sample days only)
    sensor_days = defaultdict(lambda: defaultdict(list))
    for node in nodes:
        for hour, value, _ in node["pairs"]:
            day = utc_hour(hour).astimezone(TZ).date()
            sensor_days[day][node["id"]].append(value)
    sensor_daily = {day: float(np.median([np.mean(v) for v in by_node.values() if len(v) >= MIN_HOURS_PER_DAY]))
                    for day, by_node in sensor_days.items()
                    if sum(len(v) >= MIN_HOURS_PER_DAY for v in by_node.values()) >= 5}
    stations = []
    for series in reference["stations"]:
        hours = {stamp: value for stamp, value in series["values"]}
        times = sorted(hours)
        if not times:
            continue
        days, daily = local_daily([t + ":00" for t in times], np.array([[hours[t]] for t in times]))
        column = 0 if series["pollutant"] == "PM2.5" else 1
        model_pairs = [(cams_by_day[d][column], v[0]) for d, v in zip(days, daily) if d in cams_by_day and not np.isnan(v[0]) and not np.isnan(cams_by_day[d][column])]
        sensor_pairs = [(sensor_daily[d], v[0]) for d, v in zip(days, daily) if d in sensor_daily and not np.isnan(v[0])] if series["pollutant"] == "PM2.5" else []
        stations.append({
            "station": series["station"], "sampling_point": series["sampling_point"], "pollutant": series["pollutant"],
            "type": series["type"], "area": series["area"], "altitude_m": series["altitude_m"],
            "period": [times[0][:10], times[-1][:10]],
            "cams_centre_vs_station_daily": scores(*zip(*model_pairs)) if len(model_pairs) >= 10 else None,
            "sensor_city_median_vs_station_daily": scores(*zip(*sensor_pairs), min_n=5) if len(sensor_pairs) >= 5 else None,
            "sensor_days": len(sensor_pairs),
        })
    return {
        "status": "available" if stations else "unavailable",
        "source": reference["source"],
        "note": "EEA metadata gives no coordinates for these Bulgarian stations, so the model is compared at the "
                "city centre and the sensors as a city-wide daily median. Station times are converted from the "
                "reported UTC+01 time zone. E2a data are provisional (not yet verified by the reporting country).",
        "stations": stations,
    }


# ── 3. grid products, sites, hotspots ──
def load_sites():
    path = OUT / "air_sites.geojson"
    if not path.exists():
        return None
    return json.loads(path.read_text())["features"]


def nominatim(lon, lat, cache):
    key = f"{lon:.4f},{lat:.4f}"
    if key not in cache:
        try:
            time.sleep(1.1)
            address = http_get("https://nominatim.openstreetmap.org/reverse", params={
                "format": "jsonv2", "lat": lat, "lon": lon, "zoom": 16, "accept-language": "en"}, timeout=30).json().get("address", {})
            cache[key] = {"name": address.get("neighbourhood") or address.get("quarter") or address.get("suburb") or address.get("road"),
                          "district": address.get("city_district") or address.get("suburb")}
        except (requests.RequestException, ValueError) as exc:
            print(f"Nominatim unavailable for {key}: {exc}", flush=True)
            cache[key] = {}
    return cache[key]


def main():
    cams = load_points("cams", ["pm2_5", "pm10", "nitrogen_dioxide", "ozone", "sulphur_dioxide"])
    weather = load_points("weather", ["wind_speed_10m", "wind_direction_10m", "relative_humidity_2m"])
    centre_w = weights_at(cams["lons"], cams["lats"], CENTER[0], CENTER[1])
    print(f"CAMS: {len(cams['time'])} hours × {len(centre_w)} lattice points", flush=True)

    events, episode_count = episodes(cams, weather, centre_w)
    years = yearly(cams, centre_w)
    print(f"Episodes: {episode_count} found, {len(events)} kept", flush=True)

    nodes, qc, manifest = sensor_stats(cams, weather)
    print(f"Sensors with ≥{MIN_HOURS_PER_SENSOR} screened hours: {len(nodes)}; QC {qc}", flush=True)
    level = float(np.median([n["log_ratio"] for n in nodes])) if nodes else 0.0
    residual = [n["log_ratio"] - level for n in nodes]

    width, height, lon_grid, lat_grid = grid_spec()
    if nodes:
        mean, total, count = kernel_field(nodes, lon_grid, lat_grid, residual)
        confidence = confidence_of(total, count)
        factor = factor_of(mean, total, count)
    else:
        confidence = np.zeros((height, width))
        factor = np.ones((height, width))
    checks = validation(nodes, residual) if len(nodes) > 5 else {"status": "insufficient sensors", "sensors": len(nodes)}
    reference = reference_check(cams, centre_w, nodes)

    # The factor is only used if it predicts held-out sensors; otherwise it would be an invented pattern.
    skill = checks.get("spatial_pattern_r")
    factor_applied = skill is not None and skill >= MIN_SPATIAL_SKILL
    factor_range = [round(float(factor.min()), 2), round(float(factor.max()), 2)]
    share_informed = round(float(np.mean(confidence >= MODEL_ONLY_BELOW)), 3)
    for name in ("air_local_factor.png", "air_confidence.png"):
        (OUT / name).unlink(missing_ok=True)
    if factor_applied:
        image = np.zeros((height, width, 4), dtype=np.uint8)
        image[..., 0] = np.clip(np.round(factor / 2 * 255), 0, 255)
        image[..., 3] = 255
        Image.fromarray(image, "RGBA").save(OUT / "air_local_factor.png", optimize=True)
        image[..., 0] = np.clip(np.round(confidence * 255), 0, 255)
        Image.fromarray(image, "RGBA").save(OUT / "air_confidence.png", optimize=True)
        factor_status = f"applied: leave-one-out spatial skill r = {skill}"
    else:
        factor = np.ones((height, width))
        confidence = np.zeros((height, width))
        factor_status = (f"not applied: the factor rebuilt without each sensor did not predict that sensor "
                         f"(spatial skill r = {skill}, threshold {MIN_SPATIAL_SKILL}). The map shows CAMS alone and "
                         "the register lists measured sensor locations instead of modelled neighbourhoods.")
    print(f"Local factor {factor_status}", flush=True)

    # Long-term mean and exceedance days per grid cell (CAMS bilinear × local factor)
    flat_lon, flat_lat = lon_grid.ravel(), lat_grid.ravel()
    cell_w = np.stack([weights_at(cams["lons"], cams["lats"], x, y) for x, y in zip(flat_lon, flat_lat)])
    point_mean = np.nanmean(cams["pm2_5"], axis=0)
    cell_mean = (cell_w @ point_mean) * factor.ravel()
    days, point_daily = local_daily(cams["time"], cams["pm2_5"])
    complete = ~np.isnan(point_daily).any(axis=1)
    cell_daily = (point_daily[complete] @ cell_w.T) * factor.ravel()
    years_covered = max(1.0, complete.sum() / 365.25)
    exceed = (cell_daily > THRESHOLDS["who_pm25_24h"]["value"]).sum(axis=0) / years_covered
    worst_day_index = np.argmax(cell_daily, axis=0)
    complete_days = [d for d, ok in zip(days, complete) if ok]

    sites = load_sites()
    site_count = np.zeros(flat_lon.size)
    if sites:
        site_xy = np.array([s["geometry"]["coordinates"] for s in sites])
        for k in range(flat_lon.size):
            site_count[k] = np.sum(metres(flat_lon[k], flat_lat[k], site_xy[:, 0], site_xy[:, 1]) <= SITE_RADIUS_M)

    conf_flat = confidence.ravel()
    eligible = np.flatnonzero(conf_flat >= MODEL_ONLY_BELOW) if factor_applied else np.array([], dtype=int)
    hotspots = [] if factor_applied else sensor_hotspots(nodes, sites, level)
    if eligible.size:
        rank = lambda values: (np.argsort(np.argsort(values)) + 1) / len(values)
        score = 0.6 * rank(cell_mean[eligible]) + 0.25 * rank(exceed[eligible]) + 0.15 * np.minimum(site_count[eligible], 10) / 10
        geocode_path = AIR / "geocode.json"
        geocode = json.loads(geocode_path.read_text()) if geocode_path.exists() else {}
        for k in eligible[np.argsort(-score)]:
            lon, lat = float(flat_lon[k]), float(flat_lat[k])
            if any(metres(lon, lat, h["coord"][0], h["coord"][1]) < HOTSPOT_SPACING_M for h in hotspots):
                continue
            near_nodes = [n for n in nodes if metres(lon, lat, n["lon"], n["lat"]) <= CONFIDENCE_RADIUS_M]
            heating = [n["winter_evening_ratio"] for n in near_nodes if n["winter_evening_ratio"] is not None]
            hint = None
            if len(heating) >= 2 and np.median(heating) >= HEATING_EVENING_RATIO:
                hint = f"Winter evening readings are {np.median(heating):.1f}× the midday level at nearby sensors, which suggests domestic heating."
            near_sites = [s for s in (sites or []) if metres(lon, lat, *s["geometry"]["coordinates"]) <= SITE_RADIUS_M]
            kinds = defaultdict(int)
            for s in near_sites:
                kinds[s["properties"]["kind"]] += 1
            place = nominatim(lon, lat, geocode)
            conf = float(conf_flat[k])
            hotspots.append({
                "basis": "derived",
                "id": f"AH-{len(hotspots) + 1:02d}", "name": place.get("name") or f"{lat:.3f}° N, {lon:.3f}° E",
                "district": place.get("district") or CITY, "coord": [round(lon, 5), round(lat, 5)],
                "score": int(round(float(score[np.where(eligible == k)[0][0]]) * 100)),
                "mean_pm25": round(float(cell_mean[k]), 1), "local_factor": round(float(factor.ravel()[k]), 2),
                "pm25_days_above_who_per_year": round(float(exceed[k]), 1),
                "worst_day": complete_days[int(worst_day_index[k])].isoformat(),
                "worst_day_pm25": round(float(cell_daily[int(worst_day_index[k]), k]), 1),
                "sensors_within_2km": len(near_nodes), "confidence": round(conf, 2),
                "confidence_level": "high" if conf >= 0.67 and len(near_nodes) >= 8 else "medium",
                "sites_within_500m": len(near_sites), "sites_by_kind": dict(kinds),
                "site_names": sorted({s["properties"]["name"] for s in near_sites if s["properties"]["name"]})[:6],
                "cause_hint": hint,
                "name_source": "Nominatim reverse geocoding" if place.get("name") else "coordinates",
            })
            if len(hotspots) >= MAX_HOTSPOTS:
                break
        geocode_path.write_text(json.dumps(geocode, ensure_ascii=False))

    # City-wide traffic signal in CAMS NO2 (weekday vs weekend morning rush)
    no2_centre = at(cams["nitrogen_dioxide"], centre_w)
    weekday, weekend = [], []
    for stamp, value in zip(cams["time"], no2_centre):
        local = utc_hour(stamp).astimezone(TZ)
        if 7 <= local.hour <= 9 and not np.isnan(value):
            (weekend if local.weekday() >= 5 else weekday).append(value)
    rush_ratio = float(np.mean(weekday) / np.mean(weekend)) if weekday and weekend else None

    register = [{
        "id": h["id"], "basis": h["basis"], "name": h["name"], "district": h["district"], "coord": h["coord"], "score": h["score"],
        "mean_pm25": h["mean_pm25"], "pm25_days_above_who_per_year": h["pm25_days_above_who_per_year"],
        "ratio_to_city": h.get("ratio_to_city"), "hours": h.get("hours"),
        "worst_day": h["worst_day"], "sites_within_500m": h["sites_within_500m"], "sites_by_kind": h["sites_by_kind"],
        "site_names": h["site_names"], "confidence_level": h["confidence_level"], "cause_hint": h["cause_hint"],
    } for h in hotspots]

    west, south, east, north = BBOX
    summary = {
        "generated": datetime.now(TZ).isoformat(timespec="minutes"),
        "city": CITY, "period": {"start": max(START_DATE, cams_days_start(cams)).isoformat(), "end": END_DATE.isoformat()},
        "thresholds": THRESHOLDS, "eea_bands": EEA_BANDS,
        "years": years, "episode_count": episode_count, "episodes_kept": len(events),
        "grid": {"bbox": [west, south, east, north], "width": width, "height": height, "cell_m": GRID_CELL_M,
                 "factor_applied": factor_applied, "factor_status": factor_status,
                 "factor_raster": "air_local_factor.png" if factor_applied else None, "factor_scale": 2,
                 "confidence_raster": "air_confidence.png" if factor_applied else None,
                 "model_only_below": MODEL_ONLY_BELOW, "min_spatial_skill": MIN_SPATIAL_SKILL,
                 "share_sensor_informed": share_informed, "factor_range": factor_range},
        "register_basis": "derived" if factor_applied else "measured",
        "sensors": {"sample_nodes": len(manifest["sample_nodes"]), "used": len(nodes), "days": manifest["days"],
                    "files_found": manifest["files_found"], "files_requested": manifest["files_requested"],
                    "archive_mb": manifest["megabytes"], "qc": qc,
                    "median_sensor_to_cams_ratio": round(math.exp(level), 2) if nodes else None,
                    "qc_rules": {"humidity_max_pct": HUMIDITY_MAX, "max_pm": SENSOR_MAX_PM, "stuck_run": STUCK_RUN,
                                 "min_readings_per_hour": MIN_READINGS_PER_HOUR, "min_hours_per_sensor": MIN_HOURS_PER_SENSOR}},
        "validation": checks, "reference": reference,
        "traffic_signal": {"no2_weekday_vs_weekend_rush_ratio": None if rush_ratio is None else round(rush_ratio, 2),
                           "note": "CAMS NO2 at the city centre, 07–09 local. A city-wide pattern at ~11 km, not a street-level measurement."},
        "model": {
            "background": "CAMS European air quality ensemble via Open-Meteo, 0.1° lattice, bilinear interpolation",
            "local_factor": f"exp(median log((sensor+1)/(CAMS+1)) per sensor minus the city median), Gaussian kernel σ={KERNEL_SIGMA_M} m, "
                            f"shrunk towards 1 where fewer than {FULL_SENSORS_IN_RADIUS} sensors lie within {CONFIDENCE_RADIUS_M} m; "
                            f"exactly 1 (CAMS only) below {MIN_SENSORS_IN_RADIUS}. The factor keeps the CAMS city-wide level and "
                            "only redistributes it in space.",
            "hotspot_score": "60% rank of long-term mean PM2.5, 25% rank of WHO 24-h exceedance days, 15% sensitive sites within 500 m (capped at 10); sensor-informed cells only",
        },
        "sources": {
            "cams": "CAMS European air quality forecasts (ENSEMBLE), Copernicus Atmosphere Monitoring Service, via Open-Meteo Air Quality API",
            "cams_note": "Open-Meteo documents its CAMS Europe series as forecasts from October 2023 and the CAMS European reanalysis before; both are model output.",
            "weather": "ERA5 via Open-Meteo archive API (10 m wind, relative humidity)",
            "sensors": "Sensor.Community archive (ODbL)",
            "sites": "OpenStreetMap via Overpass" if sites else None,
            "sites_count": len(sites) if sites else None,
            "reference": reference.get("source"),
            "satellite": "Not used: Sentinel-5P NO2 granules on the Planetary Computer are about 66 MB each; a multi-month regional mean would need over 1 GB of downloads and a NetCDF stack, beyond this prototype's budget.",
        },
    }
    (OUT / "air_events.json").write_text(json.dumps(events, separators=(",", ":")))
    (OUT / "air_hotspots.json").write_text(json.dumps(hotspots, ensure_ascii=False, separators=(",", ":")))
    (OUT / "air_risk_register.json").write_text(json.dumps(register, ensure_ascii=False, separators=(",", ":")))
    (OUT / "air_summary.json").write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
    print(f"Grid {width}×{height}, factor {factor_range}, sensor-informed share {share_informed}, applied {factor_applied}", flush=True)
    print(f"Validation: {json.dumps(checks)}", flush=True)
    print(f"Reference: {json.dumps(reference)[:900]}", flush=True)
    print(f"Hotspots: {len(hotspots)}; NO2 rush ratio {rush_ratio}", flush=True)


def sensor_hotspots(nodes, sites, level):
    """Measured fallback: sample sensors that read above the city median relative to CAMS.

    Individual low-cost sensors differ in calibration, so a single sensor is "low"
    confidence; it is "medium" only when a neighbour within 1 km also reads high.
    """
    if not nodes:
        return []
    geocode_path = AIR / "geocode.json"
    geocode = json.loads(geocode_path.read_text()) if geocode_path.exists() else {}
    ranks = {n["id"]: i / max(1, len(nodes) - 1) for i, n in enumerate(sorted(nodes, key=lambda n: n["log_ratio"]))}
    hotspots = []
    for node in sorted(nodes, key=lambda n: -n["log_ratio"]):
        if node["log_ratio"] <= level or len(hotspots) >= MAX_HOTSPOTS:
            break
        lon, lat = node["lon"], node["lat"]
        if any(metres(lon, lat, h["coord"][0], h["coord"][1]) < HOTSPOT_SPACING_M for h in hotspots):
            continue
        agree = [m for m in nodes if m is not node and m["log_ratio"] > level
                 and metres(lon, lat, m["lon"], m["lat"]) <= AGREE_RADIUS_M]
        values = np.array([p[1] for p in node["pairs"]])
        days = defaultdict(list)
        for hour, value, _ in node["pairs"]:
            days[utc_hour(hour).astimezone(TZ).date()].append(value)
        daily = {day: float(np.mean(v)) for day, v in days.items() if len(v) >= MIN_HOURS_PER_DAY}
        worst = max(daily.items(), key=lambda item: item[1]) if daily else (None, None)
        near_sites = [s for s in (sites or []) if metres(lon, lat, *s["geometry"]["coordinates"]) <= SITE_RADIUS_M]
        kinds = defaultdict(int)
        for s in near_sites:
            kinds[s["properties"]["kind"]] += 1
        ratio = node["winter_evening_ratio"]
        place = nominatim(lon, lat, geocode)
        hotspots.append({
            "basis": "measured",
            "id": f"AS-{len(hotspots) + 1:02d}", "name": place.get("name") or f"{lat:.3f}° N, {lon:.3f}° E",
            "district": place.get("district") or CITY, "coord": [round(lon, 5), round(lat, 5)],
            "sensor_id": node["id"], "score": int(round(ranks[node["id"]] * 100)),
            "mean_pm25": round(float(np.median(values)), 1), "hours": node["hours"],
            "ratio_to_city": round(math.exp(node["log_ratio"] - level), 2),
            "pm25_days_above_who_per_year": None,
            "worst_day": worst[0].isoformat() if worst[0] else None,
            "worst_day_pm25": round(worst[1], 1) if worst[1] is not None else None,
            "sensors_within_1km_agreeing": len(agree),
            "confidence_level": "medium" if agree else "low",
            "sites_within_500m": len(near_sites), "sites_by_kind": dict(kinds),
            "site_names": sorted({s["properties"]["name"] for s in near_sites if s["properties"]["name"]})[:6],
            "cause_hint": f"Winter evening readings are {ratio:.1f}× the midday level here, which suggests domestic heating."
            if ratio is not None and ratio >= HEATING_EVENING_RATIO else None,
            "name_source": "Nominatim reverse geocoding" if place.get("name") else "coordinates",
        })
    geocode_path.write_text(json.dumps(geocode, ensure_ascii=False))
    return hotspots


def cams_days_start(cams):
    return utc_hour(cams["time"][0]).date()


if __name__ == "__main__":
    main()
