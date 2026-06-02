# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-02T16:10:00Z
Last run: #125 — Lens: Test coverage gaps

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
### Run #125 — 2026-06-02 — Lens: Test coverage gaps
**Scope:** Ninth test coverage gaps pass. Examined: all 7 existing test files (`App.test.tsx`, `tests/accessibility.test.tsx`, `tests/errorHandling.test.tsx`, `tests/integration.test.tsx`, `tests/routing.test.tsx`, `tests/security.test.tsx`, `tests/userPreferences.test.tsx`) and their import graphs; all TypeScript source files under `utils/`, `services/`, `hooks/`; `geointellisense-analytics/app/ml/aqi_model.py` (full); `geointellisense-analytics/app/cache.py` (full); `geointellisense-analytics/app/http_client.py` (full); `utils/interpolation.ts` (full); `utils/geo3d.ts` (full); `services/aiService.ts` (full); confirmed zero `#[test]` / `#[cfg(test)]` modules in `geointellisense-ingestion/src/`; confirmed zero `def test_*` / `pytest` / `unittest` in `geointellisense-analytics/`. Cross-checked against Active Recommendations and runs #123–#124 (Latest Findings) plus archived test-coverage-gap runs #5, #20, #35, #50, #65, #80, #95, #110 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `utils/interpolation.ts:125-192` — `interpolateKriging` contains two fallback branches that are entirely untested. First: line 131 (`if (dataPoints.length < 3) { return interpolateIDW(...); }`) silently falls back to IDW when fewer than 3 data points are provided; no test verifies this path or asserts that IDW is used instead of Kriging under this condition. Second: `solveLinearSystem` (line 262) returns `null` when the Kriging matrix is singular (detected at line 276 when `|augmented[i][i]| < 1e-10`), and `interpolateKriging:173` then falls back to `interpolateIDW` — again no test exercises a degenerate colinear or near-degenerate data set that would trigger matrix singularity. `interpolateKriging` is called from `generateInterpolatedGrid:325-328` and `generateInterpolatedMatrix:361-368`, which produce the 3D AQI volume texture and the terrain overlay rendered in `AQI3DScene.tsx`. A regression that removes either fallback (e.g., returning 0 instead of calling IDW) would produce incorrect visual output silently — no test would catch it. Additionally, `interpolateTemporal:383-398` throws a `new Error('Grids must have the same size…')` when `grid1.length !== grid2.length`, but no test exercises this invariant. PROPOSAL: Add a `utils/interpolation.test.ts` file with tests for: (a) `interpolateKriging` with n<3 points falls back to IDW, (b) `interpolateKriging` with colinear points (singular matrix) falls back to IDW, (c) `interpolateTemporal` throws on mismatched grid sizes, (d) `calculateGridStats` with a single-point grid returns correct min/max/mean — L/L effort (pure functions, no DOM or network dependencies).

- OBSERVATION: `utils/geo3d.ts:38-67` — `latLngToWorld` and `worldToLatLng` are pure, inverse mathematical functions used throughout the 3D scene: `WindField.tsx:203` calls `latLngToWorld` 3,000 times per SSE tick (documented in run #124), `CityMarkers.tsx:30-45` calls it per city marker, and `TerrainMesh.tsx` uses it for terrain grid generation. The round-trip identity `worldToLatLng(latLngToWorld(lat, lng)).lat ≈ lat` and `.lng ≈ lng` is a testable invariant with no test. Similarly, `haversineDistance:115-134` implements the Haversine great-circle formula — a pure function whose correctness is verifiable against known distances (e.g., Fresno at 36.74°N 119.77°W to Bakersfield at 35.37°N 119.02°W ≈ 157 km). The function is sensitive to edge cases: `dLat=0 && dLng=0` (same point → 0 km) and near-antipodal inputs where `a > 1` due to floating-point error in `Math.sqrt(a)` and `Math.sqrt(1-a)` would produce `NaN` from `Math.atan2`. No test covers any of these. PROPOSAL: Add a `utils/geo3d.test.ts` file (Three.js can be mocked at the Vector3 level for unit tests) testing: (a) `latLngToWorld`/`worldToLatLng` round-trip to within 1e-9 precision, (b) `haversineDistance` for Fresno→Bakersfield within ±1 km, (c) `haversineDistance(lat, lng, lat, lng) === 0`, (d) `getElevationAtPoint` center-of-valley returns near 75m (base elevation) — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:371-382` — The private function `_aqi_category` maps integer AQI values to the six EPA health category strings. It is called at `predict_aqi:303` and its output is embedded directly in the JSON response consumed by `AnalysisView.tsx`. The function's correctness at EPA boundary values — exactly 50 ("Good"), 51 ("Moderate"), 100 ("Moderate"), 101 ("Unhealthy for Sensitive Groups"), 150, 151, 200, 201, 300, 301 — has health communication implications: a user asking whether air quality is "Good" or "Moderate" at AQI=50 receives one of two meaningfully different health advisories. Because Python `if aqi <= 50` is inclusive, `aqi=50` maps to `"Good"` and `aqi=51` maps to `"Moderate"` — the correct EPA thresholds — but no test asserts this. Additionally, the "Hazardous" branch (`aqi > 300`) is the final `return` with no upper bound check: `_aqi_category(9999)` returns `"Hazardous"` which is correct, but `_aqi_category(-1)` also returns `"Good"` (because -1 ≤ 50) — no test validates negative-input behavior. There are also zero Python tests anywhere in `geointellisense-analytics/` (no `tests/` directory, no `pytest.ini`, no `conftest.py`). PROPOSAL: Create `geointellisense-analytics/tests/test_aqi_model.py` with pytest tests for `_aqi_category` at all six EPA boundary values (50, 51, 100, 101, 150, 151, 200, 201, 300, 301) and at the edge case AQI=0 and AQI=500; also add `pytest` and `pytest-asyncio` to `requirements.txt` to enable the test runner — L/L effort (pure function, no DB or network dependencies).

- OBSERVATION: `services/aiService.ts:4-6` — `API_BASE_URL` is a module-level constant set at import time from `import.meta.env.VITE_GATEWAY_URL`. The two code paths are: (1) gateway path — `${VITE_GATEWAY_URL}/api` — used in production deployments; (2) localhost fallback — `'http://localhost:8080/api'` — used in development. All 6 existing test files that exercise frontend behavior (`integration.test.tsx`, `security.test.tsx`, etc.) mock `global.fetch` at the component level and assert against `localhost:3002` or `localhost:8080`; none import `aiService.ts` directly or set `import.meta.env.VITE_GATEWAY_URL`. This means the production code path — the only path used when the app is deployed behind an API gateway — has never been tested. A bug in the URL template (e.g., if `VITE_GATEWAY_URL` already contains a trailing slash, the constructed URL becomes `https://gateway.example.com//api/chat`) would be silently deployed. Furthermore, none of the 7 exported functions in `aiService.ts` (`getChatResponse`, `getGroundedSearchResponse`, `getGroundedMapsResponse`, `getLowLatencyResponse`, `getDeepAnalysisResponse`, `getPredictiveAnalysisResponse`, `getWeatherForecastResponse`) has a unit test asserting the correct request shape (`method: 'POST'`, `Content-Type: application/json`, body serialization), the correct success path (returns `data.text`), or the error fallback strings. PROPOSAL: Add `services/aiService.test.ts` with vi.mock on `import.meta.env`, testing: (a) URL construction with and without `VITE_GATEWAY_URL` including trailing-slash normalization, (b) each function's fetch body serialization, (c) HTTP error path returns the documented fallback string, (d) network failure (thrown error) returns the documented fallback string — L/L effort (pure fetch wrappers, mock with `vi.fn()`).

**Proposed actions:**
- Add `utils/interpolation.test.ts` testing Kriging fallback to IDW (n<3 and singular matrix), `interpolateTemporal` throw on size mismatch, `calculateGridStats` on minimal input — L/L effort
- Add `utils/geo3d.test.ts` testing `latLngToWorld`/`worldToLatLng` round-trip, `haversineDistance` against known city pair, and zero-distance edge case — L/L effort
- Create `geointellisense-analytics/tests/test_aqi_model.py` with pytest covering `_aqi_category` at all six EPA boundary values; add `pytest` + `pytest-asyncio` to `requirements.txt` — L/L effort
- Add `services/aiService.test.ts` covering URL construction with/without `VITE_GATEWAY_URL`, request body shape, HTTP error fallbacks, and network failure fallbacks for all 7 exported functions — L/L effort

### Run #124 — 2026-06-02 — Lens: Perf hot paths
**Scope:** Tenth perf hot paths pass. Examined: `geointellisense-ingestion/src/db/persist.rs` (full), `geointellisense-ingestion/src/broadcast.rs` (full), `geointellisense-ingestion/src/config.rs` (full), `geointellisense-ingestion/src/aqi.rs` (full), `geointellisense-ingestion/src/purpleair.rs` (full), `components/MapView.tsx` (full, lines 1–499), `hooks/useRealtimeAQI.ts` (full), `components/3d/WindField.tsx` (full), `geointellisense-analytics/app/context.py` (lines 52–70). Cross-checked against Active Recommendations and runs #122–#123 (Latest Findings) plus archived perf hot paths runs #4, #19, #34, #49, #64, #79, #94, #109 (one-line archive) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:5-35` — `write_readings` executes one `INSERT INTO sensor_readings` per reading in a sequential `for` loop. With the default `BROADCAST_INTERVAL_SECS=5` (`config.rs:31`) and 6 stations, this is 6 sequential round-trips to PostgreSQL every 5 seconds — 72 individual inserts per minute. Each iteration calls `.execute(pool).await` which acquires a pool connection, serializes the query, waits for the TCP round-trip to PostgreSQL, and releases the connection. The function is called from `broadcast::spawn_ticker` on every tick (`broadcast.rs:115`). Replacing the loop with a single bulk `INSERT INTO sensor_readings (time, location_id, ...) SELECT * FROM unnest($1::timestamptz[], $2::uuid[], ...)` (using PostgreSQL's `unnest` for typed array parameters supported by `sqlx`) would reduce 6 sequential network round-trips to 1, cutting per-broadcast DB overhead by ~83%. At 5s intervals and realistic 2ms round-trips per query, the current approach spends ~12ms per tick in DB I/O vs. ~2ms with a batch insert. PROPOSAL: Refactor `write_readings` to collect all field arrays and execute a single `INSERT ... SELECT * FROM unnest(...)` statement; remove the per-reading loop and individual `.execute` calls — M/M effort (requires constructing unnest arrays with sqlx's `PgArguments` builder).

- OBSERVATION: `geointellisense-analytics/app/context.py:60-68` — The comment on line 60 reads `# Run all queries concurrently-ish (asyncpg handles connection pooling)`, but lines 61-68 consist of seven sequential `await` expressions: `context["aqi"] = await _get_aqi_context(pool)`, followed serially by `_get_forecast_context`, `_get_fire_context`, `_get_earthquake_context`, `_get_water_context`, `_get_enviroscreen_context`, and `_get_prediction_context`. Each of these helper functions issues at least one `pool.fetch` or `pool.fetchrow` query to PostgreSQL. A connection pool does not add concurrency between sequential awaits — each `await` suspends the coroutine until the previous query completes before the next query is even submitted. `build_live_context()` is called by `build_context_text()` (`context.py:73-75`), which is in turn called before every Claude API request from chat and analysis routes; the total latency of the context build step is therefore the sum of all seven independent query durations rather than the maximum. Wrapping the seven calls in `asyncio.gather` would submit all queries to asyncpg simultaneously and return when the last one completes — expected latency reduction from ~350ms (sum) to ~80ms (max). PROPOSAL: Replace the sequential `await` chain at `context.py:61-68` with `results = await asyncio.gather(_get_aqi_context(pool), _get_forecast_context(pool), _get_fire_context(pool), _get_earthquake_context(pool), _get_water_context(pool), _get_enviroscreen_context(pool), _get_prediction_context(pool)); context["aqi"], context["forecast"], ...` (7 names unpacked from `results`) — L/L effort (one structural change, no logic modifications).

- OBSERVATION: `components/MapView.tsx:232-375` — The marker-rendering `useEffect` at line 375 declares the dependency array `[layers, aqiData, firesData, quakeData, waterData, wellsData, wqData]`. On every broadcast tick (every 5 seconds from the ingestion service), `aqiData` changes, triggering the effect to execute in full: lines 237-239 tear down ALL markers across ALL layers (`markersRef.current.forEach(m => m.setMap(null))` and `clustererRef.current.clearMarkers()`), then lines 241-374 recreate every marker from scratch — including fire, earthquake, water, oil/gas well, and water quality markers that have NOT changed since the last tick. When the wells layer is enabled, up to 500 `google.maps.Marker` objects (the limit set at `MapView.tsx:136`) are destroyed and recreated every 5 seconds. Each `new google.maps.Marker()` instantiation (lines 247, 273, 323, 348) allocates a Google Maps JS API internal object and communicates with the Maps renderer. The per-tick teardown/rebuild of 500+ unchanged markers is the dominant Maps render bottleneck. PROPOSAL: Split the single monolithic effect into per-layer effects with isolated dependency arrays (e.g., `useEffect(() => { /* AQI markers only */ }, [aqiData, layers.aqi, map])`) so that a change in `aqiData` only triggers recreation of AQI markers without touching fire, earthquake, or well markers — M/M effort (requires splitting effects and storing per-layer marker refs).

- OBSERVATION: `components/3d/WindField.tsx:199-209` — Inside the `WindParticleSystem` `useMemo` at lines 180-231, the inner loop iterates `count` times (default 500 particles). For each particle, lines 199-209 iterate over every entry in `windData` to find the nearest wind source — this is an O(count × |windData|) scan. Because `latLngToWorld(wind.lat, wind.lng)` (`WindField.tsx:203`) performs a coordinate projection for each wind point inside the hot loop, the `|windData|` world-space projections are recomputed once per particle rather than once per wind point. With `count=500` and `|windData|=6`, this runs `latLngToWorld` 3,000 times on every `useMemo` recomputation. `windData` changes on every SSE broadcast tick (every 5 seconds), so this runs 3,000 projection calls per tick. Moving the `windData.map(w => ({ ...w, wx: latLngToWorld(w.lat, w.lng).x, wz: latLngToWorld(w.lat, w.lng).z }))` precomputation outside the particle loop (or memoizing it separately) would reduce projection calls from 3,000 to 6 per tick. PROPOSAL: Add a `const projectedWind = windData.map(w => { const {x, z} = latLngToWorld(w.lat, w.lng); return { ...w, x, z }; });` line before the particle loop at `WindField.tsx:188`, then change the inner loop at line 203 to use `wind.x` and `wind.z` directly — L/L effort (two-line change, no API surface changes).

**Proposed actions:**
- Refactor `db/persist.rs:write_readings` to batch all readings into a single PostgreSQL `unnest`-based INSERT — reduces per-broadcast DB round-trips from 6 to 1 — M/M effort
- Replace sequential `await` chain at `context.py:61-68` with `asyncio.gather(...)` — converts context build from sum-of-latencies to max-of-latencies, cutting pre-Claude latency from ~350ms to ~80ms — L/L effort
- Split the monolithic marker `useEffect` in `MapView.tsx:375` into per-layer effects — prevents 500+ well markers from being destroyed and rebuilt on every 5-second AQI update — M/M effort
- Precompute `latLngToWorld` projections before the particle loop in `WindField.tsx:188-209` — eliminates 2,994 redundant coordinate projections per SSE tick — L/L effort

### Run #123 — 2026-06-02 — Lens: Dependency health
**Scope:** Ninth dependency health pass. Examined: `package.json` (full), `package-lock.json` (lockfileVersion: 3; resolved top-level packages), `geointellisense-analytics/requirements.txt` (full), all Python source files for import cross-references (`grep -rn "^import\|^from" geointellisense-analytics/`), `geointellisense-ingestion/Cargo.toml` (full), `Cargo.lock` (rand section), `geointellisense-ingestion/src/aqi.rs` (rand API usage at lines 100–158), `components/MapView.tsx` (markerclusterer usage). Cross-checked against Active Recommendations and runs #121–#122 (Latest Findings) plus archived dependency health runs #3, #18, #33, #48, #63, #78, #93, #108 (one-line archive) to confirm findings are new.

**Findings:**

- OBSERVATION: `package.json:7` declares `"@googlemaps/markerclusterer": "latest"` — the only dependency in the entire manifest using the `latest` dist-tag rather than a semver range. `package-lock.json` currently pins this to version 2.6.2. However, `latest` is not a version constraint: when any developer runs `npm install` (as opposed to `npm ci`), npm resolves the `latest` tag at that moment against the registry and may update the lock file to a newer major version (e.g., a hypothetical 3.x with breaking API changes). The library is instantiated at `components/MapView.tsx:371` as `new MarkerClusterer({ markers: aqiMarkers, map })` — if a future resolution changes the `MarkerClusterer` constructor signature, the breakage would not be caught until runtime since TypeScript types would also update. All other 14 dependencies in `package.json` correctly use semver ranges. PROPOSAL: Replace `"latest"` with `"^2.6.2"` to lock the currently-resolved major/minor series while still accepting patch updates — L/L effort.

- OBSERVATION: `geointellisense-analytics/requirements.txt:1` lists `psycopg[binary]==3.2.*` as a dependency. A full-text search of all Python files in `geointellisense-analytics/` reveals zero imports of `psycopg` or `psycopg2` — only `asyncpg` is imported, exclusively in `app/database.py:1` (`import asyncpg`). `psycopg[binary]` installs both the `psycopg` wheel and the `psycopg-binary` C extension, which is a non-trivial installation artifact (compiled shared libraries linking against `libpq`) and a potential point of binary incompatibility on Alpine or ARM images where the psycopg binary wheel may not be available (requiring a source build against libpq headers). The analytics service is fully served by `asyncpg` for all PostgreSQL interactions (`database.py:5,8,11`); `psycopg` provides no used functionality. PROPOSAL: Remove `psycopg[binary]==3.2.*` from `requirements.txt` — L/L effort.

- OBSERVATION: `geointellisense-ingestion/Cargo.toml:21` specifies `rand = "0.8"`, resolved to `0.8.5` in `Cargo.lock`. The rand 0.8.x series is in maintenance-only mode; rand 0.9.0 was released January 2025 with a renamed stable API. The ingestion service uses rand's deprecated API: `geointellisense-ingestion/src/aqi.rs:100` calls `rand::thread_rng()` (renamed to `rand::rng()` in 0.9), and `aqi.rs:106,108,109,123–130,149,156–158` call `rng.gen_range(lo..hi)` (renamed to `rng.random_range(lo..hi)` in 0.9). The rand 0.8 → 0.9 migration is a well-documented one-time API rename with no behavioral changes for `gen_range`/`random_range` on uniform distributions. Remaining on 0.8.5 also keeps `getrandom` (rand's OS entropy source) at version 0.2.x rather than 0.3.x, an obstacle for any future WASM compilation target. PROPOSAL: Update `rand = "0.8"` to `rand = "0.9"` in `Cargo.toml:21`; rename `rand::thread_rng()` → `rand::rng()` and `rng.gen_range(a..b)` → `rng.random_range(a..b)` in `aqi.rs:100,106,108,109,123–130,149,156–158` — L/L effort.

- OBSERVATION: `geointellisense-analytics/requirements.txt:15` specifies `numpy>=1.26,<2.1`, a range that admits both NumPy 1.26.x (the final 1.x release series) and NumPy 2.0.x. NumPy 2.0 introduced API-breaking changes: copy-on-write semantics (NEP 47), removal of `np.string_` and `np.bool` aliases, changed integer type defaults on Windows, and altered structured-array comparison behavior. The analytics service's geospatial stack — `rasterio==1.4.*` used in `app/clients/dem.py:165,174,249` and `app/clients/landsat.py:164,185,234,255,328`, and `geopandas==1.0.*` in `app/clients/calenviroscreen.py:16` — performs GDAL-backed raster I/O and reprojection via C extensions that link against numpy C APIs that changed between 1.x and 2.x. `scipy.ndimage.zoom` (`landsat.py:255`) had integer-input behavior changes in NumPy 2.0. Without pinning to a single major, a developer whose `pip` resolves to NumPy 1.26.x and one resolving to NumPy 2.0.x will produce different numerical results from rasterio resampling with no diagnostic from either version. PROPOSAL: Narrow the numpy constraint to `numpy>=2.0.0,<2.1` (explicit 2.0.x commitment, dropping 1.26.x) or `numpy>=1.26.0,<2.0.0` (explicit 1.x commitment) to ensure all environments resolve the same major version — L/L effort.

**Proposed actions:**
- Change `"@googlemaps/markerclusterer": "latest"` to `"^2.6.2"` in `package.json:7` — prevents `npm install` from silently resolving to a newer major with breaking API changes — L/L effort
- Remove `psycopg[binary]==3.2.*` from `requirements.txt:1` — eliminates a dead C-extension dependency that inflates Docker image size without providing any used functionality — L/L effort
- Update `rand = "0.8"` → `rand = "0.9"` in `Cargo.toml:21`; rename deprecated API calls in `aqi.rs:100,106,108,109,123–130,149,156–158` — aligns ingestion service with current rand stable API — L/L effort
- Narrow numpy constraint in `requirements.txt:15` from `>=1.26,<2.1` to either `>=2.0.0,<2.1` or `>=1.26.0,<2.0.0` — eliminates cross-version numerical behavior differences between environments — L/L effort

## 📚 Archive (one line per past run)
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
