# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-09T02:15:00Z
Last run: #221 — Lens: Docs

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
| 10 | `historical_weather.py:98` hardcodes `"totalPrecipitation": 0.0` as placeholder — live API always returns zero while TS fallback (`dataService.ts:383`) returns non-zero mock precipitation, silently diverging and making precipitation charts show all-zero data in production | TS↔Python/Data | H | L | 216 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #221 — 2026-06-09 — Lens: Docs
**Scope:** Seventeenth docs pass. Full reads of: `README.md`, `IMPLEMENTATION_STATUS.md`, `.env.local.example`, `package.json`, `geointellisense-analytics/app/config.py`, `geointellisense-ingestion/src/config.rs`, `geointellisense-analytics/app/routes/low_latency.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/ai_context.py`, `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/middleware.py`, `geointellisense-analytics/app/source_toggles.py`, `geointellisense-analytics/app/cache.py`. Cross-checked against Active Recommendations and archived docs runs #11, 26, 41, 56, 71, 86, 101, 116, 131, 146, 161, 176, 191, 206 to confirm findings are new.

**Findings:**

- OBSERVATION: `README.md:43,50,54` — The "Run Locally" section instructs developers to run `npm run dev:full` (line 43) and `npm run server` (line 50). Neither script exists in `package.json:6-10`; the only scripts defined are `dev`, `build`, `preview`, `test`, `test:ui`, `test:run`, and `test:coverage`. Any developer following the README literally will immediately fail with "npm error Missing script: dev:full" and "npm error Missing script: server". The README was written for an earlier single-process Express architecture; those scripts were removed when the stack was refactored to Rust + FastAPI but the README was not updated. Furthermore, `README.md:13` states the only prerequisite is "Node.js" — neither Docker, Python 3.11+, nor Rust/Cargo is mentioned, despite the app requiring a running Rust ingestion service (port 3001) and Python analytics service (port 3002) to function. Running `npm run dev` alone starts only the Vite frontend; all backend API calls return network errors and the app silently falls back to mock data with no error message to the user. PROPOSAL: Replace `npm run dev:full` with `docker compose up -d && npm run dev` in `README.md:43`; remove the `npm run server` example; add Docker as a prerequisite — L/L effort (~5 lines; unblocks the only working local-dev path documented in the repository).

- OBSERVATION: `README.md:63-66` — The Architecture section reads: "**Frontend** (Vite + React): Runs on `http://localhost:5174` / **Backend** (Express): Runs on `http://localhost:3001`". There is no Express backend anywhere in the codebase: no `server/` directory, no `express` dependency in `package.json`, no `server/index.js`. The actual backend is two separate services — Rust Axum (ingestion, port 3001) and Python FastAPI (analytics, port 3002). A developer reading this section would approach debugging with the wrong mental model (looking for an Express config, Node.js process management, etc.). The line "API keys are stored securely in `.env.local` and only accessed by the backend server" is also wrong: the Python service reads `.env` (not `.env.local`) and the Rust service reads OS environment variables, not any `.env*` file by default unless `dotenvy` finds one. PROPOSAL: Rewrite `README.md:59-66` to describe the actual three-service architecture (Vite frontend, Rust ingestion, FastAPI analytics) with correct ports and env file locations — L/L effort (~8 lines; corrects fundamental architecture misrepresentation that will mislead every new contributor).

- OBSERVATION: `.env.local.example:1-17` — The example file lists 5 environment variables, but `geointellisense-analytics/app/config.py:5-16` reads 11 settings and `geointellisense-ingestion/src/config.rs:17-39` reads 8 fields. Missing from the example: `EPA_AQS_EMAIL` and `EPA_AQS_KEY` (requires registering a validated email with the EPA AQS data mart — not just any email; unregistered keys return empty CSV silently), `AIRNOW_API_KEY` (free registration at airnow.gov/api), `NOAA_CDO_TOKEN` (1000-request/day rate limit, free at ncdc.noaa.gov), `NASA_FIRMS_KEY` (requires NASA EOSDIS account, institutional email preferred), `CENSUS_API_KEY` (free at api.census.gov/data/key_signup.html), `ADMIN_TOKEN` (omitting this causes the CORS `allow_credentials=True` + `allow_origins=["*"]` startup crash described in Security Active Recommendation context), `DATABASE_URL`, and `REDIS_URL` (needed when running outside Docker). Additionally, `RUST_SERVICE_URL` and `PYTHON_SERVICE_URL` (lines 15-16) do not appear in either `config.py` or `config.rs` — they are leftover from an earlier frontend-only architecture and silently ignored by both backends. PROPOSAL: Add the 8 missing variables with registration URLs and rate-limit notes; remove the two phantom variables; mark required vs optional — L/L effort (~15 lines; prevents silent empty-data failures for 6 data sources and the documented ADMIN_TOKEN CORS crash).

- OBSERVATION: `geointellisense-analytics/app/routes/low_latency.py`, `grounded_search.py`, and `ai_context.py` — all three AI route modules have no module-level docstring. The design tradeoffs embedded in these files are invisible without reading them in full: (1) `low_latency.py:31` uses `claude-haiku-4-5-20251001` with `max_tokens=1024` and no session history — the fastest/cheapest path — but nowhere does a comment explain why this model was chosen over the chat model or what "low latency" means in this context; (2) `grounded_search.py:49` caps tool-use rounds at 5 (`while resp.stop_reason == "tool_use" and rounds < 5`) with no comment explaining the cap (preventing runaway agentic loops on adversarial prompts); (3) `ai_context.py:13` exposes the full assembled Claude system prompt at `GET /api/ai/context` with no authentication — a deliberate debugging decision with no rationale recorded in the file, leaving future developers uncertain whether auth was forgotten or intentionally omitted. PROPOSAL: Add a 2-4 line module docstring to each file stating: the model used and why, the auth policy and rationale, and any loop/token caps with their intent — L/L effort (~12 lines total across 3 files; records design decisions that would otherwise require git archaeology to recover).

**Proposed actions:**
- Replace non-existent `npm run dev:full` / `npm run server` with `docker compose up -d && npm run dev` in `README.md:43-54`; add Docker to prerequisites — L/L effort (~5 lines; unblocks local dev path for new contributors)
- Rewrite `README.md:59-66` Architecture section: replace "Express" with Rust Axum + FastAPI, fix ports, fix env file references — L/L effort (~8 lines; corrects fundamental mental model error)
- Add 8 missing env vars to `.env.local.example` with registration URLs and rate-limit notes; remove 2 phantom vars — L/L effort (~15 lines; prevents silent empty-data failures and CORS crash)
- Add 2-4 line module docstrings to `low_latency.py`, `grounded_search.py`, `ai_context.py` documenting model, auth policy, and design caps — L/L effort (~12 lines; records undocumented design decisions)

### Run #220 — 2026-06-09 — Lens: Observability
**Scope:** Sixteenth observability pass. Full reads of: `geointellisense-analytics/app/main.py`, `geointellisense-analytics/app/database.py`, `geointellisense-analytics/app/cache.py`, `geointellisense-analytics/app/routes/health.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/routes/fires.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/routes/inversion.py`, `geointellisense-analytics/app/routes/admin.py`, `geointellisense-analytics/app/ml/aqi_model.py`, `geointellisense-ingestion/src/routes/health.rs`, `geointellisense-ingestion/src/main.rs`, `geointellisense-ingestion/src/broadcast.rs`, `docker-compose.yml`. Cross-checked against Active Recommendations and archived observability runs #10, 25, 40, 55, 70, 85, 100, 115, 130, 145, 160, 175, 190, 205 to confirm findings are new.

**Findings:**

- OBSERVATION: `predict.py:93`, `predict.py:192`, `fires.py:135` — Three route handlers use `traceback.print_exc()` (imported at `predict.py:3` and `fires.py:3`) instead of `logger.exception(...)`. `traceback.print_exc()` writes directly to `sys.stderr` outside the Python `logging` framework, which means: (1) these tracebacks are invisible to any log aggregator that captures Python `logging` output (e.g., uvicorn's log config, Sentry's logging integration); (2) the tracebacks appear on raw stderr uncorrelated with the request ID or any structured fields. By contrast, `fires.py:67` (poll loop) and `inversion.py:61` correctly use `logger.error(...)` without `traceback.print_exc()`. PROPOSAL: Replace `traceback.print_exc()` with `logger.exception("Prediction failed")` at `predict.py:93`, `logger.exception("Training failed")` at `predict.py:192`, and `logger.exception("FIRMS request failed")` at `fires.py:135` — L/L effort (3 lines; routes all tracebacks through the logging system; `logger.exception()` automatically includes the full traceback).

- OBSERVATION: `database.py:8-11` — `get_pool()` calls `asyncpg.create_pool(settings.database_url, min_size=2, max_size=10)` with no logging on success or failure. There is no visibility into DB pool health: when all 10 connections are in use, new `await pool.acquire()` calls block silently for up to 10 s (asyncpg's default `command_timeout`) and then raise `asyncpg.exceptions.TooManyConnectionsError` — no warning is logged before this. There is no metric for waiting acquires or pool utilization. `close_pool()` at lines 15–19 also has no logging. If `create_pool()` raises at startup (wrong `DATABASE_URL`, DB unreachable), the exception propagates to `lifespan()` (`main.py:49`) and then to uvicorn with no structured log entry recording the cause before the process exits. By contrast, the Rust service logs `tracing::info!("Connected to database")` at `main.rs:31`. PROPOSAL: (a) Add `logger.info("DB pool created (min=2 max=10)")` after `create_pool()` at `database.py:11`; (b) wrap `create_pool()` in `try/except` with `logger.critical("DB pool creation failed: %s", e)` before re-raising — L/L effort (~4 lines; closes complete blind spot on DB pool health at startup and matches Rust-side observability).

- OBSERVATION: `routes/health.py:6-12` (Python) and `routes/health.rs:11-17` (Rust) — Both health endpoints return static `{"status": "ok"}` without probing any dependency. The Python health check does not test the asyncpg pool or Redis client; the Rust health check does not probe the sqlx `PgPool` or Redis connection (both available in `AppState`). The `docker-compose.yml` uses both for `healthcheck:` — analytics at line 110 (`urllib.request.urlopen('http://localhost:3002/api/health')`), ingestion at line 68 (`curl -sf http://localhost:3001/health`). The `gateway` service declares `depends_on: analytics: condition: service_healthy` and `depends_on: ingestion: condition: service_healthy` (lines 128–131). If DB or Redis fails AFTER startup (OOM kill, network partition), the health checks continue to return 200 OK, the gateway routes traffic, and client requests receive 500/503 errors from internal handlers — with no health-signal to trigger container restart (the mechanism `restart: unless-stopped` + healthcheck failure would use). PROPOSAL: In Python `routes/health.py`, add `await pool.execute("SELECT 1")` and `await r.ping()` with a 1-second timeout; return `{"status": "degraded", "detail": "db_unreachable"}` with status 503 on failure — L/M effort (~15 lines; turns liveness probes into readiness probes and enables container restart on DB/Redis failure).

- OBSERVATION: `predict.py:27-32`, `fires.py:30-38`, `water.py:23-29`, `inversion.py:25-31` — All four background poll-loop starters use `except Exception` inside their `while True:` loops, but since Python 3.8 `asyncio.CancelledError` is a subclass of `BaseException` (not `Exception`) and therefore bypasses these handlers. If any poll task is cancelled — by uvicorn's SIGTERM handling, an explicit `task.cancel()`, or an event-loop shutdown — `CancelledError` propagates out of the `while True:`, terminating the background task permanently. None of the starters (`start_fire_polling()`, `start_water_polling()`, `start_inversion_polling()`, `start_retrain_scheduler()`) are called again after startup; none of the route handlers check whether the poll task is alive. The `/api/health` endpoint never checks `_poll_task.done()` or `_retrain_task.done()`. A dead background task produces no log at WARNING+ level and no health signal — stale cache is silently served as if fresh until the cache TTL expires, at which point API calls fail with 503. PROPOSAL: (a) In each `_poll_loop()`, add a `try/except BaseException: logger.warning("Poll task exiting: %s", type(e).__name__); raise` wrapper around `CancelledError` to surface task death in logs; (b) add `poll_tasks_alive: {source: not task.done() if task else False for ...}` to the Python health response — L/M effort (~10 lines total; makes dead poll tasks visible in both logs and the health endpoint).

**Proposed actions:**
- Replace `traceback.print_exc()` with `logger.exception(...)` at `predict.py:93`, `predict.py:192`, `fires.py:135` — L/L effort (3 lines; routes tracebacks through logging system)
- Add startup logging and `try/except` around `asyncpg.create_pool()` in `database.py:8-11` — L/L effort (~4 lines; closes blind spot on DB pool health at startup)
- Add DB + Redis dependency probes to Python `routes/health.py` (and optionally Rust `routes/health.rs`) — L/M effort (~15 lines; enables container restart on silent dependency failure)
- Wrap poll loops in `except BaseException` and add task-liveness checks to health endpoint — L/M effort (~10 lines; makes dead poll tasks observable in logs and health)

### Run #219 — 2026-06-09 — Lens: Security
**Scope:** Fifteenth security pass. Full reads of: `geointellisense-analytics/app/main.py`, `geointellisense-analytics/app/middleware.py`, `geointellisense-analytics/app/config.py`, `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/routes/admin.py`, `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/deep_analysis.py`, `geointellisense-analytics/app/routes/low_latency.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/routes/maps_config.py`, `geointellisense-analytics/app/routes/epa_aqi.py`, `geointellisense-analytics/app/routes/demographics.py`, `geointellisense-analytics/requirements.txt`. Cross-checked against Active Recommendations and archived security runs #9, 24, 39, 54, 69, 84, 99, 114, 129, 144, 159, 174, 189, 204 to confirm findings are new.

**Findings:**

- OBSERVATION: `main.py:69-78` — The CORS middleware is configured with a hard incompatibility: when `settings.admin_token` is falsy (the "dev mode" path at line 69), `_allowed_origins` is set to `["*"]` (wildcard). However, `CORSMiddleware` is always instantiated at line 72 with `allow_credentials=True` (line 77). Starlette 0.20+ (FastAPI 0.115.x uses Starlette ~0.41.x) raises `ValueError: Cannot use allow_credentials=True with allow_origins=['*']` at application startup — this is a hard startup crash, not a runtime error. The comment at line 68 reads "Allow all origins only if no admin token is set (dev mode)"; the intent is correct but the implementation is broken: in dev mode (no `ADMIN_TOKEN`), the app cannot start at all. Additionally, the combination `allow_origins=["*"]` + `allow_credentials=True` is forbidden by the Fetch specification regardless of framework enforcement: browsers silently refuse cross-origin credentialed responses when `Access-Control-Allow-Origin: *` is set. PROPOSAL: Make `allow_credentials` conditional — only pass `allow_credentials=True` when using an explicit origin list, otherwise `allow_credentials=False` when `_allowed_origins == ["*"]` (~3 lines; unblocks dev-mode startup and matches browser CORS semantics). Alternatively, remove the wildcard branch entirely and add `"http://127.0.0.1:5173"` to the explicit list.

- OBSERVATION: `chat.py:95-102` — The `/api/chat/reset` endpoint has no authentication check. The handler body is: `body = await request.json(); session_id = body.get("session_id", ""); if session_id: reset_session(session_id)`. Any caller knowing a session ID can silently clear any active chat session. Session IDs are UUID4 (generated at `claude.py:35`), so brute-force enumeration is infeasible. However, session IDs ARE returned to clients in clear text in every `/api/chat` response (`{"text": ..., "sessionId": session_id}` at `chat.py:86`). A network-level attacker (the Python backend at `docker-compose.yml` exposes port 3002 directly, bypassing TLS termination at Caddy) or an XSS victim can capture the session ID and use it to disrupt an active conversation. By contrast, the `/api/chat` endpoint itself correctly calls `check_ai_auth(request)` at line 25. PROPOSAL: Add `auth_err = check_ai_auth(request)` + early return to `/api/chat/reset` — L/L effort (~3 lines; closes the session-reset DoS surface consistent with how `/api/chat` itself is protected).

- OBSERVATION: `demographics.py:149` and `epa_aqi.py:77` — `/api/demographics/backfill` (`demographics.py:149`) and `/api/epa-aqs/backfill` (`epa_aqi.py:77`) are both unauthenticated POST endpoints that trigger large-scale batch API calls to external government services (US Census API and EPA AQS API respectively) and write directly to the PostgreSQL `demographics` and `epa_daily_summaries` tables. Neither endpoint calls `check_ai_auth(request)` or any equivalent guard. A public caller can repeatedly trigger these operations, exhausting Census API quotas (500 calls/day unauthenticated, 5000/day with a key) and the EPA AQS per-IP throttle, while also writing arbitrary-year data into the database. By contrast, the admin cache-flush and source-toggle endpoints in `admin.py:19-91` correctly gate on `x-admin-token`, and the ML train endpoint in `predict.py` is similarly gated. PROPOSAL: Add `check_ai_auth(request)` guards to both backfill endpoints (requires adding `request: Request` parameter to each function signature) — L/L effort (~6 lines total; consistent with admin/train endpoint protection and prevents unauthenticated API credit burn and DB writes).

- OBSERVATION: `predictive_analysis.py:30-36,51-58` — `PredictiveAnalysisRequest` declares `customFactors: str`, `locationName: str`, `startDate: str`, and `endDate: str` with no Pydantic `max_length` constraints. The value of `customFactors` is interpolated directly into a Claude prompt at lines 55-58: `f"{req.customFactors}\n"`. Two compounded effects: (1) Token burn — each byte of `customFactors` contributes to the input token count sent to `claude-sonnet-4-20250514` with `max_tokens=4096`; because the endpoint is already unprotected (Active Recommendation #4), an attacker can submit multi-megabyte payloads in rapid succession; (2) Prompt injection — `customFactors` is placed inside a triple-backtick code block in the prompt, but code fencing does not prevent instruction injection in practice; an adversary embedding `\n` followed by "Ignore the above instructions…" inside `customFactors` can redirect the model's response. `locationName`, `startDate`, and `endDate` are also injected directly at lines 66-67 with no sanitization or length limits. PROPOSAL: Add `max_length=2000` to `customFactors` and `max_length=200` to `locationName`, `startDate`, `endDate` via Pydantic `Field(max_length=...)` — L/L effort (~4 lines; limits per-request token burn and reduces the prompt injection attack surface).

**Proposed actions:**
- Fix CORS startup crash: make `allow_credentials` conditional on using an explicit origin list in `main.py:72-78` — L/L effort (~3 lines; unblocks dev-mode startup, corrects browser CORS semantics)
- Add `check_ai_auth(request)` to `/api/chat/reset` at `chat.py:95` — L/L effort (~3 lines; closes session-reset DoS surface)
- Add `check_ai_auth(request)` guards to `/api/demographics/backfill` at `demographics.py:149` and `/api/epa-aqs/backfill` at `epa_aqi.py:77` — L/L effort (~6 lines; prevents unauthenticated API credit burn and DB writes)
- Add `max_length` Pydantic constraints to all string fields in `PredictiveAnalysisRequest` at `predictive_analysis.py:30-36` — L/L effort (~4 lines; limits token burn and reduces prompt injection surface)

## 📚 Archive (one line per past run)
- Run #218 (2026-06-08) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #217 (2026-06-08) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #216 (2026-06-08) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #215 (2026-06-08) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #214 (2026-06-08) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #213 (2026-06-08) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #212 (2026-06-08) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #211 (2026-06-08) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #210 (2026-06-08) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #209 (2026-06-08) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #208 (2026-06-08) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #207 (2026-06-08) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #206 (2026-06-08) — Lens: Docs — 4 findings — 0 promoted to Active
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
- Run #209: lens 14 (Competitive scan) — findings added
- Run #210: lens 15 (Live-time claim audit) — findings added
- Run #211: lens 1 (Type safety) — findings added
- Run #212: lens 2 (Module boundaries) — findings added
- Run #213: lens 3 (Dependency health) — findings added
- Run #214: lens 4 (Perf hot paths) — findings added
- Run #215: lens 5 (Test coverage gaps) — findings added
- Run #216: lens 6 (TS ↔ Python contract) — findings added
- Run #217: lens 7 (UX / UI flaws) — findings added
- Run #218: lens 8 (Data pipeline integrity) — findings added
- Run #219: lens 9 (Security) — findings added
- Run #220: lens 10 (Observability) — findings added
- Run #221: lens 11 (Docs) — findings added
