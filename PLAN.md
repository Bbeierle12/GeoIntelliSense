# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T01:15:00Z
Last run: #92 — Lens: Module boundaries

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
### Run #92 — 2026-06-01 — Lens: Module boundaries
**Scope:** Eighth module-boundaries pass. Examined: `hooks/useRealtimeAQI.ts`, `components/3d/CityMarkers.tsx`, `components/3d/index.ts`, `types.ts`, `components/Dashboard.tsx`, `hooks/useNormalizedData.ts`, `services/dataService.ts`, `services/aiService.ts`, `services/WeatherService.ts`, `services/AirQualityService.ts`, `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/routes/fires.py`, `geointellisense-analytics/app/source_toggles.py`, `geointellisense-analytics/app/routes/admin.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/routes/inversion.py`, `geointellisense-analytics/app/routes/airnow.py`, `geointellisense-analytics/app/routes/nws_forecast.py`, `geointellisense-analytics/app/routes/water_quality.py`, `geointellisense-analytics/app/ml/aqi_model.py`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/routes/mod.rs`. Cross-checked against Active Recommendations and runs #89–#91 (Latest Findings) to confirm all findings are new.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` — `import type { CityData } from '../components/3d/CityMarkers'`. A React hook imports a domain data type from a UI component, inverting the canonical dependency direction (`components → hooks → services/utils`). `CityData` (declared at `CityMarkers.tsx:20-30`) defines `{ id: string; name: string; lat: number; lng: number; aqi: number; temperature?: number; humidity?: number; windSpeed?: number; pm25?: number }` — a pure domain type describing a sensor location with no Three.js or React content. `RealtimeCityData` at `useRealtimeAQI.ts:15-21` extends `CityData`, adding real-time fields. `AirQualityMapView.tsx:30` imports `CityData` via the barrel file (`./3d`), while `useRealtimeAQI.ts` bypasses the barrel and imports directly from the leaf component. Any future refactor of `CityMarkers.tsx` (e.g., splitting rendering from data shape) must account for this cross-layer import or risk breaking the hook. `types.ts` currently defines only UI navigation types (`ViewType`, `ChatMessage`, `GroundingChunk`) and is the correct home for domain data types. PROPOSAL: Move `CityData` from `components/3d/CityMarkers.tsx:20-30` to `types.ts`; update the re-export in `components/3d/index.ts:16` to `export type { CityData } from '../../types'`; change `useRealtimeAQI.ts:8` to `import type { CityData } from '../types'`; update `AirQualityMapView.tsx:30` to import from `'../types'` — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/app/claude.py:103,116` and `app/context.py:323` — All three call sites lazy-import `get_current_smoke_context` from `app.routes.fires` inside function bodies to avoid what would be a hard circular import at module level. `claude.py` is a shared infrastructure module that is imported by four route modules (`chat.py`, `grounded_search.py`, `grounded_maps.py`, `deep_analysis.py`). `context.py` is also a shared module imported by `routes/ai_context.py`. Both modules importing from `routes/fires` inverts the layering: infrastructure → route. The root cause is that `fires.py:22` declares module-level state `_smoke_context: str = ""` and a getter `get_current_smoke_context()` at line 25. This state is populated during background fire-polling (`_poll_loop`, which calls `get_smoke_context(fires)` from `app.clients.nasa_firms`). The `nasa_firms` client (`clients/nasa_firms.py`) already exports `get_smoke_context()` — it builds the smoke context string from a list of `FireDetection` objects. The in-process cache belongs one layer lower: in the client module or a dedicated state module, not in the HTTP route. PROPOSAL: Add `_smoke_context: str = ""` and `def get_current_smoke_context() -> str` to `app/clients/nasa_firms.py` (alongside the existing `get_smoke_context()` factory); update `fires.py:_poll_loop` to call `nasa_firms.set_smoke_context(_smoke_context)` instead of writing to a module-level variable; change the three lazy imports in `claude.py` (lines 103, 116) and `context.py` (line 323) to top-level `from app.clients.nasa_firms import get_current_smoke_context` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `app/routes/fires.py:45,112`, `water.py:35,118`, `inversion.py:38,85`, `airnow.py:30,75`, `nws_forecast.py:41,100`, `water_quality.py:327` — All six route files import `is_enabled` from `app.source_toggles` lazily inside handler or polling-loop bodies (12 total deferred import statements). By contrast, `routes/admin.py:6` imports the same module at the module level: `from app.source_toggles import SOURCES, is_enabled, set_enabled, get_all_states`. The apparent reason for deferred imports is the mistaken belief that `source_toggles` might introduce a circular dependency: `source_toggles.py` lazily imports `from app.cache import get_redis` inside its own async functions (lines 49, 61), suggesting its author was guarding against a `cache → source_toggles → cache` cycle. However, `cache.py` (which imports only from `app.config`) does not import from `source_toggles`, so no cycle exists. The lazy-import pattern propagated to every caller without verification, adding 12 unnecessary deferred imports. Each deferred import executes a module lookup on every handler invocation rather than once at startup. PROPOSAL: Promote all 12 deferred `from app.source_toggles import is_enabled` statements in the six route files to module-level imports, consistent with `admin.py:6`; this eliminates per-request module lookups and makes the import graph explicit — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `components/Dashboard.tsx:39-74` — A 5-call async data-fetching block (`dataService.getCurrentAQI()`, `getCurrentWeather()`, `getWeatherForecast()`, `getHistoricalAQI()`, `getHistoricalWeather()`) is embedded directly in a `useEffect` inside the `Dashboard` component body. `hooks/useNormalizedData.ts` was introduced as a dedicated hook that calls the same five `dataService` methods (lines 51-56) for the same data types. The established pattern throughout the codebase is: data-fetching goes in hooks, hooks are called from components. Every other data-consuming view follows this: `AirQualityMapView` calls `useRealtimeAQI`, dashboard widgets call `useLiveData`, `DataExplorer` calls `useLiveData`. The `Dashboard.tsx` fetch logic cannot be tested without rendering the component; it does not appear in any test file while `useNormalizedData` can be tested in isolation. Any change to `dataService` return types must be updated in both `Dashboard.tsx:39-74` and `useNormalizedData.ts:51-56`. PROPOSAL: Extract the inline `useEffect` at `Dashboard.tsx:39-74` into a `useDashboardFetch()` hook in `hooks/` that returns `{ aqiData, weatherData, forecastData, historicalAqi, historicalWeather, loading, error }`; consider whether `useDashboardFetch` and `useNormalizedData` can be unified into a single hook since they call the same service layer — M/M, score 1.0; does not displace top 10.

**Proposed actions:**
- Move `CityData` from `components/3d/CityMarkers.tsx:20-30` to `types.ts`; update `components/3d/index.ts:16` re-export and change `useRealtimeAQI.ts:8` to import from `'../types'` — L/L, score 1.0
- Move `_smoke_context` state and `get_current_smoke_context()` from `routes/fires.py:22-27` to `app/clients/nasa_firms.py`; change lazy imports in `claude.py:103,116` and `context.py:323` to top-level imports — M/L, score 2.0
- Promote 12 deferred `from app.source_toggles import is_enabled` statements in `fires.py`, `water.py`, `inversion.py`, `airnow.py`, `nws_forecast.py`, `water_quality.py` to module-level imports — L/L, score 1.0
- Extract `Dashboard.tsx:39-74` inline `useEffect` into a dedicated `useDashboardFetch()` hook; evaluate merging with `useNormalizedData.ts` — M/M, score 1.0

### Run #91 — 2026-06-01 — Lens: Type safety
**Scope:** Seventh type safety pass. Examined: `components/charts/AQITrendChart.tsx`, `components/charts/PM25TrendChart.tsx`, `components/charts/TemperaturePrecipitationChart.tsx`, `components/charts/WeatherForecastChart.tsx`, `hooks/useDashboardData.ts`, `components/3d/AQI3DScene.tsx`, `data/dashboardData.ts`, `services/dataService.ts`, `components/AccessibleChart.tsx`, `hooks/useLiveData.ts`, `hooks/useNormalizedData.ts`, `services/aiService.ts`. Cross-checked against Active Recommendations and runs #88–#90 (Latest Findings) plus archived type safety runs #1, #16, #31, #46, #61, #76 to confirm all findings are new.

**Findings:**

- OBSERVATION: `components/charts/AQITrendChart.tsx:15`, `components/charts/PM25TrendChart.tsx:15`, `components/charts/TemperaturePrecipitationChart.tsx:15`, `components/charts/WeatherForecastChart.tsx:14` — All four chart components declare their `data` prop as `data: any[]`. Each component receives pivot-table rows whose shape is dynamically computed: `AQITrendChart` expects `{ month: string; [locationName: string]: number }`, `WeatherForecastChart` expects `{ day: string; [loc_temp: string]: number }`, `TemperaturePrecipitationChart` expects `{ month: string; [loc_temp: string]: number; [loc_precip: string]: number }`. With `data: any[]`, TypeScript performs no shape check on the passed arrays. A caller could silently pass `mergedHumidityData` (which has a `month` key) to `WeatherForecastChart` (which expects a `day` key) — TypeScript would not complain, but Recharts' `XAxis dataKey="day"` would silently render an empty axis. A shared alias `type ChartDataPoint = { [key: string]: string | number | undefined }` would at minimum distinguish chart data from arbitrary `unknown[]`, and individual per-chart interfaces would provide full safety. PROPOSAL: Export `type ChartDataPoint = { [key: string]: string | number | undefined }` from `components/charts/index.ts` and replace `data: any[]` in all four chart component interfaces with `data: ChartDataPoint[]` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `hooks/useDashboardData.ts:179,223,267,311` — The four weather-metric aggregate `useMemo` blocks (`mergedHumidityData` lines 167–208, `mergedWindData` lines 210–252, `mergedUVData` lines 254–296, `mergedAgriculturalData` lines 298–342) all include `locEntry.dailyForecast.forEach((day: any) =>`. The `generateDailyForecast` function at `data/dashboardData.ts:195` returns an inferred array of objects with fully typed fields including `humidity: number`, `wind: { speed: number; ... }`, `uv: number`, `evapotranspiration: number`, `solarRadiation: number`. TypeScript infers this type from the function body — no annotation is missing. The `(day: any)` annotation deliberately silences the compiler for those field accesses (lines 190, 234, 278, 322-323) rather than using the correct inferred type. If `generateDailyForecast` were to rename a field (e.g., `evapotranspiration` → `et0`), the mismatched access at line 322 (`day.evapotranspiration`) would produce `undefined` at runtime with no compile error. The correct fix is to derive the day's type from the return value: `type DailyForecastDay = ReturnType<typeof generateDailyForecast>[number]` and annotate `(day: DailyForecastDay)` in all four callbacks. Additionally, lines 197, 241, 285, and 330 all declare `const result: any[] = []` and `const entry: any = { month }` — the narrowly typed accumulator Maps are immediately discarded at the result-assembly step. PROPOSAL: Export `type DailyForecastDay = ReturnType<typeof generateDailyForecast>[number]` from `data/dashboardData.ts`; replace `(day: any)` with `(day: DailyForecastDay)` in the four forEach callbacks in `useDashboardData.ts`; replace `const result: any[]` and `const entry: any` with a concrete type (e.g., `type MonthChartPoint = { month: string; [locationKey: string]: string | number }`) — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `CameraController` declares `const controlsRef = useRef<any>(null)` for the ref attached to `<OrbitControls ref={controlsRef} ...>` (line 79). `OrbitControls` is imported from `@react-three/drei` (line 8), which wraps `three/examples/jsm/controls/OrbitControls`. The method `controlsRef.current.getTarget(target)` is called at line 71 — with `useRef<any>`, this call and all other `controlsRef.current.*` accesses are unchecked. The correct ref type is `import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls'` which exposes `getTarget(target: THREE.Vector3): THREE.Vector3`, `getPolarAngle(): number`, `getAzimuthalAngle(): number`, and the `enabled` setter used elsewhere in `OrbitControls`. Additionally, lines 105, 175 in the same file correctly use `useRef<THREE.DirectionalLight>(null)` and `useRef<THREE.Mesh>(null)` — the inconsistency is specific to the `OrbitControls` ref where the drei wrapper complicates the type. PROPOSAL: Add `import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls'` to `AQI3DScene.tsx` and change line 57 to `useRef<ThreeOrbitControls>(null)` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `data/dashboardData.ts:195` and `services/dataService.ts:297` — Two public API surfaces lack explicit return type annotations, making their inferred types invisible to callers. `generateDailyForecast` at `dashboardData.ts:195` returns a complex array of ~30-field objects (date, temp, humidity, wind, aqi, pm25, hourlyData, etc.) but its return type is completely inferred — no `DailyForecastDay` interface is exported from the module. This is the structural root cause of the `(day: any)` pattern in `useDashboardData.ts` (Finding 2 above): without an exported named type, a developer faced with accessing forecast day fields has no autocomplete or type documentation, making `(day: any)` the path of least resistance. `DataService.getDashboardMetrics()` at `dataService.ts:297` similarly lacks a return type annotation — TypeScript infers `Promise<{ totalLocations: number; avgAqi: number; avgTemp: number; alertLocations: number; lastUpdated: Date }>`, but no `DashboardMetrics` interface is exported, so callers that access the result cannot validate field names or add new fields without risking silent omissions. PROPOSAL: (1) Export `interface DailyForecastDay { date: string; dayOfWeek: string; temp: { current: number; min: number; max: number; feelsLike: number }; humidity: number; wind: { speed: number; gust: number; direction: string }; uv: number; aqi: number; pm25: number; evapotranspiration: number; solarRadiation: number; /* ...rest */ }` from `data/dashboardData.ts` and annotate the function return `DailyForecastDay[]`; (2) export `interface DashboardMetrics { totalLocations: number; avgAqi: number; avgTemp: number; alertLocations: number; lastUpdated: Date }` from `services/dataService.ts` and annotate `getDashboardMetrics(): Promise<DashboardMetrics>` — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Export `type ChartDataPoint = { [key: string]: string | number | undefined }` from `components/charts/index.ts`; replace `data: any[]` in all four chart component Props interfaces — M/L, score 2.0
- Export `type DailyForecastDay` from `data/dashboardData.ts`; replace `(day: any)` and `const result: any[]` / `const entry: any` in the four aggregate blocks in `useDashboardData.ts` — M/L, score 2.0
- Add `import type { OrbitControls as ThreeOrbitControls }` from three.js and change `useRef<any>` to `useRef<ThreeOrbitControls>` at `AQI3DScene.tsx:57` — M/L, score 2.0
- Export `interface DailyForecastDay` from `dashboardData.ts` and `interface DashboardMetrics` from `dataService.ts`; annotate return types explicitly — M/L, score 2.0

### Run #90 — 2026-05-31 — Lens: Live-time claim audit
**Scope:** Sixth live-time claim audit pass. Examined: `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-ingestion/src/purpleair.rs`, `docker-compose.yml`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/routes/nws_forecast.py`, `geointellisense-analytics/app/routes/inversion.py`, `hooks/useRealtimeAQI.ts`, `hooks/useLiveData.ts`, `components/AirQualityMapView.tsx`, `components/dashboard/widgets/AqiTrendWidget.tsx`. Cross-checked against Active Recommendations and runs #87–#89 (Latest Findings) to confirm all findings are new.

**Findings:**

- OBSERVATION: `broadcast.rs:106-110` + `routes/aqi.rs:23-25` + `AirQualityMapView.tsx:413-416` — Both the broadcast ticker (`spawn_ticker`) and the REST `/api/aqi-snapshot` handler re-stamp every cached `AqiReading` with the current server time (`Utc::now()`) on every cycle (default every 5 seconds per `docker-compose.yml:57: BROADCAST_INTERVAL_SECS:-5`). With `PURPLEAIR_INTERVAL_SECS=600` (confirmed at `docker-compose.yml:56`), sensor values can be up to 10 minutes old while carrying a `timestamp` of "just now." `AirQualityMapView.tsx:413` renders `🔴 Live` when `isConnected` and line 416 shows `lastUpdate.toLocaleTimeString()`—which reflects the SSE receive time, not the measurement time. There is no `polledAt` or `measuredAt` field to distinguish broadcast time from measurement time in any API response. Users reading "🔴 Live — 11:09 PM" perceive freshly-measured data, when the PurpleAir sensors may have last been queried at 10:59 PM. PROPOSAL: Add a `polledAt: DateTime<Utc>` field to `AqiReading` in `aqi.rs`, set at PurpleAir fetch time in `purpleair.rs` and preserved (not overwritten) in the broadcaster; surface it in the UI as "Sensor data as of HH:MM" separate from the connection timestamp — H/M, score 1.5; does not displace top 10.

- OBSERVATION: `routes/aqi.rs:64-68` + `aqi.rs:138-162` + `AqiTrendWidget.tsx:20-22` — The `/api/aqi-history` endpoint always calls `aqi::generate_history()`, which is a pure Rust random-walk simulation using `rand::thread_rng()` (`aqi.rs:139`). It never issues a database query. This is the case even when PurpleAir data is configured and TimescaleDB has been receiving real readings via `persist::write_readings` every 5 seconds. `AqiTrendWidget.tsx:20-22` calls `useLiveData('/api/aqi-history?station_id=AQ-001&hours=24', { refreshInterval: 120_000 })` and renders the result as "AQI Trend (24h)" in the dashboard. Because `generate_history` is called fresh on each request with a new random seed, every 120-second refresh produces a completely different fictional 24-hour history. The trend chart has no continuity between renders—peaks and valleys in the previous render do not exist in the next. No disclaimer or label distinguishes the simulated curve from real historical data. PROPOSAL: Replace `aqi::generate_history()` in `routes/aqi.rs:66` with an async `sqlx` query against `sensor_readings WHERE location_id = $1 AND time > now() - interval '24 hours' ORDER BY time` to return real persisted data; fall back to the generator only when the result set is empty — H/M, score 1.5; does not displace top 10.

- OBSERVATION: `context.py:267-275` — `_get_forecast_context()` derives `last_updated` for the freshness check from `periods[0]["date"]`, which is the NWS period's `startTime` — a future timestamp (e.g., "2026-06-01T06:00:00-07:00"). Since this date is in the future, `age_seconds = (now - future_date).total_seconds()` is negative. `_freshness()` checks `stale = age_seconds > interval * 2` → `(negative) > 7200` → always `False`. The NWS forecast therefore always appears as `status: "live"` in Claude's context whenever cached data is present, regardless of how long ago it was fetched. If the Redis cache expired and a fresh NWS fetch failed silently (e.g., `httpx.TimeoutException`), the context returns `periods = []` → `last_updated = None` → `"unavailable"`. The "stale but present" state (cached data exists, but it is older than the TTL suggests) is structurally impossible for the forecast source. PROPOSAL: In `_get_forecast_context()`, use `datetime.now(timezone.utc)` as `last_updated` when periods are successfully loaded from Redis (trusting Redis TTL for cache expiry rather than attempting to derive fetch time from forecast dates); set `last_updated = None` only when no cached data exists — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `context.py:23` — `SOURCE_INTERVALS["purpleair"] = 120` with inline comment "PurpleAir fetcher runs every 2 min." The actual PurpleAir poll interval is `PURPLEAIR_INTERVAL_SECS`, which defaults to 600 seconds in both `config.rs:27` and `docker-compose.yml:56`. The staleness threshold derived from this value is `120 × 2 = 240 seconds`. In the current deployment (broadcast re-stamping, Finding 1), DB readings always appear seconds old so this does not cause a false "stale" alarm at runtime. However, if timestamp re-stamping is ever corrected (so `AqiReading.timestamp` reflects actual measurement time), any PurpleAir reading between 4 and 10 minutes old would be incorrectly flagged as stale—half the normal polling window. The wrong constant also misleads developers diagnosing freshness alerts. PROPOSAL: Change `context.py:23` to `"purpleair": 600` and update the comment to "# PurpleAir fetcher default: 10 min (PURPLEAIR_INTERVAL_SECS)" — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `AirQualityMapView.tsx:404-407` + `AirQualityMapView.tsx:390-395` — The component subtitle "Live 3D WebGL Statistical Model • San Joaquin Valley" (`AirQualityMapView.tsx:406`) is rendered unconditionally regardless of connection state. When the SSE connection fails and the `fallbackToMock` path activates (after 10 failed reconnect attempts, ~50 seconds), `AirQualityMapView.tsx:390-395` correctly shows an amber banner reading "Using simulated data (server unavailable)." The subtitle directly below continues to read "Live 3D WebGL Statistical Model," creating a contradictory signal: the header declares the visualization "live" while the banner says the underlying data is simulated. A user seeing both simultaneously receives conflicting information about data authenticity. PROPOSAL: Make the subtitle conditional: `{isConnected ? 'Live 3D WebGL Statistical Model' : (realtimeError ? 'Simulated Data — Server Unavailable' : 'Connecting…')} • San Joaquin Valley` at `AirQualityMapView.tsx:406` — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Add `polledAt: DateTime<Utc>` to `AqiReading` in `aqi.rs`, preserve from PurpleAir fetch, do not overwrite in broadcaster; surface as "Sensor data as of HH:MM" distinct from SSE connection timestamp in `AirQualityMapView.tsx` — H/M, score 1.5
- Replace `aqi::generate_history()` in `routes/aqi.rs:66` with a real TimescaleDB query against `sensor_readings`; fall back to generator only when DB result is empty — H/M, score 1.5
- Fix `_get_forecast_context()` in `context.py:267-275` to use `datetime.now(timezone.utc)` as `last_updated` when cached periods exist, enabling accurate forecast staleness detection — M/L, score 2.0
- Update `SOURCE_INTERVALS["purpleair"]` in `context.py:23` from 120 to 600 and fix the comment — L/L, score 1.0
- Make the subtitle in `AirQualityMapView.tsx:406` conditional on `isConnected` to resolve the live/simulated contradiction — L/L, score 1.0

## 📚 Archive (one line per past run)
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
