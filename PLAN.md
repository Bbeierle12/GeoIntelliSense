# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-04T02:20:00Z
Last run: #148 — Lens: LLM integration quality

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
### Run #148 — 2026-06-04 — Lens: LLM integration quality
**Scope:** Tenth LLM integration quality pass. Examined: `geointellisense-analytics/app/claude.py` (full); `geointellisense-analytics/app/routes/chat.py` (full); `geointellisense-analytics/app/routes/deep_analysis.py` (full); `geointellisense-analytics/app/routes/low_latency.py` (full); `geointellisense-analytics/app/routes/grounded_search.py` (full); `geointellisense-analytics/app/routes/grounded_maps.py` (full); `geointellisense-analytics/app/routes/predictive_analysis.py` (full); `geointellisense-analytics/app/routes/weather_forecast.py` (full); `geointellisense-analytics/requirements.txt` (full); `geointellisense-analytics/app/context.py` (lines 1–50). Grep scans for `cache_control`, `ephemeral`, and all model ID strings across the repo. Cross-checked against Active Recommendations and Latest Findings runs #145–#147 plus archived LLM lens runs #13, #28, #43, #58, #73, #88, #103, #118, #133 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `chat.py:66-76`, `grounded_search.py:62-72`, `grounded_maps.py:69-79`, `deep_analysis.py:61-76` — all four tool-use loops share the same message-accumulation bug: on each iteration, they rebuild the `messages` list using only the CURRENT round's `resp.content` and `tool_results`, discarding the exchange from all prior rounds. Tracing `chat.py`: round 1 builds `messages = get_session_history(session_id) + [assistant_round1_content, tool_results_round1]`, submits to Claude, gets `resp_round1`. Round 2 builds `messages = get_session_history(session_id) + [resp_round1.content, tool_results_round2]` — this replaces the round 1 exchange with round 2's and Claude never sees the round 1 tool calls or their results. For `deep_analysis.py`, `grounded_search.py`, and `grounded_maps.py` the same pattern: `messages = [user_prompt, assistant_content, tool_results]` is reset on every iteration from a local `assistant_content = resp.content` assignment, meaning round 2 omits round 1's initial tool-call block and results entirely. The consequence: any request that triggers more than one tool-use round (e.g., Claude queries air quality, gets a result, then decides to also query earthquakes) has an incoherent message thread from round 2 onward. Claude on round 2 sees an assistant turn that references tool-use IDs it never asked for in this context, causing it to re-derive or ignore results. The correct fix is to maintain a single accumulating `messages` list that is extended by two entries on each round rather than reset: `messages += [{"role":"assistant","content":resp.content}, {"role":"user","content":tool_results}]`. PROPOSAL: Fix the accumulation in all four routes so that multi-round tool use correctly preserves the full exchange chain — M/M effort (4 files, ~5 line change each).

- OBSERVATION: `chat.py:44,71`, `grounded_search.py:40,63`, `grounded_maps.py:47,70`, `predictive_analysis.py:92`, `weather_forecast.py:76` — five routes hard-code the model ID `"claude-sonnet-4-20250514"`. This is the Claude 3.7 Sonnet model (a claude-3.x series model released in February 2025), identified by its YYYYMMDD release-date suffix convention. The other two Claude routes in the project have already migrated to the Claude 4 model family: `deep_analysis.py:34,62` uses `"claude-opus-4-6"` and `low_latency.py:32` uses `"claude-haiku-4-5-20251001"`. The project therefore operates in a split-generation state: the two specialty routes use Claude 4 while the five highest-traffic routes (chat, grounded search, grounded maps, predictive analysis, weather forecast) remain on Claude 3.7. The Claude 4 Sonnet model (`claude-sonnet-4-6`) offers improved instruction following and reasoning versus 3.7 Sonnet. Additionally, `requirements.txt:9` pins `anthropic==0.49.*`; the current model IDs for the Claude 4 family are fully supported by this version, so the migration is a string replacement with no dependency changes. PROPOSAL: Replace `"claude-sonnet-4-20250514"` with `"claude-sonnet-4-6"` in all five routes — L/L effort (5 string replacements across 5 files).

- OBSERVATION: `claude.py:74-110` + all 7 Claude API call sites — no route in the analytics application uses Anthropic's prompt caching feature. Every `client.messages.create()` call omits `cache_control` parameters on system message content blocks, meaning the full system prompt (static SJV/chat/forecast/predictive text + the live context block built by `get_system_with_live_context()`) is billed at full input token price on every API call. The in-process 60-second context cache at `claude.py:88-89` reduces DB round-trips but does NOT reduce token billing — the same context string is billed again on every Claude call within the 60-second window. The static portions (e.g., `SJV_SYSTEM` at `claude.py:15-21`, the tool definitions array `TOOLS` at `claude.py:127-214`, and `SEARCH_SUFFIX` at `grounded_search.py:12-16`) never change between calls and are ideal `ephemeral` cache candidates. The cost impact is highest for `deep_analysis.py`: up to 4 Opus 4.6 calls per request (1 initial + 3 tool-use rounds), each re-billing the same `SJV_SYSTEM` + live context + 5 tool definitions (~600–1000 tokens). Using `cache_control: {"type": "ephemeral"}` on the system message would reduce rounds 2–4 to ~10% of normal input price for that prefix. Prompt caching is supported in `anthropic>=0.28` (the project pins `0.49.*`) and requires passing `system` as a list of content blocks with a `cache_control` key rather than a plain string, e.g., `system=[{"type":"text","text":system_text,"cache_control":{"type":"ephemeral"}}]`. PROPOSAL: Refactor `get_system_with_live_context()` to return a structured list rather than a plain string, and update all 7 Claude call sites to use the list form so the system prompt prefix is eligible for caching — M/M effort (1 helper function + 7 call sites).

- OBSERVATION: `predictive_analysis.py:51-58` and `weather_forecast.py:38-45` — both routes construct a Claude prompt by embedding the raw user-supplied string `req.customFactors` inside a markdown code fence: `f"```\n{req.customFactors}\n```\n"`. Markdown code-fence enclosure provides no prompt-injection protection because the fence can be trivially closed by a user who submits `customFactors = "```\nIGNORE ALL PREVIOUS INSTRUCTIONS. ..."`. A malicious caller can therefore inject arbitrary instruction text into Claude's prompt context, redirect the model's behavior, attempt to exfiltrate the system prompt, or produce misleading environmental analysis output. Both endpoints are unauthenticated: `predictive_analysis.py:39-40` and `weather_forecast.py:33` have no `check_ai_auth` or `check_rate_limit` calls (confirmed by source inspection; `check_ai_auth` is present in `chat.py:25`, `deep_analysis.py:20`, `low_latency.py:20`, `grounded_search.py:27`, `grounded_maps.py:27` — but absent on these two routes). The combination of anonymous access + unsanitized user-string injection means the operator's Anthropic API key is exposed to unlimited prompt-injection attacks from any public caller. Minimum mitigation: add `req.customFactors = req.customFactors.replace("```", "")` before interpolation (breaks code-fence escape) and enforce a character limit via Pydantic `Field(max_length=2000)`. Longer-term: the auth gap (Active Rec #9) must also be closed. PROPOSAL: Add `Field(max_length=2000)` to `customFactors` in both Pydantic models; strip triple-backtick sequences from `req.customFactors` before prompt interpolation; add `check_ai_auth` + `check_rate_limit` to both routes — L/L effort.

**Proposed actions:**
- Fix multi-round tool-use message accumulation in `chat.py:66`, `grounded_search.py:62`, `grounded_maps.py:69`, `deep_analysis.py:61` to extend a cumulative `messages` list per round instead of resetting it — M/M effort
- Replace `"claude-sonnet-4-20250514"` with `"claude-sonnet-4-6"` in `chat.py:44,71`, `grounded_search.py:40,63`, `grounded_maps.py:47,70`, `predictive_analysis.py:92`, `weather_forecast.py:76` — L/L effort
- Refactor `get_system_with_live_context()` in `claude.py:78` to return a structured content-block list and enable `cache_control: ephemeral` on the static system prefix across all 7 Claude call sites — M/M effort
- Sanitize `customFactors` in `predictive_analysis.py:52-58` and `weather_forecast.py:39-45`: strip triple-backtick sequences, add Pydantic `Field(max_length=2000)`, add `check_ai_auth`+`check_rate_limit` — L/L effort

### Run #147 — 2026-06-04 — Lens: Deployment / Docker
**Scope:** Tenth deployment/Docker pass. Examined: `geointellisense-analytics/Dockerfile` (full); `geointellisense-ingestion/Dockerfile` (full); `docker-compose.yml` (full); `Caddyfile` (full); `geointellisense-analytics/.dockerignore` (full); `geointellisense-ingestion/.dockerignore` (full); `geointellisense-analytics/requirements.txt` (full); `geointellisense-analytics/app/main.py` (full, lifespan section); `geointellisense-ingestion/Cargo.toml` (full). Cross-checked against Active Recommendations and Latest Findings runs #144–#146 plus archived deployment runs #12, #27, #42, #57, #72, #87, #102, #117, #132 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/Dockerfile:3-5` — the analytics production image installs `libgdal-dev` (the GDAL development package) at runtime: `RUN apt-get update && apt-get install -y --no-install-recommends libgdal-dev`. On `python:3.12-slim` (Debian bookworm), `libgdal-dev` includes C header files, `.a` static libraries, pkg-config files, and GDAL utilities — all of which are needed only at compile time, not at Python runtime. The `rasterio==1.4.*` package in `requirements.txt` ships pre-built binary wheels for linux/amd64 that bundle their own internal GDAL shared library (rasterio adopted the bundled wheel approach to eliminate this exact system dependency). Similarly, `geopandas` depends on `fiona`, which also ships bundled wheels on PyPI. Neither package requires system GDAL at runtime in a standard `pip install` from PyPI on linux/amd64. If system GDAL is genuinely needed (e.g., for a source build on an exotic arch), only the runtime shared library (`libgdal32` on bookworm) is required — `libgdal-dev` is approximately 8–20 MB larger due to its dev artifacts. PROPOSAL: Remove `libgdal-dev` from `Dockerfile:3-5` entirely and rebuild; if the image fails (indicating a wheel that needed system GDAL), replace with `libgdal32` (runtime only). This reduces image size and removes compile-time tooling from production — L/L effort.

- OBSERVATION: `geointellisense-analytics/Dockerfile` (all lines) — there is no `USER` instruction in the analytics Dockerfile. `python:3.12-slim` runs as root by default (UID 0). All Python processes (uvicorn, FastAPI, background polling tasks) execute with UID 0 inside the container. Three writable volume paths (`/app/data/dem`, `/app/data/landsat`, `/app/data/models`) are mounted as named volumes at runtime; files written by the container (DEM tiles, Landsat GeoTIFFs, trained scikit-learn models) are owned by root. An attacker who achieves arbitrary code execution via a malformed rasterio-parsed GeoTIFF, a deserialization flaw in a pickle-loaded model file (`predict.py` uses `joblib.load` on a path derived from a URL-accessible endpoint), or prompt injection → subprocess call, would have full container UID 0 — trivially able to read any mounted file, overwrite model files in the shared `modeldata` volume, or attempt container escape via privileged socket paths. The companion ingestion container (`geointellisense-ingestion/Dockerfile`) also has no `USER` instruction. PROPOSAL: Add to the analytics Dockerfile: `RUN useradd --system --create-home --home-dir /app --no-log-init appuser && chown -R appuser /app` before `COPY . .`, then `USER appuser` before `CMD`; ensure the named volume mounts remain writable by the new UID — L/L effort.

- OBSERVATION: `docker-compose.yml:119-135` — the `gateway` (Caddy) service has no `healthcheck:` block, unlike `db` (line 16-21), `redis` (line 35-40), `ingestion` (line 67-72), and `analytics` (line 109-114), all of which define healthchecks. The `gateway` service depends on `ingestion` and `analytics` being healthy (`condition: service_healthy`), but nothing depends on `gateway` being healthy. If the Caddyfile fails to parse (e.g., a typo after editing) Caddy will log a fatal error and exit — but `restart: unless-stopped` will continuously restart it, cycling between "Up" and "Restarting" states. More critically, if Caddy starts successfully but its reverse_proxy upstreams become unreachable, Caddy stays running and healthy from Docker's perspective while returning 502 to all clients. There is no health probe for the gateway's own `/health` passthrough or `respond ... 200` fallback. Without a healthcheck, `docker compose ps` cannot report gateway status, monitoring tools that poll Docker health state cannot alert on Caddy failure, and compose-level `condition: service_healthy` dependencies (if any future service depends on gateway) cannot use it. PROPOSAL: Add a `healthcheck:` block to the `gateway` service in `docker-compose.yml`: `test: ["CMD-SHELL", "wget -qO- http://localhost:8080/ || exit 1"]`, `interval: 15s`, `timeout: 5s`, `retries: 3`, `start_period: 10s` — this probes Caddy's default `respond "GeoIntelliSense API Gateway" 200` fallback route — L/L effort (5 lines in docker-compose.yml).

- OBSERVATION: `geointellisense-analytics/Dockerfile:16` + `geointellisense-analytics/app/main.py:48-57` — the analytics container CMD is `["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3002"]` with no `--workers` flag. uvicorn defaults to a single worker process. The lifespan function at `main.py:48-57` starts four persistent background tasks on startup: `start_water_polling()`, `start_fire_polling()`, `start_inversion_polling()`, and `start_retrain_scheduler()`. These tasks run indefinitely inside the single uvicorn event loop. If a developer attempts to scale the analytics service by adding `--workers 4` to the CMD (the standard uvicorn scale-out approach), each worker process independently calls the lifespan function, starting four independent copies of each polling task — resulting in 4× the external API calls (to USGS water API, NASA FIRMS fire API, inversion model), 4× the Redis write traffic, and 4 concurrent independent `start_retrain_scheduler()` instances that may trigger simultaneous model retraining and overwrite each other's saved model files in the shared `modeldata` volume. This constraint (single-worker only) is nowhere documented in the Dockerfile, docker-compose.yml, or README. PROPOSAL: Add a comment to `Dockerfile:16` noting the single-worker constraint: `# NOTE: do not add --workers; background polling tasks in lifespan() are not safe for multi-worker deployment`; longer-term, extract the 4 polling tasks into a dedicated container (a second analytics replica using a `COMMAND` override in compose) so the HTTP server can scale independently — L/L effort for the comment, M/H for the architectural separation.

**Proposed actions:**
- Remove `libgdal-dev` from `geointellisense-analytics/Dockerfile:3-5`; replace with `libgdal32` only if a source build is needed — L/L effort
- Add `RUN useradd --system ...` and `USER appuser` to analytics (and ingestion) Dockerfiles so containers do not run as root — L/L effort
- Add a `healthcheck:` block to the `gateway` service in `docker-compose.yml` probing `http://localhost:8080/` — L/L effort
- Add a comment to `Dockerfile:16` warning against `--workers` due to non-re-entrant background polling tasks in `main.py:lifespan()` — L/L effort

### Run #146 — 2026-06-04 — Lens: Docs
**Scope:** Eleventh docs pass. Examined: `README.md` (full); `package.json` (scripts section); `IMPLEMENTATION_STATUS.md` (full); `.env.local.example` (full); `docker-compose.yml` (full); `geointellisense-ingestion/src/config.rs` (full); `geointellisense-analytics/app/context.py` (lines 1–30); `geointellisense-analytics/app/claude.py` (lines 1–30); `geointellisense-analytics/app/routes/chat.py` (imports); `geointellisense-analytics/app/routes/deep_analysis.py` (imports); `geointellisense-analytics/app/routes/grounded_maps.py` (imports); `geointellisense-analytics/app/routes/grounded_search.py` (imports); `geointellisense-analytics/app/routes/low_latency.py` (imports); `geointellisense-analytics/app/routes/predict.py` (lines 1–30); `geointellisense-analytics/app/middleware.py` (lines 1–35); `types.ts` (full); `geointellisense-ingestion/src/routes/mod.rs` (full). Cross-checked against Active Recommendations and Latest Findings runs #144–#145 plus archived docs runs #11, #26, #41, #56, #71, #86, #101, #116, #131 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `README.md` (architecture section, step 3) — the README instructs developers to run `npm run dev:full` ("Run both the backend server and frontend") and `npm run server` ("Backend server"). Neither script exists in `package.json`. The actual scripts defined are: `dev`, `build`, `preview`, `test`, `test:ui`, `test:run`, `test:coverage` (7 entries, verified at `package.json:7-14`). The `concurrently` package is in devDependencies (suggesting `dev:full` was once a real script before the project pivoted to Docker), but the script entry was removed. Any developer following the README's setup instructions will receive `npm error Missing script: "dev:full"` and have no working path to run the project. Additionally, the README's Architecture section says "Backend (Express): Runs on http://localhost:3001" and "Backend (Express): Runs on http://localhost:3001" — the actual backends are Rust Axum (ingestion, port 3001) and Python FastAPI (analytics, port 3002); there is no Express server in the project. `package.json` has no `express` dependency. The README appears to be an AI Studio template stub that was never updated after the real architecture was built. PROPOSAL: Replace the README's "Run Locally" step 3 with the correct Docker-first instructions (`docker compose up -d && npm run dev`); update the Architecture section to list the two real backends with their ports; remove the AI Studio app link if the project is no longer deployed there — M/L effort (README rewrite, ~30 lines).

- OBSERVATION: `geointellisense-ingestion/src/config.rs:24` vs `geointellisense-analytics/app/context.py:22` — these two files define the same logical constant (PurpleAir polling interval) independently with conflicting values: `config.rs:24` sets the default `PURPLEAIR_INTERVAL_SECS = 600` (10 minutes), while `context.py:22` sets `SOURCE_INTERVALS["purpleair"] = 120` (2 minutes). The staleness threshold in `context.py:_freshness()` is `2 × interval = 2 × 120 = 240 seconds`. Because the Rust service polls PurpleAir every 600 seconds by default, every PurpleAir reading will always be ≥ 600 seconds old when sampled by the Python staleness check — well above the 240-second stale threshold. Consequence: Claude's system prompt (built by `build_context_text()`) always shows PurpleAir as a "STALE" data source under the default configuration, even immediately after a fresh poll completes. The operator sees "STALE data sources: purpleair" in every Claude context, creating a false sense that data collection is broken when it is actually working correctly within its configured interval. Neither `config.rs` nor `context.py` contains a comment linking these two values or explaining that `SOURCE_INTERVALS["purpleair"]` must be kept ≤ half the Rust polling interval to avoid perpetual false-stale state. PROPOSAL: Update `context.py:22` to `"purpleair": 600` to match the actual default poll interval (or add a `# must match PURPLEAIR_INTERVAL_SECS in ingestion config.rs` comment if the 120s value reflects an aspirational target); add a symmetric `# staleness threshold is 2× this (see context.py SOURCE_INTERVALS)` comment to `config.rs:24` — L/L effort (one line change + one comment each).

- OBSERVATION: `docker-compose.yml` (lines 5, 14, 19, 30, 50, 60, 73, 99, 124) — the compose file requires the following env vars from a `.env` file: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_PORT`, `REDIS_PORT`, `INGESTION_PORT`, `ANALYTICS_PORT`, `GATEWAY_PORT`, `ADMIN_TOKEN`, `ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `PURPLEAIR_INTERVAL_SECS`, `BROADCAST_INTERVAL_SECS`. The only env example file in the repo is `.env.local.example`, which covers only five variables (`ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`) — all frontend-oriented. There is no `.env.docker.example` documenting the database credentials, port mappings, or service-level variables. `docker compose up` without a `.env` in the repo root will either fail with variable substitution errors (for required vars like `POSTGRES_USER`) or use Docker Compose's empty-string defaults for optional vars, which breaks the database connection string (resulting in `postgres://:@db:5432/`). IMPLEMENTATION_STATUS.md's "Development Mode" section shows only `ANTHROPIC_API_KEY` and `GOOGLE_MAPS_API_KEY`. PROPOSAL: Add a `.env.docker.example` at the repo root documenting all 13 required docker-compose vars with safe default values (e.g., `POSTGRES_USER=geointellisense`, `DB_PORT=5432`) and reference it from README.md step 2 — L/L effort (new 15-line file + 2 README lines).

- OBSERVATION: `geointellisense-analytics/app/claude.py:10-18` — `CHAT_SYSTEM` and `SJV_SYSTEM` are defined as bare string literals with no docstrings or comments. `CHAT_SYSTEM` is a 6-word minimalist prompt ("expert geospatial and environmental analyst... San Joaquin Valley") used only in `chat.py:39`. `SJV_SYSTEM` is a 50-word detailed prompt naming all 6 SJV counties, listing domain specializations, and requiring markdown output — used in `deep_analysis.py:30`, `grounded_maps.py:43`, `grounded_search.py:36`, and `low_latency.py:30`. The two prompts differ meaningfully: `SJV_SYSTEM` is county-specific and model-intensive; `CHAT_SYSTEM` is generic and concise. There is no comment explaining the intended scope of each. A developer adding a new AI route must read all 5 existing route imports to discover the pattern. Additionally, `low_latency.py:30` uses `SJV_SYSTEM` with Haiku (`claude-haiku-4-5-20251001`) — the most token-expensive system prompt with the cheapest model, which is the opposite of the intended relationship (lightweight prompts with lightweight models). The absence of documentation allows this mismatch to accumulate silently. PROPOSAL: Add one-line comments above each constant at `claude.py:9` and `claude.py:17`: `# Used by /api/chat — concise, general-purpose` and `# Used by deep-analysis, grounded, and low-latency routes — county-specific, markdown output`; separately note in a comment above `SJV_SYSTEM` that it is too verbose for Haiku and a trimmed variant should be used for `low_latency.py` — L/L effort (3 comment lines).

**Proposed actions:**
- Rewrite `README.md` setup section: replace non-existent `npm run dev:full`/`npm run server` commands with `docker compose up -d && npm run dev`; update Architecture section to list Rust Axum + Python FastAPI instead of Express — M/L effort
- Update `context.py:22` `SOURCE_INTERVALS["purpleair"]` from `120` to `600` (or add a cross-reference comment) to eliminate perpetual false-stale PurpleAir in Claude system prompts — L/L effort
- Add `.env.docker.example` at repo root documenting all 13 docker-compose vars; reference it from README step 2 — L/L effort
- Add one-line scope comments above `CHAT_SYSTEM` and `SJV_SYSTEM` in `claude.py:9,17`; note `SJV_SYSTEM` is too verbose for Haiku routes — L/L effort

## 📚 Archive (one line per past run)
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
