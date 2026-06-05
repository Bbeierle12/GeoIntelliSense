# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-05T07:15:00Z
Last run: #167 — Lens: Module boundaries

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
### Run #167 — 2026-06-05 — Lens: Module boundaries
**Scope:** Twelfth Module boundaries pass. Files examined in full: `hooks/useRealtimeAQI.ts`; `components/3d/CityMarkers.tsx`; `components/3d/index.ts`; `services/aiService.ts`; `services/dataService.ts`; `services/AirQualityService.ts`; `services/WeatherService.ts`; `hooks/useLiveData.ts`; `components/MapView.tsx`; `components/SettingsView.tsx`; `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/context.py`; `geointellisense-analytics/app/routes/fires.py`; `geointellisense-analytics/app/routes/water.py`; `geointellisense-analytics/app/routes/inversion.py`; `geointellisense-analytics/app/source_toggles.py`; `geointellisense-analytics/app/main.py`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/routes/mod.rs`. Cross-checked against Active Recommendations and Latest Findings runs #164–#166 plus archived Module boundaries lens runs #2, #17, #32, #47, #62, #77, #92, #107, #122, #137, #152 to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` imports `type { CityData } from '../components/3d/CityMarkers'` — a hook (shared logic layer) taking a compile-time dependency on a component (presentation layer). The canonical dependency direction is `components → hooks → services → utils/types`. `useRealtimeAQI` then declares `RealtimeCityData extends CityData` at line 15, embedding the component-sourced interface into the hook's own public API. `CityData` (id, name, lat, lng, aqi, temperature, humidity, windSpeed, pm25) is a pure data shape with no rendering concern; it belongs in `types.ts` alongside the project's other domain interfaces. As long as `CityData` lives in `CityMarkers.tsx`, any test or non-3D consumer of `useRealtimeAQI` must bundle the full 3D component module (which pulls in `@react-three/fiber`, `@react-three/drei`, `THREE`) just to use the hook's type-level API. `components/3d/index.ts:16` already re-exports `type { CityData }` from `CityMarkers`, making the hook's direct deep import unnecessary even on the current path. PROPOSAL: Move `CityData` to `types.ts`; update `CityMarkers.tsx` to import it from there; update `useRealtimeAQI.ts:8` to import from `../types` — L/L effort (move one interface, update 2 imports).

- OBSERVATION: `geointellisense-analytics/app/claude.py:103` contains a guarded runtime import `from app.routes.fires import get_current_smoke_context` executed inside the `get_system_with_live_context` async function's fallback branch. `claude.py` is the core LLM-orchestration module (client factory, session store, system-prompt assembly); `routes/fires.py` is an HTTP route module in the presentation layer. The dependency direction is inverted: core orchestration is importing from a route handler. `fires.py:25` even documents this inversion: the function is named "Called by Claude AI routes to inject fire context" — acknowledging that the route module serves its own caller in a non-HTTP, non-route capacity. The function `get_current_smoke_context()` returns module-level state `_smoke_context` (a string updated by the fire poller background task). Moving this state and its getter to `context.py` (which already owns live-data assembly for system prompts) or to a new `app/state.py` singleton would sever the upward dependency; `fires.py` would call into `context`/`state` to update the value, and `claude.py` would read it from there — restoring the correct direction. PROPOSAL: Extract `_smoke_context` and `get_current_smoke_context()` from `fires.py` into `app/context.py` or a dedicated `app/state.py`; have the fire poller update context/state; remove the `from app.routes.fires` import in `claude.py:103` — M/M effort (add one module or extend context.py; update 2 import sites).

- OBSERVATION: `services/aiService.ts:4-6`, `services/WeatherService.ts:3-8`, `services/AirQualityService.ts:1-3`, `services/dataService.ts:6-8`, `hooks/useLiveData.ts:15-16`, `components/MapView.tsx:16`, `components/SettingsView.tsx:208,364` — the two service base URLs (gateway: `VITE_GATEWAY_URL || 'http://localhost:8080'`; ingestion: `VITE_INGESTION_URL || 'http://localhost:3001'`) are independently computed in **eight** locations across the codebase, using inconsistent local constant names (`API_BASE_URL`, `ANALYTICS_URL`, `GATEWAY_URL`, `INGESTION_URL`). There is no shared `config.ts` or `constants.ts` at the project root that exports these resolved URLs. Two of these eight sites are component files (`MapView.tsx:16`, `SettingsView.tsx:208`) — components should not compute service topology constants directly. If the default fallback port changes or a new service tier is added, all eight sites require a coordinated update. A single `src/config.ts` exporting `GATEWAY_BASE` and `INGESTION_BASE` would reduce the duplication to one file and allow components to import from the services or config layer. PROPOSAL: Create `config.ts` at project root exporting `GATEWAY_BASE` and `INGESTION_BASE`; replace all 8 inline computations with imports — L/L effort (1 new file + 8 import updates, purely mechanical).

- OBSERVATION: `hooks/useLiveData.ts:49-51` — the generic data-fetching hook contains inline service-routing logic: `const base = path.startsWith('/api/aqi-') || path === '/health' ? INGESTION_URL : GATEWAY_URL`. This makes the "generic" hook aware of the internal two-service topology: which URL path prefixes belong to the Rust ingestion service (port 3001) vs. the Python analytics gateway (port 8080). A caller using `useLiveData('/api/airnow/current')` will silently route to the gateway; a caller using `useLiveData('/api/aqi-snapshot')` silently routes to the Rust service — neither caller can see or override this behavior without reading the hook's internals. If the analytics service ever adds an `/api/aqi-*` endpoint (e.g., for historical AQI), the path-prefix check would misroute it to the ingestion service. The fix is to expose the routing decision as an explicit option: `useLiveData<T>(path, { service?: 'gateway' | 'ingestion', ... })` so callers declare intent rather than relying on a magic path-string check. PROPOSAL: Add a `service?: 'gateway' | 'ingestion'` option to `UseLiveDataOptions` in `useLiveData.ts:20-23`; replace the `path.startsWith` heuristic with `options.service === 'ingestion' ? INGESTION_URL : GATEWAY_URL`; update all `useLiveData` call sites that need the ingestion service to pass `{ service: 'ingestion' }` — M/L effort (update hook interface + ~10 call sites).

**Proposed actions:**
- Move `CityData` interface from `components/3d/CityMarkers.tsx` to `types.ts`; update `useRealtimeAQI.ts:8` import to `../types` — L/L effort (eliminates hook → component layer inversion)
- Extract `_smoke_context`/`get_current_smoke_context()` from `app/routes/fires.py:25` into `app/context.py` or `app/state.py`; remove runtime `from app.routes.fires` import in `claude.py:103` — M/M effort (restores correct core → routes dependency direction)
- Create `config.ts` at project root exporting `GATEWAY_BASE` and `INGESTION_BASE`; replace 8 inline URL computations across services, hooks, and components — L/L effort (eliminates duplicated service topology constants)
- Replace path-prefix heuristic in `useLiveData.ts:49-51` with explicit `service?: 'gateway' | 'ingestion'` option — M/L effort (makes routing intent explicit and future-proof)

### Run #166 — 2026-06-05 — Lens: Type safety
**Scope:** Twelfth Type safety pass. Files examined in full: `tsconfig.json`; `hooks/useDashboardData.ts`; `components/charts/PM25TrendChart.tsx`; `components/charts/AQITrendChart.tsx`; `components/charts/TemperaturePrecipitationChart.tsx`; `components/charts/WeatherForecastChart.tsx`; `components/AccessibleChart.tsx`; `components/MapView.tsx`; `components/3d/AQI3DScene.tsx`; `components/SettingsView.tsx` (line 526); `tests/security.test.tsx`. Cross-checked against Active Recommendations and Latest Findings runs #163–#165 plus archived Type safety lens runs #1, #16, #31, #46, #61, #76, #91, #106, #121, #136, #151 to confirm findings are new.

**Findings:**

- OBSERVATION: `tsconfig.json` — The compiler configuration has NO strictness flags enabled. Neither `"strict": true` nor any of its constituent flags (`"noImplicitAny"`, `"strictNullChecks"`, `"strictFunctionTypes"`, `"strictBindCallApply"`, `"strictPropertyInitialization"`, `"noImplicitReturns"`, `"noImplicitThis"`) appear in `compilerOptions`. The only emit-related quality flag present is `"skipLibCheck": true`. This is the root cause for the density of `any` and unsafe casts found in every Type Safety pass: the compiler accepts all of them without a diagnostic. In a project that is already 100% TypeScript (no `.js` source files), enabling `"strict": true` is low-effort — it requires no dependency changes — and immediately surfaces every implicit-any and missing null-check in the code as compiler errors, making future `any` introductions a build-time failure rather than a silent accumulation. The absence of `"noUnusedLocals"` and `"noUnusedParameters"` also allows dead code to accumulate without detection. PROPOSAL: Add `"strict": true` (plus `"noUnusedLocals": true` and `"noUnusedParameters": true`) to `tsconfig.json:2` `compilerOptions`; then work through the resulting compiler errors methodically — L/M effort (one-line config change + remediation pass).

- OBSERVATION: `hooks/useDashboardData.ts:69,108,128,148,179,197,199,223,241,243,267,285,287,311,330,332` — Every data-transformation `useMemo` in this file uses `any` systematically: Map values typed as `Record<string, any>` (e.g., line 69: `new Map<string, Record<string, any>>()`), `forEach` callbacks with `(day: any)` (lines 179, 223, 267, 311), accumulator arrays as `any[]` (lines 197, 241, 285, 330), and intermediate objects as `any` (lines 199, 243, 287, 332). The data being accumulated has a fixed, known shape: it merges `dailyForecast` entries by month, producing objects with `month`, `avgAqi`, `maxAqi`, `avgTemp`, `precipitation`, etc. The `DailyForecast` shape is defined in `types.ts` but the forEach callbacks cast away from it immediately. All 16 occurrences can be eliminated by declaring a `MonthlyAggregate` interface in `types.ts` and replacing `Record<string, any>` with it; the forEach parameter `(day: any)` becomes `(day: DailyForecast)`. PROPOSAL: Add `MonthlyAggregate` interface to `types.ts`; replace all `Record<string, any>` and `any[]`/`any` accumulator patterns in `useDashboardData.ts` with typed equivalents — M/M effort (define 1–2 interfaces; update 16 call sites across 4 repeated blocks).

- OBSERVATION: `components/charts/PM25TrendChart.tsx:15`, `components/charts/AQITrendChart.tsx:15`, `components/charts/TemperaturePrecipitationChart.tsx:15`, `components/charts/WeatherForecastChart.tsx:14` — All four Recharts-based chart wrapper components declare their primary data prop as `data: any[]`. The shapes these components actually receive are fixed and narrow: `PM25TrendChart` expects objects with `timestamp` and `pm25`; `AQITrendChart` expects `timestamp` and `aqi`; `TemperaturePrecipitationChart` expects `month`, `avgTemp`, `precipitation`; `WeatherForecastChart` expects `date`, `high`, `low`, `precipitation`. Since `"strict"` is disabled (see finding above), Recharts' `<LineChart data={x}>` accepts `any[]` at the JSX layer too — a caller can pass an entirely wrong array (e.g., fire incidents instead of AQI readings) and receive no type error. The correct type for the `data` prop in each chart is a named interface that documents the required keys, which also serves as the source of truth for the `dataKey` string literals used on `<Line>` / `<Bar>` elements. PROPOSAL: Define four chart data interfaces (e.g., `AqiDataPoint`, `PM25DataPoint`, `WeatherForecastPoint`, `MonthlyWeatherPoint`) in `types.ts`; replace `data: any[]` in each chart component's prop type with the appropriate named interface — L/L effort (add 4 small interfaces; update 4 prop declarations).

- OBSERVATION: `components/MapView.tsx:393` — Inside the `PlacesService.textSearch` callback, the code executes `mapInstanceRef.current!.setCenter(results[0].geometry!.location!)` using two chained non-null assertions on `geometry!` and `location!`. The outer `if` guard (`results && results.length > 0`) confirms the array is non-empty, but Google Maps `PlaceResult.geometry` is typed as `google.maps.places.PlaceGeometry | null | undefined` and can be absent for business-type results returned by `textSearch` that have not yet had their geometry loaded; `geometry.location` is separately typed as `google.maps.LatLng | null | undefined`. If `textSearch` returns a result with `geometry: null` (which the Maps Places API can return for results that require a detail fetch), the `!` assertions suppress TypeScript's null-pointer protection and the call `null!.location!` throws a runtime `TypeError: Cannot read properties of null`. The fix is a simple null-coalescing guard: `if (results[0].geometry?.location)` before calling `setCenter`. PROPOSAL: Replace `results[0].geometry!.location!` at `MapView.tsx:393` with a null guard `const loc = results[0].geometry?.location; if (loc) { mapInstanceRef.current!.setCenter(loc); mapInstanceRef.current!.setZoom(12); }` — L/L effort (change 2 lines).

**Proposed actions:**
- Add `"strict": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true` to `tsconfig.json` compilerOptions — L/M effort (enables compiler enforcement of all other type fixes)
- Define typed interfaces for chart data and replace `data: any[]` in all 4 chart components (`PM25TrendChart.tsx:15`, `AQITrendChart.tsx:15`, `TemperaturePrecipitationChart.tsx:15`, `WeatherForecastChart.tsx:14`) — L/L effort
- Replace 16 `any` occurrences in `useDashboardData.ts` data-transform useMemos with a `MonthlyAggregate` typed interface — M/M effort
- Fix chained non-null assertions at `MapView.tsx:393` with a null guard on `geometry?.location` — L/L effort (prevents runtime TypeError on Places API results without geometry)

### Run #165 — 2026-06-05 — Lens: Live-time claim audit
**Scope:** Eleventh Live-time claim audit pass. Files examined in full: `geointellisense-ingestion/src/routes/aqi.rs`; `geointellisense-ingestion/src/aqi.rs`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/config.rs`; `geointellisense-ingestion/src/purpleair.rs`; `geointellisense-ingestion/src/routes/sse.rs`; `geointellisense-ingestion/src/routes/mod.rs`; `hooks/useRealtimeAQI.ts`; `components/AirQualityMapView.tsx` (lines 60-280, 388-420); `components/dashboard/widgets/AqiTrendWidget.tsx`; `geointellisense-analytics/app/context.py` (lines 1-50); `metadata.json`; `README.md`. Cross-checked against Active Recommendations and Latest Findings runs #162–#164 plus archived Live-time claim audit lens runs #15, #30, #45, #60, #75, #90, #105, #120, #135, #150 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/routes/aqi.rs:64-73` — The `/api/aqi-history` endpoint always returns mock-generated history data regardless of what `station_id` is requested. The handler calls `aqi::generate_history(&params.station_id, hours)` (line 66), which at `aqi.rs:138-162` produces a random walk using a fixed base AQI (85 for station IDs containing "0002", 60 for all others) with ±5 AQI per step. This function never queries the database. Meanwhile `broadcast.rs:115` calls `persist::write_readings(&pool, &readings)` every `broadcast_interval_secs` (default 5 seconds), writing real or mock readings to the `sensor_readings` table. The result: the database is accumulating time-series sensor readings that are never served to the frontend. The `AqiTrendWidget.tsx:21` widget on the "Live Dashboard" (`LiveDashboard.tsx:17`: "Real-time environmental monitoring for the San Joaquin Valley") displays a 24-hour AQI trend chart that is entirely fabricated random data, even when live PurpleAir readings have been continuously persisted. Users who see the trend line going up or down are reading a random walk, not actual historical air quality. PROPOSAL: Replace `aqi.rs:64-73` history handler with a DB query against `sensor_readings` using `WHERE station_id = $1 AND timestamp > NOW() - INTERVAL '$2 hours' ORDER BY timestamp` and map to `AqiHistoryPoint`; keep `generate_history()` as a fallback when the DB result is empty — M/L effort (add one SQL query, handle empty result).

- OBSERVATION: `components/AirQualityMapView.tsx:177` — The city detail panel rendered on every city click contains a hardcoded footer string: "Real-time data from EPA monitoring station. Interpolation model uses IDW and Kriging algorithms." The first clause is factually incorrect on two counts: (a) the data source is PurpleAir crowdsourced sensors (when `PURPLEAIR_API_KEY` is configured) or synthetic mock data (`aqi.rs:131`: `source: "mock"`), not EPA; no EPA API is called anywhere in the ingestion service, and `MapView.tsx:256` even renders a `'LIVE'` vs `'MOCK'` badge based on `r.source === 'purpleair'`. (b) When Redis is down (Active Rec #3) and the PurpleAir fetch is disabled by the Redis toggle, the broadcast ticker falls back to `aqi::generate_readings()` (pure random data), yet the panel still shows "EPA monitoring station." The IDW/Kriging claim is also inaccurate: `utils/interpolation.ts` implements IDW only; Kriging is not present in the codebase. This static hardcoded string survives all data source changes silently. PROPOSAL: Replace `AirQualityMapView.tsx:177`'s hardcoded string with a dynamic source attribution that reads `city.source` (passed down from SSE reading) and renders the actual source name (e.g., "Data source: PurpleAir" or "Data source: simulated") — L/L effort (replace 1 string + thread source prop through city data).

- OBSERVATION: `broadcast.rs:106-109` combined with `config.rs:26-28` — The broadcast ticker fires every `broadcast_interval_secs` (default 5 seconds) and when a cached reading exists, re-broadcasts it with a fresh `timestamp: now`: `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()`. The PurpleAir fetch interval (`purpleair_interval_secs`) defaults to 600 seconds (10 minutes, per `config.rs:26-27` comment: "PurpleAir free tier is 1000 pts/day"). This means the SSE stream delivers up to 119 consecutive broadcasts (one every 5 seconds for up to ~10 minutes) where every reading carries the current time as its timestamp but the underlying `aqi`, `pm25`, `pm10`, `temperature`, and `humidity` values are identical to the last PurpleAir API response. On the frontend, `AirQualityMapView.tsx:413` renders `🔴 Live` based on `isConnected` (SSE connection open), not data freshness. A user watching the "Live" display sees values update with current timestamps every 5 seconds; in reality the sensor readings are potentially 9 minutes 55 seconds stale, with only the timestamp field changing. There is no UI indicator of sensor data age or last PurpleAir fetch time. PROPOSAL: Add a `data_fetched_at` field to `AqiReading` set at PurpleAir fetch time (not broadcast time); propagate via SSE to the frontend; render a staleness indicator ("Sensor data: Xm ago") next to the `🔴 Live` badge in `AirQualityMapView.tsx` — M/L effort (add one field to struct + frontend staleness display).

- OBSERVATION: `geointellisense-analytics/app/context.py:20` vs `geointellisense-ingestion/src/config.rs:26-27` — The AI context builder declares `SOURCE_INTERVALS["purpleair"] = 120` seconds (2 minutes) with comment "PurpleAir fetcher runs every 2 min". At `context.py:42`: `stale = age_seconds > interval * 2`, the staleness threshold for PurpleAir is therefore 240 seconds (4 minutes). However the actual ingestion service default is `purpleair_interval_secs = 600` (10 minutes, per `config.rs:26-27`). When deployed with default configuration (no `PURPLEAIR_INTERVAL_SECS` env override), every Claude query that calls `build_live_context()` will find PurpleAir data with age >240 seconds and mark it `"status": "stale"`. The AI system prompt header `context.py:76` instructs Claude "do NOT use training data when this is available" — but a `stale` flag on PurpleAir data causes Claude to add uncertainty caveats or potentially fall back to training data, even when PurpleAir data is freshly fetched 3 minutes ago as designed. The comment in `context.py:20` was likely set when an earlier config had a 2-minute interval; the config was later relaxed to 10 minutes (to stay within PurpleAir free tier API quota) but the context builder was not updated. PROPOSAL: Update `context.py:20` to `"purpleair": 600` to match the actual default, and align the comment; also add a comment pointing to `config.py`'s `PURPLEAIR_INTERVAL_SECS` default for discoverability — L/L effort (change 1 constant + 1 comment).

**Proposed actions:**
- Replace `/api/aqi-history` mock-only handler at `aqi.rs:64-73` with a DB query against `sensor_readings`; keep `generate_history()` as empty-result fallback — M/L effort
- Replace hardcoded "EPA monitoring station" string at `AirQualityMapView.tsx:177` with dynamic source attribution from the city's actual `source` field — L/L effort
- Add `data_fetched_at` field to `AqiReading` set at PurpleAir fetch time; surface staleness ("Sensor data: Xm ago") next to `🔴 Live` in `AirQualityMapView.tsx` — M/L effort
- Correct `context.py:20` `SOURCE_INTERVALS["purpleair"]` from 120 to 600 to match actual ingestion default — L/L effort

## 📚 Archive (one line per past run)
- Run #164 (2026-06-05) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #163 (2026-06-05) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #162 (2026-06-05) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #161 (2026-06-05) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #160 (2026-06-04) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #159 (2026-06-04) — Lens: Security — 4 findings — 0 promoted to Active
- Run #158 (2026-06-04) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #157 (2026-06-04) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #156 (2026-06-04) — Lens: TS ↔ Python contract — 3 findings — 0 promoted to Active
- Run #155 (2026-06-04) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #154 (2026-06-04) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #153 (2026-06-04) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #152 (2026-06-04) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #151 (2026-06-04) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #150 (2026-06-04) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #149 (2026-06-04) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #148 (2026-06-04) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #147 (2026-06-04) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #146 (2026-06-04) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #145 (2026-06-03) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #144 (2026-06-03) — Lens: Security — 4 findings — 0 promoted to Active
- Run #143 (2026-06-03) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #142 (2026-06-03) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #141 (2026-06-03) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
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
- Run #144: lens 9 (Security) — findings added
- Run #145: lens 10 (Observability) — findings added
- Run #146: lens 11 (Docs) — findings added
- Run #147: lens 12 (Deployment / Docker) — findings added
- Run #148: lens 13 (LLM integration quality) — findings added
- Run #149: lens 14 (Competitive scan) — findings added
- Run #150: lens 15 (Live-time claim audit) — findings added
- Run #151: lens 1 (Type safety) — findings added
- Run #152: lens 2 (Module boundaries) — findings added
- Run #153: lens 3 (Dependency health) — findings added
- Run #154: lens 4 (Perf hot paths) — findings added
- Run #155: lens 5 (Test coverage gaps) — findings added
- Run #156: lens 6 (TS ↔ Python contract) — findings added
- Run #157: lens 7 (UX / UI flaws) — findings added
- Run #158: lens 8 (Data pipeline integrity) — findings added
- Run #159: lens 9 (Security) — findings added
- Run #160: lens 10 (Observability) — findings added
- Run #161: lens 11 (Docs) — findings added
- Run #162: lens 12 (Deployment / Docker) — findings added
- Run #163: lens 13 (LLM integration quality) — findings added
- Run #164: lens 14 (Competitive scan) — findings added
- Run #165: lens 15 (Live-time claim audit) — findings added
- Run #166: lens 1 (Type safety) — findings added
- Run #167: lens 2 (Module boundaries) — findings added
