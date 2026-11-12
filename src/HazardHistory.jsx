import React from 'react';
import { Pause, Play } from 'lucide-react';

const TZ = 'Europe/Sofia';
const dateLabel = (value) => new Date(value).toLocaleDateString('en-GB', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeLabel = (value) => new Date(value).toLocaleTimeString('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
});
const visibilityLabel = (value) => value == null
  ? '—'
  : value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`;

function HistoricalEventPanel({ type, events, selectedId, onSelect, loading, error }) {
  const isFog = type === 'fog';
  return (
    <aside className={`hazard-history-panel glass hazard-history-${type}`} aria-label={`Historical ${isFog ? 'fog episodes' : 'storms'}`}>
      <div className="hazard-history-heading">
        <h2>{isFog ? 'Fog episodes' : 'Storms'}</h2>
        <span>Historical</span>
      </div>
      {loading ? (
        <p className="hazard-history-empty">Loading historical {isFog ? 'episodes' : 'storms'}…</p>
      ) : error ? (
        <p className="hazard-history-empty">Historical records are unavailable.</p>
      ) : events.length ? (
        <div className="storm-list hazard-history-list">
          {events.slice().sort((a, b) => new Date(b.start) - new Date(a.start)).map((event) => (
            <button
              type="button"
              key={event.id}
              className={`storm ${selectedId === event.id ? 'is-on' : ''}`}
              onClick={() => onSelect(event.id)}
              aria-pressed={selectedId === event.id}
            >
              <span className="storm-date">
                {dateLabel(event.start)}
                {isFog && <small>{event.type}</small>}
              </span>
              <span className="storm-meta">
                {isFog ? visibilityLabel(event.minimum_visibility_m) : `${Math.round(event.total_mm)} mm`}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="hazard-history-empty">No historical records are available.</p>
      )}
      <p className="hazard-history-note">
        Historical event playback is for review only; it is not a live warning or measurement.
      </p>
    </aside>
  );
}

function FloodRecordTimeline({ summary, onSelect }) {
  const W = 480;
  const H = 74;
  const days = summary.daily ?? [];
  const max = Math.max(...days.map(([, value]) => value), 0.5);
  const dailyRain = summary.rain?.yearly_mm ?? {};
  const dayIndex = Object.fromEntries(days.map(([day], index) => [day, index]));
  const eventPositions = summary.events.map((event, index) => ({
    event,
    index,
    day: dayIndex[event.start.slice(0, 10)],
  })).filter((item) => item.day != null);
  const path = days.map(([, value], index) => value > 0.5
    ? `M${((index / Math.max(1, days.length - 1)) * W).toFixed(1)} ${H - 2} V${(H - 2 - (value / max) * (H - 8)).toFixed(1)}`
    : '').join('');
  const years = Object.keys(dailyRain);
  return (
    <section className="timeline glass hazard-history-timeline" aria-label="Five-year rainfall history">
      <div className="tl-head">
        <div className="tl-clock">
          <span className="big">Daily rain · 5 years</span>
          <span className="tl-sub">Historical record · select a marker or storm to review</span>
        </div>
        <div className="tl-reads">
          <span><b>{summary.rain?.annual_mean_mm ?? '—'}</b> mm/yr</span>
        </div>
      </div>
      <div className="tl-chart">
        <div className="tl-svg-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={path} className="daily-bars" vectorEffect="non-scaling-stroke" />
          </svg>
          {eventPositions.map(({ event, index, day }) => (
            <button
              type="button"
              key={event.id}
              className="ev-tick"
              style={{ left: `${(day / days.length) * 100}%` }}
              onClick={() => onSelect(event.id)}
              title={`${dateLabel(event.start)} · ${event.total_mm} mm`}
              aria-label={`Review storm of ${dateLabel(event.start)}`}
            />
          ))}
          <div className="tl-ticks">{years.map((year) => <span key={year}>{year}</span>)}</div>
        </div>
      </div>
    </section>
  );
}

function FloodEventTimeline({ event, hour, setHour, playing, setPlaying }) {
  const W = 480;
  const H = 74;
  const count = event.rain.length;
  const maxRain = Math.max(...event.rain, 0.5);
  const xAt = (index) => (index / Math.max(1, count - 1)) * W;
  const line = event.level.map((value, index) => `${index ? 'L' : 'M'}${xAt(index).toFixed(1)} ${(H - 4 - value * 38).toFixed(1)}`).join(' ');
  const area = `M0 ${H} ${event.level.map((value, index) => `L${xAt(index).toFixed(1)} ${(H - 4 - value * 38).toFixed(1)}`).join(' ')} L${W} ${H} Z`;
  const peak = event.level.indexOf(Math.max(...event.level));
  const level = event.level[Math.round(hour)] ?? 0;
  const currentTime = new Date(new Date(event.window_start).getTime() + hour * 3600000);
  const ticks = [0, Math.round((count - 1) / 2), count - 1];
  return (
    <section className="timeline glass hazard-history-timeline" aria-label="Historical storm hourly playback">
      <div className="tl-head">
        <button type="button" className="play" onClick={() => setPlaying(value => !value)} aria-label={playing ? 'Pause storm playback' : 'Play storm'}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <div className="tl-clock">
          <span className="big">{dateLabel(currentTime.toISOString())} · {timeLabel(currentTime)}</span>
          <span className="tl-sub">{Math.abs(hour - peak) < 1 ? 'Peak water' : hour < peak ? 'Water rising' : 'Receding'} · historical model replay</span>
        </div>
        <div className="tl-reads">
          <span><b>{(event.rain[Math.round(hour)] ?? 0).toFixed(1)}</b> mm/h</span>
          <span><b>{Math.round(level * 100)}%</b> of peak</span>
        </div>
      </div>
      <div className="tl-chart">
        <div className="tl-svg-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {event.rain.map((rain, index) => (
              <rect key={index} x={index * W / count + W / count * 0.15} y={0}
                width={W / count * 0.7} height={Math.max(0.4, rain / maxRain * 26)} rx="1"
                className={index <= hour ? 'rain-bar past' : 'rain-bar'} />
            ))}
            <line x1="0" x2={W} y1="31" y2="31" className="tl-divider" />
            <path d={area} className="level-area" />
            <path d={line} className="level-line" vectorEffect="non-scaling-stroke" />
            <line x1={xAt(hour)} x2={xAt(hour)} y1="0" y2={H} className="tl-cursor" vectorEffect="non-scaling-stroke" />
          </svg>
          <input type="range" min="0" max={count - 1} step="1" value={hour}
            onChange={(eventValue) => { setPlaying(false); setHour(Number(eventValue.target.value)); }}
            aria-label="Scrub historical storm hour" />
          <div className="tl-ticks">{ticks.map((index) => <span key={index}>{timeLabel(new Date(new Date(event.window_start).getTime() + index * 3600000))}</span>)}</div>
        </div>
      </div>
    </section>
  );
}

function FogEventTimeline({ event, hour, setHour, playing, setPlaying }) {
  const series = event?.hourly ?? [];
  const count = series.length;
  const W = 480;
  const H = 74;
  const current = series[hour];
  const path = series.map((item, index) => {
    const x = index / Math.max(1, count - 1) * W;
    const y = H - 5 - (item.probability ?? 0) * (H - 12);
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const area = count ? `M0 ${H} ${path} L${W} ${H} Z` : '';
  const cursorX = count ? hour / Math.max(1, count - 1) * W : 0;
  return (
    <section className="timeline glass fog-timeline hazard-history-timeline" aria-label="Historical fog episode hourly playback">
      <div className="tl-head">
        <button type="button" className="play" onClick={() => setPlaying(value => !value)} disabled={!count}
          aria-label={playing ? 'Pause fog playback' : 'Play fog episode'}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <div className="tl-clock">
          <span className="big">{event ? `${dateLabel(current?.time ?? event.start)} · ${timeLabel(current?.time ?? event.start)}` : 'Historical fog episodes'}</span>
          <span className="tl-sub">{event ? `Visibility ${visibilityLabel(current?.visibility_m)} · ${event.type} fog · historical model replay` : 'Select an episode to review hourly visibility and model likelihood'}</span>
        </div>
        {current && <div className="tl-reads"><span><b>{Math.round((current.probability ?? 0) * 100)}%</b> likelihood</span></div>}
      </div>
      <div className="tl-chart">
        <div className="tl-svg-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={area} className="fog-probability-area" />
            <path d={path} className="fog-probability-line" vectorEffect="non-scaling-stroke" />
            <line x1={cursorX} x2={cursorX} y1="0" y2={H} className="tl-cursor" vectorEffect="non-scaling-stroke" />
          </svg>
          {count > 1 && <input type="range" min="0" max={count - 1} step="1" value={hour}
            onChange={(eventValue) => { setPlaying(false); setHour(Number(eventValue.target.value)); }}
            aria-label="Scrub historical fog episode hour" />}
          <div className="tl-ticks">{count > 1
            ? [0, Math.round((count - 1) / 2), count - 1].map(index => <span key={index}>{timeLabel(series[index].time)}</span>)
            : <span>{event ? `${event.duration_h} h observed episode` : 'No hourly episode selected'}</span>}</div>
        </div>
      </div>
    </section>
  );
}

export default function HazardHistory({ type, summary, events, selectedId, onSelect, hour, setHour, playing, setPlaying, loading, error }) {
  const event = events.find((item) => item.id === selectedId) ?? null;
  return (
    <>
      <HistoricalEventPanel type={type} events={events} selectedId={selectedId} onSelect={onSelect} loading={loading} error={error} />
      {type === 'flood' && summary
        ? event
          ? <FloodEventTimeline event={event} hour={hour} setHour={setHour} playing={playing} setPlaying={setPlaying} />
          : <FloodRecordTimeline summary={summary} onSelect={onSelect} />
        : type === 'fog'
          ? <FogEventTimeline event={event} hour={hour} setHour={setHour} playing={playing} setPlaying={setPlaying} />
          : null}
    </>
  );
}
