# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T04:20:00Z
Last run: #48 — Lens: Dependency health

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
### Run #48 — 2026-05-30 — Lens: Dependency health
**Scope:** Fourth dependency-health pass. Examined: `package.json`, `package-lock.json`, `geointellisense-analytics/requirements.txt`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-ingestion/Cargo.lock`, `geointellisense-ingestion/Dockerfile`, `vite.config.ts`, `geointellisense-analytics/app/ml/aqi_model.py`, `geointellisense-ingestion/src/aqi.rs`. Cross-referenced archived findings from runs #3, #18, #33 (one-line summaries only) — full detail unavailable; findings below verified as new against visible prior runs.

**Findings:**

- OBSERVATION: `package.json:16` — `"@googlemaps/markerclusterer": "latest"` uses the npm `latest` dist-tag instead of a semver range. The `package-lock.json` currently resolves this to 2.6.2 (with an integrity hash), so the current install is deterministic. However, the `latest` tag creates three risks: (a) any CI run that regenerates `package-lock.json` (e.g. `npm install --no-frozen-lockfile`) will silently upgrade to whatever `@googlemaps/markerclusterer@latest` resolves to at that moment — potentially a breaking major version; (b) automated update tools (Renovate, Dependabot) cannot compute a version bump PR because there is no semver range to advance; (c) `npm outdated` and `npm audit` treat `latest` pins differently from semver ranges, suppressing upgrade alerts. Every other dependency in `package.json` uses a proper semver range (`^2.x`, `~5.x`); this is the sole outlier. PROPOSAL: Replace `"latest"` with `"^2.6.2"` in `package.json:16` to restore deterministic version semantics while still allowing patch/minor auto-upgrades within the 2.x series.

- OBSERVATION: `geointellisense-analytics/requirements.txt:18` — `joblib>=1.4,<1.5` imposes a strict upper-bound ceiling that creates a latent unsatisfiable-constraint risk. The same file declares `scikit-learn>=1.5,<1.7` (line 17), which in its 1.6.x releases declares a runtime dependency of `joblib>=1.4.0` with no upper bound in its own metadata. If pip installs scikit-learn 1.6.x and also attempts to satisfy the `<1.5` ceiling for joblib, pip selects joblib 1.4.x — which may be removed from PyPI indices at any time (PyPI does not purge packages, but mirrors and private registries sometimes do). More critically, `aqi_model.py` uses `joblib.dump()` to serialize the gradient boosting model to `aqi_gbr.joblib` and `joblib.load()` to reload it. The joblib serialization format can change between minor releases; a model file written with joblib 1.4.x may produce `UserWarning: Trying to unpickle estimator` errors when loaded in an environment where a future pip install resolves to a higher patch. The `<1.5` ceiling appears to have been set defensively but is not documented with any comment explaining why 1.5+ is excluded. PROPOSAL: Remove the `<1.5` ceiling from `requirements.txt:18`; change to `joblib>=1.4` (or `joblib>=1.4.4` to lock in the specific tested patch); add a comment if there is a known incompatibility reason.

- OBSERVATION: `geointellisense-ingestion/Cargo.toml` — `rand = "0.8"` resolves to rand 0.8.5 in Cargo.lock (the final 0.8.x release, no longer receiving new features). rand 0.9 was released in early 2025 with a revised API: `Rng::gen_range()` → `Rng::random_range()`, `rand::thread_rng()` → `rand::rng()`. The 0.8 pin has a concrete ripple effect: rand 0.8.5 depends on `getrandom 0.2.17`, while other dependencies in the same `Cargo.lock` already use `getrandom 0.4.2`. This forces Cargo to compile two versions of `getrandom` simultaneously, and because `getrandom` transitively pulls `windows-sys`, the lock file contains three separate copies of `windows-sys` (0.48.0, 0.52.0, 0.61.2 — visible in `Cargo.lock`). Each copy brings 7 platform-specific companion crates (`windows_aarch64_gnullvm`, `windows_aarch64_msvc`, `windows_i686_gnu`, `windows_i686_msvc`, `windows_x86_64_gnu`, `windows_x86_64_gnullvm`, `windows_x86_64_msvc`), meaning 14 redundant crates are compiled on Windows and downloaded unnecessarily on Linux. The rand API is used in 16 call sites in `aqi.rs` (lines 106, 108, 109, 123–130, 149, 156–157), all using `rng.gen_range(...)`. PROPOSAL: Upgrade `rand` to `"0.9"` in `Cargo.toml`; replace every `rng.gen_range(a..b)` in `aqi.rs` with `rng.random_range(a..b)` and replace the `rand::thread_rng()` call (if present) with `rand::rng()`. This eliminates the `getrandom 0.2` subtree and collapses `windows-sys` from three versions to two.

- OBSERVATION: `package.json` — no `"engines"` field is declared; no `.nvmrc`, `.node-version`, or `.tool-versions` file exists in the repository root. Vite 6.x requires Node.js ≥18.0.0; `@react-three/fiber` 9.x and React 19 both require Node.js ≥18. Without a version constraint, a developer or CI runner on Node.js 16 (still common on some Ubuntu LTS images as the distro default) will silently complete `npm install` but fail at `vite build` or `vitest run` with opaque ESM or `require is not defined` errors rather than a clear "Node.js version X is too old" message. The `package-lock.json` lockfileVersion is 3 (introduced in npm 7 / Node.js ≥15), which provides a minor hint but no hard enforcement. PROPOSAL: Add `"engines": { "node": ">=18.0.0", "npm": ">=9.0.0" }` to `package.json`; add `.nvmrc` containing `18` for `nvm use` convenience in local dev.

- OBSERVATION: `geointellisense-analytics/requirements.txt:15–16` — `scipy>=1.13,<1.15` excludes scipy 1.15.x, which was released in late 2024. scipy 1.15 includes performance improvements to `stats.linregress` and `optimize.minimize` (used in forecasting) and critical bug fixes for sparse array operations. The `<1.15` ceiling means the CI and Docker build will install scipy 1.14.x today, but as scipy 1.14.x's PyPI upload date recedes, mirror freshness issues could emerge. More importantly, the paired constraint `numpy>=1.26,<2.1` (line 15) allows numpy 2.0.x; scipy 1.15 added explicit numpy 2.1 compatibility, which the current `<1.15` ceiling prevents. If numpy is upgraded to 2.1.x (outside the allowed range) the entire geospatial stack (`geopandas`, `rasterio`, `shapely`) would also need re-pinning. The upper bound on scipy is not annotated with any comment explaining why 1.15+ is excluded. PROPOSAL: Update `requirements.txt:16` from `scipy>=1.13,<1.15` to `scipy>=1.13,<1.16`; simultaneously update `numpy` from `<2.1` to `<2.2` to allow coordinated upgrades; add an inline comment if specific scipy 1.15 compatibility was not tested.

**Proposed actions:**
- Replace `"latest"` with `"^2.6.2"` in `package.json:16` for `@googlemaps/markerclusterer` — M/L, score 2.0; does not enter top 10
- Remove `<1.5` ceiling from `requirements.txt:18` (joblib); change to `joblib>=1.4` — M/L, score 2.0; does not enter top 10
- Upgrade `rand` to `"0.9"` in `Cargo.toml`; update 16 `gen_range` call sites in `aqi.rs` to `random_range` — M/M, score 1.0; does not enter top 10
- Add `"engines": { "node": ">=18.0.0" }` to `package.json`; add `.nvmrc` — M/L, score 2.0; does not enter top 10
- Relax `scipy<1.15` ceiling to `<1.16` in `requirements.txt:16`; align `numpy<2.1` to `<2.2` — M/L, score 2.0; does not enter top 10

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

## 📚 Archive (one line per past run)
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
