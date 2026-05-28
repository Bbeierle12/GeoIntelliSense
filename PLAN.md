# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T09:12:00Z
Last run: #5 — Lens: Test coverage gaps

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Batch DB writes in `persist.rs` with UNNEST | Perf | H | L | 4 | Open |
| 2 | Annotate AI service `response.json()` shapes | Type safety | M | L | 1 | Open |
| 3 | Extract shared base URL config module | Module boundaries | M | L | 2 | Open |
| 4 | Use `asyncio.gather` in `build_live_context` | Perf | M | L | 4 | Open |
| 5 | Reuse `THREE.Vector3` ref in `CameraController.useFrame` | Perf | M | L | 4 | Open |
| 6 | Replace `toLocaleDateString` with month-lookup array in `useDashboardData` | Perf | M | L | 4 | Open |
| 7 | Dispose `THREE.Line` objects created in `Streamline` JSX | Perf | M | L | 4 | Open |
| 8 | Add Vitest coverage thresholds to `vite.config.ts` | Test coverage | M | L | 5 | Open |
| 9 | Add unit tests for `interpolation.ts`, `weatherUtils.ts`, `colorScales.ts` pure functions | Test coverage | M | L | 5 | Open |
| 10 | Upgrade Anthropic Python SDK from `0.49.*` to `>=0.50` | Dep health | M | L | 3 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
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
- Replace `write_readings` loop with a single UNNEST batch INSERT → Active Recommendation #1
- Add `useRef<THREE.Vector3>` in `CameraController` to reuse across frames → Active Recommendation #5
- Fix `Streamline` to create `THREE.Line` in `useMemo`/`useRef` and dispose on unmount → Active Recommendation #7
- Replace `toLocaleDateString` calls with a static `MONTH_NAMES` array in `useDashboardData` → Active Recommendation #6
- Wrap `build_live_context` data fetchers in `asyncio.gather` → Active Recommendation #4
- Migrate `generateInterpolatedMatrix` to a Web Worker — not in top 10 (H/M, score 1.5)
- Migrate `CityMarkers` to `InstancedMesh` — not in top 10 (H/H, score 1.0)
- Preserve original `fetched_at` timestamp in `AqiReading`; use in `persist.rs` — not in top 10 (M/M, score 1.0)

### Run #3 — 2026-05-28 — Lens: Dependency health
**Scope:** `package.json`, `package-lock.json` (lockfileVersion 3, 368 packages), `vite.config.ts`, `index.html`, `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml` + `Cargo.lock` (283 packages), all `.tsx`/`.ts` import statements for three.js; checked for `"latest"` version pins, deprecated transitive deps, CDN dependencies, bundle-split effectiveness, and SDK version lag.

**Findings:**

- OBSERVATION: `utils/colorScales.ts:1` performs `import * as THREE from 'three'` at module top-level. The file also exports pure AQI color functions (`getAQIColor`, `getAQICategory`, `AQI_CATEGORIES`) that have zero dependency on THREE. `components/AirQualityMapView.tsx:37` imports those pure functions from `colorScales.ts`. Because the THREE namespace import is unconditional, any consumer of `colorScales.ts` — including non-3D views — forces the entire three.js package (~600 KB min) into their module graph. `vite.config.ts:17` places `three`, `@react-three/fiber`, and `@react-three/drei` in a `three-vendor` manual chunk with the comment `// Split Three.js + React Three Fiber into its own chunk (~800KB)`, but that split is only effective if the three-vendor modules are imported exclusively from lazy-loaded routes. Because `AirQualityMapView` (a non-lazy component) triggers the THREE import via `colorScales.ts`, the three-vendor chunk is pulled into the initial bundle load.

- OBSERVATION: `index.html` contains a `<script type="importmap">` block that maps `react`, `react-dom`, `recharts`, `@google/genai`, and `@googlemaps/markerclusterer` to third-party CDN URLs (`aistudiocdn.com`, `unpkg.com`). None of the `<script src>` or importmap entries carry Subresource Integrity (SRI) hashes. In a Vite build, all these packages are already resolved from `node_modules` and bundled; the importmap is a stale artifact from Google AI Studio development that introduces contradictory module paths. Additionally, `@google/genai` appears only in the importmap and nowhere in `package.json` or any TypeScript import — it is entirely unused dead weight. The `<script src="https://cdn.tailwindcss.com">` in the same file loads the full ~3 MB runtime Tailwind CDN build on every page load; Tailwind is absent from `package.json` and `vite.config.ts`, so no PostCSS purging ever runs.

- OBSERVATION: `package.json:dependencies` pins `@googlemaps/markerclusterer` to the bare string `"latest"` (line 9). `latest` is a floating tag that resolves at install time — different CI environments or developer machines may install different versions without a lock-file bump, breaking reproducible builds. The same package is separately loaded via the importmap CDN entry pointing to `unpkg.com/@googlemaps/markerclusterer/dist/index.mjs`, creating a dual-resolution path where the browser might use a different version than the Vite build.

- OBSERVATION: `geointellisense-ingestion/Cargo.toml` declares `rand = "0.8"`. Cargo.lock shows `rand 0.8.5`. The `rand` 0.8 branch has been in maintenance mode since the `rand` 0.9 release (early 2025); `rand 0.9` changes the default `ThreadRng` API and deprecates several distribution constructors used in 0.8. While 0.8.5 is not CVE-affected, keeping the ingestion service on an end-of-active-development crate means security patches are less likely to appear if new issues are found.

- OBSERVATION: `geointellisense-analytics/requirements.txt` pins `anthropic==0.49.*`. The Anthropic Python SDK 0.49.x predates structured tool result support and Managed Agents APIs that shipped in ≥0.50. The analytics service uses the SDK across at least 10 route files (`chat.py`, `deep_analysis.py`, `grounded_search.py`, etc.) calling `client.messages.create`. Staying on 0.49.x blocks access to claude-opus-4-7 Managed Tools, token-efficient tool use, and new streaming improvements; the SDK changelog for 0.50–0.51 documents no breaking changes to `messages.create`.

- OBSERVATION: `geointellisense-analytics/requirements.txt` specifies `numpy>=1.26,<2.1` — a range rather than a minor-pinned spec — while all other scientific deps (`scipy`, `scikit-learn`, `joblib`) also use range pins. This is intentional and correct for scientific stack. However, there is no `requirements.lock` / `pip-compile` artefact in the repo; the Docker image will install the latest-matching versions at build time with no reproducibility guarantee across builds.

**Proposed actions:**
- Split `utils/colorScales.ts` into `utils/aqiColors.ts` (pure JS, no THREE) and `utils/colorScalesThree.ts` (THREE textures); update `AirQualityMapView.tsx` and other non-3D importers to use the pure file → Active Recommendation (fell off top 10 this run)
- Remove the `<script type="importmap">` block and the Tailwind CDN `<script>` from `index.html`; install `tailwindcss` as a dev dep and configure the PostCSS plugin in `vite.config.ts` → Active Recommendation (fell off top 10 this run)
- Change `"@googlemaps/markerclusterer": "latest"` to `"^2.6.2"` in `package.json` → not in top 10 (L/L, displaced)
- Upgrade `rand` in `Cargo.toml` from `"0.8"` to `"0.9"` and run `cargo update` → not in top 10 (L/L, displaced)
- Bump `anthropic` in `requirements.txt` to `>=0.50,<0.52` → Active Recommendation #10

## 📚 Archive (one line per past run)
- Run #1 (2026-05-28) — Lens: Type safety — 8 findings — 4 promoted to Active
- Run #2 (2026-05-28) — Lens: Module boundaries — 6 findings — 4 promoted to Active

## 🔁 Lens rotation log
- Run #1: lens 1 (Type safety) — findings added
- Run #2: lens 2 (Module boundaries) — findings added
- Run #3: lens 3 (Dependency health) — findings added
- Run #4: lens 4 (Perf hot paths) — findings added
- Run #5: lens 5 (Test coverage gaps) — findings added
