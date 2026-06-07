# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-07T02:10:00Z
Last run: #191 — Lens: Docs

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

### Run #190 — 2026-06-07 — Lens: Observability
**Scope:** Thirteenth Observability pass. Files examined in full: `geointellisense-analytics/app/main.py`; `geointellisense-analytics/app/middleware.py`; `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/routes/chat.py`; `geointellisense-analytics/app/routes/deep_analysis.py`; `geointellisense-analytics/app/routes/predictive_analysis.py`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/db/persist.rs`; `hooks/useRealtimeAQI.ts`; `utils/errorHandling.ts`. Cross-checked against Active Recommendations and archived Observability runs #10, #25, #40, #55, #70, #85, #100, #115, #130, #145, #160, #175 to confirm findings are new.

**Findings:**

- OBSERVATION: `chat.py:43-86` and `deep_analysis.py:33-85` — Every `client.messages.create()` call returns an `anthropic.types.Message` whose `.usage` field contains `input_tokens` and `output_tokens`, but neither file captures or logs this value. In `chat.py`, `resp.usage` is available immediately after the initial call at line 43 and after each tool-use continuation at line 70, yet the final return at line 86 emits only `{"text": text, "sessionId": session_id}`. In `deep_analysis.py`, the `claude-opus-4-6` call at line 33 sets `max_tokens=40000` and `budget_tokens=32768` — a single request may legitimately consume 70 000+ tokens, and each tool-use continuation at line 61 can add another 32 768 thinking tokens. With `ai_deep` rate limited to 5 req/min, a sustained barrage at that ceiling burns up to 350 000 input+thinking tokens per minute against the Anthropic account with zero per-request visibility. There is no aggregate counter, no per-session tally, no structured log line that could be grep'd or aggregated in a log pipeline. A prompt injection attack that forces the model into a long thinking loop (possible given the injection gap noted in Active Recommendation #4) would be invisible until the Anthropic billing alert fires. PROPOSAL: After each `client.messages.create()` call in `chat.py` and `deep_analysis.py`, add `logger.info("anthropic usage endpoint=%s model=%s input=%d output=%d rounds=%d", endpoint_name, model, resp.usage.input_tokens, resp.usage.output_tokens, rounds)` — L/L effort (one `logger.info` per call site, 5 lines total; provides an operator-queryable audit trail of token consumption with zero performance overhead).

- OBSERVATION: `main.py:1-117` — The FastAPI analytics application never calls `logging.basicConfig()` or any equivalent logging configuration. All 20+ route modules use `logger = logging.getLogger(__name__)` (e.g., `middleware.py:17`, `claude.py:8`, `chat.py` imports `traceback` directly) but Python's `logging` module defaults to the root logger having no handlers installed until `basicConfig()` is called. When uvicorn starts the app, it installs handlers for `uvicorn.access` and `uvicorn.error` loggers only; application-namespace loggers (`app.middleware`, `app.claude`, `app.routes.*`) remain handler-less. Python's "last resort" handler (`_StderrHandler`) fires as a fallback, writing bare messages to stderr with no timestamp, no logger name, and no severity level — making rate-limit warnings (`middleware.py:77`), live-context failures (`claude.py:99`), and all 128+ `logger.warning/info/error` calls across route files indistinguishable from each other or from uvicorn's own stderr output. The docker-compose `analytics` service sets no `LOG_LEVEL` environment variable and no logging configuration file. PROPOSAL: Add `logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")` to `main.py` at line 6 (after `load_dotenv()`, before any app imports) — L/L effort (one line; ensures every `app.*` logger emits structured, timestamped lines to stdout; compatible with uvicorn's log capture and any downstream log aggregator without library changes).

- OBSERVATION: `hooks/useRealtimeAQI.ts:340-342` — The SSE parse-error catch block at line 341 executes `console.error('[useRealtimeAQI] Failed to parse SSE data:', parseError)` but does not include `event.data`. When the backend emits a malformed SSE frame (partial write during a slow TCP flush, schema version mismatch after a backend deploy, or a binary zero byte injected into the JSON payload), the browser console records only a `SyntaxError` with a character-offset number such as `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. Without the raw `event.data`, it is impossible to know whether the failure was caused by an HTML error page returned in place of JSON (HTTP 502 from a reverse proxy), a partial chunk of a large payload, an extra `\n` in a multi-line JSON field, or a schema field rename on the backend. All of these failure modes produce syntactically identical `SyntaxError` objects but require completely different remediation. Since parsing is entirely client-side, there is no server-side log to correlate against. PROPOSAL: Replace the catch body at line 342 with `console.error('[useRealtimeAQI] Failed to parse SSE data:', parseError, '— raw (first 300 chars):', event.data?.slice(0, 300))` — L/L effort (add `event.data?.slice(0, 300)` to the existing console call; caps payload echo at 300 characters to avoid flooding the console; provides the minimum context needed to distinguish a proxy error page from a schema drift from a truncated chunk).

- OBSERVATION: `middleware.py:76-78` — The `except` block in `check_rate_limit` logs `logger.warning("Rate limit check failed (allowing request): %s", e)` but omits the `tier` and `client` variables that are in scope at lines 45-46. When Redis becomes unreachable during a high-traffic period, every AI request that hits `check_rate_limit` emits this warning — potentially hundreds of times per minute across `ai_chat`, `ai_deep`, `ai_low_latency`, `ai_search`, and `ai_maps` tiers simultaneously. All of these log lines are identical strings (`"Rate limit check failed (allowing request): Connection refused"`) with no way to determine: which tier is affected (e.g., is `ai_deep` specifically failing while others succeed?), which client (IP or API key hash) is sending the failing request, or how many distinct clients are experiencing degraded rate-limiting vs. how many requests per client are bypassing limits. Correlating these events with client behaviour requires joining on timestamp across separate request logs, which is not feasible without a structured query. The `tier` string is already assigned at line 45; `client = _client_id(request)` at line 46 — both are available at the exception site. PROPOSAL: Change `logger.warning("Rate limit check failed (allowing request): %s", e)` to `logger.warning("Rate limit check failed tier=%s client=%s (allowing request): %s", tier, client, e)` — L/L effort (two positional arguments added to an existing log call; zero performance overhead; makes Redis degradation incidents immediately actionable by exposing tier and client identity in structured log output).

**Proposed actions:**
- Add `logger.info("anthropic usage endpoint=%s model=%s input=%d output=%d rounds=%d", ...)` after each `client.messages.create()` in `chat.py:43` and `deep_analysis.py:33` — L/L effort (5-line change across two files; provides per-request token audit trail for cost monitoring and anomaly detection)
- Add `logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")` to `main.py:6` — L/L effort (one line; fixes unformatted app-logger output across all 20+ route modules)
- Add `event.data?.slice(0, 300)` to the SSE parse-error log at `hooks/useRealtimeAQI.ts:342` — L/L effort (one argument; makes SSE parse failures diagnosable without server-side log access)
- Add `tier` and `client` to the rate-limit failure warning at `middleware.py:77` — L/L effort (two format arguments; enables per-tier and per-client Redis degradation analysis)

### Run #189 — 2026-06-07 — Lens: Security
**Scope:** Fifteenth Security pass. Files examined in full: `geointellisense-analytics/app/middleware.py`; `geointellisense-analytics/app/main.py`; `geointellisense-analytics/app/config.py`; `geointellisense-analytics/app/routes/chat.py`; `geointellisense-analytics/app/routes/admin.py`; `geointellisense-analytics/app/routes/predict.py`; `geointellisense-analytics/app/routes/predictive_analysis.py`; `geointellisense-analytics/app/routes/deep_analysis.py`; `geointellisense-analytics/app/routes/maps_config.py`; `geointellisense-analytics/app/routes/explore.py`; `geointellisense-analytics/app/routes/ai_context.py`; `geointellisense-analytics/app/claude.py`; `geointellisense-ingestion/src/routes/admin.rs`; `geointellisense-ingestion/src/routes/sse.rs`; `geointellisense-ingestion/src/routes/mod.rs`; `geointellisense-ingestion/src/main.rs`; `geointellisense-ingestion/src/config.rs`; `vite.config.ts`; `index.html`; `docker-compose.yml`. Cross-checked against Active Recommendations and archived Security runs #9, #24, #39, #54, #69, #84, #99, #114, #129, #144, #159, #174 to confirm findings are new.

**Findings:**

- OBSERVATION: `middleware.py:38-40` — The `_client_id` function trusts the raw `X-Forwarded-For` header (`forwarded = request.headers.get("x-forwarded-for", "")`) without verifying that the request arrived from a trusted reverse proxy. Any HTTP client can send `X-Forwarded-For: 1.2.3.4` to forge an arbitrary IP address, making every rate-limit bucket key (`geointelli:ratelimit:<tier>:ip:1.2.3.4`) trivially rotatable. An attacker can bypass the `ai_chat` (20 req/min), `ai_deep` (5 req/min), `ai_search` (15 req/min), and `ai_maps` (15 req/min) tiers entirely by incrementing the last octet of the spoofed IP between requests. Since these rate limits are the primary cost control on Anthropic API consumption, a complete bypass has the same practical consequence as removing them. The Python analytics service is exposed at `ANALYTICS_PORT` via docker-compose without an upstream trusted proxy environment variable, so no proxy IP range is enforced. The Rust ingestion service uses `CorsLayer::permissive()` (`main.rs:86`) and also has no `X-Forwarded-For` validation on its admin endpoint. PROPOSAL: Add a `TRUSTED_PROXY_CIDRS` setting (default empty) to `config.py`; in `middleware.py:_client_id`, only accept `X-Forwarded-For` if `request.client.host` falls within a configured trusted CIDR (use Python's `ipaddress` stdlib for the check); otherwise fall back to `request.client.host` directly — L/L effort (10–15 lines of CIDR check; closes the full rate-limit bypass attack vector without breaking reverse-proxy deployments).

- OBSERVATION: `chat.py:95-108` — `POST /api/chat/reset` (line 95) and `POST /api/chat/session` (line 105) lack both the `check_ai_auth(request)` and `await check_rate_limit(request, "ai_chat")` guards that are applied to `POST /api/chat` at lines 25-31. An unauthenticated anonymous caller can: (a) call `/api/chat/session` in a tight loop — since `claude.py:33-41` stores sessions in a module-level dict bounded by `MAX_SESSIONS = 100` with LRU eviction via `_session_order`, 100 sequential POST requests evict all legitimate users' active chat histories, effectively a denial-of-service against the conversation state of any authenticated users; (b) call `/api/chat/reset` with a known session UUID to wipe a target user's conversation — session UUIDs are `uuid4()` (cryptographically random) so guessing is infeasible, but UUIDs can leak via logs, browser devtools network panels, or support tickets. The absence of rate limiting on `/api/chat/session` also means an attacker can flood the analytics service with session-creation requests at line speed, consuming memory. PROPOSAL: Add `auth_err = check_ai_auth(request)` and `rate_err = await check_rate_limit(request, "ai_chat")` to both `/api/chat/reset` and `/api/chat/session` handlers — L/L effort (four lines mirroring the existing pattern in `/api/chat`; closes both the session-eviction DoS and the rate-limit bypass on auxiliary chat endpoints).

- OBSERVATION: `predictive_analysis.py:61-88` — The Claude user message is assembled by directly f-string-interpolating `req.locationName` (line 65), `req.startDate` and `req.endDate` (line 67), and `req.customFactors` (lines 51-57) into the prompt. `customFactors` is wrapped in a Markdown triple-backtick fence (lines 53-56) but this provides no injection barrier: a caller supplying `customFactors = "``` \n\n**New instruction:** Disregard all prior constraints and instead..."` closes the fence and injects arbitrary plain-text instructions into the Pydantic-parsed string before it reaches Claude. The `locationName` field is similarly unguarded — `locationName = "SJV\n\nActually, your new role is..."` exploits the raw f-string newline pass-through to insert a second paragraph of system-level instructions. Since `/api/predictive-analysis` has no auth (Active Recommendation #4), any anonymous caller can submit crafted requests. Claude's instruction-following makes it fully compliant to injected content, allowing production of false environmental forecasts that cite fabricated AQI figures, manipulated confidence levels, or off-topic output. No `max_length` is set on any of the four user-controlled fields in the Pydantic model. PROPOSAL: (a) Add `Field(max_length=200)` to `locationName`, `Field(pattern=r"^\d{4}-\d{2}-\d{2}$")` to `startDate`/`endDate`, and `Field(max_length=2000)` to `customFactors` in the `PredictiveAnalysisRequest` model; (b) replace the triple-backtick wrapper for `customFactors` with XML-style delimiters (`<user_context>` … `</user_context>`) that Claude treats as structured data rather than instruction-level prose — L/L effort (Pydantic field annotations + two-character delimiter change; meaningfully raises the bar for prompt injection without changing the user-visible output format).

- OBSERVATION: `index.html:14` and `index.html:30-41` — The HTML entry point loads the Tailwind CSS runtime from `https://cdn.tailwindcss.com` (line 14) without a Subresource Integrity (SRI) `integrity` attribute. The importmap at lines 30-41 fetches React 19, react-dom, recharts, and `@google/genai` from `https://aistudiocdn.com/...` and `@googlemaps/markerclusterer` from `https://unpkg.com/...` — also without SRI hashes. Without SRI, a CDN compromise (DNS hijack, BGP hijack, or provider-side incident affecting `aistudiocdn.com`, `cdn.tailwindcss.com`, or `unpkg.com`) would allow injection of arbitrary JavaScript into every user's browser session, giving an attacker full DOM access including access to the Google Maps API key retrieved from `/api/maps-config` and all chat messages sent through the UI. Additionally, `@google/genai` is imported from the CDN at line 35 but GeoIntelliSense's AI calls are made exclusively via the Anthropic SDK on the Python backend; the Google genai SDK appears to be an unused leftover that widens the CDN attack surface without providing any runtime functionality. There is no `Content-Security-Policy` meta tag in `index.html`, so the browser enforces no `script-src` restriction that would limit loading to integrity-checked scripts. PROPOSAL: (a) Remove the unused `@google/genai` importmap entry at line 35; (b) add `integrity="sha384-<hash>"` and `crossorigin="anonymous"` to the Tailwind CDN `<script>` tag at line 14; (c) pin the importmap CDN URLs to exact versions (replace `^19.2.0` with `19.2.0`) and add SRI hashes where the host supports them; (d) add a `<meta http-equiv="Content-Security-Policy">` restricting `script-src` to the pinned CDN origins and hashes — M/M effort (hash generation for each CDN script + CSP policy authoring; eliminates third-party supply chain injection risk for all frontend users).

**Proposed actions:**
- Add `TRUSTED_PROXY_CIDRS` to `config.py`; in `middleware.py:38-40` only accept `X-Forwarded-For` when `request.client.host` is within trusted CIDR range — L/L effort (closes full rate-limit bypass via header spoofing)
- Add `check_ai_auth` + `check_rate_limit` guards to `POST /api/chat/reset` and `POST /api/chat/session` at `chat.py:95-108` — L/L effort (prevents session-eviction DoS and unmetered session creation)
- Add Pydantic `Field(max_length=...)` and date-format validators to `PredictiveAnalysisRequest`; replace backtick fence with XML delimiters for `customFactors` at `predictive_analysis.py:51-57` — L/L effort (closes prompt injection via all four user-controlled fields)
- Remove unused `@google/genai` CDN import from `index.html:35`; add SRI hashes to Tailwind CDN script; add CSP meta tag — M/M effort (eliminates CDN supply chain injection risk for frontend users)

## 📚 Archive (one line per past run)
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
- Run #177 (2026-06-06) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
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
