import { useEffect, useState } from 'react';

const BASE = `${import.meta.env.BASE_URL}data/`;

export function useFogData() {
  const [state, setState] = useState({ loading: true, error: null, summary: null, events: [], hotspots: [], riskRegister: [] });
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`${BASE}fog_summary.json`).then(response => {
        if (!response.ok) throw new Error('fog_summary.json missing');
        return response.json();
      }),
      fetch(`${BASE}fog_events.json`).then(response => {
        if (!response.ok) throw new Error('fog_events.json missing');
        return response.json();
      }),
      fetch(`${BASE}fog_hotspots.json`).then(response => {
        if (!response.ok) throw new Error('fog_hotspots.json missing');
        return response.json();
      }),
      fetch(`${BASE}fog_risk_register.json`).then(response => {
        if (!response.ok) throw new Error('fog_risk_register.json missing');
        return response.json();
      }),
    ]).then(([summary, events, hotspots, riskRegister]) => {
      if (alive) setState({ loading: false, error: null, summary, events, hotspots, riskRegister });
    }).catch(error => {
      if (alive) setState(current => ({ ...current, loading: false, error: error.message }));
    });
    return () => { alive = false; };
  }, []);
  return state;
}

export const fogDataUrl = (file) => `${BASE}${file}`;
