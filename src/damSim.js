// Controller for the Studena dam-break simulation (loads data, drives the worker,
// fans out frames to the map and stats to the HUD without re-rendering React per frame).
import { dataUrl } from './useFloodData.js';

let meta = null, terrain = null, masks = null, built = null, worker = null;
const frameSubs = new Set(), statSubs = new Set();
let lastStats = null;

export async function loadDam() {
  if (meta) return meta;
  const [m, t, k, b] = await Promise.all([
    fetch(dataUrl('pernik/pernik.json')).then(r => { if (!r.ok) throw new Error('pernik.json missing'); return r.json(); }),
    fetch(dataUrl('pernik/terrain.bin')).then(r => r.arrayBuffer()),
    fetch(dataUrl('pernik/masks.bin')).then(r => r.arrayBuffer()),
    fetch(dataUrl('pernik/built.bin')).then(r => r.arrayBuffer()),
  ]);
  meta = m; terrain = new Float32Array(t); masks = new Uint8Array(k); built = new Uint8Array(b);
  return meta;
}

export const getDamMeta = () => meta;

/** Reservoir state on (or just before) a date, from Sentinel-2. */
export function levelOn(isoDate) {
  if (!meta) return null;
  const s = meta.levels;
  if (!isoDate) return s.reduce((a, b) => (b.volume_mm3 > a.volume_mm3 ? b : a));   // 5-year maximum
  const d = isoDate.slice(0, 10);
  let best = s[0];
  for (const x of s) { if (x.date <= d) best = x; else break; }
  return best;
}

export function startSim({ level, mode, speed }) {
  stopSim();
  worker = new Worker(new URL('./dambreak.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'frame') frameSubs.forEach(f => f(m));
    else if (m.type === 'stats' || m.type === 'done') { lastStats = m.type === 'done' ? { ...lastStats, done: true } : m; statSubs.forEach(f => f(lastStats)); }
    else if (m.type === 'ready') worker.postMessage({ type: 'play' });
  };
  const d = meta.dam, g = meta.grid;
  worker.postMessage({ type: 'speed', speed });
  worker.postMessage({
    type: 'init', rows: g.rows, cols: g.cols, dx: g.cell_m, z: terrain.slice(), masks, built,
    crest: d.crest_m, toe: d.toe_m, tf: d.breach_time_s, level, mode, pernikBox: meta.pernik.box_rc,
  });
}
export const pauseSim = () => worker?.postMessage({ type: 'pause' });
export const playSim = () => worker?.postMessage({ type: 'play' });
export const setSimSpeed = (speed) => worker?.postMessage({ type: 'speed', speed });
export const showMaxExtent = () => worker?.postMessage({ type: 'maxextent' });
export function stopSim() {
  worker?.terminate(); worker = null; lastStats = null;
  frameSubs.forEach(f => f(null)); statSubs.forEach(f => f(null));
}
export function onFrame(fn) { frameSubs.add(fn); return () => frameSubs.delete(fn); }
export function onStats(fn) { statSubs.add(fn); return () => statSubs.delete(fn); }
