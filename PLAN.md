# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-04T00:07:25Z
Last run: #146 — Lens: Docs

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

### Run #145 — 2026-06-03 — Lens: Observability
**Scope:** Tenth observability pass. Examined: `geointellisense-analytics/app/main.py` (full); `geointellisense-analytics/app/routes/health.py` (full); `geointellisense-analytics/app/middleware.py` (full); `geointellisense-analytics/app/routes/chat.py` (full); `geointellisense-analytics/app/routes/deep_analysis.py` (full); `geointellisense-analytics/app/routes/predictive_analysis.py` (full); `geointellisense-analytics/app/routes/fires.py` (full); `geointellisense-analytics/app/routes/inversion.py` (full); `geointellisense-analytics/app/routes/predict.py` (lines 1–120); `geointellisense-analytics/app/routes/water.py` (lines 1–55); `geointellisense-analytics/app/claude.py` (full); `geointellisense-ingestion/src/broadcast.rs` (lines 1–168); `geointellisense-ingestion/src/main.rs` (full); `components/ErrorBoundary.tsx` (full); `App.tsx` (grep for ErrorBoundary usage). Cross-checked against Active Recommendations and Latest Findings runs #143–#144 plus archived observability runs #10, #25, #40, #55, #70, #85, #100, #115, #130 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `grep -rn "traceback.print_exc"` across all `app/routes/*.py` yields 29 occurrences in 18 files: `predictive_analysis.py:99`, `grounded_search.py:81`, `grounded_maps.py:88`, `cropscape.py:57`, `nws_forecast.py:86,130`, `enviroscreen.py:272`, `traffic.py:63,98,138`, `epa_aqi.py:69`, `elevation.py:282`, `inversion.py:100`, `chat.py:88`, `calgem.py:201`, `deep_analysis.py:87`, `weather_historical.py:76`, `landsat.py:66,104,281`, `water_quality.py:356`, `low_latency.py:39`, `demographics.py:190`, `fires.py:135`, `predict.py:93,191`, `airnow.py:51,96`, `water.py:132,179`. All 29 follow the same pattern: `except Exception as e: traceback.print_exc(); return JSONResponse(...)`. The `traceback.print_exc()` call writes the raw stack trace directly to `sys.stderr`, entirely bypassing the Python `logging` system. The correct idiom when using `logging` is `logger.exception("context message")`, which automatically appends the current exception traceback to the log record. As a consequence: (1) stack traces from these 29+ paths are absent from any log aggregation system that consumes structured logging output; (2) Active Recommendation #7 notes that the Python logger has no configuration — but even after logging is configured, these 29 `traceback.print_exc()` calls will still write to raw stderr, not through the logger — they are a second independent gap on top of #7; (3) in containerised deployments where stdout/stderr are captured separately from structured log streams, operator tooling may never surface these errors. PROPOSAL: Replace all 29 occurrences of `traceback.print_exc()` in `except` blocks with `logger.exception("descriptive context: %s", e)` (no separate `traceback` import needed) — `logger.exception()` already formats and appends the traceback. A global sed-based replacement across `app/routes/*.py` handles this in one step — L/L effort.

- OBSERVATION: `chat.py:43-48`, `deep_analysis.py:33-44`, `predictive_analysis.py:91-96` — every Claude API call (`client.messages.create(...)`) returns a `Message` object whose `.usage` attribute contains `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens` (per the Anthropic API spec). None of the 5+ routes that call Claude (`chat.py`, `deep_analysis.py`, `predictive_analysis.py`, `low_latency.py`, `explore.py`) log these fields. The economic consequence is non-trivial: `deep_analysis.py` uses `claude-opus-4-6` with `budget_tokens: 32768` and `max_tokens: 40000` — at Opus pricing (~$15/M input, $75/M output), a 3-round tool-use loop that exhausts the budget can cost $8–15 per single request. With `/api/deep-analysis` currently unprotected (Active Rec #9), there is zero visibility into whether cost spikes are occurring. Additionally, `claude.py:75` calls `anthropic.Anthropic(api_key=...)` on every request — a new client object per invocation — discarding any HTTP connection-pool or session state between requests, adding TLS handshake latency to every call. PROPOSAL: In each Claude route's success path, add `logger.info("Claude %s — in=%d out=%d", model, resp.usage.input_tokens, resp.usage.output_tokens)` after `client.messages.create()` — L/L effort (one `logger.info` line per route); separately, hoist `get_client()` to a module-level singleton at `claude.py:74-75` to enable connection reuse — L/L effort.

- OBSERVATION: `components/ErrorBoundary.tsx:34-41` — `componentDidCatch(error, errorInfo)` calls only `console.error('ErrorBoundary caught an error:', error, errorInfo)` and `this.props.onError?.(error, errorInfo)`. The two `<ErrorBoundary>` instances in `App.tsx:102-104` and `App.tsx:127-200` pass no `onError` prop, so the callback is never called. No HTTP request is made from `componentDidCatch` to a backend error-collection endpoint, and no third-party error-reporting SDK (Sentry, Datadog RUM, etc.) is imported anywhere in the frontend codebase. Consequence: a React component crash that triggers the error boundary — for example, a null-dereference in `AnalysisView.tsx` caused by an unexpected Claude response shape — produces a "Something went wrong" screen for the user but generates zero server-side signal. In production, these crashes accumulate silently with no alert, no stack trace in logs, and no way to know how often users hit the error boundary. PROPOSAL: Add a fire-and-forget `fetch('/api/frontend-errors', { method: 'POST', body: JSON.stringify({ message: error.message, stack: error.stack, componentStack: errorInfo.componentStack, url: location.href, ts: Date.now() }) })` call inside `componentDidCatch` at `ErrorBoundary.tsx:37`; create a corresponding `POST /api/frontend-errors` endpoint in analytics that logs at `logger.error` level — M/L effort (2 files: one frontend line + one 10-line backend route).

- OBSERVATION: `middleware.py` (full), `main.py` (full), all route files — no middleware generates or propagates a request correlation ID. When a route handler catches an exception and returns `JSONResponse(status_code=500, content={"error": "...", "details": str(e)})` (e.g., `chat.py:89-92`), the response contains no `requestId` field. The server logs only `traceback.print_exc()` to stderr with no identifier. When a frontend user sees an error modal, there is no ID they can report that would allow an operator to find the corresponding server-side trace. This is especially problematic because: (1) the rate-limit key `geointelli:ratelimit:ai_chat:ip:x.x.x.x` is not included in error responses; (2) with multiple concurrent users, time-matching a client-reported error to a server stderr trace is impractical; (3) Uvicorn's access log (if enabled) assigns no request ID either. PROPOSAL: Add a lightweight ASGI middleware to `main.py` — before the route handlers — that generates `request_id = uuid4().hex[:12]`, sets it as `request.state.request_id`, and appends an `X-Request-ID` response header; update each route's 500 response to include `"requestId": request.state.request_id` in the JSON body — M/L effort (1 middleware class + update 500 response shapes).

**Proposed actions:**
- Replace all 29 `traceback.print_exc()` calls in `app/routes/*.py` with `logger.exception("...: %s", e)` — fixes stderr-only error logging, makes exceptions visible to any log aggregator — L/L effort
- Add `logger.info("Claude %s — in=%d out=%d", model, resp.usage.input_tokens, resp.usage.output_tokens)` after every `client.messages.create()` call; hoist `anthropic.Anthropic(...)` to a module-level singleton in `claude.py:74` — L/L effort
- Add fire-and-forget `fetch('/api/frontend-errors', ...)` in `ErrorBoundary.tsx:componentDidCatch`; add matching `POST /api/frontend-errors` logging route — M/L effort
- Add ASGI request-ID middleware to `main.py`; include `requestId` in all 500 JSON error responses — M/L effort

### Run #144 — 2026-06-03 — Lens: Security
**Scope:** Tenth security pass. Examined: `geointellisense-analytics/app/middleware.py` (full); `geointellisense-analytics/app/main.py` (full); `geointellisense-analytics/app/config.py` (full); `geointellisense-analytics/app/routes/admin.py` (full); `geointellisense-analytics/app/routes/predict.py` (full); `geointellisense-analytics/app/routes/landsat.py` (full); `geointellisense-analytics/app/clients/landsat.py` (full); `geointellisense-analytics/app/routes/explore.py` (full); `geointellisense-analytics/app/routes/ai_context.py` (full); `geointellisense-analytics/app/routes/maps_config.py` (full); `geointellisense-analytics/app/routes/sentinel.py` (full); `geointellisense-analytics/app/database.py` (full); `geointellisense-analytics/requirements.txt` (full); `.env.local.example` (full). Cross-checked against Active Recommendations and Latest Findings runs #142–#143 plus archived security runs #9, #24, #39, #54, #69, #84, #99, #114, #129 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `middleware.py:38-40` — `_client_id` extracts a client identifier for rate limiting by reading the first comma-separated value from the `X-Forwarded-For` header: `ip = forwarded.split(",")[0].strip() if forwarded else request.client.host`. The `X-Forwarded-For` header is set by reverse proxies to record the chain of IPs traversed; the FIRST value is what the original client claims — it is entirely attacker-controlled if there is no trusted proxy that strips or rewrites the header before the request reaches FastAPI. An attacker running directly against the analytics port (port 3002, bound to `0.0.0.0` per `main.py:117`) can include `X-Forwarded-For: 1.2.3.4` in every request, causing their rate-limit key to always be `ip:1.2.3.4`. By rotating through arbitrary spoofed IPs they can bypass all IP-based rate limits: the `ai_chat` limit of 20 req/min, `ai_deep` of 5 req/min, etc. (middleware.py:20-27). The correct approach is to trust only the LAST `X-Forwarded-For` value added by the known trusted proxy, or to use `X-Real-IP` which Nginx/Caddy set to the actual client IP and which clients cannot spoof. PROPOSAL: In `middleware.py:38-40`, replace `forwarded.split(",")[0].strip()` with `forwarded.split(",")[-1].strip()` (last value = set by trusted upstream proxy); or, if deployed behind Caddy (see `Caddyfile`), use `request.headers.get("x-real-ip", request.client.host)` instead and remove the `x-forwarded-for` fallback — L/L effort (one-line change).

- OBSERVATION: `main.py:63-78` + `config.py:15` + `.env.local.example` — CORS is configured as `allow_origins=["*"]` (wildcard) combined with `allow_credentials=True` in dev mode (when `settings.admin_token` is falsy), and the default for `admin_token` at `config.py:15` is `""` (empty string). The `.env.local.example` documents only frontend variables (`ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`) — it does not mention `ADMIN_TOKEN`. A developer following the example will always have `admin_token=""`. Modern Starlette (FastAPI 0.115 uses Starlette ≥ 0.41) raises `ValueError: Cannot use allow_credentials with wildcard origins` at ASGI app construction time when this combination is present. This means the analytics server **crashes at startup** in any development environment that follows the documented setup — `python -m app.main` will raise ValueError before serving any request. Even on older Starlette versions where the crash doesn't occur, the combination sends `Access-Control-Allow-Credentials: true` alongside `Access-Control-Allow-Origin: *`, which all modern browsers silently reject for credentialed cross-origin requests, breaking cookie/auth-header-based features in dev mode. PROPOSAL: Change `main.py:77` to `allow_credentials=False` when `_allowed_origins == ["*"]` (i.e., condition on `settings.admin_token`): `allow_credentials=bool(settings.admin_token)`; additionally add `ADMIN_TOKEN=dev-only-token` to `.env.local.example` so developers who need authenticated testing can set it — L/L effort (one-line config change + one-line example file update).

- OBSERVATION: `routes/landsat.py:111-138` — `POST /api/landsat/ndvi-change` accepts `compare_year: int` and `max_cloud: int` query parameters and launches a background asyncio task that: (1) makes two STAC API calls to Microsoft Planetary Computer to find Landsat scenes; (2) downloads multi-hundred-MB Cloud-Optimized GeoTIFFs from Azure Blob Storage via rasterio's VSICURL; (3) runs numpy array operations on the downloaded data; (4) saves a new GeoTIFF file to `DATA_DIR` (default `/app/data/landsat`) via `rasterio.open(..., "w")` at `clients/landsat.py:287-297`. The endpoint has no authentication and no rate limiting (no `check_ai_auth` or `check_rate_limit` call). The only guard is a 409 response if the current background task is still running. Once a task completes, a new one can immediately start. An attacker can trigger this endpoint repeatedly with different `compare_year` values (the query parameter accepts `ge=7` but has no upper bound other than FastAPI type validation), each time writing a new GeoTIFF file to disk. Each file is named `ndvi_change_{hist_id[:20]}_to_{current_id[:20]}.tif` (`clients/landsat.py:281`), so different year pairs produce different filenames — there is no deduplication. This is a disk-filling DoS vector: iterating `compare_year` from 2000 to 2030 (all valid Landsat-era years) would trigger up to 30 sequential computation tasks, each saving a new GeoTIFF to disk. Additionally, each NDVI compute downloads ~200–500 MB of GeoTIFF data from Azure, creating significant outbound bandwidth cost. Compare with `POST /api/predict/train` (Active Rec #6) which is already flagged — this endpoint has identical exposure. PROPOSAL: Add `check_ai_auth(request)` and `check_rate_limit(request, "ai_deep")` calls at the start of the `start_ndvi_change` handler, consistent with the AI endpoint protection pattern; also deduplicate by `compare_year` in the task gate (e.g., cache result by year) — M/L effort (add 2 auth/rate-limit lines + dedup logic).

- OBSERVATION: `routes/landsat.py:157-167` + `clients/landsat.py:331-332` — `GET /api/landsat/tile/ndvi-change/{product}/{z}/{x}/{y}.png` constructs a file path directly from the `product` path parameter without sanitization: `filename = f"{product}.tif"` (line 166), then `path = DATA_DIR / filename` at `clients/landsat.py:331`. Python's `pathlib` does NOT canonicalize away `..` components at path join time — `Path("/app/data/landsat") / "../../../etc/passwd.tif"` resolves to `Path("/etc/passwd.tif")`. FastAPI path parameters match only characters that don't include a literal `/` in the URL, but `..` (two dots) IS a valid single-segment path component. The `.tif` suffix is always appended, which prevents reading arbitrary files, but rasterio at `clients/landsat.py:343` (`rasterio.open(path)`) will attempt to open the traversed path, and the error message in `except Exception: return None` at line 368 is swallowed silently — an attacker can probe for file existence by observing whether the tile endpoint returns a transparent PNG (file not found) vs. attempts an open (file present but not a valid TIFF). A path like `product=../../etc/hostname` would cause rasterio to try to open `/etc/hostname.tif`, fail, and return transparent PNG — different behavior from `product=does_not_exist` (file not found: `if not path.exists(): return None`). This allows filesystem path enumeration via timing/response-code side-channels. PROPOSAL: Add path validation at `routes/landsat.py:164` before constructing filename: `if not re.match(r'^[A-Za-z0-9_\-]+$', product): raise HTTPException(400, "Invalid product name")`; alternatively use `path.resolve()` and assert it starts with `DATA_DIR.resolve()` — L/L effort (two lines).

**Proposed actions:**
- Change `middleware.py:38-40` to use last `X-Forwarded-For` value or `X-Real-IP` header to prevent rate-limit bypass via spoofed IPs — L/L effort
- Change `main.py:77` to `allow_credentials=bool(settings.admin_token)` to prevent CORS + credentials startup crash and misconfiguration; add `ADMIN_TOKEN` to `.env.local.example` — L/L effort
- Add `check_ai_auth` + `check_rate_limit("ai_deep")` to `POST /api/landsat/ndvi-change` handler at `routes/landsat.py:111`; add per-year deduplication — M/L effort
- Add `product` parameter validation at `routes/landsat.py:164` (`re.match(r'^[A-Za-z0-9_\-]+$', product)`) to prevent path traversal in NDVI tile endpoint — L/L effort

## 📚 Archive (one line per past run)
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
