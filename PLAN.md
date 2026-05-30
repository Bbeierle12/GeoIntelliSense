# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T09:10:00Z
Last run: #53 — Lens: Data pipeline integrity

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Sanitize AI result before `dangerouslySetInnerHTML` in `AnalysisView.tsx` | UX/Security | H | L | 7 | Open |
| 2 | Add retry+backoff to Rust `PurpleAirClient::fetch_sensors` | Data pipeline | H | L | 8 | Open |
| 3 | Redis-down skips all PurpleAir/earthquake polling — default toggle to ON when Redis unavailable | Data pipeline | H | L | 8 | Open |
| 4 | Propagate `sessionId` through chat calls in `aiService.ts` | TS↔Py contract | H | L | 6 | Open |
| 5 | Batch DB writes in `persist.rs` with UNNEST | Perf | H | L | 4 | Open |
| 6 | `GET /api/maps-config` exposes Google Maps API key to unauthenticated callers | Security | H | L | 9 | Open |
| 7 | `POST /api/predict/train` is unauthenticated — any client can trigger expensive model retraining | Security | H | L | 9 | Open |
| 8 | No logging configuration in analytics `main.py` — all `logger.info/debug` calls silently dropped | Observability | H | L | 10 | Open |
| 9 | Health checks return static `"ok"` without probing DB or Redis — failing containers pass healthcheck | Observability | H | L | 10 | Open |
| 10 | `/api/predictive-analysis` and `/api/weather-forecast` have no auth or rate limiting — any public caller can burn Anthropic credits | Security/LLM | H | L | 13 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #53 — 2026-05-30 — Lens: Data pipeline integrity
**Scope:** Fourth data pipeline integrity pass. Examined: `geointellisense-ingestion/src/usgs.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-ingestion/src/redis_cache.rs`, `geointellisense-ingestion/src/db/persist.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-analytics/app/clients/airnow.py`, `geointellisense-analytics/app/clients/nws_sounding.py`, `geointellisense-analytics/app/clients/nasa_firms.py`, `geointellisense-analytics/app/clients/usgs_water.py`, `geointellisense-analytics/app/routes/fires.py`, `geointellisense-analytics/app/routes/inversion.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/routes/airnow.py`, `geointellisense-analytics/app/http_client.py`, `geointellisense-analytics/app/source_toggles.py`, `geointellisense-analytics/app/cache.py`. Prior data pipeline run details (runs #8, #23, #38) archived; findings verified as new against all visible prior-run detail and Active Recommendations.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/usgs.rs:107` — `fetch_recent()` constructs a new `reqwest::Client::new()` on every USGS earthquake poll call. `reqwest::Client` holds an internal connection pool and is documented as "cheap to clone; expensive to create." Creating a new client per call means: (a) a fresh TLS handshake is performed with `earthquake.usgs.gov` on every `earthquake_interval_secs` tick (default 300 s, `config.rs:35`); (b) the old client's connection pool is discarded without being reused. By contrast, `PurpleAirClient` (`purpleair.rs:36-47`) correctly stores `http: reqwest::Client` as a struct field, allocating once at startup. The USGS client is not wrapped in a struct — `fetch_recent` is a free async function called from `fetch_and_persist_bbox` (`usgs.rs:85`) which is itself called every poll tick from `broadcast.rs:154`. Every 5 minutes, a fresh TCP+TLS connection is established with no benefit. This is a resource-waste pattern, not a correctness bug, but on resource-constrained deployments it causes measureable per-poll overhead. PROPOSAL: Add a `UsgsFetcher` struct with a `http: reqwest::Client` field (mirroring `PurpleAirClient`), move `fetch_recent` into it as a method, and store one instance in `broadcast::spawn_earthquake_poller` — or declare a `static EARTHQUAKE_CLIENT: std::sync::OnceLock<reqwest::Client>` initialized once at first call.

- OBSERVATION: `geointellisense-analytics/app/clients/nws_sounding.py:268-276` — `get_inversion_status()` awaits the two upstream fetches sequentially: `surface = await fetch_surface_obs()` (line 274) then `sounding = await fetch_sounding_850mb()` (line 275). The inline comment at line 273 reads `"# Fetch both in parallel-ish"` but the calls are plain sequential `await`s — there is no `asyncio.gather` or `asyncio.TaskGroup`. `fetch_surface_obs()` uses a 15 s timeout (`nws_sounding.py:130`) and `fetch_sounding_850mb()` uses a 20 s timeout (`nws_sounding.py:189`), so worst-case cumulative blocking time is 35 s. For the background poll loop (`inversion.py:43`) this is harmless (1800 s interval), but the on-demand path at `inversion.py:89-97` — reached when a frontend request arrives before the poll loop has run — blocks the HTTP response for up to 35 s. FastAPI's default worker timeout means a 35 s on-demand first-run request may silently time out at the reverse-proxy layer (Caddyfile) before returning. PROPOSAL: Replace lines 274-275 with `surface, sounding = await asyncio.gather(fetch_surface_obs(), fetch_sounding_850mb())` — a two-line change that makes the comment accurate and halves worst-case latency to ~20 s.

- OBSERVATION: `geointellisense-analytics/app/clients/airnow.py:48,64,79` — `AirNowClient` uses a private `httpx.AsyncClient(timeout=15.0)` (line 48) and calls it directly via `self._http.get(url, params=params)` at lines 64 and 79, followed by `resp.raise_for_status()`. This bypasses the shared `app.http_client.fetch()` layer (`http_client.py:19-81`), which provides: (a) automatic retry on 429 with `Retry-After` header respect; (b) automatic retry on 5xx with exponential backoff (1 s, 2 s, 4 s); (c) retry on `httpx.TimeoutException`. AirNow returns 429 on quota exhaustion (500 req/hour cap, shared across the 6 SJV per-city calls × forecast + current = 12 requests per user interaction). On a 429, `resp.raise_for_status()` immediately propagates as an `httpx.HTTPStatusError` which the route handler at `airnow.py:50-55` catches and returns as a 502 to the frontend — no retry is attempted. `usgs_water.py:84,101` and `nasa_firms.py:73` have already been migrated to `from app.http_client import fetch as http_fetch` and benefit from the retry logic; `airnow.py` has not. PROPOSAL: Replace `self._http.get(url, params=params)` at lines 64 and 79 with `await http_fetch(url, params=params, headers={"Authorization": ...})` using `from app.http_client import fetch as http_fetch`; remove the `_http` field and `close()` method from `AirNowClient`, and update `airnow.py` route to remove the `finally: await client.close()` block.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:76-91` + `broadcast.rs:103-113` — When `PurpleAirClient.fetch_readings()` fails (line 91: `Err(e) => tracing::warn!("PurpleAir fetch failed: {e}, cache unchanged")`), the `cache` `RwLock<Option<Vec<AqiReading>>>` is left containing the last successful readings. The broadcast ticker (lines 97-131) fires every `broadcast_interval_secs` (default 5 s from `config.rs:31`) and at line 105-109 re-emits the cached readings with the timestamp overwritten to `Utc::now()`: `AqiReading { timestamp: now, ..r.clone() }`. This means that if the PurpleAir API is down for — say — 2 hours, every SSE client (`routes/sse.rs`) receives readings whose `timestamp` field claims to be "just now" but whose sensor data is up to 2 hours old. The `purpleair_interval_secs` default is 600 s (10 min, `config.rs:27`), so after one failed poll the data is already stale by 10 minutes at minimum, yet the broadcast presents it as current. There is no `dataFreshness` or `stalenessSecs` field in the `AqiReading` struct (`aqi.rs:17-41`), no warning log from the broadcast ticker when it re-emits old data, and no UI component that compares the original fetch timestamp against wall-clock time. In extended outage scenarios (PurpleAir API maintenance windows are documented as periodic), the `X-Cache: MISS` SSE events reaching `hooks/useRealtimeAQI.ts` will show live timestamps while the underlying air quality values are hours-old sensor averages. PROPOSAL: Add a `cached_at: Option<DateTime<Utc>>` field to `LiveCache`; in the broadcast ticker, compute `staleness_secs = now - cached_at` and if `staleness_secs > purpleair_interval_secs * 3`, (a) log a `tracing::warn!` and (b) fall back to `aqi::generate_readings()` (mock) so the UI at least receives consistent, clearly-simulated data rather than silently stale live data.

- OBSERVATION: `geointellisense-analytics/app/clients/nws_sounding.py:154-214` + `geointellisense-analytics/app/routes/inversion.py:363-388` — `fetch_sounding_850mb()` only ever tries station `VBG` (Vandenberg AFB). The module-level docstring at `nws_sounding.py:7-8` explicitly names `"Station OAK (Oakland) as backup"` but no backup logic exists: the function signature is `async def fetch_sounding_850mb(station: str = SOUNDING_STATION)` and it is always called with the default (`nws_sounding.py:275`). When VBG soundings are unavailable (UWyo archive lag, maintenance, or VBG balloon launch failure), all three retry offsets (0, 12, 24 hours back) return `None` and the function returns `{"temp_850mb_c": None, ...}`. `get_inversion_status()` then passes `None` to `classify_inversion(None)` (`nws_sounding.py:288`), which returns `"unknown"` (`nws_sounding.py:83`). The poll loop at `inversion.py:47-48` then calls `_persist_event(pool, status)` (`inversion.py:364`), which inserts a row with `inversion_strength = "unknown"` into the `inversion_events` table — no guard exists in `_persist_event` to skip unknown-strength events. The `inversion_aqi_correlation` SQL query at `inversion.py:200` uses `WHERE inversion_strength IS NOT NULL` (line 195) but the `"unknown"` string passes that filter, so "unknown" rows are bucketed into `by_strength` but the key `"unknown"` is absent from the pre-initialized dict at `inversion.py:219-224`, causing it to be silently skipped by the `if strength in by_strength` guard at line 228. While the correlation result is not wrong, the "unknown" rows accumulate in the DB without any useful value, and the `inversionRate` statistic at line 163 includes them in `len(events)` as denominator, diluting the reported rate. PROPOSAL: (a) Add `BACKUP_SOUNDING_STATION = "OAK"` constant; in `fetch_sounding_850mb()`, on complete VBG failure, retry with OAK. (b) In `_persist_event` (`inversion.py:364`), add an early return if `status.inversion_strength == "unknown"` to prevent DB pollution. (c) In the correlation endpoint, add `AND inversion_strength != 'unknown'` to the CTE WHERE clause.

**Proposed actions:**
- Wrap USGS HTTP client in a `UsgsFetcher` struct (or `OnceLock<reqwest::Client>`) to eliminate per-poll `reqwest::Client` allocation at `usgs.rs:107` — M/L, score 2.0; does not enter top 10
- Replace sequential `await fetch_surface_obs() / await fetch_sounding_850mb()` with `asyncio.gather` at `nws_sounding.py:274-275` — M/L, score 2.0; does not enter top 10
- Migrate `AirNowClient` at `airnow.py:48,64,79` to use shared `http_client.fetch()` retry wrapper — M/L, score 2.0; does not enter top 10
- Add staleness detection to broadcast ticker (`broadcast.rs:105-113`): fall back to mock data after 3× `purpleair_interval_secs` without a successful PurpleAir fetch — M/M, score 1.0; does not enter top 10
- Add OAK fallback sounding station to `nws_sounding.py:154`; guard `_persist_event` against unknown-strength inserts in `inversion.py:363` — M/L, score 2.0; does not enter top 10

### Run #52 — 2026-05-30 — Lens: UX / UI flaws
**Scope:** Fourth UX/UI pass. Examined: `App.tsx`, `index.html`, `components/Header.tsx`, `components/Sidebar.tsx`, `components/ChatView.tsx`, `components/CalendarView.tsx`, `components/Dashboard.tsx`, `components/AnalysisView.tsx`, `components/DataExplorer.tsx`, `components/SettingsView.tsx`, `components/LoadingStates.tsx`, `components/dashboard/widgets/AqiGaugeWidget.tsx`, `styles/theme-light.css`. Prior UX/UI run details (runs #7, #22, #37) archived as one-liners; findings below verified as new against all visible prior-run detail.

**Findings:**

- OBSERVATION: `components/Dashboard.tsx:96` — `getAqiColor(aqi)` returns `'text-maroon-500'` for `aqi > 300` (the EPA "Hazardous" category). Tailwind CSS has no built-in `maroon` color palette and no `maroon` entry is defined in the inline `tailwind.config` in `index.html:16-28` (which only extends with `brand-primary`, `brand-secondary`, `brand-bg-dark`, `brand-bg-light`, `brand-bg-lighter`). Using Tailwind from CDN (`index.html:14`) means no JIT scan generates the class; `text-maroon-500` produces no CSS rule and renders as the default text color. Concretely: when any city's AQI exceeds 300, the large AQI number displayed in `Dashboard.tsx:403`, `453` and the corresponding PM2.5 figures appear in default `text-slate-200` — visually indistinguishable from normal conditions. The public-health severity of a Hazardous AQI event is therefore invisible in the most prominent data display. The other five categories (good → very unhealthy) all map to valid Tailwind colors (`text-green-500`, `text-yellow-400`, `text-orange-500`, `text-red-500`, `text-purple-500`). PROPOSAL: Replace `'text-maroon-500'` with `'text-rose-900'` or `'text-red-950'` (both exist in Tailwind's default palette) at `Dashboard.tsx:96`; also add a `bg-rose-900/20` background tint to the hazardous-level card to provide a redundant visual cue beyond color alone.

- OBSERVATION: `components/CalendarView.tsx:21` — The calendar's initial view state is hardcoded: `const [currentDate, setCurrentDate] = useState(new Date('2025-11-13'))`. As of 2026-05-30, this is 6.5 months in the past. Every user who opens the CalendarView sees November 2025 by default and must click the "Next →" button 6 times to navigate to the current month — the very data most relevant to them. The calendar month navigation buttons (`handlePrevMonth`/`handleNextMonth` at lines 96-102) are the only way to move forward; there is no "Go to Today" button. Furthermore, the two navigation buttons (`← Prev` at line 120, `Next →` at line 131) have no `aria-label` attributes — their accessible name is the raw text `"← Prev"` and `"Next →"` including the arrow characters, which screen readers announce as "left arrow Prev" and "Next right arrow". There is no `role="heading"` or `aria-level` on the month/year heading at line 125, meaning the calendar navigation section is inaccessible to non-visual users. PROPOSAL: (a) Change `useState(new Date('2025-11-13'))` to `useState(new Date())` so the calendar opens to the current month. (b) Add `aria-label="Previous month"` and `aria-label="Next month"` to the navigation buttons. (c) Add a "Today" button that calls `setCurrentDate(new Date())`. (d) Add `role="heading" aria-level={3}` to the month/year display at line 125.

- OBSERVATION: `App.tsx:1-202` + `components/Sidebar.tsx:11-52` + `components/ChatView.tsx` + `components/CalendarView.tsx` — Both `ChatView` and `CalendarView` are defined and exported as standalone components but are entirely absent from the application's routing and navigation. `App.tsx` lazy-loads six views: `Dashboard`, `AirQualityMapView`, `AnalysisView`, `DataExplorer`, `MapView`, `SettingsView` — `ChatView` and `CalendarView` are never imported. The `Sidebar.tsx` navItems array defines paths for five sections (lines 12-52): `/dashboard`, `/air-quality-map`, `/maps`, `/explore`, `/analysis`; there is no `/chat` or `/calendar` entry. `CalendarView` is referenced only by its own file (`CalendarView.tsx:581`) — zero other files import it, making it entirely dead code at runtime. `ChatView` is imported only in `tests/integration.test.tsx:16` for unit testing but is unreachable in the deployed app. The chat feature — a conversational AI assistant for SJV environmental queries — is described in `README.md` as a primary feature, yet there is no route, no sidebar link, and no keyboard shortcut (`App.tsx:32-86` registers `Alt+D/M/E/A/S` but not `Alt+C`). PROPOSAL: (a) Register `ChatView` as a lazy-loaded route at `/chat` in `App.tsx`; add a `ChatIcon`-backed entry to `Sidebar.tsx` navItems with shortcut `Alt+C`. (b) Either register `CalendarView` at a route (e.g., `/calendar`) or remove the file if it is intentionally retired — its dead presence misleads contributors. (c) Add `Alt+C` keyboard shortcut in the `Layout` shortcuts array in `App.tsx:32`.

- OBSERVATION: `components/ChatView.tsx:84` — The chat input uses `onKeyPress={(e) => e.key === 'Enter' && handleSend()}`. `onKeyPress` was deprecated in the DOM Level 3 Events spec and was removed from the HTML Living Standard; React 17+ emits a console deprecation warning when `onKeyPress` is used (`Warning: This synthetic event is deprecated and will be removed in a future release`). Additionally, `onKeyPress` does not fire for non-printable keys in all browser implementations — though `Enter` is typically handled, the behavior is not guaranteed by the spec. The correct replacement is `onKeyDown` (which fires on key-down for all keys, including `Enter`, with reliable cross-browser behavior). This is the only keyboard-activated action in the chat input; if `onKeyPress` is silently dropped by a future React or browser update, users lose the ability to submit messages via keyboard entirely. PROPOSAL: Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84`: `onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}`. Adding the `!e.shiftKey` guard allows users to press `Shift+Enter` for a newline if multi-line input is ever enabled.

- OBSERVATION: `components/DataExplorer.tsx:393` + `components/AnalysisView.tsx:450` — Active Recommendations row #1 (first seen run #7) documents unsanitized `dangerouslySetInnerHTML` in `AnalysisView.tsx:450`. The same pattern exists in `DataExplorer.tsx:393`: `dangerouslySetInnerHTML={{ __html: claudeResult.replace(/\n/g, '<br />') }}`. This means two separate entry points exist where AI-generated content is injected as raw HTML without sanitization. The `claudeResult` state in `DataExplorer.tsx:52` is set from `getDeepAnalysisResponse()` at line 131, which returns any text the Anthropic API returns including any `<script>`, `<img onerror>`, or anchor-based injection sequences. The existing row #1 in Active Recommendations addresses `AnalysisView.tsx` but not `DataExplorer.tsx` — the fix scope must be expanded. PROPOSAL: Expand the scope of row #1 to include `DataExplorer.tsx:393`; apply `DOMPurify.sanitize()` (or equivalent) to both locations before passing to `dangerouslySetInnerHTML`, or replace both with a Markdown renderer that does not interpret arbitrary HTML tags.

**Proposed actions:**
- Replace `'text-maroon-500'` with `'text-rose-900'` at `Dashboard.tsx:96`; add background tint for hazardous AQI card — H/L, score 3.0; ties current top 10, does not displace
- Change CalendarView initial date to `new Date()`, add aria-labels to nav buttons, add "Today" button — H/L, score 3.0; ties current top 10, does not displace
- Register `/chat` route for `ChatView` and add Sidebar entry; register or remove `CalendarView` dead code — H/M, score 1.5; does not enter top 10
- Replace deprecated `onKeyPress` with `onKeyDown` in `ChatView.tsx:84` — M/L, score 2.0; does not enter top 10
- Expand `dangerouslySetInnerHTML` sanitization fix (row #1) to cover `DataExplorer.tsx:393` — H/L, extends existing row #1

### Run #51 — 2026-05-30 — Lens: TS ↔ Python contract
**Scope:** Fourth TS↔Python contract pass. Examined: `types.ts`, `services/aiService.ts`, `services/dataService.ts`, `hooks/useLiveData.ts`, `hooks/useRealtimeAQI.ts`, `components/3d/CityMarkers.tsx`, `components/AnalysisView.tsx`, `components/Dashboard.tsx`, `data/dashboardData.ts`, `geointellisense-analytics/app/routes/chat.py`, `grounded_search.py`, `grounded_maps.py`, `historical_weather.py`, `predictive_analysis.py`, `weather_forecast.py`, `geointellisense-ingestion/src/aqi.rs`, `routes/aqi.rs`. Prior TS↔Py run details (runs #6, #21, #36) unavailable in full; findings verified as new against all visible prior-run detail.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:296-306` + `hooks/useRealtimeAQI.ts:309-324` — The SSE parser typed inline at lines 288-306 correctly declares `so2: number` (line 300) and `co: number` (line 301), matching the Rust `AqiReading` struct fields (serialized as camelCase via `#[serde(rename_all = "camelCase")]` at `aqi.rs:17`). However, the `readings.map(r => ({...}))` at lines 309-324 only maps `r.no2` into the resulting `RealtimeCityData` (line 318); `r.so2` and `r.co` are parsed from the wire but never assigned to any output field. Since `RealtimeCityData` (line 15) extends `CityData` (`CityMarkers.tsx:20`) which has no `so2` or `co` fields, and `RealtimeCityData` itself adds none, both pollutants are permanently dropped after SSE parsing on every tick. On the snapshot path, `hooks/useLiveData.ts:AqiReading` (lines 102-119) similarly omits `so2` and `co`, so neither the SSE nor the REST snapshot consumers expose these pollutants to the UI. The Rust service faithfully computes and transmits `so2` and `co` on every AQI reading, but the frontend has no typed surface to receive or display them. PROPOSAL: Add `so2?: number; co?: number` to `RealtimeCityData` (`useRealtimeAQI.ts:15`) and to `AqiReading` (`useLiveData.ts:102`); add `so2: r.so2, co: r.co` to the `readings.map` transform at `useRealtimeAQI.ts:309-324`. Propagate to any tooltip or detail panel that currently shows `no2`.

- OBSERVATION: `data/dashboardData.ts:28` vs `services/dataService.ts:67` vs `geointellisense-analytics/app/routes/historical_weather.py:98` — The static historical weather dataset in `dashboardData.ts` uses the field name `precipitation` (`{ month: 'Jul \'23', avgTemp: 98, precipitation: 0.1 }`), while the `HistoricalWeatherRecord` TypeScript interface at `dataService.ts:67` uses `totalPrecipitation: number` for the live API data path. Python's `historical_weather.py:98` returns `"totalPrecipitation": 0.0` — hardcoded, with an inline comment "sensor_readings doesn't have precip; placeholder". This creates two concrete bugs: (a) `Dashboard.tsx:217` computes `entry[${record.locationName}_precip] = record.totalPrecipitation` for the precipitation chart, which always equals 0.0 for all locations and all months — the ComposedChart precipitation bars at `Dashboard.tsx:634` render as a flat zero line; (b) AI predictive/forecast endpoints (`aiService.ts:121,156`) receive `{ month, avgTemp, precipitation }` from `dashboardData.ts` (correct field name and actual values), not from the live API — so the AI reasoning is built on static data while the chart displays live-API zeros. The field name discrepancy between `precipitation` (static) and `totalPrecipitation` (API) means a future attempt to feed live API data to the AI endpoints would require renaming at the call site. PROPOSAL: (a) Add a `precipitation` column to the `sensor_readings` schema (or integrate an external precipitation source); update `historical_weather.py` to query it. (b) Rename `totalPrecipitation` to `precipitation` in `HistoricalWeatherRecord` (`dataService.ts:67`) to align with both the static data shape and the AI endpoint contract. (c) Update `Dashboard.tsx:217,634` references accordingly.

- OBSERVATION: `types.ts:14-30` + `services/aiService.ts:45,67` vs `geointellisense-analytics/app/routes/grounded_search.py:79` + `grounded_maps.py:86` — The `GroundingChunk` interface at `types.ts:14-30` defines detailed `.web` (`uri`, `title`) and `.maps` (`uri`, `title`, `placeAnswerSources`) variants, and `aiService.ts:45` passes `data.groundingChunks` directly to callers. Both Python grounding routes exit with `return {"text": text, "groundingChunks": []}` — always an empty array. Inspection of `grounded_search.py:51` shows `tool_results = []` initialized but never populated from Anthropic's tool-use response blocks; `grounded_maps.py:58` does the same. The Anthropic Claude API does not natively return Google-style grounding chunks — the `GroundingChunk` type appears to be modeled after the Google Gemini grounding API format, which is not applicable here. As a result: the grounded search and maps UI features display no source citations despite the TS type declaring a rich citation structure. The `tool_results = []` dead code in both routes suggests an incomplete tool-call extraction loop was stubbed but never finished. PROPOSAL: Either (a) implement proper tool-call extraction from Anthropic's `content` blocks (extract `tool_use` type blocks and map their `input` to a simplified citation shape); or (b) remove `GroundingChunk` from the response contract, change the Python response to `{"text": text}` only, update `aiService.ts:45,67` return types accordingly, and delete the vestigial `tool_results = []` lines — eliminating the false citation promise.

- OBSERVATION: `hooks/useLiveData.ts:AqiReading:102-119` vs `geointellisense-ingestion/src/aqi.rs:17-41` — The snapshot-endpoint `AqiReading` type in `useLiveData.ts` is missing three fields the Rust struct serializes: (1) `color: &'static str` (e.g. `"#00e400"`) — the hex color for the AQI category, emitted at `aqi.rs:120` via camelCase serde; (2) `rawSensorCount: number | null` — `Option<i32>` at `aqi.rs:40`, serialized as `rawSensorCount` (omitted if null via `skip_serializing_if`); (3) `no2: f64`, `so2: f64`, `co: f64` — all three pollutants present in the Rust struct at `aqi.rs:31-33` but absent from `useLiveData.ts:AqiReading`. The omission of `color` is particularly wasteful: the UI currently re-derives AQI category colors in `utils/colorScales.ts:getAQICategory` using its own category-string→hex table, but the Rust side already computes the canonical hex color in `aqi_category()` at `aqi.rs:88`. If `colorScales.ts` and `aqi.rs:aqi_category` ever diverge (e.g. one updates a boundary while the other doesn't), the UI color and the server-computed color will silently differ. PROPOSAL: Add `color: string; rawSensorCount?: number; no2: number; so2: number; co: number` to `useLiveData.ts:AqiReading`; consider consuming `color` directly for AQI marker display rather than re-deriving it client-side, which would eliminate a cross-language color duplication risk.

**Proposed actions:**
- Add `so2?: number; co?: number` to `RealtimeCityData` and `AqiReading`; map `r.so2`/`r.co` in SSE transform at `useRealtimeAQI.ts:309` — M/L, score 2.0; does not enter top 10
- Rename `totalPrecipitation` → `precipitation` in `HistoricalWeatherRecord` (`dataService.ts:67`); fix Python `historical_weather.py:98` to query actual precip data — H/M, score 1.5; does not enter top 10
- Remove vestigial `tool_results = []` from `grounded_search.py:51` and `grounded_maps.py:58`; align Python response to match actual Anthropic API output or strip `GroundingChunk` from contract — M/L, score 2.0; does not enter top 10
- Add `color: string; rawSensorCount?: number; no2: number; so2: number; co: number` to `useLiveData.ts:AqiReading:102` — M/L, score 2.0; does not enter top 10

## 📚 Archive (one line per past run)
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
- Run #40 (2026-05-29) — Lens: Observability — 5 findings — 0 promoted to Active
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
