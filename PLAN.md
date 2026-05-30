# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T21:10:00Z
Last run: #64 — Lens: Perf hot paths

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
### Run #64 — 2026-05-30 — Lens: Perf hot paths
**Scope:** Fifth perf-hot-paths pass. Examined: `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/ml/aqi_model.py`, `components/3d/AQI3DScene.tsx`, `components/3d/PollutionVolume.tsx`, `components/3d/WindField.tsx`, `utils/interpolation.ts`. Prior perf-hot-paths details (#4, #19, #34, #49) archived; all findings verified as new via specificity of file:line citations.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/context.py:61-68` — `build_live_context()` awaits all 8 data-source coroutines sequentially: `context["aqi"] = await _get_aqi_context(pool)` … `context["prediction"] = await _get_prediction_context(pool)`. The inline comment at line 60 reads "Run all queries concurrently-ish (asyncpg handles connection pooling)". This is incorrect: asyncpg's connection pool enables concurrent queries from different coroutines, but the sequential `await` calls in this function serialize every coroutine — each waits for the previous to finish before starting. The eight calls include two DB round-trips (`_get_aqi_context`, `_get_forecast_context`), two PostGIS geo-distance queries (`_get_fire_context`, `_get_earthquake_context`), one water DB query, one CES DB query, one Redis scan (`_get_forecast_context`), and one ML prediction chain. Total latency = sum of all eight, typically 200–500ms for a cold DB. `build_live_context()` is called synchronously inside `build_context_text()` which is awaited before every AI call in `claude.py`. PROPOSAL: Replace the eight sequential awaits with `asyncio.gather(_get_aqi_context(pool), _get_forecast_context(pool), _get_fire_context(pool), _get_earthquake_context(pool), _get_water_context(pool), _get_enviroscreen_context(pool), asyncio.coroutine(_get_inversion_context)(), _get_prediction_context(pool))` (with `_get_inversion_context` wrapped in a thin async wrapper since it is currently synchronous). Total latency drops from sum-of-all to max-of-all.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:286` — `predict_aqi()` calls `model.staged_predict(X)` at line 286 to estimate a confidence interval. `staged_predict` is a scikit-learn GBR method that iterates through all 200 estimator stages and yields a cumulative prediction array of length 200. It is designed for model analysis and visualization, not production inference. At ~2-5ms per stage traversal, calling `staged_predict` adds approximately 400–1000ms to every inference call. By contrast, `model.predict(X)` at line 281 (which runs the full ensemble in one pass) is 5–20ms. The variance estimate derived from `staged_predict` (last 50 incremental deltas, lines 289-291) is a crude approximation: it measures learning-rate convergence noise in the boosting sequence, not the actual prediction variance for out-of-distribution inputs. The same variance estimate could be computed once at training time (from `model.staged_predict(X_test)` on the test split) and stored in `_model_meta` as a single float. PROPOSAL: (a) In `train_model()` at line 264, compute `staged = list(model.staged_predict(X_test))`, derive `std_estimate` using the existing lines 288-291 logic, and save it to `meta["pred_std_estimate"]` before `joblib.dump`; (b) in `predict_aqi()`, replace the `staged_predict` call at line 286 with `std_estimate = meta.get("pred_std_estimate", max(predicted * 0.15, 5))`. Inference latency drops from ~500ms to ~10ms.

- OBSERVATION: `components/3d/AQI3DScene.tsx:67-73` — The `CameraController` component's `useFrame` callback allocates `const target = new THREE.Vector3()` on line 69 inside the frame callback, conditional on `onCameraMove` being truthy. `useFrame` is called every render frame at ~60Hz. Each call creates a new `THREE.Vector3` heap object that is immediately consumed by `controlsRef.current.getTarget(target)` and passed to `onCameraMove`. At 60fps, this generates 60 short-lived `Vector3` allocations per second. In a garbage-collected WebAssembly-free environment (V8), ephemeral object allocation at this rate triggers incremental GC pauses that cause frame-time jitter visible as micro-stutters during camera orbit. The `OrbitControls` `getTarget()` method accepts a pre-allocated `Vector3` to write into. PROPOSAL: Hoist `const targetRef = useRef(new THREE.Vector3())` above the `useFrame` at line 67; inside the callback, call `controlsRef.current.getTarget(targetRef.current)` and pass `targetRef.current` to `onCameraMove`. This reuses the same object across all frames with zero allocation.

- OBSERVATION: `components/3d/PollutionVolume.tsx:142-204` — Each `PollutionCloud` component registers a `useFrame` callback at line 174. The callback updates two shader uniforms (`time`, `cameraPos`) and one mesh position property. `PollutionLayer` (line 217) generates one `PollutionCloud` per grid point with `value > 30`. `generateInterpolatedGrid` with `resolution=12` (the default at `PollutionVolume.tsx:277`) produces `(12+1)² = 169` grid points. With 3 layers (line 285), if all grid points exceed AQI 30, up to `169 × 3 = 507` individual `useFrame` callbacks are registered, each running at 60Hz. React Three Fiber's `useFrame` scheduler iterates through all subscribed callbacks in insertion order every frame — 507 function invocations doing redundant `clock.elapsedTime` reads and uniform writes per frame. The `time` uniform is the same value for every cloud; the `cameraPos` uniform is the same camera position for every cloud. PROPOSAL: Lift the `time` and `cameraPos` uniform updates to a single `useFrame` in `PollutionVolume`'s top-level group component, writing to a shared `uniformsRef`; pass the shared uniforms object down via context or ref-forwarding so each `PollutionCloud` creates its material with the shared reference rather than per-instance uniforms. Alternatively, replace the per-cloud `PollutionCloud` mesh array with a single `THREE.InstancedMesh` driven by one top-level `useFrame`.

- OBSERVATION: `components/3d/WindField.tsx:197-208` — Inside `WindParticleSystem`'s `useMemo` (lines 180-231), each of the `count` particles (default 500) loops over every `windData` element to find the nearest wind vector: the inner `for (const wind of windData)` at line 202 makes this O(`count` × `windData.length`). For 500 particles and even 6 wind stations this is 3,000 distance calculations — negligible in isolation. However, the `useMemo` dependency array is `[windData, count, speed, height]` at line 231. `windData` is a prop passed from `WindField`'s parent. If the parent creates `windData` via an inline `.map()` or unmemoized expression, the array reference changes on every parent render, invalidating the `useMemo` and re-running the O(N×M) loop on every render cycle. In the worst case — rapid AQI updates from the SSE stream causing parent re-renders — the 3,000+ calculations run every second. PROPOSAL: (a) Ensure callers of `WindField` memoize `windData` via `useMemo` or `useRef`; (b) inside `WindParticleSystem`, add an equality check via `useRef` to skip recalculation when wind values have not changed; (c) for future scale, precompute a `latLngToWorld`-mapped spatial structure (simple sorted array suffices for M < 20) at the `WindField` level and pass it down to avoid redundant `latLngToWorld` calls per particle.

**Proposed actions:**
- Replace sequential awaits in `build_live_context()` at `context.py:61-68` with `asyncio.gather()`; wrap `_get_inversion_context` in async — H/L, score 3.0; ties top 10 at score 3.0 but first seen #64, does not displace existing
- Precompute `pred_std_estimate` at training time in `aqi_model.py:264`; remove `staged_predict` from `predict_aqi()` at `aqi_model.py:286` — H/L, score 3.0; same tiebreak, does not displace
- Hoist `new THREE.Vector3()` out of `useFrame` in `AQI3DScene.tsx:69` using `useRef` — M/L, score 2.0; does not displace top 10
- Lift shared uniform updates from per-cloud `useFrame` in `PollutionVolume.tsx:174` to a single top-level `useFrame`; or use `InstancedMesh` — H/M, score 1.5; does not displace top 10
- Memoize `windData` at call sites of `WindField`; add ref-based equality guard inside `WindParticleSystem` `useMemo` at `WindField.tsx:231` — M/L, score 2.0; does not displace top 10

### Run #63 — 2026-05-30 — Lens: Dependency health
**Scope:** Fifth dependency-health pass. Examined: `package.json`, `package-lock.json`, `vite.config.ts`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-analytics/requirements.txt`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/Dockerfile`, `geointellisense-ingestion/src/aqi.rs` (rand usage), `geointellisense-analytics/app/routes/chat.py`, `deep_analysis.py`, `predictive_analysis.py`, `weather_forecast.py`, `grounded_search.py`, `grounded_maps.py`, `low_latency.py` (model IDs). Prior dependency-health details (#3, #18, #33, #48) archived; all findings verified as new via specificity of file:line citations.

**Findings:**

- OBSERVATION: `package.json:16` — `"@googlemaps/markerclusterer": "latest"` uses the npm `latest` dist-tag, not a semver range. The lock file currently pins the resolved version to `2.6.2`. However, `latest` is not a semver constraint — it is a floating registry alias that resolves to whatever version is tagged `latest` on npmjs.com at the moment `npm install` is run without `--frozen-lockfile` (or outside of `npm ci`). If a developer runs `npm install <any-other-package>` during development, npm will re-resolve `@googlemaps/markerclusterer` to the current `latest`, potentially pulling a major version bump (e.g., v3.x) whose API differs from the v2 `MarkerClusterer` class imported at `components/MapView.tsx:2`. The lock file protects against this only as long as `npm ci` is used exclusively; `npm install` will silently re-pin. PROPOSAL: Change `"@googlemaps/markerclusterer": "latest"` to `"@googlemaps/markerclusterer": "^2.6.2"` in `package.json:16` to anchor the major version semver-safely.

- OBSERVATION: `package.json:19` — `"@types/three": "^0.181.0"` is declared under `dependencies`, not `devDependencies`. `@types/three` is a pure TypeScript declarations package containing zero runtime code; it provides type information consumed only by the TypeScript compiler. The lock file confirms `"dev": undefined` for `node_modules/@types/three`, meaning it is stored as a production dependency. In a Docker build stage that installs only production dependencies (`npm ci --production` or `npm install --omit=dev`), this package would be absent — causing TypeScript compilation to fail if invoked in that stage. In non-Vite contexts (SSR, tests in isolation, or any future build tool) the misclassification would cause incorrect dependency auditing. By contrast, `@types/google.maps` (also a declarations-only package) is correctly placed in `devDependencies` at `package.json:31`. PROPOSAL: Move `"@types/three": "^0.181.0"` from `dependencies` (line 19) to `devDependencies` in `package.json`.

- OBSERVATION: `requirements.txt:9` — `anthropic==0.49.*` pins the Anthropic Python SDK to a release approximately 18 months old as of May 2026. The SDK has evolved significantly: prompt caching via `cache_control` in `content` blocks (introduced ~0.51), updated streaming event discriminators, and new model configuration options are all absent in 0.49.x. More concretely, the model ID `"claude-sonnet-4-20250514"` used at `routes/chat.py:44`, `routes/predictive_analysis.py:92`, `routes/weather_forecast.py:76`, `routes/grounded_search.py:40`, and `routes/grounded_maps.py:47` is a date-versioned alias from early Claude 4 releases. The current stable alias for the same capability tier is `claude-sonnet-4-6` (confirmed in system metadata). The date-versioned ID `claude-sonnet-4-20250514` may be sunset by the Anthropic API without notice, at which point all five routes begin returning `model_not_found` errors. Meanwhile, `routes/deep_analysis.py:34,62` already uses the current-style alias `claude-opus-4-6`, creating an inconsistency. PROPOSAL: (a) Bump `anthropic==0.49.*` to `anthropic>=0.55` in `requirements.txt:9`; (b) replace `"claude-sonnet-4-20250514"` with `"claude-sonnet-4-6"` in the five affected route files; (c) add prompt caching (`"cache_control": {"type": "ephemeral"}`) to the system-prompt content block in `claude.py` now that the bumped SDK supports it.

- OBSERVATION: `requirements.txt:15` — `scipy>=1.13,<1.15` blocks all scipy 1.15.x releases. scipy 1.15.0 was released January 2025 and is the current stable branch as of May 2026. The upper bound `<1.15` means `pip install -r requirements.txt` resolves to the newest 1.14.x patch — currently `1.14.1` — and can never update beyond it. There is no corresponding `requirements.lock` file (see Finding 5), so the resolved version varies across Docker builds as 1.14.x receives new patch releases. The analytics ML code (`ml/aqi_model.py`) uses `scipy.stats` and `scipy.interpolate`; scipy 1.15 does not introduce breaking API changes to these submodules. The upper bound was likely added as a precaution during initial development and has not been revisited since 1.15 shipped. PROPOSAL: Update `requirements.txt:15` to `scipy>=1.13,<1.16`, capturing scipy 1.15.x improvements (in particular performance improvements to `scipy.stats.zscore` used in anomaly detection) while maintaining a one-minor-ahead guard.

- OBSERVATION: `geointellisense-analytics/Dockerfile:6` and `requirements.txt` (entire file) — The analytics Python service has no lockfile. Every `docker build` invocation runs a live `pip install -r requirements.txt` against PyPI, resolving all version ranges (`numpy>=1.26,<2.1`, `polars==1.24.*`, `scikit-learn>=1.5,<1.7`, etc.) at build time. Two Docker builds on different days can produce images with different resolved versions of every range-pinned package. Polars in particular releases patch versions that occasionally change DataFrame API behavior (e.g., `polars==1.24.1` vs `1.24.3` have differed in `LazyFrame.collect()` error reporting). By contrast, the Rust ingestion service commits `Cargo.lock` (deterministic) and the TypeScript frontend commits `package-lock.json` (deterministic); only the Python service has this gap. PROPOSAL: Install `pip-tools` in the dev environment; run `pip-compile requirements.txt -o requirements.lock`; change `geointellisense-analytics/Dockerfile:6` from `RUN pip install --no-cache-dir -r requirements.txt` to `RUN pip install --no-cache-dir -r requirements.lock`; commit `requirements.lock` to version control and regenerate it on intentional dependency bumps.

**Proposed actions:**
- Replace `"latest"` with `"^2.6.2"` for `@googlemaps/markerclusterer` in `package.json:16` — M/L, score 2.0; does not displace top 10
- Move `"@types/three"` from `dependencies` to `devDependencies` in `package.json:19` — L/L, score 1.0; does not displace top 10
- Bump `anthropic` to `>=0.55` in `requirements.txt:9`; replace `claude-sonnet-4-20250514` with `claude-sonnet-4-6` in 5 route files — H/L, score 3.0; ties top 10 but first seen #63, does not displace existing
- Relax scipy bound to `<1.16` in `requirements.txt:15` — M/L, score 2.0; does not displace top 10
- Add `pip-compile`-generated `requirements.lock`; use it in `analytics/Dockerfile:6` — H/M, score 1.5; does not displace top 10

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

## 📚 Archive (one line per past run)
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
- Run #63: lens 3 (Dependency health) — findings added
- Run #64: lens 4 (Perf hot paths) — findings added
