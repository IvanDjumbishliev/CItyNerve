import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CITY, riskLevel } from './data.js';
import { dataUrl } from './useFloodData.js';

/* ─────────────── base style: OpenStreetMap via OpenFreeMap vector tiles ─────────────── */
const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
const DEM_TILES = ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'];
const STYLE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' },
    dem: { type: 'raster-dem', tiles: DEM_TILES, encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Terrain: SRTM (NASA) via AWS Terrain Tiles · Flood model: NASA GPM IMERG, MERRA-2, ICESat-2' },
    hill: { type: 'raster-dem', tiles: DEM_TILES, encoding: 'terrarium', tileSize: 256, maxzoom: 13 },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0C141C' } },
    { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland']]], paint: { 'fill-color': '#0F1D1B', 'fill-opacity': 0.9 } },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#112420', 'fill-opacity': 0.85 } },
    { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['industrial', 'railway', 'commercial']]], paint: { 'fill-color': '#121A23' } },
    { id: 'hillshade', type: 'hillshade', source: 'hill', paint: { 'hillshade-shadow-color': '#05090D', 'hillshade-highlight-color': '#3B5262', 'hillshade-accent-color': '#0A1118', 'hillshade-exaggeration': 0.55 } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#0E2C40' } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': '#1D4D6A', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 3] } },
    { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]], paint: { 'line-color': '#18232E', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 17, 5] } },
    { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]], paint: { 'line-color': '#26343F', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 17, 10] } },
    { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#222C35', 'line-width': 1, 'line-dasharray': [3, 3] } },
    { id: 'buildings-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#18232D', 25, '#22313D', 70, '#2E4252'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.2, ['coalesce', ['get', 'render_height'], 6]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.88,
      } },
    { id: 'place-label', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['suburb', 'quarter', 'neighbourhood', 'town', 'village']]],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13], 'text-transform': 'uppercase', 'text-letter-spacing': 0.12, 'text-max-width': 8 },
      paint: { 'text-color': '#6F8696', 'text-halo-color': '#0C141C', 'text-halo-width': 1.4 } },
    { id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14.5,
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'symbol-placement': 'line' },
      paint: { 'text-color': '#5D7181', 'text-halo-color': '#0C141C', 'text-halo-width': 1.2 } },
  ],
};

const DASH_SEQ = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];

// depth ramp (single hue, light = deeper on the dark map) — matches the legend
const RAMP = [
  { max: 0.3, rgb: [31, 95, 139] },
  { max: 1.0, rgb: [46, 143, 208] },
  { max: Infinity, rgb: [124, 203, 255] },
];
const MIN_SHOW = 0.1;

function circle([lng, lat], radius, steps = 40) {
  const kx = Math.cos(lat * Math.PI / 180), ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i % steps) / steps * Math.PI * 2;
    ring.push([lng + (Math.cos(t) * radius) / (111320 * kx), lat + (Math.sin(t) * radius) / 111320]);
  }
  return [ring];
}

export default function FloodMap({ summary, hotspots, png, factor, layers, selectedId, onSelect, onReady }) {
  const box = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const loaded = useRef(false);
  const raster = useRef({ canvas: null, ctx: null, depth: null, w: 0, h: 0 });
  const factorRef = useRef(factor);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  factorRef.current = factor;

  // draw the depth raster scaled by the timeline factor
  const paint = () => {
    const r = raster.current;
    if (!r.depth || !r.ctx) return;
    const img = r.ctx.createImageData(r.w, r.h);
    const out = img.data, d = r.depth, f = factorRef.current;
    for (let i = 0, p = 0; i < d.length; i++, p += 4) {
      const depth = (d[i] / 50) * f;
      if (depth < MIN_SHOW) continue;
      const c = depth < RAMP[0].max ? RAMP[0].rgb : depth < RAMP[1].max ? RAMP[1].rgb : RAMP[2].rgb;
      out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2]; out[p + 3] = 200;
    }
    r.ctx.putImageData(img, 0, 0);
  };

  // init once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current, style: STYLE,
      center: CITY.center, zoom: CITY.zoom, pitch: CITY.pitch, bearing: CITY.bearing,
      maxPitch: 80, attributionControl: { compact: true }, antialias: true,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) window.__floodMap = map;

    map.once('style.load', () => {
      try { map.setTerrain({ source: 'dem', exaggeration: 1.6 }); } catch (e) { /* terrain optional */ }
      try { map.setSky({ 'sky-color': '#0B1722', 'horizon-color': '#1A3447', 'fog-color': '#0C141C', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35 }); } catch (e) { /* older engines */ }

      map.addSource('streams', { type: 'geojson', data: dataUrl('streams.geojson') });
      map.addSource('icesat2', { type: 'geojson', data: dataUrl('icesat2.geojson') });
      map.addSource('ponds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({ id: 'icesat2', type: 'circle', source: 'icesat2', layout: { visibility: 'none' },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3], 'circle-color': '#E7F6A9', 'circle-opacity': 0.75 } }, 'buildings-3d');
      map.addLayer({ id: 'stream-glow', type: 'line', source: 'streams', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#4FC3F7', 'line-width': ['interpolate', ['linear'], ['get', 'km2'], 1, 2, 50, 7, 500, 14], 'line-blur': 6, 'line-opacity': 0.25 } }, 'buildings-3d');
      map.addLayer({ id: 'stream-flow', type: 'line', source: 'streams', layout: { 'line-join': 'round' },
        paint: { 'line-color': '#CDEFFF', 'line-width': ['interpolate', ['linear'], ['get', 'km2'], 1, 0.6, 50, 1.6, 500, 3], 'line-dasharray': DASH_SEQ[0], 'line-opacity': 0.75 } }, 'buildings-3d');
      map.addLayer({ id: 'ponds-3d', type: 'fill-extrusion', source: 'ponds',
        paint: { 'fill-extrusion-color': '#3FA9F5', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.5 } });

      let step = 0;
      const id = setInterval(() => {
        if (!mapRef.current) return;
        step = (step + 1) % DASH_SEQ.length;
        if (map.getLayer('stream-flow')) map.setPaintProperty('stream-flow', 'line-dasharray', DASH_SEQ[step]);
      }, 80);
      map.once('remove', () => clearInterval(id));

      loaded.current = true;
      onReady?.(map);
    });
    return () => { loaded.current = false; map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // flood raster source (needs grid bounds from the summary)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !summary) return;
    const attach = () => {
      if (map.getSource('flood')) return;
      const canvas = document.createElement('canvas');
      canvas.width = summary.grid.cols; canvas.height = summary.grid.rows;
      raster.current = { ...raster.current, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }), w: canvas.width, h: canvas.height };
      map.addSource('flood', { type: 'canvas', canvas, coordinates: summary.grid.bounds, animate: true });
      map.addLayer({ id: 'flood', type: 'raster', source: 'flood', paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, 'stream-glow');
      applyLayers(map, layers);
      paint();
    };
    if (loaded.current) attach(); else map.once('style.load', attach);
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps

  // load the depth PNG for the selected storm
  useEffect(() => {
    if (!png) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      const depth = new Uint8Array(img.width * img.height);
      for (let i = 0; i < depth.length; i++) depth[i] = px[i * 4];
      raster.current.depth = depth;
      paint();
    };
    img.src = dataUrl(png);
    return () => { alive = false; };
  }, [png]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { paint(); updatePonds(); }, [factor]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePonds = () => {
    const map = mapRef.current;
    if (!map || !map.getSource('ponds')) return;
    map.getSource('ponds').setData({
      type: 'FeatureCollection',
      features: (hotspots ?? []).map(h => ({
        type: 'Feature', properties: { height: Math.max(0.3, h.depth * factorRef.current * 20) },
        geometry: { type: 'Polygon', coordinates: circle(h.coord, Math.max(35, Math.sqrt(h.area_m2 / Math.PI) * 0.6)) },
      })),
    });
  };

  // hotspot markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hotspots?.length) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    hotspots.forEach(h => {
      const el = document.createElement('button');
      el.className = `hs-marker risk-${riskLevel(h.score)}`;
      el.setAttribute('aria-label', `${h.name}, risk score ${h.score}`);
      el.innerHTML = `<span class="hs-ring"></span><span class="hs-core">${h.score}</span><span class="hs-tip">${h.name} · ${h.district}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); onSelectRef.current?.({ kind: 'hotspot', id: h.id }); });
      markersRef.current[h.id] = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(h.coord).addTo(map);
    });
    const ready = () => updatePonds();
    if (loaded.current) ready(); else map.once('style.load', ready);
  }, [hotspots]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current) applyLayers(map, layers);
    Object.entries(markersRef.current).forEach(([id, m]) => {
      const el = m.getElement();
      el.style.display = layers.hotspots ? '' : 'none';
      el.classList.toggle('is-selected', id === selectedId);
    });
  }, [layers, selectedId]);

  return <div ref={box} className="map-canvas" />;
}

function applyLayers(map, layers) {
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('flood', layers.extent);
  vis('ponds-3d', layers.extent && layers.depth3d);
  vis('stream-flow', layers.flow);
  vis('stream-glow', layers.flow);
  vis('icesat2', layers.lidar);
  vis('buildings-3d', layers.buildings);
  try { map.setTerrain(layers.terrain ? { source: 'dem', exaggeration: 1.6 } : null); } catch (e) { /* noop */ }
}
