import { useEffect, useState } from 'react';
import { REGIONS } from './data.js';

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = {};

/** Loads the model outputs written by pipeline/model.py (REGION=sofia|pernik) into public/data. */
export function useFloodData(region = 'sofia') {
  const base = REGIONS[region]?.base ?? '';
  const empty = { loading: true, error: null, summary: null, hotspots: [], base, region };
  const [state, setState] = useState(cache[region] ?? empty);
  useEffect(() => {
    if (cache[region]) { setState(cache[region]); return; }
    setState(empty);
    let alive = true;
    Promise.all([
      fetch(`${BASE}${base}summary.json`).then(r => { if (!r.ok) throw new Error(`${base}summary.json missing`); return r.json(); }),
      fetch(`${BASE}${base}hotspots.json`).then(r => { if (!r.ok) throw new Error(`${base}hotspots.json missing`); return r.json(); }),
    ]).then(([summary, hotspots]) => {
      cache[region] = { loading: false, error: null, summary, hotspots, base, region };
      if (alive) setState(cache[region]);
    }).catch(err => alive && setState({ ...empty, loading: false, error: err.message }));
    return () => { alive = false; };
  }, [region]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export const dataUrl = (file) => `${BASE}${file}`;
