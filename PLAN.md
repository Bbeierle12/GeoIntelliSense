# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T16:12:00Z
Last run: #107 — Lens: Module boundaries

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
### Run #107 — 2026-06-01 — Lens: Module boundaries
**Scope:** Eighth module boundaries pass. Examined: `hooks/useRealtimeAQI.ts` (all imports), `components/3d/CityMarkers.tsx` (exported types, lines 20–32), `components/3d/index.ts` (barrel exports), `types.ts` (shared type catalog), `services/dataService.ts` (imports lines 1–9), `geointellisense-analytics/app/claude.py` (lines 78–120, deferred imports), `geointellisense-analytics/app/routes/fires.py` (lines 1–28, shared state), `geointellisense-analytics/app/main.py` (lines 32–57, lifespan imports), `geointellisense-analytics/app/routes/water.py`, `routes/inversion.py`, `routes/predict.py` (start_* function presence). Cross-checked against Active Recommendations and runs #105–#106 (Latest Findings) plus archived module-boundaries runs #92, #77, #62, #47, #32, #17, #2 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` — `import type { CityData } from '../components/3d/CityMarkers'`. The `hooks/` layer imports a domain type (`CityData`) directly from a UI component file in `components/3d/`. `CityData` (defined at `CityMarkers.tsx:20`) describes a city entity with lat, lng, name, aqi, pm25, category, and color fields — it is a pure domain type, not a rendering concern. The proper dependency direction is `components → hooks`; here the flow is reversed. This means `CityMarkers.tsx` cannot be moved, renamed, or split without also updating the hook, and any future hook that needs city-entity types must also import from a component file. `types.ts` (at the project root) already exists as the canonical home for shared cross-layer types — it currently contains `ViewType`, `ChatMessage`, `GroundingChunk`, etc. — but `CityData` was never placed there. The barrel export at `components/3d/index.ts:16` re-exports `CityData`, which is used by `components/AirQualityMapView.tsx:30` and the hook, but it does not solve the layering problem. PROPOSAL: Move `CityData` (and `CityMarkersProps` if needed by non-3D consumers) to `types.ts`; update `CityMarkers.tsx`, `AirQualityMapView.tsx`, `components/3d/index.ts`, and `hooks/useRealtimeAQI.ts` to import from `types.ts` — L/L effort, score 1.0.

- OBSERVATION: `geointellisense-analytics/app/claude.py:103` and `claude.py:116` — Two deferred imports inside `get_system_with_live_context()` and `get_system_with_fire_context()` reach into the route layer: `from app.routes.fires import get_current_smoke_context`. `claude.py` sits at the bottom of the analytics dependency stack: every AI route (`chat.py:7`, `deep_analysis.py:7`, `grounded_search.py:7`, `grounded_maps.py:7`, `low_latency.py:7`, `predictive_analysis.py:8`) imports from `claude.py`. The deferred import creates an upward route-level dependency: `routes/*.py → claude.py → routes/fires.py`. The shared state `_smoke_context: str = ""` at `fires.py:22` and its accessor `get_current_smoke_context()` at `fires.py:25–27` exist solely to provide fire context to Claude; they are not part of the fires HTTP route logic. Embedding them in `routes/fires.py` means the core AI orchestration module (`claude.py`) must reach up into the routes layer to read a string. PROPOSAL: Move `_smoke_context` state and `get_current_smoke_context()` out of `routes/fires.py` into a new `app/shared_state.py` (or into `app/context.py`); update `routes/fires.py` to write to the shared state module, and `claude.py:103,116` to import from the shared-state module instead of from a route file — L/L effort, score 2.0.

- OBSERVATION: `services/dataService.ts:4` — `import { dashboardData, cityLocations } from '../data/dashboardData'; // Keep for fallback`. `DataService` is the primary live-data service: it aggregates results from `WeatherService`, `AirQualityService`, and the analytics REST API (`ANALYTICS_URL`). Importing static mock data (`dashboardData`) as a fallback couples the live-service module to the static-data module. This means: (a) `DataService` bears responsibility for two very different data sources — live API and static mock — making it harder to test either path independently; (b) any refactor of `dashboardData.ts` (e.g., changing city names, restructuring the object) may silently break `DataService`'s fallback paths; (c) the `// Keep for fallback` comment indicates the author intended this coupling to be temporary but it persists. The correct boundary is: `DataService` should either succeed in fetching live data or throw/return an error; static fallback presentation is a UI-layer concern and should live in the component or hook that calls the service. PROPOSAL: Remove the `dashboardData` import from `dataService.ts:4`; have the service throw on failure; update callers (`hooks/useNormalizedData.ts`) to catch errors and supply static fallback data directly — L/M effort, score 1.0.

- OBSERVATION: `geointellisense-analytics/app/routes/fires.py`, `routes/water.py`, `routes/inversion.py`, `routes/predict.py` — Each of these four route modules exports both an HTTP `router` object and a background-task lifecycle function: `start_fire_polling` (`fires.py`), `start_water_polling` (`water.py`), `start_inversion_polling` (`inversion.py`), `start_retrain_scheduler` (`predict.py`). `main.py:32–40` imports all four lifecycle functions alongside their routers. This conflates two distinct concerns inside a single module: (1) HTTP endpoint definition (the `router` and its handler functions), which should be stateless and testable in isolation; and (2) background worker lifecycle (async polling loops and scheduled tasks), which manage shared mutable state (e.g., `_poll_task`, `_smoke_context`, `_inversion_cache`). As a result, importing any of these route routers in a test also starts background polling tasks if the lifespan context is not carefully mocked. Tests that import `from app.routes.fires import router` for unit testing the HTTP layer will silently pull in the fire polling machinery. PROPOSAL: Extract the background polling functions and their shared state into a `app/workers/` package (`workers/fires.py`, `workers/water.py`, `workers/inversion.py`, `workers/predict.py`); import only `router` from route files; import `start_*` functions from the workers package; route files that need to read worker state (e.g., `get_current_smoke_context`) import it from the workers module — M/M effort, score 1.0.

**Proposed actions:**
- Move `CityData` to `types.ts`; update `CityMarkers.tsx:20–31`, `components/3d/index.ts:16`, `AirQualityMapView.tsx:30`, `hooks/useRealtimeAQI.ts:8` — L/L, score 1.0
- Extract `_smoke_context` + `get_current_smoke_context()` from `routes/fires.py:22–27` into `app/shared_state.py` or `app/context.py`; fix upward import in `claude.py:103,116` — L/L, score 2.0
- Remove `dashboardData` import from `services/dataService.ts:4`; push static fallback responsibility to callers — L/M, score 1.0
- Extract background polling from route modules into `app/workers/` package; decouple router imports from worker imports in `main.py:32–54` — M/M, score 1.0

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

## 📚 Archive (one line per past run)
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
