# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-29T07:15:00Z
Last run: #27 — Lens: Deployment / Docker

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
### Run #27 — 2026-05-29 — Lens: Deployment / Docker
**Scope:** Second deployment/Docker pass. `docker-compose.yml`, `Caddyfile`, `geointellisense-ingestion/Dockerfile` (runtime stage), `geointellisense-ingestion/src/main.rs`, `geointellisense-ingestion/src/routes/mod.rs`, `geointellisense-analytics/app/main.py`. Prior Run #12 findings (image size, libgdal-dev, analytics USER directive, cargo stderr suppression, Python urllib healthcheck, missing gateway healthcheck, .dockerignore glob, mem_limit/OOM state) excluded from re-reporting.

**Findings:**

- OBSERVATION: `docker-compose.yml:11,32,61,99,124` — All four internal service ports are published to the host: PostgreSQL at `${DB_PORT}:5432` (line 11), Redis at `${REDIS_PORT}:6379` (line 32), ingestion at `${INGESTION_PORT}:3001` (line 61), and analytics at `${ANALYTICS_PORT}:3002` (line 99). In a production deployment, only the Caddy gateway port (`${GATEWAY_PORT}:8080`) should be externally accessible; the four internal services are designed to communicate exclusively through the `geointellisense` Docker bridge network. Publishing PostgreSQL and Redis ports to the host means any process on the deployment machine — and any internet-reachable attacker if the host lacks a strict firewall — can connect directly to the database and cache, bypassing every application-level authentication and rate-limiting layer. Fix: remove `ports:` blocks from the `db`, `redis`, `ingestion`, and `analytics` services (they are already reachable by service name within the Docker network), or scope them to loopback-only (`127.0.0.1:${DB_PORT:-5432}:5432`) for local development convenience.

- OBSERVATION: `docker-compose.yml:30,58,96` — Redis has no authentication. The startup command (line 30) is `redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru` with no `--requirepass` or ACL file. Both `REDIS_URL` values (ingestion line 58, analytics line 96) are `redis://redis:6379` — no password embedded. Redis stores sliding-window rate-limit counters keyed by client IP and API key (`middleware.py`), AQI broadcast cache state (`redis_cache.rs`), and fire/earthquake poll results. An unauthenticated connection to Redis allows any reachable process to flush all rate limits with `FLUSHDB`, inspect and forge cached sensor payloads, or decrement rate-limit counters to un-throttle blocked clients. Combined with the host-port finding above, the Redis instance is directly reachable from the host without any credential. Fix: add `--requirepass ${REDIS_PASSWORD}` to the Redis command; add `REDIS_PASSWORD` to the ingestion and analytics environment blocks; update both `REDIS_URL` values to `redis://:${REDIS_PASSWORD}@redis:6379`.

- OBSERVATION: `Caddyfile:20-22` and `geointellisense-ingestion/src/routes/mod.rs:18` — The Caddyfile `handle /api/* { reverse_proxy analytics:3002 }` catch-all matches `/api/admin/cache/flush` before any ingestion-specific rule, so `POST /api/admin/cache/flush` through the gateway is proxied to the Python analytics service. Python has no such route and returns 404 or 405. The ingestion service registers this route at `routes/mod.rs:18` (`.route("/api/admin/cache/flush", post(admin::cache_flush))`), but there is no Caddyfile `handle` block forwarding ingestion admin paths to `ingestion:3001`. The cache-flush endpoint is therefore functionally unreachable through the gateway; only callers who directly access `ingestion:3001` (published to host per finding above) can invoke it. Fix: add `handle /api/admin/cache/flush { reverse_proxy ingestion:3001 }` before the `handle /api/*` catch-all in the Caddyfile (Caddy evaluates `handle` blocks in definition order, so more-specific blocks must appear first).

- OBSERVATION: `geointellisense-ingestion/src/main.rs:86` — The ingestion service mounts `CorsLayer::permissive()` (tower-http) unconditionally for all environments. `CorsLayer::permissive()` sets `Access-Control-Allow-Origin: *` and permits all methods and headers on every response. Unlike the analytics service, which at least distinguishes production and dev CORS in `main.py:63-70` (though that logic is also flawed per Run #24), the ingestion CORS has zero production hardening and no configuration path. Because the ingestion service port is published to the host (finding above), any web page served from the deployment host's loopback address can make cross-origin requests directly to `/api/aqi-snapshot`, `/api/aqi-history`, and `/api/earthquakes/cached`, bypassing the Caddy gateway and all analytics-side auth middleware. Fix: replace `CorsLayer::permissive()` with a configurable allowlist driven by an `ALLOWED_ORIGINS` env var; permit `*` only when `cfg.admin_token.is_none()` (dev mode), mirroring the analytics `main.py` pattern.

- OBSERVATION: `docker-compose.yml:11,32,61,99,124` — The five port-mapping variables (`${DB_PORT}`, `${REDIS_PORT}`, `${INGESTION_PORT}`, `${ANALYTICS_PORT}`, `${GATEWAY_PORT}`) are referenced with no `:-<default>` fallback notation. Every other configurable variable in the file uses `:-` syntax (e.g., line 55: `${PURPLEAIR_API_KEY:-}`, line 56: `${PURPLEAIR_INTERVAL_SECS:-600}`). Without a `.env` file that defines all five port vars, `docker compose up` fails immediately with a Docker Compose variable substitution error before any image is pulled or container is started. There is no `.env.example` or `docker-compose.override.yml.example` in the repository documenting the expected values. Fix: add `:-<default>` notation to each port variable (e.g., `${DB_PORT:-5432}`, `${REDIS_PORT:-6379}`, `${INGESTION_PORT:-3001}`, `${ANALYTICS_PORT:-3002}`, `${GATEWAY_PORT:-8080}`) or add a committed `.env.example` file with documented port defaults.

- OBSERVATION: `geointellisense-ingestion/Dockerfile:16-26` — The runtime stage of the ingestion Dockerfile (based on `debian:bookworm-slim`) has no `USER` directive. The compiled binary `geointellisense-ingestion` runs as UID 0 (root) inside the container. Run #12 noted this gap for the analytics Dockerfile; the ingestion runtime stage has the identical issue. The ingestion binary binds a raw TCP port (`TcpListener::bind` at `main.rs:91`), maintains a PostgreSQL pool, and serves SSE streams — none of these require root privileges. Ports ≥1024 can be bound by any user; port 3001 is above the privileged range and requires no special capability. Fix: add `RUN useradd -u 1001 -m appuser` and `USER appuser` before the `CMD` line in the runtime stage of `geointellisense-ingestion/Dockerfile`.

**Proposed actions:**
- Remove host `ports:` from `db`, `redis`, `ingestion`, `analytics` services in `docker-compose.yml`; keep only `gateway` port exposed — H/L, score 3.0; ties current top 10, does not displace
- Add `--requirepass ${REDIS_PASSWORD}` to Redis command; add `REDIS_PASSWORD` to env blocks and `REDIS_URL` — H/L, score 3.0; ties current top 10, does not displace
- Add `handle /api/admin/cache/flush { reverse_proxy ingestion:3001 }` before `handle /api/*` in Caddyfile — M/L, score 2.0; does not enter top 10
- Replace `CorsLayer::permissive()` in `main.rs:86` with env-var-driven allowlist; permit `*` only in dev mode — M/L, score 2.0; does not enter top 10
- Add `:-<default>` fallbacks to all five port variables in `docker-compose.yml`, or add `.env.example` with port defaults — M/L, score 2.0; does not enter top 10
- Add `RUN useradd -u 1001 -m appuser && USER appuser` to ingestion Dockerfile runtime stage — M/L, score 2.0; does not enter top 10

### Run #26 — 2026-05-29 — Lens: Docs
**Scope:** All Markdown files (`README.md`, `IMPLEMENTATION_STATUS.md`, `tests/README.md`), `.env.local.example`, `package.json`, and inline documentation across Python route modules (`chat.py`, `fires.py`, `water.py`, `inversion.py`, `grounded_search.py`, `deep_analysis.py`, `historical_aqi.py`, `maps_config.py`), Python support modules (`database.py`, `config.py`), and Rust modules (`config.rs`, `usgs.rs`, `persist.rs`, `broadcast.rs`, `routes/mod.rs`).

**Findings:**

- OBSERVATION: `README.md:5-6` — The repository README has never been updated from the AI Studio scaffold. The H1 reads "Run and deploy your AI Studio app" and line 9 contains a hard-coded link to `https://ai.studio/apps/drive/1TSTROmMZDi_NK0VF4oiiW_i2TPkn1j5C`. The "Architecture" section at lines 63-66 describes only two processes — a Vite frontend on port 5174 and an Express backend on port 3001 — with no mention of the Rust ingestion service, Python analytics service, TimescaleDB/PostGIS, Redis, Caddy API gateway, or Docker Compose stack. A new contributor following this README would have no awareness of the 5-service architecture, the `docker compose up` workflow, or the 11 required env vars documented in `docker-compose.yml`. Fix: replace the AI Studio scaffold with a project-specific README covering: project description, architecture diagram (frontend → Caddy:8080 → Rust:3001 + Python:3002 → TimescaleDB + Redis), prerequisites (Docker, Node, Rust), and a getting-started section that mirrors the actual workflow in `IMPLEMENTATION_STATUS.md:48-68`.

- OBSERVATION: `README.md:43` and `package.json:6-14` — The README instructs `npm run dev:full` at line 43 as the primary way to start both backend and frontend. This script does not exist in `package.json`. The `scripts` block defines only `dev`, `build`, `preview`, `test`, `test:ui`, `test:run`, `test:coverage`. The `concurrently` package is present in `devDependencies` at `package.json:38` but is never used in any script. Running `npm run dev:full` produces an npm error: `Missing script: "dev:full"`. The README alternative at lines 49-55 describes starting Rust and Python services manually, but neither `npm run server` nor any equivalent script exists in `package.json` either. Fix: add a `"dev:full"` script to `package.json` using `concurrently`, e.g., `"concurrently \"npm run dev\" \"..."` pointing to the Vite frontend; or update `README.md:43` to replace the non-existent command with the correct Docker-first workflow.

- OBSERVATION: `.env.local.example:1-15` — The example env file documents only 5 variables: `ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`. However, `geointellisense-analytics/app/config.py:4-16` defines 10 settings that the analytics service reads from environment: `EPA_AQS_EMAIL`, `EPA_AQS_KEY` (both required together for EPA AQS auth), `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, `CENSUS_API_KEY`, and `ADMIN_TOKEN`. The `docker-compose.yml` (lines 92-108) wires all of these from host env vars with `:-` empty defaults, confirming they are real deployment inputs. A developer copying `.env.local.example` to configure the stack will have all six analytics service keys silently empty, causing `503 Not configured` errors from every affected route with no guidance on how to obtain keys. `epa_aqs.py` module docstring at line 7 documents a signup URL — but only developers who open that source file will find it. Fix: add all missing keys to `.env.local.example` with inline comments pointing to registration URLs (copying the pattern already used for `ANTHROPIC_API_KEY` and `GOOGLE_MAPS_API_KEY`).

- OBSERVATION: `geointellisense-analytics/app/database.py:1-16` — The module has no docstring and neither exported function (`get_pool`, `close_pool`) has a docstring. Nothing documents that `_pool` is a process-global lazily-initialized singleton, that callers must call `close_pool()` on shutdown (done in `main.py` lifespan), or that `min_size=2, max_size=10` (line 11) was a deliberate tuning choice. The absence of a timeout argument — flagged in Active Observation from Run #25 for `asyncpg.create_pool` — is also invisible at this call site since there is no comment noting the known gap. Given that `get_pool()` is imported by approximately 20 route and background-task modules, the lack of any documentation on its behavior under saturation conditions is a meaningful gap for future contributors. Fix: add a module docstring and a one-line docstring to each function; note the `timeout` omission with a `# TODO: add timeout=30.0` comment so reviewers know the gap is known.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:1-3`, `fires.py:1-4`, `water.py:1-4`, `inversion.py:1-5`, `grounded_search.py:1-3`, `deep_analysis.py:1-3`, `historical_aqi.py:1-2` — Seven high-traffic route files have no module-level docstring. Contrast with `explore.py:1-4`, `epa_aqs.py:1-6`, `airnow.py:1-6`, `nasa_firms.py:1-6`, and `nws_sounding.py:1-15` which all open with a docstring naming the data source, linking external docs, noting rate limits, and identifying authentication requirements. The missing-docstring files are among the most-used: `chat.py` handles the primary AI chat endpoint; `fires.py` and `water.py` run background pollers; `deep_analysis.py` and `grounded_search.py` make expensive Claude API calls. Without a module docstring, a contributor opening any of these files has no immediate context on what external APIs the module calls, what authentication it enforces, or what background tasks it spawns. Fix: add a 3–5 line module docstring to each of the seven files, following the pattern established in `explore.py`.

- OBSERVATION: `geointellisense-ingestion/src/config.rs:1-34` and `geointellisense-ingestion/src/usgs.rs:1-12` — Neither Rust source file has a module-level doc comment (`//!`). `config.rs` defines the `Config` struct with 9 fields and exposes `from_env()`, but no field carries a `///` doc attribute. The inline comment on `purpleair_interval_secs` (line 25: `// 10 min default — PurpleAir free tier is 1000 pts/day`) is the only inline documentation in the file, and it is inconsistently applied: `broadcast_interval_secs` (default 5s) and `earthquake_interval_secs` (default 300s) have no such rationale. `usgs.rs` defines four public constants (`DEFAULT_MIN_LAT` etc.) representing a worldwide bounding box default with no explanation that this is intentionally broad — compare with `purpleair.rs:8-12` which documents the SJV bounding box with `NW_LAT`/`SE_LAT` constants and an inline explanation. Fix: add `//!` module-level doc comments to both files and `///` doc attributes on each `Config` field describing the env var name, its default, and its purpose.

- OBSERVATION: `IMPLEMENTATION_STATUS.md:1-158` — The document accurately reflects Phases 1–3 (security, routing, state management, data normalization) but describes Phase 4 as future work (accessibility, error handling). The actual current state of the project is approximately 4–6 phases beyond what Phase 4 specifies: multi-service Docker stack (5 containers), Rust ingestion pipeline, Python analytics with 30+ routes, TimescaleDB hypertables, ML model training/prediction, Redis caching, rate limiting, admin API, and a Caddy gateway. The "Current Architecture" diagram at line 146-154 matches the actual 4-tier design but the rest of the document describes a 2-service frontend+Express topology. A contributor reading `IMPLEMENTATION_STATUS.md` to understand the project would get an accurate architecture diagram but an out-of-date implementation status and a "Next Steps" section that does not reflect actual gaps. Fix: update the document to add Phase 4 (multi-service Docker + Rust ingestion), Phase 5 (Python analytics + data clients), and Phase 6 (ML + admin), and revise the "Next Steps" to reference the concrete open items tracked in `PLAN.md`.

**Proposed actions:**
- Replace `README.md` scaffold header and architecture section; add 5-service architecture description and Docker getting-started — M/M, score 1.0; does not enter top 10
- Add `"dev:full"` script to `package.json` using `concurrently`, or fix `README.md:43` to remove the broken script reference — L/L, score 1.0; does not enter top 10
- Add missing API keys to `.env.local.example` with inline registration URL comments (EPA AQS, AirNow, NOAA CDO, NASA FIRMS, Census, ADMIN_TOKEN) — M/L, score 2.0; does not enter top 10
- Add module docstring and function docstrings to `database.py` noting singleton pattern and known `timeout` gap — L/L, score 1.0; does not enter top 10
- Add module docstrings to `chat.py`, `fires.py`, `water.py`, `inversion.py`, `grounded_search.py`, `deep_analysis.py`, `historical_aqi.py` following the pattern in `explore.py` — L/L, score 1.0; does not enter top 10
- Add `//!` module-level doc comments and `///` field-level attributes to `config.rs` and `usgs.rs` — L/L, score 1.0; does not enter top 10
- Update `IMPLEMENTATION_STATUS.md` to reflect Phases 4–6 (Docker stack, Rust pipeline, Python analytics, ML) and revise Next Steps to reference `PLAN.md` — M/M, score 1.0; does not enter top 10

### Run #25 — 2026-05-29 — Lens: Observability
**Scope:** Second observability pass. `cache.py`, `context.py`, `database.py`, `main.py` (Python), `sse.rs`, `routes/admin.rs` (Rust), `components/ErrorBoundary.tsx`, `utils/errorHandling.ts`, background poll loops in `water.py`, `fires.py`, `inversion.py`, `predict.py`. Prior Run #10 promotions (Active Recs #8 and #9) excluded from re-reporting.

**Findings:**

- OBSERVATION: `cache.py:67,69` — Every call to `get_cached()` emits either `logger.info("cache HIT %s", key)` (line 67) or `logger.info("cache MISS %s", key)` (line 69) at `INFO` level. The analytics service exposes ~30 routes, each calling `get_cached()` on every request. In production, even low traffic (e.g., one dashboard refresh per second) generates ~60 INFO log lines per second solely from cache HIT/MISS events. These lines are indistinguishable in severity from meaningful INFO events like "FIRMS poll: N detections" (fires.py:54) or "Inversion check: strength=..." (inversion.py:50). An operator scanning logs for service-level signals must parse through cache noise to find actionable lines. Fix: demote cache HIT/MISS logging from `INFO` to `DEBUG` level — `logger.debug("cache HIT %s", key)` / `logger.debug("cache MISS %s", key)`. Reserve `INFO` for the cache FLUSH operation at line 99 and for explicit miss-then-populate events.

- OBSERVATION: `context.py:60-67` — `build_live_context()` executes eight data-fetch calls sequentially: `_get_aqi_context`, `_get_forecast_context`, `_get_fire_context`, `_get_earthquake_context`, `_get_water_context`, `_get_enviroscreen_context`, `_get_inversion_context`, `_get_prediction_context`. The inline comment at line 60 reads "Run all queries concurrently-ish (asyncpg handles connection pooling)" but this is incorrect: asyncpg connection pooling allows concurrent use by multiple coroutines, but sequential `await` calls on a single coroutine are still serialized. If each DB query takes 30 ms at idle, the total context assembly latency is ~210 ms minimum before any Claude API call begins. During DB load spikes (e.g., TimescaleDB continuous aggregate refresh), individual queries can reach 200–500 ms, making total context assembly 1–3 seconds. Every AI endpoint calls `get_system_with_live_context()` (claude.py:60-equivalent), which calls `build_context_text()`, which calls `build_live_context()`. There is no timing instrumentation — operators cannot observe which sub-query is slow. Fix: replace sequential awaits with `asyncio.gather(*[_get_aqi_context(pool), _get_forecast_context(pool), ...])` to run all DB queries concurrently; add a `time.monotonic()` start/end around the full `build_live_context()` call and log total elapsed time at `INFO` if it exceeds 500 ms.

- OBSERVATION: `components/ErrorBoundary.tsx:36` and `utils/errorHandling.ts:311-317` — Frontend errors caught by `ErrorBoundary.componentDidCatch` are emitted to `console.error` only (ErrorBoundary.tsx:36). The `logError()` utility in `errorHandling.ts:305` also only writes to `console.error`, with an explicit TODO comment at lines 311-312: "In production, you would send this to an error tracking service // e.g., Sentry, LogRocket, etc." This integration has never been implemented. Any JavaScript runtime crash — unhandled `TypeError`, failed JSON parse, React rendering exception — is silently invisible to operators unless a user actively reports it. Additionally, the `DataServiceError.toJSON()` method at line 81-90 produces a structured error payload (code, retryable, timestamp, details) that is ideal for remote error ingestion but is never POSTed anywhere. Fix: implement a lightweight `reportError(error, context)` function that POSTs a structured payload to `POST /api/admin/errors` (or a third-party DSN); call it from `ErrorBoundary.componentDidCatch` and from `logError()` when in a production context (`import.meta.env.PROD`).

- OBSERVATION: `database.py:10-11` — `asyncpg.create_pool(settings.database_url, min_size=2, max_size=10)` is called with no `timeout` keyword argument. The asyncpg default for `Pool.acquire()` is no timeout (`None`). When all 10 pool connections are in active use — which can occur during concurrent AI context builds, backfill operations, and poll-loop persists — additional requests calling `pool.acquire()` implicitly block indefinitely. There is no log line emitted when the pool is saturated, no metric tracking pool utilization, and no alerting threshold. In practice, a deadlocked or slow query holding a connection will silently hang all subsequent requests until the query times out at the DB level. Fix: pass `timeout=30.0` to `create_pool()` and log a `WARNING` at application startup showing `max_size=10`; additionally instrument `get_pool()` to warn when `_pool._queue.qsize() == 0` (all connections lent out) using a periodic health check.

- OBSERVATION: `sse.rs:13,57-65` — `CLIENT_COUNT: AtomicUsize` (line 13) is incremented on connection (`fetch_add(1, ...)` at line 19) but never decremented. After N connections in the service lifetime, `CLIENT_COUNT.load()` equals N (cumulative), not the number of currently-active SSE clients. The disconnect detection at lines 57-65 uses a polling loop: `loop { sleep(2s); if Arc::strong_count == 1 { break } }`. This approach detects disconnects up to 2 seconds late and spawns one detached `tokio::spawn` task per connected client for the duration of that client's session. No endpoint or log line exposes the current active SSE client count; operators cannot observe SSE connection pressure (e.g., if a misbehaving frontend reconnects on every tab reload). Fix: introduce an `AtomicIsize ACTIVE_SSE_CLIENTS` counter, increment on connect, decrement in the existing disconnect-detection task; emit a `tracing::info!` on each connect/disconnect with the current active count.

- OBSERVATION: `water.py:50`, `fires.py:67`, `inversion.py:61`, `predict.py:49` — All four background poll/scheduler loop exception handlers use `logger.error("... failed: %s", e)`, logging only `str(e)`. For common exception types this is informative, but for asyncpg transport errors (`asyncpg.exceptions.ConnectionFailureError`), httpx SSL failures (`ssl.SSLCertVerificationError`), and structured httpx exceptions (`httpx.ConnectError`), the string representation omits the inner cause chain and the stack frame where the failure occurred. `logger.exception("... failed")` logs the same message plus a full traceback at ERROR level without needing `%s`. The `traceback.print_exc()` calls used in request-handler code (e.g., `predict.py:93`, `inversion.py:100`) write to stderr, which is a separate stream from the Python logging handlers and will be interleaved with tracing output in Docker without ordering guarantees. Fix: replace `logger.error("... %s", e)` with `logger.exception("...")` in all four poll loop handlers; remove `traceback.print_exc()` from request handlers and replace with `logger.exception(...)` to route all error traces through the unified logging pipeline.

**Proposed actions:**
- Demote `cache.py:67,69` cache HIT/MISS logs from `INFO` to `DEBUG` — L/L, score 1.0; does not enter top 10
- Replace sequential awaits in `context.py:60-67` with `asyncio.gather(...)`; add elapsed-time log on slow builds — M/L, score 2.0; does not enter top 10
- Implement `reportError()` POSTing to server in `ErrorBoundary.tsx` and `utils/errorHandling.ts` — M/L, score 2.0; does not enter top 10
- Add `timeout=30.0` to `asyncpg.create_pool` in `database.py:11`; log pool saturation warning — H/L, score 3.0; ties current top 10, does not displace
- Add `ACTIVE_SSE_CLIENTS: AtomicIsize` to `sse.rs` and log current count on connect/disconnect — L/L, score 1.0; does not enter top 10
- Replace `logger.error("... %s", e)` with `logger.exception(...)` in all four poll loop handlers; remove `traceback.print_exc()` from request handlers — M/L, score 2.0; does not enter top 10

## 📚 Archive (one line per past run)
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
