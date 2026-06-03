# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-03T05:10:00Z
Last run: #137 — Lens: Module boundaries

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
### Run #137 — 2026-06-03 — Lens: Module boundaries
**Scope:** Tenth module-boundaries pass. Examined: all `components/*.tsx` and `components/dashboard/*.tsx` (import sections); `contexts/UserPreferencesContext.tsx` (import section); `services/dataService.ts` (full — lines 1–416); `hooks/useDashboardData.ts` (import line); `geointellisense-analytics/app/context.py` (lines 1–60, 320–340, 460–495 — deferred import blocks); `geointellisense-analytics/app/routes/fires.py` (lines 1–40 — `get_current_smoke_context` definition); `geointellisense-analytics/app/routes/inversion.py` (lines 1–80 — `get_current_inversion` definition and poll loop); `geointellisense-analytics/app/routes/earthquakes.py` (full — raw SQL in route handler); `geointellisense-analytics/app/routes/cropscape.py` (lines 1–20); grep for `from app.database import get_pool` across all route files (17 hits); grep for `from app.clients` importing constants across routes. Cross-checked against Active Recommendations and runs #135–#136 (Latest Findings) plus archived module-boundary runs #2, #17, #32, #47, #62, #77, #92, #107, #122 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/context.py:323` and `context.py:471` — `build_live_context()` uses deferred (inside-function-body) imports to pull `get_current_smoke_context` from `app.routes.fires` and `get_current_inversion` from `app.routes.inversion`. These are not top-level circular imports (Python's import system avoids the cycle because the imports are deferred), but they represent a deliberate boundary inversion: `context.py` is imported by `claude.py:92` which is imported by every AI route handler; `routes/fires.py` and `routes/inversion.py` are supposed to be leaf nodes that nothing else in the architecture depends on. The functions being imported (`get_current_smoke_context`, `get_current_inversion`) expose module-level mutable variables (`_smoke_context: str = ""` at `fires.py:22` and `_current_status: dict | None = None` at `inversion.py:21`) that are written by background polling tasks. `context.py` thereby depends on route-module global state — meaning: (a) testing `build_live_context()` in isolation requires importing route modules with their background tasks and DB dependencies; (b) any refactor of the routes module risks silently breaking context assembly since the dependency is invisible in the call graph; (c) if `fires.py` or `inversion.py` is renamed or refactored, the deferred import fails silently (caught by `except Exception` at `context.py:331, 474`) and the Claude context omits fire/inversion data without any log entry at ERROR level. PROPOSAL: Extract `_smoke_context` and `_current_status` into a shared `app.state` module (a thin in-memory store with `get`/`set` functions); have polling tasks write to `app.state`; have `context.py` read from `app.state` — eliminates the route→context→route dependency cycle and makes the dependency graph acyclic — L/L effort (add ~20-line `state.py`; replace 4 deferred imports with `from app.state import get_smoke_context, get_inversion_status`).

- OBSERVATION: `geointellisense-analytics/app/routes/*.py` — 17 of the 28 route files import `get_pool` from `app.database` and execute raw SQL query strings directly inside route handler functions. Examples: `routes/earthquakes.py:53–91` contains two near-identical 20-line SQL blocks (one with bbox filter, one without); `routes/inversion.py` calls `_persist_event(pool, status)` which issues an `INSERT` from within the route module; `routes/fires.py` calls `pool.execute(...)` to write fire detections; `routes/predict.py:42` calls `await train_model(pool)` passing the raw pool to the ML layer. There is no repository or data-access layer: SQL query strings, table names (`earthquake_events`, `aqi_readings`, `fire_detections`, `inversion_events`), column projections, and asyncpg connection management are fully interleaved with HTTP parameter parsing and response serialisation in the same function bodies. Consequence: the same table names and column sets are hard-coded in multiple files with no single source of truth; a column rename (e.g., `event_id` → `earthquake_id`) requires editing every query across multiple route files. PROPOSAL: Extract per-domain query functions into `app/repositories/` modules (e.g., `repositories/earthquakes.py`, `repositories/fires.py`); route handlers call `await repo.get_recent(days, ...)` instead of constructing SQL — reduces code duplication, isolates asyncpg usage, and enables mock-based unit testing — M/H effort (mechanical but broad extraction across 17 files).

- OBSERVATION: `geointellisense-analytics/app/routes/cropscape.py:9`, `routes/traffic.py:10`, `routes/calgem.py:10`, `routes/enviroscreen.py:10`, `routes/epa_aqi.py:12`, `routes/demographics.py:10`, `routes/water.py:10`, `routes/weather_historical.py:11` — Eight route files import domain constants from client modules: `KERN_FIPS`, `SJV_FIPS`, `CDL_WMS_URL` from `clients/cropscape`; `KEY_ROUTES` from `clients/caltrans`; `SJV_COUNTIES` from `clients/calgem`, `clients/calenviroscreen`, `clients/epa_aqs`, `clients/census`; `SJV_STATIONS`, `DEFAULT_STATION` from `clients/noaa_cdo`; `PARAMS_ALL` from `clients/epa_aqs`. These constants — county FIPS mappings, USGS station IDs, WMS tile URLs — are geographic domain knowledge shared between client data-fetching logic and the HTTP response serialisation code in route handlers. Multiple `SJV_COUNTIES` dictionaries exist independently in `clients/calgem.py`, `clients/calenviroscreen.py`, `clients/epa_aqs.py`, and `clients/census.py` — each defining the same 8 counties with the same FIPS codes but potentially diverging (a new county addition must be made in each separately). PROPOSAL: Create `app/domain/sjv_geography.py` exporting a single `SJV_COUNTIES` mapping and related geographic constants; have all client modules and route handlers import from it — eliminates the 4-way duplication and makes geographic domain knowledge have one owner — L/L effort (one new file; 4 client files and 8 route files update their import source).

- OBSERVATION: `components/AirQualityMapView.tsx:8`, `components/AnalysisView.tsx:32`, `components/CalendarView.tsx:7`, `components/Dashboard.tsx:14`, `components/dashboard/LocationSelector.tsx:2`, `contexts/UserPreferencesContext.tsx:2` — Six frontend modules import directly from `data/dashboardData.ts`, bypassing the `services/dataService.ts` and hooks abstraction layer. The most architecturally significant violation is `UserPreferencesContext.tsx:2`: the app-wide context provider imports `LocationKey` — a type derived from the static data file's keys — directly from `data/dashboardData`. This couples the React context tree root to the data implementation. If `dashboardData.ts` is ever replaced by a live-data source, `LocationKey` must be moved or re-exported from a new location, and every file importing it must be updated. Additionally, `services/dataService.ts:4` has a static import of `dashboardData` at the top level AND a dynamic `await import('../data/dashboardData')` call inside `getLocations():274` — two different import mechanisms for the same module in the same file, which causes the module to be resolved at both bundle-time and runtime, undermining tree-shaking. The correct pattern: `data/dashboardData.ts` should be the private implementation of `services/dataService.ts`; `LocationKey`, `cityLocations`, and location coordinate data should be re-exported from `services/dataService.ts`; UI components and contexts should import only from services or hooks. PROPOSAL: Re-export `LocationKey` and `cityLocations` from `services/dataService.ts`; update 6 consumer files to import from `services/` instead of `data/`; remove the duplicate dynamic import in `dataService.ts:274` — L/L effort (no logic change; only import path updates in 7 files).

**Proposed actions:**
- Add `app/state.py` (thin in-memory store) and refactor `routes/fires.py` / `routes/inversion.py` to write state there; update `context.py:323, 471` to read from `app.state` — eliminates route-module deferred import pattern — L/L effort
- Extract per-domain SQL into `app/repositories/` modules; route handlers call repository functions instead of `get_pool()` directly — M/H effort (high effort but resolves a systemic coupling affecting 17 files)
- Create `app/domain/sjv_geography.py` with single canonical `SJV_COUNTIES`; update 4 client files + 8 route files to import from it — L/L effort
- Re-export `LocationKey` and `cityLocations` from `services/dataService.ts`; migrate 6 consumer files off direct `data/dashboardData` imports; remove duplicate dynamic import at `dataService.ts:274` — L/L effort

### Run #136 — 2026-06-03 — Lens: Type safety
**Scope:** Tenth type-safety pass. Examined: `tsconfig.json` (full); `data/dashboardData.ts` (lines 195–338 — `generateDailyForecast` function and type exports); `hooks/useDashboardData.ts` (full — all 8 `useMemo` aggregation blocks); `components/charts/AQITrendChart.tsx` (full); `components/charts/PM25TrendChart.tsx` (full); `components/charts/WeatherForecastChart.tsx` (full); `components/charts/TemperaturePrecipitationChart.tsx` (full); `components/3d/AQI3DScene.tsx` (lines 1–80 — `CameraController`); `components/AccessibleChart.tsx` (lines 60–90); `components/AirQualityMapView.tsx` (lines 240–260); `services/aiService.ts` (full). Cross-checked against Active Recommendations and runs #134–#135 (Latest Findings) plus archived type-safety runs #1, #16, #31, #46, #61, #76, #91, #106, #121 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `tsconfig.json` (full file) — The TypeScript configuration has no `"strict"` flag and no individual strict-mode options (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `noImplicitReturns`). `skipLibCheck: true` is present, but with no strict mode, the TypeScript compiler is permissive: implicit `any` inferences produce no errors, `null` and `undefined` are assignable to every type, and functions are allowed to have code paths that don't return a value. This is the structural root cause behind the dense `any` proliferation in `hooks/useDashboardData.ts`, `components/charts/*.tsx`, and `components/3d/AQI3DScene.tsx` found in this and prior type-safety passes. Without `strictNullChecks`, the `!` non-null assertions at `MapView.tsx:223,225,393,394` (`mapInstanceRef.current!.getBounds()`, etc.) provide no compile-time guarantee — the compiler treats null as a valid value everywhere and the assertions are noise rather than safety. Enabling `strict: true` (or incrementally enabling `strictNullChecks` + `noImplicitAny`) would surface existing type errors rather than silently permitting them, converting the codebase's `any` debt from invisible to compiler-visible. PROPOSAL: Add `"strict": true` to `tsconfig.json` (or minimally add `"noImplicitAny": true, "strictNullChecks": true` as a staged adoption) — M/M effort (enables compiler enforcement; expect ~50–100 new type errors to resolve on first enable, mostly in `useDashboardData.ts` and charts).

- OBSERVATION: `data/dashboardData.ts:195` — `function generateDailyForecast(location: string, days: number)` has no explicit return type annotation. The function constructs and pushes a large object literal (22 top-level fields including nested `temp`, `wind`, `precipitation`, `hourlyData` sub-objects) into `forecast` and returns it. TypeScript infers a wide object-literal union type; the `dailyForecast` field in all 7 location entries in `dashboardData` inherits this inferred type. As a consequence, the 4 `forEach` callbacks in `useDashboardData.ts` at lines 179, 223, 267, and 311 all annotate the iteration variable as `day: any` — without an explicit `DailyForecast` interface, callers cannot rely on the structural type being stable. If any field is renamed or removed from the return object (e.g., `evapotranspiration` renamed to `et0`), the access at `useDashboardData.ts:322` (`day.evapotranspiration`) silently returns `undefined` at runtime with no compile-time warning. Adding a `DailyForecast` interface that matches the object returned by `generateDailyForecast` and annotating the return type as `DailyForecast[]` would make all 4 `day: any` casts redundant and enable field-access validation. PROPOSAL: Extract a `DailyForecast` interface from `generateDailyForecast`'s return shape in `data/dashboardData.ts:195`; annotate the return type; remove the 4 `(day: any)` casts in `useDashboardData.ts:179,223,267,311` — L/L effort (one new interface declaration + 4 one-word type changes).

- OBSERVATION: `hooks/useDashboardData.ts:197,199,241,243,285,287,330,332` — The four monthly aggregation memos (`mergedHumidityData`, `mergedWindData`, `mergedUVData`, `mergedAgriculturalData`) each maintain a correctly-typed intermediate accumulator: `Map<string, Record<string, { sum: number; count: number }>>` (lines 174, 218, 262) or `Map<string, Record<string, { et0Sum: number; solarSum: number; count: number }>>` (line 306). After accumulation, the typed Map is discarded in favour of `const result: any[]` and `const entry: any = { month }`, which erases all structural information. The result flows upstream to chart components whose `data` prop is `any[]` (`AQITrendChart.tsx:15`, `PM25TrendChart.tsx:15`, `WeatherForecastChart.tsx:14`, `TemperaturePrecipitationChart.tsx:15`), creating an end-to-end untyped pipeline from aggregation to render. A typo in `entry[loc]` vs `entry[\`${loc}_et0\`]` (agricultural chart at line 334) would not be caught. Defining `type MonthlyChartPoint = { month: string } & Record<string, number>` and replacing all 8 occurrences of `result: any[]` / `entry: any` with this type would restore structural integrity without requiring any change to the chart components. PROPOSAL: Add `type MonthlyChartPoint = { month: string } & Record<string, number>` in `useDashboardData.ts`; replace `result: any[]` at lines 197, 241, 285, 330 and `entry: any` at lines 199, 243, 287, 332 with the new type — L/L effort (8 one-word substitutions + 1 type declaration).

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `const controlsRef = useRef<any>(null)` is used to hold the `OrbitControls` instance from `@react-three/drei`. The `@react-three/drei` package re-exports `OrbitControls` as a React component whose `ref` forwards to an `OrbitControlsImpl` instance (from `three-stdlib`). The correct ref type is `import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'` giving `useRef<OrbitControlsImpl | null>(null)`. At line 70, `controlsRef.current.getTarget(target)` is called; with `useRef<any>`, a change to `drei`'s OrbitControls API (e.g., the method becoming `.getTarget()` → `.target.copy()` as happened between `drei` versions) would not produce a TypeScript error and would only surface as a runtime failure during camera-move callbacks. Additionally, the OrbitControls component at line 78 accepts a `ref` prop of type `React.Ref<OrbitControlsImpl>` — passing `useRef<any>` silences the mismatch check. PROPOSAL: Replace `useRef<any>(null)` at `AQI3DScene.tsx:57` with `useRef<OrbitControlsImpl | null>(null)`; add `import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'` — L/L effort (2 lines: one import, one type parameter).

**Proposed actions:**
- Add `"strict": true` (or staged `"noImplicitAny": true, "strictNullChecks": true`) to `tsconfig.json` — root-cause fix that converts the codebase's implicit `any` debt from invisible to compiler-visible — M/M effort
- Add `DailyForecast` interface to `data/dashboardData.ts:195`; annotate `generateDailyForecast` return type; remove 4 `day: any` casts in `useDashboardData.ts:179,223,267,311` — L/L effort
- Add `type MonthlyChartPoint = { month: string } & Record<string, number>` in `useDashboardData.ts`; replace 8 `any` usages at lines 197,199,241,243,285,287,330,332 — L/L effort
- Replace `useRef<any>(null)` at `AQI3DScene.tsx:57` with `useRef<OrbitControlsImpl | null>(null>`; add `three-stdlib` import — L/L effort

### Run #135 — 2026-06-03 — Lens: Live-time claim audit
**Scope:** Tenth live-time claim audit pass. Examined: `geointellisense-ingestion/src/broadcast.rs` (full); `geointellisense-ingestion/src/config.rs` (full); `geointellisense-ingestion/src/main.rs` (full); `geointellisense-ingestion/src/routes/sse.rs` (full); `geointellisense-ingestion/src/routes/aqi.rs` (full); `geointellisense-ingestion/src/aqi.rs` (lines 1–140); `geointellisense-ingestion/src/purpleair.rs` (full); `geointellisense-analytics/app/context.py` (lines 15–55); `geointellisense-analytics/app/routes/predict.py` (full); `geointellisense-analytics/app/main.py` (full); `hooks/useLiveData.ts` (full); `hooks/useRealtimeAQI.ts` (full); `components/AirQualityMapView.tsx` (lines 60–82, 193–215, 267–285, 390–430); `components/dashboard/widgets/AqiForecastWidget.tsx` (full). Cross-checked against Active Recommendations and runs #133–#134 (Latest Findings) plus archived live-time audit runs #15, #30, #45, #60, #75, #90, #105, #120 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:75-80` and `geointellisense-ingestion/src/routes/aqi.rs:22-28` — Both the SSE broadcast ticker and the `/api/aqi-snapshot` REST handler re-stamp every `AqiReading.timestamp` field with `Utc::now()` at the moment of dispatch, not at the moment of sensor measurement. The PurpleAir fetch cycle defaults to 600 seconds (`config.rs:21: purpleair_interval_secs: 600`); the cached readings sit unchanged in memory for up to that interval. On each 5-second broadcast tick the broadcaster rebuilds the `readings` vector as `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() })`, overwriting the original PurpleAir measurement timestamp. Clients receive readings that appear to have been measured at the instant of SSE delivery, while the actual measurement may be up to 600 seconds old. `AirQualityMapView.tsx:416` displays `lastUpdate.toLocaleTimeString()` as "the time the data arrived", which coincides with the re-stamped `now` — so there is no client-visible signal that the underlying sensor observation is up to 10 minutes old. The `source: "purpleair"` field does survive, so the MapView "LIVE" badge (`components/MapView.tsx:256`) still shows for PurpleAir readings; however, neither the badge nor the timestamp conveys measurement age. PROPOSAL: Preserve the original PurpleAir fetch timestamp in a separate `measuredAt` field (set once in `purpleair.rs` from `Utc::now()` at fetch time); populate `AqiReading.timestamp` with it; add a `broadcastAt` field for the dispatch time if needed for stream bookkeeping — consumers can then compute `age_seconds = broadcastAt - measuredAt` and surface it in the UI — L/M effort.

- OBSERVATION: `geointellisense-analytics/app/context.py:20` — `SOURCE_INTERVALS["purpleair"] = 120` (comment: "PurpleAir fetcher runs every 2 min"). The staleness threshold is `age_seconds > interval * 2 = 240s`. But the actual default polling period is `config.rs:21: purpleair_interval_secs = 600` (10 minutes). Under default configuration, any PurpleAir data older than 4 minutes (240s) is classified as `status: "stale"` in the analytics context. Since the broadcast cycle is 5 seconds and the fetch cycle is 600 seconds, the cached data age at any given moment is uniformly distributed from 0 to 600 seconds; the probability of the data being ≤240s old is 240/600 = 40%. Consequently, on 60% of Claude API calls the system prompt assembled by `build_live_context()` includes the line "STALE data sources (may be outdated): purpleair" (`context.py:88-89`), causing Claude to caveat or discount real-time PurpleAir AQI values even when the system is operating exactly as designed. PROPOSAL: Correct `context.py:20` to `"purpleair": 600` to match `config.rs:21`; the stale threshold will become 1200s, accurately reflecting a 10-minute cycle — L/L effort (one integer change).

- OBSERVATION: `geointellisense-ingestion/src/purpleair.rs:118-119` + `hooks/useRealtimeAQI.ts:405-406` + `components/AirQualityMapView.tsx:281, 405` — PurpleAir v1 API does not provide wind data; `purpleair.rs:118-119` explicitly sets `wind_speed: 0.0` and `wind_direction: 0.0` on all live readings. In `useRealtimeAQI.ts`, the derived `windData` array applies `speed: city.windSpeed || 10` (JavaScript falsy coercion: `0.0 || 10 = 10`) but no direction fallback: `direction: city.windDirection` remains `0.0` (due North) for every city. `AirQualityMapView.tsx:281` selects `realtimeWindData` over `staticWindData` whenever `useRealtimeData && realtimeWindData.length > 0` — which is always true when the SSE stream is connected with PurpleAir data. The result: the 3D wind field visualization renders all wind arrows pointing due North at exactly 10 mph for all six SJV stations when live PurpleAir data is active. Meanwhile `AirQualityMapView.tsx:405` renders the static subtitle "Live 3D WebGL Statistical Model • San Joaquin Valley" unconditionally. The `staticWindData` from `generateWindData(new Date())` (lines 67–82) would provide directionally-varying, time-of-day-aware estimates (NW mornings, SE afternoons), which is more physically plausible than all-North. PROPOSAL: In `useRealtimeAQI.ts:406`, add a direction fallback `direction: city.windDirection || defaultWindDirection(city.lat)`, or fall back to `staticWindData` for the wind layer when live readings have `windSpeed === 0` — prevents the all-North-wind artifact and the subtitle "Live … Statistical Model" from implying live wind data when none exists — L/L effort.

- OBSERVATION: `components/dashboard/widgets/AqiForecastWidget.tsx:40` + `geointellisense-analytics/app/routes/predict.py:17, 40-41` — The `AqiForecastWidget` renders `data.predictedAqi`, `data.category`, and `data.modelR2` but does not render `data.trainedAt` (available in `PredictionResult` at `hooks/useLiveData.ts:134`). The ML model retrains weekly (`predict.py:17: MODEL_TTL = 604800`) via a background loop that sleeps 7 days first (`predict.py:40-41: await asyncio.sleep(604800)` before first training). Prediction results are cached for 30 minutes (`predict.py:17: PREDICT_TTL = 1800`). The `WidgetShell` "lastUpdated" time shown to users reflects when the widget last fetched the prediction endpoint (refreshInterval 300,000ms), not when the model was trained. A user seeing the dashboard "AQI Forecast (24h)" widget — which shows a prominent AQI number with "AQI Forecast (24h)" title — has no indication that the forecast may be derived from a model trained up to 7 days ago on data up to 7 days old. The R² score shown (`R²={data.modelR2}`) conveys accuracy but not freshness. PROPOSAL: Add a `trainedAt` display to `AqiForecastWidget.tsx` — render `data.trainedAt` as a small "Model trained: X days ago" line below the R² badge — L/L effort (one additional JSX line using `data.trainedAt`).

**Proposed actions:**
- Add `measuredAt` field to `AqiReading` in `purpleair.rs`, preserving original fetch timestamp; expose `broadcastAt` separately; update client to compute and display data age — prevents misleading "now" timestamps on stale readings — L/M effort
- Fix `context.py:20` `SOURCE_INTERVALS["purpleair"]` from `120` to `600` — eliminates false "STALE" Claude context warnings on 60% of calls at default config — L/L effort
- In `useRealtimeAQI.ts:406` add direction fallback when `windDirection === 0` (or when `source === "purpleair"`); prevents all-North-wind artifact in 3D wind field when SSE is connected — L/L effort
- Add `trainedAt` display to `AqiForecastWidget.tsx:40` — surface model age to users who rely on the "AQI Forecast (24h)" widget — L/L effort

## 📚 Archive (one line per past run)
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
