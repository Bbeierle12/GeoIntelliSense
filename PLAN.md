# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T14:20:00Z
Last run: #58 — Lens: LLM integration quality

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
### Run #58 — 2026-05-30 — Lens: LLM integration quality
**Scope:** Fourth LLM integration quality pass. Examined: `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/deep_analysis.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/grounded_maps.py`, `geointellisense-analytics/app/routes/low_latency.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/routes/weather_forecast.py`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/middleware.py`, `services/aiService.ts`. Prior LLM quality run details (#13, #28, #43) archived; Active Recommendations row #10 (unauth predictive-analysis/weather-forecast) acknowledged.

**Findings:**

- OBSERVATION: `claude.py:74-75` — `get_client()` returns `anthropic.Anthropic(api_key=settings.anthropic_api_key)` — the **synchronous** Anthropic SDK client. This sync client is used in six `async def` route handlers: `chat.py:43,70`, `deep_analysis.py:33,61`, `grounded_search.py:39,63`, `grounded_maps.py:46,70`, `predictive_analysis.py:91`, and `weather_forecast.py:75`. In each case, `client.messages.create(...)` is a blocking synchronous call executed directly inside an async coroutine. Python asyncio is single-threaded; a blocking call in a coroutine occupies the event loop thread for the full duration of the outbound HTTP request to `api.anthropic.com`. For `claude-opus-4-6` with extended thinking (`budget_tokens=32768`, `max_tokens=40000` in `deep_analysis.py:38-40`), this blocking window is typically 30–120 seconds. For `claude-sonnet-4-20250514` with `max_tokens=4096`, it is 5–20 seconds. During this entire period the single uvicorn worker (`docker-compose.yml:113`: `uvicorn app.main:app --host 0.0.0.0 --port 8000`, no `--workers` flag) cannot process any other request — health checks, data API calls, and concurrent AI requests all queue behind the blocked coroutine. The Anthropic SDK provides a drop-in async equivalent: `anthropic.AsyncAnthropic`, whose `client.messages.create(...)` is a proper coroutine that yields to the event loop while awaiting the response. PROPOSAL: In `claude.py`, replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` and initialize as a module-level singleton (not per-call). Add `await` to all `client.messages.create(...)` call sites in the seven affected route files — approximately 16 line changes across 8 files.

- OBSERVATION: `claude.py:74-75` — `get_client()` constructs a brand-new `anthropic.Anthropic(...)` instance **on every invocation**. The sync `Anthropic` client wraps `httpx.Client`, which allocates a new connection pool per instance. No existing TCP+TLS connection to `api.anthropic.com` is reused between requests — each call pays a full TLS handshake cost of 100–300 ms before the first byte of the model request can be sent. Additionally, `get_client()` is called once per tool-use continuation round: `chat.py:70` calls it inside the `while resp.stop_reason == "tool_use"` loop (up to 5 rounds), and `deep_analysis.py:61` does the same (up to 3 rounds). Each round creates another new `httpx.Client` instance with its own connection. None are closed explicitly — there is no `with` block and no `.close()` call — so the underlying socket descriptor is released only when CPython's GC collects the object, which may be deferred under load. Under the 20 req/min chat rate limit with 2 tool-use rounds each, up to 60 `httpx.Client` instances/minute are created and left unclosed. PROPOSAL: Declare a module-level singleton `_anthropic_client: anthropic.AsyncAnthropic | None = None` (pending the async fix above); initialize it once inside a guarded `if _anthropic_client is None` block in `get_client()`; all call sites already call `get_client()` so no other files change.

- OBSERVATION: `predictive_analysis.py:12-15` and `weather_forecast.py:12-15` — Both files define a `SYSTEM` constant that establishes the model's persona: `PREDICTIVE_SYSTEM = "You are an expert environmental data scientist specializing in California's San Joaquin Valley."` and `FORECAST_SYSTEM = "You are an expert meteorologist specializing in California's San Joaquin Valley."`. These are passed as the `system=` parameter to `messages.create` at `predictive_analysis.py:94` and `weather_forecast.py:78`. However, the user-message prompt template in both files **begins with the same persona sentence**: `predictive_analysis.py:62` opens `"You are an expert environmental data scientist specializing in California's San Joaquin Valley. Your task is to provide a predictive analysis..."` and `weather_forecast.py:49` opens `"You are an expert meteorologist specializing in California's San Joaquin Valley. Your task is to provide a predictive analysis..."`. The model therefore receives the persona instruction twice in every call — once in the privileged `system` turn and again at the start of the `user` turn. The user-turn persona prefix adds ~30 redundant tokens per request with no behavioral benefit (the system prompt already establishes the persona with higher authority). In multi-turn or adversarial inputs the redundant persona in the user turn could be interpreted as a user-supplied instruction rather than a system constraint. PROPOSAL: In `predictive_analysis.py:62` and `weather_forecast.py:49`, remove the leading persona sentence from each prompt template so each begins with `"Your task is to provide a predictive analysis..."` and `"Your task is to provide a predictive weather forecast..."` respectively. The `system=` parameter handles persona entirely.

- OBSERVATION: `deep_analysis.py:33-76` — The deep analysis endpoint makes up to 4 sequential calls to `claude-opus-4-6` per request: one initial call (lines 33–44) plus up to 3 tool-use continuation calls (lines 61–76). **Every call** sets `budget_tokens=32768` and `max_tokens=40000`. Per the Anthropic API contract, `budget_tokens` is the thinking-token allowance for **that single API call**, not the cumulative budget for the conversation. In a 3-round tool-use flow the worst-case thinking token consumption is 4 × 32768 = 131,072 thinking tokens. Extended thinking tokens are billed at output rates; at Claude Opus 4 pricing (~$75/M output tokens), 131,072 thinking tokens cost ≈$9.83 before any actual response tokens (up to 4 × 40,000 = 160,000 output tokens = $12.00). A single worst-case deep analysis request can therefore cost **$21+ in API credits**. The rate limiter at `middleware.py:23` allows 5 req/min per client IP for `ai_deep`, but there is no global rate cap, no per-client daily budget, and no logging of actual token usage — `resp.usage` is never read anywhere in the codebase. Operators cannot see how many tokens are being consumed or which requests are expensive. PROPOSAL: (a) After each `client.messages.create()` in `deep_analysis.py`, log `resp.usage.input_tokens`, `resp.usage.output_tokens` (and `resp.usage.cache_read_input_tokens` once prompt caching is added) at `logger.info` level to make per-call cost visible in the container log; (b) reduce `budget_tokens` on continuation rounds — e.g., `budget_tokens = max(1000, 32768 >> rounds)` halves the budget each round from 32768 → 16384 → 8192, appropriate for tool-result assimilation which requires less reasoning than the initial analysis; (c) add a global Redis counter `geointelli:ratelimit:ai_deep:daily` that caps total deep-analysis calls per 24 hours across all clients.

- OBSERVATION: `claude.py:78-110` — `get_system_with_live_context()` assembles a combined system prompt from `base_system` + the live context text returned by `build_context_text()` (`context.py:73`). The live context includes AQI station readings, NWS forecast periods, fire detections, earthquake events, water levels, CalEnviroScreen summary, inversion status, and ML prediction — typically 2,000–5,000 tokens. This assembled prompt is cached at the Python level for 60 seconds (`claude.py:88`). Within any 60-second window the **same system prompt text** is sent to every AI call, but no call uses Anthropic's **prompt caching** feature (`cache_control: {"type": "ephemeral"}`). Prompt caching stores the compiled KV-attention state of the system prompt on Anthropic's edge for up to 5 minutes; cache hits are charged at 10% of normal input-token rates. At the `ai_chat` rate limit of 20 req/min with a 2,500-token system prompt (conservative), 20 × 2,500 = 50,000 input tokens/min are billed at full rate when they could be cache hits after the first request in any 5-minute window — a 90% reduction on system-prompt input cost. The same applies to `grounded_search.py`, `grounded_maps.py`, `deep_analysis.py`, and `low_latency.py`. None of the five routes pass the `system` parameter in the list-of-blocks format required for per-block cache control. PROPOSAL: Modify `get_system_with_live_context()` to return the system as a list of content blocks: `[{"type": "text", "text": f"{base_system}\n\n{ctx_text}", "cache_control": {"type": "ephemeral"}}]`; update each of the 5 route files to pass this list directly as `system=system` (the API accepts both a string and a list — no other changes required). Add `resp.usage.cache_read_input_tokens` to the usage log from Finding 4 to verify cache hit rates.

**Proposed actions:**
- Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` singleton in `claude.py:74-75`; add `await` to all 8 `client.messages.create(...)` call sites — H/L, score 3.0; ties top 10, does not displace
- Convert `get_client()` to return a module-level singleton in `claude.py:74-75` — M/L, score 2.0; does not enter top 10
- Remove duplicate persona prefix from prompt templates in `predictive_analysis.py:62` and `weather_forecast.py:49` — L/L, score 1.0; does not enter top 10
- Log `resp.usage` after each `client.messages.create()` in `deep_analysis.py`; reduce `budget_tokens` per continuation round; add global daily cap — H/L, score 3.0; ties top 10, does not displace
- Add `cache_control: {"type": "ephemeral"}` to system prompt block in `get_system_with_live_context()` and pass list form to all 5 route files — M/L, score 2.0; does not enter top 10

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

## 📚 Archive (one line per past run)
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
- Run #58: lens 13 (LLM integration quality) — findings added
