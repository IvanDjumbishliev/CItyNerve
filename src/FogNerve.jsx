import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight, Building2, CarFront, Check, CircleAlert, CloudFog,
  Info, Loader2, MapPin, Mountain, PanelRightClose, PanelRightOpen, Play, Pause,
  Search, TriangleAlert, Waves, Wind, X,
} from 'lucide-react';
import FogMap from './FogMap.jsx';
import { useFogData } from './useFogData.js';

const TZ = 'Europe/Sofia';
const VISIBILITY_CLASSES = [
  { label: 'Dense fog', range: '< 200 m', colour: '#DDE5E9' },
  { label: 'Fog', range: '200–1,000 m', colour: '#B8C6CE' },
  { label: 'Mist', range: '1–5 km', colour: '#8298A5' },
  { label: 'Clear', range: '> 5 km', colour: '#435864' },
];
const RISK_NAME = (score) => score >= 80 ? 'Critical' : score >= 60 ? 'High' : score >= 40 ? 'Moderate' : 'Low';
const riskClass = (score) => RISK_NAME(score).toLowerCase();
const formatDate = (value) => value ? new Date(value).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const formatDateTime = (value) => value ? new Date(value).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const visibility = (value) => value == null ? '—' : value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`;

function RiskBadge({ score }) {
  return <span className={`risk-badge rb-${riskClass(score)}`}><CircleAlert size={12} />{RISK_NAME(score)}<b>{score}</b></span>;
}

function FogToggle({ on, onChange, icon: Icon, label, hint }) {
  return <button className={`toggle ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
    <Icon size={15} /><span className="toggle-text">{label}<small>{hint}</small></span><span className="switch"><i /></span>
  </button>;
}

function FogDataState({ loading, error }) {
  return <div className="data-state glass">
    {loading
      ? <><Loader2 size={18} className="spin" /> Loading observed Sofia fog records…</>
      : <><TriangleAlert size={18} /><span>Fog dataset unavailable ({error}). Run <code>npm run data:fog</code> to fetch observations and generate the screening outputs. No historical fog events are fabricated.</span></>}
  </div>;
}

function FogTimeline({ event, hour, setHour, playing, setPlaying, summary }) {
  const series = event?.hourly ?? [];
  const count = series.length;
  const W = 480, H = 74;
  const peak = count ? Math.max(...series.map(item => item.probability ?? 0)) : 0;
  const current = series[hour];
  const path = series.map((item, index) => {
    const x = index / Math.max(1, count - 1) * W;
    const y = H - 5 - (item.probability ?? 0) * (H - 12);
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const area = count ? `M0 ${H} ${path} L${W} ${H} Z` : '';
  const x = count ? hour / Math.max(1, count - 1) * W : 0;
  return <section className="timeline glass fog-timeline" aria-label="Fog event hourly timeline">
    <div className="tl-head">
      <button className="play" onClick={() => setPlaying(value => !value)} disabled={!count} aria-label={playing ? 'Pause fog event' : 'Play fog event'}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="tl-clock">
        <span className="mono big">{event ? formatDateTime(current?.time ?? event.start) : 'Five-year record'}</span>
        <span className="tl-sub">{event ? `${event.type} fog · observed ${visibility(current?.visibility_m)} · model ${visibility(current?.expected_visibility_m)}` : `${summary.station.fog_hours.toLocaleString('en')} observed fog hours`}</span>
      </div>
      <div className="tl-reads">
        {current && <span><Wind size={13} /><b className="mono">{current.wind_ms} m/s</b> wind</span>}
        {current && <span><CloudFog size={13} /><b className="mono">{Math.round((current.probability ?? 0) * 100)}%</b> model likelihood</span>}
      </div>
    </div>
    <div className="tl-chart">
      <div className="tl-lane-labels"><span>Model probability</span><span>0–100%</span></div>
      <div className="tl-svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={area} className="fog-probability-area" />
          <path d={path} className="fog-probability-line" vectorEffect="non-scaling-stroke" />
          <line x1={x} x2={x} y1="0" y2={H} className="tl-cursor" vectorEffect="non-scaling-stroke" />
        </svg>
        {count > 1 && <input type="range" min="0" max={count - 1} step="1" value={hour} onChange={e => { setPlaying(false); setHour(Number(e.target.value)); }} aria-label="Scrub fog event hour" />}
        <div className="tl-ticks">{count > 1
          ? [0, Math.round((count - 1) / 2), count - 1].map(index => <span key={index}>{new Date(series[index].time).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}</span>)
          : <span>{event ? `${event.duration_h} hour observed episode` : 'Select a historical episode to play it'}</span>}</div>
      </div>
    </div>
  </section>;
}

function FogDock({ events, selectedIndex, onSelect, layers, setLayers, open, onClose }) {
  const updateLayer = (key) => (value) => setLayers(current => ({ ...current, [key]: value }));
  const selected = events[selectedIndex];
  return <aside className={`dock glass fog-dock ${open ? 'is-open' : ''}`} aria-label="Historical fog episodes and map layers">
    <button className="sheet-close icon-btn" onClick={onClose} aria-label="Close event panel"><X size={16} /></button>
    <div className="dock-section">
      <h3 className="eyebrow">Observed fog episodes · last 5 years</h3>
      <div className="storm-list">
        {events.slice().reverse().map((event, reverseIndex) => {
          const index = events.length - reverseIndex - 1;
          return <button key={event.id} className={`storm ${selectedIndex === index ? 'is-on' : ''}`} onClick={() => onSelect(index)}>
            <span className="storm-date">{formatDate(event.start)} <small>{event.type}</small></span>
            <span className="storm-meta mono">{visibility(event.minimum_visibility_m)}</span>
          </button>;
        })}
        {!events.length && <p className="muted">No observed episodes in the downloaded station records.</p>}
      </div>
      {selected && <div className="readouts fog-readouts">
        <div><span>Duration</span><b className="mono">{selected.duration_h}<small> h</small></b></div>
        <div><span>Min visibility</span><b className="mono">{visibility(selected.minimum_visibility_m)}</b></div>
        <div><span>Fog type</span><b className="mono">{selected.type}</b></div>
      </div>}
      <p className="dock-desc">Episodes come from IEM METAR visibility &lt;1 km or FG/BR/FZFG codes. Historical station observations are not a forecast.</p>
    </div>
    <div className="dock-section">
      <h3 className="eyebrow">Layers</h3>
      <FogToggle on={layers.extent} onChange={updateLayer('extent')} icon={CloudFog} label="Fog density" hint="terrain-adjusted screen" />
      <FogToggle on={layers.valley} onChange={updateLayer('valley')} icon={Mountain} label="Cold-air pool terrain" hint="SRTM topographic position" />
      <FogToggle on={layers.hotspots} onChange={updateLayer('hotspots')} icon={CarFront} label="Fog hotspots" hint="OSM road exposure" />
      <FogToggle on={layers.buildings} onChange={updateLayer('buildings')} icon={Building2} label="3D buildings" hint="OSM heights" />
      <FogToggle on={layers.terrain} onChange={updateLayer('terrain')} icon={Mountain} label="Terrain relief" hint="SRTM ×1.6" />
    </div>
    <div className="dock-section legend fog-legend">
      <h3 className="eyebrow">Expected visibility</h3>
      {VISIBILITY_CLASSES.map(item => <div className="fog-class" key={item.label}><i style={{ background: item.colour }} /><span>{item.label}</span><small>{item.range}</small></div>)}
      <p className="dock-desc">Overlay opacity represents model fog likelihood; it is not measured visibility in every grid cell.</p>
    </div>
  </aside>;
}

function FogTopBar({ hotspots, onSelect, onDock, onLens, onNavigate }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const matches = useMemo(() => query
    ? hotspots.filter(item => `${item.name} ${item.district}`.toLowerCase().includes(query.toLowerCase())).slice(0, 5)
    : hotspots.slice(0, 5), [hotspots, query]);
  return <header className="topbar fog-topbar">
    <div className="brand glass">
      <span className="brand-mark"><CloudFog size={17} /></span>
      <span className="brand-text"><strong>FogNerve</strong><small><MapPin size={10} /> Sofia, BG · screening model</small></span>
    </div>
    <div className={`search glass ${focused ? 'is-focus' : ''}`}>
      <Search size={15} />
      <input value={query} onChange={e => setQuery(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)} placeholder="Search fog hotspot" aria-label="Search fog hotspots" />
      {focused && <div className="search-pop">
        <span className="eyebrow">{query ? 'Matches' : 'Fog hotspots'}</span>
        {matches.map(item => <button key={item.id} onMouseDown={() => { onSelect(item.id); setQuery(''); }}>
          <span className={`dot d-${riskClass(item.score)}`} /><span><strong>{item.name}</strong><small>{item.district}</small></span><ArrowUpRight size={13} />
        </button>)}
        {!matches.length && <p className="muted">No OSM road hotspots are currently available.</p>}
      </div>}
    </div>
    <nav className="fog-page-nav" aria-label="FogNerve pages">
      <button onClick={() => onNavigate('fog-map')}>Map</button>
      <button onClick={() => onNavigate('fog-register')}>Risk register</button>
      <button onClick={() => onNavigate('fog-sources')}>Data &amp; model</button>
    </nav>
    <div className="top-actions">
      <button className="ghost-btn glass mobile-only" onClick={onDock}><CloudFog size={15} /><span>Events</span></button>
      <button className="ghost-btn glass mobile-only" onClick={onLens}><PanelRightOpen size={15} /><span>Risk</span></button>
    </div>
  </header>;
}

function FogRiskPanel({ summary, events, hotspots, riskRegister, selectedIndex, selectedId, onSelect, open, setOpen }) {
  const selected = hotspots.find(item => item.id === selectedId);
  const event = selectedIndex >= 0 ? events[selectedIndex] : null;
  const station = summary.station;
  return <aside className={`lens glass fog-lens ${open ? 'is-open' : 'is-collapsed'}`} aria-label="Fog exposure and risk">
    <button className="lens-collapse icon-btn" onClick={() => setOpen(value => !value)} aria-label={open ? 'Collapse fog risk' : 'Expand fog risk'}>
      {open ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
    </button>
    <div className="lens-scroll">
      <div className="lens-title"><CloudFog size={18} /><div><h2>Fog exposure</h2><span>{event ? formatDate(event.start) : 'Sofia · five-year observed record'}</span></div></div>
      <div className="kpi-row">
        <div className="kpi"><span className="kpi-label">Fog hours</span><span className="kpi-value">{station.fog_hours.toLocaleString('en')}</span><span className="kpi-note">LBSF METAR observed</span></div>
        <div className="kpi"><span className="kpi-label">Mean visibility</span><span className="kpi-value">{visibility(station.mean_visibility_m)}</span><span className="kpi-note">during fog events</span></div>
        <div className="kpi"><span className="kpi-label">Minimum</span><span className="kpi-value">{visibility(station.minimum_visibility_m)}</span><span className="kpi-note">station observation</span></div>
      </div>
      {selected && <div className="detail fog-hotspot-detail">
        <div className="detail-head"><div><span className="eyebrow">{selected.id} · {selected.district}</span><h3>{selected.name}</h3></div><button className="icon-btn" onClick={() => onSelect(null)} aria-label="Close hotspot details"><X size={16} /></button></div>
        <RiskBadge score={selected.score} />
        <div className="detail-grid"><div><span>Events</span><b className="mono">{selected.events}</b></div><div><span>Station min vis</span><b className="mono">{visibility(selected.minimum_visibility_m)}</b><small>on matched dates</small></div><div><span>Road exposure</span><b className="mono">{selected.exposed_road_km ?? '—'} km</b></div><div><span>Fog days/yr</span><b className="mono">{selected.fog_days_per_year}</b></div></div>
        <div className="detail-block"><span className="eyebrow">Observed event dates</span><div className="date-chips">{(selected.recent_dates ?? []).map(date => <span key={date}>{formatDate(date)}</span>)}</div></div>
      </div>}
      <div className="list-head"><h4>Fog hotspots</h4><span>{summary.sources.roads_status === 'available' ? 'OSM roads' : 'OSM unavailable'}</span></div>
      {hotspots.length ? <ol className="fix-list">
        {hotspots.map((item, index) => <li key={item.id}><button onClick={() => onSelect(item.id)}>
          <span className="fix-rank mono">{String(index + 1).padStart(2, '0')}</span>
          <span className="fix-body"><strong>{item.name}</strong><small>{item.district} · {item.events} fog events</small></span>
          <RiskBadge score={item.score} />
        </button></li>)}
      </ol> : <p className="dock-desc fog-exposure-note">{summary.hotspot_note || 'Road geometries could not be fetched; no road exposure scores are published.'} The verified METAR station record remains available.</p>}
      {riskRegister.length > 0 && <p className="map-hint"><Info size={12} /> Road length stays blank where OSM exposure was unavailable.</p>}
    </div>
  </aside>;
}

function FogMapPage({ data, onNavigate }) {
  const { summary, events, hotspots, riskRegister } = data;
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [map, setMap] = useState(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [lensOpen, setLensOpen] = useState(() => window.innerWidth > 860);
  const [layers, setLayers] = useState({ extent: true, valley: false, hotspots: true, buildings: true, terrain: true });
  const event = selectedIndex >= 0 ? events[selectedIndex] : null;
  const currentProbability = event?.hourly[hour]?.probability ?? summary?.max_probability ?? 0;
  const expectedVisibility = event?.hourly[hour]?.expected_visibility_m ?? null;

  useEffect(() => {
    if (!events.length || selectedIndex >= 0) return;
    setSelectedIndex(events.length - 1);
  }, [events.length, selectedIndex]);
  useEffect(() => {
    const selectedEvent = events[selectedIndex];
    if (selectedEvent?.hourly.length) {
      const peak = selectedEvent.hourly.reduce((best, item, index, series) =>
        item.probability > series[best].probability ? index : best, 0);
      setHour(peak);
    } else {
      setHour(0);
    }
    setPlaying(false);
  }, [selectedIndex, events]);
  useEffect(() => {
    if (!playing || !event) return undefined;
    const timer = setInterval(() => setHour(current => current >= event.hourly.length - 1 ? 0 : current + 1), 650);
    return () => clearInterval(timer);
  }, [playing, event]);
  useEffect(() => {
    if (!map || !selectedId) return;
    const item = hotspots.find(hotspot => hotspot.id === selectedId);
    if (item) map.flyTo({ center: item.coord, zoom: 15.4, pitch: 62, duration: 1300,
      padding: { right: window.innerWidth > 900 ? 360 : 0 } });
  }, [selectedId, map, hotspots]);

  if (!summary) return <div className="map-page fog-map-page fog-theme">
    <FogMap grid={null} raster={null} fogProbability={0} expectedVisibility={null} hotspots={[]} layers={layers}
      selectedId={null} onSelect={setSelectedId} onReady={setMap} />
    <div className="map-vignette fog-vignette" aria-hidden="true" />
    <div className="fog-page-empty"><FogDataState loading={data.loading} error={data.error} /></div>
    <FogTopBar hotspots={[]} onSelect={setSelectedId} onDock={() => setDockOpen(value => !value)}
      onLens={() => setLensOpen(value => !value)} onNavigate={onNavigate} />
  </div>;

  return <div className="map-page fog-map-page fog-theme">
    <FogMap grid={summary.grid} raster={summary.grid?.raster} fogProbability={currentProbability}
      expectedVisibility={expectedVisibility} hotspots={hotspots}
      layers={layers} selectedId={selectedId} onSelect={setSelectedId} onReady={setMap} />
    <div className="map-vignette fog-vignette" aria-hidden="true" />
    <FogTopBar hotspots={hotspots} onSelect={setSelectedId} onDock={() => setDockOpen(value => !value)}
      onLens={() => setLensOpen(value => !value)} onNavigate={onNavigate} />
    <FogDock events={events} selectedIndex={selectedIndex} onSelect={setSelectedIndex} layers={layers}
      setLayers={setLayers} open={dockOpen} onClose={() => setDockOpen(false)} />
    <FogRiskPanel summary={summary} events={events} hotspots={hotspots} riskRegister={riskRegister} selectedIndex={selectedIndex}
      selectedId={selectedId} onSelect={setSelectedId} open={lensOpen} setOpen={setLensOpen} />
    {map && <div className="camera glass" aria-label="Fog map camera">
      <button onClick={() => map.zoomIn()} aria-label="Zoom in">+</button>
      <button onClick={() => map.zoomOut()} aria-label="Zoom out">−</button>
      <button onClick={() => map.easeTo({ pitch: map.getPitch() ? 0 : 60, duration: 700 })} aria-label="Toggle 3D" className="txt">3D</button>
      <button onClick={() => map.flyTo({ center: [23.326, 42.692], zoom: 12.2, pitch: 60, bearing: -24, duration: 1000 })} aria-label="Reset map"><Waves size={15} /></button>
    </div>}
    <FogTimeline event={event} hour={hour} setHour={setHour} playing={playing} setPlaying={setPlaying} summary={summary} />
    <div className="demo-chip fog-chip"><Check size={12} /> Observed IEM METAR · calibrated screening · not an official warning</div>
  </div>;
}

function FogRegisterPage({ data }) {
  const { summary, hotspots, riskRegister } = data;
  if (!summary) return <div className="page fog-theme"><FogDataState loading={data.loading} error={data.error} /></div>;
  const rows = [...hotspots, ...riskRegister.filter(row => !hotspots.some(hotspot => hotspot.id === row.id))];
  return <div className="page fog-theme">
    <header className="page-head">
      <span className="eyebrow">Sofia · {summary.period.start} – {summary.period.end}</span>
      <h1>Fog risk register</h1>
      <p>Historical station fog observations calibrate the likelihood screen. Road length and traffic exposures are reported only when OpenStreetMap road geometry is available; missing road metrics are not treated as zero.</p>
    </header>
    <div className="page-kpis">
      <div className="kpi"><span className="kpi-label">Fog episodes</span><span className="kpi-value">{summary.event_count}</span><span className="kpi-note">LBSF observed</span></div>
      <div className="kpi"><span className="kpi-label">Fog hours</span><span className="kpi-value">{summary.station.fog_hours.toLocaleString('en')}</span><span className="kpi-note">visibility / weather codes</span></div>
      <div className="kpi"><span className="kpi-label">Minimum visibility</span><span className="kpi-value">{visibility(summary.station.minimum_visibility_m)}</span></div>
      <div className="kpi"><span className="kpi-label">Road hotspots</span><span className="kpi-value">{hotspots.length}</span><span className="kpi-note">{summary.sources.roads_status}</span></div>
    </div>
    <div className="table-wrap">
      <table className="reg-table fog-register-table">
        <thead><tr><th>Location</th><th>Risk</th><th className="num">Fog days/yr</th><th className="num">Mean visibility</th><th className="num">Minimum visibility</th><th className="num">Night share</th><th className="num">Morning rush</th><th className="num">Exposed road (km)</th><th>Traffic roads affected</th><th>Event dates</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td><strong>{row.name}</strong><small>{row.id} · {row.district}</small></td>
          <td><RiskBadge score={row.score ?? row.risk_score ?? 0} /><span className="score-bar"><i style={{ width: `${row.score ?? row.risk_score ?? 0}%` }} /></span></td>
          <td className="num mono">{row.fog_days_per_year ?? '—'}</td>
          <td className="num mono">{visibility(row.mean_visibility_m)}</td>
          <td className="num mono">{visibility(row.minimum_visibility_m)}</td>
          <td className="num mono">{row.night_fog_share == null ? '—' : `${Math.round(row.night_fog_share * 100)}%`}</td>
          <td className="num mono">{row.morning_rush_fog_share == null ? '—' : `${Math.round(row.morning_rush_fog_share * 100)}%`}</td>
          <td className="num mono">{row.exposed_road_km ?? '—'}</td>
          <td>{row.traffic_roads_affected ?? '—'}</td>
          <td className="mono">{(row.recent_dates ?? []).slice(-3).map(formatDate).join(', ') || formatDate(row.worst_event)}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan="10">No observations or road exposure records are available for this period.</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="foot-note"><Info size={13} /> Station observations are ground truth only for Sofia Airport. City-grid likelihood and exposure metrics are a screening model, not an official fog warning.</p>
  </div>;
}

function FogSourcesPage({ data }) {
  const { summary } = data;
  if (!summary) return <div className="page fog-theme"><FogDataState loading={data.loading} error={data.error} /></div>;
  const inputs = [
    { kind: 'Observed visibility', name: 'Iowa Environmental Mesonet ASOS archive', agency: 'IEM · station LBSF', live: true,
      role: `${summary.station.observations.toLocaleString('en')} hourly records; visibility in metres derived from METAR statute miles. Fog catalogue labels include visibility <1 km or FG/BR/FZFG weather codes.`,
      resolution: 'METAR, typically 30 min', cadence: 'Historical archive' },
    { kind: 'Meteorology', name: summary.sources.meteorology, agency: summary.sources.meteorology.includes('NASA') ? 'NASA GMAO' : 'ECMWF via Open-Meteo', live: true,
      role: 'Temperature, dew point, relative humidity, 10 m wind and low cloud cover provide the station-calibration predictors.',
      resolution: 'Hourly reanalysis', cadence: 'Hourly' },
    { kind: 'NASA input', name: 'NASA POWER MERRA-2', agency: 'NASA GMAO', live: Boolean(summary.sources.nasa_power),
      role: summary.sources.nasa_power ? `${summary.sources.nasa_power}. POWER’s tested hourly endpoint does not expose the proposed low-cloud or PBLH fields.` : `Optional secondary meteorology input; was unavailable in the generated run. ${summary.sources.nasa_power_note || ''}`,
      resolution: 'Hourly point series', cadence: 'Hourly' },
    { kind: 'Terrain', name: 'SRTM 1″ terrain', agency: 'NASA / NGA via AWS Terrain Tiles', live: Boolean(summary.grid),
      role: summary.grid ? `${summary.grid.rows} × ${summary.grid.cols} cells, ${summary.grid.cell_m} m. Local topographic position is used as a cold-air pooling proxy.` : 'Not available; the result remains station-only.',
      resolution: summary.grid ? `${summary.grid.cell_m} m grid` : 'Not available', cadence: 'Static' },
    { kind: 'Land cover', name: 'ESA WorldCover 2021', agency: 'ESA · Sentinel-1/2', live: Boolean(summary.grid),
      role: 'Water, wetland and vegetated land modestly adjust terrain-proneness; this is not a local moisture measurement.',
      resolution: '10 m source', cadence: '2021' },
    { kind: 'Road exposure', name: 'OpenStreetMap via Overpass', agency: 'OpenStreetMap contributors', live: summary.sources.roads_status === 'available',
      role: summary.sources.roads_status === 'available' ? 'Major road geometry is sampled against fog-probability cells to screen exposed road length and hotspots.' : `The public Overpass endpoints could not be reached in this run. Road exposure is null, not zero. ${summary.sources.roads_note || ''}`,
      resolution: 'OSM linework', cadence: 'Community-updated' },
    { kind: 'Satellite check', name: 'MODIS / VIIRS low-cloud products', agency: 'NASA / NOAA', live: false,
      role: 'Skipped: no free no-key event-level fog validation endpoint was verified for this implementation.',
      resolution: 'Not used', cadence: 'Not used' },
  ];
  const pipeline = [
    ['01', 'Build the observed catalogue', 'Convert IEM METAR visibility from statute miles to metres, merge sub-hour reports and identify contiguous <1 km / FG / BR / FZFG episodes.'],
    ['02', 'Calibrate the station model', 'Fit a logistic relationship between observed fog labels and dew-point spread, RH, wind, low cloud, local hour and season; score a chronological holdout.'],
    ['03', 'Downscale by terrain', 'Use SRTM local topographic position and WorldCover moisture classes as a cold-air-pooling adjustment. Station calibration is not a city-wide visibility observation.'],
    ['04', 'Screen road exposure', 'Sample available OSM major roads against event likelihood and terrain-adjusted fog; without OSM data, road exposure is explicitly left blank.'],
  ];
  const metrics = summary.calibration;
  return <div className="page fog-theme">
    <header className="page-head">
      <span className="eyebrow">Ground observations to city screening</span>
      <h1>Fog data &amp; model</h1>
      <p>Historical visibility observations at Sofia Airport calibrate a transparent fog-likelihood screen. This is a screening prototype—not an official fog warning and not for safety-critical use.</p>
    </header>
    <div className="fog-validation glass">
      <div><span className="eyebrow">Observed validation</span><h2>{metrics.status === 'trained' ? 'Chronological holdout metrics' : 'Calibration incomplete'}</h2><p>      {metrics.records.toLocaleString('en')} station observations · {metrics.fog_observations.toLocaleString('en')} fog-labelled records · training-selected threshold {metrics.threshold ?? '—'}</p></div>
      <div className="fog-validation-metrics">
        <span><b>{metrics.hit_rate == null ? '—' : `${(metrics.hit_rate * 100).toFixed(1)}%`}</b><small>Hit rate</small></span>
        <span><b>{metrics.false_alarm_rate == null ? '—' : `${(metrics.false_alarm_rate * 100).toFixed(1)}%`}</b><small>False-alarm rate</small></span>
        <span><b>{metrics.pod == null ? '—' : `${(metrics.pod * 100).toFixed(1)}%`}</b><small>POD</small></span>
        <span><b>{metrics.far == null ? '—' : `${(metrics.far * 100).toFixed(1)}%`}</b><small>FAR</small></span>
        <small className="fog-vis-error">Expected visibility holdout MAE: {metrics.visibility_mae_m?.toLocaleString('en') ?? '—'} m</small>
      </div>
    </div>
    <ol className="pipeline fog-pipeline">{pipeline.map(([step, title, text]) => <li key={step}><span className="mono step">{step}</span><h3>{title}</h3><p>{text}</p></li>)}</ol>
    <div className="list-head wide"><h4>Inputs and provenance</h4><span>{inputs.filter(input => input.live).length} available · {summary.period.start} → {summary.period.end}</span></div>
    <div className="source-grid">{inputs.map(input => <article key={input.name} className="source-card">
      <div className="source-top"><span className="source-kind">{input.kind}</span><span className={`st st-${input.live ? 'live' : 'research'}`}>{input.live ? 'Available' : 'Not used'}</span></div>
      <h3>{input.name}</h3><span className="source-agency">{input.agency}</span><p>{input.role}</p>
      <div className="source-meta"><span><b>Resolution</b>{input.resolution}</span><span><b>Cadence</b>{input.cadence}</span></div>
    </article>)}</div>
    <div className="list-head wide"><h4>How to read this screen</h4><span>Assumptions and limits</span></div>
    <ul className="limits fog-limits">
      <li>The METAR catalogue is a real station record, but one airport station cannot validate visibility across Sofia’s full urban area.</li>
      <li>Fog hours use observed visibility below 1 km or METAR FG/BR/FZFG codes. METAR visibility and code availability can be incomplete or irregular.</li>
      <li>The model’s fog-probability raster is terrain-adjusted from station meteorology; no validated per-cell visibility observations exist here.</li>
      <li>Terrain position is only a cold-air pooling proxy. No explicit inversion, drainage-flow, boundary-layer-height or urban canopy simulation is run.</li>
      <li>NASA POWER’s verified parameters are T2M, T2MDEW, RH2M and WS2M. The proposed low-cloud/PBLH parameter names were rejected by its endpoint; Open-Meteo ERA5 supplies low cloud cover.</li>
      <li>OpenStreetMap road exposure and Nominatim naming depend on reachable public services; unavailable road geometry is reported as null. No satellite fog validation product was used.</li>
      <li>Classification and thresholds are a research screen only. This is not an official fog warning or suitable for safety-critical operations, speed control, signage or de-icing decisions.</li>
    </ul>
    <div className="list-head wide"><h4>Audience use cases</h4><span>Decision support only</span></div>
    <div className="outputs fog-audiences">
      <div><Building2 size={22} /><h3>Municipality</h3><p>Screen candidate variable-message signs, fog lights, speed-limit locations and freezing-fog alerts. Field verification is required before action.</p></div>
      <div><CircleAlert size={22} /><h3>Insurers</h3><p>Compare multi-vehicle collision exposure and expected-loss screening by road zone using observed event dates and qualified exposure data.</p></div>
      <div><CarFront size={22} /><h3>Funds, investors &amp; logistics</h3><p>Screen airport proximity, distribution-hub access and data-centre logistics routes for fog disruption; cooling and visibility at the facility are not inferred.</p></div>
    </div>
    <p className="foot-note"><Info size={13} /> Generated {formatDate(summary.generated)}. Source endpoints, event counts and validation scores reflect the last pipeline run.</p>
  </div>;
}

export default function FogNerve({ page, onNavigate }) {
  const data = useFogData();
  if (page === 'fog-register') return <FogRegisterPage data={data} />;
  if (page === 'fog-sources') return <FogSourcesPage data={data} />;
  return <FogMapPage data={data} onNavigate={onNavigate} />;
}
