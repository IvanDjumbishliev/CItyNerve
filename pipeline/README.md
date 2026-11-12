# FloodNerve, FogNerve & AirNerve data pipelines (Sofia)

Downloads real data and runs the flood screening model. Output goes to `public/data/`, which the web app loads.

## Run

```bash
python -m venv pipeline/.venv
pipeline/.venv/Scripts/python -m pip install -r pipeline/requirements.txt   # Windows
npm run data          # flood + fog pipelines
```

No accounts or API keys needed. A full run takes a few minutes (most of it ICESat-2).

Run only the FogNerve inputs and model:

```bash
python -m venv pipeline/.venv
# Linux/macOS:
pipeline/.venv/bin/python -m pip install -r pipeline/requirements.txt
# Windows:
pipeline/.venv/Scripts/python -m pip install -r pipeline/requirements.txt
npm run data:fog
# alternatively, using an already provisioned Python environment:
python pipeline/run_fog.py
```

This reuses `pipeline/work/` terrain and land-cover outputs if available, fetching SRTM/WorldCover first if absent. Fog outputs are written alongside flood data in `public/data/` as `fog_summary.json`, `fog_events.json`, `fog_hotspots.json`, `fog_risk_register.json` and a compressed `fog_proneness.png` canvas raster.

## Inputs and generated outputs

| Script | Data | Provider |
|---|---|---|
| `run_all.py` | Run the FloodNerve and FogNerve input/model steps in sequence | Local orchestration |
| `fetch_dem.py` | SRTM 1" terrain, 28 m grid | NASA/NGA via AWS Terrain Tiles |
| `fetch_icesat2.py` | ICESat-2 ground lidar (ATL03 → ATL06-SR, ATL08 ground photons) | NASA via SlideRule |
| `fetch_imerg.py` | GPM IMERG daily rain + liquid-precipitation probability | NASA via NASA POWER |
| `fetch_power.py` | MERRA-2 hourly rain pattern, soil wetness, temperature | NASA via NASA POWER |
| `fetch_era5.py` | ERA5 hourly rain (independent storm check only) | ECMWF via Open-Meteo |
| `fetch_landcover.py` | WorldCover 2021, 10 m land cover | ESA |
| `fetch_fog_inputs.py` | LBSF METAR visibility/weather codes; hourly temperature, dew point, RH, wind and low cloud | Iowa Environmental Mesonet; ERA5 via Open-Meteo; NASA POWER MERRA-2 secondary |
| `fetch_fog_roads.py` | Major roads, motorway junctions, bridges and airport features for exposure | OpenStreetMap via Overpass (optional; metrics remain null if unreachable) |
| `fog_model.py` | Observed event catalogue, held-out station calibration, terrain-proneness raster, optional road hotspots and risk register | Derived screening model |
| `run_fog.py` | Ensure shared SRTM/WorldCover inputs then run the fog fetch/model steps | Local orchestration |

Period: `config.py` (`END_DATE`, 5 years back).

## Model (`model.py`)

1. ICESat-2 vs SRTM regression → remove roof/canopy bias, report vertical error.
2. Priority-Flood+ε, D8 flow, accumulation, height above nearest drainage.
3. Storm events from IMERG (hourly shape from MERRA-2), kept only if ERA5 confirms ≥50 %.
4. SCS curve-number runoff (land cover + soil wetness on the day).
5. River overflow: Manning stage above bankfull (median annual-max storm), only channels ≥10 km².
6. Ponding: hour-by-hour basin storage vs assumed sewer/ditch drainage, in depressions that survive 20 terrain-error realisations.
7. Hotspots: built-up places with ≥30 cm, scored by depth, frequency over all storms and built-up area; named via OpenStreetMap Nominatim.

Tunable assumptions are at the top of `model.py` and `fog_model.py`; the observed-visibility cutoff is in `config.py`. Flood outputs are screening models, not engineering flood studies.

## Fog model (`fog_model.py`)

1. **Observed catalogue:** fetch LBSF METAR reports from the Iowa Environmental Mesonet ASOS archive, convert visibility from statute miles to metres, and mark fog when visibility is below 1 km or the report contains FG/BR/FZFG. Contiguous station hours are grouped into episodes and classified as radiation, advection, or freezing fog.
2. **Meteorology:** use hourly ERA5 via Open-Meteo for 2 m temperature/dew point, RH, 10 m wind and low cloud. NASA POWER MERRA-2 is fetched as a secondary series for T2M, T2MDEW, RH2M and WS2M. The endpoint rejected the proposed CLOUD_LOW/PBLH parameter names; NASA POWER is not claimed to supply those fields.
3. **Calibration:** fit a logistic regression against observed fog labels, select the maximum-Youden-J probability threshold on the earlier training period, and score the later chronological holdout at that frozen threshold. A separate ridge regression estimates visibility in metres. Hit rate, false-alarm rate, POD, FAR, and expected-visibility MAE are exported in `fog_summary.json`; these single-station metrics are not city-wide validation.
4. **Terrain adjustment:** use SRTM local topographic position and WorldCover water/wetland/vegetation classes as a cold-air pooling and moisture proxy. This does not solve drainage flow, inversions, or a spatial visibility field; the overlay is a modelled screening probability only.
5. **Exposure:** sample available OSM major-road geometry against event probability to rank road hotspots and estimate sampled road length. If Overpass endpoints cannot be reached, hotspot and road-length fields remain unavailable/null (not zero). OSM features use their mapped road names; no unsupported exposures are invented.

The verified no-key data endpoints are IEM's ASOS request endpoint, Open-Meteo's archive endpoint, and NASA POWER's hourly endpoint for the listed parameters. Overpass availability can vary by network and server load. A satellite validation layer was not implemented because no suitable free no-key event endpoint was verified. The app remains usable without the optional OSM exposure source and shows its unavailable status. The fog product is a screening prototype, not an official fog warning or for safety-critical use.

## AirNerve air-quality pipeline (Sofia)

```bash
npm run data:air          # or: pipeline/.venv/Scripts/python pipeline/run_air.py
```

Needs the same virtual environment plus `pyarrow` (in `requirements.txt`) for the EEA reference files. A first run downloads about 60 MB and takes roughly 15 minutes, most of it the citizen-sensor archive and Overpass. Reruns use the cache in `pipeline/raw/air/`. The Live view (`/api/air`) needs none of this: it reads the same sources directly through the Node server.

| Script | Data | Provider |
|---|---|---|
| `fetch_air_inputs.py` | Hourly PM2.5, PM10, NO₂, O₃, SO₂ on the 0.1° lattice over `BBOX`; ERA5 10 m wind and humidity on the same lattice; a sample of citizen-sensor daily archive files; official station hourly PM2.5/PM10 | CAMS Europe via Open-Meteo; ERA5 via Open-Meteo archive; Sensor.Community archive; EEA Air Quality Download Service |
| `fetch_air_sites.py` | Schools, kindergartens, hospitals, clinics and care homes for Sofia and every Live-view town | OpenStreetMap via Overpass (same mirrors as `fetch_fog_roads.py`; a town's file is not written if all mirrors fail) |
| `air_model.py` | Episodes, yearly exceedance counts, local-factor and confidence rasters, validation, hotspots, risk register | Derived screening model |
| `run_air.py` | Runs the three steps in order | Local orchestration |

Outputs in `public/data/`: `air_summary.json`, `air_events.json`, `air_hotspots.json`, `air_risk_register.json`, `air_sites.geojson` (plus `air_sites_<town>.geojson`), `air_local_factor.png`, `air_confidence.png`. Missing values are `null`, never 0.

### Air model (`air_model.py`)

All thresholds sit in one table at the top of the script, each with its source: WHO global air quality guidelines 2021 (Table 3.26 AQG levels: PM2.5 15 / 5, PM10 45 / 15, NO₂ 25 / 10 µg/m³ for 24 h / annual), the Directive 2008/50/EC limit values as listed by the European Commission (PM10 50 µg/m³ daily with 35 days allowed and 40 annual; PM2.5 25 annual; NO₂ 40 annual) and the European Air Quality Index bands from airindex.eea.europa.eu. The revised Directive (EU) 2024/2881 sets stricter 2030 values; they are not used here.

1. **Episodes:** CAMS PM2.5 at the city centre (bilinear on the lattice), 24-hour means of local calendar days (at least 18 hours). An episode is a run of consecutive days above the WHO 24-hour guideline. The worst 12 by total excess are kept, each with up to 7 days of hourly lattice values and wind for playback. Cause hints appear only when the data show them: winter evening peaks at least 1.5× midday (heating) or mean wind below 2 m/s (stagnation).
2. **Yearly counts:** days above the WHO PM2.5 / PM10 / NO₂ 24-hour guidelines and above the EU PM10 daily limit, plus annual means, per calendar year. Partial years are flagged. These are model counts, not a compliance assessment.
3. **Sensor screening:** sample nodes are today's outdoor Sofia nodes (15 km) that have their own humidity sensor at the same location id. Rules: drop indoor nodes; drop PM2.5 outside 0–999.9 µg/m³ (SDS011 range) or above PM10 + 1; drop runs of 6 or more identical PM2.5 readings (stuck); discard every reading taken above 85% relative humidity (node humidity, or ERA5 humidity if the node has none) because optical counters count droplets as particles; hourly medians need 3 or more readings; a sensor needs 48 or more hours.
4. **Local factor (~250 m grid):** per sensor, the median of log((sensor+1)/(CAMS+1)) at the same hours. The city median is subtracted so the factor only redistributes CAMS in space and keeps its level. A Gaussian kernel (σ 1.5 km) interpolates the residuals; the result is shrunk towards 1 where few sensors are near and is exactly 1 (CAMS only) with fewer than 3 sensors within 2 km. `air_confidence.png` stores that confidence (0–1); the map hatches cells below 0.34.
5. **Validation (in `air_summary.json`):** leave-one-sensor-out (factor rebuilt without the sensor, then CAMS × factor against its hourly medians: MAE, bias, r) next to CAMS alone against the same sensors; and an independent check against the official EEA stations (daily means, CAMS at the city centre and the city-wide sensor median). The EEA metadata has no coordinates for these Bulgarian stations, so the comparison is city-scale. Station times are converted from the reported UTC+01.
6. **Hotspots and register:** only sensor-informed cells (confidence ≥ 0.34) are ranked: 60% rank of long-term mean PM2.5, 25% rank of WHO exceedance days, 15% sensitive sites within 500 m (capped at 10), at least 800 m apart, named with Nominatim (cached, one request per second).

### Verified air endpoints (2026-11-12, no keys, real requests)

| Endpoint | Finding |
|---|---|
| `air-quality-api.open-meteo.com/v1/air-quality` (`domains=cams_europe`) | Multi-point requests work (comma-separated lists, snapped to the 0.1° grid). History from 2013-01-01; earlier start dates are rejected. Forecast values stop about 4 days ahead. CORS `*`. Free tier is non-commercial: under 10,000 calls/day, 5,000/hour, 600/minute. Open-Meteo documents the series as CAMS forecasts from October 2023 and the CAMS reanalysis before. |
| `api.open-meteo.com/v1/forecast`, `archive-api.open-meteo.com/v1/archive` | 10 m wind (m/s, direction it blows from) and humidity, multi-point. |
| `data.sensor.community/airrohr/v1/filter/area=lat,lon,km` | Last 5 minutes only. Values are strings, `location.indoor` is 0/1, several records per sensor, humidity sensors share the PM sensor's `location.id`. Sofia: 288 outdoor PM nodes within 15 km, 228 with humidity. Slovak towns: Bratislava 9, Žilina 3, the others 1 each. CORS `*`. Polled at most every 5 minutes with the project User-Agent. |
| `archive.sensor.community/<day>/` and `/<year>/<day>/` | One semicolon-separated CSV per sensor and day (~36 KB). The current year sits at the root, earlier years under the year folder. The server slows sharply with 4 parallel requests; 2 keep-alive workers give about 80 files a minute. |
| EEA `ParquetFile/urls` (dataset 1) and `metadata.csv` | Returns Sofia PM2.5 / PM10 station Parquet files (~400 KB each). BG0050A is urban background (581 m); BG0070A is rural near-city (1,321 m). Bulgarian rows in the metadata have no coordinates; time zone UTC+01. Dataset 2 (verified data) returned no Sofia files. |
| Overpass (`overpass-api.de`) | 941 sensitive sites in Sofia's box in 38 s. Both other mirrors timed out at 90 s on the same day. |
| Planetary Computer `sentinel-5p-l2-netcdf` | Search and the no-key SAS token work, but each NO₂ granule is about 66 MB. A multi-month regional mean would need over 1 GB and a NetCDF stack, so the optional satellite layer was **skipped**. |

### Air limits

CAMS is an ~11 km model and cannot resolve streets. The local factor is static (from 8 sample days in winter and summer 2026) and only redistributes the model using today's sensors; it cannot add sources the model misses. Citizen sensors are indicative and read differently from reference monitors. Areas with no sensors are unknown, not clean. The validation uses the same kind of sensors the factor is built from, plus official stations compared at city scale. This is a screening estimate, not an official air-quality assessment or a health warning.

## Pernik · Studena dam-break scenario

| Script | What |
|---|---|
| `fetch_pernik.py` | SRTM terrain + WorldCover for the Struma valley (dam → Pernik), dam wall and reservoir outline from OpenStreetMap |
| `fetch_studena_s2.py` | Reservoir water area on every clear Sentinel-2 date (NDWI, AWS Open Data, no login) |
| `model_dambreak.py` | Full-supply level from the shoreline, synthetic bed scaled to 25.2 Mm³ and the 55 m wall, Sentinel-2 area → level → volume per date, breach width/time (Froehlich 2008), reference peak outflow (Froehlich 1995) |

The flood itself is computed live in the browser (`src/dambreak.worker.js`): a local-inertial 2D shallow-water solver (Bates et al. 2010) on the 28 m grid, starting from the lake level of the selected period. Hypothetical scenario for emergency planning, not a prediction.

## Regions

The flood model runs per study area, selected with `REGION` (see `config.py`):

| Region | Area | Rain point | Output |
|---|---|---|---|
| `sofia` (default) | 23.18–23.50 E, 42.60–42.78 N | 23.32 E, 42.69 N | `public/data/` |
| `pernik` | 22.92–23.20 E, 42.50–42.68 N (city, Struma valley to Studena dam) | 23.04 E, 42.60 N | `public/data/pernik/` |

```bash
REGION=pernik pipeline/.venv/Scripts/python pipeline/model.py
```
`run_all.py` runs both regions. In the app, the Sofia / Pernik switch in the top bar changes map, storms, problem spots, register and data pages.
