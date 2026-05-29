# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-29T13:07:52Z
Last run: #33 — Lens: Dependency health

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
### Run #33 — 2026-05-29 — Lens: Dependency health
**Scope:** Third dependency-health pass. `package.json`, `package-lock.json` (368 packages), `npm audit` output, `vite.config.ts`, `geointellisense-analytics/requirements.txt`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-ingestion/Cargo.lock` (298 crates). Cross-referenced against prior run #3 (3 promoted to Active) and run #18 (archived) to exclude already-reported items.

**Findings:**

- OBSERVATION: `package.json` (root) — `npm audit` reports 8 vulnerabilities in the installed dependency tree: 5 high-severity (`vite ≤ 6.4.1`: GHSA-4w7w-66w2-5vf9 path traversal in dev server's `.map` handling, GHSA-p9ff-h696-f583 arbitrary file read via dev server WebSocket; `rollup 4.0.0–4.58.0`: GHSA-mw96-cpmx-2vgc arbitrary file write via path traversal; `react-router 7.0.0–7.12.0-pre.0`: GHSA-h5cw-625j-3rxh CSRF in Action/Server Action processing, GHSA-2w69-qvjg-hvjx XSS via open redirects; `picomatch 4.0.0–4.0.3`: GHSA-c2c7-rcm5-vvqj ReDoS via extglob quantifiers) and 3 moderate-severity (`react-router-dom 7.0.0–7.11.0`: depends on vulnerable react-router; `postcss < 8.5.10`: GHSA-qx2v-qp2m-jg93 XSS via unescaped `</style>`; `ws 8.0.0–8.20.0`: GHSA-58qx-3vcg-4xpx uninitialized memory disclosure). All are fixable with a single `npm audit fix`. Contextual impact: the vite and rollup path traversal issues affect the dev server only (not production builds). The react-router CSRF and SSR XSS advisories (GHSA-h5cw-625j-3rxh, GHSA-8v8x-cx79-35w7) do not apply because this project uses `<BrowserRouter>` with no server actions, loaders, or `createBrowserRouter` (verified in `App.tsx:2`). The open-redirect XSS (GHSA-2w69-qvjg-hvjx) is mitigated because `navigate()` in `App.tsx:37-65` is always called with hard-coded literal path strings. The picomatch ReDoS affects build and test tooling only. Fix: run `npm audit fix` in the project root; commit the updated `package-lock.json`.

- OBSERVATION: `package.json:10` — `"@googlemaps/markerclusterer": "latest"` uses npm's `latest` dist-tag instead of a semver range. The currently-resolved version is `2.6.2` (`package-lock.json`). `latest` is re-resolved on every fresh `npm install`, meaning any future npm publish — including a breaking major version (`3.0.0`) — could silently alter the dependency on the next CI install or developer setup without a lockfile bump, since the `latest` tag moves regardless of semver. The `MarkerClusterer` class is used in `components/MapView.tsx:371` to cluster AQI map markers; a breaking API change in a new major (e.g., constructor signature, `addMarkers` method name, or cluster event interface) would crash the map at runtime with no TypeScript compile error because the type definitions would also advance. Fix: replace `"latest"` with `"^2.6.2"` in `package.json` to pin to the current minor series while still accepting patch updates; run `npm install` to confirm the lock file is unchanged.

- OBSERVATION: `geointellisense-analytics/requirements.txt` — `geopandas==1.0.*` is specified but neither `pyogrio` nor `fiona` appears in `requirements.txt` or the `Dockerfile`. GeoPandas 1.0 changed its default file I/O backend from `fiona` to `pyogrio` and made `pyogrio` an optional install. The analytics container installs `libgdal-dev` via `apt-get` (enabling native GDAL C bindings) but does not install the `pyogrio` Python wheel via `pip`. Without `pyogrio`, calling `gpd.read_file(shp_path)` at `geointellisense-analytics/app/clients/calenviroscreen.py:113` raises `ImportError: pyogrio is required to use the default GeoDataFrame file reading backend. Install it with: pip install pyogrio`. The `download_and_parse()` coroutine (`calenviroscreen.py:88`) has no `try/except` around `gpd.read_file()`, so this error propagates to the CalEnviroScreen route handler and causes a 500 response on every CalEnviroScreen data request. Fix: add `pyogrio>=0.9` to `requirements.txt`; alternatively add `fiona>=1.9` if the team prefers the legacy backend, paired with the `engine="fiona"` keyword argument to `gpd.read_file()`.

- OBSERVATION: `geointellisense-analytics/requirements.txt:4` — `psycopg[binary]==3.2.*` is listed as a dependency but is never imported anywhere in the analytics codebase. A grep of all `.py` files under `geointellisense-analytics/app/` confirms that `asyncpg` (`database.py:1`) is the sole PostgreSQL driver in use; `psycopg` is not imported in any file. The `psycopg[binary]` extra installs pre-compiled C extension wheels and depends on `libpq-dev` at the system level, adding approximately 10–15 MB to the Docker image and to the build layer cache without providing any functionality. Fix: remove `psycopg[binary]==3.2.*` from `requirements.txt`.

- OBSERVATION: `components/3d/AQI3DScene.tsx:9`, `CrossSectionView.tsx:9`, `TerrainMesh.tsx:8`, `CityMarkers.tsx:9`, `PollutionVolume.tsx:8`, `WindField.tsx:8` — All six Three.js component files use `import * as THREE from 'three'` (namespace import). Only 17 symbols are consumed across all six files: `THREE.AdditiveBlending`, `THREE.BufferAttribute`, `THREE.BufferGeometry`, `THREE.Color`, `THREE.DataTexture`, `THREE.DirectionalLight`, `THREE.DoubleSide`, `THREE.Float32BufferAttribute`, `THREE.Fog`, `THREE.Group`, `THREE.Line`, `THREE.LineBasicMaterial`, `THREE.Mesh`, `THREE.PerspectiveCamera`, `THREE.Points`, `THREE.RGBAFormat`, `THREE.ShaderMaterial`, `THREE.Vector3`. Three.js 0.181 (the installed version) ships with subpath exports and supports named ESM imports (`import { Mesh, Vector3 } from 'three'`). Rollup/Vite can tree-shake named imports; it cannot tree-shake a namespace import because the entire module object is captured. The `vite.config.ts:20` comment acknowledges "~800KB" for the three-vendor chunk, which aligns with the uncompressed three.js full build (~637 KB). Switching from `import * as THREE` to named imports for the 17 used symbols would allow Rollup to eliminate the remaining ~97% of the three.js module. Fix: convert `import * as THREE from 'three'` to named imports in all six files (e.g., `import { Mesh, Vector3, BufferGeometry, ... } from 'three'`); replace all `THREE.Foo` references with bare `Foo`; update `vite.config.ts` comment to reflect the expected post-tree-shake reduction.

**Proposed actions:**
- Run `npm audit fix` in project root; commit updated `package-lock.json` — H/L, score 3.0; ties current top 10, does not displace
- Replace `"latest"` with `"^2.6.2"` for `@googlemaps/markerclusterer` in `package.json:10` — M/L, score 2.0; does not enter top 10
- Add `pyogrio>=0.9` to `geointellisense-analytics/requirements.txt` to satisfy `geopandas==1.0.*` I/O backend requirement — H/L, score 3.0; ties current top 10, does not displace
- Remove `psycopg[binary]==3.2.*` from `requirements.txt` — L/L, score 1.0; does not enter top 10
- Convert `import * as THREE from 'three'` to named imports in all six `components/3d/*.tsx` files to enable tree-shaking of the three-vendor chunk — M/M, score 1.0; does not enter top 10

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

## 📚 Archive (one line per past run)
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
