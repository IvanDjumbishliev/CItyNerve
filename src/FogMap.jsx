import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { STYLE } from './FloodMap.jsx';
import { CITY, riskLevel } from './data.js';
import { fogDataUrl } from './useFogData.js';

const VISIBILITY_COLOURS = [
  { limit: 200, colour: [239, 244, 246], opacity: 0.9 },
  { limit: 1000, colour: [205, 217, 223], opacity: 0.72 },
  { limit: 5000, colour: [152, 173, 184], opacity: 0.4 },
  { limit: Infinity, colour: [105, 130, 143], opacity: 0.08 },
];

export default function FogMap({ grid, raster, fogProbability, expectedVisibility, hotspots, layers, selectedId, onSelect, onReady }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const loaded = useRef(false);
  const [ready, setReady] = useState(false);
  const values = useRef(null);
  const contextRef = useRef(null);
  const fogProbabilityRef = useRef(fogProbability);
  const expectedVisibilityRef = useRef(expectedVisibility);
  const onSelectRef = useRef(onSelect);
  fogProbabilityRef.current = fogProbability;
  expectedVisibilityRef.current = expectedVisibility;
  onSelectRef.current = onSelect;

  const repaint = () => {
    const ctx = contextRef.current;
    const data = values.current;
    if (!ctx || !data) return;
    const image = ctx.createImageData(data.width, data.height);
    for (let i = 0, p = 0; i < data.factors.length; i += 1, p += 4) {
      const probability = Math.max(0, Math.min(1, fogProbabilityRef.current * data.factors[i]));
      if (probability <= 0.025) continue;
      const localVisibility = expectedVisibilityRef.current == null
        ? 10000 : expectedVisibilityRef.current / Math.max(0.35, data.factors[i]);
      const visibilityClass = VISIBILITY_COLOURS.find(item => localVisibility < item.limit) ?? VISIBILITY_COLOURS.at(-1);
      const colour = visibilityClass.colour;
      image.data[p] = colour[0];
      image.data[p + 1] = colour[1];
      image.data[p + 2] = colour[2];
      image.data[p + 3] = Math.round(Math.min(0.78, probability * 0.8 * visibilityClass.opacity) * 255);
    }
    ctx.putImageData(image, 0, 0);
  };

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current,
      style: JSON.parse(JSON.stringify(STYLE)),
      center: CITY.center,
      zoom: CITY.zoom,
      pitch: CITY.pitch,
      bearing: CITY.bearing,
      maxPitch: 80,
      attributionControl: { compact: true },
      antialias: true,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) window.__fogMap = map;
    map.once('style.load', () => {
      try { map.setTerrain({ source: 'dem', exaggeration: 1.6 }); } catch { /* terrain tiles may be unavailable */ }
      try {
        map.setSky({ 'sky-color': '#B8C6CE', 'horizon-color': '#D6E0E5', 'fog-color': '#AAB8C0',
          'sky-horizon-blend': 0.72, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.38 });
      } catch { /* optional on older MapLibre engines */ }
      loaded.current = true;
      setReady(true);
      onReady?.(map);
    });
    return () => {
      loaded.current = false;
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !grid?.bounds || !raster) return;
    let alive = true;
    const attach = () => {
      if (!alive || !loaded.current || map.getSource('fog')) return;
      const img = new Image();
      img.onload = () => {
        if (!alive || !map.getStyle()) return;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
        const factors = new Float32Array(img.width * img.height);
        for (let i = 0; i < factors.length; i += 1) factors[i] = (pixels[i * 4] / 255) * 1.4;
        values.current = { width: img.width, height: img.height, factors };
        contextRef.current = ctx;
        map.addSource('fog', { type: 'canvas', canvas, coordinates: grid.bounds, animate: true });
        map.addLayer({ id: 'fog-layer', type: 'raster', source: 'fog',
          paint: { 'raster-opacity': 0.9, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, 'buildings-3d');
        const valleyCanvas = document.createElement('canvas');
        valleyCanvas.width = img.width;
        valleyCanvas.height = img.height;
        const valleyContext = valleyCanvas.getContext('2d');
        if (valleyContext) {
          const valleyPixels = valleyContext.createImageData(img.width, img.height);
          for (let i = 0, p = 0; i < factors.length; i += 1, p += 4) {
            const intensity = Math.max(0, Math.min(1, (factors[i] - 0.75) / 0.65));
            valleyPixels.data[p] = 164;
            valleyPixels.data[p + 1] = 190;
            valleyPixels.data[p + 2] = 203;
            valleyPixels.data[p + 3] = Math.round(intensity * 135);
          }
          valleyContext.putImageData(valleyPixels, 0, 0);
          map.addSource('fog-valley', { type: 'canvas', canvas: valleyCanvas, coordinates: grid.bounds });
          map.addLayer({ id: 'fog-valley-layer', type: 'raster', source: 'fog-valley',
            paint: { 'raster-opacity': 0.55, 'raster-resampling': 'linear', 'raster-fade-duration': 0 },
            layout: { visibility: layers.valley ? 'visible' : 'none' } }, 'buildings-3d');
        }
        repaint();
      };
      img.onerror = () => {
        if (alive) console.error(`Unable to load fog raster: ${raster}`);
      };
      img.src = fogDataUrl(raster);
    };
    attach();
    return () => { alive = false; };
  }, [grid, raster, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    repaint();
  }, [fogProbability, expectedVisibility]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !loaded.current) return;
    const fogLayer = map.getLayer('fog-layer');
    if (fogLayer) map.setLayoutProperty('fog-layer', 'visibility', layers.extent ? 'visible' : 'none');
    const valleyLayer = map.getLayer('fog-valley-layer');
    if (valleyLayer) map.setLayoutProperty('fog-valley-layer', 'visibility', layers.valley ? 'visible' : 'none');
    if (map.getLayer('buildings-3d')) map.setLayoutProperty('buildings-3d', 'visibility', layers.buildings ? 'visible' : 'none');
    try { map.setTerrain(layers.terrain ? { source: 'dem', exaggeration: 1.6 } : null); } catch { /* terrain tiles may be unavailable */ }
  }, [layers.extent, layers.valley, layers.buildings, layers.terrain, raster, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const attach = () => {
      if (!loaded.current || !hotspots?.length || map.getSource('fog-hotspots')) return;
      map.addSource('fog-hotspots', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: hotspots.map(hotspot => ({
          type: 'Feature',
          properties: { id: hotspot.id, score: hotspot.score, name: hotspot.name, risk: riskLevel(hotspot.score) },
          geometry: { type: 'Point', coordinates: hotspot.coord },
        })) },
      });
      map.addLayer({ id: 'fog-hotspots', type: 'circle', source: 'fog-hotspots',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 15, 11],
          'circle-color': ['match', ['get', 'risk'], 'critical', '#F2594B', 'high', '#F39237', 'moderate', '#E8C547', '#57C48E'],
          'circle-stroke-color': '#E8F0F4', 'circle-stroke-width': 1.5, 'circle-opacity': 0.9 } });
      map.on('click', 'fog-hotspots', event => {
        const feature = event.features?.[0];
        if (feature) onSelectRef.current?.(feature.properties.id);
      });
      map.on('mouseenter', 'fog-hotspots', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'fog-hotspots', () => { map.getCanvas().style.cursor = ''; });
    };
    attach();
    return () => {
      if (mapRef.current !== map || !loaded.current) return;
      if (map.getLayer('fog-hotspots')) map.removeLayer('fog-hotspots');
      if (map.getSource('fog-hotspots')) map.removeSource('fog-hotspots');
    };
  }, [hotspots, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (map.getLayer('fog-hotspots')) {
      map.setLayoutProperty('fog-hotspots', 'visibility', layers.hotspots ? 'visible' : 'none');
    }
    if (selectedId) {
      const selected = hotspots.find(hotspot => hotspot.id === selectedId);
      if (selected) map.flyTo({ center: selected.coord, zoom: 15.4, pitch: 62, duration: 1300,
        padding: { right: window.innerWidth > 900 ? 360 : 0 } });
    }
  }, [selectedId, layers.hotspots, hotspots]);

  return <div ref={container} className="map-canvas" />;
}
