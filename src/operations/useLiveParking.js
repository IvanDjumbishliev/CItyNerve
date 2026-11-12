import { useEffect, useState } from 'react';
import { operatorParkingRows, parkingCityFor } from './liveParking.js';

export function useLiveParking(city) {
  const providerCity = parkingCityFor(city);
  const [state, setState] = useState({ cityId: null, data: null, error: '', loading: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true, running = false, controller;
    setState({ cityId: city.id, data: null, error: '', loading: !!providerCity });
    if (!providerCity) return;
    async function refresh() {
      if (running) return;
      running = true; controller = new AbortController();
      const request = controller, timer = setTimeout(() => request.abort(), 25000);
      try {
        const response = await fetch(`/api/parking/${providerCity}`, { signal: request.signal });
        if (!response.ok) throw Error('Live parking provider unavailable.');
        const data = await response.json();
        if (!Array.isArray(data.facilities)) throw Error('Invalid live parking response.');
        if (alive && !request.signal.aborted) setState({ cityId: city.id, data, error: data.stale ? 'Provider is unavailable; cached counts are withheld from boards.' : '', loading: false });
      } catch (error) {
        if (alive) setState({ cityId: city.id, data: null, error: request.signal.aborted ? 'Live parking request timed out.' : error.message, loading: false });
      } finally { clearTimeout(timer); running = false; }
    }
    refresh(); const timer = setInterval(refresh, 60000);
    return () => { alive = false; controller?.abort(); clearInterval(timer); };
  }, [city.id, providerCity, revision]);
  const current = state.cityId === city.id ? state : { data: null, error: '', loading: !!providerCity };
  return { ...current, supported: !!providerCity, rows: operatorParkingRows(city, current.data), refresh: () => setRevision(n => n + 1) };
}
