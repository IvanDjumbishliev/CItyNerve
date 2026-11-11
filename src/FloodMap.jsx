import React, { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CITY, riskLevel } from "./data.js";
import { dataUrl } from "./useFloodData.js";
import { onFrame } from "./damSim.js";

/* ─────────────── base style: OpenStreetMap via OpenFreeMap vector tiles ─────────────── */
const NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
const DEM_TILES = ["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"];
export const STYLE = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    omt: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution:
        '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    },
    dem: {
      type: "raster-dem",
      tiles: DEM_TILES,
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 13,
      attribution:
        "Terrain: SRTM (NASA) via AWS Terrain Tiles · Flood model: NASA GPM IMERG, MERRA-2, ICESat-2",
    },
    hill: {
      type: "raster-dem",
      tiles: DEM_TILES,
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 13,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0C141C" } },
    {
      id: "landcover",
      type: "fill",
      source: "omt",
      "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["wood", "grass", "farmland"]]],
      paint: { "fill-color": "#0F1D1B", "fill-opacity": 0.9 },
    },
    {
      id: "park",
      type: "fill",
      source: "omt",
      "source-layer": "park",
      paint: { "fill-color": "#112420", "fill-opacity": 0.85 },
    },
    {
      id: "landuse",
      type: "fill",
      source: "omt",
      "source-layer": "landuse",
      filter: ["in", ["get", "class"], ["literal", ["industrial", "railway", "commercial"]]],
      paint: { "fill-color": "#121A23" },
    },
    {
      id: "hillshade",
      type: "hillshade",
      source: "hill",
      paint: {
        "hillshade-shadow-color": "#05090D",
        "hillshade-highlight-color": "#3B5262",
        "hillshade-accent-color": "#0A1118",
        "hillshade-exaggeration": 0.55,
      },
    },
    {
      id: "water",
      type: "fill",
      source: "omt",
      "source-layer": "water",
      paint: { "fill-color": "#0E2C40" },
    },
    {
      id: "waterway",
      type: "line",
      source: "omt",
      "source-layer": "waterway",
      paint: {
        "line-color": "#1D4D6A",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 16, 3],
      },
    },
    {
      id: "road-minor",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["in", ["get", "class"], ["literal", ["minor", "service", "tertiary"]]],
      paint: {
        "line-color": "#18232E",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 17, 5],
      },
    },
    {
      id: "road-major",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary"]]],
      paint: {
        "line-color": "#26343F",
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 17, 10],
      },
    },
    {
      id: "rail",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: ["==", ["get", "class"], "rail"],
      paint: { "line-color": "#222C35", "line-width": 1, "line-dasharray": [3, 3] },
    },
    {
      id: "buildings-3d",
      type: "fill-extrusion",
      source: "omt",
      "source-layer": "building",
      minzoom: 13,
      paint: {
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], 6],
          0,
          "#18232D",
          25,
          "#22313D",
          70,
          "#2E4252",
        ],
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          0,
          14.2,
          ["coalesce", ["get", "render_height"], 6],
        ],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.88,
      },
    },
    {
      id: "place-label",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["city", "suburb", "quarter", "neighbourhood", "town", "village"]],
      ],
      layout: {
        "text-field": NAME,
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          11,
          ["match", ["get", "class"], "city", 14, 10],
          15,
          ["match", ["get", "class"], "city", 18, 13],
        ],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.12,
        "text-max-width": 8,
      },
      paint: { "text-color": "#6F8696", "text-halo-color": "#0C141C", "text-halo-width": 1.4 },
    },
    {
      id: "road-label",
      type: "symbol",
      source: "omt",
      "source-layer": "transportation_name",
      minzoom: 14.5,
      layout: {
        "text-field": NAME,
        "text-font": ["Noto Sans Regular"],
        "text-size": 10.5,
        "symbol-placement": "line",
      },
      paint: { "text-color": "#5D7181", "text-halo-color": "#0C141C", "text-halo-width": 1.2 },
    },
  ],
};

const DASH_SEQ = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

// depth ramp (single hue, light = deeper on the dark map) — matches the legend
const RAMP = [
  { max: 0.3, rgb: [31, 95, 139] },
  { max: 1.0, rgb: [46, 143, 208] },
  { max: Infinity, rgb: [124, 203, 255] },
];
const MIN_SHOW = 0.1;

// With 3D terrain MapLibre caches draped raster layers per terrain tile and only
// redraws them when tile coverage changes, not when a canvas source's pixels change.
// Free that cache after every repaint of our canvases so the water is always current.
function refreshDrape(map) {
  if (!map) return;
  try {
    map.terrain?.sourceCache?.freeRtt();
  } catch (e) {
    /* older engines */
  }
  map.triggerRepaint();
}

// MapLibre draws an image/canvas source on 3D terrain only inside ONE tile, picked from
// the image's size and centre. A grid that straddles a tile boundary is cut off at it.
// Pad the canvas (transparent, whole pixels) so that the chosen tile contains all data.
const mx = (lon) => (lon + 180) / 360;
const my = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const lonOf = (x) => x * 360 - 180;
const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
function makeDrapeCanvas(bounds, cols, rows) {
  const [[w, n], [e], , [, s]] = [bounds[0], bounds[1], bounds[2], bounds[3]];
  const x0 = mx(w),
    x1 = mx(e),
    y0 = my(n),
    y1 = my(s);
  const px = (x1 - x0) / cols,
    py = (y1 - y0) / rows;
  let Z = Math.max(0, Math.floor(-Math.log2(Math.max(x1 - x0, y1 - y0))));
  while (
    Z > 0 &&
    (Math.floor(x0 * 2 ** Z) !== Math.floor(x1 * 2 ** Z) ||
      Math.floor(y0 * 2 ** Z) !== Math.floor(y1 * 2 ** Z))
  )
    Z--;
  const T = 2 ** -Z,
    tx = Math.floor(x0 / T) * T,
    ty = Math.floor(y0 / T) * T;
  const need = T * 0.51; // makes MapLibre pick zoom Z exactly
  const pad = (a0, a1, lo, size) => {
    // grow [a0,a1] to `size`, centred, inside [lo, lo+T]
    if (a1 - a0 >= size) return [a0, a1];
    let b0 = (a0 + a1) / 2 - size / 2;
    b0 = Math.min(Math.max(b0, lo), lo + T - size);
    return [Math.min(b0, a0), Math.max(b0 + size, a1)];
  };
  const big = Math.max(x1 - x0, y1 - y0) >= need;
  const [X0, X1] = big ? [x0, x1] : pad(x0, x1, tx, need);
  const offX = Math.round((x0 - X0) / px),
    offY = 0;
  const cw = cols + offX + Math.round((X1 - x1) / px);
  const display = document.createElement("canvas");
  display.width = cw;
  display.height = rows;
  const ax0 = x0 - offX * px,
    ax1 = ax0 + cw * px;
  const coords = [
    [lonOf(ax0), latOf(y0)],
    [lonOf(ax1), latOf(y0)],
    [lonOf(ax1), latOf(y1)],
    [lonOf(ax0), latOf(y1)],
  ];
  return { display, dctx: display.getContext("2d"), coords, offX, offY };
}
function blit(d, src) {
  if (!d) return;
  d.dctx.clearRect(d.offX, d.offY, src.width, src.height);
  d.dctx.drawImage(src, d.offX, d.offY);
}

function circle([lng, lat], radius, steps = 40) {
  const kx = Math.cos((lat * Math.PI) / 180),
    ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((i % steps) / steps) * Math.PI * 2;
    ring.push([
      lng + (Math.cos(t) * radius) / (111320 * kx),
      lat + (Math.sin(t) * radius) / 111320,
    ]);
  }
  return [ring];
}

export default function FloodMap({
  summary,
  hotspots,
  png,
  factor,
  layers,
  selectedId,
  onSelect,
  onReady,
  dam,
  damFill,
  damActive,
  base = "",
}) {
  const baseRef = useRef(base);
  baseRef.current = base;
  const box = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const loaded = useRef(false);
  const raster = useRef({ canvas: null, ctx: null, depth: null, w: 0, h: 0 });
  const factorRef = useRef(factor);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  factorRef.current = factor;

  // draw the depth raster scaled by the timeline factor
  const paint = () => {
    const r = raster.current;
    if (!r.depth || !r.ctx) return;
    const img = r.ctx.createImageData(r.w, r.h);
    const out = img.data,
      d = r.depth,
      f = factorRef.current;
    for (let i = 0, p = 0; i < d.length; i++, p += 4) {
      const depth = (d[i] / 50) * f;
      if (depth < MIN_SHOW) continue;
      const c = depth < RAMP[0].max ? RAMP[0].rgb : depth < RAMP[1].max ? RAMP[1].rgb : RAMP[2].rgb;
      out[p] = c[0];
      out[p + 1] = c[1];
      out[p + 2] = c[2];
      out[p + 3] = 200;
    }
    r.ctx.putImageData(img, 0, 0);
    blit(r.drape, r.canvas);
    refreshDrape(mapRef.current);
  };

  // init once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: CITY.center,
      zoom: CITY.zoom,
      pitch: CITY.pitch,
      bearing: CITY.bearing,
      maxPitch: 80,
      attributionControl: { compact: true },
      antialias: true,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) window.__floodMap = map;

    map.once("style.load", () => {
      try {
        map.setTerrain({ source: "dem", exaggeration: 1.6 });
      } catch (e) {
        /* terrain optional */
      }
      try {
        map.setSky({
          "sky-color": "#0B1722",
          "horizon-color": "#1A3447",
          "fog-color": "#0C141C",
          "sky-horizon-blend": 0.7,
          "horizon-fog-blend": 0.6,
          "fog-ground-blend": 0.35,
        });
      } catch (e) {
        /* older engines */
      }

      map.addSource("streams", {
        type: "geojson",
        data: dataUrl(baseRef.current + "streams.geojson"),
      });
      map.addSource("icesat2", {
        type: "geojson",
        data: dataUrl(baseRef.current + "icesat2.geojson"),
      });
      map.addSource("ponds", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer(
        {
          id: "icesat2",
          type: "circle",
          source: "icesat2",
          layout: { visibility: "none" },
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 3],
            "circle-color": "#E7F6A9",
            "circle-opacity": 0.75,
          },
        },
        "buildings-3d",
      );
      map.addLayer(
        {
          id: "stream-glow",
          type: "line",
          source: "streams",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#4FC3F7",
            "line-width": ["interpolate", ["linear"], ["get", "km2"], 1, 2, 50, 7, 500, 14],
            "line-blur": 6,
            "line-opacity": 0.25,
          },
        },
        "buildings-3d",
      );
      map.addLayer(
        {
          id: "stream-flow",
          type: "line",
          source: "streams",
          layout: { "line-join": "round" },
          paint: {
            "line-color": "#CDEFFF",
            "line-width": ["interpolate", ["linear"], ["get", "km2"], 1, 0.6, 50, 1.6, 500, 3],
            "line-dasharray": DASH_SEQ[0],
            "line-opacity": 0.75,
          },
        },
        "buildings-3d",
      );
      map.addLayer({
        id: "ponds-3d",
        type: "fill-extrusion",
        source: "ponds",
        paint: {
          "fill-extrusion-color": "#3FA9F5",
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.5,
        },
      });

      // Studena reservoir + dam wall (OpenStreetMap geometry)
      map.addSource("studena", { type: "geojson", data: dataUrl("pernik/studena.geojson") });
      map.addSource("damwall", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer(
        {
          id: "studena-fill",
          type: "fill",
          source: "studena",
          filter: ["==", ["get", "kind"], "reservoir"],
          paint: { "fill-color": "#2E8FD0", "fill-opacity": 0.55 },
        },
        "buildings-3d",
      );
      map.addLayer(
        {
          id: "studena-shore",
          type: "line",
          source: "studena",
          filter: ["==", ["get", "kind"], "reservoir"],
          paint: { "line-color": "#A8E1FF", "line-width": 1.4, "line-opacity": 0.8 },
        },
        "buildings-3d",
      );
      map.addLayer({
        id: "dam-glow",
        type: "line",
        source: "studena",
        filter: ["==", ["get", "kind"], "dam"],
        layout: { "line-cap": "round" },
        paint: {
          "line-color": "#FFB86B",
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 22],
          "line-blur": 8,
          "line-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "dam-wall",
        type: "fill-extrusion",
        source: "damwall",
        paint: {
          "fill-extrusion-color": "#C9CED3",
          "fill-extrusion-height": 14,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.95,
        },
      });
      fetch(dataUrl("pernik/studena.geojson"))
        .then((r) => r.json())
        .then((fc) => {
          const walls = fc.features
            .filter((f) => f.properties.kind === "dam")
            .map((f) => ({
              type: "Feature",
              properties: {},
              geometry: { type: "Polygon", coordinates: [wallPolygon(f.geometry.coordinates, 7)] },
            }));
          map.getSource("damwall")?.setData({ type: "FeatureCollection", features: walls });
        })
        .catch(() => {});

      let step = 0;
      const id = setInterval(() => {
        if (!mapRef.current) return;
        step = (step + 1) % DASH_SEQ.length;
        if (map.getLayer("stream-flow"))
          map.setPaintProperty("stream-flow", "line-dasharray", DASH_SEQ[step]);
      }, 80);
      map.once("remove", () => clearInterval(id));

      loaded.current = true;
      onReady?.(map);
    });
    return () => {
      loaded.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // flood raster source (needs grid bounds from the summary)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !summary) return;
    const attach = () => {
      if (map.getLayer("flood")) map.removeLayer("flood"); // region switched: new grid, new bounds
      if (map.getSource("flood")) map.removeSource("flood");
      raster.current.depth = null;
      const canvas = document.createElement("canvas");
      canvas.width = summary.grid.cols;
      canvas.height = summary.grid.rows;
      const drape = makeDrapeCanvas(summary.grid.bounds, canvas.width, canvas.height);
      raster.current = {
        ...raster.current,
        canvas,
        drape,
        ctx: canvas.getContext("2d", { willReadFrequently: true }),
        w: canvas.width,
        h: canvas.height,
      };
      map.addSource("flood", {
        type: "canvas",
        canvas: drape.display,
        coordinates: drape.coords,
        animate: true,
      });
      map.addLayer(
        {
          id: "flood",
          type: "raster",
          source: "flood",
          paint: {
            "raster-opacity": 0.85,
            "raster-resampling": "nearest",
            "raster-fade-duration": 0,
          },
        },
        "stream-glow",
      );
      applyLayers(map, layers);
      paint();
    };
    if (loaded.current) attach();
    else map.once("style.load", attach);
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps

  // region switch: river network and lidar tracks of the selected city
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    map.getSource("streams")?.setData(dataUrl(base + "streams.geojson"));
    map.getSource("icesat2")?.setData(dataUrl(base + "icesat2.geojson"));
  }, [base]);

  // load the depth PNG for the selected storm
  useEffect(() => {
    if (!png) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      const depth = new Uint8Array(img.width * img.height);
      for (let i = 0; i < depth.length; i++) depth[i] = px[i * 4];
      raster.current.depth = depth;
      paint();
    };
    img.src = dataUrl(png);
    return () => {
      alive = false;
    };
  }, [png]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    paint();
    updatePonds();
  }, [factor]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePonds = () => {
    const map = mapRef.current;
    if (!map || !map.getSource("ponds")) return;
    map.getSource("ponds").setData({
      type: "FeatureCollection",
      features: (hotspots ?? []).map((h) => ({
        type: "Feature",
        properties: { height: Math.max(0.3, h.depth * factorRef.current * 20) },
        geometry: {
          type: "Polygon",
          coordinates: circle(h.coord, Math.max(35, Math.sqrt(h.area_m2 / Math.PI) * 0.6)),
        },
      })),
    });
  };

  // hotspot markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hotspots?.length) return;
    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};
    hotspots.forEach((h) => {
      const el = document.createElement("button");
      el.className = `hs-marker risk-${riskLevel(h.score)}`;
      el.setAttribute("aria-label", `${h.name}, risk score ${h.score}`);
      el.innerHTML = `<span class="hs-ring"></span><span class="hs-core">${h.score}</span><span class="hs-tip">${h.name} · ${h.district}</span>`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current?.({ kind: "hotspot", id: h.id });
      });
      markersRef.current[h.id] = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat(h.coord)
        .addTo(map);
    });
    const ready = () => updatePonds();
    if (loaded.current) ready();
    else map.once("style.load", ready);
  }, [hotspots]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current) applyLayers(map, layers);
    Object.entries(markersRef.current).forEach(([id, m]) => {
      const el = m.getElement();
      el.style.display = layers.hotspots ? "" : "none";
      el.classList.toggle("is-selected", id === selectedId);
    });
  }, [layers, selectedId]);

  // dam marker
  const damMarker = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !dam) return;
    if (!damMarker.current) {
      const el = document.createElement("button");
      el.className = "dam-marker";
      el.setAttribute("aria-label", "Studena dam");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current?.({ kind: "dam", id: "dam" });
      });
      damMarker.current = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -6] })
        .setLngLat(dam.dam.coord)
        .addTo(map);
    }
    const el = damMarker.current.getElement();
    el.innerHTML =
      '<span class="dam-pin"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18M5 20V8l4-3v15M9 9h10v11"/><path d="M12 13c1.5 1 3 1 4.5 0"/></svg></span>' +
      `<span class="dam-label"><b>Studena Dam</b><small>${damFill != null ? `${Math.round(damFill)}% full` : "Pernik water supply"}</small></span>`;
    el.classList.toggle("is-selected", selectedId === "dam");
    el.classList.toggle("is-active", !!damActive);
  }, [dam, damFill, selectedId, damActive]);

  // live dam-break water (canvas source fed by the simulation worker)
  const sim = useRef({ canvas: null, ctx: null });
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !dam) return;
    const attach = () => {
      if (map.getSource("dambreak")) return;
      const canvas = document.createElement("canvas");
      canvas.width = dam.grid.cols;
      canvas.height = dam.grid.rows;
      const drape = makeDrapeCanvas(dam.grid.bounds, canvas.width, canvas.height);
      sim.current = { canvas, ctx: canvas.getContext("2d"), drape };
      map.addSource("dambreak", {
        type: "canvas",
        canvas: drape.display,
        coordinates: drape.coords,
        animate: true,
      });
      map.addLayer(
        {
          id: "dambreak",
          type: "raster",
          source: "dambreak",
          paint: {
            "raster-opacity": 0.92,
            "raster-resampling": "linear",
            "raster-fade-duration": 0,
          },
        },
        "buildings-3d",
      );
    };
    if (loaded.current) attach();
    else map.once("style.load", attach);
    const off = onFrame((f) => {
      const { ctx, canvas, drape } = sim.current;
      if (!ctx) return;
      const vis = (id, on) =>
        map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      if (!f) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        blit(drape, canvas);
        vis("studena-fill", true);
        refreshDrape(map);
        return;
      }
      vis("studena-fill", false);
      const img = ctx.createImageData(canvas.width, canvas.height),
        o = img.data,
        d = f.depth,
        sp = f.speed;
      for (let i = 0, p = 0; i < d.length; i++, p += 4) {
        const dep = d[i] / 20;
        if (dep < 0.05) continue;
        const c =
          dep < 0.3 ? RAMP[0].rgb : dep < 1 ? RAMP[1].rgb : dep < 4 ? RAMP[2].rgb : [168, 225, 255];
        const foam = Math.min(0.85, Math.max(0, (sp[i] / 10 - 2.5) / 6)); // white water where flow is fast
        o[p] = c[0] + (255 - c[0]) * foam;
        o[p + 1] = c[1] + (255 - c[1]) * foam;
        o[p + 2] = c[2] + (255 - c[2]) * foam;
        o[p + 3] = Math.min(240, 120 + dep * 60);
      }
      ctx.putImageData(img, 0, 0);
      blit(drape, canvas);
      refreshDrape(map);
    });
    return () => {
      off();
    };
  }, [dam]);

  return <div ref={box} className="map-canvas" />;
}

function wallPolygon(coords, halfWidth) {
  const left = [],
    right = [];
  for (let i = 0; i < coords.length; i++) {
    const a = coords[Math.max(0, i - 1)],
      b = coords[Math.min(coords.length - 1, i + 1)];
    const kx = Math.cos((coords[i][1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * kx,
      dy = b[1] - a[1],
      len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len,
      ny = dx / len;
    left.push([
      coords[i][0] + (nx * halfWidth) / (111320 * kx),
      coords[i][1] + (ny * halfWidth) / 111320,
    ]);
    right.push([
      coords[i][0] - (nx * halfWidth) / (111320 * kx),
      coords[i][1] - (ny * halfWidth) / 111320,
    ]);
  }
  return [...left, ...right.reverse(), left[0]];
}

function applyLayers(map, layers) {
  const vis = (id, on) =>
    map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  vis("flood", layers.extent);
  vis("ponds-3d", layers.extent && layers.depth3d);
  vis("stream-flow", layers.flow);
  vis("stream-glow", layers.flow);
  vis("icesat2", layers.lidar);
  vis("buildings-3d", layers.buildings);
  try {
    map.setTerrain(layers.terrain ? { source: "dem", exaggeration: 1.6 } : null);
  } catch (e) {
    /* noop */
  }
}
