"""Fetch named road/junction exposure from OpenStreetMap Overpass.

Overpass is optional: the fog event catalogue and weather model still run if
the public endpoints are unavailable. The failure is written into the data
manifest and is never represented as zero road exposure.
"""
import json

import requests

from config import BBOX, RAW, USER_AGENT

ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)


def main():
    west, south, east, north = BBOX
    query = (
        "[out:json][timeout:60];("
        f'way["highway"~"motorway|trunk|primary|secondary|tertiary"]'
        f"({south},{west},{north},{east});"
        f'node["highway"="motorway_junction"]({south},{west},{north},{east});'
        f'way["aeroway"~"aerodrome|terminal"]({south},{west},{north},{east});'
        f'way["amenity"="hospital"]({south},{west},{north},{east});'
        f'node["amenity"="hospital"]({south},{west},{north},{east});'
        f'way["bridge"="yes"]["highway"]({south},{west},{north},{east});'
        ");out geom;"
    )
    errors = []
    for endpoint in ENDPOINTS:
        try:
            response = requests.get(endpoint, params={"data": query},
                                    headers={"User-Agent": USER_AGENT}, timeout=90)
            response.raise_for_status()
            payload = response.json()
            (RAW / "fog_roads.json").write_text(json.dumps({
                "source": "OpenStreetMap via Overpass API", "status": "available",
                "elements": payload.get("elements", []),
            }, separators=(",", ":")))
            print(f"OSM exposure: {len(payload.get('elements', []))} elements via {endpoint}", flush=True)
            return
        except (requests.RequestException, ValueError) as exc:
            errors.append(f"{endpoint}: {exc}")
    reason = " ; ".join(errors)
    (RAW / "fog_roads.json").write_text(json.dumps({
        "source": "OpenStreetMap via Overpass API", "status": "unavailable",
        "elements": [], "reason": reason,
    }, separators=(",", ":")))
    print(f"OSM exposure unavailable; road metrics will be null: {reason}", flush=True)


if __name__ == "__main__":
    main()
