# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-31T10:07:19Z
Last run: #77 — Lens: Module boundaries

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
### Run #77 — 2026-05-31 — Lens: Module boundaries
**Scope:** Sixth module-boundary pass. Examined all `.ts`/`.tsx` import graphs (`grep -rn "from '.*" --include="*.ts" --include="*.tsx"`), Python analytics `app/claude.py`, `app/context.py`, all `app/routes/*.py` imports, `app/ml/aqi_model.py`. Verified each finding as new via file:line specificity distinct from archived runs #2, #17, #32, #47, #62.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` — `import type { CityData } from '../components/3d/CityMarkers'` — The hook imports a domain model type directly from a leaf 3D renderer component. `CityData` (defined at `components/3d/CityMarkers.tsx:20-30`) is a pure data shape: `{ id, name, lat, lng, aqi, temperature?, humidity?, windSpeed?, pm25? }` — it has no rendering logic and no dependency on Three.js or `@react-three/fiber`. The conventional module-layer hierarchy is: `utils/types` → `hooks` → `components`. This import goes `hooks` → `components/3d`, inverting the expected direction. `RealtimeCityData` at `hooks/useRealtimeAQI.ts:15` extends `CityData`, making the hook's exported type permanently coupled to the 3D component's internal type definition. If `CityMarkers.tsx` is refactored (e.g., adding a `pmTen?: number` field to `CityData` for PM10 display) without updating `useRealtimeAQI.ts`, the hook inherits the change silently. Conversely, the hook cannot add fields to `CityData` without touching the component. The `components/3d/index.ts:16` barrel does re-export `CityData` (`export type { CityMarkersProps, CityData } from './CityMarkers'`), but the hook bypasses the barrel and imports from the leaf file directly. PROPOSAL: Move `CityData` to `types.ts` (which currently contains `GroundingChunk` and other shared types); update `components/3d/CityMarkers.tsx` to import it from `types.ts`; update `hooks/useRealtimeAQI.ts` to import from `types.ts`. The barrel `components/3d/index.ts:16` re-export can be removed or kept as a type alias — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `components/AirQualityMapView.tsx:35` — `import type { LayerSettings, TimeSettings, MetricsData } from './3d'` (which re-exports from `components/3d/UIPanels.tsx:13-46`). `AirQualityMapView` is the parent 2D/3D hybrid map container; `UIPanels` is a leaf 3D UI widget that renders overlay controls and the AQI legend. The three types define the *state contract* between `AirQualityMapView` and its child `UIPanels`: `LayerSettings` (which 3D layers are shown, lines 13-22), `TimeSettings` (animation playback state, lines 23-32), `MetricsData` (current stats for the metrics panel, lines 33-46). Having a parent (`AirQualityMapView.tsx`) derive its state shape from a child (`UIPanels.tsx`) inverts the normal contract direction. In practice: `AirQualityMapView.tsx:219` initializes `useState<LayerSettings>({...})` with field names that must match `UIPanels.tsx:55`'s `layerOptions` array — if a new layer toggle (e.g., `pollen: boolean`) is added to `LayerSettings` in `UIPanels.tsx`, `AirQualityMapView.tsx`'s `useState` initializer and its `handleLayerChange` callback at line 328 must also be updated, but TypeScript will not emit a structural error until the component is used somewhere that passes the new field — because `LayerSettings` is an interface and the spread initializer `{ ...prev, [layer]: enabled }` at line 329 is typed as `LayerSettings`. The three interfaces belong in `types.ts`; `UIPanels.tsx` should import them from there. PROPOSAL: Move `LayerSettings`, `TimeSettings`, `MetricsData` from `components/3d/UIPanels.tsx:13-46` to `types.ts`; update `components/3d/UIPanels.tsx` and `components/AirQualityMapView.tsx` to import from `types.ts`; update the barrel `components/3d/index.ts:28` to re-export from `types.ts` for backward compat — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `app/claude.py:103,116` and `app/context.py:323,471` — Four deferred in-function-body imports from HTTP route handlers, indicating circular dependency workarounds that violate the application's layering contract: (a) `claude.py:103`: `from app.routes.fires import get_current_smoke_context` inside `get_system_with_live_context()` fallback branch; (b) `claude.py:116`: same import inside `get_system_with_fire_context()` sync fallback; (c) `context.py:323`: same import inside `_get_fire_context()` — the function that builds fire context for the AI system prompt; (d) `context.py:471`: `from app.routes.inversion import get_current_inversion` inside `_get_inversion_context()`. The canonical layer order is: `routes` (HTTP handlers, top) → `context`/`claude` (AI orchestration, middle) → `database`/`cache`/`clients` (infrastructure, bottom). These deferred imports go from middle to top, which would create a circular dependency if they were at module scope: `routes/fires.py` imports from `claude.py` (for `SJV_SYSTEM` and `execute_tool`) and `routes/inversion.py` imports nothing from `claude.py` — so the full circular dep is `context.py` ↔ `routes/fires.py`. The root cause: `_smoke_context: str = ""` (line 22 of `fires.py`) and the equivalent `_current_inversion_data` module-level state in `inversion.py` are the actual values needed — not the route module itself. PROPOSAL: Create `app/polling_state.py` with two module-level stores: `_smoke_context: str = ""` and `_inversion_data: dict | None = None`, plus getter/setter functions (`get_smoke_context()`, `set_smoke_context()`, `get_inversion_data()`, `set_inversion_data()`). Update `routes/fires.py` to import `set_smoke_context` from `polling_state.py` instead of maintaining `_smoke_context` locally; update `routes/inversion.py` similarly. Update `claude.py` and `context.py` to import from `polling_state.py` rather than from the route modules. This breaks the circular dependency without any functional change — M/M, score 1.0; does not displace top 10.

- OBSERVATION: `services/dataService.ts` imports `dashboardData` and `cityLocations` from `data/dashboardData` twice — once statically at the top of the file (line 4: `import { dashboardData, cityLocations } from '../data/dashboardData'`) and once dynamically inside the `getLocations()` method (line 274: `const { dashboardData, cityLocations } = await import('../data/dashboardData')`). Both resolve to the same ES module singleton at runtime (Vite/Rollup caches module instances), so `getLocations()` always receives the same object that was already imported at line 4. The dynamic import at line 274 adds a `Promise` microtask per call for no benefit — it does not enable code splitting because `getLocations()` is called from `getDashboardMetrics()` at line 298, which is itself called synchronously within the service. The comment on line 4 (`// Keep for fallback`) suggests the static import was retained after the dynamic import was added as a supposed lazy-load, but the intent was never fully resolved. PROPOSAL: Remove the dynamic `import()` call inside `getLocations()` at line 274 and use the statically-imported `dashboardData` and `cityLocations` directly, as is already done in `getHistoricalAQIFallback()` at line 325 and `getHistoricalWeatherFallback()`. Remove the `// Keep for fallback` comment from line 4 — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `hooks/useViewport.ts:28-36` — `export const ZOOM_THRESHOLDS: Record<string, number>` is a pure configuration constant (`{ fires: 3, earthquakes: 3, aqi: 6, water: 6, wells: 9, waterQuality: 9, enviroscreen: 8 }`) with no dependency on React state, refs, or effects. It is co-located in a hook file whose primary responsibility is the reactive viewport state hook (`useViewport`). `MapView.tsx:14` imports it alongside the hook (`import { useViewport, ZOOM_THRESHOLDS } from '../hooks/useViewport'`). Configuration constants exported from hook files leak implementation details: a developer maintaining zoom threshold values must open and edit a React hook file, which is not where they would expect to find layer-level map configuration. Additionally, if a future test needs to verify zoom threshold gating logic without rendering a map component, it must import from the hook file — which pulls in the React import at line 7 as a side effect (though `useState`/`useCallback`/`useRef` are tree-shaken in production, they add to test setup). PROPOSAL: Move `ZOOM_THRESHOLDS` to `utils/mapConfig.ts` (create if it does not exist; candidate for co-location with the `SAN_JOAQUIN_BOUNDS` constant currently in `utils/geo3d.ts:15-20`). Update `hooks/useViewport.ts` and `components/MapView.tsx:14` to import from `utils/mapConfig.ts` — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Move `CityData` from `components/3d/CityMarkers.tsx:20` to `types.ts`; update hook and barrel imports — M/L, score 2.0; does not displace top 10
- Move `LayerSettings`, `TimeSettings`, `MetricsData` from `components/3d/UIPanels.tsx:13-46` to `types.ts` — M/L, score 2.0; does not displace top 10
- Create `app/polling_state.py`; extract `_smoke_context` and `_inversion_data` from route files; remove deferred imports from `claude.py` and `context.py` — M/M, score 1.0; does not displace top 10
- Remove dynamic `import()` inside `dataService.ts:274`; use static import already at line 4 — L/L, score 1.0; does not displace top 10
- Move `ZOOM_THRESHOLDS` from `hooks/useViewport.ts:28` to `utils/mapConfig.ts` — L/L, score 1.0; does not displace top 10

### Run #76 — 2026-05-31 — Lens: Type safety
**Scope:** Sixth type-safety pass. Examined: `tsconfig.json`, all `.ts`/`.tsx` files outside `node_modules`. Focused searches: `grep ": any"`, `grep "as any"`, `grep "useRef<any>"`, `grep "Record<string, any>"`, `grep "JSON.parse"`. Verified all findings as new vs. prior type-safety runs #1, #16, #31, #46, #61 (archived; full detail not available in this window).

**Findings:**

- OBSERVATION: `tsconfig.json` — The project's compiler options include no strictness flags. `"strict": true` is absent, as are the six individual flags it enables (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`). Without `noImplicitAny`, the `data: any[]` props in chart components and `(day: any)` casts in `useDashboardData.ts` are accepted silently rather than flagged as errors. Without `strictNullChecks`, the null-checks guarding `controlsRef.current` and `mapInstanceRef.current` do not receive exhaustiveness enforcement. The only strictness-adjacent option present is `"isolatedModules": true`, which enforces per-file transpilation but provides no type-soundness guarantees. The practical consequence is that TypeScript operates as a documentation tool rather than a correctness enforcer: callers can pass wrong shapes to typed functions and the compiler will not catch it. PROPOSAL: Add `"strict": true` to `tsconfig.json`'s `compilerOptions`. Then run `tsc --noEmit` to enumerate the resulting errors; the highest-density files to fix will be `hooks/useDashboardData.ts` (13 `any` usages at lines 179, 197, 199, 223, 241, 243, 267, 285, 287, 311, 330, 332) and the four chart component prop interfaces — H/M, score 1.5; does not displace top 10.

- OBSERVATION: `data/dashboardData.ts:195-334` — `generateDailyForecast(location: string, days: number)` has no explicit return type annotation. TypeScript infers the return type from the deeply-nested object literal pushed at lines 297-331: a complex structural anonymous type with nested objects `temp: { current, min, max, feelsLike }`, `wind: { speed, gust, direction }`, `precipitation: { probability, amount, type }`, and a 24-element `hourlyData` array. At consumer sites `useDashboardData.ts:179`, 223, 267, 311, accessing the elements of `locEntry.dailyForecast` requires the cast `(day: any)` because TypeScript cannot match the inferred structural type against the `locEntry` union type's `dailyForecast` member in its inference context. With `day` typed as `any`, accesses like `day.wind.speed` (line 239), `day.humidity` (line 204), `day.uv` (line 288), and `day.evapotranspiration` (line 307) are never type-checked. If `generateDailyForecast` were refactored to rename `wind` to `windData` or `evapotranspiration` to `et0` for brevity, all four consumer call sites would silently begin returning `undefined` at runtime with no TypeScript error. PROPOSAL: (a) Define an explicit `DailyForecast` interface in `data/dashboardData.ts` mirroring the object shape at lines 297-331; (b) annotate `generateDailyForecast` with `: DailyForecast[]` as its return type; (c) remove all four `(day: any)` casts in `useDashboardData.ts` — TypeScript will then verify `.wind.speed`, `.humidity`, `.uv`, `.evapotranspiration` at compile time — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `components/charts/AQITrendChart.tsx:15`, `PM25TrendChart.tsx:15`, `WeatherForecastChart.tsx:14`, `TemperaturePrecipitationChart.tsx:15` — All four chart components declare `data: any[]` in their props interfaces. The actual runtime data flowing in is produced by the `mergedHistoricalAqi`, `mergedHistoricalPm25`, `mergedHistoricalWeather`, and `mergedForecastData` computations in `Dashboard.tsx` and `useDashboardData.ts` — each of which is a `Record<string, string | number | undefined>` where the string key is a location name or a `locationName_metric` composite. With `data: any[]`, recharts `dataKey` props such as `dataKey={loc}` (e.g., `AQITrendChart.tsx:40`) and `dataKey={\`${loc}_temp\`}` (e.g., `TemperaturePrecipitationChart.tsx`) are unchecked — a refactor that changes the key naming convention would produce silently empty chart lines. Additionally, `AccessibleChart.tsx:79` and `AccessibleChart.tsx:165` define the same pattern as `data: Record<string, any>[]`. PROPOSAL: Define a shared `ChartDataPoint = Record<string, string | number | undefined>` type alias in `components/charts/index.ts`; replace `data: any[]` with `data: ChartDataPoint[]` in all four chart component interfaces and in `AccessibleChart.tsx:79,165` — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `const controlsRef = useRef<any>(null)`. At line 66, `controlsRef.current.getTarget(target)` is called inside `useFrame` with the guard `if (controlsRef.current && onCameraMove)`. With `useRef<any>`, TypeScript performs no method-existence check on `getTarget` — the `@react-three/drei` `OrbitControls` component wraps `three-stdlib`'s `OrbitControlsImpl` class, and `getTarget` is a valid method on that class. However, if a future drei upgrade renames `getTarget` to `getAzimuthalAngle` or removes it, the null guard at line 66 does not prevent a runtime `TypeError`. Additionally, the `useRef<any>` declaration means the ref's `.current` property is typed `any` throughout the component — including the `controlsRef.current.enableDamping` and similar property accesses that could be added in future maintenance without compiler feedback. The `@react-three/drei` package and `three-stdlib` are both present in `package.json`. PROPOSAL: `import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'`; change `useRef<any>(null)` to `useRef<OrbitControlsImpl | null>(null)` — the `null` union is required because the ref is initialized as `null` — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `contexts/UserPreferencesContext.tsx:139` and `contexts/UserPreferencesContext.tsx:290` — Both `JSON.parse(stored)` at line 139 and `JSON.parse(json)` at line 290 return `any`. Both values are immediately spread into objects with explicit `UserPreferences` type annotations at lines 141-148 and 292-298 respectively. TypeScript accepts the spread without complaint because spreading an `any` value is always valid. The deep merge at lines 141-148 (`{ ...defaultPreferences, ...parsed, dataSettings: { ...defaultDataSettings, ...parsed.dataSettings }, ... }`) silently accepts any value for `parsed.dataSettings` — if the stored value has `dataSettings: null` (possible from a buggy prior serialization), the spread `...null` throws a `TypeError` at runtime. The same risk exists at `UserPreferencesContext.tsx:295`: `dataSettings: { ...defaultDataSettings, ...imported.dataSettings }`. The `importPreferences` function at lines 288-306 does catch the thrown error and returns `false`, but the `localStorage` initialization path at lines 136-154 does not wrap the spread in a try-catch — it wraps `JSON.parse` but not the subsequent spread. PROPOSAL: (a) Type `JSON.parse` results as `unknown` via `const parsed = JSON.parse(stored) as unknown`; (b) add a guard `if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid preferences format')` before the spread; (c) narrow each nested field similarly (`parsed.dataSettings` should be checked as object-or-undefined before spreading) — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Add `"strict": true` to `tsconfig.json`; enumerate and fix resulting errors in `useDashboardData.ts` and chart components — H/M, score 1.5; does not displace top 10
- Define `DailyForecast` interface in `data/dashboardData.ts:195`; annotate return type; remove `(day: any)` casts in `useDashboardData.ts:179,223,267,311` — M/L, score 2.0; does not displace top 10
- Replace `data: any[]` with `ChartDataPoint[]` in four chart components and `AccessibleChart.tsx` — L/L, score 1.0; does not displace top 10
- Replace `useRef<any>` with `useRef<OrbitControlsImpl | null>` at `AQI3DScene.tsx:57` — L/L, score 1.0; does not displace top 10
- Type `JSON.parse` as `unknown`; guard spread of nested preference sub-objects in `UserPreferencesContext.tsx:139,290` — M/L, score 2.0; does not displace top 10

### Run #75 — 2026-05-31 — Lens: Live-time claim audit
**Scope:** Fifth live-time claim audit pass. Examined: `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-analytics/app/context.py`, `components/AirQualityMapView.tsx`, `hooks/useRealtimeAQI.ts`, `index.html`. All findings verified as new via file:line specificity distinct from prior live-time runs #15, #30, #45, #60.

**Findings:**

- OBSERVATION: `context.py:19-20` vs `config.rs:25-27` — `context.py` declares `"purpleair": 120` as the expected PurpleAir update interval (seconds) used by `_freshness()` at `context.py:40-48` to decide whether data is "live" or "stale" (`stale = age_seconds > interval * 2`). This sets the staleness threshold at 240 seconds (4 minutes). However, `config.rs:25-27` sets `purpleair_interval_secs` with default `600` (10 minutes), documented in the comment `// 10 min default — PurpleAir free tier is 1000 pts/day`. The result: `build_context_text()` can inject data labeled `status: "live"` into Claude's system prompt when the underlying PurpleAir measurement is up to 599 seconds (nearly 10 minutes) old. Claude's analysis will assert current AQI values with confidence ("Current AQI at Fresno is 87") based on data that may be from the prior polling cycle. There is no synchronization between the Python side's freshness model and the Rust side's actual polling cadence — each evolved independently. PROPOSAL: Align the two sides: either update `context.py:20` to `"purpleair": 600` to match the Rust default, or add a `PURPLEAIR_INTERVAL_SECS` env var read to `context.py` so both services share the same configuration value. As a belt-and-suspenders check, stamp each `sensor_readings` row at ingestion write time (which already happens via `persist.rs`) and compute data age from the DB `time` column directly in `_get_aqi_context()` rather than inferring it from the polling interval.

- OBSERVATION: `broadcast.rs:104-109` — The broadcast tick spawned at `broadcast.rs:97-130` fires every `broadcast_interval_secs` (default 5 seconds). On each tick, it reads the cached PurpleAir readings and creates a new `Vec<AqiReading>` via `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()` where `now = chrono::Utc::now()` at tick time. This overwrites `r.timestamp` — which was set to the time of the last successful PurpleAir API call — with the current wall-clock time. The SSE `aqi-update` event therefore carries `timestamp` values that are always ≤5 seconds old, regardless of measurement age. `useRealtimeAQI.ts:308-323` parses `r.timestamp` as the reading timestamp and populates `RealtimeCityData.timestamp` and `RealtimeStats.timestamp` from it. The UI renders the stats timestamp as "last updated N seconds ago" — showing values like "last updated 2 seconds ago" for measurements that are actually 0–599 seconds stale. The `AirQualityMapView.tsx:413-416` status bar shows `isConnected ? '🔴 Live' : 'Last Updated'` next to `lastUpdate.toLocaleTimeString()` — which is the React state update time, not the measurement time. Users believe they are seeing sensor data from the last few seconds; in reality the measurements can be up to 10 minutes old. PROPOSAL: Stop overwriting `timestamp` in the broadcast tick; preserve the original `r.timestamp` from the PurpleAir fetch. In `broadcast.rs:104-109`, change the mapping to emit `r.clone()` directly (no field override). Separately, add a `broadcastedAt` field to the SSE payload if the broadcast-wall-clock time is needed. On the frontend, display both `reading.timestamp` (measurement time) and `lastUpdate` (SSE receive time) in the status bar so users can distinguish data age from connection recency.

- OBSERVATION: `geointellisense-ingestion/src/routes/aqi.rs:history()` (the `/api/aqi-history` endpoint registered at `mod.rs:16`) calls `aqi::generate_history(&params.station_id, hours)` — defined at `aqi.rs:138-162` — which generates a synthetic random-walk AQI time series: `aqi_walk += rng.gen_range(-5.0..5.0)`, one point every 5 minutes, clamped to 5–400 AQI. There is no `SELECT` from `sensor_readings` or any other DB table. The analytics service does have `historical_aqi.py:28-60` which queries the real DB (`sensor_readings` joined to `locations`), but the ingestion service's `/api/aqi-history` route is a completely separate endpoint that returns fabricated data. The two "history" endpoints are siloed: `useRealtimeAQI.ts:62` exposes `getDataAtTime` which uses the in-memory `history` buffer (SSE snapshots), not the `/api/aqi-history` REST endpoint. However, any client or developer calling `GET http://ingestion-host:3001/api/aqi-history` receives convincing-looking time-series JSON with station names ("Fresno-Garland"), 5-minute intervals, and a 24-hour span — all synthetic. An operator debugging AQI trends would receive misleading data from this endpoint. PROPOSAL: Replace `aqi::generate_history()` with a DB query: `SELECT time, aqi, pm25 FROM sensor_readings WHERE location_id = $1 AND time > now() - interval '<hours> hours' ORDER BY time` — using the station UUID derived from the station name. If the DB has insufficient data (recent install, first run), return an empty array with a `{"dataSource": "none", "reason": "insufficient_history"}` field rather than fabricated data.

- OBSERVATION: `purpleair.rs:117-118` — When live PurpleAir data is fetched by `PurpleAirClient::fetch_readings()`, the resulting `AqiReading` structs have `wind_speed: 0.0` and `wind_direction: 0.0` because the PurpleAir V1 API fields list at `purpleair.rs:16` (`"name,latitude,longitude,pm2.5,pm10.0,ozone1,humidity,temperature,pressure"`) does not include wind parameters. These zero-value readings are broadcast via SSE and parsed by `useRealtimeAQI.ts:316-318` into `RealtimeCityData.windSpeed` and `RealtimeCityData.windDirection`. `AirQualityMapView.tsx:279-281` uses `realtimeWindData` (from SSE) when `useRealtimeData && realtimeWindData.length > 0` is true — which is always true when the SSE connection is live. The result: when PurpleAir data IS available (the "real" mode), all wind arrows on the map point at 0° (due north) at 0 m/s. When the server falls back to mock data (no PURPLEAIR_API_KEY), the mock `generate_readings()` at `aqi.rs:127-129` produces `wind_speed: round2(rng.gen_range(0.0..25.0))` and `wind_direction: round2(rng.gen_range(0.0..360.0))` — so wind arrows are only animated and realistic-looking when the data is fabricated. The UI renders the wind arrows in both modes identically with no disclaimer that wind data is unavailable in live mode. PROPOSAL: (a) Add NWS gridpoint wind data to the analytics weather route and inject it into the SSE broadcast as a separate `wind-update` SSE event type, or (b) when `wind_speed == 0.0 && wind_direction == 0.0` in the received readings, fall back to the `generateWindData(new Date())` function already defined at `AirQualityMapView.tsx:66-67` — using simulated NWS-informed wind rather than the zero-value PurpleAir data. Add a tooltip on wind arrows clarifying the data source.

- OBSERVATION: `AirQualityMapView.tsx:176-178` — The city detail popup tooltip renders the hard-coded string `"Real-time data from EPA monitoring station. Interpolation model uses IDW and Kriging algorithms."` This text is static for every city regardless of actual data source. The actual data source in live mode is PurpleAir consumer sensors (branded `source: "purpleair"` at `aqi.rs:120`) — not EPA FEM (Federal Equivalent Method) reference monitors. PurpleAir PA-II sensors are consumer-grade optical particle counters; they are not EPA-certified, not used for regulatory determinations, and require application of a correction factor (the EPA recommends the US-wide correction factor CF = 0.52 × PA + 2.966 for PM2.5) before comparison to regulatory thresholds. In mock mode (no API key), `aqi.rs:131` tags readings `source: "mock"`. Neither case involves an EPA monitoring station. Stating "EPA monitoring station" is a false data provenance claim that could cause users to believe the readings carry regulatory standing they do not have. This is material misinformation in a health-context application. PROPOSAL: Replace the hard-coded string with a dynamic attribution: read the `source` field from the city reading (already present in `RealtimeCityData` as typed at `useRealtimeAQI.ts:15-21`) and render `source === "purpleair" ? "PurpleAir sensor network (consumer-grade, EPA correction applied)" : source === "mock" ? "Simulated data (server unavailable)" : "EPA AirNow monitor"`. Also confirm and apply the EPA PM2.5 correction factor before displaying AQI values derived from PurpleAir PM2.5 readings.

**Proposed actions:**
- Align `context.py:20` `"purpleair"` interval to match `config.rs:27` default (600s), or share via env var — M/L, score 2.0; does not displace top 10
- Remove `timestamp: now` override in `broadcast.rs:107`; preserve original measurement timestamp; add `broadcastedAt` field — M/L, score 2.0; does not displace top 10
- Replace `aqi::generate_history()` with real DB query in `geointellisense-ingestion/src/routes/aqi.rs:history()` — M/M, score 1.0; does not displace top 10
- Fall back to `generateWindData()` when `wind_speed == 0` in SSE readings; add tooltip disclosing wind source — L/L, score 1.0; does not displace top 10
- Replace hard-coded "EPA monitoring station" at `AirQualityMapView.tsx:177` with dynamic source attribution from `city.source` field — H/L, score 3.0; ties top 10 but first seen run #75, does not displace existing

## 📚 Archive (one line per past run)
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
