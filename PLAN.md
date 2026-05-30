# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T06:12:00Z
Last run: #50 — Lens: Test coverage gaps

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
### Run #50 — 2026-05-30 — Lens: Test coverage gaps
**Scope:** Fourth test-coverage pass. Examined all 7 existing test files (`App.test.tsx`, `tests/accessibility.test.tsx`, `tests/errorHandling.test.tsx`, `tests/integration.test.tsx`, `tests/routing.test.tsx`, `tests/security.test.tsx`, `tests/userPreferences.test.tsx`), `vite.config.ts`, `package.json`, `utils/weatherUtils.ts`, `utils/colorScales.ts`, `utils/geo3d.ts`, `utils/interpolation.ts`, `services/aiService.ts`, `geointellisense-analytics/app/ml/aqi_model.py`, `geointellisense-ingestion/src/aqi.rs` (and all other Rust source files). Archive summaries for runs #5, #20, #35 unavailable in full; findings below verified as new against all visible prior-run detail.

**Findings:**

- OBSERVATION: `utils/weatherUtils.ts:1-69` — All 4 exported functions are pure mathematical computations with zero test coverage. `calculateFeelsLike(temp, humidity, windSpeed)` at line 1 has two hard threshold boundaries: `temp >= 80 && humidity >= 40` switches to the Rothfusz heat-index polynomial (9 terms), while `temp <= 50 && windSpeed >= 3` switches to the NWS wind-chill formula. The boundary values themselves (temp=80/humidity=40 and temp=50/windSpeed=3) are on the exact formula-selection thresholds — no test verifies that (80, 39, any) returns raw temp but (80, 40, any) triggers the polynomial. `calculateET0` at line 18 expects `temp` in °F (based on the comparison implicit in input convention) but converts internally at line 19 (`const tempC = (temp - 32) * 5 / 9`) — if a caller passes Celsius directly (a plausible mistake), the Penman-Monteith result would be silently wrong by a factor of ~2–3x. `calculateSunTimes` at line 33 uses an astronomical day-of-year formula with known-ground-truth outputs: for date=2026-06-21 (summer solstice) at latitude=36.7 (Fresno), sunrise ≈ 5:47 AM, dayLength ≈ 14.5 hours — fully verifiable. `determineWeatherCondition` at line 58 has 9 branches; not a single branch is exercised by any existing test. PROPOSAL: Add `utils/weatherUtils.test.ts` with: (a) exact-boundary tests for `calculateFeelsLike` at temp=80/humidity=39 vs 40 and temp=50/windSpeed=2 vs 3; (b) known-output test for `calculateSunTimes` on the solstice; (c) branch-coverage tests for all 9 `determineWeatherCondition` paths.

- OBSERVATION: `utils/colorScales.ts:27,143` — `getAQICategory(aqi: number)` at line 27 uses `<=` boundaries (≤50 → 'good', ≤100 → 'moderate', etc.). The exact-boundary values AQI=50, 51, 100, 101, 150, 151, 200, 201, 300, 301 have concrete public-health significance (crossing any boundary changes the displayed health advisory label on the UI), yet no test verifies any of them. `interpolateColorStops(stops, position)` at line 143 initialises `lower = stops[0]` and `upper = stops[stops.length - 1]` as defaults before the loop. When `position=0.0` the loop at line 151 correctly selects `stops[0]/stops[1]` (condition `0 >= 0 && 0 <= 0.1` = true). When `position=1.0` the loop selects `stops[5]/stops[6]` (condition `1.0 >= 0.6 && 1.0 <= 1.0` = true). However, when `position` falls in the gap between the initial `lower.position` default (0) and the actual first stop beyond clamping, a future change from `<=` to `<` in the loop guard would silently snap all colors to the defaults `stops[0]` and `stops[last]` for any value at exact stop positions — a hard-to-notice regression. Zero tests cover these exact-stop inputs. The `vite.config.ts` test block at lines 35–41 has no `coverage` key despite `@vitest/coverage-v8` being installed and `"test:coverage": "vitest --coverage"` being defined in `package.json:13` — no minimum threshold prevents coverage regressions from merging silently. PROPOSAL: Add `utils/colorScales.test.ts` exercising: all AQI boundary values (50/51, 100/101, 150/151, 200/201, 300/301) in `getAQICategory`; `interpolateColorStops` at position=0.0, 0.5, 1.0, and a mid-stop exact value; `hexToRgb`/`rgbToHex` round-trip. Add coverage thresholds to `vite.config.ts` (e.g., `branches: 80, functions: 80`).

- OBSERVATION: `utils/geo3d.ts:38-68,115-138` — `latLngToWorld(lat, lng, elevation)` at line 38 returns a `THREE.Vector3` and `worldToLatLng(position)` at line 57 accepts a `THREE.Vector3` — they are an algebraic inverse pair. The round-trip `worldToLatLng(latLngToWorld(lat, lng))` must return `{lat, lng}` within floating-point tolerance, but no test verifies this. The three.js `Vector3` constructor is pure JavaScript with no WebGL dependency, so the jsdom test environment can exercise these functions without a canvas or WebGL context. `haversineDistance(lat1, lng1, lat2, lng2)` at line 115 uses `EARTH_RADIUS_KM = 6371` (line 28); the known city-pair Fresno (36.7378°N, 119.7871°W) → Bakersfield (35.3733°N, 119.0187°W) is approximately 156 km — a computable ground truth for a unit test. Both `latLngToWorld` and `haversineDistance` are cited in Run #49 findings (perf lens) as functions whose call frequency matters; a future perf-optimization refactor (e.g., inlining the arithmetic) could silently introduce a sign error without a round-trip test to catch it. PROPOSAL: Add `utils/geo3d.test.ts` with: (a) `worldToLatLng(latLngToWorld(lat, lng))` round-trip for three representative San Joaquin Valley lat/lng pairs; (b) `haversineDistance(Fresno, Bakersfield)` vs. expected ~156 km ±1 km; (c) `latLngToWorld` sign check (north of center → negative z, east of center → positive x).

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs:88` — The entire Rust service has zero `#[cfg(test)] mod tests` blocks across all 9 source files (`aqi.rs`, `broadcast.rs`, `config.rs`, `db/mod.rs`, `db/persist.rs`, `main.rs`, `purpleair.rs`, `redis_cache.rs`, `usgs.rs`, `routes/*.rs`). `aqi_category(aqi: u32) -> (&'static str, &'static str)` at `aqi.rs:88` is a pure function returning the EPA AQI label and hex color; it has no I/O, no async, and no external dependencies — `cargo test` can exercise it in under 1 ms. The critical boundary: `aqi=150` must return `("Unhealthy for Sensitive Groups", "#ff7e00")` but `aqi=151` must return `("Unhealthy", "#ff0000")`. `round2(v: f64) -> f64` at `aqi.rs:164` performs `(v * 100.0).round() / 100.0`; used throughout `generate_readings()` to round simulated sensor values, but zero tests verify its behavior at boundary inputs (e.g., `round2(0.005)` — banker's rounding in Rust's `f64::round` rounds half to nearest even, not always up). PROPOSAL: Add `#[cfg(test)] mod tests` block at bottom of `aqi.rs` with tests for: all 6 AQI category boundaries in `aqi_category`; `round2(1.005) → 1.01` and `round2(0.005)` (documenting the f64 rounding behavior).

- OBSERVATION: `geointellisense-analytics/` — Complete absence of pytest infrastructure: no `conftest.py`, no `pytest.ini`, no `pyproject.toml [tool.pytest.ini_options]`, and `requirements.txt` does not include `pytest` or `pytest-asyncio`. With 30+ route modules, 15 external-API client modules, and the ML pipeline in `aqi_model.py`, zero Python tests exist. The most tractable starting point is `_aqi_category(aqi: int) -> str` at `aqi_model.py:371`, a pure function with 6 conditional branches — identical in structure to `aqi_category` in `aqi.rs:88` and `getAQICategory` in `colorScales.ts:27`. All three are unsynchronized copies: Python uses `if aqi <= 50` returning `"Good"`, Rust uses `if aqi <= 50` returning `"Good"` label and a hex color, TypeScript uses `if (aqi <= 50)` returning string key `'good'`. A label divergence (e.g., Python boundary accidentally changed to `< 50`) would produce inconsistent category strings in ML prediction responses vs. UI display without any test to surface it. `get_model_status()` at line 71 is also pure (reads module-level `_model` variable) and trivially testable. PROPOSAL: (a) Add `pytest>=7.4` and `pytest-asyncio>=0.23` to `requirements.txt`; (b) create `geointellisense-analytics/tests/test_aqi_model.py` with parametrized tests for all 6 `_aqi_category` boundaries; (c) add a cross-language boundary-parity comment in all three implementations documenting that they must agree.

**Proposed actions:**
- Add `utils/weatherUtils.test.ts` with formula-boundary and branch-coverage tests for all 4 functions — M/L, score 2.0; does not enter top 10
- Add `utils/colorScales.test.ts` covering AQI boundary values and `interpolateColorStops` exact-stop inputs; add coverage thresholds to `vite.config.ts` — M/L, score 2.0; does not enter top 10
- Add `utils/geo3d.test.ts` with `latLngToWorld`/`worldToLatLng` round-trip and `haversineDistance` vs. known city-pair ground truth — H/M, score 1.5; does not enter top 10
- Add `#[cfg(test)] mod tests` block to `aqi.rs` covering `aqi_category` boundaries and `round2` rounding behavior — M/L, score 2.0; does not enter top 10
- Add `pytest`/`pytest-asyncio` to `requirements.txt`; create `tests/test_aqi_model.py` with parametrized `_aqi_category` boundary tests — H/M, score 1.5; does not enter top 10

### Run #49 — 2026-05-30 — Lens: Perf hot paths
**Scope:** Fourth perf-hot-paths pass. Examined: `components/3d/TerrainMesh.tsx`, `components/3d/WindField.tsx`, `components/3d/PollutionVolume.tsx`, `utils/interpolation.ts`, `geointellisense-analytics/app/ml/aqi_model.py` (lines 314–369), `geointellisense-ingestion/src/broadcast.rs`. Active Recommendations row 5 (`Batch DB writes in persist.rs`) noted as already captured from run #4. Prior perf-run details (runs #4, #19, #34) available as one-line archive summaries only; findings below verified as new against all visible prior runs.

**Findings:**

- OBSERVATION: `components/3d/TerrainMesh.tsx:239-241` + `utils/interpolation.ts:347-374` — `createAQIOverlayTexture` is memoized on `[aqiData, textureResolution]` with no change-detection guard. Every time the `aqiData` prop receives a new array reference (which happens on each 5-second AQI tick in `useRealtimeAQI.ts`, even if values are unchanged), `generateInterpolatedMatrix` is called with `width=128, height=128`. That function (`interpolation.ts:358-373`) runs a double loop of 128×128 = 16,384 iterations, and each cell calls `interpolateIDW` (`interpolation.ts:51-102`) which does a `.map()` + `.filter()` + `.sort()` + weight-accumulation pass over all `aqiData` points (6 stations). Total: ≈16,384 × (6 sort comparisons + 6 weight ops) ≈ 196K arithmetic operations per rebuild. This runs synchronously on the JS main thread, blocking rendering. `createDataTexture` then uploads a 128×128 RGBA Uint8Array (65KB) to the GPU via WebGL `texImage2D`. No comparison against the previous `aqiData` values is performed — the rebuild fires even when the maximum AQI delta across stations is 0. PROPOSAL: Store the previous `aqiData` values in a `useRef`; skip `createAQIOverlayTexture` when max absolute delta across stations is below a threshold (e.g., 2 AQI units). Alternatively, offload `generateInterpolatedMatrix` to a `useMemo` with a stable identity key derived from the actual station values, preventing spurious rebuilds from reference churn.

- OBSERVATION: `components/3d/PollutionVolume.tsx:271-280` + `utils/interpolation.ts:309-341` — `PollutionVolume` calls `generateInterpolatedGrid(aqiData, SAN_JOAQUIN_BOUNDS, 12, 'idw', { power: 2 })` inside a `useMemo([aqiData, resolution])` block. `generateInterpolatedGrid` at `resolution=12` generates `(12+1)² = 169` grid points, each invoking `interpolateIDW`. The resulting `gridPoints` array is consumed by `PollutionLayer` (`PollutionVolume.tsx:217-253`), which renders a `PollutionCloud` component for every `GridPoint` with `value > 30`. Each `PollutionCloud` registers a `useFrame` callback (`PollutionVolume.tsx:174-183`) that, at 60 fps, updates `materialRef.current.uniforms.time.value` and `materialRef.current.uniforms.cameraPos.value`, and repositions `meshRef.current.position.y` via `Math.sin()`. With 3 layers × up to all 169 filtered grid points, potentially dozens of `useFrame` handlers each call `Math.sin()` every frame. Beyond the per-frame cost, the `useMemo` uses referential equality on `aqiData`, so any new array reference (even with identical values) re-triggers the 169-cell IDW grid calculation. PROPOSAL: (a) Replace `useMemo([aqiData, ...])` with a stable key derived from the actual AQI values array fingerprint (e.g., join of rounded values), preventing spurious recalculations. (b) Consolidate the per-cloud `useFrame` update into a single parent `useFrame` that sets a shared `timeUniform` and `cameraPos` once, then iterates all material refs—removing O(N) individual frame callback registrations.

- OBSERVATION: `components/3d/WindField.tsx:199-209` — Inside the `useMemo` that initializes particle attributes for 500 particles, the inner nearest-neighbor search calls `latLngToWorld(wind.lat, wind.lng)` once per `windData` entry per particle: `count × windData.length` total calls (500 × N, where N is typically 6–12 wind data points = 3,000–6,000 redundant calls to the same conversion for the same fixed wind positions). `latLngToWorld` performs arithmetic involving `SAN_JOAQUIN_BOUNDS` constants plus a scale multiplication—cheap individually but wasteful when repeated per particle. Furthermore, `Math.sqrt(Math.pow(x - wx, 2) + Math.pow(z - wz, 2))` at line 204 computes a square root that is unnecessary for nearest-neighbor selection: comparing squared distances `(x-wx)²+(z-wz)² < nearestDistSq` is monotonically equivalent and avoids 500 `Math.sqrt` calls per particle initialization. PROPOSAL: Pre-compute wind world positions once outside the particle loop: `const windWorldPositions = windData.map(w => ({ ...latLngToWorld(w.lat, w.lng), ...w }))`, then reference `windWorldPositions[j]` inside the particle loop. Replace `Math.sqrt(...)` with squared-distance comparison and rename `nearestDist` to `nearestDistSq` initialized to `Infinity`.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:119-126` — The broadcast ticker's Redis block acquires `redis.lock().await` (a `tokio::sync::Mutex`), then inside the critical section performs: (a) `serde_json::to_string(&readings)` — JSON serialization of the entire readings Vec; (b) `redis_cache::cache_snapshot(conn, &json).await` — a Redis SET command with an await; (c) `redis_cache::set_heartbeat(conn).await` — a second Redis command with an await. Both Redis awaits are `.await` calls that yield to the Tokio executor while holding the lock. Three independent tasks contend on this same Mutex: the broadcast ticker (every `broadcast_secs`), the PurpleAir poller (line 62: `redis_pa.lock().await` — same Arc clone), and the earthquake poller (line 143: `redis.lock().await`). While one task is suspended inside a Redis round-trip while holding the lock, all other tasks block. `ReadCache` (`LiveCache`) correctly uses `Arc<RwLock<...>>` at line 15, but `RedisConn` at line 21 uses `Arc<Mutex<...>>` — an asymmetry that prevents concurrent Redis reads. PROPOSAL: Move `serde_json::to_string(&readings)` before the `redis.lock()` block (serialize outside the critical section); send both Redis commands as a pipeline (single round-trip) instead of two awaits; or replace `Mutex` with a design that doesn't hold a lock across async suspension points (e.g., a dedicated Redis task that receives snapshots over a channel).

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:317-347` — `_get_current_features` issues three sequential database round-trips: `await pool.fetchrow(aqi_query)` → `await pool.fetchrow(fire_query)` → `await pool.fetchrow(inv_query)`. These queries are independent and could run concurrently via `asyncio.gather`. The `fire_query` (line 332–342) applies `ST_DWithin(geom::geography, ..., 200000)`: the `fire_detections.geom` column is stored as `geometry` type (without explicit SRID enforcement), and the `::geography` cast at each row forces an implicit coordinate system conversion per row scanned. If a GIST index exists on `geom` but not on `geom::geography`, PostGIS falls back to a sequential scan for the geography-typed distance check. `_get_current_features` is called on every `/api/predictive-analysis` request with no caching between calls — if two concurrent requests arrive within the same 5-minute window, three sequential DB queries (including the spatial one) are issued twice. PROPOSAL: (a) Replace the three sequential awaits with `asyncio.gather(pool.fetchrow(aqi_q), pool.fetchrow(fire_q), pool.fetchrow(inv_q))` to run them concurrently. (b) Create `GIST` index on `fire_detections.geom::geography` (a functional index: `CREATE INDEX idx_fire_geog ON fire_detections USING GIST((geom::geography))`). (c) Cache the feature vector with a TTL of 5 minutes (matching prediction refresh cadence).

**Proposed actions:**
- Add AQI value-delta guard before `createAQIOverlayTexture` in `TerrainMesh.tsx:239`; skip rebuild when max station delta < 2 — H/L, score 3.0; ties current top 10, does not displace
- Stabilize `PollutionVolume.tsx:271` useMemo key on actual AQI values; consolidate per-cloud `useFrame` into single parent handler — H/L, score 3.0; ties current top 10, does not displace
- Hoist `latLngToWorld` wind pre-computation outside particle loop in `WindField.tsx:199`; replace `Math.sqrt` with squared-distance comparison — M/L, score 2.0; does not enter top 10
- Move JSON serialization before `redis.lock()` in `broadcast.rs:119`; pipeline two Redis commands — M/M, score 1.0; does not enter top 10
- Use `asyncio.gather` for three sequential queries in `aqi_model.py:317`; add GIST index on `fire_detections.geom::geography`; cache features 5 min — H/M, score 1.5; does not enter top 10

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

## 📚 Archive (one line per past run)
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
