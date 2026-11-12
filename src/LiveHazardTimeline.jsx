import React, { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useFloodData } from './useFloodData.js';
import { useFogData } from './useFogData.js';
import { FogTimeline } from './FogNerve.jsx';

const TZ = 'Europe/Sofia';
const addHours = (iso, hours) => new Date(new Date(iso).getTime() + hours * 3600000);
const formatTime = (date) => date.toLocaleString('en-GB', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function FloodLiveTimeline() {
  const { summary, loading, error } = useFloodData('sofia');
  const events = summary?.events ?? [];
  const [eventIndex, setEventIndex] = useState(-1);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const event = events[eventIndex] ?? null;

  useEffect(() => {
    if (events.length && eventIndex < 0) setEventIndex(events.length - 1);
  }, [events.length, eventIndex]);
  useEffect(() => {
    if (!event) return;
    setHour(event.level.indexOf(Math.max(...event.level)));
    setPlaying(false);
  }, [eventIndex, event]);
  useEffect(() => {
    if (!playing || !event) return undefined;
    const timer = setInterval(() => setHour(current => current >= event.rain.length - 1 ? 0 : current + 1), 180);
    return () => clearInterval(timer);
  }, [playing, event]);

  if (!event) {
    return <p className="live-timeline-state">{loading ? 'Loading flood timeline…' : `Flood timeline unavailable${error ? `: ${error}` : '.'}`}</p>;
  }
  const width = 480;
  const height = 74;
  const count = event.rain.length;
  const maxRain = Math.max(...event.rain, 0.5);
  const barWidth = width / count;
  const xAt = (index) => index / Math.max(1, count - 1) * width;
  const line = event.level.map((value, index) =>
    `${index ? 'L' : 'M'}${xAt(index).toFixed(1)} ${(height - 4 - value * 38).toFixed(1)}`
  ).join(' ');
  const area = `M0 ${height} ${event.level.map((value, index) =>
    `L${xAt(index).toFixed(1)} ${(height - 4 - value * 38).toFixed(1)}`
  ).join(' ')} L${width} ${height} Z`;
  const peak = event.level.indexOf(Math.max(...event.level));
  const level = event.level[Math.round(hour)] ?? 0;
  const tickIndexes = [0, Math.round((count - 1) / 2), count - 1];

  return (
    <section className="timeline glass live-hazard-timeline" aria-label="Live flood event timeline">
      <div className="tl-head">
        <button className="play" onClick={() => setPlaying(value => !value)} aria-label={playing ? 'Pause flood event' : 'Play flood event'}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <div className="tl-clock">
          <span className="big">{formatTime(addHours(event.window_start, hour))}</span>
          <span className="tl-sub">{Math.abs(hour - peak) < 1 ? 'Peak water' : hour < peak ? 'Water rising' : 'Receding'}</span>
        </div>
        <label className="live-event-select">
          <span>Event</span>
          <select aria-label="Select flood event" value={eventIndex} onChange={(e) => setEventIndex(Number(e.target.value))}>
            {events.map((item, index) => <option value={index} key={item.id}>{formatTime(new Date(item.start))}</option>)}
          </select>
        </label>
        <div className="tl-reads"><span><b>{(event.rain[Math.round(hour)] ?? 0).toFixed(1)}</b> mm/h</span><span><b>{Math.round(level * 100)}%</b> of peak</span></div>
      </div>
      <div className="tl-chart"><div className="tl-svg-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {event.rain.map((rain, index) => <rect key={index} x={index * barWidth + barWidth * 0.15} y="0" width={barWidth * 0.7} height={Math.max(0.4, rain / maxRain * 26)} rx="1" className={index <= hour ? 'rain-bar past' : 'rain-bar'} />)}
          <line x1="0" x2={width} y1="31" y2="31" className="tl-divider" />
          <path d={area} className="level-area" />
          <path d={line} className="level-line" vectorEffect="non-scaling-stroke" />
          <line x1={xAt(hour)} x2={xAt(hour)} y1="0" y2={height} className="tl-cursor" vectorEffect="non-scaling-stroke" />
        </svg>
        <input type="range" min="0" max={count - 1} step="1" value={hour} onChange={(e) => { setPlaying(false); setHour(Number(e.target.value)); }} aria-label="Scrub flood event hour" />
        <div className="tl-ticks">{tickIndexes.map(index => <span key={index}>{formatTime(addHours(event.window_start, index))}</span>)}</div>
      </div></div>
    </section>
  );
}

function FogLiveTimeline() {
  const { summary, events, loading, error } = useFogData();
  const [eventIndex, setEventIndex] = useState(-1);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const event = events[eventIndex] ?? null;

  useEffect(() => {
    if (events.length && eventIndex < 0) setEventIndex(events.length - 1);
  }, [events.length, eventIndex]);
  useEffect(() => {
    if (!event?.hourly.length) return;
    const peak = event.hourly.reduce((best, item, index, series) =>
      item.probability > series[best].probability ? index : best, 0);
    setHour(peak);
    setPlaying(false);
  }, [eventIndex, event]);
  useEffect(() => {
    if (!playing || !event) return undefined;
    const timer = setInterval(() => setHour(current => current >= event.hourly.length - 1 ? 0 : current + 1), 650);
    return () => clearInterval(timer);
  }, [playing, event]);

  if (!summary) {
    return <p className="live-timeline-state">{loading ? 'Loading fog timeline…' : `Fog timeline unavailable${error ? `: ${error}` : '.'}`}</p>;
  }
  return (
    <div className="live-timeline-wrap">
      <label className="live-event-select fog-live-event-select">
        <span>Observed fog event</span>
        <select aria-label="Select fog event" value={eventIndex} onChange={(e) => setEventIndex(Number(e.target.value))}>
          {events.map((item, index) => <option value={index} key={item.id}>{formatTime(new Date(item.start))} · {item.type}</option>)}
        </select>
      </label>
      <FogTimeline event={event} hour={hour} setHour={setHour} playing={playing} setPlaying={setPlaying} summary={summary} />
    </div>
  );
}

export default function LiveHazardTimeline({ type }) {
  if (type === 'flood') return <FloodLiveTimeline />;
  if (type === 'fog') return <FogLiveTimeline />;
  return null;
}
