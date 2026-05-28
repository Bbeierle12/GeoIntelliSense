# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T17:15:00Z
Last run: #13 — Lens: LLM integration quality

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
### Run #13 — 2026-05-28 — Lens: LLM integration quality
**Scope:** `geointellisense-analytics/app/claude.py`, `app/routes/chat.py`, `app/routes/deep_analysis.py`, `app/routes/grounded_search.py`, `app/routes/grounded_maps.py`, `app/routes/low_latency.py`, `app/routes/predictive_analysis.py`, `app/routes/weather_forecast.py`, `services/aiService.ts`, `app/middleware.py`, `requirements.txt`

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/routes/predictive_analysis.py:37-38` and `weather_forecast.py:28-29` — `async def predictive_analysis(req: PredictiveAnalysisRequest)` and `async def weather_forecast(req: WeatherForecastRequest)` accept no `request: Request` parameter and call neither `check_ai_auth()` nor `check_rate_limit()`. All five other AI endpoints (`/api/chat`, `/api/deep-analysis`, `/api/grounded-search`, `/api/grounded-maps`, `/api/low-latency`) enforce the `x-api-key` check and per-IP sliding-window rate limiting defined in `middleware.py`. Any public caller can POST to these two endpoints indefinitely and trigger `claude-sonnet-4-20250514` calls with up to 4 096 output tokens each, with no authentication gate and no cost guardrail.

- OBSERVATION: `geointellisense-analytics/app/claude.py:68` — `get_client()` returns `anthropic.Anthropic(...)` (the synchronous SDK client). Every AI route calls `client.messages.create(...)` inside an `async def` FastAPI handler. The synchronous `create()` call blocks the entire asyncio event loop for the duration of the Anthropic HTTP round-trip (typically 1–30 seconds). Uvicorn processes no other requests on that worker thread until the call returns. The `anthropic` package ships `anthropic.AsyncAnthropic` for exactly this use case; replacing `get_client()` to return `AsyncAnthropic` and awaiting `await client.messages.create(...)` would allow concurrent request handling on the same worker.

- OBSERVATION: `geointellisense-analytics/app/claude.py:71-95` (all six AI routes) — No route uses Anthropic's prompt-caching feature. `get_system_with_live_context()` returns a system prompt that concatenates the base system string with a multi-section live context blob (AQI station readings, earthquake list, active fires, water levels, NWS forecast). This system prompt — potentially 2 000–8 000 tokens depending on data volume — is re-transmitted as a fresh input on every `client.messages.create()` call. Anthropic's `cache_control: {"type": "ephemeral"}` breakpoint on the `system` field caches the prompt for up to 5 minutes, charging 25% of normal input-token price for cache hits. Since `_cached_context` is already refreshed at most once per 60 seconds, back-to-back requests within the same minute would be near-100% cache hits, cutting per-request input-token cost by roughly 80–90% on the cached content.

- OBSERVATION: `geointellisense-analytics/app/routes/weather_forecast.py:55` — `resp = get_client().messages.create(model="claude-sonnet-4-20250514", ..., system=FORECAST_SYSTEM, ...)` passes the static `FORECAST_SYSTEM` string directly, never calling `await get_system_with_live_context(FORECAST_SYSTEM)`. Every other AI route injects current sensor readings, active fires, earthquake events, and NWS forecast into the system prompt via `get_system_with_live_context`. The weather forecast route is the only AI endpoint where the model has no knowledge of present conditions (e.g., an active heat dome or atmospheric river that would directly affect its forecast quality).

- OBSERVATION: `geointellisense-analytics/app/routes/deep_analysis.py:47-67` and `chat.py:49-65` — Both tool-use loops reconstruct the messages list from scratch on each iteration rather than carrying it forward. In `deep_analysis.py`, round 2 sends `[user_msg, round1_assistant_content, round1_tool_results]`; if the model triggers tools again in round 2, round 3 sends the same three-element list — the model's round-2 assistant response and round-2 tool results are silently dropped. With `budget_tokens=32768` extended thinking enabled, Opus's intermediate reasoning from earlier tool rounds is also discarded. The correct pattern is to grow a single `messages` list by appending `{"role": "assistant", "content": resp.content}` and `{"role": "user", "content": tool_results}` on each round before calling `create()` again.

- OBSERVATION: `geointellisense-analytics/app/routes/grounded_search.py:12-16` — `SEARCH_SUFFIX` instructs the model to "Format citations as inline references with titles and URLs where possible." Claude is a language model with no web-retrieval capability; the `TOOLS` list contains only internal data-fetch tools (`get_air_quality`, `get_earthquakes`, `get_active_fires`, `get_water_levels`, `get_weather_forecast`). Any external source URLs that Claude includes in its response are hallucinated. The endpoint is branded as a "grounded search" but performs no actual grounding to external URLs; `SEARCH_SUFFIX` actively encourages fabrication of citations that users may trust as authoritative.

- OBSERVATION: `geointellisense-analytics/app/claude.py:32-43` — `_sessions: dict[str, list[dict]] = {}` is a module-level in-process variable. Under Uvicorn with `--workers N` (or any multi-process deployment), each worker process owns an independent copy of `_sessions`. A user's first `/api/chat` request handled by worker A creates a session in A's dict; if subsequent requests land on worker B (round-robin load balancing), `get_session_history(session_id)` returns `[]` — the model starts from scratch every turn. The project already includes Redis (`redis_url` in `config.py`, `get_redis()` in `cache.py`); serializing session history as a JSON list keyed by `session_id` with a TTL of e.g. 2 hours would make sessions worker-agnostic.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:37`, `deep_analysis.py:30`, `grounded_search.py:33`, `grounded_maps.py:37`, `low_latency.py:30` — No AI route implements retry logic for transient Anthropic API errors. When `client.messages.create()` raises `anthropic.RateLimitError` (HTTP 429) or `anthropic.InternalServerError` (HTTP 529), the outer `except Exception as e:` block immediately returns HTTP 500 to the client with the raw exception string. Anthropic's own documentation recommends 2–4 retries with exponential backoff for these status codes; without it, a momentary rate-limit burst or upstream overload permanently fails user requests rather than waiting a few seconds and retrying.

**Proposed actions:**
- Add `request: Request` parameter and call `check_ai_auth(request)` + `await check_rate_limit(request, "ai_deep")` at the top of `predictive_analysis.py` and `weather_forecast.py` — references Active Recommendations row #10
- Replace `get_client()` → `anthropic.Anthropic(...)` with `anthropic.AsyncAnthropic(...)` and `await client.messages.create(...)` across all six routes — not in top 10 (H/M, score 1.5)
- Add `cache_control: {"type": "ephemeral"}` breakpoint to the `system` field in all `client.messages.create()` calls that use `get_system_with_live_context()` — not in top 10 (H/M, score 1.5)
- Replace `system=FORECAST_SYSTEM` in `weather_forecast.py:55` with `system=await get_system_with_live_context(FORECAST_SYSTEM)` — not in top 10 (M/L, score 2.0; newer first-seen than items 1-9)
- Accumulate messages list across tool-use rounds in `deep_analysis.py` and `chat.py` rather than rebuilding from session history each round — not in top 10 (M/L, score 2.0; newer first-seen)
- Remove or rewrite `SEARCH_SUFFIX` in `grounded_search.py:12-16` to omit URL citation instructions since Claude has no web access — not in top 10 (M/L, score 2.0; newer first-seen)
- Move session history to Redis: store as `geointelli:session:<id>` JSON list with 2-hour TTL; update `get_session_history`, `append_to_session`, `reset_session` in `claude.py` — not in top 10 (H/M, score 1.5)
- Add exponential-backoff retry (max 3 attempts, 1s/2s/4s) for `anthropic.RateLimitError` and `anthropic.InternalServerError` in all five route files — not in top 10 (H/L, score 3.0; newer first-seen than items 1-9, 11th H/L item overall)

### Run #12 — 2026-05-28 — Lens: Deployment / Docker
**Scope:** `geointellisense-ingestion/Dockerfile`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/.dockerignore`, `geointellisense-analytics/.dockerignore`, `docker-compose.yml`, `Caddyfile`; `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml`.

**Findings:**

- OBSERVATION: `docker-compose.yml:4` — `timescale/timescaledb-ha:pg16` is the High-Availability (Patroni-based) variant of TimescaleDB. On amd64 this image is ~1.6 GB uncompressed vs ~400 MB for `timescale/timescaledb:latest-pg16`. The compose file configures no replication workers, no Patroni environment variables, and no streaming-replica endpoints — the HA feature set is entirely unused. Every `docker compose pull` on a fresh machine incurs the full 1.6 GB network cost for a single-node deployment.

- OBSERVATION: `geointellisense-analytics/Dockerfile:3-5` — `libgdal-dev` is installed in the single-stage runtime image. The `-dev` variant pulls compilation headers, pkg-config metadata, and static `.a` libraries (~50–80 MB). At runtime, `rasterio==1.4.*` ships pre-compiled manylinux binary wheels on PyPI that bundle their own GDAL shared objects; the system `libgdal-dev` package is not loaded by the running process. Consequently `libgdal-dev` is present in the final image but unused at runtime, inflating image size by 50–80 MB. If a binary wheel is unavailable and pip falls back to source compilation, `libgdal-dev` is a build-time dependency only and should be in a multi-stage builder stage.

- OBSERVATION: `geointellisense-analytics/Dockerfile:1-16` — The analytics Dockerfile is single-stage with no `USER` directive. The Uvicorn process (and every Python subprocess it may spawn) runs as UID 0 (root) inside the container. Combined with write access to `/app` and the `modeldata` volume, an exploit against any of the 12 `httpx` client routes (e.g., SSRF via a Claude tool call in `claude.py:execute_tool()`) could write arbitrary files as root. The `--security-opt no-new-privileges` flag and a non-root `USER` directive are both absent.

- OBSERVATION: `geointellisense-ingestion/Dockerfile:11` — `RUN cargo build --release 2>/dev/null || true` redirects all stderr to `/dev/null` and always exits 0. If `cargo` fails during the dependency-caching layer (crates.io network timeout, checksum mismatch, `pkg-config` not finding `libssl-dev`), the failure is completely invisible in build logs and the layer is cached as succeeded. The subsequent `RUN touch src/main.rs && cargo build --release` (line 14) will fail with a linking or compilation error, but the root cause from line 11 is already gone. Removing `2>/dev/null` allows the actual error to surface; the `|| true` alone is sufficient for cache-miss resilience.

- OBSERVATION: `docker-compose.yml:109-113` — The analytics healthcheck is `CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:3002/api/health')"`. This forks a full CPython interpreter for every probe. With `interval: 10s` the container launches ~8,640 Python processes per day purely for health probing. No `curl` or `wget` binary is installed in the analytics image (`Dockerfile` installs only `libgdal-dev`), so a lighter alternative requires a Dockerfile change (e.g., `RUN apt-get install -y --no-install-recommends curl`).

- OBSERVATION: `docker-compose.yml:119-135` — The `gateway` service (Caddy) has no `healthcheck:` block. If Caddy fails to start (Caddyfile syntax error evaluated at runtime, port conflict) or crashes post-startup, Docker marks the container running but with `health: unknown`. No other service declares `condition: service_healthy` on `gateway`, so upstream services continue to be marked healthy while the entry point is down. A `test: ["CMD", "wget", "-qO-", "http://localhost:8080"]` with appropriate interval would surface Caddy failures automatically.

- OBSERVATION: `geointellisense-analytics/.dockerignore:1` — The entry `__pycache__` without a `**/` prefix matches only the top-level `__pycache__/` directory in the build context. The generated bytecode directories inside the package — `app/__pycache__/`, `app/routes/__pycache__/`, `app/clients/__pycache__/`, `app/ml/__pycache__/` — are not excluded. On developer machines where those directories exist, stale `.pyc` files for the host Python version are copied into the image via `COPY . .` (Dockerfile line 14) and may shadow the correct bytecode generated inside the container. The fix is `**/__pycache__` (and `**/*.pyc`).

- OBSERVATION: `docker-compose.yml` — No `deploy.resources.limits` (or legacy `mem_limit`) is configured for any service. The analytics service trains a `GradientBoostingRegressor` (`aqi_model.py:223`) with `n_estimators=200` on up to 730 days of hourly sensor readings; peak RSS during training is unbounded. If the container OOM-kills mid-training (exit code 137), `_train_status` is left permanently as `{"state": "running"}` — no `finally` block resets it in `predict.py:_run_training` — and subsequent `POST /api/predict/train` calls return 409 until restart.

**Proposed actions:**
- Change `docker-compose.yml:4` from `timescale/timescaledb-ha:pg16` to `timescale/timescaledb:latest-pg16` — not in top 10 (M/L, score 2.0; newer first-seen than item 10)
- Convert analytics Dockerfile to multi-stage: builder installs `libgdal-dev` + builds wheels; runtime stage copies only site-packages and adds `USER 1000:1000` — not in top 10 (M/L, score 2.0; newer first-seen than item 10)
- Remove `2>/dev/null` from `geointellisense-ingestion/Dockerfile:11`; keep `|| true` — not in top 10 (L/L, score 1.0)
- Add `RUN apt-get install -y --no-install-recommends curl` to analytics Dockerfile and replace Python urllib healthcheck with `curl -sf http://localhost:3002/api/health` — not in top 10 (L/L, score 1.0)
- Add `healthcheck:` block to `gateway` service in `docker-compose.yml` — not in top 10 (M/L, score 2.0; newer first-seen than item 10)
- Fix analytics `.dockerignore` to use `**/__pycache__` and `**/*.pyc` — not in top 10 (L/L, score 1.0)
- Add `mem_limit: 2g` to analytics service and add `finally: _train_status = {"state": "failed"}` in `predict.py:_run_training` — not in top 10 (M/L, score 2.0; newer first-seen than item 10)

### Run #11 — 2026-05-28 — Lens: Docs
**Scope:** `README.md`, `IMPLEMENTATION_STATUS.md`, `.env.local.example`, `docker-compose.yml`; `geointellisense-analytics/app/config.py`, `app/main.py`, `app/routes/chat.py`, `app/routes/deep_analysis.py`, `app/routes/grounded_search.py`, `app/routes/admin.py`; `geointellisense-ingestion/src/aqi.rs`, `src/broadcast.rs`, `src/config.rs`, `src/main.rs`; `services/aiService.ts`; `components/dashboard/widgets/InversionWidget.tsx`, `WaterWidget.tsx`, `WeatherWidget.tsx`.

**Findings:**

- OBSERVATION: `README.md:64` — The Architecture section states "**Backend** (Express): Runs on `http://localhost:3001`." The actual production stack has no Express server in Docker: the Rust ingestion service listens on port 3001, a Python FastAPI analytics service on port 3002, and a Caddy API gateway on port 8080. The Express `server/index.js` is a dev-only proxy and does not appear in `docker-compose.yml` at all. A new contributor following the README will be confused about which backend serves which API routes. The "How to Run" section (`npm run dev:full`) also never mentions Docker Compose, which is the only way to start the Rust, Python, and database services.

- OBSERVATION: `.env.local.example` is materially incomplete. It documents only 5 variables (`ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`). The `docker-compose.yml` ingestion service block additionally requires `ADMIN_TOKEN`, `PURPLEAIR_INTERVAL_SECS`, and `BROADCAST_INTERVAL_SECS` (and the DB/Redis port variables). The analytics `config.py` (`Settings` class) reads `EPA_AQS_EMAIL`, `EPA_AQS_KEY`, `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, and `CENSUS_API_KEY` — none of which appear in `.env.local.example`. Without these keys, the 12 Python API clients that lack retry logic (see Run #8) silently return empty results, but there is no documentation telling a deployer which keys are needed for which data source.

- OBSERVATION: `docker-compose.yml` analytics service block passes `GOOGLE_MAPS_API_KEY`, `DEM_DATA_DIR`, `LANDSAT_DATA_DIR`, and `MODEL_DIR` as environment variables into the container, but `geointellisense-analytics/app/config.py` (`Settings` class) does not declare any of these four fields. They are never read by the analytics service. Either they are vestigial from an earlier implementation, are silently consumed by child processes, or the `config.py` `Settings` class needs to be updated to reflect them.

- OBSERVATION: `IMPLEMENTATION_STATUS.md` is stale in two ways. (1) Phase 1.1 is marked "Secure API Key Management ✅ COMPLETED" and states the Maps key is "Protected via backend endpoint `/api/maps-config`," but this endpoint remains unauthenticated (Open in Active Recommendation #6, found Run #9). (2) The "How to Run" section instructs users to create a `.env` with only `ANTHROPIC_API_KEY` and `GOOGLE_MAPS_API_KEY`, which is insufficient for the Docker stack: the database, Redis, ingestion service, and analytics service each require additional variables documented nowhere in the file.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:23` — `async def chat()`, the primary AI endpoint, has no docstring. It accepts `ChatRequest` (with fields `message: str` and `session_id: str | None`), performs auth + rate-limit checks, runs up to 5 Anthropic tool-call rounds, and returns `{"text": ..., "sessionId": ...}` — none of which is stated in the function signature, decorator, or body. `grounded_search.py:24` (`async def grounded_search()`) and `deep_analysis.py:18` (`async def deep_analysis()`) share the same gap. Together these three handle all AI-facing traffic but have zero inline documentation of auth requirements, input validation, return shape, or error codes.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs` — Public type aliases and functions lack `///` doc comments. `AqiBroadcast` (line 13), `LiveCache` (line 16), and `EarthquakeCache` (line 20) are type aliases with no explanation of lock semantics or update frequency. `pub fn create() -> AqiBroadcast` (line 33) has no doc; `pub fn spawn_ticker` (line 38) takes 7 parameters with no `///` explaining what each does or what task it spawns. Only `spawn_earthquake_poller` (line 133) has a two-line doc comment.

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs` — Five public functions have no `///` doc comments: `stations()` (line 53), `aqi_category()` (line 88), `generate_readings()` (line 99), `generate_history()` (line 138), and `round2()` (line 164). These are the only mock-data generators for the entire ingestion service; when `PURPLEAIR_API_KEY` is absent every SSE broadcast uses their output, but there is no inline documentation of the AQI formula, the bounding box, the mock station list, or the history generation algorithm.

- OBSERVATION: `services/aiService.ts` — Seven exported async functions (lines 8, 30, 52, 74, 96, 118, 154) have no JSDoc. There is no inline documentation of which backend endpoint each function calls, what `x-api-key` header value is expected, what the resolved Promise shape is, or what exceptions are thrown on 401/429/500 responses.

- OBSERVATION: `geointellisense-analytics/app/routes/admin.py:11` — `def _check_admin(token: str | None) -> JSONResponse | None:` has no docstring. This security-critical helper returns a 403/401 `JSONResponse` on failure or `None` on success, but nothing in the function explains this sentinel-return contract.

- OBSERVATION: `geointellisense-ingestion/src/config.rs` — `Config` struct and `pub fn from_env() -> Self` have no `///` doc comments. `config.rs` is the single source of truth for every environment variable consumed by the ingestion service, but none of the fields documents its default value, valid range, or effect. `earthquake_interval_secs` (default 300 s) and `broadcast_interval_secs` (default 5 s) are performance-sensitive tunables that affect SSE client freshness; their operational implications are undocumented.

**Proposed actions:**
- Update `README.md:37-64` to replace Express/3001 with Rust ingestion/3001 + Python FastAPI/3002 + Caddy/8080; add a "Docker Compose" section — not in top 10 (M/L, score 2.0)
- Extend `.env.local.example` to include all analytics API keys and ingestion tunables with comments — not in top 10 (M/L, score 2.0)
- Audit and remove or document `GOOGLE_MAPS_API_KEY`, `DEM_DATA_DIR`, `LANDSAT_DATA_DIR`, `MODEL_DIR` in `docker-compose.yml` analytics env block — not in top 10 (M/L, score 2.0)
- Update `IMPLEMENTATION_STATUS.md` to reflect open security items — not in top 10 (L/L, score 1.0)
- Add docstrings to `chat.py:23`, `grounded_search.py:24`, `deep_analysis.py:18` route handlers — not in top 10 (L/L, score 1.0)
- Add `///` doc comments to `broadcast.rs:create`, `spawn_ticker`, and type aliases — not in top 10 (L/L, score 1.0)
- Add JSDoc to all seven `services/aiService.ts` exports — not in top 10 (L/L, score 1.0)

## 📚 Archive (one line per past run)
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
