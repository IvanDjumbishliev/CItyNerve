import { useEffect, useState } from 'react';
import { airTownFor } from './boardAir.js';

export function useBoardAir(city) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const town = airTownFor(city);
  useEffect(() => {
    let alive = true, running = false, controller;
    setData(null); setError(''); setLoading(false);
    if (!town) return;
    async function refresh() {
      if (running) return;
      running = true; setLoading(true); controller = new AbortController();
      const request = controller, timeout = setTimeout(() => request.abort(), 30000);
      try {
        const response = await fetch(`/api/air?town=${encodeURIComponent(town.id)}`, { signal: request.signal });
        if (!response.ok) throw Error('AirNerve service is unavailable.');
        const snapshot = await response.json();
        if (!alive || request.signal.aborted) return;
        if (snapshot.town?.id !== town.id) throw Error('AirNerve returned a different city.');
        setData({ ...snapshot, cityId: city.id });
        setError(snapshot.cams?.status === 'ok' ? '' : 'No fresh air model is available. Air messages are withheld.');
      } catch (err) {
        if (alive) { setData(null); setError(request.signal.aborted ? 'Air request timed out. Retrying automatically.' : err.message); }
      } finally { clearTimeout(timeout); running = false; if (alive) setLoading(false); }
    }
    refresh();
    const timer = setInterval(refresh, 5 * 60000);
    return () => { alive = false; controller?.abort(); clearInterval(timer); };
  }, [city.id, town?.id, revision]);
  return { data: data?.cityId === city.id ? data : null, error, loading, supported: !!town, refresh: () => setRevision(n => n + 1) };
}
