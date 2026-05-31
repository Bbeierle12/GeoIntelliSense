# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-31T17:10:00Z
Last run: #84 — Lens: Security

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
### Run #84 — 2026-05-31 — Lens: Security
**Scope:** Sixth security pass. Examined: `app/middleware.py`, `app/main.py`, `app/config.py`, `app/claude.py`, `app/routes/chat.py`, `app/routes/admin.py`, `app/routes/maps_config.py`, `app/routes/predictive_analysis.py`, `app/routes/weather_forecast.py`, `app/routes/ai_context.py`, `app/routes/deep_analysis.py`, `app/routes/grounded_search.py`, `app/routes/grounded_maps.py`, `app/routes/low_latency.py`, `app/routes/predict.py`, `app/routes/explore.py`, `app/routes/historical_aqi.py`, `app/routes/earthquakes.py`, `app/routes/calgem.py`, `geointellisense-ingestion/src/routes/admin.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `tests/security.test.tsx`. Cross-checked against Active Recommendations and prior security runs #9, #24, #39, #54, #69 (archived) to confirm all findings are new.

**Findings:**

- OBSERVATION: `app/routes/chat.py:95-108` — The `POST /api/chat/reset` and `POST /api/chat/session` endpoints have no authentication check and no rate limiting. Both endpoints are completely open to any caller. `POST /api/chat/session` (line 105) creates a new UUID session in the in-process `_sessions` dict in `claude.py` and appends to `_session_order`. The LRU eviction cap is `MAX_SESSIONS = 100` at `claude.py:27`. An attacker can POST 101 times in rapid succession to `/api/chat/session` at no cost (no auth, no rate limit), evicting all 100 legitimate active sessions from the in-memory store. Any in-flight or resumed chat that references an evicted session_id will receive an empty history (`get_session_history` returns `[]` for unknown IDs), silently losing the entire conversation context. `POST /api/chat/reset` (line 95) reads `session_id` from the request body without any ownership check; knowing (or brute-forcing) a valid UUID session_id lets any caller clear another user's chat history. By contrast, `POST /api/chat` (line 22) correctly calls `check_ai_auth` and `check_rate_limit`. The two helper endpoints were added without inheriting the same guards. PROPOSAL: Add `check_ai_auth(request)` and `check_rate_limit(request, "ai_chat")` to both `POST /api/chat/reset` and `POST /api/chat/session` — H/L, score 3.0; tied with existing top 10 (not displacing).

- OBSERVATION: `app/middleware.py:38-40` — The `_client_id()` function used for all rate-limit bucket keys reads the `X-Forwarded-For` header directly and trusts its value without any proxy validation: `forwarded = request.headers.get("x-forwarded-for", ""); ip = forwarded.split(",")[0].strip() if forwarded else request.client.host`. The `X-Forwarded-For` header is set by client HTTP libraries and is trivially spoofable — any HTTP client can set it to an arbitrary IP string. Since `_client_id` returns `f"ip:{ip}"` for unauthenticated requests (no `x-api-key`), this means every IP-based rate limit bucket (e.g., `geointelli:ratelimit:ai_chat:ip:1.2.3.4`) is independently addressable by any caller. An attacker making requests to `/api/chat` (or any other AI endpoint in dev mode where auth is skipped) can rotate `X-Forwarded-For: 1.2.3.x` on each request, distributing their traffic across 255 distinct rate-limit buckets and effectively multiplying their allowed request rate by 255× (20 req/min × 255 = 5,100 req/min for the `ai_chat` tier). The `Caddyfile` and `docker-compose.yml` do not set a trusted-proxy header that would override client-supplied values. The fix requires either (a) only trusting the last IP in the `X-Forwarded-For` chain (set by the actual reverse proxy), or (b) only using `request.client.host` and ignoring the header unless a known proxy IP prefix is configured. PROPOSAL: Replace the `X-Forwarded-For` extraction in `_client_id()` at `middleware.py:38-40` with `request.client.host` unconditionally, or add a `TRUSTED_PROXIES` config list and only accept the header from those sources — H/L, score 3.0; tied with existing top 10 (not displacing).

- OBSERVATION: `app/routes/predictive_analysis.py:31-34` and `app/routes/weather_forecast.py:25-29` — The `PredictiveAnalysisRequest` and `WeatherForecastRequest` Pydantic models impose no length constraints on any field. `historicalAqi: list[AqiDataPoint]` and `historicalWeather: list[WeatherDataPoint]` accept an unbounded number of items; `customFactors: str` accepts an unbounded string. At `predictive_analysis.py:69`, the merged list is serialized as `json.dumps(combined, indent=2)` and embedded verbatim into the LLM prompt. Sending `historicalAqi` with 5,000 `AqiDataPoint` items produces approximately 300KB of JSON embedded in the prompt string, consuming the majority of `claude-sonnet-4-20250514`'s 200K-token context window. Combined with a `customFactors` string of 100K characters and a `historicalWeather` list of equal size, a single unauthenticated request (these endpoints have no auth per Active Recommendation #10) can manufacture a prompt that exceeds the context window, causing a 400 error from the Anthropic API after the full token-billing cost has been incurred. Even with rate limiting, each single request at maximum payload can cost several dollars in inference fees. No request-body size limit is configured at the FastAPI or ASGI layer. PROPOSAL: Add Pydantic field validators: `customFactors: str = Field("", max_length=2000)` and use `Annotated[list[AqiDataPoint], Field(max_length=120)]` (120 months = 10 years) for `historicalAqi` and `historicalWeather` in both request models — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `app/routes/ai_context.py:13` — `GET /api/ai/context` returns the full live data context that is injected into every AI system prompt, with no authentication and no rate limiting. The response includes the exact text of `build_live_context()` output: the assembled AQI readings, fire detections, earthquake data, water levels, CalEnviroScreen data, and any other context sources in `app/context.py`. More importantly, the response reveals the exact structure and schema of what the system prompt looks like to the AI, including any prompt-engineering context markers (section headers, instruction fragments, and data field names). An adversary can call `GET /api/ai/context` once to obtain a complete map of the system prompt's live-data section, then craft a precisely targeted prompt-injection payload — e.g., injecting a string that appears to be a new authoritative context section because it mimics the observed structure — to redirect the AI's behavior via the user-facing `/api/chat` or `/api/grounded-search` inputs. The endpoint is described in the docstring as "for debugging and inspection" (`ai_context.py:12`), confirming it was intended as a development tool, not a public endpoint. PROPOSAL: Add `check_ai_auth(request)` to `GET /api/ai/context` at `ai_context.py:13`; alternatively, remove the endpoint entirely from production builds — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `app/main.py:63-78` — The `CORSMiddleware` is configured with `allow_credentials=True` unconditionally, but the `allow_origins` value is conditionally set: in dev mode (when `settings.admin_token` is empty), `_allowed_origins = ["*"]` at line 70; in production it is a specific allowlist. The combination of `allow_origins=["*"]` and `allow_credentials=True` violates the Fetch Living Standard (§3.2.5, step 7): browsers refuse to expose responses to scripts when both `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Credentials: true` are present in the same response. Starlette's `CORSMiddleware` does not validate this combination and emits both headers simultaneously. The practical security consequence: in dev mode, any cross-origin page can issue unauthenticated GET requests to all data endpoints (since no credentials are required for GETs) and receive the responses — because browsers enforce `*` + credentials only for credentialed requests. For `POST` requests with `Content-Type: application/json`, the preflight `OPTIONS` response includes `Access-Control-Allow-Origin: *` + `Access-Control-Allow-Credentials: true`, which browsers also reject, preventing any credentialed cross-origin POST even in dev. The net effect is that in dev mode: non-credentialed cross-origin GETs to all 40+ API routes succeed from any origin; credentialed cross-origin POSTs fail silently. The `allow_credentials=True` setting at line 77 should be conditioned on whether specific origins are configured, or the origin list should always be explicit. PROPOSAL: Change the CORS setup so that `allow_credentials=True` is only set when `_allowed_origins != ["*"]` — i.e., wrap line 77 as `allow_credentials=_allowed_origins != ["*"]`; and add `"http://localhost:5175"` and `"http://localhost:3000"` to the explicit dev-mode allowlist instead of using the wildcard — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Add `check_ai_auth(request)` and `check_rate_limit(request, "ai_chat")` to `POST /api/chat/reset` at `chat.py:95` and `POST /api/chat/session` at `chat.py:105` — H/L, score 3.0; tied with existing top 10
- Replace unchecked `X-Forwarded-For` extraction in `_client_id()` at `middleware.py:38-40` with `request.client.host`, or add a `TRUSTED_PROXIES` config list — H/L, score 3.0; tied with existing top 10
- Add `max_length=2000` to `customFactors` and `max_length=120` to the list fields in `PredictiveAnalysisRequest` and `WeatherForecastRequest` — M/L, score 2.0; does not displace top 10
- Add `check_ai_auth(request)` to `GET /api/ai/context` at `ai_context.py:13` — M/L, score 2.0; does not displace top 10
- Condition `allow_credentials` on whether specific origins are configured in `main.py:77` — L/L, score 1.0; does not displace top 10

### Run #83 — 2026-05-31 — Lens: Data pipeline integrity
**Scope:** Sixth data-pipeline-integrity pass. Examined: `geointellisense-ingestion/src/purpleair.rs`, `src/usgs.rs`, `src/broadcast.rs`, `src/db/persist.rs`, `src/config.rs`, `src/redis_cache.rs`, `src/routes/sse.rs`; Python: `app/clients/airnow.py`, `app/clients/nasa_firms.py`, `app/clients/usgs_water.py`, `app/clients/noaa_cdo.py`, `app/http_client.py`, `app/routes/fires.py`, `app/routes/water.py`, `app/routes/inversion.py`, `app/source_toggles.py`; DB migrations: `db/migrations/012_fire_detections.sql`, `db/migrations/003_earthquake_events.sql`, `db/migrations/011_water_readings.sql`, `db/migrations/002_sensor_readings.sql`. Cross-checked against prior data-pipeline runs #8, #23, #38, #53, #68 (archived) and Active Recommendations to confirm all findings are new.

**Findings:**

- OBSERVATION: `db/migrations/012_fire_detections.sql` and `app/routes/fires.py:239` — The `fire_detections` TimescaleDB table has no `UNIQUE` constraint and no primary key. Its three indices are all non-unique: `idx_fire_geom` (GIST on `geom`), `idx_fire_time` (on `time DESC`), and `idx_fire_confidence` (on `confidence, time DESC`). The `_persist_fires()` function at `fires.py:239-252` uses `ON CONFLICT DO NOTHING` without a conflict target column list. In PostgreSQL, `ON CONFLICT DO NOTHING` without an explicit target matches any uniqueness violation — but since there are no unique constraints on this table, no conflict can ever occur, so every INSERT always succeeds. The result: every 30-minute FIRMS poll re-inserts all fire detections, creating unbounded duplicates. After 7 days of continuous polling, a single fire detection appears 336 times. The `fires_history` endpoint at `fires.py:149-176` queries `fire_detections` without any `DISTINCT` or deduplication, so it returns 336× the true count and inflated `distance_km` aggregates. Compare with `003_earthquake_events.sql:18`: `CREATE UNIQUE INDEX idx_earthquake_event_id ON earthquake_events (event_id, time)` — the earthquake table correctly has a unique index, which is why `ON CONFLICT (event_id, time) DO NOTHING` in `usgs.rs:168` actually works. PROPOSAL: Add a new migration: `CREATE UNIQUE INDEX idx_fire_detections_unique ON fire_detections (time, latitude, longitude, satellite);`; update `_persist_fires` at `fires.py:241` to `ON CONFLICT (time, latitude, longitude, satellite) DO NOTHING` — H/L, score 3.0; does not outrank existing top 10 (tied).

- OBSERVATION: `geointellisense-ingestion/src/usgs.rs:107` — `fetch_recent()` creates a new `reqwest::Client` on every invocation: `let client = reqwest::Client::new()`. `spawn_earthquake_poller` in `broadcast.rs:154` calls `usgs::fetch_and_persist(&pool)` every `earthquake_interval_secs` (default 300 seconds = 5 minutes). Each call allocates a fresh `reqwest::Client` with its own internal connection pool, performs a full TCP+TLS handshake to `earthquake.usgs.gov`, then discards the client and connection after receiving the response. This means 288 fresh TLS handshakes per day to a single USGS endpoint. The `PurpleAirClient` struct in `purpleair.rs:36-47` explicitly stores `http: reqwest::Client` as a persistent field to reuse the connection pool across polls — the same design discipline was not applied to the USGS client. The USGS `fetch_recent` function is also called directly from `routes/earthquakes.rs` (on-demand HTTP handler), so the pattern is replicated in two call sites. PROPOSAL: Define a `UsgsClient` struct analogous to `PurpleAirClient` (`pub struct UsgsClient { http: reqwest::Client, bbox: BBox }`); store it in `AppState`; pass it by `Arc` to `spawn_earthquake_poller` — eliminates per-poll TLS overhead — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `app/clients/airnow.py:171` — The timestamp construction in `_normalize_observations` is: `timestamp = first.get("DateObserved", "").strip() + "T" + first.get("HourObserved", "12").zfill(2) + ":00:00"`. The AirNow API documentation specifies that `HourObserved` is returned as a JSON integer (e.g., `14` for 2 PM). When the field is present in the response, `first.get("HourObserved", "12")` returns an `int`, and calling `.zfill(2)` on an `int` raises `AttributeError: 'int' object has no attribute 'zfill'`. This exception is caught by the `try/except` in `get_all_sjv_current()` at line 98-101, which logs a warning and skips the city with `continue`. Because `HourObserved` is present in every AirNow observation response, `_normalize_observations` always raises `AttributeError` when the API is reachable with a valid key, causing `get_all_sjv_current()` to return an empty list for every city. The AirNow current-observation integration is functionally broken for any deployment with a valid `AIRNOW_API_KEY`. The forecast path at `get_all_sjv_forecast()` (line 105-135) does not call `_normalize_observations` and is unaffected. PROPOSAL: Replace `first.get("HourObserved", "12").zfill(2)` at `airnow.py:171` with `str(first.get("HourObserved", 12)).zfill(2)` — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:106-110` — The broadcast ticker re-stamps every cached PurpleAir reading with `Utc::now()` before broadcasting: `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()`. The PurpleAir fetch loop (separate Tokio task) only updates the cache on successful fetches: `Err(e) => tracing::warn!("PurpleAir fetch failed: {e}, cache unchanged")`. If the PurpleAir API fails or is rate-limited, the cache holds the last successful readings — which may be 10 minutes, 30 minutes, or arbitrarily old depending on how many consecutive poll cycles fail. The broadcast ticker, running every 5 seconds (default `broadcast_interval_secs`), re-timestamps these stale readings with `Utc::now()` and sends them over SSE as `aqi-update` events. Clients receive readings with a `timestamp` equal to the current time, with no indication that the underlying sensor data has not been refreshed. The `AqiReading` struct has no `dataAge`, `stale`, or `lastFetchedAt` field. The Rust `source: &'static str` field only distinguishes `"purpleair"` vs `"mock"` — not freshness. PROPOSAL: Track `last_successful_fetch: Arc<RwLock<Option<DateTime<Utc>>>>` alongside the cache; in the broadcast tick, include `"stale": now - last_fetch > 2 * purpleair_interval_secs` in the serialized JSON event so the frontend can display a staleness warning when data is stale — M/M, score 1.0; does not displace top 10.

- OBSERVATION: `app/routes/fires.py:46-48`, `app/routes/water.py:36-38`, `app/routes/inversion.py:39-41` — All three Python background poll loops implement the source-toggle check as `if not await is_enabled(...): await asyncio.sleep(<full_interval>); continue`. When a source is disabled, the loop sleeps for the full poll interval (1800s for fires/inversion, 900s for water) before re-checking the toggle. This also means that when a previously-disabled source is re-enabled via `POST /api/admin/sources/{source}/enable`, the poller does not respond for up to 30 minutes (for fires/inversion) or 15 minutes (for water). An operator enabling a source during an active fire incident or flood event would see no data for up to 30 minutes. Furthermore, the `asyncio.sleep(1800)` inside the "source disabled" branch executes in addition to the unconditional `await asyncio.sleep(1800)` at the bottom of the loop (`fires.py:69`), so the effective re-check interval when disabled is the full interval, not reduced. Compare with the Rust `spawn_ticker` in `broadcast.rs:56-94`: when the PurpleAir toggle is off, it simply `continue`s to the next `interval.tick().await`, which fires at the next scheduled tick — no extra sleep. PROPOSAL: Replace the fixed `asyncio.sleep` in the disabled branch of each poll loop with a shorter re-check interval (e.g., 60 seconds), so that re-enabling a source takes effect within a minute — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Add `CREATE UNIQUE INDEX idx_fire_detections_unique ON fire_detections (time, latitude, longitude, satellite)` migration; update `_persist_fires` at `fires.py:241` to use `ON CONFLICT (time, latitude, longitude, satellite) DO NOTHING` — H/L, score 3.0; tied with existing top 10
- Create `UsgsClient` struct with a persistent `reqwest::Client` field; store in `AppState`; pass to `spawn_earthquake_poller` — eliminates per-poll TLS overhead at `usgs.rs:107` — M/L, score 2.0; does not displace top 10
- Change `airnow.py:171` `.zfill(2)` call to `str(...).zfill(2)` to fix `AttributeError` that silently breaks all AirNow current observations — L/L, score 1.0; does not displace top 10
- Add staleness tracking to the broadcast ticker (`broadcast.rs:106-110`); include `stale: bool` in the SSE payload when PurpleAir data is stale — M/M, score 1.0; does not displace top 10
- Reduce the source-toggle re-check sleep in `fires.py:47`, `water.py:37`, `inversion.py:40` from the full poll interval to ~60 seconds so that enabling a source takes effect promptly — M/L, score 2.0; does not displace top 10

### Run #82 — 2026-05-31 — Lens: UX / UI flaws
**Scope:** Eighth UX/UI-flaws pass. Examined: `components/CalendarView.tsx`, `components/ChatView.tsx`, `components/Dashboard.tsx`, `components/AnalysisView.tsx`, `components/SettingsView.tsx`, `components/Header.tsx`, `components/Sidebar.tsx`, `components/LoadingStates.tsx`, `components/Toast.tsx`, `App.tsx`, `index.html`. Cross-checked against prior UX runs #7, #22, #37, #52, #67 (archived) and Active Recommendations to confirm all findings are new.

**Findings:**

- OBSERVATION: `components/CalendarView.tsx` — The file defines a complete "Comprehensive Weather Calendar" feature: a 580-line component with a 7-column calendar grid, list view, detailed day panel with 5 hourly Recharts charts, time range selector (1 day/1 week/1 month/3 months/6 months/1 year), moon phase icons, and agricultural metrics (evapotranspiration). The component accepts `selectedLocations: LocationKey[]` as a required prop. No other file imports `CalendarView` — a `grep -r "CalendarView"` across the entire project returns only the component's own file. There is no `/calendar` route in `App.tsx` (routes declared at lines 133-194 are: `/dashboard`, `/air-quality-map`, `/analysis`, `/explore`, `/maps`, `/settings`). There is no Calendar nav item in `Sidebar.tsx` (nav items at lines 11-52 are: Dashboard, Air Quality Map, Google Maps, Data Explorer, AI Analysis). The feature is entirely unreachable from the running application — it cannot be navigated to. PROPOSAL: Add `const CalendarView = lazy(() => import('./components/CalendarView'))` to `App.tsx`; add a `/calendar` route with the `<CalendarView selectedLocations={['Bakersfield']} />` element inside `<Layout>`; add a Calendar nav item to `Sidebar.tsx` with shortcut `Alt+C` — H/M, score 1.5; does not displace top 10.

- OBSERVATION: `components/CalendarView.tsx:21` — The calendar's initial month is hardcoded as `useState(new Date('2025-11-13'))`. As of today (2026-05-31), this date is over 6 months in the past. On first render the calendar always opens to November 2025 regardless of the actual current date. `getDayData()` at line 82-89 looks up dates in the static `locationData.dailyForecast` array; the forecast data in `data/dashboardData.ts` is keyed to specific date strings. If the data coverage ends in early 2026, navigating to May 2026 produces an empty calendar (all cells disabled, `dayData = null`, `cursor-not-allowed` class applies). A user opening the calendar for the first time encounters a 6-month-stale month with no apparent way to know they should press "Next" six times. PROPOSAL: Replace `useState(new Date('2025-11-13'))` at `CalendarView.tsx:21` with `useState(new Date())` so the calendar opens to the current month — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `components/ChatView.tsx:84` — The chat input's Enter-key handler uses the deprecated `onKeyPress` event: `onKeyPress={(e) => e.key === 'Enter' && handleSend()}`. `onKeyPress` was removed from the WHATWG DOM Living Standard (replaced by `onKeyDown`/`onKeyUp`) and React's synthetic event system emits a deprecation warning for it in development mode. While modern browsers still fire `keypress` for printable characters and Enter, the event is absent for non-printable keys (Escape, Tab, F-keys), meaning if this handler were extended, some key combinations would silently fail. No other input or textarea in the codebase uses `onKeyPress`; all other keyboard handlers (e.g., `App.tsx`'s `useKeyboardShortcuts`) use `keydown`. PROPOSAL: Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84`: `onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}` — adding the `!e.shiftKey` guard is also worth considering so Shift+Enter can insert line breaks if multiline support is added later — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `components/Dashboard.tsx:517-529` — The location-filter toggle buttons in the Historical Analysis section communicate their selected state only through CSS color changes (`bg-brand-primary` when selected vs `bg-brand-bg-lighter` when not). The buttons have no `aria-pressed` attribute, so screen reader users receive no feedback about which locations are currently selected. By contrast, the analysis-tool selector buttons in `AnalysisView.tsx:294-303` are correctly annotated with `aria-pressed={tool === key}` — the same toggle-button pattern applied consistently. Since `Dashboard.tsx` is the primary landing page and location comparison is a core interaction, this gap affects all keyboard/screen-reader users attempting to use the historical analysis section. PROPOSAL: Add `aria-pressed={selectedLocations.includes(loc)}` to the `<button>` element at `Dashboard.tsx:519` — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `components/AnalysisView.tsx:420` — The main prompt `<textarea>` for non-forecast analysis tools (rendered at line 420 inside the `else` branch at line 419) has no `id`, no `aria-label`, and no associated `<label htmlFor>` element. The only identification is the `placeholder={currentTool.placeholder}` attribute (e.g., `"e.g., Define atmospheric river."`). The WCAG 2.1 success criterion 1.3.1 (Info and Relationships) and 3.3.2 (Labels or Instructions) require that form inputs have a programmatic label. Screen readers such as NVDA and JAWS do not reliably announce `placeholder` text as a label — they typically read it once on first focus and then fall silent when the field has content. The forecast-tool `<textarea>` in the same component at line 409-416 is correctly labeled (`id="custom-factors"`, `<label htmlFor="custom-factors">`). PROPOSAL: Add `id="prompt-textarea"` to the `<textarea>` at `AnalysisView.tsx:420`; add `<label htmlFor="prompt-textarea" className="sr-only">{currentTool.name}: enter your prompt</label>` immediately above it — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Add `/calendar` route and sidebar nav item to make `CalendarView.tsx` reachable from the application — H/M, score 1.5; does not displace top 10
- Replace `new Date('2025-11-13')` with `new Date()` at `CalendarView.tsx:21` to default calendar to current month — L/L, score 1.0; does not displace top 10
- Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84`; consider adding `!e.shiftKey` guard — L/L, score 1.0; does not displace top 10
- Add `aria-pressed={selectedLocations.includes(loc)}` to location toggle buttons at `Dashboard.tsx:519` — L/L, score 1.0; does not displace top 10
- Add `id="prompt-textarea"` and a `className="sr-only"` label to the non-forecast `<textarea>` at `AnalysisView.tsx:420` — L/L, score 1.0; does not displace top 10

## 📚 Archive (one line per past run)
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
