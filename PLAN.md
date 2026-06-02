# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-02T05:07:32Z
Last run: #120 — Lens: Live-time claim audit

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
### Run #120 — 2026-06-02 — Lens: Live-time claim audit
**Scope:** Ninth live-time claim audit pass. Examined: `geointellisense-ingestion/src/routes/aqi.rs` (full), `geointellisense-ingestion/src/aqi.rs` (full), `geointellisense-ingestion/src/broadcast.rs` (full), `geointellisense-ingestion/src/config.rs` (full), `geointellisense-ingestion/src/db/persist.rs` (full), `geointellisense-ingestion/src/routes/sse.rs` (full), `hooks/useRealtimeAQI.ts` (full), `hooks/useLiveData.ts` (full), `components/AirQualityMapView.tsx` (full), `components/dashboard/LiveDashboard.tsx` (full), `components/dashboard/widgets/AqiGaugeWidget.tsx` (full), `components/dashboard/widgets/AqiTrendWidget.tsx` (full), `geointellisense-ingestion/src/main.rs` (full). Cross-checked against Active Recommendations and runs #118–#119 (Latest Findings) plus archived live-time audit runs #15, #30, #45, #60, #75, #90, #105 (one-line archive) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/routes/aqi.rs:64-67` — The `/api/aqi-history` HTTP endpoint exclusively calls `aqi::generate_history(&params.station_id, hours)` to produce its response. `aqi::generate_history()` (`aqi.rs:138-162`) generates a purely synthetic random-walk AQI time series: it picks `base_aqi = 85.0` if `station_id.contains("0002")`, else `60.0`, then applies ±5 AQI random steps for each 5-minute slot going back `hours * 12` points. This function has no DB interaction whatsoever. In contrast, `geointellisense-ingestion/src/db/persist.rs:5-35` writes every broadcast tick's readings to the `sensor_readings` PostgreSQL table with actual timestamps, PM2.5/PM10/O3, wind, and `source` provenance. After any non-trivial uptime, the `sensor_readings` table contains real measurements (or real PurpleAir-sourced measurements), but the `/api/aqi-history` endpoint ignores this table entirely and always returns a freshly generated random series. `AqiTrendWidget.tsx:20-23` fetches `/api/aqi-history?station_id=AQ-001&hours=24` on a 2-minute refresh interval and renders the result as "AQI Trend (24h)" with no disclaimer that the data is synthesized. The `station_id=AQ-001` string does not even match any real station UUID (stations use UUID format `a1b2c3d4-0001-4000-8000-00000000000X`), defaulting to the `base_aqi=60.0` branch. PROPOSAL: Replace `aqi::generate_history()` call in `routes/aqi.rs:66` with an actual SQL query against `sensor_readings` (e.g., `SELECT time, aqi, pm25, pm10, o3 FROM sensor_readings WHERE location_id = $1 AND time >= NOW() - INTERVAL '$2 hours' ORDER BY time ASC`) using the station UUID looked up by the station name — M/L effort.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:104-109` — The broadcast ticker runs every `broadcast_interval_secs` (default 5 s, configured via `BROADCAST_INTERVAL_SECS`). When cached PurpleAir data exists (`Some(live)`), the ticker re-stamps every reading with `chrono::Utc::now()` at line 107 (`AqiReading { timestamp: now, ..r.clone() }`), then broadcasts the re-stamped batch. PurpleAir data is only refreshed every `purpleair_interval_secs` (default 600 s, configured via `PURPLEAIR_INTERVAL_SECS`). This means the same underlying sensor measurement is broadcast 120 times with incrementing timestamps before the next real PurpleAir poll. On the frontend, `useRealtimeAQI.ts:338` calls `setLastUpdate(new Date())` on every received SSE event, and `AirQualityMapView.tsx:416` renders `lastUpdate.toLocaleTimeString()` as a live clock — it increments every 5 seconds, implying sensor measurement freshness of ≤5 s. In reality, the sensor values may be up to 10 minutes stale. The PurpleAir API documentation itself specifies that sensors update readings roughly every 2 minutes; re-broadcasting the same values under fresh timestamps degrades users' ability to judge data recency. PROPOSAL: Carry the original PurpleAir poll timestamp through from `PurpleAirClient::fetch_readings` and include it in the broadcast payload; have the frontend display a separate "measured at" time alongside the "last received" time in the `AirQualityMapView.tsx:411-418` block — L/L effort.

- OBSERVATION: `AirQualityMapView.tsx:413` and `geointellisense-ingestion/src/broadcast.rs:111` — The `🔴 Live` indicator is rendered whenever `isConnected === true` in `useRealtimeAQI.ts:272` (set on `eventSource.onopen`). When `PURPLEAIR_API_KEY` is absent or empty (the default configuration for deployments without a PurpleAir subscription), `main.rs:43-44` logs "No PURPLEAIR_API_KEY — using mock AQI data" and passes `pa_client = None` to `broadcast::spawn_ticker`. The ticker then always takes the `None => aqi::generate_readings(&stations)` path at `broadcast.rs:111`, emitting fully synthetic random data with `source: "mock"` (`aqi.rs:131`). The SSE connection opens successfully; `isConnected` becomes `true`; `🔴 Live` is shown. In `useRealtimeAQI.ts:286-343`, the SSE event listener maps each reading to `RealtimeCityData` — this interface (`useRealtimeAQI.ts:15-22`) has no `source` field, so the `source: "mock"` field emitted by the server is silently dropped during JSON mapping. The UI presents fabricated environmental readings under a live indicator with no disclaimer. The error state `'Using simulated data (server unavailable)'` at `useRealtimeAQI.ts:249` is only set for the client-side mock fallback (SSE never connected); server-side mock data through a live SSE connection produces no warning. PROPOSAL: Forward the `source` field in the SSE JSON and add it to `RealtimeCityData`; in `AirQualityMapView.tsx`, change the `🔴 Live` indicator to `🟡 Simulated` when any city's `source === "mock"` — L/L effort.

- OBSERVATION: `AirQualityMapView.tsx:177` — The city detail popup tooltip (rendered on hover/click for each map marker) contains the hardcoded string `"Real-time data from EPA monitoring station. Interpolation model uses IDW and Kriging algorithms."` The claim "EPA monitoring station" is factually incorrect for the data flowing through this component. The `useRealtimeAQI` hook (`AirQualityMapView.tsx:203`) connects to the Rust ingestion service SSE endpoint at `/api/aqi-stream`. That endpoint (`sse.rs:15-73`) broadcasts readings assembled by `broadcast::spawn_ticker`, which sources data exclusively from `PurpleAirClient::fetch_readings` (a private low-cost sensor network, not government regulatory monitoring) or from `aqi::generate_readings()` (fully synthetic). There is no EPA/AirNow data client anywhere in `geointellisense-ingestion/src/`. The analytics service does have an `airnow` client (`geointellisense-analytics/app/clients/`) that queries EPA AQS data for the Python analytics endpoints, but that data never flows into the SSE stream shown on this map. PurpleAir sensors are consumer-grade optical particle counters that correlate with but are not equivalent to EPA FRM/FEM regulatory monitors; conflating the two in user-facing copy misrepresents data quality and provenance. PROPOSAL: Replace `AirQualityMapView.tsx:177` tooltip text with accurate provenance: `"Sensor data from PurpleAir community network (when configured) or simulated. Interpolation model uses IDW and Kriging algorithms."` — L/L effort.

**Proposed actions:**
- Replace `aqi::generate_history()` in `routes/aqi.rs:66` with a SQL query against `sensor_readings` using station UUID lookup — closes gap where real persisted data is ignored by history endpoint — M/L effort
- Carry original PurpleAir poll timestamp through broadcast to frontend; display separate "measured at" vs "last received" times in `AirQualityMapView.tsx:411-418` — prevents 10-min-stale data appearing 5-s fresh — L/L effort
- Add `source` field to `RealtimeCityData` interface; propagate through SSE parse; change `🔴 Live` to `🟡 Simulated` when `source === "mock"` in `AirQualityMapView.tsx` — makes mock-data sessions visually distinct from live sessions — L/L effort
- Fix hardcoded tooltip at `AirQualityMapView.tsx:177` from "EPA monitoring station" to accurate PurpleAir/simulated provenance — L/L effort

### Run #119 — 2026-06-02 — Lens: Competitive scan (web)
**Scope:** Ninth competitive scan pass. Web searches on: AQI+AI tools 2025-2026 feature comparison; IQAir AirVisual 2025-2026 new features; AirPredict eHealth platform; BreezoMeter pollen/wildfire API; Plume Labs Flow commute routing; Airly/Local Haze/Paku differentiators; air quality cumulative exposure tracking 2025; outdoor activity window planning apps. Also examined: `contexts/UserPreferencesContext.tsx` (lines 19-24, 96-101), `hooks/useRealtimeAQI.ts` (lines 140, 288-310), `components/SettingsView.tsx` (lines 553-558, 714, 721), `components/dashboard/widgets/AqiForecastWidget.tsx` (full), `geointellisense-analytics/app/routes/inversion.py` (line 294), all client files (`geointellisense-analytics/app/clients/`), all route files — full codebase search for `pollen`, `allergen`, `exposure`, `trajectory`, `smoke.*plume`, `activity.*window`. Cross-checked against Active Recommendations and runs #117–#118 (Latest Findings) plus archived competitive scan runs #14, #29, #44, #59, #74, #89, #104 (one-line archive) to confirm findings are new.

**Findings:**

- OBSERVATION: No pollen data source exists anywhere in the GeoIntelliSense codebase — a full-text search for `pollen` and `allergen` in all `.ts`, `.tsx`, `.py`, `.toml`, and `.json` files (excluding `node_modules`, `package-lock.json`, and `PLAN.md`) returns zero results. The 18 data-source clients under `geointellisense-analytics/app/clients/` include AirNow, EPA AQS, NASA FIRMS, USGS, NWS, NOAA CDO, PurpleAir (Rust), CalEnviroScreen, CropScape, Landsat, DEM, CalGEM, Caltrans, Census, WQP, and others — but no pollen provider. By contrast, IQAir AirVisual (updated in 2025-2026 with "improved pollen data with better local accuracy") and BreezoMeter (dedicated Pollen API: hourly 72-hour allergen forecasts specifying Oak, Ragweed, Grass, etc., powering Apple Weather) both treat pollen as a first-class air-quality signal alongside PM2.5 and O3. The San Joaquin Valley is one of the highest-pollen regions in the United States: Bakersfield ranks among the worst U.S. cities for spring allergens, and the same agricultural conditions that produce elevated AQI also produce extreme grass and weed pollen. Users who open GeoIntelliSense for respiratory health guidance receive no pollen context despite it being a primary trigger for asthma and allergy episodes in the project's target geography. PROPOSAL: Integrate Google Pollen API (free tier, covers Bakersfield area) or BreezoMeter Pollen API as a new client under `geointellisense-analytics/app/clients/pollen.py`; add a `/api/pollen` route; add a `PollenWidget` alongside `AqiGaugeWidget` in the live dashboard; inject pollen context into the Claude system prompt via `context.py` — M/M effort.

- OBSERVATION: `components/dashboard/widgets/AqiForecastWidget.tsx` (full file) displays a 24-hour ML AQI prediction as a single aggregated value with confidence interval (Low / Predicted / High) via a horizontal bar chart — there is no hourly breakdown. `geointellisense-analytics/app/routes/inversion.py:294` emits the static string `"Sensitive groups should limit outdoor activity."` with no time context. Meanwhile, competing apps (IQAir AirVisual: "plan the healthiest day with health recommendations and 48-hour forecasts"; Airly: "clear recommendations showing whether it's safe to be outside, exercise or open windows"; Plume Labs: "the app will recommend for or against activities depending on the air quality — if good, the app will recommend opening your windows, enjoying exercise outdoors") all present a structured *time-window* view: "Good window 6am–9am ✓, Avoid 11am–4pm ✗". GeoIntelliSense's existing ML model in `geointellisense-analytics/app/ml/aqi_model.py` is trained on historical data with `temperature`, `humidity`, `wind_speed` covariates (derived from `context.py` sub-fetchers) and predicts a 24h aggregate — it cannot currently emit an hourly forecast because the model outputs a single point prediction, not a 48-point hourly time series. The NWS hourly forecast is already ingested via `geointellisense-analytics/app/clients/nws_sounding.py` and exposed at `routes/nws_forecast.py`, providing hourly temperature and wind speed — the inputs needed to disaggregate the 24h AQI prediction by hour of day. PROPOSAL: Extend `aqi_model.py` predict endpoint to accept an NWS hourly covariate series and output per-hour AQI estimates for the next 48h; update `AqiForecastWidget.tsx` to render a sparkline time series and highlight the lowest-AQI 3-hour window with a "Best outdoor window" badge — M/M effort.

- OBSERVATION: `contexts/UserPreferencesContext.tsx:19-24` defines `NotificationSettings` with `enabled: boolean`, `aqiAlertThreshold: number`, `temperatureAlertHigh: number`, `temperatureAlertLow: number`, `soundEnabled: boolean`. `components/SettingsView.tsx:553-558` calls `Notification.requestPermission()` to gate alerts. However, a full-text search for `new Notification(`, `showNotification(`, and `aqiAlertThreshold` across all `.ts` and `.tsx` files returns zero matches beyond the interface definition itself — the threshold is stored in localStorage but never read and never triggers a notification. Additionally, `hooks/useRealtimeAQI.ts:140` sets `DEFAULT_MAX_HISTORY_SIZE = 288` (24 hours at 5-minute intervals) and the `history: HistoricalSnapshot[]` array is fully populated with per-city AQI values throughout the session — but this dataset is exposed only to the `getDataAtTime()` playback function and is never used to compute cumulative daily exposure. IQAir's "Today's Exposure" feature computes exactly this: weighted-average AQI × hours-exposed to give a daily inhaled-dose score. AirPredict (2025, Frontiers in Digital Health) combines wearable PM sensor readings with an "Asthma Diary" module to push health-event notifications to a physician dashboard when thresholds are crossed. GeoIntelliSense has the browser permission granted, the threshold configured, and 24h of AQI history — but nothing connects them. PROPOSAL: (a) Add a `useAqiThresholdNotifier` hook that reads from `useRealtimeAQI`'s `data.stats.averageAQI`, compares against `notifications.aqiAlertThreshold`, and fires `new Notification("AQI Alert", { body: "Current AQI ${aqi} exceeds your threshold of ${threshold}" })` when the threshold is crossed (with a minimum 30-minute re-alert interval to prevent spam); (b) Add an "Exposure Today" derived value to `useRealtimeAQI` that averages the `history` array's AQI values across the session duration — L/L effort.

- OBSERVATION: `components/dashboard/widgets/FiresWidget.tsx` (and the corresponding NASA FIRMS client at `geointellisense-analytics/app/clients/nasa_firms.py`) ingests active fire perimeters and displays them on the map. However, neither the data pipeline nor any frontend component shows where the *smoke* from those fires is traveling — there is no smoke plume polygon overlay, no smoke trajectory, and no wind-aware "will this smoke reach my city?" query. BreezoMeter launched a Wildfire Tracker ("hourly-updated air quality reports tracking moving wildfire smoke with dedicated PM2.5 visualizations") in 2021 and continues to power it via their API (now owned by Google). During the January 2025 Los Angeles wildfires, reporting confirmed that PurpleAir sensors detected localized smoke 30–60 minutes before official monitors. GeoIntelliSense shows the fire marker but a user in Bakersfield with a fire 80 miles away has no way to know whether the smoke plume is heading toward them — they must correlate the fire map and the AQI gauge manually. NOAA's Hazard Mapping System (HMS) provides free GeoTIFF and GeoJSON smoke polygon feeds updated twice daily (satellite-derived smoke extent at Light/Medium/Heavy density tiers). Integrating HMS smoke polygons as a map overlay layer would allow GeoIntelliSense to display where smoke is currently located; adding a `get_smoke_trajectory` tool to the Claude tool set in `claude.py` would allow users to ask natural-language questions like "Will smoke from the current Kern County fire reach Bakersfield by tomorrow given the forecast wind?" PROPOSAL: Add a `HMSClient` at `geointellisense-analytics/app/clients/hms.py` that fetches the HMS GeoJSON smoke polygon feed; expose it via a `/api/smoke/polygons` route; add a toggleable smoke overlay layer on the map component; add `get_smoke_trajectory` to the Claude tool definitions in `claude.py` — M/M effort.

**Proposed actions:**
- Add pollen API client (`clients/pollen.py`), `/api/pollen` route, `PollenWidget`, and pollen injection into `context.py` system prompt — fills a first-class health data gap vs. IQAir, BreezoMeter, Apple Weather — M/M effort
- Extend `aqi_model.py` to emit 48h hourly AQI forecast using NWS covariate series; update `AqiForecastWidget.tsx` to render time-slot sparkline with "Best outdoor window" badge — M/M effort
- Wire `notifications.aqiAlertThreshold` in a `useAqiThresholdNotifier` hook to fire real browser notifications; add session-duration cumulative exposure average to `useRealtimeAQI` — L/L effort
- Add NOAA HMS smoke-polygon client, `/api/smoke/polygons` route, map overlay layer, and `get_smoke_trajectory` Claude tool — closes fire-to-AQI impact gap vs. BreezoMeter Wildfire Tracker — M/M effort

### Run #118 — 2026-06-02 — Lens: LLM integration quality
**Scope:** Ninth LLM integration quality pass. Examined: `geointellisense-analytics/app/claude.py` (full), `geointellisense-analytics/app/routes/chat.py` (full), `geointellisense-analytics/app/routes/deep_analysis.py` (full), `geointellisense-analytics/app/routes/predictive_analysis.py` (full), `geointellisense-analytics/app/routes/weather_forecast.py` (full), `geointellisense-analytics/app/routes/grounded_search.py` (full), `geointellisense-analytics/app/routes/grounded_maps.py` (full), `geointellisense-analytics/app/routes/low_latency.py` (full), `geointellisense-analytics/app/context.py` (full), `geointellisense-analytics/app/routes/ai_context.py` (full), `services/aiService.ts` (full). Cross-checked against Active Recommendations and runs #116–#117 (Latest Findings) plus archived LLM integration runs #13, #28, #43, #58, #73, #88, #103 (one-line archive) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/claude.py:74-75` and all seven LLM-using routes (`chat.py:43,70`, `deep_analysis.py:33,61`, `predictive_analysis.py:91`, `weather_forecast.py:75`, `grounded_search.py:39,62`, `grounded_maps.py:46,69`, `low_latency.py:31`) — `get_client()` returns `anthropic.Anthropic(...)`, the **synchronous** Anthropic SDK client. All seven routes are `async def` FastAPI handlers running inside uvicorn's asyncio event loop. When `client.messages.create(...)` is called inside these handlers, it issues an HTTP request to the Anthropic API (typically taking 2–15 seconds) using Python's `httpx` in its **synchronous** mode — which calls `asyncio.get_event_loop().run_until_complete()` internally, blocking the entire uvicorn event loop for the duration. During that window, uvicorn cannot process any other incoming HTTP request, SSE event, or background task. On any moderately loaded deployment (multiple users or a slow Anthropic API response), requests to data endpoints (`/api/aqi-snapshot`, `/api/fires/active`, etc.) pile up behind one chat request. The Anthropic Python SDK's `anthropic.AsyncAnthropic` client provides an identical API surface with `async def messages.create(...)` that integrates correctly with asyncio. PROPOSAL: Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:74-75`; add `await` before all `.messages.create(...)` calls across the seven files; update `execute_tool` accordingly — M/M effort.

- OBSERVATION: `geointellisense-analytics/app/context.py:52-70` vs `context.py:73-91` — `build_live_context()` initialises `context["sources"] = {}` at line 56 and never populates it; each sub-fetcher (e.g., `_get_aqi_context`) returns a dict containing a `"freshness"` key, but `build_live_context()` stores the sub-fetcher result directly (`context["aqi"] = await _get_aqi_context(pool)`) without promoting freshness data into `context["sources"]`. The promotion logic exists only in `ai_context.py:23-28`, used solely by the `GET /api/ai/context` debug endpoint. Consequently, `build_context_text()` at lines 81–91 iterates `sources = ctx.get("sources", {})` which is always an empty dict — so the "LIVE data sources", "STALE data sources", and "UNAVAILABLE data sources" lines are **always absent** from the system prompt injected into every Claude call via `get_system_with_live_context()`. Claude receives no freshness metadata and cannot caveat its analysis when a data source is stale or unavailable, despite the code explicitly intending to warn it ("⚠ IMPORTANT: Stale data sources may not reflect current conditions" at `context.py:185–187`, which is also unreachable for the same reason). PROPOSAL: Extract the freshness-promotion loop from `ai_context.py:23-28` into a helper function inside `context.py` and call it at the end of `build_live_context()` before returning, so both the API endpoint and `build_context_text()` share the same populated `sources` dict — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/deep_analysis.py:51,61-76` — The tool-use continuation loop resets the message history to `[original_prompt, current_round_assistant, current_round_tool_results]` on every round (lines 70–75). If Claude triggers two consecutive rounds of tool use (e.g., round 1 calls `get_air_quality`, round 2 calls `get_earthquakes`), the second API call to Anthropic receives only: user=`[original_prompt]`, assistant=`[thinking_block + tool_use_block for round 2]`, user=`[round_2_tool_results]`. The round-1 tool call and its result are absent from the conversation. This creates a structurally invalid conversation: the Anthropic API spec requires that every `tool_use` content block in an assistant turn must be followed by a matching `tool_result` in the next user turn — if round-1's `tool_use` block was in an intermediate assistant message that is now dropped, Claude's reasoning may be incoherent and the API may return a validation error. In contrast, `chat.py:66-68` builds messages correctly by appending to the full session history. The `max_tokens=40000` with `budget_tokens=32768` for deep analysis makes multi-round tool use more likely (the large token budget gives Claude room to think and decide to call multiple tools). PROPOSAL: In `deep_analysis.py`, accumulate all conversation turns in a local list (analogous to `chat.py:66-68`) rather than rebuilding from the original prompt on each round; carry forward prior `[assistant_content, tool_results]` pairs — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/context.py:61-68` — `build_live_context()` awaits each of its eight sub-fetchers sequentially: `_get_aqi_context`, `_get_forecast_context`, `_get_fire_context`, `_get_earthquake_context`, `_get_water_context`, `_get_enviroscreen_context`, `_get_inversion_context`, `_get_prediction_context`. Each sub-fetcher issues one or more `asyncpg` queries; asyncpg is async-native and does not block the event loop per se, but each `await` suspends `build_live_context` until the entire sub-fetcher completes before starting the next. Given typical PostgreSQL query round-trip times of 5–30 ms each, the eight sequential fetchers add 40–240 ms of latency before `get_system_with_live_context()` can return and the Claude API call can begin. The 60-second context cache (`claude.py:88`) amortises this cost across requests, but on cache miss (once per minute) every chat/analysis request waits for the full sequential chain. Since the sub-fetchers query independent tables with no interdependencies, all eight could run concurrently via `asyncio.gather()`. This is especially impactful when PostgreSQL is under load (slow queries bubble up to the first position) or when the ingestion service is writing data (table locks). PROPOSAL: Replace the sequential `await` calls at `context.py:61-68` with a single `asyncio.gather(...)` call collecting all eight sub-fetcher coroutines simultaneously — L/L effort.

**Proposed actions:**
- Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:74-75` and `await` all `.messages.create(...)` calls across 7 route files to prevent event-loop blocking — M/M effort
- Extract freshness-promotion from `ai_context.py:23-28` into `context.py`; call it inside `build_live_context()` so `build_context_text()` populates the LIVE/STALE/UNAVAILABLE lines in every Claude system prompt — L/L effort
- Fix `deep_analysis.py:70-75` multi-round message construction to accumulate all prior `[assistant, tool_results]` pairs rather than rebuilding from the original prompt — L/L effort
- Replace sequential awaits at `context.py:61-68` with `asyncio.gather()` to cut context-build latency by ~7× on cache miss — L/L effort

## 📚 Archive (one line per past run)
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
