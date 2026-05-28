# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T10:07:14Z
Last run: #6 — Lens: TS ↔ Python contract

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Propagate `sessionId` through chat calls in `aiService.ts` | TS↔Py contract | H | L | 6 | Open |
| 2 | Batch DB writes in `persist.rs` with UNNEST | Perf | H | L | 4 | Open |
| 3 | Add `trainedAt` to `predict_aqi()` return dict (or remove from `PredictionResult` TS type) | TS↔Py contract | M | L | 6 | Open |
| 4 | Expose `category`, `color`, `source` from SSE `aqi-update` in `RealtimeCityData` | TS↔Py contract | M | L | 6 | Open |
| 5 | Align `windSpeed` type: `ForecastPeriod.windSpeed: string` vs `ForecastRecord.windSpeed: number` | TS↔Py contract | M | L | 6 | Open |
| 6 | Annotate AI service `response.json()` shapes | Type safety | M | L | 1 | Open |
| 7 | Use `asyncio.gather` in `build_live_context` | Perf | M | L | 4 | Open |
| 8 | Add Vitest coverage thresholds to `vite.config.ts` | Test coverage | M | L | 5 | Open |
| 9 | Add unit tests for `interpolation.ts`, `weatherUtils.ts`, `colorScales.ts` pure functions | Test coverage | M | L | 5 | Open |
| 10 | Upgrade Anthropic Python SDK from `0.49.*` to `>=0.50` | Dep health | M | L | 3 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #6 — 2026-05-28 — Lens: TS ↔ Python contract
**Scope:** `types.ts`, `services/dataService.ts`, `services/aiService.ts`, `hooks/useRealtimeAQI.ts`, `hooks/useLiveData.ts`; Python routes `chat.py`, `grounded_search.py`, `grounded_maps.py`, `historical_aqi.py`, `historical_weather.py`, `predictive_analysis.py`, `weather_forecast.py`, `nws_forecast.py`, `predict.py`, `inversion.py`; Rust structs `aqi.rs` (`AqiReading`), `routes/aqi.rs` (`SnapshotResponse`); Python `clients/nws_sounding.py` (`InversionStatus.to_dict`, `_wrap_status`); Python `ml/aqi_model.py` (`predict_aqi`).

**Findings:**

- OBSERVATION: `services/aiService.ts:getChatResponse` — the function posts `{ message }` with no `session_id` field. Python `geointellisense-analytics/app/routes/chat.py:ChatRequest` accepts `session_id: str | None` and returns `{ "text": text, "sessionId": session_id }`. TypeScript only reads `data.text` and discards `sessionId`. Because `session_id` is never sent in subsequent calls, the Python handler calls `create_session()` on every request (line: `session_id = req.session_id or create_session()`). The multi-turn session history that `append_to_session` / `get_session_history` manage is permanently lost between calls: every user message starts a fresh conversation with no prior context.

- OBSERVATION: `hooks/useLiveData.ts:PredictionResult` — TypeScript declares `trainedAt: string` as a required field (line ~83). Python `geointellisense-analytics/app/ml/aqi_model.py:predict_aqi` (lines ~return dict) does NOT include `trainedAt` in its return value — the dict contains `predictedAqi`, `confidenceInterval`, `category`, `horizon`, `modelR2`, `modelMAE`, `topFactors`, and `currentFeatures`. `trainedAt` is available in `get_model_status()` but is never forwarded by `/api/predict/aqi`. Any component that renders `result.trainedAt` receives `undefined` at runtime with no type error. Additionally, Python returns `currentFeatures: dict` (the raw feature vector used for prediction) which has no corresponding declaration in `PredictionResult`, so this diagnostic field is silently discarded.

- OBSERVATION: `hooks/useRealtimeAQI.ts` — the inline `aqi-update` event type (lines ~180-197) declares: `stationId`, `stationName`, `lat`, `lng`, `county`, `timestamp`, `aqi`, `pm25`, `pm10`, `o3`, `no2`, `so2`, `co`, `temperature`, `humidity`, `windSpeed`, `windDirection`. Rust `geointellisense-ingestion/src/aqi.rs:AqiReading` (`#[serde(rename_all = "camelCase")]`) also emits: `category` (e.g. "Moderate"), `color` (hex e.g. "#ffff00"), `source` ("mock" or "purpleair"), and optionally `rawSensorCount`. These four fields are absent from the TypeScript inline type. The mapping to `RealtimeCityData` (lines ~200-213) never reads them. The 3D view therefore cannot distinguish mock from live PurpleAir data, and discards the EPA-authoritative category/color in favour of recomputing them locally in `colorScales.ts`.

- OBSERVATION: `geointellisense-analytics/app/routes/historical_weather.py:historical_weather` — every record in the response includes `"totalPrecipitation": 0.0` unconditionally (line ~`"totalPrecipitation": 0.0,  # sensor_readings doesn't have precip; placeholder`). TypeScript `services/dataService.ts:HistoricalWeatherRecord.totalPrecipitation: number` gives no indication to callers that the value is always zero. Components consuming the live endpoint receive silent zeros for all precipitation data. The fallback in `DataService.getHistoricalWeatherFallback` generates random synthetic precipitation values using `Math.random()`, meaning the mock path inadvertently produces more realistic-looking data than the live path.

- OBSERVATION: `services/aiService.ts:getGroundedSearchResponse` / `getGroundedMapsResponse` — both functions read `data.groundingChunks` from the response (lines ~36, ~55). Python `geointellisense-analytics/app/routes/grounded_search.py` returns `{"text": text, "groundingChunks": []}` and `grounded_maps.py` identically returns `{"text": text, "groundingChunks": []}` — both routes hard-code an empty list. TypeScript `types.ts:GroundingChunk` defines a complex interface with `web.uri`, `web.title`, `maps.uri`, `maps.placeAnswerSources`, etc. This interface describes citations that can never be populated via the current Python backend.

- OBSERVATION: `hooks/useLiveData.ts:ForecastPeriod` / `services/dataService.ts:ForecastRecord` — two TypeScript types represent weather forecast periods but have conflicting types for the same field: `useLiveData.ts:ForecastPeriod.windSpeed: string` (line ~120) vs `dataService.ts:ForecastRecord.windSpeed: number` (line ~52). Python `geointellisense-analytics/app/routes/nws_forecast.py` returns `"windSpeed": p.get("windSpeed", "")` — the NWS API always returns a string like `"10 mph"`. `dataService.ts:getWeatherForecast` sets `windSpeed: 0` (hardcoded number) when building `ForecastRecord`. Any code reading `ForecastRecord.windSpeed` as a string will silently get `"0"` after coercion; any code reading `ForecastPeriod.windSpeed` as a number will get `NaN` on `parseFloat("10 mph")` without explicit parsing.

- OBSERVATION: `hooks/useLiveData.ts:InversionData` — TypeScript declares 9 fields: `inversionStrength`, `surfaceTempC`, `surfaceTempF`, `temp850mbC`, `tempDiffC`, `fogLikely`, `advisory`, `aqiImpact`, `time`. Python `_wrap_status` in `inversion.py` (line ~`def _wrap_status`) spreads `InversionStatus.to_dict()` which returns 13 fields; 6 are not declared in the TS type: `temp850mbF`, `surfaceDewpointC`, `windSpeedKts`, `mixingHeightM`, `source`, `soundingStation`. The `InversionWidget` cannot display these meteorologically significant fields without TS type updates.

**Proposed actions:**
- Store `sessionId` in React state in `ChatView.tsx`; send `session_id` in each `getChatResponse` call → Active Recommendation #1
- Add `trainedAt` to `predict_aqi()` return via `meta.get("trained_at")`, or update `PredictionResult` to mark it optional → Active Recommendation #3
- Add `category`, `color`, `source` to the `aqi-update` inline type in `useRealtimeAQI.ts` and map to `RealtimeCityData` → Active Recommendation #4
- Change `ForecastRecord.windSpeed` to `string` in `dataService.ts` and update callsites → Active Recommendation #5
- Widen `InversionData` to include all 13 Python-returned fields → not in top 10 (L/L, score 1.0)
- `totalPrecipitation` fix requires a DB schema change or external weather API integration — not in top 10 (H/H, score 1.0)
- `groundingChunks` population would require implementing citation extraction from tool call results — not in top 10 (M/H, score 0.67)

### Run #5 — 2026-05-28 — Lens: Test coverage gaps
**Scope:** All files under `components/`, `hooks/`, `utils/`, `services/`, `contexts/`; `App.test.tsx`; `tests/*.test.tsx`; `vite.config.ts`; `package.json`; all `.rs` files in `geointellisense-ingestion/src/`; all `.py` files in `geointellisense-analytics/`; `geointellisense-ingestion/Cargo.toml`; `geointellisense-analytics/requirements.txt`.

**Findings:**

- OBSERVATION: `vite.config.ts:36-40` — the `test` block configures `globals`, `environment`, `setupFiles`, and `css`, but has no `coverage` key. `@vitest/coverage-v8` is present in `package.json:devDependencies`, and `"test:coverage": "vitest --coverage"` exists as an npm script, but without a `coverage.thresholds` section, `vitest --coverage` always exits 0 regardless of how little code is exercised. Any CI step running `npm run test:coverage` passes even at 0 % branch/statement coverage.

- OBSERVATION: `geointellisense-analytics/` — the entire Python analytics service (30 route files, 10 client files, `ml/aqi_model.py`, `cache.py`, `http_client.py`, `middleware.py`, `context.py`) has **zero test files**. `pytest` does not appear in `requirements.txt`. There is no `conftest.py`, no `tests/` directory, and no `pyproject.toml` with a `[tool.pytest]` section. This means the FastAPI routes (`/api/chat`, `/api/low-latency`, `/api/predict`, all 30 others) ship with no automated validation. The `middleware.py` rate-limiter and the `ml/aqi_model.py` prediction pipeline are the highest-risk untested paths.

- OBSERVATION: `geointellisense-ingestion/src/` — all 15 Rust source files (`aqi.rs`, `broadcast.rs`, `config.rs`, `db/persist.rs`, `db/mod.rs`, `main.rs`, `purpleair.rs`, `redis_cache.rs`, `routes/admin.rs`, `routes/aqi.rs`, `routes/earthquakes.rs`, `routes/health.rs`, `routes/mod.rs`, `routes/sse.rs`, `usgs.rs`) contain **zero `#[test]` functions** and zero `#[cfg(test)]` modules. `Cargo.toml` has no `[dev-dependencies]` section. The `aqi.rs` AQI calculation logic and the `persist.rs` database write path (already flagged in Run #4 for correctness issues) are both completely untested.

- OBSERVATION: `utils/interpolation.ts`, `utils/weatherUtils.ts`, `utils/colorScales.ts` — these three files contain exclusively **pure, side-effect-free functions** (`interpolateIDW`, `generateInterpolatedMatrix`, `calculateFeelsLike`, `calculateET0`, `calculateSunTimes`, `getAQIColor`, `getAQICategory`) with no network calls, DOM access, or React state — yet none appears in any test file. `interpolation.ts` is 441 lines with non-trivial spatial algorithms; a boundary case bug (e.g. zero data points passed to `interpolateIDW`) silently returns `{ value: 0, confidence: 0 }` and would corrupt the terrain map without any test catching it. `weatherUtils.ts` implements the NOAA Heat Index formula and ET₀ (Penman-Monteith) — physical equations that are independently verifiable but currently unverified.

- OBSERVATION: `hooks/useRealtimeAQI.ts` — contains SSE connection management, exponential-backoff reconnection (`reconnectInterval`, `maxReconnectAttempts`), history ring-buffer caching (`maxHistorySize`), and a mock-data fallback path (`fallbackToMock`). None of these behaviours appear in any test. The hook is a central reliability contract: if reconnection logic is broken, the live 3D view silently stalls. The mock fallback path (used in development and possibly in CI) is also untested.

- OBSERVATION: `hooks/useDashboardData.ts`, `hooks/useLiveData.ts`, `hooks/useNormalizedData.ts`, `hooks/useViewport.ts` — all four hooks have **zero test coverage**. `useLiveData.ts` classifies HTTP status codes into `ErrorKind` enum values (`'network'`, `'disabled'`, `'client'`, `'server'`) and drives the polling loop; incorrect classification would surface as wrong UI error states. `useDashboardData.ts` was identified in Run #4 as containing performance-critical transformation logic that is now also known to be untested.

- OBSERVATION: `services/AirQualityService.ts`, `services/WeatherService.ts`, `services/dataService.ts`, `services/aiService.ts` — the entire service layer has **zero test coverage**. `AirQualityService` implements a singleton with a 4-second TTL cache (`CACHE_TTL_MS = 4000`) that deduplicates `fetch` calls; the cache-miss vs. cache-hit branching is untested. `dataService.ts` defines all the TypeScript interfaces consumed by hooks and components but its fetch paths are never exercised in tests.

- OBSERVATION: `App.test.tsx` — the only top-level test file contains **three smoke assertions** (container `.flex.h-screen` exists, `<main>` exists, `<main>` has the expected CSS classes). There are no tests for view routing, sidebar navigation, error boundary activation, or any feature flag. The file satisfies "we have App tests" but provides effectively no regression safety.

**Proposed actions:**
- Add `coverage.thresholds` block to `vite.config.ts` `test` section (e.g. `lines: 60, branches: 50`) → Active Recommendation #8
- Add pure-function unit tests for `utils/interpolation.ts`, `utils/weatherUtils.ts`, `utils/colorScales.ts` → Active Recommendation #9
- Add `pytest`, `httpx[test]`, and `pytest-asyncio` to `requirements.txt`; create `geointellisense-analytics/tests/` with smoke tests for `/health`, `/api/chat`, and middleware — not in top 10 (H/H, score 1.0)
- Add `#[cfg(test)]` modules to `geointellisense-ingestion/src/aqi.rs` and `persist.rs`; add `tokio-test` to `[dev-dependencies]` — not in top 10 (M/M, score 1.0)
- Add `renderHook` tests for `useRealtimeAQI` reconnection and mock fallback — not in top 10 (M/M, score 1.0)
- Add `renderHook` tests for `useLiveData` error-kind classification — not in top 10 (M/M, score 1.0)

### Run #4 — 2026-05-28 — Lens: Perf hot paths
**Scope:** `geointellisense-ingestion/src/db/persist.rs`, `src/broadcast.rs`, `src/purpleair.rs`; `components/3d/AQI3DScene.tsx`, `CityMarkers.tsx`, `TerrainMesh.tsx`, `WindField.tsx`; `utils/interpolation.ts`; `hooks/useDashboardData.ts`, `hooks/useRealtimeAQI.ts`; `geointellisense-analytics/app/context.py`.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:5-36` — `write_readings` executes one `sqlx::query(...).execute(pool).await` per reading inside a sequential `for` loop. With the default seeded station count (~20), every broadcast tick creates 20 individual TCP round-trips to PostgreSQL. The standard PostgreSQL pattern for bulk inserts is a single `INSERT … SELECT UNNEST($1::uuid[], $2::real[], …)` which reduces N round-trips to 1. Because `sensor_readings` is a TimescaleDB hypertable (seen in `db/migrations/002_sensor_readings.sql`), row-level locking overhead compounds the cost.

- OBSERVATION: `components/3d/AQI3DScene.tsx:70` — `CameraController.useFrame` allocates `const target = new THREE.Vector3()` on every animation frame when the `onCameraMove` prop is set. At 60 fps this creates ~3,600 short-lived heap objects per minute. The fix is a `useRef<THREE.Vector3>` initialized once and reused via `.set()` calls inside the frame callback — a standard React Three Fiber GC-pressure pattern.

- OBSERVATION: `components/3d/WindField.tsx` — (a) `WindParticleSystem`'s initialization `useMemo` performs a brute-force O(P×W) nearest-wind-point search: for each of `count` (default 500) particles it scans all `windData` entries with `Math.sqrt` + comparison (lines ~147-165). Acceptable with 6 cities today; degrades linearly if station count grows. (b) Every `Streamline` component renders `<primitive object={new THREE.Line(geometry, material)} />` where a brand-new `THREE.Line` is constructed in JSX on each React render. React reconciliation creates a new THREE object every time the parent `streamlines` useMemo recomputes, and the old `THREE.Line`'s GPU buffers are never disposed, leaking WebGL geometry memory. The fix is to create the Line inside a `useMemo` or `useRef` and call `geometry.dispose() / material.dispose()` in a `useEffect` cleanup.

- OBSERVATION: `utils/interpolation.ts:generateInterpolatedMatrix` — called from `TerrainMesh.tsx`'s `useMemo` with default `textureResolution=128`. For each of 128×128 = 16,384 grid cells, `interpolateIDW` is invoked, which calls `.map()`, `.filter()`, `.sort()` on the `dataPoints` array. This O(W·H·N·log N) computation runs synchronously on the JS main thread and blocks React rendering on every AQI data update. Moving this to a `Worker` (via Comlink) or caching the result keyed by `aqiData` identity would eliminate render jank.

- OBSERVATION: `components/3d/CityMarkers.tsx` — each city is rendered as an individual `<group>` with 4 separate geometries (circleGeometry, cylinderGeometry, 2× sphereGeometry), producing 4×N WebGL draw calls per frame. Each `CityMarker` registers its own `useFrame` for the pulsing glow animation, so N cities = N `useFrame` callbacks every frame. Migrating to `InstancedMesh` with per-instance color attributes would collapse N×4 draw calls to 2 and a single parent `useFrame` could drive all animations.

- OBSERVATION: `hooks/useDashboardData.ts` — `mergedHumidityData`, `mergedWindData`, `mergedUVData`, and `mergedAgriculturalData` each call `dayDate.toLocaleDateString('en-US', { month: 'short' })` inside `dailyForecast.forEach` loops (~lines 155-355). `toLocaleDateString` invokes the V8 ICU locale subsystem on every call. With a 365-day forecast, 4 memos, and 1+ selected locations, a full recompute performs ~1,460 locale API calls per `startDate`/`endDate` change. A 12-element `['Jan','Feb',…]` lookup array is orders of magnitude faster.

- OBSERVATION: `geointellisense-analytics/app/context.py:67-75` — `build_live_context` awaits all 8 data-source fetchers sequentially (`context["aqi"] = await _get_aqi_context(pool)` … `context["prediction"] = await _get_prediction_context(pool)`). Total latency equals the sum of all 8 query times. Wrapping in `asyncio.gather` would run them concurrently against the asyncpg pool, reducing latency to roughly `max(query_times)`. `build_live_context` is called on every AI endpoint that uses `get_system_with_live_context`, including the high-frequency `/api/low-latency` route.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:80-84` — the broadcast ticker overwrites all `AqiReading` timestamps with `Utc::now()` at broadcast time: `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() })`. If the PurpleAir poller and broadcast ticker run at different intervals, readings stored in `sensor_readings.time` carry the broadcast timestamp rather than the actual sensor observation time. Downstream time-series aggregations in `historical_aqi.py` silently bucket readings at the wrong minute.

**Proposed actions:**
- Replace `write_readings` loop with a single UNNEST batch INSERT → Active Recommendation #2
- Add `useRef<THREE.Vector3>` in `CameraController` to reuse across frames → dropped from top 10
- Fix `Streamline` to create `THREE.Line` in `useMemo`/`useRef` and dispose on unmount → dropped from top 10
- Replace `toLocaleDateString` calls with a static `MONTH_NAMES` array in `useDashboardData` → dropped from top 10
- Wrap `build_live_context` data fetchers in `asyncio.gather` → Active Recommendation #7
- Migrate `generateInterpolatedMatrix` to a Web Worker — not in top 10 (H/M, score 1.5)
- Migrate `CityMarkers` to `InstancedMesh` — not in top 10 (H/H, score 1.0)
- Preserve original `fetched_at` timestamp in `AqiReading`; use in `persist.rs` — not in top 10 (M/M, score 1.0)

## 📚 Archive (one line per past run)
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
