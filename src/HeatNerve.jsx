import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight, Building2, CircleAlert, Flame, Info, Leaf, Loader2, MapPin, Mountain, PanelRightClose,
  PanelRightOpen, RotateCcw, ScanLine, Search, Sun, ThermometerSun, TreeDeciduous, TriangleAlert, Wrench, X,
  HeartPulse, Paintbrush, Plus, Minus, Satellite,
} from 'lucide-react';
import HeatMap, { SUHI_STOPS, LST_STOPS, HEAT_VIEW } from './HeatMap.jsx';
import { useHeatData } from './useHeatData.js';
import { RISK, riskLevel } from './data.js';

const TZ = 'Europe/Sofia';
const fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const pct = (v) => v == null ? '—' : `${Math.round(v * 100)}%`;
const signed = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

export const HEAT_CAUSE = {
  bare_ground: 'Bare, dry open ground',
  large_roofs: 'Large roofs & car parks',
  dark_surfaces: 'Dark asphalt & roofs',
  no_shade: 'Dense blocks, few trees',
};
const LEVER_ICON = { vegetation: TreeDeciduous, albedo: Paintbrush, people: HeartPulse };

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
function HeatDataState({ loading, error }) {
  return <div className="data-state glass">
    {loading ? <><Loader2 size={18} className="spin" /> Loading Landsat heat record…</>
      : <><TriangleAlert size={18} /><span>Heat results not found ({error}). Run the pipeline: <code>npm run data:heat</code></span></>}
  </div>;
}
const gradient = (stops) => `linear-gradient(90deg, ${stops.map(([v, c], i) => `${c} ${(i / (stops.length - 1)) * 100}%`).join(', ')})`;
const passLabel = (s) => `Landsat ${s.platform.slice(-1)} · ${fmtDay(s.date)}`;

/* ───────────── timeline: 5 years of NASA POWER air temperature + Landsat passes ───────────── */
function HeatTimeline({ summary, scene, onPick }) {
  const W = 480, H = 74;
  const days = summary.air.daily;
  const n = days.length;
  const lo = 10, hi = Math.max(40, summary.air.max_c);
  const y = (t) => H - 2 - Math.max(0, (t - lo) / (hi - lo)) * (H - 8);
  const index = useMemo(() => Object.fromEntries(days.map(([d], i) => [d, i])), [days]);
  const hot = days.map(([, t], i) => t >= 30 ? `M${(i / n * W).toFixed(1)} ${H - 2} V${y(t).toFixed(1)}` : '').join('');
  const warm = days.map(([, t], i) => t >= 20 && t < 30 ? `M${(i / n * W).toFixed(1)} ${H - 2} V${y(t).toFixed(1)}` : '').join('');
  const years = [...new Set(days.map(([d]) => d.slice(0, 4)))];
  return <section className="timeline glass heat-timeline" aria-label="Five-year air temperature and Landsat passes">
    <div className="tl-head">
      <div className="tl-clock">
        <span className="big">{scene ? passLabel(scene) : 'Hot days · 5 years'}</span>
        <span className="tl-sub">{scene ? `Air max ${scene.air_tmax_c ?? '—'} °C` : 'Tap a dot to open a satellite pass'}</span>
      </div>
      <div className="tl-reads">
        <span><b>{summary.air.hot_days}</b> days ≥30 °C</span>
      </div>
    </div>
    <div className="tl-chart">
      <div className="tl-svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={warm} className="heat-bars-warm" vectorEffect="non-scaling-stroke" />
          <path d={hot} className="heat-bars-hot" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2={W} y1={y(30)} y2={y(30)} className="heat-thr" vectorEffect="non-scaling-stroke" />
        </svg>
        {summary.scenes.filter(s => s.png).map(s => {
          const i = index[s.date];
          if (i == null) return null;
          return <button key={s.id} className={`ev-tick heat-tick ${scene?.id === s.id ? 'is-on' : ''}`} style={{ left: `${(i / n) * 100}%` }}
            onClick={() => onPick(s.id)} title={`${passLabel(s)} · city ${signed(s.city_uhi_c)} °C`} aria-label={`Open ${passLabel(s)}`} />;
        })}
        <div className="tl-ticks">{years.map(yr => <span key={yr}>{yr}</span>)}</div>
      </div>
    </div>
  </section>;
}

/* ───────────── left dock ───────────── */
function HeatDock({ summary, sceneId, setSceneId, mode, setMode, layers, setLayers, open, close }) {
  const set = (k) => (v) => setLayers(l => ({ ...l, [k]: v }));
  const passes = summary.scenes.filter(s => s.png).slice().sort((a, b) => b.date.localeCompare(a.date));
  const stops = mode === 'lst' ? LST_STOPS : SUHI_STOPS;
  return <aside className={`dock glass heat-dock ${open ? 'is-open' : ''}`} aria-label="Satellite passes and layers">
    <button className="sheet-close icon-btn" onClick={close} aria-label="Close"><X size={16} /></button>
    <div className="dock-section">
      <h3 className="dock-title">Satellite view</h3>
      <div className="seg seg-2 heat-mode">
        <button className={mode === 'suhi' ? 'is-on' : ''} onClick={() => setMode('suhi')}>Heat island</button>
        <button className={mode === 'lst' ? 'is-on' : ''} onClick={() => setMode('lst')}>Surface °C</button>
      </div>
      <div className="storm-list">
        <button className={`storm ${!sceneId ? 'is-on' : ''}`} onClick={() => setSceneId(null)}>
          <span className="storm-date">Typical summer</span>
          <span className="storm-meta mono">{signed(summary.composite.city_uhi_c)}°</span>
        </button>
        {passes.map(s => <button key={s.id} className={`storm ${sceneId === s.id ? 'is-on' : ''}`} onClick={() => setSceneId(s.id)}>
          <span className="storm-date">{fmtDay(s.date)}</span>
          <span className="storm-meta mono">{signed(s.city_uhi_c)}°</span>
        </button>)}
      </div>
    </div>
    <div className="dock-section">
      <h3 className="dock-title">Layers</h3>
      <div className="toggle-group">
        <Toggle on={layers.heat} onChange={set('heat')} icon={Flame} label="Surface heat" />
        <Toggle on={layers.green} onChange={set('green')} icon={Leaf} label="Vegetation" />
        <Toggle on={layers.lidar} onChange={set('lidar')} icon={ScanLine} label="Lidar" />
        <Toggle on={layers.hotspots} onChange={set('hotspots')} icon={CircleAlert} label="Problem spots" />
        <Toggle on={layers.buildings} onChange={set('buildings')} icon={Building2} label="Buildings" />
        <Toggle on={layers.terrain} onChange={set('terrain')} icon={Mountain} label="Terrain" />
      </div>
    </div>
    <div className="dock-section legend">
      <div className="heat-ramp" style={{ background: gradient(stops) }} />
      <div className="depth-labels">
        {mode === 'lst' ? <><span>{stops[0][0]}°</span><span>Surface temperature</span><span>{stops.at(-1)[0]}°+</span></>
          : <><span>cooler</span><span>vs countryside</span><span>+{stops.at(-1)[0]}°</span></>}
      </div>
      {layers.lidar && <div className="heat-lidar-key"><span><i style={{ background: '#57C48E' }} />Tree</span><span><i style={{ background: '#D7C2A8' }} />Roof</span><span><i style={{ background: '#9BE07A' }} />ICESat-2 canopy</span></div>}
    </div>
  </aside>;
}

/* ───────────── right panel ───────────── */
function HeatDetail({ h, nPasses, close }) {
  return <div className="detail heat-detail">
    <div className="detail-head">
      <div><span className="detail-kicker">{h.district}</span><h3>{h.name}</h3></div>
      <button className="icon-btn round" onClick={close} aria-label="Close detail"><X size={14} strokeWidth={2.6} /></button>
    </div>
    <div className="badge-row"><RiskBadge score={h.score} showScore={false} /><span className="cause-tag">{HEAT_CAUSE[h.cause]}</span></div>
    <div className="stat-row">
      <div><b>+{h.uhi_c.toFixed(1)}<small> °C</small></b><span>vs countryside</span></div>
      <div><b>{Math.round(h.lst_hot_c)}<small> °C</small></b><span>Surface</span></div>
      <div><b>{pct(h.lidar.tree_share)}</b><span>Tree cover</span></div>
    </div>
    <div className="detail-block fix heat-actions">
      <span className="detail-label"><Wrench size={12} /> Suggested actions</span>
      {h.actions.map(a => {
        const Icon = LEVER_ICON[a.lever] ?? Wrench;
        return <div className="heat-action" key={a.title}>
          <Icon size={15} />
          <div><strong>{a.title}{a.cooling_c ? <em>≈ −{a.cooling_c.toFixed(1)} °C</em> : null}</strong></div>
        </div>;
      })}
    </div>
  </div>;
}

function HeatPanel({ summary, hotspots, scene, selectedId, setSelectedId, open, setOpen }) {
  const h = hotspots.find(x => x.id === selectedId);
  const c = summary.composite;
  return <aside className={`lens glass heat-lens ${open ? 'is-open' : 'is-collapsed'}`} aria-label="Urban heat">
    <button className="lens-collapse icon-btn" onClick={() => setOpen(o => !o)} aria-label={open ? 'Collapse panel' : 'Expand panel'}>{open ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button>
    <div className="lens-scroll">
      <div className="lens-title"><h2>{summary.city}</h2><span>{scene ? fmtDay(scene.date) : 'Typical summer midday'}</span></div>
      <div className="kpi-row">
        <Kpi label="vs countryside" value={signed(scene ? scene.city_uhi_c : c.city_uhi_c)} unit="°C" />
        <Kpi label="Hottest 5%" value={`+${c.p95_uhi_c}`} unit="°C" />
        <Kpi label="Hot built-up" value={c.hot_built_km2} unit="km²" />
      </div>
      {h && <HeatDetail h={h} nPasses={c.passes} close={() => setSelectedId(null)} />}
      {!h && <p className="lens-hint"><MapPin size={13} /> Tap a marker on the map for details</p>}
    </div>
  </aside>;
}

function HeatTopBar({ hotspots, onSelect, toggleDock, toggleLens, onNavigate }) {
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const results = q ? hotspots.filter(h => `${h.name} ${h.district}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  return <header className="topbar heat-topbar">
    <div className="brand glass">
      <span className="brand-mark"><ThermometerSun size={15} strokeWidth={2.4} /></span>
      <span className="brand-text"><strong>HeatNerve</strong></span>
    </div>
    <div className={`search glass ${focus ? 'is-focus' : ''}`}>
      <Search size={15} />
      <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} placeholder="Search" aria-label="Search heat hotspots" />
      {focus && q && <div className="search-pop">
        {results.map(h => <button key={h.id} onMouseDown={() => { onSelect(h.id); setQ(''); }}>
          <span className={`dot d-${riskLevel(h.score)}`} /><span><strong>{h.name}</strong><small>{h.district}</small></span>
        </button>)}
        {!results.length && <p className="muted">No results</p>}
      </div>}
    </div>
    <nav className="fog-page-nav heat-page-nav" aria-label="HeatNerve pages">
      <button onClick={() => onNavigate('heat-map')}>Map</button>
      <button onClick={() => onNavigate('heat-register')}>Heat risk</button>
      <button onClick={() => onNavigate('heat-sources')}>Data &amp; model</button>
    </nav>
    <div className="top-actions">
      <button className="ghost-btn glass mobile-only" onClick={toggleDock} aria-label="Passes and layers"><Satellite size={15} /></button>
      <button className="ghost-btn glass mobile-only" onClick={toggleLens} aria-label="Details"><PanelRightOpen size={15} /></button>
    </div>
  </header>;
}

function HeatMapPage({ data, onNavigate }) {
  const { summary, hotspots } = data;
  const [sceneId, setSceneId] = useState(null);
  const [mode, setMode] = useState('suhi');
  const [selectedId, setSelectedId] = useState(null);
  const [map, setMap] = useState(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [lensOpen, setLensOpen] = useState(() => window.innerWidth > 860);
  const [layers, setLayers] = useState({ heat: true, green: false, lidar: false, hotspots: true, buildings: true, terrain: true });
  const scene = summary?.scenes.find(s => s.id === sceneId) ?? null;
  const png = summary ? (scene?.png ?? summary.rasters.suhi) : null;
  const refC = scene ? scene.rural_ref_c : summary?.composite.rural_ref_c ?? 0;

  useEffect(() => { if (selectedId) setLensOpen(true); }, [selectedId]);
  useEffect(() => {
    if (!map || !selectedId) return;
    const h = hotspots.find(x => x.id === selectedId);
    if (h) map.flyTo({ center: h.coord, zoom: 15.2, pitch: 60, bearing: map.getBearing() + 12, duration: 1800, padding: { right: window.innerWidth > 900 ? 360 : 0 } });
  }, [selectedId, map]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="map-page heat-map-page heat-theme">
    <HeatMap summary={summary} hotspots={hotspots} png={png} mode={mode} refC={refC} layers={layers} selectedId={selectedId} onSelect={setSelectedId} onReady={setMap} />
    <HeatTopBar hotspots={hotspots} onSelect={setSelectedId} toggleDock={() => setDockOpen(o => !o)} toggleLens={() => setLensOpen(o => !o)} onNavigate={onNavigate} />
    {summary ? <>
      <HeatDock summary={summary} sceneId={sceneId} setSceneId={setSceneId} mode={mode} setMode={setMode} layers={layers} setLayers={setLayers} open={dockOpen} close={() => setDockOpen(false)} />
      <HeatPanel summary={summary} hotspots={hotspots} scene={scene} selectedId={selectedId} setSelectedId={setSelectedId} open={lensOpen} setOpen={setLensOpen} />
      {map && <div className="camera glass" aria-label="Camera">
        <button onClick={() => map.zoomIn()} aria-label="Zoom in"><Plus size={16} /></button>
        <button onClick={() => map.zoomOut()} aria-label="Zoom out"><Minus size={16} /></button>
        <button onClick={() => map.easeTo({ pitch: map.getPitch() > 5 ? 0 : HEAT_VIEW.pitch, duration: 900 })} aria-label="Toggle 3D" className="txt">3D</button>
        <button onClick={() => map.flyTo({ ...HEAT_VIEW, duration: 1600 })} aria-label="Reset view"><RotateCcw size={15} /></button>
      </div>}
      <HeatTimeline summary={summary} scene={scene} onPick={setSceneId} />
    </> : <HeatDataState loading={data.loading} error={data.error} />}
  </div>;
}

/* ───────────── register ───────────── */
function HeatRegisterPage({ data }) {
  const { summary, hotspots } = data;
  const [filter, setFilter] = useState('all');
  if (!summary) return <div className="page heat-theme"><HeatDataState loading={data.loading} error={data.error} /></div>;
  const causes = Object.keys(HEAT_CAUSE).filter(k => hotspots.some(h => h.cause === k));
  const rows = hotspots.filter(h => filter === 'all' || h.cause === filter);
  const c = summary.composite;
  return <div className="page heat-theme">
    <header className="page-head">
      <span className="eyebrow">{summary.city} · summers {summary.scenes[0]?.date.slice(0, 4)}–{summary.scenes.at(-1)?.date.slice(0, 4)}</span>
      <h1>Heat risk register</h1>
      <p>Built-up places where Landsat measured the ground surface far hotter than the countryside around {summary.city} on {c.passes} clear summer middays. Ranked by how much hotter, how often, and how much built-up land is affected. Each place lists the cause in the data and what would cool it.</p>
    </header>
    <div className="page-kpis">
      <Kpi label="Problem spots" value={hotspots.length} />
      <Kpi label="City vs countryside" value={signed(c.city_uhi_c)} unit="°C" note="median built-up surface" />
      <Kpi label="Hot built-up land" value={c.hot_built_km2} unit="km²" note={`of ${c.urban_km2} km² · > +${summary.hot_threshold_c} °C`} />
      <Kpi label="Days ≥30 °C air" value={summary.air.hot_days} note={`${summary.air.heatwaves.length} heatwaves · 5 yrs`} />
    </div>
    <div className="filters">
      {['all', ...causes].map(f => <button key={f} className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All causes' : HEAT_CAUSE[f]}</button>)}
    </div>
    <div className="table-wrap">
      <table className="reg-table heat-register-table">
        <thead><tr><th>Location</th><th>Risk</th><th>Cause</th><th className="num">vs countryside</th><th className="num">Surface, hot days</th><th className="num">Hot passes</th><th className="num">Tree canopy</th><th className="num">NDVI</th><th className="num">Albedo</th><th className="num">Hot built-up</th><th>First action</th></tr></thead>
        <tbody>
          {rows.map(h => <tr key={h.id}>
            <td><strong>{h.name}</strong><small>{h.id} · {h.district}</small></td>
            <td><RiskBadge score={h.score} /><span className="score-bar"><i style={{ width: `${h.score}%` }} /></span></td>
            <td>{HEAT_CAUSE[h.cause]}</td>
            <td className="num mono">+{h.uhi_c.toFixed(1)} °C</td>
            <td className="num mono">{h.lst_hot_c.toFixed(0)} °C</td>
            <td className="num mono">{pct(h.hot_share)}</td>
            <td className="num mono">{pct(h.lidar.tree_share)}</td>
            <td className="num mono">{h.ndvi.toFixed(2)}</td>
            <td className="num mono">{h.albedo.toFixed(2)}</td>
            <td className="num mono">{h.hot_built_ha} ha</td>
            <td className="fix-cell"><b>{h.actions[0].title}</b>{h.actions[0].cooling_c ? ` (≈ −${h.actions[0].cooling_c} °C)` : ''}. {h.actions[0].detail}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="foot-note"><Info size={13} /> Surface (skin) temperature at about 12:10 local time, not air temperature. 30 m pixels mix roofs, streets and trees. This is a screening tool, not an engineering design.</p>
  </div>;
}

/* ───────────── data & model ───────────── */
function HeatSourcesPage({ data }) {
  const { summary } = data;
  if (!summary) return <div className="page heat-theme"><HeatDataState loading={data.loading} error={data.error} /></div>;
  const c = summary.composite, L = summary.lidar, reg = summary.regression;
  const first = summary.scenes[0]?.date, last = summary.scenes.at(-1)?.date;
  const sources = [
    { kind: 'Thermal', name: 'Landsat 8 & 9 TIRS · Collection 2 Level-2 ST', agency: 'NASA / USGS · via Microsoft Planetary Computer', live: true,
      role: `${c.passes} clear summer passes ${first} → ${last} (≥60% cloud-free over the city). Surface temperature from band 10, cloud/shadow removed with QA_PIXEL.`, res: '30 m (100 m thermal)', cadence: '8 days (L8+L9)' },
    { kind: 'Optical', name: 'Landsat 8 & 9 OLI surface reflectance', agency: 'NASA / USGS', live: true,
      role: `Same passes: NDVI vegetation index and broadband albedo (Liang 2001). Built-up median NDVI ${c.urban_ndvi}, albedo ${c.urban_albedo}.`, res: '30 m', cadence: '8 days' },
    { kind: 'Lidar', name: 'GEDI L2A', agency: 'NASA · ISS · via SlideRule', live: L.gedi_shots > 0,
      role: `${L.gedi_shots.toLocaleString('en')} quality-filtered 25 m laser shots ${L.gedi_first} → ${L.gedi_last}. Height = highest return − ground. ${L.gedi_tree.toLocaleString('en')} hit trees, ${L.gedi_roof.toLocaleString('en')} hit roofs (split by Landsat NDVI).`, res: '25 m footprints', cadence: 'ISS orbit' },
    { kind: 'Lidar', name: 'ICESat-2 ATL08 (PhoREAL)', agency: 'NASA · via SlideRule', live: L.atl08_segments > 0,
      role: `${L.atl08_segments.toLocaleString('en')} 40 m segments ${L.atl08_first ?? ''} → ${L.atl08_last ?? ''}: canopy height (98th percentile of canopy photons above ground).`, res: '40 m segments', cadence: '91-day repeat' },
    { kind: 'Air temperature', name: 'NASA POWER daily (MERRA-2)', agency: 'NASA LaRC / GMAO', live: true,
      role: `${summary.air.hot_days} days ≥30 °C, ${summary.air.very_hot_days} ≥35 °C, ${summary.air.tropical_nights} nights ≥20 °C. Hottest ${summary.air.max_c} °C on ${fmtDay(summary.air.max_day)}.`, res: '0.5° × 0.625°', cadence: 'Daily' },
    { kind: 'Land cover', name: 'ESA WorldCover 2021', agency: 'ESA · Sentinel-1/2', live: true,
      role: 'Built-up share per cell, and the vegetated countryside used as the rural reference.', res: '10 m', cadence: '2021' },
    { kind: 'Terrain', name: 'SRTM 1″', agency: 'NASA / NGA', live: true,
      role: `Rural reference restricted to ±100 m of the city's median elevation (${summary.city_elev_m} m), so cooler mountain slopes do not inflate the island.`, res: '28 m', cadence: 'Static' },
    { kind: 'Thermal', name: 'ECOSTRESS (ISS)', agency: 'NASA JPL', live: false,
      role: 'Afternoon and night thermal at 70 m would show heat stored after sunset. Needs a free NASA Earthdata login, not used yet.', res: '70 m', cadence: 'Variable' },
  ];
  const steps = [
    ['01', 'Collect clear summer passes', 'Every Landsat 8/9 pass, 1 Jun–15 Sep, whose footprint covers the city; cloud, shadow and snow pixels removed; warped onto the 28 m grid.'],
    ['02', 'Measure against the countryside', 'For each pass: heat island = surface temperature − median of vegetated, non-built cells at the same altitude.'],
    ['03', 'Explain the heat', 'Landsat NDVI and albedo, WorldCover built-up share and lidar tree/roof heights per place. Regression on Sofia itself gives local cooling rates.'],
    ['04', 'Find problem spots', 'Smoothed heat island over built-up land; hottest places 800 m apart, scored by intensity (50%), frequency (25%) and hot built-up area (25%).'],
    ['05', 'Problem → action', 'Cause from the data (bare ground, large roofs, dark surfaces, missing trees); actions with cooling estimates; named from OpenStreetMap.'],
  ];
  return <div className="page heat-theme">
    <header className="page-head">
      <span className="eyebrow">From orbit to street</span>
      <h1>Heat data &amp; model</h1>
      <p>How hot {summary.city}'s concrete and asphalt get: NASA/USGS Landsat thermal images, NASA space lidar and NASA air temperature, run through a transparent surface heat-island screen. Generated {fmtDay(summary.generated)}.</p>
    </header>
    <div className="fog-validation heat-validation glass">
      <div><span className="eyebrow">What drives the heat in {summary.city}</span><h2>City-own regression</h2><p>Heat island ~ vegetation + albedo + built-up, fitted on {reg.cells.toLocaleString('en')} built-up cells (R² {reg.r2}). Statistical association, used for the cooling estimates.</p></div>
      <div className="fog-validation-metrics">
        <span><b>{reg.ndvi.toFixed(1)}°</b><small>per +1.0 NDVI (≈ −{Math.abs(reg.ndvi / 10).toFixed(1)}° per +0.1)</small></span>
        <span><b>{reg.albedo.toFixed(1)}°</b><small>per +1.0 albedo (≈ −{Math.abs(reg.albedo / 10).toFixed(1)}° per +0.1)</small></span>
        <span><b>{reg.built >= 0 ? '+' : ''}{reg.built.toFixed(1)}°</b><small>fully built-up vs open</small></span>
        <span><b>{L.tree_cooling_c != null ? `−${L.tree_cooling_c}°` : '—'}</b><small>GEDI tree shots vs others (built-up)</small></span>
      </div>
    </div>
    <ol className="pipeline">{steps.map(([s, t, x]) => <li key={s}><span className="mono step">{s}</span><h3>{t}</h3><p>{x}</p></li>)}</ol>
    <div className="list-head wide"><h4>Inputs</h4><span>{sources.filter(s => s.live).length} connected · {summary.period.start} → {summary.period.end}</span></div>
    <div className="source-grid">
      {sources.map(d => <article key={d.name} className="source-card">
        <div className="source-top"><span className="source-kind">{d.kind}</span><span className={`st st-${d.live ? 'live' : 'research'}`}>{d.live ? 'Connected' : 'Needs login'}</span></div>
        <h3>{d.name}</h3><span className="source-agency">{d.agency}</span><p>{d.role}</p>
        <div className="source-meta"><span><b>Resolution</b>{d.res}</span><span><b>Cadence</b>{d.cadence}</span></div>
      </article>)}
    </div>
    <div className="list-head wide"><h4>Limits: read before using</h4><span>screening, not design</span></div>
    <ul className="limits">
      <li>Landsat measures the <b>surface</b> (skin) temperature of roofs, roads and canopy at about 12:10 local time. Air temperature in the street is lower and peaks later.</li>
      <li>Thermal band resolution is 100 m (delivered at 30 m), so a single small square or roof is blended with its surroundings.</li>
      <li>Night-time heat (stored by concrete, the main health risk) is not observed by Landsat. ECOSTRESS or MODIS night data would add it.</li>
      <li>Cooling estimates come from comparing places across Sofia (regression R² {reg.r2}), not from a physical simulation. Treat them as order of magnitude.</li>
      <li>GEDI and ICESat-2 sample along tracks, not wall to wall. Tree and roof shares near a place are estimates from the shots that fall there.</li>
      <li>NASA POWER air temperature is a ~50 km reanalysis cell and under-reads the hottest city streets.</li>
    </ul>
    <div className="list-head wide"><h4>Who uses this</h4><span>decision support</span></div>
    <div className="outputs">
      <div><Building2 size={22} /><h3>Municipality</h3><p>Target tree planting, cool-roof and depaving programmes at the hottest blocks first; check results on the next summer's Landsat passes.</p></div>
      <div><HeartPulse size={22} /><h3>Health &amp; social services</h3><p>Place cooling centres, fountains and shaded stops where heat islands overlap heatwave days and vulnerable residents.</p></div>
      <div><TreeDeciduous size={22} /><h3>Developers &amp; owners</h3><p>Use albedo and canopy numbers per site to justify reflective roofs, green roofs and shaded parking.</p></div>
    </div>
  </div>;
}

export default function HeatNerve({ page, onNavigate }) {
  const data = useHeatData();
  if (page === 'heat-register') return <HeatRegisterPage data={data} />;
  if (page === 'heat-sources') return <HeatSourcesPage data={data} />;
  return <HeatMapPage data={data} onNavigate={onNavigate} />;
}
