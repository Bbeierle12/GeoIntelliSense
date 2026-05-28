# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T22:10:00Z
Last run: #18 — Lens: Dependency health

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
### Run #18 — 2026-05-28 — Lens: Dependency health
**Scope:** `package.json`, `package-lock.json` (lockfileVersion 3, 368 packages), `vite.config.ts`; `geointellisense-analytics/requirements.txt`; `geointellisense-ingestion/Cargo.toml`, `Cargo.lock`. Checked for `latest`-tag usage, deprecated packages (none found), bundle-size warnings, missing lock files, outdated pinned packages, and upper-bound version caps.

**Findings:**

- OBSERVATION: `package.json:19` — `"@googlemaps/markerclusterer": "latest"` is the only dependency across all three manifests (npm, pip, Cargo) that uses an unpinned `latest` tag instead of a semver range. The lock file currently resolves it to `2.6.2`, but a `docker build --no-cache`, a fresh `npm install` after deleting `package-lock.json`, or a new contributor setup could resolve to a different major version without any manifest change. All 14 other npm dependencies use `^`, `~`, or `>=` range specifiers. The fix is to replace `"latest"` with `"^2.6.2"` (or the latest stable semver range).

- OBSERVATION: `vite.config.ts:24,37` — The `manualChunks` entry at line 24 carries an inline comment "Split Three.js + React Three Fiber into its own chunk (~800KB)", while `chunkSizeWarningLimit` on line 37 is set to `500` (KB). Since the three-vendor chunk is explicitly acknowledged to be ~800KB, this limit is exceeded on every production build, emitting a Rollup chunk-size warning that developers have tacitly conditioned themselves to ignore. Either the limit should be raised to `≥800` to reflect the known size, or the 3D feature components (`components/3d/AQI3DScene.tsx`, `CityMarkers.tsx`, `TerrainMesh.tsx`, etc.) should be wrapped in `React.lazy()` so the `three`/`@react-three/fiber`/`@react-three/drei` bundle becomes a route-level on-demand chunk — reducing initial page load by ~800KB for users who never navigate to the 3D map view.

- OBSERVATION: `geointellisense-analytics/requirements.txt` — All 18 dependencies use `.*` or `>=X,<Y` ranges (e.g. `fastapi==0.115.*`, `polars==1.24.*`, `numpy>=1.26,<2.1`), but no lock file (`requirements.lock`, `uv.lock`, or `pip-tools`-generated `requirements.in`/`requirements.txt` pair) is committed. The ingestion service has `Cargo.lock` committed and reproducible builds. The analytics service does not: two Docker builds a week apart could install different patch releases of `polars`, `psycopg`, `pydantic`, etc. (polars 1.24.3 vs 1.24.9 changed pickle compatibility between patch releases). The fix is to run `pip-compile` (pip-tools) or `uv pip compile` to generate a pinned `requirements.lock` and commit it alongside `requirements.txt`.

- OBSERVATION: `geointellisense-analytics/requirements.txt:9` — `anthropic==0.49.*` is pinned to a minor version released in early 2025, now at least 3 minor versions behind the current SDK (0.52+ as of mid-2025). The `geointellisense-analytics/app/routes/deep_analysis.py:34,62` hardcodes the model string `"claude-opus-4-6"` — a non-dated model identifier that differs from the standard dated format used elsewhere (`"claude-sonnet-4-20250514"` in `chat.py:44`). If `claude-opus-4-6` is only recognized by SDK ≥0.50, then the `anthropic==0.49.*` pin causes a silent API-level failure (the SDK sends the string to the API, which rejects it with a `404` or `invalid_model` error rather than a Python import error). Updating `anthropic` to `==0.52.*` and auditing all model strings for consistency across routes is a single low-effort change.

- OBSERVATION: `geointellisense-ingestion/Cargo.toml:15` — `rand = "0.8"`, locked at `0.8.5`. The `rand` crate published version 0.9.0 in February 2025, a major release that deprecated the module-level `rand::random()` shorthand and moved it behind `rand::rng()`. The SemVer declaration `"0.8"` will never auto-resolve to 0.9, so `cargo update` silently leaves the crate at 0.8.5 indefinitely. The usage is confined to the SSE mock-data fallback path in `broadcast.rs` (non-production path), making the upgrade low-risk: replace `rand::thread_rng().gen_range(...)` with `rand::rng().random_range(...)` and bump `Cargo.toml:15` to `"0.9"`.

- OBSERVATION: `geointellisense-analytics/requirements.txt:16-18` — Upper-bound caps `scipy>=1.13,<1.15` and `scikit-learn>=1.5,<1.7` prevent adoption of already-released patch and minor versions within those respective families. `scipy 1.14.x` is the last version installable; `scipy 1.15.x` releases (which contain numerical stability fixes in sparse solvers used by scikit-learn's `BayesianRidge` and `ARDRegression` models used in `app/ml/aqi_model.py`) are blocked. If a transitive dependency (e.g. a future `polars` or `geopandas` release) requires `scipy>=1.15`, pip resolution will fail at install time with an `ERROR: Cannot install ... because these package versions have conflicting dependencies` message — a runtime-deploy-blocking failure. The upper bounds should be relaxed to `<2.0` (or removed) after verifying test suite passes on the newer versions.

**Proposed actions:**
- Replace `"latest"` with `"^2.6.2"` for `@googlemaps/markerclusterer` in `package.json:19` — L/L, score 1.0; does not enter top 10
- Raise `chunkSizeWarningLimit` in `vite.config.ts:37` to `1000` to suppress the expected three-vendor warning, and/or wrap `components/3d/` in `React.lazy()` for on-demand loading — M/M, score 1.0; does not enter top 10
- Run `uv pip compile requirements.txt -o requirements.lock` and commit the lock file for the analytics service — M/L, score 2.0; does not enter top 10
- Bump `anthropic==0.49.*` → `==0.52.*` in `requirements.txt`; audit `deep_analysis.py:34` model string `"claude-opus-4-6"` against the SDK's supported model list — M/L, score 2.0; does not enter top 10
- Bump `rand = "0.8"` → `"0.9"` in `Cargo.toml:15`; update `broadcast.rs` call sites to `rand::rng().random_range(...)` — L/L, score 1.0; does not enter top 10
- Relax `scipy<1.15` and `scikit-learn<1.7` upper-bound caps in `requirements.txt:17-18`; re-run `app/ml/aqi_model.py` test suite on updated versions — M/L, score 2.0; does not enter top 10

### Run #17 — 2026-05-28 — Lens: Module boundaries
**Scope:** All `.ts` and `.tsx` files in `components/`, `hooks/`, `services/`, `data/`, `utils/`, `contexts/`, and root on `origin/main`; full import graph traversal; `geointellisense-analytics/app/` Python route imports; `geointellisense-ingestion/src/` Rust module declarations. Checked for circular deps (A→B→A chains), leaky abstractions, layer violations, and type co-location issues.

**Findings:**

- OBSERVATION: `data/dashboardData.ts:1` carries the comment "This file centralizes the mock data for the dashboard" and `services/dataService.ts:3` annotates it "Keep for fallback," using it only inside catch blocks at lines ~116 and ~162. Despite this intended internal-only status, the module is imported directly by `components/Dashboard.tsx:12`, `components/AirQualityMapView.tsx:1`, `components/AnalysisView.tsx:27`, `contexts/UserPreferencesContext.tsx:2`, and `hooks/useDashboardData.ts:2` — five non-service consumers. The exported `LocationKey` type (line ~1151, `export type LocationKey = keyof typeof dashboardData`) has become a de-facto public API used across context and component props, coupling the entire component layer to a module whose primary content is static mock data. This is the structural root cause of the live-vs-mock data confusion found in Run #15: components can render mock data directly without passing through `dataService`'s fallback guard.

- OBSERVATION: `components/AnalysisView.tsx:12-17` imports six raw functions from `services/aiService` — `getGroundedSearchResponse`, `getGroundedMapsResponse`, `getLowLatencyResponse`, `getDeepAnalysisResponse`, `getPredictiveAnalysisResponse`, `getWeatherForecastResponse` — with no intermediate hook. State is set directly from service responses at lines 91 (`setResult(...)`) and 136 (`setGroundingChunks(...)`), and error/loading management is implemented inline within the component. `components/ChatView.tsx:2` and `components/DataExplorer.tsx:3` also import from `services/aiService` directly. This means three separate components independently re-implement error handling, loading state, and response parsing for semantically identical "call AI service" operations, with no shared abstraction point where a retry policy, timeout, or cancellation token could be applied consistently.

- OBSERVATION: Root `types.ts` co-locates four unrelated type families: `ViewType` (a page-routing union used in `App.tsx`), `AnalysisTool` (an analysis-feature-only enum used solely in `components/AnalysisView.tsx`), `GroundingChunk` (an AI service response shape consumed by `services/aiService.ts` and `components/AnalysisView.tsx`), and `ChatMessage` (a chat-session shape consumed by `services/aiService.ts` and `components/ChatView.tsx`). The placement of `GroundingChunk` and `ChatMessage` in the global root type file means `services/aiService.ts` must import from the root rather than owning its own response types, inverting the natural dependency direction (feature module → root instead of root → feature module).

- OBSERVATION: `components/MapView.tsx` calls `fetch()` directly at approximately lines 101–106 to retrieve `/api/maps-config`, while every other data operation in the same file is abstracted through `useLiveData`, `useAqiSnapshot`, and `useViewport` hooks. There is no `useMapConfig` hook and no service function for this endpoint. This is the same endpoint flagged in Active Recommendations row #6 (Google Maps API key returned to unauthenticated callers): because the call is an inline `fetch` with no wrapper, there is no single interception point to add an Authorization header, cache the response, or suppress the call for unauthenticated users.

- OBSERVATION: **No circular dependencies (A→B→A chains) were found in any layer.** TypeScript: the import graph is strictly acyclic — the only service-to-service import is `services/dataService.ts` importing `AirQualityService` and `WeatherService` (a documented one-directional facade). Python: the 25+ route modules in `geointellisense-analytics/app/routes/` share `app.claude`, `app.cache`, and `app.database` infrastructure but do not import each other. Rust: module dependencies follow a clean unidirectional chain (`main → broadcast → {aqi, usgs, db, redis_cache}`) with no back-edges.

**Proposed actions:**
- Extract `LocationKey` type and `locations` array from `data/dashboardData.ts` (line ~1151) into `types/locations.ts`; update the 4 direct component/context import sites; restrict `data/dashboardData.ts` imports to `services/dataService.ts` only — M/L, score 2.0; does not enter top 10 (all existing rows H/L = 3.0)
- Create `hooks/useAnalysis.ts` wrapping the 6 `aiService` function calls with unified error/loading/cancellation state; update `components/AnalysisView.tsx:12-17` and `components/DataExplorer.tsx:3` to use the hook — M/M, score 1.0; does not enter top 10
- Create `hooks/useChat.ts` wrapping `getChatResponse`; update `components/ChatView.tsx:2` — M/L, score 2.0; does not enter top 10
- Create `hooks/useMapConfig.ts` wrapping the direct `fetch('/api/maps-config')` in `MapView.tsx:101`; this also provides the single interception point needed to fix Active Recommendations row #6 (add auth check before returning key) — M/L, score 2.0; does not enter top 10
- Split `types.ts` into `types/ui.ts` (`ViewType`, `TemperatureUnit`), `types/analysis.ts` (`AnalysisTool`, `GroundingChunk`), `types/chat.ts` (`ChatMessage`); update all import sites — M/M, score 1.0; does not enter top 10
- No circular dependency remediation needed: none found

### Run #16 — 2026-05-28 — Lens: Type safety
**Scope:** All 23 `.ts` and 41 `.tsx` files on `origin/main`; `tsconfig.json`; searched for `: any`, `as any`, `<any>`, `Record<string, any>`, implicit parameter annotations, `@ts-ignore`, and `@ts-nocheck` directives.

**Findings:**

- OBSERVATION: `tsconfig.json` — The compiler options object contains no `"strict": true` flag and no individual `"noImplicitAny"`, `"strictNullChecks"`, `"strictFunctionTypes"`, `"strictBindCallApply"`, or `"strictPropertyInitialization"` flags. All five strict-mode checks therefore default to `false`. TypeScript silently infers `any` for parameters with no type annotation, permits `null`/`undefined` to flow into any variable, and skips function signature compatibility checking. Every explicit `any` annotation found in the files below is a symptom of this root-cause gap; enabling `strict` would cause the compiler to surface all of them as errors.

- OBSERVATION: `data/dashboardData.ts:195-336` — `generateDailyForecast()` builds and returns an array of objects with ~25 typed fields (nested `temp`, `wind`, `precipitation`, `hourlyData` sub-objects) but its return type is inferred and never named. No `DailyForecast` interface or type alias is exported from this module. Because the return type is opaque to consumers, every call site that iterates the array must annotate loop variables as `day: any` to access fields without a TypeScript error (confirmed: 4 separate `forEach((day: any) => {...})` calls in `hooks/useDashboardData.ts`). Adding `export interface DailyForecast { date: string; dayOfWeek: string; temp: { current: number; min: number; max: number; feelsLike: number }; humidity: number; ... }` and annotating `generateDailyForecast(): DailyForecast[]` would fix all downstream `day: any` annotations in one change.

- OBSERVATION: `hooks/useDashboardData.ts:179,197,199,223,241,243,267,285,287,311,330,332` — Twelve explicit `any` annotations in five `useMemo` blocks (`mergedHumidityData`, `mergedWindData`, `mergedUVData`, `mergedAgriculturalData`, and an intermediate `mergedForecastData` Map). Four are `(day: any)` parameter annotations that cascade from the missing `DailyForecast` type in `dashboardData.ts` (see above). Eight are `result: any[]` / `entry: any` intermediate accumulators that collect `{ month: string; [location: string]: number }` objects — a shape that could be expressed as `type MonthlySeriesPoint = { month: string } & Record<string, number>`. The `Map<string, Record<string, any>>` at line ~68 likewise loses value types.

- OBSERVATION: `components/charts/AQITrendChart.tsx:15`, `components/charts/PM25TrendChart.tsx:15`, `components/charts/TemperaturePrecipitationChart.tsx:15`, `components/charts/WeatherForecastChart.tsx:14` — All four chart components declare `data: any[]` in their props interface. The actual data produced by the five corresponding `useMemo` blocks in `useDashboardData.ts` always has `{ month: string } & Record<string, number>` (AQI/PM25/temperature) or `{ day: string } & Record<string, number>` (forecast) shapes. Replacing `any[]` with `Array<{ month: string } & Record<string, number>>` (or a shared `ChartDataPoint` type alias) would let TypeScript verify that callers pass correctly-shaped data.

- OBSERVATION: `components/AccessibleChart.tsx:66,79,165` — The `DataTableColumn.format` callback is typed `(value: any) => string` (line 66). The `AccessibleChartProps.data` field is `Record<string, any>[]` (line 79). The internal `DataTable` component's `data` prop repeats `Record<string, any>[]` at line 165. Because `AccessibleChart` is the project's accessibility wrapper used by every chart, these `any` types flow through all chart data in the accessible table path. The fix — making `AccessibleChart` generic: `AccessibleChart<T extends Record<string, unknown>>` with `data: T[]` and `format?: (value: T[keyof T]) => string` — would propagate type safety from each chart's data type without requiring per-usage annotation.

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `const controlsRef = useRef<any>(null)` is the only `useRef<any>` in the entire codebase. `@react-three/drei` exports `OrbitControls` whose imperative handle type is `OrbitControlsImpl` from `three-stdlib`. The ref is accessed via `controlsRef.current.getTarget(target)` at line 70 — if the library renames or removes `getTarget`, TypeScript gives no warning. The fix is `useRef<OrbitControlsImpl | null>(null)` with `import type { OrbitControlsImpl } from 'three-stdlib'`.

- OBSERVATION: `components/AnalysisView.tsx:255` — `catch (e: any)` then `e.message`. `catch (e: any)` is technically legal without `useUnknownInCatchVariables` (part of `strict`), but it bypasses type narrowing. The `utils/errorHandling.ts` module (used elsewhere in the project) already provides `toDataServiceError(error: unknown)` which performs safe narrowing. The consistent pattern would be `catch (e: unknown) { setError(toDataServiceError(e).getUserMessage()); }`.

- OBSERVATION: `components/DataExplorer.tsx:42` — `ExploreResponse.data: Array<Record<string, any>>`. The `/api/analysis/explore` endpoint returns TimescaleDB time-bucketed rows where columns are the selected source keys (`aqi`, `temperature`, `fires`, etc.) plus a `time` string. The `chartData` memo at line ~80 then does `d.time` (implicitly typed `any`), losing all type checking. The type could be narrowed to `Array<{ time: string } & Record<string, number | null>>` which still allows dynamic source columns while narrowing `time` and value types.

**Proposed actions:**
- Add `"strict": true` to `tsconfig.json` `compilerOptions`; then progressively fix resulting errors (the most impactful being the `any` annotations below) — H/M, score 1.5; not in top 10
- Export `DailyForecast` interface from `data/dashboardData.ts` and annotate `generateDailyForecast(): DailyForecast[]`; remove all `(day: any)` annotations in `useDashboardData.ts` — M/L, score 2.0; not in top 10 (newer than existing 3.0 items)
- Replace `result: any[]` and `entry: any` accumulators in `useDashboardData.ts` with `type MonthlySeriesPoint = { month: string } & Record<string, number>` — M/L, score 2.0; not in top 10
- Replace `data: any[]` props in the four chart components with a shared `ChartDataPoint` type alias — M/L, score 2.0; not in top 10
- Make `AccessibleChart` generic (`AccessibleChart<T extends Record<string, unknown>>`) to propagate data types through the accessible table path — M/M, score 1.0; not in top 10
- Replace `useRef<any>(null)` in `AQI3DScene.tsx:57` with `useRef<OrbitControlsImpl | null>(null)` — L/L, score 1.0; not in top 10
- Replace `catch (e: any)` in `AnalysisView.tsx:255` with `catch (e: unknown)` + `toDataServiceError(e).getUserMessage()` — L/L, score 1.0; not in top 10
- Narrow `ExploreResponse.data` in `DataExplorer.tsx:42` to `Array<{ time: string } & Record<string, number | null>>` — M/L, score 2.0; not in top 10

## 📚 Archive (one line per past run)
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
