import React, { useEffect, useState } from 'react';
import { PARKING_CITIES } from '../../shared/parkingCities.js';
import { distanceKm, isActive } from './engine.js';
import { operatorParkingRows, parkingCityFor } from './liveParking.js';
import { combineParking, parkingReading } from './transportView.js';
import TransportMap from './TransportMap.jsx';

const stamp = value => value ? new Date(value).toLocaleString() : 'Unavailable';
export default function ParkingPage({ op, onNavigate }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [sort, setSort] = useState('free');
  const [selected, setSelected] = useState(null), [position, setPosition] = useState(null), [locationError, setLocationError] = useState('');
  const inventory = op.parking.filter(p => p.cityId === op.city.id);
  useEffect(() => {
    setQuery(''); setFilter('all'); setSelected(null);
    if (!inventory.length && !op.parkingLoading) op.loadParking();
  }, [op.city.id]);
  // Retain facility locations when the provider returns stale data, but never show stale counts as current.
  const live = operatorParkingRows(op.city, op.liveParking.data ? { ...op.liveParking.data, stale: false } : null);
  const closures = op.incidents.filter(i => i.cityId === op.city.id && i.type === 'closure' && isActive(i, op.now));
  const rows = combineParking(live, inventory).map(p => ({ ...p,
    reading: parkingReading(p, op.now, op.liveParking.data?.stale, closures.some(i => i.parkingId && [p.id, p.osm?.id].includes(i.parkingId))),
  }));
  const visible = rows.filter(p => p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (filter === 'all' || (filter === 'live' ? p.live : filter === 'demo' ? !p.live && p.simulated : !p.live && !p.simulated)))
    .sort((a, b) => sort === 'nearest' && position ? distanceKm(a, position) - distanceKm(b, position) : sort === 'name' ? a.name.localeCompare(b.name) : sort === 'busy' ? ((b.capacity > 0 && b.reading.free !== null ? 1 - b.reading.free / b.capacity : -1) - (a.capacity > 0 && a.reading.free !== null ? 1 - a.reading.free / a.capacity : -1)) : Number(!!b.live) - Number(!!a.live) || (b.reading.free ?? -1) - (a.reading.free ?? -1));
  const facility = visible.find(p => p.key === selected);
  const points = visible.map(p => ({ ...p, id: p.key, symbol: p.reading.free === null ? 'P' : String(p.reading.free), color: p.reading.color, detail: p.reading.label }));
  const liveCount = rows.filter(p => p.reading.kind === 'live').length;
  function nearest() {
    if (!navigator.geolocation) return setLocationError('Location is unavailable. Search or select a parking facility.');
    navigator.geolocation.getCurrentPosition(p => { setPosition({ latitude: p.coords.latitude, longitude: p.coords.longitude }); setSort('nearest'); setLocationError(''); }, () => setLocationError('Location access failed. Search or select a facility instead.'), { timeout: 10000 });
  }
  function simulateAccess(p) { op.scenario('closure', p); onNavigate('l-incidents'); }
  return <>
    <section className="ops-panel">
      <div className="ops-heading"><div><h2>Find parking</h2><p>Operator availability and mapped parking locations in one place.</p></div><div className="ops-actions"><button disabled={!op.liveParking.supported || op.liveParking.loading} onClick={op.liveParking.refresh}>{op.liveParking.loading ? 'Checking availability…' : 'Refresh availability'}</button><button disabled={op.parkingLoading} onClick={op.loadParking}>{op.parkingLoading ? 'Loading locations…' : 'Reload OSM locations'}</button></div></div>
      <div className="ops-actions"><span className="ops-note">Cities with operator feeds:</span>{Object.entries(PARKING_CITIES).map(([id, c]) => <button key={id} aria-pressed={parkingCityFor(op.city) === id} onClick={() => op.selectCity({ id, label: c.name, country: id === 'sofia' ? 'Bulgaria' : id === 'ghent' ? 'Belgium' : 'Switzerland', latitude: c.center[1], longitude: c.center[0] })}>{c.name}</button>)}</div>
      <div className="ops-kpis"><div><span>Usable operator readings</span><strong>{liveCount}</strong></div><div><span>Operator-reported free spaces</span><strong>{liveCount ? rows.filter(p => p.reading.kind === 'live').reduce((n, p) => n + p.reading.free, 0) : '—'}</strong></div><div><span>OSM locations loaded</span><strong>{inventory.length}</strong></div><div><span>Occupancy demos</span><strong>{inventory.filter(p => p.simulated).length}</strong></div></div>
      {!op.liveParking.supported && <p>No operator availability feed is connected for this city. OSM locations can still be explored.</p>}
      {op.liveParking.error && <p role="status" className="ops-error">{op.liveParking.error}</p>}
      {op.parkingError && <p role="alert" className="ops-error">{op.parkingError}</p>}
      {op.parkingProgress && <p role="status">{op.parkingProgress}</p>}
      <p className="ops-note">Availability checked every minute · retrieved {stamp(op.liveParking.data?.fetchedAt)}. Counts can change before arrival. OSM locations are within 3.5 km of the selected centre and do not include live occupancy.</p>
    </section>
    <div className="transport-toolbar"><input aria-label="Search parking" placeholder="Search parking facilities…" value={query} onChange={e => setQuery(e.target.value)} /><div className="ops-actions" aria-label="Parking sources">{[['all', 'All'], ['live', 'Operator feeds'], ['inventory', 'OSM locations'], ['demo', 'Simulated']].map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><label>Sort <select value={sort} onChange={e => setSort(e.target.value)}><option value="free">Most spaces</option><option value="busy">Nearly full</option><option value="name">Name</option>{position && <option value="nearest">Nearest to me</option>}</select></label><button onClick={nearest}>Use my location</button></div>
    {locationError && <p role="status">{locationError}</p>}
    <div className="transport-legend"><span><i style={{ background: '#26977c' }}/>Operator availability</span><span><i style={{ background: '#5988bc' }}/>Location only</span><span><i style={{ background: '#a780d6' }}/>Simulated</span><span><i style={{ background: '#7c8997' }}/>Unavailable reading</span><span><i style={{ background: '#dc6b60' }}/>Full / closed / disrupted</span></div>
    <TransportMap city={op.city} points={points} selected={facility?.key} onSelect={setSelected} label="Parking locations and operator availability" />
    {facility && <section className="ops-panel transport-detail" aria-label="Selected parking"><div className="ops-heading"><div><span className="ops-tag">{facility.live ? 'OPERATOR FEED' : facility.simulated ? 'SIMULATION' : 'OSM LOCATION'}</span><h2>{facility.name}</h2><strong style={{ color: facility.reading.color }}>{facility.reading.label}</strong></div><button onClick={() => setSelected(null)}>Close details</button></div><p>Capacity: {facility.capacity ?? 'unknown'} · {facility.live ? `Opening status: ${facility.status ?? 'not supplied'}` : `Access: ${facility.access ?? 'unknown'}`}</p><p>{facility.live ? `Retrieved ${stamp(facility.fetchedAt)}. ${facility.measuredAt ? `Provider measurement: ${stamp(facility.measuredAt)}.` : 'Provider measurement time is not supplied.'}` : `Location source: OpenStreetMap. ${facility.stale ? 'Older cached location.' : ''}`}</p>{facility.osm && <p>Also matched to an OSM location by name and position.</p>}<a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${facility.latitude},${facility.longitude}`}>Directions to facility ↗</a></section>}
    <div className="ops-heading"><h2>Parking facilities</h2><span className="ops-tag">{visible.length} locations shown</span></div>
    {!visible.length && <p role="status">{op.parkingLoading || op.liveParking.loading ? 'Loading parking…' : 'No facilities match this selection.'}</p>}
    <div className="transport-grid">{visible.map(p => <article className={`ops-panel transport-card${selected === p.key ? ' is-selected' : ''}`} key={p.key}>
      <span className="ops-tag">{p.live ? 'OPERATOR FEED' : p.simulated ? 'SIMULATION' : 'OSM LOCATION'}</span><h3>{p.name}</h3><strong className="transport-reading" style={{ color: p.reading.color }}>{p.reading.label}</strong><p>Capacity: {p.capacity ?? 'unknown'}{position && sort === 'nearest' ? ` · ${distanceKm(p, position).toFixed(1)} km straight-line` : ''}</p><p className="ops-note">{p.live ? p.source : 'OpenStreetMap · location data'}{p.stale ? ' · older cached location' : ''}</p>
      <div className="ops-actions"><button onClick={() => setSelected(p.key)} aria-pressed={selected === p.key}>View on map</button><button onClick={() => simulateAccess(p)}>Demo blocked access</button></div>
      {!p.live && <details className="transport-demo"><summary>Occupancy demo controls</summary><p>Simulated counts can appear on nearby boards. They are not live availability.</p>{!p.simulated ? <button onClick={() => op.updateParking(p.id, { simulated: true, capacity: p.capacity ?? 50, capacitySource: p.capacity === null ? 'Demo assumption: 50 spaces' : p.capacitySource, occupied: Math.floor((p.capacity ?? 50) * .6) })}>Enable simulation{p.capacity == null ? ' (50 assumed spaces)' : ''}</button> : <><p>{p.capacitySource}</p><div className="ops-actions"><button disabled={p.occupied >= p.capacity} onClick={() => op.updateParking(p.id, { occupied: p.occupied + 1 })}>Vehicle enters</button><button disabled={p.occupied <= 0} onClick={() => op.updateParking(p.id, { occupied: p.occupied - 1 })}>Vehicle leaves</button><button onClick={() => op.updateParking(p.id, { simulated: false, ...(p.capacitySource?.startsWith('Demo assumption:') ? { capacity: null, capacitySource: 'Unknown', occupied: 0 } : {}) })}>Stop simulation</button></div></>}</details>}
    </article>)}</div>
    <p className="ops-note">Only a unique nearby name match combines an operator facility with an OSM entry. Other entries retain their own source identity. Access restrictions may be incomplete; verify before directing drivers.</p>
    <div className="ops-actions"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a>{op.liveParking.data?.source && <a href={op.liveParking.data.source} target="_blank" rel="noreferrer">{op.liveParking.data.attribution} · operator source</a>}</div>
  </>;
}
