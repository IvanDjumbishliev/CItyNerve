# Cached city reports

Development and production serve `GET /api/alerts/{city}` through the same backend.
Use Node 22+ with `GROQ_API_KEY` in the server environment or local `.env`.
The browser never receives the key.

Google News RSS supplies up to six recent headlines per city. Groq's
`openai/gpt-oss-20b` extracts a small structured batch. This is headline analysis,
not a complete incident feed or a real-time emergency system. City names must
appear in headlines. Ambiguous locations remain in the list without pins.
OpenStreetMap via Photon resolves explicit names within configured city bounds;
all resulting locations are approximate. Inspect publisher links for details.

Responses, processed-headline hashes, geocoding results and quota reservations
persist in `.cache/alerts` (ignored by Git). Preserve this directory on a durable
volume. All server instances must share the same directory and filesystem locks;
independent caches cannot enforce a shared quota. Set `ALERT_CACHE_DIR` to move it.

Each city gets at most one AI attempt per 12 hours, shared by all visitors.
Failures also consume that window. There are no automatic AI retries or fallback
models. Empty feeds and unchanged headlines use no AI. Source failures retry
after 15 minutes without spending the AI slot. Refresh reloads cached results.
Analysis is requested on demand, rather than scheduled for inactive cities.

`ALERT_DAILY_TOKEN_LIMIT` defaults to 20000 across all cities per UTC day;
zero disables AI calls. Conservative reservations include maximum output and
are reconciled with reported usage after success. Provider free-tier quotas
still apply; the application does not create or guarantee a free Groq allowance.

The public Photon service is used sparingly (maximum six spaced lookups per
analysis, cached for seven days). Set `PHOTON_URL` for a self-hosted instance
when increasing coverage. Add cities through `shared/alertCities.js`, with local
language search terms and bounding boxes. Verify local source coverage first.

Run `node --test tests/alerts.test.js` to test cache limits, failures, validation,
quotas and location ambiguity without making external requests.
