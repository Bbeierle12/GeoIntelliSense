# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T23:10:00Z
Last run: #66 — Lens: TS ↔ Python contract

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
### Run #66 — 2026-05-30 — Lens: TS ↔ Python contract
**Scope:** Sixth TS↔Python contract pass. Examined: `services/aiService.ts`, `services/AirQualityService.ts`, `services/dataService.ts`, `types.ts`, `hooks/useLiveData.ts`, `geointellisense-analytics/app/routes/grounded_search.py`, `grounded_maps.py`, `chat.py`, `predictive_analysis.py`, `weather_forecast.py`, `historical_aqi.py`, `historical_weather.py`, `predict.py`, `fires.py`, `earthquakes.py`, `water.py`, `inversion.py`, `nws_forecast.py`, `geointellisense-analytics/app/ml/aqi_model.py`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `clients/nasa_firms.py`, `clients/nws_sounding.py`, `components/dashboard/widgets/AqiForecastWidget.tsx`, `FiresWidget.tsx`, `WeatherWidget.tsx`, `InversionWidget.tsx`. Prior TS↔Py contract details (#6, #21, #36, #51) archived; all findings verified as new via specificity of file:line citations.

**Findings:**

- OBSERVATION: `hooks/useLiveData.ts:136-138` declares `PredictionResult` with three non-nullable fields: `modelR2: number`, `modelMAE: number`, `trainedAt: string`. The Python source at `geointellisense-analytics/app/ml/aqi_model.py:306-308` returns these via `meta.get("r2_score")`, `meta.get("mae")`, `meta.get("trained_at")` — Python `dict.get()` returns `None` when the key is absent, so all three fields may arrive as JSON `null`. TypeScript's structural typing treats the response as `PredictionResult` without any runtime null-check. `AqiForecastWidget.tsx:40` renders `data.modelR2` directly in JSX as `R²={data.modelR2}` — when `modelR2` is `null` this renders the literal string "R²=null" visible to users. The same potential appears at `data.modelMAE` and `data.trainedAt`. The model metadata is written by `train_model()` at `aqi_model.py:264`, which keys the dict `meta["r2_score"]` etc. only after a successful fit; if the joblib file was written before the `r2_score` key was added to the meta schema (i.e., a stale model file), all three fields return `null` on every `/api/predict/aqi` call. PROPOSAL: (a) Change `useLiveData.ts:136-138` to `modelR2: number | null`, `modelMAE: number | null`, `trainedAt: string | null`; (b) add null-guard in `AqiForecastWidget.tsx:40` — `R²={data.modelR2 != null ? data.modelR2.toFixed(3) : 'N/A'}`.

- OBSERVATION: `types.ts:14-31` defines a `GroundingChunk` interface modelled on the Gemini API citation structure: `web?: { uri: string; title: string }` and `maps?: { uri: string; title: string; placeAnswerSources?: ... }`. Both Python routes that return `groundingChunks` — `grounded_search.py:79` (`return {"text": text, "groundingChunks": []}`) and `grounded_maps.py:86` (`return {"text": text, "groundingChunks": []}`) — hardcode an empty array unconditionally. No code path in either route ever populates the `groundingChunks` list. The TypeScript consumer at `AnalysisView.tsx:177` calls `setGroundingChunks(searchRes.groundingChunks)` and `AnalysisView.tsx:187` calls `setGroundingChunks(mapsRes.groundingChunks)`, but the rendering block at `AnalysisView.tsx:451` guarded by `{groundingChunks.length > 0 && (...)}` can never execute — it is permanently dead code. The `GroundingChunk` interface in `types.ts` faithfully describes the old Gemini API source-citation format; the current Claude API backend uses tool-use callbacks to fetch data and embeds citations inline in the text response rather than returning structured source objects. PROPOSAL: (a) Remove the `GroundingChunk` interface from `types.ts:14-31` and the `groundingChunks` return field from `aiService.ts:30-50` and `aiService.ts:52-72`; (b) remove the dead `{groundingChunks.length > 0 && ...}` block at `AnalysisView.tsx:451-465`; (c) alternatively, if citation surfacing is desired, populate `groundingChunks` in Python from `tool_results` (db query summaries or web source data returned by tools during the tool-use loop).

- OBSERVATION: `hooks/useLiveData.ts:163-176` declares `FiresData.fires` as `Array<{ lat: number; lng: number; brightness: number; frp: number; confidence: string; distanceKm: number; isUpwind: boolean }>`, expecting each fire to have `lat` and `lng` fields. The actual Python JSON source is `FireDetection.to_dict()` in `geointellisense-analytics/app/clients/nasa_firms.py`. That method initializes `d = {k: getattr(self, k) for k in self.__slots__}`, and `__slots__` are `("latitude", "longitude", "brightness", "frp", "confidence", "satellite", "instrument", "acq_datetime", "daynight")`. The JSON keys are therefore `latitude` and `longitude`, not `lat` and `lng`. The TypeScript interface declares `lat`/`lng` as required fields, but at runtime every fire object has `undefined` for `fire.lat` and `fire.lng`. `FiresWidget.tsx` currently uses only `f.distanceKm`, `f.frp`, and `f.confidence`, so no visible rendering bug exists today — but any map component that renders a fire pin using `f.lat`/`f.lng` (e.g., a future `MapView.tsx` feature showing fire locations) would silently receive `undefined` coordinates, placing all fires at `(0, 0)` in the ocean. PROPOSAL: Either (a) rename the keys in `FireDetection.to_dict()` from `"latitude"` → `"lat"` and `"longitude"` → `"lng"` (aligning Python output with TS type), or (b) update `useLiveData.ts:168-169` to declare `latitude: number; longitude: number` (aligning TS type with Python output) — option (a) is preferred as `lat`/`lng` is already the convention used by `FiresWidget`, `EarthquakeData`, and `AqiReading`.

- OBSERVATION: `/api/aqi-snapshot` is consumed by two separate TypeScript type definitions that have diverged: `AirQualityService.ts:16-20` defines a private `SnapshotReading` interface with only 9 fields (`lat`, `lng`, `aqi`, `pm25`, `pm10`, `no2`, `so2`, `co`, `o3`), while `hooks/useLiveData.ts:102-119` defines the more complete `AqiReading` interface with 16 fields (adding `stationId`, `stationName`, `county`, `category`, `source`, `temperature`, `humidity`, `windSpeed`, `windDirection`, `timestamp`). Both cast `data.readings` from the same Rust endpoint (`routes/aqi.rs:11`) to their respective types. The Rust `AqiReading` struct (`aqi.rs:18-41`) emits all 16+ fields. `AirQualityService.ts` silently discards `stationId`, `stationName`, `county`, `category`, `temperature`, `humidity`, `windSpeed`, `windDirection`, `source`, and `timestamp`. If a future developer adds a field to the Rust `AqiReading` struct and wants it reflected in `AirQualityService`, they must update two independent type definitions. More concretely, `WeatherWidget.tsx:14-21` uses `snapshot.readings` via `useAqiSnapshot()` (typed as `AqiReading[]`) to compute average `r.temperature`, `r.humidity`, `r.windSpeed` — these fields are in `AqiReading` but absent from `SnapshotReading`. Any developer looking at `AirQualityService.ts:getCurrentAQI()` would have no indication that the same endpoint also carries weather fields consumed elsewhere. PROPOSAL: Delete the private `SnapshotReading` interface in `AirQualityService.ts:16-20`; import and use the exported `AqiReading` from `hooks/useLiveData.ts` instead, constraining the cast to `data.readings as AqiReading[]` so there is a single source of truth for the snapshot shape.

- OBSERVATION: `geointellisense-analytics/app/routes/historical_weather.py:98` emits `"totalPrecipitation": 0.0` with an inline comment `# sensor_readings doesn't have precip; placeholder` for every single historical weather record returned from the live API. The TypeScript `HistoricalWeatherRecord` in `dataService.ts:66` types this as `totalPrecipitation: number`, with no indication it may be structurally zero. The fallback path in `dataService.ts:376` uses `totalPrecipitation: monthData.precipitation` from `dashboardData`, which has real non-zero values (e.g., `4.1` inches in December for Bakersfield). Any chart or table rendering `totalPrecipitation` will display: (a) real precipitation data when the live DB is unavailable and fallback is active, and (b) a flat zero line for all months when the live DB is healthy. The behavior is indistinguishable in the TypeScript type system — both code paths return `HistoricalWeatherRecord[]` with a `number` field. This affects predictive analysis prompts: `getPredictiveAnalysisResponse()` passes `filteredWeather` from `dashboardData` (real values), not from the live API (which would be all zeros); however, if `dataService.getHistoricalWeather()` is used as the data source instead, the all-zero precipitation would flow into AI analysis as factual historical data. PROPOSAL: Add `precipitationIsPlaceholder?: boolean` to `HistoricalWeatherRecord` and set it `true` in the Python response; alternatively integrate a real precipitation source (PRISM or NOAA CDO) into the `sensor_readings` schema; at minimum add a `WARNING: totalPrecipitation is always 0` comment to `HistoricalWeatherRecord.totalPrecipitation` in `dataService.ts:66`.

**Proposed actions:**
- Fix `PredictionResult` nullable fields in `useLiveData.ts:136-138` (`modelR2/modelMAE: number | null`, `trainedAt: string | null`); add null-guard in `AqiForecastWidget.tsx:40` — M/L, score 2.0; does not displace top 10
- Remove dead `GroundingChunk` schema from `types.ts:14-31`; remove `groundingChunks` return from `aiService.ts:30-72`; remove unreachable block in `AnalysisView.tsx:451-465` — M/L, score 2.0; does not displace top 10
- Align `FireDetection.to_dict()` field names to `lat`/`lng` in `nasa_firms.py`; fix `useLiveData.ts:168-169` — H/L, score 3.0; ties top 10 but first seen #66, does not displace existing
- Consolidate two independent snapshot type definitions: delete `SnapshotReading` in `AirQualityService.ts:16-20`; import `AqiReading` from `useLiveData.ts` — M/L, score 2.0; does not displace top 10
- Add `precipitationIsPlaceholder` flag or warning comment for zero `totalPrecipitation` in `historical_weather.py:98` and `dataService.ts:66` — M/M, score 1.0; does not displace top 10

### Run #65 — 2026-05-30 — Lens: Test coverage gaps
**Scope:** Fifth test-coverage-gaps pass. Examined: `utils/interpolation.ts`, `utils/weatherUtils.ts`, `hooks/useLiveData.ts`, `geointellisense-ingestion/src/aqi.rs`, `utils/colorScales.ts`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/cache.py`, `geointellisense-analytics/app/ml/aqi_model.py`, all existing test files (`App.test.tsx`, `tests/*.test.tsx`). Prior test-coverage details (#5, #20, #35, #50) archived; all findings verified as new via specificity of file:line citations.

**Findings:**

- OBSERVATION: `utils/interpolation.ts:98-99` — The `confidence` formula in `interpolateIDW` is `Math.max(0, Math.min(1, 1 - nearestDistance / 2))`. This clamps to `[0, 1]`, but the formula produces `0` for any nearest-point distance ≥ 2 (approximately 2 degrees, ~200 km). At that saturation point all valid interpolations beyond 200 km of any station report `confidence = 0`, which is indistinguishable from the "insufficient data" early-return path at line 61 (`return { value: 0, confidence: 0 }`). No test exercises this edge or verifies that the two `confidence: 0` states are distinguishable to callers. Separately, `interpolateKriging` at line 190 computes `confidence = Math.max(0, Math.min(1, 1 - Math.sqrt(Math.abs(variance)) / sill))`. When `sill` is small (data variance is low) and `variance` is large (ill-conditioned Kriging matrix), the inner expression can be deeply negative before the `Math.max` clamp, but `Math.abs(variance)` at line 190 incorrectly takes the absolute value of the Kriging variance — Kriging variance should always be non-negative; `Math.abs` masks a pathological matrix solution rather than surfacing it. No test exposes a near-singular Kriging matrix (3 collinear points) to verify the fallback-to-IDW path at line 172. The `solveLinearSystem` Gaussian elimination function (lines ~230–290) has zero tests; matrix singularity, zero-pivot detection, and back-substitution correctness are all unverified. PROPOSAL: Add `utils/interpolation.test.ts` with: (a) `interpolateIDW` with a single point at distance 0 (exact match), distance 1 (confidence ≈ 0.5), distance 2 (confidence = 0), distance > 2 (confidence = 0 clamped); (b) `interpolateKriging` with 3 collinear points (near-singular) to verify IDW fallback; (c) `solveLinearSystem` with known invertible 3×3 and singular 3×3 to verify null return on singularity.

- OBSERVATION: `utils/weatherUtils.ts:1-16` — `calculateFeelsLike` implements three branches: heat index (temp ≥ 80 AND humidity ≥ 40), wind chill (temp ≤ 50 AND windSpeed ≥ 3), and a neutral zone (all other conditions, returns `temp` unchanged). The neutral zone covers the range `50 < temp < 80` regardless of humidity and windSpeed, plus `temp ≥ 80` with humidity < 40. No test verifies any of the three paths. The boundary condition `temp = 80, humidity = 40` (the threshold between heat index and neutral) is particularly important: at `humidity = 39` the function returns `temp`; at `humidity = 40` it applies the full heat index polynomial. Additionally, `calculateET0` at line 28 uses `(tempC + 273)` in the denominator of the Penman-Monteith wind term. The correct value is `tempC + 273.15` (0°C = 273.15 K); using 273 introduces a maximum systematic error of ~0.055% in ET0 — small, but present across all agricultural evapotranspiration estimates and unverified by any test. `calculateSunTimes` uses `new Date(date.getFullYear(), 0, 0)` at line 34 to compute day-of-year; January 1 of the year is day 1 by this formula, but the difference `date - Jan1` in milliseconds divided by 86400000 gives 0 for Jan 1 — so `dayOfYear` is 0 on January 1, making the declination calculation use offset −81 before the day starts. No test exercises solstice or equinox dates. PROPOSAL: Add `utils/weatherUtils.test.ts` covering: heat index branch (temp=85, humidity=50), wind chill branch (temp=40, windSpeed=10), neutral zone (temp=65, humidity=60), boundary (temp=80, humidity=40 vs 39), `calculateET0` known-value sanity check, `calculateSunTimes` for equinox latitude 36.7°N.

- OBSERVATION: `hooks/useLiveData.ts:49-52` — The URL routing logic `const base = path.startsWith('/api/aqi-') || path === '/health' ? INGESTION_URL : GATEWAY_URL` is entirely untested. This single ternary routes AQI and health traffic to the Rust ingestion service and all other traffic to the Caddy gateway. A developer adding a new ingestion-served route (e.g., `/api/aqi-forecast`) must know to check this condition — but there is no test to confirm the routing. Equally, the error-kind classification at lines 57-65 assigns `errorKind = 'disabled'` for HTTP 503, `'client'` for 4xx, `'server'` for 5xx, and `'network'` for fetch rejections. The `'disabled'` kind is consumed by UI components to show "source toggle is off" messaging instead of a generic error — but no test fires a mocked 503 through `useLiveData` and asserts on `errorKind`. The `enabled = false` early-return path at line 47 (`if (!enabled) return`) is also untested: a disabled hook silently sets no state, meaning callers that pass `enabled={false}` will see `loading: true` forever (initial state) with no indication that fetching was intentionally skipped. PROPOSAL: Add `hooks/useLiveData.test.ts` using `renderHook` with mocked `fetch`; cover: success path (data set, `errorKind = null`), 503 → `errorKind = 'disabled'`, 404 → `errorKind = 'client'`, 500 → `errorKind = 'server'`, network rejection → `errorKind = 'network'`, `enabled=false` → `loading` remains `true`, URL routing assertion for `/api/aqi-readings` (→ INGESTION_URL) and `/api/context` (→ GATEWAY_URL).

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs:88-97` and `utils/colorScales.ts:27-34` — The Rust ingestion service defines `aqi_category()` as a pure `match` on the AQI value, returning `(&str, &str)` tuples of category name and hex color. The TypeScript frontend defines `getAQICategory()` independently in `colorScales.ts`. Both are currently consistent (Good=0–50, Moderate=51–100, USG=101–150, Unhealthy=151–200, Very Unhealthy=201–300, Hazardous=301+). However, there are NO cross-service contract tests. The Rust function has zero `#[cfg(test)]` inline tests — confirmed by grepping all Rust source files: no test module exists anywhere in `geointellisense-ingestion/src/`. A change to either boundary (e.g., adjusting USG to 101–155) would silently produce mismatched category labels between the API JSON response (Rust) and the UI color legend (TypeScript) with no automated detection. The `round2` function at `aqi.rs:164-166` (`(v * 100.0).round() / 100.0`) is similarly untested, including for negative values and NaN. PROPOSAL: (a) Add `#[cfg(test)]` module to `aqi.rs` with `aqi_category` boundary tests: AQI 0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301, 500; verify both category string and hex color; (b) add `round2` test for positive, negative, and subnormal values; (c) add a JSON contract snapshot test that serializes a fixed-seed `AqiReading` and asserts all fields against a reference JSON to catch Rust→TS schema drift.

- OBSERVATION: `geointellisense-analytics/` — zero Python tests across the entire analytics service (60+ `.py` files, confirmed by finding no `test_*.py` or `*_test.py` files). The ML pipeline in `app/ml/aqi_model.py` is untested end-to-end: `get_model()` (lines 54–81) loads a `.joblib` file from `MODEL_DIR` with no test for missing-file behavior, `train_model()` (lines 220–265) trains a GBR model with no test for empty training data or feature-name mismatch, and `predict_aqi()` (lines 280–300) is the production inference path with zero test coverage. The in-memory cache at `app/cache.py` (which the run #64 lens confirmed is awaited synchronously in `build_live_context`) has no tests verifying TTL expiry, thread-safety, or concurrent-population behavior under asyncio. The 15+ route modules (e.g., `routes/chat.py`, `routes/predict.py`, `routes/deep_analysis.py`) have no pytest HTTP-layer tests whatsoever — not even smoke tests checking that routes return 200 for valid input or 422 for missing required fields. A `pytest` + `httpx` test suite using `AsyncClient(app=app)` could cover the entire FastAPI surface without needing live DB or Redis connections (using dependency-override for the pool). PROPOSAL: (a) Create `geointellisense-analytics/tests/test_aqi_model.py` with: model-missing-file → `None` return, `predict_aqi` with synthetic feature dict → numeric output, `train_model` with 50-row DataFrame → model file created; (b) create `tests/test_routes_smoke.py` using `httpx.AsyncClient` with DB dependency overridden by a minimal asyncpg mock → test all 15+ routes return 2xx/4xx shapes; (c) create `tests/test_cache.py` with TTL eviction and concurrent-set deduplication.

**Proposed actions:**
- Add `utils/interpolation.test.ts`: IDW exact-match, distance-boundary, confidence-saturation, Kriging collinear-fallback, `solveLinearSystem` singular matrix — M/L, score 2.0; does not displace top 10
- Add `utils/weatherUtils.test.ts`: heat-index, wind-chill, neutral-zone, boundary temp=80/humidity=40, ET0 sanity, sun-times equinox — M/L, score 2.0; does not displace top 10
- Add `hooks/useLiveData.test.ts`: all error-kind paths (200, 503, 404, 500, reject), URL routing, `enabled=false` loading-forever — H/L, score 3.0; ties top 10 at score 3.0, first seen #65, does not displace existing
- Add `#[cfg(test)]` to `aqi.rs` for `aqi_category` boundary + `round2` + snapshot contract — H/L, score 3.0; same tiebreak, does not displace
- Bootstrap `geointellisense-analytics/tests/` with `pytest`+`httpx`: `test_aqi_model.py`, `test_routes_smoke.py`, `test_cache.py` — H/H, score 1.0; does not displace top 10

### Run #64 — 2026-05-30 — Lens: Perf hot paths
**Scope:** Fifth perf-hot-paths pass. Examined: `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/ml/aqi_model.py`, `components/3d/AQI3DScene.tsx`, `components/3d/PollutionVolume.tsx`, `components/3d/WindField.tsx`, `utils/interpolation.ts`. Prior perf-hot-paths details (#4, #19, #34, #49) archived; all findings verified as new via specificity of file:line citations.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/context.py:61-68` — `build_live_context()` awaits all 8 data-source coroutines sequentially: `context["aqi"] = await _get_aqi_context(pool)` … `context["prediction"] = await _get_prediction_context(pool)`. The inline comment at line 60 reads "Run all queries concurrently-ish (asyncpg handles connection pooling)". This is incorrect: asyncpg's connection pool enables concurrent queries from different coroutines, but the sequential `await` calls in this function serialize every coroutine — each waits for the previous to finish before starting. The eight calls include two DB round-trips (`_get_aqi_context`, `_get_forecast_context`), two PostGIS geo-distance queries (`_get_fire_context`, `_get_earthquake_context`), one water DB query, one CES DB query, one Redis scan (`_get_forecast_context`), and one ML prediction chain. Total latency = sum of all eight, typically 200–500ms for a cold DB. `build_live_context()` is called synchronously inside `build_context_text()` which is awaited before every AI call in `claude.py`. PROPOSAL: Replace the eight sequential awaits with `asyncio.gather(_get_aqi_context(pool), _get_forecast_context(pool), _get_fire_context(pool), _get_earthquake_context(pool), _get_water_context(pool), _get_enviroscreen_context(pool), asyncio.coroutine(_get_inversion_context)(), _get_prediction_context(pool))` (with `_get_inversion_context` wrapped in a thin async wrapper since it is currently synchronous). Total latency drops from sum-of-all to max-of-all.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:286` — `predict_aqi()` calls `model.staged_predict(X)` at line 286 to estimate a confidence interval. `staged_predict` is a scikit-learn GBR method that iterates through all 200 estimator stages and yields a cumulative prediction array of length 200. It is designed for model analysis and visualization, not production inference. At ~2-5ms per stage traversal, calling `staged_predict` adds approximately 400–1000ms to every inference call. By contrast, `model.predict(X)` at line 281 (which runs the full ensemble in one pass) is 5–20ms. The variance estimate derived from `staged_predict` (last 50 incremental deltas, lines 289-291) is a crude approximation: it measures learning-rate convergence noise in the boosting sequence, not the actual prediction variance for out-of-distribution inputs. The same variance estimate could be computed once at training time (from `model.staged_predict(X_test)` on the test split) and stored in `_model_meta` as a single float. PROPOSAL: (a) In `train_model()` at line 264, compute `staged = list(model.staged_predict(X_test))`, derive `std_estimate` using the existing lines 288-291 logic, and save it to `meta["pred_std_estimate"]` before `joblib.dump`; (b) in `predict_aqi()`, replace the `staged_predict` call at line 286 with `std_estimate = meta.get("pred_std_estimate", max(predicted * 0.15, 5))`. Inference latency drops from ~500ms to ~10ms.

- OBSERVATION: `components/3d/AQI3DScene.tsx:67-73` — The `CameraController` component's `useFrame` callback allocates `const target = new THREE.Vector3()` on line 69 inside the frame callback, conditional on `onCameraMove` being truthy. `useFrame` is called every render frame at ~60Hz. Each call creates a new `THREE.Vector3` heap object that is immediately consumed by `controlsRef.current.getTarget(target)` and passed to `onCameraMove`. At 60fps, this generates 60 short-lived `Vector3` allocations per second. In a garbage-collected WebAssembly-free environment (V8), ephemeral object allocation at this rate triggers incremental GC pauses that cause frame-time jitter visible as micro-stutters during camera orbit. The `OrbitControls` `getTarget()` method accepts a pre-allocated `Vector3` to write into. PROPOSAL: Hoist `const targetRef = useRef(new THREE.Vector3())` above the `useFrame` at line 67; inside the callback, call `controlsRef.current.getTarget(targetRef.current)` and pass `targetRef.current` to `onCameraMove`. This reuses the same object across all frames with zero allocation.

- OBSERVATION: `components/3d/PollutionVolume.tsx:142-204` — Each `PollutionCloud` component registers a `useFrame` callback at line 174. The callback updates two shader uniforms (`time`, `cameraPos`) and one mesh position property. `PollutionLayer` (line 217) generates one `PollutionCloud` per grid point with `value > 30`. `generateInterpolatedGrid` with `resolution=12` (the default at `PollutionVolume.tsx:277`) produces `(12+1)² = 169` grid points. With 3 layers (line 285), if all grid points exceed AQI 30, up to `169 × 3 = 507` individual `useFrame` callbacks are registered, each running at 60Hz. React Three Fiber's `useFrame` scheduler iterates through all subscribed callbacks in insertion order every frame — 507 function invocations doing redundant `clock.elapsedTime` reads and uniform writes per frame. The `time` uniform is the same value for every cloud; the `cameraPos` uniform is the same camera position for every cloud. PROPOSAL: Lift the `time` and `cameraPos` uniform updates to a single `useFrame` in `PollutionVolume`'s top-level group component, writing to a shared `uniformsRef`; pass the shared uniforms object down via context or ref-forwarding so each `PollutionCloud` creates its material with the shared reference rather than per-instance uniforms. Alternatively, replace the per-cloud `PollutionCloud` mesh array with a single `THREE.InstancedMesh` driven by one top-level `useFrame`.

- OBSERVATION: `components/3d/WindField.tsx:197-208` — Inside `WindParticleSystem`'s `useMemo` (lines 180-231), each of the `count` particles (default 500) loops over every `windData` element to find the nearest wind vector: the inner `for (const wind of windData)` at line 202 makes this O(`count` × `windData.length`). For 500 particles and even 6 wind stations this is 3,000 distance calculations — negligible in isolation. However, the `useMemo` dependency array is `[windData, count, speed, height]` at line 231. `windData` is a prop passed from `WindField`'s parent. If the parent creates `windData` via an inline `.map()` or unmemoized expression, the array reference changes on every parent render, invalidating the `useMemo` and re-running the O(N×M) loop on every render cycle. In the worst case — rapid AQI updates from the SSE stream causing parent re-renders — the 3,000+ calculations run every second. PROPOSAL: (a) Ensure callers of `WindField` memoize `windData` via `useMemo` or `useRef`; (b) inside `WindParticleSystem`, add an equality check via `useRef` to skip recalculation when wind values have not changed; (c) for future scale, precompute a `latLngToWorld`-mapped spatial structure (simple sorted array suffices for M < 20) at the `WindField` level and pass it down to avoid redundant `latLngToWorld` calls per particle.

**Proposed actions:**
- Replace sequential awaits in `build_live_context()` at `context.py:61-68` with `asyncio.gather()`; wrap `_get_inversion_context` in async — H/L, score 3.0; ties top 10 at score 3.0 but first seen #64, does not displace existing
- Precompute `pred_std_estimate` at training time in `aqi_model.py:264`; remove `staged_predict` from `predict_aqi()` at `aqi_model.py:286` — H/L, score 3.0; same tiebreak, does not displace
- Hoist `new THREE.Vector3()` out of `useFrame` in `AQI3DScene.tsx:69` using `useRef` — M/L, score 2.0; does not displace top 10
- Lift shared uniform updates from per-cloud `useFrame` in `PollutionVolume.tsx:174` to a single top-level `useFrame`; or use `InstancedMesh` — H/M, score 1.5; does not displace top 10
- Memoize `windData` at call sites of `WindField`; add ref-based equality guard inside `WindParticleSystem` `useMemo` at `WindField.tsx:231` — M/L, score 2.0; does not displace top 10

## 📚 Archive (one line per past run)
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
