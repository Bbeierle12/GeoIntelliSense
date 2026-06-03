# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-03T21:10:00Z
Last run: #143 — Lens: Data pipeline integrity

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
### Run #143 — 2026-06-03 — Lens: Data pipeline integrity
**Scope:** Tenth data-pipeline-integrity pass. Examined: `geointellisense-ingestion/src/db/persist.rs` (full); `geointellisense-ingestion/src/broadcast.rs` (full); `geointellisense-ingestion/src/purpleair.rs` (full); `geointellisense-ingestion/src/usgs.rs` (full); `geointellisense-ingestion/src/redis_cache.rs` (full); `geointellisense-ingestion/src/aqi.rs` (full); `geointellisense-analytics/app/http_client.py` (full); `geointellisense-analytics/app/routes/water.py` (full); `geointellisense-analytics/app/routes/fires.py` (full); `geointellisense-analytics/app/clients/nasa_firms.py` (full); `geointellisense-analytics/app/clients/usgs_water.py` (full); `geointellisense-analytics/app/context.py` (lines 1–250, 380–430); `geointellisense-analytics/app/source_toggles.py` (full). Cross-checked against Active Recommendations and Latest Findings runs #141–#142 plus archived data-pipeline-integrity runs #8, #23, #38, #53, #68, #83, #98, #113, #128 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `db/persist.rs:7-11` + `broadcast.rs:106-110` — `write_readings` issues a plain `INSERT INTO sensor_readings (...) VALUES (...)` with no `ON CONFLICT` clause. The broadcast ticker at `broadcast.rs:97-130` fires every `broadcast_interval_secs` (e.g., 30 seconds). On each tick it re-reads the PurpleAir live cache and re-timestamps every reading with the current broadcast time (`broadcast.rs:107-109`: `AqiReading { timestamp: now, ..r.clone() }`), then calls `persist::write_readings`. Between PurpleAir fetches (`purpleair_interval_secs`, typically 120 s), the same underlying sensor measurements are written to the DB multiple times — once per broadcast tick — each with a fabricated "broadcast time" timestamp. At 30 s broadcast / 120 s PurpleAir intervals, 4 inserts fire per PurpleAir observation: one with the real fetch time, three with fabricated intermediate timestamps. Unlike the earthquake persist (`ON CONFLICT (event_id, time) DO NOTHING` at `usgs.rs:169-173`) and water persist (`ON CONFLICT (time, site_id, parameter) DO NOTHING` at `water.py:291-294`), `sensor_readings` has no deduplication. Consequences: (1) row count is 4× actual observation count; (2) time-windowed `AVG(pm25)` queries in `context.py:201-211` count the same measurement 4 times, biasing AQI aggregates; (3) DB storage grows 4× faster than expected. PROPOSAL: Either (a) add a unique constraint on `(time, location_id)` to `sensor_readings` and update `db/persist.rs:7-11` to `ON CONFLICT (time, location_id) DO NOTHING`; or (b) remove the timestamp overwrite in `broadcast.rs:107-109` (change `AqiReading { timestamp: now, ..r.clone() }` → `r.clone()`) so each PurpleAir reading is persisted only once at its original fetch timestamp — L/L effort for (b); M/L for (a) (requires schema migration).

- OBSERVATION: `usgs.rs:6-9, 22-32, 80-81, 118` — `BBox::default()` covers the entire world (lat −90..90, lng −180..180). `fetch_and_persist` at line 81 calls `fetch_and_persist_bbox(pool, &BBox::default())`, which is the sole call site in `broadcast.rs:154`. `fetch_recent` at lines 103-106 builds a 30-day window at `minmagnitude=0.5` (line 118). The USGS FDSNWS API responds with HTTP 400 ("Too many results, try smaller query") when a query would return >20,000 events. A 30-day global M0.5+ query routinely yields 15,000–50,000+ events depending on aftershock clusters; during high-activity periods (post-major-earthquake aftershock swarms), 20,000 is easily exceeded. `fetch_recent` catches the 400 at `usgs.rs:124-128` and propagates `Err(...)`. `fetch_and_persist_bbox` logs `tracing::warn!("USGS fetch failed: {e}")` and returns `Vec::new()`. `spawn_earthquake_poller` overwrites `*quake_cache` with the empty vector (`broadcast.rs:165`). SSE clients then receive "0 significant earthquakes" — a false negative — precisely on the days with elevated seismic activity when the earthquake feed matters most. The failure is silent to users. PROPOSAL: Replace the global default bbox constants at `usgs.rs:6-9` with the SJV-centred region (`DEFAULT_MIN_LAT = 33.5`, `DEFAULT_MAX_LAT = 38.5`, `DEFAULT_MIN_LNG = -122.5`, `DEFAULT_MAX_LNG = -116.5`); also raise `minmagnitude` at line 118 from `0.5` to `2.0` to match the M2.0 filter used in `context.py:356` and the M3.0 SSE filter at `broadcast.rs:159` — a regional SJV query at M2.0+ returns a few hundred events/month, well under the 20,000 limit — L/L effort (4 constant changes + 1 query-param change).

- OBSERVATION: `usgs.rs:107` + `purpleair.rs:45` — Both Rust HTTP clients have no request timeout. `usgs.rs:107`: `let client = reqwest::Client::new()` is called inside `fetch_recent`, which is invoked on every earthquake poll cycle. `reqwest::Client::new()` uses no timeout. If the USGS endpoint stalls (hung TCP, silent firewall drop), the earthquake poller task blocks indefinitely on `.send().await` — Tokio will never cancel it without a process restart. Separately, `purpleair.rs:45`: `http: reqwest::Client::new()` also sets no timeout. A stalled PurpleAir connection would block the PA poll loop permanently after the first hung request, stopping all subsequent PurpleAir data refreshes for the process lifetime. The Python counterpart `http_client.py:14` correctly sets `DEFAULT_TIMEOUT = 30.0` and applies it via `async with httpx.AsyncClient(timeout=timeout)`. Additionally, the USGS client is re-instantiated on every poll cycle (`usgs.rs:107` inside `fetch_recent`), discarding TCP connection-pooling and TLS-session-reuse benefits between polls — unlike `PurpleAirClient` which stores `http: reqwest::Client` as a field and reuses it across polls. PROPOSAL: Change both `reqwest::Client::new()` calls to `reqwest::ClientBuilder::new().timeout(std::time::Duration::from_secs(30)).build().unwrap()` at `purpleair.rs:45` and `usgs.rs:107`; additionally refactor `fetch_recent` into a `UsgsClient` struct (mirror of `PurpleAirClient`) so the pooled client persists across poll cycles — L/L for timeout addition; M/L for the full struct refactor.

- OBSERVATION: `context.py:243-248` — `_get_forecast_context` uses `r.scan_iter("geointelli:analytics:forecast:*")` with an immediate `break` to pick the first matching Redis key. Redis `SCAN` iteration order is undefined — it depends on the internal hash table cursor position, which varies with Redis version, keyspace size, and memory layout. If multiple forecast cache keys exist (e.g., one per location queried by the `nws_forecast` route for Fresno, Bakersfield, Stockton, Modesto, Visalia, Merced), the `break` picks an arbitrary location's forecast. This arbitrary forecast is then injected into the Claude system prompt by `build_context_text()` at line 73, which is called by every Claude AI route (chat, analysis, deep analysis, predictive analysis). Claude may reference Fresno's weather forecast when reasoning about Bakersfield conditions — a factual error that is silent and plausible-looking (both cities are in the SJV and have similar but distinct climates). No location field is logged or validated. PROPOSAL: Store the primary/regional forecast under a fixed key (e.g., `geointelli:analytics:forecast:primary`) written by `nws_forecast.py` when the default multi-location forecast is cached, and replace `context.py:244-248`'s `scan_iter` + `break` with `await r.get("geointelli:analytics:forecast:primary")` — L/L effort (one-line key change in `nws_forecast.py` + one-line update in `context.py`).

**Proposed actions:**
- Add `ON CONFLICT (time, location_id) DO NOTHING` to `db/persist.rs:7-11` sensor_readings INSERT (with matching unique constraint), OR remove broadcast-ticker timestamp overwrite at `broadcast.rs:107-109` — eliminates duplicate DB rows and aggregate bias — L/L (b) or M/L (a)
- Replace global earthquake bbox constants at `usgs.rs:6-9` with SJV region; raise `minmagnitude` to `2.0` at line 118 — prevents silent earthquake data loss on active seismic days — L/L effort
- Add 30-second request timeout to `reqwest::ClientBuilder` in `purpleair.rs:45` and `usgs.rs:107`; refactor USGS client into a reusable struct — prevents infinite hangs in poll loops — L/L (timeout only) or M/L (struct refactor)
- Replace non-deterministic `scan_iter`+`break` in `context.py:244-248` with a deterministic fixed Redis key for the primary forecast — eliminates wrong-city weather in Claude system prompts — L/L effort

### Run #142 — 2026-06-03 — Lens: UX / UI flaws
**Scope:** Tenth UX/UI-flaws pass. Examined: `App.tsx` (full — routing, keyboard shortcuts); `components/Sidebar.tsx` (full — nav items, shortcut tooltips); `components/CalendarView.tsx` (full — 581 lines); `components/DataExplorer.tsx` (full — chart, Claude result rendering); `components/dashboard/widgets/WeatherWidget.tsx` (full); `components/dashboard/WidgetShell.tsx` (full); `styles/theme-light.css` (full); `components/SettingsView.tsx` (lines 1–260, 420–700); `components/dashboard/widgets/AqiGaugeWidget.tsx` (full); `components/dashboard/LiveDashboard.tsx` (full); `components/3d/UIPanels.tsx` (full); `components/LoadingStates.tsx` (full). Cross-checked against Active Recommendations and runs #140–#141 (Latest Findings) plus archived UX/UI runs #7, #22, #37, #52, #67, #82, #97, #112, #127 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `components/DataExplorer.tsx:393` — `dangerouslySetInnerHTML={{ __html: claudeResult.replace(/\n/g, '<br />') }}` — The Data Explorer's "Ask Claude" feature renders the AI response via `dangerouslySetInnerHTML` with no sanitization, only a newline-to-`<br>` substitution. This is the same XSS pattern as `AnalysisView.tsx:450` (Active Recommendation #1), but in a separate route (`/explore`) that was not mentioned in that recommendation. A Claude response containing `<script>alert(1)</script>` or `<img src=x onerror=...>` would execute in the user's browser. The `claudeResult` state is populated by `getDeepAnalysisResponse(prompt)` at line 143, which calls `POST /api/analysis/deep` on the backend. The backend routes to Claude via `deep_analysis.py` and returns the raw model text, which flows through `aiService.ts:getDeepAnalysisResponse` → `DataExplorer.tsx:setClaudeResult` → `dangerouslySetInnerHTML` with no sanitization at any step. `DOMPurify` is not imported anywhere in the project. PROPOSAL: Add `import DOMPurify from 'dompurify'` to `DataExplorer.tsx` and change `dangerouslySetInnerHTML={{ __html: claudeResult.replace(/\n/g, '<br />') }}` to `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(claudeResult.replace(/\n/g, '<br />')) }}` — L/L effort (mirrors the fix needed for Active Rec #1 in `AnalysisView.tsx`).

- OBSERVATION: `components/CalendarView.tsx:21` + absence of any import in App.tsx or any other file — `CalendarView` is a 581-line fully-implemented weather calendar component with multi-month navigation, hourly charts, moon phase display, and a detailed day view. It is not imported anywhere in the codebase: `grep -rn "CalendarView"` returns only its own definition. No route exists for it in `App.tsx`; the `Sidebar.tsx` navItems array contains no entry pointing to it. The component defaults to `useState(new Date('2025-11-13'))` — hardcoded to November 2025, which is 7 months in the past as of June 2026. Because no route or nav item exposes it, this date is invisible to users, but if/when the component is wired in it will open showing the wrong month. PROPOSAL: Either (a) add a `/calendar` route in `App.tsx` with a `CalendarView` lazy import, a corresponding nav item in `Sidebar.tsx`, and change `useState(new Date('2025-11-13'))` to `useState(new Date())` to default to the current month — M/L effort; or (b) delete the component if the Calendar feature was abandoned — L/L effort (removes 581 lines of dead code).

- OBSERVATION: `components/dashboard/widgets/WeatherWidget.tsx:9` — `const loading = snapLoading && fcLoading;` uses logical AND instead of OR to combine two loading states. `snapLoading` comes from `useAqiSnapshot()` (a Redis-backed AQI snapshot endpoint); `fcLoading` comes from `useNwsForecast()` (an NWS HTTP-backed forecast endpoint). When the faster endpoint (`useAqiSnapshot`) resolves first, `snapLoading` becomes `false` while `fcLoading` is still `true`. The computed `loading` becomes `false && true = false`. `WidgetShell` receives `loading={false}` (line 29) and stops showing the loading skeleton (`WidgetShell.tsx:22` guards on `if (loading && !error)`). At this moment `forecast` is still `undefined`, so `(forecast || []).filter(...)` at line 24 returns `[]`, and `periods.length === 0` at line 60 triggers the "No forecast data" empty state message before any data has actually been requested. The user sees "No forecast data" for a brief flash, which then updates to real data when `useNwsForecast` resolves — a confusing experience. PROPOSAL: Change `WeatherWidget.tsx:9` from `const loading = snapLoading && fcLoading;` to `const loading = snapLoading || fcLoading;` — eliminates the premature empty-state flash — L/L effort (single operator change).

- OBSERVATION: `components/Sidebar.tsx:33` + `App.tsx:32–86` — The Google Maps nav item in `Sidebar.tsx` declares `shortcut: 'Alt+G'` and renders it in the `title` attribute at line 84: `"Google Maps - Alt+G"`. The `useKeyboardShortcuts` hook in `App.tsx:88` is called with 6 shortcuts: `Alt+D` (Dashboard), `Alt+M` (Air Quality Map), `Alt+E` (Data Explorer), `Alt+A` (Analysis), `Alt+S` (Settings), `Shift+?` (announce shortcuts). There is no `Alt+G` entry. Users hovering over the Google Maps nav item see "Google Maps - Alt+G" in the native tooltip and may try the shortcut, which does nothing (or triggers a browser/OS action). Separately, `SettingsView.tsx:1009–1024` renders a Keyboard Shortcuts help section that lists 6 shortcuts but omits `Alt+G` for Google Maps entirely, creating a second inconsistency: the nav tooltip advertises a shortcut that the settings help page doesn't mention and the app doesn't implement. PROPOSAL: Add `{ key: 'g', altKey: true, action: () => { navigate('/maps'); announce('Navigated to Google Maps'); }, description: 'Go to Google Maps' }` to the `shortcuts` array in `App.tsx:32` and a corresponding entry in `SettingsView.tsx:1009`'s shortcuts array — L/L effort (two lines added to existing arrays).

**Proposed actions:**
- Add `DOMPurify.sanitize()` wrapper to `DataExplorer.tsx:393` `dangerouslySetInnerHTML` call, mirroring fix needed for Active Rec #1 in `AnalysisView.tsx` — L/L effort
- Wire `CalendarView` into a `/calendar` route in `App.tsx` and Sidebar nav, changing hardcoded `new Date('2025-11-13')` to `new Date()`, OR delete the 581-line dead component — M/L (wire) or L/L (delete)
- Fix `WeatherWidget.tsx:9` loading gate: `snapLoading && fcLoading` → `snapLoading || fcLoading` — L/L effort (eliminates premature "No forecast data" flash)
- Add `Alt+G` shortcut to `App.tsx` keyboard shortcuts array and `SettingsView.tsx` shortcuts help list — L/L effort

### Run #141 — 2026-06-03 — Lens: TS ↔ Python contract
**Scope:** Tenth TS↔Python-contract pass. Examined: `types.ts` (full); `services/aiService.ts` (full); `services/dataService.ts` (full); `services/WeatherService.ts` (full); `services/AirQualityService.ts` (full); `components/ChatView.tsx` (full); `components/AnalysisView.tsx` (full); `components/Dashboard.tsx` (lines 1–100, 200–330); `hooks/useNormalizedData.ts` (full); `geointellisense-analytics/app/routes/chat.py` (full); `geointellisense-analytics/app/routes/grounded_search.py` (full); `geointellisense-analytics/app/routes/grounded_maps.py` (full); `geointellisense-analytics/app/routes/deep_analysis.py` (full); `geointellisense-analytics/app/routes/predictive_analysis.py` (full); `geointellisense-analytics/app/routes/weather_forecast.py` (full); `geointellisense-analytics/app/routes/historical_aqi.py` (full); `geointellisense-analytics/app/routes/historical_weather.py` (full); `geointellisense-analytics/app/routes/nws_forecast.py` (full); `geointellisense-analytics/app/claude.py` (full); `geointellisense-ingestion/src/aqi.rs` (lines 1–52, AqiReading struct and serde). Cross-checked against Active Recommendations and Latest Findings runs #139–#140 plus archived TS↔Python-contract runs #6, #21, #36, #51, #66, #81, #96, #111, #126 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `types.ts:14–30` + `services/aiService.ts:30–50, 52–72` + `grounded_search.py:79` + `grounded_maps.py:86` — `GroundingChunk` type in `types.ts` defines a rich web/maps grounding structure with `.web.uri`, `.web.title`, `.maps.uri`, `.maps.title`, and `.maps.placeAnswerSources` — clearly modelled after the Google Gemini Grounding API's citation metadata. The Python routes `grounded_search.py:79` and `grounded_maps.py:86` always return `{"text": text, "groundingChunks": []}` — hardcoded empty arrays. `aiService.ts:45` reads `data.groundingChunks` and returns it to `AnalysisView.tsx:85`, which stores the chunks in state and renders a Sources section at `AnalysisView.tsx:451–464` only when `groundingChunks.length > 0`. Since Python never returns non-empty chunks, the Sources section is permanently invisible — dead UI backed by dead wire data. The app originally used Google Gemini which natively provided grounding citations; when migrated to Claude, the Python side was changed to return `[]` but the `GroundingChunk` type, the `groundingChunks` state, `aiService.ts` return types, and `AnalysisView.tsx` rendering logic were all left in place. This is schema drift from a backend migration: the TypeScript contract describes a feature that no longer exists at the wire level. PROPOSAL: Either (a) implement Claude web-search tool grounding in `grounded_search.py` and `grounded_maps.py`, extracting source URLs from `tool_use`/`tool_result` pairs and returning them as `groundingChunks`; or (b) remove dead code — delete `types.ts:14–30`, remove `groundingChunks` from `aiService.ts` return types, remove `AnalysisView.tsx:451–464` sources section — M/L effort for (a), L/L for (b).

- OBSERVATION: `chat.py:95–108` — Python defines two session-management endpoints: `POST /api/chat/reset` (line 95) and `POST /api/chat/session` (line 105). Neither has a corresponding TypeScript function in `aiService.ts`. `ChatView.tsx:41` calls `getChatResponse(input)` which calls `POST /api/chat` with `{ message }` (no `session_id` field). `chat.py:19` defines `ChatRequest.session_id: str | None = None`; line 36 executes `session_id = req.session_id or create_session()` — always creates a new session because the client never sends `session_id`. `chat.py:86` returns `{"text": text, "sessionId": session_id}` but `aiService.ts:23` reads only `data.text` and discards the returned `sessionId`. The session system (`claude.py:23–65` — `create_session`, `get_session_history`, `append_to_session`, `reset_session`) maintains per-session `messages` history of up to 50 exchanges, but because the client never receives the `sessionId` or sends it back, every user message starts a fresh one-turn session. The `/api/chat/reset` and `/api/chat/session` endpoints are dead code with no callers. This is a multi-layer contract gap: the fix in Active Recommendation #4 (propagate `sessionId` through `getChatResponse`) is the minimum prerequisite; additionally, `aiService.ts` needs functions for `/api/chat/reset` and `/api/chat/session` to expose the full session lifecycle to the frontend. PROPOSAL: Add `resetChatSession(sessionId: string)` and `createChatSession()` functions to `aiService.ts` calling `/api/chat/reset` and `/api/chat/session` respectively; update `getChatResponse` to accept and return `sessionId`; update `ChatView.tsx` to store `sessionId` in state and pass it on subsequent messages — M/L effort (prerequisite: Active Rec #4).

- OBSERVATION: `services/dataService.ts:67` + `geointellisense-analytics/app/routes/historical_weather.py:98` + `components/Dashboard.tsx:217` — `HistoricalWeatherRecord` at `dataService.ts:66–73` declares `totalPrecipitation: number` as a required field. `historical_weather.py:98` hardcodes `"totalPrecipitation": 0.0` with inline comment "sensor_readings doesn't have precip; placeholder". The fallback path `dataService.ts:382` uses `monthData.precipitation` from `dashboardData` (real non-zero values). `Dashboard.tsx:217` renders `entry[\`${record.locationName}_precip\`] = record.totalPrecipitation` into chart data consumed by `ComposedChart` precipitation bar series (lines 200–329). When the live DB path is active (`/api/historical-weather` returns successfully), every precipitation bar in the Dashboard's historical weather chart shows `0` — not "no data available" but silently a flat zero line. The fallback path shows real values. A user switching between live-DB and fallback modes sees precipitation fluctuate between real data and all-zeros with no indication of which path is active. PROPOSAL: Either (a) add a `precipitation` column to the `sensor_readings` ingestion schema and populate it from PurpleAir or NWS data; or (b) mark `totalPrecipitation` as `number | null` in `HistoricalWeatherRecord` and have `historical_weather.py:98` return `null` instead of `0.0`, then update `Dashboard.tsx:217` to skip null entries so the chart shows a gap rather than a misleading zero — L/L effort for option (b).

- OBSERVATION: `services/WeatherService.ts:98–136` + `geointellisense-analytics/app/routes/nws_forecast.py:56–90` — `WeatherService.getForecast(_lat: number, _lon: number)` uses underscore-prefixed parameters (indicating they are intentionally unused). Line 100 calls `${ANALYTICS_URL}/forecast` with no query parameters. `nws_forecast.py:16–90` returns all monitored locations' NWS forecast periods as a flat array (one entry per NWS period per location). `WeatherService.ts:113–132` groups these by `dateKey = r.date.split('T')[0]` without filtering by location, so highs from Fresno, Bakersfield, Stockton, Modesto, Visalia, and Merced periods are all pushed into the same `highs` and `lows` arrays. `Math.max(...v.highs)` at line 130 returns the single hottest city's temperature as the "high", and `Math.min(...v.lows)` at line 129 returns the coldest city's low — not a point forecast for any specific location. `dataService.ts:246` calls `weatherService.getForecast(loc.latitude, loc.longitude)` for each location in a loop, but all calls return the same blended multi-city result. `ForecastRecord` entries pushed at `dataService.ts:248–263` carry the correct `locationId`/`locationName` but incorrect temperatures. `nws_forecast.py:22–23` supports `lat`/`lon` query parameters for point forecasts, but `WeatherService` never sends them. PROPOSAL: Update `WeatherService.getForecast(lat, lon)` to call `${ANALYTICS_URL}/forecast?lat=${lat}&lon=${lon}` (the ad-hoc point forecast path at `nws_forecast.py:93–131`), which returns a single location's periods; remove the cross-location aggregation logic (lines 113–132) in favour of filtering `isDaytime` periods directly — M/L effort (1-line URL fix + simplified aggregation; `_adhoc_point_forecast` already handles the server-side logic).

**Proposed actions:**
- Remove dead `GroundingChunk` type and grounding UI from `types.ts`, `aiService.ts`, and `AnalysisView.tsx`; or implement Claude tool-based grounding in `grounded_search.py` / `grounded_maps.py` — L/L for removal, M/L for implementation
- Add `createChatSession()` and `resetChatSession(sessionId)` to `aiService.ts`; update `getChatResponse` to accept/return `sessionId`; update `ChatView.tsx` to persist and forward `sessionId` — M/L effort (prerequisite: Active Rec #4)
- Change `historical_weather.py:98` `"totalPrecipitation": 0.0` → `null`; update `HistoricalWeatherRecord.totalPrecipitation: number | null`; skip null in `Dashboard.tsx:217` — L/L effort
- Fix `WeatherService.getForecast` to pass `lat` and `lon` to `/api/forecast?lat=...&lon=...`; remove cross-location aggregation — M/L effort

## 📚 Archive (one line per past run)
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
