# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-04T08:05:00Z
Last run: #153 — Lens: Dependency health

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
### Run #153 — 2026-06-04 — Lens: Dependency health
**Scope:** Thirteenth dependency health pass. Files examined in full: `package.json`; `package-lock.json` (selected entries); `geointellisense-analytics/requirements.txt`; `geointellisense-analytics/Dockerfile`; `geointellisense-ingestion/Cargo.toml`; `geointellisense-ingestion/Cargo.lock` (selected entries); `geointellisense-ingestion/src/aqi.rs` (lines 1–165); `vite.config.ts`. Cross-checked against Active Recommendations and Latest Findings runs #150–#152 plus archived Dependency Health lens runs #3, #18, #33, #48, #63, #78, #93, #108, #123, #138 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `package.json` — `"@googlemaps/markerclusterer": "latest"` uses the `latest` dist-tag as its version specifier, making it the only dependency in the entire file not pinned to a semver range. Every other package uses `^x.y.z` or `~x.y.z` (e.g., `"@react-three/drei": "^10.7.7"`, `"react": "^19.2.0"`). The `latest` tag resolves at install time to whatever the current dist-tag points to on the npm registry, meaning `npm install` (not `npm ci`) will silently upgrade this package to any future major version. The lockfile currently pins it to `2.6.2` (confirmed in `package-lock.json`), so `npm ci` in CI is safe today — but any developer or automated dependency-update tool running `npm install` without `--prefer-dedupe` or with a stale lock file will silently advance to the newest version, potentially pulling in a major-version breaking change. The `@googlemaps/markerclusterer` package uses Google Maps Marker Clustering API; a v3 (if released) would likely change the constructor and cluster algorithm API. No other dependency in the file uses `latest`. PROPOSAL: Change `"@googlemaps/markerclusterer": "latest"` to `"@googlemaps/markerclusterer": "^2.6.2"` in `package.json` to match the lockfile-pinned version and bring it in line with all other dependency specifiers — L/L effort (1-line change + confirm `npm ci` still passes).

- OBSERVATION: `geointellisense-ingestion/Cargo.toml` specifies `rand = "0.8"`, which resolves to `rand 0.8.5` (the final 0.8 release) in `Cargo.lock`. The rand crate released 0.9.0 in January 2025 with breaking API changes: `rand::thread_rng()` was removed and replaced by `rand::rng()`; the `Rng::gen_range()` method was renamed to `Rng::random_range()`; and the `use rand::Rng` import remains but the trait methods changed. In `aqi.rs`, the deprecated API is used at 15 call sites: `rand::thread_rng()` appears at lines `100` and `139`; `.gen_range(...)` appears at lines `106`, `108`, `109`, `123–130`, `149`, `156–160`. rand 0.8.5 receives no further maintenance; all new rand bug fixes and security patches target 0.9+. The ecosystem risk is concrete: if any future dependency in `Cargo.toml` — for example an upgrade to `redis = "0.28"` or a new crate — pulls in `rand` as a transitive dep with `^0.9`, Cargo will be forced to build two incompatible rand versions simultaneously (SemVer allows it, but it adds ~200KB to the binary and causes subtle issues when rand types from 0.8 and 0.9 are mixed across crate boundaries). PROPOSAL: Bump `rand = "0.8"` to `rand = "0.9"` in `Cargo.toml`; update `aqi.rs:100,139` from `rand::thread_rng()` to `rand::rng()`; rename `.gen_range()` to `.random_range()` at all 13 call sites in `aqi.rs` — L/M effort (Cargo.toml change + 15 targeted line edits + `cargo test`).

- OBSERVATION: `geointellisense-analytics/requirements.txt` pins `joblib>=1.4,<1.5` and `scipy>=1.13,<1.15` with upper-bound caps that now block released versions. joblib 1.5.0 was released in May 2025; scipy 1.15.0 was released in January 2025. As of June 2026, `pip install -r requirements.txt` will resolve joblib to the newest `1.4.x` release and scipy to the newest `1.14.x` release — both missing more than a year of patches and improvements. The joblib constraint directly affects `geointellisense-analytics/app/ml/aqi_model.py:22`, which uses `joblib.load` and `joblib.dump` to persist the `GradientBoostingRegressor` model at `MODEL_PATH` (`/app/data/models/aqi_gbr.joblib`). joblib 1.5 includes fixes for memory leaks in the multiprocessing backend and improved pickling stability for scikit-learn estimators. The scipy constraint affects `app/clients/landsat.py:255` which calls `scipy.ndimage.zoom` for raster image resampling; scipy 1.15 includes performance improvements to `ndimage`. The upper bounds also create a future pip-resolution failure risk: if any dependency added to `requirements.txt` later requires `joblib>=1.5` or `scipy>=1.15`, pip will emit an unsatisfiable constraint error and fail the entire install. PROPOSAL: Remove upper bounds — change `joblib>=1.4,<1.5` to `joblib>=1.5` and `scipy>=1.13,<1.15` to `scipy>=1.15`; similarly evaluate the `scikit-learn>=1.5,<1.7` cap (scikit-learn 1.6 was released Dec 2024, 1.7 may be released soon); run `pip install -r requirements.txt` in a fresh venv to confirm compatibility — L/L effort (3-line requirements.txt edit + Docker rebuild test).

- OBSERVATION: `geointellisense-analytics/Dockerfile:1` uses `FROM python:3.12-slim` — a floating minor-version tag — while `geointellisense-ingestion/Dockerfile:1` correctly uses `FROM rust:1.88-slim` (a pinned minor version). The `python:3.12-slim` tag on Docker Hub is updated on every Python patch release (3.12.0, 3.12.1, ... 3.12.9+) and on every underlying Debian security update, meaning two sequential `docker build` invocations of the analytics service may produce images with different Python patch versions, different `pip` versions, and different versions of the apt-installed `libgdal-dev`. This breaks reproducible builds: a CI/CD pipeline that runs `docker build` today and again in a week may produce functionally different images without any change to the source code. The ingestion Dockerfile shows the author is aware of pinning; the analytics Dockerfile was inconsistently left floating. With `geopandas==1.0.*` and `rasterio==1.4.*` both depending on the GDAL C library installed via `apt-get install libgdal-dev`, a system-level libgdal version difference between builds can change spatial computation results. PROPOSAL: Change `FROM python:3.12-slim` to `FROM python:3.12.9-slim` (or whatever the current 3.12 patch is) in `geointellisense-analytics/Dockerfile:1`; add a comment with the update policy (e.g., bump on security advisories); optionally pin the full image digest (`FROM python:3.12.9-slim@sha256:...`) for maximum reproducibility — L/L effort (1-line Dockerfile change).

**Proposed actions:**
- Change `"@googlemaps/markerclusterer": "latest"` to `"@googlemaps/markerclusterer": "^2.6.2"` in `package.json` — L/L effort
- Bump `rand = "0.8"` to `rand = "0.9"` in `Cargo.toml`; update `aqi.rs:100,139` `thread_rng()→rng()` and 13 `.gen_range()→.random_range()` call sites — L/M effort
- Remove upper bounds from `joblib>=1.4,<1.5` and `scipy>=1.13,<1.15` in `requirements.txt`; re-test analytics container build — L/L effort
- Pin analytics `Dockerfile:1` to `FROM python:3.12.9-slim` to match ingestion Dockerfile pinning discipline — L/L effort

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

## 📚 Archive (one line per past run)
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
