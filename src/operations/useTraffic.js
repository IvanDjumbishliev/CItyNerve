import { useEffect, useState } from 'react';
import { DEFAULT_CITY, distanceKm } from './engine.js';

export function useTraffic(city) {
  const supported = distanceKm(city, DEFAULT_CITY) < 3;
  const [state, setState] = useState({ data: null, error: '', loading: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true, running = false, controller;
    setState({ data: null, error: '', loading: supported });
    if (!supported) return;
    async function refresh() {
      if (running || document.hidden) return;
      running = true; controller = new AbortController();
      const request = controller, timer = setTimeout(() => request.abort(), 25000);
      try {
        const response = await fetch('/api/traffic?city=sofia', { signal: request.signal });
        if (!response.ok) throw Error('Traffic service unavailable.');
        const data = await response.json();
        if (data.city !== 'sofia' || !Array.isArray(data.rows)) throw Error('Invalid traffic response.');
        if (alive && !request.signal.aborted) setState({ data: { ...data, cityId: city.id }, error: data.error ?? '', loading: false });
      } catch (error) {
        if (alive) setState({ data: null, error: request.signal.aborted ? 'Traffic request timed out.' : error.message, loading: false });
      } finally { running = false; clearTimeout(timer); }
    }
    refresh(); const interval = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { alive = false; controller?.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [city.id, supported, revision]);
  return { ...state, data: state.data?.cityId === city.id ? state.data : null, supported, refresh: () => setRevision(n => n + 1) };
}
