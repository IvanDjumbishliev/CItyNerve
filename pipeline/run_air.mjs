import { spawnSync } from 'node:child_process';
import path from 'node:path';

const python = process.platform === 'win32'
  ? path.join('pipeline', '.venv', 'Scripts', 'python.exe')
  : path.join('pipeline', '.venv', 'bin', 'python');
const result = spawnSync(python, [path.join('pipeline', 'run_air.py')], { stdio: 'inherit' });

if (result.error) {
  throw new Error(`Could not start the air pipeline interpreter at ${python}: ${result.error.message}`);
}
process.exit(result.status ?? 1);
