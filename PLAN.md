# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-31T20:10:00Z
Last run: #87 — Lens: Deployment / Docker

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
### Run #87 — 2026-05-31 — Lens: Deployment / Docker
**Scope:** Seventh deployment/Docker pass. Examined: `geointellisense-ingestion/Dockerfile`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/.dockerignore`, `geointellisense-analytics/.dockerignore`, `docker-compose.yml`, `Caddyfile`, `db/init/02-migrations.sh`, `geointellisense-ingestion/src/main.rs`, `geointellisense-analytics/app/main.py`, `geointellisense-ingestion/Cargo.toml`. Cross-checked against Active Recommendations and prior Docker runs #12, #27, #42, #57, #72 (all archived) to confirm all findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/Dockerfile:1-16` — The analytics Dockerfile uses a single-stage build. At lines 3-5, `libgdal-dev` is installed via `apt-get`. `libgdal-dev` is the GDAL development package that includes C headers, static libraries, and the GDAL shared runtime. It is required at `pip install` time for `rasterio` and `geopandas` to compile their C extensions, but the compiled extensions only need the GDAL shared runtime library (`libgdal32` or equivalent) at container runtime — not the full dev package. Because there is no multi-stage build, the entire `libgdal-dev` installation (including headers, ~200MB of transitive dependencies: `libproj-dev`, `libgeos-dev`, `libproj25`, `libgeos3.11.1`, etc.) is retained in the production image layer. A two-stage build would install `libgdal-dev` and compile Python wheels in a `builder` stage, then copy only the compiled `site-packages` directory and `libgdal32` into the final `python:3.12-slim` stage, reducing the image by roughly 180-200MB. PROPOSAL: Convert `geointellisense-analytics/Dockerfile` to a two-stage build: (1) `builder` FROM `python:3.12-slim` installs `libgdal-dev`, runs `pip wheel -r requirements.txt --wheel-dir /wheels`; (2) runtime FROM `python:3.12-slim` installs only `libgdal32` (runtime lib) and runs `pip install --no-index --find-links /wheels -r requirements.txt` — M/M, score 1.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/Dockerfile:11` — `RUN cargo build --release 2>/dev/null || true` discards ALL Cargo stderr output during the dependency pre-compilation step. Cargo writes all compiler diagnostics, build-script output (`build.rs` print statements), and linker errors to stderr. If a transitive dependency's build script fails — for example, `openssl-sys` failing to locate `libssl-dev` headers via `pkg-config`, or `ring` failing to find a C compiler — the error is silently discarded by `2>/dev/null`. The subsequent `RUN touch src/main.rs && cargo build --release` at line 14 then fails at the linking stage with a confusing secondary error message rather than the original root cause. For example, a `pkg-config` failure on `libssl-dev` would produce at line 11 the clear message `"pkg-config exited with status code 1"` (discarded), but at line 14 produce only `"error[E0463]: can't find crate for 'openssl'"` with no root cause. The `|| true` idiom is correct for allowing the layer to succeed even when `src/main.rs` is a stub, but the stderr redirect is unnecessary. PROPOSAL: Change line 11 to `RUN cargo build --release || true` (remove `2>/dev/null`); this preserves all diagnostic output in the Docker build log while still allowing the layer to succeed — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `docker-compose.yml:119-135` — The `gateway` service (Caddy reverse proxy) has no `healthcheck` stanza, making it the only service among all five without health monitoring. The `db` service uses `pg_isready` (line 17), `redis` uses `redis-cli ping` (line 36), `ingestion` uses `curl -sf http://localhost:3001/health` (line 68), and `analytics` uses a Python HTTP check (line 110). The gateway is the sole public ingress point for all client traffic; its failure is more visible than an upstream service failure. Without a healthcheck: (1) `docker compose ps` shows the gateway as "Up" without a `(healthy)` annotation, making automated readiness checks unreliable; (2) monitoring systems (Portainer, Uptime Kuma, custom deploy scripts) that gate on container health state cannot detect a crashed or misconfigured Caddy instance; (3) the `restart: unless-stopped` policy at line 135 fires on exit but not on a process hang, so a hung Caddy (e.g., blocked on a Caddyfile parse error after a hot-reload) is invisible to Docker's restart logic. The gateway's healthcheck can reuse the existing `/health` route (Caddyfile line 15-17 proxies it to `ingestion:3001/health`). The `caddy:2-alpine` image includes BusyBox `wget`. PROPOSAL: Add `healthcheck: {test: ["CMD-SHELL", "wget -qO /dev/null http://localhost:8080/health || exit 1"], interval: 15s, timeout: 5s, retries: 3, start_period: 30s}` to the `gateway` service in `docker-compose.yml` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/.dockerignore:1-6` — The analytics `.dockerignore` excludes `__pycache__`, `*.pyc`, `.venv`, `.env`, `.git`, but does not exclude `data/`. The `docker-compose.yml` mounts three named volumes at `DEM_DATA_DIR=/app/data/dem`, `LANDSAT_DATA_DIR=/app/data/landsat`, and `MODEL_DIR=/app/data/models`. If a developer runs the analytics service locally outside Docker and sets these env vars to paths inside the repository tree (e.g., `./data/dem`), local DEM tiles, Landsat scene archives, or trained `.joblib` model files reside in the build context directory. Without a `data/` exclusion, `docker build` sends all local data files to the Docker daemon as part of the build context, and they are copied into the image via the `COPY . .` instruction at line 12. Landsat scenes can be hundreds of MB per tile. The `.dockerignore` also omits `.pytest_cache/`, `htmlcov/`, `.mypy_cache/`, and `*.egg-info/` — standard directories generated by test runs and type-checking that add no runtime value to the image but inflate build context size. PROPOSAL: Add `data/`, `.pytest_cache/`, `htmlcov/`, `.mypy_cache/`, `*.egg-info/`, `tests/` to `geointellisense-analytics/.dockerignore` — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/Dockerfile:16-26` and `geointellisense-analytics/Dockerfile:1-16` — Neither Dockerfile includes a `USER` instruction; both services run their main processes as root (uid 0) inside the container. The ingestion service runs as root in `debian:bookworm-slim`; the analytics service runs as root in `python:3.12-slim`. If either service is compromised via SSRF, command injection in a system call, or a path traversal in a file-serving route, the attacker obtains a root shell inside the container, gaining write access to all mounted volumes (`pgdata` is not mounted here, but `demdata`, `landsatdata`, `modeldata` are), the ability to install tools or modify the binary, and the ability to exfiltrate credentials from environment variables. Both base images include a `nobody` user (uid 65534). The ingestion service binary (`geointellisense-ingestion`) requires no privileged ports (binds to 3001, >1024) and no elevated filesystem permissions; the analytics service similarly uses only port 3002 and writes to `/app/data/*` directories that can be pre-owned by a non-root user. Adding a non-root user to both Dockerfiles is a contained, low-effort hardening step. PROPOSAL: In `geointellisense-ingestion/Dockerfile` (runtime stage), add `RUN useradd -u 1001 -m appuser` before `COPY --from=builder` and append `USER appuser`; in `geointellisense-analytics/Dockerfile`, add `RUN useradd -u 1001 -m appuser && chown -R appuser /app` after `COPY . .` and append `USER appuser` — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Convert `geointellisense-analytics/Dockerfile` to a two-stage build: builder installs `libgdal-dev` and compiles wheels; runtime installs only `libgdal32` and pre-built wheels — M/M, score 1.0; does not displace top 10
- Remove `2>/dev/null` from `Dockerfile:11` in ingestion Dockerfile so Cargo build errors are visible in Docker build logs — L/L, score 1.0; does not displace top 10
- Add `healthcheck` to `gateway` service in `docker-compose.yml` using `wget -qO /dev/null http://localhost:8080/health` from BusyBox in `caddy:2-alpine` — M/L, score 2.0; does not displace top 10
- Add `data/`, `.pytest_cache/`, `htmlcov/`, `.mypy_cache/`, `*.egg-info/`, `tests/` to `geointellisense-analytics/.dockerignore` to prevent accidental build-context bloat — L/L, score 1.0; does not displace top 10
- Add non-root `USER` instruction to both Dockerfiles (`useradd -u 1001 appuser`) to limit blast radius from container compromise — M/L, score 2.0; does not displace top 10

### Run #86 — 2026-05-31 — Lens: Docs
**Scope:** Sixth docs pass. Examined: `README.md`, `IMPLEMENTATION_STATUS.md`, `.env.local.example`, `docker-compose.yml`, `package.json`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-analytics/app/routes/fires.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/routes/inversion.py`, `geointellisense-analytics/app/routes/admin.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/main.py`, `geointellisense-analytics/app/config.py`. Cross-checked against Active Recommendations and prior docs runs #11, #26, #41, #56, #71 (all archived) to confirm all findings are new.

**Findings:**

- OBSERVATION: `README.md:34` (Architecture section) and `README.md:15-18` (Run Locally section) — The README describes a two-service architecture: "Backend (Express): Runs on http://localhost:3001" and "Frontend (Vite + React): Runs on http://localhost:5174". The `package.json` has no `express` dependency, no `server` script, and no `dev:full` script; both commands the README prescribes (`npm run dev:full`, `npm run server`) fail immediately with "missing script: dev:full" / "missing script: server". The actual system is a four-service docker-compose stack: Rust/Axum ingestion (port 3001), Python/FastAPI analytics (port 3002), TimescaleDB+PostGIS, and a Caddy gateway (port 8080). Neither `docker-compose` nor `docker compose up` appears anywhere in the README. A developer following the README verbatim cannot run the project. PROPOSAL: Rewrite README "Run Locally" section to describe `docker compose up` as the primary path and document the gateway URL (http://localhost:8080); archive or delete the Express references — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `docker-compose.yml:5-22` — The `docker-compose.yml` references 15 environment variables via `${VAR}` interpolation: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_PORT`, `REDIS_PORT`, `INGESTION_PORT`, `ANALYTICS_PORT`, `GATEWAY_PORT`, `ADMIN_TOKEN`, `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, `EPA_AQS_EMAIL`, `EPA_AQS_KEY`, `CENSUS_API_KEY`. The only `.env` example file in the repository is `.env.local.example`, which documents five variables for the Vite frontend (`ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`). There is no `.env.example` (or `.env.docker.example`) at the repository root documenting the docker-compose variables. When a developer runs `docker compose up` without a `.env` file, all 15 variables silently expand to empty strings: `POSTGRES_USER` becomes `""`, causing the `pg_isready` healthcheck to fail, the Rust service to fail DB initialization, and the Python service to start with no API keys. The `${PURPLEAIR_INTERVAL_SECS:-600}` pattern provides defaults only for three optional variables; the required ones (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`) have no defaults and no documentation. PROPOSAL: Create `.env.example` at the repo root listing all 15 docker-compose vars with safe placeholder values and one-line descriptions (e.g., `POSTGRES_PASSWORD=changeme  # Required: DB password`); reference it from README — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/app/routes/fires.py:30-38` — `start_fire_polling()` has no docstring. By contrast, the sibling functions `start_water_polling()` (`water.py:23`) has `"""Start background task that polls USGS every 15 minutes."""` and `start_inversion_polling()` (`inversion.py:25`) has `"""Start background task that checks inversion status every 30 min."""`. The missing docstring is particularly important because `start_fire_polling()` has a non-obvious early-return branch: if `settings.nasa_firms_key` is falsy, the function returns silently without creating a task (lines 32-34), while the other two pollers always start. Without a docstring, this behavior — and the fact that fire polling requires an explicit API key while water and inversion polling do not — is invisible to a developer reading only the `lifespan` startup handler in `main.py`. FastAPI's `/docs` OpenAPI page will also show no description for any route in the fires module (since FastAPI uses the function docstring as the endpoint summary for the `GET /api/fires/active` and `GET /api/fires/history` routes, and neither has a docstring). PROPOSAL: Add `"""Start NASA FIRMS fire polling (30 min interval). No-op if NASA_FIRMS_KEY is not configured."""` to `start_fire_polling()` at `fires.py:30`; also add docstrings to `fires_active` and `fires_history` for OpenAPI parity with `predict.py` routes — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:42-49` (`spawn_ticker` signature) — `spawn_ticker` is a public function with 7 parameters and no doc comment. Its behavior is significantly non-obvious: it conditionally spawns a PurpleAir poll Tokio task only when `pa_client: Option<PurpleAirClient>` is `Some`, and always spawns a second independent broadcast-ticker Tokio task. The two tasks run on different intervals (`purpleair_secs` vs `broadcast_secs`), share state only via the `cache: LiveCache` `Arc<RwLock<...>>`, and the broadcast ticker continues to re-stamp cached data as `Utc::now()` even when PurpleAir is disabled or failing. A developer reading `main.rs` to understand the data flow sees only `broadcast::spawn_ticker(...)` with no indication that this call spawns two concurrent background loops, or that the broadcast loop will emit stale-timestamped data when the PurpleAir loop is absent. The public `AppState` struct at line 27 also has no doc comment explaining that `cache` holds only the last successful PurpleAir fetch (or `None` until the first fetch), which causes the broadcast loop to fall back to mock data. PROPOSAL: Add a `/// Spawns two background tasks: (1) PurpleAir sensor poll (only if pa_client is Some), and (2) broadcast ticker that re-stamps and fans out the latest cache snapshot every broadcast_secs. When PurpleAir is disabled or absent, the broadcast emits mock data.` doc comment before `spawn_ticker` at `broadcast.rs:42`; add `/// Shared state passed to every Axum handler.` to `AppState` — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `IMPLEMENTATION_STATUS.md:87-113` — The "📋 Next Steps — Phase 4: Polish & Production Readiness" section lists three items as pending: (1) accessibility patterns, (2) "Return structured errors from services / Display user-friendly error messages / Add retry mechanisms", and (3) implicitly, authentication. However, items (2) and (3) are already implemented in the current codebase: `utils/errorHandling.ts` defines `withRetry`, `DataServiceError`, `toDataServiceError`, and `fetchWithTimeout`; `app/middleware.py` implements `check_ai_auth` and `check_rate_limit`; the admin token system is live. The `IMPLEMENTATION_STATUS.md` "Current Architecture" section also still contains the comment "Easy to add authentication/rate limiting later" — contradicted by the fact that both are already added. The "Performance Note" about a 696KB bundle warning ("will be addressed in Phase 3") refers to a superseded implementation; the current build does not use the same bundling strategy. A new developer reading this document would believe error handling, retry logic, and auth are missing and would spend time re-implementing them. PROPOSAL: Update `IMPLEMENTATION_STATUS.md` Phase 4 to mark error handling and auth as completed; add a brief Phase 5 section acknowledging the actual open items from Active Recommendations (session ownership, unauthenticated endpoints) — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Rewrite README "Run Locally" and "Architecture" sections to describe `docker compose up` and the four-service stack; remove Express references — M/L, score 2.0; does not displace top 10
- Create `.env.example` at repo root documenting all 15 docker-compose variables with placeholder values and one-line descriptions — M/L, score 2.0; does not displace top 10
- Add docstring to `start_fire_polling()` at `fires.py:30` noting it is a no-op without `NASA_FIRMS_KEY`; add docstrings to `fires_active` and `fires_history` for OpenAPI coverage — L/L, score 1.0; does not displace top 10
- Add `///` doc comment to `spawn_ticker` at `broadcast.rs:42` explaining the two-task design and stale-timestamp behavior — L/L, score 1.0; does not displace top 10
- Update `IMPLEMENTATION_STATUS.md` Phase 4 to reflect that error handling and auth are already implemented; correct or remove the stale "easy to add later" note — L/L, score 1.0; does not displace top 10

### Run #85 — 2026-05-31 — Lens: Observability
**Scope:** Sixth observability pass. Examined: `geointellisense-analytics/app/routes/chat.py`, `app/routes/predict.py`, `app/routes/fires.py`, `app/ml/aqi_model.py`, `app/middleware.py`, `app/main.py`, `app/claude.py`, `geointellisense-ingestion/src/routes/sse.rs`, `src/db/persist.rs`, `src/broadcast.rs`, `src/main.rs`, `services/aiService.ts`, `utils/errorHandling.ts`, `components/ErrorBoundary.tsx`, `hooks/useApiStatus.ts`. Cross-checked against Active Recommendations and prior observability runs #10, #25, #40, #55, #70 (archived) to confirm all findings are new.

**Findings:**

- OBSERVATION: `app/routes/chat.py:88`, `app/routes/predict.py:93`, `app/routes/predict.py:191`, `app/routes/fires.py:135` — Four separate exception handlers call `traceback.print_exc()` and then return a JSON error response, bypassing Python's logging system entirely. `traceback.print_exc()` writes to `sys.stderr` unconditionally; the Python `logging` module has no knowledge of these output streams. If logging is later configured with a structured JSON formatter (e.g., for Datadog, CloudWatch, or Loki), stack traces from these four call sites will appear in raw text on the host's stderr/stdout stream rather than in the structured log pipeline. The existing `logger` instances are already defined in all three modules (`logger = logging.getLogger(__name__)`) and support `logger.exception(msg)` — which both logs the message through the configured handler chain AND appends the current traceback via `exc_info=True`. The correct fix is `logger.exception("Failed to get chat response")` (replacing `traceback.print_exc()` + the error log that doesn't exist). PROPOSAL: Replace each `traceback.print_exc()` call at `chat.py:88`, `predict.py:93`, `predict.py:191`, `fires.py:135` with `logger.exception(...)` using the same message already in the adjacent JSONResponse — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/src/routes/sse.rs:13-19` — `CLIENT_COUNT` is declared as `static CLIENT_COUNT: AtomicUsize = AtomicUsize::new(0)` and is only ever incremented: `CLIENT_COUNT.fetch_add(1, Ordering::Relaxed) + 1`. The value functions as a monotonically increasing connection-sequence-number, not a live gauge of currently-connected SSE clients. After 100 connections (99 of them already disconnected), `CLIENT_COUNT` reads 100, but the actual live subscriber count is 1 (the broadcast channel's `receiver_count()` would return this). The `"SSE client connected"` and `"SSE client disconnected"` log lines use `client_id` (the sequence number) for correlation, which is correct — but there is no periodic or on-demand log line reporting the total live SSE subscriber count. The Tokio broadcast channel already tracks active receivers: `state.tx.receiver_count()` returns the live count. PROPOSAL: Add a `ACTIVE_CLIENTS: AtomicUsize` counter that increments on connect and decrements on disconnect (in the existing disconnect-detector task at `sse.rs:57-65`); log `active_clients` at `INFO` level in both the connect and disconnect messages so operators can track SSE fanout without parsing a stream of connect/disconnect pairs — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `services/aiService.ts:8-28`, `30-50`, `52-72`, `74-94`, `96-116`, `118-152`, `154-186` — All seven exported AI-service functions catch every exception and return a hardcoded fallback string (`"Sorry, I encountered an error. Please try again."`, `"Failed to get a deep analysis response."`, etc.). `console.error` is called, but errors are never passed to the `logError()` function in `utils/errorHandling.ts:305-323` (which has a comment `// In production, you would send this to an error tracking service`) and are never rethrown. As a result, callers (`ChatView.tsx`, `AnalysisView.tsx`) receive a plain string that is displayed verbatim as an "AI response" — there is no mechanism to distinguish a legitimate short answer from a silent error fallback. A user asking the AI a question during a 503 outage sees `"Failed to get a deep analysis response."` styled identically to a real answer. The `withRetry`, `DataServiceError`, and `fetchWithTimeout` infrastructure in `utils/errorHandling.ts` exists precisely for this use case and is unused by `aiService.ts`. PROPOSAL: Replace bare `catch` blocks in `aiService.ts` with `toDataServiceError(error)` from `utils/errorHandling.ts`; throw the typed error so `ChatView` and `AnalysisView` can display a distinct error state (vs. a real response); call `logError(error, 'aiService')` before rethrowing — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:31-33` — `write_readings` iterates over every reading in the broadcast tick and emits one `tracing::error!` per failed INSERT: `tracing::error!(station = %r.station_name, "Failed to persist reading: {e}")`. With the default `broadcast_interval_secs = 5` and a typical batch of 15–20 readings per tick, a sustained DB connection failure generates `20 × (60/5) = 240` individual error log lines per minute with no aggregation, no circuit-breaker, and no log-level escalation after repeated failures. The Rust ingestion service uses `TraceLayer::new_for_http()` (from `main.rs:87`) for HTTP request tracing, but there is no health-state object that tracks "N consecutive persist failures." By contrast, the PurpleAir fetch loop in `broadcast.rs:91` correctly emits a single `tracing::warn!` per failed poll cycle rather than one warning per sensor. PROPOSAL: Track a consecutive-failure counter alongside `write_readings`; emit a single summary `tracing::error!("Failed to persist {failed}/{total} readings this tick: {e}")` and after 3 consecutive all-fail ticks, log at `ERROR` with a note to check DB connectivity — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `app/routes/predict.py:36-49` — `_retrain_loop` begins with `await asyncio.sleep(604800)` (7 days) before the first retrain iteration. On a fresh deployment where the model has never been trained, `GET /api/predict/aqi` returns 503 "Model not trained yet" indefinitely until someone manually calls `POST /api/predict/train`. The `start_retrain_scheduler()` startup log reads `"AQI model retrain scheduler started (weekly)"` — no mention that the first automatic retrain will not start for 7 days. `GET /api/predict/train/status` returns `{"state": "idle"}` throughout the entire 7-day wait, which is identical to the state before the scheduler was ever started; operators have no way to distinguish "scheduler is waiting" from "scheduler is not running". PROPOSAL: (1) Log `logger.info("First scheduled retrain in 7 days; call POST /api/predict/train to train immediately")` inside `start_retrain_scheduler()`; (2) Change `_train_status` to `{"state": "scheduled", "nextRunAt": (now + 7_days).isoformat()}` inside `_retrain_loop` immediately after the task starts, before the sleep — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Replace `traceback.print_exc()` at `chat.py:88`, `predict.py:93`, `predict.py:191`, `fires.py:135` with `logger.exception(...)` to route stack traces through the logging system — M/L, score 2.0; does not displace top 10
- Add `ACTIVE_CLIENTS: AtomicUsize` in `sse.rs`; decrement on disconnect and include `active_clients` in connect/disconnect log events — L/L, score 1.0; does not displace top 10
- Replace bare `catch` blocks in `aiService.ts` with `toDataServiceError` + `logError` + rethrow so callers can render a distinct error state — M/L, score 2.0; does not displace top 10
- Change `persist::write_readings` to emit a single-line summary error per tick rather than one error per row; add a consecutive-failure counter — M/L, score 2.0; does not displace top 10
- Log "first retrain in 7 days" at scheduler startup and set `_train_status` to `{"state": "scheduled", "nextRunAt": ...}` inside `_retrain_loop` before the sleep at `predict.py:39` — L/L, score 1.0; does not displace top 10

## 📚 Archive (one line per past run)
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
