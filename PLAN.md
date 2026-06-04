# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-04T21:05:00Z
Last run: #158 — Lens: Data pipeline integrity

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Sanitize AI result before `dangerouslySetInnerHTML` in `AnalysisView.tsx` | UX/Security | H | L | 7 | Open |
| 2 | Add retry+backoff to Rust `PurpleAirClient::fetch_sensors` | Data pipeline | H | L | 8 | Open |
| 3 | Redis-down skips all PurpleAir/earthquake polling — default toggle to ON when Redis unavailable | Data pipeline | H | L | 8 | Open |
| 4 | Propagate `sessionId` through chat calls in `aiService.ts` | TS↔Py contract | H | L | 6 | Open |
| 5 | `GET /api/maps-config` exposes Google Maps API key to unauthenticated callers | Security | H | L | 9 | Open |
| 6 | `POST /api/predict/train` is unauthenticated — any client can trigger expensive model retraining | Security | H | L | 9 | Open |
| 7 | No logging configuration in analytics `main.py` — all `logger.info/debug` calls silently dropped | Observability | H | L | 10 | Open |
| 8 | Health checks return static `"ok"` without probing DB or Redis — failing containers pass healthcheck | Observability | H | L | 10 | Open |
| 9 | `/api/predictive-analysis` and `/api/weather-forecast` have no auth or rate limiting — any public caller can burn Anthropic credits | Security/LLM | H | L | 13 | Open |
| 10 | `context.py:394` SELECT uses `unit` instead of `units` — water-level data silently absent from all Claude system prompts | Data pipeline | H | L | 113 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #158 — 2026-06-04 — Lens: Data pipeline integrity
**Scope:** Fourteenth data pipeline integrity pass. Files examined in full: `geointellisense-ingestion/src/purpleair.rs`; `geointellisense-ingestion/src/usgs.rs`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/main.rs`; `geointellisense-ingestion/src/db/persist.rs`; `geointellisense-analytics/app/routes/fires.py`; `geointellisense-analytics/app/routes/epa_aqi.py`; `geointellisense-analytics/app/routes/airnow.py`; `geointellisense-analytics/app/routes/water.py`; `geointellisense-analytics/app/routes/earthquakes.py`; `geointellisense-analytics/app/clients/nasa_firms.py`; `geointellisense-analytics/app/cache.py`; `db/migrations/002_sensor_readings.sql`; `db/migrations/006_sensor_readings_source.sql`; `db/migrations/011_water_readings.sql`; `db/migrations/012_fire_detections.sql`. Cross-checked against Active Recommendations and Latest Findings runs #156–#157 plus archived Data pipeline integrity lens runs #8, #23, #38, #53, #68, #83, #98, #113, #128, #143 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `db/migrations/012_fire_detections.sql:1-19` and `fires.py:239` — the `fire_detections` table has no UNIQUE constraint: it has only a GiST spatial index, a time-DESC index, and a confidence index. In PostgreSQL, `ON CONFLICT DO NOTHING` without a conflict target column list or constraint name only suppresses violations of existing UNIQUE or PRIMARY KEY constraints; with none present, it acts as a no-op and every INSERT succeeds regardless of duplicates. `fires.py:239` uses exactly this bare `ON CONFLICT DO NOTHING`. The background poll loop at `fires.py:41-69` runs every 30 minutes and calls `fetch_all_sources(settings.nasa_firms_key, days=2)` — NASA FIRMS returns all fire detections from the last 48 hours on every call. Each call inserts all returned detections again. After 24 hours (48 polls), every fire detection appears 48 times in `fire_detections`. The `/api/fires/history` endpoint at `fires.py:139-177` queries `SELECT ... FROM fire_detections WHERE time >= now() - make_interval(days => $1)` with no deduplication, so its `count` field and `fires` array grow by 48× per 24 hours of operation. PROPOSAL: Add a migration `CREATE UNIQUE INDEX idx_fire_detections_unique ON fire_detections (time, latitude, longitude, satellite, instrument)`; change `fires.py:239`'s `ON CONFLICT DO NOTHING` to `ON CONFLICT (time, latitude, longitude, satellite, instrument) DO NOTHING` — L/L effort (one SQL migration + update one clause).

- OBSERVATION: `geointellisense-ingestion/src/usgs.rs:107` — `fetch_recent` calls `let client = reqwest::Client::new()` inside the async function body, creating a brand-new HTTP client (and therefore a brand-new TCP/TLS connection pool) on every invocation. `fetch_recent` is called by `fetch_and_persist` → called by `spawn_earthquake_poller` (`broadcast.rs:154`) on every poll tick (default: `cfg.earthquake_interval_secs`). A new `reqwest::Client` per call means no TCP keep-alive survives between polls, no TLS session resumption occurs, and no HTTP/2 multiplexing is possible. The USGS FDSNWS endpoint at `https://earthquake.usgs.gov/` serves over HTTPS, so each ephemeral client triggers a full TLS handshake on every poll. By contrast, `purpleair.rs:41-47` correctly stores `http: reqwest::Client` as a struct field (`PurpleAirClient { api_key, http }`) and reuses it across all calls. PROPOSAL: Remove the inline `reqwest::Client::new()` from `usgs.rs:107`; either pass a `&reqwest::Client` parameter into `fetch_recent` and `fetch_and_persist_bbox`, or introduce an `EarthquakeClient` struct mirroring `PurpleAirClient`'s pattern and construct the client once in `broadcast::spawn_earthquake_poller` — L/L effort (add a client field or parameter, thread through 2 function signatures).

- OBSERVATION: `epa_aqi.py:49-68` — the non-county (all-SJV) code path at lines 53-56 iterates over all 8 entries in `SJV_COUNTIES`, collecting results into `results = []`. The entire loop is wrapped in a single `try` block that starts at line 49 and has one `except Exception as e` at line 68 that immediately returns a `JSONResponse(status_code=502, ...)`. If any one county's `client.get_daily_by_county(code, param, start_date, end_date)` call raises an exception (e.g., a transient network error for Fresno County), the outer `except` discards all previously accumulated county results (potentially 7 of 8 counties fully fetched) and returns a 502 with zero data. The caller receives `{"error": "EPA AQS request failed", "details": "..."}` despite 87.5% of the requested data being available. The same fragility applies to any multi-source aggregation where partial success is acceptable. PROPOSAL: Move the try/except inside the per-county loop at lines 54-55: catch per-county exceptions, append a partial-error marker to the response, and continue; return the collected results (possibly empty) plus an `errors` list indicating which counties failed — L/L effort (restructure 4 lines of the inner loop to wrap with try/except).

- OBSERVATION: `epa_aqi.py:181`, `water.py:297`, `fires.py:247` — all three persist helper functions use `if "INSERT" in result: inserted += 1` to count successfully persisted rows. asyncpg's `pool.execute()` returns a PostgreSQL command-tag string: `"INSERT 0 1"` when one row was inserted, and `"INSERT 0 0"` when `ON CONFLICT DO NOTHING` suppressed the insert. The Python substring check `"INSERT" in result` evaluates to `True` for BOTH `"INSERT 0 1"` and `"INSERT 0 0"` because the string `"INSERT"` appears in both. Consequently, every call to `_persist_summaries`, `_persist_readings` (water), and `_persist_fires` reports 100% of rows as "new" regardless of how many were actually deduplicated. Log lines such as `"Backfill: Kern/PM2.5/2024 — 365 rows inserted"` and `"USGS Water poll: 12 readings, 12 new"` are systematically wrong: they report attempted-count, not inserted-count. The correct parse is `int(result.split()[-1]) > 0` (the last space-delimited token is the inserted-row count). PROPOSAL: Replace `if "INSERT" in result: inserted += 1` with `if int(result.split()[-1]) > 0: inserted += 1` at `epa_aqi.py:181`, `water.py:297`, and `fires.py:247` — L/L effort (3 one-line changes).

**Proposed actions:**
- Add `CREATE UNIQUE INDEX idx_fire_detections_unique ON fire_detections (time, latitude, longitude, satellite, instrument)` migration; update `fires.py:239` conflict clause — L/L effort
- Refactor `usgs.rs:107` to reuse a persistent `reqwest::Client` across earthquake polls, mirroring `PurpleAirClient` — L/L effort
- Restructure `epa_aqi.py:53-56` inner loop to catch per-county exceptions individually, returning partial results instead of failing entirely — L/L effort
- Replace `"INSERT" in result` with `int(result.split()[-1]) > 0` at `epa_aqi.py:181`, `water.py:297`, `fires.py:247` — L/L effort

### Run #157 — 2026-06-04 — Lens: UX / UI flaws
**Scope:** Thirteenth UX / UI flaws pass. Files examined in full: `components/Sidebar.tsx`; `components/Header.tsx`; `components/ChatView.tsx`; `components/Dashboard.tsx`; `components/AnalysisView.tsx` (lines 1–100, 159–470); `components/DataExplorer.tsx`; `components/CalendarView.tsx`; `components/Toast.tsx`; `components/LoadingStates.tsx`; `components/SettingsView.tsx`. Cross-checked against Active Recommendations and Latest Findings runs #155–#156 plus archived UX / UI flaws lens runs #7, #22, #37, #52, #67, #82, #97, #112, #127, #142 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `Dashboard.tsx:97` — `getAqiColor` returns `'text-maroon-500'` for AQI > 300 (the Hazardous category). Tailwind CSS does not include a `maroon` color in its default palette — this class generates no CSS rule and the browser silently falls back to the default text color (white/slate). As a result, the most dangerous AQI level (Hazardous, > 300) displays without any distinctive color coding while all lower levels (Good → green-500, Moderate → yellow-400, USG → orange-500, Unhealthy → red-500, Very Unhealthy → purple-500) correctly render their intended colors. The broken class is also applied at `Dashboard.tsx:454` in the comparison view's PM2.5 color: `getAqiColor(aqi.pm25 * 2.5)`. Every chart label and stat card that calls `getAqiColor` with a value > 300 silently loses its color indicator. PROPOSAL: Replace `'text-maroon-500'` with a valid Tailwind class that conveys extreme severity, e.g. `'text-rose-900'` or add a custom `maroon` color to the Tailwind config in `vite.config.ts`/`tailwind.config.js` — L/L effort (1-line change in `getAqiColor` + purge/rebuild).

- OBSERVATION: `Dashboard.tsx:336-341` — The error-state retry button inside `renderCurrentConditions` calls `window.location.reload()` to recover from a fetch failure. The sequence at line 337 is `setError(null); setLoading(true); window.location.reload()` — the two state-setter calls immediately before a full page reload are no-ops because the component is destroyed by the reload before React can process them. More importantly, a full page reload is a disproportionately disruptive UX response to a partial data-fetch failure: it destroys all state (selected locations, date filters, active charts, any open tabs) and forces the user to re-navigate. The correct pattern is to call the `fetchData` function directly from the retry handler. `fetchData` is defined inside the `useEffect` at `Dashboard.tsx:39` and is not accessible outside it; extracting it to a `useCallback` at the component level would let the retry button call it without a page reload. PROPOSAL: Extract `fetchData` from the `useEffect` into a `useCallback` at `Dashboard.tsx` component scope; replace `window.location.reload()` in the retry button with a call to `fetchData()` — L/L effort (move ~30-line fetch block + adjust deps array).

- OBSERVATION: `ChatView.tsx:84` — `onKeyPress` event handler is deprecated in the HTML spec and React has emitted a deprecation warning for it since React 17. The correct replacement is `onKeyDown`. Additionally, the messages scroll container at `ChatView.tsx:54` (`<div className="flex-1 overflow-y-auto p-4 space-y-4">`) has no `role="log"` or `aria-live="polite"` attribute. For chat-style interfaces, ARIA's `log` role combined with `aria-live="polite"` is the standard way to inform screen readers that content is being appended — without it, screen reader users receive no announcement when the assistant responds or when the typing indicator appears. The `isLoading` spinner at `ChatView.tsx:65-75` appears visually but is also not announced. The send button's `title` attribute at `ChatView.tsx:93` contains a helpful hint but the `input` at `ChatView.tsx:80` lacks an `aria-label` (it has a `placeholder` but placeholder text is not reliably announced as an accessible label). PROPOSAL: Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84`; add `role="log" aria-live="polite" aria-label="Chat messages"` to the messages container div at line 54; add `aria-label="Type your message"` to the input at line 80 — L/L effort (4 attribute additions).

- OBSERVATION: `CalendarView.tsx:21` — `useState(new Date('2025-11-13'))` hardcodes the calendar's initial month to November 13, 2025 — more than six months before today (2026-06-04). When a user opens the Calendar view, they immediately see a month that has no relationship to the current date. There is no "Go to today" button or any navigational anchor to the present. The calendar only shows data from `dashboardData['dailyForecast']` which is static mock data; navigating forward past the available data silently shows empty day cells. The UX problem is the combination of: (a) opening to a stale month with no user-visible explanation, (b) no affordance to return to "today" or "the most recent available data", and (c) the prev/next month buttons at `CalendarView.tsx:120-133` provide no feedback when there is no data for the selected month (the calendar grid shows but all cells are `disabled` and visually grey with no tooltip or message). PROPOSAL: Initialize `currentDate` with `new Date()` at `CalendarView.tsx:21`; add a "Today" button beside the prev/next nav that calls `setCurrentDate(new Date())`; add an empty-state message inside the calendar grid when all days have `!dayData` — L/L effort (change initial value, add one button, add one conditional `<p>`).

**Proposed actions:**
- Fix `getAqiColor` in `Dashboard.tsx:97` to return a valid Tailwind class for AQI > 300 (e.g. `'text-rose-900'`) — L/L effort
- Extract `fetchData` from `useEffect` into `useCallback`; replace `window.location.reload()` retry with direct `fetchData()` call in `Dashboard.tsx:337` — L/L effort
- Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84`; add `role="log" aria-live="polite"` to messages container; add `aria-label` to input — L/L effort
- Initialize `CalendarView` to `new Date()` at `CalendarView.tsx:21`; add "Today" button; add empty-state for months with no data — L/L effort

### Run #156 — 2026-06-04 — Lens: TS ↔ Python contract
**Scope:** Twelfth TS ↔ Python contract pass. Files examined in full: `types.ts`; `services/aiService.ts`; `services/dataService.ts`; `hooks/useNormalizedData.ts`; `components/AnalysisView.tsx` (lines 1–60, 95–260, 449–471); `geointellisense-analytics/app/routes/chat.py`; `geointellisense-analytics/app/routes/predictive_analysis.py`; `geointellisense-analytics/app/routes/weather_forecast.py`; `geointellisense-analytics/app/routes/grounded_search.py`; `geointellisense-analytics/app/routes/grounded_maps.py`; `geointellisense-analytics/app/routes/historical_aqi.py`; `geointellisense-analytics/app/routes/historical_weather.py`. Cross-checked against Active Recommendations and Latest Findings runs #154–#155 plus archived TS ↔ Python contract lens runs #6, #21, #36, #51, #66, #81, #96, #111, #126, #141 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `dataService.ts:199` and `dataService.ts:221` — `getHistoricalAQI` and `getHistoricalWeather` pass comma-separated `location_ids` strings where each ID is a slug generated at `dataService.ts:279` as `name.toLowerCase().replace(/\s+/g, '_')` (e.g. `"bakersfield"`, `"fresno"`). `historical_aqi.py:46` and `historical_weather.py:37` both pass this list to PostgreSQL via `ANY($1::uuid[])` — PostgreSQL immediately rejects non-UUID values with `invalid input syntax for type uuid: "bakersfield"`, producing a 500 response. The TS catches all HTTP errors at `dataService.ts:208-210` and `dataService.ts:228-230` and silently falls back to mock `dashboardData`. Consequence: every call to `getHistoricalAQI(locationIds)` or `getHistoricalWeather(locationIds)` with a non-empty `locationIds` array returns mock data, never live database records. Additionally, when the unfiltered API call succeeds (no `location_ids` parameter), Python returns UUIDs in the `locationId` field (e.g. `"locationId": "3a8f…-uuid"`) while `getLocations()` at `dataService.ts:278-280` produces slug IDs (`"bakersfield"`). Any downstream filter like `records.filter(r => r.locationId === loc.id)` in `Dashboard.tsx:153` will never match — UUID from the API vs. slug from the location list. PROPOSAL: Align location IDs on one canonical form: either (a) add a `name_slug` column to the `locations` DB table and query by it in historical routes, or (b) change `getLocations()` to fetch actual UUIDs from the backend; either fix eliminates the mismatch in both the filter query and the returned records — M/M effort (add slug column to DB schema + update both TS and Python).

- OBSERVATION: `grounded_search.py:79` and `grounded_maps.py:86` both hardcode `"groundingChunks": []` in every response. `AnalysisView.tsx:85` declares `const [groundingChunks, setGroundingChunks] = useState<GroundingChunk[]>([])`, `AnalysisView.tsx:177` sets it from the search response, `AnalysisView.tsx:187` sets it from the maps response, and `AnalysisView.tsx:451-463` renders an entire "Sources" section — but this section is permanently hidden because the API always returns an empty array. The `GroundingChunk` interface at `types.ts:14-30` defines a full schema with `web.uri`, `web.title`, `maps.uri`, `maps.placeAnswerSources.reviewSnippets` — none of which ever gets populated. The Python uses Claude's tool-use mechanism (`TOOLS`, `execute_tool`) for web search, but tool results are consumed internally in the `while resp.stop_reason == "tool_use"` loop and are never extracted into the response's `groundingChunks` field. PROPOSAL: Either (a) remove the dead `groundingChunks` field from both Python response dicts and the TS `GroundingChunk` interface/`groundingChunks` state, or (b) instrument the tool-use loop in `grounded_search.py` and `grounded_maps.py` to extract source URLs from web-search tool results and return them as `groundingChunks` — L/L effort for option (a) or M/H effort for option (b).

- OBSERVATION: `historical_weather.py` (entire file) — the `/api/historical-weather` route has no Redis TTL cache while the structurally identical `/api/historical-aqi` route implements a 300-second cache at `historical_aqi.py:22-25` (`await get_cached(...)`) and `historical_aqi.py:100-101` (`await set_cached(...)`). Both routes are called together in `useNormalizedData.ts:53-54` (`dataService.getHistoricalAQI(...)` and `dataService.getHistoricalWeather(...)`) within a `Promise.all` on every component render. A cache miss on `historical-aqi` re-queries PostgreSQL once then returns cached for the next 5 minutes; a cache miss on `historical-weather` always queries PostgreSQL regardless of call frequency. Additionally, `historical_weather.py:56` returns a plain Python list `return []` on the empty-row path rather than `JSONResponse` — the response therefore lacks `X-Cache` headers, inconsistent with `historical_aqi.py:64` which returns `JSONResponse(content=[], headers=cache_headers(False, HIST_TTL))`. PROPOSAL: Add `get_cached`/`set_cached` calls to `historical_weather.py` mirroring the pattern in `historical_aqi.py:22-25,100-101`; change the empty-rows path to `return JSONResponse(content=[], headers=cache_headers(False, HIST_TTL))` — L/L effort (copy-adapt ~8 lines from `historical_aqi.py` + add `from app.cache import get_cached, set_cached, cache_headers` import).

**Proposed actions:**
- Align location IDs: add `name_slug` to `locations` table and filter by slug in `historical_aqi.py:46` and `historical_weather.py:37`; update `getLocations()` to return slugs matching DB records — M/M effort
- Remove dead `groundingChunks` field from Python responses and TS state/interface (option a), or implement source extraction in the tool-use loop (option b) — L/L (a) or M/H (b)
- Add Redis TTL cache to `historical_weather.py` mirroring `historical_aqi.py:22-25,100-101`; fix empty-path to `JSONResponse` — L/L effort

## 📚 Archive (one line per past run)
- Run #155 (2026-06-04) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #154 (2026-06-04) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #153 (2026-06-04) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #152 (2026-06-04) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #151 (2026-06-04) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #150 (2026-06-04) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #149 (2026-06-04) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #148 (2026-06-04) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #147 (2026-06-04) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #146 (2026-06-04) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #145 (2026-06-03) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #144 (2026-06-03) — Lens: Security — 4 findings — 0 promoted to Active
- Run #143 (2026-06-03) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #142 (2026-06-03) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #141 (2026-06-03) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #140 (2026-06-03) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #139 (2026-06-03) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #138 (2026-06-03) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #137 (2026-06-03) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #136 (2026-06-03) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #135 (2026-06-03) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #134 (2026-06-03) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #133 (2026-06-03) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #132 (2026-06-03) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #131 (2026-06-02) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #130 (2026-06-02) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #129 (2026-06-02) — Lens: Security — 4 findings — 0 promoted to Active
- Run #128 (2026-06-02) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #127 (2026-06-02) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #126 (2026-06-02) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #125 (2026-06-02) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #124 (2026-06-02) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #123 (2026-06-02) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #122 (2026-06-02) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #121 (2026-06-02) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #120 (2026-06-02) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #119 (2026-06-02) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #118 (2026-06-02) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #117 (2026-06-02) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #116 (2026-06-02) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #115 (2026-06-02) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #114 (2026-06-01) — Lens: Security — 4 findings — 0 promoted to Active
- Run #113 (2026-06-01) — Lens: Data pipeline integrity — 4 findings — 1 promoted to Active
- Run #112 (2026-06-01) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #111 (2026-06-01) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #110 (2026-06-01) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #109 (2026-06-01) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #108 (2026-06-01) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #107 (2026-06-01) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #106 (2026-06-01) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #105 (2026-06-01) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #104 (2026-06-01) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #103 (2026-06-01) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #102 (2026-06-01) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #101 (2026-06-01) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #100 (2026-06-01) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #99 (2026-06-01) — Lens: Security — 4 findings — 0 promoted to Active
- Run #98 (2026-06-01) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #97 (2026-06-01) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #96 (2026-06-01) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #95 (2026-06-01) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #94 (2026-06-01) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #93 (2026-06-01) — Lens: Dependency health — 5 findings — 0 promoted to Active
- Run #92 (2026-06-01) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #91 (2026-06-01) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #90 (2026-05-31) — Lens: Live-time claim audit — 5 findings — 0 promoted to Active
- Run #89 (2026-05-31) — Lens: Competitive scan (web) — 5 findings — 0 promoted to Active
- Run #88 (2026-05-31) — Lens: LLM integration quality — 5 findings — 0 promoted to Active
- Run #87 (2026-05-31) — Lens: Deployment / Docker — 5 findings — 0 promoted to Active
- Run #86 (2026-05-31) — Lens: Docs — 5 findings — 0 promoted to Active
- Run #85 (2026-05-31) — Lens: Observability — 5 findings — 0 promoted to Active
- Run #84 (2026-05-31) — Lens: Security — 5 findings — 0 promoted to Active
- Run #83 (2026-05-31) — Lens: Data pipeline integrity — 5 findings — 0 promoted to Active
- Run #82 (2026-05-31) — Lens: UX / UI flaws — 5 findings — 0 promoted to Active
- Run #81 (2026-05-31) — Lens: TS ↔ Python contract — 5 findings — 0 promoted to Active
- Run #80 (2026-05-31) — Lens: Test coverage gaps — 5 findings — 0 promoted to Active
- Run #79 (2026-05-31) — Lens: Perf hot paths — 5 findings — 0 promoted to Active
- Run #78 (2026-05-31) — Lens: Dependency health — 5 findings — 0 promoted to Active
- Run #77 (2026-05-31) — Lens: Module boundaries — 5 findings — 0 promoted to Active
- Run #76 (2026-05-31) — Lens: Type safety — 5 findings — 0 promoted to Active
- Run #75 (2026-05-31) — Lens: Live-time claim audit — 5 findings — 0 promoted to Active
- Run #74 (2026-05-31) — Lens: Competitive scan (web) — 5 findings — 0 promoted to Active
- Run #73 (2026-05-31) — Lens: LLM integration quality — 5 findings — 0 promoted to Active
- Run #72 (2026-05-31) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #71 (2026-05-31) — Lens: Docs — 5 findings — 0 promoted to Active
- Run #70 (2026-05-31) — Lens: Observability — 5 findings — 0 promoted to Active
- Run #69 (2026-05-31) — Lens: Security — 5 findings — 0 promoted to Active
- Run #68 (2026-05-31) — Lens: Data pipeline integrity — 5 findings — 0 promoted to Active
- Run #67 (2026-05-31) — Lens: UX / UI flaws — 5 findings — 0 promoted to Active
- Run #66 (2026-05-30) — Lens: TS ↔ Python contract — 5 findings — 0 promoted to Active
- Run #65 (2026-05-30) — Lens: Test coverage gaps — 5 findings — 0 promoted to Active
- Run #64 (2026-05-30) — Lens: Perf hot paths — 5 findings — 0 promoted to Active
- Run #63 (2026-05-30) — Lens: Dependency health — 5 findings — 0 promoted to Active
- Run #62 (2026-05-30) — Lens: Module boundaries — 5 findings — 0 promoted to Active
- Run #61 (2026-05-30) — Lens: Type safety — 5 findings — 0 promoted to Active
- Run #60 (2026-05-30) — Lens: Live-time claim audit — 5 findings — 0 promoted to Active
- Run #59 (2026-05-30) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #58 (2026-05-30) — Lens: LLM integration quality — 5 findings — 0 promoted to Active
- Run #57 (2026-05-30) — Lens: Deployment / Docker — 5 findings — 0 promoted to Active
- Run #56 (2026-05-30) — Lens: Docs — 5 findings — 0 promoted to Active
- Run #55 (2026-05-30) — Lens: Observability — 5 findings — 0 promoted to Active
- Run #54 (2026-05-30) — Lens: Security — 5 findings — 0 promoted to Active
- Run #53 (2026-05-30) — Lens: Data pipeline integrity — 5 findings — 0 promoted to Active
- Run #52 (2026-05-30) — Lens: UX / UI flaws — 5 findings — 0 promoted to Active
- Run #51 (2026-05-30) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #50 (2026-05-30) — Lens: Test coverage gaps — 5 findings — 0 promoted to Active
- Run #49 (2026-05-30) — Lens: Perf hot paths — 5 findings — 0 promoted to Active
- Run #48 (2026-05-30) — Lens: Dependency health — 5 findings — 0 promoted to Active
- Run #47 (2026-05-30) — Lens: Module boundaries — 5 findings — 0 promoted to Active
- Run #46 (2026-05-30) — Lens: Type safety — 5 findings — 0 promoted to Active
- Run #45 (2026-05-30) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #44 (2026-05-30) — Lens: Competitive scan (web) — 5 findings — 0 promoted to Active
- Run #43 (2026-05-29) — Lens: LLM integration quality — 5 findings — 0 promoted to Active
- Run #42 (2026-05-29) — Lens: Deployment / Docker — 5 findings — 0 promoted to Active
- Run #41 (2026-05-29) — Lens: Docs — 5 findings — 0 promoted to Active
- Run #40 (2026-05-29) — Lens: Observability — 6 findings — 0 promoted to Active
- Run #39 (2026-05-29) — Lens: Security — 5 findings — 0 promoted to Active
- Run #38 (2026-05-29) — Lens: Data pipeline integrity — 5 findings — 0 promoted to Active
- Run #37 (2026-05-29) — Lens: UX / UI flaws — 5 findings — 0 promoted to Active
- Run #36 (2026-05-29) — Lens: TS ↔ Python contract — 5 findings — 0 promoted to Active
- Run #35 (2026-05-29) — Lens: Test coverage gaps — 5 findings — 0 promoted to Active
- Run #34 (2026-05-29) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #33 (2026-05-29) — Lens: Dependency health — 5 findings — 0 promoted to Active
- Run #32 (2026-05-29) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #31 (2026-05-29) — Lens: Type safety — 5 findings — 0 promoted to Active
- Run #30 (2026-05-29) — Lens: Live-time claim audit — 5 findings — 0 promoted to Active
- Run #29 (2026-05-29) — Lens: Competitive scan (web) — 6 findings — 0 promoted to Active
- Run #28 (2026-05-29) — Lens: LLM integration quality — 6 findings — 0 promoted to Active
- Run #27 (2026-05-29) — Lens: Deployment / Docker — 6 findings — 0 promoted to Active
- Run #26 (2026-05-29) — Lens: Docs — 7 findings — 0 promoted to Active
- Run #25 (2026-05-29) — Lens: Observability — 6 findings — 0 promoted to Active
- Run #24 (2026-05-29) — Lens: Security — 6 findings — 0 promoted to Active
- Run #23 (2026-05-29) — Lens: Data pipeline integrity — 7 findings — 0 promoted to Active
- Run #22 (2026-05-29) — Lens: UX / UI flaws — 6 findings — 0 promoted to Active
- Run #21 (2026-05-29) — Lens: TS ↔ Python contract — 6 findings — 0 promoted to Active
- Run #20 (2026-05-29) — Lens: Test coverage gaps — 7 findings — 0 promoted to Active
- Run #19 (2026-05-28) — Lens: Perf hot paths — 7 findings — 0 promoted to Active
- Run #18 (2026-05-28) — Lens: Dependency health — 5 findings — 0 promoted to Active
- Run #17 (2026-05-28) — Lens: Module boundaries — 5 findings — 0 promoted to Active
- Run #16 (2026-05-28) — Lens: Type safety — 8 findings — 0 promoted to Active
- Run #15 (2026-05-28) — Lens: Live-time claim audit — 5 findings — 0 promoted to Active
- Run #14 (2026-05-28) — Lens: Competitive scan (web) — 7 findings — 0 promoted to Active
- Run #13 (2026-05-28) — Lens: LLM integration quality — 8 findings — 0 promoted to Active
- Run #12 (2026-05-28) — Lens: Deployment / Docker — 7 findings — 0 promoted to Active
- Run #11 (2026-05-28) — Lens: Docs — 10 findings — 0 promoted to Active
- Run #10 (2026-05-28) — Lens: Observability — 6 findings — 2 promoted to Active
- Run #9 (2026-05-28) — Lens: Security — 8 findings — 2 promoted to Active
- Run #8 (2026-05-28) — Lens: Data pipeline integrity — 7 findings — 2 promoted to Active
- Run #7 (2026-05-28) — Lens: UX / UI flaws — 8 findings — 1 promoted to Active
- Run #6 (2026-05-28) — Lens: TS ↔ Python contract — 6 findings — 4 promoted to Active
- Run #5 (2026-05-28) — Lens: Test coverage gaps — 7 findings — 2 promoted to Active
- Run #4 (2026-05-28) — Lens: Perf hot paths — 7 findings — 3 promoted to Active
- Run #3 (2026-05-28) — Lens: Dependency health — 5 findings — 3 promoted to Active
- Run #2 (2026-05-28) — Lens: Module boundaries — 6 findings — 4 promoted to Active
- Run #1 (2026-05-28) — Lens: Type safety — 8 findings — 4 promoted to Active

## 🔁 Lens rotation log
- Run #1: lens 1 (Type safety) — findings added
- Run #2: lens 2 (Module boundaries) — findings added
- Run #3: lens 3 (Dependency health) — findings added
- Run #4: lens 4 (Perf hot paths) — findings added
- Run #5: lens 5 (Test coverage gaps) — findings added
- Run #6: lens 6 (TS ↔ Python contract) — findings added
- Run #7: lens 7 (UX / UI flaws) — findings added
- Run #8: lens 8 (Data pipeline integrity) — findings added
- Run #9: lens 9 (Security) — findings added
- Run #10: lens 10 (Observability) — findings added
- Run #11: lens 11 (Docs) — findings added
- Run #12: lens 12 (Deployment / Docker) — findings added
- Run #13: lens 13 (LLM integration quality) — findings added
- Run #14: lens 14 (Competitive scan) — findings added
- Run #15: lens 15 (Live-time claim audit) — findings added
- Run #16: lens 1 (Type safety) — findings added
- Run #17: lens 2 (Module boundaries) — findings added
- Run #18: lens 3 (Dependency health) — findings added
- Run #19: lens 4 (Perf hot paths) — findings added
- Run #20: lens 5 (Test coverage gaps) — findings added
- Run #21: lens 6 (TS ↔ Python contract) — findings added
- Run #22: lens 7 (UX / UI flaws) — findings added
- Run #23: lens 8 (Data pipeline integrity) — findings added
- Run #24: lens 9 (Security) — findings added
- Run #25: lens 10 (Observability) — findings added
- Run #26: lens 11 (Docs) — findings added
- Run #27: lens 12 (Deployment / Docker) — findings added
- Run #28: lens 13 (LLM integration quality) — findings added
- Run #29: lens 14 (Competitive scan) — findings added
- Run #30: lens 15 (Live-time claim audit) — findings added
- Run #31: lens 1 (Type safety) — findings added
- Run #32: lens 2 (Module boundaries) — findings added
- Run #33: lens 3 (Dependency health) — findings added
- Run #34: lens 4 (Perf hot paths) — findings added
- Run #35: lens 5 (Test coverage gaps) — findings added
- Run #36: lens 6 (TS ↔ Python contract) — findings added
- Run #37: lens 7 (UX / UI flaws) — findings added
- Run #38: lens 8 (Data pipeline integrity) — findings added
- Run #39: lens 9 (Security) — findings added
- Run #40: lens 10 (Observability) — findings added
- Run #41: lens 11 (Docs) — findings added
- Run #42: lens 12 (Deployment / Docker) — findings added
- Run #43: lens 13 (LLM integration quality) — findings added
- Run #44: lens 14 (Competitive scan) — findings added
- Run #45: lens 15 (Live-time claim audit) — findings added
- Run #46: lens 1 (Type safety) — findings added
- Run #47: lens 2 (Module boundaries) — findings added
- Run #48: lens 3 (Dependency health) — findings added
- Run #49: lens 4 (Perf hot paths) — findings added
- Run #50: lens 5 (Test coverage gaps) — findings added
- Run #51: lens 6 (TS ↔ Python contract) — findings added
- Run #52: lens 7 (UX / UI flaws) — findings added
- Run #53: lens 8 (Data pipeline integrity) — findings added
- Run #54: lens 9 (Security) — findings added
- Run #55: lens 10 (Observability) — findings added
- Run #56: lens 11 (Docs) — findings added
- Run #57: lens 12 (Deployment / Docker) — findings added
- Run #58: lens 13 (LLM integration quality) — findings added
- Run #59: lens 14 (Competitive scan) — findings added
- Run #60: lens 15 (Live-time claim audit) — findings added
- Run #61: lens 1 (Type safety) — findings added
- Run #62: lens 2 (Module boundaries) — findings added
- Run #63: lens 3 (Dependency health) — findings added
- Run #64: lens 4 (Perf hot paths) — findings added
- Run #65: lens 5 (Test coverage gaps) — findings added
- Run #66: lens 6 (TS ↔ Python contract) — findings added
- Run #67: lens 7 (UX / UI flaws) — findings added
- Run #68: lens 8 (Data pipeline integrity) — findings added
- Run #69: lens 9 (Security) — findings added
- Run #70: lens 10 (Observability) — findings added
- Run #71: lens 11 (Docs) — findings added
- Run #72: lens 12 (Deployment / Docker) — findings added
- Run #73: lens 13 (LLM integration quality) — findings added
- Run #74: lens 14 (Competitive scan) — findings added
- Run #75: lens 15 (Live-time claim audit) — findings added
- Run #76: lens 1 (Type safety) — findings added
- Run #77: lens 2 (Module boundaries) — findings added
- Run #78: lens 3 (Dependency health) — findings added
- Run #79: lens 4 (Perf hot paths) — findings added
- Run #80: lens 5 (Test coverage gaps) — findings added
- Run #81: lens 6 (TS ↔ Python contract) — findings added
- Run #82: lens 7 (UX / UI flaws) — findings added
- Run #83: lens 8 (Data pipeline integrity) — findings added
- Run #84: lens 9 (Security) — findings added
- Run #85: lens 10 (Observability) — findings added
- Run #86: lens 11 (Docs) — findings added
- Run #87: lens 12 (Deployment / Docker) — findings added
- Run #88: lens 13 (LLM integration quality) — findings added
- Run #89: lens 14 (Competitive scan) — findings added
- Run #90: lens 15 (Live-time claim audit) — findings added
- Run #91: lens 1 (Type safety) — findings added
- Run #92: lens 2 (Module boundaries) — findings added
- Run #93: lens 3 (Dependency health) — findings added
- Run #94: lens 4 (Perf hot paths) — findings added
- Run #95: lens 5 (Test coverage gaps) — findings added
- Run #96: lens 6 (TS ↔ Python contract) — findings added
- Run #97: lens 7 (UX / UI flaws) — findings added
- Run #98: lens 8 (Data pipeline integrity) — findings added
- Run #99: lens 9 (Security) — findings added
- Run #100: lens 10 (Observability) — findings added
- Run #101: lens 11 (Docs) — findings added
- Run #102: lens 12 (Deployment / Docker) — findings added
- Run #103: lens 13 (LLM integration quality) — findings added
- Run #104: lens 14 (Competitive scan) — findings added
- Run #105: lens 15 (Live-time claim audit) — findings added
- Run #106: lens 1 (Type safety) — findings added
- Run #107: lens 2 (Module boundaries) — findings added
- Run #108: lens 3 (Dependency health) — findings added
- Run #109: lens 4 (Perf hot paths) — findings added
- Run #110: lens 5 (Test coverage gaps) — findings added
- Run #111: lens 6 (TS ↔ Python contract) — findings added
- Run #112: lens 7 (UX / UI flaws) — findings added
- Run #113: lens 8 (Data pipeline integrity) — findings added
- Run #114: lens 9 (Security) — findings added
- Run #115: lens 10 (Observability) — findings added
- Run #116: lens 11 (Docs) — findings added
- Run #117: lens 12 (Deployment / Docker) — findings added
- Run #118: lens 13 (LLM integration quality) — findings added
- Run #119: lens 14 (Competitive scan) — findings added
- Run #120: lens 15 (Live-time claim audit) — findings added
- Run #121: lens 1 (Type safety) — findings added
- Run #122: lens 2 (Module boundaries) — findings added
- Run #123: lens 3 (Dependency health) — findings added
- Run #124: lens 4 (Perf hot paths) — findings added
- Run #125: lens 5 (Test coverage gaps) — findings added
- Run #126: lens 6 (TS ↔ Python contract) — findings added
- Run #127: lens 7 (UX / UI flaws) — findings added
- Run #128: lens 8 (Data pipeline integrity) — findings added
- Run #129: lens 9 (Security) — findings added
- Run #130: lens 10 (Observability) — findings added
- Run #131: lens 11 (Docs) — findings added
- Run #132: lens 12 (Deployment / Docker) — findings added
- Run #133: lens 13 (LLM integration quality) — findings added
- Run #134: lens 14 (Competitive scan) — findings added
- Run #135: lens 15 (Live-time claim audit) — findings added
- Run #136: lens 1 (Type safety) — findings added
- Run #137: lens 2 (Module boundaries) — findings added
- Run #138: lens 3 (Dependency health) — findings added
- Run #139: lens 4 (Perf hot paths) — findings added
- Run #140: lens 5 (Test coverage gaps) — findings added
- Run #141: lens 6 (TS ↔ Python contract) — findings added
- Run #142: lens 7 (UX / UI flaws) — findings added
- Run #143: lens 8 (Data pipeline integrity) — findings added
- Run #144: lens 9 (Security) — findings added
- Run #145: lens 10 (Observability) — findings added
- Run #146: lens 11 (Docs) — findings added
- Run #147: lens 12 (Deployment / Docker) — findings added
- Run #148: lens 13 (LLM integration quality) — findings added
- Run #149: lens 14 (Competitive scan) — findings added
- Run #150: lens 15 (Live-time claim audit) — findings added
- Run #151: lens 1 (Type safety) — findings added
- Run #152: lens 2 (Module boundaries) — findings added
- Run #153: lens 3 (Dependency health) — findings added
- Run #154: lens 4 (Perf hot paths) — findings added
- Run #155: lens 5 (Test coverage gaps) — findings added
- Run #156: lens 6 (TS ↔ Python contract) — findings added
- Run #157: lens 7 (UX / UI flaws) — findings added
- Run #158: lens 8 (Data pipeline integrity) — findings added
