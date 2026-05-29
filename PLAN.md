# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-29T16:10:00Z
Last run: #36 — Lens: TS ↔ Python contract

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
### Run #36 — 2026-05-29 — Lens: TS ↔ Python contract
**Scope:** Third TS↔Python contract pass. All TypeScript interfaces in `hooks/useLiveData.ts`, `services/dataService.ts`, `services/aiService.ts`, `types.ts`; Python route handlers in `geointellisense-analytics/app/routes/` (chat, grounded_search, grounded_maps, low_latency, deep_analysis, predictive_analysis, weather_forecast, predict, historical_aqi, historical_weather, inversion, fires, water, earthquakes, nws_forecast); Python models in `geointellisense-analytics/app/clients/nasa_firms.py`, `app/clients/nws_sounding.py`, `app/ml/aqi_model.py`; `components/MapView.tsx` for field access patterns. Cross-referenced against run #6 (4 promoted to Active) and run #21 (0 promoted, archived) to exclude previously-reported items.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/clients/nasa_firms.py` and `hooks/useLiveData.ts:137-148` — `FireDetection.to_dict()` serializes raw `__slots__` keys directly: the dict keys are `latitude` and `longitude` (matching the slot names). However, TypeScript `FiresData.fires[]` declares `lat: number` and `lng: number`, and `components/MapView.tsx:274` accesses `position: { lat: f.lat, lng: f.lng }`. Because no key named `lat` or `lng` exists in the Python response, `f.lat` and `f.lng` are `undefined` at runtime. Google Maps ignores a marker whose position contains `undefined` coordinates and silently declines to render it. As a result, the fire layer is always empty on the map regardless of how many detections the FIRMS API returns. This is a functional regression: the fire marker loop at `MapView.tsx:271-281` runs without error but produces zero visible markers in every case where the FIRMS API returns fire data. Fix: in `nasa_firms.py`, change the `to_dict` method to emit `"lat"` and `"lng"` instead of `"latitude"` and `"longitude"`, or add explicit remapping before returning (`d["lat"] = d.pop("latitude"); d["lng"] = d.pop("longitude")`); alternatively rename the TypeScript interface fields to `latitude`/`longitude` and update `MapView.tsx:274` accordingly.

- OBSERVATION: `services/dataService.ts:163-175` and `geointellisense-analytics/app/routes/historical_aqi.py:47-48` / `historical_weather.py:37-38` — `DataService.getLocations()` constructs location IDs as `name.toLowerCase().replace(/\s+/g, '_')` (e.g., `"fresno"`, `"bakersfield"`, `"modesto"`). These name-based IDs are passed verbatim in the `location_ids` query parameter when `getHistoricalAQI()` and `getHistoricalWeather()` call the analytics endpoints. Both Python handlers split on commas and then execute `AND sr.location_id = ANY(${idx}::uuid[])`, which instructs PostgreSQL to cast the string `"fresno"` to a UUID. PostgreSQL raises `invalid input syntax for type uuid: "fresno"` for every such request. The `asyncpg` driver propagates this as an exception, FastAPI returns HTTP 500, and the TypeScript `DataService` catches the error at line 184 and silently falls back to `getHistoricalAQIFallback()` (mock data). As a result, real historical data is never fetched from the database; every `DataExplorer` and `CalendarView` render is driven entirely by static mock data regardless of what is stored in TimescaleDB. Fix: either (a) update `DataService.getLocations()` to use the actual UUID from the `locations` table (requires a `GET /api/locations` endpoint), or (b) change both Python handlers to filter by `l.name = ANY($1::text[])` so that human-readable names are accepted.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:264-274` and `hooks/useLiveData.ts:103-113` — `predict_aqi()` returns the dict keys `"modelR2": meta.get("r2_score")`, `"modelMAE": meta.get("mae")`, and `"trainedAt": meta.get("trained_at")`. All three call `.get()` on the in-memory meta dict without a default, returning Python `None` (JSON `null`) when the corresponding key is absent. This occurs if the model was loaded from a `.joblib` file that was saved before these metadata fields were introduced, or if a training run fails after saving the model file but before saving the meta file. TypeScript `PredictionResult` at `useLiveData.ts:105-110` declares `modelR2: number`, `modelMAE: number`, and `trainedAt: string` — all non-optional. Any consumer that accesses `data.modelR2.toFixed(3)` or `data.trainedAt.slice(0, 10)` will throw `TypeError: Cannot read properties of null` at runtime. Additionally, `predict_aqi()` includes a key `"currentFeatures"` (line 273) that is not declared in `PredictionResult`, meaning it is silently present in every prediction response but invisible to TypeScript consumers. Fix: (a) supply defaults in `predict_aqi()` — `meta.get("r2_score", 0)`, `meta.get("mae", 0)`, `meta.get("trained_at", "")` — and (b) add `currentFeatures?: Record<string, number>` to `PredictionResult` for correctness.

- OBSERVATION: `geointellisense-analytics/app/routes/predict.py:_get_airnow_comparison()` and `hooks/useLiveData.ts:109` — The optional `airnowComparison` field on `PredictionResult` is typed `{ source: string; aqi: number; category: string }`. In `_get_airnow_comparison()`, the returned dict uses `"aqi": f.get("aqi")` and `"category": f.get("category")` where `f` is a cached AirNow forecast dict. Neither key is guaranteed to exist: if the AirNow forecast was cached before these fields were added, or if the station data format changes, both `.get()` calls return `None`. TypeScript sees `aqi: null` where `number` is required. The function also returns two extra undeclared fields — `"date": f.get("date")` and `"parameter": f.get("parameter")` — that are absent from the TypeScript type. Fix: supply defaults (`f.get("aqi", 0)`, `f.get("category", "Unknown")`) in `_get_airnow_comparison()`; extend `airnowComparison` in `PredictionResult` to include `date?: string` and `parameter?: string` for complete type coverage.

- OBSERVATION: `geointellisense-analytics/app/routes/water.py:_format_current()` and `hooks/useLiveData.ts:202-213` — `_format_current()` includes `"lat": r.latitude` and `"lng": r.longitude` on every station object. TypeScript `WaterData.stations[]` is declared as `{ siteId: string; siteName: string; readings: Record<...> }` with no `lat` or `lng` fields. Any code that needs to geo-locate a USGS water station from `WaterData` must use a type assertion or cast, and TypeScript strict mode would flag direct property access as a type error. This is a type-completeness gap: the data is present in the network response but absent from the declared contract. Fix: add `lat: number; lng: number` to the `WaterData.stations[]` item type in `useLiveData.ts`.

**Proposed actions:**
- In `nasa_firms.py:to_dict`, rename `latitude`→`lat` and `longitude`→`lng` in the returned dict so fire marker positions are no longer undefined — H/L, score 3.0; ties current top 10, does not displace
- Update `DataService.getHistoricalAQI/Weather` to either (a) fetch UUID-based location IDs from a `/api/locations` endpoint, or (b) change the Python handlers to filter by name (`l.name = ANY(...)`) instead of UUID cast — H/L, score 3.0; ties current top 10, does not displace
- Supply `.get()` defaults for `r2_score`, `mae`, `trained_at` in `aqi_model.py:predict_aqi()` and declare `currentFeatures?` in `PredictionResult` — M/L, score 2.0; does not enter top 10
- Provide fallback values for `aqi` and `category` in `_get_airnow_comparison()`; add `date?`/`parameter?` to `PredictionResult.airnowComparison` — L/L, score 1.0; does not enter top 10
- Add `lat: number; lng: number` to `WaterData.stations[]` item type in `useLiveData.ts:206` — L/L, score 1.0; does not enter top 10

### Run #35 — 2026-05-29 — Lens: Test coverage gaps
**Scope:** Third test-coverage pass. All TypeScript files under `hooks/`, `utils/`, `services/`; Vitest configuration in `vite.config.ts`; test files under `tests/` and `App.test.tsx`; Python `geointellisense-analytics/app/cache.py`; Rust `geointellisense-ingestion/src/aqi.rs`. Cross-referenced archived findings from runs #5 and #20 to avoid duplicates; focused on specific behavioral gaps and edge-case bugs within already-acknowledged untested modules.

**Findings:**

- OBSERVATION: `hooks/useLiveData.ts:47-52` — The `fetchData` callback's URL-routing logic is completely untested. The condition `path.startsWith('/api/aqi-') || path === '/health'` routes to `INGESTION_URL`; all other paths go to `GATEWAY_URL`. Six specialized hooks depend on this routing: `useAqiSnapshot('/api/aqi-snapshot', ...)` → ingestion; `useAqiPrediction('/api/predict/aqi', ...)` → gateway; `useInversionStatus`, `useActiveFires`, `useEarthquakes`, `useWaterLevels` → gateway. No test verifies that any of these paths hits the correct service. Critically, the prefix `'/api/aqi-'` (with trailing hyphen) is required to prevent `useAqiPrediction`'s path (`'/api/predict/aqi'`) from matching. If the condition were accidentally written as `path.startsWith('/api/aqi')` (no hyphen), then `useAqiPrediction` would silently target `INGESTION_URL` — which does not serve ML prediction endpoints — and every prediction read would return 404 with no TypeScript compile error. The four error-classification branches (503→`'disabled'`, 4xx→`'client'`, 5xx→`'server'`, network failure→`'network'`) are also untested for `useLiveData` itself; only `useApiStatus` (a different hook) has any error-path test coverage.

- OBSERVATION: `utils/colorScales.ts:137-145` — `hexToRgb()` silently returns `{ r: 0, g: 0, b: 0 }` (pure black) for any input that does not match its regex `/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i`. Inputs that silently produce black include 3-digit shorthand hex (`"#f00"`), CSS named colors (`"red"`), and `rgb()`/`hsl()` strings. No test exercises this fallback path. The function is called by five exported utilities: `interpolateColorStops()`, `blendColors()`, `adjustBrightness()`, `getContrastColor()`, and `getAQIRGBA()`. While all current internal callers pass constants from `AQI_CATEGORIES` (valid 6-digit hex), `hexToRgb` is a public export callable by any future consumer. The highest-risk consumer is `getContrastColor()` (`colorScales.ts:271`), which uses luminance to decide whether overlaid text should be black or white. A non-matching input causes it to compute luminance from `{ r: 0, g: 0, b: 0 }` and always return `'#ffffff'` (white text), silently overriding correct contrast decisions for any component that passes non-6-digit hex to this utility.

- OBSERVATION: `utils/interpolation.ts:228-257` and `utils/interpolation.ts:51-105` — The co-located sensor edge case is untested. When all `dataPoints` share the same lat/lng (e.g., a monitoring station and an adjacent PurpleAir device geocoded to the same address), `estimateVariogramParams` computes `maxDist = 0` → `range = 0`. Inside `variogramFunction`, `distance / range = Infinity`; the spherical branch `if (distance >= range)` → `true` for all non-zero distances, returning `sill` regardless of actual distance. The resulting kriging matrix K fails partial pivoting at column 1, `solveLinearSystem` returns null, and `interpolateKriging` falls back to IDW at line 174. However, the IDW fallback also fails gracefully but incorrectly: the `exactMatch` guard at `interpolateIDW:79` returns the first co-located point's value without averaging co-located sensors. If two sensors at the same address report AQI 65 and 95, IDW returns 65 (whichever is first in the array) and silently discards 95. No test exercises either the kriging→IDW handoff for co-located inputs or the IDW exact-match behavior with multiple co-located sensors. `generateInterpolatedGrid()` (line 309), called from `AQI3DScene.tsx` and `CrossSectionView.tsx`, is the production entry point for this untested path.

- OBSERVATION: `geointellisense-analytics/app/cache.py:56-63` — `_key()` accepts `params: dict[str, Any] | str`. Dict inputs are canonicalized via `json.dumps(..., sort_keys=True)`. String inputs are used as-is with no type prefix in the hash input. A string param that happens to equal the JSON serialization of a dict used by another caller aliases to the same cache entry. Looking at call sites: `routes/chat.py` calls `set_cached("chat", session_id, ...)` with a string session ID; a session ID equal to `'{"location": "Fresno"}'` (no UUID validation enforces this cannot happen) would alias into another endpoint's cache. Separately, `cache_headers(hit, ttl)` (line 109) returns `f"public, max-age={ttl}"` without validating that `ttl > 0`. A `ttl=0` passed by any caller produces `Cache-Control: public, max-age=0`, instructing CDNs and browsers not to cache — the opposite of the intended behavior — with no error or log. No test exists for any of the five public functions in the module.

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs:82-92` — `aqi_category(aqi: u32)` maps AQI values to EPA category strings using Rust range patterns (`0..=50`, `51..=100`, etc.). Zero `#[cfg(test)]` blocks exist in the entire Rust service. The five boundary values (50, 100, 150, 200, 300) that determine category transitions are not verified by any test. The function is called in `generate_readings()` (line 100) for every mock AQI reading produced when no PurpleAir API key is present — the default configuration in development and in production if the key is missing. Category labels computed by `aqi_category` are serialized into `AqiReading.category` and sent to the frontend, where they control map marker tooltips and legend entries. A one-off boundary error (e.g., 50 → "Moderate" instead of "Good") would silently mislabel every reading at that threshold in all SSE streams and API snapshot responses.

**Proposed actions:**
- Add Vitest tests for `useLiveData` covering: each of the 6 typed hooks routes to the correct base URL; all 4 error branches produce the correct `errorKind` — M/L, score 2.0; does not enter top 10
- Add tests for `utils/colorScales.ts:hexToRgb` covering valid 6-digit hex, `#`-prefixed hex, non-matching inputs, and `getContrastColor` behavior on black fallback — M/L, score 2.0; does not enter top 10
- Add tests for `utils/interpolation.ts:interpolateIDW` with multiple co-located input points, verifying it does not silently return only the first sensor's value — M/L, score 2.0; does not enter top 10
- Add pytest for `geointellisense-analytics/app/cache.py` with a mock Redis client covering all 5 public functions including string/dict key isolation and `cache_headers` boundary behavior — M/L, score 2.0; does not enter top 10
- Add `#[cfg(test)]` module to `geointellisense-ingestion/src/aqi.rs` with boundary tests for `aqi_category` at values 50, 51, 100, 101, 150, 151, 200, 201, 300, 301 — M/L, score 2.0; does not enter top 10

### Run #34 — 2026-05-29 — Lens: Perf hot paths
**Scope:** Third perf-hot-paths pass. All Rust files under `geointellisense-ingestion/src/` (focus: `broadcast.rs`, `purpleair.rs`, `db/persist.rs`, `routes/sse.rs`, `routes/aqi.rs`); Python files under `geointellisense-analytics/app/` (focus: `context.py`, `ml/aqi_model.py`, `claude.py`, `routes/chat.py`); TypeScript components `components/MapView.tsx`, `hooks/useLiveData.ts`. Cross-referenced archived findings from run #4 and run #19 to avoid duplicates.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/context.py:61-68` — `build_live_context()` contains a comment "Run all queries concurrently-ish (asyncpg handles connection pooling)" but the implementation is fully sequential: seven `await` expressions are chained one after another (`context["aqi"] = await _get_aqi_context(pool)`, `context["forecast"] = await _get_forecast_context(pool)`, and so on through `context["prediction"]`). Each call suspends the coroutine until that individual query completes before the next begins. The seven DB/Redis operations — `DISTINCT ON` AQI query, Redis `SCAN_ITER` for forecast, three PostgreSQL geography queries (fires, earthquakes, water), an aggregate on `census_tracts`, and the ML prediction pipeline — are fully independent and have no shared state that would prevent concurrent execution. At a typical asyncpg round-trip of 5–15ms each, sequential execution costs 35–105ms; concurrent execution via `asyncio.gather()` would reduce this to the longest single query's latency (~15ms). Because `build_live_context()` is called on every `/api/chat` request that misses the 60-second context cache (i.e., the first message in any session, and every message after a 60-second idle), this sequential overhead adds directly to the user-visible chat response latency. Fix: replace the seven sequential `await` calls with `results = await asyncio.gather(_get_aqi_context(pool), _get_forecast_context(pool), _get_fire_context(pool), _get_earthquake_context(pool), _get_water_context(pool), _get_enviroscreen_context(pool), _get_prediction_context(pool))` and unpack into the context dict; `_get_inversion_context()` is synchronous and can remain outside the gather.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:286` — Inside `predict_aqi()`, the confidence-interval calculation calls `model.staged_predict(X)` on a `GradientBoostingRegressor` with `n_estimators=200`. `staged_predict` is a generator that applies the ensemble incrementally, traversing all 200 trees stage-by-stage to yield 200 cumulative predictions; its cost is equivalent to calling `model.predict(X)` 200 times. On a model of this size, `staged_predict` on a single feature vector takes ~100–200ms on a CPU-only analytics container, versus ~1ms for a single `model.predict()`. The result (`np.std(np.diff(staged[-50:]))`) measures the standard deviation of the increment sizes over the last 50 boosting stages, which quantifies convergence rate — not prediction uncertainty — and has no statistical interpretation as a confidence interval. A gradient boosting model does not produce native prediction intervals; the existing fallback at line 292 (`std_estimate = max(predicted * 0.15, 5)`) is the correct approach. `predict_aqi()` is called from `_get_prediction_context()` in `context.py:498`, which is called on every uncached chat message. Fix: remove the `staged_predict` block (lines 286-291); unconditionally use `std_estimate = max(predicted * 0.15, 5)` as the variance proxy, which is both faster and more honest about the CI's heuristic nature.

- OBSERVATION: `components/MapView.tsx:369-374` — The marker-rendering effect (lines 232–375) collects all markers into `allMarkers` (AQI first, then fires, earthquakes, wells, water quality) and at line 369 checks `if (layers.aqi && aqiData?.readings && aqiData.readings.length > 10)` to decide whether to use `MarkerClusterer`. When clustering is active — which is the default state whenever PurpleAir returns >10 readings (effectively always) — only `allMarkers.slice(0, aqiData.readings.length)` is passed to `new MarkerClusterer({ markers: aqiMarkers, map })`. The `MarkerClusterer` constructor calls `setMap(map)` on each AQI marker it manages. The remaining non-AQI markers (`allMarkers[N:]`, where N = AQI count) never have `setMap()` called on them and are silently invisible despite their layer toggles being enabled. The `else` branch (line 373) correctly calls `allMarkers.forEach(m => m.setMap(map))`, but it only executes when AQI is disabled or has ≤10 readings — both rare states. In practice, this means the fire, earthquake, oil/gas wells, and water quality layers are always invisible when the map is in its normal operating state. Fix: after creating the clusterer, add `allMarkers.slice(aqiData.readings.length).forEach(m => m.setMap(map))` to set the non-AQI markers onto the map independently of the clusterer.

- OBSERVATION: `components/MapView.tsx:232,375` — The single `useEffect` at line 232 manages all seven data layers with one combined dependency array (`[layers, aqiData, firesData, quakeData, waterData, wellsData, wqData]`). On every trigger, the effect destroys all existing markers (`markersRef.current.forEach(m => m.setMap(null))`, line 237) and rebuilds all markers from scratch regardless of which dependency changed. Because `aqiData` is polled every 30 seconds (`useLiveData` with `refreshInterval: 30_000`), the map performs a full teardown-and-rebuild of all markers (including up to 500 wells + earthquakes + fires + water quality markers) every 30 seconds, even when those other datasets have not changed. Each cycle of ~500+ `google.maps.Marker` destructions and re-constructions triggers a corresponding number of V8 heap allocations and Google Maps DOM operations. On a low-end device with several layers active, this can produce a visible flash (all markers disappear then reappear) every 30 seconds. Fix: split into per-layer effects — one effect per data source, each managing its own `markersRef` sub-collection and only running when that source's data or toggle changes; use a `Map<string, google.maps.Marker[]>` keyed by layer name to track per-layer markers.

**Proposed actions:**
- Replace sequential `await` calls in `context.py:61-68` with `asyncio.gather()`; keep `_get_inversion_context()` synchronous outside the gather — M/L, score 2.0; ties but does not displace existing top 10
- Remove `model.staged_predict(X)` block in `aqi_model.py:286-291`; always use `std_estimate = max(predicted * 0.15, 5)` — M/L, score 2.0; does not enter top 10
- After clustering block in `MapView.tsx:372`, add `.slice(aqiData.readings.length).forEach(m => m.setMap(map))` to set non-AQI markers — H/L, score 3.0; ties current top 10, does not displace
- Split the monolithic marker effect at `MapView.tsx:232` into per-layer effects using a `Map<string, google.maps.Marker[]>` for layer isolation — M/H, score 0.67; does not enter top 10

## 📚 Archive (one line per past run)
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
