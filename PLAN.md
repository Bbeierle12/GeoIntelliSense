# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T15:20:00Z
Last run: #11 — Lens: Docs

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
| 10 | Add `trainedAt` to `predict_aqi()` return dict (or remove from `PredictionResult` TS type) | TS↔Py contract | M | L | 6 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #11 — 2026-05-28 — Lens: Docs
**Scope:** `README.md`, `IMPLEMENTATION_STATUS.md`, `.env.local.example`, `docker-compose.yml`; `geointellisense-analytics/app/config.py`, `app/main.py`, `app/routes/chat.py`, `app/routes/deep_analysis.py`, `app/routes/grounded_search.py`, `app/routes/admin.py`; `geointellisense-ingestion/src/aqi.rs`, `src/broadcast.rs`, `src/config.rs`, `src/main.rs`; `services/aiService.ts`; `components/dashboard/widgets/InversionWidget.tsx`, `WaterWidget.tsx`, `WeatherWidget.tsx`.

**Findings:**

- OBSERVATION: `README.md:64` — The Architecture section states "**Backend** (Express): Runs on `http://localhost:3001`." The actual production stack has no Express server in Docker: the Rust ingestion service listens on port 3001, a Python FastAPI analytics service on port 3002, and a Caddy API gateway on port 8080. The Express `server/index.js` is a dev-only proxy and does not appear in `docker-compose.yml` at all. A new contributor following the README will be confused about which backend serves which API routes. The "How to Run" section (`npm run dev:full`) also never mentions Docker Compose, which is the only way to start the Rust, Python, and database services.

- OBSERVATION: `.env.local.example` is materially incomplete. It documents only 5 variables (`ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`). The `docker-compose.yml` ingestion service block additionally requires `ADMIN_TOKEN`, `PURPLEAIR_INTERVAL_SECS`, and `BROADCAST_INTERVAL_SECS` (and the DB/Redis port variables). The analytics `config.py` (`Settings` class) reads `EPA_AQS_EMAIL`, `EPA_AQS_KEY`, `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, and `CENSUS_API_KEY` — none of which appear in `.env.local.example`. Without these keys, the 12 Python API clients that lack retry logic (see Run #8) silently return empty results, but there is no documentation telling a deployer which keys are needed for which data source.

- OBSERVATION: `docker-compose.yml` analytics service block passes `GOOGLE_MAPS_API_KEY`, `DEM_DATA_DIR`, `LANDSAT_DATA_DIR`, and `MODEL_DIR` as environment variables into the container, but `geointellisense-analytics/app/config.py` (`Settings` class) does not declare any of these four fields. They are never read by the analytics service. Either they are vestigial from an earlier implementation, are silently consumed by child processes, or the `config.py` `Settings` class needs to be updated to reflect them.

- OBSERVATION: `IMPLEMENTATION_STATUS.md` is stale in two ways. (1) Phase 1.1 is marked "Secure API Key Management ✅ COMPLETED" and states the Maps key is "Protected via backend endpoint `/api/maps-config`," but this endpoint remains unauthenticated (Open in Active Recommendation #6, found Run #9). (2) The "How to Run" section instructs users to create a `.env` with only `ANTHROPIC_API_KEY` and `GOOGLE_MAPS_API_KEY`, which is insufficient for the Docker stack: the database, Redis, ingestion service, and analytics service each require additional variables documented nowhere in the file.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:23` — `async def chat()`, the primary AI endpoint, has no docstring. It accepts `ChatRequest` (with fields `message: str` and `session_id: str | None`), performs auth + rate-limit checks, runs up to 5 Anthropic tool-call rounds, and returns `{"text": ..., "sessionId": ...}` — none of which is stated in the function signature, decorator, or body. `grounded_search.py:24` (`async def grounded_search()`) and `deep_analysis.py:18` (`async def deep_analysis()`) share the same gap: no docstring on the route handler. Together these three handle all AI-facing traffic but have zero inline documentation of auth requirements, input validation, return shape, or error codes.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs` — Public type aliases and functions lack `///` doc comments. `AqiBroadcast` (line 13), `LiveCache` (line 16), and `EarthquakeCache` (line 20) are type aliases with no explanation of lock semantics or update frequency. `pub fn create() -> AqiBroadcast` (line 33) has no doc; `pub fn spawn_ticker(tx, pool, cache, redis, pa_client, broadcast_interval_secs, purpleair_interval_secs)` (line 38) takes 7 parameters and has no `///` explaining what each does or what goroutine/task it spawns. Only `spawn_earthquake_poller` (line 133) has a two-line doc comment.

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs` — Five public functions have no `///` doc comments: `stations()` (line 53), `aqi_category()` (line 88), `generate_readings()` (line 99), `generate_history()` (line 138), and `round2()` (line 164). These are the only mock-data generators for the entire ingestion service; when `PURPLEAIR_API_KEY` is absent every SSE broadcast uses their output, but there is no inline documentation of the AQI formula, the bounding box, the mock station list, or the history generation algorithm.

- OBSERVATION: `services/aiService.ts` — Seven exported async functions (lines 8, 30, 52, 74, 96, 118, 154: `getChatResponse`, `getGroundedSearchResponse`, `getGroundedMapsResponse`, `getLowLatencyResponse`, `getDeepAnalysisResponse`, `getPredictiveAnalysisResponse`, `getWeatherForecastResponse`) have no JSDoc. There is no inline documentation of which backend endpoint each function calls, what `x-api-key` header value is expected, what the resolved Promise shape is, or what exceptions are thrown on 401/429/500 responses.

- OBSERVATION: `geointellisense-analytics/app/routes/admin.py:11` — `def _check_admin(token: str | None) -> JSONResponse | None:` has no docstring. This security-critical helper is called at the top of every admin route and returns a 403/401 `JSONResponse` on failure or `None` on success, but nothing in the function explains this sentinel-return contract. A developer adding a new admin route must read the body to understand the calling convention.

- OBSERVATION: `geointellisense-ingestion/src/config.rs` — `Config` struct and its only method `pub fn from_env() -> Self` have no `///` doc comments. `config.rs` is the single source of truth for every environment variable consumed by the ingestion service, but none of the fields documents its default value, valid range, or effect. `earthquake_interval_secs` (default 300 s) and `broadcast_interval_secs` (default 5 s) are performance-sensitive tunables that affect SSE client freshness; their operational implications are undocumented.

**Proposed actions:**
- Update `README.md:37-64` to replace Express/3001 with Rust ingestion/3001 + Python FastAPI/3002 + Caddy/8080; add a "Docker Compose" section explaining `docker compose up` as the correct startup path — not in top 10 (M/L, score 2.0; ties with item 10 but first seen run 11)
- Extend `.env.local.example` to include all analytics API keys (`EPA_AQS_EMAIL`, `EPA_AQS_KEY`, `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, `CENSUS_API_KEY`) and ingestion tunables (`ADMIN_TOKEN`, `PURPLEAIR_INTERVAL_SECS`, `BROADCAST_INTERVAL_SECS`) with comments — not in top 10 (M/L, score 2.0)
- Audit and remove or document `GOOGLE_MAPS_API_KEY`, `DEM_DATA_DIR`, `LANDSAT_DATA_DIR`, `MODEL_DIR` in `docker-compose.yml` analytics env block — not in top 10 (M/L, score 2.0)
- Update `IMPLEMENTATION_STATUS.md` to reflect open security items (maps-config, predict/train) — not in top 10 (L/L, score 1.0)
- Add docstrings to `chat.py:23`, `grounded_search.py:24`, `deep_analysis.py:18` route handlers describing auth, rate limit, Claude model used, and return shape — not in top 10 (L/L, score 1.0)
- Add `///` doc comments to `broadcast.rs:create`, `spawn_ticker`, and type aliases; add `//!` crate-level doc to `src/main.rs` — not in top 10 (L/L, score 1.0)
- Add JSDoc to all seven `services/aiService.ts` exports — not in top 10 (L/L, score 1.0)

### Run #10 — 2026-05-28 — Lens: Observability
**Scope:** `geointellisense-analytics/app/main.py`, `app/middleware.py`, `app/cache.py`, `app/database.py`, `app/routes/health.py`, `app/routes/chat.py`, `app/routes/deep_analysis.py`, `app/routes/predict.py`, `app/routes/grounded_search.py`, `app/routes/explore.py`, `app/routes/admin.py`, `app/ml/aqi_model.py`, `app/http_client.py`, `app/claude.py`; `geointellisense-ingestion/src/main.rs`, `src/routes/health.rs`, `src/routes/sse.rs`, `src/db/persist.rs`; `utils/errorHandling.ts`; `components/ErrorBoundary.tsx`; `docker-compose.yml`; `geointellisense-analytics/requirements.txt`; `geointellisense-ingestion/Cargo.toml`.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/main.py` — Zero logging configuration: no `logging.basicConfig()`, no format string, no root-logger handler, no `log_config` passed to `uvicorn.run()`. Every `logging.getLogger(__name__)` call across the codebase (`cache.py`, `http_client.py`, `predict.py`, `explore.py`, `aqi_model.py`, `middleware.py`) resolves to Python's `lastResort` handler (stderr, WARNING+ only). `logger.info("cache HIT ...")`, `logger.info("cache MISS ...")`, `logger.info("AQI model retrain complete: R²=%.4f", ...)`, `logger.debug(...)`, and `logger.warning("Rate limit check failed ...")` are all silently discarded at runtime. Uvicorn access log and error log also use the default (unformatted) Python logging because no `log_config` is supplied. No structured fields (request ID, session ID, endpoint, latency) appear in any log line.

- OBSERVATION: `geointellisense-analytics/app/routes/health.py:7-13` and `geointellisense-ingestion/src/routes/health.rs:8-15` — Both health endpoints return `{"status": "ok"}` unconditionally, with no dependency probe. The analytics `docker-compose.yml` healthcheck (`python -c urllib.request.urlopen('http://localhost:3002/api/health')`) passes even when the `asyncpg` pool is exhausted, when Redis is unreachable, or when `ANTHROPIC_API_KEY` is absent. The ingestion healthcheck (`curl -sf http://localhost:3001/health`) similarly passes when the PgPool or Redis connection is broken. Docker marks these containers `healthy` and Caddy continues routing traffic to them while their data dependencies are down.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:57`, `deep_analysis.py:57`, `grounded_search.py` (final `except Exception as e` block), `predict.py:_run_training` (final `except Exception as e`) — All four 500-error paths call `traceback.print_exc()` directly, writing unformatted tracebacks to `sys.stderr`. They do not call `logger.exception(...)`, which would route the traceback through the logging system where a formatter, handler, or aggregator could capture it with structured fields. Because no root logger is configured (finding above), even switching to `logger.exception()` today would still drop the record; the two fixes are a coupled unit of work.

- OBSERVATION: `geointellisense-analytics/app/middleware.py` and `app/main.py` — No request-correlation middleware exists. No `X-Request-ID` header is injected or propagated. Each chat request in `chat.py` triggers up to 5 tool-call rounds in `claude.py:execute_tool()`, each of which makes outbound `httpx` calls to internal and external endpoints; there is no shared identifier linking these sub-requests in logs. The Rust ingestion service logs `tracing::info!(client_id, "SSE client connected")` per client, but the Python analytics side has no equivalent per-request tracing context.

- OBSERVATION: `geointellisense-analytics/requirements.txt` and `geointellisense-ingestion/Cargo.toml` — Neither service includes a metrics library (`prometheus-fastapi-instrumentator`, `metrics`, `opentelemetry`, etc.). No `/metrics` endpoint exists. There are no counters or gauges for: AQI ingestion events per source, Anthropic API call counts per model, Claude tool-call rounds per request, cache hit/miss ratio (logged but not aggregated), SSE client session counts, or external API error rates. `sse.rs:CLIENT_COUNT` is an `AtomicUsize` tracking total SSE clients since startup but its value is never surfaced through any endpoint or export.

- OBSERVATION: `docker-compose.yml` — No `logging:` key is present for any of the four services (`db`, `redis`, `ingestion`, `analytics`). The default `json-file` driver applies with no `max-size` or `max-file` limits. Once logging is configured, the analytics service will emit one `cache HIT/MISS` line per cache read; the ingestion service emits one broadcast `tracing::info!` per tick at `BROADCAST_INTERVAL_SECS` (default 5 s), producing ~17,000 lines/day from that loop alone. On long-running deployments this exhausts disk space with no log rotation.

- OBSERVATION: `utils/errorHandling.ts:193` (`logError()`) and `components/ErrorBoundary.tsx:componentDidCatch` — `logError()` contains the comment `// In production, you would send this to an error tracking service`. `ErrorBoundary.componentDidCatch` only calls `console.error('ErrorBoundary caught an error:', error, errorInfo)` with no external report. There is no Sentry, LogRocket, or Datadog integration, no `window.onerror` handler, and no `window.onunhandledrejection` listener anywhere in the frontend codebase. Browser-side JavaScript exceptions and React render errors are invisible outside the user's browser DevTools.

- OBSERVATION: `geointellisense-analytics/app/routes/predict.py` (`start_training` and `_run_training`) — `_train_status` is set to `{"state": "running", "minDays": min_days}` with no `startedAt` timestamp; the completion entry `{"state": "completed", "result": meta}` carries no `completedAt`. Operators polling `GET /api/predict/train/status` cannot determine how long training has been running or whether a `"running"` state is hung. The weekly `_retrain_loop()` has no status tracking at all — it produces no externally observable state between log lines (which are currently dropped, per finding #1).

**Proposed actions:**
- Add `logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")` (or JSON formatter via `python-json-logger`) to `geointellisense-analytics/app/main.py`; replace all `traceback.print_exc()` calls in `chat.py:57`, `deep_analysis.py:57`, `grounded_search.py`, `predict.py:_run_training` with `logger.exception(...)` → Active Recommendation #8
- Extend `GET /api/health` (`health.py`) to `await pool.fetchval("SELECT 1")` and `await redis.ping()`, returning 503 on failure; extend ingestion `health::check()` to probe its `PgPool` and Redis connection → Active Recommendation #9
- Add `X-Request-ID` middleware to `app/main.py` (generate UUID if absent, inject into `request.state`, include in all log records and responses) — not in top 10 (M/M, score 1.0)
- Add `prometheus-fastapi-instrumentator` to `requirements.txt` and mount `/metrics` in `app/main.py`; expose `CLIENT_COUNT` from `sse.rs` via a `/metrics` route — not in top 10 (M/H, score 0.67)
- Add `logging: {driver: json-file, options: {max-size: "20m", max-file: "5"}}` to all four services in `docker-compose.yml` — not in top 10 (M/L, score 2.0; demoted by earlier first-seen of item #10)
- Add `startedAt` / `completedAt` ISO timestamps to `_train_status` dict in `predict.py` — not in top 10 (L/L, score 1.0)
- Wire Sentry SDK in frontend (`@sentry/react`) and backend (`sentry-sdk[fastapi]`); replace `console.error` in `ErrorBoundary.componentDidCatch` and `logError()` — not in top 10 (M/H, score 0.67)

### Run #9 — 2026-05-28 — Lens: Security
**Scope:** `app/middleware.py`, `app/config.py`, `app/main.py`, `app/routes/admin.py`, `app/routes/chat.py`, `app/routes/deep_analysis.py`, `app/routes/predict.py`, `app/routes/maps_config.py`, `app/routes/ai_context.py`, `app/routes/explore.py`, `app/claude.py`; `src/routes/admin.rs`, `src/config.rs`; `docker-compose.yml`; `Caddyfile`.

**Findings:**

- OBSERVATION: `app/routes/maps_config.py:11-12` — `GET /api/maps-config` returns `GOOGLE_MAPS_API_KEY` in plaintext JSON to any unauthenticated caller with no `check_ai_auth`, no rate limit, and no referrer restriction check. The Caddyfile routes all `/api/*` paths through the public gateway with no path-level restriction. Any browser or script can retrieve the API key and use the project's Maps quota/billing.

- OBSERVATION: `app/routes/predict.py:start_training()` — `POST /api/predict/train` calls neither `check_ai_auth` nor `check_rate_limit`. An unauthenticated caller can repeatedly trigger background RandomForest retraining (full sensor-readings DB scan for up to 730 days). The 409 guard `if _train_task and not _train_task.done()` prevents concurrent runs but not sequential flooding: once the task completes, the endpoint immediately accepts the next training request.

- OBSERVATION: `app/routes/chat.py:chat_reset()` and `new_session()` — `POST /api/chat/reset` and `POST /api/chat/session` carry no auth check and no rate limit. `chat_reset` accepts any `session_id` in the POST body and clears that session's history via `reset_session(session_id)`. A caller who discovers any valid UUID can silently erase another user's conversation context (IDOR). `chat/session` can be spammed to cycle through the 100-session LRU (evicting active sessions) without throttle.

- OBSERVATION: `app/routes/ai_context.py:ai_context()` — `GET /api/ai/context` has no auth check. The endpoint assembles and returns the full internal live-data context (current AQI readings, NWS forecast, fire detections, earthquake events, USGS water levels, enviroscreen data) that is injected verbatim into AI system prompts. The docstring labels it "debugging and inspection," but it is publicly accessible through the Caddy gateway on the same `/api/*` passthrough rule.

- OBSERVATION: `app/main.py:63-70` — In dev mode (`settings.admin_token` is empty), `_allowed_origins = ["*"]` while `allow_credentials=True` remains set unconditionally. FastAPI/Starlette `CORSMiddleware` either raises `ValueError: Cannot use allow_credentials=True with wildcard allow_origins` (crashing the dev server at startup) or silently drops the `Access-Control-Allow-Credentials` header, breaking auth-header sharing. The intent — unrestricted dev access — is not achieved; the fix is `allow_credentials=False` when the origin list is `["*"]`.

- OBSERVATION: `app/middleware.py:check_ai_auth():89` and `app/routes/admin.py:_check_admin():12-13` — Both functions compare provided tokens with configured secrets using Python's `==` operator (`if api_key == settings.admin_token:`, `if token != settings.admin_token:`). CPython `str.__eq__` short-circuits on first mismatch, so comparison time correlates with matching prefix length. The same issue exists in `src/routes/admin.rs:31` (`if provided != token`). The correct fixes are `hmac.compare_digest()` (Python stdlib) and `subtle::ConstantTimeEq` (Rust) to eliminate timing oracle risk.

- OBSERVATION: `app/routes/chat.py`, `deep_analysis.py`, `grounded_search.py`, `predict.py` — All `except Exception as e` 500 handlers return `"details": str(e)` directly in the JSON response body. Exception messages from `asyncpg`, `anthropic`, and `httpx` can contain database DSN fragments, API key prefixes, internal file paths, and model identifiers. These details are forwarded to unauthenticated external callers, aiding stack fingerprinting.

- OBSERVATION: `docker-compose.yml:Redis service` — Redis runs with no `--requirepass` option. The `geointellisense` bridge network is shared by all four containers (db, redis, ingestion, analytics). Any process running inside the analytics container — including code executed via the AI tool loop in `app/claude.py:execute_tool()`, which makes unrestricted `httpx` calls to internal service endpoints — can connect to `redis://redis:6379` without credentials and delete `geointelli:ratelimit:*` keys to bypass all AI-endpoint rate limiting.

**Proposed actions:**
- Add `check_ai_auth` to `GET /api/maps-config`; or restrict Maps API key by HTTP Referrer in Google Cloud Console → Active Recommendation #6
- Add `check_ai_auth` + `check_rate_limit(..., "ai_deep")` to `POST /api/predict/train` → Active Recommendation #7
- Add `check_ai_auth` to `GET /api/ai/context` — not in top 10 (M/L, score 2.0; ties items 8-10)
- Fix dev-mode CORS: set `allow_credentials=False` when `allow_origins=["*"]` — not in top 10 (M/L, score 2.0)
- Replace `==` / `!=` token comparisons with `hmac.compare_digest` (Python) and `subtle::ConstantTimeEq` (Rust) — not in top 10 (M/L, score 2.0)
- Replace `"details": str(e)` with sanitized messages in all 500 handlers — not in top 10 (M/L, score 2.0)
- Add `--requirepass` to Redis in docker-compose and update `REDIS_URL` env vars — not in top 10 (M/M, score 1.0)
- Add rate limit to `POST /api/chat/reset` and `POST /api/chat/session` — not in top 10 (M/M, score 1.0)

## 📚 Archive (one line per past run)
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
