import { useCallback, useEffect, useRef, useState } from 'react';

const BASE = `${import.meta.env.BASE_URL}data/`;
export const airDataUrl = (file) => `${BASE}${file}`;
const REFRESH_MS = 5 * 60000; // sensor.community updates every 5 minutes

/** Live snapshot from our own server (/api/air). Keeps the last good copy if a refresh fails. */
export function useAirLive(townId) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const version = useRef(0);
  const load = useCallback(() => {
    const current = ++version.current;
    setState((previous) => ({
      data: previous.data?.town.id === townId ? previous.data : null,
      loading: true,
      error: null,
    }));
    fetch(`/api/air?town=${encodeURIComponent(townId)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Air service answered ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (current === version.current) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (current === version.current)
          setState((previous) => ({ data: previous.data, loading: false, error: error.message }));
      });
  }, [townId]);
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(timer);
      version.current += 1;
    };
  }, [load]);
  return { ...state, refresh: load };
}

/** Last-24 h series for one sensor, fetched when a sensor is opened. */
export function useSensorHistory(townId, sensorId) {
  const [state, setState] = useState({ hours: null, loading: false, error: null, note: null });
  useEffect(() => {
    if (sensorId == null) {
      setState({ hours: null, loading: false, error: null, note: null });
      return undefined;
    }
    let alive = true;
    setState({ hours: null, loading: true, error: null, note: null });
    fetch(`/api/air/history?town=${encodeURIComponent(townId)}&sensor=${sensorId}`)
      .then((response) => {
        if (!response.ok) throw new Error('History unavailable');
        return response.json();
      })
      .then((data) => {
        if (alive) setState({ hours: data.hours, loading: false, error: null, note: data.note });
      })
      .catch((error) => {
        if (alive) setState({ hours: null, loading: false, error: error.message, note: null });
      });
    return () => { alive = false; };
  }, [townId, sensorId]);
  return state;
}

const optional = (file) => fetch(`${BASE}${file}`)
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);

/** Pipeline outputs for the Analysis pages. Only the summary is required. */
export function useAirData() {
  const [state, setState] = useState({
    loading: true, error: null, summary: null, events: [], hotspots: [], riskRegister: [],
  });
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`${BASE}air_summary.json`).then((response) => {
        if (!response.ok) throw new Error('air_summary.json missing');
        return response.json();
      }),
      optional('air_events.json'),
      optional('air_hotspots.json'),
      optional('air_risk_register.json'),
    ]).then(([summary, events, hotspots, riskRegister]) => {
      if (alive) setState({
        loading: false, error: null, summary,
        events: events ?? [], hotspots: hotspots ?? [], riskRegister: riskRegister ?? [],
      });
    }).catch((error) => {
      if (alive) setState((current) => ({ ...current, loading: false, error: error.message }));
    });
    return () => { alive = false; };
  }, []);
  return state;
}

/** Sensitive sites for one town (written by the pipeline); null when not generated. */
export function useAirSites(townId) {
  const [sites, setSites] = useState(null);
  useEffect(() => {
    let alive = true;
    setSites(null);
    optional(townId === 'sofia' ? 'air_sites.geojson' : `air_sites_${townId}.geojson`).then((data) => {
      if (alive) setSites(data?.features ? data : null);
    });
    return () => { alive = false; };
  }, [townId]);
  return sites;
}

/** Decode the red channel of a PNG raster written by air_model.py into numbers. */
function loadRaster(file, bounds, scale) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) { resolve(null); return; }
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const data = new Float32Array(image.width * image.height);
      for (let index = 0; index < data.length; index += 1) data[index] = (pixels[index * 4] / 255) * scale;
      resolve({ width: image.width, height: image.height, data, bounds });
    };
    image.onerror = () => resolve(null);
    image.src = `${BASE}${file}`;
  });
}

/** Local factor and confidence rasters described in the summary's `grid` block. */
export function useAirRasters(grid) {
  const [rasters, setRasters] = useState({ factor: null, confidence: null });
  useEffect(() => {
    let alive = true;
    if (!grid?.factor_raster) {
      setRasters({ factor: null, confidence: null });
      return undefined;
    }
    Promise.all([
      loadRaster(grid.factor_raster, grid.bbox, grid.factor_scale),
      grid.confidence_raster ? loadRaster(grid.confidence_raster, grid.bbox, 1) : null,
    ]).then(([factor, confidence]) => {
      if (alive) setRasters({ factor, confidence });
    });
    return () => { alive = false; };
  }, [grid?.factor_raster, grid?.confidence_raster]); // eslint-disable-line react-hooks/exhaustive-deps
  return rasters;
}
