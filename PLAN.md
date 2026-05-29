# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-29T20:30:00Z
Last run: #40 — Lens: Observability

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
### Run #40 — 2026-05-29 — Lens: Observability
**Scope:** Third observability pass. Python analytics: all 32 `app/routes/*.py` files checked for error-handling patterns; `app/main.py`; `app/middleware.py`. Rust ingestion: `src/main.rs`. Frontend: `index.tsx`, `utils/errorHandling.ts`, `components/ErrorBoundary.tsx`. Cross-referenced Active Rec rows #8 and #9 and archived findings from runs #10 and #25 to exclude previously-reported items.

**Findings:**

- OBSERVATION: 23 of the ~32 Python route files use `traceback.print_exc()` in their `except` blocks rather than `logger.exception()`. Representative examples: `chat.py:88`, `deep_analysis.py:87`, `grounded_search.py:81`, `predictive_analysis.py:99`, `low_latency.py:39`, `traffic.py:63`, `predict.py:93`, `water.py:132`, `fires.py:135`, `airnow.py:51`. `traceback.print_exc()` writes directly to `sys.stderr` and completely bypasses the Python `logging` framework — it is unaffected by log level, handler configuration, or log-aggregation middleware. This means that even after applying the fix from Active Rec row #8 (adding a logging configuration to `main.py`), all exception stack traces from every API endpoint will still escape to raw stderr rather than flowing through any structured log handler. The correct replacement is `logger.exception("descriptive message")`, which emits at ERROR level with the full traceback attached, routes through the configured logging system, and is searchable in any downstream aggregator.

- OBSERVATION: `geointellisense-analytics/app/middleware.py:64-75` — when `check_rate_limit()` enforces a 429 response it produces no log entry. The function's only `logger.warning()` call (line 77) fires when the Redis check itself raises an exception (i.e., Redis is unavailable), not when a rate limit is legitimately hit. As a result there is zero observability into which clients are being throttled, on which endpoint tier, at what request frequency, or whether the configured limits are appropriate. Distinguishing an abusive scraper from a high-volume legitimate partner requires manual Redis key inspection. Fix: add `logger.warning("Rate limit hit: client=%s tier=%s count=%d limit=%d", client, tier, count, max_requests)` at line 64 before the `return JSONResponse(...)`.

- OBSERVATION: `index.tsx:1-15` — the React entry point has no `window.onerror` or `window.addEventListener('unhandledrejection', ...)` handler. React's `ErrorBoundary` catches render-cycle errors only; it does NOT catch async errors from `fetch()` calls, rejected promises from `services/dataService.ts`, `services/aiService.ts`, and `services/AirQualityService.ts`. These failures are silently discarded by the browser. `utils/errorHandling.ts:321-322` contains the comment "In production, you would send this to an error tracking service (e.g., Sentry, LogRocket)" — but `logError()` is never invoked for unhandled promise rejections, making the stub dead code for this entire class of errors. Fix: add `window.addEventListener('unhandledrejection', e => logError(e.reason, 'unhandledrejection'))` in `index.tsx` before the `root.render()` call; this alone routes all async errors through the existing `logError()` path and makes them visible in the browser console with timestamps and context.

- OBSERVATION: `geointellisense-analytics/app/main.py` — the FastAPI application has no `@app.exception_handler(Exception)` registered. Unhandled exceptions in route coroutines cause FastAPI to return HTTP 500, but uvicorn logs only a single-line entry to its own internal `uvicorn.error` logger (e.g., `ERROR: Exception in ASGI application`) with no indication of which route, which session ID, which model call, or what request parameters were in flight. There is also no `BaseHTTPMiddleware` that measures request duration. An operator looking at application logs during an incident cannot determine which of the ~32 route handlers is failing, at what frequency, or how long requests are taking. Fix: register an `@app.exception_handler(Exception)` that calls `logger.exception("Unhandled exception in %s", request.url.path)` before re-raising; add a `BaseHTTPMiddleware` subclass that records `time.monotonic()` on entry and logs `method, path, status_code, duration_ms` on exit.

- OBSERVATION: `geointellisense-ingestion/src/main.rs:87` — `TraceLayer::new_for_http()` is added to the Axum router, which emits HTTP request spans via `tower_http`. However, no request-ID or correlation-ID header is injected into responses (no `SetRequestIdLayer`, no UUID generation). The Python analytics service at `geointellisense-analytics/app/main.py` also generates no correlation ID. A single user interaction that touches both services — e.g., the chat assistant calling `build_live_context()` (Python) which depends on the Rust SSE feed — produces log entries in two separate Docker log streams with no shared field linking them. Diagnosing a latency spike or error requires manually cross-referencing timestamps across both services. Fix: add `tower_http::request_id::SetRequestIdLayer` in the Rust router; have the Python analytics service forward or generate `X-Request-ID` headers, logging the value in every route handler.

**Proposed actions:**
- Replace all `traceback.print_exc()` calls in 23 route files with `logger.exception("…")` — M/L, score 2.0; does not enter top 10
- Add `logger.warning(…)` on rate-limit hit in `middleware.py:64` — M/L, score 2.0; does not enter top 10
- Add `window.addEventListener('unhandledrejection', …)` in `index.tsx:14` — M/L, score 2.0; does not enter top 10
- Register `@app.exception_handler(Exception)` and a request-duration middleware in `main.py` — M/L, score 2.0; does not enter top 10
- Add `SetRequestIdLayer` in Rust router and `X-Request-ID` propagation in Python service — M/L, score 2.0; does not enter top 10

### Run #39 — 2026-05-29 — Lens: Security
**Scope:** Third security pass. Python analytics service: `app/main.py`, `app/middleware.py`, `app/config.py`, `app/routes/admin.py`, `app/routes/ai_context.py`, `app/routes/chat.py`, `app/routes/explore.py`, `app/routes/demographics.py`, `app/routes/maps_config.py`. Rust ingestion service: `src/main.rs`, `src/routes/admin.rs`, `src/routes/sse.rs`. Cross-referenced Active Recs rows #6, #7, #10 and archived findings from runs #9 and #24 to exclude previously-reported items.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/routes/demographics.py:149` — `POST /api/demographics/backfill` has no authentication check. The handler immediately spawns an asyncio task (`_backfill_task`) that calls the US Census Bureau ACS API for all census tracts across multiple San Joaquin Valley counties and then executes up to ~1,000 individual asyncpg `INSERT … ON CONFLICT DO UPDATE` statements against the `demographics` table. Any unauthenticated HTTP caller can trigger this endpoint repeatedly, exhausting Census Bureau API rate limits for the server's IP, flooding the database with concurrent writes, and filling the global `_backfill_status` module-level dict with misleading state. The pattern is identical to `POST /api/predict/train` (Active Rec row #7, which was flagged in run #9), but is a distinct unprotected endpoint not previously reported. Fix: apply `_check_admin` (as used in `admin.py`) or `check_ai_auth` (as used in `chat.py`) before spawning the backfill task.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:96-108` — `POST /api/chat/reset` and `POST /api/chat/session` have no authentication checks. By contrast, `POST /api/chat` (line 22) correctly calls `check_ai_auth(request)` and `check_rate_limit(request, "ai_chat")`. The reset handler at line 97-102 accepts an arbitrary `session_id` in the request body and calls `reset_session(session_id)` — permanently discarding the session's conversation history — with no validation that the caller owns or is authorized to reset that session. Any observer of a `sessionId` value returned in a prior chat response can destroy it. The session creation endpoint at lines 105-108 is also unprotected, allowing unlimited in-memory session objects to be created. Fix: add `check_ai_auth(request)` at the top of both handlers; for `reset`, additionally validate that the session belongs to the requesting client (or require the admin token).

- OBSERVATION: `geointellisense-analytics/app/routes/ai_context.py:12` — `GET /api/ai/context` is fully unauthenticated and unrate-limited. The handler calls `build_live_context()`, which aggregates live AQI sensor readings, fire detections, earthquake events, USGS water gauge data, inversion strength, and CalEnviroScreen scores into the single context object that the AI assistant uses. This endpoint was introduced specifically for debugging and inspection (per its docstring), but it is mounted on the production app router without any access control. Any external caller can poll it at any cadence to obtain the full assembled intelligence context. While each individual data source is public, the assembled, pre-processed context represents server-side analytical work and exposes internal state (e.g. which sources are stale or unavailable) that assists in probing the system. Fix: add `check_ai_auth(request)` or require the admin token for this endpoint, or remove it from production routing and expose it only in development.

- OBSERVATION: `geointellisense-analytics/app/routes/explore.py:41` — The `bucket` query parameter accepts any string and is passed directly to PostgreSQL as `time_bucket($1::interval, time)` via asyncpg's parameterized query at lines 152, 163, 178, 192, 204. While parameterized binding prevents SQL injection, any valid PostgreSQL interval with fine granularity — e.g. `bucket=1+second` with `days=365` — instructs TimescaleDB to produce approximately 31.5 million one-second buckets. asyncpg will fetch all rows into memory, FastAPI will JSON-serialize the entire result set (each row being a `{bucket, value}` dict), and the response body could exceed several gigabytes. This creates a functional denial-of-service against the analytics service and PostgreSQL without any authentication. The `days` parameter is bounded (`ge=1, le=365`) but `bucket` has no allowlist. Fix: validate `bucket` against an explicit set of permitted intervals such as `{"1 hour", "6 hours", "1 day", "7 days", "30 days"}` before executing the query; return HTTP 400 for any value outside this set.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:88-92` — The `/api/chat` error handler returns `"details": str(e)` verbatim in the HTTP 500 response body. The Anthropic SDK raises `anthropic.APIStatusError`, `anthropic.APIConnectionError`, and `anthropic.AuthenticationError` exceptions whose string representations include HTTP request headers, partial response bodies, and in some versions, the API key value used in the `Authorization` header. An `asyncpg` `InvalidPasswordError` or `TooManyConnectionsError` raised during live-context retrieval in the same try block would expose the `DATABASE_URL` connection string (including credentials). Any caller who triggers a 500 response receives this diagnostic information. Fix: replace `"details": str(e)` with a sanitized error message (e.g. the exception class name only); log `str(e)` server-side via `logger.exception("chat error")` instead.

**Proposed actions:**
- Add `_check_admin` or `check_ai_auth` to `POST /api/demographics/backfill` in `demographics.py:149` — H/L, score 3.0; ties current top 10, does not displace
- Add `check_ai_auth(request)` to `POST /api/chat/reset` and `POST /api/chat/session` in `chat.py:96,105` — M/L, score 2.0; does not enter top 10
- Add `check_ai_auth(request)` or admin-token gate to `GET /api/ai/context` in `ai_context.py:12` — M/L, score 2.0; does not enter top 10
- Add allowlist validation for `bucket` parameter in `explore.py:41`; return 400 for non-permitted intervals — M/L, score 2.0; does not enter top 10
- Replace `"details": str(e)` with sanitized class name in `chat.py:91`; log full exception server-side — M/L, score 2.0; does not enter top 10

### Run #38 — 2026-05-29 — Lens: Data pipeline integrity
**Scope:** Third data-pipeline pass. Rust ingestion service: `src/broadcast.rs`, `src/purpleair.rs`, `src/usgs.rs`, `src/redis_cache.rs`, `src/routes/sse.rs`, `src/db/persist.rs`. Python analytics service: `app/http_client.py`, `app/source_toggles.py`, `app/clients/nasa_firms.py`, `app/clients/nws_sounding.py`, `app/clients/usgs_water.py`, `app/clients/airnow.py`, `app/routes/fires.py`, `app/routes/water.py`, `app/routes/inversion.py`, `app/routes/earthquakes.py`. Cross-referenced archived findings from runs #8 and #23 to exclude previously-reported items.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/http_client.py:33` — `async with httpx.AsyncClient(timeout=timeout) as client:` is placed inside the retry loop. This creates a brand-new `httpx.AsyncClient` (and its underlying TCP/TLS connection pool) for every request attempt and immediately destroys it on `__aexit__`. The httpx documentation explicitly warns against this pattern inside a loop. Every API call — to NASA FIRMS, USGS Water, and any other caller of `http_fetch` — incurs a fresh DNS lookup, TCP handshake, and TLS negotiation. In retry scenarios (when the remote server is under load or throttling), each of the 3 retry attempts repeats this overhead. For HTTPS endpoints like the FIRMS CSV API or USGS Water Services, this adds roughly 200–500ms of connection setup latency per attempt that would be eliminated by a reused pool. Fix: instantiate a single `httpx.AsyncClient` at module level as a singleton (or inject it via FastAPI lifespan state), and reference it in `fetch()` rather than creating a new one per call.

- OBSERVATION: `geointellisense-analytics/app/clients/nws_sounding.py:130` and `nws_sounding.py:189` — Both `fetch_surface_obs()` and `fetch_sounding_850mb()` instantiate `httpx.AsyncClient` directly instead of calling `app.http_client.fetch()`. `fetch_surface_obs()` (line 130) has zero retry: a single network error or non-2xx response raises immediately, is caught at `inversion.py:61` without retry, and leaves `_current_status` stale for the next 30-minute poll cycle — meaning the inversion advisory can be based on 30-minute-old data during transient outages. `fetch_sounding_850mb()` (line 189) uses a `for hours_back in [0, 12, 24]:` loop that silently falls back to 12- or 24-hour-old sounding data on any error, making it look like a retry but actually serving stale data. A transient network failure during the 12Z poll would cause the system to report yesterday's inversion strength to the AI context builder without any log warning beyond DEBUG level. Fix: replace both bare `httpx.AsyncClient` calls with `app.http_client.fetch()` to gain automatic retry/backoff; in `fetch_sounding_850mb`, distinguish `httpx.HTTPStatusError` with 404 (no data available for this time slot → fall back) from network errors (retry the same time slot before falling back).

- OBSERVATION: `geointellisense-ingestion/src/usgs.rs:107` — `let client = reqwest::Client::new();` is called inside `fetch_recent()`, which runs on every earthquake poll tick. `reqwest::Client` documentation states it "has an internal connection pool and is intended to be created once per application." Creating it per-poll discards the connection pool and forces a new DNS resolution, TCP handshake, and TLS handshake to the USGS FDSN server on every invocation. Compare with `PurpleAirClient` in `purpleair.rs:43`, which correctly stores `http: reqwest::Client` as a struct field reused across fetches. The discarded client also means that the USGS URL's keep-alive connection is closed and re-opened at each poll, adding 200–400ms overhead per tick and preventing the OS from amortizing TLS session resumption. Fix: extract a `UsgsClient` struct analogous to `PurpleAirClient` with a single `reqwest::Client` field, or create the client once in `spawn_earthquake_poller` and thread it into `fetch_and_persist`.

- OBSERVATION: `geointellisense-analytics/app/routes/water.py:287` — `ts.replace(".000", "")` removes only the literal string `.".000"` from USGS Water Services timestamp strings before calling `datetime.fromisoformat()`. The USGS Instantaneous Values API can return timestamps with non-zero milliseconds (e.g., `"2025-11-13T08:15:00.123-08:00"`). For any such value, the `.replace(".000", "")` is a no-op, and on Python < 3.11 `datetime.fromisoformat()` raises `ValueError` because it does not support the `YYYY-MM-DDTHH:MM:SS.mmm±HH:MM` form. The `except Exception` handler at line 300 silently drops the reading and continues, so any batch that contains even one non-zero-millisecond timestamp under-persists without any count discrepancy in the returned `inserted` value. Since `_persist_readings` is called in both the 15-minute poll loop and on-demand in `water_current()`, the water_readings table can accumulate systematic gaps whenever USGS returns these timestamps. Fix: replace the fragile `.replace(".000", "")` pattern with `re.sub(r'\.\d+', '', ts)` to strip any fractional-second component, or upgrade to Python 3.11's fully conformant `fromisoformat()`.

- OBSERVATION: `geointellisense-analytics/app/routes/water.py:185-205` (`_format_db_current`) vs `water.py:208-231` (`_format_current`) — `_format_current()` includes `"lat": r.latitude` and `"lng": r.longitude` in each station object (lines 215–216). `_format_db_current()` builds station objects from DB rows but does NOT select or include `lat`/`lng` (lines 192–199). The DB query at lines 100–108 (`SELECT DISTINCT ON (site_id) ... FROM water_readings WHERE time > now() - interval '2 hours'`) omits `latitude` and `longitude` columns even though these are stored in every row of `water_readings` (confirmed by the `INSERT` at line 289–296 which binds `r.latitude` and `r.longitude`). Because `water_current()` returns `_format_db_current()` at line 115 whenever the DB has data from the last 2 hours — which is essentially always after the 15-minute poll loop has run — the `lat`/`lng` fields are absent from nearly every production response to `GET /api/water/current`. Any frontend code that renders USGS water station markers on the map receives `undefined` coordinates and silently fails to place any markers. Run #36 proposed adding `lat: number; lng: number` to the TypeScript type, but that fix alone would not resolve the issue: the server-side DB path must also return these fields. Fix: add `latitude, longitude` to the `SELECT` clause at lines 91–98 and 100–108 in `water.py`, then expose them as `"lat"`/`"lng"` in `_format_db_current()`.

**Proposed actions:**
- Move `httpx.AsyncClient` in `http_client.py` to a module-level singleton, removing per-request instantiation — M/L, score 2.0; does not enter top 10
- Replace bare `httpx.AsyncClient` calls in `nws_sounding.py:130` and `:189` with `app.http_client.fetch()`; distinguish HTTP 404 from network errors in `fetch_sounding_850mb` — M/L, score 2.0; does not enter top 10
- Introduce `UsgsClient` struct in `usgs.rs` (or create client once in `spawn_earthquake_poller`) to reuse the `reqwest::Client` across polls — M/L, score 2.0; does not enter top 10
- Replace `ts.replace(".000", "")` with `re.sub(r'\.\d+', '', ts)` in `water.py:287` — M/L, score 2.0; does not enter top 10
- Add `latitude, longitude` to the DB queries in `_format_db_current()` / `water_current()` so water station map coordinates are present in DB-path responses — H/L, score 3.0; ties current top 10, does not displace

## 📚 Archive (one line per past run)
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
