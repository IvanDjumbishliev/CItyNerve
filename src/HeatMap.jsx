import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { STYLE, makeDrapeCanvas, blit, refreshDrape } from './FloodMap.jsx';
import { riskLevel } from './data.js';
import { heatDataUrl } from './useHeatData.js';

const VIEW = { center: [23.326, 42.692], zoom: 11.9, pitch: 55, bearing: -20 };

// Heat ramp, shared with the legend in HeatNerve.jsx (value → colour).
export const SUHI_STOPS = [[-4, '#2F6E9A'], [0, '#5B7C8C'], [2, '#F7E3A1'], [4, '#FDBF5C'], [6, '#F68D45'], [8, '#E2573F'], [10, '#BC2F4F'], [13, '#6E1A55']];
export const LST_STOPS = [[22, '#2F6E9A'], [28, '#5B7C8C'], [32, '#F7E3A1'], [36, '#FDBF5C'], [40, '#F68D45'], [44, '#E2573F'], [48, '#BC2F4F'], [54, '#6E1A55']];

const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function colourAt(stops, v) {
  if (v <= stops[0][0]) return hex(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (v - a) / (b - a);
      const A = hex(ca), B = hex(cb);
      return A.map((x, k) => Math.round(x + (B[k] - x) * t));
    }
  }
  return hex(stops.at(-1)[1]);
}

/** 256-entry RGBA lookup for the uint8-encoded SUHI raster. */
function buildLut(enc, mode, refC) {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let v = 1; v < 256; v++) {
    const suhi = enc.lo + (v - 1) / enc.scale;
    const value = mode === 'lst' ? suhi + refC : suhi;
    const [r, g, b] = colourAt(mode === 'lst' ? LST_STOPS : SUHI_STOPS, value);
    const a = suhi < 0 ? 0.42 : suhi < 2 ? 0.12 + suhi * 0.16 : 0.8;
    lut.set([r, g, b, Math.round(a * 255)], v * 4);
  }
  return lut;
}

function decode(url, cb) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const v = new Uint8Array(img.width * img.height);
    for (let i = 0; i < v.length; i++) v[i] = px[i * 4];
    cb(v);
  };
  img.src = url;
}

export default function HeatMap({ summary, hotspots, png, mode, refC, layers, selectedId, onSelect, onReady }) {
  const box = useRef(null);
  const mapRef = useRef(null);
  const loaded = useRef(false);
  const heat = useRef({ values: null });
  const markers = useRef({});
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const look = useRef({ mode, refC });
  look.current = { mode, refC };

  const paintHeat = () => {
    const h = heat.current;
    if (!h.values || !h.ctx || !summary) return;
    const lut = buildLut(summary.encoding.suhi, look.current.mode, look.current.refC);
    const img = h.ctx.createImageData(h.w, h.h), o = img.data, v = h.values;
    for (let i = 0, p = 0; i < v.length; i++, p += 4) {
      const k = v[i] * 4;
      if (!v[i]) continue;
      o[p] = lut[k]; o[p + 1] = lut[k + 1]; o[p + 2] = lut[k + 2]; o[p + 3] = lut[k + 3];
    }
    h.ctx.putImageData(img, 0, 0);
    blit(h.drape, h.canvas);
    refreshDrape(mapRef.current);
  };

  useEffect(() => {
    const style = JSON.parse(JSON.stringify(STYLE));
    const map = new maplibregl.Map({ container: box.current, style, ...VIEW, maxPitch: 80, attributionControl: { compact: true }, antialias: true });
    mapRef.current = map;
    if (import.meta.env.DEV) window.__heatMap = map;
    map.once('style.load', () => {
      try { map.setTerrain({ source: 'dem', exaggeration: 1.4 }); } catch { /* terrain optional */ }
      try { map.setSky({ 'sky-color': '#1A1410', 'horizon-color': '#4A2E1C', 'fog-color': '#120E0B', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35 }); } catch { /* older engines */ }
      loaded.current = true;
      onReady?.(map);
    });
    return () => { loaded.current = false; map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // rasters + lidar (once the summary is known)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !summary) return;
    const attach = () => {
      if (map.getSource('heat')) return;
      const { cols, rows, bounds } = summary.grid;
      const canvas = document.createElement('canvas'); canvas.width = cols; canvas.height = rows;
      const drape = makeDrapeCanvas(bounds, cols, rows);
      heat.current = { ...heat.current, canvas, drape, ctx: canvas.getContext('2d'), w: cols, h: rows };
      map.addSource('heat', { type: 'canvas', canvas: drape.display, coordinates: drape.coords, animate: true });
      map.addLayer({ id: 'heat', type: 'raster', source: 'heat', paint: { 'raster-opacity': 0.88, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, 'buildings-3d');

      // vegetation (Landsat NDVI) — green where plants are actively cooling
      const gCanvas = document.createElement('canvas'); gCanvas.width = cols; gCanvas.height = rows;
      const gDrape = makeDrapeCanvas(bounds, cols, rows);
      map.addSource('green', { type: 'canvas', canvas: gDrape.display, coordinates: gDrape.coords, animate: false });
      map.addLayer({ id: 'green', type: 'raster', source: 'green', layout: { visibility: layers.green ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } }, 'buildings-3d');
      decode(heatDataUrl(summary.rasters.ndvi), (v) => {
        const e = summary.encoding.ndvi, ctx = gCanvas.getContext('2d');
        const img = ctx.createImageData(cols, rows), o = img.data;
        for (let i = 0, p = 0; i < v.length; i++, p += 4) {
          if (!v[i]) continue;
          const n = e.lo + (v[i] - 1) / e.scale;
          if (n < 0.3) continue;
          const t = Math.min(1, (n - 0.3) / 0.45);
          o[p] = 60 - 30 * t; o[p + 1] = 150 + 60 * t; o[p + 2] = 90; o[p + 3] = 70 + 140 * t;
        }
        ctx.putImageData(img, 0, 0);
        blit(gDrape, gCanvas);
        refreshDrape(map);
      });

      map.addSource('heat-lidar', { type: 'geojson', data: heatDataUrl(summary.rasters.lidar) });
      map.addLayer({ id: 'heat-lidar', type: 'circle', source: 'heat-lidar', layout: { visibility: layers.lidar ? 'visible' : 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 14, ['interpolate', ['linear'], ['get', 'h'], 0, 2, 30, 5], 17, ['interpolate', ['linear'], ['get', 'h'], 0, 4, 30, 9]],
          'circle-color': ['match', ['get', 'k'], 'tree', '#57C48E', 'canopy', '#9BE07A', 'roof', '#D7C2A8', 'mixed', '#A7B07A', '#5D6A73'],
          'circle-opacity': 0.85, 'circle-stroke-color': '#0C0A08', 'circle-stroke-width': 0.4,
        } });
      map.on('click', 'heat-lidar', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const kind = { tree: 'Tree canopy', canopy: 'Tree canopy', roof: 'Roof / structure', mixed: 'Mixed', low: 'Low surface' }[f.properties.k];
        new maplibregl.Popup({ closeButton: false, className: 'heat-popup' }).setLngLat(e.lngLat)
          .setHTML(`<b>${kind}</b> · ${f.properties.h} m<br><small>${f.properties.s} lidar</small>`).addTo(map);
      });
      map.on('mouseenter', 'heat-lidar', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'heat-lidar', () => { map.getCanvas().style.cursor = ''; });
      applyLayers(map, layers);
    };
    if (loaded.current) attach(); else map.once('style.load', attach);
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps

  // selected pass / median raster
  useEffect(() => {
    if (!png) return undefined;
    let alive = true;
    decode(heatDataUrl(png), (v) => { if (alive) { heat.current.values = v; paintHeat(); } });
    return () => { alive = false; };
  }, [png]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { paintHeat(); }, [mode, refC]); // eslint-disable-line react-hooks/exhaustive-deps

  // hotspot markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hotspots?.length) return;
    Object.values(markers.current).forEach(m => m.remove());
    markers.current = {};
    hotspots.forEach(h => {
      const el = document.createElement('button');
      el.className = `hs-marker heat-marker risk-${riskLevel(h.score)}`;
      el.setAttribute('aria-label', `${h.name}, heat score ${h.score}`);
      el.innerHTML = `<span class="hs-ring"></span><span class="hs-core">+${Math.round(h.uhi_c)}°</span><span class="hs-tip">${h.name} · ${h.district}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); onSelectRef.current?.(h.id); });
      markers.current[h.id] = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(h.coord).addTo(map);
    });
  }, [hotspots]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current) applyLayers(map, layers);
    Object.entries(markers.current).forEach(([id, m]) => {
      const el = m.getElement();
      el.style.display = layers.hotspots ? '' : 'none';
      el.classList.toggle('is-selected', id === selectedId);
    });
  }, [layers, selectedId]);

  return <div ref={box} className="map-canvas" />;
}

export const HEAT_VIEW = VIEW;

function applyLayers(map, layers) {
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('heat', layers.heat);
  vis('green', layers.green);
  vis('heat-lidar', layers.lidar);
  vis('buildings-3d', layers.buildings);
  try { map.setTerrain(layers.terrain ? { source: 'dem', exaggeration: 1.4 } : null); } catch { /* noop */ }
}
