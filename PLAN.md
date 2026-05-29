# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-29T04:15:00Z
Last run: #24 — Lens: Security

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
### Run #24 — 2026-05-29 — Lens: Security
**Scope:** Second security pass. `middleware.py`, `main.py`, `config.py`, `chat.py`, `deep_analysis.py`, `grounded_search.py`, `predict.py`, `ai_context.py`, `explore.py`, `routes/admin.py` (Python), `routes/admin.rs` (Rust). Active Recommendations #6, #7, #10 (from Run #9) excluded from re-reporting.

**Findings:**

- OBSERVATION: `middleware.py:38-40` — `_client_id()` builds the per-client rate-limit key by taking the first IP in the `X-Forwarded-For` header without any proxy trust validation. The function does `forwarded.split(",")[0].strip()` on the raw header value, so any unauthenticated client can set `X-Forwarded-For: 8.8.8.8` to have their rate-limit bucket charged against `ip:8.8.8.8` instead of their actual IP. An attacker can cycle through arbitrary spoofed IPs to avoid their own bucket filling, effectively bypassing IP-based rate limiting across all tiers (ai_chat, ai_deep, ai_search, ai_maps, data_default). Note: API-key-authenticated clients are tracked separately via their hashed key (`f"key:{md5}"`) and are not affected by this bypass. Fix: only honor `X-Forwarded-For` when `request.client.host` is in a configured trusted-proxy list (e.g., an env-var `TRUSTED_PROXIES`), or always use `request.client.host` and treat XFF as informational.

- OBSERVATION: `chat.py:95-108` — Two endpoints lack `check_ai_auth` and `check_rate_limit`. `POST /api/chat/session` (line 105) creates a UUID session in the in-process `_sessions` LRU dict (`claude.py:33-41`). The LRU cap is `MAX_SESSIONS = 100` (line 26). An unauthenticated caller can POST to `/api/chat/session` in a loop at zero Anthropic cost; once the LRU cycles past 100, the oldest legitimate user sessions are silently evicted. The next chat from that user reaches `append_to_session` (line 53) which re-creates an empty session — the user loses all prior conversation context with no error signal. `POST /api/chat/reset` (line 95) allows any caller with a known session UUID to destroy any session's history. Session UUIDs are returned in the chat response body, so a user who shares a chat response (e.g., copies the JSON) also shares their session UUID. Fix: add `check_ai_auth` to both endpoints; add `check_rate_limit(request, "ai_chat")` to `/api/chat/session`.

- OBSERVATION: `middleware.py:50-78` — The Redis sliding-window rate-limit check is inside a bare `except Exception as e` (line 76) that logs a warning and returns `None` (allow request) on any Redis error. Failure modes include: Redis connection refused on startup, Redis OOM (key eviction), TCP timeout, and Redis server restart. During any Redis unavailability window — which can last minutes — all rate limiting silently drops for every endpoint in every tier. When the app runs in dev mode (`ADMIN_TOKEN` unset, line 94-96 in the same file), `check_ai_auth` also returns `None`, so both the auth gate and the rate limit gate fail open simultaneously. Fix: return a 503 or 429 response when Redis is unavailable (fail-closed strategy); alternatively, implement an in-process fallback counter using a `threading.Lock`-guarded dict for the current process as a last resort.

- OBSERVATION: `ai_context.py:12-32` — `GET /api/ai/context` requires no authentication and is not registered with `check_ai_auth` or `check_rate_limit`. The endpoint returns the full assembled AI system prompt context: current AQI readings, fire/earthquake/water data, freshness metadata for all sources, and the exact field names and data structure injected into every Claude AI message. While the data is environmental rather than user-private, this endpoint discloses the complete system prompt context format to any unauthenticated caller. An attacker studying the output can map the exact context structure, identify which data sources are live vs. stale, and craft targeted prompt injection strings that reference known context fields. Fix: add `check_ai_auth(request)` to the route, or at minimum add `check_rate_limit(request, "data_default")` to limit bulk probing.

- OBSERVATION: `chat.py:88-92`, `deep_analysis.py:86-93`, `predict.py:92-97`, `grounded_search.py:82-88` — On unhandled exceptions, all four AI routes return `"details": str(e)` in the HTTP 500 response body. Python exception messages from asyncpg include database object names (`UndefinedColumnError: column "foo" does not exist`), from httpx include internal service addresses (`ConnectError: [Errno 111] Connection refused` on `http://localhost:3001/`), and from anthropic include API response structures. These strings are returned verbatim in the JSON response body, disclosing internal implementation details to any caller who can trigger an error. `traceback.print_exc()` in the same blocks correctly writes full stack traces to server stderr only — but `str(e)` exposes the first exception line to clients. Fix: replace `"details": str(e)` with `"details": "Internal error — see server logs"` in all production-facing error handlers; gate verbose details behind a `settings.debug` flag if needed.

- OBSERVATION: `main.py:62-78` — CORS is misconfigured in both modes. (a) Dev mode (`ADMIN_TOKEN` unset, line 69): `_allowed_origins = ["*"]` is combined with `allow_credentials=True` (line 76). Starlette's `CORSMiddleware` reflects the actual request `Origin` header into `Access-Control-Allow-Origin` for credentialed requests even when the origins list is `["*"]`, meaning any web origin can make credentialed CORS requests to all API endpoints. (b) Production mode (`ADMIN_TOKEN` set, lines 63-67): `_allowed_origins` is hardcoded to three localhost addresses. Any production deployment of the frontend at a non-localhost domain will fail all browser-enforced CORS checks, causing every API call to fail. Fix: (a) set `allow_credentials=False` when `allow_origins=["*"]`; (b) add an `ALLOWED_ORIGINS` env var to `config.py` and extend `_allowed_origins` from it in production.

**Proposed actions:**
- Validate `X-Forwarded-For` against a `TRUSTED_PROXIES` env var in `middleware.py:38`; fall back to `request.client.host` when no trusted proxy is configured — M/L, score 2.0; does not displace top 10 (all H/L = 3.0)
- Add `check_ai_auth` and `check_rate_limit` to `POST /api/chat/reset` and `POST /api/chat/session` in `chat.py:95,105` — M/L, score 2.0; does not displace top 10
- Fail rate limiter closed (return 429 or 503) when Redis is unavailable at `middleware.py:76`; add in-process fallback counter — H/L, score 3.0; ties current top 10, does not displace
- Add `check_ai_auth` to `GET /api/ai/context` in `ai_context.py:12` — M/L, score 2.0; does not displace top 10
- Replace `"details": str(e)` with a generic message in all four AI route error handlers; gate verbose details behind `settings.debug` — M/L, score 2.0; does not displace top 10
- Fix CORS: set `allow_credentials=False` in dev mode; add `ALLOWED_ORIGINS` env var to `config.py` and wire it into `_allowed_origins` in `main.py:67` — H/M, score 1.5; does not displace top 10

### Run #23 — 2026-05-29 — Lens: Data pipeline integrity
**Scope:** Second data pipeline pass. All Rust ingestion files (`broadcast.rs`, `purpleair.rs`, `usgs.rs`, `redis_cache.rs`, `aqi.rs`, `db/persist.rs`); all Python analytics clients (`airnow.py`, `nws_sounding.py`, `epa_aqs.py`, `usgs_water.py`, `nasa_firms.py`, `noaa_cdo.py`, and remaining secondary clients); shared `http_client.py`; routes `airnow.py`, `epa_aqi.py`, `historical_aqi.py`. Prior Run #8 findings (retry on PurpleAir, Redis toggle) are Active Recommendations #2/#3 and excluded from re-reporting.

**Findings:**

- OBSERVATION: `broadcast.rs:111-115` and `aqi.rs:99-136` and `db/persist.rs:5-35` — When `cache.read().await` returns `None` (PurpleAir not configured, or Redis-gated and Redis is unavailable), the broadcast loop at line 111 calls `aqi::generate_readings(&stations)`, which produces mock readings with `source: "mock"` and randomized AQI values. These are then passed directly to `persist::write_readings(&pool, &readings)` at line 115. The `persist.rs` INSERT at lines 8–15 has no filter on `source` and no `ON CONFLICT` guard — every call inserts a new row unconditionally. The historical AQI query in `historical_aqi.py:29` SELECTs from `sensor_readings` without a `WHERE source != 'mock'` clause. Any historical chart, ML model training (`aqi_model.py:257`), or exported report silently includes fabricated AQI values for every broadcast interval during which PurpleAir data was unavailable. Fix: add `WHERE source != 'mock'` to all analytical queries against `sensor_readings`; or conditionally skip `persist::write_readings` when `source == "mock"`.

- OBSERVATION: `usgs.rs:107` — `let client = reqwest::Client::new()` creates a fresh `reqwest::Client` instance on every call to `fetch_recent()`. `reqwest::Client` internally owns a connection pool, TLS session cache, and DNS resolver. `spawn_earthquake_poller` in `broadcast.rs:136` calls `usgs::fetch_and_persist(&pool)` (line 154) on every tick of `interval_secs`. Each tick creates a new client, discards the existing pool, and pays a fresh TLS handshake to `earthquake.usgs.gov`. The `PurpleAirClient` struct at `purpleair.rs:36-46` correctly holds a persistent `http: reqwest::Client` field and is constructed once in `main.rs:41`. The USGS client has no equivalent struct. Fix: introduce `pub struct UsgsClient { http: reqwest::Client }` with a `new()` constructor, store it in `AppState`, and pass it into `spawn_earthquake_poller` — same pattern as `PurpleAirClient`.

- OBSERVATION: `airnow.py:48,64,78` — `AirNowClient.__init__` creates `self._http = httpx.AsyncClient(timeout=15.0)`. The `get_current_observations` method at line 64 and `get_forecast` at line 78 call `resp.raise_for_status()` with no retry on 5xx or timeout. A shared `http_client.py` module already exists at `geointellisense-analytics/app/http_client.py` and implements 3-attempt retry with exponential backoff (1s, 2s, 4s) for 429 and 5xx responses, and catches `httpx.TimeoutException` with the same backoff. `nasa_firms.py:17` and `usgs_water.py:13` both import and use `from app.http_client import fetch as http_fetch`. `airnow.py` does not. Additionally, `get_all_sjv_current` at line 87 catches per-city exceptions and continues the loop, so a 503 from AirNow for Bakersfield produces a partial 200 response — the caller at `airnow.py:36` returns `{"count": N, "readings": [...]}` with Bakersfield silently absent and no field indicating degraded coverage.

- OBSERVATION: `nws_sounding.py:273-275` — `get_inversion_status()` contains the comment "Fetch both in parallel-ish" but uses two sequential `await` calls: `surface = await fetch_surface_obs()` (line 274) then `sounding = await fetch_sounding_850mb()` (line 275). `fetch_surface_obs()` has a 15-second timeout (`httpx.AsyncClient(timeout=15.0)` at line 130). `fetch_sounding_850mb()` iterates through `hours_back in [0, 12, 24]` (line 169), each attempt using a 20-second timeout (line 189). In the worst case — NWS API slow and all three UWyo retries exhaust — the inversion route wall-clock latency is up to 15s + (3×20s) = 75 seconds before returning. Any downstream caller with a 30s read timeout will see a request error even though surface data arrived at second 15. Fix: replace with `surface, sounding = await asyncio.gather(fetch_surface_obs(), fetch_sounding_850mb())` — the two sources are independent and parallelism is the stated intent.

- OBSERVATION: `broadcast.rs:87-93, 103-113` and `redis_cache.rs:31-36` — When a PurpleAir fetch fails (line 91-92), `tracing::warn!("PurpleAir fetch failed: {e}, cache unchanged")` is logged and the `LiveCache` retains its previous value. The broadcast loop at lines 103-113 re-broadcasts the cached readings every tick, re-stamping them with `timestamp: now` (line 107). The Redis snapshot cache at `redis_cache.rs:33` has a 120-second TTL (`set_ex(&key, json, 120)`), preventing Redis from serving data older than 2 minutes. However, the in-memory `LiveCache` (`Arc<RwLock<Option<Vec<AqiReading>>>>`) has no TTL and no `cached_at` timestamp — it can retain readings indefinitely. After a prolonged PurpleAir outage, SSE consumers receive readings whose `timestamp` field is current but whose `pm25`, `aqi`, and pollutant values are arbitrarily stale, with no machine-readable freshness indicator. Fix: replace `LiveCache` content type with `(Vec<AqiReading>, DateTime<Utc>)` (or a wrapper struct), record the fetch time, and set `category` to `"Stale"` (or add a `data_age_secs` field in the SSE payload) when the cache age exceeds 2× the PurpleAir poll interval.

- OBSERVATION: `epa_aqs.py:83-86` and `epa_aqi.py:128-139` — `EpaAqsClient._throttled_get()` calls `resp = await self._http.get(url, params=params)` then `resp.raise_for_status()` with no retry. The EPA AQS API undergoes scheduled maintenance; a 502 or 503 mid-backfill causes an exception that bubbles up to `epa_aqi.py:_run_backfill`'s inner `except` at line 136, which logs the failure and advances to the next county/year combo. There is no retry mechanism and no mechanism to re-queue failed batches. A single 60-second maintenance window touching 3 parameter codes across 6 counties can permanently skip up to 18 county/year/param combinations from the historical record — the only recovery is manually re-running the backfill and cross-referencing `_backfill_status["errors"]`. Fix: add retry logic in `_throttled_get` (already have `asyncio.sleep` infrastructure), or switch to using `http_client.py:fetch` with `max_retries=3`.

- OBSERVATION: `nws_sounding.py:169-175` — `fetch_sounding_850mb` iterates `for hours_back in [0, 12, 24]` to find the most recent sounding. The `target` variable at line 170 is set to `now` with `hour = 12 if (now.hour >= 6) else 0`. When the current UTC hour is between 06:00 and 11:59, `target.hour` is set to 12 — but the 12Z sounding has not yet launched (radiosondes are released at 00:00Z and 12:00Z UTC; data is available ~30 minutes after launch). The function will request the 12Z sounding for today from UWyo, receive an empty or error response, waste a 20-second HTTP call, then fall back to subtracting 12 hours to land at 00Z — which is the correct most-recent sounding. Additionally, `hours_back = 24` at line 169 is intended as a further fallback, but the subtraction from a fixed `target` (already pinned to 00Z or 12Z today) means `hours_back=24` lands on the same-hour sounding yesterday — not necessarily the preceding 00Z/12Z pair. Fix: enumerate actual sounding times explicitly: iterate candidate datetimes `[12Z today, 00Z today, 12Z yesterday, 00Z yesterday]` and request only times ≤ `now`.

**Proposed actions:**
- Add `WHERE source != 'mock'` filter to `historical_aqi.py:29` SELECT and to ML training queries in `aqi_model.py`; or gate `persist::write_readings` in `broadcast.rs:115` behind a `source != "mock"` check — H/M, score 1.5; does not enter top 10
- Create `UsgsClient` struct in `usgs.rs` holding a persistent `reqwest::Client`; pass it through `spawn_earthquake_poller` in `broadcast.rs` — M/L, score 2.0; does not enter top 10
- Replace `AirNowClient._http` direct calls in `airnow.py:64,78` with `from app.http_client import fetch as http_fetch`; add partial-failure indicator field to `get_all_sjv_current` response — M/L, score 2.0; does not enter top 10
- Replace sequential `await` calls in `nws_sounding.py:274-275` with `asyncio.gather(fetch_surface_obs(), fetch_sounding_850mb())` — M/L, score 2.0; does not enter top 10
- Add `cached_at: DateTime<Utc>` to `LiveCache` in `broadcast.rs`; emit `data_age_secs` in SSE/snapshot payload when age > 2× poll interval — M/L, score 2.0; does not enter top 10
- Add retry loop to `EpaAqsClient._throttled_get()` in `epa_aqs.py:83` for 5xx responses (reuse existing `asyncio.sleep` pattern) — M/M, score 1.0; does not enter top 10
- Fix `fetch_sounding_850mb` in `nws_sounding.py:169` to enumerate `[12Z today, 00Z today, 12Z yesterday, 00Z yesterday]` and skip future times — M/M, score 1.0; does not enter top 10

### Run #22 — 2026-05-29 — Lens: UX / UI flaws
**Scope:** Second UX/UI pass. All component files in `components/` (AnalysisView.tsx, CalendarView.tsx, ChatView.tsx, Dashboard.tsx, DataExplorer.tsx, ErrorMessage.tsx, LoadingStates.tsx, Sidebar.tsx, Toast.tsx), `styles/theme-light.css`, `index.html` (Tailwind brand-color definitions). Prior Run #7 findings and Active Recommendation #1 (`dangerouslySetInnerHTML`) excluded from consideration.

**Findings:**

- OBSERVATION: `components/ChatView.tsx:84` — The chat input uses `onKeyPress={(e) => e.key === 'Enter' && handleSend()}`. `onKeyPress` is deprecated in the DOM Living Standard and in React's TypeScript types; the replacement is `onKeyDown`. Additionally, the `<input>` element at line 80 has no `aria-label` attribute and no associated `<label>` element — only a `placeholder="Ask about the San Joaquin Valley..."`. Placeholders disappear on focus and are not a valid accessible name substitute under WCAG 1.3.1 (Info and Relationships). Screen readers using browse mode announce the input's purpose from the placeholder, but once typing begins the label context is gone. The send `<button>` at line 88 has a `title` attribute only when `!hasApiKey` (a tooltip, not an accessible name), but no `aria-label` at all, so in the default enabled state screen readers announce "Send" from the button text — which is acceptable but the button-to-input pairing has no programmatic relationship. Fix: replace `onKeyPress` with `onKeyDown`; add `<label htmlFor="chat-input" className="sr-only">Chat message</label>` and `id="chat-input"` to the input.

- OBSERVATION: `components/AnalysisView.tsx:445` — The inline error block `{error && <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg">{error}</div>}` has no `role="alert"` or `aria-live` attribute. This div is conditionally rendered after a failed analysis — errors like "No historical data found for Fresno" appear here. Because the element is not a live region, screen reader users navigating linearly will only discover the error message if they happen to tab past it; it is never announced reactively. A separate `role="status" aria-live="polite" aria-atomic="true"` div exists at line 268 for screen-reader-only status feedback during loading, but it is cleared after the analysis completes and does not relay the `error` state. Fix: add `role="alert"` to the error container at line 445 — `role="alert"` is implicitly `aria-live="assertive"` and causes immediate announcement on render.

- OBSERVATION: `components/CalendarView.tsx:119-133,150-181` — The calendar widget has significant ARIA gaps for a complex interactive grid. (a) Previous-month and next-month navigation buttons at lines 119-124 and 128-133 display only the text "← Prev" and "Next →" (Unicode arrow + word) with no `aria-label` — screen readers announce the raw arrow character followed by the word, yielding "left-pointing arrow Prev" and "Next right-pointing arrow". (b) Day-of-week header divs at lines 136-143 (`['Sun', 'Mon', ...]`) are plain `<div>` elements with no `role="columnheader"` or `abbr` attribute — WCAG 1.3.1 requires column headers be semantically identified. (c) Calendar day `<button>` elements at lines 150-181 have no `aria-label` providing the full date (e.g., `"May 15, 2026 — AQI 87"`), no `aria-selected` prop to expose selection state programmatically (selection is tracked visually via `isSelected` CSS but never surfaced to the accessibility tree), and the outer `<div className="grid grid-cols-7 gap-2">` (lines 147, 186) has neither `role="grid"` nor `role="row"` for each week row — the ARIA grid pattern recommended by WAI-ARIA for interactive calendar widgets is absent entirely. Fix: add `role="grid"`, `role="row"`, `role="gridcell"`, `aria-selected`, and descriptive `aria-label` per day button; add `aria-label="Previous month"` and `aria-label="Next month"` to navigation buttons.

- OBSERVATION: `components/DataExplorer.tsx:189,193,205,209` — The "Time Range" `<label>` at line 189 and the "Granularity" `<label>` at line 205 are not associated with their respective `<select>` controls. Neither label has a `htmlFor` attribute, and neither `<select>` has an `id` attribute — the programmatic label-control relationship is missing entirely. Without this association, screen readers announce the select dropdowns as unlabeled (or fall back to surrounding text heuristics). The "Data Sources" label at line 167 has the same issue — it labels a group of toggle buttons visually but has no `role="group"` wrapper or `aria-labelledby` reference. This is distinct from the properly-labeled controls in `AnalysisView.tsx` (which correctly use `htmlFor`/`id` pairs). Fix: add matching `id="time-range-select"` + `htmlFor="time-range-select"` and `id="granularity-select"` + `htmlFor="granularity-select"`; wrap the source buttons in `<fieldset><legend>Data Sources</legend>...</fieldset>` or use `role="group" aria-labelledby`.

- OBSERVATION: `components/Toast.tsx:39` — The toast notification container uses `className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm"`. `max-w-sm` is 384px (Tailwind default). On a viewport narrower than 400px (e.g., 320px iPhone SE, 360px Android budget phones), the container's left edge extends off-screen: `right: 16px` means the container occupies from `320px - 16px - 384px = -80px` to `320px - 16px = 304px`, clipping 80px of toast content off the left side. Users on narrow-screen devices cannot read the leftmost portion of any notification message. Individual `ToastItem` elements at line 67 use `text-sm flex items-center gap-3` — the text wraps, but the container itself is not constrained to the viewport. Fix: change `max-w-sm` to `max-w-[calc(100vw-2rem)]` or add a responsive class `w-[calc(100vw-2rem)] sm:max-w-sm` with `left-4` on small screens.

- OBSERVATION: `components/Dashboard.tsx:582-591` — The "Daily (Coming Soon)" button at line 587 carries the `disabled` attribute but its Tailwind classes include `hover:bg-brand-secondary` without a `disabled:` modifier guard. The button's active class string (lines 584-590) is the same as the "not-selected" style of sibling buttons in the granularity group (`bg-brand-bg-lighter text-slate-300`), making it visually indistinguishable from a "weekly" button that happens to be inactive — users must infer the difference only from the parenthetical "(Coming Soon)" text. No `disabled:opacity-50`, `disabled:cursor-not-allowed`, or `title` attribute is present. Browsers suppress pointer-events on disabled elements so the hover variant won't actually fire, but the cursor remains a default pointer on desktop rather than `not-allowed`, and the button's affordance is ambiguous. Fix: add `disabled:opacity-50 disabled:cursor-not-allowed` and `title="Daily view coming soon"` to the button class string.

**Proposed actions:**
- Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84`; add `id="chat-input"` to the input and an associated sr-only `<label>` — M/L, score 2.0; does not enter top 10
- Add `role="alert"` to the error div at `AnalysisView.tsx:445` — M/L, score 2.0; does not enter top 10
- Add `role="grid"`, `role="row"`, `role="gridcell"`, `aria-selected`, `aria-label` per day, and navigation button `aria-label` to `CalendarView.tsx:119-181` — M/M, score 1.0; does not enter top 10
- Add `htmlFor`/`id` pairs to "Time Range" and "Granularity" selects in `DataExplorer.tsx:189-209`; wrap source buttons in a labelled group — M/L, score 2.0; does not enter top 10
- Fix toast overflow on narrow screens: change `max-w-sm` at `Toast.tsx:39` to `w-[calc(100vw-2rem)] sm:max-w-sm` — M/L, score 2.0; does not enter top 10
- Add `disabled:opacity-50 disabled:cursor-not-allowed title="Daily view coming soon"` to the disabled button at `Dashboard.tsx:587` — L/L, score 1.0; does not enter top 10

## 📚 Archive (one line per past run)
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
