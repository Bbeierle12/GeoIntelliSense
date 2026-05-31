# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-31T12:08:00Z
Last run: #79 — Lens: Perf hot paths

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
### Run #79 — 2026-05-31 — Lens: Perf hot paths
**Scope:** Sixth perf-hot-paths pass. Examined: `geointellisense-ingestion/src/aqi.rs`, `broadcast.rs`, `persist.rs`, `purpleair.rs`, `usgs.rs`, `routes/sse.rs`; frontend `components/3d/AQI3DScene.tsx`, `PollutionVolume.tsx`, `WindField.tsx`, `TerrainMesh.tsx`, `CityMarkers.tsx`; `hooks/useRealtimeAQI.ts`. Verified all findings are new vs. archived perf runs #4, #19, #34, #49, #64.

**Findings:**

- OBSERVATION: `components/3d/AQI3DScene.tsx:69` — `CameraController.useFrame` allocates `const target = new THREE.Vector3()` inside the callback body, which executes at up to 60fps whenever the `onCameraMove` prop is provided. Each call creates a new `THREE.Vector3` heap object that is immediately consumed and abandoned, contributing O(60) allocations per second to the V8 young-generation heap for as long as the 3D scene is mounted with an `onCameraMove` handler. R3F documentation explicitly warns that object allocation inside `useFrame` triggers incremental GC work between frames. The fix is a single-character change: hoist `const targetRef = useRef(new THREE.Vector3())` outside the `useFrame` callback, then pass `targetRef.current` to `getTarget(targetRef.current)` and `onCameraMove(camera.position, targetRef.current)` — the same `Vector3` is reused each frame, producing zero GC pressure. PROPOSAL: Add `const targetVec = useRef(new THREE.Vector3())` at `AQI3DScene.tsx:57` (alongside `controlsRef`); replace the `const target = new THREE.Vector3()` allocation at line 69 with `const target = targetVec.current` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `components/3d/WindField.tsx:336` — The `Streamline` component's `return` statement is `<primitive object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 }))} />`. On every React render of `Streamline`, a new `THREE.Line` and a new `THREE.LineBasicMaterial` are instantiated inline. The `geometry` object IS memoized (via `useMemo` at line 324), but the `LineBasicMaterial` and the `THREE.Line` wrapper are not — they are created fresh on each render and the old ones are never disposed. This is a WebGL memory leak: each abandoned `LineBasicMaterial` holds a reference to compiled shader program objects that are registered in the WebGL context; without an explicit `.dispose()` call, they accumulate. `WindField` renders one `Streamline` per entry in `windPositions` (line 409), so the leak scales with the number of wind data points per re-render. PROPOSAL: Replace the inline creation with `const lineObject = useMemo(() => new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 })), [geometry, color])`; add a `useEffect(() => () => { lineObject.material.dispose(); lineObject.geometry.dispose(); }, [lineObject])` cleanup; render `<primitive object={lineObject} />` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `components/3d/TerrainMesh.tsx:202` — The `RegionBoundary` component returns `<primitive object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#4CAF50', transparent: true, opacity: 0.6 }))} />`. The `geometry` is correctly memoized (via `useMemo` at line 197), but the `THREE.LineBasicMaterial` and the `THREE.Line` object wrapping it are created inline in JSX on every render. Same WebGL disposal problem as the `WindField.tsx:336` case above: the abandoned materials accumulate compiled shader objects in the WebGL context. Unlike `Streamline`, `RegionBoundary` takes no props that change after mount, so its render frequency is low — but the first mount still creates an undisposed material/object pair, and any parent re-render that causes `RegionBoundary` to re-mount (e.g., a `TerrainMesh` key change) leaks another pair. PROPOSAL: Wrap both the `LineBasicMaterial` creation and the `THREE.Line` constructor in a `useMemo` inside `RegionBoundary`, and add a `useEffect` cleanup that calls `.dispose()` on both when the component unmounts — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/src/usgs.rs:107` — `fetch_recent()` creates `let client = reqwest::Client::new()` inside the function body on every invocation. `fetch_recent` is called by `fetch_and_persist_bbox`, which is called by the earthquake poller loop (`broadcast.rs:154`) every `earthquake_interval_secs`. Each call to `reqwest::Client::new()` initializes a new connection pool, TLS session store, and root certificate bundle. This discards any existing TCP keepalive connections to `earthquake.usgs.gov`, forcing a full TCP + TLS handshake (typically 2-3 RTTs) before the HTTP GET can be sent on every polling cycle. This stands in direct contrast to `PurpleAirClient` (defined at `purpleair.rs:37-47`), which correctly stores `http: reqwest::Client` as a struct field initialized once at `PurpleAirClient::new()`. The `reqwest::Client` is `Clone + Send + Sync` and thread-safe by design; it is intended to be reused across many requests. PROPOSAL: Add a `http: reqwest::Client` field to a new `UsgsClient` struct (mirroring `PurpleAirClient`); initialize it once in `main.rs` and pass it to `spawn_earthquake_poller`; replace `let client = reqwest::Client::new()` at `usgs.rs:107` with the stored field — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `components/3d/PollutionVolume.tsx:174-183` — Each `PollutionCloud` component registers its own `useFrame` subscription (line 174). R3F's `useFrame` maintains a global subscriber list that is iterated on every animation frame. With `resolution=12` (the default for `PollutionVolume`), `generateInterpolatedGrid` produces a 12×12 = 144-point grid; after the `point.value > 30` filter at line 220, most grid points survive (since mock AQI values hover around 55-85). With 3 layers (line 285), the scene mounts approximately 3 × ~100 = ~300 `PollutionCloud` components, each contributing one `useFrame` callback. The subscriber iteration itself is O(N) per frame, adding ~300 function call overheads per animation tick. Each callback also sets `position.y` via a `Math.sin` call and copies the camera position into the shader uniform. All of these operations could be consolidated into a single `useFrame` at the `PollutionVolume` group level, iterating over a `useRef`-stored array of mesh and material refs. PROPOSAL: Remove `useFrame` from `PollutionCloud`; add a single `useFrame` in `PollutionVolume` that iterates over a `useRef<Array<{meshRef, materialRef, position, animOffset}>>` to update all cloud positions and uniforms in one pass — M/M, score 1.0; does not displace top 10.

**Proposed actions:**
- Hoist `new THREE.Vector3()` out of `useFrame` into a `useRef` at `AQI3DScene.tsx:57,69` — M/L, score 2.0; does not displace top 10
- Wrap `new THREE.Line + LineBasicMaterial` in `useMemo` with `useEffect` dispose in `WindField.tsx:336` — M/L, score 2.0; does not displace top 10
- Same fix for `TerrainMesh.tsx:202` `RegionBoundary` — L/L, score 1.0; does not displace top 10
- Extract `reqwest::Client` into a `UsgsClient` struct; initialize once in `main.rs`; pass to USGS poller — M/L, score 2.0; does not displace top 10
- Consolidate ~300 per-cloud `useFrame` callbacks into one parent-level callback in `PollutionVolume.tsx` — M/M, score 1.0; does not displace top 10

### Run #78 — 2026-05-31 — Lens: Dependency health
**Scope:** Sixth dependency-health pass. Examined: `package.json`, `package-lock.json`, `vite.config.ts`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-ingestion/Cargo.lock`, `geointellisense-analytics/requirements.txt`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/Dockerfile`. Cross-checked with source file grep for actual import usage. Verified all findings are new vs. prior dependency-health runs #3, #18, #33, #48, #63 (archived).

**Findings:**

- OBSERVATION: `package.json:16` — `"@googlemaps/markerclusterer": "latest"` uses the npm `latest` dist-tag instead of a semver range. All other production dependencies use semver ranges (`"^10.7.7"`, `"^19.2.0"`, etc.). `"latest"` resolves to whichever version carries the `latest` tag at install time. The `package-lock.json:996` currently locks it to `2.6.2`, but the lock is bypassed whenever `npm install` is run against a `package.json` specifier that could resolve to a newer version — e.g., when a developer runs `npm install` after pulling changes, or when CI performs a fresh install on a branch that updates other deps. If `@googlemaps/markerclusterer` publishes a `3.x` major with breaking API changes and tags it `latest`, the next non-`npm ci` install would pull `3.x`, silently breaking the `MarkerClusterer` usage at `components/MapView.tsx:90` and `components/MapView.tsx:371`. PROPOSAL: Replace `"latest"` with `"^2.6.2"` at `package.json:16`, matching the currently locked version.

- OBSERVATION: `geointellisense-analytics/requirements.txt:4` — `psycopg[binary]==3.2.*` is declared as a dependency but is imported nowhere in the analytics service codebase. `grep` across all `.py` files under `geointellisense-analytics/` finds zero `import psycopg` or `from psycopg` statements. The service uses only `asyncpg==0.30.*` (line 5) for all PostgreSQL access — `app/database.py:1` is the sole DB driver entrypoint and it imports `asyncpg` exclusively. `psycopg[binary]` installs compiled C extension wheels (libpq bindings) during Docker build, adding non-trivial image size and install time with zero runtime benefit. The analytics `Dockerfile` already runs `apt-get install -y libgdal-dev`; psycopg's binary wheel adds another native library with no consumer. PROPOSAL: Remove `psycopg[binary]==3.2.*` from `geointellisense-analytics/requirements.txt:4` entirely.

- OBSERVATION: `vite.config.ts:21` documents the `three-vendor` manual chunk as `~800KB`, but `vite.config.ts:33` sets `chunkSizeWarningLimit: 500`. Every production build will emit a Vite size warning for the `three-vendor` chunk despite this being an intentional design decision, causing build-log noise that may mask genuine new warnings. Furthermore, `@react-three/drei@10.7.7` (locked at `package-lock.json`) lists `@mediapipe/tasks-vision@0.10.17` as a hard `dependency` (not `optionalDependency` or `peerDependency`). `@mediapipe/tasks-vision` is a full computer vision SDK (face landmarks, hand-tracking, object detection). None of the drei components that require it (`FaceControls`, `FaceLandmarker`, `HandsControls`, `Webcam`) are imported anywhere in the project — `grep` across all `.ts`/`.tsx` files confirms zero uses. Despite Vite tree-shaking, `@mediapipe/tasks-vision` contributes WASM blob weight and JS bootstrap overhead to the `three-vendor` chunk because `@react-three/drei`'s entry point statically references the mediapipe wrapper during module initialization. PROPOSAL: (a) Raise `chunkSizeWarningLimit` in `vite.config.ts:33` to at least `1000` to suppress the known-intentional three-vendor warning; (b) consider replacing `@react-three/drei` with targeted alternatives for the handful of drei helpers this project actually uses (`OrbitControls`, `Html`, `Billboard`, `Text`) to eliminate the mediapipe transitive payload.

- OBSERVATION: `geointellisense-ingestion/Cargo.toml:20` specifies `rand = "0.8"`, locked at `rand 0.8.5` by `Cargo.lock:1413`. `rand 0.9.0` was released in February 2025 and introduces several improvements, notably deprecating `rand::thread_rng()` — the exact API called at `aqi.rs:100` (`let mut rng = rand::thread_rng()`) and `aqi.rs:139` (`let mut rng = rand::thread_rng()`). In rand 0.9, `thread_rng()` was replaced by `rand::rng()` and the crate's overall API was cleaned up. The `Cargo.toml` edition `"2024"` (line 4) targets the Rust 2024 edition, making the rand 0.8 pin the oldest dependency in the manifest by two major versions. Cargo's pre-1.0 semver rules mean `rand = "0.8"` will never auto-resolve to 0.9, so the project is explicitly pinned to a stale release branch. The `.gen_range(a..b)` calls at `aqi.rs` are syntactically unchanged between 0.8 and 0.9; only the `thread_rng()` → `rng()` rename is required. PROPOSAL: Update `Cargo.toml:20` to `rand = "0.9"`; change `aqi.rs:100` and `aqi.rs:139` from `rand::thread_rng()` to `rand::rng()`; run `cargo build --release` to verify no remaining API incompatibilities.

- OBSERVATION: `geointellisense-analytics/requirements.txt:16-18` applies upper bounds to three ML packages — `scipy>=1.13,<1.15`, `scikit-learn>=1.5,<1.7`, `joblib>=1.4,<1.5` — while leaving `polars`, `fastapi`, `anthropic`, and other dependencies as wildcard `.*` ranges. As of May 2026, `scipy 1.15.x`, `scikit-learn 1.7.x`, and `joblib 1.5.x` are all available stable releases. The upper bounds block installation of these in new Docker builds without any documented justification in the file. The actual usage is minimal and stable: `scipy` is only used for `scipy.ndimage.zoom` at `app/clients/landsat.py:255` (stable API since scipy 1.0); `scikit-learn` only uses `GradientBoostingRegressor`, `train_test_split`, `mean_absolute_error`, `r2_score` at `app/ml/aqi_model.py:209-211` (unchanged across 1.x); `joblib` only uses `dump`/`load` at `aqi_model.py:62-64,257-258` (backward-compatible serialization in 1.5). The asymmetric constraint strategy — pinning these three with upper bounds while leaving other deps as `.*` wildcards — provides a false sense of reproducibility: `polars==1.24.*` can drift across patch versions but `scipy<1.15` is blocked from security patches. PROPOSAL: Remove the upper bounds: change line 16 to `scipy>=1.13`, line 17 to `scikit-learn>=1.5`, line 18 to `joblib>=1.4`; or adopt `pip-tools` to generate a fully-pinned `requirements.lock` file for true reproducibility.

**Proposed actions:**
- Replace `"latest"` with `"^2.6.2"` for `@googlemaps/markerclusterer` at `package.json:16` — M/L, score 2.0; does not displace top 10
- Remove unused `psycopg[binary]==3.2.*` from `requirements.txt:4` — L/L, score 1.0; does not displace top 10
- Raise `chunkSizeWarningLimit` in `vite.config.ts:33` to `1000`; investigate replacing `@react-three/drei` with targeted deps to drop mediapipe payload — M/M, score 1.0; does not displace top 10
- Update `Cargo.toml:20` to `rand = "0.9"`; update `aqi.rs:100,139` from `thread_rng()` to `rng()` — M/M, score 1.0; does not displace top 10
- Remove upper bounds from `requirements.txt:16-18` for scipy/scikit-learn/joblib; or adopt pip-tools lock file — M/L, score 2.0; does not displace top 10

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

## 📚 Archive (one line per past run)
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
