"""Run the full FloodNerve data pipeline: download real data, then model.

    pipeline/.venv/Scripts/python pipeline/run_all.py      (Windows)
    pipeline/.venv/bin/python pipeline/run_all.py          (macOS/Linux)
"""
import os, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = ["fetch_dem.py", "fetch_landcover.py", "fetch_power.py", "fetch_imerg.py", "fetch_era5.py", "fetch_icesat2.py", "model.py",
         "fetch_pernik.py", "fetch_studena_s2.py", "model_dambreak.py"]

env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
for s in STEPS:
    print(f"\n=== {s} ===", flush=True)
    subprocess.run([sys.executable, s], cwd=HERE, env=env, check=True)
