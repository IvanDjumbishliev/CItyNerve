import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import data from "../../public/data/sofia-heat.json";

const radius = 6371007.181;
const degrees = 180 / Math.PI;
function corner(col, row) {
  const lat = (data.y + (data.rows - row) * data.step) / radius;
  return [((data.x + col * data.step) / radius / Math.cos(lat)) * degrees, lat * degrees];
}
const cells = data.cells.map(([id, mean, peak, count, hot]) => {
  const col = id % data.cols,
    row = Math.floor(id / data.cols);
  const ring = [
    [col, row],
    [col + 1, row],
    [col + 1, row + 1],
    [col, row + 1],
    [col, row],
  ].map(([x, y]) => corner(x, y));
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: { id, mean, peak, count, hot, share: Math.round((100 * hot) / count) },
    center: corner(col + 0.5, row + 0.5),
  };
});
const places = [
  ["Serdika", 23.322, 42.698],
  ["Sofia Airport", 23.411, 42.688],
  ["Studentski Grad", 23.345, 42.649],
  ["Lyulin Centre", 23.255, 42.717],
  ["South Park", 23.307, 42.658],
];
function placeCell([, lon, lat]) {
  const col = Math.floor(((lon / degrees) * radius * Math.cos(lat / degrees) - data.x) / data.step);
  const row = data.rows - 1 - Math.floor(((lat / degrees) * radius - data.y) / data.step);
  return cells.find((c) => c.properties.id === row * data.cols + col);
}
const colors = ["#ffdf91", "#ffac56", "#ed6747", "#a32b51", "#5c1749"];
const modes = {
  mean: { label: "Average surface heat", steps: [25, 30, 35, 40, 45], unit: "°C" },
  share: { label: "Frequency above threshold", steps: [0, 25, 50, 75, 100], unit: "%" },
};
function paint(mode) {
  return [
    "interpolate",
    ["linear"],
    ["get", mode],
    ...modes[mode].steps.flatMap((n, i) => [n, colors[i]]),
  ];
}

export default function HeatPage() {
  const host = useRef(null),
    map = useRef(null);
  const [mode, setMode] = useState("mean"),
    [selected, select] = useState(
      cells.reduce((a, b) => (a.properties.mean > b.properties.mean ? a : b)),
    );
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let view;
    try {
      view = new maplibregl.Map({
        container: host.current,
        center: [23.32, 42.69],
        zoom: 10.5,
        style: {
          version: 8,
          sources: {
            streets: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
            heat: { type: "geojson", data: { type: "FeatureCollection", features: cells } },
          },
          layers: [
            { id: "streets", type: "raster", source: "streets" },
            {
              id: "heat",
              type: "fill",
              source: "heat",
              paint: { "fill-color": paint("mean"), "fill-opacity": 0.62 },
            },
            {
              id: "selection",
              type: "line",
              source: "heat",
              filter: ["==", "id", -1],
              paint: { "line-color": "#111827", "line-width": 3 },
            },
          ],
        },
      });
      map.current = view;
      view.addControl(new maplibregl.NavigationControl({ showCompass: false }));
      view.on("load", () => setReady(true));
      view.on("click", "heat", (e) => {
        const cell = cells.find((c) => c.properties.id === e.features[0].properties.id);
        if (cell) select(cell);
      });
    } catch {
      setFailed(true);
    }
    return () => {
      view?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (ready && map.current) {
      map.current.setPaintProperty("heat", "fill-color", paint(mode));
      map.current.setFilter("selection", ["==", "id", selected.properties.id]);
    }
  }, [ready, mode, selected]);
  function focus(cell) {
    select(cell);
    map.current?.easeTo({ center: cell.center, zoom: 12 });
  }
  const p = selected.properties;
  const name =
    places.find((place) => placeCell(place) === selected)?.[0] ||
    selected.center
      .slice()
      .reverse()
      .map((v) => v.toFixed(3) + "°")
      .join(", ");
  return (
    <div className="page heat-page">
      <header className="page-head">
        <span className="eyebrow">Sofia · Summer 2024</span>
        <h1>Summer heat atlas</h1>
        <p>
          Explore where roofs, roads and green spaces stayed hottest during daytime satellite
          passes. Select a cell to inspect its record.
        </p>
      </header>
      <div className="filters">
        {Object.entries(modes).map(([id, m]) => (
          <button
            key={id}
            className={mode === id ? "is-on" : ""}
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="heat-layout">
        <div>
          <div className="heat-map" ref={host} aria-label="Sofia summer surface heat map" />
          {failed && <p>Map graphics unavailable. Explore locations below.</p>}
          <div className="heat-scale">
            <strong>
              {mode === "mean"
                ? "Mean daytime surface temperature"
                : "Share of valid composites at or above 35°C"}
            </strong>
            <i />
            <div>
              {modes[mode].steps.map((n) => (
                <span key={n}>
                  {n}
                  {modes[mode].unit}
                </span>
              ))}
            </div>
          </div>
        </div>
        <aside className="source-card">
          <h3>{name}</h3>
          <p>Average surface temperature</p>
          <strong className="heat-number">{p.mean}°C</strong>
          <p>
            Hottest composite <b>{p.peak}°C</b>
          </p>
          <p>
            <b>
              {p.hot} of {p.count}
            </b>{" "}
            valid observations averaged at least 35°C.
          </p>
          <h3>Explore Sofia</h3>
          <div className="filters">
            {places.map((place) => {
              const cell = placeCell(place);
              return (
                <button key={place[0]} disabled={!cell} onClick={() => focus(cell)}>
                  {place[0]}
                  {cell ? "" : " · insufficient data"}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
      <p className="foot-note">
        NASA Terra MODIS · approximately 1 km cells · 12 eight-day composites starting June–August
        2024. Uncolored cells have insufficient coverage. These historical surface readings differ
        from air temperature and do not forecast next summer.
      </p>
      <a href={import.meta.env.BASE_URL + "data/sofia-heat.md"}>Data and processing method</a>
    </div>
  );
}
