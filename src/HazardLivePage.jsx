import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { AlertCircle, LocateFixed, Minus, Plus, RotateCcw } from 'lucide-react';
import { CITY, HAZARD_MODULES } from './data.js';
import { STYLE } from './FloodMap.jsx';
import ModuleTabs from './ModuleTabs.jsx';
import HazardHistory from './HazardHistory.jsx';
import { useFloodData } from './useFloodData.js';
import { useFogData } from './useFogData.js';

const EMPTY_EVENTS = [];

export default function HazardLivePage({ moduleId, onNavigate }) {
  const module = HAZARD_MODULES.find((item) => item.id === moduleId);
  const floodData = useFloodData();
  const fogData = useFogData();
  const host = useRef(null);
  const [map, setMap] = useState(null);
  const [mapError, setMapError] = useState('');
  const [location, setLocation] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const historySummary = moduleId === 'flood' ? floodData.summary : fogData.summary;
  const historyEvents = moduleId === 'flood'
    ? floodData.summary?.events ?? EMPTY_EVENTS
    : fogData.events;
  const selectedEvent = useMemo(
    () => historyEvents.find((event) => event.id === selectedEventId) ?? null,
    [historyEvents, selectedEventId],
  );
  const historyState = moduleId === 'flood' ? floodData : fogData;

  useEffect(() => {
    if (moduleId === 'fog' && !selectedEventId && historyEvents.length) {
      const latest = historyEvents.reduce((newest, event) =>
        new Date(event.start) > new Date(newest.start) ? event : newest,
      );
      setSelectedEventId(latest.id);
    }
  }, [historyEvents, moduleId, selectedEventId]);

  useEffect(() => {
    if (!selectedEvent) return;
    const series = moduleId === 'fog' ? selectedEvent.hourly : selectedEvent.level;
    if (series?.length) {
      const peak = series.reduce((best, item, index) => {
        const value = moduleId === 'fog' ? item.probability : item;
        const bestValue = moduleId === 'fog' ? series[best].probability : series[best];
        return value > bestValue ? index : best;
      }, 0);
      setHour(peak);
    } else {
      setHour(0);
    }
    setPlaying(false);
  }, [moduleId, selectedEvent]);

  useEffect(() => {
    if (!playing || !selectedEvent) return undefined;
    const seriesLength = moduleId === 'fog' ? selectedEvent.hourly.length : selectedEvent.level.length;
    if (!seriesLength) return undefined;
    const timer = setInterval(() => {
      setHour((current) => current >= seriesLength - 1 ? 0 : current + 1);
    }, moduleId === 'fog' ? 650 : 180);
    return () => clearInterval(timer);
  }, [moduleId, playing, selectedEvent]);

  useEffect(() => {
    if (!module || !host.current) return undefined;
    let view;
    try {
      view = new maplibregl.Map({
        container: host.current,
        style: structuredClone(STYLE),
        center: CITY.center,
        zoom: 12.2,
        pitch: 55,
        bearing: -24,
        antialias: true,
        attributionControl: true,
      });
      view.on('click', (event) => {
        setLocation([event.lngLat.lng, event.lngLat.lat]);
      });
      view.on('error', (event) => {
        if (event.error) setMapError(event.error.message);
      });
      setMap(view);
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'Map could not be initialized.');
    }

    return () => {
      view?.remove();
    };
  }, [module]);

  if (!module) return null;
  const liveView = module.liveView;

  return (
    <div className={`hazard-live hazard-live-${module.id}`} style={{ '--live-accent': liveView.accent }}>
      <div ref={host} className="hazard-live-map" aria-label={`${module.name} live conditions map`} />
      <header className="hazard-live-topbar">
        <div className="hazard-live-brand glass">
          <strong>{module.name}</strong>
          <span>Sofia · Bulgaria</span>
        </div>
        <ModuleTabs module={module} route={module.routes.live} onNavigate={onNavigate} />
      </header>

      <aside className="hazard-live-panel glass" aria-label={`${module.name} live status`}>
        <span className="eyebrow">Live operations</span>
        <h1>{liveView.headline}</h1>
        <div className="hazard-live-status">
          <i />
          <strong>{liveView.status}</strong>
        </div>
        <p>{liveView.detail}</p>
        <div className="hazard-live-separator" />
        <div className="hazard-live-reading">
          <span>Current reading</span>
          <strong>—</strong>
          <small>No connected observation</small>
        </div>
        <div className="hazard-live-source">
          <AlertCircle size={15} />
          <span>Historical model output is available in Analysis, not as a live measurement.</span>
        </div>
        {mapError && <p className="hazard-live-error" role="status">Map issue: {mapError}</p>}
        <div className="hazard-live-location">
          <LocateFixed size={14} />
          {location
            ? `${location[1].toFixed(4)}° N, ${location[0].toFixed(4)}° E`
            : 'Select a location on the map'}
        </div>
      </aside>

      <HazardHistory
        type={module.id}
        summary={historySummary}
        events={historyEvents}
        selectedId={selectedEventId}
        onSelect={(id) => {
          setSelectedEventId(id);
          setPlaying(false);
        }}
        hour={hour}
        setHour={setHour}
        playing={playing}
        setPlaying={setPlaying}
        loading={historyState.loading}
        error={historyState.error}
      />

      {map && (
        <div className="hazard-live-controls glass" aria-label="Map controls">
          <button type="button" onClick={() => map.zoomIn()} aria-label="Zoom in"><Plus size={16} /></button>
          <button type="button" onClick={() => map.zoomOut()} aria-label="Zoom out"><Minus size={16} /></button>
          <button type="button" onClick={() => map.easeTo({ pitch: map.getPitch() ? 0 : 55, duration: 500 })} aria-label="Toggle 3D view">3D</button>
          <button type="button" onClick={() => { setLocation(null); map.flyTo({ center: CITY.center, zoom: 12.2, pitch: 55, bearing: -24, duration: 700 }); }} aria-label="Reset map"><RotateCcw size={15} /></button>
        </div>
      )}

      <div className="hazard-live-footer glass">
        <span className="hazard-live-dot" />
        LIVE DATA NOT CONNECTED
        <span className="hazard-live-footer-divider" />
        Map location: Sofia
      </div>
    </div>
  );
}
