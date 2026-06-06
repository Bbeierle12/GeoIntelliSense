# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-06T20:15:00Z
Last run: #185 — Lens: Test coverage gaps

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Sanitize AI result before `dangerouslySetInnerHTML` in `AnalysisView.tsx` | UX/Security | H | L | 7 | Open |
| 2 | `GET /api/maps-config` exposes Google Maps API key to unauthenticated callers | Security | H | L | 9 | Open |
| 3 | `POST /api/predict/train` is unauthenticated — any client can trigger expensive model retraining | Security | H | L | 9 | Open |
| 4 | `/api/predictive-analysis` and `/api/weather-forecast` have no auth or rate limiting — any public caller can burn Anthropic credits | Security/LLM | H | L | 13 | Open |
| 5 | `context.py:394` SELECT uses `unit` instead of `units` — water-level data silently absent from all Claude system prompts | Data pipeline | H | L | 113 | Open |
| 6 | Upgrade `vitest` / `@vitest/ui` / `@vitest/coverage-v8` from 4.0.13 to ≥4.1.0 — CVSS 9.8 arbitrary file read/execute via UI server (GHSA-5xrq-8626-4rwp) | Security/Dep | H | L | 168 | Open |
| 7 | Upgrade `react-router-dom` from 7.9.6 to ≥7.14.3 — 9 active advisories incl. RCE via turbo-stream deserialization (GHSA-49rj-9fvp-4h2h, CVSS 8.1) | Security/Dep | H | L | 168 | Open |
| 8 | Add retry+backoff to Rust `PurpleAirClient::fetch_sensors` | Data pipeline | H | L | 8 | Open |
| 9 | Redis-down skips all PurpleAir/earthquake polling — default toggle to ON when Redis unavailable | Data pipeline | H | L | 8 | Open |
| 10 | Upgrade `vite` from 6.4.1 to ≥6.5.0 AND change `host` from `'0.0.0.0'` to `'127.0.0.1'` in `vite.config.ts:9` — GHSA-p9ff-h696-f583 file read amplified by all-interfaces binding | Security/Dep | H | L | 168 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #185 — 2026-06-06 — Lens: Test coverage gaps
**Scope:** Fifteenth Test coverage gaps pass. Files examined in full: `vite.config.ts`; `tests/setup.ts`; `App.test.tsx`; `tests/accessibility.test.tsx`; `tests/security.test.tsx`; `tests/integration.test.tsx`; `tests/userPreferences.test.tsx`; `tests/routing.test.tsx`; `tests/errorHandling.test.tsx`; `utils/interpolation.ts`; `utils/colorScales.ts`; `services/AirQualityService.ts`; `hooks/useDashboardData.ts`; `hooks/useNormalizedData.ts`. Cross-checked against Active Recommendations and archived Test coverage runs #5, #20, #35, #50, #65, #80, #95, #110, #125, #140, #155, #170 to confirm findings are new.

**Findings:**

- OBSERVATION: `vite.config.ts:35-40` — The `test` configuration block contains `globals: true`, `environment: 'jsdom'`, `setupFiles: './tests/setup.ts'`, and `css: true`, but has no `coverage` sub-key at all. The `package.json` script `"test:coverage": "vitest run --coverage"` triggers `@vitest/coverage-v8` but without a `coverage.thresholds` block in `vite.config.ts`, coverage can silently drop to 0% on any branch and the command still exits 0. CI (if wired to `test:coverage`) would pass with zero coverage, and there is no automated enforcement of a minimum bar. The project currently has 7 test files covering approximately 20% of source files (77 of 97 source files have no test counterpart). Without threshold enforcement, incremental deletions of test code or addition of new untested source files are invisible to the CI gate. A minimal threshold — e.g., `coverage: { thresholds: { lines: 20, functions: 20, branches: 15, statements: 20 } }` pinned to the current actual coverage — would at minimum prevent regression below the existing baseline. PROPOSAL: Add a `coverage` sub-key to the `test` block in `vite.config.ts:35` with `provider: 'v8'`, `reporter: ['text', 'lcov']`, and `thresholds` matching the current measured baseline — L/L effort (four added lines in vite.config.ts; creates an automated CI gate against coverage regression without requiring any new test authorship).

- OBSERVATION: `utils/interpolation.ts:125-192` and `utils/interpolation.ts:261-299` — `interpolateKriging()` is a 68-line spatial interpolation function implementing ordinary kriging with matrix-based weight calculation, and `solveLinearSystem()` is a 39-line Gaussian elimination solver with partial pivoting. Both are called by `generateInterpolatedGrid()` (line 325-327) and `generateInterpolatedMatrix()` (line 365-367), which drive the AQI heatmap textures displayed in the 3D visualization components. Zero test coverage exists for these functions. Key untested behaviors: (a) `interpolateKriging` falls back to `interpolateIDW` when `dataPoints.length < 3` (line 131-133) — a caller passing 2 stations would silently switch algorithms with no error; (b) `solveLinearSystem` returns `null` when the pivot is smaller than `1e-10` (line 276), causing `interpolateKriging` to fall back to IDW at line 172-174 — this fallback path is unreachable by inspection but has never been exercised by a test; (c) the three variogram models (`spherical`, `exponential`, `gaussian`) and the `estimateVariogramParams` function computing sill, range, and nugget from data variance are entirely untested; (d) `interpolateIDW` at line 80 uses `p.distance < 0.0001` as an exact-match threshold — a station at exactly the target coordinate returns `confidence: 1` but a station 0.0001° away (≈11m) does not, creating a discontinuity around the threshold boundary. A sign error or off-by-one in the kriging weights would produce plausible-looking but numerically incorrect AQI heatmaps with no observable failure at the UI layer. PROPOSAL: Add a `tests/interpolation.test.ts` file covering `interpolateIDW` (with exact match, single point, two-point, and radius-exclusion cases), `interpolateKriging` (with n<3 fallback, singular-matrix fallback, and all three variogram models), and `calculateGridStats` — M/L effort (new test file; validates the most mathematically complex frontend code in the project against known-good reference values).

- OBSERVATION: `services/AirQualityService.ts:30-76` — `AirQualityService` is a singleton with a 4-second TTL read-through cache (`CACHE_TTL_MS = 4000` at line 26) and a nearest-station lookup in `getCurrentAQI` (line 56: `readings.reduce` with `Math.hypot`). No test file exercises this class. Four critical behaviors are untested: (a) the singleton contract — calling `AirQualityService.getInstance()` twice must return the same object reference; if the singleton guard at line 31 ever fails (e.g., due to module re-evaluation in test isolation), multiple cache states coexist silently; (b) cache hit path — a second call to `getReadings()` within 4 seconds must return `cachedReadings` without invoking `fetch`; without a test, a future developer adding a parameter to `getReadings()` could silently invalidate the cache on every call; (c) cache miss path — after 4 seconds the `now - this.cacheTimestamp` condition at line 39 should trigger a new fetch; (d) nearest-station selection at line 56-59 — with mock readings at known coordinates, the `reduce` must select the closest station; a swap of `lat`/`lng` in `Math.hypot` would produce wrong-city AQI with no runtime error. Since `AirQualityService.getInstance()` is called by `useRealtimeAQI` on every poll cycle, a regression in any of these paths degrades live AQI display to stale or wrong-location data. PROPOSAL: Add a `tests/AirQualityService.test.ts` file using `vi.spyOn(global, 'fetch')` to assert singleton identity, cache-hit/miss fetch call counts, and correct nearest-station selection for a set of known coordinate pairs — L/L effort (new test file; covers the entire TTL cache and spatial lookup logic for the real-time AQI data path).

- OBSERVATION: `hooks/useDashboardData.ts:4-7` — `parseMonthString` is a module-level function at lines 4-7 used by `getFilteredHistoricalData` (line 96) to filter historical AQI and weather data by date range. It parses month strings of the form `"Jan '24"` via: `monthStr.replace("'", "")` → `"Jan 24"`, split by space → `["Jan", "24"]`, then `new Date(Date.parse("Jan 1, 2012")).getMonth()` to convert month name to index, then `new Date(parseInt(\`20${year}\`), monthIndex)`. Two bugs are latent and untested: (1) `String.prototype.replace` with a string first argument replaces only the FIRST occurrence — if a month string ever contains two apostrophes (e.g., from a malformed data entry or locale-variant format like `"Jan''24"`), the second apostrophe survives into the `split` and produces `["Jan", "'24"]`, causing `parseInt("'24")` to return `NaN` and `new Date(NaN, monthIndex)` to be an `Invalid Date`. All subsequent `date >= start && date <= end` comparisons evaluate to `false` (NaN comparisons), producing an empty chart with no error thrown. (2) The year reconstruction `\`20${year}\`` hardcodes a 21st-century assumption: month strings representing years 2000-2009 would parse correctly, but a year string of `"24"` correctly produces 2024 while `"100"` (theoretical future) would produce `20100`. The function is not exported and not tested. `getFilteredHistoricalData` is consumed by five `useMemo` calls (`mergedHistoricalAqi`, `mergedHistoricalPm25`, `mergedHistoricalWeather`, `mergedHumidityData`, `mergedWindData`) that silently return `[]` on parsing failure, making the entire DataExplorer and Dashboard chart area appear empty. PROPOSAL: Export `parseMonthString` from `useDashboardData.ts` and add tests to `tests/useDashboardData.test.ts` covering the happy path (`"Jan '24"` → January 2024), the apostrophe-replace edge case, and an invalid format producing a recognizable error rather than `NaN` propagation; additionally replace `String.replace("'", "")` with `String.replace(/'/g, "")` at line 5 — L/L effort (one regex fix at line 5; export + 5 unit tests; prevents silent empty-chart failures from malformed month strings in historical data).

**Proposed actions:**
- Add `coverage: { provider: 'v8', reporter: ['text', 'lcov'], thresholds: { lines: 20, functions: 20, branches: 15, statements: 20 } }` to the `test` block in `vite.config.ts:35` — L/L effort (automated CI gate against coverage regression; zero new tests required)
- Add `tests/interpolation.test.ts` covering `interpolateIDW` (exact match, n<minPoints, radius exclusion), `interpolateKriging` (n<3 fallback, singular-matrix fallback, all three variogram models), and `calculateGridStats` — M/L effort (validates most complex frontend math against known-good reference values)
- Add `tests/AirQualityService.test.ts` using `vi.spyOn(global, 'fetch')` for singleton identity, cache hit/miss call counts, and nearest-station selection with known coordinate fixtures — L/L effort (covers TTL cache and spatial lookup for the real-time AQI display path)
- Replace `monthStr.replace("'", "")` with `monthStr.replace(/'/g, "")` in `useDashboardData.ts:5`; export `parseMonthString`; add `tests/useDashboardData.test.ts` with edge-case month string parsing tests — L/L effort (fixes silent empty-chart failure; validates date-range filter for all Dashboard chart aggregations)

### Run #184 — 2026-06-06 — Lens: Perf hot paths
**Scope:** Fourteenth Perf hot paths pass. Files examined in full: `geointellisense-ingestion/src/db/persist.rs`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/aqi.rs`; `components/3d/WindField.tsx`; `components/3d/CityMarkers.tsx`; `geointellisense-analytics/app/context.py`; `geointellisense-analytics/app/routes/water_quality.py`; `geointellisense-analytics/app/routes/chat.py`. Cross-checked against Active Recommendations and archived Perf hot paths runs #4, #19, #34, #49, #64, #79, #94, #109, #124, #139, #154, #169 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:6-28` — `write_readings()` executes a separate `sqlx::query(...).execute(pool).await` for every `AqiReading` in a sequential `for r in readings` loop. The broadcast ticker (invoked from `broadcast.rs:115` as `persist::write_readings(&pool, &readings).await`) calls this function on every tick with the full current reading set. With 6 stations, each broadcast tick issues 6 sequential DB round-trips, each incurring the full PostgreSQL wire-protocol overhead (parse, plan, execute, return). If the DB pool is under load from concurrent analytics queries, each `execute` may wait for a free connection, serializing the 6 inserts further. A single multi-row `INSERT … VALUES (…),(…),…` or a `sqlx::QueryBuilder::push_values` batch (available since sqlx 0.7) collapses all 6 round-trips into 1 per tick, eliminating 83% of the per-tick insert latency in the real-time AQI hot path. PROPOSAL: Replace the `for` loop in `persist.rs:6-28` with a `sqlx::QueryBuilder`-based batch insert; the existing 15-column schema can be pushed row-by-row into a single `QueryBuilder` and executed once — L/L effort (one function rewrite; reduces broadcast-tick DB I/O from N round-trips to 1 per tick with no schema changes).

- OBSERVATION: `components/3d/WindField.tsx:198-209` — The `useMemo` at line 180 computing `positions`, `sizes`, `lives`, and `velocities` for the 500-particle default runs an O(count × windData.length) nearest-wind search: for every particle `i` in `[0, count)`, it iterates all `windData` entries computing Euclidean distance via `Math.sqrt(Math.pow(x - wx, 2) + Math.pow(z - wz, 2))` at line 204. With 500 particles and 6 wind-data cities this is **3,000 `Math.sqrt` + 6,000 `Math.pow` calls** per useMemo invocation. The dependency array at line 231 is `[windData, count, speed, height]`; `windData` is a derived array prop reconstructed by the parent on each render, so this O(3000-op) memo re-fires on every parent re-render even when wind data is numerically identical. Additionally, `latLngToWorld` is called inside the inner loop — once per particle per wind point (3,000 calls) — though wind points only number 6. Pre-computing the 6 world coordinates outside the particle loop and using squared distance instead of sqrt for comparison would reduce work to 6 `latLngToWorld` calls + 3,000 two-multiply additions. PROPOSAL: Hoist `const worldCoords = windData.map(w => ({ ...latLngToWorld(w.lat, w.lng), wind: w }))` before the particle loop in the same useMemo; replace `Math.sqrt(Math.pow(x-wx, 2) + Math.pow(z-wz, 2))` at line 204 with `(x-wx)*(x-wx) + (z-wz)*(z-wz)` (squared distance suffices for nearest-neighbor comparison) — L/L effort (two-line change; eliminates 3,000 sqrt, 6,000 pow, and 2,994 redundant `latLngToWorld` calls per useMemo run).

- OBSERVATION: `geointellisense-analytics/app/context.py:286-310` — `_get_fire_context()` issues two sequential `pool.fetchrow()` DB calls per chat/analysis request. The first at line 286 counts fires and fetches `MAX(time)` for the 48-hour window. The second at line 302 fetches the single nearest fire via `ORDER BY geom::geography <-> … LIMIT 1`. Both queries filter identically on `WHERE time > now() - interval '48 hours'` and reference the same geographic point (`ST_MakePoint(-119.0187, 35.3733)`), meaning the database scans the same set of rows twice. A single CTE — `WITH base AS (SELECT * FROM fire_detections WHERE time > now() - interval '48 hours'), counts AS (SELECT COUNT(*) AS cnt, SUM(…) AS nearby, MAX(time) AS last_time FROM base), nearest AS (SELECT …, ST_Distance(…) AS dist_km FROM base ORDER BY geom::geography <-> … LIMIT 1) SELECT * FROM counts, nearest` — serves both in one round-trip. `_get_fire_context` is invoked on every call to `build_context_text` (called synchronously at `chat.py:39` and `routes/analysis.py` on every user message), so each chat message incurs one redundant fire-table scan. At 10–50ms per DB hop, collapsing to one query saves 10–50ms per message with no change to the returned data. PROPOSAL: Refactor `_get_fire_context()` in `context.py:286-310` to use a single CTE combining the COUNT/MAX aggregate with the nearest-fire ORDER BY in one `pool.fetchrow()` call — M/L effort (one SQL rewrite; saves one DB round-trip per chat/analysis request on the fire context path).

- OBSERVATION: `geointellisense-analytics/app/routes/water_quality.py:363-386` — `_persist_samples()` awaits one `pool.execute()` per sample in a sequential `for s in samples` loop (line 365). WQP API responses for the San Joaquin Valley parameter set can return 500–2,000 samples per backfill run (called from `_run_backfill()` at line ~340). At a conservative 10ms per asyncpg round-trip, 1,000 samples require 10 seconds of sequential awaiting; at 50ms (networked DB), 50 seconds. During this window the asyncpg connection is held exclusively (not returned to the pool between iterations), blocking concurrent requests from acquiring it. The existing `ON CONFLICT (time, site_id, parameter, sample_fraction) DO NOTHING` clause is fully compatible with asyncpg's `executemany` batch protocol, which sends all rows in a single protocol message and processes the conflict check server-side in one transaction. PROPOSAL: Replace the per-row `pool.execute()` loop in `water_quality.py:363-386` with `await pool.executemany(INSERT_SQL, [(s.time, s.site_id, s.site_name, s.longitude, s.latitude, s.parameter, s.value, s.unit, s.detection_limit, s.detection_condition, s.sample_fraction, s.organization) for s in samples])` and count inserted rows via a `SELECT changes()` or result inspection — L/L effort (replace loop body with one `executemany` call; reduces backfill insert time from O(N×latency) to near-O(1) and frees the asyncpg connection for concurrent requests after a single await).

**Proposed actions:**
- Replace sequential `for r in readings` INSERT loop in `persist.rs:6-28` with `sqlx::QueryBuilder::push_values` batch insert — L/L effort (reduces broadcast-tick DB I/O from N round-trips to 1; eliminates 83% of insert latency in the real-time AQI hot path)
- Remove `Math.sqrt`/`Math.pow` from `WindField.tsx:204`; pre-compute `latLngToWorld` for all wind points before the particle loop — L/L effort (eliminates 3,000 sqrt + 6,000 pow + 2,994 redundant coordinate conversions per useMemo invocation)
- Combine two `pool.fetchrow` calls in `context.py:286-310` into a single CTE query — M/L effort (saves one DB round-trip per chat/analysis request on the fire context path)
- Replace per-row `pool.execute` loop in `water_quality.py:363-386` with asyncpg `executemany` — L/L effort (reduces backfill insert time from O(N×latency) to O(1); frees DB connection for concurrent requests)

### Run #183 — 2026-06-06 — Lens: Dependency health
**Scope:** Thirteenth Dependency health pass. Files examined in full: `package.json`; `package-lock.json` (dependency graph for all 360+ packages); `vite.config.ts`; `geointellisense-ingestion/Cargo.toml`; `geointellisense-ingestion/Cargo.lock` (getrandom, rand, ring, uuid, redis crate versions); `geointellisense-analytics/requirements.txt`; `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/routes/chat.py`; `geointellisense-analytics/app/routes/analysis.py`. Cross-checked against Active Recommendations and archived Dependency health runs #3, #18, #33, #48, #63, #78, #93, #108, #123, #138, #153, #168 to confirm findings are new.

**Findings:**

- OBSERVATION: `package.json:7` — `"@googlemaps/markerclusterer": "latest"` is the only dependency among all 10 runtime dependencies that uses the `"latest"` dist-tag rather than a semver range. All other runtime deps (`react`, `react-dom`, `react-router-dom`, `recharts`, `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three`, `date-fns`) use `^major.minor.patch` ranges; all 10 devDependencies also use semver ranges. The `package-lock.json` currently pins `@googlemaps/markerclusterer` to `2.6.2` via an integrity hash, so `npm ci` is deterministic. However, `npm install` (not `npm ci`) in a fresh environment — run by a new developer, by Renovate/Dependabot during a lockfile refresh, or by a CI pipeline that runs `npm install` rather than `npm ci` — will query the npm registry for the current `latest` tag and install whatever it resolves to. If Google Maps releases `@googlemaps/markerclusterer@3.0.0` (the library has had major versions before), a fresh `npm install` would silently upgrade through a breaking API change with no version constraint to stop it, and the error would appear at runtime (marker cluster rendering failure) rather than at `npm install` time. PROPOSAL: Replace `"latest"` with `"^2.6.2"` in `package.json:7` to pin to the installed semver major — L/L effort (one character change; makes the version constraint consistent with all other deps and ensures major-version upgrades are intentional rather than implicit).

- OBSERVATION: `geointellisense-ingestion/Cargo.toml:14` — `rand = "0.8"` is locked to `rand 0.8.5` (released 2022) in `Cargo.lock`. `rand 0.9.0` was released January 2025 as a stable breaking-change upgrade; `rand 0.9` uses ChaCha12 as the default CSPRNG instead of ChaCha8 (ChaCha12 is the IETF-recommended variant; ChaCha8 was chosen for speed in 0.8 but has tighter security margins). The `rand 0.9` release also deprecates `Rng::gen()` in favor of `Rng::random()`. In `geointellisense-ingestion/src/aqi.rs`, `rand::Rng` is imported and used at the top of the file for synthetic AQI data generation that runs in production (the `generate_history()` and `generate_readings()` functions are called by live HTTP handlers, as documented in Run #180 findings). Beyond the algorithm improvement, the `rand 0.8.5` dependency pulls `rand_core 0.6.4` which in turn requires `getrandom 0.2.17`; however, `uuid 1.22.0` and `tempfile 3.26.0` in the same binary already require `getrandom 0.4.2`. The Cargo.lock confirms two getrandom major versions compiled simultaneously: `getrandom 0.2.17` (via `rand_core 0.6 → rand 0.8`) and `getrandom 0.4.2` (via `uuid 1.22 + tempfile 3.26`). Upgrading `rand` to `"0.9"` would update `rand_core` to `0.9.x` which uses `getrandom 0.3/0.4`, eliminating the `getrandom 0.2.17` copy from the binary (ring still contributes getrandom 0.2 as a transitive dep, but removing rand's contribution reduces the dual-copy surface). The only code change needed is renaming `rng.gen::<f64>()` calls to `rng.random::<f64>()` in `aqi.rs`. PROPOSAL: Bump `rand = "0.8"` to `rand = "0.9"` in `Cargo.toml:14`; update `aqi.rs` usages of `rng.gen()` to `rng.random()` — L/L effort (one Cargo.toml line + a few method renames; upgrades to ChaCha12 RNG, removes getrandom 0.2 duplication from rand_core, modernizes a 2022 crate to its current stable release).

- OBSERVATION: `package-lock.json` (recharts section) — `recharts@3.4.1` (the version resolved from `package.json:20`'s `"^3.3.0"`) declares `@reduxjs/toolkit: '1.x.x || 2.x.x'` and `react-redux: '8.x.x || 9.x.x'` as runtime **`dependencies`** (not `peerDependencies`), locked to `@reduxjs/toolkit@2.10.1` and `react-redux@9.2.0` respectively. This means recharts ships its own internal Redux store for chart state management. `@reduxjs/toolkit@2.10.1` pulls `immer@10.1.1`, `reselect@5.1.1`, and `redux@5.x` as its own dependencies. The combined size overhead of this state management layer inside the recharts bundle is approximately 140–160KB minified before gzip. `vite.config.ts:38-39` comments that the recharts `manualChunk` is expected to be ~300KB — the actual chunk is larger precisely because of the bundled RTK/redux/immer. GeoIntelliSense uses recharts exclusively for passive data rendering: `LineChart`, `BarChart`, `AreaChart` in `AQITrendChart.tsx`, `PM25TrendChart.tsx`, `TemperaturePrecipitationChart.tsx`, `WeatherForecastChart.tsx`, and the dashboard widgets. None of the application code uses `createSlice`, `configureStore`, `useSelector`, or any Redux APIs directly — the RTK/redux bundle is entirely internal to recharts' rendering pipeline and invisible to the application. The recharts 3.x architecture change (from recharts 2.x which had no RTK dependency) was a deliberate library design choice, not a transitive install artifact; it cannot be tree-shaken. PROPOSAL: Evaluate replacing `recharts` with `victory` (`victory-vendor` is already installed as a recharts transitive dep at `^37.0.2`) or `@observablehq/plot` (~15KB gzip) for the project's simple AQI/weather line and bar charts — M/M effort (component API migration across 4-5 chart files; eliminates ~150KB of Redux state management from the chart bundle and reduces initial parse time for chart-heavy views).

- OBSERVATION: `geointellisense-analytics/requirements.txt:9` — `anthropic==0.49.*` uses a wildcard patch pin (equivalent to `>=0.49.0,<0.50.0`). The `anthropic` Python SDK releases on PyPI move through minor versions that include breaking changes (e.g., the `ThinkingBlock` content type introduced in 0.50, the `AsyncStream` iterator protocol change in 0.51, the `TokenCountResponse` field rename in 0.53). The wildcard `0.49.*` pin means the analytics service is frozen at the 0.49 release line with no path to pick up these changes without a manual requirements update. More critically: PyPI allows package maintainers to `yank` specific version ranges (a soft deprecation that causes `pip install` to skip the yanked versions for fresh environments without `--pre` flags); if Anthropic yanks `0.49.*` due to a security issue, a fresh `pip install -r requirements.txt` in a new deployment or Docker build would either fail with a resolver error or fall back to no-match behavior depending on pip version. The code in `chat.py:43-74` and `routes/analysis.py:5223-5530` uses `client.messages.create(model=..., ...)` with synchronous calls (`get_client()` returns `anthropic.Anthropic`, not `anthropic.AsyncAnthropic`) — the 0.49 SDK's synchronous client is stable for this usage, but the project cannot access `anthropic.AsyncAnthropic` improvements, extended thinking support (`thinking={"type": "enabled", "budget_tokens": N}`), or the batch API (`client.messages.batches.create(...)`) introduced in 0.50+. PROPOSAL: Replace `anthropic==0.49.*` with `anthropic>=0.49,<1.0` in `requirements.txt:9` — L/L effort (one line; allows minor-version upgrades within the 0.x compatibility band, prevents yank-induced fresh-install failures, and enables adoption of 0.50+ API features without manual pin bumps; upper bound `<1.0` guards against a hypothetical 1.0 breaking change).

**Proposed actions:**
- Replace `"@googlemaps/markerclusterer": "latest"` with `"^2.6.2"` in `package.json:7` — L/L effort (prevents silent major-version upgrades on fresh `npm install`; aligns with semver convention used by all other deps)
- Bump `rand = "0.8"` to `rand = "0.9"` in `Cargo.toml:14`; rename `rng.gen()` calls to `rng.random()` in `aqi.rs` — L/L effort (upgrades from 2022 ChaCha8 RNG to ChaCha12; removes getrandom 0.2 duplication from rand_core in the production binary)
- Evaluate replacing `recharts` with a lighter charting library (e.g., `@observablehq/plot`) for the 4-5 simple chart components — M/M effort (eliminates ~150KB RTK/redux/immer runtime bundle from recharts chunk)
- Replace `anthropic==0.49.*` with `anthropic>=0.49,<1.0` in `requirements.txt:9` — L/L effort (permits patch+minor upgrades within 0.x; prevents yank-induced install failures; unlocks 0.50+ async and extended thinking APIs)

## 📚 Archive (one line per past run)
- Run #182 (2026-06-06) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #181 (2026-06-06) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #180 (2026-06-06) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #179 (2026-06-06) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #178 (2026-06-06) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #177 (2026-06-06) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #176 (2026-06-06) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #175 (2026-06-05) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #174 (2026-06-05) — Lens: Security — 4 findings — 0 promoted to Active
- Run #173 (2026-06-05) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #172 (2026-06-05) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #171 (2026-06-05) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #170 (2026-06-05) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #169 (2026-06-05) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #168 (2026-06-05) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #167 (2026-06-05) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #166 (2026-06-05) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #165 (2026-06-05) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #164 (2026-06-05) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #163 (2026-06-05) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #162 (2026-06-05) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #161 (2026-06-05) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #160 (2026-06-04) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #159 (2026-06-04) — Lens: Security — 4 findings — 0 promoted to Active
- Run #158 (2026-06-04) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #157 (2026-06-04) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #156 (2026-06-04) — Lens: TS ↔ Python contract — 3 findings — 0 promoted to Active
- Run #155 (2026-06-04) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #154 (2026-06-04) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #153 (2026-06-04) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #152 (2026-06-04) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #151 (2026-06-04) — Lens: Type safety — 4 findings — 0 promoted to Active
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
- Run #154: lens 4 (Perf hot paths) — findings added
- Run #155: lens 5 (Test coverage gaps) — findings added
- Run #156: lens 6 (TS ↔ Python contract) — findings added
- Run #157: lens 7 (UX / UI flaws) — findings added
- Run #158: lens 8 (Data pipeline integrity) — findings added
- Run #159: lens 9 (Security) — findings added
- Run #160: lens 10 (Observability) — findings added
- Run #161: lens 11 (Docs) — findings added
- Run #162: lens 12 (Deployment / Docker) — findings added
- Run #163: lens 13 (LLM integration quality) — findings added
- Run #164: lens 14 (Competitive scan) — findings added
- Run #165: lens 15 (Live-time claim audit) — findings added
- Run #166: lens 1 (Type safety) — findings added
- Run #167: lens 2 (Module boundaries) — findings added
- Run #168: lens 3 (Dependency health) — findings added
- Run #169: lens 4 (Perf hot paths) — findings added
- Run #170: lens 5 (Test coverage gaps) — findings added
- Run #171: lens 6 (TS ↔ Python contract) — findings added
- Run #172: lens 7 (UX / UI flaws) — findings added
- Run #173: lens 8 (Data pipeline integrity) — findings added
- Run #174: lens 9 (Security) — findings added
- Run #175: lens 10 (Observability) — findings added
- Run #176: lens 11 (Docs) — findings added
- Run #177: lens 12 (Deployment / Docker) — findings added
- Run #178: lens 13 (LLM integration quality) — findings added
- Run #179: lens 14 (Competitive scan) — findings added
- Run #180: lens 15 (Live-time claim audit) — findings added
- Run #181: lens 1 (Type safety) — findings added
- Run #182: lens 2 (Module boundaries) — findings added
- Run #183: lens 3 (Dependency health) — findings added
- Run #184: lens 4 (Perf hot paths) — findings added
- Run #185: lens 5 (Test coverage gaps) — findings added
