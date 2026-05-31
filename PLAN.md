# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-31T19:15:00Z
Last run: #86 — Lens: Docs

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
### Run #86 — 2026-05-31 — Lens: Docs
**Scope:** Sixth docs pass. Examined: `README.md`, `IMPLEMENTATION_STATUS.md`, `.env.local.example`, `docker-compose.yml`, `package.json`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-analytics/app/routes/fires.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/routes/inversion.py`, `geointellisense-analytics/app/routes/admin.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/main.py`, `geointellisense-analytics/app/config.py`. Cross-checked against Active Recommendations and prior docs runs #11, #26, #41, #56, #71 (all archived) to confirm all findings are new.

**Findings:**

- OBSERVATION: `README.md:34` (Architecture section) and `README.md:15-18` (Run Locally section) — The README describes a two-service architecture: "Backend (Express): Runs on http://localhost:3001" and "Frontend (Vite + React): Runs on http://localhost:5174". The `package.json` has no `express` dependency, no `server` script, and no `dev:full` script; both commands the README prescribes (`npm run dev:full`, `npm run server`) fail immediately with "missing script: dev:full" / "missing script: server". The actual system is a four-service docker-compose stack: Rust/Axum ingestion (port 3001), Python/FastAPI analytics (port 3002), TimescaleDB+PostGIS, and a Caddy gateway (port 8080). Neither `docker-compose` nor `docker compose up` appears anywhere in the README. A developer following the README verbatim cannot run the project. PROPOSAL: Rewrite README "Run Locally" section to describe `docker compose up` as the primary path and document the gateway URL (http://localhost:8080); archive or delete the Express references — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `docker-compose.yml:5-22` — The `docker-compose.yml` references 15 environment variables via `${VAR}` interpolation: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_PORT`, `REDIS_PORT`, `INGESTION_PORT`, `ANALYTICS_PORT`, `GATEWAY_PORT`, `ADMIN_TOKEN`, `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, `EPA_AQS_EMAIL`, `EPA_AQS_KEY`, `CENSUS_API_KEY`. The only `.env` example file in the repository is `.env.local.example`, which documents five variables for the Vite frontend (`ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`). There is no `.env.example` (or `.env.docker.example`) at the repository root documenting the docker-compose variables. When a developer runs `docker compose up` without a `.env` file, all 15 variables silently expand to empty strings: `POSTGRES_USER` becomes `""`, causing the `pg_isready` healthcheck to fail, the Rust service to fail DB initialization, and the Python service to start with no API keys. The `${PURPLEAIR_INTERVAL_SECS:-600}` pattern provides defaults only for three optional variables; the required ones (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`) have no defaults and no documentation. PROPOSAL: Create `.env.example` at the repo root listing all 15 docker-compose vars with safe placeholder values and one-line descriptions (e.g., `POSTGRES_PASSWORD=changeme  # Required: DB password`); reference it from README — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/app/routes/fires.py:30-38` — `start_fire_polling()` has no docstring. By contrast, the sibling functions `start_water_polling()` (`water.py:23`) has `"""Start background task that polls USGS every 15 minutes."""` and `start_inversion_polling()` (`inversion.py:25`) has `"""Start background task that checks inversion status every 30 min."""`. The missing docstring is particularly important because `start_fire_polling()` has a non-obvious early-return branch: if `settings.nasa_firms_key` is falsy, the function returns silently without creating a task (lines 32-34), while the other two pollers always start. Without a docstring, this behavior — and the fact that fire polling requires an explicit API key while water and inversion polling do not — is invisible to a developer reading only the `lifespan` startup handler in `main.py`. FastAPI's `/docs` OpenAPI page will also show no description for any route in the fires module (since FastAPI uses the function docstring as the endpoint summary for the `GET /api/fires/active` and `GET /api/fires/history` routes, and neither has a docstring). PROPOSAL: Add `"""Start NASA FIRMS fire polling (30 min interval). No-op if NASA_FIRMS_KEY is not configured."""` to `start_fire_polling()` at `fires.py:30`; also add docstrings to `fires_active` and `fires_history` for OpenAPI parity with `predict.py` routes — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:42-49` (`spawn_ticker` signature) — `spawn_ticker` is a public function with 7 parameters and no doc comment. Its behavior is significantly non-obvious: it conditionally spawns a PurpleAir poll Tokio task only when `pa_client: Option<PurpleAirClient>` is `Some`, and always spawns a second independent broadcast-ticker Tokio task. The two tasks run on different intervals (`purpleair_secs` vs `broadcast_secs`), share state only via the `cache: LiveCache` `Arc<RwLock<...>>`, and the broadcast ticker continues to re-stamp cached data as `Utc::now()` even when PurpleAir is disabled or failing. A developer reading `main.rs` to understand the data flow sees only `broadcast::spawn_ticker(...)` with no indication that this call spawns two concurrent background loops, or that the broadcast loop will emit stale-timestamped data when the PurpleAir loop is absent. The public `AppState` struct at line 27 also has no doc comment explaining that `cache` holds only the last successful PurpleAir fetch (or `None` until the first fetch), which causes the broadcast loop to fall back to mock data. PROPOSAL: Add a `/// Spawns two background tasks: (1) PurpleAir sensor poll (only if pa_client is Some), and (2) broadcast ticker that re-stamps and fans out the latest cache snapshot every broadcast_secs. When PurpleAir is disabled or absent, the broadcast emits mock data.` doc comment before `spawn_ticker` at `broadcast.rs:42`; add `/// Shared state passed to every Axum handler.` to `AppState` — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `IMPLEMENTATION_STATUS.md:87-113` — The "📋 Next Steps — Phase 4: Polish & Production Readiness" section lists three items as pending: (1) accessibility patterns, (2) "Return structured errors from services / Display user-friendly error messages / Add retry mechanisms", and (3) implicitly, authentication. However, items (2) and (3) are already implemented in the current codebase: `utils/errorHandling.ts` defines `withRetry`, `DataServiceError`, `toDataServiceError`, and `fetchWithTimeout`; `app/middleware.py` implements `check_ai_auth` and `check_rate_limit`; the admin token system is live. The `IMPLEMENTATION_STATUS.md` "Current Architecture" section also still contains the comment "Easy to add authentication/rate limiting later" — contradicted by the fact that both are already added. The "Performance Note" about a 696KB bundle warning ("will be addressed in Phase 3") refers to a superseded implementation; the current build does not use the same bundling strategy. A new developer reading this document would believe error handling, retry logic, and auth are missing and would spend time re-implementing them. PROPOSAL: Update `IMPLEMENTATION_STATUS.md` Phase 4 to mark error handling and auth as completed; add a brief Phase 5 section acknowledging the actual open items from Active Recommendations (session ownership, unauthenticated endpoints) — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Rewrite README "Run Locally" and "Architecture" sections to describe `docker compose up` and the four-service stack; remove Express references — M/L, score 2.0; does not displace top 10
- Create `.env.example` at repo root documenting all 15 docker-compose variables with placeholder values and one-line descriptions — M/L, score 2.0; does not displace top 10
- Add docstring to `start_fire_polling()` at `fires.py:30` noting it is a no-op without `NASA_FIRMS_KEY`; add docstrings to `fires_active` and `fires_history` for OpenAPI coverage — L/L, score 1.0; does not displace top 10
- Add `///` doc comment to `spawn_ticker` at `broadcast.rs:42` explaining the two-task design and stale-timestamp behavior — L/L, score 1.0; does not displace top 10
- Update `IMPLEMENTATION_STATUS.md` Phase 4 to reflect that error handling and auth are already implemented; correct or remove the stale "easy to add later" note — L/L, score 1.0; does not displace top 10

### Run #85 — 2026-05-31 — Lens: Observability
**Scope:** Sixth observability pass. Examined: `geointellisense-analytics/app/routes/chat.py`, `app/routes/predict.py`, `app/routes/fires.py`, `app/ml/aqi_model.py`, `app/middleware.py`, `app/main.py`, `app/claude.py`, `geointellisense-ingestion/src/routes/sse.rs`, `src/db/persist.rs`, `src/broadcast.rs`, `src/main.rs`, `services/aiService.ts`, `utils/errorHandling.ts`, `components/ErrorBoundary.tsx`, `hooks/useApiStatus.ts`. Cross-checked against Active Recommendations and prior observability runs #10, #25, #40, #55, #70 (archived) to confirm all findings are new.

**Findings:**

- OBSERVATION: `app/routes/chat.py:88`, `app/routes/predict.py:93`, `app/routes/predict.py:191`, `app/routes/fires.py:135` — Four separate exception handlers call `traceback.print_exc()` and then return a JSON error response, bypassing Python's logging system entirely. `traceback.print_exc()` writes to `sys.stderr` unconditionally; the Python `logging` module has no knowledge of these output streams. If logging is later configured with a structured JSON formatter (e.g., for Datadog, CloudWatch, or Loki), stack traces from these four call sites will appear in raw text on the host's stderr/stdout stream rather than in the structured log pipeline. The existing `logger` instances are already defined in all three modules (`logger = logging.getLogger(__name__)`) and support `logger.exception(msg)` — which both logs the message through the configured handler chain AND appends the current traceback via `exc_info=True`. The correct fix is `logger.exception("Failed to get chat response")` (replacing `traceback.print_exc()` + the error log that doesn't exist). PROPOSAL: Replace each `traceback.print_exc()` call at `chat.py:88`, `predict.py:93`, `predict.py:191`, `fires.py:135` with `logger.exception(...)` using the same message already in the adjacent JSONResponse — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/src/routes/sse.rs:13-19` — `CLIENT_COUNT` is declared as `static CLIENT_COUNT: AtomicUsize = AtomicUsize::new(0)` and is only ever incremented: `CLIENT_COUNT.fetch_add(1, Ordering::Relaxed) + 1`. The value functions as a monotonically increasing connection-sequence-number, not a live gauge of currently-connected SSE clients. After 100 connections (99 of them already disconnected), `CLIENT_COUNT` reads 100, but the actual live subscriber count is 1 (the broadcast channel's `receiver_count()` would return this). The `"SSE client connected"` and `"SSE client disconnected"` log lines use `client_id` (the sequence number) for correlation, which is correct — but there is no periodic or on-demand log line reporting the total live SSE subscriber count. The Tokio broadcast channel already tracks active receivers: `state.tx.receiver_count()` returns the live count. PROPOSAL: Add a `ACTIVE_CLIENTS: AtomicUsize` counter that increments on connect and decrements on disconnect (in the existing disconnect-detector task at `sse.rs:57-65`); log `active_clients` at `INFO` level in both the connect and disconnect messages so operators can track SSE fanout without parsing a stream of connect/disconnect pairs — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `services/aiService.ts:8-28`, `30-50`, `52-72`, `74-94`, `96-116`, `118-152`, `154-186` — All seven exported AI-service functions catch every exception and return a hardcoded fallback string (`"Sorry, I encountered an error. Please try again."`, `"Failed to get a deep analysis response."`, etc.). `console.error` is called, but errors are never passed to the `logError()` function in `utils/errorHandling.ts:305-323` (which has a comment `// In production, you would send this to an error tracking service`) and are never rethrown. As a result, callers (`ChatView.tsx`, `AnalysisView.tsx`) receive a plain string that is displayed verbatim as an "AI response" — there is no mechanism to distinguish a legitimate short answer from a silent error fallback. A user asking the AI a question during a 503 outage sees `"Failed to get a deep analysis response."` styled identically to a real answer. The `withRetry`, `DataServiceError`, and `fetchWithTimeout` infrastructure in `utils/errorHandling.ts` exists precisely for this use case and is unused by `aiService.ts`. PROPOSAL: Replace bare `catch` blocks in `aiService.ts` with `toDataServiceError(error)` from `utils/errorHandling.ts`; throw the typed error so `ChatView` and `AnalysisView` can display a distinct error state (vs. a real response); call `logError(error, 'aiService')` before rethrowing — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/src/db/persist.rs:31-33` — `write_readings` iterates over every reading in the broadcast tick and emits one `tracing::error!` per failed INSERT: `tracing::error!(station = %r.station_name, "Failed to persist reading: {e}")`. With the default `broadcast_interval_secs = 5` and a typical batch of 15–20 readings per tick, a sustained DB connection failure generates `20 × (60/5) = 240` individual error log lines per minute with no aggregation, no circuit-breaker, and no log-level escalation after repeated failures. The Rust ingestion service uses `TraceLayer::new_for_http()` (from `main.rs:87`) for HTTP request tracing, but there is no health-state object that tracks "N consecutive persist failures." By contrast, the PurpleAir fetch loop in `broadcast.rs:91` correctly emits a single `tracing::warn!` per failed poll cycle rather than one warning per sensor. PROPOSAL: Track a consecutive-failure counter alongside `write_readings`; emit a single summary `tracing::error!("Failed to persist {failed}/{total} readings this tick: {e}")` and after 3 consecutive all-fail ticks, log at `ERROR` with a note to check DB connectivity — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `app/routes/predict.py:36-49` — `_retrain_loop` begins with `await asyncio.sleep(604800)` (7 days) before the first retrain iteration. On a fresh deployment where the model has never been trained, `GET /api/predict/aqi` returns 503 "Model not trained yet" indefinitely until someone manually calls `POST /api/predict/train`. The `start_retrain_scheduler()` startup log reads `"AQI model retrain scheduler started (weekly)"` — no mention that the first automatic retrain will not start for 7 days. `GET /api/predict/train/status` returns `{"state": "idle"}` throughout the entire 7-day wait, which is identical to the state before the scheduler was ever started; operators have no way to distinguish "scheduler is waiting" from "scheduler is not running". PROPOSAL: (1) Log `logger.info("First scheduled retrain in 7 days; call POST /api/predict/train to train immediately")` inside `start_retrain_scheduler()`; (2) Change `_train_status` to `{"state": "scheduled", "nextRunAt": (now + 7_days).isoformat()}` inside `_retrain_loop` immediately after the task starts, before the sleep — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Replace `traceback.print_exc()` at `chat.py:88`, `predict.py:93`, `predict.py:191`, `fires.py:135` with `logger.exception(...)` to route stack traces through the logging system — M/L, score 2.0; does not displace top 10
- Add `ACTIVE_CLIENTS: AtomicUsize` in `sse.rs`; decrement on disconnect and include `active_clients` in connect/disconnect log events — L/L, score 1.0; does not displace top 10
- Replace bare `catch` blocks in `aiService.ts` with `toDataServiceError` + `logError` + rethrow so callers can render a distinct error state — M/L, score 2.0; does not displace top 10
- Change `persist::write_readings` to emit a single-line summary error per tick rather than one error per row; add a consecutive-failure counter — M/L, score 2.0; does not displace top 10
- Log "first retrain in 7 days" at scheduler startup and set `_train_status` to `{"state": "scheduled", "nextRunAt": ...}` inside `_retrain_loop` before the sleep at `predict.py:39` — L/L, score 1.0; does not displace top 10

### Run #84 — 2026-05-31 — Lens: Security
**Scope:** Sixth security pass. Examined: `app/middleware.py`, `app/main.py`, `app/config.py`, `app/claude.py`, `app/routes/chat.py`, `app/routes/admin.py`, `app/routes/maps_config.py`, `app/routes/predictive_analysis.py`, `app/routes/weather_forecast.py`, `app/routes/ai_context.py`, `app/routes/deep_analysis.py`, `app/routes/grounded_search.py`, `app/routes/grounded_maps.py`, `app/routes/low_latency.py`, `app/routes/predict.py`, `app/routes/explore.py`, `app/routes/historical_aqi.py`, `app/routes/earthquakes.py`, `app/routes/calgem.py`, `geointellisense-ingestion/src/routes/admin.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `tests/security.test.tsx`. Cross-checked against Active Recommendations and prior security runs #9, #24, #39, #54, #69 (archived) to confirm all findings are new.

**Findings:**

- OBSERVATION: `app/routes/chat.py:95-108` — The `POST /api/chat/reset` and `POST /api/chat/session` endpoints have no authentication check and no rate limiting. Both endpoints are completely open to any caller. `POST /api/chat/session` (line 105) creates a new UUID session in the in-process `_sessions` dict in `claude.py` and appends to `_session_order`. The LRU eviction cap is `MAX_SESSIONS = 100` at `claude.py:27`. An attacker can POST 101 times in rapid succession to `/api/chat/session` at no cost (no auth, no rate limit), evicting all 100 legitimate active sessions from the in-memory store. Any in-flight or resumed chat that references an evicted session_id will receive an empty history (`get_session_history` returns `[]` for unknown IDs), silently losing the entire conversation context. `POST /api/chat/reset` (line 95) reads `session_id` from the request body without any ownership check; knowing (or brute-forcing) a valid UUID session_id lets any caller clear another user's chat history. By contrast, `POST /api/chat` (line 22) correctly calls `check_ai_auth` and `check_rate_limit`. The two helper endpoints were added without inheriting the same guards. PROPOSAL: Add `check_ai_auth(request)` and `check_rate_limit(request, "ai_chat")` to both `POST /api/chat/reset` and `POST /api/chat/session` — H/L, score 3.0; tied with existing top 10 (not displacing).

- OBSERVATION: `app/middleware.py:38-40` — The `_client_id()` function used for all rate-limit bucket keys reads the `X-Forwarded-For` header directly and trusts its value without any proxy validation: `forwarded = request.headers.get("x-forwarded-for", ""); ip = forwarded.split(",")[0].strip() if forwarded else request.client.host`. The `X-Forwarded-For` header is set by client HTTP libraries and is trivially spoofable — any HTTP client can set it to an arbitrary IP string. Since `_client_id` returns `f"ip:{ip}"` for unauthenticated requests (no `x-api-key`), this means every IP-based rate limit bucket (e.g., `geointelli:ratelimit:ai_chat:ip:1.2.3.4`) is independently addressable by any caller. An attacker making requests to `/api/chat` (or any other AI endpoint in dev mode where auth is skipped) can rotate `X-Forwarded-For: 1.2.3.x` on each request, distributing their traffic across 255 distinct rate-limit buckets and effectively multiplying their allowed request rate by 255× (20 req/min × 255 = 5,100 req/min for the `ai_chat` tier). The `Caddyfile` and `docker-compose.yml` do not set a trusted-proxy header that would override client-supplied values. The fix requires either (a) only trusting the last IP in the `X-Forwarded-For` chain (set by the actual reverse proxy), or (b) only using `request.client.host` and ignoring the header unless a known proxy IP prefix is configured. PROPOSAL: Replace the `X-Forwarded-For` extraction in `_client_id()` at `middleware.py:38-40` with `request.client.host` unconditionally, or add a `TRUSTED_PROXIES` config list and only accept the header from those sources — H/L, score 3.0; tied with existing top 10 (not displacing).

- OBSERVATION: `app/routes/predictive_analysis.py:31-34` and `app/routes/weather_forecast.py:25-29` — The `PredictiveAnalysisRequest` and `WeatherForecastRequest` Pydantic models impose no length constraints on any field. `historicalAqi: list[AqiDataPoint]` and `historicalWeather: list[WeatherDataPoint]` accept an unbounded number of items; `customFactors: str` accepts an unbounded string. At `predictive_analysis.py:69`, the merged list is serialized as `json.dumps(combined, indent=2)` and embedded verbatim into the LLM prompt. Sending `historicalAqi` with 5,000 `AqiDataPoint` items produces approximately 300KB of JSON embedded in the prompt string, consuming the majority of `claude-sonnet-4-20250514`'s 200K-token context window. Combined with a `customFactors` string of 100K characters and a `historicalWeather` list of equal size, a single unauthenticated request (these endpoints have no auth per Active Recommendation #10) can manufacture a prompt that exceeds the context window, causing a 400 error from the Anthropic API after the full token-billing cost has been incurred. Even with rate limiting, each single request at maximum payload can cost several dollars in inference fees. No request-body size limit is configured at the FastAPI or ASGI layer. PROPOSAL: Add Pydantic field validators: `customFactors: str = Field("", max_length=2000)` and use `Annotated[list[AqiDataPoint], Field(max_length=120)]` (120 months = 10 years) for `historicalAqi` and `historicalWeather` in both request models — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `app/routes/ai_context.py:13` — `GET /api/ai/context` returns the full live data context that is injected into every AI system prompt, with no authentication and no rate limiting. The response includes the exact text of `build_live_context()` output: the assembled AQI readings, fire detections, earthquake data, water levels, CalEnviroScreen data, and any other context sources in `app/context.py`. More importantly, the response reveals the exact structure and schema of what the system prompt looks like to the AI, including any prompt-engineering context markers (section headers, instruction fragments, and data field names). An adversary can call `GET /api/ai/context` once to obtain a complete map of the system prompt's live-data section, then craft a precisely targeted prompt-injection payload — e.g., injecting a string that appears to be a new authoritative context section because it mimics the observed structure — to redirect the AI's behavior via the user-facing `/api/chat` or `/api/grounded-search` inputs. The endpoint is described in the docstring as "for debugging and inspection" (`ai_context.py:12`), confirming it was intended as a development tool, not a public endpoint. PROPOSAL: Add `check_ai_auth(request)` to `GET /api/ai/context` at `ai_context.py:13`; alternatively, remove the endpoint entirely from production builds — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `app/main.py:63-78` — The `CORSMiddleware` is configured with `allow_credentials=True` unconditionally, but the `allow_origins` value is conditionally set: in dev mode (when `settings.admin_token` is empty), `_allowed_origins = ["*"]` at line 70; in production it is a specific allowlist. The combination of `allow_origins=["*"]` and `allow_credentials=True` violates the Fetch Living Standard (§3.2.5, step 7): browsers refuse to expose responses to scripts when both `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Credentials: true` are present in the same response. Starlette's `CORSMiddleware` does not validate this combination and emits both headers simultaneously. The practical security consequence: in dev mode, any cross-origin page can issue unauthenticated GET requests to all data endpoints (since no credentials are required for GETs) and receive the responses — because browsers enforce `*` + credentials only for credentialed requests. For `POST` requests with `Content-Type: application/json`, the preflight `OPTIONS` response includes `Access-Control-Allow-Origin: *` + `Access-Control-Allow-Credentials: true`, which browsers also reject, preventing any credentialed cross-origin POST even in dev. The net effect is that in dev mode: non-credentialed cross-origin GETs to all 40+ API routes succeed from any origin; credentialed cross-origin POSTs fail silently. The `allow_credentials=True` setting at line 77 should be conditioned on whether specific origins are configured, or the origin list should always be explicit. PROPOSAL: Change the CORS setup so that `allow_credentials=True` is only set when `_allowed_origins != ["*"]` — i.e., wrap line 77 as `allow_credentials=_allowed_origins != ["*"]`; and add `"http://localhost:5175"` and `"http://localhost:3000"` to the explicit dev-mode allowlist instead of using the wildcard — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Add `check_ai_auth(request)` and `check_rate_limit(request, "ai_chat")` to `POST /api/chat/reset` at `chat.py:95` and `POST /api/chat/session` at `chat.py:105` — H/L, score 3.0; tied with existing top 10
- Replace unchecked `X-Forwarded-For` extraction in `_client_id()` at `middleware.py:38-40` with `request.client.host`, or add a `TRUSTED_PROXIES` config list — H/L, score 3.0; tied with existing top 10
- Add `max_length=2000` to `customFactors` and `max_length=120` to the list fields in `PredictiveAnalysisRequest` and `WeatherForecastRequest` — M/L, score 2.0; does not displace top 10
- Add `check_ai_auth(request)` to `GET /api/ai/context` at `ai_context.py:13` — M/L, score 2.0; does not displace top 10
- Condition `allow_credentials` on whether specific origins are configured in `main.py:77` — L/L, score 1.0; does not displace top 10

## 📚 Archive (one line per past run)
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
