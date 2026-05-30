# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T18:08:06Z
Last run: #62 — Lens: Module boundaries

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
### Run #62 — 2026-05-30 — Lens: Module boundaries
**Scope:** Fifth module-boundaries pass. Examined: `hooks/useRealtimeAQI.ts`, `components/3d/CityMarkers.tsx`, `components/3d/index.ts`, `components/3d/AQI3DScene.tsx`, `data/dashboardData.ts`, `types.ts`, `contexts/UserPreferencesContext.tsx`, `hooks/useDashboardData.ts`, `components/Dashboard.tsx`, `components/dashboard/LocationSelector.tsx`, `components/AirQualityMapView.tsx`, `components/AnalysisView.tsx`, `components/CalendarView.tsx`, `services/dataService.ts`, `components/charts/index.ts`, `components/charts/*.tsx`. Prior module-boundary details (#2, #17, #32, #47) archived; all findings verified as new via specificity of file:line citations.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8,15` — `useRealtimeAQI` imports `type { CityData } from '../components/3d/CityMarkers'` and declares `export interface RealtimeCityData extends CityData`. This is a layer inversion: hooks (data/logic layer) should not import from components (presentation layer). The correct dependency arrow is components → hooks → services/utils, not hooks → components. `CityData` itself is a pure data shape (`id: string; name: string; lat: number; lng: number; aqi: number; temperature?: number; humidity?: number; windSpeed?: number; pm25?: number;`) with no Three.js or rendering concerns — it belongs in `types.ts`. As a downstream consequence, `AirQualityMapView.tsx:30` imports `CityData` from the 3D barrel (`./3d`) rather than a shared type source, giving the same domain type two different nominal import paths depending on which layer the consumer lives in. Any future consumer of `useRealtimeAQI` that does not use the 3D scene transitively loads the `CityMarkers` module. PROPOSAL: Move `CityData` declaration from `components/3d/CityMarkers.tsx:20-30` to `types.ts`; update imports in `hooks/useRealtimeAQI.ts:8`, `components/3d/CityMarkers.tsx`, `components/AirQualityMapView.tsx:30`, and `components/3d/index.ts:16`.

- OBSERVATION: `data/dashboardData.ts:338` — `LocationKey` is declared as `export type LocationKey = keyof typeof dashboardData`, a type derived as a side-effect of the mock data object's keys. This type is consumed by 8 non-data-layer files: `contexts/UserPreferencesContext.tsx:2`, `hooks/useDashboardData.ts:2`, `components/Dashboard.tsx:14`, `components/dashboard/LocationSelector.tsx:2`, `components/AirQualityMapView.tsx:8`, `components/AnalysisView.tsx:32`, `components/CalendarView.tsx:7`, and `services/dataService.ts:4`. Coupling the domain type for "which cities exist" to the mock data file's runtime object means: (a) adding a new city requires touching `dashboardData.ts`; (b) migrating to a live `/api/locations` endpoint would require updating the type declaration and all 8 import sites simultaneously; (c) `types.ts` exists as the central type file but does not contain this core domain type. PROPOSAL: Declare `export type LocationKey = 'Fresno' | 'Bakersfield' | 'Visalia' | 'Hanford' | 'Modesto' | 'Stockton' | 'Valley Average';` explicitly in `types.ts`; change `dashboardData.ts:338` to constrain the data object to `Record<LocationKey, ...>`; update all 8 import sites.

- OBSERVATION: `components/3d/index.ts:6-7` — The `components/3d` barrel publicly re-exports `SceneContext`, `useSceneContext`, and `SceneContextValue` from `AQI3DScene.tsx`. A codebase-wide grep finds that no file outside `components/3d/` imports `useSceneContext` or `SceneContext`. These are internal implementation details of the parent-child scene context pattern: `AQI3DScene.tsx:262-294` provides the context; child 3D components consume it via `useSceneContext` imported directly from `./AQI3DScene`. Exposing them in the barrel's public surface creates a misleading API — callers of the `components/3d` module can attempt to consume or provide `SceneContext` themselves, which would throw `'useSceneContext must be used within AQI3DScene'` at runtime with no compile-time guard. PROPOSAL: Remove `SceneContext`, `useSceneContext`, and `SceneContextValue` from the export list in `components/3d/index.ts:6-7`; retain only `AQI3DScene` and `AQI3DSceneProps` from that file's exports.

- OBSERVATION: `components/Dashboard.tsx:2-4` — `Dashboard.tsx` imports 12 recharts primitives (`BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`, `LineChart`, `Line`, `ReferenceLine`, `ComposedChart`) directly from `recharts`. The project has a `components/charts/` abstraction barrel (`components/charts/index.ts`) wrapping four domain chart types (`AQITrendChart`, `PM25TrendChart`, `WeatherForecastChart`, `TemperaturePrecipitationChart`). However, the comparison bar chart and historical composed chart in `Dashboard.tsx` are not wrapped; `components/AnalysisView.tsx:15` and `components/CalendarView.tsx:6` also import recharts directly. This makes recharts a visible, leaky dependency of 4 component files — replacing it (e.g., with Nivo or Visx) requires touching each file individually. The `components/charts/` abstraction is half-implemented. PROPOSAL: Add `ComparisonBarChart` and `HistoricalComposedChart` wrapper components under `components/charts/`; export them from `components/charts/index.ts`; replace direct recharts imports in `Dashboard.tsx:2-4`, `AnalysisView.tsx:15`, and `CalendarView.tsx:6`.

- OBSERVATION: `services/dataService.ts:4` — `dataService.ts` contains `import { dashboardData, cityLocations } from '../data/dashboardData'; // Keep for fallback`. A service module's role is to abstract data fetching from backend APIs; importing the mock data implementation directly embeds the fallback strategy as a side-effect of top-level module evaluation. `dashboardData` is a 338+ line in-memory object that is bundled and eagerly evaluated on every page load regardless of whether the fallback is ever triggered. This also means a developer reading `dataService.ts` must cross-reference `dashboardData.ts` to understand the fallback behavior. The fallback data needed by the service is a fraction of `dashboardData`'s full content; embedding a minimal inline stub would remove the service-to-data-layer coupling while keeping the fallback behavior. PROPOSAL: Extract the minimal fallback data needed by `dataService.ts` into an inline stub within the service file; remove `import { dashboardData, cityLocations } from '../data/dashboardData'` at `dataService.ts:4`.

**Proposed actions:**
- Move `CityData` from `components/3d/CityMarkers.tsx:20-30` to `types.ts`; update 4 import sites in `useRealtimeAQI.ts:8`, `CityMarkers.tsx`, `AirQualityMapView.tsx:30`, `3d/index.ts:16` — M/L, score 2.0; does not enter top 10
- Declare `LocationKey` explicitly in `types.ts`; remove `keyof typeof dashboardData` at `dashboardData.ts:338`; update 8 import sites — M/L, score 2.0; does not enter top 10
- Remove `SceneContext`, `useSceneContext`, `SceneContextValue` from `components/3d/index.ts:6-7` public barrel — L/L, score 1.0; does not enter top 10
- Add `ComparisonBarChart` and `HistoricalComposedChart` to `components/charts/`; replace direct recharts imports in `Dashboard.tsx:2-4`, `AnalysisView.tsx:15`, `CalendarView.tsx:6` — M/M, score 1.0; does not enter top 10
- Extract fallback data inline to `dataService.ts`; remove `dashboardData` import at `dataService.ts:4` — M/L, score 2.0; does not enter top 10

### Run #61 — 2026-05-30 — Lens: Type safety
**Scope:** Fourth type-safety pass. Examined: `tsconfig.json`, `hooks/useDashboardData.ts`, `hooks/useViewport.ts`, `components/AccessibleChart.tsx`, `services/WeatherService.ts`, `services/dataService.ts`, `data/dashboardData.ts`, `components/charts/AQITrendChart.tsx`, `components/charts/PM25TrendChart.tsx`, `components/charts/TemperaturePrecipitationChart.tsx`, `components/charts/WeatherForecastChart.tsx`. Prior type-safety details (#1, #16, #31, #46) archived; all findings verified as new via specificity of file:line citations.

**Findings:**

- OBSERVATION: `useDashboardData.ts:179,223,267,311` and `data/dashboardData.ts:195` — Four `useMemo` computations (humidity, wind-speed, UV, agricultural trends) iterate over `locEntry.dailyForecast` with `forEach((day: any) => ...)`. The `dailyForecast` arrays are produced by `generateDailyForecast()` at `dashboardData.ts:195`, which returns a richly-typed inferred array — each element contains 20+ typed fields including `date: string`, `temp: {current,min,max,feelsLike}`, `humidity: number`, `wind: {speed,gust,direction}`, `uv: number`, `evapotranspiration: number`, `solarRadiation: number`. TypeScript can infer this type from `locEntry.dailyForecast` because `locEntry` is typed by `dashboardData[loc]`. However, the explicit `: any` annotation on the forEach callback parameter overrides that inference: `day.evapotranspiration` at line 322 vs. a typo `day.evaptransipration` would both compile silently. Downstream, the four accumulator result arrays at `useDashboardData.ts:197-199, 241-243, 285-287, 330-332` are declared as `any[]` with `entry: any` accumulators, producing opaque `useMemo` return values that feed directly into the chart components' `data: any[]` props — the type checker provides zero coverage across the entire data pipeline from `generateDailyForecast` through the chart renderer. PROPOSAL: (a) Export `export type DailyForecast = ReturnType<typeof generateDailyForecast>[number];` from `dashboardData.ts` (line 337); (b) replace all four `(day: any)` annotations in `useDashboardData.ts` with `(day: DailyForecast)`; (c) replace the four `result: any[]` / `entry: any` patterns with `Array<{ month: string } & Record<string, number>>`.

- OBSERVATION: `hooks/useViewport.ts:28` — `export const ZOOM_THRESHOLDS: Record<string, number>` maps seven specific layer names (`'fires'`, `'earthquakes'`, `'aqi'`, `'water'`, `'wells'`, `'waterQuality'`, `'enviroscreen'`) to minimum zoom levels, but the annotation `Record<string, number>` accepts any string key and returns `number` for all access — even unknown keys that return `undefined` at runtime. A zoom-threshold check like `zoom >= ZOOM_THRESHOLDS['well']` (typo for `'wells'`) compiles without error but evaluates as `zoom >= undefined` (i.e., `false` or `NaN` comparison) at runtime, silently disabling the layer guard. TypeScript's `Record<string, number>` index signature conflates "any key I try returns `number`" with "any key that exists returns `number`"; the compile-time contract is wider than the runtime reality. PROPOSAL: Define `export type ZoomLayerKey = 'fires' | 'earthquakes' | 'aqi' | 'water' | 'wells' | 'waterQuality' | 'enviroscreen';` at `useViewport.ts:27`; change `ZOOM_THRESHOLDS` to `Record<ZoomLayerKey, number>`. TypeScript will then flag any access with a non-`ZoomLayerKey` string and verify object completeness.

- OBSERVATION: `hooks/useViewport.ts:54` — The `updateViewport` callback's first parameter is typed with a 170-character anonymous structural interface: `{ getNorthEast: () => { lat: () => number; lng: () => number }; getSouthWest: () => { lat: () => number; lng: () => number } }`. This is a hand-written structural approximation of `google.maps.LatLngBounds`. The `@types/google.maps` package is available in the project (referenced in `vite-env.d.ts`). Using the anonymous structural type means: (a) the shape is unnamed, making call-site IDE completion unhelpful; (b) if `@types/google.maps` updates the return type of `getNorthEast()` from a plain `{lat(): number; lng(): number}` to the richer `google.maps.LatLng` class, the anonymous type would diverge without a compile error; (c) callers can pass any structurally-matching object even if it is not a real `LatLngBounds`. PROPOSAL: Replace the anonymous structural type at `useViewport.ts:54` with `google.maps.LatLngBounds`, or extract a named interface `interface GoogleMapsBoundsLike { getNorthEast(): { lat(): number; lng(): number }; getSouthWest(): { lat(): number; lng(): number }; }` at the top of the file.

- OBSERVATION: `components/AccessibleChart.tsx:66,79` — The `DataTableColumn` interface declares `format?: (value: any) => string` at line 66. The `AccessibleChartProps` interface declares `data: Record<string, any>[]` at line 79. Both `any` usages are related: `format` is called at line 155 as `col.format(row[col.key])` where `row` is a `Record<string, any>` element. Because the value type is `any`, a formatter written as `(v: number) => v.toFixed(2)` compiles without error even when the key maps to a string field at runtime, producing a `TypeError`. Callers across the dashboard pass domain-specific formatters (AQI, temperature, precipitation); the `any` annotation removes all type checking. PROPOSAL: Add a generic type parameter: `interface DataTableColumn<T = unknown> { key: string; header: string; format?: (value: T) => string; }` and update `data: Record<string, unknown>[]` in `AccessibleChartProps`. Callers that know the value type parameterize as `DataTableColumn<number>`.

- OBSERVATION: `services/WeatherService.ts:103-111` — `getForecast()` casts the raw API response with an anonymous inline interface: `await response.json() as Array<{ locationName: string; date: string; tempHigh: number | null; tempLow: number | null; humidity: number | null; conditions: string; icon: string; }>`. This shape describes records from the analytics `/api/forecast` endpoint. `dataService.ts` consumes the same endpoint and defines `ForecastRecord` (lines 75-88), but `ForecastRecord` carries additional fields (`precipProbability`, `windSpeed`, `uvIndex`) that the `WeatherService` inline cast omits — there is no shared authoritative type for this API boundary. If the analytics service renames `tempHigh` to `temp_high`, the `WeatherService` cast silently compiles while runtime extraction (`r.tempHigh`) returns `undefined`. The inline anonymous interface is also invisible to anyone reading `dataService.ts`, preventing cross-file type consistency checks. PROPOSAL: Export a named `ForecastApiRecord` interface from `dataService.ts` representing the exact wire shape of the `/api/forecast` response; import and use it as the cast target in `WeatherService.ts:103`, creating a single authoritative type for this API boundary.

**Proposed actions:**
- Export `DailyForecast` type from `dashboardData.ts:337`; remove `(day: any)` annotations in `useDashboardData.ts:179,223,267,311`; type result arrays as `Array<{month: string} & Record<string, number>>` — H/L, score 3.0; ties top 10, does not displace (first seen #61)
- Define `ZoomLayerKey` union type and change `ZOOM_THRESHOLDS` to `Record<ZoomLayerKey, number>` in `useViewport.ts:27-28` — M/L, score 2.0; does not enter top 10
- Replace anonymous structural bounds type at `useViewport.ts:54` with `google.maps.LatLngBounds` or a named interface — M/L, score 2.0; does not enter top 10
- Add generic `T` param to `DataTableColumn` in `AccessibleChart.tsx:66`; change `data` to `Record<string, unknown>[]` — M/L, score 2.0; does not enter top 10
- Export named `ForecastApiRecord` interface from `dataService.ts`; use as cast target in `WeatherService.ts:103` — M/L, score 2.0; does not enter top 10

### Run #60 — 2026-05-30 — Lens: Live-time claim audit
**Scope:** Fifth live-time claim audit. Examined: `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/db/persist.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/source_toggles.py`, `hooks/useRealtimeAQI.ts`, `components/AirQualityMapView.tsx`. Prior live-time audit details (#15, #30, #45) archived; all findings verified as new.

**Findings:**

- OBSERVATION: `context.py:20` vs `config.rs:26-27` — `context.py` defines `SOURCE_INTERVALS["purpleair"] = 120` (2-minute interval), giving a staleness threshold of 240 seconds (2× the interval). However, `config.rs:26-27` defaults `purpleair_interval_secs = 600` (10 minutes), with the comment "PurpleAir free tier is 1000 pts/day." Since `_freshness()` at `context.py:41-43` marks data stale when `age_seconds > interval * 2 = 240s`, any PurpleAir reading older than 4 minutes is classified "stale" — yet the ingestion service only refetches every 10 minutes. Even when polling runs perfectly on schedule, data is marked stale for the 6-minute window between the 4-minute stale threshold and the 10-minute refetch — i.e., 60% of every cycle. In practice the AI system prompt receives a "⚠ IMPORTANT: Stale data sources may not reflect current conditions" caveat the majority of the time even when the ingestion pipeline is healthy. PROPOSAL: Align `SOURCE_INTERVALS["purpleair"]` in `context.py:20` with the actual ingestion default by changing it from `120` to `600`. For robustness, read the interval from a shared config or environment variable so the two services cannot drift again.

- OBSERVATION: `context.py:52-70` — `build_live_context()` initializes `context["sources"] = {}` at line 57 and never populates it. Each of the eight `_get_*` fetcher functions returns freshness metadata under its own key (e.g., `context["aqi"]["freshness"]`, `context["fires"]["freshness"]`, etc.), but none of them write to `context["sources"]`. Consequently, when `build_context_text()` reads `sources = ctx.get("sources", {})` at line 81, it always receives `{}`. The three status lines — "LIVE data sources: …", "STALE data sources: …", "UNAVAILABLE data sources: …" — are structurally unreachable: `live_sources`, `stale_sources`, and `unavailable` are always empty lists. Claude never receives the per-source freshness awareness that `build_context_text()` was designed to inject; instead it processes AQI readings without any indication of whether the underlying data pipeline is healthy or dead. PROPOSAL: After all eight `_get_*` calls in `build_live_context()` (lines 61–68), extract freshness into `context["sources"]` with a block like: `for key, src_key in [("aqi","purpleair"),("fires","fires"),("earthquakes","earthquakes"),("water","water"),("forecast","nws_forecast"),("inversion","inversion")]: freshn = context.get(key,{}).get("freshness",{}); context["sources"][src_key] = freshn`. This wire-up requires no change to the fetchers themselves.

- OBSERVATION: `routes/aqi.rs:52-63` — The `GET /api/aqi-history` handler calls `aqi::generate_history(&params.station_id, hours)` unconditionally, with no database query. The `sensor_readings` table is populated every 5 seconds by `persist::write_readings()` (`broadcast.rs:115`) and contains actual recorded values (real PurpleAir readings or mock, depending on availability), but this data is entirely ignored. Every call to `/api/aqi-history` returns a freshly generated random walk — a different sequence on each invocation, bearing no relationship to any previously observed or stored readings. The station_id parameter further misbehaves: `aqi::generate_history()` at `aqi.rs:143` checks only `if station_id.contains("0002")` to pick a base AQI; all other station IDs produce the same baseline walk regardless of which location is requested. Any UI or analytics consumer that calls this endpoint (e.g., `DataExplorer.tsx` via `useLiveData`) receives fabricated trend lines presented as historical observations. PROPOSAL: Replace the `generate_history()` call in `routes/aqi.rs:57` with a `sqlx::query!` against `sensor_readings` joined to `locations` on `location_id`, filtering by station UUID and time window; fall back to `generate_history()` only if the query returns zero rows (cold-start scenario).

- OBSERVATION: `source_toggles.py:9-11` and `broadcast.rs:70-94` and `persist.rs:26` and `context.py:196-232` — `source_toggles.py` comment reads "All sources default to OFF." When a source toggle is OFF (or Redis is unavailable, per `broadcast.rs:69-73`), the PurpleAir fetch is skipped and `broadcast.rs:111` falls back to `aqi::generate_readings()`, which sets `source: "mock"` on every `AqiReading`. `persist.rs:26` stores this value in `sensor_readings.source`. `_get_aqi_context()` at `context.py:201-209` queries the last hour of `sensor_readings` without any filter on `source != 'mock'`, so mock readings are retrieved alongside (or instead of) real ones. These fabricated values — random integers scattered around fixed baselines (Fresno: 75 AQI, Bakersfield: 85, etc.) — are injected verbatim into the AI system prompt as "current air quality" for named CARB monitoring stations. Claude produces analysis, health recommendations, and predictive statements based on what amounts to `rand::thread_rng().gen_range(-20.0..25.0)`. In the default deployment (all toggles off, or Redis unavailable), 100% of the "live" data Claude reasons over is synthetic. PROPOSAL: Add `AND sr.source != 'mock'` to the `sensor_readings` query in `_get_aqi_context()` at `context.py:203`; if the result set is empty, return `{"readings": [], "freshness": _freshness(None, "purpleair")}` so Claude explicitly sees the AQI source as "unavailable" rather than receiving fabricated numbers.

- OBSERVATION: `AirQualityMapView.tsx:413` and `useRealtimeAQI.ts:288-324` — The map header shows `🔴 Live` when `isConnected` is true (SSE connection open). The Rust `AqiReading` struct (`aqi.rs:38-39`) serializes a `source` field (`"purpleair"`, `"airnow"`, or `"mock"`) in every `aqi-update` SSE event. The `addEventListener('aqi-update', ...)` handler in `useRealtimeAQI.ts:286-343` parses incoming readings with an inline type at lines 288–306 that has no `source` property. The `RealtimeCityData` interface at lines 15-22 likewise omits `source`. During the city-mapping step at lines 309-324 the `source` value is silently discarded. `AirQualityMapView.tsx` therefore cannot distinguish a connection broadcasting real PurpleAir sensor readings from one broadcasting mock-generated data; `🔴 Live` is displayed in both cases. When PurpleAir is disabled (the default) and the SSE stream carries mock data, users who see the `🔴 Live` indicator receive no indication that the displayed values are synthetic. PROPOSAL: (a) Add `source: string` to the inline reading type at `useRealtimeAQI.ts:288-306` and to the `RealtimeCityData` interface at `useRealtimeAQI.ts:15-22`; (b) propagate it through the city mapping at line 309-324; (c) in `AirQualityMapView.tsx:413`, derive `const allMock = cities.every(c => c.source === "mock")` and display `⚫ Simulated` (or amber `🟡 Simulated`) instead of `🔴 Live` when `allMock` is true.

**Proposed actions:**
- Fix `SOURCE_INTERVALS["purpleair"]` in `context.py:20` from 120 to 600 to match actual ingestion interval in `config.rs:27` — M/L, score 2.0; does not enter top 10
- Wire `context["sources"]` from per-key freshness sub-dicts in `build_live_context()` at `context.py:61-68`; enables freshness status lines in AI prompt — M/L, score 2.0; does not enter top 10
- Replace `generate_history()` in `routes/aqi.rs:57` with a real DB query against `sensor_readings` — H/M, score 1.5; does not enter top 10
- Add `AND sr.source != 'mock'` filter to `_get_aqi_context` query in `context.py:203` — H/L, score 3.0; ties top 10, does not displace
- Add `source: string` to `RealtimeCityData` in `useRealtimeAQI.ts:15-22`; show `⚫ Simulated` in `AirQualityMapView.tsx:413` when all sources are "mock" — M/L, score 2.0; does not enter top 10

## 📚 Archive (one line per past run)
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
