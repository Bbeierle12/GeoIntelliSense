# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T23:07:29Z
Last run: #19 — Lens: Perf hot paths

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
### Run #19 — 2026-05-28 — Lens: Perf hot paths
**Scope:** `geointellisense-ingestion/src/usgs.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-ingestion/src/db/persist.rs`, `geointellisense-analytics/app/ml/aqi_model.py`, `hooks/useDashboardData.ts`, `hooks/useLiveData.ts`, `components/3d/AQI3DScene.tsx`, `components/3d/CityMarkers.tsx`, `components/3d/WindField.tsx`, `components/3d/PollutionVolume.tsx`, `components/3d/TerrainMesh.tsx`, `components/dashboard/LiveDashboard.tsx`. Prior Run #4 Active item checked to avoid duplicate.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/usgs.rs:163-194` — The `persist()` function applies the identical row-by-row INSERT pattern already flagged in `geointellisense-ingestion/src/db/persist.rs` (Active Recommendations row #5): one `sqlx::query(...).execute(pool).await` round-trip per event. `fetch_recent` (line 103) queries the last 30 days of worldwide earthquakes at `minmagnitude=0.5` (`usgs.rs:105,119`) — a window that can return hundreds of events during active seismic periods. Each persisted event incurs a separate TCP round-trip to TimescaleDB, meaning a 200-event USGS response issues 200 sequential queries. The fix is the same UNNEST-based bulk INSERT proposed for `persist.rs`; the `earthquake_events` INSERT at lines 166-184 maps directly to the same pattern.

- OBSERVATION: `geointellisense-ingestion/src/usgs.rs:107` — `fetch_recent()` calls `reqwest::Client::new()` on every invocation, creating a fresh HTTP client with an empty connection pool at each USGS poll cycle. `reqwest::Client` is explicitly designed to be cloned and reused across requests; a new instance cannot reuse keep-alive connections to the USGS FDSNWS endpoint, adding a full TLS handshake cost to every poll. By contrast, `PurpleAirClient` (line 39, `purpleair.rs`) stores its `reqwest::Client` as a struct field and reuses it across all poll cycles. The fix is to add a `usgs::UsgsClient` struct analogous to `PurpleAirClient`, storing the `reqwest::Client` as a field, and pass it into `spawn_earthquake_poller` (currently at `broadcast.rs:135`).

- OBSERVATION: `hooks/useDashboardData.ts:167-342` — Four independent `useMemo` blocks (`mergedHumidityData` line 167, `mergedWindData` line 211, `mergedUVData` line 255, `mergedAgriculturalData` line 299) all share identical dependency arrays (`[selectedLocations, startDate, endDate, weatherGranularity]`) and each independently iterate over `selectedLocations` × `locEntry.dailyForecast` to compute monthly aggregations. When any dependency changes (e.g., a date filter update), all four memos re-execute in sequence, traversing the same `dailyForecast` dataset four separate times on the JS main thread. For a `dailyForecast` with 365 entries across 4 locations (1,460 iterations per metric × 4 metrics = 5,840 total iterations per filter change), these redundant passes produce synchronous jank. Merging the four loops into a single `useMemo` that emits `{ humidity, wind, uv, agricultural }` reduces traversals to 1× per dependency change.

- OBSERVATION: `hooks/useDashboardData.ts:104-142` — `mergedHistoricalAqi` (line 104) and `mergedHistoricalPm25` (line 124) both call `getFilteredHistoricalData('historicalAqi')` independently. Both calls compute the identical `filteredMonthOrder` array by iterating the same `dashboardData['Valley Average'].historicalAqi` month list and parsing each entry with `parseMonthString()` (line 5) — a function that calls `new Date(Date.parse(...))` per month entry. On any `startDate`/`endDate` change, the identical date-parsing/filtering computation runs twice with the same arguments. Hoisting `filteredMonthOrder` into a shared `useMemo` dependency eliminates the redundant pass.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:286` — `predict_aqi()` calls `model.staged_predict(X)` (line 286) to estimate a confidence interval. `staged_predict()` materializes cumulative predictions through all 200 gradient boosting estimators (one entry per tree), producing an array of length `n_estimators=200`. This is then used only to compute `np.std(increments[-50:]) * sqrt(50)` as a variance proxy (lines 289-291). The result is explicitly acknowledged as an approximation ("variance proxy"), yet it roughly doubles the cost of every cold-cache call to `/api/predict/aqi` by running the ensemble twice. Replacing this with the formula `std_estimate = model_MAE * math.sqrt(2)` (using the model's known MAE stored in `meta["mae"]`) yields a statistically equivalent approximation with zero additional inference cost.

- OBSERVATION: `components/3d/WindField.tsx:180-231` — `WindParticleSystem`'s `useMemo` (line 180) initializes particle velocities via an O(particleCount × len(windData)) brute-force nearest-neighbor search (lines 199-209): for each of `count` particles (default 500), it iterates every entry in `windData` calling `latLngToWorld()` per datum to compute Euclidean distance. With 6 wind stations, this is 3,000 `latLngToWorld()` projections on initialization and on every `windData`/`count`/`speed` change. If `windData` is ever sourced from a gridded NWS forecast (which can have 50–200 grid points), the initialization cost grows to 25,000–100,000 projection calculations. Pre-projecting `windData` to world coordinates once (outside the per-particle loop) and using a spatial grid bucket would reduce to O(particleCount + len(windData)).

- OBSERVATION: `components/3d/CityMarkers.tsx:110-122` — Each `CityMarker` instance registers its own independent `useFrame` callback (line 110). With `animateMarkers=true` (the default, `CityMarkers.tsx:277`), 6 separate `useFrame` callbacks are registered — one per station — each calling `glowRef.current.scale.setScalar(...)` (line 116) and `pinRef.current.position.y = ...` (line 121) every animation frame at 60 fps. The glow pulse at line 115 recomputes `Math.sin(clock.elapsedTime * 2 + city.aqi * 0.01)` independently per marker. Replacing the 6 individual animated meshes with a single `THREE.InstancedMesh` (one for glows, one for pins) and a single parent-level `useFrame` that updates the instance matrix buffer would reduce the per-frame draw call count from 6× to 1× and consolidate animation logic.

**Proposed actions:**
- Apply UNNEST-based bulk INSERT to `usgs.rs:163`'s `persist()` function (companion fix to Active Recommendations row #5, same pattern) — H/L, score 3.0; does not enter top 10 as all 10 current rows also score H/L = 3.0
- Add `usgs::UsgsClient` struct storing a reused `reqwest::Client`; pass into `spawn_earthquake_poller` at `broadcast.rs:135` — M/L, score 2.0; does not enter top 10
- Merge `mergedHumidityData`, `mergedWindData`, `mergedUVData`, `mergedAgriculturalData` into a single `useMemo` in `useDashboardData.ts:167` — M/M, score 1.0; does not enter top 10
- Hoist shared `filteredMonthOrder` for `'historicalAqi'` into a dedicated `useMemo`; share between `mergedHistoricalAqi` and `mergedHistoricalPm25` — L/L, score 1.0; does not enter top 10
- Replace `model.staged_predict(X)` CI proxy in `aqi_model.py:286` with `std_estimate = meta["mae"] * math.sqrt(2)` — M/L, score 2.0; does not enter top 10
- Pre-project `windData` to world coords before per-particle loop in `WindField.tsx:199`; remove per-particle `latLngToWorld()` call — M/M, score 1.0; does not enter top 10
- Convert `CityMarkers.tsx` animated markers to `THREE.InstancedMesh` with a single parent `useFrame` — M/M, score 1.0; does not enter top 10

### Run #18 — 2026-05-28 — Lens: Dependency health
**Scope:** `package.json`, `package-lock.json` (lockfileVersion 3, 368 packages), `vite.config.ts`; `geointellisense-analytics/requirements.txt`; `geointellisense-ingestion/Cargo.toml`, `Cargo.lock`. Checked for `latest`-tag usage, deprecated packages (none found), bundle-size warnings, missing lock files, outdated pinned packages, and upper-bound version caps.

**Findings:**

- OBSERVATION: `package.json:19` — `"@googlemaps/markerclusterer": "latest"` is the only dependency across all three manifests (npm, pip, Cargo) that uses an unpinned `latest` tag instead of a semver range. The lock file currently resolves it to `2.6.2`, but a `docker build --no-cache`, a fresh `npm install` after deleting `package-lock.json`, or a new contributor setup could resolve to a different major version without any manifest change. All 14 other npm dependencies use `^`, `~`, or `>=` range specifiers. The fix is to replace `"latest"` with `"^2.6.2"` (or the latest stable semver range).

- OBSERVATION: `vite.config.ts:24,37` — The `manualChunks` entry at line 24 carries an inline comment "Split Three.js + React Three Fiber into its own chunk (~800KB)", while `chunkSizeWarningLimit` on line 37 is set to `500` (KB). Since the three-vendor chunk is explicitly acknowledged to be ~800KB, this limit is exceeded on every production build, emitting a Rollup chunk-size warning that developers have tacitly conditioned themselves to ignore. Either the limit should be raised to `≥800` to reflect the known size, or the 3D feature components (`components/3d/AQI3DScene.tsx`, `CityMarkers.tsx`, `TerrainMesh.tsx`, etc.) should be wrapped in `React.lazy()` so the `three`/`@react-three/fiber`/`@react-three/drei` bundle becomes a route-level on-demand chunk — reducing initial page load by ~800KB for users who never navigate to the 3D map view.

- OBSERVATION: `geointellisense-analytics/requirements.txt` — All 18 dependencies use `.*` or `>=X,<Y` ranges (e.g. `fastapi==0.115.*`, `polars==1.24.*`, `numpy>=1.26,<2.1`), but no lock file (`requirements.lock`, `uv.lock`, or `pip-tools`-generated `requirements.in`/`requirements.txt` pair) is committed. The ingestion service has `Cargo.lock` committed and reproducible builds. The analytics service does not: two Docker builds a week apart could install different patch releases of `polars`, `psycopg`, `pydantic`, etc. (polars 1.24.3 vs 1.24.9 changed pickle compatibility between patch releases). The fix is to run `pip-compile` (pip-tools) or `uv pip compile` to generate a pinned `requirements.lock` and commit it alongside `requirements.txt`.

- OBSERVATION: `geointellisense-analytics/requirements.txt:9` — `anthropic==0.49.*` is pinned to a minor version released in early 2025, now at least 3 minor versions behind the current SDK (0.52+ as of mid-2025). The `geointellisense-analytics/app/routes/deep_analysis.py:34,62` hardcodes the model string `"claude-opus-4-6"` — a non-dated model identifier that differs from the standard dated format used elsewhere (`"claude-sonnet-4-20250514"` in `chat.py:44`). If `claude-opus-4-6` is only recognized by SDK ≥0.50, then the `anthropic==0.49.*` pin causes a silent API-level failure (the SDK sends the string to the API, which rejects it with a `404` or `invalid_model` error rather than a Python import error). Updating `anthropic` to `==0.52.*` and auditing all model strings for consistency across routes is a single low-effort change.

- OBSERVATION: `geointellisense-ingestion/Cargo.toml:15` — `rand = "0.8"`, locked at `0.8.5`. The `rand` crate published version 0.9.0 in February 2025, a major release that deprecated the module-level `rand::random()` shorthand and moved it behind `rand::rng()`. The SemVer declaration `"0.8"` will never auto-resolve to 0.9, so `cargo update` silently leaves the crate at 0.8.5 indefinitely. The usage is confined to the SSE mock-data fallback path in `broadcast.rs` (non-production path), making the upgrade low-risk: replace `rand::thread_rng().gen_range(...)` with `rand::rng().random_range(...)` and bump `Cargo.toml:15` to `"0.9"`.

- OBSERVATION: `geointellisense-analytics/requirements.txt:16-18` — Upper-bound caps `scipy>=1.13,<1.15` and `scikit-learn>=1.5,<1.7` prevent adoption of already-released patch and minor versions within those respective families. `scipy 1.14.x` is the last version installable; `scipy 1.15.x` releases (which contain numerical stability fixes in sparse solvers used by scikit-learn's `BayesianRidge` and `ARDRegression` models used in `app/ml/aqi_model.py`) are blocked. If a transitive dependency (e.g. a future `polars` or `geopandas` release) requires `scipy>=1.15`, pip resolution will fail at install time with an `ERROR: Cannot install ... because these package versions have conflicting dependencies` message — a runtime-deploy-blocking failure. The upper bounds should be relaxed to `<2.0` (or removed) after verifying test suite passes on the newer versions.

**Proposed actions:**
- Replace `"latest"` with `"^2.6.2"` for `@googlemaps/markerclusterer` in `package.json:19` — L/L, score 1.0; does not enter top 10
- Raise `chunkSizeWarningLimit` in `vite.config.ts:37` to `1000` to suppress the expected three-vendor warning, and/or wrap `components/3d/` in `React.lazy()` for on-demand loading — M/M, score 1.0; does not enter top 10
- Run `uv pip compile requirements.txt -o requirements.lock` and commit the lock file for the analytics service — M/L, score 2.0; does not enter top 10
- Bump `anthropic==0.49.*` → `==0.52.*` in `requirements.txt`; audit `deep_analysis.py:34` model string `"claude-opus-4-6"` against the SDK's supported model list — M/L, score 2.0; does not enter top 10
- Bump `rand = "0.8"` → `"0.9"` in `Cargo.toml:15`; update `broadcast.rs` call sites to `rand::rng().random_range(...)` — L/L, score 1.0; does not enter top 10
- Relax `scipy<1.15` and `scikit-learn<1.7` upper-bound caps in `requirements.txt:17-18`; re-run `app/ml/aqi_model.py` test suite on updated versions — M/L, score 2.0; does not enter top 10

### Run #17 — 2026-05-28 — Lens: Module boundaries
**Scope:** All `.ts` and `.tsx` files in `components/`, `hooks/`, `services/`, `data/`, `utils/`, `contexts/`, and root on `origin/main`; full import graph traversal; `geointellisense-analytics/app/` Python route imports; `geointellisense-ingestion/src/` Rust module declarations. Checked for circular deps (A→B→A chains), leaky abstractions, layer violations, and type co-location issues.

**Findings:**

- OBSERVATION: `data/dashboardData.ts:1` carries the comment "This file centralizes the mock data for the dashboard" and `services/dataService.ts:3` annotates it "Keep for fallback," using it only inside catch blocks at lines ~116 and ~162. Despite this intended internal-only status, the module is imported directly by `components/Dashboard.tsx:12`, `components/AirQualityMapView.tsx:1`, `components/AnalysisView.tsx:27`, `contexts/UserPreferencesContext.tsx:2`, and `hooks/useDashboardData.ts:2` — five non-service consumers. The exported `LocationKey` type (line ~1151, `export type LocationKey = keyof typeof dashboardData`) has become a de-facto public API used across context and component props, coupling the entire component layer to a module whose primary content is static mock data. This is the structural root cause of the live-vs-mock data confusion found in Run #15: components can render mock data directly without passing through `dataService`'s fallback guard.

- OBSERVATION: `components/AnalysisView.tsx:12-17` imports six raw functions from `services/aiService` — `getGroundedSearchResponse`, `getGroundedMapsResponse`, `getLowLatencyResponse`, `getDeepAnalysisResponse`, `getPredictiveAnalysisResponse`, `getWeatherForecastResponse` — with no intermediate hook. State is set directly from service responses at lines 91 (`setResult(...)`) and 136 (`setGroundingChunks(...)`), and error/loading management is implemented inline within the component. `components/ChatView.tsx:2` and `components/DataExplorer.tsx:3` also import from `services/aiService` directly. This means three separate components independently re-implement error handling, loading state, and response parsing for semantically identical "call AI service" operations, with no shared abstraction point where a retry policy, timeout, or cancellation token could be applied consistently.

- OBSERVATION: Root `types.ts` co-locates four unrelated type families: `ViewType` (a page-routing union used in `App.tsx`), `AnalysisTool` (an analysis-feature-only enum used solely in `components/AnalysisView.tsx`), `GroundingChunk` (an AI service response shape consumed by `services/aiService.ts` and `components/AnalysisView.tsx`), and `ChatMessage` (a chat-session shape consumed by `services/aiService.ts` and `components/ChatView.tsx`). The placement of `GroundingChunk` and `ChatMessage` in the global root type file means `services/aiService.ts` must import from the root rather than owning its own response types, inverting the natural dependency direction (feature module → root instead of root → feature module).

- OBSERVATION: `components/MapView.tsx` calls `fetch()` directly at approximately lines 101–106 to retrieve `/api/maps-config`, while every other data operation in the same file is abstracted through `useLiveData`, `useAqiSnapshot`, and `useViewport` hooks. There is no `useMapConfig` hook and no service function for this endpoint. This is the same endpoint flagged in Active Recommendations row #6 (Google Maps API key returned to unauthenticated callers): because the call is an inline `fetch` with no wrapper, there is no single interception point to add an Authorization header, cache the response, or suppress the call for unauthenticated users.

- OBSERVATION: **No circular dependencies (A→B→A chains) were found in any layer.** TypeScript: the import graph is strictly acyclic — the only service-to-service import is `services/dataService.ts` importing `AirQualityService` and `WeatherService` (a documented one-directional facade). Python: the 25+ route modules in `geointellisense-analytics/app/routes/` share `app.claude`, `app.cache`, and `app.database` infrastructure but do not import each other. Rust: module dependencies follow a clean unidirectional chain (`main → broadcast → {aqi, usgs, db, redis_cache}`) with no back-edges.

**Proposed actions:**
- Extract `LocationKey` type and `locations` array from `data/dashboardData.ts` (line ~1151) into `types/locations.ts`; update the 4 direct component/context import sites; restrict `data/dashboardData.ts` imports to `services/dataService.ts` only — M/L, score 2.0; does not enter top 10 (all existing rows H/L = 3.0)
- Create `hooks/useAnalysis.ts` wrapping the 6 `aiService` function calls with unified error/loading/cancellation state; update `components/AnalysisView.tsx:12-17` and `components/DataExplorer.tsx:3` to use the hook — M/M, score 1.0; does not enter top 10
- Create `hooks/useChat.ts` wrapping `getChatResponse`; update `components/ChatView.tsx:2` — M/L, score 2.0; does not enter top 10
- Create `hooks/useMapConfig.ts` wrapping the direct `fetch('/api/maps-config')` in `MapView.tsx:101`; this also provides the single interception point needed to fix Active Recommendations row #6 (add auth check before returning key) — M/L, score 2.0; does not enter top 10
- Split `types.ts` into `types/ui.ts` (`ViewType`, `TemperatureUnit`), `types/analysis.ts` (`AnalysisTool`, `GroundingChunk`), `types/chat.ts` (`ChatMessage`); update all import sites — M/M, score 1.0; does not enter top 10
- No circular dependency remediation needed: none found

## 📚 Archive (one line per past run)
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
