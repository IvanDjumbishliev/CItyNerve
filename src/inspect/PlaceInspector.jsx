import React, { useEffect, useState } from "react";
import { Crosshair, Link, Loader2, RotateCcw, X } from "lucide-react";
import { usePlace, PlaceMapInteraction } from "./PlaceContext.jsx";
import { inspectPlace } from "./data.js";
import { REGIONS } from "../data.js";
import { HEAT_TOWNS } from "../heat/towns.js";
import "./place.css";
import { readInspectionTime } from "./geometry.js";

export default function PlaceInspector() {
  const { active, enabled, setEnabled, selection, setSelection } = usePlace();
  const [time, setTime] = useState(() => readInspectionTime(window.location.hash));
  const [results, setResults] = useState(null);
  const [retry, setRetry] = useState(0);
  const [linkMessage, setLinkMessage] = useState("");
  const day = active?.context.shade?.day || time.day;
  const hour = active?.context.shade?.hour ?? time.hour;
  const context = active?.context;
  const supported = Boolean(active);
  useEffect(() => {
    if (context?.shade) setTime({ day: context.shade.day, hour: context.shade.hour });
  }, [context?.shade?.day, context?.shade?.hour]);

  useEffect(() => {
    const escape = (event) => {
      if (event.key === "Escape") setEnabled(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [setEnabled]);

  useEffect(() => {
    if (active && selection && active.context.cityId !== selection.cityId) setSelection(null);
  }, [active?.context.cityId, selection?.cityId, setSelection]);

  useEffect(() => {
    if (!enabled || !selection || !active || selection.cityId !== active.context.cityId) return;
    let cancelled = false;
    setResults(null);
    setLinkMessage("");
    inspectPlace(selection, context, day, hour, (index, result) => {
      if (cancelled) return;
      setResults((current) => {
        const next = current ? [...current] : Array(4).fill(null);
        next[index] = result;
        return next;
      });
    }).then((value) => {
      if (!cancelled) setResults(value);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, selection, context, day, hour, retry]);

  async function copyLink() {
    const params = new URLSearchParams({
      inspect: selection.point.map((value) => value.toFixed(6)).join(","),
      city: selection.cityId,
      day,
      hour: String(hour),
    });
    if (context.flood?.eventId) params.set("storm", context.flood.eventId);
    if (context.heat?.sceneId) params.set("scene", context.heat.sceneId);
    const url = new URL(window.location.href);
    url.hash = `${context.route}?${params}`;
    try {
      await navigator.clipboard.writeText(url.href);
      setLinkMessage("Location link copied");
    } catch {
      setLinkMessage(url.href);
    }
  }

  if (!supported) return null;
  const cityName =
    REGIONS[selection?.cityId]?.label ||
    HEAT_TOWNS.find((town) => town.id === selection?.cityId)?.name;
  return (
    <>
      <PlaceMapInteraction />
      <button
        className={`place-tool ${enabled ? "is-on" : ""}`}
        aria-pressed={enabled}
        onClick={() => setEnabled((value) => !value)}
        title="Select a point to inspect its data"
      >
        <Crosshair size={17} /> Inspect place
      </button>
      {enabled && !selection && (
        <div className="place-instruction" role="status">
          Click a street or building to inspect it. Drag to move the map. Escape to exit.
        </div>
      )}
      {enabled && selection && selection.cityId === context.cityId && (
        <aside className="place-panel" aria-label="Place inspection">
          <header className="place-header">
            <div>
              <span className="place-eyebrow">INSPECT THIS PLACE</span>
              <h2>{selection.name}</h2>
              <p>
                {cityName} · {selection.point[1].toFixed(5)}, {selection.point[0].toFixed(5)}
              </p>
            </div>
            <button
              className="place-icon"
              aria-label="Close place inspector"
              onClick={() => setEnabled(false)}
            >
              <X size={18} />
            </button>
          </header>
          <p className="place-intro">
            Different sources describe different dates and scales. These results are not a combined
            safety rating.
          </p>
          <fieldset className="place-time">
            <legend>Explore building shade</legend>
            <label>
              Date
              <input
                type="date"
                value={day}
                onChange={(event) => {
                  if (!event.target.value) return;
                  if (context.shade?.onDay) context.shade.onDay(event.target.value);
                  else setTime((value) => ({ ...value, day: event.target.value }));
                }}
              />
            </label>
            <label>
              Local time{" "}
              <strong>
                {String(Math.floor(hour)).padStart(2, "0")}:{hour % 1 ? "30" : "00"}
              </strong>
              <input
                aria-label="Inspection shade time"
                type="range"
                min="0"
                max="23.5"
                step="0.5"
                value={hour}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (context.shade?.onHour) context.shade.onHour(value);
                  else setTime((current) => ({ ...current, hour: value }));
                }}
              />
            </label>
            <small>Shade time does not change satellite heat or historical flood data.</small>
          </fieldset>
          {(!results || results.some((result) => !result)) && (
            <p className="place-loading" role="status">
              <Loader2 size={17} className="spin" /> Reading available datasets…
            </p>
          )}
          {results?.filter(Boolean).map((result) => (
            <section className={`place-card ${result.status}`} key={result.title}>
              <div className="place-card-heading">
                <h3>{result.title}</h3>
                <span>{result.status === "available" ? "MODEL / ESTIMATE" : "UNAVAILABLE"}</span>
              </div>
              <strong className="place-value">{result.value || "Data unavailable here"}</strong>
              <p>{result.detail}</p>
              {result.date && <p className="place-date">{result.date}</p>}
              {result.source && (
                <details>
                  <summary>Source and limitations</summary>
                  <p>{result.source}</p>
                  <p>{result.resolution}</p>
                </details>
              )}
            </section>
          ))}
          <footer className="place-footer">
            <button onClick={copyLink}>
              <Link size={14} /> Copy location link
            </button>
            <button onClick={() => setRetry((value) => value + 1)}>
              <RotateCcw size={14} /> Retry data
            </button>
            <p role="status">{linkMessage}</p>
            <small>Point estimates apply to the available grid cell or building geometry.</small>
          </footer>
        </aside>
      )}
    </>
  );
}
