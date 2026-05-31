# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-31T13:07:15Z
Last run: #80 — Lens: Test coverage gaps

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
### Run #80 — 2026-05-31 — Lens: Test coverage gaps
**Scope:** Sixth test-coverage-gaps pass. Examined: `utils/interpolation.ts`, `utils/colorScales.ts`, `utils/weatherUtils.ts`, `hooks/useRealtimeAQI.ts`, `geointellisense-analytics/app/ml/aqi_model.py`. Cross-checked against prior test-coverage runs #5, #20, #35, #50, #65 to confirm all findings are new. Test files reviewed: `App.test.tsx`, `tests/accessibility.test.tsx`, `tests/errorHandling.test.tsx`, `tests/integration.test.tsx`, `tests/routing.test.tsx`, `tests/security.test.tsx`, `tests/userPreferences.test.tsx`.

**Findings:**

- OBSERVATION: `utils/interpolation.ts:261-300` — `solveLinearSystem` is a private Gaussian-elimination function called by `interpolateKriging` at line 170. Its singular-matrix detection path (`if (Math.abs(augmented[i][i]) < 1e-10) return null` at line 276) is never exercised by any test. When `solveLinearSystem` returns `null`, `interpolateKriging` falls back to IDW at line 173. No test verifies this fallback occurs (rather than a crash or a silently wrong result). Concretely: if a caller provides collinear data points (e.g., three stations at the same latitude with different longitudes), the Kriging matrix becomes rank-deficient; the singular-path `return null` fires at line 277; `interpolateKriging` calls `interpolateIDW`. Without a test, a future refactor that returns `[]` (empty array) instead of `null` for the singular case would silently produce a zero-AQI value from the weight loop at `interpolateKriging:181` across every affected grid cell, rather than triggering the IDW fallback — corrupting the displayed AQI map without any error. PROPOSAL: Add a test with three collinear `DataPoint` values; assert that `interpolateKriging` returns a result whose `value` matches the IDW result and is not `0` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `utils/colorScales.ts:143-172` — `interpolateColorStops` has two degenerate-input paths with no test coverage. (a) Single-element `stops` array: lines 148-149 set both `lower` and `upper` to `stops[0]`; the loop at line 151 iterates zero times; `range = upper.position - lower.position = 0`; `localT = 0`; the function returns `lower.color`. This is arguably correct, but entirely untested — if `stops` accidentally had one element due to a data error, the function would silently return a single color for all AQI values, making the entire map appear monochrome with no visible error. (b) Two consecutive stops with identical `position` values (a hard stop): `range` is `0`, `localT` is `0`, and the function always returns `lower.color` regardless of how far through the band the position lies. No gradient stops in the current codebase share a position, but this is a precondition enforced only by convention; no runtime check or test guards it. `interpolateColorStops` is called by `getInterpolatedAQIColor` (line 177), `getInterpolatedWindColor`, and `getInterpolatedPressureColor` — all of which feed the map's live color rendering. PROPOSAL: Add tests for `interpolateColorStops` with (a) a single-element stops array, (b) two stops with identical positions, (c) a position exactly equal to a stop boundary — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `utils/weatherUtils.ts:38` — `calculateSunTimes` computes `Math.acos(-Math.tan(latRad) * Math.tan(declinationRad))`. `Math.acos` is only defined on `[-1, 1]`; arguments outside this range return `NaN`. For latitudes beyond ~66.5° N/S (the Arctic/Antarctic circles), during summer or winter solstice the argument exceeds `1` or drops below `-1` (polar day / polar midnight). `formatTime(NaN)` at line 46 produces `"NaN:NaN AM"`, and `dayLength` becomes `NaN`. The function has no domain guard and no `isNaN` check. The San Joaquin Valley (lat ~36°N) is well within the safe range, but the utility is exported as a general function and `calculateSunTimes` is called from `services/WeatherService.ts` with a `latitude` parameter derived from user-selected locations. If a future dataset includes stations in Canada or Alaska, or if the location selector is extended northward, the bug becomes active. No test exercises `latitude` values above 66° — there is no test file for `weatherUtils.ts` at all. PROPOSAL: Add a `weatherUtils.test.ts` covering `calculateFeelsLike` boundary conditions (`temp=80/humidity=40`, `temp=50/windSpeed=3`, the gap between the two formula regions), `calculateET0` with `temp=32°F` (0°C, denominator at `237.3`), and `calculateSunTimes` with `latitude=70` to validate the NaN path is handled — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `hooks/useRealtimeAQI.ts:309-311` — The `aqi-update` SSE event handler maps incoming readings via `r.stationName.split('-')[0]` (lines 310, 311) without a null guard. If the Rust ingestion service sends a reading where `stationName` is `null` or `undefined` — which can occur for PurpleAir sensors that only expose a numeric sensor ID (the `stationName` field in `aqi.rs` is constructed from station metadata, not the raw sensor record) — `null.split('-')` throws `TypeError: Cannot read properties of null (reading 'split')`. The outer `try/catch` at lines 287/340 catches the exception and logs `console.error`, silently discarding the entire SSE event (all stations in that batch, not just the malformed one). Since the `readings` array at line 288 is parsed from the full SSE payload, a single null `stationName` in a multi-station update drops all stations' data for that cycle. No test exercises a payload containing `null` or `undefined` `stationName` values. The current `tests/integration.test.tsx` mocks the SSE endpoint but only with well-formed station names. PROPOSAL: Add a test that injects a synthetic SSE `aqi-update` event with one reading having `stationName: null`; assert that the hook either (a) skips the malformed reading and retains valid city data, or (b) falls back to mock data — currently neither behavior is specified — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:183-184` — `build_training_data` uses Python's `or` operator for null-coalescing on feature columns: `r["temperature"] or 20` (line 183) and `r["humidity"] or 50` (line 184). In Python, `0 or 20` evaluates to `20` because `0` is falsy. This means any sensor reading with `temperature = 0` (which occurs at freezing air temperatures in Fahrenheit: 0°F = -17.8°C, plausible in the Sierra Nevada) is silently replaced with `20` in the training feature matrix. Similarly `humidity = 0%` (extremely dry conditions) is replaced with `50%`. The `None` case is handled correctly by `or`, but the `0` case introduces systematic model bias: the model is never trained on actual 0°F temperatures, but will be asked to predict for them at inference time (line 267's `predict_aqi` is passed live sensor values without the same coalescing at `routes/predict.py:75-97`). There is no test for `build_training_data` at all — no file under `geointellisense-analytics/` contains a test for the ML module. The fix is to replace `or` with explicit `if x is None` checks or `0 if x is None else x`. PROPOSAL: Add `tests/test_aqi_model.py` testing `build_training_data` with a mock pool that returns rows containing `temperature=0`, `humidity=0`, and `aqi=0`; assert the feature vector preserves `0` rather than substituting defaults — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Add test for `interpolateKriging` with collinear data points; verify IDW fallback fires (not a zero-value) — `utils/interpolation.ts:261-300` — M/L, score 2.0; does not displace top 10
- Add `interpolateColorStops` tests: single-element stops, identical-position stops, position exactly on boundary — `utils/colorScales.ts:143-172` — L/L, score 1.0; does not displace top 10
- Create `weatherUtils.test.ts`; cover `calculateFeelsLike` boundary conditions and `calculateSunTimes(date, 70)` for NaN path — `utils/weatherUtils.ts:38` — L/L, score 1.0; does not displace top 10
- Add SSE integration test with `stationName: null` reading; specify expected behavior (skip vs. fallback) — `hooks/useRealtimeAQI.ts:309-311` — M/L, score 2.0; does not displace top 10
- Create `tests/test_aqi_model.py`; test `build_training_data` with `temperature=0` and `humidity=0` rows to catch `or`-coalescing zero-value bug — `app/ml/aqi_model.py:183-184` — M/L, score 2.0; does not displace top 10

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

- OBSERVATION: `vite.config.ts:21` documents the `three-vendor` manual chunk as `~800KB`, but `vite.config.ts:33` sets `chunkSizeWarningLimit: 500`. Every production build will emit a Vite size warning for the `three-vendor` chunk despite this being an intentional design decision, causing build-log noise that may mask genuine new warnings. Furthermore, `@react-three/drei@10.7.7` (locked at `package-lock.json`) lists `@mediapipe/tasks-vision@0.10.17` as a hard `dependency` (not `optionalDependency` or `peerDependency`). `@mediapipe/tasks-vision` is a full computer vision SDK (face landmarks, hand-tracking, object detection). None of the drei components that require it (`FaceControls`, `FaceLandmarker`, `HandsControls`, `Webcam`) are imported anywhere in the project — `grep` across all `.ts`/`.tsx` files confirms zero uses. Despite Vite tree-shaking, `@react-three/drei`'s entry point statically references the mediapipe wrapper during module initialization. PROPOSAL: (a) Raise `chunkSizeWarningLimit` in `vite.config.ts:33` to at least `1000` to suppress the known-intentional three-vendor warning; (b) consider replacing `@react-three/drei` with targeted alternatives for the handful of drei helpers this project actually uses (`OrbitControls`, `Html`, `Billboard`, `Text`) to eliminate the mediapipe transitive payload.

- OBSERVATION: `geointellisense-ingestion/Cargo.toml:20` specifies `rand = "0.8"`, locked at `rand 0.8.5` by `Cargo.lock:1413`. `rand 0.9.0` was released in February 2025 and introduces several improvements, notably deprecating `rand::thread_rng()` — the exact API called at `aqi.rs:100` (`let mut rng = rand::thread_rng()`) and `aqi.rs:139` (`let mut rng = rand::thread_rng()`). In rand 0.9, `thread_rng()` was replaced by `rand::rng()` and the crate's overall API was cleaned up. The `Cargo.toml` edition `"2024"` (line 4) targets the Rust 2024 edition, making the rand 0.8 pin the oldest dependency in the manifest by two major versions. Cargo's pre-1.0 semver rules mean `rand = "0.8"` will never auto-resolve to 0.9, so the project is explicitly pinned to a stale release branch. The `.gen_range(a..b)` calls at `aqi.rs` are syntactically unchanged between 0.8 and 0.9; only the `thread_rng()` → `rng()` rename is required. PROPOSAL: Update `Cargo.toml:20` to `rand = "0.9"`; change `aqi.rs:100` and `aqi.rs:139` from `rand::thread_rng()` to `rand::rng()`; run `cargo build --release` to verify no remaining API incompatibilities.

- OBSERVATION: `geointellisense-analytics/requirements.txt:16-18` applies upper bounds to three ML packages — `scipy>=1.13,<1.15`, `scikit-learn>=1.5,<1.7`, `joblib>=1.4,<1.5` — while leaving `polars`, `fastapi`, `anthropic`, and other dependencies as wildcard `.*` ranges. As of May 2026, `scipy 1.15.x`, `scikit-learn 1.7.x`, and `joblib 1.5.x` are all available stable releases. The upper bounds block installation of these in new Docker builds without any documented justification in the file. The actual usage is minimal and stable: `scipy` is only used for `scipy.ndimage.zoom` at `app/clients/landsat.py:255` (stable API since scipy 1.0); `scikit-learn` only uses `GradientBoostingRegressor`, `train_test_split`, `mean_absolute_error`, `r2_score` at `app/ml/aqi_model.py:209-211` (unchanged across 1.x); `joblib` only uses `dump`/`load` at `aqi_model.py:62-64,257-258` (backward-compatible serialization in 1.5). The asymmetric constraint strategy — pinning these three with upper bounds while leaving other deps as `.*` wildcards — provides a false sense of reproducibility: `polars==1.24.*` can drift across patch versions but `scipy<1.15` is blocked from security patches. PROPOSAL: Remove the upper bounds: change line 16 to `scipy>=1.13`, line 17 to `scikit-learn>=1.5`, line 18 to `joblib>=1.4`; or adopt `pip-tools` to generate a fully-pinned `requirements.lock` file for true reproducibility.

**Proposed actions:**
- Replace `"latest"` with `"^2.6.2"` for `@googlemaps/markerclusterer` at `package.json:16` — M/L, score 2.0; does not displace top 10
- Remove unused `psycopg[binary]==3.2.*` from `requirements.txt:4` — L/L, score 1.0; does not displace top 10
- Raise `chunkSizeWarningLimit` in `vite.config.ts:33` to `1000`; investigate replacing `@react-three/drei` with targeted deps to drop mediapipe payload — M/M, score 1.0; does not displace top 10
- Update `Cargo.toml:20` to `rand = "0.9"`; update `aqi.rs:100,139` from `thread_rng()` to `rng()` — M/M, score 1.0; does not displace top 10
- Remove upper bounds from `requirements.txt:16-18` for scipy/scikit-learn/joblib; or adopt pip-tools lock file — M/L, score 2.0; does not displace top 10

## 📚 Archive (one line per past run)
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
