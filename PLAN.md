# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-05T03:15:00Z
Last run: #163 — Lens: LLM integration quality

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
### Run #163 — 2026-06-05 — Lens: LLM integration quality
**Scope:** Eleventh LLM integration quality pass. Files examined in full: `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/routes/chat.py`; `geointellisense-analytics/app/routes/deep_analysis.py`; `geointellisense-analytics/app/routes/predictive_analysis.py`; `geointellisense-analytics/app/routes/weather_forecast.py`; `geointellisense-analytics/app/routes/grounded_search.py`; `geointellisense-analytics/app/routes/grounded_maps.py`; `geointellisense-analytics/app/routes/low_latency.py`; `geointellisense-analytics/app/context.py`. Cross-checked against Active Recommendations and Latest Findings runs #160–#162 plus archived LLM integration lens runs #13, #28, #43, #58, #73, #88, #103, #118, #133, #148 to confirm findings are new.

**Findings:**

- OBSERVATION: `chat.py:66-68,84` — During the tool-use loop, the intermediate assistant and user-tool-result turns are built into an ephemeral `messages` list passed directly to the API but are **never saved back to the persistent session**. Specifically, lines 66-69 construct `messages = get_session_history(session_id) + [{"role": "assistant", "content": resp.content}, {"role": "user", "content": tool_results}]` and pass it to the API, but neither `append_to_session()` is called for the assistant tool-use turn nor for the tool-result user turn. Only the final text is persisted at line 84: `append_to_session(session_id, "assistant", text)`. Consequence: on the next user turn in the same session, `get_session_history(session_id)` returns history that shows Claude's final answer quoting specific data values (e.g., "PM2.5 is currently 45 μg/m³ near Fresno") but contains no record of the `get_air_quality` tool call or its result that produced those values. Claude receives a conversation history with unexplained factual claims — it cannot distinguish between data it retrieved via tools and data it may have hallucinated. For multi-turn conversations that build on prior tool-retrieved data (e.g., "compare today's AQI to what you found yesterday"), the model operates with a corrupted view of its own prior reasoning. PROPOSAL: After each tool-use round in `chat.py`, call `append_to_session(session_id, "assistant", resp.content)` (for the tool-use assistant turn) and append a user message with the tool results before re-querying — ensuring the full conversation including tool exchanges is persisted — M/L effort (restructure loop to call `append_to_session` after each round).

- OBSERVATION: `weather_forecast.py:48-49` and `predictive_analysis.py:62` — Both endpoints open their user-content prompt by re-stating the same role persona already defined in their respective system prompts. `weather_forecast.py:48-49` begins: `"You are an expert meteorologist specializing in California's San Joaquin Valley."` — a verbatim copy of `FORECAST_SYSTEM` at `weather_forecast.py:12-15`. `predictive_analysis.py:62` begins: `"You are an expert environmental data scientist specializing in California's San Joaquin Valley."` — a verbatim copy of `PREDICTIVE_SYSTEM` at `predictive_analysis.py:12-15`. Both code comments identify the origin: "Exact prompt template ported from server/index.js lines 410-435/350-377" — these were copied from an older Express server that used `anthropic.completions.create()` with no `system` parameter, so the persona had to be embedded in the user turn. Now that the Python endpoints use the `system` parameter, the role definition appears twice: once in `system` and again at the top of the user message. The Anthropic API documentation states that the system prompt is the authoritative source for persona instructions; a competing role definition in the user turn creates ambiguous instruction precedence and wastes ~15 tokens per request on each of two high-traffic endpoints. PROPOSAL: Remove the opening role-definition sentence from the user prompt in `weather_forecast.py:48-49` and `predictive_analysis.py:62`, relying solely on the `system` parameter; keep the task instructions (everything after the role sentence) — L/L effort (delete 1 line from each of 2 files).

- OBSERVATION: `deep_analysis.py:79-83` — The response extraction loop contains a `break` that exits on the first text block found: `for block in resp.content: if block.type == "text": text = block.text; break`. This differs from the extraction pattern used in every other endpoint: `chat.py:79-82`, `grounded_search.py:74-77`, and `grounded_maps.py:81-84` all accumulate ALL text blocks via `text += block.text` without a `break`. For extended thinking responses where `stop_reason == "end_turn"` (no tool use), `resp.content` typically contains exactly one `ThinkingBlock` followed by exactly one `TextBlock` — so the `break` is harmless. However, when the deep-analysis tool-use loop's final turn (line 61-76) produces a response with multiple text blocks (which the Anthropic API can return when Claude interleaves analysis text around tool results), the `break` at line 83 discards all text blocks after the first one, silently truncating the response returned to the user. This is a correctness regression relative to the other endpoints: `deep_analysis.py` is the only endpoint where multi-text-block responses are silently truncated. PROPOSAL: Replace `deep_analysis.py:79-83` with the accumulation pattern: `text = ""; for block in resp.content: if block.type == "text": text += block.text` — L/L effort (change 1 line, remove 1 line).

- OBSERVATION: `claude.py:74-75` — `get_client()` instantiates a brand-new `anthropic.Anthropic()` object on every invocation: `def get_client() -> anthropic.Anthropic: return anthropic.Anthropic(api_key=settings.anthropic_api_key)`. The Anthropic Python SDK internally creates a new `httpx.Client` (with its own connection pool) each time `anthropic.Anthropic()` is constructed. Three endpoints call `get_client()` inline and discard the result after a single request: `low_latency.py:31` (`get_client().messages.create(...)`), `predictive_analysis.py:91` (`get_client().messages.create(...)`), and `weather_forecast.py:75` (`get_client().messages.create(...)`). Under concurrent load, each simultaneous request to any of these endpoints opens a fresh TCP connection to `api.anthropic.com`, bypassing the connection reuse that a shared pool provides. For `low_latency.py` specifically — the endpoint whose name and model choice (`claude-haiku-4-5-20251001`) are explicitly optimized for speed — creating a new HTTP connection pool on every request adds ~100-300ms of TCP handshake and TLS negotiation latency, negating the model-selection benefit. The fix is a module-level singleton: `_client: anthropic.Anthropic | None = None` initialized once at import time or via a lazy `get_client()` that checks the global before creating. PROPOSAL: Promote `get_client()` in `claude.py:74-75` to a module-level singleton using a lazy-init pattern; update all call-sites in `low_latency.py:31`, `predictive_analysis.py:91`, and `weather_forecast.py:75` to use the shared instance — L/L effort (add 3 lines to `claude.py`, no changes needed at call sites since `get_client()` API is preserved).

**Proposed actions:**
- Persist tool-use intermediate turns to session history in `chat.py` tool loop — call `append_to_session()` for both the assistant tool-use turn and the tool-result user turn — M/L effort
- Remove redundant role-persona sentence from user prompts in `weather_forecast.py:48-49` and `predictive_analysis.py:62` — L/L effort
- Replace `break`-on-first-text-block pattern in `deep_analysis.py:79-83` with accumulation `text += block.text` — L/L effort
- Promote `anthropic.Anthropic()` to module-level singleton in `claude.py` to enable connection-pool reuse across requests — L/L effort

### Run #162 — 2026-06-05 — Lens: Deployment / Docker
**Scope:** Twelfth Deployment/Docker pass. Files examined in full: `geointellisense-ingestion/Dockerfile`; `geointellisense-analytics/Dockerfile`; `geointellisense-ingestion/.dockerignore`; `geointellisense-analytics/.dockerignore`; `docker-compose.yml`; `Caddyfile`; `geointellisense-analytics/requirements.txt`; `geointellisense-ingestion/Cargo.toml`; `geointellisense-ingestion/src/routes/health.rs`; `geointellisense-analytics/app/routes/health.py`. Cross-checked against Active Recommendations and Latest Findings runs #159–#161 plus archived Deployment/Docker lens runs #12, #27, #42, #57, #72, #87, #102, #117, #132, #147 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/Dockerfile:11` — `RUN cargo build --release 2>/dev/null || true` applies two independent error-suppression mechanisms simultaneously. `2>/dev/null` discards all of Cargo's standard-error output; Cargo writes ALL diagnostics — download failures, yanked-crate errors, linker errors, missing pkg-config probes — exclusively to stderr, so this redirection makes every failure permanently invisible in Docker BuildKit's build log. `|| true` then forces the step to exit 0 regardless of outcome, so Docker marks the layer as successfully cached even if `cargo build` exited non-zero. Combined, the result is: if crates.io is unreachable, a transitive dependency has been yanked, or libssl-dev was not correctly located by pkg-config (lines 3-5), the builder layer is silently created with zero compiled artifacts; the next step (`RUN touch src/main.rs && cargo build --release` at line 14) then fails with a confusing "could not find crate" or "could not link" diagnostic that points to a symptom rather than the actual cause. The canonical Cargo dependency-caching pattern is `COPY Cargo.toml Cargo.lock ./ && RUN cargo fetch`, which downloads all crate sources without attempting compilation, exits non-zero on any network/registry failure (so Docker correctly aborts the build), and produces no dummy artifacts. PROPOSAL: Replace lines 8-11 with `COPY Cargo.toml Cargo.lock ./` and `RUN cargo fetch`, then `COPY src ./src` and `RUN cargo build --release` — eliminates both error-suppression hacks while preserving the dependency-caching layer benefit — L/L effort (restructure 4 Dockerfile lines).

- OBSERVATION: `docker-compose.yml:119-135` — The `gateway` service (Caddy) has no `healthcheck` block defined, while every other service in the file (db, redis, ingestion, analytics) has one. In Docker's health model a container with no healthcheck never enters the `healthy` state — it transitions from `starting` to a running status with `"Health": {}` (no status field). Two concrete consequences: (1) Any compose override or external orchestration that attempts `depends_on: gateway: condition: service_healthy` will fail immediately at startup because the gateway can never satisfy `service_healthy`, blocking any service that depends on the full stack being routable through the gateway. (2) Monitoring tools that consume `docker inspect --format '{{.State.Health.Status}}'` always receive an empty string for the gateway, making its operational state invisible in dashboards (Portainer, Uptime Kuma, Prometheus Docker SD) while db/redis/ingestion/analytics all show "healthy". The `/health` path is already proxied in `Caddyfile:15-17` (`reverse_proxy ingestion:3001`), so a gateway healthcheck using `curl -sf http://localhost:8080/health` would simultaneously verify Caddy is up AND that the ingestion reverse-proxy path is routing correctly. PROPOSAL: Add a `healthcheck` block to the `gateway` service with `test: ["CMD-SHELL", "curl -sf http://localhost:8080/health || exit 1"]`, `interval: 10s`, `timeout: 5s`, `retries: 5`, `start_period: 10s` — L/L effort (add 6 lines to docker-compose.yml; `curl` is already installed in `caddy:2-alpine`).

- OBSERVATION: `geointellisense-analytics/Dockerfile:16` — `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3002"]` starts a single-process ASGI server with one event loop. Several analytics route handlers are CPU-bound or block the event loop: `elevation.py` performs rasterio DEM raster reads and numpy array lookups (file I/O + array math); `ml/aqi_model.py`'s `POST /api/predict/train` (Active Rec #6) runs a full scikit-learn `RandomForestRegressor.fit()` on the event loop thread; `demographics.py` executes large polygon-intersection aggregations via asyncpg. When any of these handlers runs, it starves all other concurrent requests — a single call to `/api/predict/train` can block the entire analytics service for minutes. The standard production fix is `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3002", "--workers", "4"]` (multiple processes) or a gunicorn supervisor, but this is blocked by the in-process session state: `claude.py:26-41` stores chat sessions in a module-global `_sessions` dict and a `_session_order` deque — multi-process workers would each maintain an independent `_sessions`, breaking session continuity across requests. Therefore the correct remediation is two-step: first move `_sessions` to Redis (which requires `redis` already in `requirements.txt`), then enable `--workers 4`. PROPOSAL: Move `claude.py` session state to Redis under a namespaced key (e.g., `session:{uuid}`) with `ex=3600` TTL; then add `--workers 4` to the CMD — M/M effort (refactor session storage + Dockerfile CMD change).

- OBSERVATION: `docker-compose.yml:110` — The analytics healthcheck command `python -c "import urllib.request; urllib.request.urlopen('http://localhost:3002/api/health')"` calls `urllib.request.urlopen()` without a `timeout` argument. Python's default socket timeout is `None` (blocks indefinitely) unless explicitly set via `socket.setdefaulttimeout()`. If the uvicorn process is running but its asyncio event loop is fully blocked (e.g., the asyncpg pool is exhausted and all pool waiters are blocked indefinitely — the `timeout=None` pool behavior documented in Run #161 `database.py:7` finding), `urlopen` connects to the open port but then waits forever for the HTTP response. Docker's outer healthcheck `timeout: 5s` (line 112) ultimately sends SIGKILL to the Python process after 5 seconds, which prevents a hung healthcheck from masking a hung server indefinitely. However this masks an important diagnostic distinction: a "connection refused" error (server process crashed) and a "connection accepted but hung" state (server running but deadlocked on DB pool) both produce identical Docker health events (`unhealthy` after `timeout: 5s`), making it impossible to distinguish between the two failure modes from Docker logs alone. The fix is `urllib.request.urlopen('http://localhost:3002/api/health', timeout=4)`, which raises `socket.timeout` on a hung response (within the 5s Docker deadline) versus `urllib.error.URLError` on a refused connection — two distinct exceptions that produce distinct messages in `docker events`. PROPOSAL: Add `timeout=4` to the `urlopen` call in `docker-compose.yml:110` — L/L effort (add 10 characters to the healthcheck command).

**Proposed actions:**
- Replace `cargo build --release 2>/dev/null || true` dummy-build pattern at `ingestion/Dockerfile:8-11` with `cargo fetch` to pre-download dependencies without silently swallowing build errors — L/L effort
- Add `healthcheck` block to `gateway` service in `docker-compose.yml` using `curl -sf http://localhost:8080/health` — L/L effort
- Move `claude.py` session state (`_sessions`, `_session_order`) to Redis, then enable `--workers 4` in analytics/Dockerfile CMD — M/M effort
- Add `timeout=4` to `urlopen` call in analytics healthcheck at `docker-compose.yml:110` — L/L effort

### Run #161 — 2026-06-05 — Lens: Docs
**Scope:** Eleventh Docs pass. Files examined in full: `README.md`; `IMPLEMENTATION_STATUS.md`; `.env.local.example`; `docker-compose.yml`; `geointellisense-analytics/app/config.py`; `geointellisense-analytics/app/database.py`; `geointellisense-analytics/app/cache.py`; `geointellisense-analytics/app/main.py`; `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/context.py`; `geointellisense-analytics/app/middleware.py`; `geointellisense-analytics/app/source_toggles.py`; `geointellisense-analytics/app/routes/predict.py`; `geointellisense-analytics/app/routes/admin.py`; `geointellisense-analytics/app/routes/predictive_analysis.py`; `geointellisense-analytics/app/routes/explore.py`; `geointellisense-analytics/app/routes/water.py`; `geointellisense-analytics/app/ml/aqi_model.py`; `geointellisense-ingestion/src/config.rs`; `geointellisense-ingestion/src/main.rs`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/aqi.rs`; `geointellisense-ingestion/src/purpleair.rs`; `geointellisense-ingestion/src/usgs.rs`; `geointellisense-ingestion/src/redis_cache.rs`; `geointellisense-ingestion/src/db/persist.rs`; `geointellisense-ingestion/src/routes/sse.rs`; `geointellisense-ingestion/src/routes/health.rs`; `geointellisense-ingestion/src/routes/admin.rs`; `services/aiService.ts`; `types.ts`; `tests/README.md`. Cross-checked against Active Recommendations and Latest Findings runs #158–#160 plus archived Docs lens runs #11, #26, #41, #56, #71, #86, #101, #116, #131, #146 to confirm findings are new.

**Findings:**

- OBSERVATION: `README.md:1-52` — The project README is the unmodified AI Studio scaffold: its title is "Run and deploy your AI Studio app", line 8 links to `https://ai.studio/apps/drive/1TSTROmMZDi_NK0VF4oiiW_i2TPkn1j5C`, and its Architecture section (lines 42-52) describes only two services — "Frontend (Vite + React) on port 5174" and "Backend (Express) on port 3001". The actual system is a **four-service** architecture: Vite/React frontend, Rust ingestion service (port 3001), Python/FastAPI analytics service (port 3002), and Caddy API gateway (port 8080). The README contains no mention of: Docker Compose (`docker-compose.yml`), PostgreSQL/TimescaleDB/PostGIS (`timescale/timescaledb-ha:pg16`), Redis, or the `geointellisense-ingestion` and `geointellisense-analytics` directories at all. The "Run Locally" section instructs `npm install` + `npm run dev:full` — but this only starts the Express server and Vite frontend; it does not start the DB, Redis, Rust service, or Python service, so all real-time data endpoints return connection errors. A developer following the README verbatim gets a non-functional app with no indication of the missing services. The document is approximately 18 months out of sync with the actual codebase architecture. PROPOSAL: Replace `README.md` with a project-accurate document covering: four-service architecture diagram; prerequisites (Docker, Node.js, Rust/Cargo for dev without Docker); Docker Compose quick-start (`docker compose up`); local-without-Docker instructions for each service; complete environment variable reference (all 11+ variables); links to `IMPLEMENTATION_STATUS.md` for roadmap details — M/M effort (write once, significant value).

- OBSERVATION: `.env.local.example:1-16` and `docker-compose.yml:80-95` — `.env.local.example` documents 5 of the 11+ environment variables the analytics service reads. The 7 completely undocumented variables are: `EPA_AQS_EMAIL` and `EPA_AQS_KEY` (required for `GET /api/epa-aqi/*` historical data; credentials obtained at `https://aqs.epa.gov/data/api`); `AIRNOW_API_KEY` (required for `GET /api/airnow/*` endpoints; obtained at `https://docs.airnowapi.org/`); `NOAA_CDO_TOKEN` (required for `GET /api/historical-weather/*`; obtained at `https://www.ncdc.noaa.gov/cdo-web/token`); `NASA_FIRMS_KEY` (required for fire detection polling in `fires.py`; `docker-compose.yml:93` shows `NASA_FIRMS_KEY: ${NASA_FIRMS_KEY:-}`); `CENSUS_API_KEY` (required for `GET /api/demographics/*`; obtained at `https://api.census.gov/data/key_signup.html`); `ADMIN_TOKEN` (gates all `/api/admin/*` routes in both `admin.py` and `admin.rs`; without it the admin API returns HTTP 403 for every request). Additionally, `docker-compose.yml:1-28` requires six Docker-specific variables (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_PORT`, `REDIS_PORT`, `INGESTION_PORT`, `ANALYTICS_PORT`, `GATEWAY_PORT`) that have no documentation anywhere in the repository — not in README, not in `.env.local.example`, not in `IMPLEMENTATION_STATUS.md`. There is no `.env.example` or `.env.docker.example` file documenting the compose-level variables. A developer running `docker compose up` without a `.env` file gets 8 missing variable errors before the first container starts. PROPOSAL: Add all 7 missing analytics variables (with description, example value, and where to obtain) to `.env.local.example`; create a `.env.docker.example` with the 8 Docker-specific variables plus all service-level variables, with inline comments — L/L effort (add ~30 documented lines to two files).

- OBSERVATION: `geointellisense-analytics/app/database.py:1-16` — The module has no docstring and no documentation of the asyncpg connection pool parameters `min_size=2, max_size=10` at line 7. Three non-obvious behaviors are undocumented: (a) `asyncpg.create_pool()` without a `timeout` argument uses `timeout=None`, meaning any query that arrives when all 10 connections are busy will block indefinitely rather than raising a timeout error — this makes `GET /api/epa-aqi/*` backfill requests (which are the heaviest DB consumers) capable of silently blocking all other pool waiters during a long aggregation query; (b) `min_size=2` means the pool pre-opens 2 connections on startup, but if the database is unreachable at startup (common in Docker when `db` container isn't yet ready despite `depends_on: condition: service_healthy`), `create_pool()` raises `asyncpg.PostgresConnectionFailureError` and the lifespan handler in `main.py:42` propagates it as an uncaught exception, crashing the FastAPI process; (c) the pool is a process-global singleton (`_pool` at `database.py:5`) so any test that calls `get_pool()` against a real DB will mutate shared state across test cases. Contrast with `cache.py:1-8` which has a thorough module-level docstring explaining its key namespace and TTL conventions. PROPOSAL: Add a module-level docstring to `database.py` documenting the `min_size`, `max_size` rationale, the `timeout=None` blocking behavior, and a note about the startup-crash risk; add `command_timeout=30.0` to `create_pool()` to cap per-query blocking at 30 seconds — L/L effort (add 6-line docstring + one keyword argument).

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:5-30` — The only public function in the Rust persistence layer, `pub async fn write_readings(pool: &PgPool, readings: &[AqiReading])`, has no `///` doc comment. Its signature returns `()` — no `Result` — so the caller at `broadcast.rs:spawn_ticker` has no way to detect persist failures at the type level. The failure behavior (log the error via `tracing::error!` at line 28 and silently continue) is invisible to readers of the call site in `broadcast.rs`. This matters because the same silent-continue pattern means: a complete loss of DB connectivity causes the Rust service to keep running and broadcasting SSE events to clients showing "live" data, while silently dropping every reading to disk; the gap is undetectable from metrics or the `/health` endpoint (which returns static `{"status":"ok"}`). Additionally, the SQL at `persist.rs:8-12` uses a bare `INSERT ... VALUES` with no `ON CONFLICT DO NOTHING` clause — if a reading with the same `(time, location_id)` is inserted twice (e.g., on service restart when the broadcast ticker fires before the first interval completes), `sqlx` returns a `UniqueViolationError` that is logged as a tracing `error!` but swallowed. Without a doc comment this conflict behavior is unknown to code reviewers. PROPOSAL: Add `/// Writes AQI readings to PostgreSQL. Per-row errors are logged via tracing but not propagated; callers cannot detect persist failures. Duplicate (time, location_id) rows produce a UniqueViolationError that is silently swallowed.` above `write_readings` at `persist.rs:5`; consider adding `ON CONFLICT (time, location_id) DO NOTHING` to the INSERT to eliminate duplicate-key log noise — L/L effort (4-line doc comment + add 2 SQL words).

**Proposed actions:**
- Replace stale AI-Studio-scaffold `README.md` with a project-accurate document covering four-service architecture, Docker Compose quick-start, local dev instructions, and complete environment variable reference — M/M effort
- Add 7 missing analytics variables to `.env.local.example`; create `.env.docker.example` for the 8 Docker Compose variables — L/L effort
- Add module-level docstring to `database.py` documenting pool sizing and `timeout=None` blocking behavior; add `command_timeout=30.0` to `create_pool()` — L/L effort
- Add `///` doc comment to `write_readings()` at `persist.rs:5` documenting the silent-failure contract and implicit duplicate-key behavior — L/L effort

## 📚 Archive (one line per past run)
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
