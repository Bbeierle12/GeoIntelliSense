# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-07T04:10:00Z
Last run: #193 — Lens: LLM integration quality

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
| 8 | Add retry+backoff to Rust `PurpleAirClient::fetch_sensors` | Data pipeline | H | L | 8 | Open |
| 9 | Redis-down skips all PurpleAir/earthquake polling — default toggle to ON when Redis unavailable | Data pipeline | H | L | 8 | Open |
| 10 | Upgrade `vite` from 6.4.1 to ≥6.5.0 AND change `host` from `'0.0.0.0'` to `'127.0.0.1'` in `vite.config.ts:9` — GHSA-p9ff-h696-f583 file read amplified by all-interfaces binding | Security/Dep | H | L | 168 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #193 — 2026-06-07 — Lens: LLM integration quality
**Scope:** Thirteenth LLM integration quality pass. Files examined in full: `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/routes/chat.py`; `geointellisense-analytics/app/routes/deep_analysis.py`; `geointellisense-analytics/app/routes/low_latency.py`; `geointellisense-analytics/app/routes/grounded_search.py`; `geointellisense-analytics/app/routes/grounded_maps.py`; `geointellisense-analytics/app/routes/predictive_analysis.py`; `geointellisense-analytics/app/routes/weather_forecast.py`; `geointellisense-analytics/app/config.py`; `geointellisense-analytics/app/context.py`. Cross-checked against Active Recommendations and archived LLM integration runs #13, #28, #43, #58, #73, #88, #103, #118, #133, #148, #163, #178 to confirm findings are new.

**Findings:**

- OBSERVATION: `claude.py:74-75` — `get_client()` returns `anthropic.Anthropic(api_key=settings.anthropic_api_key)` unconditionally on every invocation. The `anthropic.Anthropic` constructor creates a new `httpx.Client` instance (including a fresh connection pool and TLS session) each time it is called. Every route that invokes `get_client()` — `chat.py:40`, `deep_analysis.py:31`, `low_latency.py:31`, `grounded_search.py:37`, `grounded_maps.py:44`, `predictive_analysis.py:91`, `weather_forecast.py:75` — therefore incurs a full TCP handshake and TLS negotiation against `api.anthropic.com` on each request, discarding the previously established connection immediately after. Under load, when the `ai_chat` rate limit allows 20 req/min, this creates 20 separate connection setups per minute rather than multiplexing over a persistent HTTPS/2 connection. The `httpx.Client` created inside `anthropic.Anthropic` is also not closed explicitly — the connection pool is abandoned after `get_client()` goes out of scope, relying on CPython's reference counting to close the underlying socket. Under PyPy or in garbage-collected environments this can exhaust file descriptors. PROPOSAL: Replace `get_client()` with a module-level singleton: `_client: anthropic.Anthropic | None = None` and `def get_client() -> anthropic.Anthropic: global _client; if _client is None: _client = anthropic.Anthropic(api_key=settings.anthropic_api_key); return _client` — L/L effort (5 lines in `claude.py`; reuses the connection pool across all requests; reduces per-request latency by ~50-200 ms depending on TLS session resumption support from Anthropic's CDN).

- OBSERVATION: `chat.py:43`, `deep_analysis.py:33`, `low_latency.py:31`, `grounded_search.py:39`, `grounded_maps.py:46`, `predictive_analysis.py:91`, `weather_forecast.py:75` — All seven LLM-calling route handlers are declared `async def` and run on uvicorn's asyncio event loop, but every call to `client.messages.create()` is a synchronous blocking operation. The `anthropic.Anthropic` class uses a synchronous `httpx.Client`; `messages.create()` calls `httpx.Client.post()` which blocks on the OS socket read until the full LLM response is received. For `claude-opus-4-6` with `max_tokens=40000` and `budget_tokens=32768` (`deep_analysis.py:33-41`), a single call can block for 60-120 seconds. During that time, uvicorn's event loop cannot process any other coroutine — no SSE heartbeats, no rate-limit checks, no health pings — effectively reducing the entire analytics service to single-request throughput for each blocked call. The concurrent request capacity claimed by `check_rate_limit` (e.g., 5 req/min for `ai_deep`) is therefore illusory: even if 5 requests arrive simultaneously within the rate window, only one runs while the others queue in the OS TCP backlog. PROPOSAL: Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:74-75` and change all `client.messages.create(...)` calls to `await client.messages.create(...)` across the seven route files — M/M effort (~15 lines changed across 7 files; makes all LLM calls non-blocking; restores true concurrent request handling; no change to API parameters or prompts required; `anthropic.AsyncAnthropic` is a drop-in async replacement with identical method signatures).

- OBSERVATION: `deep_analysis.py:70-76` — The tool-use continuation loop rebuilds the `messages` array on each iteration as `[original_user_prompt, assistant_content_from_this_round, tool_results_from_this_round]`. On round 1, this is correct. On round 2 (if the model calls a second tool), the messages sent to the API are: `[original_user_prompt, round-2-assistant-content, round-2-tool-results]` — the entire exchange from round 1 (round-1 assistant content + round-1 tool results) is silently dropped. Claude therefore synthesises its final deep analysis without access to the data it fetched in earlier rounds. For example, if round 1 retrieved AQI data and round 2 retrieved earthquake data, the final response was produced by a Claude instance that only saw the earthquake data — the AQI findings it reasoned about in round 1 are invisible. The same truncation bug does not exist in `chat.py:66-69` (which correctly accumulates history via `get_session_history`) or `grounded_search.py:63-71` (which correctly prepends `assistant_content` and `tool_results`). PROPOSAL: Replace `deep_analysis.py:70-76` with an accumulating messages list: initialise `messages = [{"role": "user", "content": req.prompt}]` before the loop, and inside each iteration append `{"role": "assistant", "content": assistant_content}` and `{"role": "user", "content": tool_results}` before the next `client.messages.create()` call — L/L effort (~6 line change; fixes silent data loss in multi-round deep-analysis tool calls; aligns with the correct pattern already used in `grounded_search.py`).

- OBSERVATION: `grounded_search.py:79` and `grounded_maps.py:86` — Both endpoints return `{"text": text, "groundingChunks": []}` — the `groundingChunks` field is always an unconditional empty list regardless of how many tool calls were executed. During a typical request where Claude calls `get_air_quality`, `get_earthquakes`, and `get_active_fires`, the tool results are used to ground Claude's response, but neither the tool names, the data source URLs, nor any content summary is surfaced to the client. The frontend receives `groundingChunks: []` every time, which means the UI (wherever it renders source citations) always displays "0 sources" even when three live API calls were actually made. The tool call results are already fully captured in the `tool_results` list built at lines 52-61 (`grounded_search.py`) and lines 57-66 (`grounded_maps.py`) — the data is present in memory but discarded before the return statement. PROPOSAL: After the tool-use loop in both files, build a `grounding_chunks` list from `tool_results`: for each entry in `tool_results`, append `{"title": entry_tool_name, "uri": f"/api/{tool_endpoint}", "content_snippet": entry_content[:200]}` and return it as `groundingChunks` — M/M effort (~10 lines per file; surfaces actual data provenance to the UI; enables frontend to show "Sources: AQI data, Earthquake data, Fire data" instead of "Sources: 0"; requires tracking `block.name` alongside `tool_results`).

**Proposed actions:**
- Replace `get_client()` with a module-level singleton in `claude.py:74-75` — L/L effort (5 lines; eliminates per-request TCP+TLS setup overhead; prevents file descriptor leak under non-CPython runtimes)
- Switch from `anthropic.Anthropic` to `anthropic.AsyncAnthropic` throughout `claude.py` and all 7 LLM route files — M/M effort (~15 lines; restores true async concurrency; eliminates event-loop blocking during LLM calls)
- Fix multi-round message accumulation in `deep_analysis.py:70-76` — L/L effort (~6 lines; fixes silent tool-result truncation in round 2+; aligns with correct pattern in `grounded_search.py`)
- Populate `groundingChunks` from captured `tool_results` in `grounded_search.py:79` and `grounded_maps.py:86` — M/M effort (~10 lines per file; surfaces actual data provenance in the UI response)

### Run #192 — 2026-06-07 — Lens: Deployment / Docker
**Scope:** Thirteenth Deployment/Docker pass. Files examined in full: `geointellisense-analytics/Dockerfile`; `geointellisense-ingestion/Dockerfile`; `geointellisense-analytics/.dockerignore`; `geointellisense-ingestion/.dockerignore`; `docker-compose.yml`; `Caddyfile`; `geointellisense-analytics/requirements.txt`. Cross-checked against Active Recommendations and archived Deployment/Docker runs #12, #27, #42, #57, #72, #87, #102, #117, #132, #147, #162, #177 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/Dockerfile:3-5` — The analytics service uses a single-stage build (`FROM python:3.12-slim`), unlike the Rust ingestion service which correctly uses a two-stage build (`rust:1.88-slim AS builder` → `debian:bookworm-slim`). Line 4 installs `libgdal-dev`, a Debian development package that includes ~80 MB of GDAL C headers (`/usr/include/gdal/`), static libraries (`libgdal.a`), and pkg-config metadata needed only during `pip install` of packages that compile GDAL C extensions (`rasterio==1.4.*`, `geopandas==1.0.*` in `requirements.txt`). At runtime, only `libgdal32` (the shared library) is needed. Because the analytics Dockerfile has no `AS builder` stage, every production image layer carries the full GDAL development toolchain — headers, static libs, and pkg-config data serve no runtime purpose and expand the container's package surface. On Debian bookworm, `libgdal-dev` transitively depends on `libpq-dev`, `libhdf5-dev`, `libnetcdf-dev`, and several other `-dev` packages, compounding the bloat. PROPOSAL: Split `geointellisense-analytics/Dockerfile` into two stages: `FROM python:3.12-slim AS builder` (installs `libgdal-dev`, runs `pip install --no-cache-dir -r requirements.txt`) followed by `FROM python:3.12-slim` (installs only `libgdal32 libproj25`, copies `/usr/local/lib/python3.12/site-packages` from builder, and runs `CMD`) — reduces final analytics image by ~80 MB and eliminates all GDAL development headers from the runtime attack surface, matching the pattern already established in the ingestion Dockerfile.

- OBSERVATION: `docker-compose.yml:110` — The analytics service healthcheck uses `["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:3002/api/health')"]`. The `urllib.request.urlopen()` call at line 110 receives no `timeout` argument, which means it defaults to Python's global socket timeout — `None` (wait indefinitely). The analytics service legitimately blocks its event loop during `await client.messages.create()` calls: `deep_analysis.py` sets `max_tokens=40000` and `budget_tokens=32768`, meaning a single deep-analysis request can hold the process for 60+ seconds. During that interval, `/api/health` is still reachable (uvicorn's asyncio loop continues serving), but if the uvicorn process ever becomes genuinely stuck (e.g., a hung subprocess in the ML inference path, or a blocking DB call that escaped the async context), the healthcheck subprocess hangs alongside it with no bound. Docker's healthcheck `timeout: 5s` (line 112) then kills the check, marks the container as "unhealthy", and the `gateway` service — which has `depends_on: analytics: condition: service_healthy` (line 131) — enters a restart cycle, dropping all in-flight AI requests. The `timeout: 5s` on the Docker side is already set, but it only kills the subprocess after 5 seconds; if the subprocess were making a blocking OS socket call, the OS may not honour the signal promptly. PROPOSAL: Change the analytics healthcheck command to `["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:3002/api/health', timeout=3)"]` — the explicit `timeout=3` argument sets a 3-second Python-level socket deadline, well within the Docker `timeout: 5s`, ensuring the check raises `urllib.error.URLError` and exits non-zero rather than hanging if the analytics HTTP server is unresponsive.

- OBSERVATION: `geointellisense-ingestion/Dockerfile:11` — The dependency-caching layer uses `RUN cargo build --release 2>/dev/null || true`. The `2>/dev/null` suppresses all stderr output from Cargo (warnings, errors, and linker messages), and `|| true` forces exit code 0 regardless of whether the build succeeded. The intent is to pre-build transitive dependency crates into a Docker layer cache using a stub `fn main() {}` before the real source is copied in. However, if any dependency fails to compile — for example, because a new transitive crate added to `Cargo.toml` needs a native library that is not yet listed in the `apt-get install` block at lines 3-5 — the layer succeeds silently with a broken cache. The real build at line 14 (`RUN touch src/main.rs && cargo build --release`) then either rebuilds all crates from scratch (defeating the caching intent and producing a confusing slow build) or fails with a cryptic error about the binary crate rather than the actual failing dependency. Because stderr is entirely discarded, no CI or docker-build log captures the Cargo-level error that would identify which package and which missing library caused the failure. PROPOSAL: Change line 11 to `RUN cargo build --release --lib 2>&1 | tee /tmp/dep-build.log; grep -E "^error" /tmp/dep-build.log && exit 1; exit 0` — this preserves the cache-warming intent while surfacing compilation errors in the build log and failing the layer if any `error[...]` line is emitted by Cargo.

- OBSERVATION: `Caddyfile:3-5` — The `handle /api/aqi-stream` block proxies to `ingestion:3001` using a bare `reverse_proxy ingestion:3001` directive without an explicit `flush_interval` subdirective. Caddy's reverse proxy module does implement automatic SSE flush detection: when it observes a `Content-Type: text/event-stream` response header, it sets `flush_interval` to `-1` (immediate flush). However, this automatic detection fires after the first response byte is read; if the Rust ingestion service sends an SSE response with the event-stream `Content-Type` but delays the first `data:` frame (e.g., during initial sensor poll, which runs every `PURPLEAIR_INTERVAL_SECS=600` seconds), Caddy has no `Content-Type` to inspect yet and may apply its default flush policy to the preamble. Additionally, Caddy's automatic detection is version-dependent — the behaviour was added in Caddy 2.4 and the `caddy:2-alpine` image in `docker-compose.yml:121` is pinned only to the major version `2`, meaning any Caddy 2.x update could introduce a regression in the auto-detect path. Making `flush_interval -1` explicit in the `handle /api/aqi-stream` block removes the dependency on Caddy's heuristic and is idiomatic per the Caddy docs for SSE-serving proxies. PROPOSAL: Replace the bare `reverse_proxy ingestion:3001` at `Caddyfile:4` with a block form: `reverse_proxy ingestion:3001 { flush_interval -1 }` — zero-cost change (no restart required, just Caddy config reload) that guarantees immediate byte-for-byte SSE frame forwarding regardless of Caddy version or response header timing.

**Proposed actions:**
- Split `geointellisense-analytics/Dockerfile` into two-stage build: builder stage with `libgdal-dev`, runtime stage with only `libgdal32` — L/M effort (~10 Dockerfile lines; reduces analytics image by ~80 MB; eliminates dev-toolchain headers from runtime)
- Add `timeout=3` to `urlopen` in analytics healthcheck at `docker-compose.yml:110` — L/L effort (one argument; prevents infinite hang when analytics HTTP server is unresponsive, ensures 3s Python deadline is inside Docker's 5s timeout)
- Replace `2>/dev/null || true` at `geointellisense-ingestion/Dockerfile:11` with a form that logs and fails on Cargo errors — L/L effort (one-line change; surfaces dependency compilation failures that currently pass silently)
- Add `flush_interval -1` subdirective to `handle /api/aqi-stream` block in `Caddyfile:4` — L/L effort (two lines; guarantees SSE frame flushing independent of Caddy version heuristics)

### Run #191 — 2026-06-07 — Lens: Docs
**Scope:** Thirteenth Docs pass. Files examined in full: `README.md`; `IMPLEMENTATION_STATUS.md`; `.env.local.example`; `docker-compose.yml`; `geointellisense-analytics/app/routes/predictive_analysis.py`; `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/main.py`; `geointellisense-analytics/app/config.py`; `geointellisense-ingestion/src/main.rs`; `geointellisense-ingestion/src/config.rs`; `geointellisense-ingestion/src/purpleair.rs`; `Caddyfile`; `package.json`; `db/migrations/001_locations.sql`; `db/migrations/017_water_quality.sql`. Cross-checked against Active Recommendations and archived Docs runs #11, #26, #41, #56, #71, #86, #101, #116, #131, #146, #161, #176 to confirm findings are new.

**Findings:**

- OBSERVATION: `README.md:45`, `README.md:51`, `README.md:64`, `IMPLEMENTATION_STATUS.md:7`, `IMPLEMENTATION_STATUS.md:65` — Both developer-facing documentation files reference a deleted Express backend that no longer exists in the repository. `README.md:45` instructs the reader to run `npm run dev:full`; `README.md:51` instructs `npm run server`; `IMPLEMENTATION_STATUS.md:65` also instructs `npm run server`. `package.json` (the single source of truth for npm scripts) defines only `dev`, `build`, `preview`, `test`, `test:ui`, `test:run`, and `test:coverage` — neither `dev:full` nor `server` exist, so both commands fail immediately with `npm error Missing script: "dev:full"`. `README.md:64` describes the architecture as "**Backend** (Express): Runs on `http://localhost:3001`" — port 3001 is in fact the Rust ingestion service (Axum, not Express); the Python FastAPI analytics service runs on port 3002. `IMPLEMENTATION_STATUS.md:7` states "**Backend proxy** already implemented in `server/index.js`" — the `server/` directory does not exist in the repository. A first-time developer following the README's Step 3 ("Run both the backend server and frontend: `npm run dev:full`") receives an error and has no path to a working development environment. PROPOSAL: Rewrite `README.md` Step 3 to `docker compose up -d` (the actual entry point documented in `IMPLEMENTATION_STATUS.md`'s "Development Mode" section); remove all references to `npm run server` and Express; update the Architecture section to reflect the Caddy gateway (`localhost:8080`), Rust ingestion (`localhost:3001`), and Python analytics (`localhost:3002`) services — L/L effort (README rewrite; zero code change; unblocks all new contributors).

- OBSERVATION: `.env.local.example` — The example environment file documents 5 variables (`ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`) but `docker-compose.yml` requires at least 14 additional variables via `${VAR}` substitution. Variables referenced in `docker-compose.yml` but absent from `.env.local.example`: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_PORT`, `REDIS_PORT`, `INGESTION_PORT`, `ANALYTICS_PORT`, `GATEWAY_PORT`, `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, `EPA_AQS_EMAIL`, `EPA_AQS_KEY`, `CENSUS_API_KEY`, and `ADMIN_TOKEN`. Without defaults in docker-compose.yml for any of these (unlike e.g. `PURPLEAIR_API_KEY:-` which has a fallback), running `docker compose up` without a populated `.env` will produce docker-compose errors such as `variable is not set. Defaulting to a blank string` or `invalid interpolation format` for critical variables like `POSTGRES_USER` and `POSTGRES_PASSWORD`, causing the `db` service to fail at startup. The README instructs users to copy `.env.local.example` to `.env.local`, but the actual docker-compose workflow reads from `.env` (no `.local` suffix). PROPOSAL: Expand `.env.local.example` to include all 19 required variables with safe example values (e.g., `POSTGRES_USER=geointellisense`, `POSTGRES_PASSWORD=changeme`, `DB_PORT=5432`, `REDIS_PORT=6379`, `INGESTION_PORT=3001`, `ANALYTICS_PORT=3002`, `GATEWAY_PORT=8080`) and rename it to `.env.example` to match docker-compose's default read path — L/L effort (add ~15 lines; eliminates docker compose startup failures for all new contributors).

- OBSERVATION: `geointellisense-analytics/app/routes/predictive_analysis.py:42` and `predictive_analysis.py:60` — Two inline comments reference `server/index.js`, a file that does not exist: line 42 reads `# Merge AQI and weather data point-by-point, matching the Express logic` and line 60 reads `# Exact prompt template ported from server/index.js lines 350-377`. The `server/` directory is absent from the repository — it was the deleted Express/Node.js backend replaced by this Python FastAPI service. These comments are the only surviving documentation of the prompt's design rationale (why the data merge follows a specific loop order, and why the Markdown structure is exactly as written). A developer unfamiliar with the migration history who sees `server/index.js lines 350-377` will spend time looking for a file that no longer exists, and may incorrectly conclude the comments describe a live dependency rather than a historical source. PROPOSAL: Replace line 42 with `# Merge AQI and weather data month-by-month; shorter list truncates (weather may have fewer entries than AQI)` and replace line 60 with `# Prompt structure matches the original Node.js server output format; preserve spacing/headers for frontend Markdown renderer` — L/L effort (two comment rewrites; no functional change; documents the invariants in place of the deleted source reference).

- OBSERVATION: `geointellisense-analytics/app/claude.py:232-233` — The `execute_tool` function falls back to a hardcoded `http://localhost:3001/api/aqi-snapshot` when the primary call to `http://localhost:{settings.port}/api/aqi-snapshot` returns non-200. The only inline documentation is the comment `# Fall back to DB-based snapshot` at line 232. This comment does not document: (a) that `localhost:3001` is the Rust ingestion service and therefore subject to its `PORT` env var; (b) that in a `docker compose` deployment, `localhost:3001` inside the `analytics` container is not reachable (the ingestion service is on the Docker network as `ingestion:3001`, not `localhost:3001`), making this fallback silently broken in all containerized deployments; (c) why a non-200 from the primary call should trigger a fallback to a different service rather than propagating the error. In production, when the analytics service fails to serve `/api/aqi-snapshot` (perhaps due to a DB query timeout), the fallback executes, reaches a connection-refused on `localhost:3001` inside the container, and returns `{"error": "Tool execution failed: ..."}` to Claude — who then reports "air quality data unavailable" to the user — with no log line distinguishing this from a successful but empty response. PROPOSAL: Expand the comment at `claude.py:232` to `# Fallback: ask the Rust ingestion service directly (local-dev only — localhost:3001 is unreachable inside the analytics container in docker-compose; configure INGESTION_URL env var to enable this in containerized deployments)` and add `settings.ingestion_url` to `config.py` with a default of `http://localhost:3001` — L/L effort (comment + one `config.py` field; makes the docker-compose incompatibility visible to any reviewer of `claude.py`).

**Proposed actions:**
- Rewrite `README.md` Step 3 to use `docker compose up -d`; remove `npm run dev:full` / `npm run server` references; fix Architecture section to name Caddy/Rust/Python services — L/L effort (unblocks all first-time contributors)
- Expand `.env.local.example` → `.env.example` with all 19 docker-compose required variables — L/L effort (eliminates docker compose startup failures for new contributors)
- Replace stale `server/index.js` comments at `predictive_analysis.py:42` and `predictive_analysis.py:60` with forward-only explanations of the invariants — L/L effort (two comment rewrites; removes dead file references)
- Add `INGESTION_URL` to `config.py`; expand comment at `claude.py:232` to document docker-compose incompatibility of the localhost:3001 fallback — L/L effort (makes a silent production failure path discoverable)

## 📚 Archive (one line per past run)
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
