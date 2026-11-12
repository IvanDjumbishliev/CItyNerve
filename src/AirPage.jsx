import React, { useMemo, useState } from 'react';
import AirScene from './air/AirScene.jsx';
import { TOWNS } from '../shared/towns.js';
import { useAirData, useAirLive, useAirRasters, useAirSites } from './useAirData.js';

const VIEW = { zoom: 11.3, pitch: 48, bearing: -18 };
const clock = (iso, timeZone) => new Date(iso).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
const minutesOld = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

/** Live view: now, the last 48 h and the forecast, for any supported town. */
export default function AirPage({ onNavigate }) {
  const [townId, setTownId] = useState('sofia');
  const town = TOWNS.find((item) => item.id === townId);
  const { data, loading, error, refresh } = useAirLive(townId);
  const analysis = useAirData();
  // The local factor comes from the Sofia pipeline run; other towns stay CAMS-only.
  const grid = townId === 'sofia' ? analysis.summary?.grid : null;
  const rasters = useAirRasters(grid);
  const sites = useAirSites(townId);
  const view = useMemo(() => ({ center: town.center, ...VIEW }), [town]);
  const live = data?.town.id === townId ? data : null;

  const notices = useMemo(() => {
    if (!live) return [];
    const list = [];
    const zone = town.timeZone;
    if (error) list.push({ key: 'server', level: 'warn', text: `Live service unreachable (${error}). Showing the snapshot from ${clock(live.generatedAt, zone)}, ${minutesOld(live.generatedAt)} min old.` });
    if (live.cams.status === 'stale') list.push({ key: 'cams', level: 'warn', text: `CAMS feed unreachable. Showing the model run fetched at ${clock(live.cams.fetchedAt, zone)} (${minutesOld(live.cams.fetchedAt)} min old).` });
    if (live.cams.status === 'unavailable') list.push({ key: 'cams', level: 'bad', text: 'CAMS model unavailable: no concentration surface or forecast can be shown.' });
    if (live.sensors.status === 'stale') list.push({ key: 'sensors', level: 'warn', text: `Sensor feed unreachable. Showing readings fetched at ${clock(live.sensors.fetchedAt, zone)} (${minutesOld(live.sensors.fetchedAt)} min old).` });
    if (live.sensors.status === 'unavailable') list.push({ key: 'sensors', level: 'bad', text: 'Citizen sensor feed unavailable: readings are not shown.' });
    else if (!live.sensors.counts.shown) list.push({ key: 'no-sensors', level: 'info', text: `No citizen sensors are reporting within ${live.sensors.radiusKm} km. CAMS-only mode: the map shows the model alone.` });
    else if (live.sensors.counts.shown < 5) list.push({ key: 'few-sensors', level: 'info', text: `Only ${live.sensors.counts.shown} citizen sensor${live.sensors.counts.shown > 1 ? 's' : ''} reporting here. The surface is the CAMS model alone.` });
    if (live.wind.status === 'unavailable') list.push({ key: 'wind', level: 'info', text: 'Wind forecast unavailable.' });
    if (townId === 'sofia' && !analysis.summary) list.push({ key: 'factor', level: 'info', text: 'Sensor-based local adjustment not generated yet (npm run data:air). The surface is the CAMS model alone.' });
    else if (townId === 'sofia' && !grid?.factor_applied) list.push({ key: 'factor', level: 'info', text: 'The surface is the CAMS model alone: the sensor-based neighbourhood adjustment failed its leave-one-out test, so it is not shown.' });
    return list;
  }, [live, error, town, townId, grid, analysis.summary]);

  return <AirScene
    mode="live" route="l-air" onNavigate={onNavigate}
    town={town} towns={TOWNS} onTown={setTownId} view={view}
    loading={loading} error={error ? `Live air service unreachable (${error}). Start the app with npm run dev or npm start.` : null}
    onRetry={refresh} notices={notices}
    lattice={live?.lattice ?? null} time={live?.time} nowIndex={live ? live.nowIndex : null}
    lastIndex={live?.cams.lastIndex ?? -1} values={live?.cams.values ?? null}
    wind={live?.wind.status !== 'unavailable' ? live?.wind : null}
    sensors={live?.sensors.items ?? null} sensorInfo={live?.sensors.items ? live.sensors : null}
    year={live?.year} rasters={rasters} sites={sites}
    hotspots={townId === 'sofia' ? analysis.hotspots : []}
  />;
}
