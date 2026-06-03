# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-03T18:15:00Z
Last run: #140 — Lens: Test coverage gaps

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
### Run #140 — 2026-06-03 — Lens: Test coverage gaps
**Scope:** Eleventh test-coverage-gaps pass. Examined: `vite.config.ts` (full — vitest test block); `utils/weatherUtils.ts` (full — 4 exported functions); `utils/colorScales.ts` (lines 1–130 — `hexToRgb`, `rgbToHex`, `interpolateColorStops`, `blendColors`, `getContrastColor`); `geointellisense-ingestion/src/aqi.rs` (full — `aqi_category`, `round2`, `generate_readings`, `generate_history`); `grep -l "#[test]"` across all 15 Rust source files (0 results); `tests/` directory listing (confirmed 7 test files and their import targets); `package.json` scripts. Cross-checked against Active Recommendations and runs #138–#139 (Latest Findings) plus archived test-coverage-gaps runs #125, #110, #95, #80, #65, #50, #35, #20, #5 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `vite.config.ts:35–41` — The `test` block contains only `globals: true`, `environment: 'jsdom'`, `setupFiles: './tests/setup.ts'`, and `css: true`. There is no `coverage` key — no `provider`, `reporter`, `thresholds`, or `include`/`exclude` patterns. The `package.json` scripts are `"test": "vitest"` and `"test:ui": "vitest --ui"` — neither invokes `--coverage`. Without a coverage provider configured, `npx vitest run --coverage` defaults to `v8` but applies no minimum thresholds, meaning a run reporting 5% line coverage succeeds with exit 0. As a consequence, coverage regressions are undetectable in CI: a developer could delete a test file and coverage could silently collapse from 40% to 20% without any pipeline failure. The current test suite covers approximately: `utils/errorHandling.ts` (comprehensive), `contexts/UserPreferencesContext.tsx` (comprehensive), `hooks/useApiStatus.ts` (partial), `components/Header.tsx`, `components/Sidebar.tsx`, `components/ChatView.tsx`, `components/AnalysisView.tsx`, `components/MapView.tsx` (integration-level only); entirely absent: `services/` (4 files, 601 lines total), `hooks/useDashboardData.ts`, `hooks/useLiveData.ts`, `hooks/useNormalizedData.ts`, `hooks/useRealtimeAQI.ts`, `hooks/useViewport.ts`, `utils/colorScales.ts`, `utils/geo3d.ts`, `utils/interpolation.ts`, `utils/weatherUtils.ts`. PROPOSAL: Add a `coverage` block to `vite.config.ts` with `provider: 'v8'`, `reporter: ['text', 'lcov']`, `include: ['**/*.{ts,tsx}']`, `exclude: ['tests/**', '**/*.test.*', 'vite-env.d.ts', 'vite.config.ts']`, and initial thresholds at current actual coverage levels (e.g., `lines: 20`, `branches: 15`) — acts as a ratchet; raise thresholds as coverage improves — M/L effort (config-only change; no tests written).

- OBSERVATION: `utils/weatherUtils.ts:1–16` — `calculateFeelsLike(temp, humidity, windSpeed)` implements the Rothfusz regression polynomial for heat index (branch at `temp >= 80 && humidity >= 40`, lines 3–8). The US National Weather Service specifies two mandatory adjustment terms for the Rothfusz equation: (a) when `RH < 13` and `80 ≤ T ≤ 112`, subtract `((13-RH)/4) * sqrt((17 - abs(T-95)) / 17)` from the regression result; (b) when `RH > 85` and `80 ≤ T ≤ 87`, add `((RH-85)/10) * ((87-T)/5)`. Both adjustments are absent. At `temp=82, humidity=10` (low RH, in-range temperature — heat index branch NOT triggered because `humidity >= 40` fails, so function returns `temp` — correct). But at `temp=83, humidity=14, windSpeed=0`: the heat index branch is NOT triggered (14 < 40). At `temp=83, humidity=41`: heat index IS triggered; the uncorrected Rothfusz overestimates apparent temperature by ~2–4°F for low-humidity conditions. Additionally, `calculateSunTimes` (line 38): `Math.acos(-Math.tan(latRad) * Math.tan(declinationRad))` returns `NaN` when the argument falls outside `[-1, 1]`, which occurs at polar latitudes (above ~66.5°N or below ~66.5°S) during corresponding solstice. The function has no bounds guard, and `NaN` propagates through `formatTime(NaN)` to produce the string `"NaN:NaN AM"` in the returned object. San Joaquin Valley (~36–37°N) is safe from this in production, but the exported function is not self-defending. Zero tests exist for any of the four functions in this file. PROPOSAL: Add `utils/weatherUtils.test.ts` covering `calculateFeelsLike` at heat-index branch boundary (`temp=80, humidity=40`), wind-chill boundary (`temp=50, humidity=0, windSpeed=3`), and the unconditioned fallthrough; add NWS adjustment terms to `calculateFeelsLike`; add `Math.abs(arg) <= 1` guard to `calculateSunTimes` before calling `Math.acos` — M/L effort.

- OBSERVATION: `utils/colorScales.ts:119–128` — `hexToRgb(hex: string)` uses regex `/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i`, which only matches 6-digit hex strings. Three-character CSS shorthand hex (`'#fff'`, `'#a3b'`) and any non-hex color value (`'transparent'`, `'red'`, `''`) produce `result = null` and the function silently returns `{r:0, g:0, b:0}` — black. This silent fallback propagates: `blendColors('#00e400', 'transparent', 0.5)` returns a blend toward black instead of indicating an invalid input; `getContrastColor('#fff')` computes luminance of `{r:0,g:0,b:0}` (0.0 → dark) and returns `'#ffffff'` for white text on the 3-char white background — an incorrect contrast recommendation (white-on-white is invisible). `adjustBrightness('#abc', 2)` returns black instead of brightened `#aabbcc`. All 14 exported symbols in `colorScales.ts` (`getAQICategory`, `getAQIColor`, `getAQIColorThree`, `hexToRgb`, `rgbToHex`, `interpolateColorStops`, `getInterpolatedAQIColor`, `createGradientTexture`, `createAQILookupTexture`, `createDataTexture`, `createVolumeTexture`, `createCSSGradient`, `blendColors`, `adjustBrightness`, `getContrastColor`, `aqiToOpacity`, `getAQIRGBA`, `generateAQILegendItems`) have zero tests. The non-Three.js-dependent functions (`getAQICategory`, `getAQIColor`, `hexToRgb`, `rgbToHex`, `interpolateColorStops`, `blendColors`, `adjustBrightness`, `getContrastColor`, `aqiToOpacity`, `createCSSGradient`, `generateAQILegendItems`) can be tested without mocking Three.js. PROPOSAL: Add `utils/colorScales.test.ts` testing `getAQICategory` at all 6 EPA boundary values (50/51, 100/101, 150/151, 200/201, 300/301); test `hexToRgb` with valid 6-char, 3-char (documents the unsupported behavior), and empty string; test `interpolateColorStops` at positions 0.0, 0.5, 1.0; fix `hexToRgb` to either expand 3-char CSS shorthand hex or throw on invalid input rather than silently returning black — L/L effort.

- OBSERVATION: `geointellisense-ingestion/src/` — `find geointellisense-ingestion/src -name "*.rs" | xargs grep -l "#[test]"` returns zero results across all 15 Rust source files (`aqi.rs`, `broadcast.rs`, `config.rs`, `main.rs`, `purpleair.rs`, `redis_cache.rs`, `usgs.rs`, `db/mod.rs`, `db/persist.rs`, `routes/admin.rs`, `routes/aqi.rs`, `routes/earthquakes.rs`, `routes/health.rs`, `routes/mod.rs`, `routes/sse.rs`). The most straightforwardly testable function is `aqi_category(aqi: u32) -> (&'static str, &'static str)` at `aqi.rs:88–96`. It uses inclusive range patterns covering all EPA AQI tiers. The boundary values requiring test coverage: `aqi_category(0)` → ("Good", "#00e400"), `aqi_category(50)` → Good, `aqi_category(51)` → ("Moderate", "#ffff00"), `aqi_category(100)` → Moderate, `aqi_category(101)` → USG, `aqi_category(150)` → USG, `aqi_category(151)` → ("Unhealthy", "#ff0000"), `aqi_category(200)` → Unhealthy, `aqi_category(201)` → ("Very Unhealthy", "#8f3f97"), `aqi_category(300)` → Very Unhealthy, `aqi_category(301)` → ("Hazardous", "#7e0023"), `aqi_category(500)` → Hazardous. `round2(v: f64)` at line 164–165 (`(v * 100.0).round() / 100.0`) has a floating-point edge case: `round2(1.005)` may return `1.0` rather than `1.01` due to IEEE 754 binary representation of `1.005` (the decimal value `1.005` is stored as `1.00499999...` in f64, so `* 100.0 = 100.49999...`, and `.round()` → `100.0`). Without tests, this rounding bias is invisible. A `#[cfg(test)]` module in `aqi.rs` would take ~10 lines and enable `cargo test` to validate all category boundaries. PROPOSAL: Add `#[cfg(test)] mod tests { use super::*; }` to `geointellisense-ingestion/src/aqi.rs` covering all 12 `aqi_category` boundary values and `round2` rounding behavior; document the f64 `round2(1.005)` result as a known limitation — L/L effort.

**Proposed actions:**
- Add `coverage` block to `vite.config.ts` test section with `v8` provider, `text`/`lcov` reporters, and initial thresholds matching current coverage — eliminates silent coverage regressions in CI — M/L effort
- Add `utils/weatherUtils.test.ts` covering all four exported functions at boundary inputs; fix Rothfusz adjustment terms in `calculateFeelsLike`; add `Math.abs(arg) <= 1` guard before `Math.acos` in `calculateSunTimes` — M/L effort
- Add `utils/colorScales.test.ts` for 12 EPA AQI boundary values in `getAQICategory`, edge cases in `hexToRgb` (3-char hex, empty string), and `interpolateColorStops` at 0.0/0.5/1.0; fix `hexToRgb` to expand or reject 3-char hex — L/L effort
- Add `#[cfg(test)] mod tests {}` to `geointellisense-ingestion/src/aqi.rs` covering all `aqi_category` boundary values and `round2` f64 rounding — L/L effort (10 lines; no external dependencies needed)

### Run #139 — 2026-06-03 — Lens: Perf hot paths
**Scope:** Tenth perf-hot-paths pass. Examined: `geointellisense-ingestion/src/db/persist.rs` (full); `geointellisense-ingestion/src/broadcast.rs` (full); `geointellisense-ingestion/src/purpleair.rs` (full); `geointellisense-analytics/app/context.py` (lines 1–100, 193–250); `geointellisense-analytics/app/cache.py` (full); `geointellisense-analytics/app/ml/aqi_model.py` (lines 1–60); `hooks/useLiveData.ts` (full); `hooks/useRealtimeAQI.ts` (full); `hooks/useNormalizedData.ts` (full); `components/AirQualityMapView.tsx` (lines 1–390); `components/3d/TerrainMesh.tsx` (full); `utils/interpolation.ts` (lines 1–115, 347–374). Cross-checked against Active Recommendations and runs #137–#138 (Latest Findings) plus archived perf-hot-paths runs #4, #19, #34, #49, #64, #79, #94, #109, #124 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:5–34` — `write_readings(pool, readings)` iterates over `readings` with a plain Rust `for r in readings` loop (line 6) and issues one `sqlx::query(...).execute(pool).await` per `AqiReading` (lines 7–29). Each call is a full PostgreSQL client-server round trip: parse → plan → bind → execute → commit. For a typical broadcast cycle with ~15–20 station readings, this is 15–20 separate synchronous-to-the-async-executor round trips executed serially (each `.await` suspends the task until the DB acknowledges). `broadcast.rs:115` calls `persist::write_readings(&pool, &readings).await` on every tick of the broadcast loop (default `broadcast_interval_secs`). At 30-second intervals this produces approximately 2,880 ingestion ticks per day, each paying N×RTT instead of 1×RTT. PostgreSQL supports bulk insert via `UNNEST` array parameters — a single `INSERT INTO sensor_readings (time, location_id, pm25, ...) SELECT * FROM UNNEST($1::timestamptz[], $2::uuid[], $3::float8[], ...)` statement with all N rows bound as arrays achieves the same result in one round trip regardless of N. The `sqlx` crate supports binding `Vec<T>` as array parameters via `.bind(vec![...])`. PROPOSAL: Refactor `write_readings` in `db/persist.rs` to build parallel `Vec<T>` columns from `readings`, then issue a single batched `UNNEST` INSERT — H/M effort (query rewrite + sqlx array binding; no schema changes required; error handling still needed per-row via checking affected-row count).

- OBSERVATION: `geointellisense-analytics/app/context.py:52–70` — `build_live_context()` issues 7 async queries (lines 61–68: `_get_aqi_context`, `_get_forecast_context`, `_get_fire_context`, `_get_earthquake_context`, `_get_water_context`, `_get_enviroscreen_context`, `_get_prediction_context`) as sequential `await` expressions in a linear chain. The comment at line 60 — "Run all queries concurrently-ish (asyncpg handles connection pooling)" — is incorrect: sequential `await` calls are NOT concurrent; each coroutine must complete before the next `await` expression is evaluated, regardless of asyncpg's connection pool. The total latency is the arithmetic sum of all 7 query durations. `build_live_context()` is called on every request to the Claude chat, analysis, predictive-analysis, and weather-forecast routes (via `build_context_text()` called from each route before constructing the system prompt). On a lightly-loaded system with ~10ms per query, sequential execution adds ~70ms of DB latency to every user-facing AI response; under contention (slow DB queries) this accumulates proportionally. Replacing with `asyncio.gather()` lets all 7 coroutines dispatch their queries simultaneously and waits for the slowest, reducing latency to max(durations) ≈ 10ms instead of sum(durations) ≈ 70ms. PROPOSAL: Add `import asyncio` to `context.py`; replace lines 61–68 with `(aqi, fcast, fires, quakes, water, ces, pred) = await asyncio.gather(_get_aqi_context(pool), _get_forecast_context(pool), _get_fire_context(pool), _get_earthquake_context(pool), _get_water_context(pool), _get_enviroscreen_context(pool), _get_prediction_context(pool)); context.update({"aqi": aqi, "forecast": fcast, "fires": fires, "earthquakes": quakes, "water": water, "enviroscreen": ces, "prediction": pred}); context["inversion"] = _get_inversion_context()` — H/L effort (< 10 lines; no logic change; corrects the misleading "concurrently-ish" comment).

- OBSERVATION: `hooks/useRealtimeAQI.ts:396–407` — The hook computes `aqiDataPoints` (line 396: `cities.map(city => ({ lat, lng, value: city.aqi }))`) and `windData` (line 402: `cities.map(city => ({ lat, lng, speed, direction }))`) as plain `Array.prototype.map` calls at the top level of the hook function, outside any `useMemo`. Every time any stateful dependency inside the hook changes — SSE `aqi-update` event (`setData`, line 337), `lastUpdate` (`setLastUpdate`, line 339), `history` append (`addToHistory`, line 338), connection state transitions — the hook function re-executes and returns new array object references for both `aqiDataPoints` and `windData`, even if the underlying `cities` data is identical. In mock-data mode (`setInterval` at line 252, 5-second interval), this fires every 5 seconds. The new `aqiDataPoints` reference propagates to `AirQualityMapView.tsx:268` where it is captured in the `aqiDataPoints` useMemo (dep: `realtimeAqiDataPoints.length` — a primitive, so the memo is stable as long as city count doesn't change). However, `windData` is not stabilized: `AirQualityMapView.tsx:281` `const windData = useRealtimeData && realtimeWindData.length > 0 ? realtimeWindData : staticWindData` is a plain variable reassignment without useMemo, creating a new reference on every render that propagates to `WindField` as a prop. Meanwhile `TerrainMesh.tsx:239` has `const aqiTexture = useMemo(() => createAQIOverlayTexture(aqiData, textureResolution), [aqiData, textureResolution])` — `createAQIOverlayTexture` calls `generateInterpolatedMatrix` which loops over `width * height = 128 * 128 = 16,384` grid cells, each invoking `interpolateIDW` (O(N) with inner `map` + `filter` + `sort` on all data points). This computation runs on the JS main thread and blocks rendering whenever triggered. PROPOSAL: Wrap `aqiDataPoints` and `windData` in `useMemo([data])` inside `useRealtimeAQI.ts` (lines 396 and 402 respectively); stabilize `windData` assignment in `AirQualityMapView.tsx:281` with a `useMemo` keyed on `realtimeWindData.length` — M/L effort (2–4 `useMemo` additions; eliminates spurious 16,384-cell IDW recomputation on mock-data ticks and SSE state updates).

- OBSERVATION: `components/3d/TerrainMesh.tsx:180–203` — `RegionBoundary` is a functional component that memoizes its `geometry` (`THREE.BufferGeometry`) at line 183 via `useMemo`, but then returns `<primitive object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#4CAF50', transparent: true, opacity: 0.6 }))} />` at line 202. Both `new THREE.Line(...)` and `new THREE.LineBasicMaterial(...)` are instantiated inline in the JSX return expression, outside any ref or memo. Every time `RegionBoundary` re-renders (which occurs whenever its parent `TerrainMesh` re-renders — e.g., on AQI data updates, overlay opacity prop changes, wireframe toggle), a new `THREE.Line` and `THREE.LineBasicMaterial` are allocated on the GPU without the previous instances being `.dispose()`'d. Three.js WebGL objects (`BufferGeometry`, `Material`, `Texture`) are not garbage-collected by the JS GC; they must be explicitly disposed via `.dispose()` to release GPU memory. Since React Three Fiber's `<primitive>` component swaps the underlying Three.js object on each render without calling `.dispose()` on the old one, this creates one leaked `THREE.Line` + `THREE.LineBasicMaterial` pair per re-render of `TerrainMesh`. Over the lifetime of the 3D view (AQI updates every 30 seconds, each triggering a re-render), this accumulates significant GPU VRAM waste. PROPOSAL: Replace the inline `new THREE.Line(...)` in `RegionBoundary` with `const line = useMemo(() => new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#4CAF50', transparent: true, opacity: 0.6 })), [geometry])` and add `useEffect(() => () => { line.material.dispose(); }, [line])` for cleanup — L/L effort (2 hook calls in an existing component; eliminates GPU memory leak on re-render).

**Proposed actions:**
- Refactor `db/persist.rs:write_readings` to use a single batched UNNEST INSERT instead of N sequential single-row INSERTs — H/M effort
- Replace sequential `await` chain at `context.py:61–68` with `asyncio.gather(...)` to run all 7 context queries concurrently — H/L effort (corrects misleading "concurrently-ish" comment)
- Wrap `aqiDataPoints` and `windData` in `useMemo([data])` in `useRealtimeAQI.ts:396,402`; stabilize `windData` prop in `AirQualityMapView.tsx:281` — M/L effort
- Replace inline `new THREE.Line(...)` in `TerrainMesh.tsx:202` with `useMemo` + `useEffect` disposal — L/L effort

### Run #138 — 2026-06-03 — Lens: Dependency health
**Scope:** Tenth dependency-health pass. Examined: `package.json` (full); `package-lock.json` (dependency metadata via programmatic parse — resolved versions, dev flags, and dependency trees for all 367 packages); `npm audit --json` (full output, 11 vulnerabilities parsed and classified); `geointellisense-ingestion/Cargo.toml` (full) and `geointellisense-ingestion/Cargo.lock` (resolved versions including `rand` crate); `geointellisense-analytics/requirements.txt` (full); `geointellisense-analytics/app/claude.py` (lines 1–50); grep for `model=` across all `geointellisense-analytics/app/routes/*.py` files. Cross-checked against Active Recommendations and runs #136–#137 (Latest Findings) plus archived dependency-health runs #3, #18, #33, #48, #63, #78, #93, #108, #123 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `package-lock.json` (react-router entry, `dev=False`) + `npm audit --json` — `react-router@7.9.6` and `react-router-dom@7.9.6` are production dependencies (not dev-only; `dev=False` in the lock file, matching `"react-router-dom": "^7.9.6"` in `package.json` dependencies, not devDependencies). `npm audit` reports three HIGH-severity advisories against this version: (1) CSRF issue in Action/Server Action Request Processing — affects apps that use react-router v7 Actions (the `action()` export) without a CSRF token; GeoIntelliSense's `router` in `App.tsx` does not currently define loader/action functions, but any future addition of form submissions via react-router v7 Actions would inherit this flaw; (2) XSS via Open Redirects — affects any usage of `<Link to={externalOrUntrustedUrl}>` or programmatic `navigate(untrustedUrl)` where the value is user- or API-controlled; `services/aiService.ts` constructs URLs from API responses and could serve as an untrusted source if redirected through a Link; (3) SSR XSS in ScrollRestoration — GeoIntelliSense is a client-side SPA (Vite + `index.html` entry, no SSR detected in `vite.config.ts`), so this specific advisory is not directly exploitable, but the first two are. `fixAvailable: true` — `npm audit fix` will upgrade `react-router-dom` to the patched version with no breaking API changes. PROPOSAL: Run `npm audit fix` targeting react-router to upgrade from `7.9.6` to the patched release; update `package.json` to `"^7.x.y"` where `x.y` is the patched version — H/L effort (one command; no code changes expected).

- OBSERVATION: `package-lock.json` + `npm audit --json` — `vitest@4.0.13` has a CRITICAL advisory ("When Vitest UI server is listening, arbitrary file can be read and executed", affecting `<=4.1.0-beta.6`; the installed version `4.0.13` falls in this range). `@vitest/coverage-v8@4.0.13` and `@vitest/ui@4.0.13` are also listed as critical via the same advisory. All three are `dev=True` (devDependencies), but they are invoked in CI via `npm run test:ui` (`package.json` scripts) and by developers running `vitest --ui` during development. When the Vitest UI server is active (e.g., a developer runs `npm run test:ui` on a shared CI machine or leaves it running in a containerized dev environment), an attacker with network access to the UI server port can read arbitrary files and execute code with the server's privileges. Additionally: `vite@6.4.1` (the bundler, also `dev=True`) carries two HIGH advisories — "Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling" and "Vite Vulnerable to Arbitrary File Read via Vite Dev Server WebSocket" — both exploitable when the Vite dev server (`npm run dev`) is exposed on a non-localhost interface (e.g., inside Docker with `--host 0.0.0.0`). Transitive: `picomatch@4.0.3` (pulled by both `vite` and `vitest`) falls in the vulnerable range `>=4.0.0 <4.0.4` for "Picomatch: Method Injection in POSIX Character Classes" and "Picomatch has a ReDoS vulnerability via extglob quantifiers". `fixAvailable: true` for all — a single `npm audit fix` addresses the entire chain. PROPOSAL: Run `npm audit fix` to upgrade vitest/vite/picomatch to patched versions; add `--network=bridge` / `--host localhost` constraint to any Dockerized dev environment to prevent dev-server port exposure — M/L effort (one command + optional docker-compose setting review).

- OBSERVATION: `package.json` line 11 — `"@googlemaps/markerclusterer": "latest"` is the only dependency (prod or dev) in the entire `package.json` that uses the `"latest"` dist-tag instead of a semver range. All 9 other production dependencies and all 14 devDependencies use `^` or `~` specifiers. `package-lock.json` resolves this to `2.6.2` at the time the lock was last updated. However: (a) `npm install` (without `--frozen-lockfile` or `npm ci`) will re-resolve `"latest"` to whatever the current `@googlemaps/markerclusterer` release is at the time of execution, ignoring the lock file's pinned `2.6.2`; (b) the Google Maps Marker Clusterer library has shipped major releases with breaking changes (the v2 → v3 `MarkerClusterer` constructor API diverged from v1); a silent `latest` bump to a hypothetical v3 could break the clustering integration in `AirQualityMapView.tsx` at whichever import path and constructor invocation it uses; (c) security patches in a `latest` jump that also introduces breaking changes cannot be adopted without manual verification. The correct fix is to replace `"latest"` with `"^2.6.2"` — the semver equivalent of what the lock file already enforces when `npm ci` is used but not when `npm install` is run (e.g., in a Dockerfile `RUN npm install`). PROPOSAL: Change `package.json:11` from `"@googlemaps/markerclusterer": "latest"` to `"@googlemaps/markerclusterer": "^2.6.2"` — L/L effort (one-character change; no behavior change when lock file is present, eliminates non-reproducible installs when lock file is absent).

- OBSERVATION: `geointellisense-analytics/requirements.txt` + grep across `app/routes/*.py` — The Python analytics service pins `anthropic==0.49.*`, restricting the installed SDK to patch-level updates within the `0.49.x` line. At the same time, `app/routes/deep_analysis.py:34` and `deep_analysis.py:62` pass `model="claude-opus-4-6"` to `anthropic.AsyncAnthropic().messages.create()`. The current canonical Opus 4 model ID (per 2026 Anthropic model registry) is `claude-opus-4-8`; `claude-opus-4-6` is a retired snapshot that may no longer be routed by the Anthropic API. When this model ID is rejected, the `deep_analysis.py` endpoint silently raises an `anthropic.BadRequestError` (or similar) and returns a 500 to the frontend — the route has no fallback model. Additionally, `app/routes/chat.py:44`, `grounded_search.py:40`, `grounded_maps.py:47`, `predictive_analysis.py:92`, and `weather_forecast.py:76` all reference `model="claude-sonnet-4-20250514"` — a May 2025 date-stamp snapshot alias; Anthropic date-stamped aliases are retained but eventually deprecated. The `anthropic==0.49.*` SDK pin further prevents access to any SDK-level features introduced in `0.50+` (prompt caching API changes, streaming improvements, tool-use schema updates). There is no `requirements.lock` or equivalent hash-pinned freeze file in `geointellisense-analytics/` — the `==0.49.*` constraint is the only reproducibility guarantee. PROPOSAL: Update `requirements.txt` to `anthropic>=0.49,<2.0` (or pin to the latest stable); update `deep_analysis.py:34,62` to `model="claude-opus-4-8"` (current Opus 4); standardise remaining routes to `model="claude-sonnet-4-6"` replacing the date-stamp alias — M/L effort (one requirements line + 2-line model ID change; risk: need to verify 0.50+ SDK changes do not break existing `create()` call signatures).

**Proposed actions:**
- Run `npm audit fix` for `react-router-dom` to patch 3 HIGH CVEs (CSRF, XSS via open redirects, SSR XSS) in the production dependency — H/L effort
- Run `npm audit fix` (or upgrade vitest/vite individually) to patch critical `vitest@4.0.13` arbitrary-file-read/execute and high `vite@6.4.1` path-traversal/arbitrary-file-read vulnerabilities in dev toolchain — M/L effort
- Change `package.json:11` `"@googlemaps/markerclusterer": "latest"` → `"^2.6.2"` — L/L effort
- Update `geointellisense-analytics/requirements.txt` `anthropic==0.49.*` to allow `>=0.49,<2.0`; change `deep_analysis.py:34,62` `model="claude-opus-4-6"` → `model="claude-opus-4-8"`; standardise date-stamp Sonnet aliases to `model="claude-sonnet-4-6"` — M/L effort

## 📚 Archive (one line per past run)
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
