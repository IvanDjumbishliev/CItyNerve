import React, { useMemo, useState, useEffect } from 'react';
import {
  Waves, Map as MapIcon, ListOrdered, Satellite, Search, X, Play, Pause, Mountain, Building2, Droplets,
  Navigation, Box, Plus, Minus, RotateCcw, Info, CloudRain, Gauge, Wrench, ArrowUpRight, SlidersHorizontal,
  PanelRightClose, PanelRightOpen, CircleAlert, MapPin, ScanLine, CalendarDays, Check, Loader2, TriangleAlert,
  LayoutDashboard, Siren, CloudRain as RainIcon, CloudFog, ThermometerSun, CarFront, BellRing, Radio, Settings2,
} from 'lucide-react';
import FloodMap from './FloodMap.jsx';
import { CITY, RISK, CAUSE, riskLevel, PIPELINE } from './data.js';
import { useFloodData } from './useFloodData.js';
import LegacyApp from './legacy/LegacyApp.jsx';
import './legacy/legacy.css';

const TZ = 'Europe/Sofia';
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const fmtDayShort = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' });
const fmtTime = (d) => d.toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const addHours = (iso, h) => new Date(new Date(iso).getTime() + h * 3600e3);
const ha = (km2) => Math.round(km2 * 100);

/* ───────────── small UI atoms ───────────── */
function RiskBadge({ score, showScore = true }) {
  const lvl = riskLevel(score);
  return <span className={`risk-badge rb-${lvl}`}><CircleAlert size={12} strokeWidth={2.4} />{RISK[lvl].label}{showScore && <b>{score}</b>}</span>;
}
function Kpi({ label, value, unit, note }) {
  return <div className="kpi"><span className="kpi-label">{label}</span><span className="kpi-value">{value}<small>{unit}</small></span>{note && <span className="kpi-note">{note}</span>}</div>;
}
function Toggle({ on, onChange, icon: Icon, label, hint }) {
  return <button className={`toggle ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
    <Icon size={15} /><span className="toggle-text">{label}{hint && <small>{hint}</small>}</span><span className="switch"><i /></span>
  </button>;
}

/* ───────────── navigation rail ───────────── */
const RAIL_GROUPS = [
  { label: null, items: [['map', 'Flood map', MapIcon], ['register', 'Risk register', ListOrdered], ['sources', 'Data & model', Satellite]] },
  { label: 'Platform', items: [
    ['l-overview', 'Overview', LayoutDashboard], ['l-incidents', 'Incidents', Siren], ['l-flood', 'Flood', RainIcon],
    ['l-fog', 'Fog', CloudFog], ['l-heat', 'Heat', ThermometerSun], ['l-mobility', 'Mobility', CarFront],
    ['l-alert', 'Alerts', BellRing], ['l-devices', 'Devices', Radio], ['l-settings', 'Settings', Settings2],
  ] },
];

function Rail({ page, setPage }) {
  return <nav className="rail" aria-label="Main">
    <div className="rail-logo" title="FloodNerve"><Waves size={20} strokeWidth={2.4} /></div>
    <div className="rail-items">
      {RAIL_GROUPS.map((g, gi) => <div className="rail-group" key={gi}>
        {g.label && <span className="rail-group-label">{g.label}</span>}
        {g.items.map(([id, label, Icon]) => <button key={id} className={`rail-btn ${page === id ? 'is-active' : ''}`} onClick={() => setPage(id)} aria-current={page === id} title={label}>
          <Icon size={19} /><span>{label}</span>
        </button>)}
      </div>)}
    </div>
    <div className="rail-foot"><span className="pulse-dot live" /><span className="rail-foot-text">NASA data</span></div>
  </nav>;
}

/* ───────────── timeline ───────────── */
function EventTimeline({ ev, hour, setHour, playing, setPlaying }) {
  const W = 480, H = 74, n = ev.rain.length;
  const maxRain = Math.max(...ev.rain, 0.5);
  const bw = W / n;
  const xAt = (i) => (i / Math.max(1, n - 1)) * W;
  const line = ev.level.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)} ${(H - 4 - v * 38).toFixed(1)}`).join(' ');
  const area = `M0 ${H} ` + ev.level.map((v, i) => `L${xAt(i).toFixed(1)} ${(H - 4 - v * 38).toFixed(1)}`).join(' ') + ` L${W} ${H} Z`;
  const now = addHours(ev.window_start, hour);
  const peak = ev.level.indexOf(Math.max(...ev.level));
  const lvl = ev.level[Math.round(hour)] ?? 0;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * (n - 1)));
  return <section className="timeline glass" aria-label="Storm timeline">
    <div className="tl-head">
      <button className="play" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play storm'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <div className="tl-clock"><span className="mono big">{fmtTime(now)}</span><span className="tl-sub">{Math.abs(hour - peak) < 1 ? 'Peak water' : hour < peak ? 'Water rising' : 'Receding'} · local time</span></div>
      <div className="tl-reads">
        <span><CloudRain size={13} /> <b className="mono">{(ev.rain[Math.round(hour)] ?? 0).toFixed(1)}</b> mm/h</span>
        <span><Gauge size={13} /> <b className="mono">{Math.round(lvl * 100)}%</b> of event peak</span>
      </div>
    </div>
    <div className="tl-chart">
      <div className="tl-lane-labels"><span>Rain</span><span>Water</span></div>
      <div className="tl-svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {ev.rain.map((r, i) => <rect key={i} x={i * bw + bw * 0.15} y={0} width={bw * 0.7} height={Math.max(0.4, (r / maxRain) * 26)} rx="1" className={i <= hour ? 'rain-bar past' : 'rain-bar'} />)}
          <line x1="0" x2={W} y1="31" y2="31" className="tl-divider" />
          <path d={area} className="level-area" />
          <path d={line} className="level-line" vectorEffect="non-scaling-stroke" />
          <line x1={xAt(hour)} x2={xAt(hour)} y1="0" y2={H} className="tl-cursor" vectorEffect="non-scaling-stroke" />
        </svg>
        <input type="range" min="0" max={n - 1} step="1" value={hour} onChange={e => { setPlaying(false); setHour(+e.target.value); }} aria-label="Scrub storm hour" />
        <div className="tl-ticks">{ticks.map(i => <span key={i}>{fmtTime(addHours(ev.window_start, i)).replace(',', '')}</span>)}</div>
      </div>
    </div>
  </section>;
}

function RecordTimeline({ summary, onPick }) {
  const W = 480, H = 74, days = summary.daily, n = days.length;
  const max = Math.max(...days.map(d => d[1]));
  const path = days.map(([, v], i) => v > 0.5 ? `M${(i / n * W).toFixed(1)} ${H - 2} V${(H - 2 - (v / max) * (H - 8)).toFixed(1)}` : '').join('');
  const dayIndex = Object.fromEntries(days.map(([d], i) => [d, i]));
  const years = Object.keys(summary.rain.yearly_mm);
  return <section className="timeline glass" aria-label="Five-year rain record">
    <div className="tl-head">
      <span className="play static"><CalendarDays size={16} /></span>
      <div className="tl-clock"><span className="mono big">{fmtDay(summary.period.start)} – {fmtDay(summary.period.end)}</span><span className="tl-sub">Daily rain, 5 years · map shows the deepest water from the 8 largest storms</span></div>
      <div className="tl-reads">
        <span><CloudRain size={13} /> <b className="mono">{summary.rain.annual_mean_mm}</b> mm/yr</span>
        <span><Droplets size={13} /> wettest day <b className="mono">{summary.rain.wettest_day.mm}</b> mm</span>
      </div>
    </div>
    <div className="tl-chart">
      <div className="tl-lane-labels"><span>Rain</span><span>/day</span></div>
      <div className="tl-svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={path} className="daily-bars" vectorEffect="non-scaling-stroke" />
        </svg>
        {summary.events.map((e, i) => {
          const idx = dayIndex[e.start.slice(0, 10)];
          if (idx == null) return null;
          return <button key={e.id} className="ev-tick" style={{ left: `${(idx / n) * 100}%` }} onClick={() => onPick(i)} title={`${fmtDay(e.start)} · ${e.total_mm} mm`} aria-label={`Open storm of ${fmtDay(e.start)}`} />;
        })}
        <div className="tl-ticks">{years.map(y => <span key={y}>{y}</span>)}</div>
      </div>
    </div>
  </section>;
}

/* ───────────── left dock: real storms + layers ───────────── */
function StormDock({ summary, eventIdx, setEventIdx, layers, setLayers, open, close }) {
  const set = (k) => (v) => setLayers(l => ({ ...l, [k]: v }));
  const ev = eventIdx >= 0 ? summary.events[eventIdx] : null;
  return <aside className={`dock glass ${open ? 'is-open' : ''}`} aria-label="Storms and layers">
    <button className="sheet-close icon-btn" onClick={close} aria-label="Close"><X size={16} /></button>
    <div className="dock-section">
      <h3 className="eyebrow">Real storms · last 5 years</h3>
      <div className="storm-list">
        <button className={`storm ${eventIdx === -1 ? 'is-on' : ''}`} onClick={() => setEventIdx(-1)}>
          <span className="storm-date">5-year maximum</span><span className="storm-meta mono">{summary.max5y.flooded_km2} km²</span>
        </button>
        {summary.events.map((e, i) => <button key={e.id} className={`storm ${eventIdx === i ? 'is-on' : ''}`} onClick={() => setEventIdx(i)}>
          <span className="storm-date">{fmtDay(e.start)}</span>
          <span className="storm-meta mono">{Math.round(e.total_mm)} mm</span>
        </button>)}
      </div>
      {ev ? <div className="readouts">
        <div><span>Rain (GPM)</span><b className="mono">{Math.round(ev.total_mm)}<small> mm</small></b></div>
        <div><span>Soil wetness</span><b className="mono">{Math.round(ev.soil_wetness * 100)}<small> %</small></b></div>
        <div><span>ERA5 check</span><b className="mono">{Math.round(ev.era5_mm)}<small> mm</small></b></div>
      </div> : <p className="dock-desc">{summary.rain.events_confirmed} storms ≥12 mm confirmed by two independent sources since {fmtDay(summary.period.start)}.</p>}
    </div>
    <div className="dock-section">
      <h3 className="eyebrow">Layers</h3>
      <Toggle on={layers.extent} onChange={set('extent')} icon={Droplets} label="Flood depth" hint="model output · 28 m" />
      <Toggle on={layers.depth3d} onChange={set('depth3d')} icon={Box} label="Water volume" hint="3D at problem spots · ×20" />
      <Toggle on={layers.flow} onChange={set('flow')} icon={Navigation} label="River network" hint="computed from terrain" />
      <Toggle on={layers.hotspots} onChange={set('hotspots')} icon={CircleAlert} label="Problem spots" />
      <Toggle on={layers.lidar} onChange={set('lidar')} icon={ScanLine} label="ICESat-2 lidar" hint="NASA ground tracks" />
      <Toggle on={layers.buildings} onChange={set('buildings')} icon={Building2} label="3D buildings" hint="OSM heights" />
      <Toggle on={layers.terrain} onChange={set('terrain')} icon={Mountain} label="Terrain relief" hint="SRTM ×1.6" />
    </div>
    <div className="dock-section legend">
      <h3 className="eyebrow">Water depth</h3>
      <div className="depth-ramp"><i style={{ background: '#1F5F8B' }} /><i style={{ background: '#2E8FD0' }} /><i style={{ background: '#7CCBFF' }} /></div>
      <div className="depth-labels"><span>0.1–0.3 m</span><span>0.3–1 m</span><span>&gt; 1 m</span></div>
      {layers.lidar && <div className="drain-legend"><span><i className="lidar-dot" />ICESat-2 ground point (2021–2026)</span></div>}
    </div>
  </aside>;
}

/* ───────────── right panel ───────────── */
function HotspotDetail({ h, close }) {
  return <div className="detail">
    <div className="detail-head">
      <div><span className="eyebrow">{h.id} · {h.district}</span><h3>{h.name}</h3></div>
      <button className="icon-btn" onClick={close} aria-label="Close detail"><X size={16} /></button>
    </div>
    <div className="badge-row"><RiskBadge score={h.score} /><span className="cause-tag">{CAUSE[h.cause]}</span></div>
    <div className="detail-grid">
      <div><span>Max depth</span><b className="mono">{h.depth.toFixed(2)} m</b></div>
      <div><span>Flooded in</span><b className="mono">{h.events} of {h.events_total}</b><small>storms ≥30 cm</small></div>
      <div><span>Time above flood level</span><b className="mono">~{h.duration_h} h</b><small>model estimate</small></div>
      <div><span>Built-up area hit</span><b className="mono">{(h.built_m2 / 1e4).toFixed(1)} ha</b></div>
    </div>
    <div className="detail-block"><span className="eyebrow">Storm dates that flooded it</span>
      <div className="date-chips">{h.recent_dates.map(d => <span key={d} className={d === h.worst_event ? 'is-worst' : ''}>{fmtDay(d)}</span>)}</div>
    </div>
    <div className="detail-block"><span className="eyebrow">Why</span><p>{h.cause === 'river'
      ? `Water rises out of the channel here: ${h.upstream_km2.toFixed(0)} km² of catchment drains through this point.`
      : `A low point in the terrain collecting runoff from ${h.upstream_km2.toFixed(1)} km².`}</p></div>
    <div className="detail-block fix"><span className="eyebrow"><Wrench size={11} /> Suggested action</span><p>{h.fix}</p></div>
  </div>;
}

function RiskPanel({ summary, hotspots, eventIdx, selection, setSelection, open, setOpen }) {
  const hs = selection ? hotspots.find(h => h.id === selection.id) : null;
  const cur = eventIdx >= 0 ? summary.events[eventIdx] : summary.max5y;
  return <aside className={`lens glass ${open ? 'is-open' : 'is-collapsed'}`} aria-label="Flood risk">
    <button className="lens-collapse icon-btn" onClick={() => setOpen(o => !o)} aria-label={open ? 'Collapse panel' : 'Expand panel'}>{open ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button>
    <div className="lens-scroll">
      <div className="lens-title"><Waves size={18} /><div><h2>Flood risk</h2><span>{eventIdx >= 0 ? `Storm of ${fmtDay(cur.start)}` : 'Sofia · 5-year maximum'}</span></div></div>
      {hs && <HotspotDetail h={hs} close={() => setSelection(null)} />}
      <div className="kpi-row">
        <Kpi label="Flooded area" value={cur.flooded_km2} unit="km²" note="depth ≥10 cm" />
        <Kpi label="Built-up hit" value={ha(cur.built_flooded_km2)} unit="ha" note="ESA WorldCover" />
        <Kpi label="Max depth" value={cur.max_depth_m.toFixed(1)} unit="m" note="model" />
      </div>
      <div className="list-head"><h4>Problem spots</h4><span>5 years · {hotspots[0]?.events_total} storms</span></div>
      <ol className="fix-list">
        {hotspots.map((h, i) => <li key={h.id}><button onClick={() => setSelection({ kind: 'hotspot', id: h.id })}>
          <span className="fix-rank mono">{String(i + 1).padStart(2, '0')}</span>
          <span className="fix-body"><strong>{h.name}</strong><small>{h.district} · {h.depth.toFixed(2)} m · {h.events}× flooded</small></span>
          <RiskBadge score={h.score} />
        </button></li>)}
      </ol>
    </div>
  </aside>;
}

/* ───────────── top bar ───────────── */
function MapTopBar({ hotspots, onSearchPick, toggleDock, toggleLens }) {
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const results = q ? hotspots.filter(h => (h.name + h.district).toLowerCase().includes(q.toLowerCase())).slice(0, 6) : hotspots.slice(0, 5);
  return <header className="topbar">
    <div className="brand glass">
      <span className="brand-mark"><Waves size={16} strokeWidth={2.6} /></span>
      <span className="brand-text"><strong>FloodNerve</strong><small><MapPin size={10} /> {CITY.label}, BG</small></span>
    </div>
    <div className={`search glass ${focus ? 'is-focus' : ''}`}>
      <Search size={15} />
      <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} placeholder="Search street or district" aria-label="Search" />
      {focus && <div className="search-pop">
        <span className="eyebrow">{q ? 'Matches' : 'Top problem spots'}</span>
        {results.map(h => <button key={h.id} onMouseDown={() => { onSearchPick(h.id); setQ(''); }}>
          <span className={`dot d-${riskLevel(h.score)}`} /><span><strong>{h.name}</strong><small>{h.district}</small></span><ArrowUpRight size={13} />
        </button>)}
        {!results.length && <p className="muted">No problem spot matches.</p>}
      </div>}
    </div>
    <div className="top-actions">
      <button className="ghost-btn glass mobile-only" onClick={toggleDock}><SlidersHorizontal size={15} /><span>Storms</span></button>
      <button className="ghost-btn glass mobile-only" onClick={toggleLens}><PanelRightOpen size={15} /><span>Risk</span></button>
    </div>
  </header>;
}

function CameraControls({ map }) {
  const [is3d, set3d] = useState(true);
  if (!map) return null;
  return <div className="camera glass" aria-label="Camera">
    <button onClick={() => map.zoomIn()} aria-label="Zoom in"><Plus size={16} /></button>
    <button onClick={() => map.zoomOut()} aria-label="Zoom out"><Minus size={16} /></button>
    <button onClick={() => { const n = !is3d; set3d(n); map.easeTo({ pitch: n ? CITY.pitch : 0, duration: 900 }); }} aria-label="Toggle 3D" className="txt">{is3d ? '2D' : '3D'}</button>
    <button onClick={() => { set3d(true); map.flyTo({ center: CITY.center, zoom: CITY.zoom, pitch: CITY.pitch, bearing: CITY.bearing, duration: 1600 }); }} aria-label="Reset view"><RotateCcw size={15} /></button>
  </div>;
}

function DataState({ loading, error }) {
  return <div className="data-state glass">
    {loading ? <><Loader2 size={18} className="spin" /> Loading NASA-based model results…</>
      : <><TriangleAlert size={18} /> Model results not found ({error}). Run the pipeline: <code>npm run data</code></>}
  </div>;
}

/* ───────────── pages ───────────── */
function MapPage({ data }) {
  const { summary, hotspots } = data;
  const [eventIdx, setEventIdx] = useState(-1);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState(null);
  const [map, setMap] = useState(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [lensOpen, setLensOpen] = useState(() => window.innerWidth > 860);
  const [layers, setLayers] = useState({ extent: true, depth3d: true, flow: true, hotspots: true, lidar: false, buildings: true, terrain: true });

  const ev = summary && eventIdx >= 0 ? summary.events[eventIdx] : null;
  useEffect(() => {
    if (!ev) return;
    setHour(ev.level.indexOf(Math.max(...ev.level)));   // open at the peak
    setPlaying(false);
  }, [eventIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing || !ev) return;
    const id = setInterval(() => setHour(h => (h >= ev.rain.length - 1 ? 0 : h + 1)), 180);
    return () => clearInterval(id);
  }, [playing, ev]);

  useEffect(() => {
    if (!map || !selection) return;
    const item = hotspots.find(h => h.id === selection.id);
    if (item) map.flyTo({ center: item.coord, zoom: 15.4, pitch: 62, bearing: map.getBearing() + 12, duration: 1800, padding: { right: window.innerWidth > 900 ? 360 : 0 } });
  }, [selection, map]); // eslint-disable-line react-hooks/exhaustive-deps

  const factor = ev ? (ev.level[hour] ?? 0) : 1;
  const png = summary ? (ev ? ev.png : summary.max5y.png) : null;

  return <div className="map-page">
    <FloodMap summary={summary} hotspots={hotspots} png={png} factor={factor} layers={layers} selectedId={selection?.id} onSelect={setSelection} onReady={setMap} />
    <div className="map-vignette" aria-hidden="true" />
    <MapTopBar hotspots={hotspots} onSearchPick={id => setSelection({ kind: 'hotspot', id })} toggleDock={() => setDockOpen(o => !o)} toggleLens={() => setLensOpen(o => !o)} />
    {summary ? <>
      <StormDock summary={summary} eventIdx={eventIdx} setEventIdx={setEventIdx} layers={layers} setLayers={setLayers} open={dockOpen} close={() => setDockOpen(false)} />
      <RiskPanel summary={summary} hotspots={hotspots} eventIdx={eventIdx} selection={selection} setSelection={setSelection} open={lensOpen} setOpen={setLensOpen} />
      <CameraControls map={map} />
      {ev ? <EventTimeline ev={ev} hour={hour} setHour={setHour} playing={playing} setPlaying={setPlaying} />
        : <RecordTimeline summary={summary} onPick={setEventIdx} />}
      <div className="demo-chip"><Check size={12} /> NASA GPM IMERG · MERRA-2 · ICESat-2 · SRTM — screening model</div>
    </> : <DataState loading={data.loading} error={data.error} />}
  </div>;
}

function RegisterPage({ data }) {
  const { summary, hotspots } = data;
  const [filter, setFilter] = useState('all');
  if (!summary) return <div className="page"><DataState loading={data.loading} error={data.error} /></div>;
  const rows = hotspots.filter(h => filter === 'all' || riskLevel(h.score) === filter);
  const levels = ['critical', 'high', 'moderate', 'low'].filter(l => hotspots.some(h => riskLevel(h.score) === l));
  return <div className="page">
    <header className="page-head">
      <span className="eyebrow">Sofia · {fmtDay(summary.period.start)} – {fmtDay(summary.period.end)}</span>
      <h1>Risk register</h1>
      <p>Built-up places where the model, driven by {summary.rain.events_confirmed} real storms from NASA satellite rainfall, puts at least 30 cm of water. Ranked by depth, how often it happens and how much built-up land is hit.</p>
    </header>
    <div className="page-kpis">
      <Kpi label="Problem spots" value={hotspots.length} />
      <Kpi label="Storms analysed" value={summary.rain.events_confirmed} note={`of ${summary.rain.events_found} found`} />
      <Kpi label="Max flooded area" value={summary.max5y.flooded_km2} unit="km²" />
      <Kpi label="Built-up hit (max)" value={ha(summary.max5y.built_flooded_km2)} unit="ha" />
    </div>
    <div className="filters">
      {['all', ...levels].map(f => <button key={f} className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All levels' : RISK[f].label}</button>)}
    </div>
    <div className="table-wrap">
      <table className="reg-table">
        <thead><tr><th>Location</th><th>Risk</th><th>Cause</th><th className="num">Max depth</th><th className="num">Flooded</th><th className="num">Above flood level</th><th className="num">Built-up hit</th><th>Worst storm</th><th>Suggested action</th></tr></thead>
        <tbody>
          {rows.map(h => <tr key={h.id}>
            <td><strong>{h.name}</strong><small>{h.id} · {h.district}</small></td>
            <td><RiskBadge score={h.score} /><span className="score-bar"><i style={{ width: `${h.score}%` }} /></span></td>
            <td>{CAUSE[h.cause]}</td>
            <td className="num mono">{h.depth.toFixed(2)} m</td>
            <td className="num mono">{h.events} / {h.events_total}</td>
            <td className="num mono">~{h.duration_h} h</td>
            <td className="num mono">{(h.built_m2 / 1e4).toFixed(1)} ha</td>
            <td className="mono">{fmtDay(h.worst_event)}</td>
            <td className="fix-cell">{h.fix}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="foot-note"><Info size={13} /> Screening model at 28 m resolution. Not an official flood map; channels, culverts and sewers are not surveyed.</p>
  </div>;
}

function SourcesPage({ data }) {
  const { summary } = data;
  if (!summary) return <div className="page"><DataState loading={data.loading} error={data.error} /></div>;
  const L = summary.lidar, Rn = summary.rain;
  const sources = [
    { kind: 'Lidar', name: 'ICESat-2 (ATL03 → ATL08 ground)', agency: 'NASA · via SlideRule', status: 'live',
      role: `${L.segments_used.toLocaleString('en')} ground segments ${L.first} – ${L.last}. Terrain error ${L.rmse_before_m} → ${L.rmse_after_m} m after correction.`,
      res: '40 m segments', cadence: '91-day repeat' },
    { kind: 'Terrain', name: 'SRTM 1″', agency: 'NASA / NGA · AWS Terrain Tiles', status: 'live',
      role: `${summary.grid.rows}×${summary.grid.cols} cells, ${summary.dem.min_m}–${summary.dem.max_m} m. Roof bias ${L.built_bias_m} m, canopy bias ${L.tree_bias_m} m removed.`,
      res: `${summary.grid.cell_m} m`, cadence: 'Static' },
    { kind: 'Precipitation', name: 'GPM IMERG', agency: 'NASA / JAXA · via NASA POWER', status: 'live',
      role: `Daily satellite rain, ${Rn.total_mm.toLocaleString('en')} mm in 5 years (${Rn.annual_mean_mm} mm/yr). Rain vs snow from IMERG liquid probability.`,
      res: '0.1°', cadence: 'Daily' },
    { kind: 'Reanalysis', name: 'MERRA-2', agency: 'NASA GMAO · via NASA POWER', status: 'live',
      role: `${Rn.hours.toLocaleString('en')} hours: hourly rain pattern, surface soil wetness, temperature.`,
      res: '0.5° × 0.625°', cadence: 'Hourly' },
    { kind: 'Validation', name: 'ERA5', agency: 'ECMWF · via Open-Meteo', status: 'live',
      role: `Independent check: ${Rn.events_confirmed} of ${Rn.events_found} storms confirmed.`, res: '0.25°', cadence: 'Hourly' },
    { kind: 'Land cover', name: 'WorldCover 2021', agency: 'ESA · Sentinel-1/2', status: 'live',
      role: `Built-up, vegetation and water at 10 m → runoff curve numbers. ${Math.round(summary.landcover.built_share * 100)}% of the area is built-up.`, res: '10 m', cadence: '2021' },
    { kind: 'Soil', name: 'SMAP L4', agency: 'NASA', status: 'login', role: 'Finer soil moisture (9 km, 3-hourly). Needs a free NASA Earthdata login.', res: '9 km', cadence: '3 h' },
    { kind: 'Precipitation', name: 'GPM IMERG half-hourly', agency: 'NASA', status: 'login', role: 'Real 30-min storm intensities instead of daily totals. Needs Earthdata login.', res: '0.1°', cadence: '30 min' },
  ];
  const statusLabel = { live: 'Connected', login: 'Needs login' };
  return <div className="page">
    <header className="page-head">
      <span className="eyebrow">From orbit to street</span>
      <h1>Data & model</h1>
      <p>Every number on the map comes from this chain: NASA satellite rain and lidar, terrain and land cover, run through a transparent flood screening model for Sofia. Generated {fmtDay(summary.generated)}.</p>
    </header>
    <ol className="pipeline">
      {PIPELINE.map(p => <li key={p.step}><span className="mono step">{p.step}</span><h3>{p.title}</h3><p>{p.text}</p></li>)}
    </ol>
    <div className="list-head wide"><h4>Inputs</h4><span>{sources.filter(s => s.status === 'live').length} connected · period {summary.period.start} → {summary.period.end}</span></div>
    <div className="source-grid">
      {sources.map(d => <article key={d.name} className="source-card">
        <div className="source-top"><span className="source-kind">{d.kind}</span><span className={`st st-${d.status === 'live' ? 'live' : 'research'}`}>{statusLabel[d.status]}</span></div>
        <h3>{d.name}</h3>
        <span className="source-agency">{d.agency}</span>
        <p>{d.role}</p>
        <div className="source-meta"><span><b>Resolution</b>{d.res}</span><span><b>Cadence</b>{d.cadence}</span></div>
      </article>)}
    </div>
    <div className="list-head wide"><h4>Limits — read before using</h4><span>screening, not engineering design</span></div>
    <ul className="limits">
      <li>Terrain is 28 m: underpasses, curbs and culverts narrower than that are not visible to the model.</li>
      <li>Storm-sewer capacity is assumed ({summary.model.sewer_mm_h} mm/h over built-up catchments, {summary.model.ditch_mm_h} mm/h elsewhere); Sofia's real network is not public.</li>
      <li>Rain intensity within a day comes from MERRA-2's hourly pattern, so short cloudbursts are smoothed and urban ponding is underestimated.</li>
      <li>River channels are treated as natural; concrete channels of the Vladayska and Perlovska carry more than the model assumes.</li>
      <li>Low points are kept only if they persist in ≥{Math.round(summary.model.depression_prob * 100)}% of {summary.model.realisations} terrain realisations with ICESat-2-measured error ({L.rmse_after_m} m).</li>
    </ul>
  </div>;
}

export default function App() {
  const [page, setPage] = useState('map');
  const data = useFloodData();
  return <div className="shell">
    <Rail page={page} setPage={setPage} />
    <main className={`main main-${page}`}>
      {page === 'map' && <MapPage data={data} />}
      {page === 'register' && <RegisterPage data={data} />}
      {page === 'sources' && <SourcesPage data={data} />}
      {page.startsWith('l-') && <LegacyApp page={page.slice(2)} setPage={id => setPage('l-' + id)} />}
    </main>
  </div>;
}
