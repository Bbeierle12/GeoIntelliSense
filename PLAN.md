# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T04:15:00Z
Last run: #95 — Lens: Test coverage gaps

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
### Run #95 — 2026-06-01 — Lens: Test coverage gaps
**Scope:** Seventh test-coverage-gaps pass. Examined: all `tests/` and `App.test.tsx` for current coverage; then focused on files introduced in the latest code commit (`e686fe7`): `geointellisense-analytics/app/http_client.py`, `geointellisense-analytics/app/middleware.py`, `hooks/useViewport.ts`, `geointellisense-analytics/app/routes/chat.py` (session management additions). Cross-checked against Active Recommendations and runs #93–#94 (Latest Findings) plus archived test-coverage-gaps runs #5, #20, #35, #50, #65, #80 (one-line archive only) to confirm all findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/http_client.py` (entire file, 81 lines) — introduced in commit `e686fe7`, zero tests exist. The `fetch()` function has four distinct control-flow branches: (1) success path (`resp.status_code < 400` → return at line 37); (2) 429 rate-limit path (lines 41-45: reads `Retry-After` header, falls back to `RETRY_BACKOFF[min(attempt, len-1)]`, sleeps, continues); (3) 5xx server-error path (lines 48-52: waits backoff, continues only when `attempt < max_retries`); (4) exception paths (lines 57-76: `httpx.TimeoutException`, `httpx.HTTPStatusError`, generic `Exception`). Additionally, lines 78-81 (`if last_error: raise last_error; raise RuntimeError(...)`) are structurally unreachable: the `TimeoutException` branch at line 64 re-raises on the last attempt before the loop exits; the generic `Exception` branch at line 75 re-raises similarly; `last_error` is set but never the only remaining failure path. No test validates the 429 backoff, the 5xx retry, the correct propagation of `HTTPStatusError` on a non-retried 4xx, nor the dead-code nature of lines 78-81. PROPOSAL: Add pytest tests for `app/http_client.py:fetch()` using `respx` or `httpx.MockTransport`; cover success on first attempt, 429→retry→success, 5xx→retry→5xx→raise on final attempt, timeout→retry→success, non-retriable 4xx raises immediately, and assert lines 78-81 cannot be reached via normal code paths — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/app/middleware.py` (entire file, 111 lines) — introduced in commit `e686fe7`, zero tests. Three functions are entirely untested: `_client_id()` (lines 32-40) has three branches — `x-api-key` header present (→ MD5 hash, line 37), `x-forwarded-for` header present (→ first IP from comma-separated list, line 39), and fallback to `request.client.host` or `"unknown"`. No test exercises the multi-hop forwarded-for case (e.g., `"10.0.0.1, 192.168.1.1"` should yield `"ip:10.0.0.1"`). `check_ai_auth()` (lines 82-111) has four outcomes: 503 when `settings.anthropic_api_key` is falsy (line 89), None pass-through when `settings.admin_token` is falsy/dev-mode (lines 94-96), 401 when API key header is absent but admin_token is set (line 100), and 403 for wrong key (line 109). `check_rate_limit()` (lines 43-79) wraps Redis pipeline operations in a broad `try/except` at line 76 that silently allows the request through on any Redis error — this fail-open behaviour is critical-path and untested. PROPOSAL: Add pytest unit tests using `unittest.mock.AsyncMock` to mock `get_redis()`: assert `_client_id` returns `"ip:10.0.0.1"` for multi-hop forwarded header; assert `check_ai_auth` returns 503/401/403/None for each branch; assert `check_rate_limit` returns `None` (allowing request) when Redis raises an exception — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `hooks/useViewport.ts` (entire file, 91 lines) — introduced in commit `e686fe7`, zero tests. `bboxToString()` (lines 39-42) is a pure function rounding each coordinate to 2 decimal places; no test validates rounding: `bboxToString({south:34.004, west:-121.005, north:37.496, east:-117.494})` should produce `"34.00,-121.01,37.50,-117.49"`, but whether this matches cache-key semantics is unverified. The `updateViewport` callback (lines 54-82) has two observable behaviours that are untested: (a) debounce coalescing — calls within 500 ms should coalesce into the last call; (b) change-detection guard at line 70 — when the rounded bbox string is identical to `lastBboxRef.current`, `setViewportState` is never called, meaning sub-threshold map pans (< 0.005°) produce stale viewport state silently. Also, the very first call to `updateViewport` invokes `clearTimeout(debounceRef.current)` when `debounceRef.current` is `undefined` (line 55); while harmless in browsers, this pattern means any test verifying clean timer teardown must account for the initial `undefined` state. PROPOSAL: Add vitest tests for `hooks/useViewport.ts`: unit-test `bboxToString` with rounding edge cases; test `updateViewport` debounce coalescing with `vi.useFakeTimers()`; test sub-threshold pan drops update; test genuine bbox change updates `viewport.bboxString` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:53-76` — tool-use loop added in commit `e686fe7`, zero tests. The loop `while resp.stop_reason == "tool_use" and rounds < 5` (line 53) terminates after 5 rounds but no test verifies: (a) exactly 5 `client.messages.create` calls are made when the model keeps returning `stop_reason == "tool_use"`; (b) the message list at line 66 is correctly constructed as `get_session_history(session_id) + assistant_block + tool_results` — if session history grows per round, the list could become exponentially large; (c) if `execute_tool` raises, the outer `except Exception` at line 87 catches it and returns a 500, rather than the exception being re-raised mid-loop. Additionally, `chat_reset()` at lines 95-102 silently skips `reset_session()` when `session_id` is an empty string (`body.get("session_id", "")` falsy check at line 100), returning `{"reset": True, "sessionId": ""}` with no error indication — this misleads callers into thinking the reset succeeded. PROPOSAL: Add FastAPI `TestClient` tests for `app/routes/chat.py`: mock `get_client()` to return an object cycling through `stop_reason == "tool_use"` five times then `"end_turn"`; assert exactly 6 `messages.create` calls (5 tool rounds + 1 final); test `execute_tool` exception → 500; test `chat_reset` with `""` session ID returns the silent-skip behaviour — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Add `respx`-based pytest tests for `app/http_client.py:fetch()` covering all 4 control-flow branches and confirming lines 78-81 are dead code — M/L, score 2.0
- Add pytest unit tests for `app/middleware.py` covering `_client_id()` multi-hop forwarding, `check_ai_auth()` all 4 outcomes, and `check_rate_limit()` Redis-fail-open — M/L, score 2.0
- Add vitest tests for `hooks/useViewport.ts`: `bboxToString()` rounding, debounce coalescing, sub-threshold pan drop, genuine update path — M/L, score 2.0
- Add FastAPI `TestClient` tests for `app/routes/chat.py` tool-use loop 5-round cap, `execute_tool` exception propagation, and `chat_reset` empty-session silent-skip — M/L, score 2.0

### Run #94 — 2026-06-01 — Lens: Perf hot paths
**Scope:** Eighth perf hot paths pass. Examined: `hooks/useRealtimeAQI.ts`, `components/3d/TerrainMesh.tsx`, `components/3d/WindField.tsx`, `components/3d/PollutionVolume.tsx`, `components/3d/CityMarkers.tsx`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/db/persist.rs`. Cross-checked against Active Recommendations and runs #91–#93 (Latest Findings) plus archived perf hot paths runs #4, #19, #34, #49, #64, #79 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:396-400` and `components/3d/TerrainMesh.tsx:239-241` — `aqiDataPoints` is computed as a plain `const` in the body of `useRealtimeAQI` (`const aqiDataPoints: DataPoint[] = cities.map(...)`), with no `useMemo`. Every SSE update sets `data` state, triggering a re-render of all consumers; on each render a new `aqiDataPoints` array is produced. This new array is passed as the `aqiData` prop to `TerrainMesh`, where `useMemo(() => createAQIOverlayTexture(aqiData, textureResolution), [aqiData, textureResolution])` re-fires on every render because React's dependency check uses `Object.is`, and the new array reference is never `===` to the previous one. `createAQIOverlayTexture` calls `generateInterpolatedMatrix` (IDW interpolation over a `textureResolution×textureResolution = 128×128 = 16,384` grid with N source points per SSE event), followed by `createDataTexture` which allocates a new `THREE.DataTexture` backed by `Uint8Array(128×128×4 = 65,536)` bytes and uploads it to the GPU. The superseded `THREE.DataTexture` is never `texture.dispose()`d: neither the `useMemo` return value nor any `useEffect` cleanup at `TerrainMesh.tsx:253-261` calls `dispose()` on the replaced texture. Over a session with SSE updates every ~30 s, this leaks one 64 KB GPU texture per update. PROPOSAL: Wrap `aqiDataPoints` in `useMemo` at `useRealtimeAQI.ts:396` (with `cities` as dependency) to stabilize the array reference across renders that don't change AQI values; add a `useEffect` cleanup in `TerrainMesh.tsx` that calls the previous `aqiTexture.dispose()` when `aqiTexture` changes — H/M, score 1.5; does not displace top 10.

- OBSERVATION: `components/3d/WindField.tsx:199-209` — Inside the `useMemo` that initialises particle velocities, the nearest-wind-point search at line 205 uses `Math.sqrt(Math.pow(x - wx, 2) + Math.pow(z - wz, 2))`. The `sqrt` is unnecessary for a nearest-neighbour comparison: sort order is identical whether distances or their squares are compared, so no information is lost by dropping `sqrt`. With `count = 500` (default) and `windData.length = 6`, this executes 3,000 `Math.sqrt` + 2×3,000 `Math.pow` calls per `useMemo` recomputation. The `useMemo` recomputes whenever `windData`, `count`, `speed`, or `height` change; `windData` is an inline-derived array from SSE state that re-creates on every SSE update (same root cause as Finding 1). Additionally, `latLngToWorld(wind.lat, wind.lng)` at line 203 is called once per particle per wind-data entry — the same 6 world-coordinate conversions are repeated 500 times each (3,000 total calls) rather than being precomputed outside the particle loop. PROPOSAL: Before the particle loop, precompute world coordinates into a local array (`const worldCoords = windData.map(w => ({ ...latLngToWorld(w.lat, w.lng), wind: w }))`); inside the inner loop replace `Math.sqrt(Math.pow(x-wx,2)+Math.pow(z-wz,2))` at line 205 with the squared form `(x-wx)*(x-wx)+(z-wz)*(z-wz)` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `components/3d/WindField.tsx:336` and `components/3d/TerrainMesh.tsx:202` — Both `Streamline` (WindField.tsx:336) and `RegionBoundary` (TerrainMesh.tsx:202) render `<primitive object={new THREE.Line(geometry, new THREE.LineBasicMaterial(...))} />` with the Three.js `Line` object and its `LineBasicMaterial` constructed inline in JSX. `geometry` is memoized in both cases, but the `THREE.Line` wrapper and its material are not — a new pair of objects is created on every render. React Three Fiber detects the new `object` reference, removes the old Three.js object from the scene and mounts the new one, but neither `.dispose()` is called on the old `Line` nor on its `LineBasicMaterial`. The orphaned material retains GPU shader-program state and vertex-buffer bindings. The re-render rate equals the SSE update rate for `WindField` (which receives a new `windData` prop on every event), so N `Streamline` components (one per wind data point) each leak one `THREE.Line` + one `LineBasicMaterial` per event; `RegionBoundary` leaks on any parent re-render. PROPOSAL: In `WindField.tsx:Streamline`, replace the inline `<primitive object={new THREE.Line(...)} />` with a `useMemo` wrapping `new THREE.Line(geometry, material)` (with `geometry` as dependency) plus a `useEffect` cleanup calling `line.material.dispose(); line.geometry.dispose()` on dep change; apply the identical pattern to `RegionBoundary` at `TerrainMesh.tsx:202` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `components/3d/PollutionVolume.tsx:174-184` — Each `PollutionCloud` component registers its own `useFrame` callback that executes every animation frame to update two shader uniforms (`time`, `cameraPos`) and set `meshRef.current.position.y`. With the default `resolution = 12`, `generateInterpolatedGrid` produces 144 grid points; after the `point.value > 30` filter at line 221, the majority (potentially 100–130 points given typical SJV AQI levels) pass through and are rendered across 3 layers, resulting in up to ~390 individual `PollutionCloud` components and an equal number of separate `useFrame` callbacks invoked per animation frame. At 60 fps, this is ~23,400 per-cloud callback invocations per second, each calling `Math.sin`, two uniform assignments, and one `position.y` assignment, plus React Three Fiber's frame-loop scheduler overhead per callback. An `InstancedMesh` approach would consolidate all pollution clouds into a single Three.js draw call, with one `useFrame` callback updating one `time` uniform, while per-instance AQI-driven color and density variation would be encoded as instance attributes or an instance color buffer. Additionally, the `useFrame` at `PollutionVolume.tsx:293-297` rotates `groupRef.current` unconditionally on every frame even when the component has no visible children (the `aqiData.length === 0` early return at line 300 follows the hook declaration, so the hook is always registered). PROPOSAL: Refactor `PollutionLayer` + `PollutionCloud` into a single `InstancedPollutionMesh` using `THREE.InstancedMesh`; encode per-cloud position, scale, and AQI-derived color in the instance matrix and color buffer updated via a single `useMemo` when `gridPoints` changes; replace N individual `useFrame` callbacks with one shared callback updating only the `time` uniform and group rotation — H/H, score 1.0; does not displace top 10.

**Proposed actions:**
- Wrap `aqiDataPoints` in `useMemo` at `useRealtimeAQI.ts:396`; add `useEffect` cleanup calling `aqiTexture.dispose()` in `TerrainMesh.tsx` when texture changes — H/M, score 1.5
- Precompute 6 world coords outside particle loop at `WindField.tsx:199`; replace `Math.sqrt(Math.pow(...))` with squared distance at line 205 — M/L, score 2.0
- Wrap `new THREE.Line(...)` in `useMemo` with disposal cleanup in `WindField.tsx:336` and `TerrainMesh.tsx:202` — M/L, score 2.0
- Refactor up to ~390 individual `PollutionCloud useFrame` callbacks into single `THREE.InstancedMesh` in `PollutionVolume.tsx` — H/H, score 1.0

### Run #93 — 2026-06-01 — Lens: Dependency health
**Scope:** Seventh dependency health pass. Examined: `package.json`, `package-lock.json`, `vite.config.ts`, `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-ingestion/Cargo.lock`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/Dockerfile`. Cross-checked against Active Recommendations and runs #91–#92 (Latest Findings) plus archived dependency health runs #3, #18, #33, #48, #63, #78 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `package.json:19` — `"@types/three": "^0.181.0"` is listed under `dependencies` rather than `devDependencies`. Type declaration packages in the `@types/*` namespace contain zero runtime code — they exist solely to supply TypeScript type information at compile time. Including a type-only package in `dependencies` means it is listed as a production runtime requirement. In a Docker multi-stage build or any toolchain that prunes `devDependencies` for the production image, the package would be incorrectly included in the production artefact and installed when the project is used as a library dependency. Every other `@types/*` package in this project — `@types/google.maps` (`package.json:32`), `@types/node` (`package.json:33`), `@types/react` (`package.json:34`), `@types/react-dom` (`package.json:35`) — is correctly placed in `devDependencies`. `@types/three` is the sole outlier. The lockfile (`package-lock.json`) does not mark its entry with `"dev": true` (confirmed by scanning all `"dev": true` entries), while the other `@types/*` entries all carry `"dev": true`. PROPOSAL: Move `"@types/three": "^0.181.0"` from `dependencies` to `devDependencies` in `package.json:19` — consistent with all other `@types/*` packages in the project — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `package.json:16` — `"@googlemaps/markerclusterer": "latest"` uses npm's dist-tag `"latest"` as its version specifier, resolved to `2.6.2` in the current `package-lock.json`. Every other production dependency uses explicit semver ranges (`^` or `~`). The `"latest"` tag is not a version constraint — it is a mutable pointer that resolves to whatever is currently tagged `latest` on npm. If the package publishes a breaking major version (e.g., `3.0.0`) and tags it `latest`, any operation that regenerates or updates the lockfile (`npm install --package-lock-only`, `npm update`, Dependabot PRs, or a fresh CI clone without a committed lockfile) will silently install the breaking version. In contrast, `"^2.6.2"` would prevent installation of `3.x.x`. This is the only dependency in the project with a floating dist-tag specifier. PROPOSAL: Replace `"latest"` with `"^2.6.2"` for `@googlemaps/markerclusterer` at `package.json:16`; review all other dependencies for similar floating specifiers before each release — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/Cargo.toml:21` — `rand = "0.8"`, resolved to `0.8.5` in `Cargo.lock`. The `rand` crate published `0.9.0` (breaking release) in January 2025, with the following API removals relevant to this codebase: `thread_rng()` was removed (replaced by `rng()`), `Rng::gen::<T>()` renamed to `Rng::random::<T>()`, and `Rng::gen_range()` renamed to `Rng::random_range()`. The project uses `rand` exclusively in `aqi.rs` to simulate fake AQI history (the `generate_history()` function called from `routes/aqi.rs:66`, confirmed in run #90's finding 2). Because Cargo's semver resolution respects the `"0.8"` constraint, `cargo update` will never advance past `0.8.5` automatically. This creates a widening migration gap: as other crates in the dependency tree (e.g., future `sqlx` or `axum` releases) adopt `rand 0.9` transitive dependencies, the project may end up with two incompatible versions of `rand` in the tree. Additionally, since `generate_history()` is acknowledged as simulation-only and run #90 proposed replacing it with a real TimescaleDB query, the `rand` dependency should be a candidate for complete removal. PROPOSAL: Track `rand` for removal once the real DB query path in `routes/aqi.rs:66` is implemented (see run #90 Active Recommendations item); if retaining the fallback path, migrate `aqi.rs` from `rand 0.8` API (`thread_rng()`, `gen_range()`) to `rand 0.9` API (`rng()`, `random_range()`) and update `Cargo.toml:21` to `rand = "0.9"` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/requirements.txt:18` — `joblib>=1.4,<1.5`. joblib 1.5.0 was released, making the `<1.5` upper bound exclusive of the entire 1.5.x series. On a fresh Docker build (`FROM python:3.12-slim`; `RUN pip install --no-cache-dir -r requirements.txt`), pip resolves the latest compatible versions of all packages simultaneously. If `scikit-learn` (`requirements.txt:17`: `scikit-learn>=1.5,<1.7`) in its 1.6.x releases updated its own minimum joblib requirement to `>=1.5`, pip would find no satisfying `joblib` version and would fail the build with `ERROR: Cannot install because these package versions have conflicting dependencies`. The constraint also conflicts logically with `scikit-learn>=1.5,<1.7` — scikit-learn 1.6.x ships with joblib as a runtime dependency, and its released distributions may hard-require joblib 1.5.x. All other Python packages in the file use either a lower-bounded-only range (`>=`) or a wide upper bound. `joblib` is the only package with a tight exclusive upper bound at a released version boundary. PROPOSAL: Change `joblib>=1.4,<1.5` to `joblib>=1.4,<2` in `requirements.txt:18`; run `pip install -r requirements.txt` in a fresh environment to confirm resolution before merging — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `vite.config.ts:21,33` — The `manualChunks` configuration at lines 21–28 explicitly creates a `three-vendor` chunk containing `three`, `@react-three/fiber`, and `@react-three/drei`, with the inline comment `// Split Three.js + React Three Fiber into its own chunk (~800KB)`. The `chunkSizeWarningLimit` at line 33 is set to `500` (KB). Vite emits a build warning for every output chunk exceeding this limit. The `three-vendor` chunk is knowingly ~800KB (roughly 1.6× the configured limit), meaning every production build (`npm run build`) produces a spurious warning: `(!) Some chunks are larger than 500 kB after minification`. This warning cannot be eliminated without removing Three.js from the project. By surfacing on every build, it trains developers to ignore Vite's chunk-size warnings, which defeats the purpose of the warning mechanism — a genuinely oversized new chunk added later would be lost in the noise. The warning limit should be set at or above the maximum expected chunk size. PROPOSAL: Raise `chunkSizeWarningLimit` from `500` to `1000` in `vite.config.ts:33` and add a comment referencing the `three-vendor` chunk as the reason for the raised limit; this keeps the mechanism meaningful for unexpected growth in other chunks — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Move `"@types/three"` from `dependencies` to `devDependencies` in `package.json:19` — L/L, score 1.0
- Replace `"latest"` with `"^2.6.2"` for `@googlemaps/markerclusterer` at `package.json:16` — L/L, score 1.0
- Plan `rand` crate removal from `Cargo.toml:21` contingent on implementing real DB query in `routes/aqi.rs:66`; if retaining fallback, migrate to `rand 0.9` API — M/L, score 2.0
- Change `joblib>=1.4,<1.5` to `joblib>=1.4,<2` in `requirements.txt:18` — M/L, score 2.0
- Raise `chunkSizeWarningLimit` from `500` to `1000` in `vite.config.ts:33`; add comment explaining the Three.js chunk exemption — L/L, score 1.0

## 📚 Archive (one line per past run)
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
