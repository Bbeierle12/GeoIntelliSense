# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T03:06:28Z
Last run: #47 — Lens: Module boundaries

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
### Run #47 — 2026-05-30 — Lens: Module boundaries
**Scope:** Fourth module-boundaries pass. Examined: `hooks/useRealtimeAQI.ts`, `components/3d/CityMarkers.tsx`, `components/3d/index.ts`, `services/dataService.ts`, `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/routes/fires.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/routes/inversion.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/main.py`. Cross-referenced archive summaries for runs #2, #17, #32 (all Module boundaries) — archived as one-line summaries only, specific finding text unavailable; findings below verified against visible prior runs.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` — imports `type { CityData }` directly from `../components/3d/CityMarkers`. In the standard React layer order, hooks sit below components (hooks provide behavior; components consume hooks). This import inverts that relationship: `hooks/useRealtimeAQI.ts` depends on a rendering component file, making the hook unusable in any context that does not also carry the 3D component tree. Specifically, `AirQualityMapView.tsx:16` → `useRealtimeAQI.ts:8` → `CityMarkers.tsx` — a component imports a hook which imports a sibling component. The `CityData` interface (`CityMarkers.tsx:20-32`) is a pure data shape (lat, lng, name, aqi, etc.) with no rendering or React-lifecycle content; it has no business being defined inside a `.tsx` component file. The barrel re-export at `components/3d/index.ts:16` does not mitigate the architectural violation — it just provides a second import path to the same component. PROPOSAL: Move the `CityData` interface (and `WindData` at `WindField.tsx`) to `types.ts`; update imports in `CityMarkers.tsx`, `useRealtimeAQI.ts`, and `AirQualityMapView.tsx` accordingly.

- OBSERVATION: `geointellisense-analytics/app/claude.py:103,116` — `get_system_with_live_context()` contains two fallback import statements that reach into a route module: `from app.routes.fires import get_current_smoke_context`. The dependency hierarchy should be routes → service-layer → domain, but here `claude.py` (a service-layer module used by multiple route modules) imports from `routes/fires.py`, creating an upward dependency. The import chain is: `routes/chat.py` → `claude.py` → `routes/fires.py`. If `routes/fires.py` ever needed to import anything from `claude.py` (e.g., to use `get_client()` for a fire-analysis feature), Python would fail at import time with a circular import error. The two fallback paths at lines 103 and 116 use `try/except ImportError` guards, which masks the circular-import risk rather than eliminating it — the guard only catches cases where the module has not yet been imported, not already-partially-initialized cases. PROPOSAL: Extract `get_current_smoke_context()` from `routes/fires.py` into `context.py` or a dedicated `context_sources.py` helper; have `claude.py:103` import it from there; `routes/fires.py` can call the same function from that shared location.

- OBSERVATION: `geointellisense-analytics/app/claude.py:217-272` — `execute_tool()` implements each of the 5 Claude tools by making `httpx.AsyncClient` HTTP calls back to `http://localhost:{settings.port}/api/...` — the same process it is running inside. The analytics service calls itself over the network to fulfill tool requests. This introduces four concrete problems: (a) every tool call adds one intra-process TCP round-trip latency; (b) the fallback at line 232 hard-codes `http://localhost:3001/api/aqi-snapshot` (the Rust ingestion port), meaning any port change in `docker-compose.yml` silently breaks Claude's air-quality tool; (c) if auth middleware (`check_ai_auth` in `middleware.py`) is applied to the tool-invoked endpoints, these internal calls will fail because they carry no API key; (d) if `execute_tool` is called before the server fully binds (e.g., during lifespan setup), all tool calls return `{"error": "Tool execution failed: ..."}` silently. PROPOSAL: Replace HTTP self-calls in `execute_tool` with direct calls to the underlying Python service functions (e.g., call `fetch_current_aqi()` from the client layer, or call the database query directly via `get_pool()`); remove the hard-coded port fallback at line 232.

- OBSERVATION: `geointellisense-analytics/app/routes/water.py:23`, `routes/fires.py:30`, `routes/inversion.py:25`, `routes/predict.py:27` — each of these route modules declares and exports a background polling/scheduling function (`start_water_polling`, `start_fire_polling`, `start_inversion_polling`, `start_retrain_scheduler`), which `main.py:32-40,51-54` imports alongside the HTTP router objects. Route modules have a single defined responsibility: expose HTTP endpoints. Background task lifecycle (creating `asyncio.Task` objects, managing `_poll_task: asyncio.Task | None` module-level state, running infinite `while True` loops) is infrastructure-layer behavior that leaks through the route module's public interface. This means a developer reading `water.py` must understand both HTTP request handling and polling task management. It also makes it impossible to import the `water_router` without implicitly accepting the polling task as part of the module's public API. PROPOSAL: Create `geointellisense-analytics/app/tasks/` package with `water_poll.py`, `fires_poll.py`, `inversion_poll.py`, `retrain_scheduler.py`; move each `start_*` function and its `_poll_loop`/`_poll_task` state into the corresponding tasks module; `main.py` imports from `app.tasks.*`; route modules no longer export non-HTTP functions.

- OBSERVATION: `services/dataService.ts:4` and `services/dataService.ts:274` — `dashboardData` and `cityLocations` are imported from `../data/dashboardData` twice in the same file: once as a static top-level import at line 4 (`import { dashboardData, cityLocations } from '../data/dashboardData'; // Keep for fallback`) and once as a dynamic `await import('../data/dashboardData')` at line 274 inside `getLocations()`. The `// Keep for fallback` comment confirms the static import was intentionally left when a dynamic-import refactor was applied to `getLocations()` but not completed consistently. The dynamic import at line 274 re-resolves and re-executes module loading overhead for a module that is already in the ES module cache (Vite/esbuild). The two import paths reference the same singleton module object, so there is no functional divergence — but the dual import creates reader confusion about which binding is authoritative. The `dashboardData` identifier at lines 128, 171, 325, 366 uses the static binding; line 274's dynamic re-import shadows it with an identical value. PROPOSAL: Delete the `await import('../data/dashboardData')` at line 274 and replace `dashboardData` / `cityLocations` in the `getLocations()` body with the already-imported top-level bindings; remove the `// Keep for fallback` comment since the static import should simply be the sole import.

**Proposed actions:**
- Move `CityData` interface from `components/3d/CityMarkers.tsx` to `types.ts`; remove `useRealtimeAQI.ts:8` component import — M/L, score 2.0; does not enter top 10
- Extract `get_current_smoke_context` from `routes/fires.py` to `context.py`; remove `claude.py:103,116` route import — M/L, score 2.0; does not enter top 10
- Replace HTTP self-calls in `claude.py:execute_tool` with direct Python function calls; remove hard-coded port at line 232 — H/M, score 1.5; does not enter top 10
- Create `app/tasks/` package; move all `start_*` polling functions out of route modules — M/M, score 1.0; does not enter top 10
- Remove dynamic re-import in `dataService.ts:274`; use existing top-level bindings — L/L, score 1.0; does not enter top 10

### Run #46 — 2026-05-30 — Lens: Type safety
**Scope:** Fourth type-safety pass. Examined: `data/dashboardData.ts`, `hooks/useDashboardData.ts`, `services/aiService.ts`, `services/WeatherService.ts`, `services/AirQualityService.ts`, `services/dataService.ts`, `contexts/UserPreferencesContext.tsx`, `hooks/useRealtimeAQI.ts`, `hooks/useLiveData.ts`, `components/charts/AQITrendChart.tsx`, `components/charts/PM25TrendChart.tsx`, `components/charts/WeatherForecastChart.tsx`, `components/charts/TemperaturePrecipitationChart.tsx`, `components/AccessibleChart.tsx`, `types.ts`. Cross-referenced archived findings from runs #1, #16, #31 (summary lines only — no detail available to cross-check at the individual-finding level) and noted that zero type-safety findings have ever been promoted to Active Recommendations, implying all prior type-safety findings were M/L or below.

**Findings:**

- OBSERVATION: `data/dashboardData.ts:195-196` — `function generateDailyForecast(location: string, days: number)` has no return type annotation. The function assembles and returns objects with 20+ distinct fields (`date`, `dayOfWeek`, `temp.current/min/max/feelsLike`, `humidity`, `dewPoint`, `pressure`, `wind.speed/gust/direction`, `uv`, `precipitation.probability/amount/type`, `cloudCover`, `visibility`, `solarRadiation`, `evapotranspiration`, `moonPhase`, `sunrise`, `sunset`, `dayLength`, `condition`, `aqi`, `pm25`, `hourlyData[{hour, temp, feelsLike, humidity, ...}]`). Because no `DailyForecastEntry` interface is declared, TypeScript infers a wide, anonymous object-literal type from the `forecast.push({...})` call at line 297. This unannotated return type is the root cause of 13 `any` annotations downstream in `useDashboardData.ts:179,197,199,223,241,243,267,285,287,311,330,332` — four separate `forEach((day: any) => {...})` loops and eight `result: any[], entry: any` declarations — because there is no named type to import for the element of `locEntry.dailyForecast`. PROPOSAL: Declare an explicit `export interface DailyForecastEntry` (or `export type DailyForecastEntry = ReturnType<typeof generateDailyForecast>[number]`) in `data/dashboardData.ts`; import it in `useDashboardData.ts` and replace every `day: any` with `day: DailyForecastEntry` and every `result: any[], entry: any` with typed alternatives.

- OBSERVATION: `services/aiService.ts:22,44,66,88,110,146,180` — Seven `response.json()` calls across all seven API-wrapper functions return the implicit TypeScript type `any` (the standard library types `Response.json()` as `Promise<any>`). Each function then immediately property-accesses the result (`data.text`, `data.groundingChunks`) without any type annotation or runtime validation. Typos (`data.tex`, `data.groundindChunks`) are invisible to the compiler. The `getChatResponse` function at line 8 declares `Promise<string>` as its return type, and the sole line `return data.text` compiles silently even if the backend changes its response shape to `{ result: string }` — the type error is absorbed silently since `data` is `any`. This affects every LLM-backed feature in the UI. PROPOSAL: For each function, add an inline type to the `response.json()` call: e.g. `const data = await response.json() as { text: string }` for single-field responses and `const data = await response.json() as { text: string; groundingChunks: GroundingChunk[] }` for grounded responses; alternatively, define a small `interface ChatApiResponse { text: string }` etc. at the top of `aiService.ts` and cast to it.

- OBSERVATION: `contexts/UserPreferencesContext.tsx:139,290` — Two `JSON.parse()` calls produce untyped `any` values that are immediately spread into `UserPreferences`-shaped objects without shape validation. At line 139 (`const parsed = JSON.parse(stored)`), `parsed` has type `any`; the spread `{ ...defaultPreferences, ...parsed, dataSettings: { ...defaultDataSettings, ...parsed.dataSettings }, ... }` silently absorbs any malformed stored preferences (wrong field types, extra fields, missing fields). At line 290 (`importPreferences`), `const imported = JSON.parse(json)` produces `any`; if `imported` is a primitive (e.g. `JSON.parse("42")` returns the number `42`), accessing `imported.dataSettings` yields `undefined`, and `{ ...defaultDataSettings, ...undefined }` silently uses defaults; if `imported.theme` is `"purple"` (invalid `Theme` literal), the type `UserPreferences` is violated at runtime without any TS error since `imported` is `any`. The `typeof imported !== 'object'` guard is absent. PROPOSAL: Annotate `JSON.parse` return as `unknown` (requires TypeScript `5.x` — already compatible since `tsconfig.json` does not set `strict: false`), then narrow: `if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid preferences format')` before spreading; this catches shape errors at import/load time.

- OBSERVATION: `components/charts/AQITrendChart.tsx:15`, `PM25TrendChart.tsx:15`, `WeatherForecastChart.tsx:14`, `TemperaturePrecipitationChart.tsx:15` — All four chart components declare `data: any[]` in their props interfaces. The actual data arrays produced by `useDashboardData` are always `Array<{ month: string; [location: string]: number | string }>` (for trend/history charts) or `Array<{ day: string; [key: string]: number }>` (for weekly forecast). With `any[]`, recharts can receive literally any value — an array of strings, an array of nulls, a nested array — without compile-time error. Because `recharts` charts consume these arrays via dynamic `dataKey` string lookups, TypeScript has no way to verify that `dataKey={loc}` resolves to a numeric value in the data; `any[]` makes this even worse by removing all checking on the array elements. PROPOSAL: Define `type ChartDataRow = { month: string } & Record<string, number | string>` in a shared `types.ts` or inline per chart; replace all four `data: any[]` props with `data: ChartDataRow[]`.

- OBSERVATION: `services/dataService.ts:297` — `async getDashboardMetrics(locationIds?: string[])` has no return type annotation. The inferred return type is `Promise<{ totalLocations: number; avgAqi: number; avgTemp: number; alertLocations: number; lastUpdated: Date }>`. While TypeScript infers this correctly today, without a declared `DashboardMetrics` interface the signature is invisible to consumers and any refactoring of the `return {...}` literal would silently change the inferred type without alerting callers. Specifically, if a future developer renames `alertLocations` to `alertCount` inside the function body, callers accessing `metrics.alertLocations` would get `undefined` at runtime but no compile-time error because there is no named contract. PROPOSAL: Declare `export interface DashboardMetrics { totalLocations: number; avgAqi: number; avgTemp: number; alertLocations: number; lastUpdated: Date }` and annotate the method as `async getDashboardMetrics(locationIds?: string[]): Promise<DashboardMetrics>`.

**Proposed actions:**
- Declare `DailyForecastEntry` interface in `data/dashboardData.ts:195`; import and apply in `useDashboardData.ts` — H/L, score 3.0; ties current top 10, does not displace
- Add inline response type casts to all 7 `response.json()` calls in `services/aiService.ts` — M/L, score 2.0; does not enter top 10
- Narrow `JSON.parse` return to `unknown` in `UserPreferencesContext.tsx:139,290`; add object-shape guard — H/L, score 3.0; ties current top 10, does not displace
- Replace `data: any[]` with `data: ChartDataRow[]` in all 4 chart component props — M/L, score 2.0; does not enter top 10
- Declare `DashboardMetrics` interface and annotate `getDashboardMetrics` return type in `dataService.ts:297` — M/L, score 2.0; does not enter top 10

### Run #45 — 2026-05-30 — Lens: Live-time claim audit
**Scope:** Third live-time claim audit pass. Examined: `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-analytics/app/context.py`, `hooks/useRealtimeAQI.ts`, `hooks/useLiveData.ts`, `components/AirQualityMapView.tsx`, `components/dashboard/LiveDashboard.tsx`, `components/dashboard/widgets/AqiGaugeWidget.tsx`, `components/dashboard/widgets/AqiTrendWidget.tsx`. Cross-referenced archived findings from runs #15 and #30 to exclude previously-reported items.

**Findings:**

- OBSERVATION: `context.py:20` declares `SOURCE_INTERVALS["purpleair"] = 120` (2 minutes), while `config.rs:27` shows the actual default poll interval is `600` seconds (10 minutes). The `_freshness()` function at `context.py:45` marks a source as stale when `age_seconds > interval * 2`, making the threshold 240 seconds (4 minutes). Under the default configuration, PurpleAir data is fetched every 10 minutes but the analytics service declares it stale after only 4 minutes — meaning for 6 of every 10 minutes, Claude receives a context string with `STALE data sources: purpleair` and the warning `⚠ IMPORTANT: Stale data sources may not reflect current conditions`. Claude then adds unnecessary uncertainty caveats to every AQI response during those 6 minutes, even though the data is only 4–9 minutes old and perfectly within the intended refresh window. The mismatch also propagates to `build_context_text():85-91` which lists sources as `stale_sources` and injects them into every prompt. PROPOSAL: Align `SOURCE_INTERVALS["purpleair"]` in `context.py:20` to match `config.rs:27`'s default of `600`; or better, read the interval from a shared config/environment variable so both services stay in sync automatically.

- OBSERVATION: `broadcast.rs:106-108` — inside the broadcast ticker (runs every `broadcast_interval_secs`, default 5 s), cached `AqiReading` structs are re-stamped with a fresh `now` before broadcast: `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()`. The `AqiReading.timestamp` field (declared in `aqi.rs:24`) is intended to represent when the sensor measurement was taken, but it is unconditionally overwritten with the current system time at every broadcast tick. The same pattern appears in the REST snapshot handler at `routes/aqi.rs:17-24`: `live.iter().map(|r| aqi::AqiReading { timestamp: now, ..r.clone() }).collect()`. Because PurpleAir is polled every 10 minutes but broadcast every 5 seconds, each `sensor_readings` DB row (written by `persist::write_readings`) receives a timestamp 0–5 seconds old even if the underlying sensor measurement was made 9 minutes ago. The `lastUpdated` value shown in `WidgetShell` is derived from the HTTP response timestamp, not from the sensor fetch time — so users and Claude see the data as perpetually "just updated" when it may be up to 10 minutes stale. PROPOSAL: Add a `fetched_at: DateTime<Utc>` field to `AqiReading` that is set when the PurpleAir API call returns and never overwritten; propagate it through `broadcast.rs` and `routes/aqi.rs`; expose it in the SSE event JSON and REST response so the frontend can display the true data age rather than the broadcast age.

- OBSERVATION: `routes/aqi.rs:64-73` — the `GET /api/aqi-history` handler calls `aqi::generate_history(&params.station_id, hours)` unconditionally. `aqi::generate_history()` at `aqi.rs:138-162` is a pure **random-walk generator** with no database access — it produces a synthetic 24-hour AQI series by random-walking `aqi_walk` with `rng.gen_range(-5.0..5.0)` increments. It never queries `sensor_readings`. The handler also accepts `station_id=AQ-001` (from `default_station()` at `aqi.rs:50`) — a string that has no corresponding row in the database; the real stations use UUIDs (`a1b2c3d4-0001-4000-8000-000000000001` etc.). `AqiTrendWidget.tsx:21` calls this endpoint with `station_id=AQ-001&hours=24` and renders the result as the "AQI Trend (24h)" chart on the Live Dashboard. **Every data point in the 24-hour trend chart is fabricated**, refreshed with new random values every 2 minutes (`refreshInterval: 120_000`). Users who look at the trend chart to decide outdoor activity timing, and Claude when it queries `/api/aqi-history` via tool use, receive entirely synthetic data while the real historical measurements sit unused in the `sensor_readings` TimescaleDB table. PROPOSAL: Replace the `history` handler body in `routes/aqi.rs:64-73` with a `SELECT time, aqi, pm25, pm10, o3 FROM sensor_readings WHERE location_id = $1 AND time > now() - make_interval(hours => $2) ORDER BY time ASC` query; accept the real UUID format station IDs; update `AqiTrendWidget.tsx` to pass a valid UUID.

- OBSERVATION: `useRealtimeAQI.ts:286-306` — the SSE `aqi-update` event parser destructures `stationId, stationName, lat, lng, county, timestamp, aqi, pm25, pm10, o3, no2, so2, co, temperature, humidity, windSpeed, windDirection` from each reading, but **omits the `source` field**. The Rust ingestion service (`aqi.rs:38`) includes `source: &'static str` in the serialized SSE payload — values can be `"purpleair"` (real sensor), `"mock"` (generated gap-fill for stations with no nearby PurpleAir sensor), or `"airnow"`. When `broadcast.rs:76-94` fills in stations with no nearby sensors using `aqi::generate_readings()`, those mock readings (with `source: "mock"`) are merged into the broadcast and pushed over the SSE stream — but `useRealtimeAQI` silently discards `source`, making mock in-service gap-fills indistinguishable from real PurpleAir readings in the frontend. The `AirQualityMapView.tsx:413` status indicator shows `'🔴 Live'` whenever `isConnected` is true, regardless of whether the stream contains real sensor data or mock gap-fills. The subtitle at `AirQualityMapView.tsx:405` always reads "Live 3D WebGL Statistical Model" even when all city readings originate from the random generator. The `AqiGaugeWidget.tsx:67` does correctly display "PA" / "EPA" badge for readings from `useAqiSnapshot()` (the REST path), but the SSE-driven 3D map has no equivalent disclosure. PROPOSAL: Add `source: string` to the parsed reading shape in `useRealtimeAQI.ts:288-306`; pass it through `RealtimeCityData`; render a small "⚠ Simulated" badge on map markers whose `source === "mock"`; conditionally change `AirQualityMapView.tsx:405` subtitle to "Live 3D WebGL Statistical Model (partial simulated data)" when any city source is `"mock"`.

**Proposed actions:**
- Align `SOURCE_INTERVALS["purpleair"]` in `context.py:20` with `config.rs:27` default (600 s); or inject via shared env var — M/L, score 2.0; does not enter top 10
- Add `fetched_at` field to `AqiReading` in `aqi.rs`; stop overwriting `timestamp` in `broadcast.rs:106-108` and `routes/aqi.rs:24` — H/L, score 3.0; ties current top 10, does not displace
- Replace synthetic `aqi::generate_history()` in `routes/aqi.rs:64-73` with real DB query against `sensor_readings`; update `AqiTrendWidget.tsx` station ID — H/L, score 3.0; ties current top 10, does not displace
- Add `source` to `useRealtimeAQI.ts:288-306` parsed shape; render "Simulated" badge on mock map markers; update `AirQualityMapView.tsx:405` subtitle conditionally — M/L, score 2.0; does not enter top 10

## 📚 Archive (one line per past run)
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
