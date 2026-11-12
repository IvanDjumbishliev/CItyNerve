import React, { useState } from "react";
import {
  Activity,
  Waves,
  CloudFog,
  ThermometerSun,
  CarFront,
  Layers3,
  ArrowUpRight,
  MapPin,
  ChevronRight,
} from "lucide-react";
import { CITIES, MODULES } from "./legacyData.js";
import { HAZARD_MODULES } from "../data.js";
import ModuleTabs from "../ModuleTabs.jsx";
const ICONS = { flood: Waves, fog: CloudFog, heat: ThermometerSun, mobility: CarFront };
const MODULE_KEYS = Object.keys(ICONS);
function Tag({ children, variant = "neutral" }) {
  return <span className={`tag tag-${variant}`}>{children}</span>;
}
function StatusDot({ color = "green" }) {
  return <span className={`status-dot dot-${color}`} />;
}
function ModuleIcon({ module, size = 19 }) {
  const Icon = ICONS[module] ?? Activity;
  return (
    <span className={`module-icon mod-${module}`}>
      <Icon size={size} />
    </span>
  );
}
function Header({ city, setCityId, page, onNavigateRoute }) {
  const hazard = HAZARD_MODULES.find((module) => module.id === page);
  return (
    <header className={`topbar ${hazard ? "has-module-tabs" : ""}`}>
      <div className="breadcrumbs">
        <span>City Operations</span>
        <ChevronRight size={15} />
        <strong>
          {page === "settings" ? "Settings" : MODULES.find((module) => module.id === page)?.name}
        </strong>
      </div>
      {hazard && (
        <ModuleTabs module={hazard} route={hazard.routes.live} onNavigate={onNavigateRoute} />
      )}
      <div className="city-select">
        <MapPin size={15} />
        <select
          aria-label="Select city"
          value={city.id}
          onChange={(event) => setCityId(event.target.value)}
        >
          {CITIES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}, {item.country}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
function ModulePage({ type, city }) {
  const module = MODULES.find((m) => m.id === type);
  const Icon = ICONS[type];
  const configs = {
    flood: {
      eyebrow: "HYDROLOGICAL INTELLIGENCE",
      headline: "Flood monitoring & prevention",
      text: "Monitor forecast rainfall and local water sensors. Coordinate safe preparation of flood barriers and road advisories.",
      measure: `${city.rainfall} mm`,
      measureLabel: "Sample rainfall reading",
      capabilities: [
        "Rainfall and river risk ingestion",
        "Local water-level monitoring",
        "Barrier safety-check workflow",
        "Flood impact event generation",
      ],
      next: "Connect Open-Meteo precipitation data, then add your ESP32 water sensor and miniature barrier.",
    },
    fog: {
      eyebrow: "ROAD WEATHER INTELLIGENCE",
      headline: "Visibility monitoring & road safety",
      text: "Detect poor visibility, flag hazardous corridors, and coordinate warning signage with mobility and citizen alerts.",
      measure: `${city.visibility} m`,
      measureLabel: "Sample visibility reading",
      capabilities: [
        "Forecast visibility ingestion",
        "Low-visibility thresholds",
        "Digital road sign simulation",
        "Connected road hazard alerts",
      ],
      next: "Connect Open-Meteo visibility forecasts and add an LED warning sign.",
    },
    heat: {
      eyebrow: "CLIMATE RESILIENCE",
      headline: "Urban heat protection",
      text: "Track thermal exposure and coordinate heat-risk communication, public guidance and cooling points.",
      measure: `${city.temperature}°C`,
      measureLabel: "Sample air temperature",
      capabilities: [
        "Temperature and apparent heat",
        "Heat-risk severity rules",
        "Public heat advisories",
        "Cooling location layer",
      ],
      next: "Connect apparent temperature and forecast from Open-Meteo; add verified cooling places.",
    },
    mobility: {
      eyebrow: "SMART URBAN MOBILITY",
      headline: "Traffic, roads & parking",
      text: "Monitor parking demand, connect road closures to weather incidents, and communicate mobility disruptions.",
      measure: `${city.occupancy}%`,
      measureLabel: "Simulated parking occupancy",
      capabilities: [
        "Parking zone inventory",
        "Simulated occupancy inputs",
        "Weather-linked road closures",
        "City mobility warnings",
      ],
      next: "Add parking areas from OpenStreetMap; occupancy should remain labeled simulated unless sensor-backed.",
    },
  };
  const conf = configs[type];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MODULES / {conf.eyebrow}</div>
          <div className="module-heading">
            <ModuleIcon module={type} size={25} />
            <h1>{module.name}</h1>
            <Tag variant="blue">Framework ready</Tag>
          </div>
          <p>{conf.text}</p>
        </div>
      </div>
      <div className="module-hero">
        <div className="hero-content">
          <div className="hero-eyebrow">
            MODULE CONTROL PANEL <span>•</span> {city.label.toUpperCase()}
          </div>
          <h2>{conf.headline}</h2>
          <p>
            Connect your first real data source when you're ready. All readings currently come from
            local demo configuration.
          </p>
        </div>
        <div className="hero-orbit">
          <div className="orbit-ring orbit-a" />
          <div className="orbit-ring orbit-b" />
          <div className={`orbit-center mod-${type}`}>
            <Icon size={60} />
          </div>
          <i className="orbit-node node-one" />
          <i className="orbit-node node-two" />
          <i className="orbit-node node-three" />
        </div>
      </div>
      <div className="module-summary-grid">
        <div className="panel metric-panel">
          <span className="mini-label">CURRENT MEASUREMENT</span>
          <div className="metric-number">{conf.measure}</div>
          <p>
            {conf.measureLabel} · {city.label}
          </p>
          <Tag>Demonstration only</Tag>
        </div>
        <div className="panel metric-panel">
          <span className="mini-label">MODULE STATUS</span>
          <div className="metric-status">
            <StatusDot /> Connected
          </div>
          <p>Module UI and event definitions initialized</p>
          <Tag variant="green">Ready for integration</Tag>
        </div>
      </div>
      <div className="module-lower">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>
                <Layers3 size={18} /> Planned capabilities
              </h2>
              <p>Integration milestones for this module</p>
            </div>
          </div>
          <div className="capability-list">
            {conf.capabilities.map((x, i) => (
              <div className="capability" key={x}>
                <span className="cap-number">0{i + 1}</span>
                <span>{x}</span>
                <Tag variant="neutral">Planned</Tag>
              </div>
            ))}
          </div>
          <div className="module-next">
            <strong>
              <ArrowUpRight size={17} /> Suggested next step
            </strong>
            <p>{conf.next}</p>
          </div>
        </section>
      </div>
    </>
  );
}
function SettingsPage({ city, cityId, setCityId }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SYSTEM / SETTINGS</div>
          <h1>Workspace settings</h1>
          <p>Configuration for your CityNerve demonstration environment.</p>
        </div>
      </div>
      <section className="panel settings-panel">
        <h2>City configuration</h2>
        <p>Select which European city your demo is currently representing.</p>
        <label htmlFor="settings-city">Active city</label>
        <select id="settings-city" value={cityId} onChange={(e) => setCityId(e.target.value)}>
          {CITIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}, {c.country}
            </option>
          ))}
        </select>
        <div className="settings-line">
          <span>Region</span>
          <strong>{city.region}</strong>
        </div>
        <div className="settings-line">
          <span>Data mode</span>
          <Tag variant="amber">Simulated / sample</Tag>
        </div>
        <div className="settings-line">
          <span>Connected APIs</span>
          <strong>None yet</strong>
        </div>
        <div className="settings-line">
          <span>Environment</span>
          <strong>Hackathon development</strong>
        </div>
      </section>
    </>
  );
}
export default function LegacyApp({ page, onNavigateRoute }) {
  const [cityId, setCityId] = useState("michalovce");
  const city = CITIES.find((item) => item.id === cityId) || CITIES[0];
  return (
    <div className="legacy">
      <div className="app-shell">
        <div className="main-area">
          <Header city={city} setCityId={setCityId} page={page} onNavigateRoute={onNavigateRoute} />
          <main className="content">
            <div className="content-inner">
              {MODULE_KEYS.includes(page) ? (
                <ModulePage type={page} city={city} />
              ) : page === "settings" ? (
                <SettingsPage city={city} cityId={cityId} setCityId={setCityId} />
              ) : null}
              <footer className="app-footer">
                <span>© 2026 CityNerve</span>
              </footer>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
