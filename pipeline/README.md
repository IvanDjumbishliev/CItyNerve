# FloodNerve & FogNerve data pipelines (Sofia)

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
