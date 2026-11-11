# FloodNerve data pipeline (Sofia)

Downloads real data and runs the flood screening model. Output goes to `public/data/`, which the web app loads.

## Run

```bash
python -m venv pipeline/.venv
pipeline/.venv/Scripts/python -m pip install -r pipeline/requirements.txt   # Windows
npm run data          # = pipeline/.venv/Scripts/python pipeline/run_all.py
```

No accounts or API keys needed. A full run takes a few minutes (most of it ICESat-2).

## Inputs (all real)

| Script | Data | Provider |
|---|---|---|
| `fetch_dem.py` | SRTM 1" terrain, 28 m grid | NASA/NGA via AWS Terrain Tiles |
| `fetch_icesat2.py` | ICESat-2 ground lidar (ATL03 → ATL06-SR, ATL08 ground photons) | NASA via SlideRule |
| `fetch_imerg.py` | GPM IMERG daily rain + liquid-precipitation probability | NASA via NASA POWER |
| `fetch_power.py` | MERRA-2 hourly rain pattern, soil wetness, temperature | NASA via NASA POWER |
| `fetch_era5.py` | ERA5 hourly rain (independent storm check only) | ECMWF via Open-Meteo |
| `fetch_landcover.py` | WorldCover 2021, 10 m land cover | ESA |

Period: `config.py` (`END_DATE`, 5 years back).

## Model (`model.py`)

1. ICESat-2 vs SRTM regression → remove roof/canopy bias, report vertical error.
2. Priority-Flood+ε, D8 flow, accumulation, height above nearest drainage.
3. Storm events from IMERG (hourly shape from MERRA-2), kept only if ERA5 confirms ≥50 %.
4. SCS curve-number runoff (land cover + soil wetness on the day).
5. River overflow: Manning stage above bankfull (median annual-max storm), only channels ≥10 km².
6. Ponding: hour-by-hour basin storage vs assumed sewer/ditch drainage, in depressions that survive 20 terrain-error realisations.
7. Hotspots: built-up places with ≥30 cm, scored by depth, frequency over all storms and built-up area; named via OpenStreetMap Nominatim.

Tunable assumptions are at the top of `model.py`. This is a screening model, not an engineering flood study.

## Pernik · Studena dam-break scenario

| Script | What |
|---|---|
| `fetch_pernik.py` | SRTM terrain + WorldCover for the Struma valley (dam → Pernik), dam wall and reservoir outline from OpenStreetMap |
| `fetch_studena_s2.py` | Reservoir water area on every clear Sentinel-2 date (NDWI, AWS Open Data, no login) |
| `model_dambreak.py` | Full-supply level from the shoreline, synthetic bed scaled to 25.2 Mm³ and the 55 m wall, Sentinel-2 area → level → volume per date, breach width/time (Froehlich 2008), reference peak outflow (Froehlich 1995) |

The flood itself is computed live in the browser (`src/dambreak.worker.js`): a local-inertial 2D shallow-water solver (Bates et al. 2010) on the 28 m grid, starting from the lake level of the selected period. Hypothetical scenario for emergency planning, not a prediction.
