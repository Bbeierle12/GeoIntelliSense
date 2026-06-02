# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-02T01:10:00Z
Last run: #116 — Lens: Docs

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Sanitize AI result before `dangerouslySetInnerHTML` in `AnalysisView.tsx` | UX/Security | H | L | 7 | Open |
| 2 | Add retry+backoff to Rust `PurpleAirClient::fetch_sensors` | Data pipeline | H | L | 8 | Open |
| 3 | Redis-down skips all PurpleAir/earthquake polling — default toggle to ON when Redis unavailable | Data pipeline | H | L | 8 | Open |
| 4 | Propagate `sessionId` through chat calls in `aiService.ts` | TS↔Py contract | H | L | 6 | Open |
| 5 | `GET /api/maps-config` exposes Google Maps API key to unauthenticated callers | Security | H | L | 9 | Open |
| 6 | `POST /api/predict/train` is unauthenticated — any client can trigger expensive model retraining | Security | H | L | 9 | Open |
| 7 | No logging configuration in analytics `main.py` — all `logger.info/debug` calls silently dropped | Observability | H | L | 10 | Open |
| 8 | Health checks return static `"ok"` without probing DB or Redis — failing containers pass healthcheck | Observability | H | L | 10 | Open |
| 9 | `/api/predictive-analysis` and `/api/weather-forecast` have no auth or rate limiting — any public caller can burn Anthropic credits | Security/LLM | H | L | 13 | Open |
| 10 | `context.py:394` SELECT uses `unit` instead of `units` — water-level data silently absent from all Claude system prompts | Data pipeline | H | L | 113 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #116 — 2026-06-02 — Lens: Docs
**Scope:** Eighth docs pass. Examined: `README.md` (full), `IMPLEMENTATION_STATUS.md` (full), `.env.local.example` (full), `package.json` (scripts block), `vite.config.ts` (full), `geointellisense-analytics/app/config.py` (full), `geointellisense-analytics/app/middleware.py` (full), `geointellisense-analytics/app/claude.py` (lines 78–110), `geointellisense-analytics/app/context.py` (lines 280–310, 345–385, 388–428), `geointellisense-analytics/app/routes/predict.py` (lines 1–30), `geointellisense-analytics/app/clients/landsat.py` (lines 1–80), `geointellisense-analytics/app/ml/aqi_model.py` (lines 1–80), `services/aiService.ts` (full), `hooks/useLiveData.ts` (full), `hooks/useViewport.ts` (full), `hooks/useApiStatus.ts` (lines 1–25), `types.ts` (full). Cross-checked against Active Recommendations and runs #114–#115 (Latest Findings) plus archived docs runs #11, #26, #41, #56, #71, #86, #101 (one-line archive) to confirm findings are new.

**Findings:**

- OBSERVATION: `README.md:33-47` and `package.json` (scripts) — The README instructs developers to start the project using `npm run dev:full` (to run backend + frontend together) and `npm run server` (to run the backend alone). Neither script exists: `package.json` defines only `dev`, `build`, `preview`, `test`, `test:ui`, `test:run`, and `test:coverage`. Running either command fails with `npm ERR! Missing script: "dev:full"`. Additionally, `README.md:64` describes the backend as "Backend (Express): Runs on `http://localhost:3001`" — there is no Express server in this repository; the Rust ingestion service (Axum) runs on 3001 and the Python analytics service (FastAPI) runs on 3002. A new developer following the README verbatim cannot run the project: the listed start commands don't exist and the listed backend technology and port are both wrong. PROPOSAL: Update `README.md` to replace the non-existent `npm run dev:full`/`npm run server` instructions with the actual start procedure (e.g., `docker-compose up` or separate terminal commands for `cd geointellisense-ingestion && cargo run`, `cd geointellisense-analytics && uvicorn app.main:app`, and `npm run dev`); correct the architecture section to reflect Rust/Axum on 3001 and Python/FastAPI on 3002 — M/M effort.

- OBSERVATION: `.env.local.example:15-16` vs `hooks/useLiveData.ts:12-13` and `services/aiService.ts:3-6` — `.env.local.example` documents two service-URL variables: `RUST_SERVICE_URL=http://localhost:3001` and `PYTHON_SERVICE_URL=http://localhost:3002`. Neither name is referenced anywhere in the frontend codebase. The frontend reads `import.meta.env.VITE_GATEWAY_URL` (used in `aiService.ts:3-6` and `hooks/useLiveData.ts:12`) and `import.meta.env.VITE_INGESTION_URL` (used in `hooks/useLiveData.ts:13`). Setting `RUST_SERVICE_URL` or `PYTHON_SERVICE_URL` in `.env.local` has zero effect on the running frontend; the app silently falls back to `http://localhost:8080` (gateway) and `http://localhost:3001` (ingestion). The consequence is that a developer in a non-standard network layout (remote dev box, Docker bridge, cloud dev environment) who dutifully configures the documented env vars will find the frontend still pointing at localhost. PROPOSAL: Replace `RUST_SERVICE_URL` and `PYTHON_SERVICE_URL` in `.env.local.example` with the correct names `VITE_INGESTION_URL` (pointing to the Rust service) and `VITE_GATEWAY_URL` (pointing to the Caddy gateway or Python service) — L/L effort.

- OBSERVATION: `.env.local.example` (full file, 16 lines) vs `geointellisense-analytics/app/config.py:5-15` — `config.py` declares 12 settings fields via Pydantic `BaseSettings`; `.env.local.example` documents only 3 of them (`ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`). The following 9 are absent from the example file entirely: `DATABASE_URL` (`config.py:5`), `EPA_AQS_EMAIL` (`config.py:8`), `EPA_AQS_KEY` (`config.py:9`), `AIRNOW_API_KEY` (`config.py:10`), `NOAA_CDO_TOKEN` (`config.py:11`), `NASA_FIRMS_KEY` (`config.py:12`), `REDIS_URL` (`config.py:13`), `CENSUS_API_KEY` (`config.py:14`), `ADMIN_TOKEN` (`config.py:15`). Two additional runtime env vars used in source code are also absent: `LANDSAT_DATA_DIR` (`clients/landsat.py:24`) and `MODEL_DIR` (`ml/aqi_model.py:27`). Without `DATABASE_URL` and `REDIS_URL`, the analytics container fails to connect to infrastructure at startup; without the data-source keys, all polling routes return empty data. A first-time contributor has no documented path to configure a working local environment for the analytics service. PROPOSAL: Extend `.env.local.example` with all 11 missing variables, with inline comments describing each (source/registration URL, whether optional or required, effect when absent) — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/predict.py:16-17`, `geointellisense-analytics/app/claude.py:88`, and `geointellisense-analytics/app/context.py:280-310` — Three separate numeric constants appear with no explanatory comment: (a) `predict.py:16-17` defines `PREDICT_TTL = 1800` (30 min) and `MODEL_TTL = 604800` (7 days) as bare integers; the 7-day `MODEL_TTL` is used to gate automatic retraining (the model is only retrained once per week), but a maintainer reading the code has no indication why weekly was chosen or how it relates to data ingestion volume; (b) `claude.py:88` caches the fully-assembled live context for `CONTEXT_TTL = 60` seconds with no docstring on `get_system_with_live_context()` explaining the TTL choice or the fallback chain (full context → fire-only context → base system prompt, visible at `claude.py:100-108`); (c) `context.py:286` and `context.py:353` both embed the raw coordinate pair `ST_MakePoint(-119.0187, 35.3733)` (downtown Bakersfield) in SQL strings with no inline comment identifying what the point represents or why it is hardcoded rather than configurable — future maintainers or contributors trying to adapt GeoIntelliSense to another region will not recognize these as the geographic center for distance calculations. PROPOSAL: Add a named constant `BAKERSFIELD_CENTER = (-119.0187, 35.3733)` at module level in `context.py` with a comment identifying it; add a module-level docstring to `claude.py` explaining the context assembly/caching pipeline; add inline comments to `predict.py:16-17` explaining the 30-min prediction cache and 7-day retraining interval — L/L effort.

**Proposed actions:**
- Rewrite `README.md` run instructions to use actual start commands (docker-compose or per-service); correct architecture section from "Express on 3001" to "Rust/Axum on 3001, FastAPI on 3002" — M/M effort
- Replace `RUST_SERVICE_URL`/`PYTHON_SERVICE_URL` in `.env.local.example:15-16` with `VITE_INGESTION_URL`/`VITE_GATEWAY_URL` to match actual frontend env var names — L/L effort
- Extend `.env.local.example` with all 11 missing vars (`DATABASE_URL`, `EPA_AQS_EMAIL`, `EPA_AQS_KEY`, `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, `REDIS_URL`, `CENSUS_API_KEY`, `ADMIN_TOKEN`, `LANDSAT_DATA_DIR`, `MODEL_DIR`) with inline comments — L/L effort
- Extract Bakersfield center coord to a named constant in `context.py`; add docstring to `get_system_with_live_context()` in `claude.py`; add inline comments to `predict.py:16-17` TTL constants — L/L effort

### Run #115 — 2026-06-02 — Lens: Observability
**Scope:** Ninth observability pass. Examined: `geointellisense-analytics/app/cache.py` (full), `geointellisense-analytics/app/main.py` (full), `geointellisense-analytics/app/routes/chat.py` (full), `geointellisense-analytics/app/routes/deep_analysis.py` (lines 1–65), `geointellisense-analytics/app/routes/predictive_analysis.py` (lines 1–65), `geointellisense-analytics/app/routes/water.py` (lines 1–55), `geointellisense-analytics/app/routes/fires.py` (lines 1–70), `geointellisense-analytics/app/routes/inversion.py` (full), `geointellisense-analytics/app/routes/predict.py` (lines 1–55), `geointellisense-analytics/app/database.py` (full), `geointellisense-analytics/app/http_client.py` (full), `geointellisense-analytics/app/claude.py` (full), `geointellisense-analytics/app/middleware.py` (full), `geointellisense-analytics/app/config.py` (full), `geointellisense-ingestion/src/redis_cache.rs` (full), `geointellisense-ingestion/src/broadcast.rs` (full), `geointellisense-ingestion/src/main.rs` (full), `geointellisense-ingestion/src/db/persist.rs` (full), `geointellisense-ingestion/src/routes/sse.rs` (full), `components/ErrorBoundary.tsx` (full), `App.tsx` (full). Cross-checked against Active Recommendations and runs #113–#114 (Latest Findings) plus archived observability runs #10, #25, #40, #55, #70, #85, #100 (one-line archive) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/cache.py:70,72` — The `get_cached()` function emits `logger.info("cache HIT %s", key)` and `logger.info("cache MISS %s", key)` on every invocation. Every route handler calls `get_cached()` before issuing any DB query; with 30+ registered routers each making 1–3 cache lookups per request, a moderately loaded deployment produces thousands of INFO log lines per hour whose only content is whether a Redis key existed. By contrast, the Rust ingestion service's equivalent calls in `redis_cache.rs:43-44` use `tracing::debug!` for cache hit/miss, reserving INFO for meaningful events. The effect in the Python service is that meaningful INFO-level events — "USGS Water poll: 7 readings, 3 new", "Inversion check: strength=strong, T_diff=4.2°C" — are buried in cache-hit noise when logs are viewed at INFO level. PROPOSAL: At `cache.py:70`, change `logger.info("cache HIT %s", key)` to `logger.debug("cache HIT %s", key)`; at `cache.py:72`, change `logger.info("cache MISS %s", key)` to `logger.debug("cache MISS %s", key)` — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/main.py:47-57` — The FastAPI `lifespan` startup function calls six async functions (`get_pool()`, `get_redis()`, `start_water_polling()`, `start_fire_polling()`, `start_inversion_polling()`, `start_retrain_scheduler()`) without any surrounding `try/except` or any log output — neither success confirmation nor failure context. If `get_pool()` fails (PostgreSQL not ready at container startup), the exception propagates as a raw `asyncpg.exceptions.ConnectionDoesNotExistError` traceback with no contextual message identifying which step failed. `get_redis()` similarly fails silently if Redis is unreachable. The `start_*` functions (`water.py:29`, `fires.py:31`, `inversion.py:50`, `predict.py:33`) each emit their own success `logger.info(...)`, but these are never reached if an earlier startup step throws. The Rust ingestion service emits `tracing::info!("Connected to database")` at `main.rs:31` and `"Connected to Redis"` at `redis_cache.rs:11` for comparable startup steps. PROPOSAL: In `lifespan()` at `main.py:49-54`, wrap `get_pool()` and `get_redis()` in `try/except` with `logger.critical("DB/Redis startup failed: %s", e); raise`; add `logger.info("DB pool ready")` / `logger.info("Redis ready")` after successful init — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:1,87-92` and `geointellisense-analytics/app/routes/deep_analysis.py:1` — Neither file declares `import logging` or `logger = logging.getLogger(__name__)`. Both files' `except Exception as e:` blocks call `traceback.print_exc()` for error reporting, which writes to `sys.stderr` directly, bypassing Python's `logging` pipeline entirely. In containerized deployments with uvicorn (the standard ASGI server), stdout and stderr are separate streams: structured log collectors (e.g., Fluentd, AWS CloudWatch Logs agent, Datadog) typically capture the process stdout (which Python `logging` defaults to when configured with `StreamHandler`) but may or may not capture stderr. Because chat and deep-analysis are the highest-value endpoints (they consume Anthropic credits and are directly user-visible), their failures are the most critical to observe — yet they are the least likely to appear in production log aggregation. By contrast, every polling route (`water.py`, `fires.py`, `inversion.py`, `predict.py`) properly declares `logger = logging.getLogger(__name__)` and calls `logger.error(...)` in exception handlers. PROPOSAL: Add `import logging` and `logger = logging.getLogger(__name__)` at the top of `chat.py` and `deep_analysis.py`; replace `traceback.print_exc()` with `logger.exception("Chat endpoint error: %s", e)` (resp. `"Deep-analysis endpoint error: %s"`) — L/L effort.

- OBSERVATION: `geointellisense-ingestion/src/redis_cache.rs:26-29` — The `set_heartbeat()` function unconditionally discards the result of its Redis `SET EX` call with `let _: Result<(), _> = conn.set_ex(...).await;`. Compare with `cache_snapshot()` at `redis_cache.rs:31-36`, which performs the same `set_ex` operation but explicitly checks the result and emits `tracing::warn!("Redis SET snapshot failed: {e}")` on failure. The heartbeat key (`geointelli:ingestion:heartbeat`) with a 30-second TTL is the primary liveness signal for any external health monitor that polls Redis (e.g., a Docker healthcheck script or an uptime monitor comparing `GET geointelli:ingestion:heartbeat` against a threshold). If the Redis connection experiences a transient error during a heartbeat write, the key expires after 30 seconds — causing the monitoring system to report the ingestion service as dead — but no log entry is emitted to correlate the monitoring alert with the transient Redis error. PROPOSAL: In `set_heartbeat()` at `redis_cache.rs:28`, replace `let _: Result<(), _> = conn.set_ex(...).await;` with `if let Err(e) = conn.set_ex::<_, _, ()>(&key, ...).await { tracing::warn!("Redis heartbeat write failed: {e}"); }` — matching the pattern already used in `cache_snapshot()` — L/L effort.

**Proposed actions:**
- Downgrade `logger.info("cache HIT/MISS ...")` to `logger.debug(...)` at `cache.py:70,72` to restore signal-to-noise ratio in production INFO logs — L/L effort
- Add startup success/failure logging to `lifespan()` at `main.py:49-54` — L/L effort
- Add `logger = logging.getLogger(__name__)` to `chat.py` and `deep_analysis.py`; replace `traceback.print_exc()` with `logger.exception(...)` — L/L effort
- Add `tracing::warn!` on heartbeat write failure in `set_heartbeat()` at `redis_cache.rs:28`, matching the `cache_snapshot()` pattern — L/L effort

### Run #114 — 2026-06-01 — Lens: Security
**Scope:** Eighth security pass. Examined: `geointellisense-analytics/app/main.py` (full), `geointellisense-analytics/app/middleware.py` (full), `geointellisense-analytics/app/config.py` (full), `geointellisense-analytics/app/routes/admin.py` (full), `geointellisense-analytics/app/routes/maps_config.py` (full), `geointellisense-analytics/app/routes/predict.py` (full), `geointellisense-analytics/app/routes/explore.py` (full), `geointellisense-analytics/app/routes/ai_context.py` (full), `geointellisense-analytics/app/routes/landsat.py` (full, route side), `geointellisense-analytics/app/clients/landsat.py` (lines 1–30, 323–345), `geointellisense-analytics/app/routes/chat.py` (middleware imports), `geointellisense-analytics/app/routes/deep_analysis.py` (middleware imports). Enumerated all routes for `check_ai_auth`/`check_rate_limit` calls. Cross-checked against Active Recommendations and runs #112–#113 (Latest Findings) plus archived security runs #9, #24, #39, #54, #69, #84, #99 (one-line archive) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/main.py:69-78` — The CORS middleware is configured with `allow_credentials=True` unconditionally (line 77), but in dev mode (when `settings.admin_token` is the empty string default from `config.py:15`) the `_allowed_origins` list is overridden to `["*"]` at line 70. Per the CORS Level 2 specification (and Starlette's own warning: `"CORS: Cannot use allow_credentials=True with wildcard 'allow_origins'"`) this combination is **invalid**: the `Access-Control-Allow-Origin: *` header and `Access-Control-Allow-Credentials: true` header cannot legally appear together in the same response. Modern browsers (Chrome 119+, Firefox 121+, Safari 17+) silently discard cross-origin responses that present this combination and reject the request with a CORS error — the front-end SPA at `http://localhost:5173` therefore cannot make credentialed cross-origin calls to the API in dev mode when no `admin_token` is set. The fix is straightforward: move `allow_credentials=True` inside the production branch only (when `_allowed_origins != ["*"]`), or remove it entirely since the API currently uses `x-api-key` header-based auth (which does not require `allow_credentials`) rather than cookies. PROPOSAL: At `main.py:72–78`, pass `allow_credentials=False` when `_allowed_origins == ["*"]`; alternatively, remove `allow_credentials=True` from the `CORSMiddleware` call entirely since no route relies on cookies — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/landsat.py:159-166` and `geointellisense-analytics/app/clients/landsat.py:331` — The `GET /api/landsat/tile/ndvi-change/{product}/{z}/{x}/{y}.png` endpoint declares `product: str = Path(...)` with no validation constraint. At line 166 the handler constructs `filename = f"{product}.tif"` and at `clients/landsat.py:331` resolves `path = DATA_DIR / filename`. Python's `pathlib.Path` does NOT canonicalize traversal sequences during division: `Path("/app/data/landsat") / "../../etc/someconfig.tif"` yields the path `/app/data/landsat/../../etc/someconfig.tif`, which resolves to `/app/etc/someconfig.tif`. The `.tif` suffix prevents reading most OS-level secrets, but rasterio's `open()` at `clients/landsat.py:343` will attempt to parse any reachable file with that extension as a GeoTIFF — triggering a rasterio error that bubbles up and is caught by the bare `except Exception: return None` at line 368, so no information is leaked. The risk is that a determined attacker could fingerprint the filesystem layout by probing which paths exist (transparent PNG returned from non-existent `.tif`) versus which paths produce rasterio parse errors (different response timing). The correct fix is to validate `product` against the output of `get_computed_products()` (which lists all valid product stems via `DATA_DIR.glob("ndvi_change_*.tif")` at `clients/landsat.py:430`) before building the filename. PROPOSAL: In the `ndvi_change_tile` handler at `routes/landsat.py:163`, call `get_computed_products()` and validate that `product` is in the returned list; return HTTP 404 immediately if not — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/explore.py:41-42` and `explore.py:151-160` — The `GET /api/analysis/explore` endpoint accepts a `bucket: str` query parameter with no allowlist constraint (`bucket: str = Query("1 day", description="Time bucket: 1 hour, 6 hours, 1 day")`). The value is passed as the first positional parameter to PostgreSQL's `time_bucket($1::interval, time)` function in all five source queries at `explore.py:151-218`. An attacker can pass `bucket=1 second` combined with `days=365`, instructing TimescaleDB to compute 31,536,000 one-second buckets across a full year of `sensor_readings` rows per query. The `/api/analysis/explore` endpoint applies only the `data_default` rate limit (60 req/min per client IP) inherited from `middleware.py:26`, meaning a single client can issue 60 such queries per minute. Each query scans the full `sensor_readings` table partitioned by day and performs a massive GROUP BY — this is sufficient to saturate the DB at high ingestion volumes. The hint in the description (`"1 hour, 6 hours, 1 day"`) documents the intended values but they are not enforced. PROPOSAL: Replace the `bucket: str` parameter at `explore.py:41` with `bucket: Literal["1 hour", "6 hours", "1 day"] = Query("1 day")` (using `typing.Literal` or a FastAPI `Enum`), which causes FastAPI to reject any other value with HTTP 422 before the query is issued — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/ai_context.py:12-32` — The `GET /api/ai/context` endpoint is completely unauthenticated and does not call `check_ai_auth` or `check_rate_limit`. It returns `build_live_context()` — the full assembled object that is injected into Claude's system prompt on every AI request — including live AQI readings from all PurpleAir sensors, active fire locations with FRP values, earthquake events, water levels, EnviroScreen scores, and inversion layer state. The `freshness` sub-objects for each data source (e.g. `{"status": "unavailable", "last_seen": null}` or `{"status": "fresh", "age_seconds": 12}`) reveal which data pollers are active, which are failing, and how recently each data pipeline wrote to the DB. An unauthenticated external caller can use this endpoint to: (a) extract all real-time sensor readings without going through the intended data endpoints; (b) perform reconnaissance on poller health to identify which pipelines to target for disruption; (c) observe inversion layer and AQI data ahead of time before a premium alert feature would surface it. The 60-second cache at `CONTEXT_TTL = 60` limits DB load but not attacker query rate. PROPOSAL: Add `check_ai_auth(request)` (at minimum a rate-limit check via `check_rate_limit(request, "data_default")`) to `ai_context()` at `ai_context.py:12`; import `Request` from FastAPI and `check_rate_limit` from `app.middleware` — L/L effort.

**Proposed actions:**
- Fix CORS misconfiguration at `main.py:72-78`: pass `allow_credentials=False` when `allow_origins=["*"]` (dev mode), or remove `allow_credentials=True` entirely — L/L effort
- Validate `product` path parameter against `get_computed_products()` at `routes/landsat.py:163` before constructing filesystem path — L/L effort
- Change `bucket: str` to `bucket: Literal["1 hour", "6 hours", "1 day"]` at `explore.py:41` to block expensive sub-hour timeseries queries — L/L effort
- Add `check_rate_limit(request, "data_default")` (and optionally `check_ai_auth`) to `GET /api/ai/context` at `ai_context.py:12` — L/L effort

## 📚 Archive (one line per past run)
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
