import { useEffect, useState } from 'react';

const BASE = `${import.meta.env.BASE_URL}data/`;
let cache = null;

/** Loads the model outputs written by pipeline/model.py into public/data. */
export function useFloodData() {
  const [state, setState] = useState(cache ?? { loading: true, error: null, summary: null, hotspots: [] });
  useEffect(() => {
    if (cache) return;
    let alive = true;
    Promise.all([
      fetch(`${BASE}summary.json`).then(r => { if (!r.ok) throw new Error('summary.json missing'); return r.json(); }),
      fetch(`${BASE}hotspots.json`).then(r => { if (!r.ok) throw new Error('hotspots.json missing'); return r.json(); }),
    ]).then(([summary, hotspots]) => {
      cache = { loading: false, error: null, summary, hotspots };
      if (alive) setState(cache);
    }).catch(err => alive && setState({ loading: false, error: err.message, summary: null, hotspots: [] }));
    return () => { alive = false; };
  }, []);
  return state;
}

export const dataUrl = (file) => `${BASE}${file}`;
