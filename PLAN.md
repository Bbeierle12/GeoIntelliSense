# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-06T00:15:00Z
Last run: #176 — Lens: Docs

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
### Run #176 — 2026-06-06 — Lens: Docs
**Scope:** Twelfth Docs pass. Files examined in full: `README.md`; `IMPLEMENTATION_STATUS.md`; `.env.local.example`; `docker-compose.yml`; `geointellisense-analytics/app/config.py`; `geointellisense-analytics/app/context.py`; `geointellisense-analytics/app/source_toggles.py`; `geointellisense-analytics/app/routes/deep_analysis.py`; `geointellisense-analytics/app/routes/low_latency.py`; `geointellisense-analytics/app/routes/predictive_analysis.py`; `geointellisense-analytics/app/routes/grounded_search.py`; `geointellisense-analytics/app/routes/ai_context.py`; `geointellisense-ingestion/src/config.rs`; `geointellisense-ingestion/src/main.rs`; `Caddyfile`. Cross-checked against Active Recommendations and archived Docs runs #11, #26, #41, #56, #71, #86, #101, #116, #131, #146, #161 to confirm findings are new.

**Findings:**

- OBSERVATION: `.env.local.example:1-17` and `docker-compose.yml:8-11,29-31,61,98-99,109` — The example env file enumerates only 5 variables: `ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`. The `docker-compose.yml` references at least 8 additional variables with no hard-coded defaults that are required for `docker compose up` to succeed: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (lines 8-10, no defaults — Docker Compose interpolation will emit empty strings causing PostgreSQL startup failure), `DB_PORT`, `REDIS_PORT`, `INGESTION_PORT`, `ANALYTICS_PORT`, `GATEWAY_PORT` (lines 11,31,61,99,109 — without these, port-mapping lines fail silently with port 0 bindings or Compose parse errors depending on version). A developer cloning the repo and running `docker compose up -d` following `IMPLEMENTATION_STATUS.md:47-59` would get immediate container startup failures with no guidance. The analytics service also needs `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, `EPA_AQS_EMAIL`, `EPA_AQS_KEY`, `CENSUS_API_KEY`, `ADMIN_TOKEN` (compose lines 86-97) — these have `:-` empty defaults so they are technically optional at startup, but their absence silently disables whole data domains with no operator warning. PROPOSAL: Expand `.env.local.example` with all variables from `docker-compose.yml`, grouped by service, annotated with required vs. optional status and sensible development defaults (e.g., `POSTGRES_USER=geointellisense`, `DB_PORT=5432`, `GATEWAY_PORT=8080`); add acquisition URL comments for `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, `EPA_AQS_EMAIL`/`EPA_AQS_KEY`, `CENSUS_API_KEY` — L/L effort (one file edit; eliminates silent failure for new developers running the Docker stack).

- OBSERVATION: `README.md:1-10,57,62-66` — The README is the boilerplate AI Studio template: the `<img>` banner at line 2 links to `github.com/user-attachments`, the heading is "Run and deploy your AI Studio app", line 9 links to `https://ai.studio/apps/drive/1TSTROmMZDi_NK0VF4oiiW_i2TPkn1j5C`, prerequisites list only "Node.js", and step 3 says `npm run dev:full` with step 4 "Open your browser to `http://localhost:5174`". The "Architecture" section (lines 62-66) describes "Backend (Express): Runs on http://localhost:3001" and says "API keys are stored securely in `.env.local` and only accessed by the backend server." The actual running system is a 5-service Docker stack: Caddy API gateway on `${GATEWAY_PORT}` (Caddyfile:1 — `:8080`), Rust/Axum ingestion on 3001, Python/FastAPI analytics on 3002, TimescaleDB on `${DB_PORT}`, Redis on `${REDIS_PORT}`. The Express backend (`server/index.js`) referenced in the README no longer exists as the primary backend. A developer following the README will install Node packages, run `npm run dev:full` (which starts only the Vite frontend), get no data from any backend endpoints, and be unable to discover they need `docker compose up` first. PROPOSAL: Replace README with a project-accurate document covering: actual service topology (Caddy→Rust ingestion, Caddy→Python analytics), Docker-first quickstart (`cp .env.local.example .env && docker compose up -d && npm run dev`), port map (gateway:8080, ingestion:3001, analytics:3002, frontend:5174), API key prerequisites section with acquisition links for all 9 credential types — M/L effort (write once; eliminates the single largest onboarding barrier).

- OBSERVATION: `geointellisense-analytics/app/config.py:7-15` — The `Settings` class declares 8 API credential fields — `epa_aqs_email`, `epa_aqs_key`, `airnow_api_key`, `noaa_cdo_token`, `nasa_firms_key`, `census_api_key`, `admin_token`, `anthropic_api_key` — all with empty-string defaults and zero docstrings or inline comments. This contrasts with `.env.local.example` which provides acquisition URLs for `ANTHROPIC_API_KEY` and `GOOGLE_MAPS_API_KEY`. Of the undocumented credentials: EPA AQS uses an unusual email+key pair scheme (register at `aqs.epa.gov/data/api/signup`) with no traditional token; NOAA CDO requires a free token from `ncdc.noaa.gov/cdo-web/token` with a per-request rate limit of 5/second; NASA FIRMS requires a separate MAP_KEY from `firms.modaps.eosdis.nasa.gov/api/area/` distinct from the standard EOSDIS login; Census API key is obtained from `api.census.gov/data/key_signup.html`. Without this documentation, a developer enabling data sources via `POST /api/admin/sources/{source}/enable` has no in-code guidance on which env var to set or how to obtain it. PROPOSAL: Add a module-level docstring to `config.py` listing each API credential field with its signup URL and any quota constraints; match the documentation style used in `.env.local.example` for `ANTHROPIC_API_KEY` and `GOOGLE_MAPS_API_KEY` — L/L effort (docstring only; eliminates undiscoverable credential setup for 4 non-obvious APIs).

- OBSERVATION: `IMPLEMENTATION_STATUS.md:77-106` and `IMPLEMENTATION_STATUS.md:139-143` — The "Performance Note" block (lines 139-143) states: "The build shows a warning about chunk size (696KB). This will be addressed in Phase 3 when we: Implement code splitting with React.lazy(), Optimize bundle with dynamic imports, Add route-based code splitting." However, lines 77-106 mark Phase 3 as `✅ COMPLETED`, and Phase 3's completion items (Modularize Dashboard, Normalize Data Layer) make no mention of code splitting or bundle optimization. The Performance Note is a forward-looking commitment that was never crossed off, creating a false checkpoint: Phase 3 is marked done but one of its stated deliverables was not addressed. Compound to this, `IMPLEMENTATION_STATUS.md` makes no reference to any of the Phase 4+ work that has since been completed: Rust/Axum ingestion service, Python/FastAPI analytics service, TimescaleDB time-series, Redis caching, Caddy gateway, ML model, satellite imagery (Landsat/Sentinel), CalGEM, CalEnviroScreen, demographics, water quality, or the 50+ API routes now in production. The document's "Current Architecture" diagram (lines 147-153) shows Rust Ingestion and Python Analytics in the diagram but these services are never described in any phase. PROPOSAL: Add Phase 4+ sections to `IMPLEMENTATION_STATUS.md` documenting the backend services that are in production; strike through the Performance Note or move it to an open issue, referencing the bundle warning as still-open; ensures the document reflects actual project state rather than a 3-phase plan that stopped updating at the React refactor — L/L effort (document update only; prevents the false-completion signal for developers reading project status).

**Proposed actions:**
- Expand `.env.local.example` with all `docker-compose.yml` variables including required DB/port vars and optional credential vars with acquisition URL comments — L/L effort (eliminates Docker stack startup failures for new developers)
- Replace `README.md` with project-accurate quickstart covering Docker-first workflow, actual service topology, and port map — M/L effort (removes the #1 onboarding barrier: generic AI Studio template)
- Add module-level docstring to `config.py` documenting each credential field with signup URL and quota constraints — L/L effort (closes undiscoverable credential setup for EPA AQS, NOAA CDO, NASA FIRMS, Census)
- Update `IMPLEMENTATION_STATUS.md`: mark Performance Note as open, add Phase 4+ sections for the backend services already in production — L/L effort (corrects false-completion signal and missing architecture phases)

### Run #175 — 2026-06-05 — Lens: Observability
**Scope:** Twelfth Observability pass. Files examined in full: `geointellisense-analytics/app/routes/health.py`; `geointellisense-analytics/app/routes/chat.py`; `geointellisense-analytics/app/routes/predict.py`; `geointellisense-analytics/app/http_client.py`; `geointellisense-analytics/app/main.py`; `geointellisense-analytics/app/ml/aqi_model.py`; `geointellisense-analytics/Dockerfile`; `docker-compose.yml`; `utils/errorHandling.ts`; `components/ErrorBoundary.tsx`; `geointellisense-ingestion/src/main.rs`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/db/persist.rs`. Cross-checked against Active Recommendations and archived Observability runs #10, #25, #40, #55, #70, #85, #100, #115, #130, #145, #160 to confirm findings are new.

**Findings:**

- OBSERVATION: `routes/chat.py:88`, `routes/predict.py:93`, `routes/predict.py:191` — All three exception handlers call `traceback.print_exc()` instead of `logger.exception()`. `traceback.print_exc()` writes the full stack trace directly to `sys.stderr`, bypassing Python's `logging` module entirely. The analytics `Dockerfile:16` runs `uvicorn app.main:app` with no `--log-config` argument, so uvicorn configures the root logger and emits structured log records to stdout. `traceback.print_exc()` output goes to stderr as an unstructured text blob — invisible to log aggregators (ELK, CloudWatch, Datadog) that consume stdout only. Additionally, these stderr traces carry no request correlation context (session_id, route, timestamp) that the logging framework attaches automatically. `predict.py:191` in `_run_training` is especially critical: a training failure calls `traceback.print_exc()` then sets `_train_status["state"] = "failed"` — no ERROR-level line is emitted to the log stream, making it impossible to alert on failed model retraining. PROPOSAL: Replace `traceback.print_exc()` at `chat.py:88` with `logger.exception("Chat handler error")`; replace `predict.py:93` with `logger.exception("AQI prediction failed")`; replace `predict.py:191` with `logger.exception("AQI model training failed")` — Python's `logger.exception()` automatically appends the current traceback to the ERROR-level log record — L/L effort (three one-line replacements; routes all stack traces through uvicorn's structured pipeline with ERROR severity and request context).

- OBSERVATION: `app/http_client.py:57-76` — When `fetch()` exhausts all retries, the final raise path for `httpx.TimeoutException` (line 64) and for generic exceptions (line 76) executes `raise` with no preceding `logger.error(...)`. Each individual retry attempt logs at WARNING level (lines 61, 73), but these warnings are identical in severity to transient single-retry events. The `httpx.HTTPStatusError` path (lines 66-67) has no log whatsoever before re-raise. In practice: a persistent outage of AirNow, NOAA CDO, or NASA FIRMS produces only WARNING-level retry messages — indistinguishable from a single transient 429 that resolved immediately. An operator monitoring for `ERROR` in the log stream gets no signal when an upstream API has been fully unreachable across all 3+1 attempts. PROPOSAL: Add `logger.error("All retries exhausted for %s: %s", url, last_error or e)` immediately before the final `raise` at lines 64 and 76; add `logger.error("HTTP error fetching %s: %s", url, e)` before the re-raise at line 67 — L/L effort (three one-line insertions; elevates persistent upstream failures from WARNING to ERROR, enabling alerting rules to distinguish transient noise from actionable outages).

- OBSERVATION: `routes/health.py:6-12` — `GET /api/health` returns `{"status": "ok", "service": "...", "version": "..."}` unconditionally, with no DB probe (`SELECT 1`) and no Redis PING. `docker-compose.yml:109-113` — the analytics container healthcheck calls `urllib.request.urlopen('http://localhost:3002/api/health')`, and `docker-compose.yml:128-130` shows the gateway sets `depends_on: analytics: condition: service_healthy`, meaning Caddy starts routing external traffic as soon as this shallow check passes. If the PostgreSQL pool fails after startup (brief network hiccup, failover), the health endpoint still returns 200, the container stays "healthy", and external traffic is routed to a service that will fail every DB-dependent endpoint. By contrast, `db` uses `pg_isready` (line 17) and `redis` uses `redis-cli ping` (line 36) — both probe actual service health. The ingestion Rust health endpoint (`routes/health.rs:11-17`) also returns static status with no dependency probing. PROPOSAL: Extend `routes/health.py` to call `await (await get_pool()).fetchval("SELECT 1")` and `await (await get_redis()).ping()` inside a try/except; return HTTP 503 with `{"status": "degraded", "db": false/true, "redis": false/true}` on any failure — L/L effort (10 lines; prevents premature gateway activation and enables Docker's health orchestration to restart degraded analytics containers rather than routing traffic to them).

- OBSERVATION: `components/ErrorBoundary.tsx:36` and `utils/errorHandling.ts:305-323` — `ErrorBoundary.componentDidCatch` calls `console.error('ErrorBoundary caught an error:', error, errorInfo)` with a comment "Log the error to an error reporting service" — no actual remote call. `logError()` in `errorHandling.ts` has a comment "In production, you would send this to an error tracking service e.g., Sentry, LogRocket, etc." but the implementation calls only `console.error()`. Neither function cross-calls the other: `ErrorBoundary.componentDidCatch` uses raw `console.error`, not `logError()`. Browser `console.error()` is visible only in the user's DevTools — completely invisible to operators. A React render crash (e.g., null dereference in a chart's data prop in `Dashboard.tsx`) is silently lost in production: no error rate metric, no alert on regression, no stack trace with browser/OS/user context. With 19 unwrapped `<ResponsiveContainer>` instances (noted in run #172), unhandled chart errors will reach the nearest boundary — and currently produce zero operator-visible signal. PROPOSAL: Add a `reportError(error: Error, context?: string): void` helper to `errorHandling.ts` that either POSTs to a `/api/error-report` stub (backend logs it) or calls a feature-flagged `Sentry.captureException()`; wire it from `ErrorBoundary.componentDidCatch` (replacing the raw `console.error` call) and from the `else` branch in `logError()` — M/M effort (new helper + 2 call sites + optional backend stub; closes the operator visibility gap for all client-side crashes).

**Proposed actions:**
- Replace `traceback.print_exc()` with `logger.exception(...)` at `chat.py:88`, `predict.py:93`, `predict.py:191` — L/L effort (routes stack traces through structured logging at ERROR severity)
- Add `logger.error(...)` before final `raise` in `http_client.py:64,76`; add error log before re-raise at `http_client.py:67` — L/L effort (enables alerting on persistent upstream API outages)
- Extend `routes/health.py` to probe DB (`SELECT 1`) and Redis (`PING`); return 503 on failure — L/L effort (aligns analytics health semantics with gateway's `service_healthy` dependency)
- Add `reportError()` helper to `errorHandling.ts`; wire from `ErrorBoundary.componentDidCatch` and `logError()` — M/M effort (closes operator visibility gap for client-side React crashes)

### Run #174 — 2026-06-05 — Lens: Security
**Scope:** Twelfth Security pass. Files examined in full: `geointellisense-analytics/app/main.py`; `geointellisense-analytics/app/middleware.py`; `geointellisense-analytics/app/routes/admin.py`; `geointellisense-analytics/app/routes/ai_context.py`; `geointellisense-analytics/app/routes/deep_analysis.py`; `geointellisense-analytics/app/routes/low_latency.py`; `geointellisense-analytics/app/routes/grounded_search.py`; `geointellisense-analytics/app/routes/explore.py`; `geointellisense-analytics/app/routes/landsat.py`; `geointellisense-analytics/app/clients/landsat.py`; `geointellisense-analytics/app/routes/demographics.py`; `geointellisense-analytics/app/routes/water_quality.py`; `geointellisense-analytics/app/config.py`; `geointellisense-analytics/app/database.py`. Cross-checked against Active Recommendations and archived Security runs #9, #24, #39, #54, #69, #84, #99, #114, #129, #144, #159 to confirm findings are new.

**Findings:**

- OBSERVATION: `admin.py:15` and `middleware.py:106` — Both admin token validation points use Python's built-in `!=`/`==` string operators for comparing secrets: `admin.py:15`: `if token != settings.admin_token:` and `middleware.py:106`: `if api_key == settings.admin_token:`. CPython's str comparison short-circuits on the first non-matching byte, making comparison time proportional to the length of the matching prefix. This is a textbook timing side-channel: an adversary who can measure round-trip latency can recover `admin_token` one character at a time by finding the prefix that yields the longest comparison time. In a local network or co-hosted environment (cloud VM) the per-byte timing difference is on the order of tens of nanoseconds — difficult but not impossible to exploit. Python's standard library provides `hmac.compare_digest(a, b)` (stdlib since Python 3.3) explicitly for constant-time secret comparison; it is the documented replacement for this pattern. PROPOSAL: At `admin.py:1` add `import hmac`; replace line 15 `if token != settings.admin_token:` with `if not hmac.compare_digest(token or "", settings.admin_token):`. At `middleware.py:7` add `import hmac`; replace line 106 `if api_key == settings.admin_token:` with `if hmac.compare_digest(api_key, settings.admin_token):` — L/L effort (two files, two-line change each; eliminates timing oracle on the only credential comparison path).

- OBSERVATION: `main.py:63-78` — CORS is configured with `allow_credentials=True` unconditionally (line 77), but in dev mode (when `settings.admin_token` is empty), `allow_origins` is set to `["*"]` (line 70). Per the W3C Fetch specification section 3.2.3 and the CORS standard, a response including both `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Credentials: true` is spec-violating; conformant browsers silently discard the credentials flag and block credentialed cross-origin requests. Starlette's `CORSMiddleware` emits both headers without raising an error, creating a mismatch between the application's intent and browser behaviour. More critically, there is no startup assertion or log warning when this permissive fallback activates — a production deployment that neglects to set `ADMIN_TOKEN` silently advertises `Access-Control-Allow-Origin: *` to every origin. The comment at line 62 says "restrict to known origins in production" but the guard is purely advisory. PROPOSAL: (a) Change `allow_credentials=True` at `main.py:77` to `allow_credentials=bool(settings.admin_token)` so credentials are only enabled when origins are restricted; (b) add `if not settings.admin_token: logger.warning("ADMIN_TOKEN not set — CORS wildcard active; all origins accepted")` immediately after line 70 — L/L effort (two config lines + one log line; aligns spec compliance and makes unsafe dev mode visible in logs).

- OBSERVATION: `routes/landsat.py:157-166` and `clients/landsat.py:331-334` — The tile endpoint `GET /api/landsat/tile/ndvi-change/{product}/{z}/{x}/{y}.png` accepts the user-controlled `product` path parameter (line 159) without any character or path-traversal validation, constructs `filename = f"{product}.tif"` (line 166), and passes it directly into `render_ndvi_change_tile`. Inside that function at `clients/landsat.py:331`, `path = DATA_DIR / filename` builds the path using `pathlib.Path`'s `/` operator, which does NOT normalise `..` at construction time — only the OS resolves `..` on file access. A caller supplying `product=../other_dir/target` causes `path = DATA_DIR / "../other_dir/target.tif"`, resolving to a file one directory above `DATA_DIR`. The forced `.tif` extension constrains the attack to GeoTIFF files only, but no check verifies that the resolved path remains within `DATA_DIR`. A guard `path.resolve().is_relative_to(DATA_DIR.resolve())` (Python 3.9+) is absent. PROPOSAL: In `render_ndvi_change_tile` at `clients/landsat.py:331`, immediately after `path = DATA_DIR / filename`, add `if not path.resolve().is_relative_to(DATA_DIR.resolve()): return None` before `path.exists()`; additionally add a regex `Path` validator in the route at `routes/landsat.py:159` to reject `product` values containing `.` sequences: `product: str = Path(..., pattern=r'^[a-zA-Z0-9_\-]+$')` — L/L effort (one guard line in client, one regex in route declaration; eliminates traversal out of `DATA_DIR`).

- OBSERVATION: `routes/demographics.py:149-162` — `POST /api/demographics/backfill` launches a background task (`asyncio.create_task`) that calls the US Census Bureau ACS API (`fetch_tract_demographics` or `fetch_sjv_demographics`) without any authentication check. Contrast with `routes/admin.py` (cache flush, source toggles) which all call `_check_admin(x_admin_token)` before mutating state, and with the AI endpoints which all call `check_ai_auth()`. The backfill endpoint has only a 409 concurrency guard (lines 157-158), meaning one unauthenticated caller starts the job and subsequent callers get a 409 until completion. The Census Bureau rate-limits requests per API key; repeated unauthenticated backfill triggers can exhaust the `settings.census_api_key` daily quota and fill the `demographics` table with data from arbitrary FIPS codes (the `state` and `county` query params are unconstrained). The companion `GET /api/demographics/backfill/status` (line 165-167) also has no auth, leaking task progress and error messages. PROPOSAL: Add `from app.routes.admin import _check_admin` (or duplicate the check inline using `settings.admin_token`) at the top of `demographics.py`; call `err = _check_admin(request.headers.get("x-admin-token"))` as the first two lines of `start_backfill`, returning `err` if set; add `request: Request` to the function signature — L/L effort (three-line change; prevents unauthenticated Census API quota exhaustion and arbitrary FIPS backfill injection).

**Proposed actions:**
- Replace `token != settings.admin_token` with `not hmac.compare_digest(token or "", settings.admin_token)` at `admin.py:15`; replace `api_key == settings.admin_token` with `hmac.compare_digest(api_key, settings.admin_token)` at `middleware.py:106` — L/L effort (eliminates timing oracle on admin token)
- Set `allow_credentials=bool(settings.admin_token)` at `main.py:77`; add startup warning log when wildcard CORS activates — L/L effort (CORS spec compliance + visible dev-mode footgun)
- Add `path.resolve().is_relative_to(DATA_DIR.resolve())` guard in `clients/landsat.py:331`; add `pattern=r'^[a-zA-Z0-9_\-]+$'` to `product` Path param in `routes/landsat.py:159` — L/L effort (eliminates path traversal out of DATA_DIR)
- Add admin token auth to `POST /api/demographics/backfill` at `demographics.py:149`; add `request: Request` parameter — L/L effort (prevents unauthenticated Census API quota exhaustion)

## 📚 Archive (one line per past run)
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
