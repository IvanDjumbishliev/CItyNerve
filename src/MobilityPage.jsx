import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { getMapStyle, applyMapTheme } from "./FloodMap.jsx";
import { PARKING_CITIES } from "../shared/parkingCities.js";
import useAppTheme from "./useAppTheme.js";
export default function MobilityPage() {
  const theme = useAppTheme();
  const [city, setCity] = useState("sofia"),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("free"),
    [selected, setSelected] = useState(null),
    [refresh, setRefresh] = useState(0);
  const [position, setPosition] = useState(null),
    [locationError, setLocationError] = useState("");
  const host = useRef(null),
    map = useRef(null),
    markers = useRef([]);
  useEffect(() => {
    const view = new maplibregl.Map({
      container: host.current,
      style: getMapStyle(theme),
      center: [23.33, 42.69],
      zoom: 12,
      pitch: 0,
    });
    map.current = view;
    view.addControl(new maplibregl.NavigationControl());
    return () => {
      markers.current.forEach((m) => m.remove());
      view.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (map.current) applyMapTheme(map.current, theme);
  }, [theme]);
  useEffect(() => {
    setData(null);
    setSelected(null);
    setQuery("");
    setSort("free");
    setError("");
  }, [city]);
  useEffect(() => {
    let stopped = false,
      controller;
    async function load() {
      if (document.hidden) return;
      controller?.abort();
      const active = new AbortController();
      controller = active;
      try {
        const r = await fetch("/api/parking/" + city, { signal: active.signal });
        if (!r.ok) throw Error();
        const result = await r.json();
        if (!stopped) {
          setData(result);
          setError("");
        }
      } catch {
        if (!stopped && !active.signal.aborted)
          setError("Refresh failed. Displaying the last available readings when available.");
      }
    }
    load();
    const id = setInterval(load, 60000);
    document.addEventListener("visibilitychange", load);
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", load);
    };
  }, [city, refresh]);
  useEffect(() => {
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    if (!data || !map.current) return;
    markers.current = data.facilities.map((f) => {
      const el = document.createElement("button");
      el.textContent = String(f.free);
      el.className = "parking-pin";
      el.title = f.name + " · " + f.free + " available";
      el.onclick = () => setSelected(f.id);
      const age = f.measuredAt ? Date.now() - Date.parse(f.measuredAt) : null;
      el.style.background =
        error ||
        data.stale ||
        f.status === "closed" ||
        (age !== null && (!Number.isFinite(age) || age < 0 || age > 300000))
          ? "#666"
          : f.free === 0
            ? "#b03e3e"
            : f.capacity && f.free / f.capacity < 0.1
              ? "#a06b22"
              : "#23785b";
      return new maplibregl.Marker({ element: el }).setLngLat([f.lon, f.lat]).addTo(map.current);
    });
  }, [data, error]);
  const rows = (data?.facilities || [])
    .filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === "nearest" && position
        ? distance(a) - distance(b)
        : sort === "busy"
          ? (b.capacity > 0 ? 1 - b.free / b.capacity : -1) -
            (a.capacity > 0 ? 1 - a.free / a.capacity : -1)
          : b.free - a.free,
    );
  const facility = data?.facilities.find((f) => f.id === selected);
  function distance(f) {
    return (
      6371 *
      2 *
      Math.asin(
        Math.min(
          1,
          Math.sqrt(
            Math.sin(((f.lat - position[1]) * Math.PI) / 360) ** 2 +
              Math.cos((position[1] * Math.PI) / 180) *
                Math.cos((f.lat * Math.PI) / 180) *
                Math.sin(((f.lon - position[0]) * Math.PI) / 360) ** 2,
          ),
        ),
      )
    );
  }
  function nearest() {
    if (!navigator.geolocation) {
      setLocationError("Location unavailable.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition([p.coords.longitude, p.coords.latitude]);
        setSort("nearest");
        setLocationError("");
      },
      () => setLocationError("Location unavailable. Choose another sorting option."),
      { timeout: 10000 },
    );
  }
  function choose(f) {
    setSelected(f.id);
    map.current?.easeTo({ center: [f.lon, f.lat], zoom: 15 });
  }
  return (
    <div className="sun-page">
      <div className="sun-map" ref={host} aria-label="Live parking map" />
      <header className="sun-title glass">
        <span className="eyebrow">Mobility</span>
        <h1>Find a space</h1>
        <label className="sun-town">
          City
          <select
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              map.current?.jumpTo({ center: PARKING_CITIES[e.target.value].center, zoom: 12 });
            }}
          >
            {Object.entries(PARKING_CITIES).map(([id, c]) => (
              <option key={id} value={id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p>Monitored facilities · {data?.facilities.length || 0} locations</p>
      </header>
      <aside className="sun-inspector glass">
        <input
          aria-label="Search parking"
          placeholder="Search parking"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="sun-locations">
          <button onClick={() => setSort("free")}>Most available</button>
          {data?.facilities.some((f) => f.capacity > 0) && (
            <button onClick={() => setSort("busy")}>Nearly full</button>
          )}
          <button onClick={nearest}>Nearest</button>
          <button onClick={() => setRefresh((n) => n + 1)}>Refresh</button>
        </div>
        {locationError && <p role="alert">{locationError}</p>}
        <p role="status">
          {error ||
            (!data
              ? "Loading availability…"
              : data.stale
                ? "Source unavailable · saved readings"
                : "Fetched " + new Date(data.fetchedAt).toLocaleTimeString())}
        </p>
        {rows.map((f) => (
          <button
            className="parking-row"
            aria-pressed={f.id === selected}
            key={f.id}
            onClick={() => choose(f)}
          >
            <span>{f.name}</span>
            <b>
              {f.free} free
              {position && sort === "nearest"
                ? " · " + distance(f).toFixed(1) + " km straight-line"
                : ""}
            </b>
          </button>
        ))}
        {data && !rows.length && <p>No matching facilities.</p>}
        {facility && (
          <section>
            <h2>{facility.name}</h2>
            <strong className="sun-number">{facility.free}</strong>
            <p>Facility status · {facility.status}</p>
            <p>
              Reported available spaces
              {facility.capacity !== null ? " of " + facility.capacity : ""}
            </p>
            <p>
              {facility.measuredAt
                ? "Measured " + new Date(facility.measuredAt).toLocaleString()
                : "Measurement time unavailable from provider."}
            </p>
            <a
              target="_blank"
              rel="noreferrer"
              href={
                "https://www.google.com/maps/dir/?api=1&destination=" +
                facility.lat +
                "," +
                facility.lon
              }
            >
              Directions to facility
            </a>
          </section>
        )}
        <p>Counts can change before arrival. Gray markers indicate old or uncertain readings.</p>
        <a href={data?.source || "#"} target="_blank" rel="noreferrer">
          {data?.attribution ? "Source · " + data.attribution : "Parking provider"}
        </a>
      </aside>
    </div>
  );
}
