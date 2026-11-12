import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { STYLE } from "./FloodMap.jsx";
import SatelliteHeat from "./heat/SatelliteHeat.jsx";
import { buildingShadows, sunPosition, inShade, inRing } from "./heat/shadows.js";

import { HEAT_TOWNS, boundary, coverageOf, loadNeighborhood } from "./heat/towns.js";
import ModuleTabs from "./ModuleTabs.jsx";
import { Play, Pause, MapPin, Maximize2, Building2, Loader2, ChevronDown, X } from "lucide-react";
const empty = { type: "FeatureCollection", features: [] };
const timeLabel = (hour) =>
  Math.floor(hour).toString().padStart(2, "0") +
  ":" +
  Math.round((hour % 1) * 60)
    .toString()
    .padStart(2, "0");

export default function HeatPage({ onNavigate }) {
  const [townId, setTownId] = useState("sofia");
  const town = HEAT_TOWNS.find((t) => t.id === townId);
  return <TownHeat key={townId} town={town} townId={townId} setTownId={setTownId} onNavigate={onNavigate} />;
}
function TownHeat({ town, townId, setTownId, onNavigate }) {
  const [bounds, setBounds] = useState(null),
    [loading, setLoading] = useState(false),
    [outside, setOutside] = useState(false);
  const ring = useMemo(() => (bounds ? boundary(bounds) : []), [bounds]);
  const ringRef = useRef(ring);
  ringRef.current = ring;
  const request = useRef(null),
    requestVersion = useRef(0);
  async function loadHere() {
    const view = map.current;
    if (!view) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++requestVersion.current;
    setLoading(true);
    setPlaying(false);
    setError("");
    try {
      const center = view.getCenter();
      const result = await loadNeighborhood([center.lng, center.lat], controller.signal);
      if (version !== requestVersion.current) return;
      setBuildings(result.buildings);
      setBounds(result.bounds);
      setPoint(null);
      setOutside(false);
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }
  useEffect(() => () => request.current?.abort(), []);
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
  const solarTown = useMemo(
    () =>
      bounds
        ? { ...town, center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] }
        : town,
    [bounds, town],
  );
  const shadows = useMemo(
    () => (buildings ? buildingShadows(buildings, day, hour, solarTown) : empty),
    [buildings, day, hour, solarTown],
  );
  const sun = sunPosition(day, hour, solarTown);
  const samples = useMemo(() => {
    if (!buildings || !point) return [];
    return Array.from({ length: 28 }, (_, i) => {
      const sampleHour = 6.25 + i * 0.5;
      const aboveHorizon = sunPosition(day, sampleHour, solarTown).altitude > 0;
      return {
        hour: sampleHour,
        daylight: aboveHorizon,
        shaded:
          !aboveHorizon || inShade(point, buildingShadows(buildings, day, sampleHour, solarTown)),
      };
    });
  }, [buildings, day, solarTown, point]);
  const exposure = samples.filter((sample) => sample.daylight && !sample.shaded).length / 2;
  const roof = point && buildings?.features.some((b) => inRing(point, b.geometry.coordinates[0]));
  useEffect(() => {
    const controller = new AbortController();
    const version = requestVersion.current;
    fetch(import.meta.env.BASE_URL + "data/" + town.id + "-shade-buildings.geojson", {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((b) => {
        if (version !== requestVersion.current) return;
        setBuildings(b);
        setBounds(coverageOf(b));
      })
      .catch(() => {
        if (!controller.signal.aborted && version === requestVersion.current)
          setError("Building data could not load. Load buildings here to retry.");
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
        center: town.center,
        zoom: 16,
        pitch: 48,
        bearing: -20,
        antialias: true,
      });
      map.current = view;
      view.addControl(new maplibregl.NavigationControl(), "bottom-right");
      view.on("load", () => {
        view.addSource("study", { type: "geojson", data: empty });
        view.addLayer(
          {
            id: "sunlit",
            type: "fill",
            source: "study",
            paint: { "fill-color": "#e8b45e", "fill-opacity": 0.16 },
          },
          "road-label",
        );
        view.addLayer({
          id: "coverage",
          type: "line",
          source: "study",
          paint: { "line-color": "#ffcf83", "line-width": 2, "line-dasharray": [3, 2] },
        });
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
        if (inRing(p, ringRef.current)) {
          setPoint(p);
          setOutside(false);
        } else {
          setOutside(true);
          setPoint(null);
        }
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
    map.current
      .getSource("study")
      .setData(
        bounds ? { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } } : empty,
      );
    map.current.getSource("shade").setData(shadows);
    map.current.getSource("local-buildings").setData(buildings || empty);
    map.current
      .getSource("point")
      .setData(
        point ? { type: "Feature", geometry: { type: "Point", coordinates: point } } : empty,
      );
  }, [ready, buildings, shadows, point, bounds, ring]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setHour((h) => (h >= 20 ? 6 : h + 0.25)), 300);
    return () => clearInterval(id);
  }, [playing]);
  const status = point
    ? roof
      ? "Building footprint"
      : sun.altitude <= 0
        ? "After sunset"
        : inShade(point, shadows)
          ? "In shade"
          : "In direct sun"
    : null;
  return (
    <div className="sun-page">
      <div
        ref={host}
        className="sun-map"
        aria-label={town.name + " 3D sunlight and building shadows"}
      />
      <header className="sun-title glass">
        <h1>Follow the shade</h1>
        <label className="sun-town">
          <span className="sr-only">Town</span>
          <select aria-label="Heat town" value={townId} onChange={(e) => setTownId(e.target.value)}>
            {HEAT_TOWNS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
      </header>
      <ModuleTabs module="heat" route="l-heat" onNavigate={onNavigate} />
      <aside className="sun-inspector glass">
        {point ? (
          <>
            <span className="sun-kicker">Street exposure</span>
            <h2>{status}</h2>
            {!roof && (
              <>
                <strong className="sun-number">
                  {exposure}
                  <small> h of sun</small>
                </strong>
                <div className="sun-strip" aria-label="Sun and shade from 06:00 to 20:00">
                  {samples.map((s) => (
                    <i
                      key={s.hour}
                      title={timeLabel(s.hour)}
                      className={s.shaded ? "is-shade" : ""}
                    />
                  ))}
                </div>
                <div className="sun-strip-axis">
                  <span>06:00</span>
                  <span>13:00</span>
                  <span>20:00</span>
                </div>
              </>
            )}
            <button className="sun-link" onClick={() => setPoint(null)}>
              Clear selection
            </button>
          </>
        ) : (
          <p className="sun-empty">
            <MapPin size={14} />{" "}
            {outside
              ? "Outside the loaded area. Load buildings here first."
              : "Tap a street inside the dashed area"}
          </p>
        )}
        <div className="sun-locations">
          <button className="sun-btn primary" disabled={loading || !ready} onClick={loadHere}>
            {loading ? (
              <>
                <Loader2 size={15} className="spin" /> Loading…
              </>
            ) : (
              <>
                <Building2 size={15} /> Load buildings here
              </>
            )}
          </button>
          <button
            className="sun-btn icon"
            title="Show loaded area"
            aria-label="Show loaded area"
            disabled={!bounds || !ready}
            onClick={() =>
              map.current?.fitBounds(
                [
                  [bounds[0], bounds[1]],
                  [bounds[2], bounds[3]],
                ],
                { padding: 70 },
              )
            }
          >
            <Maximize2 size={15} />
          </button>
        </div>
        {error && (
          <p className="sun-error" role="alert">
            {error}
          </p>
        )}
        {!buildings && !error && (
          <p className="sun-empty">
            <Loader2 size={14} className="spin" /> Loading buildings…
          </p>
        )}
        <div className="sun-foot">
          {town.id === "sofia" && (
            <button className="sun-link" onClick={() => setSatellite(!satellite)}>
              Satellite heat record
            </button>
          )}
          <details>
            <summary>About the model</summary>
            <p>
              Clear-sky sun position and flat-ground shadows from OpenStreetMap footprints. Heights
              include level-based estimates and a 9 m fallback. Courtyard holes and buildings
              represented only as OSM relations are omitted. Shade near the boundary can miss
              buildings outside the loaded area. Trees, terrain, clouds, reflections and stored heat
              require further data. Sun exposure indicates potential radiant heating.
            </p>
            <a href="https://www.openstreetmap.org/copyright">OpenStreetMap building data · ODbL</a>
          </details>
        </div>
      </aside>
      <div className="sun-time glass">
        <button
          className="sun-play"
          disabled={!ready || !buildings || loading}
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? "Pause" : "Play daylight"}
        >
          {playing ? (
            <Pause size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" />
          )}
        </button>
        <label className="sun-slider">
          <span className="sun-clock">{timeLabel(hour)}</span>
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
        <input
          className="sun-date"
          aria-label="Summer date"
          type="date"
          min="2026-06-01"
          max="2026-08-31"
          value={day}
          onChange={(e) => {
            if (e.target.value >= "2026-06-01" && e.target.value <= "2026-08-31")
              setDay(e.target.value);
          }}
        />
        <span className="sun-key">
          <i /> Sun <i /> Shade
        </span>
      </div>
      {satellite && (
        <div className="sun-satellite glass">
          <button
            className="icon-btn round sun-close"
            onClick={() => setSatellite(false)}
            aria-label="Close satellite record"
          >
            <X size={14} strokeWidth={2.6} />
          </button>
          <SatelliteHeat />
        </div>
      )}
    </div>
  );
}
