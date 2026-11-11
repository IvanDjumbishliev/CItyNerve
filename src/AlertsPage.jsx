import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { BellRing, ExternalLink, MapPin, RefreshCw, TriangleAlert } from "lucide-react";
import { STYLE } from "./FloodMap.jsx";
import { ALERT_CITIES, ALERT_CATEGORIES } from "../shared/alertCities.js";
import "./alerts.css";

function dateLabel(value) {
  return value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not yet analyzed";
}

function IncidentMap({ city, incidents, selected, onSelect }) {
  const host = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const view = new maplibregl.Map({
      container: host.current,
      style: structuredClone(STYLE),
      center: ALERT_CITIES[city].center,
      zoom: 12,
    });
    map.current = view;
    const observer = new ResizeObserver(() => view.resize());
    observer.observe(host.current);
    view.addControl(new maplibregl.NavigationControl(), "bottom-right");
    view.on("error", () =>
      setError("Some map tiles could not load. Reports remain available in the list."),
    );
    view.on("idle", () => setError(""));
    return () => {
      observer.disconnect();
      markers.current.forEach((marker) => marker.remove());
      view.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    map.current?.flyTo({
      center: ALERT_CITIES[city].center,
      zoom: 12,
      duration: 700,
    });
  }, [city]);

  useEffect(() => {
    markers.current.forEach((marker) => marker.remove());
    markers.current = incidents
      .filter((incident) => incident.location)
      .map((incident) => {
        const button = document.createElement("button");
        button.className = "alert-map-pin" + (selected === incident.id ? " is-selected" : "");
        button.textContent = "!";
        button.title = `${incident.place}: ${incident.summary} (approximate location)`;
        button.setAttribute("aria-label", button.title);
        button.onclick = () => onSelect(incident.id);
        return new maplibregl.Marker({ element: button })
          .setLngLat(incident.location.coordinates)
          .addTo(map.current);
      });
  }, [incidents, selected, onSelect]);

  useEffect(() => {
    const incident = incidents.find((item) => item.id === selected);
    if (incident?.location)
      map.current?.flyTo({
        center: incident.location.coordinates,
        zoom: incident.location.radiusM >= 1000 ? 13 : 15,
        duration: 700,
      });
  }, [selected]);

  return (
    <div className="alerts-map-wrap">
      <div ref={host} className="alerts-map" />
      {error && (
        <p className="alerts-map-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

export default function AlertsPage() {
  const [city, setCity] = useState("sofia");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setData(null);
    setSelected(null);
    setCategory("all");
  }, [city]);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/alerts/${city}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Reports are unavailable. Please try again later.");
        const result = await response.json();
        setData(result);
        if (result.phase === "processing") timer = setTimeout(load, 5000);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [city, refresh]);

  const incidents = data?.incidents || [];
  const visible = incidents.filter(
    (incident) => category === "all" || incident.category === category,
  );
  const active = incidents.find((incident) => incident.id === selected);
  const mapped = incidents.filter((incident) => incident.location).length;

  return (
    <section className="alerts-page" aria-label="City incident reports">
      <aside className="alerts-sidebar">
        <header className="alerts-heading">
          <span className="alerts-eyebrow">
            <BellRing size={15} /> CITY SIGNALS
          </span>
          <h1>Know what’s happening.</h1>
          <p>Local news, turned into city reports.</p>
        </header>
        <label className="alerts-field">
          Inspect city
          <select value={city} onChange={(event) => setCity(event.target.value)}>
            {Object.entries(ALERT_CITIES).map(([id, item]) => (
              <option key={id} value={id}>
                {item.name}, {item.country}
              </option>
            ))}
          </select>
        </label>
        <div className="alerts-count">
          <strong>{incidents.length}</strong>
          <span>
            news reports
            <br />
            <small>{mapped} with approximate locations</small>
          </span>
          <button
            title="Reload saved reports. AI runs at most once per city every 12 hours."
            aria-label="Reload reports"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={17} className={loading ? "alerts-spin" : ""} />
          </button>
        </div>
        <label className="alerts-field">
          Report type
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setSelected(null);
            }}
          >
            <option value="all">All reports</option>
            {Object.entries(ALERT_CATEGORIES).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="alerts-status" role="status">
          {loading
            ? "Checking saved reports. Initial analysis may take a minute…"
            : error ||
              data?.message ||
              (data?.stale
                ? "Saved analysis is older than 12 hours."
                : "Saved results · AI analysis at most every 12 hours.")}
          <small>
            Analyzed: {dateLabel(data?.analyzedAt)}
            <br />
            Next eligible check: {dateLabel(data?.nextAnalysisAt)}
          </small>
        </div>
        <div className="alerts-list">
          {!loading && !visible.length && (
            <div className="alerts-empty">
              <TriangleAlert size={26} />
              <h2>No reports to display</h2>
              <p>
                {category === "all"
                  ? "No matching incidents were found in the available headlines. This does not confirm the city is incident-free."
                  : "Try another report type."}
              </p>
            </div>
          )}
          {visible.map((incident) => (
            <button
              className={`alert-card ${selected === incident.id ? "is-selected" : ""}`}
              key={incident.id}
              onClick={() => setSelected(incident.id)}
            >
              <span className="alert-card-meta">
                {ALERT_CATEGORIES[incident.category]} · {incident.status}
              </span>
              <strong>{incident.summary}</strong>
              <span>
                <MapPin size={12} />{" "}
                {incident.location
                  ? `${incident.place} · approximate`
                  : incident.place
                    ? `${incident.place} · not mapped`
                    : "Location not specified"}
              </span>
              <small>
                {incident.publisher} · {dateLabel(incident.publishedAt)}
              </small>
            </button>
          ))}
        </div>
        <footer className="alerts-disclaimer">
          News headlines via Google News RSS · summaries by AI. Publication time is not incident
          time. Reports may already be resolved; this is not an emergency service.
        </footer>
      </aside>
      <div className="alerts-canvas">
        <IncidentMap city={city} incidents={visible} selected={selected} onSelect={setSelected} />
        <div className="alerts-map-title">
          <MapPin size={16} />
          <strong>{ALERT_CITIES[city].name}</strong>
          <span>Approximate news locations</span>
        </div>
        {active && (
          <article className="alerts-detail">
            <button
              className="alerts-close"
              aria-label="Close report details"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <span className="alerts-eyebrow">
              {ALERT_CATEGORIES[active.category]} · {active.status}
            </span>
            <h2>{active.summary}</h2>
            <p>
              <strong>{active.location ? active.place : "No verified map location"}</strong>
              {active.location &&
                ` · ${active.location.precision}, approximately ${active.location.radiusM} m uncertainty`}
            </p>
            <blockquote>{active.title}</blockquote>
            {active.evidence && <p>Location evidence: “{active.evidence}”</p>}
            <p>
              Published {dateLabel(active.publishedAt)}
              {active.eventTime && ` · Event time in source: ${active.eventTime}`}
            </p>
            <a href={active.sourceUrl} target="_blank" rel="noopener noreferrer">
              Read original report · {active.publisher} <ExternalLink size={13} />
            </a>
            <small>
              AI summary. Named locations are geocoded using OpenStreetMap via Photon. Pins do not
              establish an exact incident address.
            </small>
          </article>
        )}
      </div>
    </section>
  );
}
