# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-31T05:10:00Z
Last run: #72 — Lens: Deployment / Docker

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
### Run #72 — 2026-05-31 — Lens: Deployment / Docker
**Scope:** Fifth Docker/deployment pass. Examined: `docker-compose.yml`, `geointellisense-analytics/Dockerfile`, `geointellisense-analytics/.dockerignore`, `geointellisense-ingestion/Dockerfile`, `geointellisense-ingestion/.dockerignore`, `Caddyfile`, `db/init/02-migrations.sh`, `db/migrations/` (001–017), `geointellisense-analytics/app/routes/health.py`. All findings verified as new via file:line specificity distinct from prior Docker runs #12, #27, #42, #57.

**Findings:**

- OBSERVATION: `docker-compose.yml:109-114` — The `analytics` service healthcheck is `["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:3002/api/health')"]`. This pattern has two compounding problems. First, `curl` is not installed in the analytics container: `geointellisense-analytics/Dockerfile:3-5` runs `apt-get install -y --no-install-recommends libgdal-dev` and nothing else, so `curl` is unavailable and the Python fallback was required. Second, `urllib.request.urlopen()` uses `socket.getdefaulttimeout()` which defaults to `None` — meaning the call blocks indefinitely if the server is listening (TCP accept succeeds) but not responding (no HTTP reply). The compose `timeout: 5s` directive is the wall-clock timeout for the subprocess: Docker sends `SIGKILL` after 5 seconds. However, if the connect phase completes before the timeout (fast ACK) but the server then stalls on the response, the Python interpreter is alive and waiting; Docker kills it and the check is marked unhealthy after `timeout`. The healthcheck itself fires every 10 seconds, but each Python spawn adds ~100–200 ms cold-start overhead — meaning 1–2% of each 10-second interval is consumed by interpreter startup with no work done. By contrast, the ingestion service uses `["CMD-SHELL", "curl -sf http://localhost:3001/health || exit 1"]` — a single binary invocation with implicit connect timeout from the OS TCP stack. PROPOSAL: Add `curl` to the analytics Dockerfile: change `apt-get install -y --no-install-recommends libgdal-dev` to `apt-get install -y --no-install-recommends libgdal-dev curl`; change the compose healthcheck to `["CMD", "curl", "-sf", "--max-time", "4", "http://localhost:3002/api/health"]`, matching the ingestion service pattern and respecting the `timeout: 5s` boundary.

- OBSERVATION: `docker-compose.yml:120-135` — The `gateway` service (Caddy 2-alpine) has no `healthcheck:` block. Every other service in the stack has a healthcheck: `db` uses `pg_isready`, `redis` uses `redis-cli ping`, `ingestion` uses `curl -sf http://localhost:3001/health`, `analytics` uses the Python probe. The `gateway` service depends on `ingestion` and `analytics` (both `condition: service_healthy`), ensuring its dependencies are ready before gateway starts. However, once Caddy starts, there is no periodic liveness check. If Caddy enters a degraded state — for example, its reverse proxy configuration reloads and fails to bind, or the Caddy process is alive but no longer accepting connections on `:8080` — `restart: unless-stopped` only triggers on process exit (not on liveness failure). Any external orchestrator (Docker Swarm, ECS, a monitoring agent, or a load balancer using Docker's healthcheck label) that queries `docker inspect` for service health will find the gateway in `starting`/`healthy` state indefinitely, with no signal that HTTP traffic is failing. The `caddy:2-alpine` image includes `wget`; a minimal check is: `test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080"]`. The `Caddyfile:24` endpoint `respond "GeoIntelliSense API Gateway" 200` exists specifically to serve as such a gateway-level ping endpoint. PROPOSAL: Add a `healthcheck:` block to the `gateway` service: `test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080"]`, `interval: 15s`, `timeout: 5s`, `retries: 3`, `start_period: 10s`.

- OBSERVATION: `geointellisense-ingestion/Dockerfile:10-11` — The dependency-caching layer uses the pattern: `RUN mkdir src && echo "fn main() {}" > src/main.rs` followed by `RUN cargo build --release 2>/dev/null || true`. The `2>/dev/null` redirects all cargo stderr to `/dev/null`, silencing progress, warnings, AND error messages. The `|| true` ensures the command always exits 0 regardless of whether the build succeeded or failed. The stated intent (layer-cache the compiled dependency artifacts) is correct, but the combination creates a silent-failure trap: if a crate in `Cargo.toml` fails to compile — for example, an indirect dependency receives a breaking patch, `pkg-config` cannot locate `libssl-dev` (line 3's apt-installed package), or `Cargo.lock` references a yanked crate version — the dummy build fails silently. Docker caches the result of this failed `RUN` step as a valid layer. The next `RUN touch src/main.rs && cargo build --release` at line 14 then fails with `error[E0463]: can't find crate for '<dep>'` — the error points at the missing dependency artifact from step 11, not the root compilation failure from step 10. A CI engineer investigating this sees link errors with no upstream context. PROPOSAL: Remove `2>/dev/null` to preserve error visibility; separate the suppressible case (expected linker failure when `main.rs` is a dummy with missing library dependencies) from genuine compile errors by redirecting only stdout: `RUN cargo build --release > /dev/null || true`. This preserves stderr for error messages while silencing progress output. Alternatively, use `cargo fetch` as the dependency warm-up step (downloads and verifies sources without compiling): `RUN cargo fetch` replaces the dummy-source build entirely, giving deterministic behavior and full error visibility.

- OBSERVATION: `docker-compose.yml:13-15` + `db/init/02-migrations.sh:1-9` — The `db` service mounts `./db/init:/docker-entrypoint-initdb.d` (init scripts) and `./db/migrations:/docker-entrypoint-initdb.d/migrations:ro` (17 SQL migration files, `001_locations.sql` through `017_water_quality.sql`). The `02-migrations.sh` init script iterates over these SQL files at line 5 (`for f in /docker-entrypoint-initdb.d/migrations/*.sql`). This works correctly for first-run initialization. However, the PostgreSQL Docker entrypoint at `docker-entrypoint.sh` executes init scripts **only when the data directory is empty** (`$PGDATA` contains no files). On any subsequent `docker compose up` with an existing `pgdata` volume, PostgreSQL skips all init scripts without emitting any log message to indicate scripts were skipped. Consequence: adding a new migration file (e.g., `018_new_index.sql`) to `./db/migrations/` has no effect on any existing PostgreSQL instance — the file is mounted into the container but never executed. There is no `schema_migrations` tracking table or equivalent (no Alembic, Flyway, Liquibase), so there is no way to query which migrations have been applied to a given environment. The only documented paths to apply new migrations to an existing deployment are: (a) `docker compose down -v` (destroys all data) or (b) manually exec-ing into the container and running the SQL. Path (a) is destructive; path (b) is undocumented and error-prone. PROPOSAL: Integrate Alembic into the analytics service: add `alembic` to `requirements.txt`; add an `alembic upgrade head` invocation to the `lifespan` function in `main.py` before the DB pool is created; store Alembic migrations alongside the current SQL files. Alternatively, add a one-shot `migrate` service to `docker-compose.yml` that runs a migration shell script against the live DB and exits, which operators can run with `docker compose run --rm migrate` after deploying new SQL files.

**Proposed actions:**
- Add `curl` to analytics Dockerfile and change healthcheck to `curl -sf --max-time 4` at `docker-compose.yml:110` — M/L, score 2.0; does not displace top 10
- Add `healthcheck:` block to `gateway` service in `docker-compose.yml:120` — M/L, score 2.0; does not displace top 10
- Remove `2>/dev/null` from `geointellisense-ingestion/Dockerfile:11`; preserve `|| true` or replace with `cargo fetch` — L/L, score 1.0; does not displace top 10
- Integrate Alembic (or a migrate one-shot service) for incremental DB migration — H/M, score 1.5; does not displace top 10

### Run #71 — 2026-05-31 — Lens: Docs
**Scope:** Fifth docs pass. Examined: `README.md`, `geointellisense-analytics/app/main.py`, `app/config.py`, `app/database.py`, `app/claude.py`, `geointellisense-ingestion/src/purpleair.rs`, `src/main.rs`, `src/broadcast.rs`, `src/db/persist.rs`, `docker-compose.yml`, `package.json`, `tsconfig.json`, `tests/README.md`. All findings verified as new via file:line specificity distinct from prior docs runs #11, #26, #41, #56.

**Findings:**

- OBSERVATION: `README.md:5-66` — The README title is "Run and deploy your AI Studio app" (line 5) and line 9 links to a Google AI Studio app URL (`https://ai.studio/apps/drive/1TSTROmMZ...`), revealing the file is an unmodified Google AI Studio project template. The Architecture section at lines 63-66 documents "Backend (Express): Runs on `http://localhost:3001`" — but the actual backend is a FastAPI Python service on port 3002 (confirmed `app/main.py:60`: `FastAPI(...)` and `main.py:117`: `port=settings.port`, `config.py:6`: `port: int = 3002`) plus a separate Rust ingestion service (`geointellisense-ingestion/`). There is no mention of TimescaleDB, PostGIS, Redis, or the Rust service anywhere in the README. Prerequisites at line 13 list only "Node.js", omitting Python 3.11+, Rust/Cargo, Docker, PostgreSQL, and Redis. Setup steps at lines 43-55 reference `npm run dev:full` and `npm run server` — but these scripts do not appear in `package.json` (confirmed: `package.json` contains only `dev`, `build`, `preview`, `test`, `test:ui`, `test:run`, `test:coverage`). An operator following this README can run the frontend only; no part of it documents how to start the Python analytics service or Rust ingestion service. The "Security Note" at line 39 states "API keys are stored on the backend only and never exposed to the client browser" — but Active Recommendation #6 documents that `GET /api/maps-config` exposes the Google Maps API key to unauthenticated callers. The README has not been updated since the project was scaffolded from an AI Studio template. PROPOSAL: Replace `README.md` with a project-specific document covering: (a) correct architecture (Vite+React frontend, FastAPI Python analytics on :3002, Rust ingestion, TimescaleDB, Redis); (b) correct prerequisites; (c) correct setup commands; (d) environment variable reference keyed to `config.py` fields; (e) link to `/docs` for OpenAPI reference.

- OBSERVATION: `geointellisense-analytics/app/config.py:4-17` — The `Settings(BaseSettings)` class at line 4 declares 9 third-party API credential fields (`anthropic_api_key`, `epa_aqs_email`, `epa_aqs_key`, `airnow_api_key`, `noaa_cdo_token`, `nasa_firms_key`, `census_api_key`, `admin_token`, and `purpleair_api_key` which is absent from this file but consumed by the Rust service) all defaulting to `""` with no docstring, no class-level docstring, and no per-field comments distinguishing required-for-core-function fields from optional-feature fields. There is no documentation of which features degrade when each key is absent: `anthropic_api_key = ""` silently disables all AI routes (chat, grounded search, predictive analysis, weather forecast) with a generic error response rather than a startup warning; `nasa_firms_key = ""` silently causes fire data to be absent; `airnow_api_key = ""` silently causes AirNow data to be absent. Most critically, `admin_token: str = ""` at line 15 defaults to empty string, which (as documented in Active Recommendation #7 context and Run #69 Finding 1) triggers `check_ai_auth()` at `middleware.py:95-96` to unconditionally permit all requests — but there is no comment on the field warning about this behavior. A developer provisioning a new environment has no docs-level signal to distinguish `anthropic_api_key` (blocks all AI functionality when absent) from `census_api_key` (optional demographic enrichment only). The module at `config.py:1` also lacks a module-level docstring. PROPOSAL: Add a class docstring to `Settings` listing each field, whether it is required or optional, what feature it gates, and the expected format (e.g., "API key string", "email address"); add an inline comment on `admin_token` warning `# SECURITY: leave empty only in dev — see middleware.py:95`.

- OBSERVATION: `geointellisense-analytics/app/main.py:60` — `FastAPI(title="GeoIntelliSense Analytics", version="0.1.0", lifespan=lifespan)` at line 60 omits the `description=` parameter. FastAPI uses this parameter to populate the API overview shown at the top of `/docs` (Swagger UI) and `/redoc` (ReDoc). Without `description=`, the auto-generated API docs have a blank overview section with no explanation of the service's purpose, data sources, authentication mechanism, or rate limiting policy. More significantly, all 36 routers included at lines 80-111 are added via `app.include_router(X)` without `tags=` arguments, meaning every endpoint appears in `/docs` without grouping — a flat, unsorted wall of 60+ endpoints with no categorical separation between, e.g., air quality routes, fire routes, water routes, and admin routes. Most FastAPI routers in this codebase do define a router-level prefix (`prefix="/api/..."`) but do not define `tags=[...]` — confirmed in `app/routes/chat.py` (router declared without tags). The lifespan function at lines 48-57 and the CORS conditional at lines 63-70 (which opens CORS to `"*"` when `admin_token` is not set) have no inline comments explaining the security implications. `main.py:1` has no module-level docstring. PROPOSAL: Add `description="..."` to `FastAPI(...)` at line 60 describing the service and linking to `/redoc` for full API reference; add `tags=["<category>"]` to each router declaration at `app/routes/*.py` so that `/docs` is organized into logical groups; add a comment block before the CORS logic at line 62 cross-referencing Run #69 Active Recommendation #7.

- OBSERVATION: `geointellisense-ingestion/src/purpleair.rs:7-16` — The bounding box constants `NW_LAT = 38.0`, `SE_LAT = 35.0`, `NW_LNG = -121.5`, `SE_LNG = -118.5` at lines 8-11 are preceded only by the comment `// SJV bounding box` at line 7. This comment names the region but provides no documentation of: (a) the coordinate reference system in use (WGS84 decimal degrees, as expected by PurpleAir's API, but not stated), (b) the rationale for these specific integer boundaries (the San Joaquin Valley spans approximately 35.0°N to 38.0°N and 118.5°W to 121.5°W — the chosen values clip the valley but exclude the Tehachapi transition zone), (c) the procedure for updating the bounding box if the product expands coverage to the Bay Area or Los Angeles Basin. The `FIELDS` constant at line 16 contains the PurpleAir API field selector `"name,latitude,longitude,pm2.5,pm10.0,ozone1,humidity,temperature,pressure"` with only the comment `// Fields we request from PurpleAir` at line 15. There is no documentation that `ozone1` in PurpleAir's API refers to the channel-A ozone reading (as opposed to `ozone2` for channel-B), that `pm2.5` is the real-time `ATM` concentration in µg/m³ (not the `CF=1` variant), or that `humidity` and `temperature` are sensor-measured (not NWS-sourced) values. A maintainer adding carbon monoxide or nitrogen dioxide monitoring has no docs-level guidance for which PurpleAir field names to use or whether they exist in all sensor tiers. PROPOSAL: Replace `// SJV bounding box` with a `/// Bounding box for San Joaquin Valley sensor queries (WGS84 decimal degrees).` doc comment on the constant block; add per-constant inline comments: `// Northern boundary ≈ Stockton` / `// Southern boundary ≈ Bakersfield`; expand the `FIELDS` comment to note the channel variant and unit for key fields.

- OBSERVATION: `geointellisense-analytics/app/database.py:8-19` — The module at `database.py:1` has no module-level docstring. `get_pool()` at line 8 declares return type `asyncpg.Pool` and initializes the module-level `_pool` global on first call using the pattern `if _pool is None: _pool = await asyncpg.create_pool(...)` at lines 10-11. This check-then-initialize pattern is not protected by an `asyncio.Lock`. In an asyncio application, two coroutines calling `get_pool()` before `_pool` is initialized will both pass the `if _pool is None` check (since the pool-creation `await` yields control back to the event loop, allowing the second coroutine to enter the `if` block before the first coroutine sets `_pool`). This results in two pools being created; the second `_pool =` assignment at line 11 overwrites the first, abandoning its connections and leaking them to the pool's internal connection limit. The current calling site at `main.py:49` invokes `get_pool()` once in the lifespan context before any routes are active (safe in practice), but this fragile assumption is not documented. Neither `get_pool()` at line 8 nor `close_pool()` at line 15 has a docstring. `close_pool():18` sets `_pool = None` after `await _pool.close()`, but there is no docstring noting that any concurrent call to `get_pool()` after `close_pool()` starts (but before it finishes) could reinitialize the pool. PROPOSAL: Add a module docstring to `database.py:1`; add a docstring to `get_pool()` noting its single-caller startup assumption; add an `asyncio.Lock` guard or a docstring warning explicitly documenting the call-once requirement.

**Proposed actions:**
- Replace `README.md` with a project-accurate document (correct architecture, prerequisites, setup commands, env var reference) — H/M, score 1.5; does not displace top 10
- Add class docstring + per-field comments to `Settings` in `config.py:4` documenting required vs. optional keys and `admin_token` security note — M/L, score 2.0; does not displace top 10
- Add `description=` to `FastAPI(...)` at `main.py:60`; add `tags=[...]` to each router at `app/routes/*.py` — M/L, score 2.0; does not displace top 10
- Expand `purpleair.rs:7-16` constant comments with CRS, boundary rationale, and `FIELDS` unit/channel docs — L/L, score 1.0; does not displace top 10
- Add module/function docstrings to `database.py`; add `asyncio.Lock` or document single-caller assumption at `get_pool():8` — M/L, score 2.0; does not displace top 10

### Run #70 — 2026-05-31 — Lens: Observability
**Scope:** Sixth observability pass. Examined: `geointellisense-analytics/app/main.py`, `app/database.py`, `app/cache.py`, `app/claude.py`, `app/http_client.py`, `app/middleware.py`, `app/source_toggles.py`, `app/routes/chat.py`, `app/routes/predict.py`, `app/routes/inversion.py`, `app/routes/fires.py`, `app/routes/water.py`, `app/routes/health.py`, `app/ml/aqi_model.py`, `geointellisense-ingestion/src/main.rs`, `src/broadcast.rs`, `src/db/persist.rs`, `src/redis_cache.rs`, `src/routes/health.rs`. All findings verified as new via file:line specificity distinct from Active Recommendations #8, #9 and from prior observability runs #10, #25, #40, #55.

**Findings:**

- OBSERVATION: 31 occurrences of `traceback.print_exc()` across the Python analytics service bypass the Python logging system entirely, writing raw stack traces to `sys.stderr`. Confirmed locations include: `chat.py:88`, `predict.py:93`, `predict.py:191`, `inversion.py:100`, `nws_forecast.py:86`, `nws_forecast.py:130`, `grounded_maps.py:88`, `deep_analysis.py:87`, `grounded_search.py:81`, `epa_aqi.py:69`, `fires.py:135`, `elevation.py:282`, `cropscape.py:57`, `water.py:132`, `water.py:179`, `enviroscreen.py:272`, `traffic.py:63`, `traffic.py:98`, `traffic.py:138`, `calgem.py:201`, `weather_historical.py:76`, `demographics.py:190`, `water_quality.py:356`, `airnow.py:51`, `airnow.py:96`, `low_latency.py:39`, `landsat.py:66`, `landsat.py:104`, `landsat.py:281`, `weather_forecast.py:83`, `predictive_analysis.py:99`. `traceback.print_exc()` at these sites writes to raw `sys.stderr` with no log level, no logger name, no timestamp, and no structured fields. This is distinct from and compounding Active Rec #8 (no logging config): even if a `logging.basicConfig()` is added to `main.py`, these 31 sites still bypass it, so the traceback text never reaches configured handlers (e.g., a log aggregator's stdin parser, a structured JSON handler, or a syslog handler). In a Docker container running under a log aggregator (Datadog, CloudWatch Logs, Loki), structured log lines are emitted to stdout and parsed by agent; raw stderr tracebacks are captured separately and not correlated with the structured log stream. An error at e.g. `chat.py:88` produces a bare Python traceback on stderr with no session_id, no API key hash, no request path — making it impossible to match to a user complaint without manual grep across container logs. PROPOSAL: Replace all 31 `traceback.print_exc()` calls with `logger.exception("<handler> error")` (or `logger.error("...", exc_info=True)`), which logs at ERROR level through the named logger and includes traceback text inline — visible to any configured handler. This is a mechanical `sed` substitution per-file; no logic change required.

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:5-35` — `write_readings()` is declared `pub async fn write_readings(pool: &PgPool, readings: &[AqiReading])` returning `()`. The function iterates over each reading independently and logs individual failures at `tracing::error!(station = %r.station_name, "Failed to persist reading: {e}")` at line 31. However, the calling site in `broadcast.rs:115` is a bare `persist::write_readings(&pool, &readings).await;` with no result inspection (the return type `()` makes this impossible). If every reading fails in a given broadcast cycle (e.g., a schema migration added a NOT NULL column that the Rust code doesn't fill, or the DB connection pool is exhausted), the broadcast ticker at `broadcast.rs:97-131` continues to: (a) emit N individual `tracing::error` lines (which may scroll past in a busy log), (b) publish a Redis snapshot at line 121, and (c) push readings to SSE subscribers at line 128 — all with no aggregate indication that 0 of N readings were persisted that cycle. An operator watching `sensor_readings` row counts would see no growth and have to manually correlate N error lines to identify the source. This finding is distinct from Active Rec #5 (batch DB writes) which addresses performance; this finding addresses observability of write outcomes. PROPOSAL: Change `write_readings` to return `(usize, usize)` representing `(succeeded, failed)`; add `tracing::info!("Persist: {succeeded}/{total} readings written", ...)` in the broadcast ticker after each call, and `tracing::warn!` when `failed > 0`, enabling at-a-glance diagnosis of persistence health per cycle.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:87-92` — the generic `except Exception as e` handler catches all exceptions from the Anthropic API call at line 43, including `anthropic.APIStatusError`. The Anthropic Python SDK raises `anthropic.APIStatusError` for any HTTP error from the API, and this exception carries two critical observability fields: `e.request_id` (a string like `"req_01XYZ..."` — Anthropic's internal request identifier included in their support and incident lookups) and `e.status_code`. Neither is logged or returned to the caller: the handler at lines 88-92 calls `traceback.print_exc()` (bypasses logging per Finding 1) and returns `{"error": "Failed to get chat response", "details": str(e)}` which includes the exception message but not the `request_id`. The same pattern is present in `grounded_search.py:81`, `grounded_maps.py:88`, `deep_analysis.py:87`, and `low_latency.py:39`. Without `request_id`, an operator who suspects an Anthropic service degradation has no way to correlate a user-reported failure with an Anthropic support ticket or incident timeline — they cannot tell whether the failure was a network timeout, a model overload, a rate limit, or an authentication issue. PROPOSAL: Add a specific `except anthropic.APIStatusError as e:` handler before the generic `Exception` handler in each of the 5 affected routes: `logger.error("Anthropic API error status=%d request_id=%s path=%s", e.status_code, e.request_id, request.url.path)` and return `JSONResponse(status_code=502, content={"error": "AI service error", "anthropicRequestId": e.request_id})`.

- OBSERVATION: `geointellisense-analytics/app/main.py:60-87` — the FastAPI application has no per-request correlation ID middleware. The Rust ingestion service at `main.rs:87` applies `TraceLayer::new_for_http()` from `tower-http`, which automatically attaches a unique request ID span to every HTTP request and includes it in every `tracing::` log call made during that request's lifecycle. The Python analytics service has no equivalent: each `logger.error(...)` or `logger.info(...)` call across the 36 modules that call `logging.getLogger(__name__)` emits lines with no request-scoped identifier. When multiple concurrent requests are in flight (e.g., SSE stream + chat + water poll simultaneously), interleaved log lines from `water.py:44`, `fires.py:54`, and `inversion.py:50` have no field to distinguish which request produced which log line. A log aggregator query like "all log lines for the request that failed at 14:32:07" is impossible without a request ID. Standard practice is `starlette-context` or a custom `contextvars`-based middleware that generates a `request_id = str(uuid.uuid4())` per request and injects it into a `logging.Filter` on the root handler, so every log record gains a `request_id` field. PROPOSAL: Add `starlette-context` (or equivalent) to `requirements.txt`; add middleware in `main.py` before `CORSMiddleware` that sets `request_id = uuid4()` in context; add a `logging.Filter` that reads from the context and attaches `request_id` to every `LogRecord`, making it visible in all downstream `logger.*` calls without changing any route code.

- OBSERVATION: `geointellisense-analytics/app/database.py:8-12` and `app/cache.py:29-32` — both the DB pool and Redis client are created silently on first use with no startup confirmation log or connection probe. `database.py:11`: `asyncpg.create_pool(settings.database_url, min_size=2, max_size=10)` succeeds silently when the DB is reachable, and raises an unhandled exception (propagating through `main.py:49` → lifespan → uvicorn startup failure) when it is not. There is no `logger.info("PostgreSQL pool created (min=%d max=%d host=...", 2, 10)` on success. `cache.py:29-32`: `redis.from_url(settings.redis_url, decode_responses=True)` does NOT establish a connection — redis-py's `from_url` is synchronous and returns a client object without pinging the server. The first actual Redis command (e.g., during a cache HIT/MISS in a route handler) will fail if Redis is unreachable, but the startup logs show nothing to indicate Redis connectivity status. By contrast, the Rust service (`redis_cache.rs:7-23`) explicitly calls `client.get_multiplexed_async_connection().await` at startup and logs `"Connected to Redis"` on success or `"Redis connection failed (non-fatal): {e}"` on failure. An operator watching the Python analytics service start up sees no structured indication of whether DB or Redis are actually reachable, unlike the Rust service where startup connectivity is fully observable. PROPOSAL: After `asyncpg.create_pool()` in `database.py:11`, add `logger.info("PostgreSQL pool ready (min_size=2, max_size=10)")`. In `cache.py:29-32`, after `redis.from_url(...)`, add `await r.ping()` in a try/except to log `logger.info("Redis connected")` on success or `logger.warning("Redis unreachable at startup: %s — cache layer degraded", e)` on failure (non-fatal, mirroring the Rust service behavior).

**Proposed actions:**
- Replace all 31 `traceback.print_exc()` calls with `logger.exception(...)` across the Python analytics service — H/L, score 3.0; ties top 10, first seen #70, does not displace existing
- Change `write_readings()` in `persist.rs:5` to return `(usize, usize)`; add aggregate persist log in `broadcast.rs:115` — M/L, score 2.0; does not displace top 10
- Add `except anthropic.APIStatusError` handler logging `e.request_id` in `chat.py:87`, `grounded_search.py:81`, `grounded_maps.py:88`, `deep_analysis.py:87`, `low_latency.py:39` — M/L, score 2.0; does not displace top 10
- Add per-request correlation ID middleware (starlette-context or contextvars) to `main.py` — M/L, score 2.0; does not displace top 10
- Add startup probe + log in `database.py:11` and `cache.py:29-32` — M/L, score 2.0; does not displace top 10

## 📚 Archive (one line per past run)
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
