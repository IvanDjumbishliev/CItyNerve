"""Run the HeatNerve pipeline: Landsat thermal + GEDI/ICESat-2 lidar + NASA POWER -> public/data/heat."""
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

if not (WORK / "grid.json").exists() or not (WORK / "dem.npy").exists():
    subprocess.run([sys.executable, "fetch_dem.py"], cwd=HERE, check=True, env=env)
if not (WORK / "landcover.npy").exists() or not (WORK / "built_frac.npy").exists():
    subprocess.run([sys.executable, "fetch_landcover.py"], cwd=HERE, check=True, env=env)

for step in ("fetch_heat_power.py", "fetch_heat_lidar.py", "fetch_landsat_heat.py", "heat_model.py"):
    print(f"\n=== {step} ===", flush=True)
    subprocess.run([sys.executable, step], cwd=HERE, check=True, env=env)
