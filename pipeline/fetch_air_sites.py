"""Fetch sensitive sites for AirNerve from OpenStreetMap via Overpass.

Schools, kindergartens, hospitals, clinics and care homes for Sofia (BBOX) and for
each Live-view town. Written straight to public/data as small GeoJSON files.
Overpass is optional: if every mirror fails the file is not written, and the app
shows the site layer as unavailable instead of empty.
"""
import json
import time

import requests

from config import BBOX, OUT, RAW, USER_AGENT

ENDPOINTS = (                                  # same mirror list as fetch_fog_roads.py
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
# Town centres mirror shared/towns.js; the study box matches townBbox() in shared/air.js.
TOWNS = {
    "sofia": None,
    "bratislava": (17.1145, 48.139), "michalovce": (21.918, 48.755), "kosice": (21.271621, 48.729007),
    "presov": (21.233034, 48.98921), "nitra": (18.091834, 48.319288), "zilina": (18.739179, 49.23357),
    "banska-bystrica": (19.150167, 48.73321),
}


def kind_of(tags):
    amenity = tags.get("amenity")
    if amenity in ("school", "kindergarten", "hospital", "clinic"):
        return amenity
    if amenity == "nursing_home" or tags.get("social_facility") in ("nursing_home", "assisted_living"):
        return "care"
    return None


def query(box):
    west, south, east, north = box
    area = f"({south},{west},{north},{east})"
    return ("[out:json][timeout:90];("
            f'nwr["amenity"~"^(school|kindergarten|hospital|clinic|nursing_home)$"]{area};'
            f'nwr["social_facility"~"^(nursing_home|assisted_living)$"]{area};'
            ");out center tags;")


def fetch(town, box):
    cache = RAW / "air" / f"sites_{town}.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        return json.loads(cache.read_text()), None
    errors = []
    for endpoint in ENDPOINTS:
        try:
            response = requests.post(endpoint, data={"data": query(box)}, headers={"User-Agent": USER_AGENT}, timeout=150)
            response.raise_for_status()
            elements = response.json().get("elements", [])
            cache.write_text(json.dumps(elements, separators=(",", ":")))
            return elements, None
        except (requests.RequestException, ValueError) as exc:
            errors.append(f"{endpoint}: {exc}")
    return None, " ; ".join(errors)


def main():
    report = {}
    for town, centre in TOWNS.items():
        box = BBOX if centre is None else (centre[0] - 0.15, centre[1] - 0.1, centre[0] + 0.15, centre[1] + 0.1)
        elements, error = fetch(town, box)
        if elements is None:
            report[town] = {"status": "unavailable", "reason": error}
            print(f"{town}: sites unavailable ({error})", flush=True)
            continue
        features, seen = [], set()
        for element in elements:
            tags = element.get("tags", {})
            kind = kind_of(tags)
            point = (element.get("lon"), element.get("lat")) if element["type"] == "node" else \
                ((element.get("center") or {}).get("lon"), (element.get("center") or {}).get("lat"))
            if not kind or point[0] is None:
                continue
            key = (kind, tags.get("name"), round(point[0], 4), round(point[1], 4))
            if key in seen:
                continue
            seen.add(key)
            features.append({"type": "Feature", "properties": {
                "id": f"{element['type'][0]}{element['id']}", "kind": kind,
                "name": tags.get("name:en") or tags.get("name") or None,
            }, "geometry": {"type": "Point", "coordinates": [round(point[0], 5), round(point[1], 5)]}})
        name = "air_sites.geojson" if town == "sofia" else f"air_sites_{town}.geojson"
        (OUT / name).write_text(json.dumps({"type": "FeatureCollection", "features": features,
                                            "source": "© OpenStreetMap contributors (ODbL) via Overpass API"},
                                           ensure_ascii=False, separators=(",", ":")))
        counts = {}
        for feature in features:
            counts[feature["properties"]["kind"]] = counts.get(feature["properties"]["kind"], 0) + 1
        report[town] = {"status": "available", "sites": len(features), "by_kind": counts}
        print(f"{town}: {len(features)} sites {counts}", flush=True)
        time.sleep(2)
    (RAW / "air" / "sites_report.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
