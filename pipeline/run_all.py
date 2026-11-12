"""Run the full FloodNerve data pipeline: download real data, then model.

    pipeline/.venv/Scripts/python pipeline/run_all.py      (Windows)
    pipeline/.venv/bin/python pipeline/run_all.py          (macOS/Linux)
"""
import os, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = ["fetch_dem.py", "fetch_landcover.py", "fetch_power.py", "fetch_imerg.py", "fetch_era5.py", "fetch_icesat2.py", "model.py",
         "fetch_pernik.py", "fetch_studena_s2.py", "fetch_moew.py", "model_dambreak.py"]
FLOOD = ["fetch_dem.py", "fetch_landcover.py", "fetch_power.py", "fetch_imerg.py", "fetch_era5.py", "fetch_icesat2.py", "model.py"]
FOG = ["fetch_fog_inputs.py", "fetch_fog_roads.py", "fog_model.py"]
AIR = ["fetch_air_inputs.py", "fetch_air_sites.py", "air_model.py"]

base = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
for s in STEPS:                       # Sofia flood model + Studena dam scenario
    print(f"\n=== {s} ===", flush=True)
    subprocess.run([sys.executable, s], cwd=HERE, env={**base, "REGION": "sofia"}, check=True)
for s in FLOOD:                       # Pernik flood model (same method, Pernik rain point and area)
    print(f"\n=== pernik: {s} ===", flush=True)
    subprocess.run([sys.executable, s], cwd=HERE, env={**base, "REGION": "pernik"}, check=True)
for s in FOG:                          # Sofia fog observations and screening model
    print(f"\n=== fog: {s} ===", flush=True)
    subprocess.run([sys.executable, s], cwd=HERE, env=base, check=True)
for s in AIR:                          # Sofia air-quality history, sensor factor and hotspots
    print(f"\n=== air: {s} ===", flush=True)
    subprocess.run([sys.executable, s], cwd=HERE, env=base, check=True)
