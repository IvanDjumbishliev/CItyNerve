# FloodNerve · Sofia — Flood-risk UI prototype

A 3D flood-risk interface for Sofia, Bulgaria. It is designed to visualise how storm water moves and ponds across the city using free NASA Earth-observation data (NASADEM, ICESat-2 / G-LiHT lidar, GPM IMERG rainfall, SMAP soil moisture, HLS land cover) combined with OpenStreetMap.

Audiences: **municipality** (where to fix first), **insurers** (exposure and expected loss) and **funds / investors** (flood screening of data-centre sites).

## Start

Requires Node.js 20.19+ or 22+ (compatible with Vite 6).

```bash
npm install
npm run dev
```

Open the localhost URL printed by Vite (usually http://localhost:5173).

Production build:

```bash
npm run build
npm run preview
```

## Included

- Full-screen 3D map (MapLibre GL + OpenStreetMap, SRTM terrain, 3D OSM buildings)
- **Real flood model results** for Sofia from NASA GPM IMERG rain, MERRA-2 soil wetness, ICESat-2 lidar and SRTM terrain, covering the last 5 years: flood depth per real storm, 5-year maximum, river network, problem spots with real storm dates
- Storm list, hourly timeline with playback, risk register and data & model pages

Data is produced by the Python pipeline in [pipeline/](pipeline/README.md) (`npm run data`).

## Important: what is real

Map, terrain, rainfall, soil wetness, lidar and land cover are real data (NASA SRTM, ICESat-2, GPM IMERG, MERRA-2; ESA WorldCover; OpenStreetMap). The flood depths and problem spots are outputs of a **screening model** run on that data (see `pipeline/README.md` for method and limits). It is not an official flood map: sewer capacity is assumed, terrain is 28 m, and rain intensity within a day is smoothed.

## Where to start integrating

1. `src/data.js` holds initial city configs, modules, sample incidents and scenarios.
2. `src/App.jsx` holds the current UI, navigation and incident state.
3. Create `src/services/weather.js` to request weather forecasts by city.
4. Create `src/services/api.js` to talk to a Cloudflare Worker / D1 backend.
5. Move incident generation into an API backed by D1; retain demo scenarios separately.
6. Replace the illustrative SVG map with Leaflet and OpenStreetMap tiles.
7. Add ESP32 telemetry via a backend endpoint (never expose control secrets in the frontend).

## Suggested initial API contract

- `GET /api/cities`
- `GET /api/weather?cityId=michalovce`
- `GET /api/incidents?cityId=michalovce`
- `POST /api/events` (authenticated / validated)
- `GET /api/devices?cityId=michalovce`
- `POST /api/demo/scenarios` (restricted to demo environment)

## Recommended next step

Build CityNerve Core + AlertNerve first (shared events and incident database), then FloodNerve. The five tabs can be implemented independently after shared event schemas are stable.

## Safety

This starter is not intended for safety-critical operations, official flood or fog warnings, or autonomous control of real infrastructure. Any physical-barrier demo should use a miniature model with local interlocks and an easily accessible power cut-off.
