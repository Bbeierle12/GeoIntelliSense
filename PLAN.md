# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-29T12:10:00Z
Last run: #32 — Lens: Module boundaries

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
### Run #32 — 2026-05-29 — Lens: Module boundaries
**Scope:** Second module-boundaries pass. All TypeScript files under `hooks/`, `services/`, `contexts/`, `components/3d/`, `data/`; all Python files under `geointellisense-analytics/app/` including `claude.py`, `context.py`, `routes/fires.py`, `routes/inversion.py`; Rust module declarations in `geointellisense-ingestion/src/`. Cross-referenced against prior run #2 and run #17 findings (archived).

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/claude.py:103,116` and `geointellisense-analytics/app/context.py:323,471` — Both `claude.py` (the core AI/LLM wrapper) and `context.py` (the live-data context builder) contain lazy imports that reach upward into the HTTP route layer: `from app.routes.fires import get_current_smoke_context` appears at `claude.py:103`, `claude.py:116`, and `context.py:323`; `from app.routes.inversion import get_current_inversion` appears at `context.py:471`. The functions `get_current_smoke_context()` (`fires.py:25-27`) and `get_current_inversion()` (`inversion.py:66-68`) are single-line getters for module-level polling-state variables (`_smoke_context: str = ""` and `_current_status: dict | None = None`) that background asyncio tasks write to. The domain logic these getters expose — "most recently polled fire/inversion state" — belongs in a shared lower-level module (e.g., `polling_state.py`), not inside FastAPI route files. The lazy-import workaround masks a structural violation: utility modules (`context.py`, `claude.py`) should never depend on route modules. If `routes/fires.py` were split or renamed in a future refactor, the silent `except ImportError: pass` guards in `claude.py:107` and `claude.py:120` would suppress the breakage, leaving the AI with no fire context and no error log. Fix: create `geointellisense-analytics/app/polling_state.py` with `_smoke_context: str = ""` and `_inversion_status: dict | None = None` plus their getter/setter functions; update `routes/fires.py` and `routes/inversion.py` to call the setters; update `claude.py` and `context.py` to import from `polling_state.py`.

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` — `import type { CityData } from '../components/3d/CityMarkers'`. In React's architectural convention, the hook layer (data/business logic) sits below the component layer (rendering). This import is inverted: a hook depends on a type declared inside a 3D rendering component. At `useRealtimeAQI.ts:15`, the hook further extends it: `export interface RealtimeCityData extends CityData { ... }`, making `CityData` part of the hook's public API contract. `CityData` is a pure domain interface (`{ id, name, lat, lng, aqi, temperature?, humidity?, windSpeed?, pm25? }`) with no Three.js or rendering concern; it belongs in `types.ts` alongside `ChatMessage`, `GroundingChunk`, and other domain types. Its current location in `CityMarkers.tsx` is incidental — it was defined there because `CityMarkers` was the first consumer. Meanwhile `AirQualityMapView.tsx:30` imports `CityData` via the `./3d` barrel index (correct path), while the hook bypasses the barrel and imports directly from the source file, creating two different import paths for the same symbol. Fix: move `CityData` to `types.ts`; update `useRealtimeAQI.ts:8` to `import type { CityData } from '../types'`; update `components/3d/CityMarkers.tsx` to `import type { CityData } from '../../types'`; update the `./3d/index.ts` barrel re-export to `export type { CityData } from '../../types'`.

- OBSERVATION: `contexts/UserPreferencesContext.tsx:2` — `import { LocationKey } from '../data/dashboardData'`. `LocationKey` is defined as `type LocationKey = keyof typeof dashboardData` at `data/dashboardData.ts:338`, which derives the type from the object's keys at compile time. This means any module that imports `UserPreferencesContext` (or calls `useUserPreferences()`) transitively depends on `data/dashboardData.ts` — a 300+ line module that exports a large static object containing mock AQI readings, forecast arrays, and weather data for all locations. The bundler must include this entire module in any chunk that uses the preferences context, bloating every page that applies theme or notification settings. There are currently 8 files importing from `dashboardData` across `components/`, `services/`, `hooks/`, and `contexts/` — the `contexts/` import is the most architecturally incorrect because context is framework infrastructure, not feature data. Fix: declare `LocationKey` explicitly as a string union in `types.ts` (e.g., `export type LocationKey = 'Valley Average' | 'Bakersfield' | 'Fresno' | 'Visalia' | 'Merced' | 'Modesto' | 'Stockton'`); annotate `dashboardData` with `Record<LocationKey, ...>` to preserve type safety; update `contexts/UserPreferencesContext.tsx:2` to import from `'../types'`.

- OBSERVATION: `services/dataService.ts:4` and `services/dataService.ts:274` — `dashboardData` is imported both statically (`import { dashboardData, cityLocations } from '../data/dashboardData'` at line 4) and again via a redundant dynamic import (`const { dashboardData, cityLocations } = await import('../data/dashboardData')` at line 274 inside `getLocations()`). ES modules are singletons — the dynamic import at runtime resolves to the already-loaded module instance, so the dynamic call is a no-op that returns the same object references already available at the top of the file. The redundancy makes `getLocations()` appear to be loading the module asynchronously on demand (as one might do for code splitting), but it is not — the `// Keep for fallback` comment on line 4 documents that both import sites are intentional, making the architecture harder to reason about. Any developer reading `getLocations()` in isolation will assume it performs lazy loading and will not look for the top-level import. Fix: remove the `await import()` call at line 274; replace with direct references to the module-level `dashboardData` and `cityLocations` bindings already available from line 4.

**Proposed actions:**
- Create `polling_state.py` with `_smoke_context`/`_inversion_status` state; update `routes/fires.py`, `routes/inversion.py`, `claude.py`, `context.py` to use it — M/L, score 2.0; does not displace existing top 10
- Move `CityData` to `types.ts`; update `useRealtimeAQI.ts:8`, `CityMarkers.tsx`, and `./3d/index.ts` barrel — L/L, score 1.0; does not enter top 10
- Declare `LocationKey` as an explicit string union in `types.ts`; remove import from `UserPreferencesContext.tsx:2` — M/M, score 1.0; does not enter top 10
- Remove redundant `await import('../data/dashboardData')` in `dataService.ts:274`; use top-level bindings — L/L, score 1.0; does not enter top 10

### Run #31 — 2026-05-29 — Lens: Type safety
**Scope:** Third type-safety pass. All `.ts` and `.tsx` files under `services/`, `hooks/`, `components/`, `data/`, and `utils/` (excluding `node_modules`, test files). Focus on `any` usages, unsafe casts, missing return type annotations, and non-null assertions not covered by runs #1 and #16. Cross-referenced tsconfig.json.

**Findings:**

- OBSERVATION: `data/dashboardData.ts:195` — `generateDailyForecast(location, days)` has no explicit return type annotation. It returns an inferred anonymous object array whose shape includes a nested `wind: { speed, gust, direction }` object, `uv`, `evapotranspiration`, `solarRadiation`, and `hourlyData`. Because no `DailyForecastEntry` interface is declared, every call site in `useDashboardData.ts` (lines 179, 223, 267, 311) and `components/Dashboard.tsx` (lines 118, 151, 177, 203, 231, 257, 283, 309) must cast `day: any` to avoid TypeScript narrowing errors, and must use `Map<string, Record<string, any>>` for chart entries. This is the root cause of 14 `any`-annotated `day` / `entry` / `result` variables spread across two files. If `evapotranspiration` were renamed to `et0` in `generateDailyForecast`, `useDashboardData.ts:322` (`day.evapotranspiration`) silently returns `undefined`, the monthly et0 aggregation sums to `NaN`, and the agricultural chart renders empty bars with no compile-time error. Fix: declare `interface DailyForecastEntry { date: string; dayOfWeek: string; temp: { current: number; min: number; max: number; feelsLike: number }; humidity: number; dewPoint: number; pressure: number; wind: { speed: number; gust: number; direction: string }; uv: number; precipitation: { probability: number; amount: number; type: string }; cloudCover: number; visibility: number; solarRadiation: number; evapotranspiration: number; moonPhase: number; sunrise: string; sunset: string; dayLength: number; condition: string; aqi: number; pm25: number; hourlyData: HourlyEntry[] }` in `dashboardData.ts` and annotate the return type of `generateDailyForecast` as `DailyForecastEntry[]`; then remove the `any` casts in `useDashboardData.ts` and `Dashboard.tsx`.

- OBSERVATION: `services/aiService.ts:22,44,66,88,110,146,180` — All 7 AI endpoint wrapper functions call `const data = await response.json()` (TypeScript type: `Promise<any>`) and immediately access `data.text` or `data.groundingChunks` without any typed response interface. The `getChatResponse` return type `Promise<string>` is satisfied even if `data.text` is `undefined` at runtime, because `undefined` is assignable to `string` under the implicit-any rule (tsconfig has no `strict: true`). A backend change from `{ text: "..." }` to `{ answer: "..." }` causes every chat message to display `undefined` in the UI with no compile-time signal. No `interface ChatApiResponse`, `GroundedSearchApiResponse`, or similar is declared anywhere in `aiService.ts`. Fix: add typed response interfaces (e.g., `interface ChatApiResponse { text: string }`; `interface GroundedSearchApiResponse { text: string; groundingChunks: GroundingChunk[] }`) and annotate each `data` variable; import `GroundingChunk` already defined in `types.ts` which is only imported for the return type but not used to type intermediate `data`.

- OBSERVATION: `services/AirQualityService.ts:46-47` and `services/WeatherService.ts:62-63` — Both services parse the `/api/aqi-snapshot` response via `const data = await response.json()` (type `any`) and immediately assign `data.readings as SnapshotReading[]`. The `as` assertion is applied to an `any`-typed expression, making it a no-op safety check — TypeScript accepts `null as SnapshotReading[]` without complaint. When PurpleAir is unreachable and the ingestion service returns `{ readings: null, stationCount: 0 }` (a documented fallback path in `broadcast.rs`), `this.cachedReadings` is set to `null`, and the subsequent `readings.reduce(...)` at `AirQualityService.ts:56` and `WeatherService.ts:72` throws `TypeError: Cannot read properties of null (reading 'reduce')`, crashing the AQI and weather tiles for the session. Fix: add an Array check before the assignment: `if (!Array.isArray(data?.readings)) throw new Error('Unexpected snapshot shape: readings is not an array'); this.cachedReadings = data.readings as SnapshotReading[];`.

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `const controlsRef = useRef<any>(null)` for the `OrbitControls` instance. The `@react-three/drei` package ships TypeScript declarations via `@types/three` and its own `OrbitControls` re-export; the correct ref type is `React.ElementRef<typeof OrbitControls>` which resolves to `OrbitControlsImpl` from `three-stdlib`. At line 70, `controlsRef.current.getTarget(target)` — if `@react-three/drei` changes the method name or argument signature in a minor version update, the call silently fails at runtime (the `any` type prevents TypeScript from catching it). Fix: replace `useRef<any>` with `useRef<React.ElementRef<typeof OrbitControls>>(null)` and import `OrbitControls` type from `@react-three/drei`.

- OBSERVATION: `components/DataExplorer.tsx:42` — Component declares `data: Array<Record<string, any>>` as a prop type for its internal data table. Every chart data array flowing from `useDashboardData` and `dataService` through this component has its value types erased to `any`. A column renderer accessing `row.aqi` would not be flagged if `aqi` was renamed to `aqiValue` anywhere upstream. `Record<string, string | number>` would be a strictly narrower type that still supports the dynamic key pattern while preventing accidental passage of nested objects or React elements as chart cell values. Fix: change the prop type to `data: Array<Record<string, string | number>>` and update all push/assign sites to match.

**Proposed actions:**
- Declare `DailyForecastEntry` interface in `dashboardData.ts:195`; annotate `generateDailyForecast` return type; remove 14 `any` casts in `useDashboardData.ts` and `Dashboard.tsx` — M/M, score 1.0; does not enter top 10
- Add typed response interfaces for all 7 AI API functions in `aiService.ts` — M/M, score 1.0; does not enter top 10
- Add `Array.isArray(data?.readings)` guard before `as SnapshotReading[]` in `AirQualityService.ts:47` and `WeatherService.ts:63` — H/L, score 3.0; ties current top 10, does not displace
- Replace `useRef<any>` with `useRef<React.ElementRef<typeof OrbitControls>>` in `AQI3DScene.tsx:57` — L/L, score 1.0; does not enter top 10
- Narrow `DataExplorer.tsx:42` prop type from `Array<Record<string, any>>` to `Array<Record<string, string | number>>` — L/L, score 1.0; does not enter top 10

### Run #30 — 2026-05-29 — Lens: Live-time claim audit
**Scope:** Second pass. All files relevant to the "live-time" data pipeline: `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-analytics/app/context.py`, `components/AirQualityMapView.tsx`, `components/dashboard/widgets/AqiTrendWidget.tsx`, `hooks/useRealtimeAQI.ts`, `db/migrations/002_sensor_readings.sql`, `db/migrations/006_sensor_readings_source.sql`. Prior Run #15 findings excluded from re-reporting.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/routes/aqi.rs:64-72` — The `/api/aqi-history` route handler calls `aqi::generate_history(&params.station_id, hours)` unconditionally. `generate_history()` (defined in `aqi.rs:138-162`) is a pure random walk: it seeds a `base_aqi` of 85.0 if the `station_id` string contains `"0002"`, and 60.0 for all other IDs, then applies ±5 random steps per 5-minute point across the requested window. The `sensor_readings` TimescaleDB hypertable — populated by `broadcast.rs:persist::write_readings()` every 5 seconds — is never queried. Additionally, `AqiTrendWidget.tsx:21` hard-codes `station_id=AQ-001`, which is not a valid UUID and matches the 60-AQI fallback path. The resulting 24-hour AQI trend chart displayed on the dashboard is entirely fabricated: even when the live SSE stream delivers genuine PurpleAir readings that are persisted to the DB, the trend chart shows only synthetic data. Fix: replace `aqi::generate_history()` in the route handler with a DB query: `SELECT time, aqi, pm25 FROM sensor_readings WHERE location_id = $1 AND time > now() - interval '$2 hours' ORDER BY time ASC`; pass the correct station UUID; fall back to `generate_history()` only when the table returns zero rows.

- OBSERVATION: `geointellisense-analytics/app/context.py:204` — `_get_aqi_context()` issues the query `SELECT … sr.category … FROM sensor_readings sr`. The `sensor_readings` schema (defined by `db/migrations/002_sensor_readings.sql` and extended by `006_sensor_readings_source.sql`) has no `category` column — the `AqiReading` Rust struct carries `category` in memory but `persist.rs:5-35` never writes it. PostgreSQL raises `column "sr.category" does not exist`; the `except Exception as e: logger.warning(...)` block at line 223 silently swallows the error; `readings` stays `[]` and `last_updated` stays `None`. The function returns `{"readings": [], "freshness": {"status": "unavailable"}, "_source": "purpleair"}` on every call. `build_context_text()` (called by every AI route) therefore always presents the AI with an empty AQI section, directly negating the stated purpose of the live context builder: *"Assembles a snapshot of all available real-time and recent data so Claude can reason from LIVE conditions"* (`context.py:1-6`). Fix: remove `sr.category` from the SELECT; derive category in Python from the returned `aqi` integer using EPA breakpoints (e.g., `"Good" if aqi <= 50 else "Moderate" if aqi <= 100 else ...`).

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:106-109` — The AQI broadcast ticker fires every `broadcast_interval_secs` (default 5 s). When PurpleAir cache is populated it re-stamps every cached reading with `timestamp: now` before broadcasting: `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()`. The PurpleAir fetcher polls at `purpleair_interval_secs` (default 600 s). This means SSE `aqi-update` events carry a freshly-minted timestamp every 5 seconds even though the underlying sensor values may be up to 600 seconds old. `useRealtimeAQI.ts:339` calls `setLastUpdate(new Date())` on every SSE event; `AirQualityMapView.tsx:413-416` then renders `{isConnected ? '🔴 Live' : 'Last Updated'} {lastUpdate.toLocaleTimeString()}` — showing e.g. "🔴 Live 10:05:32" when the PurpleAir measurements are from 10:00:00. Fix: add a `sensorDataAgeMs` field to the broadcast payload (current time minus the last successful PurpleAir fetch time, tracked in a shared `AtomicI64`); surface it in the UI as "Sensor data: Xs old" when `sensorDataAgeMs > 60_000`.

- OBSERVATION: `geointellisense-analytics/app/context.py:19-27` — `SOURCE_INTERVALS["purpleair"]` is hardcoded to `120` (2 minutes). `_freshness()` marks data stale when `age_seconds > interval * 2`, i.e., after 240 seconds. But `geointellisense-ingestion/src/config.rs:27` defaults `purpleair_interval_secs` to `600` (10 minutes), documented inline as *"PurpleAir free tier is 1000 pts/day."* Under normal operating conditions, AQI data age will be 0–600 seconds; `_freshness()` declares it stale at 241 seconds. Claude's system prompt will say `status: "stale"` for roughly 60% of the PurpleAir polling window, causing the model to hedge with "data may not be current" even when the sensor just updated 5 minutes ago — which is entirely within spec. Fix: read `SOURCE_INTERVALS["purpleair"]` from an env var `PURPLEAIR_INTERVAL_SECS` with the same default as the Rust config (600), so both services share the same polling cadence assumption.

- OBSERVATION: `components/AirQualityMapView.tsx:177` — The city marker popup tooltip reads `"Real-time data from EPA monitoring station."` The real-time SSE stream (`/api/aqi-stream`) is sourced exclusively from PurpleAir sensor readings when `PURPLEAIR_API_KEY` is configured, or from `aqi::generate_readings()` (random mock) when it is not. EPA AQS data is only accessed by the Python analytics client `clients/epa_aqs.py` for historical analysis; it does not feed the SSE stream or the 3D map markers. The `AqiReading.source` field (`"purpleair"` or `"mock"`) is correctly serialized in the SSE event payload but is silently dropped during parsing in `useRealtimeAQI.ts:308-321` (no `source` field is mapped to the `RealtimeCityData` interface). Consequently, users viewing the map tooltip always see an attribution that is factually incorrect regardless of the active data source. Fix: map `source` from the SSE payload into `RealtimeCityData`; render `"PurpleAir sensor network"` when `source === "purpleair"`, `"Simulated data"` when `source === "mock"`, removing the false EPA attribution.

**Proposed actions:**
- Replace mock `generate_history()` call in `routes/aqi.rs:64` with a DB query against `sensor_readings`; update `AqiTrendWidget.tsx:21` to use a valid station UUID — H/L, score 3.0; ties current top 10, does not displace
- Remove `sr.category` from `context.py:204` SELECT; compute category from `aqi` in Python — H/L, score 3.0; ties current top 10, does not displace
- Add `sensorDataAgeMs` to SSE broadcast payload in `broadcast.rs`; surface as "Sensor data: Xs old" in `AirQualityMapView.tsx:413-416` — M/L, score 2.0; does not enter top 10
- Set `SOURCE_INTERVALS["purpleair"]` in `context.py:19` from env var `PURPLEAIR_INTERVAL_SECS` defaulting to 600 — M/L, score 2.0; does not enter top 10
- Map `source` from SSE payload into `RealtimeCityData`; replace false "EPA" tooltip at `AirQualityMapView.tsx:177` with source-accurate label — M/L, score 2.0; does not enter top 10

## 📚 Archive (one line per past run)
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
