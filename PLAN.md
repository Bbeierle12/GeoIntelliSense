# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T13:10:00Z
Last run: #57 — Lens: Deployment / Docker

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
### Run #57 — 2026-05-30 — Lens: Deployment / Docker
**Scope:** Fifth Docker/deployment pass. Examined: `geointellisense-ingestion/Dockerfile`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/.dockerignore`, `geointellisense-analytics/.dockerignore`, `docker-compose.yml`, `Caddyfile`, `geointellisense-analytics/requirements.txt`, `geointellisense-analytics/app/main.py`, `geointellisense-analytics/app/ml/`, `geointellisense-ingestion/src/main.rs`. All findings verified as new against all visible prior-run detail and Active Recommendations (prior Docker runs #12, #27, #42 archived).

**Findings:**

- OBSERVATION: `docker-compose.yml:119-135` — The `gateway` service (Caddy) is the sole external entry point for all traffic yet has no `healthcheck:` block. Every other service — `db` (line 16), `redis` (line 35), `ingestion` (line 67), `analytics` (line 109) — defines a healthcheck with `interval`, `timeout`, `retries`, and `start_period`. The `gateway` service uses `condition: service_healthy` on its dependencies (`ingestion` and `analytics` at lines 129–132), so Docker correctly waits for both upstreams before starting Caddy — but there is no reciprocal check that Caddy itself is serving. If the `Caddyfile` fails to parse (syntax error introduced during development), Caddy exits immediately; `docker compose up` prints no error and returns exit 0 because there is nothing to declare unhealthy. Any CI pipeline using `docker compose up --wait` would report success despite the gateway being dead. Any client or integration test that connects immediately after `docker compose up` (without manual sleeping) may hit a closed port. PROPOSAL: Add to the `gateway` service: `healthcheck: { test: ["CMD", "curl", "-sf", "http://localhost:8080"], interval: 10s, timeout: 5s, retries: 5, start_period: 10s }`. Caddy's alpine image ships with `curl`; `curl -sf` on the gateway's catch-all `respond "GeoIntelliSense API Gateway" 200` rule (Caddyfile line 24) returns HTTP 200 only when Caddy has fully loaded its config and is accepting connections.

- OBSERVATION: `geointellisense-analytics/Dockerfile:3` — The analytics runtime image installs `libgdal-dev` as its only system dependency. On Debian Bookworm (the base for `python:3.12-slim`), the `-dev` suffix indicates a package that includes C headers (`.h` files), static libraries (`.a` archives), and `pkgconfig` (`.pc`) files required only when compiling C extensions against GDAL — not at runtime. The runtime-only shared library package is `libgdal34t64`. `rasterio==1.4.*` (in `requirements.txt:13`) ships as a pre-compiled binary wheel for linux/amd64 on PyPI that bundles GDAL's shared library inside the wheel (`rasterio.libs/libgdal.so.*`), meaning zero system GDAL installation is required for either install or runtime. `geopandas==1.0.*` similarly depends on `rasterio` and `shapely`, both of which are pre-compiled. The `libgdal-dev` installation adds approximately 35–50MB of header files and static libs to the runtime image with no benefit; it was likely a vestige of an earlier source-compilation approach. PROPOSAL: Remove `libgdal-dev` from `Dockerfile:3-5` entirely; verify with `docker build` followed by `docker run ... python -c "import rasterio, geopandas"` that both imports succeed without it. If any wheel falls back to a source build and requires GDAL headers, add only `libgdal34t64` (the runtime library) as a targeted fix rather than reinstating the full `-dev` package.

- OBSERVATION: `geointellisense-ingestion/Dockerfile` and `geointellisense-analytics/Dockerfile` — Neither Dockerfile includes a `USER` directive. The ingestion binary (`geointellisense-ingestion`) runs as root in a `debian:bookworm-slim` container; the analytics service (`uvicorn app.main:app`) runs as root in a `python:3.12-slim` container. Running production services as root violates CIS Docker Benchmark Recommendation 4.1 ("Ensure that a non-root user is used") and Docker's own best-practice documentation. In the analytics container, root access to the volume mount paths `/app/data/dem`, `/app/data/landsat`, and `/app/data/models` (docker-compose.yml lines 101–103) means a compromised analytics service (e.g., via an SSRF vulnerability in one of the 30+ routes that fetch external URLs, or a path traversal in `elevation.py` or `landsat.py`) has write access to all persistent data volumes and the full container filesystem. In the ingestion container, the Rust binary runs with root privileges in a container that also has `libssl3` and `curl` installed — both of which could be leveraged in a container escape. PROPOSAL: Ingestion: add before `EXPOSE 3001`: `RUN useradd --system --uid 1001 --gid 0 appuser` then `USER 1001`. Analytics: add before `CMD`: `RUN addgroup --system app && adduser --system --ingroup app --uid 1001 appuser && chown -R appuser:app /app` then `USER appuser`. The analytics volume mounts (`demdata`, `landsatdata`, `modeldata`) may require `user: "1001:0"` in `docker-compose.yml` or an entrypoint `chown` to handle volume directory ownership on first start.

- OBSERVATION: `geointellisense-ingestion/Dockerfile:11` — The dummy-build layer reads `RUN cargo build --release 2>/dev/null || true`. The intent is to cache compiled dependency artifacts by building against an empty `main.rs` before copying real source; this is a valid layer-cache pattern. However, `2>/dev/null || true` swallows ALL stderr output and forces exit 0 regardless of error type. If the dependency compilation fails for a real reason — `pkg-config libssl-dev` not found (misconfigured base layer), `cargo fetch` network timeout from crates.io, or an incompatible dependency version — the `|| true` forces a successful exit, the layer is cached with incomplete artifacts, and the subsequent `RUN touch src/main.rs && cargo build --release` at line 14 fails with a confusing error (linker error, missing crate artifact, or "error: failed to compile" with no context) that has no relationship to the actual root cause. Debugging a Docker build broken this way requires adding `|| true ; cat /app/target/build-*/stderr` or similar archaeology. The `2>/dev/null` also prevents the build log from being preserved in `docker build --progress=plain` output, eliminating the audit trail. PROPOSAL: Replace line 11 with `RUN cargo build --release || true` — remove only `2>/dev/null` so that stdout/stderr is visible in `docker build` output even when the command nominally fails. This preserves the layer-cache intent while making real failures diagnosable. For added robustness, split into `RUN cargo fetch` (always succeeds cleanly or fails cleanly on network error) followed by `RUN cargo build --release || true` (dummy build may fail, output visible).

- OBSERVATION: `geointellisense-analytics/.dockerignore` — The file excludes `__pycache__`, `*.pyc`, `.venv`, `.env`, `.git` but omits several categories of files that can substantially inflate the Docker build context and resulting image layer. (a) `app/ml/` contains `aqi_model.py` and `__init__.py`; when the ML model trainer runs locally (via `POST /api/predict/train` or direct invocation), joblib persists trained scikit-learn models (RandomForest, gradient boosted) to `MODEL_DIR` — which defaults to `./data/models` (relative to `cwd`) but could also write intermediate artifacts to `app/ml/`. Scikit-learn models for environmental datasets with 100+ features routinely reach 50–200MB as `.pkl`/`.joblib` files. (b) The analytics `COPY . .` at line 12 copies everything not in `.dockerignore`, including `app/ml/__init__.py`, any local `.pytest_cache/`, any `*.egg-info/` from a local `pip install -e .`, and any local `data/` subdirectory. If a developer has pre-populated a `data/dem/` or `data/landsat/` directory (GeoTIFF DEM tiles are 200–500MB each), those will be included in the build context, causing the `docker build` command to spend minutes transferring them to the Docker daemon before a single `FROM` instruction runs. PROPOSAL: Extend `geointellisense-analytics/.dockerignore` with: `**/*.pkl`, `**/*.joblib`, `**/*.egg-info/`, `.pytest_cache/`, `data/`, `*.md` (optional). Additionally add `**/__pycache__/` and `**/*.pyc` using glob patterns (the current `__pycache__` entry without `**/` only excludes the root-level directory).

**Proposed actions:**
- Add `healthcheck` block to `gateway` service in `docker-compose.yml:135` — M/L, score 2.0; does not enter top 10
- Remove `libgdal-dev` from `geointellisense-analytics/Dockerfile:3`; verify pre-compiled rasterio/geopandas wheels need no system GDAL — L/L, score 1.0; does not enter top 10
- Add non-root `USER` to both Dockerfiles: `USER 1001` in ingestion, `USER appuser` in analytics — M/L, score 2.0; does not enter top 10
- Replace `2>/dev/null || true` with `|| true` (remove stderr suppression) at `geointellisense-ingestion/Dockerfile:11` — M/L, score 2.0; does not enter top 10
- Extend `geointellisense-analytics/.dockerignore` with `**/*.pkl`, `**/*.joblib`, `data/`, `.pytest_cache/`, `**/__pycache__/` — L/L, score 1.0; does not enter top 10

### Run #56 — 2026-05-30 — Lens: Docs
**Scope:** Fourth docs pass. Examined: `README.md`, `IMPLEMENTATION_STATUS.md`, `.env.local.example`, `package.json`, `docker-compose.yml`, `Caddyfile`, `geointellisense-analytics/app/main.py`, `geointellisense-analytics/app/config.py`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-ingestion/src/main.rs`, `geointellisense-ingestion/src/config.rs`. Confirmed no README exists in `geointellisense-ingestion/` or `geointellisense-analytics/`. Findings verified as new against all visible prior-run detail and Active Recommendations (prior docs run details #11, #26, #41 archived).

**Findings:**

- OBSERVATION: `README.md:38-51` — The README references two npm scripts that do not exist in `package.json`: `npm run dev:full` (line 38) and `npm run server` (lines 44-47). `package.json:6-14` defines only `dev`, `build`, `preview`, `test`, `test:ui`, `test:run`, and `test:coverage`. A developer following the README's "Run Locally" instructions will hit `npm error Missing script: "dev:full"` immediately. Additionally, line 51 instructs the developer to open `http://localhost:5174`, but the Caddy API gateway (`docker-compose.yml:122-135`) is exposed on `${GATEWAY_PORT}:8080` — port 5174 is the Vite dev server for the frontend only, not the unified API+frontend endpoint. The correct development workflow is `docker compose up -d` (to start db, redis, ingestion, analytics, and gateway) followed by `npm run dev` (for the Vite frontend), with the full app accessible at `http://localhost:8080` (or whatever `GATEWAY_PORT` is set to). The README describes none of this. PROPOSAL: Rewrite the "Run Locally" section of `README.md` to document: (1) Docker + Node.js as prerequisites; (2) `cp .env.local.example .env` with a note that `.env` (not `.env.local`) is what `docker-compose.yml` reads via `${VAR}` substitution; (3) `docker compose up -d` as the backend start command; (4) `npm run dev` as the frontend start command; (5) the gateway URL vs. the Vite dev server URL.

- OBSERVATION: `.env.local.example:1-17` — The example env file documents only 5 variables: `ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`. However `docker-compose.yml` performs variable substitution on at least 17 additional undocumented variables: `POSTGRES_USER` (line 8), `POSTGRES_PASSWORD` (line 9), `POSTGRES_DB` (line 10), `DB_PORT` (line 11), `REDIS_PORT` (line 30), `INGESTION_PORT` (line 61), `ANALYTICS_PORT` (line 99), `GATEWAY_PORT` (line 123), `AIRNOW_API_KEY` (line 87), `NOAA_CDO_TOKEN` (line 88), `NASA_FIRMS_KEY` (line 89), `EPA_AQS_EMAIL` (line 90), `EPA_AQS_KEY` (line 91), `CENSUS_API_KEY` (line 92), `ADMIN_TOKEN` (lines 59, 97), `PURPLEAIR_INTERVAL_SECS` (line 56), `BROADCAST_INTERVAL_SECS` (line 57). When these are absent from `.env`, Docker substitutes empty strings: the Postgres service starts with blank credentials and immediately fails its healthcheck; the analytics service starts without `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, `EPA_AQS_EMAIL`, `EPA_AQS_KEY`, and `CENSUS_API_KEY`, silently degrading all affected data sources (AirNow, NOAA, NASA FIRMS, EPA AQS, Census). A first-time developer copying `.env.local.example` to `.env` will get a broken stack with no explanation. PROPOSAL: Add all 17 missing variables to `.env.local.example` with comments explaining what each is for, what service it connects to, whether it is required or optional, and where to obtain it (e.g., `# EPA AQS credentials — required for historical air quality data; register free at https://aqs.epa.gov/aqsweb/documents/data_api.html`). This is H/L — high impact (blocks any new developer from getting the project running), low effort (one file addition with comments).

- OBSERVATION: `geointellisense-ingestion/` and `geointellisense-analytics/` — Neither sub-project directory contains a README file. `geointellisense-ingestion/` is a Rust Axum service that exposes 7 HTTP endpoints (AQI stream/snapshot/history, earthquake cache, admin, health, SSE) and runs two background pollers (PurpleAir sensor ingestion, USGS earthquake fetching). `geointellisense-analytics/` is a Python FastAPI service with 30+ registered routers (`main.py:80-111`) and four background polling tasks (fires, water, inversion, ML retrain). Neither service documents: (a) minimum language toolchain versions (`rustc` version for ingestion; Python version for analytics); (b) the standalone run command and required env vars for local development outside Docker (`DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY` for analytics; `DATABASE_URL`, `REDIS_URL`, `PORT` for ingestion); (c) the full list of exposed API endpoints with their path, method, auth requirement, and brief description; (d) the external APIs each service calls (ingestion: PurpleAir, USGS; analytics: Anthropic, AirNow, NOAA CDO, NASA FIRMS, EPA AQS, US Census, NWS, USGS Water, CalEnviroScreen). A developer wanting to work on one service in isolation has no starting point beyond reading all source files. PROPOSAL: Create `geointellisense-ingestion/README.md` and `geointellisense-analytics/README.md`, each covering: what the service does, prerequisites, standalone dev run command, environment variables table (name/required/default/description), exposed endpoints table, and which external APIs it calls.

- OBSERVATION: `IMPLEMENTATION_STATUS.md:108-120` — The "Next Steps / Phase 4: Polish & Production Readiness" section lists items as unimplemented TODO work: "Add patterns to charts for colorblind users" and "Implement proper ARIA labels" (lines 113-114); "Return structured errors from services" and "Add retry mechanisms" (lines 118-119). However, in the current repo: `components/AccessibleChart.tsx` and `components/AccessibleChartWrapper.tsx` already exist and implement accessible chart patterns and ARIA roles; `utils/errorHandling.ts` implements `DataServiceError`, `withRetry`, `toDataServiceError`, and `logError`. These Phase 4 items have been implemented since at least Run #1 (the earliest archived run). The "Next Steps" section creates false work signals: a developer skimming the file would add Phase 4 to their task list despite the work already being done. Furthermore, the "Architecture" diagram at lines 147-153 shows only `Frontend → Rust Ingestion` and `Frontend → Python Analytics` but omits the Caddy API gateway, Redis cache layer, and TimescaleDB+PostGIS — all three of which are active, named services in `docker-compose.yml`. PROPOSAL: Update `IMPLEMENTATION_STATUS.md`: mark Phase 4 items as complete with the relevant file paths; update the architecture diagram to include Caddy gateway (port 8080), Redis (port 6379), and TimescaleDB/PostGIS (port 5432) in the correct topology.

- OBSERVATION: `geointellisense-analytics/app/config.py:4-17` — The `Settings` class defines 10 configuration fields with no field-level documentation of any kind: no docstring on the class, no `Field(description=...)` on any field, no inline comments. The field names `epa_aqs_email` and `epa_aqs_key` are not self-explanatory to developers unfamiliar with the EPA AQS (Air Quality System) Data API, which requires an email-address username and a separate token key. `noaa_cdo_token` is a NOAA Climate Data Online API bearer token, distinct from a generic "API key". `nasa_firms_key` is a NASA FIRMS (Fire Information for Resource Management System) MAP_KEY used in GeoTIFF download requests — its format and acquisition path differ from all other keys. None of this is explained anywhere in the codebase. `pydantic-settings`'s `BaseSettings` supports `Field(description="...", alias="ENV_VAR_NAME")` annotations that propagate into FastAPI's generated `/docs` (OpenAPI) schema — meaning this is self-documenting at zero runtime cost. Currently the analytics service's `/docs` endpoint shows all settings fields as bare string/int types with no description. PROPOSAL: Add a class docstring to `Settings` listing all required vs optional fields; apply `Field(default="", description="...")` to each field at `config.py:5-16`, using the description text to explain the API, where credentials are obtained, and the expected format (email, token, API key, URL).

**Proposed actions:**
- Rewrite `README.md` "Run Locally" section to document Docker prerequisite, correct npm scripts, backend vs. frontend ports, and `.env` vs `.env.local` distinction — M/L, score 2.0; does not enter top 10
- Add all 17 missing variables to `.env.local.example` with per-variable descriptions and acquisition links — H/L, score 3.0; ties current top 10, does not displace
- Create `geointellisense-ingestion/README.md` and `geointellisense-analytics/README.md` documenting prerequisites, run commands, env vars, endpoints, and external APIs — M/M, score 1.0; does not enter top 10
- Update `IMPLEMENTATION_STATUS.md`: mark completed Phase 4 items; add Caddy/Redis/TimescaleDB to architecture diagram — L/L, score 1.0; does not enter top 10
- Add `Field(description=...)` annotations and a class docstring to `Settings` in `config.py:4-17` — M/L, score 2.0; does not enter top 10

### Run #55 — 2026-05-30 — Lens: Observability
**Scope:** Fourth observability pass. Examined: `geointellisense-analytics/app/cache.py`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/main.py`, `geointellisense-analytics/app/routes/fires.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/routes/inversion.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/routes/admin.py`, `geointellisense-analytics/app/routes/health.py`, `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-ingestion/src/routes/health.rs`, `services/aiService.ts`, `utils/errorHandling.ts`, `hooks/useApiStatus.ts`, `components/ErrorBoundary.tsx`. Prior observability run details (runs #10, #25, #40) archived; confirmed Active Recommendations from prior passes: rows #8 (no logging config in `main.py`) and #9 (health checks static `"ok"`). Findings below verified as new against all visible prior-run detail and Active Recommendations.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/cache.py:70,73` — `get_cached()` logs cache hits at `logger.info` level (line 70: `logger.info("cache HIT %s", key)`) and misses also at `logger.info` level (line 73: `logger.info("cache MISS %s", key)`), while `set_cached()` at line 85 already uses `logger.debug("cache SET %s ttl=%ds", key, ttl)`. Every GET call to the API — of which there are 30+ routes, each calling `get_cached()` at the start of the handler — emits an INFO-level log entry. At a modest 10 requests/minute across routes, this produces 10+ INFO log lines per minute from cache operations alone, swamping actual application events like poll failures and auth errors. This inconsistency creates a direct dilemma when fixing Active Recommendations row #8 (adding a logging config to `main.py`): if `level=INFO` is chosen, cache checks flood the log; if `level=WARNING` is chosen to suppress cache noise, the poll-loop `logger.info()` calls in `fires.py:54`, `water.py:44`, and `inversion.py:50-55` are also silenced, eliminating all operational visibility into background polling. PROPOSAL: Change `logger.info("cache HIT %s", key)` at `cache.py:70` and `logger.info("cache MISS %s", key)` at `cache.py:73` to `logger.debug(...)`, aligning with the `cache SET` level at line 85. This is a two-line change that makes all three cache event levels consistent at `DEBUG` and unblocks a clean `INFO`-level logging config in `main.py`.

- OBSERVATION: `services/aiService.ts:8-186` — All seven AI service functions (`getChatResponse`, `getGroundedSearchResponse`, `getGroundedMapsResponse`, `getLowLatencyResponse`, `getDeepAnalysisResponse`, `getPredictiveAnalysisResponse`, `getWeatherForecastResponse`) follow the same pattern: `catch (error) { console.error("Error in getXResponse:", error); return "hardcoded fallback string" }`. `console.error()` emits only to browser devtools — no structured record exists in any log store. The `logError()` utility at `utils/errorHandling.ts:305-323` (formats `DataServiceError` with `code`, `retryable` flag, and ISO timestamp), `withRetry()` at `utils/errorHandling.ts:217-249`, and `toDataServiceError()` at `utils/errorHandling.ts:112-187` exist in the codebase for precisely this use case but are never imported by `aiService.ts`. Concretely: when the analytics backend returns 429 with `{"retryAfter": 15, "error": "Rate limit exceeded"}`, the frontend receives an HTTP error, the `throw new Error("HTTP error! status: 429")` at (e.g.) `aiService.ts:19` is caught at line 24, `console.error` emits to devtools, and the user sees `"Sorry, I encountered an error. Please try again."` — with no timing guidance and no retry attempt. A 429 (retryable, transient) is completely indistinguishable from a 503 or a DNS failure at the UI layer. PROPOSAL: Import `withRetry`, `toDataServiceError`, and `logError` from `utils/errorHandling.ts`; in each catch block, replace `console.error(...)` with `logError(error, "getChatResponse")`; wrap each `fetch` call with `withRetry(() => fetch(...), { maxRetries: 2, onRetry: (n, e, d) => logError(e, ...) })` — the `isRetryable` check in `withRetry` already distinguishes 429 and 5xx from auth errors via `toDataServiceError`.

- OBSERVATION: `geointellisense-ingestion/src/routes/sse.rs:13,19,57-65` — `CLIENT_COUNT: AtomicUsize` at line 13 is incremented via `fetch_add(1, Ordering::Relaxed)` at line 19 when a client connects, but is never decremented anywhere in the file. The disconnect detection task spawned at lines 57-65 polls `Arc::strong_count(&active_for_drop) == 1` every 2 seconds to detect when the client's stream is dropped, logs "SSE client disconnected" (line 61), and `break`s — but performs no `CLIENT_COUNT.fetch_sub(1, Ordering::Relaxed)`. After any period of connection cycling — including the frontend's own 10-attempt auto-reconnect logic in `hooks/useRealtimeAQI.ts:352-364`, or browser tab reloads — `CLIENT_COUNT` reads a value far exceeding the number of active connections. Since `CLIENT_COUNT` is the only concurrency signal in the service (no Prometheus metrics, no `/metrics` endpoint, no rate-limiting counter), the "SSE client connected" trace event at line 22 (`tracing::info!(client_id, "SSE client connected")`) produces a misleading and ever-growing `client_id` that cannot be used to assess true concurrency. Additionally, the 2-second polling loop in the disconnect task is itself a resource cost: 100 simultaneous SSE clients = 100 background `tokio::task`s waking every 2 seconds to check an atomic. PROPOSAL: Add `CLIENT_COUNT.fetch_sub(1, Ordering::Relaxed);` at `sse.rs:62`, immediately before `break;`, to maintain an accurate current-connections gauge. Optionally replace the polling task with a `tokio::select!` on a one-shot channel that fires when the `active` Arc is dropped, eliminating the 2-second busy-poll entirely.

- OBSERVATION: `geointellisense-analytics/app/context.py:60-68` — `build_live_context()` performs 8 async operations sequentially: `await _get_aqi_context(pool)`, `await _get_forecast_context(pool)`, `await _get_fire_context(pool)`, `await _get_earthquake_context(pool)`, `await _get_water_context(pool)`, `await _get_enviroscreen_context(pool)`, `_get_inversion_context()` (sync in-memory), and `await _get_prediction_context(pool)`. The inline comment at line 60 reads `"Run all queries concurrently-ish (asyncpg handles connection pooling)"` but the awaited calls execute sequentially in Python's event loop — asyncpg's connection pool allows multiple connections to be used simultaneously, but only by concurrent coroutines; awaiting one at a time negates the benefit. `_get_fire_context` itself performs two DB queries (`pool.fetchrow` at line 286 and line 300). With 8–9 DB operations, worst-case serial latency is ~9 × 100ms = 900ms added to every AI call that misses the 60s context cache (see `claude.py:88`). There is no per-source timing instrumentation: when an AI response is slow, there is no log entry identifying which source took longest. The same sequential-await antipattern was found in `nws_sounding.py:274-275` (run #53), but `context.py` is a distinct and higher-impact location because it is called on every cache miss for every AI endpoint. PROPOSAL: Replace lines 60-68 with `import asyncio; aqi, forecast, fires, quakes, water, ces, pred = await asyncio.gather(_get_aqi_context(pool), _get_forecast_context(pool), _get_fire_context(pool), _get_earthquake_context(pool), _get_water_context(pool), _get_enviroscreen_context(pool), _get_prediction_context(pool)); context["inversion"] = _get_inversion_context()` — reducing worst-case context-build time from ~900ms to ~100ms (the slowest single query). Additionally, wrap each gather element with a `time.monotonic()` span and emit `logger.debug("ctx source %s: %.0fms", name, elapsed_ms)` to make slow sources visible.

- OBSERVATION: `geointellisense-analytics/app/routes/fires.py:20,30-37` + `water.py:20,23-29` + `inversion.py:21,25-31` + `predict.py:21,27-33` — The analytics service runs four background asyncio Tasks stored in module-level variables (`_poll_task` in `fires.py`, `water.py`, `inversion.py`; `_retrain_task` in `predict.py`). The existing admin endpoint `GET /api/admin/sources` (`admin.py:31-37`) returns only Redis source-toggle states — it does not expose whether each polling task is currently alive, the last time it successfully ran, or the most recent error it encountered. An operator who sees `"nasa_firms": {"enabled": true}` from the sources endpoint has no way to distinguish "task is alive, sleeping between 30-minute polls" from "task exited after the `while True` body raised an `AttributeError` inside a sub-call 45 minutes ago, was caught by the top-level `except Exception`, logged a one-line error (silently dropped due to row #8), and is now sleeping for 30 minutes." The only recovery path is a container restart via `docker compose restart analytics` — but there is no signal that a restart is needed. There is no Prometheus `/metrics` endpoint, no structured JSON metrics for poll-task health, no `lastSuccessAt` or `lastErrorAt` field anywhere. PROPOSAL: In each poll module, add module-level `_last_success: float = 0.0` and `_last_error: str = ""` variables; update them inside the `while True` loop on each successful poll and on each caught exception. Add a `GET /api/admin/status` endpoint in `admin.py` (admin-token-guarded) that imports these from each poll module and returns `{"tasks": [{"name": "nasa_firms", "alive": bool, "lastSuccessAt": iso8601|null, "lastError": str}]}`. This requires zero external dependencies and gives operators a real-time liveness view of all background tasks.

**Proposed actions:**
- Change `cache HIT`/`cache MISS` log level from INFO to DEBUG in `cache.py:70,73` — M/L, score 2.0; does not enter top 10
- Add `logError` + `toDataServiceError` + `withRetry` to `aiService.ts` catch blocks at lines 24, 45, 66, 81, 103, 145, 179 — M/L, score 2.0; does not enter top 10
- Decrement `CLIENT_COUNT` on SSE client disconnect in `sse.rs:62` before `break` — M/L, score 2.0; does not enter top 10
- Replace sequential `await` chain in `context.py:60-68` with `asyncio.gather`; add per-source DEBUG timing — M/L, score 2.0; does not enter top 10
- Add `GET /api/admin/status` endpoint reporting poll task liveness + `lastSuccessAt` + `lastError` for all four background tasks — M/L, score 2.0; does not enter top 10

## 📚 Archive (one line per past run)
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
