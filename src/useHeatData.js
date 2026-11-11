import { useEffect, useState } from 'react';

const BASE = `${import.meta.env.BASE_URL}data/`;
let cache = null;

/** Loads the HeatNerve outputs written by pipeline/heat_model.py into public/data/heat. */
export function useHeatData() {
  const [state, setState] = useState(cache ?? { loading: true, error: null, summary: null, hotspots: [] });
  useEffect(() => {
    if (cache) return undefined;
    let alive = true;
    Promise.all([
      fetch(`${BASE}heat/summary.json`).then(r => { if (!r.ok) throw new Error('heat/summary.json missing'); return r.json(); }),
      fetch(`${BASE}heat/hotspots.json`).then(r => { if (!r.ok) throw new Error('heat/hotspots.json missing'); return r.json(); }),
    ]).then(([summary, hotspots]) => {
      cache = { loading: false, error: null, summary, hotspots };
      if (alive) setState(cache);
    }).catch(error => alive && setState({ loading: false, error: error.message, summary: null, hotspots: [] }));
    return () => { alive = false; };
  }, []);
  return state;
}

export const heatDataUrl = (file) => `${BASE}${file}`;
