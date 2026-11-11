"""Run the FogNerve input and modelling pipeline on macOS, Linux, or Windows."""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"

if not (WORK / "grid.json").exists() or not (WORK / "dem.npy").exists():
    subprocess.run([sys.executable, "fetch_dem.py"], cwd=HERE, check=True)
if not (WORK / "landcover.npy").exists() or not (WORK / "built_frac.npy").exists():
    subprocess.run([sys.executable, "fetch_landcover.py"], cwd=HERE, check=True)

for step in ("fetch_fog_inputs.py", "fetch_fog_roads.py", "fog_model.py"):
    print(f"\n=== {step} ===", flush=True)
    subprocess.run([sys.executable, step], cwd=HERE, check=True)
