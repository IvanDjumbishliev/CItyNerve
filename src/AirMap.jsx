import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import { STYLE } from './FloodMap.jsx';
import {
  BANDS, NO_DATA_COLOUR, POLLUTANTS, UNIT,
  bandOf, bilinear, colourFor, sampleGrid,
} from '../shared/air.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const rgb = (colour) => `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`;
const SURFACE_WIDTH = 320;
const SURFACE_ALPHA = 0.66;
// Below this confidence the estimate is the CAMS model alone: drawn hatched and fainter.
const MODEL_ONLY_BELOW = 0.34;

export const SITE_KINDS = {
  school: { label: 'School', glyph: 'S', colour: '#64b5ff' },
  kindergarten: { label: 'Kindergarten', glyph: 'K', colour: '#ffd166' },
  hospital: { label: 'Hospital', glyph: 'H', colour: '#ff6b6b' },
  clinic: { label: 'Clinic', glyph: '+', colour: '#ff9f9f' },
  care: { label: 'Care home', glyph: 'C', colour: '#c9a7ff' },
};

/** MapLibre colour expression for the index bands of one pollutant; value < 0 means no data. */
function bandColourExpression(pollutant, property) {
  const value = ['get', property];
  const steps = ['step', value, rgb(BANDS[0].colour)];
  POLLUTANTS[pollutant].limits.forEach((limit, index) => steps.push(limit + 0.5, rgb(BANDS[index + 1].colour)));
  return ['case', ['<', value, 0], rgb(NO_DATA_COLOUR), steps];
}

function badgeImage(glyph, colour) {
  const size = 44;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.beginPath();
  context.roundRect(4, 4, size - 8, size - 8, 11);
  context.fillStyle = 'rgba(14, 18, 24, 0.94)';
  context.fill();
  context.lineWidth = 3;
  context.strokeStyle = colour;
  context.stroke();
  context.fillStyle = '#ffffff';
  context.font = '700 24px system-ui, "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(glyph, size / 2, size / 2 + 1.5);
  return { width: size, height: size, data: context.getImageData(0, 0, size, size).data };
}

function arrowImage() {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.translate(size / 2, size / 2);
  context.beginPath(); // points up (north) before rotation
  context.moveTo(0, -19);
  context.lineTo(9, -5);
  context.lineTo(3, -5);
  context.lineTo(3, 18);
  context.lineTo(-3, 18);
  context.lineTo(-3, -5);
  context.lineTo(-9, -5);
  context.closePath();
  context.fillStyle = 'rgba(255, 255, 255, 0.95)';
  context.strokeStyle = 'rgba(8, 14, 20, 0.9)';
  context.lineWidth = 2.5;
  context.stroke();
  context.fill();
  return { width: size, height: size, data: context.getImageData(0, 0, size, size).data };
}

/** Sparse wind arrows: model wind interpolated between lattice points (as u/v components). */
function windFeatures(lattice, wind) {
  if (!lattice || !wind?.speed || !wind?.direction) return EMPTY;
  const u = wind.speed.map((speed, index) => {
    const direction = wind.direction[index];
    return speed == null || direction == null ? null : -speed * Math.sin(direction * Math.PI / 180);
  });
  const v = wind.speed.map((speed, index) => {
    const direction = wind.direction[index];
    return speed == null || direction == null ? null : -speed * Math.cos(direction * Math.PI / 180);
  });
  const features = [];
  const { lons, lats } = lattice;
  const step = 0.05;
  for (let lat = lats[0] + step / 2; lat < lats.at(-1); lat += step) {
    for (let lon = lons[0] + step / 2; lon < lons.at(-1); lon += step) {
      const east = bilinear(lattice, u, lon, lat);
      const north = bilinear(lattice, v, lon, lat);
      if (east === null || north === null) continue;
      const speed = Math.hypot(east, north);
      features.push({
        type: 'Feature',
        properties: { speed: Math.round(speed * 10) / 10, to: (Math.atan2(east, north) * 180 / Math.PI + 360) % 360 },
        geometry: { type: 'Point', coordinates: [lon, lat] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

export default function AirMap({
  view, lattice, field, pollutant, factor, confidence, sensors, sites, wind, hotspots,
  layers, point, selectedSensor, selectedHotspot, popup,
  onPoint, onSensor, onHotspot, onPopupClose, onReady,
}) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const surface = useRef({ canvas: null, context: null, key: '' });
  const tip = useRef(null);
  const popupRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [popupHost, setPopupHost] = useState(null);
  const latest = useRef({});
  latest.current = { onPoint, onSensor, onHotspot, onPopupClose, pollutant };

  /* ── map ── */
  useEffect(() => {
    let map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: structuredClone(STYLE),
        center: view.center,
        zoom: view.zoom,
        pitch: view.pitch,
        bearing: view.bearing,
        maxPitch: 75,
        attributionControl: { compact: true },
        antialias: true,
      });
    } catch {
      return undefined;
    }
    mapRef.current = map;
    if (import.meta.env.DEV) window.__airMap = map;
    tip.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'air-tip' });
    map.once('style.load', () => {
      Object.entries(SITE_KINDS).forEach(([kind, spec]) =>
        map.addImage(`air-site-${kind}`, badgeImage(spec.glyph, spec.colour), { pixelRatio: 2 }));
      map.addImage('air-arrow', arrowImage(), { pixelRatio: 2 });

      map.addSource('air-wind', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'air-wind', type: 'symbol', source: 'air-wind',
        layout: { 'icon-image': 'air-arrow', 'icon-rotate': ['get', 'to'], 'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['get', 'speed'], 0, 0.45, 4, 0.75, 10, 1.1] },
        paint: { 'icon-opacity': ['interpolate', ['linear'], ['get', 'speed'], 0, 0.3, 2, 0.6, 6, 0.85] } });

      map.addSource('air-sites', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'air-sites-halo', type: 'circle', source: 'air-sites', filter: ['>=', ['get', 'band'], 4],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 20], 'circle-color': 'rgba(255, 69, 58, 0.28)',
          'circle-stroke-color': '#ff453a', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'air-sites', type: 'symbol', source: 'air-sites',
        layout: { 'icon-image': ['concat', 'air-site-', ['get', 'kind']], 'icon-padding': 3,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 0.95],
          'symbol-sort-key': ['-', 10, ['get', 'band']] } });

      map.addSource('air-sensors', { type: 'geojson', data: EMPTY, cluster: true, clusterMaxZoom: 10, clusterRadius: 34,
        clusterProperties: { worst: ['max', ['get', 'v']] } });
      map.addLayer({ id: 'air-sensor-clusters', type: 'circle', source: 'air-sensors', filter: ['has', 'point_count'],
        paint: { 'circle-radius': ['step', ['get', 'point_count'], 13, 10, 16, 50, 20],
          'circle-color': bandColourExpression('pm25', 'worst'), 'circle-stroke-color': '#0b1218', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'air-sensor-count', type: 'symbol', source: 'air-sensors', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
        paint: { 'text-color': '#0b1218' } });
      map.addLayer({ id: 'air-sensors', type: 'circle', source: 'air-sensors', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 12, 6, 15, 10],
          'circle-color': bandColourExpression('pm25', 'v'),
          'circle-opacity': ['case', ['get', 'humid'], 0.5, 0.95],
          'circle-stroke-color': ['case', ['get', 'selected'], '#ffffff', '#0b1218'],
          'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.2] } });

      map.addSource('air-hotspots', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'air-hotspots', type: 'circle', source: 'air-hotspots',
        paint: { 'circle-radius': ['case', ['get', 'selected'], 15, 11], 'circle-color': 'rgba(12, 18, 24, 0.88)',
          'circle-stroke-color': ['case', ['get', 'selected'], '#ffffff', '#ff9f0a'], 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'air-hotspot-rank', type: 'symbol', source: 'air-hotspots',
        layout: { 'text-field': ['get', 'rank'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-allow-overlap': true },
        paint: { 'text-color': '#ffffff' } });

      map.addSource('air-point', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'air-point', type: 'circle', source: 'air-point',
        paint: { 'circle-radius': 7, 'circle-color': 'rgba(255, 255, 255, 0.15)', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });

      const describe = (feature) => {
        const properties = feature.properties;
        const key = latest.current.pollutant;
        if (feature.layer.id === 'air-hotspots') return `<b>${properties.name}</b><span>Hotspot #${properties.rank}</span>`;
        const band = properties.v >= 0 ? bandOf(key, properties.v) : null;
        const reading = properties.v >= 0
          ? `${POLLUTANTS[key].label} ${Number(properties.v).toFixed(1)} ${UNIT} · ${band.label}`
          : `${POLLUTANTS[key].label} unavailable`;
        if (feature.layer.id === 'air-sensors')
          return `<b>${reading}</b><span>Citizen sensor · measured${properties.humid ? ' · high humidity' : ''}</span>`;
        return `<b>${properties.name || 'Unnamed site'}</b><span>${SITE_KINDS[properties.kind]?.label ?? ''} · ${reading} (estimate)</span>`;
      };
      ['air-sensors', 'air-sites', 'air-hotspots'].forEach((layer) => {
        map.on('mousemove', layer, (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          map.getCanvas().style.cursor = 'pointer';
          tip.current.setLngLat(event.lngLat).setHTML(describe(feature)).addTo(map);
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
          tip.current.remove();
        });
      });
      map.on('click', (event) => {
        const hits = map.queryRenderedFeatures(event.point, {
          layers: ['air-sensors', 'air-sensor-clusters', 'air-hotspots'].filter((id) => map.getLayer(id)),
        });
        const hit = hits[0];
        if (hit?.layer.id === 'air-sensors') { latest.current.onSensor?.(hit.properties.id); return; }
        if (hit?.layer.id === 'air-hotspots') { latest.current.onHotspot?.(hit.properties.id); return; }
        if (hit?.layer.id === 'air-sensor-clusters') {
          map.easeTo({ center: hit.geometry.coordinates, zoom: Math.max(map.getZoom() + 1.5, 11.5) });
          return;
        }
        latest.current.onPoint?.([event.lngLat.lng, event.lngLat.lat]);
      });
      setReady(true);
      onReady?.(map);
    });
    return () => {
      setReady(false);
      tip.current?.remove();
      popupRef.current?.remove();
      surface.current = { canvas: null, context: null, key: '' };
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── camera follows the selected town / view ── */
  const viewKey = `${view.center[0]},${view.center[1]},${view.zoom}`;
  const firstView = useRef(viewKey);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || firstView.current === viewKey) return;
    firstView.current = viewKey;
    map.flyTo({ center: view.center, zoom: view.zoom, pitch: view.pitch, bearing: view.bearing, duration: 1200 });
  }, [viewKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── layer 1: concentration surface (CAMS bilinear × local factor) ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !lattice) return;
    const { lons, lats } = lattice;
    const [west, south, east, north] = [lons[0], lats[0], lons.at(-1), lats.at(-1)];
    const key = [west, south, east, north].join(',');
    const state = surface.current;
    if (state.key !== key) {
      const aspect = (north - south) / ((east - west) * Math.cos(((north + south) / 2) * Math.PI / 180));
      const canvas = state.canvas ?? document.createElement('canvas');
      canvas.width = SURFACE_WIDTH;
      canvas.height = Math.max(8, Math.round(SURFACE_WIDTH * aspect));
      state.canvas = canvas;
      state.context = canvas.getContext('2d');
      state.key = key;
      const corners = [[west, north], [east, north], [east, south], [west, south]];
      if (map.getSource('air-surface')) {
        map.getSource('air-surface').setCoordinates(corners);
      } else {
        map.addSource('air-surface', { type: 'canvas', canvas, coordinates: corners, animate: false });
        map.addLayer({ id: 'air-surface', type: 'raster', source: 'air-surface',
          paint: { 'raster-opacity': 1, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, 'buildings-3d');
      }
    }
    const { canvas, context } = state;
    const image = context.createImageData(canvas.width, canvas.height);
    if (field) {
      const feather = Math.round(canvas.width * 0.05);
      for (let y = 0; y < canvas.height; y += 1) {
        const lat = north - ((y + 0.5) / canvas.height) * (north - south);
        for (let x = 0; x < canvas.width; x += 1) {
          const lon = west + ((x + 0.5) / canvas.width) * (east - west);
          const background = bilinear(lattice, field, lon, lat);
          if (background === null) continue;
          const colour = colourFor(pollutant, background * sampleGrid(factor, lon, lat, 1));
          if (!colour) continue;
          let alpha = SURFACE_ALPHA;
          if (confidence && sampleGrid(confidence, lon, lat, 0) < MODEL_ONLY_BELOW)
            alpha *= (x + y) % 7 < 2 ? 0.32 : 0.62;
          const edge = Math.min(x, y, canvas.width - 1 - x, canvas.height - 1 - y);
          if (edge < feather) alpha *= (edge + 1) / (feather + 1);
          const p = (y * canvas.width + x) * 4;
          image.data[p] = colour[0];
          image.data[p + 1] = colour[1];
          image.data[p + 2] = colour[2];
          image.data[p + 3] = Math.round(alpha * 255);
        }
      }
    }
    context.putImageData(image, 0, 0);
    // The canvas source is static: play for one frame so MapLibre re-reads the pixels.
    const source = map.getSource('air-surface');
    source.play();
    map.triggerRepaint();
    map.once('render', () => requestAnimationFrame(() => { if (mapRef.current === map) source.pause(); }));
  }, [ready, lattice, field, pollutant, factor, confidence]);

  /* ── layer 2: sensors ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource('air-sensors').setData({ type: 'FeatureCollection', features: (sensors ?? []).map((sensor) => ({
      type: 'Feature',
      properties: { id: sensor.id, v: sensor.value ?? -1, humid: sensor.status === 'humid', selected: sensor.id === selectedSensor },
      geometry: { type: 'Point', coordinates: [sensor.lon, sensor.lat] },
    })) });
  }, [ready, sensors, selectedSensor]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setPaintProperty('air-sensors', 'circle-color', bandColourExpression(pollutant, 'v'));
    map.setPaintProperty('air-sensor-clusters', 'circle-color', bandColourExpression(pollutant, 'worst'));
  }, [ready, pollutant]);

  /* ── layer 3: sensitive sites ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource('air-sites').setData(sites ?? EMPTY);
  }, [ready, sites]);

  /* ── layer 4: wind ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource('air-wind').setData(layers.wind ? windFeatures(lattice, wind) : EMPTY);
  }, [ready, lattice, wind, layers.wind]);

  /* ── hotspots and the inspected point ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource('air-hotspots').setData({ type: 'FeatureCollection', features: (hotspots ?? []).map((hotspot, index) => ({
      type: 'Feature',
      properties: { id: hotspot.id, name: hotspot.name, rank: String(index + 1), selected: hotspot.id === selectedHotspot },
      geometry: { type: 'Point', coordinates: hotspot.coord },
    })) });
  }, [ready, hotspots, selectedHotspot]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource('air-point').setData(point
      ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } } : EMPTY);
  }, [ready, point]);

  /* ── visibility toggles ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const show = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    show('air-surface', layers.surface);
    ['air-sensors', 'air-sensor-clusters', 'air-sensor-count'].forEach((id) => show(id, layers.sensors));
    show('air-sites', layers.sites);
    show('air-sites-halo', layers.sites && layers.highlight);
    show('air-wind', layers.wind);
    ['air-hotspots', 'air-hotspot-rank'].forEach((id) => show(id, layers.hotspots !== false));
    show('buildings-3d', layers.buildings);
  }, [ready, layers, lattice]);

  /* ── React-rendered popup (sensor details) ── */
  const popupKey = popup ? popup.lngLat.join(',') : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !popup) return undefined;
    const host = document.createElement('div');
    const instance = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 14, maxWidth: '300px', className: 'air-popup' })
      .setLngLat(popup.lngLat).setDOMContent(host).addTo(map);
    instance.on('close', () => latest.current.onPopupClose?.());
    popupRef.current = instance;
    setPopupHost(host);
    return () => {
      instance.off('close');
      instance.remove();
      setPopupHost(null);
    };
  }, [ready, popupKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>
    <div ref={container} className="map-canvas" role="application" aria-label="Air quality map" />
    {popup && popupHost && createPortal(popup.content, popupHost)}
  </>;
}
