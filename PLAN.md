# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T02:10:00Z
Last run: #93 — Lens: Dependency health

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
### Run #93 — 2026-06-01 — Lens: Dependency health
**Scope:** Seventh dependency health pass. Examined: `package.json`, `package-lock.json`, `vite.config.ts`, `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-ingestion/Cargo.lock`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/Dockerfile`. Cross-checked against Active Recommendations and runs #91–#92 (Latest Findings) plus archived dependency health runs #3, #18, #33, #48, #63, #78 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `package.json:19` — `"@types/three": "^0.181.0"` is listed under `dependencies` rather than `devDependencies`. Type declaration packages in the `@types/*` namespace contain zero runtime code — they exist solely to supply TypeScript type information at compile time. Including a type-only package in `dependencies` means it is listed as a production runtime requirement. In a Docker multi-stage build or any toolchain that prunes `devDependencies` for the production image, the package would be incorrectly included in the production artefact and installed when the project is used as a library dependency. Every other `@types/*` package in this project — `@types/google.maps` (`package.json:32`), `@types/node` (`package.json:33`), `@types/react` (`package.json:34`), `@types/react-dom` (`package.json:35`) — is correctly placed in `devDependencies`. `@types/three` is the sole outlier. The lockfile (`package-lock.json`) does not mark its entry with `"dev": true` (confirmed by scanning all `"dev": true` entries), while the other `@types/*` entries all carry `"dev": true`. PROPOSAL: Move `"@types/three": "^0.181.0"` from `dependencies` to `devDependencies` in `package.json:19` — consistent with all other `@types/*` packages in the project — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `package.json:16` — `"@googlemaps/markerclusterer": "latest"` uses npm's dist-tag `"latest"` as its version specifier, resolved to `2.6.2` in the current `package-lock.json`. Every other production dependency uses explicit semver ranges (`^` or `~`). The `"latest"` tag is not a version constraint — it is a mutable pointer that resolves to whatever is currently tagged `latest` on npm. If the package publishes a breaking major version (e.g., `3.0.0`) and tags it `latest`, any operation that regenerates or updates the lockfile (`npm install --package-lock-only`, `npm update`, Dependabot PRs, or a fresh CI clone without a committed lockfile) will silently install the breaking version. In contrast, `"^2.6.2"` would prevent installation of `3.x.x`. This is the only dependency in the project with a floating dist-tag specifier. PROPOSAL: Replace `"latest"` with `"^2.6.2"` for `@googlemaps/markerclusterer` at `package.json:16`; review all other dependencies for similar floating specifiers before each release — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/Cargo.toml:21` — `rand = "0.8"`, resolved to `0.8.5` in `Cargo.lock`. The `rand` crate published `0.9.0` (breaking release) in January 2025, with the following API removals relevant to this codebase: `thread_rng()` was removed (replaced by `rng()`), `Rng::gen::<T>()` renamed to `Rng::random::<T>()`, and `Rng::gen_range()` renamed to `Rng::random_range()`. The project uses `rand` exclusively in `aqi.rs` to simulate fake AQI history (the `generate_history()` function called from `routes/aqi.rs:66`, confirmed in run #90's finding 2). Because Cargo's semver resolution respects the `"0.8"` constraint, `cargo update` will never advance past `0.8.5` automatically. This creates a widening migration gap: as other crates in the dependency tree (e.g., future `sqlx` or `axum` releases) adopt `rand 0.9` transitive dependencies, the project may end up with two incompatible versions of `rand` in the tree. Additionally, since `generate_history()` is acknowledged as simulation-only and run #90 proposed replacing it with a real TimescaleDB query, the `rand` dependency should be a candidate for complete removal. PROPOSAL: Track `rand` for removal once the real DB query path in `routes/aqi.rs:66` is implemented (see run #90 Active Recommendations item); if retaining the fallback path, migrate `aqi.rs` from `rand 0.8` API (`thread_rng()`, `gen_range()`) to `rand 0.9` API (`rng()`, `random_range()`) and update `Cargo.toml:21` to `rand = "0.9"` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/requirements.txt:18` — `joblib>=1.4,<1.5`. joblib 1.5.0 was released, making the `<1.5` upper bound exclusive of the entire 1.5.x series. On a fresh Docker build (`FROM python:3.12-slim`; `RUN pip install --no-cache-dir -r requirements.txt`), pip resolves the latest compatible versions of all packages simultaneously. If `scikit-learn` (`requirements.txt:17`: `scikit-learn>=1.5,<1.7`) in its 1.6.x releases updated its own minimum joblib requirement to `>=1.5`, pip would find no satisfying `joblib` version and would fail the build with `ERROR: Cannot install because these package versions have conflicting dependencies`. The constraint also conflicts logically with `scikit-learn>=1.5,<1.7` — scikit-learn 1.6.x ships with joblib as a runtime dependency, and its released distributions may hard-require joblib 1.5.x. All other Python packages in the file use either a lower-bounded-only range (`>=`) or a wide upper bound. `joblib` is the only package with a tight exclusive upper bound at a released version boundary. PROPOSAL: Change `joblib>=1.4,<1.5` to `joblib>=1.4,<2` in `requirements.txt:18`; run `pip install -r requirements.txt` in a fresh environment to confirm resolution before merging — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `vite.config.ts:21,33` — The `manualChunks` configuration at lines 21–28 explicitly creates a `three-vendor` chunk containing `three`, `@react-three/fiber`, and `@react-three/drei`, with the inline comment `// Split Three.js + React Three Fiber into its own chunk (~800KB)`. The `chunkSizeWarningLimit` at line 33 is set to `500` (KB). Vite emits a build warning for every output chunk exceeding this limit. The `three-vendor` chunk is knowingly ~800KB (roughly 1.6× the configured limit), meaning every production build (`npm run build`) produces a spurious warning: `(!) Some chunks are larger than 500 kB after minification`. This warning cannot be eliminated without removing Three.js from the project. By surfacing on every build, it trains developers to ignore Vite's chunk-size warnings, which defeats the purpose of the warning mechanism — a genuinely oversized new chunk added later would be lost in the noise. The warning limit should be set at or above the maximum expected chunk size. PROPOSAL: Raise `chunkSizeWarningLimit` from `500` to `1000` in `vite.config.ts:33` and add a comment referencing the `three-vendor` chunk as the reason for the raised limit; this keeps the mechanism meaningful for unexpected growth in other chunks — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Move `"@types/three"` from `dependencies` to `devDependencies` in `package.json:19` — L/L, score 1.0
- Replace `"latest"` with `"^2.6.2"` for `@googlemaps/markerclusterer` at `package.json:16` — L/L, score 1.0
- Plan `rand` crate removal from `Cargo.toml:21` contingent on implementing real DB query in `routes/aqi.rs:66`; if retaining fallback, migrate to `rand 0.9` API — M/L, score 2.0
- Change `joblib>=1.4,<1.5` to `joblib>=1.4,<2` in `requirements.txt:18` — M/L, score 2.0
- Raise `chunkSizeWarningLimit` from `500` to `1000` in `vite.config.ts:33`; add comment explaining the Three.js chunk exemption — L/L, score 1.0

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

## 📚 Archive (one line per past run)
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
