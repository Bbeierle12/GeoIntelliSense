# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-03T01:06:30Z
Last run: #133 — Lens: LLM integration quality

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
### Run #133 — 2026-06-03 — Lens: LLM integration quality
**Scope:** Ninth LLM integration quality pass. Examined: `geointellisense-analytics/app/claude.py` (full); `geointellisense-analytics/app/routes/chat.py` (full); `geointellisense-analytics/app/routes/deep_analysis.py` (full); `geointellisense-analytics/app/routes/predictive_analysis.py` (full); `geointellisense-analytics/app/routes/weather_forecast.py` (full); `geointellisense-analytics/app/routes/grounded_maps.py` (full); `geointellisense-analytics/app/routes/grounded_search.py` (full); `geointellisense-analytics/app/routes/low_latency.py` (full); `geointellisense-analytics/app/routes/ai_context.py` (full); `geointellisense-analytics/app/context.py` (partial — lines 1–191); `geointellisense-analytics/requirements.txt` (full). Cross-checked against Active Recommendations and runs #131–#132 (Latest Findings) plus archived LLM integration runs #13, #28, #43, #58, #73, #88, #103, #118 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `claude.py:74-75` — `get_client()` instantiates a new `anthropic.Anthropic(api_key=settings.anthropic_api_key)` SDK client on every invocation. Internally, `anthropic.Anthropic` creates a new `httpx.Client` with its own connection pool, meaning every Claude API call pays a fresh TLS handshake to `api.anthropic.com` with zero keep-alive reuse across requests. The Anthropic SDK is explicitly designed to be instantiated once and shared. More critically: `anthropic.Anthropic` is the *synchronous* client; all seven call sites — `chat.py:43,70`, `deep_analysis.py:33,61`, `grounded_maps.py:46,69`, `grounded_search.py:39,62`, `low_latency.py:31`, `predictive_analysis.py:91`, `weather_forecast.py:75` — are in `async def` FastAPI handlers. The blocking `client.messages.create()` runs on the asyncio event loop thread and freezes it for the full API response duration — up to 30+ seconds for Opus + 32,768-token extended thinking in `deep_analysis.py:34-44`. During that time the uvicorn worker cannot accept or respond to any other request, serialising all concurrency through the most expensive code path. Fix: declare a module-level `_async_client: anthropic.AsyncAnthropic` singleton in `claude.py`; expose it instead of the per-call `get_client()` factory; switch all seven `messages.create()` calls to `await _async_client.messages.create()`. PROPOSAL: Replace sync `anthropic.Anthropic` per-call pattern with a module-level `anthropic.AsyncAnthropic` singleton — H/M effort (seven call sites across five files).

- OBSERVATION: `deep_analysis.py:61-75` (identical pattern at `grounded_maps.py:62-79` and `grounded_search.py:49-72`) — The multi-round tool-use loop resets the message history on every iteration rather than accumulating it. At the start of each round, `assistant_content = resp.content` captures the current assistant response; then `messages` is built as exactly three items: `[original_user_prompt, latest_assistant_content, latest_tool_results]`. When `rounds == 2`, the round-1 assistant response and round-1 tool results are absent from the `messages` list — only the round-2 state is visible. Claude on round 2 has no memory of which tools it called in round 1, what they returned, or what reasoning it produced from those results. This can cause redundant repeat tool calls or analysis that ignores round-1 discoveries. The bug is most costly in `deep_analysis.py`, which uses Opus with a 32,768-token extended thinking budget; each wasted round costs approximately $0.48 in thinking tokens alone at current Opus pricing. Compare: `chat.py:66-68` correctly grows the message list by reading `get_session_history(session_id)`. Fix: maintain a growing `messages` list across loop iterations, appending two entries per round (the assistant turn and the user/tool-result turn). PROPOSAL: Refactor the tool-use loop in `deep_analysis.py`, `grounded_maps.py`, and `grounded_search.py` to accumulate message history across rounds (growing list, not 3-message reset) — references the working pattern in `chat.py:66-68` — L/L effort (6–8 line change per file).

- OBSERVATION: `predictive_analysis.py:33` (`customFactors: str`) and `weather_forecast.py:28` (`customFactors: str`) — Both Pydantic request models accept `customFactors` as a bare `str` with no `Field(max_length=...)` constraint. The value is interpolated verbatim into a triple-backtick code block in the Claude prompt at `predictive_analysis.py:51-57` and `weather_forecast.py:38-45`. This creates two distinct problems. (1) **Token amplification**: an anonymous caller can send `customFactors` of arbitrary length (e.g., 200,000 characters), passed unchanged to Claude, burning proportional input tokens at full price with no upper bound. (2) **Prompt injection**: wrapping the field in `` ``` `` does not prevent a payload that itself contains `` ``` `` followed by arbitrary instruction text from closing the code block and injecting instructions into the otherwise-structured prompt (e.g., "Ignore all previous instructions"). Since `/api/predictive-analysis` and `/api/weather-forecast` have no authentication (Active Rec #9), any anonymous caller can exploit both vectors. Fix: add `customFactors: str = Field(default="", max_length=2000)` to both request models; truncate or escape backtick sequences before interpolation. PROPOSAL: Add `Field(max_length=2000)` to `customFactors` in `predictive_analysis.py:33` and `weather_forecast.py:28` — L/L effort (two one-line changes).

- OBSERVATION: `chat.py:43` / `deep_analysis.py:33,61` / `grounded_maps.py:46,69` / `grounded_search.py:39,62` / `low_latency.py:31` / `predictive_analysis.py:91` / `weather_forecast.py:75` — None of the seven `client.messages.create()` call sites pass `cache_control` on the `system` parameter, forfeiting Anthropic's prompt-caching cost discount. The system prompt assembled by `get_system_with_live_context` is identical for all requests within the 60-second `_cached_context_ts` window (`claude.py:88`), making it an ideal cache candidate: same bytes, reused repeatedly. Anthropic prompt caching charges ~10% of the standard input-token rate for cache hits. For the `deep_analysis.py` Opus route, a 3,000-token system prompt saves approximately $0.40/MTok; for `chat.py` (Sonnet), ~$0.27/MTok. The `anthropic==0.49.*` SDK (`requirements.txt:9`) fully supports prompt caching via the structured-system-block form: `system=[{"type": "text", "text": ..., "cache_control": {"type": "ephemeral"}}]`. None of the seven call sites use this form — all pass `system=system` (a plain string). PROPOSAL: Change all seven `system=system` parameters to `system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]` — L/L effort (seven one-line changes, or a helper wrapper in `claude.py`).

**Proposed actions:**
- Replace `get_client()` pattern with a module-level `anthropic.AsyncAnthropic` singleton in `claude.py:74-75`; switch all 7 `messages.create()` call sites to `await` — eliminates event-loop blocking and per-call TLS handshake overhead — H/M effort
- Refactor tool-use loop in `deep_analysis.py:61-75`, `grounded_maps.py:62-79`, `grounded_search.py:49-72` to accumulate messages across rounds rather than resetting to 3-message list — L/L effort
- Add `Field(max_length=2000)` to `customFactors` in `predictive_analysis.py:33` and `weather_forecast.py:28` — caps token amplification and closes prompt-injection surface — L/L effort
- Pass `cache_control: {"type": "ephemeral"}` on `system` at all 7 `messages.create()` call sites — enables Anthropic prompt-caching discount (~10% of standard input rate for cached tokens) — L/L effort

### Run #132 — 2026-06-03 — Lens: Deployment / Docker
**Scope:** Tenth Docker/Deployment pass. Examined: `geointellisense-analytics/Dockerfile` (full); `geointellisense-ingestion/Dockerfile` (full); `docker-compose.yml` (full); `Caddyfile` (full); `geointellisense-analytics/.dockerignore` (full); `geointellisense-ingestion/.dockerignore` (full); `geointellisense-analytics/requirements.txt` (full); `geointellisense-ingestion/Cargo.toml` (full); `geointellisense-analytics/app/routes/health.py` (full); `geointellisense-ingestion/src/routes/health.rs` (full). Cross-checked against Active Recommendations and runs #130–#131 (Latest Findings) plus archived Docker runs #12, #27, #42, #57, #72, #87, #102, #117 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `docker-compose.yml:119-135` — The `gateway` (Caddy) service is the only service in the compose stack with no `healthcheck:` block. The `db`, `redis`, `ingestion`, and `analytics` services all define healthchecks; `gateway` does not. Furthermore, `ingestion` and `analytics` both declare `depends_on: ... condition: service_healthy`, meaning Compose blocks until those services pass health checks before the gateway starts. But nothing downstream of the gateway monitors its continued health. If Caddy terminates or enters a crash-loop after its initial successful start, `docker ps` continues reporting the container as `Up` (not `unhealthy`), and `restart: unless-stopped` will restart it — but only after Docker detects the process exit, not before. A Caddy hang (process alive but not serving requests) is entirely invisible. The gateway is the sole public entry point for all API calls; its health is more critical than any individual backend service, yet it is the only one without a probe. Fix: add a healthcheck to the gateway service: `test: ["CMD", "wget", "-qO-", "http://localhost:8080/"]` (the Caddyfile's `respond "GeoIntelliSense API Gateway" 200` catch-all makes this safe) with `interval: 10s`, `timeout: 5s`, `retries: 3`, `start_period: 5s`. The `caddy:2-alpine` image already includes `wget`. PROPOSAL: Add a `healthcheck:` block to the `gateway` service in `docker-compose.yml` — L/L effort (6 lines).

- OBSERVATION: `docker-compose.yml:110` — The `analytics` service healthcheck invokes a full Python interpreter every 10 seconds: `["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:3002/api/health')"]`. Python startup alone takes 50–100 ms and loads the interpreter, stdlib, and C extensions before making a trivial HTTP request. Contrast: the `ingestion` service healthcheck at `docker-compose.yml:68` uses `curl -sf http://localhost:3001/health`, which completes in under 5 ms. The Python-based probe fires every 10 seconds across the container's lifetime; on a host running multiple analytics instances (e.g., in Docker Swarm or with `scale: N`), this compounds. The root cause is that `geointellisense-analytics/Dockerfile:1` bases on `python:3.12-slim`, which does not include `curl`. Adding `curl` to the analytics Dockerfile's `apt-get install` block alongside `libgdal-dev` (`Dockerfile:3-5`) would allow replacing the Python probe with `["CMD-SHELL", "curl -sf http://localhost:3002/api/health || exit 1"]`, matching the ingestion pattern. PROPOSAL: Add `curl` to `apt-get install` in `geointellisense-analytics/Dockerfile:3`; update the analytics healthcheck in `docker-compose.yml:110` to use `curl -sf` — L/L effort (one package added, one line changed).

- OBSERVATION: `docker-compose.yml:54` — The `ingestion` service environment block sets `RUST_LOG: info` as a hardcoded literal. Every other tunable in the same environment block follows the `${VAR:-default}` pattern that allows host-environment override: `PURPLEAIR_INTERVAL_SECS: ${PURPLEAIR_INTERVAL_SECS:-600}` (line 56), `BROADCAST_INTERVAL_SECS: ${BROADCAST_INTERVAL_SECS:-5}` (line 57). `RUST_LOG` is the sole exception. This means that to get `debug` or `trace` log output from the Rust ingestion service during incident investigation or development, an operator must edit `docker-compose.yml` directly — they cannot set `RUST_LOG=debug` in their shell and run `docker compose up` to pick it up. In a production deployment where `docker-compose.yml` is managed as infrastructure-as-code and changes require a PR, this creates unnecessary friction. PROPOSAL: Change `docker-compose.yml:54` from `RUST_LOG: info` to `RUST_LOG: ${RUST_LOG:-info}` — L/L effort (one character change: wrap in `${...:-...}`).

- OBSERVATION: `geointellisense-analytics/Dockerfile:3-5` — The analytics Dockerfile installs `libgdal-dev` in a single-stage build. `libgdal-dev` is a compile-time package: it includes C header files (`/usr/include/gdal/`) and static libraries that are needed only during `pip install` when `rasterio` and `geopandas` compile their native C extensions. After `RUN pip install --no-cache-dir -r requirements.txt` completes on line 10, those headers are never needed again. Because the Dockerfile is single-stage, the dev headers (~25–45 MB depending on the Debian gdal version) remain in the final image layer alongside the runtime. The correct approach is a two-stage build: Stage 1 (`FROM python:3.12-slim AS builder`) installs `libgdal-dev` and uses `pip install --prefix=/install` to collect wheels; Stage 2 (`FROM python:3.12-slim`) installs only the runtime `libgdal34` (the shared library) and copies `/install` from the builder stage. This also removes the `apt-get` cache from the final image entirely. An alternative single-stage mitigation — `apt-get install libgdal-dev && pip install ... && apt-get purge libgdal-dev && apt-get autoremove` — is unreliable because purging GDAL may pull runtime symbols that `rasterio`'s `.so` references. The multi-stage approach is the only safe fix. PROPOSAL: Convert `geointellisense-analytics/Dockerfile` to a two-stage build, replacing `libgdal-dev` in Stage 1 with `libgdal34` (runtime shared library) in Stage 2; estimate 30–50 MB reduction in final image size — M/M effort.

**Proposed actions:**
- Add `healthcheck:` block to the `gateway` service in `docker-compose.yml` using `wget` against the Caddy catch-all route — closes the only unhealthy-container blind spot in the stack — L/L effort
- Add `curl` to analytics `Dockerfile:3` and update `docker-compose.yml:110` to use `curl -sf` for healthcheck — removes 50–100 ms Python interpreter overhead every 10 seconds — L/L effort
- Change `docker-compose.yml:54` from `RUST_LOG: info` to `RUST_LOG: ${RUST_LOG:-info}` — enables runtime log-level override without editing compose file — L/L effort
- Convert `geointellisense-analytics/Dockerfile` to two-stage build, moving `libgdal-dev` to builder stage and installing only `libgdal34` at runtime — reduces final image by ~30–50 MB — M/M effort

### Run #131 — 2026-06-02 — Lens: Docs
**Scope:** Ninth docs pass. Examined: `README.md` (full); `IMPLEMENTATION_STATUS.md` (full); `package.json` (full); `.env.local.example` (full); `docker-compose.yml` (full); `geointellisense-analytics/app/config.py` (full); `geointellisense-analytics/app/source_toggles.py` (full); `geointellisense-analytics/app/main.py` (full); `geointellisense-analytics/app/middleware.py` (full); `geointellisense-analytics/app/ml/aqi_model.py` (partial); `geointellisense-analytics/app/routes/predict.py` (full); `geointellisense-analytics/app/routes/chat.py` (full); `geointellisense-ingestion/src/config.rs` (full); `geointellisense-ingestion/src/broadcast.rs` (full); `services/aiService.ts` (full); `hooks/useLiveData.ts` (full); `hooks/useRealtimeAQI.ts` (full). Cross-checked against Active Recommendations and runs #129–#130 (Latest Findings) plus archived docs runs #11, #26, #41, #56, #71, #86, #101, #116 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `README.md:43,50,63` — The README's "Run Locally" section is completely disconnected from the actual codebase. Line 43 instructs `npm run dev:full` — this script does not exist in `package.json:6-14` (only `dev`, `build`, `preview`, `test*` are defined). Line 50 instructs `npm run server` — also absent from `package.json`. Line 63 states "Backend (Express): Runs on http://localhost:3001" — there is no Express dependency in `package.json`, no `server/index.js`, and no Express server anywhere in the repository. The actual backend is a Rust Axum ingestion service (`geointellisense-ingestion`, port 3001), a Python FastAPI analytics service (`geointellisense-analytics`, port 3002), and a Caddy gateway (`Caddyfile`, port 8080), all coordinated by `docker-compose.yml`. Line 22 says "creating a `.env.local` file," but the Python service reads from `.env` via `config.py:17` (`model_config = {"env_file": ".env", ...}`) and `docker-compose.yml:85-97` expects vars (`ANTHROPIC_API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, etc.) absent from `.env.local.example`. A developer who follows the README instructions verbatim gets a frontend with no working backend — zero data, no AI. PROPOSAL: Rewrite README.md "Run Locally" section to document: (1) copy `.env.local.example` → `.env` and fill in Docker Compose required vars; (2) `docker compose up -d` to start all services; (3) `npm install && npm run dev` for the frontend only; (4) the source-toggle startup step (see Finding #3 below) — H/M effort.

- OBSERVATION: `.env.local.example:1-16` + `docker-compose.yml:8-9,18-19,56-97` — The only env-var example file documents three variables (`ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`). The `docker-compose.yml` references nine additional variables that have **no defaults and no documentation anywhere in the repo**: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (required — without these, the TimescaleDB container starts with empty auth and `DATABASE_URL` in the ingestion service becomes `postgres://:@db:5432/`), `DB_PORT`, `REDIS_PORT`, `INGESTION_PORT`, `ANALYTICS_PORT`, `GATEWAY_PORT`, `ADMIN_TOKEN`. The file is also named `.env.local.example`, which Vite reads but `docker compose` ignores — Docker Compose reads `.env` by default. A developer who copies `.env.local.example` to `.env.local` as the README instructs will have a working Vite dev server but a broken Docker stack. There is no `.env.example` with sensible defaults anywhere. PROPOSAL: Rename `.env.local.example` to `.env.example` (or add a parallel `.env.example`) that documents all 12 variables with safe development defaults (`POSTGRES_USER=geointellisense`, `POSTGRES_PASSWORD=geointellisense_dev`, `POSTGRES_DB=geointellisense`, `DB_PORT=5432`, `REDIS_PORT=6379`, `INGESTION_PORT=3001`, `ANALYTICS_PORT=3002`, `GATEWAY_PORT=8080`, `ADMIN_TOKEN=dev-token`) — L/L effort.

- OBSERVATION: `source_toggles.py:2-10` + `main.py:51-54` + `geointellisense-ingestion/src/broadcast.rs:60-73` — The `source_toggles.py` module docstring describes the admin API correctly but says nothing about the startup contract. When `docker compose up` completes and all health checks pass, **zero live data flows**: every polling loop (`start_water_polling`, `start_fire_polling`, `start_inversion_polling` in `main.py:51-53`; `spawn_ticker`, `spawn_earthquake_poller` in `broadcast.rs:60-73`) checks its Redis toggle before each cycle. Redis initializes empty, so `is_enabled()` at `source_toggles.py:51` returns `False` (key absent → `val == "1"` is `False`) for all sources. The frontend shows 503 "disabled" errors for every data tile. The only path to live data is `POST /api/admin/sources/enable-all` with `x-admin-token` header — a procedure documented only in `source_toggles.py:5-7`, which no developer would read before running the app. Compounding this: Active Rec #3 notes that if Redis is slow or unavailable, the Rust service also defaults all toggles to skip — so the window for silent "no data" is wider than documented. There is no README section, no IMPLEMENTATION_STATUS step, no startup script, and no inline comment in `main.py`'s `lifespan` function that warns of this behavior. PROPOSAL: Add a "First Run" or "Getting Started" section to README.md documenting the `enable-all` step after `docker compose up`; add a one-line comment in `main.py` above the `lifespan` body noting that all data sources default to OFF — L/L effort.

- OBSERVATION: `config.py:4-17` + `middleware.py:88` + `middleware.py:95` — The `Settings` class has 11 fields, none with `Field(description=...)` metadata or a class docstring. All fields have default values (empty string or localhost URLs), so they appear equally optional in code. In practice five fields are feature-gating: `anthropic_api_key` — checked at `middleware.py:88`, blocks all AI routes when absent and returns 503; `admin_token` — checked at `middleware.py:95`, disables all auth enforcement when absent (dev mode); `google_maps_api_key` — required by `routes/maps_config.py` to serve the maps config endpoint; `airnow_api_key` — required by `clients/airnow.py` for any AirNow data; `nasa_firms_key` — required by `routes/fires.py` for NASA FIRMS fire detections. A developer who sets only `ANTHROPIC_API_KEY` in their `.env` gets AI routes active but no fire, AirNow, or maps data — with no error at startup and no documentation of what each key unlocks. The field name → env var mapping (Pydantic-Settings uppercases field names) is also undocumented; a developer unfamiliar with `pydantic-settings` may not know that `anthropic_api_key` maps to `ANTHROPIC_API_KEY`. PROPOSAL: Add a class docstring to `Settings` in `config.py` listing which fields gate which features; wrap the five key fields with `Field(default="", description="...")` to make the feature-to-key mapping machine-readable (e.g. in OpenAPI docs) — L/L effort.

**Proposed actions:**
- Rewrite README.md "Run Locally" section to reflect Docker Compose workflow, remove all Express/`dev:full`/`npm run server` references — H/M effort (fixes onboarding completely)
- Add `.env.example` (or rename `.env.local.example`) with all 12 Docker Compose variables and safe dev defaults — L/L effort (unblocks `docker compose up` for new developers)
- Add "First Run" section to README.md and a one-line comment in `main.py` documenting the source-toggle enable-all step — L/L effort
- Add class docstring + `Field(description=...)` to feature-gating fields in `config.py` — L/L effort

## 📚 Archive (one line per past run)
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
