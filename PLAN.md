# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-05T17:10:16Z
Last run: #169 — Lens: Perf hot paths

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
| 8 | Add retry+backoff to Rust `PurpleAirClient::fetch_sensors` | Data pipeline | H | L | 8 | Open |
| 9 | Redis-down skips all PurpleAir/earthquake polling — default toggle to ON when Redis unavailable | Data pipeline | H | L | 8 | Open |
| 10 | Upgrade `vite` from 6.4.1 to ≥6.5.0 AND change `host` from `'0.0.0.0'` to `'127.0.0.1'` in `vite.config.ts:9` — GHSA-p9ff-h696-f583 file read amplified by all-interfaces binding | Security/Dep | H | L | 168 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #169 — 2026-06-05 — Lens: Perf hot paths
**Scope:** Twelfth Perf hot paths pass. Files examined in full: `geointellisense-ingestion/src/db/persist.rs`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/routes/sse.rs`; `geointellisense-analytics/app/context.py`; `geointellisense-analytics/app/cache.py`; `geointellisense-analytics/app/routes/historical_aqi.py`; `geointellisense-analytics/app/routes/low_latency.py`; `components/MapView.tsx`; `hooks/useDashboardData.ts`; `components/3d/CityMarkers.tsx`. Cross-checked against Active Recommendations and archived Perf hot paths runs #4, #19, #34, #49, #64, #79, #94, #109, #124, #139, #154 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:5-34` — `write_readings` executes one `INSERT INTO sensor_readings … VALUES ($1…$15)` per reading inside a `for r in readings` loop (`.execute(pool).await` at line 28 is inside the loop body). Called from `broadcast.rs:115` on every broadcast tick, this generates N separate PostgreSQL round-trips for each batch — currently 6 readings → 6 sequential awaits per tick. With `broadcast_secs=10`, that is 6 network round-trips to Postgres every 10 seconds that could be 1. `sqlx::QueryBuilder` supports multi-row INSERT via `.push_values()` / `.build()` allowing a single parameterised statement for the full batch. PROPOSAL: Refactor `write_readings` to build a single multi-row INSERT using `sqlx::QueryBuilder::new("INSERT INTO sensor_readings …").push_values(readings, |mut b, r| { b.push_bind(…); })`.build().execute(pool).await` — L/L effort (no schema changes; eliminates N−1 extra DB round-trips per tick).

- OBSERVATION: `geointellisense-analytics/app/context.py:52-68` — `build_live_context()` chains 7 `await` calls sequentially (lines 61–68): `_get_aqi_context`, `_get_forecast_context`, `_get_fire_context`, `_get_earthquake_context`, `_get_water_context`, `_get_enviroscreen_context`, `_get_prediction_context`. The in-code comment on line 60 acknowledges this: "Run all queries concurrently-ish (asyncpg handles connection pooling)" — but asyncpg pooling does NOT parallelize sequential awaits; it only prevents connection starvation. Each awaited function executes at least one DB query before the next begins. If each query takes ~50 ms the total latency floor is 350 ms; with asyncio.gather() it collapses to ~50 ms (the slowest single query). `build_live_context` is called on every Claude AI request path, so this directly inflates AI response latency. PROPOSAL: Replace the seven sequential awaits with a single `results = await asyncio.gather(_get_aqi_context(pool), _get_forecast_context(pool), _get_fire_context(pool), _get_earthquake_context(pool), _get_water_context(pool), _get_enviroscreen_context(pool), _get_prediction_context(pool))` and then unpack into `context["aqi"] = results[0]` etc. — L/L effort (a mechanical rewrite of 8 lines; all functions are already async and independent).

- OBSERVATION: `components/MapView.tsx:232-374` — The single `useEffect` that renders all map markers lists `[layers, aqiData, firesData, quakeData, waterData, wellsData, wqData]` as dependencies (line 375 equivalent). On every execution it first destroys all existing markers via `markersRef.current.forEach(m => m.setMap(null))` and `clustererRef.current.clearMarkers()` (lines 237–239), then rebuilds every marker from scratch via `new google.maps.Marker(…)` in per-layer `for` loops. AQI data refreshes every 30 s; fires/quakes/water every 5–15 min. Each AQI refresh therefore triggers full teardown + DOM reallocation of all layer markers simultaneously, not just the AQI layer. `MarkerClusterer` re-computation (line 371) is O(n log n) over all markers. With 50+ markers across layers, this produces a visible 100–200 ms render stall on every AQI tick. PROPOSAL: Split the monolithic `useEffect` into one `useEffect` per data layer, each managing only its own markers in `markersRef` sub-arrays, so a fire-data update does not tear down and recreate AQI markers — M/M effort (4–5 focused effects + per-layer ref arrays).

- OBSERVATION: `geointellisense-analytics/app/routes/low_latency.py:31-36` — `get_client().messages.create(…)` (line 31) calls the Anthropic Python SDK's **synchronous** `messages.create` method directly inside an `async def` handler. The SDK's sync `create` method performs a blocking HTTP request (via `httpx` without `await`) that holds the asyncio event loop for the full round-trip duration — typically 1–5 s for `claude-haiku-4-5-20251001`. During that interval no other request in the FastAPI process can be served, including health checks and lower-cost endpoints. With 3+ concurrent low-latency requests the handlers queue up, producing tail latencies of 3–15 s. The async Anthropic client (`AsyncAnthropic`) is already a first-class SDK offering and the client factory in `claude.py` could expose it alongside the existing sync client. PROPOSAL: Switch `get_client()` in `claude.py` to return `anthropic.AsyncAnthropic(…)`; change `resp = get_client().messages.create(…)` at `low_latency.py:31` to `resp = await get_client().messages.create(…)` (also applies to `chat.py`, `deep_analysis.py`, `predictive_analysis.py`, `weather_forecast.py`) — M/L effort (change client factory + 5 call sites; eliminates event-loop stall on every AI request).

**Proposed actions:**
- Refactor `persist.rs:5-34` `write_readings` to single multi-row INSERT via `sqlx::QueryBuilder` — L/L effort (eliminates N−1 DB round-trips per broadcast tick)
- Replace sequential awaits in `context.py:61-68` with `asyncio.gather()` — L/L effort (reduces AI context build latency from ~350 ms to ~50 ms)
- Split `MapView.tsx:232-374` monolithic marker `useEffect` into per-layer effects — M/M effort (eliminates full marker teardown on every AQI data refresh)
- Switch Anthropic SDK calls from sync to async (`low_latency.py:31` and 4 other route files) — M/L effort (unblocks asyncio event loop during AI requests)

### Run #168 — 2026-06-05 — Lens: Dependency health
**Scope:** Twelfth Dependency health pass. Tools used: `npm audit --json`; `package-lock.json` version inspection via Node.js; `Cargo.lock` direct grep; `requirements.txt`; `package.json`; `vite.config.ts`. Compared against Active Recommendations and archived Dependency health lens runs #3, #18, #33, #48, #63, #78, #93, #108, #123, #138, #153 to confirm findings are new.

**Findings:**

- OBSERVATION: `package.json:42` declares `"test:ui": "vitest --ui"` and installs `vitest@4.0.13` (from `package-lock.json`). The current npm advisory database flags `vitest ≤4.1.0-beta.6` as CRITICAL under GHSA-5xrq-8626-4rwp ("When Vitest UI server is listening, arbitrary file can be read and executed", CVSS 9.8, CWE-862 — Missing Authorization). The `--ui` flag starts the Vitest browser UI server, which exposes a WebSocket endpoint that the advisory identifies as the attack surface. At CVSS 9.8 this is network-exploitable without authentication. The same advisory propagates to `@vitest/coverage-v8@4.0.13` and `@vitest/ui@4.0.13` (both `package.json:46,47`). `npm audit` confirms `fixAvailable: true` — `npm audit fix` can upgrade all three to ≥4.1.0. PROPOSAL: Run `npm audit fix` (or manually bump vitest/\@vitest\/ui/\@vitest\/coverage-v8 to `^4.1.0`) and commit the updated `package-lock.json` — L/L effort (one command; no API changes required by vitest 4.1.0).

- OBSERVATION: `package.json:28` declares `"react-router-dom": "^7.9.6"`; `package-lock.json` resolves both `react-router` and `react-router-dom` to `7.9.6`. The npm advisory database lists **9 active advisories** against the range `7.0.0–7.14.2`, including: GHSA-49rj-9fvp-4h2h ("React Router's vendored turbo-stream v2 allows arbitrary constructor invocation via TYPE_ERROR deserialization leading to Unauth RCE", CVSS 8.1, CWE-502); GHSA-2w69-qvjg-hvjx ("React Router vulnerable to XSS via Open Redirects", CVSS 8.0, CWE-79); GHSA-8v8x-cx79-35w7 ("React Router SSR XSS in ScrollRestoration", CVSS 8.2, CWE-79); GHSA-h5cw-625j-3rxh ("CSRF issue in Action/Server Action Request Processing", CVSS 6.5, CWE-346/352); GHSA-8x6r-g9mw-2r78 (DoS via `__manifest` endpoint, CVSS 7.5); and four further XSS/redirect advisories. The project uses `react-router-dom` for client-side routing (SPA mode) without SSR, so SSR-specific advisories like `ScrollRestoration` XSS have reduced impact; however GHSA-49rj-9fvp-4h2h (turbo-stream deserialization) and GHSA-h5cw-625j-3rxh (CSRF in action processing) can affect any application using React Router v7 data mode. The fix for all 9 advisories requires upgrading to ≥7.14.3. The `^7.9.6` semver range in `package.json` allows `npm install` to resolve to a patched version automatically. PROPOSAL: Run `npm install react-router-dom@^7.14.3` (or `npm audit fix`) and commit the updated lockfile — L/L effort.

- OBSERVATION: `package.json:16` declares `"@googlemaps/markerclusterer": "latest"`. This is the **only** production dependency (out of all 10 in `dependencies`) using the `latest` dist-tag instead of a semver range. The `package-lock.json` currently freezes it at `2.6.2`, so `npm ci` in CI is deterministic. However, any developer running `npm install` (which updates the lockfile) or any environment using a fresh `npm install` without the lockfile will silently advance to whatever the npm registry considers `latest` at that moment — which could include a future v3.x with a breaking API. The `@googlemaps/markerclusterer` package is used in `components/MapView.tsx` (Google Maps marker clustering); a breaking-change update would not be caught by TypeScript types until runtime, since `@types/google.maps` is separately versioned. The package.json `latest` also makes `npm outdated` reports noisy and prevents Dependabot/Renovate from calculating a meaningful semver bump target. PROPOSAL: Replace `"latest"` with `"^2.6.2"` (the currently installed version) in `package.json:16` — L/L effort (one-line change; eliminates the non-reproducible dependency).

- OBSERVATION: `vite.config.ts:9` sets `host: '0.0.0.0'`, binding the Vite development server to all network interfaces. `package-lock.json` resolves `vite` to `6.4.1`. The npm advisory database flags `vite ≤6.4.1` under GHSA-p9ff-h696-f583 ("Vite Vulnerable to Arbitrary File Read via Vite Dev Server WebSocket", CWE-200/306). The two issues compound: the file-read vulnerability uses the Vite dev server WebSocket endpoint (`__vite_hmr`), and the `host: '0.0.0.0'` configuration makes that endpoint reachable from any host on the same network — not just `localhost`. In a Docker-based or shared CI environment (which this project uses, given `docker-compose.yml`), any process or container on the bridge network can connect to the Vite WebSocket and read arbitrary files from the developer's machine or container. The `host: '0.0.0.0'` was likely set to expose the Vite dev server from inside a Docker container to the host machine, but it also widens the attack surface for the known CVE. Fix requires two coordinated changes: (1) upgrade `vite` to ≥6.5.0 in `package.json:48`; (2) change `host` in `vite.config.ts:9` to `'127.0.0.1'` unless Docker networking genuinely requires it, or document the network-trust assumption explicitly. PROPOSAL: Bump `vite` to `^6.5.0` in `package.json`; change `host: '0.0.0.0'` to `host: '127.0.0.1'` (or use Docker's `--network host` only for the container that needs it) in `vite.config.ts:9` — L/L effort (two-line change + lockfile update).

**Proposed actions:**
- Upgrade `vitest`/`@vitest/ui`/`@vitest/coverage-v8` to `^4.1.0` in `package.json`; run `npm audit fix`; commit lockfile — L/L effort (eliminates CVSS 9.8 GHSA-5xrq-8626-4rwp)
- Upgrade `react-router-dom` to `^7.14.3` in `package.json`; commit lockfile — L/L effort (closes 9 advisories including CVSS 8.1 RCE GHSA-49rj-9fvp-4h2h)
- Replace `"@googlemaps/markerclusterer": "latest"` with `"^2.6.2"` in `package.json:16` — L/L effort (makes production dependency reproducible)
- Bump `vite` to `^6.5.0`; change `host: '0.0.0.0'` to `host: '127.0.0.1'` in `vite.config.ts:9` — L/L effort (closes GHSA-p9ff-h696-f583 file-read advisory and reduces network exposure of dev WebSocket)

### Run #167 — 2026-06-05 — Lens: Module boundaries
**Scope:** Twelfth Module boundaries pass. Files examined in full: `hooks/useRealtimeAQI.ts`; `components/3d/CityMarkers.tsx`; `components/3d/index.ts`; `services/aiService.ts`; `services/dataService.ts`; `services/AirQualityService.ts`; `services/WeatherService.ts`; `hooks/useLiveData.ts`; `components/MapView.tsx`; `components/SettingsView.tsx`; `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/context.py`; `geointellisense-analytics/app/routes/fires.py`; `geointellisense-analytics/app/routes/water.py`; `geointellisense-analytics/app/routes/inversion.py`; `geointellisense-analytics/app/source_toggles.py`; `geointellisense-analytics/app/main.py`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/routes/mod.rs`. Cross-checked against Active Recommendations and Latest Findings runs #164–#166 plus archived Module boundaries lens runs #2, #17, #32, #47, #62, #77, #92, #107, #122, #137, #152 to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` imports `type { CityData } from '../components/3d/CityMarkers'` — a hook (shared logic layer) taking a compile-time dependency on a component (presentation layer). The canonical dependency direction is `components → hooks → services → utils/types`. `useRealtimeAQI` then declares `RealtimeCityData extends CityData` at line 15, embedding the component-sourced interface into the hook's own public API. `CityData` (id, name, lat, lng, aqi, temperature, humidity, windSpeed, pm25) is a pure data shape with no rendering concern; it belongs in `types.ts` alongside the project's other domain interfaces. As long as `CityData` lives in `CityMarkers.tsx`, any test or non-3D consumer of `useRealtimeAQI` must bundle the full 3D component module (which pulls in `@react-three/fiber`, `@react-three/drei`, `THREE`) just to use the hook's type-level API. `components/3d/index.ts:16` already re-exports `type { CityData }` from `CityMarkers`, making the hook's direct deep import unnecessary even on the current path. PROPOSAL: Move `CityData` to `types.ts`; update `CityMarkers.tsx` to import it from there; update `useRealtimeAQI.ts:8` to import from `../types` — L/L effort (move one interface, update 2 imports).

- OBSERVATION: `geointellisense-analytics/app/claude.py:103` contains a guarded runtime import `from app.routes.fires import get_current_smoke_context` executed inside the `get_system_with_live_context` async function's fallback branch. `claude.py` is the core LLM-orchestration module (client factory, session store, system-prompt assembly); `routes/fires.py` is an HTTP route module in the presentation layer. The dependency direction is inverted: core orchestration is importing from a route handler. `fires.py:25` even documents this inversion: the function is named "Called by Claude AI routes to inject fire context" — acknowledging that the route module serves its own caller in a non-HTTP, non-route capacity. The function `get_current_smoke_context()` returns module-level state `_smoke_context` (a string updated by the fire poller background task). Moving this state and its getter to `context.py` (which already owns live-data assembly for system prompts) or to a new `app/state.py` singleton would sever the upward dependency; `fires.py` would call into `context`/`state` to update the value, and `claude.py` would read it from there — restoring the correct direction. PROPOSAL: Extract `_smoke_context` and `get_current_smoke_context()` from `fires.py` into `app/context.py` or a dedicated `app/state.py`; have the fire poller update context/state; remove the `from app.routes.fires` import in `claude.py:103` — M/M effort (add one module or extend context.py; update 2 import sites).

- OBSERVATION: `services/aiService.ts:4-6`, `services/WeatherService.ts:3-8`, `services/AirQualityService.ts:1-3`, `services/dataService.ts:6-8`, `hooks/useLiveData.ts:15-16`, `components/MapView.tsx:16`, `components/SettingsView.tsx:208,364` — the two service base URLs (gateway: `VITE_GATEWAY_URL || 'http://localhost:8080'`; ingestion: `VITE_INGESTION_URL || 'http://localhost:3001'`) are independently computed in **eight** locations across the codebase, using inconsistent local constant names (`API_BASE_URL`, `ANALYTICS_URL`, `GATEWAY_URL`, `INGESTION_URL`). There is no shared `config.ts` or `constants.ts` at the project root that exports these resolved URLs. Two of these eight sites are component files (`MapView.tsx:16`, `SettingsView.tsx:208`) — components should not compute service topology constants directly. If the default fallback port changes or a new service tier is added, all eight sites require a coordinated update. A single `src/config.ts` exporting `GATEWAY_BASE` and `INGESTION_BASE` would reduce the duplication to one file and allow components to import from the services or config layer. PROPOSAL: Create `config.ts` at project root exporting `GATEWAY_BASE` and `INGESTION_BASE`; replace all 8 inline computations with imports — L/L effort (1 new file + 8 import updates, purely mechanical).

- OBSERVATION: `hooks/useLiveData.ts:49-51` — the generic data-fetching hook contains inline service-routing logic: `const base = path.startsWith('/api/aqi-') || path === '/health' ? INGESTION_URL : GATEWAY_URL`. This makes the "generic" hook aware of the internal two-service topology: which URL path prefixes belong to the Rust ingestion service (port 3001) vs. the Python analytics gateway (port 8080). A caller using `useLiveData('/api/airnow/current')` will silently route to the gateway; a caller using `useLiveData('/api/aqi-snapshot')` silently routes to the Rust service — neither caller can see or override this behavior without reading the hook's internals. If the analytics service ever adds an `/api/aqi-*` endpoint (e.g., for historical AQI), the path-prefix check would misroute it to the ingestion service. The fix is to expose the routing decision as an explicit option: `useLiveData<T>(path, { service?: 'gateway' | 'ingestion', ... })` so callers declare intent rather than relying on a magic path-string check. PROPOSAL: Add a `service?: 'gateway' | 'ingestion'` option to `UseLiveDataOptions` in `useLiveData.ts:20-23`; replace the `path.startsWith` heuristic with `options.service === 'ingestion' ? INGESTION_URL : GATEWAY_URL`; update all `useLiveData` call sites that need the ingestion service to pass `{ service: 'ingestion' }` — M/L effort (update hook interface + ~10 call sites).

**Proposed actions:**
- Move `CityData` interface from `components/3d/CityMarkers.tsx` to `types.ts`; update `useRealtimeAQI.ts:8` import to `../types` — L/L effort (eliminates hook → component layer inversion)
- Extract `_smoke_context`/`get_current_smoke_context()` from `app/routes/fires.py:25` into `app/context.py` or `app/state.py`; remove runtime `from app.routes.fires` import in `claude.py:103` — M/M effort (restores correct core → routes dependency direction)
- Create `config.ts` at project root exporting `GATEWAY_BASE` and `INGESTION_BASE`; replace 8 inline URL computations across services, hooks, and components — L/L effort (eliminates duplicated service topology constants)
- Replace path-prefix heuristic in `useLiveData.ts:49-51` with explicit `service?: 'gateway' | 'ingestion'` option — M/L effort (makes routing intent explicit and future-proof)

## 📚 Archive (one line per past run)
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
