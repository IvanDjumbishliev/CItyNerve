import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  Waves,
  Search,
  X,
  Play,
  Pause,
  Mountain,
  Building2,
  Droplets,
  Navigation,
  Box,
  Plus,
  Minus,
  RotateCcw,
  Info,
  CloudRain,
  Gauge,
  Wrench,
  ArrowUpRight,
  SlidersHorizontal,
  PanelRightClose,
  PanelRightOpen,
  CircleAlert,
  MapPin,
  ScanLine,
  CalendarDays,
  Check,
  Loader2,
  TriangleAlert,
  CloudRain as RainIcon,
  CloudFog,
  ThermometerSun,
  CarFront,
  LayoutDashboard,
  Siren,
  BellRing,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  Zap,
  Square,
  Timer,
  Home,
  Maximize2,
} from "lucide-react";
import MobilityPage from "./MobilityPage.jsx";
import OperationsPage from "./operations/OperationsPage.jsx";
import { useOperations } from "./operations/useOperations.js";
import HeatPage from "./HeatPage.jsx";
import FloodMap from "./FloodMap.jsx";
import {
  CITY,
  REGIONS,
  RISK,
  CAUSE,
  HAZARD_MODULES,
  getHazardModuleForRoute,
  riskLevel,
  PIPELINE,
} from "./data.js";
import { useFloodData } from "./useFloodData.js";
import {
  loadDam,
  levelOn,
  startSim,
  stopSim,
  pauseSim,
  playSim,
  setSimSpeed,
  showMaxExtent,
  onStats,
} from "./damSim.js";
import FogNerve from "./FogNerve.jsx";
import HeatNerve from "./HeatNerve.jsx";
import LegacyApp from "./legacy/LegacyApp.jsx";
import ModuleTabs from "./ModuleTabs.jsx";
import { PlaceProvider, usePlaceMap } from "./inspect/PlaceContext.jsx";
import PlaceInspector from "./inspect/PlaceInspector.jsx";
import { readSelection } from "./inspect/geometry.js";
import "./legacy/legacy.css";

const TZ = "Europe/Sofia";
const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const fmtDayShort = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
const fmtTime = (d) =>
  d.toLocaleString("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const addHours = (iso, h) => new Date(new Date(iso).getTime() + h * 3600e3);
const ha = (km2) => Math.round(km2 * 100);

/* ───────────── small UI atoms ───────────── */
function RiskBadge({ score, showScore = true }) {
  const lvl = riskLevel(score);
  return (
    <span className={`risk-badge rb-${lvl}`}>
      <CircleAlert size={12} strokeWidth={2.4} />
      {RISK[lvl].label}
      {showScore && <b>{score}</b>}
    </span>
  );
}
function Kpi({ label, value, unit, note }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        {value}
        <small>{unit}</small>
      </span>
      {note && <span className="kpi-note">{note}</span>}
    </div>
  );
}
function Toggle({ on, onChange, icon: Icon, label, hint }) {
  return (
    <button
      className={`toggle ${on ? "is-on" : ""}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <Icon size={15} />
      <span className="toggle-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className="switch">
        <i />
      </span>
    </button>
  );
}

/* ───────────── navigation rail ───────────── */
const HAZARD_ICONS = { flood: RainIcon, fog: CloudFog, heat: ThermometerSun };
const RAIL_GROUPS = [
  {
    items: [
      ["operations", "City operations", LayoutDashboard],
      ["l-incidents", "Incidents", Siren],
      ["ops-parking", "Parking inventory", CarFront],
      ["l-alert", "Smart boards", BellRing],
      ...HAZARD_MODULES.map((module) => [
        module.routes.map,
        module.navLabel,
        HAZARD_ICONS[module.icon],
      ]),
      ["l-mobility", "Live parking", CarFront],
    ],
  },
];

function Rail({ page, setPage, expanded, setExpanded, theme, onToggleTheme }) {
  const activeModule = getHazardModuleForRoute(page);
  const activeId = activeModule?.routes.map ?? page;
  return (
    <nav className={`rail ${expanded ? "is-expanded" : ""}`} aria-label="Main navigation">
      <div className="rail-head">
        <div className="rail-logo" title="FloodNerve">
          <Waves size={20} strokeWidth={2.4} />
        </div>
        <button
          type="button"
          className="rail-expand"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
          aria-expanded={expanded}
          title={expanded ? "Collapse navigation" : "Expand navigation"}
        >
          {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>
      <div className="rail-items">
        {RAIL_GROUPS.map((group, groupIndex) => (
          <div className="rail-group" key={groupIndex}>
            {group.items.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                className={`rail-btn ${activeId === id ? "is-active" : ""}`}
                onClick={() => setPage(id)}
                aria-current={activeId === id ? "page" : undefined}
                aria-label={label}
                title={label}
              >
                <Icon size={19} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="rail-btn rail-theme"
        onClick={onToggleTheme}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        aria-pressed={theme === "light"}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      >
        {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>
      </button>
      <button
        type="button"
        className={`rail-btn rail-settings ${page === "l-settings" ? "is-active" : ""}`}
        onClick={() => setPage("l-settings")}
        aria-current={page === "l-settings" ? "page" : undefined}
        aria-label="Settings"
        title="Settings"
      >
        <Settings2 size={19} />
        <span>Settings</span>
      </button>
    </nav>
  );
}

/* ───────────── timeline ───────────── */
function EventTimeline({ ev, hour, setHour, playing, setPlaying }) {
  const W = 480,
    H = 74,
    n = ev.rain.length;
  const maxRain = Math.max(...ev.rain, 0.5);
  const bw = W / n;
  const xAt = (i) => (i / Math.max(1, n - 1)) * W;
  const line = ev.level
    .map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)} ${(H - 4 - v * 38).toFixed(1)}`)
    .join(" ");
  const area =
    `M0 ${H} ` +
    ev.level.map((v, i) => `L${xAt(i).toFixed(1)} ${(H - 4 - v * 38).toFixed(1)}`).join(" ") +
    ` L${W} ${H} Z`;
  const now = addHours(ev.window_start, hour);
  const peak = ev.level.indexOf(Math.max(...ev.level));
  const lvl = ev.level[Math.round(hour)] ?? 0;
  const ticks = [0, 0.5, 1].map((f) => Math.round(f * (n - 1)));
  return (
    <section className="timeline glass" aria-label="Storm timeline">
      <div className="tl-head">
        <button
          className="play"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Play storm"}
        >
          {playing ? (
            <Pause size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" />
          )}
        </button>
        <div className="tl-clock">
          <span className="big">{fmtTime(now)}</span>
          <span className="tl-sub">
            {Math.abs(hour - peak) < 1 ? "Peak water" : hour < peak ? "Water rising" : "Receding"}
          </span>
        </div>
        <div className="tl-reads">
          <span>
            <b>{(ev.rain[Math.round(hour)] ?? 0).toFixed(1)}</b> mm/h
          </span>
          <span>
            <b>{Math.round(lvl * 100)}%</b> of peak
          </span>
        </div>
      </div>
      <div className="tl-chart">
        <div className="tl-svg-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {ev.rain.map((r, i) => (
              <rect
                key={i}
                x={i * bw + bw * 0.15}
                y={0}
                width={bw * 0.7}
                height={Math.max(0.4, (r / maxRain) * 26)}
                rx="1"
                className={i <= hour ? "rain-bar past" : "rain-bar"}
              />
            ))}
            <line x1="0" x2={W} y1="31" y2="31" className="tl-divider" />
            <path d={area} className="level-area" />
            <path d={line} className="level-line" vectorEffect="non-scaling-stroke" />
            <line
              x1={xAt(hour)}
              x2={xAt(hour)}
              y1="0"
              y2={H}
              className="tl-cursor"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <input
            type="range"
            min="0"
            max={n - 1}
            step="1"
            value={hour}
            onChange={(e) => {
              setPlaying(false);
              setHour(+e.target.value);
            }}
            aria-label="Scrub storm hour"
          />
          <div className="tl-ticks">
            {ticks.map((i) => (
              <span key={i}>{fmtTime(addHours(ev.window_start, i)).replace(",", "")}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function RecordTimeline({ summary, onPick }) {
  const W = 480,
    H = 74,
    days = summary.daily,
    n = days.length;
  const max = Math.max(...days.map((d) => d[1]));
  const path = days
    .map(([, v], i) =>
      v > 0.5
        ? `M${((i / n) * W).toFixed(1)} ${H - 2} V${(H - 2 - (v / max) * (H - 8)).toFixed(1)}`
        : "",
    )
    .join("");
  const dayIndex = Object.fromEntries(days.map(([d], i) => [d, i]));
  const years = Object.keys(summary.rain.yearly_mm);
  return (
    <section className="timeline glass" aria-label="Five-year rain record">
      <div className="tl-head">
        <div className="tl-clock">
          <span className="big">Daily rain · 5 years</span>
          <span className="tl-sub">Tap a dot to open a storm</span>
        </div>
        <div className="tl-reads">
          <span>
            <b>{summary.rain.annual_mean_mm}</b> mm/yr
          </span>
        </div>
      </div>
      <div className="tl-chart">
        <div className="tl-svg-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={path} className="daily-bars" vectorEffect="non-scaling-stroke" />
          </svg>
          {summary.events.map((e, i) => {
            const idx = dayIndex[e.start.slice(0, 10)];
            if (idx == null) return null;
            return (
              <button
                key={e.id}
                className="ev-tick"
                style={{ left: `${(idx / n) * 100}%` }}
                onClick={() => onPick(i)}
                title={`${fmtDay(e.start)} · ${e.total_mm} mm`}
                aria-label={`Open storm of ${fmtDay(e.start)}`}
              />
            );
          })}
          <div className="tl-ticks">
            {years.map((y) => (
              <span key={y}>{y}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────── left dock: real storms + layers ───────────── */
function StormDock({ summary, eventIdx, setEventIdx, layers, setLayers, open, close }) {
  const set = (k) => (v) => setLayers((l) => ({ ...l, [k]: v }));
  return (
    <aside className={`dock glass ${open ? "is-open" : ""}`} aria-label="Storms and layers">
      <button className="sheet-close icon-btn" onClick={close} aria-label="Close">
        <X size={16} />
      </button>
      <div className="dock-section">
        <h3 className="dock-title">Storms</h3>
        <div className="storm-list">
          {summary.events
            .map((e, i) => ({ e, i }))
            .sort((a, b) => new Date(b.e.start) - new Date(a.e.start))
            .map(({ e, i }) => (
              <button
                key={e.id}
                className={`storm ${eventIdx === i ? "is-on" : ""}`}
                onClick={() => setEventIdx(i)}
              >
                <span className="storm-date">{fmtDay(e.start)}</span>
                <span className="storm-meta">{Math.round(e.total_mm)} mm</span>
              </button>
            ))}
        </div>
      </div>
      <div className="dock-section">
        <h3 className="dock-title">Layers</h3>
        <div className="toggle-group">
          <Toggle on={layers.extent} onChange={set("extent")} icon={Droplets} label="Flood depth" />
          <Toggle on={layers.depth3d} onChange={set("depth3d")} icon={Box} label="Water volume" />
          <Toggle on={layers.flow} onChange={set("flow")} icon={Navigation} label="Rivers" />
          <Toggle
            on={layers.hotspots}
            onChange={set("hotspots")}
            icon={CircleAlert}
            label="Problem spots"
          />
          <Toggle on={layers.lidar} onChange={set("lidar")} icon={ScanLine} label="Lidar" />
          <Toggle
            on={layers.buildings}
            onChange={set("buildings")}
            icon={Building2}
            label="Buildings"
          />
          <Toggle on={layers.terrain} onChange={set("terrain")} icon={Mountain} label="Terrain" />
        </div>
      </div>
      <div className="dock-section legend">
        <div className="depth-ramp">
          <i style={{ background: "#1F5F8B" }} />
          <i style={{ background: "#2E8FD0" }} />
          <i style={{ background: "#7CCBFF" }} />
        </div>
        <div className="depth-labels">
          <span>10 cm</span>
          <span>Water depth</span>
          <span>1 m+</span>
        </div>
      </div>
    </aside>
  );
}

/* ───────────── right panel ───────────── */
function HotspotDetail({ h, close }) {
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <span className="detail-kicker">{h.district}</span>
          <h3>{h.name}</h3>
        </div>
        <button className="icon-btn round" onClick={close} aria-label="Close detail">
          <X size={14} strokeWidth={2.6} />
        </button>
      </div>
      <div className="badge-row">
        <RiskBadge score={h.score} showScore={false} />
        <span className="cause-tag">{CAUSE[h.cause]}</span>
      </div>
      <div className="stat-row">
        <div>
          <b>
            {h.depth.toFixed(1)}
            <small> m</small>
          </b>
          <span>Max depth</span>
        </div>
        <div>
          <b>
            {h.events}
            <small> / {h.events_total}</small>
          </b>
          <span>Storms</span>
        </div>
        <div>
          <b>
            ~{h.duration_h}
            <small> h</small>
          </b>
          <span>Under water</span>
        </div>
      </div>
      <div className="detail-block fix">
        <span className="detail-label">
          <Wrench size={12} /> Suggested action
        </span>
        <p>{h.fix}</p>
      </div>
    </div>
  );
}

/* ───────────── Studena dam ───────────── */
const fmtClock = (t) => {
  const s = Math.max(0, Math.round(t));
  return `T+${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function FillChart({ levels, official = [], current }) {
  const W = 300,
    H = 64,
    n = levels.length;
  const t0 = new Date(levels[0].date).getTime(),
    t1 = new Date(levels[n - 1].date).getTime();
  const x = (d) => ((new Date(d).getTime() - t0) / (t1 - t0)) * W;
  const y = (f) => H - 4 - (Math.min(100, f) / 100) * (H - 10);
  const line = levels
    .map((l, i) => `${i ? "L" : "M"}${x(l.date).toFixed(1)} ${y(l.fill_pct).toFixed(1)}`)
    .join(" ");
  const [hover, setHover] = useState(null);
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect(),
      fx = ((e.clientX - r.left) / r.width) * W;
    let best = levels[0];
    for (const l of levels) if (Math.abs(x(l.date) - fx) < Math.abs(x(best.date) - fx)) best = l;
    setHover(best);
  };
  const show = hover ?? current;
  return (
    <div className="fill-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Reservoir fill over five years"
      >
        <line x1="0" x2={W} y1={y(100)} y2={y(100)} className="fc-grid" />
        <line x1="0" x2={W} y1={y(50)} y2={y(50)} className="fc-grid" />
        <path d={`${line} L${W} ${H} L0 ${H} Z`} className="fc-area" />
        <path d={line} className="fc-line" vectorEffect="non-scaling-stroke" />
        {show && (
          <line
            x1={x(show.date)}
            x2={x(show.date)}
            y1="0"
            y2={H}
            className="fc-cursor"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {official
        .filter((o) => o.date >= levels[0].date && o.date <= levels[n - 1].date)
        .map((o) => (
          <span
            key={o.date}
            className="fc-dot"
            style={{ left: `${(x(o.date) / W) * 100}%`, top: `${y(o.fill_pct)}px` }}
            title={`МОСВ ${fmtDay(o.date)}: ${o.volume_mm3} Mm³ (${Math.round(o.fill_pct)}%)`}
          />
        ))}
      {show && (
        <div className="fc-tip" style={{ left: `${(x(show.date) / W) * 100}%` }}>
          {fmtDay(show.date)} · <b>{Math.round(show.fill_pct)}%</b>
        </div>
      )}
      <div className="fc-axis">
        <span>{levels[0].date.slice(0, 4)}</span>
        <span>100% = 25.2 Mm³</span>
        <span>{levels[n - 1].date.slice(0, 4)}</span>
      </div>
      <div className="fc-legend">
        <span>
          <i className="lg-line" />
          Sentinel-2 (calibrated)
        </span>
        {official.length > 0 && (
          <span>
            <i className="lg-dot" />
            МОСВ official
          </span>
        )}
      </div>
    </div>
  );
}

function DamPanel({ dam, level, periodLabel, mode, setMode, onSimulate, simActive, close }) {
  const d = dam.dam;
  return (
    <div className="detail dam-detail">
      <div className="detail-head">
        <div>
          <span className="detail-kicker">
            {d.name_bg} · {d.river}
          </span>
          <h3>Studena Dam</h3>
        </div>
        <button className="icon-btn round" onClick={close} aria-label="Close">
          <X size={14} strokeWidth={2.6} />
        </button>
      </div>
      <div className="stat-row">
        <div>
          <b>
            {d.height_m}
            <small> m</small>
          </b>
          <span>Wall height</span>
        </div>
        <div>
          <b>
            {d.capacity_mm3}
            <small> Mm³</small>
          </b>
          <span>Capacity</span>
        </div>
        <div>
          <b>
            {Math.round(
              Math.hypot(
                (d.coord[0] - dam.pernik.coord[0]) * 82,
                (d.coord[1] - dam.pernik.coord[1]) * 111,
              ),
            )}
            <small> km</small>
          </b>
          <span>To Pernik</span>
        </div>
      </div>
      <div className="detail-block">
        <span className="detail-label">Water in the lake · {periodLabel}</span>
        <div className="fill-gauge">
          <i style={{ width: `${Math.min(100, level.fill_pct)}%` }} />
          <span>{Math.round(level.fill_pct)}%</span>
        </div>
        <FillChart levels={dam.levels} official={dam.official} current={level} />
      </div>
      <div className="detail-block">
        <span className="detail-label">Failure scenario</span>
        <div className="seg seg-2">
          <button className={mode === "breach" ? "is-on" : ""} onClick={() => setMode("breach")}>
            Breach
          </button>
          <button
            className={mode === "collapse" ? "is-on" : ""}
            onClick={() => setMode("collapse")}
          >
            Total collapse
          </button>
        </div>
        <p className="dam-sub">
          {mode === "breach"
            ? `A ${d.breach_width_m} m gap opens over ${Math.round(d.breach_time_s / 60)} min (Froehlich 2008).`
            : "The whole wall fails within about a minute: worst case."}
        </p>
      </div>
      <button className="simulate-btn" onClick={onSimulate} disabled={simActive}>
        <Zap size={17} /> {simActive ? "Simulation running" : "Simulate dam failure"}
      </button>
      <p className="dam-note">
        <Info size={12} /> Hypothetical planning scenario, not a prediction.
      </p>
    </div>
  );
}

function DamHud({ stats, dam, speed, setSpeed, paused, setPaused, onStop }) {
  const d = dam.dam;
  const done = stats?.done;
  return (
    <section className="timeline glass dam-hud" aria-label="Dam failure simulation">
      <div className="tl-head">
        <button
          className="play danger"
          onClick={() => {
            if (paused) {
              playSim();
              setPaused(false);
            } else {
              pauseSim();
              setPaused(true);
            }
          }}
          aria-label={paused ? "Resume" : "Pause"}
          disabled={done}
        >
          {paused || done ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <div className="tl-clock">
          <span className="mono big">{fmtClock(stats?.t ?? 0)}</span>
          <span className="tl-sub">
            {done
              ? "Simulation finished · 3 h"
              : stats?.breachPct < 1
                ? `Breach opening ${Math.round((stats?.breachPct ?? 0) * 100)}%`
                : "Flood wave travelling down the Struma"}
          </span>
        </div>
        <div className="seg seg-3 speed">
          {[60, 300, 900].map((v) => (
            <button
              key={v}
              className={speed === v ? "is-on" : ""}
              onClick={() => {
                setSpeed(v);
                setSimSpeed(v);
              }}
            >
              ×{v}
            </button>
          ))}
        </div>
        {done && (
          <button className="ghost-btn small" onClick={showMaxExtent}>
            <Maximize2 size={14} /> Max extent
          </button>
        )}
        <button className="ghost-btn small" onClick={onStop}>
          <Square size={13} /> Stop
        </button>
      </div>
      <div className="sim-stats">
        <div>
          <span>Released</span>
          <b className="mono">
            {(stats?.released ?? 0).toFixed(1)}
            <small> / {(stats?.V0 ?? 0).toFixed(1)} Mm³</small>
          </b>
          <i className="mini-bar">
            <i
              style={{
                width: `${Math.min(100, ((stats?.released ?? 0) / Math.max(0.01, stats?.V0 ?? 1)) * 100)}%`,
              }}
            />
          </i>
        </div>
        <div>
          <span>Outflow now · peak</span>
          <b className="mono">
            {Math.round(stats?.outflow ?? 0).toLocaleString("en")}
            <small> · {Math.round(stats?.peakQ ?? 0).toLocaleString("en")} m³/s</small>
          </b>
          <em>Froehlich est. {d.qp_froehlich_m3s.toLocaleString("en")}</em>
        </div>
        <div>
          <span>Flooded land</span>
          <b className="mono">
            {(stats?.area ?? 0).toFixed(2)}
            <small> km²</small>
          </b>
          <em>max {(stats?.peakArea ?? 0).toFixed(2)}</em>
        </div>
        <div>
          <span>Built-up under water</span>
          <b className="mono">
            {Math.round(stats?.built ?? 0)}
            <small> ha</small>
          </b>
          <em>&gt;30 cm · max {Math.round(stats?.peakBuilt ?? 0)}</em>
        </div>
        <div className={stats?.pernikAt != null ? "alert" : ""}>
          <span>
            <Home size={11} /> Reaches Pernik
          </span>
          <b className="mono">{stats?.pernikAt != null ? fmtClock(stats.pernikAt) : "—"}</b>
          <em>{stats?.pernikAt != null ? "built-up area >30 cm" : "not yet"}</em>
        </div>
      </div>
    </section>
  );
}

function RiskPanel({
  summary,
  hotspots,
  eventIdx,
  selection,
  setSelection,
  open,
  setOpen,
  damSlot,
  cityLabel = "Sofia",
}) {
  const hs = selection?.kind === "hotspot" ? hotspots.find((h) => h.id === selection.id) : null;
  const cur = eventIdx >= 0 ? summary.events[eventIdx] : summary.max5y;
  return (
    <aside className={`lens glass ${open ? "is-open" : "is-collapsed"}`} aria-label="Flood risk">
      <button
        className="lens-collapse icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Collapse panel" : "Expand panel"}
      >
        {open ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </button>
      <div className="lens-scroll">
        <div className="lens-title">
          <h2>{cityLabel}</h2>
          <span>{eventIdx >= 0 ? `Storm of ${fmtDay(cur.start)}` : "5-year maximum"}</span>
        </div>
        <div className="kpi-row">
          <Kpi label="Flooded" value={cur.flooded_km2} unit="km²" />
          <Kpi label="Built-up" value={ha(cur.built_flooded_km2)} unit="ha" />
          <Kpi label="Deepest" value={cur.max_depth_m.toFixed(1)} unit="m" />
        </div>
        {selection?.kind === "dam" && damSlot}
        {hs && <HotspotDetail h={hs} close={() => setSelection(null)} />}
        {!selection && (
          <p className="lens-hint">
            <MapPin size={13} /> Tap a marker on the map for details
          </p>
        )}
      </div>
    </aside>
  );
}

/* ───────────── top bar ───────────── */
function MapTopBar({
  hotspots,
  onSearchPick,
  toggleDock,
  toggleLens,
  onDam,
  damReady,
  region,
  setRegion,
  onNavigate,
}) {
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const results = q
    ? hotspots
        .filter((h) => (h.name + h.district).toLowerCase().includes(q.toLowerCase()))
        .slice(0, 6)
    : [];
  return (
    <header className="topbar">
      <div className="brand glass">
        <span className="brand-mark">
          <Waves size={15} strokeWidth={2.6} />
        </span>
        <span className="brand-text">
          <strong>FloodNerve</strong>
        </span>
      </div>
      <div className="city-switch glass" role="tablist" aria-label="City">
        {Object.values(REGIONS).map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={region === r.id}
            className={region === r.id ? "is-on" : ""}
            onClick={() => setRegion(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <ModuleTabs module="flood" route="map" onNavigate={onNavigate} />
      <div className={`search glass ${focus ? "is-focus" : ""}`}>
        <Search size={15} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder="Search"
          aria-label="Search street or district"
        />
        {focus && q && (
          <div className="search-pop">
            {results.map((h) => (
              <button
                key={h.id}
                onMouseDown={() => {
                  onSearchPick(h.id);
                  setQ("");
                }}
              >
                <span className={`dot d-${riskLevel(h.score)}`} />
                <span>
                  <strong>{h.name}</strong>
                  <small>{h.district}</small>
                </span>
              </button>
            ))}
            {!results.length && <p className="muted">No results</p>}
          </div>
        )}
      </div>
      {damReady && (
        <button className="ghost-btn glass dam-jump" onClick={onDam}>
          <Zap size={15} />
          <span>Studena dam</span>
        </button>
      )}
      <div className="top-actions">
        <button
          className="ghost-btn glass mobile-only"
          onClick={toggleDock}
          aria-label="Storms and layers"
        >
          <SlidersHorizontal size={15} />
        </button>
        <button className="ghost-btn glass mobile-only" onClick={toggleLens} aria-label="Details">
          <PanelRightOpen size={15} />
        </button>
      </div>
    </header>
  );
}

function CameraControls({ map, view = CITY }) {
  const [is3d, set3d] = useState(true);
  if (!map) return null;
  return (
    <div className="camera glass" aria-label="Camera">
      <button onClick={() => map.zoomIn()} aria-label="Zoom in">
        <Plus size={16} />
      </button>
      <button onClick={() => map.zoomOut()} aria-label="Zoom out">
        <Minus size={16} />
      </button>
      <button
        onClick={() => {
          const n = !is3d;
          set3d(n);
          map.easeTo({ pitch: n ? view.pitch : 0, duration: 900 });
        }}
        aria-label="Toggle 3D"
        className="txt"
      >
        {is3d ? "2D" : "3D"}
      </button>
      <button
        onClick={() => {
          set3d(true);
          map.flyTo({
            center: view.center,
            zoom: view.zoom,
            pitch: view.pitch,
            bearing: view.bearing,
            duration: 1600,
          });
        }}
        aria-label="Reset view"
      >
        <RotateCcw size={15} />
      </button>
    </div>
  );
}

function DataState({ loading, error }) {
  return (
    <div className="data-state glass">
      {loading ? (
        <>
          <Loader2 size={18} className="spin" /> Loading NASA-based model results…
        </>
      ) : (
        <>
          <TriangleAlert size={18} /> Model results not found ({error}). Run the pipeline:{" "}
          <code>npm run data</code>
        </>
      )}
    </div>
  );
}

/* ───────────── pages ───────────── */
function MapPage({ data, region, setRegion, onNavigate, onDemoIncident }) {
  const view = REGIONS[region];
  const { summary, hotspots } = data;
  const [eventIdx, setEventIdx] = useState(-1);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState(null);
  const [map, setMap] = useState(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [lensOpen, setLensOpen] = useState(() => window.innerWidth > 860);
  const [layers, setLayers] = useState({
    extent: true,
    depth3d: true,
    flow: true,
    hotspots: true,
    lidar: false,
    buildings: true,
    terrain: true,
  });
  const [dam, setDam] = useState(null);
  const [damMode, setDamMode] = useState("breach");
  const [simActive, setSimActive] = useState(false);
  const [simStats, setSimStats] = useState(null);
  const [simSpeed, setSimSpeedState] = useState(300);
  const [simPaused, setSimPaused] = useState(false);

  useEffect(() => {
    loadDam()
      .then(setDam)
      .catch(() => setDam(null));
  }, []);
  useEffect(() => {
    let last = 0;
    const off = onStats((st) => {
      const now = performance.now();
      if (!st || st.done || now - last > 200) {
        last = now;
        setSimStats(st);
      }
    });
    return () => {
      off();
      stopSim();
    };
  }, []);

  const ev = summary && eventIdx >= 0 ? summary.events[eventIdx] : null;
  useEffect(() => {
    if (!ev) return;
    setHour(ev.level.indexOf(Math.max(...ev.level))); // open at the peak
    setPlaying(false);
  }, [eventIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing || !ev) return;
    const id = setInterval(() => setHour((h) => (h >= ev.rain.length - 1 ? 0 : h + 1)), 180);
    return () => clearInterval(id);
  }, [playing, ev]);

  // the details panel follows the selection: picking a marker on the map opens it
  useEffect(() => {
    if (selection) setLensOpen(true);
  }, [selection]);

  useEffect(() => {
    if (!map || !selection) return;
    if (selection.kind === "dam" && dam) {
      map.flyTo({
        center: dam.dam.coord,
        zoom: 14.2,
        pitch: 64,
        bearing: 130,
        duration: 2200,
        padding: { right: window.innerWidth > 900 ? 360 : 0 },
      });
      return;
    }
    const item = hotspots.find((h) => h.id === selection.id);
    if (item)
      map.flyTo({
        center: item.coord,
        zoom: 15.4,
        pitch: 62,
        bearing: map.getBearing() + 12,
        duration: 1800,
        padding: { right: window.innerWidth > 900 ? 360 : 0 },
      });
  }, [selection, map]); // eslint-disable-line react-hooks/exhaustive-deps

  // switching city: back to the 5-year view of that city
  useEffect(() => {
    setEventIdx(-1);
    setSelection(null);
    setPlaying(false);
    map?.flyTo({
      center: view.center,
      zoom: view.zoom,
      pitch: view.pitch,
      bearing: view.bearing,
      duration: 2400,
    });
  }, [region]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    if (summary && params.get("city") === region && params.get("storm")) {
      setEventIdx(summary.events.findIndex((item) => item.id === params.get("storm")));
    }
  }, [summary, region]);

  const factor = ev ? (ev.level[hour] ?? 0) : 1;
  const png = summary ? data.base + (ev ? ev.png : summary.max5y.png) : null;

  usePlaceMap(map, { cityId: region, route: "map", flood: { eventId: ev?.id || null } });

  const damLevel = dam ? levelOn(ev ? ev.start : null) : null;
  const periodLabel = ev ? `storm of ${fmtDay(ev.start)}` : "highest in 5 years";
  const runSim = () => {
    if (!dam || !damLevel) return;
    setSimStats(null);
    setSimPaused(false);
    setSimActive(true);
    setPlaying(false);
    startSim({ level: damLevel.level_m, mode: damMode, speed: simSpeed });
    map?.flyTo({
      center: [23.088, 42.568],
      zoom: 12.2,
      pitch: 56,
      bearing: -48,
      duration: 2600,
      padding: { right: window.innerWidth > 900 ? 360 : 0, bottom: 170, top: 60 },
    });
  };
  const endSim = () => {
    stopSim();
    setSimActive(false);
    setSimStats(null);
  };
  const damSlot =
    dam && damLevel ? (
      <DamPanel
        dam={dam}
        level={damLevel}
        periodLabel={periodLabel}
        mode={damMode}
        setMode={setDamMode}
        onSimulate={runSim}
        simActive={simActive}
        close={() => setSelection(null)}
      />
    ) : null;

  return (
    <div className="map-page">
      <FloodMap
        summary={summary}
        hotspots={hotspots}
        png={png}
        factor={factor}
        layers={layers}
        selectedId={selection?.id}
        onSelect={setSelection}
        onReady={setMap}
        base={data.base}
        dam={dam}
        damFill={damLevel?.fill_pct}
        damActive={simActive}
      />
      <MapTopBar
        hotspots={hotspots}
        onSearchPick={(id) => setSelection({ kind: "hotspot", id })}
        toggleDock={() => setDockOpen((o) => !o)}
        toggleLens={() => setLensOpen((o) => !o)}
        damReady={!!dam}
        onDam={() => {
          setSelection({ kind: "dam", id: "dam" });
          setLensOpen(true);
        }}
        region={region}
        setRegion={setRegion}
        onNavigate={onNavigate}
      />
      {summary ? (
        <>
          <StormDock
            summary={summary}
            eventIdx={eventIdx}
            setEventIdx={setEventIdx}
            layers={layers}
            setLayers={setLayers}
            open={dockOpen}
            close={() => setDockOpen(false)}
          />
          <RiskPanel
            summary={summary}
            hotspots={hotspots}
            eventIdx={eventIdx}
            selection={selection}
            setSelection={setSelection}
            open={lensOpen}
            setOpen={setLensOpen}
            damSlot={damSlot}
            cityLabel={view.label}
          />
          <CameraControls map={map} view={view} />
          {selection?.kind === "hotspot" && (
            <button
              className="ghost-btn glass"
              style={{ position: "absolute", bottom: 175, left: 24, zIndex: 10 }}
              onClick={() => onDemoIncident(hotspots.find((h) => h.id === selection.id))}
            >
              Create demo report at selected hotspot → Operations
            </button>
          )}
          {simActive && dam ? (
            <DamHud
              stats={simStats}
              dam={dam}
              speed={simSpeed}
              setSpeed={setSimSpeedState}
              paused={simPaused}
              setPaused={setSimPaused}
              onStop={endSim}
            />
          ) : ev ? (
            <EventTimeline
              ev={ev}
              hour={hour}
              setHour={setHour}
              playing={playing}
              setPlaying={setPlaying}
            />
          ) : (
            <RecordTimeline summary={summary} onPick={setEventIdx} />
          )}
        </>
      ) : (
        <DataState loading={data.loading} error={data.error} />
      )}
    </div>
  );
}

function RegisterPage({ data, onNavigate }) {
  const { summary, hotspots } = data;
  const [filter, setFilter] = useState("all");
  if (!summary)
    return (
      <div className="page">
        <ModuleTabs module="flood" route="register" onNavigate={onNavigate} />
        <DataState loading={data.loading} error={data.error} />
      </div>
    );
  const rows = hotspots.filter((h) => filter === "all" || riskLevel(h.score) === filter);
  const levels = ["critical", "high", "moderate", "low"].filter((l) =>
    hotspots.some((h) => riskLevel(h.score) === l),
  );
  return (
    <div className="page">
      <ModuleTabs module="flood" route="register" onNavigate={onNavigate} />
      <header className="page-head">
        <span className="eyebrow">
          {REGIONS[data.region].label} · {fmtDay(summary.period.start)} –{" "}
          {fmtDay(summary.period.end)}
        </span>
        <h1>Risk register</h1>
        <p>
          Built-up places where the model, driven by {summary.rain.events_confirmed} real storms
          from NASA satellite rainfall, puts at least 30 cm of water. Ranked by depth, how often it
          happens and how much built-up land is hit.
        </p>
      </header>
      <div className="page-kpis">
        <Kpi label="Problem spots" value={hotspots.length} />
        <Kpi
          label="Storms analysed"
          value={summary.rain.events_confirmed}
          note={`of ${summary.rain.events_found} found`}
        />
        <Kpi label="Max flooded area" value={summary.max5y.flooded_km2} unit="km²" />
        <Kpi label="Built-up hit (max)" value={ha(summary.max5y.built_flooded_km2)} unit="ha" />
      </div>
      <div className="filters">
        {["all", ...levels].map((f) => (
          <button key={f} className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>
            {f === "all" ? "All levels" : RISK[f].label}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="reg-table">
          <thead>
            <tr>
              <th>Location</th>
              <th>Risk</th>
              <th>Cause</th>
              <th className="num">Max depth</th>
              <th className="num">Flooded</th>
              <th className="num">Above flood level</th>
              <th className="num">Built-up hit</th>
              <th>Worst storm</th>
              <th>Suggested action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id}>
                <td>
                  <strong>{h.name}</strong>
                  <small>
                    {h.id} · {h.district}
                  </small>
                </td>
                <td>
                  <RiskBadge score={h.score} />
                  <span className="score-bar">
                    <i style={{ width: `${h.score}%` }} />
                  </span>
                </td>
                <td>{CAUSE[h.cause]}</td>
                <td className="num mono">{h.depth.toFixed(2)} m</td>
                <td className="num mono">
                  {h.events} / {h.events_total}
                </td>
                <td className="num mono">~{h.duration_h} h</td>
                <td className="num mono">{(h.built_m2 / 1e4).toFixed(1)} ha</td>
                <td className="mono">{fmtDay(h.worst_event)}</td>
                <td className="fix-cell">{h.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="foot-note">
        <Info size={13} /> Screening model at 28 m resolution. Not an official flood map; channels,
        culverts and sewers are not surveyed.
      </p>
    </div>
  );
}

function SourcesPage({ data, onNavigate }) {
  const { summary } = data;
  if (!summary)
    return (
      <div className="page">
        <ModuleTabs module="flood" route="sources" onNavigate={onNavigate} />
        <DataState loading={data.loading} error={data.error} />
      </div>
    );
  const L = summary.lidar,
    Rn = summary.rain;
  const sources = [
    {
      kind: "Lidar",
      name: "ICESat-2 (ATL03 → ATL08 ground)",
      agency: "NASA · via SlideRule",
      status: "live",
      role: `${L.segments_used.toLocaleString("en")} ground segments ${L.first} – ${L.last}. Terrain error ${L.rmse_before_m} → ${L.rmse_after_m} m after correction.`,
      res: "40 m segments",
      cadence: "91-day repeat",
    },
    {
      kind: "Terrain",
      name: "SRTM 1″",
      agency: "NASA / NGA · AWS Terrain Tiles",
      status: "live",
      role: `${summary.grid.rows}×${summary.grid.cols} cells, ${summary.dem.min_m}–${summary.dem.max_m} m. Roof bias ${L.built_bias_m} m, canopy bias ${L.tree_bias_m} m removed.`,
      res: `${summary.grid.cell_m} m`,
      cadence: "Static",
    },
    {
      kind: "Precipitation",
      name: "GPM IMERG",
      agency: "NASA / JAXA · via NASA POWER",
      status: "live",
      role: `Daily satellite rain, ${Rn.total_mm.toLocaleString("en")} mm in 5 years (${Rn.annual_mean_mm} mm/yr). Rain vs snow from IMERG liquid probability.`,
      res: "0.1°",
      cadence: "Daily",
    },
    {
      kind: "Reanalysis",
      name: "MERRA-2",
      agency: "NASA GMAO · via NASA POWER",
      status: "live",
      role: `${Rn.hours.toLocaleString("en")} hours: hourly rain pattern, surface soil wetness, temperature.`,
      res: "0.5° × 0.625°",
      cadence: "Hourly",
    },
    {
      kind: "Validation",
      name: "ERA5",
      agency: "ECMWF · via Open-Meteo",
      status: "live",
      role: `Independent check: ${Rn.events_confirmed} of ${Rn.events_found} storms confirmed.`,
      res: "0.25°",
      cadence: "Hourly",
    },
    {
      kind: "Land cover",
      name: "WorldCover 2021",
      agency: "ESA · Sentinel-1/2",
      status: "live",
      role: `Built-up, vegetation and water at 10 m → runoff curve numbers. ${Math.round(summary.landcover.built_share * 100)}% of the area is built-up.`,
      res: "10 m",
      cadence: "2021",
    },
    {
      kind: "Reservoir",
      name: "Sentinel-2 L2A · Studena",
      agency: "ESA Copernicus · AWS Open Data",
      status: "live",
      role: "Water surface of the Studena reservoir on every clear day 2022–2026 (NDWI), converted to volume and level.",
      res: "10 m",
      cadence: "~5 days",
    },
    {
      kind: "Official",
      name: "МОСВ monthly bulletins",
      agency: "Ministry of Environment and Water",
      status: "live",
      role: "Official Studena volumes used to calibrate the satellite level (error ≈1.2 Mm³).",
      res: "Reservoir",
      cadence: "Monthly",
    },
    {
      kind: "Soil",
      name: "SMAP L4",
      agency: "NASA",
      status: "login",
      role: "Finer soil moisture (9 km, 3-hourly). Needs a free NASA Earthdata login.",
      res: "9 km",
      cadence: "3 h",
    },
    {
      kind: "Precipitation",
      name: "GPM IMERG half-hourly",
      agency: "NASA",
      status: "login",
      role: "Real 30-min storm intensities instead of daily totals. Needs Earthdata login.",
      res: "0.1°",
      cadence: "30 min",
    },
  ];
  const statusLabel = { live: "Connected", login: "Needs login" };
  return (
    <div className="page">
      <ModuleTabs module="flood" route="sources" onNavigate={onNavigate} />
      <header className="page-head">
        <span className="eyebrow">From orbit to street</span>
        <h1>Data & model</h1>
        <p>
          Every number on the map comes from this chain: NASA satellite rain and lidar, terrain and
          land cover, run through a transparent flood screening model for{" "}
          {REGIONS[data.region].label}. Generated {fmtDay(summary.generated)}.
        </p>
      </header>
      <ol className="pipeline">
        {PIPELINE.map((p) => (
          <li key={p.step}>
            <span className="mono step">{p.step}</span>
            <h3>{p.title}</h3>
            <p>{p.text}</p>
          </li>
        ))}
      </ol>
      <div className="list-head wide">
        <h4>Inputs</h4>
        <span>
          {sources.filter((s) => s.status === "live").length} connected · period{" "}
          {summary.period.start} → {summary.period.end}
        </span>
      </div>
      <div className="source-grid">
        {sources.map((d) => (
          <article key={d.name} className="source-card">
            <div className="source-top">
              <span className="source-kind">{d.kind}</span>
              <span className={`st st-${d.status === "live" ? "live" : "research"}`}>
                {statusLabel[d.status]}
              </span>
            </div>
            <h3>{d.name}</h3>
            <span className="source-agency">{d.agency}</span>
            <p>{d.role}</p>
            <div className="source-meta">
              <span>
                <b>Resolution</b>
                {d.res}
              </span>
              <span>
                <b>Cadence</b>
                {d.cadence}
              </span>
            </div>
          </article>
        ))}
      </div>
      <div className="list-head wide">
        <h4>Limits — read before using</h4>
        <span>screening, not engineering design</span>
      </div>
      <ul className="limits">
        <li>
          Terrain is 28 m: underpasses, curbs and culverts narrower than that are not visible to the
          model.
        </li>
        <li>
          Storm-sewer capacity is assumed ({summary.model.sewer_mm_h} mm/h over built-up catchments,{" "}
          {summary.model.ditch_mm_h} mm/h elsewhere); the city's real network is not public.
        </li>
        <li>
          Rain intensity within a day comes from MERRA-2's hourly pattern, so short cloudbursts are
          smoothed and urban ponding is underestimated.
        </li>
        <li>
          River channels are treated as natural; concrete channels of the Vladayska and Perlovska
          carry more than the model assumes.
        </li>
        <li>
          Low points are kept only if they persist in ≥
          {Math.round(summary.model.depression_prob * 100)}% of {summary.model.realisations} terrain
          realisations with ICESat-2-measured error ({L.rmse_after_m} m).
        </li>
      </ul>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      return window.localStorage.getItem("floodnerve-theme") === "light" ? "light" : "dark";
    } catch (error) {
      console.warn("Could not load the saved theme preference.", error);
      return "dark";
    }
  });
  const [page, setPage] = useState(() => {
    const initialRoute = window.location.hash.slice(1).split("?")[0];
    if (["l-overview", "l-devices", "l-flood"].includes(initialRoute)) {
      return "operations";
    }
    if (initialRoute === "l-fog") return "fog-map";
    return initialRoute || "operations";
  }); // e.g. #heat-map
  const [region, setRegion] = useState(() => {
    const city = readSelection(window.location.hash)?.cityId;
    return Object.hasOwn(REGIONS, city) ? city : "sofia";
  });
  const sharedCityPending = useRef(readSelection(window.location.hash)?.cityId);
  const [railExpanded, setRailExpanded] = useState(false);
  const operations = useOperations();
  const operationalPages = ["operations", "l-incidents", "ops-parking", "l-alert"];
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("floodnerve-theme", theme);
    } catch (error) {
      console.warn("Could not save the theme preference.", error);
    }
  }, [theme]);
  useEffect(() => {
    const shared = sharedCityPending.current;
    if (Object.hasOwn(REGIONS, shared) && shared !== operations.city.id) {
      const city = REGIONS[shared];
      operations.selectCity({
        id: shared,
        label: city.label,
        country: city.country,
        latitude: city.center[1],
        longitude: city.center[0],
      });
      return;
    }
    sharedCityPending.current = null;
    if (["sofia", "pernik"].includes(operations.city.id)) setRegion(operations.city.id);
  }, [operations.city.id]);
  const changeRegion = (id) => {
    setRegion(id);
    const c = REGIONS[id];
    operations.selectCity({
      id,
      label: c.label,
      country: c.country,
      latitude: c.center[1],
      longitude: c.center[0],
    });
  };
  const navigateOperations = (id) => setPage(id === "l-mobility" ? "ops-parking" : id);
  const data = useFloodData(region);
  return (
    <PlaceProvider>
      <div className={`shell ${railExpanded ? "rail-expanded" : ""}`}>
        <Rail
          page={page}
          setPage={setPage}
          expanded={railExpanded}
          setExpanded={setRailExpanded}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        />
        <main className={`main main-${page}`}>
          {operationalPages.includes(page) && (
            <OperationsPage
              key={page}
              op={operations}
              page={page === "ops-parking" ? "l-mobility" : page}
              onNavigate={navigateOperations}
            />
          )}
          {page === "map" && (
            <MapPage
              data={data}
              region={region}
              setRegion={changeRegion}
              onNavigate={setPage}
              onDemoIncident={(h) => {
                if (!h) return;
                const c = REGIONS[region];
                const city = {
                  id: region,
                  label: c.label,
                  country: c.country,
                  latitude: c.center[1],
                  longitude: c.center[0],
                };
                operations.selectCity(city);
                operations.scenario(
                  "flood",
                  { name: h.name, latitude: h.coord[1], longitude: h.coord[0], historical: true },
                  city,
                );
                setPage("l-incidents");
              }}
            />
          )}
          {page === "register" && <RegisterPage data={data} onNavigate={setPage} />}
          {page === "sources" && <SourcesPage data={data} onNavigate={setPage} />}
          {page === "l-heat" && <HeatPage onNavigate={setPage} />}
          {page === "l-mobility" && <MobilityPage />}
          {page.startsWith("fog-") && <FogNerve page={page} onNavigate={setPage} />}
          {page.startsWith("heat-") && <HeatNerve page={page} onNavigate={setPage} />}
          {page !== "l-heat" &&
            page !== "l-flood" &&
            page !== "l-fog" &&
            page !== "l-mobility" &&
            page.startsWith("l-") && <LegacyApp page={page.slice(2)} onNavigateRoute={setPage} />}
          <PlaceInspector />
        </main>
      </div>
    </PlaceProvider>
  );
}
