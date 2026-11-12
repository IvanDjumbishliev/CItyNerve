import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
export default function OperationsMap({ city, boards, parking, incidents }) {
  const host = useRef(null), map = useRef(null), markers = useRef([]);
  const [ready, setReady] = React.useState(false), [error, setError] = React.useState('');
  useEffect(() => {
    try {
      const m = new maplibregl.Map({ container: host.current, center: [city.longitude, city.latitude], zoom: 12, style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] } });
      map.current = m; m.addControl(new maplibregl.NavigationControl()); m.on('load', () => setReady(true));
      return () => { markers.current.forEach(x => x.remove()); m.remove(); map.current = null; };
    } catch { setError('Map graphics unavailable. Board and parking details remain available below.'); }
  }, []);
  useEffect(() => {
    if (!map.current || !ready) return;
    map.current.flyTo({ center: [city.longitude, city.latitude], zoom: 12 });
    markers.current.forEach(m => m.remove());
    markers.current = [...parking.slice(0, 40).map(p => ({ ...p, symbol: 'P', detail: 'OSM parking · occupancy unknown unless simulated', color: '#2563eb' })), ...boards.map(b => ({ ...b, symbol: '▤', detail: 'Virtual board · demo placement', color: '#0f766e' })), ...incidents.map(i => ({ ...i, name: i.title, symbol: '!', detail: i.evidence, color: '#b45309' }))].map(p => {
      const el = document.createElement('button'); el.className = 'ops-marker'; el.textContent = p.symbol; el.style.background = p.color; el.setAttribute('aria-label', p.name);
      const text = document.createElement('div'); text.textContent = `${p.name} — ${p.detail}`;
      return new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).setPopup(new maplibregl.Popup().setDOMContent(text)).addTo(map.current);
    });
  }, [city, ready, boards, parking, incidents]);
  return <><div className="ops-map" ref={host} aria-label="Parking, virtual boards and active incident locations" />{error && <p role="status">{error}</p>}</>;
}
