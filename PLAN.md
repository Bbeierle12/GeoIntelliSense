# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-08T22:00:00Z
Last run: #216 — Lens: TS ↔ Python contract

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
### Run #216 — 2026-06-08 — Lens: TS ↔ Python contract
**Scope:** Sixteenth TS ↔ Python contract pass. Files read in full: `types.ts`, `services/aiService.ts`, `services/dataService.ts`, `components/AnalysisView.tsx` (lines 1–260), `hooks/useLiveData.ts`, `hooks/useNormalizedData.ts`, `data/dashboardData.ts` (lines 1–80), `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/historical_aqi.py`, `geointellisense-analytics/app/routes/historical_weather.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/routes/weather_forecast.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/grounded_maps.py`, `geointellisense-analytics/app/routes/nws_forecast.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/routes/ai_context.py`, `geointellisense-analytics/app/routes/explore.py`, `geointellisense-analytics/app/routes/weather_historical.py`, `geointellisense-analytics/app/ml/aqi_model.py:285–311`. Cross-checked against Active Recommendations and archived TS↔Python contract runs #6, 21, 36, 51, 66, 81, 96, 111, 126, 141, 156, 171, 186, 201 to confirm findings are new.

**Findings:**

- OBSERVATION: `historical_weather.py:98` — `"totalPrecipitation": 0.0` is hardcoded as a placeholder comment reads `# sensor_readings doesn't have precip; placeholder`. The TypeScript `HistoricalWeatherRecord` interface at `dataService.ts:68` declares `totalPrecipitation: number` (non-optional), and the TS mock fallback at `dataService.ts:383` returns `monthData.precipitation` from `dashboardData` (non-zero values, e.g. Bakersfield January: 3.9 in). This means: (1) any Dashboard chart that graphs `totalPrecipitation` over time will display flat zero from the live backend and non-zero from the fallback — the difference is invisible in the UI and a developer cannot distinguish "no rain" from "precipitation data unavailable"; (2) `Dashboard.tsx:277–303` includes `mergedHistoricalWeather` and `mergedAgriculturalData` memos that process `totalPrecipitation` — users in the San Joaquin Valley will see zero precipitation for all historical months even during the January–March rainy season, directly undermining the app's environmental accuracy claims. PROPOSAL: (a) Either add a `precipitation` column to `sensor_readings` (or join `weather_observations.PRCP` in `historical_weather.py`) and remove the placeholder — M/H effort (~20 SQL migration + Python join); (b) or return `null` / omit the field and reflect that in the TypeScript type as `totalPrecipitation?: number | null`, so charts can render "no data" rather than "zero rain" — L/L effort (~5 lines on each side; correct representation of missing data).

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:310` — `predict_aqi()` returns a `"currentFeatures"` key in the `/api/predict/aqi` response, containing a dict of all 13 model features (aqi, pm25, temperature, humidity, wind_speed, wind_direction_sin, wind_direction_cos, fire_count_200km, fire_total_frp, inversion_strength, day_of_week, month, hour) mapped to their current numeric values. The TypeScript `PredictionResult` interface at `useLiveData.ts:131–141` does NOT include a `currentFeatures` field: the interface has only `predictedAqi`, `confidenceInterval`, `category`, `horizon`, `modelR2`, `modelMAE`, `trainedAt`, `topFactors`, and optional `airnowComparison`. As a result, `currentFeatures` is silently discarded after `useLiveData` fetches `/api/predict/aqi` — any component using `data?.currentFeatures` will get `undefined` at runtime (TypeScript will also flag this as a type error for strictly-typed access). The feature values are particularly useful for displaying "which current conditions are driving today's 24h forecast" alongside the `topFactors` list. PROPOSAL: Add `currentFeatures?: Record<string, number>` to `PredictionResult` in `useLiveData.ts:141` — L/L effort (1 line; surfaces already-returned data to the UI without any backend change).

- OBSERVATION: `geointellisense-analytics/app/routes/predict.py:133–138` — the `/api/predict/factors` GET endpoint returns `{modelR2, modelMAE, trainedAt, trainingSamples, factors: [{feature, importance, pctContribution, description}]}` (note: `factors` array with four fields each). No TypeScript type or hook wraps this endpoint in `useLiveData.ts` or any other TS file. The closest related type, `PredictionResult` at `useLiveData.ts:131–141`, has `topFactors: Array<{feature: string; importance: number}>` (two fields, different key name). If a developer calls `/api/predict/factors` by reusing `PredictionResult`, two contract violations occur: (1) the top-level key is `factors` not `topFactors` — `data.topFactors` would be `undefined`; (2) each entry has `pctContribution: number` and `description: string` that are not in the `topFactors` element type. No runtime error would surface (TypeScript structural types allow extra fields), but `pctContribution` — the percentage of the prediction variance attributed to each feature — would be inaccessible to any consumer that typed against `PredictionResult`. PROPOSAL: Add `FactorsResult` interface to `useLiveData.ts` for `/api/predict/factors` responses, with `factors: Array<{feature: string; importance: number; pctContribution: number; description: string}>` — L/L effort (~12 lines; avoids silent schema mismatch if `/api/predict/factors` is consumed in the future dashboard).

- OBSERVATION: `types.ts:14–30` — the `GroundingChunk` interface exposes a `maps.placeAnswerSources.reviewSnippets` nested structure (with `uri`, `text`, and `author` fields on each snippet) that mirrors the Gemini 1.5 Pro grounding API response format. Both Python grounding routes unconditionally return `"groundingChunks": []`: `grounded_search.py:79` and `grounded_maps.py:86`. This means: (1) `AnalysisView.tsx:85` maintains `const [groundingChunks, setGroundingChunks] = useState<GroundingChunk[]>([])` and `setGroundingChunks(searchRes.groundingChunks)` at line 177, but the array is permanently empty — the TypeScript UI code for rendering citations (if any) is dead at runtime; (2) the `maps.placeAnswerSources.reviewSnippets.author` path is a Gemini-specific field (Gemini Maps grounding returns review snippets with authors); Claude's tool-use results do not map to this shape. The Python backend migrated from Gemini to Claude (both endpoints now use `claude-sonnet-4-20250514`) but the TypeScript contract was never updated to reflect that no grounding metadata is returned. PROPOSAL: (a) Short-term: remove the `maps.placeAnswerSources` nesting from `GroundingChunk` or replace the whole interface with a minimal `{text: string; uri?: string}[]` reflecting what the Python could realistically populate from tool results — L/L effort (~8 lines in `types.ts`); (b) long-term: populate `groundingChunks` from `tool_result` content returned by Claude's web-search tool calls in `grounded_search.py` — M/M effort (~20 lines extracting URLs from tool responses).

**Proposed actions:**
- Fix `historical_weather.py:98`: join `weather_observations.PRCP` or return `null` for `totalPrecipitation`; update TS type if null — H/L impact, L/L (schema change) or M/H (SQL join) effort (Active Recommendation #10)
- Add `currentFeatures?: Record<string, number>` to `PredictionResult` in `useLiveData.ts:141` — M/L effort (1 line; surfaces model explainability data already returned by `/api/predict/aqi`)
- Add `FactorsResult` interface in `useLiveData.ts` for `/api/predict/factors` response shape — M/L effort (~12 lines; prevents shape mismatch if endpoint is consumed)
- Remove Gemini-era `maps.placeAnswerSources.reviewSnippets` nesting from `GroundingChunk` in `types.ts:14–30`; align with Claude's tool-use output — M/L effort (~8 lines; cleans dead Gemini-era schema)

### Run #215 — 2026-06-08 — Lens: Test coverage gaps
**Scope:** Fifteenth test-coverage pass. Full reads of: `tests/` (all 7 test files), `App.test.tsx`, `utils/colorScales.ts`, `utils/interpolation.ts`, `utils/weatherUtils.ts`, `geointellisense-analytics/app/cache.py`, `geointellisense-analytics/app/ml/aqi_model.py`, `geointellisense-ingestion/Cargo.toml`, all `.rs` source files (grep for `#[cfg(test)]`). Cross-checked against Active Recommendations and archived test-coverage runs #5, 20, 35, 50, 65, 80, 95, 110, 125, 140, 155, 170, 185, 200 to confirm findings are new.

**Findings:**

- OBSERVATION: `utils/colorScales.ts:351-355` — `getContrastColor` is an exported function with zero test coverage and zero call sites in the codebase (no file imports it). The function computes `luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255` and returns `'#000000'` when `luminance > 0.5`, else `'#ffffff'`. The 0.5 threshold is based on the BT.601 gamma-encoded luma formula, not the WCAG 2.x relative luminance formula (which gamma-decodes each channel and uses a threshold of ~0.179). For the AQI category orange `#ff7e00` (used at `unhealthySensitive`): BT.601 luma ≈ 0.589 → returns black text; for AQI red `#ff0000` (used at `unhealthy`): BT.601 luma ≈ 0.299 → returns white text. The WCAG linear formula would return white for `#ff7e00` and black is borderline for `#ff0000`. Since this function is presumably intended for accessible AQI color labels, the wrong threshold could result in low-contrast label text. Additionally, the function is dead code — it has never been called in production and its behavior is entirely unverified. PROPOSAL: (a) Add a vitest unit test verifying `getContrastColor` returns the expected value for each of the 6 AQI category colors (`#00e400`, `#ffff00`, `#ff7e00`, `#ff0000`, `#8f3f97`, `#7e0023`) — L/L effort (~15 lines; validates the threshold for all AQI use cases); (b) either replace the threshold with the WCAG formula or document the BT.601 choice as intentional — L/L effort (~3 line change).

- OBSERVATION: `utils/interpolation.ts:407-440` — `calculateGridStats` is an exported function with zero test coverage and zero call sites in the codebase (never imported). At line 415, `values` is sorted from `grid.map(p => p.value)` — if called with an empty array `[]`, `values[0]` and `values[n - 1]` are both `undefined`, mean divides by 0 yielding `NaN`, and all five `percentiles` entries are `undefined`. There is no guard or early-return for the empty-input case. The same crash potential exists in `generateInterpolatedGrid:309` — if called with `resolution = 0`, the outer loop iterates once with `i = 0` and `j = 0`, producing a 1-element grid, which is safe, but `resolution = -1` produces no iterations and an empty grid that would cause `calculateGridStats` to crash if chained. Additionally, the Kriging fallback path in `interpolateKriging:131-133` (falls back to IDW when `dataPoints.length < 3`) and the `solveLinearSystem` null-return path (line 172-174, falls back to IDW) are zero-test-coverage control flow branches. PROPOSAL: (a) Add a guard in `calculateGridStats` returning `null` or throwing a descriptive error for empty `grid` input — L/L effort (~3 lines); (b) add vitest unit tests for `interpolateIDW`, `interpolateTemporal`, and `calculateGridStats` covering the exact-match path, the empty-grid crash, and the mismatched-size throw (`interpolateTemporal:388`) — L/L effort (~20 lines; covers the 3 highest-risk untested paths).

- OBSERVATION: `utils/weatherUtils.ts:1-69` — All four exported functions (`calculateFeelsLike`, `calculateET0`, `calculateSunTimes`, `determineWeatherCondition`) have zero test coverage. Three specific correctness issues have no test to catch them: (1) `calculateFeelsLike:9` uses `temp <= 50 && windSpeed >= 3` for wind chill — at `temp = 50.0, windSpeed = 2.9` (just below threshold), the function returns raw temperature; at `temp = 50.1, windSpeed = 25`, the heat-index branch (`temp >= 80`) does not trigger but neither does wind chill; the function silently returns the raw temperature for a wide range of real-world conditions where feels-like would meaningfully differ (e.g., 55°F / 25mph). (2) `calculateSunTimes:38` calls `Math.acos(-Math.tan(latRad) * Math.tan(declinationRad))` with no guard against values outside `[-1, 1]`. For latitudes above ~66.5°N (Arctic Circle) or below ~-66.5°S, during polar night or polar day, the argument falls outside this range and `Math.acos` returns `NaN`, which silently propagates to all return values. The San Joaquin Valley (36–38°N) is safe, but the function is exported with no documented latitude restriction. (3) `determineWeatherCondition:58-69` uses a first-match if-chain: `precipProb=80%, temp=105°F` returns `'Rainy'` (not `'Very Hot'`), which is arguably correct but the priority order is untested and undocumented. PROPOSAL: Add vitest unit tests for all four functions in `weatherUtils.ts`, covering: (a) `calculateFeelsLike` at heat-index boundary (temp=80/humidity=40 vs 80/39), wind-chill boundary (temp=50/speed=3 vs 50/2), and the gap region; (b) `calculateSunTimes` for at least one known-good date at Fresno's latitude (36.7°N) and verification that the return values are parseable strings; (c) `determineWeatherCondition` for each of the 8 outcome branches — L/L effort (~30 lines; covers 3 latent correctness issues before the functions are reused in new contexts).

- OBSERVATION: `geointellisense-analytics/app/cache.py:90-103` — `flush_all` has a silent count-inconsistency bug on mid-iteration Redis errors. The `async for key in r.scan_iter(f"{PREFIX}:*")` loop accumulates matched keys into the `keys` list before calling `r.delete(*keys)`. The entire loop and delete are wrapped in a single `try/except`. If a Redis error occurs: (a) during `scan_iter` iteration after N keys have been appended — the `except` block returns 0, but those N keys exist and were NOT deleted, making the returned count incorrect and the cache not fully flushed; (b) during `r.delete(*keys)` after all keys were scanned — the `except` block returns 0 but all keys were scanned (just not deleted), and the caller has no way to distinguish this from a zero-key flush. The `cache_headers` function at line 106 is also zero-tested: `cache_headers(hit=True, ttl=3600)` should return `{"Cache-Control": "public, max-age=3600", "X-Cache": "HIT"}` — a trivial but untested assertion. No pytest files exist anywhere in `geointellisense-analytics/`. PROPOSAL: (a) Create `geointellisense-analytics/tests/test_cache.py` with pytest tests for `_key` (deterministic hash for same input), `cache_headers` (HIT/MISS strings), and the `flush_all` error path using `unittest.mock.AsyncMock` for the Redis client — L/L effort (~25 lines; first test file for the Python service, catches the count-inconsistency bug and validates key generation); (b) fix `flush_all:101` to return `len(keys)` in the except block when `r.delete` is the failure point, or restructure to separate scan from delete — L/L effort (~5 lines).

**Proposed actions:**
- Add vitest unit tests for `getContrastColor` against all 6 AQI category colors; document or correct the BT.601 vs WCAG threshold — L/L effort (~18 lines; validates dead-code function before it is called in production)
- Add empty-grid guard to `calculateGridStats`; add vitest tests for `interpolateIDW` exact-match path, empty-grid crash, and `interpolateTemporal` mismatched-size throw — L/L effort (~23 lines)
- Add vitest unit tests for all 4 `weatherUtils.ts` functions covering boundary conditions and the `calculateSunTimes` NaN-propagation risk — L/L effort (~30 lines)
- Create `geointellisense-analytics/tests/test_cache.py` with pytest tests for `_key`, `cache_headers`, and `flush_all` error paths; fix `flush_all` mid-error count — L/L effort (~30 lines; first Python test file in the service)

### Run #214 — 2026-06-08 — Lens: Perf hot paths
**Scope:** Fifteenth perf-hot-paths pass. Full reads of: `geointellisense-ingestion/src/db/persist.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-ingestion/src/redis_cache.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `hooks/useRealtimeAQI.ts`, `hooks/useDashboardData.ts`, `components/Dashboard.tsx`, `services/dataService.ts`. Cross-checked against Active Recommendations and archived perf runs #4, 19, 34, 49, 64, 79, 94, 109, 124, 139, 154, 169, 184, 199 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:6-34` — `write_readings` issues one `sqlx::query().execute()` call per reading inside a `for r in readings` loop — a sequential N-round-trip write pattern. With 6 stations per broadcast tick and a realistic `broadcast_secs` of 30, this produces 2,880 individual Postgres round-trips per day, each requiring its own query-parse, plan, WAL-write, and ack cycle. If the `sensor_readings` table is a TimescaleDB hypertable, each insert also pays chunk-routing overhead individually. A single `INSERT INTO sensor_readings ... SELECT UNNEST($1::uuid[]), UNNEST($2::timestamptz[]), ...` statement (or sqlx `QueryBuilder::push_values` / bulk-bind approach) would collapse all 6 inserts into a single Postgres round-trip, reducing write amplification by 6×. PROPOSAL: Replace the per-row loop in `persist.rs:6-34` with a single parameterized bulk INSERT using `QueryBuilder` — M/M effort (~20 line change; reduces write round-trips from N to 1 per broadcast tick without changing the DB schema).

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:104-112` — every broadcast tick, when the live PurpleAir cache is populated, the ticker loop clones the entire `Vec<AqiReading>` to update only the `timestamp` field: `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()`. `AqiReading` contains two heap-allocated `String` fields — `station_name` (e.g., "Fresno-Garland", 14 bytes) and `county` (e.g., "Kern", 4 bytes). With 6+ readings per tick, each broadcast fires 12+ `String::clone()` operations that allocate on the heap, memcpy the string content, and then deallocate when the readings arc is dropped by receivers. Since `station_name` and `county` are station-static (they never change between ticks), changing these two fields from `String` to `Arc<str>` in the `AqiReading` struct would make the per-tick clone a cheap atomic refcount increment (~1 ns) instead of a heap allocation + memcpy (~50–200 ns per field). PROPOSAL: Change `station_name: String` and `county: String` in `aqi.rs:9-11` to `station_name: Arc<str>` and `county: Arc<str>`; update all construction sites in `aqi.rs:99-136`, `aqi.rs:139-161`, `purpleair.rs:100-122` — M/M effort (~25 call-site updates; eliminates heap allocation in the hot broadcast path for static string fields).

- OBSERVATION: `hooks/useRealtimeAQI.ts:182-198` — the `getDataAtTime` function performs an O(n) linear scan over the `history` array (bounded by `maxHistorySize = 288`) to find the snapshot with the closest timestamp. The array is always appended in chronological order by `addToHistory` (line 162-178), making it a sorted sequence — optimal for binary search. For 288 entries, a linear scan averages 144 comparisons; a binary search would average 8. Additionally, `getDataAtTime` is a `useCallback` with `[history]` as its dependency (line 198): because `history` is replaced (not mutated) on every new SSE data event or mock-data interval tick (every 5 seconds in fallback mode), this callback gets a new function reference on every tick. Any component that lists `getDataAtTime` in a `useEffect` or `useMemo` dependency array — or passes it as a prop to a memoized child — will re-compute or re-render on every data update, even when `getDataAtTime` is never called. PROPOSAL: (a) Replace the linear scan in `useRealtimeAQI.ts:186-195` with a binary search over `history.map(s => s.timestamp.getTime())` — L/L effort (~8 lines); (b) memoize the sorted timestamp array separately so `getDataAtTime` does not need to capture the full `history` array in its closure — L/L effort (~5 additional lines; decouples `getDataAtTime` identity from data updates when callers don't depend on history content).

- OBSERVATION: `components/Dashboard.tsx:145-328` — the Dashboard component defines 7 `useMemo` hooks that each independently iterate the `historicalWeather` or `historicalAqi` arrays (`mergedHistoricalAqi:145`, `mergedHistoricalPm25:171`, `mergedHistoricalWeather:197`, `mergedHumidityData:225`, `mergedWindData:251`, `mergedUVData:277`, `mergedAgriculturalData:303`). Five of these — `mergedHistoricalWeather`, `mergedHumidityData`, `mergedWindData`, `mergedUVData`, `mergedAgriculturalData` — iterate the full `historicalWeather` array independently, each calling `new Date(Date.parse(record.month + " 1, 2012"))` per record to parse a month string. On any `selectedLocations`, `startDate`, or `endDate` state change, all 5 memos invalidate and run separate full scans producing 5 Maps from the same underlying array. Additionally, `Dashboard.tsx:20-23` duplicates `parseMonthString` identically from `useDashboardData.ts:4-7` — the same parse-then-discard-Date pattern appears in both files. PROPOSAL: Add a single `useMemo` in `Dashboard.tsx` that pre-indexes `historicalWeather` into a `Map<monthKey, Map<locationName, HistoricalWeatherRecord>>` keyed by the same `monthKey` used by all five consumer memos; replace the 5 independent full-array scans with O(1) map lookups inside their respective memos — M/M effort (~50 line refactor; reduces 5 O(n) passes to 1 O(n) indexing pass plus 5 O(1) lookups on each filter-change re-render).

**Proposed actions:**
- Replace per-row `for r in readings` loop in `persist.rs:6-34` with single bulk `INSERT ... UNNEST(...)` or `QueryBuilder::push_values` — M/M effort (6× fewer Postgres round-trips per broadcast tick)
- Change `station_name: String` and `county: String` in `aqi.rs` to `Arc<str>`; update construction in `aqi.rs`, `purpleair.rs` — M/M effort (eliminates heap allocations in hot broadcast clone path)
- Replace O(n) linear scan in `useRealtimeAQI.ts:186-195` with binary search over chronologically ordered history; decouple `getDataAtTime` identity from history reference — L/L effort (~13 lines total)
- Add a single pre-indexing `useMemo` for `historicalWeather` in `Dashboard.tsx`; replace 5 independent full-array scans with map lookups — M/M effort (~50 lines; eliminates 4 redundant O(n) passes per filter-change re-render)

## 📚 Archive (one line per past run)
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
