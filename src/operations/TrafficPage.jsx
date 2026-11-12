import React, { useState } from 'react';
import { demoBoards } from './boards.js';
import { trafficForBoard } from '../../shared/traffic.js';
import { trafficFeatures, trafficPresentation, TRAFFIC_COLORS } from './transportView.js';
import TransportMap from './TransportMap.jsx';

const stamp = value => value ? new Date(value).toLocaleString() : 'Not yet available';
export default function TrafficPage({ op, onNavigate }) {
  const [filter, setFilter] = useState('all'), [selected, setSelected] = useState(null);
  const rows = op.traffic.supported ? demoBoards(op.city).map(b => { const traffic = trafficForBoard(b, op.traffic.data, op.now); return { ...b, traffic, display: trafficPresentation(traffic) }; }) : [];
  const usable = rows.filter(b => b.traffic?.status === 'ok');
  const visible = rows.filter(b => filter === 'all' || b.display.kind === filter);
  const points = visible.map(b => ({ ...b, symbol: String(b.number), color: b.display.color, detail: `${b.display.label} · ${b.direction}` }));
  const chosen = visible.find(b => b.id === selected);
  const count = kind => rows.filter(b => b.display.kind === kind).length;
  return <>
    <section className="ops-panel"><div className="ops-heading"><div><h2>Live road conditions</h2><p>TomTom traffic on sampled road segments around Sofia’s smart boards.</p></div><button onClick={op.traffic.refresh} disabled={!op.traffic.supported || op.traffic.loading}>{op.traffic.loading ? 'Checking traffic…' : 'Refresh traffic'}</button></div>
      <div className="ops-kpis"><div><span>Matched readings</span><strong>{usable.length}<small> / {rows.length}</small></strong></div><div><span>Slow traffic</span><strong>{count('congestion')}</strong></div><div><span>Closures reported</span><strong>{count('closure')}</strong></div><div><span>Unavailable / unmatched</span><strong>{count('unavailable')}</strong></div></div>
      <p className="ops-note">Retrieved {stamp(op.traffic.data?.fetchedAt)} · checked every minute · provider requests cached for five minutes. These are sampled segments, not a citywide traffic layer.</p>
      {!op.traffic.supported && <p role="status">Live traffic is currently configured for Sofia. Select Sofia above to explore the demo network.</p>}
      {op.traffic.error && <p className="ops-error" role="status">{op.traffic.error}</p>}
      {op.traffic.loading && <p role="status">Loading current traffic readings…</p>}
    </section>
    {op.traffic.supported && <>
      <div className="ops-actions ops-filters" aria-label="Traffic conditions">{[['all', 'All samples'], ['flow', 'No slowdown'], ['congestion', 'Slow traffic'], ['closure', 'Closures'], ['unavailable', 'Unavailable']].map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label} ({id === 'all' ? rows.length : count(id)})</button>)}</div>
      <div className="transport-legend">{[['flow', 'No slowdown detected'], ['congestion', 'Slow traffic'], ['closure', 'Closure reported'], ['unavailable', 'No usable reading']].map(([kind, label]) => <span key={kind}><i style={{ background: TRAFFIC_COLORS[kind] }}/>{label}</span>)}</div>
      <TransportMap traffic city={op.city} points={points} roads={trafficFeatures(visible)} selected={chosen?.id} onSelect={setSelected} label="TomTom sampled traffic segments and smart board locations" />
      <p className="ops-note">Coloured lines are fresh, matched provider road geometry. Numbered markers identify demo boards; grey markers have no usable reading. Uncoloured roads are not assessed. Opposite-direction samples can overlap.</p>
      {chosen && <section className="ops-panel transport-detail" aria-label="Selected traffic segment"><div className="ops-heading"><div><h2>#{chosen.number} · {chosen.road}</h2><p>{chosen.direction} · {chosen.heading}°</p><strong style={{ color: chosen.display.color }}>{chosen.display.label}</strong></div><button onClick={() => setSelected(null)}>Close details</button></div>{chosen.traffic?.status === 'ok' ? <><p>{Math.round(chosen.traffic.currentSpeed)} km/h average · {Math.round(chosen.traffic.freeFlowSpeed)} km/h free flow · +{Math.round(chosen.traffic.delaySeconds)} seconds on this segment.</p><p>Provider confidence {Math.round(chosen.traffic.confidence * 100)}% · fetched {stamp(chosen.traffic.fetchedAt)}</p></> : <p>{chosen.traffic?.reason ?? 'Waiting for a usable provider reading.'}</p>}<button onClick={() => onNavigate('l-alert')}>Open smart boards →</button></section>}
      <div className="ops-heading"><h2>Road samples</h2><span className="ops-tag">{visible.length} shown</span></div>
      {!visible.length && <p>No samples match this filter.</p>}
      <div className="transport-grid">{visible.map(b => <article className={`ops-panel transport-card${chosen?.id === b.id ? ' is-selected' : ''}`} key={b.id}>
        <span className="ops-tag" style={{ color: b.display.color }}>{b.display.label}</span><h3>#{b.number} · {b.road}</h3><p>{b.direction}</p>
        {b.traffic?.status === 'ok' ? <><strong className="transport-speed">{Math.round(b.traffic.currentSpeed)} <small>km/h average</small></strong><p>{Math.round(b.traffic.freeFlowSpeed)} km/h free flow · +{Math.round(b.traffic.delaySeconds)} s segment delay</p><div className="transport-speed-bar" aria-label={`${Math.round((b.traffic.ratio ?? 0) * 100)} percent of free-flow speed`}><i style={{ width: `${Math.min(100, Math.max(0, (b.traffic.ratio ?? 0) * 100))}%`, background: b.display.color }}/></div><p className="ops-note">Confidence {Math.round(b.traffic.confidence * 100)}% · fetched {stamp(b.traffic.fetchedAt)}</p></> : <p>{b.traffic?.reason ?? (op.traffic.loading ? 'Loading provider reading…' : 'No usable provider reading available.')}</p>}
        <button onClick={() => setSelected(b.id)} aria-pressed={chosen?.id === b.id}>Inspect on map</button>
      </article>)}</div>
    </>}
    <section className="ops-panel"><h2>How this connects to the boards</h2><p>The same readings drive smart-board traffic messages. Slow traffic means at most 60% of free-flow speed with at least 15 seconds of segment delay. A reading must pass confidence, position, direction and freshness checks before it can colour a road or drive a message.</p><p>Higher-priority flood, fog or closure warnings may override a congestion message. Simulated queue incidents remain in Incidents and Smart boards; this view only shows the provider traffic feed.</p><p className="ops-note">Average speeds are not speed limits. Segment delays are not journey estimates. Missing data does not indicate a clear road.</p><a href="https://www.tomtom.com/" target="_blank" rel="noreferrer">Traffic data © TomTom</a></section>
  </>;
}
