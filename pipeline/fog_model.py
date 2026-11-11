"""Observed-station-calibrated fog screening model for Sofia.

The event catalogue is based on actual LBSF METAR visibility/weather codes.
Meteorological probability is fitted to a held-out subset of station
observations. The city raster is a terrain-proneness downscaling, not a
visibility observation or an operational forecast.
"""
import json
import math
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
import requests
from PIL import Image
from scipy.optimize import minimize
from scipy.special import expit
from scipy.ndimage import uniform_filter

from config import FOG_VISIBILITY_M, OUT, RAW, WORK, http_get

SOFIA_TZ = ZoneInfo("Europe/Sofia")

# ── tunable screening assumptions ──
MIN_WIND_MS = 2.5
MAX_DEWPOINT_SPREAD_C = 1.5
MIN_RELATIVE_HUMIDITY = 90.0
ADVECTION_LOW_CLOUD_PCT = 60.0
MAX_EVENT_GAP_MINUTES = 90
MAX_OBSERVED_VISIBILITY_M = 10000.0
MIN_TRAINING_RECORDS = 100
HOLDOUT_FRACTION = 0.2
TERRAIN_RADIUS_CELLS = 35
TERRAIN_TPI_SCALE_M = 18.0
TERRAIN_VALLEY_BASE = 0.72
TERRAIN_TPI_FACTOR = 0.35
TERRAIN_MOISTURE_BASE = 0.9
TERRAIN_MOISTURE_FACTOR = 0.15
HOTSPOT_MIN_EVENTS = 2
HOTSPOT_MIN_SPACING_M = 300
MAX_HOTSPOTS = 12
CALIBRATION_THRESHOLD_MIN = 0.01
CALIBRATION_THRESHOLD_MAX = 0.5
CALIBRATION_THRESHOLD_STEPS = 50
MIN_EVENT_PROBABILITY = 0.2
MIN_SPATIAL_FOG_PROBABILITY = 0.25


def load_inputs():
    metar = json.loads((RAW / "fog_metar.json").read_text())["records"]
    meteorology = json.loads((RAW / "fog_meteorology.json").read_text())
    weather = {row["time"]: row for row in meteorology["records"]}
    return metar, weather, meteorology


def features(stamp, weather):
    row = weather.get(stamp, {})
    temp = row.get("temperature_c")
    dewpoint = row.get("dewpoint_c")
    rh = row.get("relative_humidity")
    wind = row.get("wind_kmh")
    cloud = row.get("low_cloud_pct")
    if wind is None:
        wind = (row.get("wind_ms") or 0) * 3.6
    try:
        dt = datetime.strptime(stamp, "%Y%m%d%H")
    except ValueError:
        dt = datetime.strptime(stamp[:10], "%Y%m%d%H")
    spread = max(0.0, float(temp) - float(dewpoint)) if temp is not None and dewpoint is not None else 10.0
    rh = float(rh) if rh is not None else max(0.0, min(100.0, 100 - spread * 6))
    cloud = float(cloud) if cloud is not None else 50.0
    wind = float(wind) / 3.6
    doy = dt.timetuple().tm_yday / 365.25 * math.tau
    hour = dt.hour / 24 * math.tau
    favourable = float(
        spread <= MAX_DEWPOINT_SPREAD_C and rh >= MIN_RELATIVE_HUMIDITY
        and wind <= MIN_WIND_MS and cloud <= 50
    )
    vector = [spread, rh, wind, cloud, math.sin(hour), math.cos(hour),
              math.sin(doy), math.cos(doy), favourable]
    return vector, {"temperature_c": temp, "dewpoint_c": dewpoint, "spread_c": spread,
                    "relative_humidity": rh, "wind_ms": wind, "low_cloud_pct": cloud}


def fit_model(metar, weather):
    rows = []
    for record in metar:
        vector, values = features(record["time"], weather)
        if record.get("visibility_m") is None:
            continue
        rows.append((record["time"], vector, int(record["fog"]), values, float(record["visibility_m"])))
    if len(rows) < MIN_TRAINING_RECORDS or len({row[2] for row in rows}) < 2:
        return None, {"status": "insufficient observations", "records": len(rows),
                      "fog_observations": sum(row[2] for row in rows)}

    x = np.asarray([row[1] for row in rows], dtype=np.float64)
    y = np.asarray([row[2] for row in rows], dtype=np.float64)
    split = max(1, int(len(rows) * (1 - HOLDOUT_FRACTION)))
    split = min(split, len(rows) - 1)

    def train(indices):
        mean = x[indices].mean(axis=0)
        std = x[indices].std(axis=0)
        std[std < 1e-8] = 1
        z = (x[indices] - mean) / std
        target = y[indices]

        def loss(coef):
            logits = np.clip(coef[0] + z @ coef[1:], -30, 30)
            return float(np.logaddexp(0, logits).sum() - target @ logits + 0.05 * (coef[1:] @ coef[1:]))

        result = minimize(loss, np.zeros(x.shape[1] + 1), method="L-BFGS-B")
        if not result.success and not np.isfinite(result.fun):
            raise RuntimeError(f"Fog calibration did not converge: {result.message}")
        return mean, std, result.x

    train_idx = np.arange(split)
    mean, std, coef = train(train_idx)
    train_probability = expit(coef[0] + ((x[train_idx] - mean) / std) @ coef[1:])
    threshold = CALIBRATION_THRESHOLD_MIN
    best_skill = -float("inf")
    for candidate in np.linspace(CALIBRATION_THRESHOLD_MIN, CALIBRATION_THRESHOLD_MAX, CALIBRATION_THRESHOLD_STEPS):
        prediction = train_probability >= candidate
        true_positive = int(np.sum(prediction & (y[train_idx] == 1)))
        false_positive = int(np.sum(prediction & (y[train_idx] == 0)))
        false_negative = int(np.sum(~prediction & (y[train_idx] == 1)))
        true_negative = int(np.sum(~prediction & (y[train_idx] == 0)))
        pod = true_positive / max(1, true_positive + false_negative)
        false_alarm_rate = false_positive / max(1, false_positive + true_negative)
        skill = pod - false_alarm_rate
        if skill > best_skill or (skill == best_skill and candidate > threshold):
            threshold, best_skill = float(candidate), skill

    visibility_target = np.log1p(np.asarray([row[4] for row in rows], dtype=np.float64))
    vis_mean = x[train_idx].mean(axis=0)
    vis_std = x[train_idx].std(axis=0)
    vis_std[vis_std < 1e-8] = 1
    z_train = np.column_stack([np.ones(len(train_idx)), (x[train_idx] - vis_mean) / vis_std])
    penalty = np.eye(z_train.shape[1]) * 2.0
    penalty[0, 0] = 0
    vis_coef = np.linalg.solve(z_train.T @ z_train + penalty, z_train.T @ visibility_target[train_idx])
    holdout_y = y[split:]
    z_holdout = np.column_stack([np.ones(len(holdout_y)), (x[split:] - vis_mean) / vis_std])
    vis_holdout = np.clip(np.expm1(z_holdout @ vis_coef), 50, MAX_OBSERVED_VISIBILITY_M)
    vis_actual = np.asarray([row[4] for row in rows], dtype=np.float64)[split:]
    holdout_prob = expit(coef[0] + ((x[split:] - mean) / std) @ coef[1:])
    predicted = holdout_prob >= threshold
    tp = int(np.sum(predicted & (holdout_y == 1)))
    fp = int(np.sum(predicted & (holdout_y == 0)))
    fn = int(np.sum(~predicted & (holdout_y == 1)))
    tn = int(np.sum(~predicted & (holdout_y == 0)))
    metrics = {
        "status": "trained",
        "records": len(rows),
        "fog_observations": int(y.sum()),
        "holdout_records": len(holdout_y),
        "threshold": round(threshold, 3),
        "threshold_selection": "Maximum Youden J (POD − false-alarm rate), selected on the training period only",
        "visibility_mae_m": round(float(np.mean(np.abs(vis_holdout - vis_actual)))),
        "visibility_median_absolute_error_m": round(float(np.median(np.abs(vis_holdout - vis_actual)))),
        "hit_rate": round((tp + tn) / max(1, len(holdout_y)), 4),
        "false_alarm_rate": round(fp / max(1, fp + tn), 4),
        "pod": round(tp / max(1, tp + fn), 4),
        "far": round(fp / max(1, tp + fp), 4),
        "confusion": {"hits": tp, "false_alarms": fp, "misses": fn, "correct_negatives": tn},
    }

    full_mean, full_std, full_coef = train(np.arange(len(rows)))
    vis_mean = x.mean(axis=0)
    vis_std = x.std(axis=0)
    vis_std[vis_std < 1e-8] = 1
    z_all = np.column_stack([np.ones(len(x)), (x - vis_mean) / vis_std])
    penalty = np.eye(z_all.shape[1]) * 2.0
    penalty[0, 0] = 0
    vis_coef = np.linalg.solve(z_all.T @ z_all + penalty, z_all.T @ visibility_target)
    model = {"mean": full_mean, "std": full_std, "coef": full_coef,
             "visibility_mean": vis_mean, "visibility_std": vis_std,
             "visibility_coef": vis_coef}
    visibility_bins = {}
    for record in metar:
        vector, values = features(record["time"], weather)
        record["predictor"] = values
        probability = float(expit(full_coef[0] + ((np.asarray(vector) - full_mean) / full_std) @ full_coef[1:]))
        record["model_probability"] = probability if record.get("visibility_m") is not None else 0.0
        visibility_features = np.concatenate([[1.0], (np.asarray(vector) - vis_mean) / vis_std])
        record["expected_visibility_m"] = round(float(np.clip(
            np.expm1(visibility_features @ vis_coef), 50, MAX_OBSERVED_VISIBILITY_M
        )))
        if record.get("visibility_m") is not None:
            bucket = min(9, int(probability * 10))
            visibility_bins.setdefault(bucket, []).append(record["visibility_m"])
    metrics["visibility_calibration"] = [
        {"probability_range": [round(bucket / 10, 1), round((bucket + 1) / 10, 1)],
         "records": len(values), "median_observed_visibility_m": round(float(np.median(values)))}
        for bucket, values in sorted(visibility_bins.items())
    ]
    return model, metrics


def event_type(hours):
    freezing = any((row.get("predictor") or {}).get("temperature_c") is not None
                   and (row["predictor"]["temperature_c"] <= 0 or "FZFG" in row.get("weather_codes", []))
                   for row in hours)
    if freezing:
        return "freezing"
    if any((row.get("predictor") or {}).get("wind_ms", 0) >= MIN_WIND_MS
           or (row.get("predictor") or {}).get("low_cloud_pct", 0) >= ADVECTION_LOW_CLOUD_PCT for row in hours):
        return "advection"
    return "radiation"


def build_events(metar, weather):
    by_hour = {}
    for row in metar:
        try:
            stamp = row["time"][:10]
            datetime.strptime(stamp, "%Y%m%d%H")
        except (KeyError, ValueError):
            continue
        item = by_hour.get(stamp)
        if item is None:
            item = dict(row)
            item["time"] = stamp
            item["model_probability"] = float(row.get("model_probability") or 0)
            by_hour[stamp] = item
        else:
            item["visibility_m"] = min(item["visibility_m"], row["visibility_m"])
            item["fog"] = item["fog"] or row["fog"]
            item["weather_codes"] = sorted(set(item["weather_codes"] + row["weather_codes"]))
            item["model_probability"] = max(item["model_probability"], float(row.get("model_probability") or 0))
    hours = []
    for stamp in sorted(by_hour):
        row = by_hour[stamp]
        _, values = features(stamp, weather)
        row["predictor"] = values
        row["model_probability"] = float(row.get("model_probability") or 0)
        hours.append(row)

    episodes, active = [], []
    previous = None
    for row in hours:
        time_value = datetime.strptime(row["time"], "%Y%m%d%H")
        if row["fog"] and (previous is None or (time_value - previous).total_seconds() <= MAX_EVENT_GAP_MINUTES * 60):
            active.append(row)
        elif row["fog"]:
            if active:
                episodes.append(active)
            active = [row]
        elif active:
            episodes.append(active)
            active = []
        previous = time_value
    if active:
        episodes.append(active)

    events = []
    positions = {row["time"]: index for index, row in enumerate(hours)}
    for index, episode in enumerate(episodes):
        start = datetime.strptime(episode[0]["time"], "%Y%m%d%H").replace(tzinfo=ZoneInfo("UTC"))
        end = datetime.strptime(episode[-1]["time"], "%Y%m%d%H").replace(tzinfo=ZoneInfo("UTC"))
        start_index = positions[episode[0]["time"]]
        end_index = positions[episode[-1]["time"]]
        window = hours[max(0, start_index - 6):min(len(hours), end_index + 7)]
        series = []
        for row in window:
            time_utc = datetime.strptime(row["time"], "%Y%m%d%H").replace(tzinfo=ZoneInfo("UTC"))
            series.append({
                "time": time_utc.astimezone(SOFIA_TZ).isoformat(timespec="minutes"),
                "visibility_m": round(row["visibility_m"]),
                "expected_visibility_m": row.get("expected_visibility_m"),
                "fog_observed": bool(row["fog"]),
                "probability": round(row.get("model_probability", 0), 3),
                "temperature_c": round(row["predictor"]["temperature_c"], 1) if row["predictor"]["temperature_c"] is not None else None,
                "dewpoint_spread_c": round(row["predictor"]["spread_c"], 1),
                "wind_ms": round(row["predictor"]["wind_ms"], 1),
                "low_cloud_pct": round(row["predictor"]["low_cloud_pct"]),
            })
        events.append({
            "id": f"FG-{index + 1:04d}",
            "start": start.astimezone(SOFIA_TZ).isoformat(timespec="minutes"),
            "end": end.astimezone(SOFIA_TZ).isoformat(timespec="minutes"),
            "duration_h": len(episode),
            "minimum_visibility_m": int(min(row["visibility_m"] for row in episode)),
            "type": event_type(episode),
            "hourly": series,
        })
    return events


def terrain_factor(grid):
    dem_file = WORK / "dem.npy"
    if not dem_file.exists():
        return None
    dem = np.load(dem_file).astype(np.float32)
    radius = max(3, TERRAIN_RADIUS_CELLS)
    local_mean = uniform_filter(dem, size=radius * 2 + 1, mode="nearest")
    tpi = np.clip((local_mean - dem) / TERRAIN_TPI_SCALE_M, -1.5, 1.5)
    factor = np.clip(TERRAIN_VALLEY_BASE + TERRAIN_TPI_FACTOR * tpi, 0.3, 1.3)
    landcover_path = WORK / "landcover.npy"
    if landcover_path.exists():
        landcover = np.load(landcover_path)
        moisture = np.isin(landcover, [10, 20, 30, 40, 80, 90, 95, 100]).astype(np.float32)
        factor *= TERRAIN_MOISTURE_BASE + TERRAIN_MOISTURE_FACTOR * uniform_filter(moisture, size=9, mode="nearest")
    return np.clip(factor, 0.2, 1.4)


def grid_metadata():
    grid = json.loads((WORK / "grid.json").read_text())
    grid["bounds"] = [[grid["west"], grid["north"]], [grid["east"], grid["north"]],
                      [grid["east"], grid["south"]], [grid["west"], grid["south"]]]
    return grid


def grid_index(lon, lat, grid):
    x0, y0 = grid["tile_origin"]
    zoom, cols, rows = grid["zoom"], grid["cols"], grid["rows"]
    n = 2 ** zoom
    xtile = (lon + 180) / 360 * n
    ytile = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n
    col = int((xtile - x0) * 256)
    row = int((ytile - y0) * 256)
    if 0 <= row < rows and 0 <= col < cols:
        return row, col
    return None


def osm_hotspots(events, roads, grid, terrain):
    elements = roads.get("elements", [])
    if roads.get("status") != "available" or not elements or terrain is None:
        return [], None
    rows, cols = terrain.shape
    road_length = np.zeros(rows * cols, dtype=np.float64)
    names = {}
    references = {}
    priority_points = []
    for way in elements:
        tags = way.get("tags", {})
        points = way.get("geometry", [])
        if way.get("type") == "node":
            points = [{"lon": way["lon"], "lat": way["lat"]}]
        if (tags.get("highway") == "motorway_junction" or tags.get("amenity") == "hospital"
                or tags.get("aeroway") in ("aerodrome", "terminal")):
            if points:
                priority_points.append((float(np.mean([point["lon"] for point in points])),
                                        float(np.mean([point["lat"] for point in points])),
                                        "junction" if tags.get("highway") == "motorway_junction" else
                                        "hospital access" if tags.get("amenity") == "hospital" else "airport"))
        if not tags.get("highway") or len(points) < 2:
            continue
        name = tags.get("name")
        reference = tags.get("ref")
        for first, last in zip(points, points[1:]):
            lat_scale = math.cos(math.radians((first["lat"] + last["lat"]) / 2))
            distance = math.hypot((last["lon"] - first["lon"]) * lat_scale * 111320,
                                  (last["lat"] - first["lat"]) * 111320)
            steps = max(1, int(distance / max(25, grid["cell_m"])))
            for part in range(steps + 1):
                fraction = part / steps
                lon = first["lon"] + (last["lon"] - first["lon"]) * fraction
                lat = first["lat"] + (last["lat"] - first["lat"]) * fraction
                index = grid_index(lon, lat, grid)
                if index:
                    row, col = index
                    flat = row * cols + col
                    road_length[flat] += distance / steps
                    if name:
                        names.setdefault(flat, name)
                    if reference:
                        references.setdefault(flat, reference)
    road_cells = np.flatnonzero(road_length)
    if not road_cells.size:
        return [], "No road geometries fell inside the terrain grid."

    event_counts = np.zeros(rows * cols, dtype=np.uint16)
    density_sum = np.zeros(rows * cols, dtype=np.float64)
    for event in events:
        peak_probability = max((hour["probability"] for hour in event["hourly"]), default=0)
        if peak_probability < MIN_EVENT_PROBABILITY:
            continue
        event_counts[road_cells] += (terrain.ravel()[road_cells] * peak_probability >= MIN_SPATIAL_FOG_PROBABILITY)
        density_sum[road_cells] += terrain.ravel()[road_cells] * peak_probability

    eligible = road_cells[event_counts[road_cells] >= HOTSPOT_MIN_EVENTS]
    if not eligible.size:
        return [], "Road data loaded, but no sampled road cells met the event-frequency threshold."
    priority_weight = np.ones(road_cells.size, dtype=np.float64)
    priority_types = {}
    if priority_points:
        x0, y0 = grid["tile_origin"]
        n = 2 ** grid["zoom"]
        cell_rows, cell_cols = np.divmod(road_cells, cols)
        cell_lons = (x0 + (cell_cols + 0.5) / 256) / n * 360 - 180
        cell_lats = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y0 + (cell_rows + 0.5) / 256) / n))))
        for lon, lat, feature_type in priority_points:
            distance = np.hypot((cell_lons - lon) * math.cos(math.radians(lat)) * 111320,
                                (cell_lats - lat) * 111320)
            near = distance <= 300
            weight = 1.0 + 0.5 * (1 - distance[near] / 300)
            priority_weight[near] = np.maximum(priority_weight[near], weight)
            for flat in road_cells[near]:
                priority_types.setdefault(int(flat), set()).add(feature_type)
    scores = (event_counts[eligible] * density_sum[eligible] * np.sqrt(road_length[eligible]))
    road_weight = np.ones(rows * cols, dtype=np.float64)
    road_weight[road_cells] = priority_weight
    scores *= road_weight[eligible]
    order = eligible[np.argsort(scores)[::-1]]
    hotspots = []
    for flat in order:
        row, col = divmod(int(flat), cols)
        x0, y0 = grid["tile_origin"]
        n = 2 ** grid["zoom"]
        xtile = x0 + (col + 0.5) / 256
        ytile = y0 + (row + 0.5) / 256
        lon = xtile / n * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ytile / n))))
        if any(math.hypot((lon - h["coord"][0]) * math.cos(math.radians(lat)) * 111320,
                          (lat - h["coord"][1]) * 111320) < HOTSPOT_MIN_SPACING_M for h in hotspots):
            continue
        dates = sorted({event["start"][:10] for event in events
                        if max((hour["probability"] for hour in event["hourly"]), default=0) * terrain[row, col] >= MIN_SPATIAL_FOG_PROBABILITY})
        hotspots.append({
            "id": f"FH-{len(hotspots) + 1:02d}",
            "name": names.get(int(flat)) or (
                f"Route {references[int(flat)]}" if int(flat) in references else "OSM road"),
            "district": "Sofia",
            "_cell": int(flat),
            "coord": [round(lon, 5), round(lat, 5)],
            "score": min(100, round(float(scores[np.where(eligible == flat)[0][0]] /
                                                max(1, scores.max())) * 100)),
            "fog_days_per_year": round(len(dates) / 5, 1),
            "minimum_visibility_m": min((event["minimum_visibility_m"] for event in events
                                         if event["start"][:10] in dates), default=None),
            "exposed_road_km": round(road_length[flat] / 1000, 2),
            "events": int(event_counts[flat]),
            "recent_dates": dates[-8:],
            "traffic_roads_affected": names.get(int(flat)) or (
                f"Route {references[int(flat)]}" if int(flat) in references else "OSM road"),
            "exposure_types": sorted(priority_types.get(int(flat), set())),
            "source": "OpenStreetMap roads × METAR-calibrated terrain-adjusted fog model",
        })
        if len(hotspots) >= MAX_HOTSPOTS:
            break
    geocode = {}
    geocode_path = RAW / "fog_geocode.json"
    if geocode_path.exists():
        geocode = json.loads(geocode_path.read_text())
    for hotspot in hotspots:
        if hotspot["name"] != "OSM road" and not hotspot["name"].startswith("Route "):
            hotspot["name_source"] = "OpenStreetMap name tag"
            del hotspot["_cell"]
            continue
        key = f"{hotspot['coord'][0]:.4f},{hotspot['coord'][1]:.4f}"
        if key not in geocode:
            try:
                time.sleep(1.1)
                response = http_get("https://nominatim.openstreetmap.org/reverse", params={
                    "format": "jsonv2", "lat": hotspot["coord"][1], "lon": hotspot["coord"][0],
                    "zoom": 17, "accept-language": "en",
                }, timeout=30)
                address = response.json().get("address", {})
                geocode[key] = {
                    "name": address.get("road") or address.get("pedestrian") or address.get("neighbourhood"),
                    "district": address.get("suburb") or address.get("quarter") or address.get("city_district"),
                }
            except (requests.RequestException, ValueError) as exc:
                print(f"Nominatim lookup unavailable for {key}: {exc}", flush=True)
                geocode[key] = {}
        if geocode[key].get("name"):
            hotspot["name"] = geocode[key]["name"]
            hotspot["traffic_roads_affected"] = geocode[key]["name"]
            hotspot["name_source"] = "Nominatim reverse geocoding"
        if geocode[key].get("district"):
            hotspot["district"] = geocode[key]["district"]
        hotspot.setdefault("name_source", "OpenStreetMap road reference")
        del hotspot["_cell"]
    geocode_path.write_text(json.dumps(geocode, ensure_ascii=False))
    return hotspots, None


def main():
    metar, weather, meteorology_source = load_inputs()
    _, calibration = fit_model(metar, weather)
    events = build_events(metar, weather)
    grid = grid_metadata() if (WORK / "grid.json").exists() else None
    terrain = terrain_factor(grid) if grid else None

    roads_file = RAW / "fog_roads.json"
    roads = json.loads(roads_file.read_text()) if roads_file.exists() else {
        "status": "unavailable", "source": "OpenStreetMap via Overpass API",
        "elements": [], "reason": "Road-fetch step has not run.",
    }
    hotspots, hotspot_note = osm_hotspots(events, roads, grid, terrain) if grid else ([], "Terrain grid unavailable.")

    raster_file = None
    if terrain is not None:
        raster_file = "fog_proneness.png"
        image = np.zeros((*terrain.shape, 4), dtype=np.uint8)
        image[..., 0] = np.clip(terrain / 1.4 * 255, 0, 255).astype(np.uint8)
        image[..., 3] = 255
        Image.fromarray(image, "RGBA").save(OUT / raster_file, optimize=True)

    fog_hours = sum(bool(record["fog"]) for record in metar)
    observed_hours = len(metar)
    local_hours = []
    for record in metar:
        local = datetime.strptime(record["time"], "%Y%m%d%H").replace(tzinfo=ZoneInfo("UTC")).astimezone(SOFIA_TZ)
        local_hours.append(local)
    total_years = max(1, (local_hours[-1] - local_hours[0]).days / 365.25) if local_hours else 5
    observed_fog_records = []
    for row in metar:
        if not row["fog"]:
            continue
        local = datetime.strptime(row["time"], "%Y%m%d%H").replace(tzinfo=ZoneInfo("UTC")).astimezone(SOFIA_TZ)
        observed_fog_records.append((row, local))
    fog_dates = {local.date() for _, local in observed_fog_records}
    fog_hours_night = sum(1 for _, local in observed_fog_records if local.hour >= 21 or local.hour < 6)
    fog_hours_morning = sum(1 for _, local in observed_fog_records if 6 <= local.hour < 10)
    mean_visibility = float(np.mean([row["visibility_m"] for row, _ in observed_fog_records])) if observed_fog_records else None
    min_visibility = min((row["visibility_m"] for row, _ in observed_fog_records), default=None)
    max_probability = max((hour["probability"] for event in events for hour in event["hourly"]), default=0)

    road_status = roads.get("status", "unavailable")
    register = [{
        "id": "FR-01", "name": "LBSF · Sofia Airport visibility", "district": "Vrazhdebna",
        "fog_days_per_year": round(len(fog_dates) / total_years, 1),
        "mean_visibility_m": round(mean_visibility) if mean_visibility is not None else None,
        "minimum_visibility_m": min_visibility,
        "night_fog_share": round(fog_hours_night / max(1, fog_hours), 3) if fog_hours else None,
        "morning_rush_fog_share": round(fog_hours_morning / max(1, fog_hours), 3) if fog_hours else None,
        "exposed_road_km": None,
        "traffic_roads_affected": None,
        "risk_score": min(100, round(max_probability * 100)),
        "source_status": "station observation; no matched road length" if road_status == "available" else "station-only; OSM road exposure unavailable",
    }] if events else []

    input_info = json.loads((RAW / "fog_meteorology.json").read_text())
    summary = {
        "generated": datetime.now(SOFIA_TZ).isoformat(timespec="minutes"),
        "period": {"start": json.loads((RAW / "fog_metar.json").read_text())["period"]["start"],
                   "end": json.loads((RAW / "fog_metar.json").read_text())["period"]["end"]},
        "station": {"id": "LBSF", "name": "Sofia Airport", "observations": observed_hours,
                    "fog_hours": fog_hours, "fog_days_per_year": round(len(fog_dates) / total_years, 1),
                    "mean_visibility_m": round(mean_visibility) if mean_visibility is not None else None,
                    "minimum_visibility_m": min_visibility},
        "calibration": calibration,
        "model": {
            "method": "Logistic regression on observed METAR visibility/weather-code labels and hourly reanalysis predictors; expected visibility uses a separate ridge regression fitted to observed visibility. Both are evaluated on a chronological holdout. City raster applies a terrain-position and land-cover moisture adjustment.",
            "thresholds": {"visibility_m": FOG_VISIBILITY_M, "wind_ms": MIN_WIND_MS,
                           "dewpoint_spread_c": MAX_DEWPOINT_SPREAD_C, "relative_humidity_pct": MIN_RELATIVE_HUMIDITY,
                           "advection_low_cloud_pct": ADVECTION_LOW_CLOUD_PCT, "event_gap_minutes": MAX_EVENT_GAP_MINUTES,
                           "hotspot_min_events": HOTSPOT_MIN_EVENTS, "hotspot_probability": MIN_SPATIAL_FOG_PROBABILITY},
            "inputs": meteorology_source["source"],
            "spatial_status": "terrain-adjusted" if terrain is not None else "station-only; terrain grid unavailable",
        },
        "sources": {
            "observations": "Iowa Environmental Mesonet ASOS archive, station LBSF",
            "meteorology": input_info["source"],
            "meteorology_fallback_reason": input_info.get("fallback_reason"),
            "nasa_power": "NASA POWER hourly MERRA-2: T2M, T2MDEW, RH2M, WS2M"
            if json.loads((RAW / "fog_power.json").read_text()).get("records") else None,
            "nasa_power_note": json.loads((RAW / "fog_power.json").read_text()).get("reason"),
            "roads": roads.get("source"),
            "roads_status": road_status,
            "roads_note": roads.get("reason"),
            "satellite": "Not used; no validated free low-cloud/fog satellite endpoint was verified.",
        },
        "grid": {
            "rows": grid["rows"], "cols": grid["cols"], "cell_m": round(grid["cell_m"], 1),
            "bounds": grid["bounds"], "raster": raster_file,
        } if grid else None,
        "event_count": len(events),
        "max_probability": round(max_probability, 3),
        "hotspot_note": hotspot_note or roads.get("reason"),
    }
    (OUT / "fog_events.json").write_text(json.dumps(events, separators=(",", ":")))
    (OUT / "fog_hotspots.json").write_text(json.dumps(hotspots, ensure_ascii=False, separators=(",", ":")))
    (OUT / "fog_risk_register.json").write_text(json.dumps(register, ensure_ascii=False, separators=(",", ":")))
    (OUT / "fog_summary.json").write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
    print(f"Fog model: {observed_hours} station hours, {fog_hours} observed fog hours, "
          f"{len(events)} episodes, {len(hotspots)} OSM hotspots", flush=True)
    print(f"Holdout: {calibration}", flush=True)


if __name__ == "__main__":
    main()
