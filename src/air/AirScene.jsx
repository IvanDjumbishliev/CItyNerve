import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2, Crosshair, Info, Layers, Loader2, MapPin, Minus, Navigation2, PanelRightClose, PanelRightOpen,
  Pause, Play, Plus, Radio, RefreshCw, RotateCcw, School, Search, SlidersHorizontal, TriangleAlert, Wind, X,
} from 'lucide-react';
import AirMap, { SITE_KINDS } from '../AirMap.jsx';
import ModuleTabs from '../ModuleTabs.jsx';
import { useSensorHistory } from '../useAirData.js';
import {
  BANDS, GUIDELINES, POLLUTANTS, SENSOR_QC, UNIT,
  airIndex, bandIndex, bandOf, bilinear, compass, surfaceAt,
} from '../../shared/air.js';

const MAP_POLLUTANTS = ['pm25', 'pm10', 'no2', 'o3'];
const SENSOR_POLLUTANTS = ['pm25', 'pm10'];
const rgb = (colour) => `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`;
const fix = (value, digits = 1) => (value == null ? '—' : Number(value).toFixed(digits));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function formatters(timeZone) {
  const make = (options) => (value) => (value ? new Date(value).toLocaleString('en-GB', { timeZone, ...options }) : '—');
  return {
    clock: make({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    time: make({ hour: '2-digit', minute: '2-digit' }),
    day: make({ weekday: 'short', day: 'numeric' }),
    date: make({ day: 'numeric', month: 'short', year: 'numeric' }),
    hourOf: (value) => Number(new Date(value).toLocaleString('en-GB', { timeZone, hour: '2-digit', hour12: false }).slice(0, 2)),
  };
}
function age(iso) {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/* ── small parts ── */
export function KindTag({ kind }) {
  const label = { measured: 'Measured', modelled: 'Modelled', derived: 'Derived' }[kind];
  return <span className={`air-tag air-tag-${kind}`}>{label}</span>;
}
function BandChip({ pollutant, value }) {
  const band = bandOf(pollutant, value);
  if (!band) return <span className="air-band air-band-none">No data</span>;
  return <span className="air-band" style={{ '--band': rgb(band.colour) }}><i />{band.label}</span>;
}
function Toggle({ on, onChange, icon: Icon, label, hint, disabled }) {
  return <button type="button" className={`toggle ${on && !disabled ? 'is-on' : ''}`} onClick={() => onChange(!on)}
    role="switch" aria-checked={on && !disabled} disabled={disabled}>
    <Icon size={15} /><span className="toggle-text">{label}{hint && <small>{hint}</small>}</span><span className="switch"><i /></span>
  </button>;
}

export function AirLegend({ pollutant, hasConfidence }) {
  const limits = POLLUTANTS[pollutant].limits;
  return <div className="air-legend" role="group" aria-label={`${POLLUTANTS[pollutant].label} index bands in ${UNIT}`}>
    <span className="air-legend-title">{POLLUTANTS[pollutant].label} <small>{UNIT}</small></span>
    {BANDS.map((band, index) => <span key={band.id} className="air-legend-item">
      <i style={{ background: rgb(band.colour) }} />
      <b>{band.label}</b>
      <small>{index === 0 ? `0–${limits[0]}` : index < limits.length ? `${limits[index - 1] + 1}–${limits[index]}` : `> ${limits.at(-1)}`}</small>
    </span>)}
    {hasConfidence && <span className="air-legend-item"><i className="air-hatch" /><b>Model only</b><small>no sensors nearby</small></span>}
  </div>;
}

function Sparkline({ hours, pollutant, format }) {
  const W = 240, H = 46;
  const values = hours.map((hour) => hour[pollutant]);
  const max = Math.max(...values.filter((value) => value != null), POLLUTANTS[pollutant].limits[1]);
  const width = W / hours.length;
  return <figure className="air-spark">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label={`${POLLUTANTS[pollutant].label} hourly medians over the last 24 hours`}>
      {values.map((value, index) => value == null
        ? <rect key={index} x={index * width + 1} y={H - 2} width={width - 2} height={2} className="air-spark-gap" />
        : <rect key={index} x={index * width + 1} y={H - Math.max(2, (value / max) * (H - 4))} width={width - 2}
            height={Math.max(2, (value / max) * (H - 4))} rx="1" fill={rgb(bandOf(pollutant, value).colour)}>
            <title>{`${format.time(hours[index].time)} · ${fix(value)} ${UNIT}`}</title>
          </rect>)}
    </svg>
    <figcaption><span>{format.time(hours[0].time)}</span><span>last 24 h · hourly median</span><span>{format.time(hours.at(-1).time)}</span></figcaption>
  </figure>;
}

function SensorPopup({ sensor, townId, pollutant, format }) {
  const history = useSensorHistory(townId, sensor.id);
  const key = SENSOR_POLLUTANTS.includes(pollutant) ? pollutant : 'pm25';
  const filled = history.hours?.filter((hour) => hour[key] != null).length ?? 0;
  return <div className="air-popup-body">
    <div className="air-popup-head"><KindTag kind="measured" /><span>{sensor.type} · #{sensor.id}</span></div>
    <div className="air-popup-value">
      <strong>{fix(sensor[key])}</strong><span>{UNIT} {POLLUTANTS[key].label}</span>
      <BandChip pollutant={key} value={sensor[key]} />
    </div>
    <dl className="air-popup-list">
      <div><dt>{key === 'pm25' ? 'PM10' : 'PM2.5'}</dt><dd>{fix(sensor[key === 'pm25' ? 'pm10' : 'pm25'])} {UNIT}</dd></div>
      <div><dt>Reading time</dt><dd>{format.time(sensor.time)} · {age(sensor.time)}</dd></div>
      <div><dt>Humidity</dt><dd>{sensor.humidityUsed == null ? 'unavailable' : `${Math.round(sensor.humidityUsed)}% (${sensor.humiditySource})`}</dd></div>
    </dl>
    {sensor.status === 'humid' && <p className="air-popup-warn"><TriangleAlert size={13} /> Humidity above {SENSOR_QC.humidityMax}%: optical sensors over-read in fog. This reading is likely too high.</p>}
    {history.loading && <p className="air-popup-note"><Loader2 size={13} className="spin" /> Loading last 24 h…</p>}
    {history.error && <p className="air-popup-note">Last-24 h history unavailable.</p>}
    {history.hours && (filled
      ? <><Sparkline hours={history.hours} pollutant={key} format={format} />
          {filled < 24 && <p className="air-popup-note">{24 - filled} of 24 hours have no data. The public archive is published once a day; later hours come only from readings seen since this server started.</p>}</>
      : <p className="air-popup-note">No archived readings for the last 24 h.</p>)}
    <p className="air-popup-foot">Citizen sensor, indicative. Not a reference-grade monitor.</p>
  </div>;
}

function AirTimeline({ time, series, pollutant, hour, setHour, playing, setPlaying, nowIndex, lastIndex, format, hasConfidence, subtitle }) {
  const W = 720, H = 58;
  const count = lastIndex + 1;
  const width = W / count;
  const max = Math.max(...series.slice(0, count).filter((value) => value != null), POLLUTANTS[pollutant].limits[2]);
  const value = series[hour];
  const live = nowIndex != null;
  const offset = live ? hour - nowIndex : null;
  const phase = !live ? subtitle : offset === 0 ? 'Now' : offset > 0 ? `Forecast · in ${offset} h` : `${-offset} h ago · model analysis`;
  const ticks = [];
  for (let index = 0; index < count; index += 1) if (format.hourOf(time[index]) === 0) ticks.push(index);
  return <section className="timeline glass air-timeline" aria-label="Hourly air quality timeline">
    <AirLegend pollutant={pollutant} hasConfidence={hasConfidence} />
    <div className="tl-head">
      <button type="button" className="play" onClick={() => setPlaying((current) => !current)} disabled={count < 2}
        aria-label={playing ? 'Pause playback' : 'Play hours'}>
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </button>
      <div className="tl-clock">
        <span className="big">{format.clock(time[hour])}</span>
        <span className="tl-sub">{phase}</span>
      </div>
      <div className="tl-reads">
        <span><b>{fix(value)}</b> {UNIT}</span>
        <BandChip pollutant={pollutant} value={value} />
        {live && <button type="button" className="air-now-btn" onClick={() => { setPlaying(false); setHour(nowIndex); }}
          disabled={hour === nowIndex}>Now</button>}
      </div>
    </div>
    <div className="tl-chart"><div className="tl-svg-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><pattern id="air-forecast-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2" height="5" fill="rgba(12, 16, 22, 0.55)" /></pattern></defs>
        {series.slice(0, count).map((item, index) => {
          if (item == null) return <rect key={index} x={index * width} y={H - 2} width={Math.max(0.5, width - 0.6)} height="2" className="air-bar-gap" />;
          const height = Math.max(2, (item / max) * (H - 6));
          return <rect key={index} x={index * width} y={H - height} width={Math.max(0.5, width - 0.6)} height={height}
            fill={rgb(bandOf(pollutant, item).colour)} opacity={live && index > nowIndex ? 0.6 : 1} />;
        })}
        {live && nowIndex < count - 1 && <rect x={(nowIndex + 1) * width} y="0" width={W - (nowIndex + 1) * width} height={H} fill="url(#air-forecast-hatch)" />}
        {live && <line x1={(nowIndex + 0.5) * width} x2={(nowIndex + 0.5) * width} y1="0" y2={H} className="air-now-line" vectorEffect="non-scaling-stroke" />}
        <line x1={(hour + 0.5) * width} x2={(hour + 0.5) * width} y1="0" y2={H} className="tl-cursor" vectorEffect="non-scaling-stroke" />
      </svg>
      {live && <span className="air-now-flag" style={{ left: `${((nowIndex + 0.5) / count) * 100}%` }}>NOW</span>}
      {live && <div className="air-split" aria-hidden="true">
        <span style={{ width: `${((nowIndex + 0.5) / count) * 100}%` }}>Past 48 h · model analysis</span>
        <span>Forecast →</span>
      </div>}
      {count > 1 && <input type="range" min="0" max={count - 1} step="1" value={hour}
        onChange={(event) => { setPlaying(false); setHour(Number(event.target.value)); }}
        aria-label="Scrub hours" aria-valuetext={`${format.clock(time[hour])}, ${fix(value)} ${UNIT}`} />}
      <div className="air-ticks">{ticks.map((index) => <span key={index} style={{ left: `${(index / count) * 100}%` }}>{format.day(time[index])}</span>)}</div>
    </div></div>
  </section>;
}

/* ── the scene ── */
export default function AirScene({
  mode, route, onNavigate, town, towns, onTown, view,
  loading, error, onRetry, notices = [],
  lattice, time = [], nowIndex = null, lastIndex = -1, values, wind, sensors, sensorInfo,
  year, rasters, sites, hotspots = [], episodes, episodeIndex, onEpisode, timelineNote, panelExtra,
}) {
  const format = useMemo(() => formatters(town.timeZone), [town.timeZone]);
  const [pollutant, setPollutant] = useState('pm25');
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [layers, setLayers] = useState({ surface: true, sensors: true, sites: true, highlight: false, wind: true, buildings: true });
  const [point, setPoint] = useState(null);
  const [sensorId, setSensorId] = useState(null);
  const [hotspotId, setHotspotId] = useState(null);
  const [map, setMap] = useState(null);
  const [bearing, setBearing] = useState(view.bearing);
  const [dockOpen, setDockOpen] = useState(false);
  const [lensOpen, setLensOpen] = useState(() => window.innerWidth > 860);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const updateLayer = (key) => (value) => setLayers((current) => ({ ...current, [key]: value }));
  const hasData = lastIndex >= 0 && Boolean(values);

  // Jump to "now" (live) or to the worst hour (episode) whenever a new series arrives.
  const seriesKey = `${town.id}|${time[0] ?? ''}|${lastIndex}|${nowIndex}`;
  useEffect(() => {
    setPlaying(false);
    if (!hasData) { setHour(0); return; }
    if (nowIndex != null) { setHour(Math.min(nowIndex, lastIndex)); return; }
    let best = 0;
    let bestValue = -1;
    for (let index = 0; index <= lastIndex; index += 1) {
      const value = bilinear(lattice, values.pm25?.[index], town.center[0], town.center[1]);
      if (value != null && value > bestValue) { best = index; bestValue = value; }
    }
    setHour(best);
  }, [seriesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPoint(null); setSensorId(null); setHotspotId(null); }, [town.id]);
  useEffect(() => {
    if (!playing || !hasData) return undefined;
    const timer = setInterval(() => setHour((current) => (current >= lastIndex ? 0 : current + 1)), reducedMotion() ? 1500 : 420);
    return () => clearInterval(timer);
  }, [playing, hasData, lastIndex]);
  useEffect(() => {
    if (!map) return undefined;
    const update = () => setBearing(map.getBearing());
    map.on('rotate', update);
    return () => map.off('rotate', update);
  }, [map]);

  const at = point ?? town.center;
  const field = hasData ? values[pollutant]?.[hour] ?? null : null;
  const factor = rasters?.factor ?? null;
  const series = useMemo(() => (hasData
    ? time.map((_, index) => (index > lastIndex ? null : surfaceAt(lattice, values[pollutant]?.[index], factor, at[0], at[1])))
    : []), [hasData, time, lastIndex, lattice, values, pollutant, factor, at[0], at[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useMemo(() => {
    if (!hasData) return {};
    return Object.fromEntries(Object.keys(POLLUTANTS).map((key) => [key,
      surfaceAt(lattice, values[key]?.[hour], key === 'pm25' || key === 'pm10' ? factor : null, at[0], at[1])]));
  }, [hasData, lattice, values, hour, factor, at[0], at[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const index = airIndex(current);
  const band = index ? BANDS[index.band] : null;
  const worst = useMemo(() => {
    if (nowIndex == null || !series.length) return null;
    let best = null;
    for (let i = nowIndex + 1; i <= lastIndex; i += 1) if (series[i] != null && (!best || series[i] > best.value)) best = { index: i, value: series[i] };
    return best;
  }, [series, nowIndex, lastIndex]);

  const sensorItems = useMemo(() => (sensors ?? []).map((sensor) => ({ ...sensor, value: SENSOR_POLLUTANTS.includes(pollutant) ? sensor[pollutant] : null })), [sensors, pollutant]);
  const sensorsApply = SENSOR_POLLUTANTS.includes(pollutant) && (nowIndex == null || hour === nowIndex);
  const selectedSensor = sensorItems.find((sensor) => sensor.id === sensorId) ?? null;

  const exposure = useMemo(() => {
    if (!sites?.features) return null;
    const useFactor = pollutant === 'pm25' || pollutant === 'pm10' ? factor : null;
    const features = sites.features.map((feature) => {
      const [lon, lat] = feature.geometry.coordinates;
      const value = field ? surfaceAt(lattice, field, useFactor, lon, lat) : null;
      return { ...feature, properties: { ...feature.properties, v: value ?? -1, band: bandIndex(pollutant, value) ?? -1 } };
    });
    const counts = BANDS.map((_, i) => features.filter((feature) => feature.properties.band === i).length);
    const affected = features.filter((feature) => feature.properties.band >= 3)
      .sort((a, b) => b.properties.v - a.properties.v);
    return { collection: { type: 'FeatureCollection', features }, counts, affected, worstTwo: counts[4] + counts[5] };
  }, [sites, field, lattice, factor, pollutant]);

  const windAt = useMemo(() => {
    if (!wind?.speed?.[hour] || !lattice) return null;
    const pointIndex = lattice.lats.reduce((bestLat, lat, i) => (Math.abs(lat - at[1]) < Math.abs(lattice.lats[bestLat] - at[1]) ? i : bestLat), 0) * lattice.lons.length
      + lattice.lons.reduce((bestLon, lon, i) => (Math.abs(lon - at[0]) < Math.abs(lattice.lons[bestLon] - at[0]) ? i : bestLon), 0);
    const speed = wind.speed[hour][pointIndex];
    const direction = wind.direction[hour][pointIndex];
    return speed == null || direction == null ? null : { speed, direction };
  }, [wind, hour, lattice, at[0], at[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const windField = useMemo(() => (wind?.speed?.[hour] ? { speed: wind.speed[hour], direction: wind.direction[hour] } : null), [wind, hour]);

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return [];
    const fromHotspots = hotspots.filter((item) => `${item.name} ${item.district ?? ''}`.toLowerCase().includes(text))
      .map((item) => ({ key: `h-${item.id}`, name: item.name, note: `Hotspot · ${item.district ?? town.name}`, coord: item.coord, hotspot: item.id }));
    const fromSites = (sites?.features ?? []).filter((feature) => (feature.properties.name ?? '').toLowerCase().includes(text))
      .map((feature) => ({ key: `s-${feature.properties.id}`, name: feature.properties.name, note: SITE_KINDS[feature.properties.kind]?.label, coord: feature.geometry.coordinates }));
    return [...fromHotspots, ...fromSites].slice(0, 6);
  }, [query, hotspots, sites, town.name]);
  const jump = (coord, zoom = 14.2) => {
    setPoint(coord);
    map?.flyTo({ center: coord, zoom, duration: reducedMotion() ? 0 : 1200, padding: { right: window.innerWidth > 900 ? 360 : 0 } });
  };
  const selectHotspot = (id) => {
    setHotspotId(id);
    const item = hotspots.find((hotspot) => hotspot.id === id);
    if (item) jump(item.coord);
  };

  const popup = selectedSensor ? {
    lngLat: [selectedSensor.lon, selectedSensor.lat],
    content: <SensorPopup sensor={selectedSensor} townId={town.id} pollutant={pollutant} format={format} />,
  } : null;
  const hasConfidence = Boolean(rasters?.confidence);
  const who = GUIDELINES.who2021;
  const eu = GUIDELINES.eu2008;

  return <div className="map-page air-map-page air-theme">
    <AirMap view={view} lattice={lattice} field={layers.surface ? field : null} pollutant={pollutant}
      factor={pollutant === 'pm25' || pollutant === 'pm10' ? factor : null} confidence={rasters?.confidence ?? null}
      sensors={sensorsApply ? sensorItems : []} sites={exposure?.collection ?? null} wind={windField} hotspots={hotspots}
      layers={layers} point={point} selectedSensor={sensorId} selectedHotspot={hotspotId} popup={popup}
      onPoint={(coord) => { setPoint(coord); setSensorId(null); }} onSensor={setSensorId} onHotspot={selectHotspot}
      onPopupClose={() => setSensorId(null)} onReady={setMap} />

    <header className="topbar air-topbar">
      <div className="brand glass">
        <span className="brand-mark"><Wind size={15} strokeWidth={2.4} /></span>
        <span className="brand-text"><strong>AirNerve</strong></span>
      </div>
      {towns && <label className="air-town glass">
        <MapPin size={14} aria-hidden="true" />
        <span className="sr-only">Town</span>
        <select aria-label="Town" value={town.id} onChange={(event) => onTown(event.target.value)}>
          {towns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      {(hotspots.length > 0 || sites) && <div className={`search glass ${focused ? 'is-focus' : ''}`}>
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)} placeholder="Search hotspots and sites" aria-label="Search hotspots and sensitive sites" />
        {focused && query && <div className="search-pop">
          {matches.map((item) => <button type="button" key={item.key}
            onMouseDown={() => { if (item.hotspot) selectHotspot(item.hotspot); else jump(item.coord, 15); setQuery(''); }}>
            <span className="dot" /><span><strong>{item.name}</strong><small>{item.note}</small></span>
          </button>)}
          {!matches.length && <p className="muted">No results</p>}
        </div>}
      </div>}
      <ModuleTabs module="air" route={route} onNavigate={onNavigate} />
      <div className="top-actions">
        <button type="button" className="ghost-btn glass mobile-only" onClick={() => setDockOpen((value) => !value)} aria-label="Pollutant and layers"><SlidersHorizontal size={15} /></button>
        <button type="button" className="ghost-btn glass mobile-only" onClick={() => setLensOpen((value) => !value)} aria-label="Details"><PanelRightOpen size={15} /></button>
      </div>
    </header>

    <aside className={`dock glass air-dock ${dockOpen ? 'is-open' : ''}`} aria-label="Pollutant, layers and episodes">
      <button type="button" className="sheet-close icon-btn" onClick={() => setDockOpen(false)} aria-label="Close panel"><X size={16} /></button>
      {episodes && <div className="dock-section">
        <h3 className="dock-title">Pollution episodes</h3>
        <div className="storm-list">
          {episodes.map((episode, i) => <button type="button" key={episode.id} className={`storm ${episodeIndex === i ? 'is-on' : ''}`}
            onClick={() => onEpisode(i)} aria-pressed={episodeIndex === i}>
            <span className="storm-date">{format.date(episode.start)}</span>
            <span className="storm-meta mono">{episode.days} d · {fix(episode.peak_day_pm25, 0)}</span>
          </button>)}
          {!episodes.length && <p className="muted">No episodes in the record.</p>}
        </div>
      </div>}
      <div className="dock-section">
        <h3 className="dock-title">Pollutant</h3>
        <div className="seg seg-4 air-seg" role="group" aria-label="Pollutant">
          {MAP_POLLUTANTS.map((key) => <button type="button" key={key} className={pollutant === key ? 'is-on' : ''}
            aria-pressed={pollutant === key} onClick={() => setPollutant(key)} title={POLLUTANTS[key].name}>{POLLUTANTS[key].label}</button>)}
        </div>
      </div>
      <div className="dock-section">
        <h3 className="dock-title">Layers</h3>
        <div className="toggle-group">
          <Toggle on={layers.surface} onChange={updateLayer('surface')} icon={Layers} label="Concentration surface" hint={factor ? 'Derived: CAMS × local factor' : 'Modelled: CAMS, ~11 km'} />
          {sensors && <Toggle on={layers.sensors} onChange={updateLayer('sensors')} icon={Radio} label="Citizen sensors"
            hint={!SENSOR_POLLUTANTS.includes(pollutant) ? 'Particles only (PM2.5, PM10)' : hour !== nowIndex ? 'Shown for the current hour only' : 'Measured, indicative'}
            disabled={!sensorsApply} />}
          <Toggle on={layers.sites} onChange={updateLayer('sites')} icon={School} label="Schools & hospitals" hint={sites ? `${sites.features.length} sites · OpenStreetMap` : 'Not generated for this town'} disabled={!sites} />
          <Toggle on={layers.highlight} onChange={updateLayer('highlight')} icon={TriangleAlert} label="Highlight exposed sites" hint="Very poor or extremely poor air" disabled={!sites || !layers.sites} />
          <Toggle on={layers.wind} onChange={updateLayer('wind')} icon={Navigation2} label="Wind" hint="Modelled, 10 m" disabled={!wind} />
          <Toggle on={layers.buildings} onChange={updateLayer('buildings')} icon={Building2} label="Buildings" />
        </div>
      </div>
      <div className="dock-section air-key">
        <p><KindTag kind="measured" /> Citizen sensor readings</p>
        <p><KindTag kind="modelled" /> CAMS model, about 11 km</p>
        <p><KindTag kind="derived" /> Our fused screening surface</p>
      </div>
    </aside>

    <aside className={`lens glass air-lens ${lensOpen ? 'is-open' : 'is-collapsed'}`} aria-label="Air quality at the selected location">
      <button type="button" className="lens-collapse icon-btn" onClick={() => setLensOpen((value) => !value)} aria-label={lensOpen ? 'Collapse panel' : 'Expand panel'}>
        {lensOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </button>
      <div className="lens-scroll">
        <div className="lens-title"><h2>{town.name}</h2><span>{hasData ? format.clock(time[hour]) : '—'}</span></div>
        <p className="air-where"><Crosshair size={12} /> {point ? `${point[1].toFixed(4)}° N, ${point[0].toFixed(4)}° E` : 'Town centre'}
          {point ? <button type="button" className="air-link" onClick={() => setPoint(null)}>reset</button> : <small> · click the map to inspect a place</small>}</p>
        {notices.map((notice) => <p key={notice.key} className={`air-notice air-notice-${notice.level}`} role="status">
          <TriangleAlert size={13} /><span>{notice.text}</span></p>)}

        {hasData ? <>
          <div className="air-index" style={{ '--band': band ? rgb(band.colour) : 'var(--m-fill-2)' }}>
            <span className="air-index-label">Air quality index <KindTag kind={factor ? 'derived' : 'modelled'} /></span>
            <strong>{band?.label ?? 'Unavailable'}</strong>
            {index && <span className="air-index-sub">Driven by {POLLUTANTS[index.dominant].label} · {fix(index.value)} {UNIT}</span>}
          </div>
          {band && <div className="air-advice">
            <p><b>General public</b>{band.general}</p>
            <p><b>Sensitive groups</b>{band.sensitive}</p>
          </div>}
          <table className="air-values">
            <caption className="sr-only">Pollutant concentrations at the selected location and hour</caption>
            <tbody>{Object.keys(POLLUTANTS).map((key) => <tr key={key}>
              <th scope="row">{POLLUTANTS[key].label}<small>{POLLUTANTS[key].name}</small></th>
              <td className="mono">{fix(current[key])} <small>{UNIT}</small></td>
              <td><BandChip pollutant={key} value={current[key]} /></td>
            </tr>)}</tbody>
          </table>
          <div className="kpi-row air-kpis">
            {sensorInfo && <div className="kpi"><span className="kpi-label">Sensor median PM2.5</span>
              <span className="kpi-value">{fix(sensorInfo.medianPm25)}</span><span className="kpi-note">{sensorInfo.counts.usable} sensors · measured</span></div>}
            {windAt && <div className="kpi"><span className="kpi-label">Wind</span>
              <span className="kpi-value">{fix(windAt.speed)}<small> m/s</small></span><span className="kpi-note">from {compass(windAt.direction)} · modelled</span></div>}
            {worst && <div className="kpi"><span className="kpi-label">Worst forecast hour</span>
              <span className="kpi-value">{fix(worst.value, 0)}</span>
              <span className="kpi-note"><button type="button" className="air-link" onClick={() => { setPlaying(false); setHour(worst.index); }}>{format.clock(time[worst.index])}</button></span></div>}
          </div>
        </> : !loading && <p className="lens-hint"><TriangleAlert size={13} /> Modelled background unavailable{error ? `: ${error}` : '.'}</p>}

        {year && year.status !== 'unavailable' && <div className="air-year">
          <h3>{year.year} so far <KindTag kind="modelled" /></h3>
          <p><b>{year.pm25DaysAboveWho}</b> of {year.daysWithData} days above the WHO 24-hour guideline for PM2.5 ({who.pm25.day} {UNIT})</p>
          <p><b>{year.pm10DaysAboveEuLimit}</b> days above the EU daily limit for PM10 ({eu.pm10.day} {UNIT}; {eu.pm10.allowedDays} allowed per year)</p>
          <small>CAMS model at the town centre, through {year.through}. Not a compliance assessment.</small>
        </div>}

        {panelExtra}

        <div className="air-sites">
          <h3>Exposed sites <KindTag kind="derived" /></h3>
          {!sites && <p className="muted">The site inventory has not been generated for {town.name}.</p>}
          {sites && exposure && <>
            <p className="air-sites-count"><b>{exposure.affected.length}</b> of {sites.features.length} schools, kindergartens, hospitals and care sites in Poor or worse {POLLUTANTS[pollutant].label} at this hour
              {exposure.worstTwo > 0 && <> · <b>{exposure.worstTwo}</b> in the two worst bands</>}</p>
            <ul className="air-site-list">{exposure.affected.slice(0, 8).map((feature) => <li key={feature.properties.id}>
              <button type="button" onClick={() => jump(feature.geometry.coordinates, 15)}>
                <span className="air-site-kind" style={{ '--kind': SITE_KINDS[feature.properties.kind]?.colour }}>{SITE_KINDS[feature.properties.kind]?.glyph}</span>
                <span><strong>{feature.properties.name || 'Unnamed site'}</strong><small>{SITE_KINDS[feature.properties.kind]?.label}</small></span>
                <span className="mono">{fix(feature.properties.v, 0)}</span>
              </button></li>)}</ul>
            {exposure.affected.length > 8 && <p className="muted">+ {exposure.affected.length - 8} more on the map</p>}
            {!exposure.affected.length && <p className="muted">No mapped site is in Poor or worse air at this hour.</p>}
          </>}
        </div>

        <p className="air-disclaimer"><Info size={13} /><span>Screening estimate, not an official air-quality assessment or a health warning. CAMS is a model at about 11 km. Citizen sensors are indicative, not reference-grade.</span></p>
        <p className="air-credits">CAMS / Copernicus Atmosphere Monitoring Service · Open-Meteo (CC BY 4.0) · Sensor.Community (ODbL) · © OpenStreetMap contributors</p>
      </div>
    </aside>

    {map && <div className="camera glass" aria-label="Map camera">
      <button type="button" onClick={() => map.zoomIn()} aria-label="Zoom in"><Plus size={16} /></button>
      <button type="button" onClick={() => map.zoomOut()} aria-label="Zoom out"><Minus size={16} /></button>
      <button type="button" onClick={() => map.easeTo({ pitch: map.getPitch() ? 0 : view.pitch, duration: 700 })} aria-label="Toggle 3D" className="txt">3D</button>
      <button type="button" onClick={() => map.flyTo({ ...view, duration: reducedMotion() ? 0 : 1000 })} aria-label="Reset map"><RotateCcw size={15} /></button>
      {onRetry && <button type="button" onClick={onRetry} aria-label="Refresh live data" disabled={loading}>
        <RefreshCw size={15} className={loading ? 'spin' : ''} /></button>}
    </div>}

    {windAt && layers.wind && <div className="air-wind glass" aria-label={`Wind from ${compass(windAt.direction)}, ${fix(windAt.speed)} metres per second`}>
      <span className="air-wind-dial"><Navigation2 size={18} style={{ transform: `rotate(${windAt.direction + 180 - bearing}deg)` }} /></span>
      <span><b>{fix(windAt.speed)} m/s</b><small>from {compass(windAt.direction)}</small></span>
    </div>}

    {hasData
      ? <AirTimeline time={time} series={series} pollutant={pollutant} hour={hour} setHour={setHour} playing={playing}
          setPlaying={setPlaying} nowIndex={nowIndex} lastIndex={lastIndex} format={format} hasConfidence={hasConfidence} subtitle={timelineNote} />
      : <section className="timeline glass air-timeline"><AirLegend pollutant={pollutant} hasConfidence={hasConfidence} /></section>}

    {!hasData && <div className="air-state"><div className="data-state glass" role="status">
      {loading
        ? <><Loader2 size={18} className="spin" /> Loading {mode === 'live' ? 'live air data' : 'air analysis'} for {town.name}…</>
        : <><TriangleAlert size={18} /><span>{error || 'No air data available.'}</span>
            {onRetry && <button type="button" className="air-link" onClick={onRetry}>Retry</button>}</>}
    </div></div>}
  </div>;
}
