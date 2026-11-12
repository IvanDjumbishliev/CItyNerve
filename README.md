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

## FogNerve · Sofia fog screening

FogNerve is available from the navigation rail beside FloodNerve. It includes a MapLibre 3D terrain map, observed fog-event catalogue and playback, fog-risk register, hotspot panel, and data/model notes.

Run just the fog inputs and model:

```bash
npm run data:fog
```

The fog pipeline reuses the SRTM and WorldCover downloads from the flood pipeline when present (it downloads missing shared inputs), then writes `fog_summary.json`, `fog_events.json`, `fog_hotspots.json`, `fog_risk_register.json` and `fog_proneness.png` into `public/data/`. The full `npm run data` run includes FogNerve after FloodNerve.

Observed episodes are based on real Iowa Environmental Mesonet METAR visibility and FG/BR/FZFG weather codes at Sofia Airport (LBSF). Hourly temperature, dew point, relative humidity, wind and low cloud are from ERA5 via Open-Meteo; NASA POWER MERRA-2 temperature, dew point, humidity and wind are fetched as a secondary series. The station model is calibrated on real observations and reports chronological holdout hit rate, false-alarm rate, probability of detection (POD) and false-alarm ratio (FAR). The city raster is a modelled terrain-proneness adjustment, not a grid of observed visibility.

OpenStreetMap road exposure is fetched from Overpass when a public endpoint is reachable. If that service is unavailable, road lengths and traffic exposure are left blank and the data page reports the source failure; they are not estimated as zero or fabricated. NASA POWER rejected the proposed cloud-cover/PBLH parameter names, so ERA5 via Open-Meteo supplies low-cloud cover; no satellite fog product is used. **FogNerve is a screening prototype, not an official fog warning and not for safety-critical use.** Do not use it to issue speed limits, signage, de-icing actions, or operational instructions without independent field validation.

## HeatNerve · Sofia urban heat island

HeatNerve (Heat map, Heat risk, Heat data in the navigation rail) shows how much hotter Sofia's concrete, asphalt and roofs get than the countryside around it, and what to do about it at each hot spot.

```bash
npm run data:heat
```

Real inputs, no logins: **Landsat 8/9 Collection 2 Level-2** surface temperature (thermal band 10) and surface reflectance for every clear summer pass 2022–2026 (Microsoft Planetary Computer STAC); **GEDI L2A** and **ICESat-2 ATL08** space lidar via SlideRule (tree canopy vs roof heights); **NASA POWER** daily air temperature (hot days, heatwaves); ESA WorldCover and SRTM from the shared pipeline. `pipeline/heat_model.py` computes the surface heat island (pass temperature − vegetated countryside at the same altitude), NDVI and albedo, a regression on Sofia's own cells for cooling estimates, and ranks hotspots named from OpenStreetMap. Each hotspot lists its data-derived cause (bare ground, large roofs/paved lots, dark surfaces, missing trees) and actions. Outputs go to `public/data/heat/`. Landsat measures midday **surface** temperature, not air temperature, and the cooling numbers are statistical associations, not a design guarantee.

## Where to start integrating

1. `src/data.js` holds FloodNerve's Sofia map configuration.
2. `src/App.jsx` registers FloodNerve, FogNerve, and the platform navigation.
3. FogNerve observations and model outputs are fetched by `src/useFogData.js`.
4. `pipeline/fetch_fog_inputs.py` and `pipeline/fog_model.py` build its station catalogue, validation metrics, and terrain/exposure outputs.

## Suggested initial API contract

- `GET /api/cities`
- `GET /api/weather?cityId=michalovce`
- `POST /api/events` (authenticated / validated)
- `POST /api/demo/scenarios` (restricted to demo environment)

## Recommended next step

Build CityNerve Core first (shared events and incident database), then FloodNerve. The remaining tabs can be implemented independently after shared event schemas are stable.

## Safety

This starter is not intended for safety-critical operations, official flood or fog warnings, or autonomous control of real infrastructure. Any physical-barrier demo should use a miniature model with local interlocks and an easily accessible power cut-off.

### Parking availability

Mobility uses operator-reported availability for six Sofia facilities and Basel-Stadt parking data (CC BY 4.0). Sofia supplies neither capacity nor measurement timestamps; its catalog leaves reuse licensing unspecified. Confirm operator reuse terms for public deployment. Basel records with impossible counts are omitted.

Run npm run dev for development. For production run npm run build followed by npm start (Node 20+). PORT defaults to 3000. The Node server supplies the same /api/parking/{city} adapters used by Vite. A purely static deployment needs this API service behind the same origin. Responses are cached for 60 seconds; failed refreshes retain the last successful readings with a stale flag.

Additional parking providers are Ghent (municipal free-reuse model license), St. Gallen (CC BY-NC, noncommercial reuse) and Zürich (PLS live RSS under CC0, with coordinates/capacity joined by normalized facility name to ParkenDD metadata). Zürich facilities without usable coordinates or counts are excluded; its official per-facility timestamps are retained. Update cadence, coverage and data age vary by provider.

Bratislava and Košice have sensor-backed parking services, but a publicly accessible occupancy feed for this integration has not been verified. Their payment and permit APIs do not establish access to current availability.
