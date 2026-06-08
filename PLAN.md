# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-08T05:10:00Z
Last run: #208 — Lens: LLM integration quality

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Sanitize AI result before `dangerouslySetInnerHTML` in `AnalysisView.tsx` | UX/Security | H | L | 7 | Open |
| 2 | `GET /api/maps-config` exposes Google Maps API key to unauthenticated callers | Security | H | L | 9 | Open |
| 3 | `POST /api/predict/train` is unauthenticated — any client can trigger expensive model retraining | Security | H | L | 9 | Open |
| 4 | `/api/predictive-analysis` and `/api/weather-forecast` have no auth or rate limiting — any public caller can burn Anthropic credits | Security/LLM | H | L | 13 | Open |
| 5 | `context.py:394` SELECT uses `unit` instead of `units` — water-level data silently absent from all Claude system prompts | Data pipeline | H | L | 113 | Open |
| 6 | Upgrade `vitest` / `@vitest/ui` / `@vitest/coverage-v8` from 4.0.13 to ≥4.1.0 — CVSS 9.8 arbitrary file read/execute via UI server (GHSA-5xrq-8626-4rwp) | Security/Dep | H | L | 168 | Open |
| 7 | Upgrade `react-router-dom` from 7.9.6 to ≥7.14.3 — 9 active advisories incl. RCE via turbo-stream deserialization (GHSA-49rj-9fvp-4h2h, CVSS 8.1) | Security/Dep | H | L | 168 | Open |
| 8 | Upgrade `vite` from 6.4.1 to ≥6.5.0 AND change `host` from `'0.0.0.0'` to `'127.0.0.1'` in `vite.config.ts:9` — GHSA-p9ff-h696-f583 file read amplified by all-interfaces binding | Security/Dep | H | L | 168 | Open |
| 9 | `dataService.ts:199` sends slug IDs (e.g. `"fresno"`) for `location_ids` but `historical_aqi.py:46`, `historical_weather.py:40`, `nws_forecast.py:50` cast them as `uuid[]` — PostgreSQL errors; all filtered calls silently fall back to mock | TS↔Python/Data | H | L | 201 | Open |
| 10 | `aiService.ts:getChatResponse` reads only `data.text`, discarding the `sessionId` returned by `chat.py:86` — every request creates a new Python session via `create_session()` so multi-turn context is silently lost | TS↔Python/UX | H | L | 201 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #208 — 2026-06-08 — Lens: LLM integration quality
**Scope:** Fourteenth LLM integration quality pass. Files examined in full: `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/config.py`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/deep_analysis.py`, `geointellisense-analytics/app/routes/low_latency.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/grounded_maps.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/routes/weather_forecast.py`, `services/aiService.ts`. Cross-checked against Active Recommendations and archived LLM runs #13, #28, #43, #58, #73, #88, #103, #118, #133, #148, #163, #178, #193 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:43,70`, `deep_analysis.py:33,61`, `low_latency.py:31`, `grounded_search.py:39,62`, `grounded_maps.py:46,69`, `predictive_analysis.py:91`, `weather_forecast.py:75` — All 11 Claude API invocations use `client.messages.create(...)` (synchronous), where `client` is an `anthropic.Anthropic` instance returned by `claude.py:get_client()`. All of these call sites live inside `async def` FastAPI route handlers. The `anthropic.Anthropic` client is the synchronous SDK variant and its `.messages.create()` method performs a blocking HTTP call via `httpx.Client`. When a synchronous blocking call runs inside an `async def` coroutine under uvicorn's asyncio event loop, it occupies the single event loop thread for the full duration of the call — typically 1–5 seconds for Haiku, 5–30 seconds for Sonnet, and 30–90+ seconds for Opus with extended thinking (`deep_analysis.py:33`). During this blocking period, the asyncio event loop cannot service any other coroutine: all other concurrent HTTP requests to the analytics service (health checks, water queries, fire queries, AQI snapshots, other chat requests) are queued and cannot make progress. A single `POST /api/deep-analysis` call thus stalls the entire analytics service for up to 90 seconds. The fix is to replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` at `claude.py:74` and change all 11 `.create()` calls to `await client.messages.create(...)` — the Anthropic Python SDK ships `AsyncAnthropic` with an identical interface. PROPOSAL: Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:74` and add `await` to all 11 `messages.create()` call sites — H/M effort (~12 one-line changes across 7 files; eliminates event-loop blocking that currently serializes all analytics service traffic behind each LLM API call).

- OBSERVATION: `geointellisense-analytics/app/claude.py:74-75` — `get_client()` constructs a brand-new `anthropic.Anthropic(api_key=settings.anthropic_api_key)` object on every invocation. The `anthropic.Anthropic` constructor creates a new `httpx.Client` instance with its own connection pool. Every call to any of the 7 Claude-backed route handlers calls `get_client()` (directly or via the imported reference), which means every single LLM API request establishes a new TCP connection + TLS 1.3 handshake to `api.anthropic.com`. TLS handshake overhead to a remote API endpoint is typically 50–250ms (1 full round-trip for TCP + 1–2 for TLS, depending on session resumption availability). This overhead is paid even for the `low_latency.py` endpoint, which uses Haiku specifically for speed. The `httpx.Client` already supports keep-alive connection pooling — the overhead is entirely self-inflicted by creating a new client per request. The fix is a module-level singleton: `_client: anthropic.AsyncAnthropic | None = None` with a `get_client()` that initialises it once and returns the cached instance — or, better, initialise it once at `main.py` lifespan startup and inject it via FastAPI's dependency system. PROPOSAL: Convert `get_client()` at `claude.py:74` to a module-level singleton (or lifespan-scoped dependency) so the underlying `httpx` connection pool is reused across requests — L/L effort (~5 lines; eliminates per-request TLS handshake overhead, especially impactful for the Haiku low-latency endpoint).

- OBSERVATION: `geointellisense-analytics/app/context.py:61-68` — `build_live_context()` awaits each of its seven data-source fetchers sequentially with no concurrency: `context["aqi"] = await _get_aqi_context(pool)`, then `context["forecast"] = await _get_forecast_context(pool)`, then `context["fires"] = await _get_fire_context(pool)`, etc. The seven fetchers are entirely independent: they read from different tables (`sensor_readings`, Redis forecast cache, `fire_detections`, `earthquake_events`, `water_readings`, `census_tracts`) and have no data dependencies on each other. Under asyncpg with a 5ms average round-trip, the sequential chain of 8 awaits (7 DB fetchers + 1 Redis scan) accumulates ~40ms of serial latency minimum, in addition to actual query execution time. Since `build_live_context()` runs on every request that calls `get_system_with_live_context()` when the 60-second module-level cache expires — affecting `/api/chat`, `/api/deep-analysis`, `/api/low-latency`, `/api/grounded-search`, `/api/grounded-maps` — this serial pattern directly adds latency to the user-visible first response after each cache expiry boundary. Replacing lines 61-68 with a single `asyncio.gather(...)` call would reduce total context build time from the sum of all query latencies to the maximum of any single query latency — roughly a 6× speedup for the cold-cache path. PROPOSAL: Replace the sequential `await` chain at `context.py:61-68` with `asyncio.gather(_get_aqi_context(pool), _get_forecast_context(pool), ..., _get_prediction_context(pool))` and unpack the results into the `context` dict — L/L effort (~10 lines; reduces context build latency from sequential sum to concurrent max, directly improving user-facing response time for all AI endpoints on cache-miss).

- OBSERVATION: `geointellisense-analytics/app/routes/weather_forecast.py:75` and `geointellisense-analytics/app/routes/predictive_analysis.py:90` — Both endpoints call `await get_system_with_live_context(FORECAST_SYSTEM)` / `await get_system_with_live_context(PREDICTIVE_SYSTEM)`. These two endpoints receive historical data in the request body and ask Claude to extrapolate statistical trends for the next 3 months — a task that is purely statistical and has no need for real-time sensor data. `get_system_with_live_context()` (`claude.py:78-110`) injects the full live context including AQI station readings, fire detections, earthquake events, water levels, inversion status, ML predictions, and CalEnviroScreen data — a payload of 500–2,000 tokens depending on how many data sources are currently live. `weather_forecast.py:72` explicitly instructs Claude: "Do NOT include any analysis or forecast related to air quality (AQI, PM2.5)" — yet the system prompt immediately preceding this instruction contains AQI readings for multiple stations. The live context is not only irrelevant to the prompt's task but actively contradicts the prompt's own instructions; Claude must expend reasoning effort to reconcile the system-prompt data it has been told to ignore. At `claude-sonnet-4-20250514` input pricing (~$3/MTok), a 1,000-token live context injected on every call to these two endpoints costs ~$0.003/call before any other token use, and is replicated across each tool-continuation round. Since neither endpoint has auth/rate limiting (Active Recommendation row #4), these tokens are also billable for unauthenticated callers. PROPOSAL: Replace `await get_system_with_live_context(PREDICTIVE_SYSTEM)` with `PREDICTIVE_SYSTEM` at `predictive_analysis.py:90` and `await get_system_with_live_context(FORECAST_SYSTEM)` with `FORECAST_SYSTEM` at `weather_forecast.py:75` — L/L effort (~2 one-line changes; eliminates up to 2,000 irrelevant input tokens per call and removes the instruction–context contradiction in the weather forecast prompt).

**Proposed actions:**
- Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:74` and add `await` to all 11 `messages.create()` call sites in `chat.py`, `deep_analysis.py`, `low_latency.py`, `grounded_search.py`, `grounded_maps.py`, `predictive_analysis.py`, `weather_forecast.py` — H/M effort (~12 lines; eliminates event-loop blocking that serializes analytics service traffic behind each LLM API call)
- Convert `claude.py:get_client()` to a module-level singleton so the httpx connection pool is reused — L/L effort (~5 lines; eliminates TLS handshake overhead on every API call)
- Replace sequential `await` chain at `context.py:61-68` with `asyncio.gather(...)` — L/L effort (~10 lines; reduces context build time from serial sum to concurrent max)
- Remove `get_system_with_live_context()` from `predictive_analysis.py:90` and `weather_forecast.py:75`; use base system strings directly — L/L effort (~2 lines; removes irrelevant/contradictory live context from statistical forecast prompts)

### Run #207 — 2026-06-08 — Lens: Deployment / Docker
**Scope:** Fifteenth Deployment/Docker pass. Files examined in full: `geointellisense-ingestion/Dockerfile`, `geointellisense-analytics/Dockerfile`, `docker-compose.yml`, `Caddyfile`, `geointellisense-ingestion/src/main.rs`, `geointellisense-analytics/app/main.py`, `geointellisense-analytics/.dockerignore`, `geointellisense-ingestion/.dockerignore`, `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml`. Cross-checked against Active Recommendations and archived Docker runs #12, #27, #42, #57, #72, #87, #102, #117, #132, #147, #162, #177, #192 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/main.rs:75` — `axum::serve(listener, app).await.unwrap()` has no graceful-shutdown signal handler, and the binary runs as PID 1. On Linux, PID 1 receives signals only if it has explicitly registered a handler for them — the kernel does not apply default signal dispositions to PID 1. A grep over the entire `src/` directory confirms there is no `tokio::signal::unix::signal`, `SignalKind::terminate()`, or `ctrl_c()` call anywhere in the ingestion codebase. The consequence: `docker stop geointellisense-ingestion` (or `docker compose stop ingestion` or `docker compose restart ingestion`) sends SIGTERM to PID 1; the Rust binary silently discards it; Docker waits the default 10-second `stop_grace_period`; then sends SIGKILL. Every container stop takes ≥10 seconds, abruptly terminates all active SSE connections on `/api/aqi-stream` (clients receive a broken stream with no `event: error` sentinel), and may interrupt in-flight `persist.rs` database writes mid-transaction (forcing PostgreSQL to roll back on the next connection). The fix is axum's built-in graceful-shutdown API: replace line 75 with `axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await.unwrap()` and add a `shutdown_signal()` async fn that awaits `tokio::signal::unix::signal(SignalKind::terminate())?.recv().await` — approximately 8 additional lines in `main.rs`. PROPOSAL: Add SIGTERM graceful-shutdown handler to `main.rs` using `axum::serve(...).with_graceful_shutdown(...)` — M/L effort (~8 lines; reduces every container stop from 10-second forced-kill to near-instant drain-and-exit, preserving in-flight DB writes and notifying SSE clients gracefully).

- OBSERVATION: `docker-compose.yml` analytics service (lines 79-113) — No `stop_grace_period` is configured, and the CMD in `geointellisense-analytics/Dockerfile` does not pass `--timeout-graceful-shutdown`. Docker's default stop grace period is 10 seconds. Uvicorn's default `--timeout-graceful-shutdown` is 5 seconds — it drops in-progress requests after 5 seconds even if Docker gives it more time. The analytics service handles the longest-running requests in the stack: Claude API streaming responses (typical 5-30 seconds, worst-case 60+ seconds for deep-analysis), scikit-learn model retraining triggered by `start_retrain_scheduler()` (`main.py:50`), and background pollers spawned at lifespan start for water, fire, and inversion. During `docker compose stop analytics`, any Claude API call more than 5 seconds in-flight is silently killed: the partial streaming response is discarded, the client receives a broken pipe (or a proxy 502 from Caddy), and any asyncpg transaction opened by the handler is left in an inconsistent state until PostgreSQL's idle-in-transaction timeout expires. The fix is two coordinated changes: (a) add `stop_grace_period: 30s` to the analytics service definition in `docker-compose.yml` (giving Docker a 30-second SIGKILL deadline) and (b) add `--timeout-graceful-shutdown 25` to the Dockerfile CMD (`CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3002", "--timeout-graceful-shutdown", "25"]`) so uvicorn waits up to 25 seconds for in-flight requests before drain. PROPOSAL: Add `stop_grace_period: 30s` to the analytics service in `docker-compose.yml` and `--timeout-graceful-shutdown 25` to the analytics Dockerfile CMD — L/L effort (~2 lines; prevents mid-request SIGKILL during rolling restarts and container maintenance).

- OBSERVATION: `geointellisense-analytics/Dockerfile` (entire file) and `geointellisense-ingestion/Dockerfile` final stage (lines 14-20) — Neither Dockerfile contains a `USER` instruction. Both service processes run as root (UID 0) inside their containers. For the analytics service: uvicorn + FastAPI runs as root and processes external data from the Claude API, PurpleAir, USGS, NASA FIRMS, NOAA, EPA, and WQP APIs. The service executes scikit-learn model retraining (`predict.py`) where training data comes from PostgreSQL rows ultimately sourced from external APIs. Running as root means any code-execution or container-escape vulnerability (prompt injection via Claude, malformed raster file via rasterio, CVE in geopandas/numpy) gives an attacker root access inside the container — with write access to the entire container filesystem, to all mounted volumes (`/app/data/dem`, `/app/data/landsat`, `/app/data/models`), and elevated privilege for container escape techniques. For the ingestion service: the Rust binary also runs as root unnecessarily — the binary needs only network access on port 3001, PostgreSQL/Redis connections, and outbound HTTP; all of these work equally well as an unprivileged user. PROPOSAL: Add `RUN useradd -r -u 1001 -g root appuser && chown -R appuser /app` + `USER appuser` to the analytics Dockerfile before the `EXPOSE` directive; add `RUN useradd -r -u 1001 -g root appuser` + `USER appuser` to the ingestion Dockerfile's final stage — H/L effort (~2 lines per Dockerfile; limits blast radius of any container compromise to an unprivileged user, a standard container hardening baseline).

- OBSERVATION: `geointellisense-analytics/.dockerignore` (entire file) — The file excludes `__pycache__`, `*.pyc`, `.venv`, `.env`, `.git`, but does NOT exclude `data/`. The analytics Dockerfile (`COPY . .`) copies the entire `geointellisense-analytics/` build context. The analytics service references three data directories inside the build context: `DEM_DATA_DIR: /app/data/dem` (elevation rasters; individual GeoTIFF files are 50MB–5GB each), `LANDSAT_DATA_DIR: /app/data/landsat` (Landsat 8/9 scenes; 800MB+ per multi-band scene), and `MODEL_DIR: /app/data/models` (scikit-learn pickled models from `predict.py`'s `_retrain()` function). If a developer runs the application locally and these data directories accumulate files, every subsequent `docker build` silently bakes potentially gigabytes of geo-raster data into the image layer — making the image unexpectedly large and build times extremely slow. At container runtime, `docker-compose.yml` mounts named volumes (`demdata`, `landsatdata`, `modeldata`) at exactly these paths, which shadow the image-layer contents entirely — so the COPYied data is unreachable and serves no purpose. There is no mechanism (e.g., a `VOLUME` instruction or entrypoint initialization script) to copy image-layer seed data into the named volumes on first run. PROPOSAL: Add `data/` to `geointellisense-analytics/.dockerignore` — L/L effort (1 line; eliminates silent multi-gigabyte image inflation for developers who have run the analytics service locally before rebuilding).

**Proposed actions:**
- Add SIGTERM handler to `geointellisense-ingestion/src/main.rs:75` using `axum::serve(...).with_graceful_shutdown(shutdown_signal())` — M/L effort (~8 lines; fixes forced-SIGKILL on every container stop, preserving SSE connections and in-flight DB writes)
- Add `stop_grace_period: 30s` to analytics service in `docker-compose.yml` and `--timeout-graceful-shutdown 25` to analytics Dockerfile CMD — L/L effort (~2 lines; prevents mid-request SIGKILL during `docker compose stop`)
- Add `USER appuser` (with `useradd`) to both Dockerfiles' final stages — H/L effort (~2 lines each; enforces least-privilege container runtime for both services)
- Add `data/` to `geointellisense-analytics/.dockerignore` — L/L effort (1 line; prevents silent baking of multi-GB raster/model files into Docker image layers)

### Run #206 — 2026-06-08 — Lens: Docs
**Scope:** Fifteenth documentation pass. Files examined in full: `README.md`, `IMPLEMENTATION_STATUS.md`, `.env.local.example`, `package.json`, `docker-compose.yml`, `Caddyfile`, `geointellisense-analytics/app/main.py`, `geointellisense-analytics/app/config.py`, `geointellisense-ingestion/src/config.rs`. Cross-checked against Active Recommendations and archived docs runs #11, #26, #41, #56, #71, #86, #101, #116, #131, #146, #161, #176, #191 to confirm findings are new.

**Findings:**

- OBSERVATION: `README.md:44` and `README.md:50` — The "Run Locally" section instructs developers to run `npm run dev:full` (line 44, described as running "both the backend server and frontend") and `npm run server` (line 50, described as "Backend server"). Neither script exists in `package.json`. The scripts actually defined are: `dev`, `build`, `preview`, `test`, `test:ui`, `test:run`, `test:coverage`. There is no `dev:full`, no `server`, and no `dev:backend` or equivalent. A developer following the README's step-3 quickstart will receive `npm error Missing script: "dev:full"` (or `"server"`) and cannot start the application without reading the codebase or `IMPLEMENTATION_STATUS.md` to discover that `docker compose up -d` is the correct backend start command. The correct local development workflow — `docker compose up -d` for backend services + `npm run dev` for the frontend Vite server — is documented only in `IMPLEMENTATION_STATUS.md:58-60`, not in README.md. PROPOSAL: Update `README.md` step 3 to replace `npm run dev:full` / `npm run server` with `docker compose up -d && npm run dev` and document the Docker prerequisite — L/L effort (~5 lines; makes the quickstart runnable for new contributors).

- OBSERVATION: `docker-compose.yml:9-11,61,99,124` and `.env.local.example` (entire file) — The `docker-compose.yml` uses variable substitution for at least 8 environment variables that have no default values and are not present in any committed example file: `POSTGRES_USER` (line 9), `POSTGRES_PASSWORD` (line 10), `POSTGRES_DB` (line 11), `DB_PORT` (line 12), `REDIS_PORT` (line 34), `INGESTION_PORT` (line 61), `ANALYTICS_PORT` (line 99), and `GATEWAY_PORT` (line 124). Docker Compose resolves these from a `.env` file in the project root — but no such file exists. The only example is `.env.local.example`, which covers only five frontend-scoped variables and is documented only for the Node.js/Vite layer. A developer running `docker compose up` without a root `.env` file will get empty strings for all eight variables: the database service starts with `POSTGRES_USER=""` (no authentication configured), `DB_PORT:5432` becomes `:5432` (invalid port mapping), and port bindings for ingestion, analytics, and the gateway fail. There is also no documentation in `README.md` or `IMPLEMENTATION_STATUS.md` that a separate root `.env` is required with different variables than `.env.local`. PROPOSAL: Add a `.env.example` at the project root (alongside `docker-compose.yml`) documenting all eight variables with safe development defaults (e.g., `POSTGRES_USER=geointellisense`, `DB_PORT=5432`, `INGESTION_PORT=3001`, `ANALYTICS_PORT=3002`, `GATEWAY_PORT=8080`), and add a note in `README.md` to copy it before running `docker compose up` — L/L effort (~15 lines; unblocks the docker-compose path for all new contributors).

- OBSERVATION: `IMPLEMENTATION_STATUS.md:8` — The "Secure API Key Management" section states "**Backend proxy** already implemented in `server/index.js`". The `server/` directory does not exist in the repository (confirmed via glob). The original Express-based backend (`server/index.js`) was replaced by the Rust Axum ingestion service (`geointellisense-ingestion/`) and the Python FastAPI analytics service (`geointellisense-analytics/`) before the first commit. The stale reference points contributors to a non-existent file and implies a Node/Express architecture that no longer exists. Additionally, `README.md:62-66` describes the architecture as "Backend (Express): Runs on http://localhost:3001" — there is no Express backend; the service on :3001 is the Rust Axum ingestion service, and Python FastAPI analytics runs on :3002, with a Caddy reverse proxy on port `GATEWAY_PORT` routing between them (per `Caddyfile` and `docker-compose.yml:119-135`). PROPOSAL: (a) Remove the `server/index.js` reference from `IMPLEMENTATION_STATUS.md:8`; (b) update `README.md:62-66` Architecture section to accurately describe the Rust Axum ingestion service (:3001), Python FastAPI analytics service (:3002), and Caddy gateway (:8080) — L/L effort (~6 lines across two files; eliminates confusing reference to non-existent component).

- OBSERVATION: `README.md:13-14` and `geointellisense-ingestion/src/config.rs:9` — The README lists only "Node.js" under "Prerequisites". Running the full application via `docker compose up` requires Docker Engine ≥24 and Docker Compose v2; developing or modifying the Rust ingestion service requires the Rust toolchain (MSRV implied by dependencies); developing the Python analytics service requires Python 3.11+ and the packages listed in `geointellisense-analytics/requirements.txt`. None of these are mentioned. Additionally, `config.rs:9` defines `earthquake_interval_secs` read from env var `EARTHQUAKE_INTERVAL_SECS`, which controls the USGS earthquake polling interval (default 300 s). This variable is absent from `docker-compose.yml`'s `ingestion` service environment block (lines 51-61) — it cannot be tuned via docker-compose without editing the YAML, unlike `PURPLEAIR_INTERVAL_SECS` and `BROADCAST_INTERVAL_SECS` which are both wired through. Operators wanting to reduce earthquake polling frequency (e.g., in resource-constrained environments) have no documented way to do so. PROPOSAL: (a) Update `README.md:13-14` Prerequisites to list Docker + Docker Compose as the primary requirement and Rust/Python toolchains as optional for service-level development; (b) add `EARTHQUAKE_INTERVAL_SECS: ${EARTHQUAKE_INTERVAL_SECS:-300}` to the `ingestion` service environment block in `docker-compose.yml` alongside the existing `PURPLEAIR_INTERVAL_SECS` line — L/L effort (~4 lines; makes all tunable intervals consistently configurable via docker-compose and corrects prerequisites for new contributors).

**Proposed actions:**
- Update `README.md:44,50` to replace `npm run dev:full` / `npm run server` with `docker compose up -d && npm run dev` — L/L effort (~5 lines; fixes broken quickstart commands)
- Add `.env.example` at project root with all 8 docker-compose variables and defaults; add copy instruction to README — L/L effort (~15 lines; unblocks `docker compose up` for new developers)
- Remove stale `server/index.js` reference from `IMPLEMENTATION_STATUS.md:8`; update `README.md:62-66` to describe the actual Rust+Python+Caddy stack — L/L effort (~6 lines; eliminates architectural misinformation)
- Add Docker+Compose to `README.md:13-14` Prerequisites; add `EARTHQUAKE_INTERVAL_SECS` to `docker-compose.yml` ingestion env block — L/L effort (~4 lines; complete documentation for operators and contributors)

## 📚 Archive (one line per past run)
- Run #205 (2026-06-08) — Lens: Observability — 5 findings — 0 promoted to Active
- Run #204 (2026-06-08) — Lens: Security — 4 findings — 0 promoted to Active
- Run #203 (2026-06-07) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #202 (2026-06-07) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #201 (2026-06-07) — Lens: TS ↔ Python contract — 4 findings — 2 promoted to Active
- Run #200 (2026-06-07) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #199 (2026-06-07) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #198 (2026-06-07) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #197 (2026-06-07) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #196 (2026-06-07) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #195 (2026-06-07) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #194 (2026-06-07) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #193 (2026-06-07) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #192 (2026-06-07) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #191 (2026-06-07) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #190 (2026-06-07) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #189 (2026-06-07) — Lens: Security — 4 findings — 0 promoted to Active
- Run #188 (2026-06-06) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #187 (2026-06-06) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #186 (2026-06-06) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #185 (2026-06-06) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #184 (2026-06-06) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #183 (2026-06-06) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #182 (2026-06-06) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #181 (2026-06-06) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #180 (2026-06-06) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #179 (2026-06-06) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #178 (2026-06-06) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #177 (2026-06-06) — Lens: Deployment / Docker — 5 findings — 0 promoted to Active
- Run #176 (2026-06-06) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #175 (2026-06-05) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #174 (2026-06-05) — Lens: Security — 4 findings — 0 promoted to Active
- Run #173 (2026-06-05) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #172 (2026-06-05) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #171 (2026-06-05) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #170 (2026-06-05) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #169 (2026-06-05) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #168 (2026-06-05) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #167 (2026-06-05) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #166 (2026-06-05) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #165 (2026-06-05) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #164 (2026-06-05) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #163 (2026-06-05) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #162 (2026-06-05) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #161 (2026-06-05) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #160 (2026-06-04) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #159 (2026-06-04) — Lens: Security — 4 findings — 0 promoted to Active
- Run #158 (2026-06-04) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #157 (2026-06-04) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #156 (2026-06-04) — Lens: TS ↔ Python contract — 3 findings — 0 promoted to Active
- Run #155 (2026-06-04) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #154 (2026-06-04) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #153 (2026-06-04) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #152 (2026-06-04) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #151 (2026-06-04) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #150 (2026-06-04) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #149 (2026-06-04) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #148 (2026-06-04) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #147 (2026-06-04) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #146 (2026-06-04) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #145 (2026-06-03) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #144 (2026-06-03) — Lens: Security — 4 findings — 0 promoted to Active
- Run #143 (2026-06-03) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #142 (2026-06-03) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #141 (2026-06-03) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #140 (2026-06-03) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #139 (2026-06-03) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #138 (2026-06-03) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #137 (2026-06-03) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #136 (2026-06-03) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #135 (2026-06-03) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #134 (2026-06-03) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #133 (2026-06-03) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #132 (2026-06-03) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #131 (2026-06-02) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #130 (2026-06-02) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #129 (2026-06-02) — Lens: Security — 4 findings — 0 promoted to Active
- Run #128 (2026-06-02) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #127 (2026-06-02) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #126 (2026-06-02) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #125 (2026-06-02) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #124 (2026-06-02) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #123 (2026-06-02) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #122 (2026-06-02) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #121 (2026-06-02) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #120 (2026-06-02) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #119 (2026-06-02) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #118 (2026-06-02) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #117 (2026-06-02) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #116 (2026-06-02) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #115 (2026-06-02) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #114 (2026-06-01) — Lens: Security — 4 findings — 0 promoted to Active
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
- Run #117: lens 12 (Deployment / Docker) — findings added
- Run #118: lens 13 (LLM integration quality) — findings added
- Run #119: lens 14 (Competitive scan) — findings added
- Run #120: lens 15 (Live-time claim audit) — findings added
- Run #121: lens 1 (Type safety) — findings added
- Run #122: lens 2 (Module boundaries) — findings added
- Run #123: lens 3 (Dependency health) — findings added
- Run #124: lens 4 (Perf hot paths) — findings added
- Run #125: lens 5 (Test coverage gaps) — findings added
- Run #126: lens 6 (TS ↔ Python contract) — findings added
- Run #127: lens 7 (UX / UI flaws) — findings added
- Run #128: lens 8 (Data pipeline integrity) — findings added
- Run #129: lens 9 (Security) — findings added
- Run #130: lens 10 (Observability) — findings added
- Run #131: lens 11 (Docs) — findings added
- Run #132: lens 12 (Deployment / Docker) — findings added
- Run #133: lens 13 (LLM integration quality) — findings added
- Run #134: lens 14 (Competitive scan) — findings added
- Run #135: lens 15 (Live-time claim audit) — findings added
- Run #136: lens 1 (Type safety) — findings added
- Run #137: lens 2 (Module boundaries) — findings added
- Run #138: lens 3 (Dependency health) — findings added
- Run #139: lens 4 (Perf hot paths) — findings added
- Run #140: lens 5 (Test coverage gaps) — findings added
- Run #141: lens 6 (TS ↔ Python contract) — findings added
- Run #142: lens 7 (UX / UI flaws) — findings added
- Run #143: lens 8 (Data pipeline integrity) — findings added
- Run #144: lens 9 (Security) — findings added
- Run #145: lens 10 (Observability) — findings added
- Run #146: lens 11 (Docs) — findings added
- Run #147: lens 12 (Deployment / Docker) — findings added
- Run #148: lens 13 (LLM integration quality) — findings added
- Run #149: lens 14 (Competitive scan) — findings added
- Run #150: lens 15 (Live-time claim audit) — findings added
- Run #151: lens 1 (Type safety) — findings added
- Run #152: lens 2 (Module boundaries) — findings added
- Run #153: lens 3 (Dependency health) — findings added
- Run #154: lens 4 (Perf hot paths) — findings added
- Run #155: lens 5 (Test coverage gaps) — findings added
- Run #156: lens 6 (TS ↔ Python contract) — findings added
- Run #157: lens 7 (UX / UI flaws) — findings added
- Run #158: lens 8 (Data pipeline integrity) — findings added
- Run #159: lens 9 (Security) — findings added
- Run #160: lens 10 (Observability) — findings added
- Run #161: lens 11 (Docs) — findings added
- Run #162: lens 12 (Deployment / Docker) — findings added
- Run #163: lens 13 (LLM integration quality) — findings added
- Run #164: lens 14 (Competitive scan) — findings added
- Run #165: lens 15 (Live-time claim audit) — findings added
- Run #166: lens 1 (Type safety) — findings added
- Run #167: lens 2 (Module boundaries) — findings added
- Run #168: lens 3 (Dependency health) — findings added
- Run #169: lens 4 (Perf hot paths) — findings added
- Run #170: lens 5 (Test coverage gaps) — findings added
- Run #171: lens 6 (TS ↔ Python contract) — findings added
- Run #172: lens 7 (UX / UI flaws) — findings added
- Run #173: lens 8 (Data pipeline integrity) — findings added
- Run #174: lens 9 (Security) — findings added
- Run #175: lens 10 (Observability) — findings added
- Run #176: lens 11 (Docs) — findings added
- Run #177: lens 12 (Deployment / Docker) — findings added
- Run #178: lens 13 (LLM integration quality) — findings added
- Run #179: lens 14 (Competitive scan) — findings added
- Run #180: lens 15 (Live-time claim audit) — findings added
- Run #181: lens 1 (Type safety) — findings added
- Run #182: lens 2 (Module boundaries) — findings added
- Run #183: lens 3 (Dependency health) — findings added
- Run #184: lens 4 (Perf hot paths) — findings added
- Run #185: lens 5 (Test coverage gaps) — findings added
- Run #186: lens 6 (TS ↔ Python contract) — findings added
- Run #187: lens 7 (UX / UI flaws) — findings added
- Run #188: lens 8 (Data pipeline integrity) — findings added
- Run #189: lens 9 (Security) — findings added
- Run #190: lens 10 (Observability) — findings added
- Run #191: lens 11 (Docs) — findings added
- Run #192: lens 12 (Deployment / Docker) — findings added
- Run #193: lens 13 (LLM integration quality) — findings added
- Run #194: lens 14 (Competitive scan) — findings added
- Run #195: lens 15 (Live-time claim audit) — findings added
- Run #196: lens 1 (Type safety) — findings added
- Run #197: lens 2 (Module boundaries) — findings added
- Run #198: lens 3 (Dependency health) — findings added
- Run #199: lens 4 (Perf hot paths) — findings added
- Run #200: lens 5 (Test coverage gaps) — findings added
- Run #201: lens 6 (TS ↔ Python contract) — findings added
- Run #202: lens 7 (UX / UI flaws) — findings added
- Run #203: lens 8 (Data pipeline integrity) — findings added
- Run #204: lens 9 (Security) — findings added
- Run #205: lens 10 (Observability) — findings added
- Run #206: lens 11 (Docs) — findings added
- Run #207: lens 12 (Deployment / Docker) — findings added
- Run #208: lens 13 (LLM integration quality) — findings added
