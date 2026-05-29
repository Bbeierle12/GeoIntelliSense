# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-29T22:10:00Z
Last run: #42 — Lens: Deployment / Docker

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
### Run #42 — 2026-05-29 — Lens: Deployment / Docker
**Scope:** Third Deployment/Docker pass. Examined: `docker-compose.yml`, `Caddyfile`, `geointellisense-ingestion/Dockerfile`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/.dockerignore`, `geointellisense-analytics/.dockerignore`, `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml`, `db/init/01-extensions.sql`, `db/init/02-migrations.sh`, `db/migrations/` (17 files), `geointellisense-analytics/app/ml/aqi_model.py:257-258`, `geointellisense-ingestion/src/routes/sse.rs`. Cross-referenced findings from runs #12 and #27 to exclude previously-reported items.

**Findings:**

- OBSERVATION: `Caddyfile:3-5` — The `handle /api/aqi-stream { reverse_proxy ingestion:3001 }` block has no `flush_interval` directive. By default Caddy's reverse proxy buffers response bodies and flushes periodically rather than immediately. For Server-Sent Events, each `event:aqi-update\ndata:...\n\n` frame emitted by the Rust ingestion service is held in Caddy's buffer until the buffer fills or a flush interval fires, introducing latency between the Rust service emitting a sensor reading and the browser EventSource receiving it. `sse.rs:68-72` sends a `: heartbeat` comment every 30 seconds via `KeepAlive::new().interval(Duration::from_secs(30))`, which is sufficient to prevent proxy-level idle-timeout disconnections but does not cause Caddy to flush buffered data events between heartbeats. Fix: add `flush_interval -1` inside the `handle /api/aqi-stream` block — Caddy documentation specifies `-1` as "flush immediately after each chunk."

- OBSERVATION: `Caddyfile:1` — The gateway listens on `:8080` using Caddy's bare-port syntax, which disables TLS entirely. Caddy's distinguishing feature is automatic HTTPS via ACME/Let's Encrypt when a hostname is specified instead of a bare port. With `:8080`, Caddy never attempts certificate provisioning. All traffic between the client and the gateway — including chat messages, AI responses, the `x-api-key` header used for authentication, and the `ADMIN_TOKEN` value — is transmitted in plaintext HTTP. Given that Caddy reduces TLS configuration to replacing `:8080` with a production domain name, the current configuration leaves all production traffic unencrypted at no necessary configuration cost. Fix: replace `:8080 {` with the production domain; ensure `docker-compose.yml` publishes ports `80` and `443` for the ACME HTTP-01 challenge; set `GATEWAY_PORT` to `443` in production.

- OBSERVATION: `geointellisense-analytics/requirements.txt:1-19` — All 14 Python packages use wildcard (`==X.Y.*`) or range (`>=X,<Y`) constraints. There is no `requirements.lock` file, no `pip-compile` invocation in the Dockerfile, and no exact-version pinning. `pip install -r requirements.txt` selects the latest compatible patch release at build time. Two Docker builds of the same commit on different dates can install different package versions: for example, `anthropic==0.49.*` could install `0.49.0` today and `0.49.3` next month, with the latter potentially changing streaming-event shapes or tool-call schemas in ways that silently break `claude.py`. The Docker layer cache keys on the `requirements.txt` file hash, so the `pip install` layer is replayed only when `requirements.txt` changes; but resolved package versions can differ across rebuilds regardless. Fix: run `pip-compile requirements.txt -o requirements.lock` (from `pip-tools`) and change the Dockerfile to `RUN pip install --no-cache-dir -r requirements.lock` to pin every transitive dependency to exact versions, making image builds fully reproducible.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:257-258` — Model training concludes with two sequential `joblib.dump()` calls: `joblib.dump(model, MODEL_PATH)` at line 257 and `joblib.dump(meta, META_PATH)` at line 258. Both files must be mutually consistent — `_load_model()` at lines 62-64 loads both and uses them together for inference. If the container is killed between the two writes (SIGTERM from `docker stop`, or SIGKILL from OOM — the OOM scenario was flagged in run #12), `MODEL_PATH` contains newly trained weights while `META_PATH` retains the old metadata (feature list, version string, training timestamp). The next container start calls `_load_model()`, which succeeds without error — `joblib.load()` does not validate cross-file consistency — but predictions will be computed with a mismatched model/metadata pair, producing silently incorrect results. Fix: write to `MODEL_PATH.tmp` and `META_PATH.tmp` first, then call `os.rename(MODEL_PATH.tmp, MODEL_PATH)` / `os.rename(META_PATH.tmp, META_PATH)` sequentially; add a consistency check in `_load_model()` that compares `meta["version"]` against the model's own attributes before accepting the loaded pair.

- OBSERVATION: `db/init/02-migrations.sh` and `docker-compose.yml:14-15` — `02-migrations.sh` loops over every `*.sql` file in `/docker-entrypoint-initdb.d/migrations/` and runs each through `psql`. PostgreSQL's `docker-entrypoint-initdb.d` mechanism executes scripts exactly once — only when the data directory is empty (new volume or after `docker volume rm geointellisense_pgdata`). On every subsequent `docker compose up`, the `db/migrations/` bind mount is present and all 17 SQL files are visible inside the container, but `02-migrations.sh` is never re-executed. There is no schema version table (`flyway_schema_history`, `schema_migrations`, Alembic `alembic_version`, or equivalent). When migration file `018_new_table.sql` is added to `db/migrations/`, it is silently ignored for all existing deployments until the operator manually connects to the running database and executes it, or destroys the volume and loses all data. New contributors following the compose workflow have no indication of this constraint. Fix: adopt a migration runner that tracks applied migrations — e.g., add Alembic to the analytics service and call `alembic upgrade head` in the FastAPI lifespan startup hook — or at minimum add a comment to `docker-compose.yml:14-15` and `02-migrations.sh` documenting the one-time execution semantics and the manual migration procedure.

**Proposed actions:**
- Add `flush_interval -1` to `handle /api/aqi-stream` block in `Caddyfile:3-5` — H/L, score 3.0; ties current top 10, does not displace
- Replace `:8080 {` with production domain in `Caddyfile:1`; publish ports 80/443 in `docker-compose.yml` — M/L, score 2.0; does not enter top 10
- Run `pip-compile`; change Dockerfile to pin from `requirements.lock` instead of `requirements.txt` — M/L, score 2.0; does not enter top 10
- Write model files to `.tmp` + atomic rename in `aqi_model.py:257-258`; add consistency check in `_load_model()` — M/L, score 2.0; does not enter top 10
- Adopt Alembic or equivalent migration runner; add `alembic upgrade head` to FastAPI lifespan — H/M, score 1.5; does not enter top 10

### Run #41 — 2026-05-29 — Lens: Docs
**Scope:** Third docs pass. Examined: `README.md`, `IMPLEMENTATION_STATUS.md`, `.env.local.example`, `docker-compose.yml`, all 17 migration files in `db/migrations/`, `geointellisense-analytics/app/database.py`, `app/config.py`, `app/cache.py`, `app/claude.py`, `app/source_toggles.py`, all 14 client files in `app/clients/`, all 32 route files in `app/routes/`, `geointellisense-ingestion/src/config.rs`, `src/aqi.rs`, `src/broadcast.rs`, `src/purpleair.rs`, `src/usgs.rs`, `src/db/persist.rs`, `src/routes/sse.rs`. Cross-referenced archived findings from runs #11 and #26 to exclude previously-reported items.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/clients/dem.py:65` and `dem.py:80` — The module defines `add_tile()` twice at module scope with different signatures. The first definition at line 65 takes three arguments `(tile_id, name, bounds)` and auto-generates the download URL from `tile_id`; its docstring reads: *"URL auto-generated from tile_id."* The second definition at line 80 takes four arguments `(tile_id, name, url, bounds)` and requires an explicit URL. In Python, the second definition silently replaces the first at import time — the three-argument form documented at line 65 does not exist at runtime. `geointellisense-analytics/app/routes/elevation.py:258` calls `add_tile(tile_id, name, {"north": north, "south": south, "east": east, "west": west})` — three positional arguments — which matches only the dead first definition. Every call to `POST /api/elevation/tiles/add` in production raises `TypeError: add_tile() missing 1 required positional argument: 'bounds'` at runtime. The docstring at line 65-77 thus documents a function that Python has already overwritten: it is dead documentation masking a latent crash. Fix: remove the first `add_tile` definition (lines 65-77); update `elevation.py:258` to supply an auto-generated URL as the third argument, e.g. `url = f"https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/historical/{tile_id}/USGS_13_{tile_id}.tif"` before the call.

- OBSERVATION: `geointellisense-analytics/app/routes/deep_analysis.py:18`, `grounded_search.py:23`, `grounded_maps.py:24` — None of the three AI-facing route handlers has a Python docstring. FastAPI exposes function docstrings verbatim as OpenAPI `description` fields in the auto-generated `/docs` Swagger UI. For the most expensive endpoints in the system — each consuming Anthropic API credits, each applying stricter rate limits, each auth-gated — the interactive documentation shows only the HTTP method and path. There is no description of what `prompt` should contain, what model is used (`claude-opus-4-6` for deep analysis, `claude-sonnet-4-20250514` for search and maps), what the `thinking` block in the deep-analysis response represents, or what the `tool_use` loop cycle in grounded-maps does. The same absence exists for `traffic_current` (`traffic.py:25`), `traffic_historical` (`traffic.py:68`), `tracts_bbox` (`enviroscreen.py:53`), `start_backfill` (`enviroscreen.py:122`), and `backfill_status` (`enviroscreen.py:143`). Fix: add a one-line docstring to each handler; the AI endpoints should also document the model used and that responses may include a `thinking` key.

- OBSERVATION: `.env.local.example` is missing 8 environment variables accepted by `app/config.py` and `docker-compose.yml`. The example file documents only `ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`. The `Settings` class in `app/config.py` also accepts: `EPA_AQS_EMAIL`, `EPA_AQS_KEY`, `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `CENSUS_API_KEY`, `ADMIN_TOKEN`. The `docker-compose.yml` additionally requires: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_PORT`, `REDIS_PORT`, `INGESTION_PORT`, `ANALYTICS_PORT`, `GATEWAY_PORT`. None of these appear in `.env.local.example`. A developer following the README's "Configure API keys" step — which says "Copy the example file and add your API keys" — is never informed of these variables. Running `docker compose up -d` without them produces Docker Compose variable-substitution warnings for every undefined variable, and the admin API at `/api/admin/sources` is permanently inaccessible (the admin token is never set). Fix: add all omitted variables to `.env.local.example` with brief comments explaining each; create a `.env.docker.example` for the Docker-specific port variables.

- OBSERVATION: `geointellisense-analytics/app/database.py` has no module docstring. The `get_pool()` function at line 8 uses a `if _pool is None: _pool = await asyncpg.create_pool(...)` guard with no asyncio lock. Under FastAPI's lifespan startup the pool is created once, but route handlers also call `get_pool()` directly. In a scenario where multiple requests arrive before the lifespan hook completes (e.g., during a container restart under load), multiple coroutines can simultaneously pass the `_pool is None` check and each call `asyncpg.create_pool()`. Only one assignment to `_pool` survives; the other pool objects are abandoned — their connections held open but never tracked or closed. The pool size constants `min_size=2, max_size=10` have no comment explaining why these values were chosen relative to the TimescaleDB connection limit (PostgreSQL default: 100). Fix: add a module docstring; wrap the pool creation in an `asyncio.Lock`; add an inline comment on the `min_size`/`max_size` values referencing the DB connection limit.

- OBSERVATION: `db/migrations/001_locations.sql` through `db/migrations/011_water_readings.sql` — eleven of seventeen migration files have no file-level comment. Later migrations (`017_water_quality.sql`, `012_fire_detections.sql`, `013_traffic_readings.sql`) include a leading `-- <description>` header that explains what data source the table serves. The early migrations are missing this context: `001_locations.sql` creates the `locations` table whose UUIDs are the primary keys referenced across `002_sensor_readings.sql` and hardcoded in `005_seed_sjv_locations.sql` — but there is no comment explaining this seeding relationship or that the UUIDs in `005` are also used verbatim in `aqi.rs:STATIONS`. `006_sensor_readings_source.sql` adds a `source` column via `ALTER TABLE` with no comment indicating the safe default value for pre-existing rows, which risks data ambiguity for operators replaying migrations. Fix: prepend a one-line `-- <description>` to each of the 11 undocumented migrations explaining what it creates or alters and any cross-migration dependencies.

**Proposed actions:**
- Remove duplicate `add_tile()` at `dem.py:65-77`; update `elevation.py:258` to supply explicit URL — H/L, score 3.0; ties current top 10, does not displace
- Add docstrings to AI-facing handlers in `deep_analysis.py:18`, `grounded_search.py:23`, `grounded_maps.py:24` — M/L, score 2.0; does not enter top 10
- Add 8 missing env vars to `.env.local.example`; create `.env.docker.example` — M/L, score 2.0; does not enter top 10
- Add `asyncio.Lock` guard and module docstring to `database.py` — M/L, score 2.0; does not enter top 10
- Add `-- <description>` header to migrations `001`–`011` — L/L, score 1.0; does not enter top 10

### Run #40 — 2026-05-29 — Lens: Observability
**Scope:** Third observability pass. Python analytics: all 32 `app/routes/*.py` files checked for error-handling patterns; `app/main.py`; `app/middleware.py`. Rust ingestion: `src/main.rs`. Frontend: `index.tsx`, `utils/errorHandling.ts`, `components/ErrorBoundary.tsx`. Cross-referenced Active Rec rows #8 and #9 and archived findings from runs #10 and #25 to exclude previously-reported items.

**Findings:**

- OBSERVATION: 23 of the ~32 Python route files use `traceback.print_exc()` in their `except` blocks rather than `logger.exception()`. Representative examples: `chat.py:88`, `deep_analysis.py:87`, `grounded_search.py:81`, `predictive_analysis.py:99`, `low_latency.py:39`, `traffic.py:63`, `predict.py:93`, `water.py:132`, `fires.py:135`, `airnow.py:51`. `traceback.print_exc()` writes directly to `sys.stderr` and completely bypasses the Python `logging` framework — it is unaffected by log level, handler configuration, or log-aggregation middleware. This means that even after applying the fix from Active Rec row #8 (adding a logging configuration to `main.py`), all exception stack traces from every API endpoint will still escape to raw stderr rather than flowing through any structured log handler. The correct replacement is `logger.exception("descriptive message")`, which emits at ERROR level with the full traceback attached, routes through the configured logging system, and is searchable in any downstream aggregator.

- OBSERVATION: `geointellisense-analytics/app/middleware.py:64-75` — when `check_rate_limit()` enforces a 429 response it produces no log entry. The function's only `logger.warning()` call (line 77) fires when the Redis check itself raises an exception (i.e., Redis is unavailable), not when a rate limit is legitimately hit. As a result there is zero observability into which clients are being throttled, on which endpoint tier, at what request frequency, or whether the configured limits are appropriate. Distinguishing an abusive scraper from a high-volume legitimate partner requires manual Redis key inspection. Fix: add `logger.warning("Rate limit hit: client=%s tier=%s count=%d limit=%d", client, tier, count, max_requests)` at line 64 before the `return JSONResponse(...)`.

- OBSERVATION: `index.tsx:1-15` — the React entry point has no `window.onerror` or `window.addEventListener('unhandledrejection', ...)` handler. React's `ErrorBoundary` catches render-cycle errors only; it does NOT catch async errors from `fetch()` calls, rejected promises from `services/dataService.ts`, `services/aiService.ts`, and `services/AirQualityService.ts`. These failures are silently discarded by the browser. `utils/errorHandling.ts:321-322` contains the comment "In production, you would send this to an error tracking service (e.g., Sentry, LogRocket)" — but `logError()` is never invoked for unhandled promise rejections, making the stub dead code for this entire class of errors. Fix: add `window.addEventListener('unhandledrejection', e => logError(e.reason, 'unhandledrejection'))` in `index.tsx` before the `root.render()` call; this alone routes all async errors through the existing `logError()` path and makes them visible in the browser console with timestamps and context.

- OBSERVATION: `geointellisense-analytics/app/main.py` — the FastAPI application has no `@app.exception_handler(Exception)` registered. Unhandled exceptions in route coroutines cause FastAPI to return HTTP 500, but uvicorn logs only a single-line entry to its own internal `uvicorn.error` logger (e.g., `ERROR: Exception in ASGI application`) with no indication of which route, which session ID, which model call, or what request parameters were in flight. There is also no `BaseHTTPMiddleware` that measures request duration. An operator looking at application logs during an incident cannot determine which of the ~32 route handlers is failing, at what frequency, or how long requests are taking. Fix: register an `@app.exception_handler(Exception)` that calls `logger.exception("Unhandled exception in %s", request.url.path)` before re-raising; add a `BaseHTTPMiddleware` subclass that records `time.monotonic()` on entry and logs `method, path, status_code, duration_ms` on exit.

- OBSERVATION: `geointellisense-ingestion/src/main.rs:87` — `TraceLayer::new_for_http()` is added to the Axum router, which emits HTTP request spans via `tower_http`. However, no request-ID or correlation-ID header is injected into responses (no `SetRequestIdLayer`, no UUID generation). The Python analytics service at `geointellisense-analytics/app/main.py` also generates no correlation ID. A single user interaction that touches both services — e.g., the chat assistant calling `build_live_context()` (Python) which depends on the Rust SSE feed — produces log entries in two separate Docker log streams with no shared field linking them. Diagnosing a latency spike or error requires manually cross-referencing timestamps across both services. Fix: add `tower_http::request_id::SetRequestIdLayer` in the Rust router; have the Python analytics service forward or generate `X-Request-ID` headers, logging the value in every route handler.

**Proposed actions:**
- Replace all `traceback.print_exc()` calls in 23 route files with `logger.exception("…")` — M/L, score 2.0; does not enter top 10
- Add `logger.warning(…)` on rate-limit hit in `middleware.py:64` — M/L, score 2.0; does not enter top 10
- Add `window.addEventListener('unhandledrejection', …)` in `index.tsx:14` — M/L, score 2.0; does not enter top 10
- Register `@app.exception_handler(Exception)` and a request-duration middleware in `main.py` — M/L, score 2.0; does not enter top 10
- Add `SetRequestIdLayer` in Rust router and `X-Request-ID` propagation in Python service — M/L, score 2.0; does not enter top 10

## 📚 Archive (one line per past run)
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
