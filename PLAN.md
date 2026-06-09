# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-09T20:10:00Z
Last run: #229 — Lens: Perf hot paths

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

### Run #227 — 2026-06-09 — Lens: Module boundaries
**Scope:** Seventeenth module-boundaries pass. Full reads of: `geointellisense-analytics/app/context.py` (lines 315–334, 465–500), `geointellisense-analytics/app/claude.py` (lines 95–125), `geointellisense-analytics/app/routes/fires.py` (lines 10–70), `geointellisense-analytics/app/http_client.py`, `geointellisense-analytics/app/routes/cropscape.py`, `geointellisense-analytics/app/routes/nws_forecast.py`, `geointellisense-analytics/app/routes/sentinel.py`, `services/WeatherService.ts` (lines 1–66), `services/AirQualityService.ts` (lines 1–50), `hooks/useRealtimeAQI.ts` (lines 1–20). Grep for `from app.routes` across all non-route `.py` files; grep for `import httpx` across all route `.py` files; grep for `from.*components` across all hook `.ts` files; grep for `const INGESTION_URL\|const ANALYTICS_URL\|const API_BASE_URL` across all service `.ts` files. Cross-checked against Active Recommendations and archived module-boundary runs #2, 17, 32, 47, 62, 77, 92, 107, 122, 137, 152, 167, 182, 197, 212 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/context.py:323` contains `from app.routes.fires import get_current_smoke_context` inside `_get_fire_context()`, and `context.py:471` contains `from app.routes.inversion import get_current_inversion` inside `_get_inversion_context()`. `geointellisense-analytics/app/claude.py:103` and `claude.py:116` each independently execute `from app.routes.fires import get_current_smoke_context`. The imported symbols (`get_current_smoke_context` at `fires.py:25` and the equivalent in `inversion.py`) are thin accessors for mutable module-level globals (`_smoke_context: str = ""` at `fires.py:22`, `_inversion_result` at the equivalent location in `inversion.py`) that are updated by background polling loops defined in those same route files. The dependency direction is inverted: `context.py` and `claude.py` are orchestration/context-builder modules that conceptually sit below the HTTP layer — they should provide data TO routes, not import stateful accessors FROM them. This creates a hard coupling: if `fires.py` is refactored (e.g., the global is moved to a shared state module), `context.py` and `claude.py` must be updated in tandem, and any future route that needs to contribute runtime state to the context must be explicitly imported here (already four imports across the two files). PROPOSAL: Extract `_smoke_context` and its accessor `get_current_smoke_context()` from `fires.py` into a new `app/runtime_state.py` module (or extend the existing `cache.py`). Both `fires.py` (background polling writer) and `context.py`/`claude.py` (readers) import from `runtime_state`. This severs the route→context import cycle and establishes a unidirectional data flow: routes write to shared state; context builders read from shared state — L/L effort (~15 lines; moves 3 global variables and their accessors, updates 4 import sites).

- OBSERVATION: `geointellisense-analytics/app/http_client.py` is a shared HTTP client module whose module docstring explicitly states "All outbound API calls should use this instead of raw httpx." The module provides retry-on-429, exponential backoff (`RETRY_BACKOFF = [1.0, 2.0, 4.0]`), and a unified `fetch()` function. However, three route files bypass it entirely: `routes/cropscape.py:12` (`import httpx`), `routes/nws_forecast.py:1` (`import httpx`), and `routes/sentinel.py:16` (`import httpx`) each import `httpx` directly and make raw HTTP calls. The shared client is only used by `clients/nasa_firms.py` and `clients/usgs_water.py`. As a result, cropscape, NWS forecast, and Sentinel outbound calls have no retry logic — a single transient 429 or 503 from the USDA CropScape API, NWS, or Sentinel Hub will fail the request immediately and return an error to the frontend with no retry attempt. PROPOSAL: In `cropscape.py`, `nws_forecast.py`, and `sentinel.py`, replace `import httpx` and direct `httpx.get()/httpx.AsyncClient()` calls with `from app.http_client import fetch` and `response = await fetch(url, params=params)` — L/L effort (~3 lines per file; immediately gives these three routes 429-resilient, retry-backed HTTP semantics matching the documented module contract).

- OBSERVATION: `services/WeatherService.ts:3-5` declares `const INGESTION_URL = import.meta.env.VITE_INGESTION_URL ? \`${import.meta.env.VITE_INGESTION_URL}/api\` : 'http://localhost:3001/api'` — an exact duplicate of the same declaration at `services/AirQualityService.ts:1-3`. Both services independently own a copy of this URL derivation logic. Furthermore, `WeatherService.ts:59` calls `fetch(\`${INGESTION_URL}/aqi-snapshot\`)` to retrieve sensor station readings for temperature/humidity/wind — this is the same AQI ingestion snapshot endpoint that `AirQualityService.ts:43` also calls. `WeatherService` is reaching into AQI-domain infrastructure to extract weather-related sensor fields. This cross-service responsibility leak means that if the ingestion snapshot endpoint URL or response shape changes, it must be patched in two separate service files; it also means `WeatherService` independently re-implements snapshot caching (its own `cachedReadings` + `cacheTimestamp` at lines 40-42) that `AirQualityService` already has at the same endpoint, so two parallel cache instances may return divergent snapshot data to AQI and weather widgets at the same polling interval. PROPOSAL: (a) Extract URL configuration into a single `services/config.ts`: `export const INGESTION_URL = ...; export const ANALYTICS_URL = ...;` — both services import from it; (b) add a `getSnapshotReadings()` public method to `AirQualityService` that returns the cached snapshot array, and have `WeatherService` call `AirQualityService.getInstance().getSnapshotReadings()` instead of independently calling the same HTTP endpoint — L/L effort (~8 lines; eliminates the duplicate URL declaration and the duplicate snapshot cache for the same endpoint).

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` contains `import type { CityData } from '../components/3d/CityMarkers'`. The correct dependency direction for hooks is: components import hooks, never the reverse. By importing `CityData` from a component file, `useRealtimeAQI` binds its public type interface to the internal structure of `components/3d/CityMarkers.tsx`. The `RealtimeCityData` interface exported at line 14 (`export interface RealtimeCityData extends CityData`) extends this imported type — meaning any change to `CityData` in `CityMarkers.tsx` silently propagates to the hook's public API and all downstream consumers without a clear dependency path. This inversion was likely unintentional: `CityData` represents a domain concept (a city's map-layer data point) that should live in a shared types module, not inside a component file. PROPOSAL: Move `CityData` (and any other domain-facing types currently in `components/3d/CityMarkers.tsx`) to a new `types/mapTypes.ts` or the existing nearest-neighbor types module; update `CityMarkers.tsx` to import from `types/mapTypes.ts` and remove the re-export; update `useRealtimeAQI.ts:8` import accordingly — L/L effort (~5 lines; restores the hooks-don't-import-components invariant and makes `CityData` a first-class domain type rather than a component implementation detail).

**Proposed actions:**
- Create `app/runtime_state.py`; move `_smoke_context`/`get_current_smoke_context()` from `fires.py` and equivalent from `inversion.py`; update 4 import sites in `context.py` and `claude.py` — L/L effort (~15 lines; severs inverted route→context dependency)
- Replace `import httpx` in `cropscape.py:12`, `nws_forecast.py:1`, `sentinel.py:16` with `from app.http_client import fetch` — L/L effort (~3 lines each; enforces documented module contract and adds retry protection)
- Extract `INGESTION_URL`/`ANALYTICS_URL` to `services/config.ts`; route `WeatherService` snapshot calls through `AirQualityService.getSnapshotReadings()` — L/L effort (~8 lines; eliminates duplicate URL config and duplicate snapshot cache)
- Move `CityData` type from `components/3d/CityMarkers.tsx` to `types/mapTypes.ts`; update `useRealtimeAQI.ts:8` import — L/L effort (~5 lines; restores hooks-don't-import-components invariant)

## 📚 Archive (one line per past run)
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
