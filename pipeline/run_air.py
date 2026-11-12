"""Run the AirNerve input and modelling pipeline on macOS, Linux, or Windows."""
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
for step in ("fetch_air_inputs.py", "fetch_air_sites.py", "air_model.py"):
    print(f"\n=== {step} ===", flush=True)
    subprocess.run([sys.executable, step], cwd=HERE, env=env, check=True)
