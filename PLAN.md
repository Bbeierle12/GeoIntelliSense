# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T18:10:00Z
Last run: #109 — Lens: Perf hot paths

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
### Run #109 — 2026-06-01 — Lens: Perf hot paths
**Scope:** Eighth perf hot paths pass. Examined: `geointellisense-ingestion/src/broadcast.rs` (tick intervals, persist call sites), `geointellisense-ingestion/src/config.rs` (default broadcast_interval_secs=5), `geointellisense-ingestion/src/db/persist.rs` (write_readings loop), `geointellisense-ingestion/src/purpleair.rs` (fetch_readings bucketing algorithm), `geointellisense-ingestion/src/routes/sse.rs` (disconnect tracker, stream composition), `utils/interpolation.ts` (generateInterpolatedMatrix, generateInterpolatedGrid, interpolateIDW internals), `components/3d/TerrainMesh.tsx` (createAQIOverlayTexture, textureResolution default, useMemo dependency), `components/3d/PollutionVolume.tsx` (PollutionCloud useFrame, resolution default, layer count), `components/3d/AQI3DScene.tsx` (CameraController useFrame, Vector3 allocation), `hooks/useRealtimeAQI.ts` (addToHistory, history state spread, broadcast interval). Cross-checked against Active Recommendations and runs #107–#108 (Latest Findings) plus archived perf runs #94, #79, #64, #49, #34, #19, #4 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `components/3d/TerrainMesh.tsx:115–121` and `utils/interpolation.ts:358–374` — `createAQIOverlayTexture` calls `generateInterpolatedMatrix(aqiData, SAN_JOAQUIN_BOUNDS, 128, 128, 'idw')` (default `textureResolution = 128` at `TerrainMesh.tsx:217`). This executes **128 × 128 = 16,384 sequential calls** to `interpolateIDW` inside `useMemo` (line 239–241), synchronously on the React main thread, triggered every time `aqiData` changes — i.e., every SSE event at `broadcast_interval_secs = 5` (default, `config.rs:30`). Each `interpolateIDW` call at `interpolation.ts:65–73` allocates three intermediate arrays (`.map()`, `.filter()`, `.sort()`), totaling ~49,152 temporary array allocations per texture rebuild. With 6 stations as inputs, each sort is O(6 log 6) but the sheer iteration count (16,384 calls × 3 allocs) generates measurable GC pressure and can block the main thread for 10–80ms per update depending on device, causing perceptible jank every 5 seconds when the 3D scene is mounted. Note: `generateInterpolatedMatrix` is also exported and could be called at higher resolutions by callers overriding `textureResolution`. PROPOSAL: Replace synchronous `useMemo` execution with `React.useDeferredValue` on the `aqiData` prop so texture recomputation does not block the render frame; alternatively, halve the default to `textureResolution = 64` (4,096 IDW calls, perceptually equivalent given the six-station data density) and add a `maxResolution` guard inside `createAQIOverlayTexture` — L/L effort.

- OBSERVATION: `components/3d/PollutionVolume.tsx:174–184` — Each `PollutionCloud` instance registers its own `useFrame` callback. With `resolution = 12` (default, line 259), `generateInterpolatedGrid` produces `(12+1)² = 169` grid points (line 273–279). After the `point.value > 30` filter at line 221 — with mock AQI ranging 50–95 across 6 stations, IDW interpolation propagates values above 30 to nearly all grid cells — approximately 140–160 clouds are mounted per layer. Across 3 layers (lines 283–290) this creates **420–480 mounted `PollutionCloud` instances**, each registering a separate `useFrame` subscriber in R3F's internal subscription list. R3F processes all `useFrame` subscribers sequentially inside each `requestAnimationFrame`; at 60fps with 400+ callbacks, the per-tick function-call overhead (without any GPU work) alone adds multi-millisecond CPU cost to every frame, competing with the render loop. Additionally, each cloud creates a separate `THREE.Mesh` + `THREE.ShaderMaterial` draw call, causing 400+ GPU draw calls per frame for what could be a single `InstancedMesh` with one draw call. PROPOSAL: Refactor `PollutionLayer` to render all clouds as a single `InstancedMesh<BoxGeometry, ShaderMaterial>`; merge all per-cloud `useFrame` logic into a single `useFrame` in the parent `PollutionVolume` component that updates the instanced mesh's uniform buffer and instance matrices in one pass — M/M effort.

- OBSERVATION: `components/3d/AQI3DScene.tsx:69` — The `CameraController` `useFrame` callback at line 67–73 allocates `const target = new THREE.Vector3()` on every invocation (60fps) when `onCameraMove` is provided. This creates 60 short-lived `Vector3` objects per second, each allocated on the V8 heap and collected in minor GC cycles every few seconds. While individually trivial, it compounds with other per-frame allocations (shader uniform spreads in PollutionCloud, array mappings in `aqiDataPoints`/`windData` at `useRealtimeAQI.ts:396–407`). The `THREE.Vector3` API supports in-place reuse via `getTarget(existingVec)`; the fix is a single `const targetRef = useRef(new THREE.Vector3())` declared above the callback, then calling `controlsRef.current.getTarget(targetRef.current)` inside `useFrame`. PROPOSAL: Add `const targetVecRef = useRef(new THREE.Vector3())` to `CameraController` at `AQI3DScene.tsx:57`; replace `const target = new THREE.Vector3()` at line 69 with reuse of `targetVecRef.current` — L/L effort.

- OBSERVATION: `hooks/useRealtimeAQI.ts:165–177` — `addToHistory` uses the React state updater `setHistory(prev => [...prev, snapshot])`. At steady state with 288 history entries, each update creates: (a) a 289-element spread allocation, then (b) a `.slice(-288)` creating a second 288-element copy — two O(N) allocations per SSE event (every 5 seconds for mock, every broadcast tick for live). Because `history` is React state and is exposed directly in the hook's return value (line 409), every history push re-renders all consumers of `useRealtimeAQI` including those that only destructure `{ cities, stats }`. The `timeRange` `useMemo` at line 201–213 also recomputes on every history push (it depends on `history` in its dep array). With 6–50 consumers possible in the component tree, each 5-second SSE tick may trigger 6–50 unnecessary re-renders of non-history consumers. PROPOSAL: Move the history ring buffer into a `useRef<HistoricalSnapshot[]>` (not state), expose a `historyRef` instead of `history` in the return value, and only call `setHistory` (for subscribers that need React reactivity on history) when `getDataAtTime` or the playback UI is actively used — L/M effort.

**Proposed actions:**
- Replace `useMemo` synchronous execution of `generateInterpolatedMatrix` in `TerrainMesh.tsx:239–241` with `React.useDeferredValue` on `aqiData`; or halve default `textureResolution` to 64 in `TerrainMesh.tsx:217` with a `maxResolution = 128` guard — L/L effort
- Refactor `PollutionLayer`/`PollutionCloud` in `PollutionVolume.tsx` to use a single `InstancedMesh`; merge all per-cloud `useFrame` callbacks into one parent-level handler — M/M effort
- Replace `const target = new THREE.Vector3()` at `AQI3DScene.tsx:69` with a `useRef`-cached Vector3 — L/L effort
- Move `useRealtimeAQI.ts` history buffer from state to ref to decouple SSE events from re-renders of non-history consumers — L/M effort

### Run #108 — 2026-06-01 — Lens: Dependency health
**Scope:** Eighth dependency health pass. Examined: `package.json` (all dependencies and devDependencies), `package-lock.json` (resolved versions, deprecated flags, transitive dependency tree for drei), `vite.config.ts` (manualChunks and build settings), `geointellisense-analytics/requirements.txt` (all Python constraints), `geointellisense-ingestion/Cargo.toml` and `Cargo.lock` (crate versions), import patterns in `components/3d/AQI3DScene.tsx:8`, `components/3d/CrossSectionView.tsx:8`, `components/3d/CityMarkers.tsx:8`. Cross-checked against Active Recommendations and runs #106–#107 (Latest Findings) plus archived dependency health runs #93, #78, #63, #48, #33, #18, #3 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `package.json:16` — `"@googlemaps/markerclusterer": "latest"` is the only dependency in the entire file that uses the floating `"latest"` tag instead of a semver range. All 11 other production dependencies (`@react-three/drei`, `@react-three/fiber`, `@types/three`, `date-fns`, `react`, `react-dom`, `react-router-dom`, `recharts`, `three`, and others) use `^x.y.z` pinning. The `"latest"` specifier is resolved at install time to whatever the registry's current latest tag points to; it is not locked by `npm ci` in the same deterministic way as a semver range. While `package-lock.json` currently resolves it to `2.6.2`, any `npm install` invocation on a fresh environment (or CI step using `npm install` rather than `npm ci`) could pull in a different major version if the package authors bump the latest tag to, e.g., `3.0.0`. This is a build-reproducibility risk specific to this one package. PROPOSAL: Replace `"@googlemaps/markerclusterer": "latest"` with `"@googlemaps/markerclusterer": "^2.6.2"` in `package.json:16` — L/L effort.

- OBSERVATION: `package.json:38` — `"concurrently": "^9.1.2"` is listed in `devDependencies` but no npm script in `package.json` references it. The seven defined scripts (`dev`, `build`, `preview`, `test`, `test:ui`, `test:run`, `test:coverage`) all invoke either `vite` or `vitest` directly. No `Makefile`, shell script, or `docker-compose.yml` service command invokes `concurrently` either. The lock file resolves it to `9.2.1`. `concurrently` is a tool for running multiple npm scripts in parallel (e.g., `concurrently "npm run dev" "npm run server"`), suggesting it may have been added during an earlier development phase when a backend dev server was run alongside the frontend — but that pattern was replaced by docker-compose. Keeping it adds ~400KB to `node_modules` and can cause confusion about which packages are actively used. PROPOSAL: Remove `"concurrently": "^9.1.2"` from `devDependencies` in `package.json:38` — L/L effort.

- OBSERVATION: `geointellisense-analytics/requirements.txt:17–18` — `scipy>=1.13,<1.15` and `joblib>=1.4,<1.5` both have explicit upper-bound exclusions that block currently-stable minor versions. `scipy 1.15` was released January 2025 and `joblib 1.5` was released November 2024; both are the current maintained branches receiving security patches. The `<1.5` upper bound on joblib was likely added to pin below an API-breaking change, but joblib 1.5's changelog lists only additive changes (new `Parallel` kwargs) with no breaking removals — the constraint is overly conservative. Similarly, `scipy<1.15` blocks `scipy 1.15.x` which includes the NumPy 2.x compatibility fixes important for the `numpy>=1.26,<2.1` co-constraint. The practical risk is that a fresh `pip install -r requirements.txt` in a Docker build will install `joblib 1.4.x` and `scipy 1.14.x` specifically, missing security patches released in 2025. `scikit-learn>=1.5,<1.7` (line 18) has a similar pattern: scikit-learn 1.6 (December 2024) is the current stable and the `<1.7` bound will begin blocking new patch releases. PROPOSAL: Remove the `<1.5`, `<1.15`, and `<1.7` upper bounds from `requirements.txt:17–18` (or widen them one minor version beyond the latest tested) and run a compatibility matrix test; these packages all follow semantic versioning with documented backwards-compatibility — L/L effort.

- OBSERVATION: `package-lock.json` — `@react-three/drei@10.7.7` declares `@mediapipe/tasks-vision@0.10.17` and `hls.js@1.6.15` as hard runtime dependencies (not optional, not peer). Both are present in `node_modules` (confirmed in lock file). `@mediapipe/tasks-vision` is required by drei's ML vision helpers (`FaceLandmarker`, `HandLandmarker`, `PoseLandmarker`, `FaceControls`) — none of which are imported anywhere in this project; only `OrbitControls`, `PerspectiveCamera`, `Environment`, `Stats`, `Text`, `Billboard`, `Html`, and `Line` are used (`AQI3DScene.tsx:8`, `CrossSectionView.tsx:8`, `CityMarkers.tsx:8`). `hls.js` is required by drei's `<Video>` component, which is also unused. Whether these packages survive Rollup's tree-shaking depends on whether drei's package entry exports them from a shared barrel that also exports the used symbols; if the barrel has side-effectful imports the tree-shaker cannot eliminate them. No bundle visualization tool (e.g., `rollup-plugin-visualizer`) is configured in `vite.config.ts`, so the actual `three-vendor` chunk size is unknown — the code comment at `vite.config.ts:21` claims "~800KB" but this estimate predates `@mediapipe/tasks-vision`'s inclusion as a hard dep in drei 10.x. PROPOSAL: Add `rollup-plugin-visualizer` as a devDependency; add `visualizer({ open: false, filename: 'dist/stats.html' })` to `vite.config.ts` plugins to produce a bundle map on each `npm run build`; use the output to verify the actual three-vendor chunk size and confirm `@mediapipe/tasks-vision` is tree-shaken — L/L effort.

**Proposed actions:**
- Replace `"@googlemaps/markerclusterer": "latest"` with `"^2.6.2"` in `package.json:16` — L/L effort
- Remove `"concurrently": "^9.1.2"` from `devDependencies` in `package.json:38` — L/L effort
- Remove upper-bound exclusions `<1.5` (joblib), `<1.15` (scipy), `<1.7` (scikit-learn) from `requirements.txt:17–18` after compatibility verification — L/L effort
- Add `rollup-plugin-visualizer` to devDeps; wire into `vite.config.ts` plugins to confirm actual `three-vendor` chunk size and verify `@mediapipe/tasks-vision` tree-shaking — L/L effort

### Run #107 — 2026-06-01 — Lens: Module boundaries
**Scope:** Eighth module boundaries pass. Examined: `hooks/useRealtimeAQI.ts` (all imports), `components/3d/CityMarkers.tsx` (exported types, lines 20–32), `components/3d/index.ts` (barrel exports), `types.ts` (shared type catalog), `services/dataService.ts` (imports lines 1–9), `geointellisense-analytics/app/claude.py` (lines 78–120, deferred imports), `geointellisense-analytics/app/routes/fires.py` (lines 1–28, shared state), `geointellisense-analytics/app/main.py` (lines 32–57, lifespan imports), `geointellisense-analytics/app/routes/water.py`, `routes/inversion.py`, `routes/predict.py` (start_* function presence). Cross-checked against Active Recommendations and runs #105–#106 (Latest Findings) plus archived module-boundaries runs #92, #77, #62, #47, #32, #17, #2 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` — `import type { CityData } from '../components/3d/CityMarkers'`. The `hooks/` layer imports a domain type (`CityData`) directly from a UI component file in `components/3d/`. `CityData` (defined at `CityMarkers.tsx:20`) describes a city entity with lat, lng, name, aqi, pm25, category, and color fields — it is a pure domain type, not a rendering concern. The proper dependency direction is `components → hooks`; here the flow is reversed. This means `CityMarkers.tsx` cannot be moved, renamed, or split without also updating the hook, and any future hook that needs city-entity types must also import from a component file. `types.ts` (at the project root) already exists as the canonical home for shared cross-layer types — it currently contains `ViewType`, `ChatMessage`, `GroundingChunk`, etc. — but `CityData` was never placed there. The barrel export at `components/3d/index.ts:16` re-exports `CityData`, which is used by `components/AirQualityMapView.tsx:30` and the hook, but it does not solve the layering problem. PROPOSAL: Move `CityData` (and `CityMarkersProps` if needed by non-3D consumers) to `types.ts`; update `CityMarkers.tsx`, `AirQualityMapView.tsx`, `components/3d/index.ts`, and `hooks/useRealtimeAQI.ts` to import from `types.ts` — L/L effort, score 1.0.

- OBSERVATION: `geointellisense-analytics/app/claude.py:103` and `claude.py:116` — Two deferred imports inside `get_system_with_live_context()` and `get_system_with_fire_context()` reach into the route layer: `from app.routes.fires import get_current_smoke_context`. `claude.py` sits at the bottom of the analytics dependency stack: every AI route (`chat.py:7`, `deep_analysis.py:7`, `grounded_search.py:7`, `grounded_maps.py:7`, `low_latency.py:7`, `predictive_analysis.py:8`) imports from `claude.py`. The deferred import creates an upward route-level dependency: `routes/*.py → claude.py → routes/fires.py`. The shared state `_smoke_context: str = ""` at `fires.py:22` and its accessor `get_current_smoke_context()` at `fires.py:25–27` exist solely to provide fire context to Claude; they are not part of the fires HTTP route logic. Embedding them in `routes/fires.py` means the core AI orchestration module (`claude.py`) must reach up into the routes layer to read a string. PROPOSAL: Move `_smoke_context` state and `get_current_smoke_context()` out of `routes/fires.py` into a new `app/shared_state.py` (or into `app/context.py`); update `routes/fires.py` to write to the shared state module, and `claude.py:103,116` to import from the shared-state module instead of from a route file — L/L effort, score 2.0.

- OBSERVATION: `services/dataService.ts:4` — `import { dashboardData, cityLocations } from '../data/dashboardData'; // Keep for fallback`. `DataService` is the primary live-data service: it aggregates results from `WeatherService`, `AirQualityService`, and the analytics REST API (`ANALYTICS_URL`). Importing static mock data (`dashboardData`) as a fallback couples the live-service module to the static-data module. This means: (a) `DataService` bears responsibility for two very different data sources — live API and static mock — making it harder to test either path independently; (b) any refactor of `dashboardData.ts` (e.g., changing city names, restructuring the object) may silently break `DataService`'s fallback paths; (c) the `// Keep for fallback` comment indicates the author intended this coupling to be temporary but it persists. The correct boundary is: `DataService` should either succeed in fetching live data or throw/return an error; static fallback presentation is a UI-layer concern and should live in the component or hook that calls the service. PROPOSAL: Remove the `dashboardData` import from `dataService.ts:4`; have the service throw on failure; update callers (`hooks/useNormalizedData.ts`) to catch errors and supply static fallback data directly — L/M effort, score 1.0.

- OBSERVATION: `geointellisense-analytics/app/routes/fires.py`, `routes/water.py`, `routes/inversion.py`, `routes/predict.py` — Each of these four route modules exports both an HTTP `router` object and a background-task lifecycle function: `start_fire_polling` (`fires.py`), `start_water_polling` (`water.py`), `start_inversion_polling` (`inversion.py`), `start_retrain_scheduler` (`predict.py`). `main.py:32–40` imports all four lifecycle functions alongside their routers. This conflates two distinct concerns inside a single module: (1) HTTP endpoint definition (the `router` and its handler functions), which should be stateless and testable in isolation; and (2) background worker lifecycle (async polling loops and scheduled tasks), which manage shared mutable state (e.g., `_poll_task`, `_smoke_context`, `_inversion_cache`). As a result, importing any of these route routers in a test also starts background polling tasks if the lifespan context is not carefully mocked. Tests that import `from app.routes.fires import router` for unit testing the HTTP layer will silently pull in the fire polling machinery. PROPOSAL: Extract the background polling functions and their shared state into a `app/workers/` package (`workers/fires.py`, `workers/water.py`, `workers/inversion.py`, `workers/predict.py`); import only `router` from route files; import `start_*` functions from the workers package; route files that need to read worker state (e.g., `get_current_smoke_context`) import it from the workers module — M/M effort, score 1.0.

**Proposed actions:**
- Move `CityData` to `types.ts`; update `CityMarkers.tsx:20–31`, `components/3d/index.ts:16`, `AirQualityMapView.tsx:30`, `hooks/useRealtimeAQI.ts:8` — L/L, score 1.0
- Extract `_smoke_context` + `get_current_smoke_context()` from `routes/fires.py:22–27` into `app/shared_state.py` or `app/context.py`; fix upward import in `claude.py:103,116` — L/L, score 2.0
- Remove `dashboardData` import from `services/dataService.ts:4`; push static fallback responsibility to callers — L/M, score 1.0
- Extract background polling from route modules into `app/workers/` package; decouple router imports from worker imports in `main.py:32–54` — M/M, score 1.0

## 📚 Archive (one line per past run)
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
