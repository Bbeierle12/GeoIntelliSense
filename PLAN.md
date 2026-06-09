# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-09T21:10:00Z
Last run: #230 — Lens: Test coverage gaps

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
| 8 | Upgrade `vite` from 6.4.1 to ≥6.5.0 AND change `host` from `'0.0.0.0'` to `'127.0.0.1'` in `vite.config.ts:9` — GHSA-p9ff-h696-f583 file read amplified by all-interfaces binding | Security/Dep | H | L | 168 | Open |
| 9 | `dataService.ts:199` sends slug IDs (e.g. `"fresno"`) for `location_ids` but `historical_aqi.py:46`, `historical_weather.py:40`, `nws_forecast.py:50` cast them as `uuid[]` — PostgreSQL errors; all filtered calls silently fall back to mock | TS↔Python/Data | H | L | 201 | Open |
| 10 | `historical_weather.py:98` hardcodes `"totalPrecipitation": 0.0` as placeholder — live API always returns zero while TS fallback (`dataService.ts:383`) returns non-zero mock precipitation, silently diverging and making precipitation charts show all-zero data in production | TS↔Python/Data | H | L | 216 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #230 — 2026-06-09 — Lens: Test coverage gaps
**Scope:** Sixteenth test-coverage-gaps pass. Full reads of: `utils/weatherUtils.ts`, `utils/interpolation.ts`, `utils/colorScales.ts`, `utils/geo3d.ts`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-analytics/app/http_client.py`, `geointellisense-analytics/app/ml/aqi_model.py`. Grep for `#\[cfg(test)\]` across all `.rs`; grep for `test_` across all `.py`; grep for `conftest` in analytics dir. Surveyed all existing test files: `App.test.tsx`, `tests/accessibility.test.tsx`, `tests/errorHandling.test.tsx`, `tests/integration.test.tsx`, `tests/routing.test.tsx`, `tests/security.test.tsx`, `tests/userPreferences.test.tsx`. Cross-checked against Active Recommendations and archived test-coverage runs #5, 20, 35, 50, 65, 80, 95, 110, 125, 140, 155, 170, 185, 200, 215 (one-line summaries only) and Latest Findings runs #227–229 to confirm findings are new.

**Findings:**

- OBSERVATION: `utils/weatherUtils.ts` exports four non-trivial pure functions — `calculateFeelsLike` (lines 1–16), `calculateET0` (lines 18–31), `calculateSunTimes` (lines 33–56), and `determineWeatherCondition` (lines 58–69) — with zero test coverage. `calculateFeelsLike` applies three distinct branches: heat index when `temp >= 80 && humidity >= 40`, wind chill when `temp <= 50 && windSpeed >= 3`, and identity otherwise. The gap between these conditions (50 < temp < 80) silently returns dry-bulb temperature regardless of humidity or wind, which is correct per NOAA but never verified by a test. `calculateET0` applies the FAO Penman-Monteith equation; if `tempC = -237.3` (physically impossible, -395.7°F) the denominator of `es` (line 21: `tempC + 237.3`) would be zero — but no test confirms the safe operating range or the `max(0, et0)` clamp at line 30. `determineWeatherCondition` at line 59 has precedence-ordered conditions where `precipProb > 70 → Rainy` supersedes all others; with `cloudCover = 90` and `precipProb = 75`, the function returns `'Rainy'` (not `'Overcast'`). This precedence is intentional but never asserted. These functions are consumed by `WeatherWidget` and `services/WeatherService.ts` and directly affect weather display. PROPOSAL: Add `tests/weatherUtils.test.ts` covering boundary conditions for all four functions: heat-index/wind-chill/identity boundaries in `calculateFeelsLike`; saturation edge in `calculateET0`; solstice/equinox day-length values in `calculateSunTimes`; precedence ordering in `determineWeatherCondition` — L/L effort (~60 lines; pure synchronous functions, zero mocking needed).

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs:88-97` defines `aqi_category(aqi: u32) → (&'static str, &'static str)` mapping AQI integers to `(label, hex_color)` using Rust inclusive-range match arms. An identical category boundary table is independently defined in TypeScript at `utils/colorScales.ts:15-22` (`AQI_CATEGORIES` object with `range: [0,50]`, `[51,100]`, etc.) and again in Python at `geointellisense-analytics/app/ml/aqi_model.py:371-382` (`_aqi_category`). These three implementations are entirely independent — no shared schema, no contract test, no codegen. A boundary discrepancy (e.g., one implementation treating AQI=100 as 'moderate' while another treats it as 'unhealthy for sensitive groups') would cause different parts of the app to show different categories for the same AQI value. Currently, the Rust file has zero `#[cfg(test)]` modules anywhere in `geointellisense-ingestion/src/` — `cargo test` passes vacuously with no test functions. PROPOSAL: Add a `#[cfg(test)] mod tests` block in `aqi.rs` asserting each of the 7 boundary values (AQI 0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301); add a matching `tests/colorScales.test.ts` asserting `getAQICategory(50) === 'good'` and `getAQICategory(51) === 'moderate'` at each boundary — L/L effort (~20 Rust lines + 15 TS lines; prevents silent three-way category divergence).

- OBSERVATION: `utils/interpolation.ts:57-61` returns `{ value: 0, confidence: 0 }` when `dataPoints.length < minPoints` (default `minPoints = 1`). This means calling `interpolateIDW([], targetLat, targetLng)` silently returns `value: 0` — an AQI of 0, which maps to `getAQICategory(0) = 'good'` and renders as green on the 3D city markers and pollution volume. In production, if the SSE connection to the ingestion service drops and `useRealtimeAQI.ts` feeds an empty readings array to `generateInterpolatedGrid`, the entire valley would display as AQI=0 (Good) rather than showing a stale-data or error state. No test covers the empty-input path, the `minPoints` threshold path, or the `searchRadius` filter at line 71 (`.filter((p) => p.distance <= searchRadius)`) — which can also produce an empty filtered set that returns `{ value: 0, confidence: 0 }`. PROPOSAL: Add `tests/interpolation.test.ts` with cases: empty-array → `{ value: 0, confidence: 0 }`, single-point exact match → `{ value: point.value, confidence: 1 }`, `searchRadius` smaller than nearest point → `{ value: 0, confidence: 0 }`, two-point IDW midpoint → verified weighted average — L/L effort (~40 lines; pure math functions, no mocking needed; documents and validates silent-zero behavior so callers know to guard against it).

- OBSERVATION: `geointellisense-analytics/app/http_client.py` contains a 7-path retry state machine (lines 31-81) with no corresponding test infrastructure in the entire `geointellisense-analytics/` package: there is no `tests/` directory, no `conftest.py`, no `pytest.ini`, and no `pyproject.toml` `[tool.pytest]` section — `find` returns zero Python test files across all 60+ `.py` source files. The most important untested path is lines 47-52: when a 500 response is received on the final attempt (`attempt == max_retries`), the condition `attempt < max_retries` is False and execution falls through to `resp.raise_for_status()` at line 55. There is also a structural dead-code issue at lines 78-81: the `if last_error: raise last_error; raise RuntimeError(...)` block is only reachable if the loop completes without a `return`, `continue`, or `raise` — but given the branch structure (every path either returns, continues, or raises), the `raise RuntimeError` at line 81 is unreachable in all practical cases. With `respx` (the httpx-compatible mock library), all 7 paths could be covered in approximately 50 pytest lines. PROPOSAL: Create `geointellisense-analytics/tests/test_http_client.py` with `pytest` + `respx`; cover: (a) success on first attempt, (b) 429 → sleep → retry → success, (c) 500 × 3 → HTTPStatusError on attempt 4, (d) TimeoutException → retry → success, (e) TimeoutException × 4 → propagates; also add `pytest` to `requirements.txt` and a `conftest.py` — L/M effort (~50 lines + config; provides the first automated coverage for the Python analytics service and documents the retry contract).

**Proposed actions:**
- Add `tests/weatherUtils.test.ts` covering boundary conditions for `calculateFeelsLike`, `calculateET0`, `calculateSunTimes`, `determineWeatherCondition` — L/L effort (~60 lines; zero mocking needed)
- Add `#[cfg(test)] mod tests` in `aqi.rs` for all 11 AQI boundary values; add matching boundary assertions in a new `tests/colorScales.test.ts` — L/L effort (~35 lines; prevents silent three-way Rust/TS/Python category divergence)
- Add `tests/interpolation.test.ts` covering empty-input, exact-match, searchRadius-exclusion, and two-point midpoint paths in `interpolateIDW` — L/L effort (~40 lines; documents silent-zero behavior that can masquerade as AQI=0 on empty data)
- Create `geointellisense-analytics/tests/test_http_client.py` with `pytest` + `respx`; add `pytest` + `respx` to `requirements.txt`; add `conftest.py` — L/M effort (~50 lines + config; first test coverage for the entire Python analytics package)

### Run #229 — 2026-06-09 — Lens: Perf hot paths
**Scope:** Fifteenth perf-hot-paths pass. Full reads of: `geointellisense-ingestion/src/db/persist.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/purpleair.rs`, `components/3d/CityMarkers.tsx` (full), `hooks/useRealtimeAQI.ts` (lines 1–350), `db/migrations/002_sensor_readings.sql`, `db/migrations/006_sensor_readings_source.sql`. Grep for `useMemo\|useCallback\|React.memo` across all `.ts`/`.tsx`; grep for `setInterval\|setTimeout` across hooks; grep for `INSERT` across all `.rs`. Cross-checked against Active Recommendations and archived perf-hot-paths runs #4, 19, 34, 49, 64, 79, 94, 109, 124, 139, 154, 169, 184, 199, 214 (one-line summaries only) and Latest Findings runs #226–228 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:6-29` iterates `for r in readings` and calls `sqlx::query(...).execute(pool).await` once per reading — a sequential N+1 INSERT pattern. With 6 seeded SJV stations, every call to `write_readings` fires 6 individual PostgreSQL round-trips in series. Given the broadcast ticker fires every `broadcast_interval_secs` seconds (configurable, default visible in `config.rs`), this generates 6 sequential wire round-trips per tick. A single multi-row INSERT parameterized as `VALUES ($1,$2,...,$15), ($16,$17,...,$30), ...` would persist all 6 readings in one query. Additionally, if `write_readings` fails partway through the loop (e.g., a constraint violation on row 3), rows 1-2 are already committed while rows 4-6 are skipped — there is no wrapping transaction, so partial writes are possible. PROPOSAL: Rewrite `write_readings` to build a single multi-row INSERT statement (or use a COPY pipeline via `sqlx::query`/`PgCopyIn`) wrapped in an explicit `BEGIN`/`COMMIT` transaction; this reduces 6 round-trips to 1 and makes the batch atomic — L/L effort (~20 lines; eliminates N+1 pattern and adds write atomicity).

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:104-113` acquires a read lock on `LiveCache` and then, if a live snapshot exists, clones every `AqiReading` element in full using the `..r.clone()` struct-update syntax (`live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()`). `AqiReading` contains several heap-allocated `String` fields: `station_name`, `county`, `source`, `category`, and `color`. Cloning `AqiReading` therefore allocates 5 new `String` heap buffers per reading × 6 readings = 30 new heap allocations per broadcast tick, just to update the `timestamp` field. The resulting `Vec<AqiReading>` is then wrapped in `Arc::new(readings)` at line 128 and sent to subscribers — but the Arc-wrapping happens after the clone, so the clone is not avoided. Since `station_name`, `county`, `source`, `category`, and `color` are static per station and do not change between ticks, the full clone is unnecessary. PROPOSAL: Store `LiveCache` as `Arc<RwLock<Option<Arc<Vec<AqiReading>>>>>` (add an inner `Arc`); in the broadcast loop, clone only the `Arc` (a single atomic reference-count increment) and emit a separate per-tick `timestamp` alongside the Arc payload, or update only the timestamp in a shallow `Vec` copy by storing timestamp separately from the stable station data — L/M effort (~10 lines; eliminates 30 heap allocations per tick from String field copies).

- OBSERVATION: `components/3d/CityMarkers.tsx:58` defines `CityMarker` as a plain inner function component with no `React.memo()` wrapping. The parent `CityMarkers` at line 269 maps over all cities: `cities.map((city) => <CityMarker key={city.id} city={city} ... onClick={() => onCityClick?.(city)} onHover={(hovered) => onCityHover?.(hovered ? city : null)} />)`. The `onClick` and `onHover` props at lines 291-292 are inline arrow functions — a new function identity on every parent render. Since `CityMarker` has no `React.memo` guard, every time `useRealtimeAQI` fires `setData(parsedData)` (every SSE update, every 5 seconds), all 6 `CityMarker` instances unconditionally re-render, even for cities whose `aqi`, `lat`, `lng`, and `name` did not change between ticks. Each re-render re-evaluates three `useMemo` hooks (`position`, `color`, `markerHeight` at lines 74-87), creates new `THREE.Vector3` and `THREE.Color` objects, and traverses the full JSX tree including `Billboard`, `Text`, and `Html` elements. Adding `React.memo(CityMarker)` combined with stable `onClick`/`onHover` callbacks (via `useCallback` in the parent) would cause React to skip re-rendering any marker whose props are reference-equal. PROPOSAL: Wrap `CityMarker` in `export const CityMarker = React.memo(function CityMarker(...) {...})`; in `CityMarkers`, stabilize click/hover callbacks with `useCallback` keyed on `city.id` — L/L effort (~4 lines; prevents 6× per-tick re-renders for static markers, eliminates redundant THREE object allocations per unchanged city).

- OBSERVATION: `hooks/useRealtimeAQI.ts:162-178` implements `addToHistory` using React state with `setHistory(prev => { const updated = [...prev, snapshot]; if (updated.length > maxHistorySize) { return updated.slice(-maxHistorySize); } return updated; })`. Every call to `addToHistory` (once per SSE event at line 338, i.e., every 5 seconds) copies the entire history array twice: `[...prev, snapshot]` spreads `prev` (up to 288 elements) into a new array of 289 elements, then `.slice(-288)` copies 288 of those elements into yet another new array. Once the buffer reaches capacity (after 24 hours of 5-second ticks), each tick allocates 577 array slots (289 + 288) and creates one `HistoricalSnapshot` object (with `new Date()` at line 167). Additionally, `getDataAtTime` at line 181-198 performs a linear scan (`for (const snapshot of history)`) over up to 288 entries for every playback query. PROPOSAL: Replace the spread/slice pattern with a fixed-capacity ring-buffer class (`class RingBuffer<T>` with `push(item)` and `find(predicate)` backed by a pre-allocated `T[]` array and a `head` index pointer); store it in a `useRef` rather than `useState` to avoid triggering re-renders on every push, and expose a separate `historyVersion` counter via `useState` that increments on push — L/M effort (~30 lines for RingBuffer; reduces per-tick history cost from O(N) to O(1) and makes playback lookup O(N) over a data structure that never reallocates).

**Proposed actions:**
- Rewrite `persist.rs:write_readings` to use a single multi-row INSERT wrapped in a transaction — L/L effort (~20 lines; eliminates N+1 pattern and adds write atomicity)
- Store `LiveCache` value as inner `Arc<Vec<AqiReading>>`; in broadcast loop, clone only the Arc rather than deep-cloning String fields per tick — L/M effort (~10 lines; removes 30 heap allocations per broadcast tick)
- Wrap `CityMarker` in `React.memo`; stabilize `onClick`/`onHover` in parent with `useCallback` — L/L effort (~4 lines; skips re-renders for unchanged city markers on each SSE update)
- Replace `addToHistory` spread/slice with a `RingBuffer` in a `useRef`; expose version counter for re-render signaling — L/M effort (~30 lines; reduces history maintenance from O(N) to O(1) per tick)

### Run #228 — 2026-06-09 — Lens: Dependency health
**Scope:** Eighteenth dependency-health pass. Full reads of: `package.json`, `package-lock.json` (resolved versions for `@googlemaps/markerclusterer`, `vite`, `react-router-dom`, `vitest`, `three`, `recharts`), `vite.config.ts`, `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-ingestion/Cargo.lock` (resolved versions for `rand`, `axum`, `sqlx`, `reqwest`, `redis`, `tower-http`), `geointellisense-ingestion/src/aqi.rs` (rand usage). Grep for `rand` usage across all `.rs` files. Cross-checked against Active Recommendations and archived dependency-health runs #3, 18, 33, 48, 63, 78, 93, 108, 123, 138, 153, 168, 183, 198, 213 (one-line summaries only available) and Last Findings runs #225–227 to confirm findings are new.

**Findings:**

- OBSERVATION: `vite.config.ts:21` contains the comment `// Split Three.js + React Three Fiber into its own chunk (~800KB)`, explicitly documenting that the `three-vendor` manual chunk is estimated at approximately 800 KB. However, `vite.config.ts:33` sets `chunkSizeWarningLimit: 500`. Vite emits a `(!) Some chunks are larger than 500 kB after minification` warning for any chunk that exceeds `chunkSizeWarningLimit`. Because the `three-vendor` chunk is ~800 KB — 60% larger than the threshold — this warning fires on every production build unconditionally. The warning is permanent, ambient noise; it cannot be silenced without either raising the limit or removing the chunk definition. As a result, developers cannot distinguish this known-large chunk warning from a new genuine oversize regression caused by an accidental large import. The chunk size guard that is supposed to act as a CI/CD canary for bundle growth is permanently triggered and therefore useless. PROPOSAL: Raise `chunkSizeWarningLimit` from `500` to `900` in `vite.config.ts:33` — L/L effort (~1 character change; silences the known three-vendor warning while preserving the threshold as a meaningful detector for any other chunk that unexpectedly exceeds 900 KB).

- OBSERVATION: `package.json:16` specifies `"@googlemaps/markerclusterer": "latest"` using the npm `"latest"` dist-tag as the version specifier. All 9 other runtime dependencies use semver range qualifiers (`^X.Y.Z`): `@react-three/drei`, `@react-three/fiber`, `@types/three`, `date-fns`, `react`, `react-dom`, `react-router-dom`, `recharts`, `three`. The `package-lock.json` currently resolves `@googlemaps/markerclusterer` to `2.6.2`, which protects against drift when the lock file is present. However, if `package-lock.json` is deleted (a common outcome of merge conflicts or Docker layer rebuilds with `RUN npm install --omit=dev`) or `npm install --force` is run, npm re-resolves `"latest"` to whatever is current at that time. A future `3.0.0` major release of `@googlemaps/markerclusterer` (the package follows semver with breaking changes between major versions; v1→v2 removed the legacy `MarkerClusterer` class entirely) would silently install a breaking version in any environment that re-runs `npm install`. The only file in the project that imports this package is `components/MapView.tsx`, which uses the v2 API. PROPOSAL: Replace `"latest"` with `"^2.6.2"` in `package.json:16` — L/L effort (~8 character change; pins to the installed major version, aligns with all other dep specifiers, and prevents silent major-version breakage on lock-file-absent installs).

- OBSERVATION: `geointellisense-analytics/requirements.txt:15-16` specifies `numpy>=1.26,<2.1` and `scipy>=1.13,<1.15`. These two upper-bound caps interact in a way that creates an unvalidated numpy/scipy version pairing on fresh installs. NumPy 2.0 introduced breaking C API changes (`NPY_NO_DEPRECATED_API`, changed scalar type hierarchy); scipy 1.15.0 (released January 2025) was the first scipy release to be built and tested against NumPy 2.0 as the primary target. The `requirements.txt` allows `numpy>=2.0` (within the `<2.1` cap) but blocks `scipy>=1.15`, meaning a fresh `pip install -r requirements.txt` can resolve to `numpy==2.0.x` + `scipy==1.14.x` — a combination where scipy was compiled targeting numpy <2.0 and numpy 2.0's binary compatibility layer is required but not guaranteed for all scipy C-extension entry points. There is no `requirements-lock.txt` or `pip-compile`-generated lockfile: the analytics service has no mechanism to reproduce the exact dependency set across environments. A CI/CD pipeline, Docker build, and a developer's local virtualenv can all resolve to different numpy/scipy combinations within the allowed ranges. PROPOSAL: (a) Raise the scipy cap to `scipy>=1.15,<1.16` to ensure it uses the first numpy-2.0-validated scipy release; (b) run `pip-compile requirements.txt -o requirements-lock.txt` and commit `requirements-lock.txt`; use `pip install -r requirements-lock.txt` in CI and Docker — M/M effort (~4 lines + one-time pip-compile run; eliminates cross-environment dependency drift for the analytics service's scientific computing stack).

- OBSERVATION: `geointellisense-ingestion/Cargo.toml:20` specifies `rand = "0.8"`, which Cargo resolves to `0.8.5` (visible in `Cargo.lock`). rand `0.8.5` is the final release of the rand 0.8.x series; the rand maintainers released rand `0.9.0` in January 2025 as the new stable series and are not backporting fixes to 0.8.x. The ingestion binary is therefore permanently stuck on an unmaintained minor series unless manually bumped. The rand crate is used in `geointellisense-ingestion/src/aqi.rs:2` (`use rand::Rng`) and at lines 100 and 139 (`let mut rng = rand::thread_rng()`), exclusively for generating simulated AQI readings (the function result carries `source: "mock"` at line 131). In rand 0.9.0, `rand::thread_rng()` was replaced by `rand::rng()` (a free function returning the same `ThreadRng` type); upgrading to `rand = "0.9"` requires changing two call sites from `rand::thread_rng()` to `rand::rng()`. The rand 0.8 dependency also pulls in `rand_core 0.6.4` as a transitive dependency — rand 0.9 uses `rand_core 0.9.x`, so staying on 0.8 also freezes the entire rand ecosystem sub-tree. PROPOSAL: In `Cargo.toml:20`, change `rand = "0.8"` to `rand = "0.9"`; in `aqi.rs:100` and `aqi.rs:139`, replace `rand::thread_rng()` with `rand::rng()` — L/L effort (~3 lines; upgrades to current stable rand series and its associated rand_core ecosystem, eliminates unmaintained crate dependency).

**Proposed actions:**
- Raise `chunkSizeWarningLimit` from `500` to `900` in `vite.config.ts:33` — L/L effort (~1 change; makes chunk size warning actionable again)
- Replace `"@googlemaps/markerclusterer": "latest"` with `"^2.6.2"` in `package.json:16` — L/L effort (~8 chars; pins to installed major version, prevents silent breaking upgrade on lock-file-absent installs)
- Raise `scipy>=1.15,<1.16` in `requirements.txt:16`; add `requirements-lock.txt` via `pip-compile` — M/M effort (~4 lines + one-time run; closes numpy 2.0 / scipy 1.14 compatibility gap and adds reproducible Python deps)
- In `Cargo.toml:20`, change `rand = "0.8"` to `rand = "0.9"`; in `aqi.rs:100,139`, replace `rand::thread_rng()` with `rand::rng()` — L/L effort (~3 lines; upgrades ingestion to current stable rand crate series)

## 📚 Archive (one line per past run)
- Run #227 (2026-06-09) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #226 (2026-06-09) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #225 (2026-06-09) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #224 (2026-06-09) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #223 (2026-06-09) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #222 (2026-06-09) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #221 (2026-06-09) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #220 (2026-06-09) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #219 (2026-06-09) — Lens: Security — 4 findings — 0 promoted to Active
- Run #218 (2026-06-08) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #217 (2026-06-08) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #216 (2026-06-08) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #215 (2026-06-08) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #214 (2026-06-08) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #213 (2026-06-08) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #212 (2026-06-08) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #211 (2026-06-08) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #210 (2026-06-08) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #209 (2026-06-08) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #208 (2026-06-08) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #207 (2026-06-08) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #206 (2026-06-08) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #205 (2026-06-08) — Lens: Observability — 5 findings — 0 promoted to Active
- Run #204 (2026-06-08) — Lens: Security — 4 findings — 0 promoted to Active
- Run #203 (2026-06-07) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #202 (2026-06-07) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #201 (2026-06-07) — Lens: TS ↔ Python contract — 4 findings — 2 promoted to Active
- Run #200 (2026-06-07) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #199 (2026-06-07) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #198 (2026-06-07) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #197 (2026-06-07) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #196 (2026-06-07) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #195 (2026-06-07) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #194 (2026-06-07) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #193 (2026-06-07) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #192 (2026-06-07) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #191 (2026-06-07) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #190 (2026-06-07) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #189 (2026-06-07) — Lens: Security — 4 findings — 0 promoted to Active
- Run #188 (2026-06-06) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #187 (2026-06-06) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #186 (2026-06-06) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #185 (2026-06-06) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #184 (2026-06-06) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #183 (2026-06-06) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #182 (2026-06-06) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #181 (2026-06-06) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #180 (2026-06-06) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #179 (2026-06-06) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #178 (2026-06-06) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #177 (2026-06-06) — Lens: Deployment / Docker — 5 findings — 0 promoted to Active
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
- Run #186: lens 6 (TS ↔ Python contract) — findings added
- Run #187: lens 7 (UX / UI flaws) — findings added
- Run #188: lens 8 (Data pipeline integrity) — findings added
- Run #189: lens 9 (Security) — findings added
- Run #190: lens 10 (Observability) — findings added
- Run #191: lens 11 (Docs) — findings added
- Run #192: lens 12 (Deployment / Docker) — findings added
- Run #193: lens 13 (LLM integration quality) — findings added
- Run #194: lens 14 (Competitive scan) — findings added
- Run #195: lens 15 (Live-time claim audit) — findings added
- Run #196: lens 1 (Type safety) — findings added
- Run #197: lens 2 (Module boundaries) — findings added
- Run #198: lens 3 (Dependency health) — findings added
- Run #199: lens 4 (Perf hot paths) — findings added
- Run #200: lens 5 (Test coverage gaps) — findings added
- Run #201: lens 6 (TS ↔ Python contract) — findings added
- Run #202: lens 7 (UX / UI flaws) — findings added
- Run #203: lens 8 (Data pipeline integrity) — findings added
- Run #204: lens 9 (Security) — findings added
- Run #205: lens 10 (Observability) — findings added
- Run #206: lens 11 (Docs) — findings added
- Run #207: lens 12 (Deployment / Docker) — findings added
- Run #208: lens 13 (LLM integration quality) — findings added
- Run #209: lens 14 (Competitive scan) — findings added
- Run #210: lens 15 (Live-time claim audit) — findings added
- Run #211: lens 1 (Type safety) — findings added
- Run #212: lens 2 (Module boundaries) — findings added
- Run #213: lens 3 (Dependency health) — findings added
- Run #214: lens 4 (Perf hot paths) — findings added
- Run #215: lens 5 (Test coverage gaps) — findings added
- Run #216: lens 6 (TS ↔ Python contract) — findings added
- Run #217: lens 7 (UX / UI flaws) — findings added
- Run #218: lens 8 (Data pipeline integrity) — findings added
- Run #219: lens 9 (Security) — findings added
- Run #220: lens 10 (Observability) — findings added
- Run #221: lens 11 (Docs) — findings added
- Run #222: lens 12 (Deployment / Docker) — findings added
- Run #223: lens 13 (LLM integration quality) — findings added
- Run #224: lens 14 (Competitive scan) — findings added
- Run #225: lens 15 (Live-time claim audit) — findings added
- Run #226: lens 1 (Type safety) — findings added
- Run #227: lens 2 (Module boundaries) — findings added
- Run #228: lens 3 (Dependency health) — findings added
- Run #229: lens 4 (Perf hot paths) — findings added
- Run #230: lens 5 (Test coverage gaps) — findings added
