import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

const EMPTY = { type: 'FeatureCollection', features: [] };
export default function TransportMap({ city, points, selected, onSelect, roads = EMPTY, traffic = false, label }) {
  const host = useRef(null), map = useRef(null), markers = useRef([]), selection = useRef(onSelect);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  selection.current = onSelect;
  useEffect(() => {
    let view;
    try {
      view = new maplibregl.Map({ container: host.current, center: [city.longitude, city.latitude], zoom: 11.5,
        style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] } });
      map.current = view;
      view.addControl(new maplibregl.NavigationControl());
      view.on('load', () => {
        view.addSource('traffic', { type: 'geojson', data: EMPTY, ...(traffic ? { attribution: 'Traffic © TomTom' } : {}) });
        view.addLayer({ id: 'traffic-outline', type: 'line', source: 'traffic', paint: { 'line-color': '#132333', 'line-width': 10, 'line-opacity': .65 } });
        view.addLayer({ id: 'traffic-lines', type: 'line', source: 'traffic', paint: { 'line-color': ['get', 'color'], 'line-width': 6 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        view.on('click', 'traffic-lines', e => selection.current(e.features?.[0]?.properties.id));
        view.on('mouseenter', 'traffic-lines', () => { view.getCanvas().style.cursor = 'pointer'; });
        view.on('mouseleave', 'traffic-lines', () => { view.getCanvas().style.cursor = ''; });
        setReady(true);
      });
      view.on('error', () => setError('Some map tiles could not load. Readings remain available in the list.'));
    } catch { setError('Map graphics are unavailable. Use the readings below.'); }
    return () => { markers.current.forEach(m => m.remove()); view?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (ready) map.current?.jumpTo({ center: [city.longitude, city.latitude], zoom: 11.5 });
  }, [ready, city.latitude, city.longitude]);
  useEffect(() => {
    if (ready) map.current?.getSource('traffic')?.setData(roads);
  }, [ready, roads]);
  useEffect(() => {
    if (!ready || !map.current) return;
    markers.current.forEach(m => m.remove());
    markers.current = points.map(p => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = `transport-pin${p.id === selected ? ' is-selected' : ''}`;
      el.textContent = p.symbol; el.style.background = p.color;
      el.title = `${p.name} · ${p.detail}`; el.setAttribute('aria-label', el.title);
      el.setAttribute('aria-pressed', String(p.id === selected));
      el.onclick = () => selection.current(p.id);
      const marker = new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(map.current);
      el.setAttribute('aria-label', el.title);
      return marker;
    });
  }, [ready, points, selected]);
  // Realtime updates must not reset the user's zoom or map position.
  const focus = points.find(p => p.id === selected);
  useEffect(() => {
    if (ready && focus) {
      map.current?.easeTo({ center: [focus.longitude, focus.latitude], zoom: 14, duration: 500 });
      host.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [ready, selected, focus?.latitude, focus?.longitude]);
  return <><div className="ops-map transport-map" ref={host} aria-label={label} />{error && <p role="status" className="ops-note">{error}</p>}</>;
}
