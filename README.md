# CityNerve — Hackathon UI Starter

A responsive React + Vite interface for a modular European smart-city platform.

## Start

Requires Node.js 20.19+ or 22+ (compatible with Vite 6).

```bash
npm install
npm run dev
```

Open the localhost URL printed by Vite (usually http://localhost:5173).

Production build:

```bash
npm run build
npm run preview
```

## Included

- Responsive control-center dashboard and navigation
- Five module pages: FloodNerve, FogNerve, HeatNerve, MobilityNerve, AlertNerve
- City selector: Michalovce, Bratislava, Valencia, Rotterdam
- Illustrative city map with clickable module pins (not geographic mapping)
- Incident center with severity filters
- Scenario buttons that generate synthetic incidents
- Device registry placeholders and settings page
- Dark UI using plain CSS and `lucide-react`

## Important: sample data

This starter is a **frontend-only prototype**. All readings, incidents, device statuses, and map geometry are illustrative. No weather API, satellite feed, database, municipal system, or actual ESP32 hardware is connected yet. Incident changes live in React state and reset on page reload. A scenario triggers an event in the UI; it does **not** activate a real barrier or send actual emergency messages.

## Where to start integrating

1. `src/data.js` holds initial city configs, modules, sample incidents and scenarios.
2. `src/App.jsx` holds the current UI, navigation and incident state.
3. Create `src/services/weather.js` to request weather forecasts by city.
4. Create `src/services/api.js` to talk to a Cloudflare Worker / D1 backend.
5. Move incident generation into an API backed by D1; retain demo scenarios separately.
6. Replace the illustrative SVG map with Leaflet and OpenStreetMap tiles.
7. Add ESP32 telemetry via a backend endpoint (never expose control secrets in the frontend).

## Suggested initial API contract

- `GET /api/cities`
- `GET /api/weather?cityId=michalovce`
- `GET /api/incidents?cityId=michalovce`
- `POST /api/events` (authenticated / validated)
- `GET /api/devices?cityId=michalovce`
- `POST /api/demo/scenarios` (restricted to demo environment)

## Recommended next step

Build CityNerve Core + AlertNerve first (shared events and incident database), then FloodNerve. The five tabs can be implemented independently after shared event schemas are stable.

## Safety

This starter is not intended for safety-critical operations, official flood or fog warnings, or autonomous control of real infrastructure. Any physical-barrier demo should use a miniature model with local interlocks and an easily accessible power cut-off.
