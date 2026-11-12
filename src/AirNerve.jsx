import React, { useMemo, useState } from 'react';
import { Building2, CircleAlert, HeartPulse, Info, Loader2, School, TriangleAlert, Users } from 'lucide-react';
import AirScene, { KindTag } from './air/AirScene.jsx';
import ModuleTabs from './ModuleTabs.jsx';
import { useAirData, useAirRasters, useAirSites } from './useAirData.js';
import { TOWNS } from '../shared/towns.js';
import { BANDS, POLLUTANTS, SENSOR_QC, UNIT } from '../shared/air.js';

const TZ = 'Europe/Sofia';
const SOFIA = TOWNS.find((town) => town.id === 'sofia');
const VIEW = { center: [23.326, 42.692], zoom: 11.6, pitch: 50, bearing: -20 };
const fmtDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fix = (value, digits = 1) => (value == null ? '—' : Number(value).toFixed(digits));
const rgb = (colour) => `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`;
const RISK = (score) => (score >= 80 ? 'Critical' : score >= 60 ? 'High' : score >= 40 ? 'Moderate' : 'Low');

function AirDataState({ loading, error }) {
  return <div className="data-state glass">
    {loading
      ? <><Loader2 size={18} className="spin" /> Loading the Sofia air analysis…</>
      : <><TriangleAlert size={18} /><span>Air analysis unavailable ({error}). Run <code>npm run data:air</code> to fetch the inputs and generate the outputs. No episodes or statistics are fabricated. The Live view works without it.</span></>}
  </div>;
}

function RiskBadge({ score }) {
  return <span className={`risk-badge rb-${RISK(score).toLowerCase()}`}><CircleAlert size={12} />{RISK(score)}<b>{score}</b></span>;
}

/* ── Analysis › Map: historical episodes ── */
function AirMapPage({ data, onNavigate }) {
  const { summary, events, hotspots } = data;
  const [selected, setIndex] = useState(null);
  const rasters = useAirRasters(summary?.grid);
  const sites = useAirSites('sofia');
  const ordered = useMemo(() => events.slice().reverse(), [events]); // newest first in the list
  const index = selected ?? 0;
  const episode = ordered[index] ?? null;
  const panelExtra = episode && <div className="air-episode">
    <h3>Episode {episode.id} <KindTag kind="modelled" /></h3>
    <p><b>{episode.days}</b> day{episode.days > 1 ? 's' : ''} above the WHO 24-hour PM2.5 guideline · {fmtDate(episode.start)} – {fmtDate(episode.end)}</p>
    <p>Worst day {fmtDate(episode.peak_day)}: <b>{fix(episode.peak_day_pm25)}</b> {UNIT} PM2.5 (24 h mean at the city centre)</p>
    {episode.mean_wind_ms != null && <p>Mean wind during the window: {fix(episode.mean_wind_ms)} m/s</p>}
    {episode.cause_hints.map((hint) => <p key={hint}>{hint}</p>)}
    <p className="muted">Playback shows the {episode.window.note}. Concentrations are the CAMS model; the colour surface adds the local factor.</p>
  </div>;
  return <AirScene
    mode="analysis" route="air-map" onNavigate={onNavigate} town={SOFIA} view={VIEW}
    loading={data.loading} error={summary ? (events.length ? null : 'No pollution episodes in this record.') : data.error}
    lattice={episode?.lattice ?? null} time={episode?.time ?? []} lastIndex={episode ? episode.time.length - 1 : -1}
    values={episode?.values ?? null} wind={episode?.wind ?? null} rasters={rasters} sites={sites} hotspots={hotspots}
    episodes={ordered} episodeIndex={index} onEpisode={setIndex}
    timelineNote={episode ? `Episode ${episode.id} · historical model replay` : ''} panelExtra={panelExtra}
  />;
}

/* ── Analysis › Risk register ── */
function AirRegisterPage({ data, onNavigate }) {
  const { summary, riskRegister, events } = data;
  if (!summary) return <div className="page air-theme"><ModuleTabs module="air" route="air-register" onNavigate={onNavigate} /><AirDataState loading={data.loading} error={data.error} /></div>;
  const complete = summary.years.filter((year) => year.complete);
  const latest = complete.at(-1);
  const who = summary.thresholds.who_pm25_24h.value;
  const eu = summary.thresholds.eu_pm10_24h;
  const measured = summary.register_basis === 'measured';
  return <div className="page air-theme">
    <ModuleTabs module="air" route="air-register" onNavigate={onNavigate} />
    <header className="page-head">
      <span className="eyebrow">Sofia · {summary.period.start} – {summary.period.end}</span>
      <h1>Air pollution risk register</h1>
      {measured
        ? <p>Citizen-sensor locations that read highest relative to the CAMS model on {summary.sensors.days.length} sample days in winter and summer 2026, with the schools, kindergartens, hospitals and care homes within 500 m. A sensor-based neighbourhood model was built and tested, but it did not predict held-out sensors, so neighbourhoods are not ranked from it.</p>
        : <p>Neighbourhoods ranked by long-term PM2.5, days above the WHO guideline and the schools, kindergartens, hospitals and care homes nearby. Only places with enough citizen sensors are ranked; elsewhere the model cannot separate neighbourhoods.</p>}
    </header>
    <div className="page-kpis">
      <div className="kpi"><span className="kpi-label">Pollution episodes</span><span className="kpi-value">{summary.episode_count}</span><span className="kpi-note">runs of days above {who} {UNIT} · worst {events.length} kept</span></div>
      {latest && <div className="kpi"><span className="kpi-label">PM2.5 days above WHO, {latest.year}</span><span className="kpi-value">{latest.pm25_days_above_who}</span><span className="kpi-note">of {latest.days_with_data} days · CAMS model</span></div>}
      {latest && <div className="kpi"><span className="kpi-label">PM10 days above EU limit, {latest.year}</span><span className="kpi-value">{latest.pm10_days_above_eu_limit}</span><span className="kpi-note">{eu.value} {UNIT}; {eu.allowed_per_year} allowed per year</span></div>}
      <div className="kpi"><span className="kpi-label">Ranked places</span><span className="kpi-value">{riskRegister.length}</span><span className="kpi-note">{measured ? `measured · ${summary.sensors.used} screened sensors` : `${Math.round(summary.grid.share_sensor_informed * 100)}% of the area is sensor-informed`}</span></div>
    </div>
    <div className="list-head wide"><h4>Yearly exceedance days at the city centre</h4><span>CAMS model · <KindTag kind="modelled" /></span></div>
    <div className="air-years">{summary.years.map((year) => <div key={year.year}>
      <b>{year.pm25_days_above_who}</b><span>PM2.5 days &gt; {who} {UNIT}</span>
      <span>{year.pm10_days_above_eu_limit} PM10 days &gt; {eu.value} · mean PM2.5 {fix(year.pm25_mean)}</span>
      <small>{year.year}{year.complete ? '' : ` · partial (${year.days_with_data} days)`}</small>
    </div>)}</div>
    <div className="table-wrap">
      <table className="reg-table air-register-table">
        <thead><tr><th>Place</th><th>Rank</th><th className="num">{measured ? 'Median PM2.5' : 'Mean PM2.5'}</th><th className="num">{measured ? 'vs city median' : 'Days > WHO / yr'}</th><th>Worst day</th><th className="num">Sites ≤ 500 m</th><th>Nearby sites</th><th>Confidence</th><th>Likely cause</th></tr></thead>
        <tbody>{riskRegister.map((row) => <tr key={row.id}>
          <td><strong>{row.name}</strong><small>{row.id} · {row.district} · <KindTag kind={row.basis ?? 'derived'} /></small></td>
          <td><RiskBadge score={row.score} /><span className="score-bar"><i style={{ width: `${row.score}%` }} /></span></td>
          <td className="num mono">{fix(row.mean_pm25)}{measured && row.hours ? <small>{row.hours} h</small> : null}</td>
          <td className="num mono">{measured ? (row.ratio_to_city == null ? '—' : `${fix(row.ratio_to_city, 2)}×`) : fix(row.pm25_days_above_who_per_year, 0)}</td>
          <td className="mono">{fmtDate(row.worst_day)}</td>
          <td className="num mono">{row.sites_within_500m}</td>
          <td>{row.site_names.length ? row.site_names.slice(0, 3).join(', ') : '—'}</td>
          <td>{row.confidence_level}</td>
          <td>{row.cause_hint ?? '—'}</td>
        </tr>)}
        {!riskRegister.length && <tr><td colSpan="9">No place has enough citizen sensors to be ranked in this run.</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="foot-note"><Info size={13} /> {measured
      ? <><KindTag kind="measured" /> Values are screened citizen-sensor medians over the sample hours (humid hours removed), ranked by their ratio to CAMS relative to the city median. Individual low-cost sensors differ in calibration: a row is "medium" confidence only when another sensor within 1 km also reads high. </>
      : <><KindTag kind="derived" /> Mean PM2.5 and exceedance days are the fused screening surface (CAMS × local factor), not measurements. </>}
      Cause hints appear only when the sensor data show them. This is a screening estimate, not an official air-quality assessment or a health warning.</p>
  </div>;
}

function Scores({ title, value, note }) {
  return <div>
    <h3>{title}</h3>
    {value ? <dl>
      <div><dt>MAE</dt><dd>{value.mae} {UNIT}</dd></div>
      <div><dt>Bias</dt><dd>{value.bias > 0 ? '+' : ''}{value.bias} {UNIT}</dd></div>
      <div><dt>Correlation r</dt><dd>{value.r}</dd></div>
      <div><dt>Pairs</dt><dd>{value.n.toLocaleString('en')}</dd></div>
    </dl> : <p className="muted">Not enough overlapping data.</p>}
    {note && <small>{note}</small>}
  </div>;
}

/* ── Analysis › Data & model ── */
function AirSourcesPage({ data, onNavigate }) {
  const { summary } = data;
  if (!summary) return <div className="page air-theme"><ModuleTabs module="air" route="air-sources" onNavigate={onNavigate} /><AirDataState loading={data.loading} error={data.error} /></div>;
  const v = summary.validation;
  const ref = summary.reference;
  const urban = ref.stations?.filter((station) => station.area === 'urban') ?? [];
  const t = summary.thresholds;
  const inputs = [
    { kind: 'Modelled', name: 'CAMS European air quality (ENSEMBLE)', agency: 'Copernicus Atmosphere Monitoring Service via Open-Meteo', live: true,
      role: `Hourly PM2.5, PM10, NO₂, O₃ and SO₂ on a 0.1° lattice since ${summary.period.start}. ${summary.sources.cams_note}`, resolution: '0.1° (~11 km), hourly', cadence: 'Daily model runs, 4-day forecast' },
    { kind: 'Measured', name: 'Sensor.Community citizen sensors', agency: 'Sensor.Community contributors · ODbL', live: summary.sensors.used > 0,
      role: `${summary.sensors.used} of ${summary.sensors.sample_nodes} sampled Sofia nodes passed screening on ${summary.sensors.days.length} sample days (${summary.sensors.files_found} of ${summary.sensors.files_requested} archive files, ${summary.sensors.archive_mb} MB).`, resolution: 'Point, ~2.5 min', cadence: 'Live every 5 min; daily archive' },
    { kind: 'Measured', name: 'EEA official monitoring stations', agency: 'European Environment Agency · reported by Bulgaria', live: ref.status === 'available',
      role: ref.status === 'available' ? `Independent check: ${ref.stations.length} station series (provisional E2a data).` : `Not available in this run. ${ref.reason ?? ''}`, resolution: 'Station, hourly', cadence: 'Up-to-date (E2a)' },
    { kind: 'Modelled', name: 'ERA5 wind and humidity', agency: 'ECMWF via Open-Meteo', live: true,
      role: 'Wind arrows during episodes; humidity for sensors without their own humidity sensor.', resolution: '~25 km, hourly', cadence: 'Reanalysis' },
    { kind: 'Map data', name: 'Schools, kindergartens, hospitals, clinics, care homes', agency: 'OpenStreetMap contributors via Overpass', live: Boolean(summary.sources.sites),
      role: summary.sources.sites ? `${summary.sources.sites_count} sites in the study area, used for exposure and ranking.` : 'Overpass could not be reached; site exposure is unavailable, not zero.', resolution: 'Points', cadence: 'Community-updated' },
    { kind: 'Satellite', name: 'Sentinel-5P TROPOMI NO₂', agency: 'ESA / Copernicus via Planetary Computer', live: false,
      role: summary.sources.satellite, resolution: 'Not used', cadence: 'Not used' },
  ];
  const steps = [
    ['01', 'Model background', 'Five years of hourly CAMS concentrations on the 0.1° lattice; the browser interpolates bilinearly between lattice points.'],
    ['02', 'Screen the sensors', `Drop indoor nodes, readings outside 0–${SENSOR_QC.maxPm} ${UNIT}, PM2.5 above PM10, stuck values (${summary.sensors.qc_rules.stuck_run} identical in a row) and every reading above ${summary.sensors.qc_rules.humidity_max_pct}% humidity, where optical sensors count droplets. Hourly medians need ${summary.sensors.qc_rules.min_readings_per_hour}+ readings.`],
    ['03', 'Local factor', summary.model.local_factor],
    ['04', 'Validate', 'Leave each sensor out, rebuild the factor from the others and score the fused estimate against it. Compare the model and the sensors with the official station.'],
    ['05', 'Episodes and hotspots', `Episodes are runs of days with a 24-hour mean above the WHO guideline. ${summary.model.hotspot_score}.`],
  ];
  return <div className="page air-theme">
    <ModuleTabs module="air" route="air-sources" onNavigate={onNavigate} />
    <header className="page-head">
      <span className="eyebrow">Model, sensors and official stations</span>
      <h1>Air data &amp; model</h1>
      <p>A screening estimate, not an official air-quality assessment or a health warning. CAMS is a model at about 11 km. Citizen sensors are indicative, not reference-grade. The fused surface combines both and is labelled <KindTag kind="derived" /> everywhere it appears.</p>
    </header>
    <div className="air-validation glass">
      <div>
        <span className="eyebrow">Validation</span>
        <h2>{v.sensors} sensors, leave-one-out</h2>
        <p>{v.method}</p>
        {v.spatial_pattern_r != null && <p>Spatial skill: the factor rebuilt without a sensor correlates with that sensor's own ratio at r = {v.spatial_pattern_r} (needed: {summary.grid.min_spatial_skill}).</p>}
        <p className={summary.grid.factor_applied ? '' : 'air-verdict'}><b>Local factor {summary.grid.factor_applied ? 'applied' : 'not applied'}.</b> {summary.grid.factor_applied ? '' : 'Too few sensors on too few sample days, and differences between individual sensors, outweigh real neighbourhood differences. The map shows CAMS alone; a longer archive sample or co-located calibration against the official station would be the next step.'}</p>
        <p>Median sensor-to-CAMS ratio: {fix(summary.sensors.median_sensor_to_cams_ratio, 2)}. The factor design removes this city-wide offset and keeps the CAMS level.</p>
      </div>
      <div className="air-validation-grid">
        <Scores title="CAMS vs citizen sensors (hourly)" value={v.cams_vs_sensor} note="Model only, at each sensor's position." />
        <Scores title="Fused vs citizen sensors (hourly, LOSO)" value={v.fused_vs_sensor_loso} note="CAMS × factor built without that sensor." />
        {urban.map((station) => <React.Fragment key={station.sampling_point}>
          <Scores title={`CAMS vs ${station.station} ${station.pollutant} (daily)`} value={station.cams_centre_vs_station_daily}
            note={`Official ${station.type} ${station.area} station, ${station.period[0]} – ${station.period[1]}. Model at the city centre.`} />
          {station.pollutant === 'PM2.5' && <Scores title={`Sensors vs ${station.station} PM2.5 (daily)`} value={station.sensor_city_median_vs_station_daily}
            note={`City-wide median of screened sensors on ${station.sensor_days} sample days.`} />}
        </React.Fragment>)}
        {ref.status !== 'available' && <div><h3>Official reference</h3><p className="muted">Not validated against reference monitors in this run. {ref.reason}</p></div>}
      </div>
    </div>
    {ref.status === 'available' && <p className="foot-note"><Info size={13} /> {ref.note}</p>}
    <ol className="pipeline air-pipeline">{steps.map(([step, title, text]) => <li key={step}><span className="mono step">{step}</span><h3>{title}</h3><p>{text}</p></li>)}</ol>
    <div className="list-head wide"><h4>Thresholds</h4><span>Every value with its source</span></div>
    <div className="table-wrap">
      <table className="reg-table air-threshold-table">
        <thead><tr><th>Threshold</th><th className="num">Value</th><th>Source</th></tr></thead>
        <tbody>
          {Object.entries(t).map(([key, item]) => <tr key={key}>
            <td>{key.replace(/_/g, ' ').replace('pm25', 'PM2.5').replace('pm10', 'PM10').replace('no2', 'NO₂').replace('who', 'WHO').replace('eu', 'EU').replace('24h', '24-hour').replace('year', 'annual')}</td>
            <td className="num mono">{item.value} {UNIT}{item.allowed_per_year ? <small>{item.allowed_per_year} days allowed</small> : null}</td>
            <td>{item.source}</td>
          </tr>)}
          {['pm25', 'pm10', 'no2', 'o3', 'so2'].map((key) => <tr key={key}>
            <td>EEA index bands · {POLLUTANTS[key].label}</td>
            <td className="num mono">{POLLUTANTS[key].limits.join(' / ')}</td>
            <td><span className="air-band-cell">{BANDS.map((band) => <i key={band.id} style={{ background: rgb(band.colour) }} title={band.label} />)}</span> European Air Quality Index, airindex.eea.europa.eu (upper limits of Good … Very poor)</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="list-head wide"><h4>Inputs and provenance</h4><span>{inputs.filter((input) => input.live).length} available</span></div>
    <div className="source-grid">{inputs.map((input) => <article key={input.name} className="source-card">
      <div className="source-top"><span className="source-kind">{input.kind}</span><span className={`st st-${input.live ? 'live' : 'research'}`}>{input.live ? 'Available' : 'Not used'}</span></div>
      <h3>{input.name}</h3><span className="source-agency">{input.agency}</span><p>{input.role}</p>
      <div className="source-meta"><span><b>Resolution</b>{input.resolution}</span><span><b>Cadence</b>{input.cadence}</span></div>
    </article>)}</div>
    <div className="list-head wide"><h4>Limits</h4><span>Read before using the numbers</span></div>
    <ul className="limits air-limits">
      <li>CAMS is a regional model at about 11 km. It cannot see a single street, chimney or junction; the local factor redistributes it using sensors, it does not add new sources.</li>
      <li>Citizen sensors are low-cost optical counters. They read differently from reference monitors, especially in humid air, and their placement is not controlled. Readings above {summary.sensors.qc_rules.humidity_max_pct}% humidity are discarded for the model and flagged on the Live map.</li>
      {summary.grid.factor_applied
        ? <><li>The local factor comes from {summary.sensors.days.length} sample days in 2026 and today's reporting sensors. It is static: it does not change with the season, the wind or the hour.</li>
            <li>Where fewer than three sensors lie within 2 km the map shows the model alone (hatched). Hotspots are only ranked in sensor-informed areas, so quiet parts of the city with no sensors are not "clean", they are unknown.</li></>
        : <><li>The sensor-based local factor was built from {summary.sensors.used} sensors on {summary.sensors.days.length} sample days and rejected by its own leave-one-out test, so the map cannot separate neighbourhoods: within Sofia it shows the ~11 km model only.</li>
            <li>The register lists measured sensor locations. Places without a sensor are not "clean", they are unknown, and one high sensor may be a calibration difference rather than a real hotspot.</li></>}
      <li>Episode and exceedance counts use CAMS at the city centre. They are not a legal compliance assessment, which needs official monitoring stations.</li>
      <li>{summary.traffic_signal.no2_weekday_vs_weekend_rush_ratio != null ? `CAMS NO₂ is ${summary.traffic_signal.no2_weekday_vs_weekend_rush_ratio}× higher on weekday mornings than weekend mornings at the city centre, a city-wide traffic signal; it is not resolved per street.` : 'No traffic signal could be computed.'}</li>
      <li>{summary.sources.satellite}</li>
    </ul>
    <div className="list-head wide"><h4>Who it is for</h4><span>Decision support only</span></div>
    <div className="outputs air-audiences">
      <div><Building2 size={22} /><h3>City staff</h3><p>See which schools, kindergartens and hospitals sit in the worst air during episodes, and where more sensors would reduce the uncertainty.</p></div>
      <div><School size={22} /><h3>Schools and kindergartens</h3><p>Plan outdoor activities around the forecast's worst hours; check the official EEA index before acting.</p></div>
      <div><HeartPulse size={22} /><h3>Residents</h3><p>Use the EEA health messages for sensitive groups. This tool is not a health warning.</p></div>
      <div><Users size={22} /><h3>Citizen-sensor community</h3><p>The confidence map shows where a new sensor adds the most information.</p></div>
    </div>
    <p className="foot-note"><Info size={13} /> Generated {fmtDate(summary.generated)}. CAMS / Copernicus Atmosphere Monitoring Service · Open-Meteo (CC BY 4.0) · Sensor.Community (ODbL) · EEA · © OpenStreetMap contributors.</p>
  </div>;
}

export default function AirNerve({ page, onNavigate }) {
  const data = useAirData();
  if (page === 'air-register') return <AirRegisterPage data={data} onNavigate={onNavigate} />;
  if (page === 'air-sources') return <AirSourcesPage data={data} onNavigate={onNavigate} />;
  return <AirMapPage data={data} onNavigate={onNavigate} />;
}
