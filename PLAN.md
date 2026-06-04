# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-04T07:10:00Z
Last run: #152 — Lens: Module boundaries

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
### Run #152 — 2026-06-04 — Lens: Module boundaries
**Scope:** Twelfth module boundaries pass. Files examined in full: `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/context.py` (lines 315–490); `geointellisense-analytics/app/routes/fires.py` (lines 1–60); `geointellisense-analytics/app/routes/inversion.py` (lines 60–80); `geointellisense-analytics/app/main.py` (lines 1–50); `hooks/useRealtimeAQI.ts` (lines 1–35); `hooks/useApiStatus.ts`; `components/3d/CityMarkers.tsx` (lines 1–50); `components/3d/index.ts`; `contexts/UserPreferencesContext.tsx` (lines 1–10); `services/dataService.ts`; `services/aiService.ts`; `components/Dashboard.tsx` (imports); `components/AnalysisView.tsx` (imports). Grep scans for `from app.routes` in Python analytics, `from.*components` in hooks, `dashboardData` imports across all TS/TSX files, and cross-layer import patterns. Cross-checked against Active Recommendations and Latest Findings runs #149–#151 plus archived Module Boundaries lens runs #2, #17, #32, #47, #62, #77, #92, #107, #122, #137 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/claude.py:103,116` + `geointellisense-analytics/app/context.py:323,471` — The service layer imports from route handler modules, inverting the correct dependency direction. Specifically: `claude.py:103` (`get_system_with_live_context` fallback) and `claude.py:116` (`get_system_with_fire_context`) both do `from app.routes.fires import get_current_smoke_context`; `context.py:323` likewise imports `from app.routes.fires import get_current_smoke_context`; and `context.py:471` imports `from app.routes.inversion import get_current_inversion`. The expected layer order is: `routes` → `services/claude.py` + `context.py` → `clients` + `database`. Having `claude.py` and `context.py` import *up* into `routes` creates a latent circular-import risk: any future route that imports from `app.claude` (e.g., for a per-route Claude call) would immediately create an import cycle and crash FastAPI startup. The root cause is that in-memory polling state (`_smoke_context: str = ""` at `fires.py:22`; the equivalent in `inversion.py`) is stored inside the route files rather than in a shared state module. The fix is to move these module-level state variables and their read accessors (`get_current_smoke_context`, `get_current_inversion`) to a new `app/state.py` module; route pollers write to `state.py`, and service modules (`claude.py`, `context.py`) import from `state.py` — a module with no route dependencies. PROPOSAL: Create `geointellisense-analytics/app/state.py` with `smoke_context: str` and `inversion_status: dict | None` variables and their accessors; update `fires.py` and `inversion.py` to write to `state.py`; update `claude.py:103,116` and `context.py:323,471` to import from `state.py` instead of route modules — H/L effort (5-6 small file edits).

- OBSERVATION: `geointellisense-analytics/app/claude.py:217-272` — `execute_tool()` calls its own FastAPI endpoints via `httpx` rather than calling the underlying service functions directly. All five tool branches dispatch through `http://localhost:{settings.port}/api/...` (or `http://localhost:3001/api/...` for the AQI fallback). For example, `get_air_quality` calls `GET /api/aqi-snapshot` which is a Rust ingestion service endpoint; `get_active_fires` calls `GET /api/fires/active`; `get_earthquakes` calls `GET /api/earthquakes/recent`. This self-HTTP pattern has three concrete costs: (a) latency — an extra network round-trip for every tool call in a Claude conversation; (b) silent failure mode — if `settings.port` differs from the bound port, or the server hasn't finished starting up when the first tool call arrives, the tool returns `{"error": "Tool execution failed: ..."}` with no indication of the root cause; (c) architectural coupling — `execute_tool` cannot be unit-tested without a live server, and it hard-codes the port and localhost assumption, making the ingestion service (port 3001) an invisible transitive dependency of any LLM tool-use call. The underlying data is accessible in-process: earthquake data lives in `broadcast.quake_cache` (an `Arc<RwLock<Vec<...>>>` shared into FastAPI state via the ingestion side), fire data is available via `app.clients.nasa_firms.fetch_all_sources`, water data via `app.clients.usgs_water.fetch_current_readings`, and AQI via the analytics DB directly. PROPOSAL: Replace `execute_tool`'s `httpx` calls with direct Python function calls to the analytics-side data access layer (`app.clients.*`, `app.context` helpers, or DB queries); the Rust side data (AQI snapshot) can be proxied via the analytics DB's `sensor_readings` table which is populated by `broadcast.rs:persist::write_readings` — M/M effort (refactor 5 tool branches to call Python functions; small schema for each result format).

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` + `components/3d/CityMarkers.tsx:20` — the `useRealtimeAQI` hook imports a domain type from a component, reversing the correct layer dependency. The file at line 8 does `import type { CityData } from '../components/3d/CityMarkers'`, and then extends it at line 15: `export interface RealtimeCityData extends CityData { ... }`. In a layered frontend architecture, hooks form a lower layer that components depend upon; a hook importing from a component creates a cycle risk (any component in the `components/3d/` subtree that imports from `useRealtimeAQI` now has an indirect self-dependency via `CityMarkers`). `CityData` (`CityMarkers.tsx:20-30`) is a plain data interface — `name: string`, `lat: number`, `lng: number`, `aqi: number`, `pm25: number`, `color: string` — with no Three.js or React-component logic. It belongs in `types.ts` next to `GroundingChunk` and `AnalysisTool`. The `components/3d/index.ts:16` barrel re-exports `CityData`, but this still anchors the type in the component tree. Additionally, `components/AirQualityMapView.tsx:30` also imports `CityData` directly from `components/3d/CityMarkers` — so two consumers already chain through the component file. PROPOSAL: Move `CityData` interface from `components/3d/CityMarkers.tsx:20` to `types.ts`; add a re-export in `components/3d/CityMarkers.tsx` (`export type { CityData } from '../types'` or similar) to avoid breaking `components/3d/index.ts`; update `hooks/useRealtimeAQI.ts:8` and `components/AirQualityMapView.tsx:30` to import from `types.ts` — L/L effort (move interface + update 2 import paths).

- OBSERVATION: `contexts/UserPreferencesContext.tsx:2` + `data/dashboardData.ts` — the `LocationKey` domain type is stranded inside `data/dashboardData.ts` rather than in `types.ts`, forcing 7 separate modules to import from the dashboard data file to obtain this type. The full list of importers: `components/AnalysisView.tsx:32`, `components/CalendarView.tsx:7`, `components/Dashboard.tsx:14`, `components/dashboard/LocationSelector.tsx:2`, `contexts/UserPreferencesContext.tsx:2`, `hooks/useDashboardData.ts:2`, and `services/dataService.ts:4`. The `contexts/UserPreferencesContext.tsx` case is the most problematic boundary violation: the application's global context module (which holds theme, notification settings, language, and location preferences) is import-chained to a 3000+ line mock/seed data file (`data/dashboardData.ts`) solely to obtain the `LocationKey` string union type. Any tree-shaking or code-splitting that removes `data/dashboardData.ts` from the context bundle would require touching all 7 importers. `LocationKey` is a pure type with no runtime value; it should live in `types.ts` alongside `GroundingChunk`. PROPOSAL: Move `LocationKey` (and the `locations` array if it is used as a value by some importers) from `data/dashboardData.ts` to `types.ts`; add re-exports in `data/dashboardData.ts` for backward compatibility; update `contexts/UserPreferencesContext.tsx:2` to import from `types.ts` — L/L effort (move 1-2 declarations + update 7 import paths).

**Proposed actions:**
- Create `geointellisense-analytics/app/state.py` with shared in-memory state (`smoke_context`, `inversion_status`); update `fires.py:22`, `inversion.py` to write to it; update `claude.py:103,116` and `context.py:323,471` to read from `state.py` — H/L effort
- Replace `execute_tool`'s 5 `httpx`-to-self branches (`claude.py:217-272`) with direct calls to analytics-side data access functions — M/M effort
- Move `CityData` from `components/3d/CityMarkers.tsx:20` to `types.ts`; update `hooks/useRealtimeAQI.ts:8` and `components/AirQualityMapView.tsx:30` — L/L effort
- Move `LocationKey` from `data/dashboardData.ts` to `types.ts`; update 7 import paths including `contexts/UserPreferencesContext.tsx:2` — L/L effort

### Run #151 — 2026-06-04 — Lens: Type safety
**Scope:** Eleventh type safety pass. Files examined in full: `data/dashboardData.ts`; `hooks/useDashboardData.ts`; `components/Dashboard.tsx`; `components/3d/AQI3DScene.tsx`; `components/AccessibleChart.tsx`; `components/DataExplorer.tsx`; `components/AnalysisView.tsx`; `types.ts`; `services/dataService.ts`; `tests/security.test.tsx`. Grep scans for `: any`, `as any`, `Record<string, any>`, `useRef<any>`, `result: any`, `entry: any`, and non-null assertion `!` patterns across all `.ts`/`.tsx` files. Cross-checked against Active Recommendations and Latest Findings runs #148–#150 plus archived Type Safety lens runs #1, #16, #31, #46, #61, #76, #91, #106, #121, #136 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `data/dashboardData.ts:195` — `generateDailyForecast(location: string, days: number)` has no explicit return type annotation; TypeScript infers the return as a complex structural object literal type but exposes it to consumers only as a widened implicit type. When `useDashboardData.ts` accesses `locEntry.dailyForecast` (a property inferred from the `dashboardData` const), TypeScript cannot narrow the element type in iteration, causing `(day: any)` to be the only viable annotation at `useDashboardData.ts:179`, `useDashboardData.ts:223`, `useDashboardData.ts:267`, and `useDashboardData.ts:311` — four identical forEach callbacks, each annotating the iteration variable as `any`. This propagates further: `result: any[]` (lines 197, 241, 285, 330) and `entry: any = { month }` (lines 199, 243, 287, 332) are required because the entry object's fields are built from a `day` of unknown type. Root-cause: no `DailyForecastEntry` interface exists in `data/dashboardData.ts`. A single interface definition (`interface DailyForecastEntry { date: string; aqi: number; pm25: number; humidity: number; windSpeed: number; uv: number; ... }`) added to `data/dashboardData.ts` and used as the return type of `generateDailyForecast(): DailyForecastEntry[]` would eliminate all 12 downstream `any` annotations in `useDashboardData.ts` with no behaviour change. PROPOSAL: Export `DailyForecastEntry` interface from `data/dashboardData.ts`; annotate `generateDailyForecast` return type; remove all 12 `any` annotations in `useDashboardData.ts:179,197,199,223,241,243,267,285,287,311,330,332` — L/L effort.

- OBSERVATION: `components/Dashboard.tsx:118,151,177,203,231,257,283,309` + `hooks/useDashboardData.ts:69,108,128,148` — twelve instances of `new Map<string, Record<string, any>>()` used as intermediate chart aggregation structures (day-bucket maps and month-bucket maps). The `Record<string, any>` value type erases the actual shape: in every usage, map values hold `{ [locationName: string]: number }` entries (one numeric reading per location). Concretely, all 12 maps accumulate AQI, PM2.5, humidity, wind speed, UV, or temperature values keyed by location name. This untyped value propagates into non-null assertions: `monthMap.get(monthKey)![record.locationName] = record.avgAqi` appears at `Dashboard.tsx:163`, `189`, `243`, `269`, `295` and `useDashboardData.ts:117`, `137` — seven `!` assertions that suppress TypeScript's knowledge that `.get()` can return `undefined`. Each is safe only because the `set()` call precedes the `get()` within the same loop body, an invariant TypeScript cannot verify and a future refactor could break. Replacing `Map<string, Record<string, any>>` with `Map<string, { [location: string]: number }>` (or a named alias `type LocationValueMap = Map<string, Record<string, number>>`) and replacing `!` with null-coalescing `?? {}` would restore type safety without changing semantics. PROPOSAL: Define `type LocationValueMap = Map<string, Record<string, number>>` in a shared utility or inline; apply to all 12 map declarations; remove 7 non-null assertions by using `?? {}` initialiser guard — M/M effort (12 declarations + 7 assertion removals across 2 files).

- OBSERVATION: `components/AccessibleChart.tsx:66,79,165` — The component's public props interface (inferred from the `AxisConfig` inline object around line 66) includes `format?: (value: any) => string`, and the `data` prop is declared as `Record<string, any>[]` at lines 79 and 165. Since `AccessibleChart` is the shared charting wrapper used throughout the dashboard (AQI trends, weather overlays, comparison charts), every consumer passes chart data as `any`-typed records without compile-time validation. The actual runtime shape of every `data` element is `{ [key: string]: string | number }` — a month/day label string plus one numeric value per active location. Typing the formatter as `(value: string | number) => string` and the data as `Record<string, string | number>[]` (or a `ChartDataPoint` type alias) would catch consumers that pass malformed structures (e.g., nested objects or `undefined` values) at compile time. No call site would require changes since all current callers already pass conforming data. PROPOSAL: Replace `any` in `AccessibleChart.tsx:66` formatter signature and `:79,165` data prop types with `string | number` and `Record<string, string | number>[]` respectively; export a `ChartDataPoint` alias if shared across files — L/L effort.

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `const controlsRef = useRef<any>(null)` is used to hold the Three.js `OrbitControls` instance from `@react-three/drei`. The `@react-three/drei` package (present in `package.json`) exports `OrbitControls` as a React component wrapping `three/examples/jsm/controls/OrbitControls.OrbitControlsImpl`. The canonical typed ref for this is `useRef<OrbitControlsImpl | null>(null)` using the import `import type { OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls'` — or simply the re-export from `@react-three/drei` if available. With `useRef<any>`, any method called on `controlsRef.current` (e.g., `.reset()`, `.saveState()`, `.update()`) has no type checking and no IDE autocomplete. PROPOSAL: Change `useRef<any>(null)` at `AQI3DScene.tsx:57` to `useRef<OrbitControlsImpl | null>(null)` with the appropriate import — L/L effort (1-line change + import).

**Proposed actions:**
- Export `DailyForecastEntry` interface from `data/dashboardData.ts:195`; annotate `generateDailyForecast` return type; drop all 12 `any` annotations in `useDashboardData.ts` (lines 179, 197, 199, 223, 241, 243, 267, 285, 287, 311, 330, 332) — L/L effort
- Define `type LocationValueMap = Map<string, Record<string, number>>`; replace 12 `Record<string, any>` map declarations in `Dashboard.tsx` and `useDashboardData.ts`; remove 7 non-null `.get()!` assertions with `?? {}` guard — M/M effort
- Replace `any` formatter and data-prop types in `AccessibleChart.tsx:66,79,165` with `string | number` and `Record<string, string | number>[]` — L/L effort
- Replace `useRef<any>` at `AQI3DScene.tsx:57` with `useRef<OrbitControlsImpl | null>(null)` — L/L effort

### Run #150 — 2026-06-04 — Lens: Live-time claim audit
**Scope:** Tenth live-time claim audit pass. Files examined in full: `geointellisense-ingestion/src/aqi.rs`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/config.rs`; `geointellisense-ingestion/src/routes/aqi.rs`; `geointellisense-ingestion/src/routes/sse.rs`; `hooks/useRealtimeAQI.ts`; `hooks/useLiveData.ts`; `components/dashboard/LiveDashboard.tsx`; `components/dashboard/WidgetShell.tsx`; `components/dashboard/widgets/AqiGaugeWidget.tsx`; `components/dashboard/widgets/AqiTrendWidget.tsx`; `components/dashboard/widgets/FiresWidget.tsx`; `components/dashboard/widgets/AqiForecastWidget.tsx`; `index.html`; `metadata.json`; `.env.local.example`; `geointellisense-analytics/app/context.py` (lines 1–100). Grep scans for "live", "real-time", "mock", "generate" across all TS/Rust/Python. Cross-checked against Active Recommendations and Latest Findings runs #147–#149 plus archived Live-time lens runs #135, #120, #105, #90, #75, #60, #45, #30, #15 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:107` + `geointellisense-ingestion/src/routes/aqi.rs:24` — Both the SSE broadcaster and the REST `/api/aqi-snapshot` endpoint overwrite every sensor reading's original `timestamp` field with `Utc::now()` before sending data to clients. In the broadcast loop (interval default 5 seconds from `config.rs:32`), `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() })` stamps cached readings — which are up to 600 seconds (10 min) old under the default `purpleair_interval_secs = 600` — with the current clock time. The REST snapshot at `aqi.rs:24` does the same: `aqi::AqiReading { timestamp: now, ..r.clone() }`. `WidgetShell.tsx:44-48` renders `lastUpdated.toLocaleTimeString()` as the widget's "last updated" label. `useLiveData.ts:75` sets `lastUpdated = new Date()` on each successful fetch. The result: the "Air Quality Index" widget (`AqiGaugeWidget.tsx`) shows a timestamp that refreshes every 30 seconds (`useLiveData.ts:128`) giving the impression sensor data was just measured, while the underlying PurpleAir sensor values are up to 10 minutes old. No field in the API response carries the actual measurement timestamp. The original `AqiReading.timestamp` field value (the time data was written to the cache by the PurpleAir fetcher task at `broadcast.rs:88`) is discarded before clients see it. PROPOSAL: Preserve the original PurpleAir fetch timestamp in a separate `sensorTimestamp` field on the `AqiReading` struct and include it in both the SSE event payload and REST snapshot response; update `WidgetShell`/`AqiGaugeWidget` to display sensor age ("data from 8 min ago") alongside the fetch time — M/L effort (Rust struct change + frontend display update).

- OBSERVATION: `geointellisense-analytics/app/context.py:20` vs `geointellisense-ingestion/src/config.rs:27` — `context.py` declares `SOURCE_INTERVALS = {"purpleair": 120, ...}` meaning it expects PurpleAir to update every 2 minutes; the staleness threshold is `interval * 2 = 240 seconds` (line 44: `stale = age_seconds > interval * 2`). However, `config.rs:27` defaults `purpleair_interval_secs = 600` (10 minutes), and `docker-compose.yml` passes `PURPLEAIR_INTERVAL_SECS: ${PURPLEAIR_INTERVAL_SECS:-600}`. Under the default configuration, PurpleAir data will be marked "STALE" in Claude's system prompt at t+240s after any fetch, and continue appearing stale for the remaining 360s until the next fetch — meaning Claude sees the AQI data as stale for 60% of the 600-second fetch cycle. `context.py:185-188` appends "⚠ IMPORTANT: Stale data sources may not reflect current conditions. Caveat any analysis that depends on stale sources." to every Claude system prompt when any source is stale. Because `purpleair` is stale 60% of the time under default config, Claude will routinely add staleness caveats to AQI analysis in responses — contradicting the "Real-time AQI and PM2.5 levels" promise in `components/Dashboard.tsx:367` and "Live AQI" in `index.html:6`. PROPOSAL: Synchronise `context.py:20` to `"purpleair": 600` (matching the actual default fetch interval) so staleness is only flagged when data is genuinely overdue (>1200 seconds); alternatively add a `PURPLEAIR_CONTEXT_INTERVAL_SECS` env var so the freshness threshold tracks the configured fetch interval at runtime — L/L effort.

- OBSERVATION: `geointellisense-ingestion/src/routes/aqi.rs:64-73` + `geointellisense-ingestion/src/aqi.rs:138-162` — the `GET /api/aqi-history` endpoint handler (`aqi.rs:64-73`) calls `aqi::generate_history(station_id, hours)` unconditionally with no database query. `generate_history()` (`aqi.rs:138-162`) is a pure synthetic random-walk generator: it creates `hours * 12` data points using `rand::Rng` values around a hard-coded `base_aqi` (85.0 for station `0002`, 60.0 for all others), with no access to TimescaleDB. Meanwhile, `broadcast.rs:115` calls `persist::write_readings(&pool, &readings).await` every 5 seconds, writing real sensor readings (PurpleAir or mock) to the database. TimescaleDB accumulates this history, but the `/api/aqi-history` endpoint never queries it. `AqiTrendWidget.tsx:21` fetches `/api/aqi-history?station_id=AQ-001&hours=24` every 120 seconds and renders the result as the "AQI Trend (24h)" chart on the `LiveDashboard` — which carries the heading "Real-time environmental monitoring for the San Joaquin Valley" (`LiveDashboard.tsx:17`). The entire 24-hour trend chart displayed prominently on the live dashboard is entirely fabricated synthetic data. PROPOSAL: Replace `history()` in `routes/aqi.rs` with a TimescaleDB query (e.g., `SELECT time_bucket('5 minutes', time) AS bucket, ROUND(AVG(aqi)) AS aqi, ROUND(AVG(pm25)::numeric, 1) AS pm25 FROM sensor_readings WHERE location_id = $1 AND time >= now() - $2 * interval '1 hour' GROUP BY bucket ORDER BY bucket`) using the real `persist`-written data — M/M effort (Rust route + query, requires passing pool to the handler).

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:49-95` + `.env.local.example:5` + `geointellisense-ingestion/src/aqi.rs:130` + `components/dashboard/widgets/AqiGaugeWidget.tsx:67` — when `PURPLEAIR_API_KEY` is absent or empty, `config.rs:22-24` sets `purpleair_api_key = None` and `broadcast.rs:49` skips spawning the PurpleAir polling task entirely. The `LiveCache` (`cache`) remains `None`. Every broadcast tick then falls back to `aqi::generate_readings(&stations)` (`broadcast.rs:111`) which creates fully synthetic data with `source: "mock"` (`aqi.rs:131`). The REST snapshot handler `aqi.rs:26-29` has the identical fallback. `.env.local.example:5` ships `PURPLEAIR_API_KEY=` (empty), marking it "Optional". New deployments following only the README instructions (which only require `ANTHROPIC_API_KEY` and `GOOGLE_MAPS_API_KEY`) will serve mock AQI data indefinitely. In `AqiGaugeWidget.tsx:67`, the source badge for `source === 'mock'` evaluates to an empty string (`r.source === 'purpleair' ? 'PA' : r.source === 'airnow' ? 'EPA' : ''`) — no badge is shown, making mock readings visually indistinguishable from live sensor data. The "Live Dashboard" heading and `index.html:6` meta description "Live AQI, weather, fire detection, and groundwater data" are materially false when `PURPLEAIR_API_KEY` is absent. PROPOSAL: Add a visible "Demo Data" or "Simulated" banner/badge in `AqiGaugeWidget.tsx` (and `LiveDashboard.tsx`) when `source === 'mock'`; update the README to call out that the PURPLEAIR_API_KEY is required for actual live AQI; consider adding a `REACT_APP_MOCK_MODE` flag or a `/api/data-status` endpoint the frontend can query to know whether real sensor data is available — L/L effort.

**Proposed actions:**
- Preserve original PurpleAir fetch timestamp in a `sensorTimestamp` field on `AqiReading`; display data age in `AqiGaugeWidget` ("data from Xm ago") — `broadcast.rs:107`, `aqi.rs:24` — M/L effort
- Set `context.py:20` `"purpleair"` interval to 600 (matching `config.rs` default) to stop falsely flagging AQI as stale 60% of the time under default config — L/L effort
- Replace mock `generate_history()` call in `routes/aqi.rs:64-73` with a TimescaleDB time-bucket query against real `sensor_readings` data — M/M effort
- Add visible "Simulated" badge to `AqiGaugeWidget.tsx:67` when `source === 'mock'`; document `PURPLEAIR_API_KEY` as required for live data in README — L/L effort

## 📚 Archive (one line per past run)
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
