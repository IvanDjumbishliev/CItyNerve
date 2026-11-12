import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { readSelection } from "./geometry.js";

const Context = createContext(null);

export function PlaceProvider({ children }) {
  const [selection, setSelection] = useState(() => readSelection(window.location.hash));
  const [enabled, setEnabled] = useState(() => Boolean(readSelection(window.location.hash)));
  const [active, setActive] = useState(null);
  const register = useCallback((map, context) => setActive({ map, context }), []);
  const unregister = useCallback(
    (map) => setActive((current) => (current?.map === map ? null : current)),
    [],
  );
  return (
    <Context.Provider
      value={{ selection, setSelection, enabled, setEnabled, active, register, unregister }}
    >
      {children}
    </Context.Provider>
  );
}

export const usePlace = () => useContext(Context);

// Register map instances without changing their rendering or normal click handlers.
export function usePlaceMap(map, context) {
  const place = usePlace();
  const latest = useRef(context);
  latest.current = context;
  const register = place?.register;
  const unregister = place?.unregister;
  const signature = JSON.stringify(context, (key, value) =>
    ["buildings", "shadows", "onDay", "onHour"].includes(key) ? undefined : value,
  );
  useEffect(() => {
    if (map && register) register(map, latest.current);
  }, [map, register, signature, context.shade?.buildings, context.shade?.shadows]);
  useEffect(
    () => () => {
      if (map) unregister?.(map);
    },
    [map, unregister],
  );
}

export function PlaceMapInteraction() {
  const { active, enabled, selection, setSelection } = usePlace();
  useEffect(() => {
    if (!active?.map || !enabled) return;
    const { map, context } = active;
    const host = map.getCanvasContainer();
    const canvas = map.getCanvas();
    const previous = canvas.style.cursor;
    canvas.style.cursor = "crosshair";
    let down;
    const pointerDown = (event) => {
      down = [event.clientX, event.clientY];
    };
    const click = (event) => {
      if (
        event.button !== 0 ||
        (down && Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = canvas.getBoundingClientRect();
      const pixel = [event.clientX - rect.left, event.clientY - rect.top];
      const coordinate = map.unproject(pixel);
      const features = map.queryRenderedFeatures(pixel);
      const named = features.find(
        (feature) =>
          /road|building|poi/.test(feature.layer?.id || "") &&
          (feature.properties?.["name:en"] || feature.properties?.name),
      );
      const name = named?.properties?.["name:en"] || named?.properties?.name || "Selected place";
      setSelection({ point: [coordinate.lng, coordinate.lat], cityId: context.cityId, name });
    };
    host.addEventListener("pointerdown", pointerDown, true);
    host.addEventListener("click", click, true);
    return () => {
      canvas.style.cursor = previous;
      host.removeEventListener("pointerdown", pointerDown, true);
      host.removeEventListener("click", click, true);
    };
  }, [active, enabled, setSelection]);

  useEffect(() => {
    if (!active?.map || !selection || !enabled || active.context.cityId !== selection.cityId)
      return;
    const pin = document.createElement("div");
    pin.className = "place-pin";
    pin.setAttribute("aria-label", "Inspected location");
    const marker = new maplibregl.Marker({ element: pin })
      .setLngLat(selection.point)
      .addTo(active.map);
    return () => marker.remove();
  }, [active?.map, active?.context.cityId, enabled, selection]);
  return null;
}
