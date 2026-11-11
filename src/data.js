// FloodNerve · Sofia — static configuration.
// All flood results are loaded at runtime from /public/data, produced by the
// Python pipeline in /pipeline from real NASA inputs (see pipeline/README.md).

export const CITY = {
  id: 'sofia',
  label: 'Sofia',
  country: 'Bulgaria',
  center: [23.326, 42.692],
  zoom: 12.2,
  pitch: 60,
  bearing: -24,
};

export const RISK = {
  critical: { label: 'Critical', color: '#F2594B' },
  high:     { label: 'High',     color: '#F39237' },
  moderate: { label: 'Moderate', color: '#E8C547' },
  low:      { label: 'Low',      color: '#57C48E' },
};
// Score 0–100 from the model: depth (35%), how often it floods (40%), built-up area hit (25%).
export const riskLevel = (score) => score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 45 ? 'moderate' : 'low';

export const CAUSE = {
  river: 'River overflow',
  ponding: 'Runoff ponding in a low point',
};

export const PIPELINE = [
  { step: '01', title: 'Correct terrain with lidar', text: 'SRTM elevation is compared with ICESat-2 ground photons; the roof and canopy bias is measured and removed.' },
  { step: '02', title: 'Route water', text: 'Depressions filled (Priority-Flood), D8 flow directions, flow accumulation, river network and height above nearest drainage.' },
  { step: '03', title: 'Find real storms', text: 'GPM IMERG daily rain spread to hours with MERRA-2; storms kept only if ERA5 independently confirms them.' },
  { step: '04', title: 'Runoff & overflow', text: 'SCS curve number from land cover and the soil wetness on the day; river stage by Manning above bankfull; ponding in robust low points.' },
  { step: '05', title: 'Score problem spots', text: 'Depth × frequency over all confirmed storms × built-up area flooded, named from OpenStreetMap.' },
];
