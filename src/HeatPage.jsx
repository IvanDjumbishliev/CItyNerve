import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { STYLE } from "./FloodMap.jsx";
import SatelliteHeat from "./heat/SatelliteHeat.jsx";
import { buildingShadows, sunPosition, inShade, inRing } from "./heat/shadows.js";

const bounds = [23.329, 42.685, 23.347, 42.699];
const empty = { type: "FeatureCollection", features: [] };
const ring = [
  [bounds[0], bounds[1]],
  [bounds[2], bounds[1]],
  [bounds[2], bounds[3]],
  [bounds[0], bounds[3]],
  [bounds[0], bounds[1]],
];
const locations = [
  ["Vasil Levski stadium", 23.335, 42.687],
  ["Eagles’ Bridge", 23.3376, 42.6905],
  ["Sofia University", 23.335, 42.694],
  ["Borisova Garden edge", 23.342, 42.688],
];
const timeLabel = (hour) =>
  Math.floor(hour).toString().padStart(2, "0") +
  ":" +
  Math.round((hour % 1) * 60)
    .toString()
    .padStart(2, "0");

export default function HeatPage() {
  const host = useRef(null),
    map = useRef(null);
  const [buildings, setBuildings] = useState(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [day, setDay] = useState("2026-07-15"),
    [hour, setHour] = useState(15),
    [point, setPoint] = useState(null);
  const [playing, setPlaying] = useState(false),
    [satellite, setSatellite] = useState(false);
  const shadows = useMemo(
    () => (buildings ? buildingShadows(buildings, day, hour) : empty),
    [buildings, day, hour],
  );
  const sun = sunPosition(day, hour);
  const samples = useMemo(
    () =>
      buildings
        ? Array.from({ length: 28 }, (_, i) => ({
            hour: 6.25 + i * 0.5,
            shadow: buildingShadows(buildings, day, 6.25 + i * 0.5),
          }))
        : [],
    [buildings, day],
  );
  const daylight = samples.filter((sample) => sunPosition(day, sample.hour).altitude > 0);
  const exposure = point
    ? daylight.filter((sample) => !inShade(point, sample.shadow)).length / 2
    : 0;
  const roof = point && buildings?.features.some((b) => inRing(point, b.geometry.coordinates[0]));
  useEffect(() => {
    const controller = new AbortController();
    fetch(import.meta.env.BASE_URL + "data/sofia-shade-buildings.geojson", {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setBuildings)
      .catch(() => {
        if (!controller.signal.aborted) setError("Building data could not load. Reload to retry.");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    let view;
    try {
      const style = structuredClone(STYLE);
      style.layers = style.layers.filter((l) => l.id !== "buildings-3d");
      view = new maplibregl.Map({
        container: host.current,
        style,
        center: [23.3376, 42.6905],
        zoom: 16,
        pitch: 48,
        bearing: -20,
        antialias: true,
      });
      map.current = view;
      view.addControl(new maplibregl.NavigationControl(), "bottom-right");
      view.on("load", () => {
        view.addSource("study", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } },
        });
        view.addLayer(
          {
            id: "sunlit",
            type: "fill",
            source: "study",
            paint: { "fill-color": "#e8b45e", "fill-opacity": 0.16 },
          },
          "road-label",
        );
        view.addSource("shade", { type: "geojson", data: empty });
        view.addLayer(
          {
            id: "shade",
            type: "fill",
            source: "shade",
            paint: { "fill-color": "#666666", "fill-opacity": 0.72 },
          },
          "road-label",
        );
        view.addSource("local-buildings", { type: "geojson", data: empty });
        view.addLayer({
          id: "local-buildings",
          type: "fill-extrusion",
          source: "local-buildings",
          paint: {
            "fill-extrusion-height": ["get", "heightM"],
            "fill-extrusion-color": "#bdac93",
            "fill-extrusion-opacity": 1,
          },
        });
        view.addSource("point", { type: "geojson", data: empty });
        view.addLayer({
          id: "point",
          type: "circle",
          source: "point",
          paint: {
            "circle-radius": 7,
            "circle-color": "#fff",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffad57",
          },
        });
        setReady(true);
      });
      view.on("click", (e) => {
        const p = [e.lngLat.lng, e.lngLat.lat];
        if (inRing(p, ring)) setPoint(p);
      });
    } catch {
      setError("3D map unavailable. Try a browser with WebGL enabled.");
    }
    return () => {
      view?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    map.current.getSource("shade").setData(shadows);
    map.current.getSource("local-buildings").setData(buildings || empty);
    map.current
      .getSource("point")
      .setData(
        point ? { type: "Feature", geometry: { type: "Point", coordinates: point } } : empty,
      );
  }, [ready, buildings, shadows, point]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setHour((h) => (h >= 20 ? 6 : h + 0.25)), 300);
    return () => clearInterval(id);
  }, [playing]);
  return (
    <div className="sun-page">
      <div
        ref={host}
        className="sun-map"
        aria-label="Central Sofia 3D sunlight and building shadows"
      />
      <header className="sun-title glass">
        <span className="eyebrow">Heat · Central Sofia</span>
        <h1>Follow the shade</h1>
        <p>See where buildings shelter the street as the sun moves.</p>
      </header>
      <aside className="sun-inspector glass">
        <span className="eyebrow">Street exposure</span>
        <h2>
          {point
            ? roof
              ? "Building footprint"
              : sun.altitude <= 0
                ? "After sunset"
                : inShade(point, shadows)
                  ? "In building shade"
                  : "In direct sunlight"
            : "Pick a place on the map"}
        </h2>
        {point ? (
          <>
            <p>
              {point[1].toFixed(5)}° N · {point[0].toFixed(5)}° E
            </p>
            {!roof && (
              <>
                <strong className="sun-number">≈{exposure} h</strong>
                <p>Direct sun across the 06:00–20:00 window, sampled every 30 minutes.</p>
                <div className="sun-strip">
                  {samples.map((s) => (
                    <i
                      key={s.hour}
                      title={timeLabel(s.hour)}
                      style={{ background: inShade(point, s.shadow) ? "#666666" : "#edb65f" }}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <p>
            Gold shows exposed ground. Gray shows projected building shade. Click a street or square
            inside the study area.
          </p>
        )}
        <div className="sun-locations">
          {locations.map(([name, lon, lat]) => (
            <button
              key={name}
              onClick={() => {
                setPoint([lon, lat]);
                map.current?.easeTo({ center: [lon, lat], zoom: 17, pitch: 50 });
              }}
            >
              {name} ↗
            </button>
          ))}
        </div>
        <details>
          <summary>What the model includes</summary>
          <p>
            Clear-sky sun position and flat-ground shadows from OpenStreetMap footprints. Heights
            include level-based estimates and a 9 m fallback. Trees, terrain, clouds, reflections
            and stored heat require further data. Sun exposure indicates potential radiant heating.
          </p>
          <a href="https://www.openstreetmap.org/copyright">OpenStreetMap building data · ODbL</a>
        </details>
        <button className="sun-context" onClick={() => setSatellite(!satellite)}>
          {satellite ? "Close satellite context" : "View satellite heat record"}
        </button>
        {error && <p role="alert">{error}</p>}
        {!buildings && !error && <p>Loading building geometry…</p>}
      </aside>
      <div className="sun-time glass">
        <button disabled={!ready || !buildings} onClick={() => setPlaying(!playing)}>
          {playing ? "Pause" : "Play daylight"}
        </button>
        <label>
          Summer date
          <input
            type="date"
            min="2026-06-01"
            max="2026-08-31"
            value={day}
            onChange={(e) => {
              if (e.target.value >= "2026-06-01" && e.target.value <= "2026-08-31")
                setDay(e.target.value);
            }}
          />
        </label>
        <label className="sun-slider">
          <span>
            <b>{timeLabel(hour)}</b> · Sofia time
          </span>
          <input
            aria-label="Time of day"
            type="range"
            min="6"
            max="20"
            step=".25"
            value={hour}
            onChange={(e) => {
              setPlaying(false);
              setHour(Number(e.target.value));
            }}
          />
        </label>
        <span className="sun-key">
          <i /> Direct sun <i /> Building shade
        </span>
      </div>
      {satellite && (
        <div className="sun-satellite glass">
          <button onClick={() => setSatellite(false)}>Close satellite record</button>
          <SatelliteHeat />
        </div>
      )}
    </div>
  );
}
