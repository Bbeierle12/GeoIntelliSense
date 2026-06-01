# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T15:10:00Z
Last run: #106 — Lens: Type safety

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
### Run #106 — 2026-06-01 — Lens: Type safety
**Scope:** Eighth type safety pass. Examined: `hooks/useDashboardData.ts` (entire file, all `useMemo` aggregation blocks), `data/dashboardData.ts` (structure of `generateDailyForecast` return value, lines 195–336), `components/charts/AQITrendChart.tsx`, `components/charts/PM25TrendChart.tsx`, `components/charts/TemperaturePrecipitationChart.tsx`, `components/charts/WeatherForecastChart.tsx` (prop interfaces), `components/3d/AQI3DScene.tsx` (CameraController, lines 51–95), `components/AccessibleChart.tsx` (DataTableColumn and AccessibleChartProps, lines 63–86), `services/AirQualityService.ts`, `services/WeatherService.ts`, `hooks/useRealtimeAQI.ts`, `components/Dashboard.tsx`. Cross-checked against Active Recommendations and runs #103–#105 (Latest Findings) plus archived type safety runs #91, #76, #61, #46, #31, #16, #1 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useDashboardData.ts:179,197,199,223,241,243,267,285,287,311,330,332` — `generateDailyForecast()` at `data/dashboardData.ts:195` returns a rich inferred type: each element has nested objects `temp: { current, min, max, feelsLike }`, `wind: { speed, gust, direction }`, `precipitation: { probability, amount, type }`, top-level scalars `humidity`, `uv`, `evapotranspiration`, `solarRadiation`, `aqi`, `pm25`, etc. Because there is no exported named interface for this type, the four `useMemo` aggregation callbacks in `useDashboardData.ts` that compute humidity trends (lines 179–205), wind speed trends (223–251), UV index trends (267–294), and agricultural metrics (311–341) all annotate the forEach loop variable as `day: any`. The aggregated result arrays are typed `result: any[]` and each row as `entry: any`. In total, 12 `any` annotations could be eliminated by adding `export interface DailyForecastEntry { date: string; temp: { current: number; min: number; max: number; feelsLike: number }; humidity: number; wind: { speed: number; gust: number; direction: string }; uv: number; evapotranspiration: number; solarRadiation: number; aqi: number; pm25: number; ... }` to `dashboardData.ts` and changing `generateDailyForecast`'s return type annotation to `DailyForecastEntry[]`. TypeScript would then infer the correct type for `day` in each forEach without explicit annotation. PROPOSAL: Add `DailyForecastEntry` interface to `dashboardData.ts`; replace all 12 `any` annotations in `useDashboardData.ts` with properly-typed alternatives — L/L effort.

- OBSERVATION: `components/charts/AQITrendChart.tsx:15`, `components/charts/PM25TrendChart.tsx:15`, `components/charts/TemperaturePrecipitationChart.tsx:15`, `components/charts/WeatherForecastChart.tsx:14` — All four chart components declare `data: any[]` in their prop interfaces. The actual runtime shape for the three monthly-trend charts is `{ month: string; [locationKey: string]: string | number }[]` (aggregated from `useDashboardData.ts`), and for `WeatherForecastChart` it is `{ day: string; [loc_temp]: number; [loc_humidity]: number }[]` (aggregated from `Dashboard.tsx:117–133`). With `data: any[]`, TypeScript cannot validate at call sites that callers pass the correct key structure, nor can Recharts' own generics be leveraged to verify `dataKey` prop values like `{loc}` or `{loc}_temp` refer to real properties. A runtime mismatch (e.g., aggregation producing `{ month: ... }` while `WeatherForecastChart` expects `{ day: ... }`) would silently render an empty chart rather than a compile-time error. PROPOSAL: Define `type MonthlyChartEntry = { month: string } & Record<string, number | string>` and `type DailyChartEntry = { day: string } & Record<string, number | string>` in `components/charts/index.ts`; use them as the `data` prop type in all four chart components — L/L effort.

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `CameraController` declares `const controlsRef = useRef<any>(null)` and then accesses `controlsRef.current.getTarget(target)` at line 71. The `OrbitControls` component imported from `@react-three/drei` wraps the `OrbitControls` class from `three-stdlib`, which the drei package re-exports with full TypeScript definitions. Typing the ref as `any` means TypeScript cannot verify that `.getTarget()` is a valid method on the controls instance; if the drei API changes or the ref is attached to a different component, the error only surfaces at runtime. The `@react-three/drei` package exports `OrbitControls` as a forwardRef component; its instance type is `typeof OrbitControls` from `three-stdlib`, which has a `getTarget(target: THREE.Vector3): THREE.Vector3` method signature. PROPOSAL: Import `OrbitControls as OrbitControlsImpl` from `three-stdlib` and type the ref as `useRef<OrbitControlsImpl | null>(null)` in `AQI3DScene.tsx:57`; no logic changes required — L/L effort.

- OBSERVATION: `components/AccessibleChart.tsx:66,79` — `DataTableColumn.format` is declared as `format?: (value: any) => string` (line 66) and `AccessibleChartProps.data` is `Record<string, any>[]` (line 79). At the table renderer, `col.format!(row[col.key])` is called with `row[col.key]` typed as `any`. TypeScript cannot warn if a column's `format` function receives a number when it expects a Date, or if `key` refers to a non-existent property. The `data` prop as `Record<string, any>[]` similarly allows callers to pass entirely wrong shapes without error. A single generic parameter would resolve both without breaking call sites: `interface DataTableColumn<T = unknown> { key: string; header: string; format?: (value: T) => string; }` and `data: Array<Record<string, unknown>>`. Callers that need to type-narrow can specify `T`; others get `unknown` instead of `any`, which is narrower while still permissive. PROPOSAL: Add generic `T = unknown` to `DataTableColumn`, update `format` callback parameter, and change `data` from `Record<string, any>[]` to `Array<Record<string, unknown>>` in `AccessibleChart.tsx` — L/L effort.

**Proposed actions:**
- Add `export interface DailyForecastEntry { ... }` to `data/dashboardData.ts`; annotate `generateDailyForecast` return as `DailyForecastEntry[]`; remove all 12 `any` annotations from `hooks/useDashboardData.ts:179–332` — L/L, score 1.0
- Add `MonthlyChartEntry` and `DailyChartEntry` types to `components/charts/index.ts`; replace `data: any[]` in all four chart component prop interfaces — L/L, score 1.0
- Import `OrbitControls as OrbitControlsImpl` from `three-stdlib`; retype `controlsRef` at `AQI3DScene.tsx:57` to `useRef<OrbitControlsImpl | null>(null)` — L/L, score 1.0
- Add generic `T = unknown` to `DataTableColumn` in `AccessibleChart.tsx:66`; change `data` prop to `Array<Record<string, unknown>>` — L/L, score 1.0

### Run #105 — 2026-06-01 — Lens: Live-time claim audit
**Scope:** Seventh live-time claim audit pass. Examined: `data/dashboardData.ts` (entire file), `components/CalendarView.tsx` (initial state, data consumption), `services/dataService.ts` (fallback paths), `geointellisense-ingestion/src/broadcast.rs` (ticker logic), `geointellisense-ingestion/src/config.rs` (interval defaults), `geointellisense-analytics/app/context.py` (SOURCE_INTERVALS), `hooks/useRealtimeAQI.ts` (SSE consumer), `hooks/useLiveData.ts` (polling hooks), `components/Dashboard.tsx` (chart rendering). Cross-checked against Active Recommendations and runs #103–#104 (Latest Findings) plus archived live-time runs #90, #75, #60, #45, #30, #15 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `CalendarView.tsx:21` and `data/dashboardData.ts:198` — The calendar's `currentDate` React state is initialized to `new Date('2025-11-13')`, a hardcoded past date; the calendar opens to November 2025 regardless of the actual current date. This is directly coupled to `generateDailyForecast()` at `dashboardData.ts:195`, which computes all 365-day forecast arrays from `const baseDate = new Date('2025-11-13')`. Because `dashboardData` is a top-level module constant, the entire `dailyForecast` array for every city (`Bakersfield`, `Fresno`, `Visalia`, `Merced`, `Modesto`, `Stockton`) is computed once at module initialization time, anchored to November 13, 2025. As of June 1, 2026 (today), the first ~200 days of each location's `dailyForecast` array (November 2025 through ~May 2026) describe dates that are already in the past, yet they are rendered as "forecast" data. A user opening `CalendarView.tsx` sees a calendar defaulting to November 2025 and can navigate forward into data that is labeled as prospective forecast but is in fact static historical-looking values. There is no `Date.now()` anywhere in `generateDailyForecast()` — every page load produces the same arrays. PROPOSAL: Replace `const baseDate = new Date('2025-11-13')` at `dashboardData.ts:198` with `const baseDate = new Date()` so the forecast window is always anchored to today; replace `useState(new Date('2025-11-13'))` at `CalendarView.tsx:21` with `useState(new Date())` — both are L/L changes.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:97-129` — The `spawn_ticker` broadcast loop fires every `broadcast_interval_secs` (default 5 seconds, `config.rs:29`). On each tick it clones the cached PurpleAir readings and overwrites `timestamp` with `chrono::Utc::now()` (`broadcast.rs:106-109`): `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()`. The cache itself is only updated by the PurpleAir poller, which runs every `purpleair_interval_secs` (default 600 seconds — 10 minutes, `config.rs:27`). The result is that SSE clients receive broadcasts every 5 seconds bearing a fresh wall-clock timestamp, but the AQI, PM2.5, O3, NO2, temperature, humidity, and wind values inside each broadcast are identical to those from the last PurpleAir API fetch up to 10 minutes ago. `useRealtimeAQI` at `hooks/useRealtimeAQI.ts:338-339` updates `lastUpdate` to `new Date()` on every `aqi-update` event, so the UI displays a "last updated X seconds ago" indicator that increments every 5 seconds even when the sensor data is 9 minutes 55 seconds stale. There is no field in `AqiReading` that distinguishes the sensor-read time from the broadcast-tick time; downstream consumers have no mechanism to determine actual data age. PROPOSAL: Add a `sensor_read_time: DateTime<Utc>` field to `AqiReading` at `aqi.rs`; populate it from the PurpleAir fetch timestamp rather than `Utc::now()` in the broadcast ticker; surface it in the SSE payload and in `useRealtimeAQI`'s return type so the UI can display true sensor age — M/L effort.

- OBSERVATION: `geointellisense-analytics/app/context.py:19-20` vs `geointellisense-ingestion/src/config.rs:27` — `SOURCE_INTERVALS["purpleair"] = 120` in `context.py` defines 120 seconds (2 minutes) as the expected PurpleAir update interval, so the freshness check at `context.py:47` flags data as stale when `age_seconds > 120 * 2 = 240` seconds (4 minutes). However, the ingestion service's `purpleair_interval_secs` defaults to 600 seconds (10 minutes), with an inline comment: "PurpleAir free tier is 1000 pts/day." At the 10-minute default rate, PurpleAir data becomes older than 4 minutes within 4 minutes of each fetch, and stays above the stale threshold for `(600 − 240) / 600 = 60%` of every polling cycle. The analytics context builder will emit "STALE data sources (may be outdated): purpleair" to Claude's system prompt for the majority of requests even when the ingestion service is functioning normally at its design rate. Every AI chat, grounded search, and low-latency response during that 60% window includes a stale-data caveat that instructs Claude to hedge its answers, degrading response quality for a system the description calls "live-time." PROPOSAL: Change `SOURCE_INTERVALS["purpleair"]` at `context.py:20` from `120` to `600` to match the actual default ingestion interval, or introduce a shared `PURPLEAIR_INTERVAL_SECS` environment variable read by both `config.rs` and `context.py` — L/L effort.

- OBSERVATION: `services/dataService.ts:382-387` — `getHistoricalWeatherFallback()` is the fallback path invoked when `GET /api/historical-weather` fails (e.g., analytics service unreachable). It derives `avgHumidity`, `avgWindSpeed`, `maxUV`, `avgSolarRad`, and `avgEt0` from temperature using formulas that include `Math.random()` calls: `avgHumidity: Math.round(Math.max(20, 80 - (monthData.avgTemp - 50) * 0.8 + (Math.random() * 10)))`, `avgWindSpeed: Math.round(5 + Math.random() * 5)`, `maxUV: Math.round(...)`, `avgSolarRad: Math.round(...)`, `avgEt0: Math.round(...)`. Each browser page load or service re-initialization produces a completely different set of historical humidity, wind, UV, solar radiation, and evapotranspiration values. The Dashboard's "Humidity Trends," "Wind Speed Patterns," "UV Index Trends," and "Agricultural Metrics" charts (`Dashboard.tsx:651-729`) render these randomized values without any "estimated" or "simulated" badge. A user comparing charts between two page loads sees entirely different historical wind and humidity patterns even though the data is represented as objective historical record. In a tool whose "live-time" branding implies trustworthy sensor data, serving random numbers silently in historical charts is a direct claim violation. PROPOSAL: Replace `Math.random()` in `getHistoricalWeatherFallback()` at `dataService.ts:382-387` with deterministic seasonal averages from published NOAA normals for San Joaquin Valley, and display a visible "Data estimated — live service unavailable" banner on affected charts when the fallback path fires — M/L effort.

**Proposed actions:**
- Fix `dashboardData.ts:198` base date to `new Date()` and `CalendarView.tsx:21` initial state to `new Date()` — L/L effort
- Add `sensor_read_time` field to `AqiReading` in `aqi.rs`; propagate through broadcast ticker and SSE payload; expose in `useRealtimeAQI` return type — M/L effort
- Change `SOURCE_INTERVALS["purpleair"]` at `context.py:20` from `120` to `600`; or share via env var with `config.rs` — L/L effort
- Replace `Math.random()` in `getHistoricalWeatherFallback()` with deterministic seasonal values; add "estimated" badge to fallback charts — M/L effort

### Run #104 — 2026-06-01 — Lens: Competitive scan (web)
**Scope:** Eighth competitive scan pass. Web searches for: AQI+AI tool feature gaps (2025–2026), VayuBuddy/VayuChat LLM analytics chatbots, AirPredict eHealth platform, pollution-aware routing research, push notification implementations in comparable apps. Cross-referenced against current GeoIntelliSense source files: `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/low_latency.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/claude.py`, `components/MapView.tsx`. Cross-checked against Active Recommendations and runs #102–#103 (Latest Findings) plus archived competitive runs #14, #29, #44, #59, #74, #89 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: VayuBuddy (arXiv:2411.12760, Nov 2024) and VayuChat (arXiv:2511.01046, Nov 2024, ACM IKDD 2025) are two peer-reviewed LLM-over-air-quality-data systems that convert natural-language questions (e.g., "Which cities had the worst PM2.5 in winter 2025?") directly into executable Python code, run it in a sandboxed environment, and return the result as a sortable table, plot, or structured answer alongside the generated code. GeoIntelliSense's AI chat at `chat.py:43–86` and grounded search at `grounded_search.py:39–88` use Claude's text responses exclusively: the `execute_tool` function at `claude.py:217` dispatches model tool calls to pre-defined FastAPI endpoints but never generates or executes user-visible Python code, and the frontend renders all AI output as markdown prose. There is no mechanism for a user to ask an analytic question and receive a downloadable chart, a ranked table, or a reproducible snippet — all responses are narrative. The gap is most visible for questions like "Compare PM2.5 across Fresno, Bakersfield, and Modesto over the last 30 days" — VayuChat would return an interactive bar chart with the code; GeoIntelliSense's `/api/chat` would return a paragraph that may or may not accurately reflect the DB values. PROPOSAL: Add a `/api/chat/execute` endpoint that accepts a natural-language query, has Claude generate a pandas/polars Python snippet against the TimescaleDB schema, executes it in a restricted subprocess (no filesystem or network access), and returns structured JSON plus a base64-encoded PNG chart — M/M, score 1.0; does not displace top 10.

- OBSERVATION: Multiple 2025–2026 academic and commercial tools now offer pollution-aware route optimization: a 2026 Frontiers paper ("Smart Route", DOI: 10.3389/frsc.2026.1759665) demonstrates a system that reduces AQI exposure by ~26% during commutes by weighting street segments by near-real-time pollution levels; Plume Labs Flow provides hyperlocal street-level PM2.5 to its routing layer; Google BreezoMeter's heatmap API is used by third-party navigators for cleaner-path routing. GeoIntelliSense has substantial data prerequisites already in place — real-time AQI by sensor at `geointellisense-ingestion/src/routes/aqi.rs`, a live `MapView.tsx` with an AQI overlay (`LayerState.aqi` at `MapView.tsx:22`), and a `traffic.py` route serving Caltrans corridor data — but there is no route optimization endpoint, no Google Directions API integration, and no UI workflow for entering origin/destination and requesting a lower-exposure path. The `MapView.tsx` renders static AQI markers and fire/earthquake/water overlays; it has no route-drawing or waypoint input. PROPOSAL: Implement a `/api/routes/clean` endpoint that accepts origin/destination lat-lng pairs, fetches candidate routes from Google Directions API with `alternatives=true`, scores each route by integrating interpolated AQI values along the polyline from the live sensor DB, and returns the lowest-exposure option with a per-segment AQI breakdown; add a route-planner panel to `MapView.tsx` — M/H, score 0.67; does not displace top 10.

- OBSERVATION: AirPredict (Frontiers in Digital Health, 2025, PMC12179981) and the AQHI (Air Quality Health Index, Health Canada) both tailor air quality risk presentation to individual health profiles — asthma, COPD, cardiovascular disease, elderly, children, pregnancy — and AirPredict additionally combines wearable spirometry and heart rate data with PM2.5 exposure to compute a per-person *inhaled PM dose* rather than a location-ambient index. GeoIntelliSense provides no personal health profile: `CHAT_SYSTEM` at `claude.py:10–13` and `SJV_SYSTEM` at `claude.py:15–21` are static, user-agnostic system prompts; `PredictiveAnalysisRequest` at `predictive_analysis.py:30–37` accepts only `locationName`, `historicalAqi`, `historicalWeather`, `customFactors`, `startDate`, `endDate`; and `predict.py` produces a population-level 24-hour AQI forecast with no health-condition weighting. There is no user registration, no profile storage schema, and no frontend settings UI for health conditions. All health-related language in AI responses defaults to generic guidance ("people with respiratory conditions should…") rather than personalised advice. PROPOSAL: Add an optional `health_profile: {conditions: list[str], age_group: str, activity_level: str}` field to `ChatRequest` and `PredictiveAnalysisRequest`; inject the profile into the per-request system prompt so Claude tailors recommendations; add a `SettingsView.tsx` health-profile section with checkboxes for common conditions — M/M, score 1.0; does not displace top 10.

- OBSERVATION: All major comparable AQI apps — IQAir AirVisual, Fresh Air (fresh-air-app.com), AQI.in, the new AQI app Apple Watch release (Instagram/Google Play, May 2026) — provide configurable threshold-based push notifications that fire when AQI crosses a user-set level, including lock-screen alerts on iOS/Android and watch-face complications on Apple Watch and Wear OS. GeoIntelliSense delivers real-time AQI data exclusively via a Server-Sent Events stream at `geointellisense-ingestion/src/routes/sse.rs`, which the frontend consumes through `hooks/useRealtimeAQI.ts`; there is no outbound notification path. A full-text search of the repository (`grep -rn "firebase\|FCM\|push_notif\|web-push\|APNs\|vapid\|notify"`) returns zero matches. When a user closes the browser tab, stops the SSE subscription, or is on a mobile device, they receive no alert even if the AQI spikes to Hazardous (>300). This is a direct feature gap versus every app in the same category. PROPOSAL: Add a Web Push subscription endpoint (`POST /api/notifications/subscribe`) that stores a VAPID-based PushSubscription in the DB; in the ingestion SSE ticker (`broadcast.rs:spawn_ticker`), when AQI crosses configurable thresholds, invoke the web-push library to send a notification payload; add a subscription UI in `SettingsView.tsx` — H/M, score 1.5; does not displace top 10.

**Proposed actions:**
- Add `/api/chat/execute` endpoint: Claude generates pandas/polars code from NL query, execute in subprocess sandbox, return structured JSON + chart — M/M, score 1.0
- Add `/api/routes/clean` endpoint using Google Directions alternatives + live AQI segment scoring; add route-planner panel to `MapView.tsx` — M/H, score 0.67
- Add optional `health_profile` field to `ChatRequest`/`PredictiveAnalysisRequest` in Python layer; inject into system prompt; add health profile UI in `SettingsView.tsx` — M/M, score 1.0
- Implement Web Push (VAPID) notification system: subscribe endpoint, threshold logic in ingestion ticker at `broadcast.rs`, subscription UI in `SettingsView.tsx` — H/M, score 1.5

## 📚 Archive (one line per past run)
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
