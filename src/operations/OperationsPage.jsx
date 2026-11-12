import React, { useMemo, useState } from 'react';
import { CITY_PRESETS, RULES, boardMessage, distanceKm, isActive } from './engine.js';
import { searchCities } from './api.js';
import OperationsMap from './OperationsMap.jsx';
import './operations.css';
const stamp = value => value ? new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—';
function CitySearch({ op }) {
  const [query, setQuery] = useState(''), [results, setResults] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function search(e) {
    e.preventDefault(); if (query.trim().length < 2) return; setBusy(true); setError('');
    try { const found = await searchCities(query.trim(), AbortSignal.timeout(15000)); setResults(found); if (!found.length) setError('No matching cities.'); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="ops-city"><div className="ops-actions">{CITY_PRESETS.map(c => <button key={c.id} onClick={() => op.selectCity(c)} aria-pressed={op.city.id === c.id}>{c.label}</button>)}</div><form onSubmit={search}><input aria-label="Search any city" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search another city…" minLength={2}/><button disabled={busy}>{busy ? 'Searching…' : 'Find city'}</button></form>{error && <p role="status">{error}</p>}{results.length > 0 && <div className="ops-results">{results.map(c => <button key={c.id} onClick={() => { op.selectCity(c); setResults([]); }}>{c.label}, {c.admin}, {c.country}</button>)}</div>}</div>;
}
export default function OperationsPage({ op, page, onNavigate }) {
  const [incidentFilter, setIncidentFilter] = useState('all');
  const overview = page === 'operations';
  const parkingPage = page === 'l-mobility';
  const incidentPage = page === 'l-incidents';
  const boardsPage = page === 'l-alert';
  const parking = useMemo(() => op.parking.filter(p => p.cityId === op.city.id), [op.parking, op.city.id]);
  const incidents = op.incidents.filter(i => i.cityId === op.city.id);
  const active = incidents.filter(i => isActive(i, op.now));
  const drafts = incidents.filter(i => i.status === 'draft');
  const incidentStatus = i => i.status === 'published' && !isActive(i, op.now) ? 'expired' : i.status;
  const shownIncidents = incidents.filter(i => incidentFilter === 'all' || incidentStatus(i) === incidentFilter);
  const disrupted = parking.filter(p => active.some(e => e.type === 'closure' && e.parkingId === p.id));
  const boards = useMemo(() => Array.from({ length: 3 }, (_, i) => {
    const p = parking[i];
    return { id: `board:${op.city.id}:${i}`, name: p ? `${p.name} approach` : `City approach ${i + 1}`, cityId: op.city.id, latitude: (p?.latitude ?? op.city.latitude) + .002 * (i + 1), longitude: (p?.longitude ?? op.city.longitude) + .003 * i, parkingId: p?.id };
  }), [parking, op.city]);
  const title = page === 'l-mobility' ? 'Mobility & parking' : page === 'l-alert' ? 'Smart boards & citizen alerts' : page === 'l-incidents' ? 'Shared incident center' : 'City operations';
  const description = overview ? 'Weather watch and a citywide response overview' : parkingPage ? 'Parking locations, occupancy simulation and access disruptions' : incidentPage ? 'Review, publish and resolve shared incidents' : 'Location-aware messages and citizen communication previews';
  const prepared = CITY_PRESETS.find(c => distanceKm(c, op.city) < 2);
  return <div className="ops-page">
    <header className="ops-header"><div><span className="eyebrow">CITYNERVE / COORDINATED RESPONSE</span><h1>{title}</h1><p>{op.city.label}, {op.city.country} · {description}</p></div><span className="ops-tag">Prototype · virtual delivery</span></header>
    <CitySearch op={op}/>
    {overview && <p className="ops-context">{prepared ? `Prepared historical flood analysis is available for ${prepared.label} in Flood map. It is background risk context, not current flooding.` : 'Weather works for this city. Detailed flood analysis has not been prepared for this area.'}</p>}
    {op.storageError && <p role="alert">{op.storageError}</p>}
    {overview && <><section className="ops-panel"><div className="ops-heading"><div><h2>Weather watch · next 24 hours</h2><p>Model forecast · automatically checked every 15 minutes · retrieved {stamp(op.weather?.fetchedAt)}</p></div><button onClick={op.refresh} disabled={op.loading}>{op.loading ? 'Fetching…' : 'Refresh weather'}</button></div>
      {op.weatherError && <p className="ops-error" role="alert">Weather unavailable: {op.weatherError}. Existing advisories expire if they are not refreshed.</p>}
      <div className="ops-kpis">{[['Peak rain', op.weather?.rainPeak, 'mm/h'], ['Accumulated rain', op.weather?.rainTotal, 'mm'], ['Lowest visibility', op.weather?.visibilityMin, 'm'], ['Peak apparent heat', op.weather?.heatMax, '°C']].map(([label, value, unit]) => <div key={label}><span>{label}</span><strong>{Number.isFinite(value) ? Math.round(value * 10) / 10 : '—'} <small>{unit}</small></strong></div>)}</div>
      <p className="ops-note">{op.stale ? 'No fresh forecast available.' : `Forecast window: ${stamp(op.weather.validFrom)} – ${stamp(op.weather.validTo)}.`} Demo rules: rain ≥{RULES.rainHour} mm/h or ≥{RULES.rainDay} mm/24h; visibility &lt;{RULES.visibility} m; apparent heat ≥{RULES.apparentTemperature}°C. These are configurable prototype thresholds, not official warning levels.</p>
      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo · CC BY 4.0</a>
    </section>
    <div className="ops-summary">
      {[['Active incidents', active.length, 'Review incident history', 'l-incidents'], ['Awaiting approval', drafts.length, 'Review draft reports', 'l-incidents'], ['Parking areas', parking.length, `${disrupted.length} with disrupted access`, 'l-mobility'], ['Virtual boards', boards.length, 'Inspect outgoing messages', 'l-alert']].map(([label, value, detail, target]) => <button className="ops-summary-card" key={label} onClick={() => onNavigate(target)}><span>{label}</span><strong>{value}</strong><small>{detail} →</small></button>)}
    </div></>}
    {(overview || parkingPage || boardsPage) && <OperationsMap city={op.city} boards={parkingPage ? [] : boards} parking={boardsPage ? [] : parking} incidents={active}/>}
    {overview && <section className="ops-panel"><div className="ops-heading"><h2>Current response</h2><button onClick={() => onNavigate('l-incidents')}>Open incident center →</button></div>{!active.length ? <p>No active advisories. Review weather above or create a demonstration report in Incidents.</p> : active.slice(0, 4).map(i => <article className="ops-incident" key={i.id}><div><h3>{i.title}</h3><span className="ops-tag">{i.evidence}</span><p>{i.source} · expires {stamp(i.expiresAt)}</p></div></article>)}</section>}
    {boardsPage && <><div className="ops-heading"><div><h2>Location-aware smart boards</h2><p>Virtual boards at illustrative approach locations. Messages use incident radius and priority; road direction and turn-by-turn routing are not modeled.</p></div><span className="ops-tag">{active.length} active incidents</span></div>
    <div className="ops-boards">{boards.map(b => { const result = boardMessage(b, incidents, parking, op.now); return <article className="ops-board-card" key={b.id}><h3>{b.name}</h3><small>{b.latitude.toFixed(4)}, {b.longitude.toFixed(4)} · demo placement</small><div className="ops-sign">{result.message}</div><span className="ops-tag">{result.evidence}</span><p>{result.source}{result.incident && ` · expires ${stamp(result.incident.expiresAt)}`}</p></article>; })}</div>
    <section className="ops-panel"><div className="ops-heading"><div><h2>Message priority</h2><p>Closure → flood risk → low visibility → heat → parking → routine information. Draft and expired incidents are excluded.</p></div><button onClick={() => onNavigate('l-incidents')}>Manage incidents →</button></div></section></>}
    {parkingPage && <section className="ops-panel"><h2>Parking inventory</h2><p>Real OSM locations within 3.5 km. Occupancy is unknown until you enable a simulation. Access restrictions may be incomplete; verify before directing drivers.</p><button disabled={op.parkingLoading} onClick={op.loadParking}>{op.parkingLoading ? 'Loading parking…' : 'Load / reload OSM parking'}</button>{op.parkingError && <p role="alert" className="ops-error">{op.parkingError}</p>}{!parking.length && <p>No parking loaded. No availability is invented.</p>}
      {!op.parkingError && op.parkingProgress && <p role="status" aria-live="polite">{op.parkingProgress}</p>}
      {parking.slice(0, 8).map(p => { const blocked = active.some(e => e.type === 'closure' && e.parkingId === p.id); return <article className="ops-parking" key={p.id}><h3>{p.name}</h3><p>Access: {p.access} · Capacity: {p.capacity ?? 'unknown'} ({p.capacitySource})</p>{p.fetchedAt && <p>Location retrieved {stamp(p.fetchedAt)} · {p.provider}</p>}<strong>{blocked ? 'Access disrupted · simulated closure' : p.simulated ? `${p.capacity - p.occupied} / ${p.capacity} spaces · SIMULATED` : 'Availability unknown'}</strong><div className="ops-actions">{!p.simulated ? <button onClick={() => op.updateParking(p.id, { simulated: true, capacity: p.capacity ?? 50, capacitySource: p.capacity === null ? 'Demo assumption: 50 spaces' : p.capacitySource, occupied: Math.floor((p.capacity ?? 50) * .6) })}>Enable occupancy simulation</button> : <><button disabled={p.occupied >= p.capacity} onClick={() => op.updateParking(p.id, { occupied: Math.min(p.capacity, p.occupied + 1) })}>Vehicle enters</button><button disabled={p.occupied <= 0} onClick={() => op.updateParking(p.id, { occupied: Math.max(0, p.occupied - 1) })}>Vehicle leaves</button></>}<button onClick={() => op.scenario('closure', p)}>Simulate blocked access</button></div></article>; })}
      {parking.length > 8 && <p>Showing 8 of {parking.length} parking areas; up to 40 shown on map.</p>}<a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors · ODbL</a>
      <p>Blocked-access simulations create draft incidents. Publish them in the incident center to update board messages.</p><button onClick={() => onNavigate('l-incidents')}>Review access incidents →</button>
    </section>}
    {boardsPage && <section className="ops-panel"><h2>Citizen preview</h2><div className="ops-phone"><small>CITYNERVE · IN-APP PREVIEW</small>{active.length ? active.map(i => <article key={i.id}><strong>{i.title}</strong><p>{i.message.replaceAll('\n', ' · ')}</p><small>{i.evidence} · {i.source} · {stamp(i.observedAt)}</small></article>) : <p>No active advisories for this city.</p>}</div><p className="ops-note">No SMS, push notification, BG-ALERT or physical board is contacted. Preview is city-level; personal subscriptions are not implemented.</p></section>}
    {incidentPage && <><section className="ops-panel"><h2>Scenario laboratory</h2><p>Simulated reports require operator publication. They do not claim that flooding has been observed.</p><div className="ops-actions"><button onClick={() => op.scenario('flood')}>Simulate flood report</button><button onClick={() => op.scenario('closure')}>Simulate road closure</button></div></section>
    <section className="ops-panel"><h2>Incident history · {op.city.label}</h2><p>Forecast advisories publish automatically; local simulated reports await operator approval. Publishing or resolving an incident updates boards and citizen previews.</p>
      <div className="ops-actions ops-filters" aria-label="Filter incidents">{['all', 'draft', 'published', 'resolved', 'expired'].map(status => <button key={status} aria-pressed={incidentFilter === status} onClick={() => setIncidentFilter(status)}>{status === 'published' ? 'Active' : status[0].toUpperCase() + status.slice(1)}</button>)}</div>
      {!incidents.length && <p>No incidents. If forecast thresholds are not crossed, boards retain routine information.</p>}
      {!!incidents.length && !shownIncidents.length && <p>No incidents match this filter.</p>}
      {shownIncidents.map(i => <article className="ops-incident" key={i.id}><div><h3>{i.title}</h3><span className="ops-tag">{i.evidence}</span> <span>{incidentStatus(i)}</span><p>{i.source} · {stamp(i.observedAt)} · expires {stamp(i.expiresAt)}</p>{i.context && <p>Historical model context: {i.context}</p>}<small>{i.scope ?? 'Local simulated incident; approximate impact radius.'}</small></div><div className="ops-actions">{i.status === 'draft' && <button onClick={() => op.setIncidentStatus(i.id, 'published')}>Approve & publish demo</button>}{['draft', 'published'].includes(i.status) && <button onClick={() => op.setIncidentStatus(i.id, 'resolved')}>Resolve</button>}</div></article>)}
      <button onClick={() => onNavigate('l-alert')}>Inspect board & citizen messages →</button>
    </section></>}
  </div>;
}
