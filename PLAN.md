# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T12:05:00Z
Last run: #103 — Lens: LLM integration quality

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
### Run #103 — 2026-06-01 — Lens: LLM integration quality
**Scope:** Seventh LLM integration quality pass. Examined: `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/config.py`, `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/deep_analysis.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/grounded_maps.py`, `geointellisense-analytics/app/routes/low_latency.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/routes/weather_forecast.py`. Cross-checked against Active Recommendations and runs #101–#102 (Latest Findings) plus archived LLM runs #88, #73, #58, #43, #28, #13 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `claude.py:74-75` — `get_client()` returns `anthropic.Anthropic(api_key=settings.anthropic_api_key)` — the **synchronous** Anthropic SDK client. Every AI route handler (`chat.py:43`, `deep_analysis.py:33`, `grounded_search.py:39`, `grounded_maps.py:46`, `low_latency.py:31`, `predictive_analysis.py:91`, `weather_forecast.py:75`) is declared `async def` and is executed on uvicorn's asyncio event loop, but calls `client.messages.create(...)` without `await`. The synchronous `messages.create` uses an `httpx.Client` (blocking I/O) that does NOT yield back to the event loop during the HTTP call. This means the event loop is frozen for the entire duration of every Claude API round-trip — typically 3–30+ seconds for Sonnet, and up to 120s for an Opus extended-thinking call with `budget_tokens=32768` (`deep_analysis.py:41`). During that freeze, ALL other requests to this uvicorn worker (including the health-check probe at `GET /api/health`, PurpleAir polling callbacks, and concurrent user requests) are queued until the AI call completes. With the single-worker default, this effectively serializes all users. The fix is to replace `anthropic.Anthropic` at `claude.py:75` with `anthropic.AsyncAnthropic`, make `get_client()` return the async variant, and add `await` before every `client.messages.create(...)` call in the six route files. PROPOSAL: Change `claude.py:74-75` to return `anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)`; add `await` to every `messages.create` call in all six AI route handlers — H/L, score 3.0; tied with existing top 10 (tiebreak: earlier first-seen rows remain).

- OBSERVATION: `context.py:61-68` — `build_context_text()` is on the hot path for every AI chat request (cache miss every 60 seconds; `get_system_with_live_context` at `claude.py:88`). It runs eight independent async DB/Redis queries completely serially: `_get_aqi_context` (line 61), `_get_forecast_context` (62), `_get_fire_context` (63), `_get_earthquake_context` (64), `_get_water_context` (65), `_get_enviroscreen_context` (66), `_get_inversion_context` (67, sync), `_get_prediction_context` (68). Because each is `await`-ed individually, each query blocks the coroutine until it returns before the next starts. The eight queries are entirely independent — no query depends on any other's output. Under a typical asyncpg pool with a local DB, each query adds ~2–5ms latency. Total sequential latency: 16–40ms per 60-second cache-miss. With `asyncio.gather()` all eight would complete in the latency of the slowest single query. This overhead is most damaging for `POST /api/low-latency` (`low_latency.py`), which uses `claude-haiku-4-5-20251001` explicitly for minimum end-to-end latency, but then waits up to 40ms for context serialization before the model call. PROPOSAL: Replace the eight sequential `await` calls at `context.py:61-68` with `results = await asyncio.gather(_get_aqi_context(pool), _get_forecast_context(pool), _get_fire_context(pool), _get_earthquake_context(pool), _get_water_context(pool), _get_enviroscreen_context(pool), asyncio.coroutine_wrapper(_get_inversion_context), _get_prediction_context(pool))` and unpack into `context` dict — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `grounded_search.py:47-72`, `grounded_maps.py:53-79`, `deep_analysis.py:46-76` — All three multi-round tool-use loops have a context-accumulation bug that manifests on the third tool-use round and beyond. In `grounded_search.py`, the while-loop body captures `assistant_content = resp.content` (line 52) and then calls the API with `messages=[{"role": "user", "content": req.prompt}, {"role": "assistant", "content": assistant_content}, {"role": "user", "content": tool_results}]` (lines 62-72). On round 2, `assistant_content` holds round-1's assistant message and `tool_results` holds round-1's tool results — correct. On round 3, `assistant_content` holds round-2's assistant message and `tool_results` holds round-2's tool results, but the messages list is reconstructed anew from only those three entries: the round-1 assistant response and round-1 tool results have been discarded entirely. The model is asked to continue reasoning without access to the data it retrieved in round 1. For the five-round cap at `grounded_search.py:49`, rounds 3–5 see at most one prior tool-call. `deep_analysis.py` has the same pattern with a three-round cap (`line 48`). PROPOSAL: Accumulate messages across rounds: initialize `messages = [{"role": "user", "content": req.prompt}]` before the while loop, and after each tool-call response append `{"role": "assistant", "content": resp.content}` and `{"role": "user", "content": tool_results}` to the same list rather than rebuilding from scratch — M/M, score 1.0; does not displace top 10.

- OBSERVATION: `claude.py:29-65` — `_sessions: dict[str, list[dict]]` and `_session_order: list[str]` are module-level global dictionaries. In Python, each `uvicorn --workers N` invocation spawns N independent OS processes, each with its own copy of the module-level state. A session created via `POST /api/chat/session` returns a `session_id` UUID that is stored only in the worker process that handled that request. Subsequent chat messages with that `session_id` may be load-balanced to a different worker, which has no record of the session; `get_session_history(session_id)` at `claude.py:46` returns an empty list silently, and the chat handler creates a new history entry as if it were a fresh conversation (the user's prior messages are lost). The client receives `{"text": "...", "sessionId": "same-uuid"}` with no error indication. Active Rec #10 (predictive-analysis/weather-forecast have no auth) and the Docker run #102 recommendation to add `--workers 2` compound this: adding workers makes the session-loss issue more frequent. Redis is already in the service topology (`docker-compose.yml:26-43`); `app/cache.py` already has a `get_redis()` helper. PROPOSAL: Serialize session histories to Redis using key `geointelli:chat:session:{session_id}` with a TTL of 24h; replace `_sessions` dict lookups in `append_to_session`, `get_session_history`, and `reset_session` with `await r.get/set/delete` calls — M/M, score 1.0; does not displace top 10.

**Proposed actions:**
- Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:75`; add `await` to all `messages.create` calls in six AI route handlers — H/L, score 3.0
- Wrap the 8 context queries at `context.py:61-68` in `asyncio.gather()` for parallel execution — M/L, score 2.0
- Accumulate `messages` list across tool-use rounds instead of rebuilding from scratch in `grounded_search.py`, `grounded_maps.py`, `deep_analysis.py` — M/M, score 1.0
- Move `_sessions` dict to Redis via `app/cache.py:get_redis()`; set 24h TTL per session key — M/M, score 1.0

### Run #102 — 2026-06-01 — Lens: Deployment / Docker
**Scope:** Seventh Docker/deployment pass. Examined: `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/Dockerfile`, `geointellisense-analytics/.dockerignore`, `geointellisense-ingestion/.dockerignore`, `docker-compose.yml`, `Caddyfile`, `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-analytics/app/main.py`, `geointellisense-ingestion/src/main.rs`. Cross-checked against Active Recommendations and runs #100–#101 (Latest Findings) plus archived Docker runs #87, #72, #57, #42, #27, #12 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/Dockerfile:3-5` — The analytics Dockerfile installs `libgdal-dev` as its sole `apt-get` dependency: `RUN apt-get update && apt-get install -y --no-install-recommends libgdal-dev`. The `libgdal-dev` package is the GDAL *development* variant: it installs the GDAL C headers, static libraries, and CLI tools (`gdal_translate`, `ogr2ogr`, `gdal_rasterize`, etc.) in addition to the runtime shared library. The three packages that reference GDAL in `requirements.txt` — `rasterio==1.4.*`, `geopandas==1.0.*`, and `shapely==2.0.*` — all publish pre-built *manylinux* wheels to PyPI. Manylinux wheels bundle their own GDAL and PROJ shared libraries internally (compiled against the manylinux2014/2_28 sysroot), meaning `pip install rasterio` on a Linux host with no GDAL installed at all will succeed using the bundled wheel. Installing `libgdal-dev` is therefore unnecessary for the pip install step and for runtime operation of those packages; the bundled GDAL inside the wheel takes precedence over any system-installed GDAL at runtime. The net effect is that the analytics image carries `libgdal-dev` (~200 MB of headers, static archives, and CLI binaries) in its `/usr/` tree for no functional purpose, inflating the final image unnecessarily. The single-stage build means these files cannot be shed in a later layer. PROPOSAL: Remove `libgdal-dev` from the `apt-get install` line at `geointellisense-analytics/Dockerfile:3`; verify `pip install rasterio geopandas shapely` succeeds against the pre-built manylinux PyPI wheels without it; if a runtime `libgdal.so` is actually required for an edge case (e.g., system GDAL CLI usage), install only `libgdal32` (the runtime shared library, ~30 MB) rather than `libgdal-dev` (~200 MB) — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `docker-compose.yml:119-135` — The `gateway` service (Caddy 2 on Alpine) is the sole external-facing entry point for all API traffic on port 8080, yet it is the only service among the five defined in `docker-compose.yml` that has no `healthcheck` stanza. The `db` service has `pg_isready` (lines 16-21), `redis` has `redis-cli ping` (lines 35-40), `ingestion` has `curl -sf http://localhost:3001/health` (lines 67-72), and `analytics` has a Python `urllib` health check (lines 109-114); only `gateway` (lines 119-135) has none. The absence of a healthcheck has two concrete consequences: (1) if Caddy fails to bind to port 8080 after startup (e.g., the port is already in use from a prior crashed container, or `/etc/caddy/Caddyfile` has a syntax error that Caddy rejects after the first load), Docker will mark the container as `running` because the process is alive even though no HTTP is being served; `restart: unless-stopped` will not trigger a restart until the process itself exits; (2) in any environment where `docker-compose.yml` is adapted to a Kubernetes manifest or ECS task definition, there is no readiness probe to copy from the Compose spec. The `caddy:2-alpine` image ships with `wget` built-in (BusyBox), making a lightweight healthcheck straightforward. PROPOSAL: Add `healthcheck: test: ["CMD-SHELL", "wget -qO- http://localhost:8080/ 2>&1 | grep -q 'GeoIntelliSense' || exit 1"] interval: 10s timeout: 5s retries: 5 start_period: 5s` to the `gateway` service definition at `docker-compose.yml:135` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/Dockerfile:16` — The analytics Dockerfile's `CMD` is `["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3002"]` with no `--workers` flag, starting a single asyncio event loop serving all 30+ registered route handlers. Multiple route handlers invoke CPU-bound operations *synchronously* inside that event loop without wrapping them in `asyncio.run_in_executor()`: `predict.py` runs `sklearn` model training (a multi-second CPU-bound fit); `landsat.py` calls `rasterio` to read large raster files; `elevation.py` processes DEM rasters; `water_quality.py` runs polars aggregations over large datasets; `explore.py` executes expensive `time_bucket()` queries and builds polars DataFrames. Because these are not offloaded to a thread pool, a single slow request monopolizes the event loop and delays all concurrent requests — including the health-check handler at `GET /api/health`. The docker-compose healthcheck for analytics (lines 109-114) has `timeout: 5s`. If `POST /api/predict/train` blocks the event loop for more than 5 seconds (realistic for any non-trivial model fit), the health check times out, the container accrues `retries: 5` failures, and Docker marks it unhealthy and restarts it — discarding the in-progress training run entirely. PROPOSAL: Either add `--workers 2` (or `--workers $(nproc)`) to the `CMD` in `geointellisense-analytics/Dockerfile:16` so each worker has its own event loop and one blocked worker does not starve the health-check worker, or wrap CPU-bound operations in `await asyncio.get_event_loop().run_in_executor(None, cpu_fn)` in the affected route handlers — H/M, score 1.5; does not displace top 10.

- OBSERVATION: `docker-compose.yml:1-154` — No service in `docker-compose.yml` has a Docker-level memory or CPU resource limit. The `redis` service uses `--maxmemory 256mb --maxmemory-policy allkeys-lru` in its startup command (line 30), but this is Redis's internal key-eviction threshold — the Redis OS process itself, including its heap and connection overhead, can grow beyond 256 MB without any container-level ceiling stopping it. The `analytics` container is most exposed: `POST /api/predict/train` (Active Rec #7, currently unauthenticated) invokes `sklearn` model fitting; `GET /api/explore` can fetch up to 365 days of multi-source time-series data as polars DataFrames; and Anthropic streaming responses accumulate full message content in memory. Without `deploy.resources.limits` (Compose v2 syntax, compatible with `docker compose` on Docker Engine 20.10+), Docker will allow any container to allocate all available host RAM. An OOM event in the analytics container will trigger the Linux OOM killer, which may elect to kill the PostgreSQL `db` process or the Redis process instead of the analytics container (depending on the kernel's oom_score heuristics), causing a cascading outage. PROPOSAL: Add `deploy: resources: limits: memory: 2g cpus: "2.0"` to the `analytics` service, `deploy: resources: limits: memory: 512m cpus: "1.0"` to the `ingestion` service, and `deploy: resources: limits: memory: 512m cpus: "0.5"` to the `redis` service in `docker-compose.yml`; ensure `db` (TimescaleDB) has `deploy: resources: limits: memory: 4g` with a corresponding `shared_buffers` PostgreSQL setting — H/M, score 1.5; does not displace top 10.

**Proposed actions:**
- Remove `libgdal-dev` from `geointellisense-analytics/Dockerfile:3`; verify manylinux wheels provide their own GDAL; if a system GDAL runtime lib is needed, install `libgdal32` instead — M/L, score 2.0
- Add `healthcheck` stanza to `gateway` service at `docker-compose.yml:135` using `wget -qO-` against `http://localhost:8080/` — M/L, score 2.0
- Add `--workers 2` to `CMD` in `geointellisense-analytics/Dockerfile:16` or wrap CPU-bound route handlers in `run_in_executor` — H/M, score 1.5
- Add `deploy.resources.limits` for `analytics`, `ingestion`, `redis`, and `db` services in `docker-compose.yml` — H/M, score 1.5

### Run #101 — 2026-06-01 — Lens: Docs
**Scope:** Eighth documentation pass. Examined: `services/dataService.ts`, `hooks/useRealtimeAQI.ts`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/db/persist.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-analytics/app/routes/deep_analysis.py`, `geointellisense-analytics/app/routes/chat.py`, `docker-compose.yml`, `.env.local.example`. Cross-checked against Active Recommendations and runs #99–#100 (Latest Findings) plus archived docs runs #86, #71, #56, #41, #26, #11 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `services/dataService.ts:91` — The `DataService` class is the primary singleton used across the entire frontend to aggregate multi-source data, but has no JSDoc. The class declaration at line 91 is preceded only by a bare `// Data service class` inline comment. None of its five public async methods have JSDoc: `getCurrentAQI` (line 104), `getCurrentWeather` (line 147), `getHistoricalAQI` (line 192), `getWeatherForecast` (line 236), or `getDashboardMetrics` (line 297) — each uses `// Fetch ...` inline comments rather than `/** @param ... @returns ... */` blocks. The `getDashboardMetrics()` method at line 297 returns a computed object whose shape is undocumented; callers have no contract for what fields to expect. The fallback logic spanning lines 318–403 uses mock data under undocumented conditions (no description of when mocks trigger). IDE hover, TypeDoc generation, and onboarding all degrade without JSDoc on the central data-access class. PROPOSAL: Add a `/** Singleton service ... */` JSDoc block above the class at `dataService.ts:91`; add `@param`/`@returns` JSDoc to each of the five public methods; document the `getDashboardMetrics` return type with an explicit interface — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `hooks/useRealtimeAQI.ts:139` — The exported `useRealtimeAQI()` function is 290 lines long and the most complex hook in the codebase (SSE connection, exponential-backoff reconnect, 288-snapshot historical ring buffer, mock-data fallback), yet has no JSDoc on the function export itself. The file has a four-line block comment at lines 2–5, but it is plain text with no `@param` or `@returns` tags. Six exported interfaces (`RealtimeCityData`, `RealtimeStats`, `RealtimeAQIData`, `HistoricalSnapshot`, `UseRealtimeAQIOptions` at line 40, `UseRealtimeAQIReturn` at line 49) have no member-level JSDoc: each field in `UseRealtimeAQIOptions` and `UseRealtimeAQIReturn` is a naked property declaration with no description, units, or constraints. For example, `UseRealtimeAQIOptions.maxHistorySize` (line 45) has no documentation that the effective maximum is constrained by `DEFAULT_MAX_HISTORY_SIZE = 288` at line 137, nor that 288 represents 24 hours of 5-minute-interval snapshots. `UseRealtimeAQIOptions.maxReconnectAttempts` (line 47) has no documentation of the default value or the exponential-backoff formula used. PROPOSAL: Add a `/** @param options - ... @returns ... */` JSDoc block to `useRealtimeAQI` at line 139; add per-member `/** ... */` comments to `UseRealtimeAQIOptions` and `UseRealtimeAQIReturn` fields — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:24` and `broadcast.rs:33–38` — There is an inconsistency in Rust `///` doc comment coverage in `broadcast.rs`: `LiveCache` (line 15), `EarthquakeCache` (line 18), and `RedisConn` (line 21) all have `///` doc comments, but `pub type AqiBroadcast` (line 12), `pub struct AppState` (line 24), `pub fn create()` (line 33), and `pub fn spawn_ticker()` (line 38) have none. `AppState` is the most widely referenced type in the codebase — it is extracted via `State<Arc<AppState>>` in every Axum route handler — and its six fields (`tx`, `pool`, `cache`, `quake_cache`, `redis`, `admin_token`) are undocumented. The same gap exists in `db/persist.rs:5`: `pub async fn write_readings` is the only public function in that module and writes every AQI reading to the database, yet has no `///` doc comment describing its semantics, panic conditions (`panic!`s on `sqlx::query!` errors are undocumented), or the UNNEST-based batch-write idiom it should eventually use (Active Rec #5). PROPOSAL: Add `///` doc comments to `AqiBroadcast` at `broadcast.rs:12`, `AppState` and all its fields at `broadcast.rs:24`, `create()` at `broadcast.rs:33`, `spawn_ticker()` at `broadcast.rs:38`; add `///` to `write_readings` at `persist.rs:5` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `docker-compose.yml:54–59` — The ingestion service's environment variable block has no inline YAML comments explaining the operational meaning or safe ranges of five variables. `PURPLEAIR_INTERVAL_SECS` (line 56, default `600`) has no comment explaining that 600 seconds is the PurpleAir API's documented rate-limit floor for the community tier — setting it below 120 risks an API key ban. `BROADCAST_INTERVAL_SECS` (line 57, default `5`) has no comment explaining the 5-second SSE push cadence or its effect on frontend `EventSource` reconnect loops. `ADMIN_TOKEN` appears at both line 59 (ingestion) and line 97 (analytics) with no comment that both services must share the same value — operators who set them independently will find that the ingestion admin endpoints accept a token that the analytics middleware rejects. `RUST_LOG` (line 54, value `info`) has no comment listing valid values or the performance cost of `trace`/`debug`. By contrast, `.env.local.example` (the frontend configuration file) includes descriptive comments for every variable it defines. PROPOSAL: Add inline YAML comments (`# ...`) to `docker-compose.yml:54–59` and `docker-compose.yml:97` explaining rate-limit implications, the shared-token requirement, and the valid `RUST_LOG` levels — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Add JSDoc class block and per-method `@param`/`@returns` to `DataService` in `services/dataService.ts:91`; define explicit return type interface for `getDashboardMetrics` — M/L, score 2.0
- Add `@param`/`@returns` JSDoc to `useRealtimeAQI` at `hooks/useRealtimeAQI.ts:139`; add per-member comments to `UseRealtimeAQIOptions` and `UseRealtimeAQIReturn` interface fields — M/L, score 2.0
- Add `///` doc comments to `AppState`, `AqiBroadcast`, `create()`, `spawn_ticker()` in `broadcast.rs`; add `///` to `write_readings` in `persist.rs:5` — M/L, score 2.0
- Add inline YAML comments to `docker-compose.yml:54–59,97` covering rate-limit implications, shared `ADMIN_TOKEN` requirement, and valid `RUST_LOG` levels — L/L, score 1.0

## 📚 Archive (one line per past run)
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
