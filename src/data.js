export const CITIES = [
  { id: 'michalovce', label: 'Michalovce', country: 'Slovakia', region: 'Košice Region', temperature: 12, rainfall: 18, visibility: 640, occupancy: 68 },
  { id: 'bratislava', label: 'Bratislava', country: 'Slovakia', region: 'Bratislava Region', temperature: 15, rainfall: 8, visibility: 1400, occupancy: 84 },
  { id: 'valencia', label: 'Valencia', country: 'Spain', region: 'Valencian Community', temperature: 26, rainfall: 5, visibility: 6000, occupancy: 79 },
  { id: 'rotterdam', label: 'Rotterdam', country: 'Netherlands', region: 'South Holland', temperature: 11, rainfall: 23, visibility: 950, occupancy: 72 },
];

export const MODULES = [
  { id: 'flood', name: 'FloodNerve', description: 'Flood monitoring & barrier coordination', color: 'blue', sensor: 'Water-level station', unit: 'mm', value: '18' },
  { id: 'fog', name: 'FogNerve', description: 'Visibility sensing & road warnings', color: 'purple', sensor: 'Visibility monitor', unit: 'm', value: '640' },
  { id: 'heat', name: 'HeatNerve', description: 'Thermal risk & public cooling', color: 'orange', sensor: 'Heat monitoring', unit: '°C', value: '12' },
  { id: 'mobility', name: 'MobilityNerve', description: 'Traffic disruptions & smart parking', color: 'teal', sensor: 'Parking network', unit: '%', value: '68' },
  { id: 'alert', name: 'AlertNerve', description: 'Coordinated public communication', color: 'rose', sensor: 'Communication network', unit: 'events', value: '3' },
];

export const INITIAL_INCIDENTS = [
  { id: 'CN-1042', type: 'flood', title: 'Elevated rainfall forecast', location: 'Riverside district', severity: 'medium', status: 'Monitoring', time: '09:42', source: 'Sample data' },
  { id: 'CN-1041', type: 'fog', title: 'Reduced visibility reported', location: 'Northern approach', severity: 'low', status: 'Acknowledged', time: '09:18', source: 'Sample data' },
  { id: 'CN-1040', type: 'mobility', title: 'Parking zone approaching capacity', location: 'Central district', severity: 'low', status: 'Monitoring', time: '08:56', source: 'Sample data' },
];

export const SCENARIOS = {
  flood: { title: 'Flood response scenario', severity: 'high', location: 'Riverside district', description: 'Water-level threshold exceeded. Road access and barrier preparation requested.', effects: ['FloodNerve: water level critical', 'MobilityNerve: riverside route flagged', 'AlertNerve: public advisory drafted'] },
  fog: { title: 'Dense fog scenario', severity: 'medium', location: 'Northern approach', description: 'Simulated low visibility detected near a main road.', effects: ['FogNerve: warning sign enabled', 'MobilityNerve: low-visibility road flagged', 'AlertNerve: driver advisory drafted'] },
  heat: { title: 'Extreme heat scenario', severity: 'high', location: 'Central district', description: 'Simulated heat risk elevated across exposed urban areas.', effects: ['HeatNerve: heat risk elevated', 'AlertNerve: cooling guidance drafted'] },
  parking: { title: 'Parking capacity scenario', severity: 'medium', location: 'Central district', description: 'Simulated parking occupancy reaches capacity.', effects: ['MobilityNerve: parking availability low', 'AlertNerve: information advisory drafted'] },
};
