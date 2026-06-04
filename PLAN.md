# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-04T19:20:00Z
Last run: #156 — Lens: TS ↔ Python contract

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
### Run #156 — 2026-06-04 — Lens: TS ↔ Python contract
**Scope:** Twelfth TS ↔ Python contract pass. Files examined in full: `types.ts`; `services/aiService.ts`; `services/dataService.ts`; `hooks/useNormalizedData.ts`; `components/AnalysisView.tsx` (lines 1–60, 95–260, 449–471); `geointellisense-analytics/app/routes/chat.py`; `geointellisense-analytics/app/routes/predictive_analysis.py`; `geointellisense-analytics/app/routes/weather_forecast.py`; `geointellisense-analytics/app/routes/grounded_search.py`; `geointellisense-analytics/app/routes/grounded_maps.py`; `geointellisense-analytics/app/routes/historical_aqi.py`; `geointellisense-analytics/app/routes/historical_weather.py`. Cross-checked against Active Recommendations and Latest Findings runs #154–#155 plus archived TS ↔ Python contract lens runs #6, #21, #36, #51, #66, #81, #96, #111, #126, #141 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `dataService.ts:199` and `dataService.ts:221` — `getHistoricalAQI` and `getHistoricalWeather` pass comma-separated `location_ids` strings where each ID is a slug generated at `dataService.ts:279` as `name.toLowerCase().replace(/\s+/g, '_')` (e.g. `"bakersfield"`, `"fresno"`). `historical_aqi.py:46` and `historical_weather.py:37` both pass this list to PostgreSQL via `ANY($1::uuid[])` — PostgreSQL immediately rejects non-UUID values with `invalid input syntax for type uuid: "bakersfield"`, producing a 500 response. The TS catches all HTTP errors at `dataService.ts:208-210` and `dataService.ts:228-230` and silently falls back to mock `dashboardData`. Consequence: every call to `getHistoricalAQI(locationIds)` or `getHistoricalWeather(locationIds)` with a non-empty `locationIds` array returns mock data, never live database records. Additionally, when the unfiltered API call succeeds (no `location_ids` parameter), Python returns UUIDs in the `locationId` field (e.g. `"locationId": "3a8f…-uuid"`) while `getLocations()` at `dataService.ts:278-280` produces slug IDs (`"bakersfield"`). Any downstream filter like `records.filter(r => r.locationId === loc.id)` in `Dashboard.tsx:153` will never match — UUID from the API vs. slug from the location list. PROPOSAL: Align location IDs on one canonical form: either (a) add a `name_slug` column to the `locations` DB table and query by it in historical routes, or (b) change `getLocations()` to fetch actual UUIDs from the backend; either fix eliminates the mismatch in both the filter query and the returned records — M/M effort (add slug column to DB schema + update both TS and Python).

- OBSERVATION: `grounded_search.py:79` and `grounded_maps.py:86` both hardcode `"groundingChunks": []` in every response. `AnalysisView.tsx:85` declares `const [groundingChunks, setGroundingChunks] = useState<GroundingChunk[]>([])`, `AnalysisView.tsx:177` sets it from the search response, `AnalysisView.tsx:187` sets it from the maps response, and `AnalysisView.tsx:451-463` renders an entire "Sources" section — but this section is permanently hidden because the API always returns an empty array. The `GroundingChunk` interface at `types.ts:14-30` defines a full schema with `web.uri`, `web.title`, `maps.uri`, `maps.placeAnswerSources.reviewSnippets` — none of which ever gets populated. The Python uses Claude's tool-use mechanism (`TOOLS`, `execute_tool`) for web search, but tool results are consumed internally in the `while resp.stop_reason == "tool_use"` loop and are never extracted into the response's `groundingChunks` field. PROPOSAL: Either (a) remove the dead `groundingChunks` field from both Python response dicts and the TS `GroundingChunk` interface/`groundingChunks` state, or (b) instrument the tool-use loop in `grounded_search.py` and `grounded_maps.py` to extract source URLs from web-search tool results and return them as `groundingChunks` — L/L effort for option (a) or M/H effort for option (b).

- OBSERVATION: `historical_weather.py` (entire file) — the `/api/historical-weather` route has no Redis TTL cache while the structurally identical `/api/historical-aqi` route implements a 300-second cache at `historical_aqi.py:22-25` (`await get_cached(...)`) and `historical_aqi.py:100-101` (`await set_cached(...)`). Both routes are called together in `useNormalizedData.ts:53-54` (`dataService.getHistoricalAQI(...)` and `dataService.getHistoricalWeather(...)`) within a `Promise.all` on every component render. A cache miss on `historical-aqi` re-queries PostgreSQL once then returns cached for the next 5 minutes; a cache miss on `historical-weather` always queries PostgreSQL regardless of call frequency. Additionally, `historical_weather.py:56` returns a plain Python list `return []` on the empty-row path rather than `JSONResponse` — the response therefore lacks `X-Cache` headers, inconsistent with `historical_aqi.py:64` which returns `JSONResponse(content=[], headers=cache_headers(False, HIST_TTL))`. PROPOSAL: Add `get_cached`/`set_cached` calls to `historical_weather.py` mirroring the pattern in `historical_aqi.py:22-25,100-101`; change the empty-rows path to `return JSONResponse(content=[], headers=cache_headers(False, HIST_TTL))` — L/L effort (copy-adapt ~8 lines from `historical_aqi.py` + add `from app.cache import get_cached, set_cached, cache_headers` import).

**Proposed actions:**
- Align location IDs: add `name_slug` to `locations` table and filter by slug in `historical_aqi.py:46` and `historical_weather.py:37`; update `getLocations()` to return slugs matching DB records — M/M effort
- Remove dead `groundingChunks` field from Python responses and TS state/interface (option a), or implement source extraction in the tool-use loop (option b) — L/L (a) or M/H (b)
- Add Redis TTL cache to `historical_weather.py` mirroring `historical_aqi.py:22-25,100-101`; fix empty-path to `JSONResponse` — L/L effort

### Run #155 — 2026-06-04 — Lens: Test coverage gaps
**Scope:** Eleventh test coverage gaps pass. Files examined in full: `utils/weatherUtils.ts`; `utils/interpolation.ts` (lines 1–200); `utils/colorScales.ts` (lines 88–174); `geointellisense-ingestion/src/aqi.rs` (lines 88–166). Verified zero `#[cfg(test)]` blocks in all Rust src files (grep clean). Verified zero pytest files in `geointellisense-analytics/` (grep clean). Cross-checked against Active Recommendations and Latest Findings runs #152–#154 plus archived Test coverage gaps lens runs #5, #20, #35, #50, #65, #80, #95, #110, #125, #140 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `utils/weatherUtils.ts:1-16` — `calculateFeelsLike` has an undocumented "dead zone" with no test coverage. The function applies heat index when `temp >= 80 && humidity >= 40`, wind chill when `temp <= 50 && windSpeed >= 3`, and otherwise returns raw `temp`. The dead zone [51°F, 79°F] always falls through to `return temp`, but the combination boundary at exactly `temp=80, humidity=39` (hot but dry) is particularly subtle: the heat index branch fires only when humidity ≥ 40, so a dry 80°F day returns raw temperature — this matches NWS guidelines but is nowhere documented. Similarly, `determineWeatherCondition` at lines 58-69 evaluates 8 `if` branches in strict priority order (precipProb → cloudCover → windSpeed → temp). Because priority is implicit in code ordering, `precipProb=71, cloudCover=90, windSpeed=30` returns "Rainy" even though it is also "Overcast" and "Windy" — the dominant condition wins by accident of ordering. No test covers any boundary for either function. PROPOSAL: Add unit tests for `calculateFeelsLike` covering: (a) heat index activation boundary (`temp=80, humidity=40` and `temp=80, humidity=39`); (b) wind chill boundary (`temp=50, windSpeed=3` and `temp=50, windSpeed=2`); (c) dead-zone pass-through (`temp=65, windSpeed=15`). Add tests for `determineWeatherCondition` covering at least two priority-collision cases — L/L effort (new `weatherUtils.test.ts` file, ~20 test cases).

- OBSERVATION: `utils/interpolation.ts:126-175` — `interpolateKriging` contains a structural defect that makes the Kriging implementation always fall back to IDW, and zero tests expose it. At lines 146-157, the Kriging matrix `K` is built by calling `variogramFunction(dist, ...)`. When `i == j`, `dist` is always `0` — and `variogramFunction` at line 204 explicitly returns `0` for `distance === 0`. This means every diagonal entry `K[i][i] = 0`. `solveLinearSystem` at line 276 returns `null` when `Math.abs(augmented[i][i]) < 1e-10` — which triggers immediately on the first iteration when the pivot is `K[0][0] = 0`. Thus `solveLinearSystem` always returns `null`, the guard at line 172-175 always fires, and `interpolateKriging` always delegates to `interpolateIDW`. The `method: 'kriging'` option in `generateInterpolatedGrid` (line 327) and `generateInterpolatedMatrix` (line 366) is therefore silently inoperative — any caller requesting Kriging gets IDW without any warning. The correct fix is to add the nugget effect to the diagonal: `K[i][i] = nugget` (or `sill * 0.1` as `estimateVariogramParams` already computes) rather than calling `variogramFunction(0, ...)`. PROPOSAL: Fix `interpolation.ts:147-149` to set `K[i][j] = (i === j) ? nugget : variogramFunction(...)` so the matrix is non-singular; add unit tests verifying (a) `interpolateKriging` with 4+ data points returns a non-IDW result; (b) `interpolateKriging` with < 3 points falls back to IDW; (c) `generateInterpolatedGrid` with `method: 'kriging'` produces different results than `method: 'idw'` — M/L effort (1-line fix in Kriging matrix + ~10 test cases).

- OBSERVATION: `utils/colorScales.ts:119-128` and `27-34` — `hexToRgb` and `getAQICategory` have no boundary tests and contain silent failure modes. `hexToRgb` at line 122 returns `{r:0, g:0, b:0}` (black) when the input string fails the hex regex — with no error thrown. This means `interpolateColorStops` at line 143, which calls `hexToRgb` for both `lower.color` and `upper.color`, silently produces black output for any malformed stop color. All hardcoded gradient constants (`AQI_GRADIENT_STOPS`, `TEMPERATURE_GRADIENT_STOPS`, etc.) use valid hex strings today, but the silent fallback means future invalid entries produce wrong visualizations with no error. `getAQICategory` at lines 27-34 contains 6 boundary conditions: the boundaries at 50/51, 100/101, 150/151, 200/201, 300/301 are all untested. The `hexToRgb` → `rgbToHex` round-trip is also untested: calling `hexToRgb(rgbToHex(r, g, b))` should recover `{r, g, b}` exactly — but `rgbToHex` applies `Math.round` on floating-point values that result from `interpolateColorStops`'s linear interpolation, meaning the round-trip adds ±1 quantization per channel. PROPOSAL: Add `colorScales.test.ts` covering: (a) all 6 `getAQICategory` boundary values (0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301, 500); (b) `hexToRgb` with invalid input (`''`, `'not-a-color'`); (c) `hexToRgb`/`rgbToHex` round-trip with known values; (d) `interpolateColorStops` at position 0.0 and 1.0 (clamping) — L/L effort (new `colorScales.test.ts`, ~15 test cases).

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs:138-166` — `generate_history` uses a fragile substring match `station_id.contains("0002")` at line 143 to distinguish the Bakersfield station's base AQI (85.0) from all other stations (60.0). This string comparison evaluates against whatever string is passed in — the route handler at `routes/aqi.rs` extracts this from the URL path parameter. If the station ID is passed as an uppercase UUID, or if the route logic changes to pass a different identifier format, the `contains("0002")` check silently fails and all stations default to base_aqi 60.0 (losing Bakersfield's higher baseline). Additionally, `aqi_category` at lines 88-97 is business-critical — it maps `u32` AQI values to the category strings returned in every API response — but has zero `#[cfg(test)]` tests. Key edge cases: `aqi_category(0)` = "Good"; `aqi_category(50)` = "Good"; `aqi_category(51)` = "Moderate"; `aqi_category(u32::MAX)` should hit the wildcard `_` arm → "Hazardous". There are zero `#[cfg(test)]` modules in the entire ingestion service (confirmed across all files: `aqi.rs`, `broadcast.rs`, `config.rs`, `purpleair.rs`, `redis_cache.rs`, `usgs.rs`, `db/persist.rs`, all route files). PROPOSAL: Add `#[cfg(test)]` module to `aqi.rs` with tests for `aqi_category` at all 6 boundary values; replace `station_id.contains("0002")` with a proper lookup against the `stations()` function's `base_aqi` field (pass `Station` instead of `&str`) — L/L effort (add ~15-line test module + refactor `generate_history` signature to accept `&Station`).

**Proposed actions:**
- Add `weatherUtils.test.ts` covering all boundaries of `calculateFeelsLike` and `determineWeatherCondition` — L/L effort
- Fix `interpolation.ts:147-149` Kriging diagonal (set `K[i][i] = nugget`); add tests verifying Kriging differs from IDW — M/L effort
- Add `colorScales.test.ts` covering `getAQICategory` at all 11 boundary values and `hexToRgb`/`rgbToHex` round-trip — L/L effort
- Add `#[cfg(test)]` module to `aqi.rs` testing `aqi_category` boundaries; refactor `generate_history` to accept `&Station` instead of `&str` — L/L effort

### Run #154 — 2026-06-04 — Lens: Perf hot paths
**Scope:** Tenth perf hot paths pass. Files examined in full: `geointellisense-ingestion/src/db/persist.rs`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/aqi.rs`; `geointellisense-ingestion/src/purpleair.rs`; `geointellisense-ingestion/src/routes/sse.rs`; `components/3d/AQI3DScene.tsx`; `components/3d/CityMarkers.tsx`; `hooks/useRealtimeAQI.ts`. Cross-checked against Active Recommendations and Latest Findings runs #151–#153 plus archived Perf hot paths lens runs #4, #19, #34, #49, #64, #79, #94, #109, #124, #139 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:5-35` — `write_readings` fires N individual SQL `INSERT` statements in a sequential `for` loop with no transaction and no batching. Each iteration (`sqlx::query("INSERT INTO sensor_readings ...").execute(pool).await`) is a fully independent DB round-trip. With 6 seeded stations this means 6 sequential network round-trips to PostgreSQL every broadcast tick. There is no wrapping `BEGIN`/`COMMIT` transaction: if inserts 1–4 succeed and insert 5 fails (e.g. a unique-constraint violation or a transient connection error), the DB retains 4 rows for that tick with 2 absent — partial ingestion with no atomicity and no indication in the data. The fix is straightforward: replace the loop with a single parameterized `INSERT INTO sensor_readings ... SELECT * FROM UNNEST($1::timestamptz[], $2::uuid[], ...)` or use `sqlx::QueryBuilder::push_values` to build a multi-value `VALUES ($1,...), ($2,...), ...` statement, wrapped in `pool.begin()`/`tx.commit()`. The entire batch becomes 1 DB round-trip. PROPOSAL: Rewrite `write_readings` in `persist.rs` to use `sqlx::QueryBuilder::push_values` for a single batched INSERT wrapped in a transaction — H/L effort (rewrite ~30-line function + test).

- OBSERVATION: `components/3d/AQI3DScene.tsx:67-73` — `CameraController::useFrame` allocates `new THREE.Vector3()` on every animation frame. Line 69 reads `const target = new THREE.Vector3();` inside the `useFrame` callback body (line 67). At 60fps this creates 60 garbage-collectible `THREE.Vector3` objects per second. Three.js and `@react-three/fiber` document this as a common GC pressure source: frequent small-object allocations inside `useFrame` cause incremental GC pauses that manifest as microstutters (1–5ms dropped frames) during camera movement. The fix is a one-time allocation via `useRef` outside the frame loop: `const targetRef = useRef(new THREE.Vector3())` at the top of `CameraController`, then inside `useFrame` use `controlsRef.current.getTarget(targetRef.current)` and pass `targetRef.current` to `onCameraMove`. Additionally, `onCameraMove` is called unconditionally every frame even when the camera is stationary — adding a `camera.position.equals(prevPositionRef.current)` guard would skip the callback when nothing has changed. PROPOSAL: Hoist `const targetRef = useRef(new THREE.Vector3())` outside `useFrame` in `AQI3DScene.tsx:CameraController`; add `const prevPos = useRef(new THREE.Vector3())` and skip `onCameraMove` call when position is unchanged — L/L effort (2 ref additions + 2 line changes inside frame callback).

- OBSERVATION: `components/3d/CityMarkers.tsx:110-123` — each of the N `CityMarker` instances registers its own independent `useFrame` callback. With 6 cities, 6 separate `useFrame` callbacks run every frame (60fps). The guard `if (!animate || !markerRef.current) return` at line 111 exits early but still incurs the overhead of 6 separate callback invocations per frame. Additionally, `cylinderGeometry args={[0.8 * scale, 1.2 * scale, markerHeight, 16]}` at line 148 depends on `markerHeight` (derived from `city.aqi` via the `useMemo` at lines 84-87). When `city.aqi` changes on each SSE event, `markerHeight` recalculates and `cylinderGeometry` is provided a new `args` tuple — React Three Fiber detects the prop change and Three.js disposes the old `BufferGeometry` and allocates a new one. With 6 cities updating on each SSE tick, this is 6 geometry reallocations per data update. A more efficient approach is to keep the cylinder geometry fixed-height and instead mutate `mesh.scale.y` in the animation frame based on the current AQI — Three.js scale mutations have no allocation cost. PROPOSAL: Consolidate the 6 per-marker `useFrame` callbacks into one `useFrame` in the parent `CityMarkers` component that iterates marker refs; replace `cylinderGeometry args` with a fixed-height geometry and animate height via `ref.current.scale.y` — M/M effort (refactor animation model in `CityMarkers.tsx`).

- OBSERVATION: `hooks/useRealtimeAQI.ts:162-178` and `181-198` — two compounding inefficiencies in the history management code. First, `addToHistory` at lines 165-177 uses `setHistory(prev => [...prev, snapshot])` — a spread copy that allocates a full new array of up to `maxHistorySize` (288) snapshot objects on every data event. Second, `getDataAtTime` at lines 185-197 performs a linear O(N) scan through all history entries to find the nearest timestamp. Since history entries are always appended in chronological order, the array is sorted by `timestamp.getTime()` and a binary search would locate the nearest entry in O(log 288) ≈ 8 comparisons instead of up to 288. The `getDataAtTime` callback also lists `[history]` as its dependency (line 198), so it re-creates on every history update — meaning both the closure and the underlying search are freshly allocated each time new data arrives. Together, for every SSE event, the hook: (a) allocates a new 288-element array, (b) recreates the `getDataAtTime` closure, and (c) any consumer that calls `getDataAtTime` triggers a full linear scan. PROPOSAL: Replace linear scan in `getDataAtTime` (lines 185-197) with binary search over the sorted `history` array; replace spread-copy in `addToHistory` with a mutable circular-buffer ref (`useRef<HistoricalSnapshot[]>([])`) synced to state only when needed — L/L effort (add ~15-line binary search helper + refactor `addToHistory`).

**Proposed actions:**
- Rewrite `write_readings` in `db/persist.rs:5-35` to use `sqlx::QueryBuilder::push_values` for a single batched INSERT wrapped in `pool.begin()/tx.commit()` — H/L effort
- Hoist `new THREE.Vector3()` out of `useFrame` in `AQI3DScene.tsx:CameraController` (line 69); add stationary-camera guard to skip `onCameraMove` when position unchanged — L/L effort
- Consolidate 6 per-marker `useFrame` callbacks into one in parent `CityMarkers.tsx`; replace geometry `args` with fixed-height cylinder + `scale.y` mutation — M/M effort
- Replace O(N) linear scan in `useRealtimeAQI.ts:getDataAtTime` with binary search; replace spread-copy history append with circular buffer ref — L/L effort

## 📚 Archive (one line per past run)
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
