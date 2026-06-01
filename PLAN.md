# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T08:10:00Z
Last run: #99 — Lens: Security

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
### Run #99 — 2026-06-01 — Lens: Security
**Scope:** Ninth security pass. Examined: `geointellisense-analytics/app/middleware.py`, `geointellisense-analytics/app/main.py`, `geointellisense-analytics/app/config.py`, `geointellisense-analytics/app/routes/admin.py`, `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/explore.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/routes/weather_forecast.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/grounded_maps.py`, `geointellisense-analytics/app/routes/deep_analysis.py`. Cross-checked against Active Recommendations and runs #96–#98 (Latest Findings) plus archived security runs #9, #24, #39, #54, #69, #84 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `chat.py:95-102` and `chat.py:105-107` — `POST /api/chat/reset` and `POST /api/chat/session` are missing `check_ai_auth()` calls entirely. Every other AI-touching endpoint in the codebase (`/api/chat`, `/api/deep-analysis`, `/api/grounded-search`, `/api/grounded-maps`, `/api/low-latency`) calls `check_ai_auth(request)` as its first line. `chat_reset` at `chat.py:95-102` calls `reset_session(session_id)` — a destructive in-memory operation — for any `session_id` provided in the JSON body, with no authentication requirement. Because `create_session()` generates a UUID (visible in the `/api/chat` response body's `sessionId` field), an attacker who intercepts or guesses session UUIDs can destroy any active user's conversation history. `new_session()` at `chat.py:105-107` creates server-side session state with no auth, allowing an unauthenticated attacker to pre-create large numbers of sessions to exhaust memory. Neither endpoint has a rate-limit call either. Additionally, both handlers lack a `request: Request` parameter, making it mechanically impossible to add auth without refactoring the signature. PROPOSAL: Add `request: Request` parameter and `check_ai_auth(request)` + `await check_rate_limit(request, "ai_chat")` calls to both `chat_reset` (line 96) and `new_session` (line 106) — H/L, score 3.0; does not displace top 10 (tied with existing H/L rows, tiebreak favors earlier first-seen).

- OBSERVATION: `explore.py:41` and `explore.py:146-219` — the `bucket` query parameter (`str`, default `"1 day"`) is accepted without whitelist validation and is passed as `$1::interval` to nine separate `time_bucket()` calls (one per data source). PostgreSQL's `time_bucket()` accepts any valid `INTERVAL` expression, including `'1 microsecond'`. With `days=365` (the max allowed) and `bucket=1 microsecond`, each query requests `365 * 24 * 60 * 60 * 1,000,000 ≈ 31.5 trillion` buckets from TimescaleDB; the query will exhaust PostgreSQL's working memory and crash the connection pool. The cache at `explore.py:48-51` — `cache_key = {"src": sources, "days": days, "bucket": bucket}` — is keyed on `bucket`, so each unique `bucket` string gets its own cache entry; an attacker cycles through `"1 microsecond"`, `"2 microseconds"`, `"1 nanosecond"` etc. to bypass the cache on every request. The endpoint at `explore.py:37-89` has no `check_ai_auth()` call, making it publicly reachable without credentials. This is a unauthenticated resource-exhaustion (DoS) path into the database. PROPOSAL: Add `ALLOWED_BUCKETS = frozenset({"1 hour", "6 hours", "1 day", "1 week"})` and validate `if bucket not in ALLOWED_BUCKETS: return JSONResponse(status_code=400, ...)` at `explore.py:44` before the cache lookup — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `middleware.py:106` and `admin.py:14` — both files compare secret tokens using Python's built-in equality operator. `middleware.py:106`: `if api_key == settings.admin_token:` and `admin.py:14`: `if token != settings.admin_token:` use CPython's string `__eq__`, which performs an early-exit byte-by-byte comparison. This enables a remote timing side-channel: an attacker can repeatedly submit candidate tokens and measure response latency to determine how many leading bytes of the correct token are matched (longer equal prefix → marginally longer comparison). In a local network or low-jitter environment, this can leak token bytes one at a time. The fix is Python's `hmac.compare_digest()` (stdlib, no new dependency), which guarantees constant-time comparison regardless of the position of the first differing byte. The same pattern is absent from `check_ai_auth` (which compares `api_key == settings.admin_token` at line 106), making the entire auth path vulnerable. PROPOSAL: Add `import hmac` to both `middleware.py` and `admin.py`; replace `api_key == settings.admin_token` at `middleware.py:106` with `hmac.compare_digest(api_key, settings.admin_token)`, and replace `token != settings.admin_token` at `admin.py:14` with `not hmac.compare_digest(token, settings.admin_token)` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `main.py:63-78` — the CORS configuration has two distinct problems. (1) In dev mode (when `settings.admin_token` is `""`), `_allowed_origins = ["*"]` at line 70 is combined with `allow_credentials=True` at line 77. Per the Fetch/CORS specification (§4.3.2), a response with `Access-Control-Allow-Origin: *` must not carry `Access-Control-Allow-Credentials: true`; browsers reject such responses. Starlette's `CORSMiddleware` resolves this by returning the actual request `Origin` value (not `*`) when credentials are allowed and any origin is permitted — effectively granting credentialed cross-origin access to ANY origin in dev mode. This means a malicious page on any domain can make credentialed requests (with cookies/auth headers) to the API when running in dev mode, violating the principle of minimum privilege even in development. (2) In production mode (admin_token set), `_allowed_origins` is hard-coded to `["http://localhost:5173", "http://localhost:5174", "http://localhost:8080"]` at lines 63-67. Any deployment that serves the frontend from a real domain (e.g., `https://geointellisense.example.com`) will have all browser requests rejected by CORS with no way to configure the allowed origin without a code change. PROPOSAL: Add `cors_origins: list[str] = []` to `Settings` in `config.py`; populate `_allowed_origins` from this setting in production mode (falling back to localhost if empty); in dev mode, conditionally set `allow_credentials=False` when using `"*"` to avoid the wildcard+credentials violation — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Add `request: Request`, `check_ai_auth`, and rate-limit call to `POST /api/chat/reset` at `chat.py:96` and `POST /api/chat/session` at `chat.py:106` — H/L, score 3.0
- Add `ALLOWED_BUCKETS` whitelist validation to `explore.py:44` before cache lookup; return 400 for unrecognized `bucket` values — M/L, score 2.0
- Replace `==`/`!=` token comparisons with `hmac.compare_digest()` in `middleware.py:106` and `admin.py:14` — M/L, score 2.0
- Add `cors_origins` env-configurable setting; fix wildcard+credentials conflict in dev mode at `main.py:69-78`; add production domain support — M/L, score 2.0

### Run #98 — 2026-06-01 — Lens: Data pipeline integrity
**Scope:** Eighth data-pipeline-integrity pass. Examined: `geointellisense-ingestion/src/usgs.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/redis_cache.rs`, `geointellisense-ingestion/src/db/persist.rs`, `geointellisense-analytics/app/clients/airnow.py`, `geointellisense-analytics/app/clients/nasa_firms.py`, `geointellisense-analytics/app/clients/usgs_water.py`, `geointellisense-analytics/app/routes/fires.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/routes/inversion.py`, `geointellisense-analytics/app/http_client.py`, `geointellisense-analytics/app/source_toggles.py`, `geointellisense-analytics/app/cache.py`. Cross-checked against Active Recommendations and runs #95–#97 (Latest Findings) plus archived data-pipeline-integrity runs #8, #23, #38, #53, #68, #83 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `usgs.rs:107` — `fetch_recent()` calls `reqwest::Client::new()` inside the function body on every invocation. The earthquake poller in `broadcast.rs:154` calls `usgs::fetch_and_persist(&pool).await` on every polling tick (default every `earthquake_interval_secs`). Creating a new `reqwest::Client` per tick defeats connection pooling: each call opens a fresh TCP+TLS connection to `earthquake.usgs.gov`, pays TLS handshake cost, and discards the connection on return. By contrast, `PurpleAirClient` at `purpleair.rs:36-47` correctly stores `reqwest::Client` as a struct field. Additionally, `reqwest::Client::new()` at `usgs.rs:107` applies no request timeout — `reqwest::Client`'s default timeout is infinite. The `.send().await?` at `usgs.rs:122` will block indefinitely if USGS's FDSN endpoint hangs (which occurs during routine USGS maintenance windows). Since the earthquake poller runs in a `tokio::spawn` task, a hung `.send().await?` permanently blocks that task's single future without ever timing out, leaving earthquake data stale with no error emitted. PROPOSAL: Extract `reqwest::Client` into `usgs::Client` struct (mirroring `PurpleAirClient`); configure `reqwest::ClientBuilder::new().timeout(std::time::Duration::from_secs(30)).build()` at construction time; store the client in `broadcast::AppState` or pass it into `fetch_and_persist` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `airnow.py:87-103` and `airnow.py:109-135` — Both `get_all_sjv_current()` and `get_all_sjv_forecast()` iterate over `SJV_LOCATIONS` (6 cities) in a `for loc in SJV_LOCATIONS:` loop using sequential `await` per city rather than `asyncio.gather`. At `airnow.py:89`, `await self.get_current_observations(...)` awaits completion before moving to the next city; at `airnow.py:111`, `await self.get_forecast(...)` does the same. Since `AirNowClient.__init__` configures `timeout=15.0` (line 48), each individual city call can take up to 15 seconds. In the worst case — AirNow responding slowly for all 6 cities — `get_all_sjv_current()` takes 6 × 15 = 90 seconds before returning, and `get_all_sjv_forecast()` adds another 90 seconds. The `/api/airnow/current` route at `airnow.py:36` calls `await client.get_all_sjv_current()` directly (no route-level timeout), so a uvicorn worker can be blocked for up to 90 seconds per request. The sequential pattern also means a slow city early in the list (e.g., Bakersfield at index 0) delays all subsequent cities. The fix is a `asyncio.gather(*[self.get_current_observations(loc["lat"], loc["lng"]) for loc in SJV_LOCATIONS], return_exceptions=True)` pattern, reducing worst-case to one round-trip time across all 6. PROPOSAL: Replace sequential `await` loops in `airnow.py:87-103` and `airnow.py:109-135` with `asyncio.gather(..., return_exceptions=True)`; handle `Exception` results per-element in the gathered output — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `nasa_firms.py:59-77` and `nasa_firms.py:124-155` — `fetch_active_fires()` at `nasa_firms.py:59-77` checks only for HTTP 401 (line 74) before passing `resp.text` to `_parse_csv()`. All other HTTP status codes that `http_client.py` considers client errors (4xx) will cause `resp.raise_for_status()` to propagate an exception, which `fetch_all_sources:93` catches and logs. However, NASA FIRMS's CDN can return HTTP 200 with an HTML error page (e.g., "Service Temporarily Unavailable" in HTML) when the API is overloaded — a documented edge case for FIRMS. In this case, `resp.status_code < 400` is true (so `http_client.py` treats it as success and returns the response), and `_parse_csv(resp.text, source)` at `nasa_firms.py:77` silently parses the HTML. `csv.DictReader` in `_parse_csv:126` will interpret the HTML `<html>` tag line as a single-column header named `"<html>"`, and each subsequent HTML line will produce a row that fails the `lat = float(row.get("latitude", 0))` parse and triggers `if lat == 0: continue` — returning an empty list. The caller in `fetch_all_sources:90` logs `"FIRMS %s: 0 detections"` and proceeds normally. The poll loop at `fires.py:51-58` then runs `_smoke_context = get_smoke_context([])` → `_smoke_context = ""`, silently clearing any previously-valid smoke context. Operators have no way to distinguish "zero fires detected" (correct) from "CDN error page served" (incorrect). PROPOSAL: In `fetch_active_fires` at `nasa_firms.py:59-77`, add `content_type = resp.headers.get("content-type", ""); if not content_type.startswith("text/csv"): raise ValueError(f"FIRMS returned non-CSV content-type: {content_type!r}")` before calling `_parse_csv` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `water.py:109-110` — The DB fallback query in `water_current()` at `water.py:86-110` swallows all exceptions with a bare `except Exception: rows = []` at line 109, with no logging call. If the database is temporarily unavailable, the query at `water.py:100` raises `asyncpg.exceptions.TooManyConnectionsError` or `ConnectionFailureError`; the exception is silently discarded and `rows = []`, which causes the handler to proceed to check `is_enabled("usgs_water")` and potentially make a live external USGS API call even when the intent was to serve from DB. This silent swallow means DB errors in the `water_current` path are entirely invisible in logs — operators cannot distinguish "no recent DB readings" (expected at service startup) from "DB down" (requires intervention). By contrast, every other polling error in the same codebase uses `logger.error("... poll failed: %s", e)` (e.g., `water.py:49-50`, `fires.py:66-67`, `inversion.py:60-61`). The fix is trivial: change `except Exception:` to `except Exception as e: logger.warning("water_current DB fallback failed: %s", e)`. PROPOSAL: At `water.py:109`, change `except Exception:` to `except Exception as e: logger.warning("water_current DB fallback failed, proceeding to external API: %s", e)` — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Extract `reqwest::Client` into a `usgs::Client` struct with a 30-second timeout; reuse across earthquake polling ticks at `usgs.rs:107` — M/L, score 2.0
- Replace sequential `await` in `airnow.py:87-103` and `airnow.py:109-135` with `asyncio.gather(..., return_exceptions=True)` — M/L, score 2.0
- Add content-type validation in `fetch_active_fires` at `nasa_firms.py:73-74` before calling `_parse_csv` — M/L, score 2.0
- Add `logger.warning()` to the bare `except Exception` at `water.py:109` — M/L, score 2.0

### Run #97 — 2026-06-01 — Lens: UX / UI flaws
**Scope:** Seventh UX/UI flaws pass. Examined: `ChatView.tsx`, `AnalysisView.tsx`, `CalendarView.tsx`, `Dashboard.tsx`, `DataExplorer.tsx`, `Header.tsx`, `Sidebar.tsx`, `LoadingStates.tsx`, `Toast.tsx`, `SettingsView.tsx`, `components/dashboard/LiveDashboard.tsx`, `components/dashboard/widgets/AqiGaugeWidget.tsx`, `components/dashboard/widgets/InversionWidget.tsx`, `styles/theme-light.css`, `index.html`, `App.tsx`. Cross-checked against Active Recommendations and runs #94–#96 (Latest Findings) plus archived UX/UI flaws runs #7, #22, #37, #52, #67, #82 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `ChatView.tsx:84` — The chat input uses `onKeyPress={(e) => e.key === 'Enter' && handleSend()}`. `onKeyPress` was deprecated in the WHATWG HTML Events specification (removed 2021) and in React 17 (console deprecation warning in development builds since React 17.0.0). In React 18, `onKeyPress` still fires but prints a deprecation warning to the browser console on every keystroke. The semantic replacement is `onKeyDown`, which fires for all key presses including Enter, does not carry the deprecation, and has superior mobile accessibility: on iOS VoiceOver with a software keyboard, the virtual "Return" key fires `keydown` but not `keypress` for some input configurations, meaning users of iOS VoiceOver or some mobile IMEs cannot submit chat messages via Enter with the current handler. Additionally, the current handler lacks an `isComposing` guard: if a CJK IME user presses Enter to confirm a composition (e.g., selecting a kanji), the current handler calls `handleSend()` prematurely, submitting an incomplete message mid-composition. PROPOSAL: Replace `onKeyPress={(e) => e.key === 'Enter' && handleSend()}` at `ChatView.tsx:84` with `onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSend()}` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `CalendarView.tsx:119-133` and `CalendarView.tsx:287-292` — Three interactive buttons lack accessible names and keyboard focus indicators. (1) The "← Prev" month button at line 119 uses the class `"px-4 py-2 bg-brand-bg-dark hover:bg-brand-secondary rounded-md transition-colors"` — no `focus:ring-*` Tailwind class, no `aria-label`. Screen readers announce the button as "leftwards arrow Prev button" (Chrome/NVDA) or "left arrow, Prev, button" (Safari/VoiceOver); neither communicates target month. (2) The "Next →" button at line 128 has the same issue, announcing as "Next rightwards arrow button". (3) The Close button at line 287 contains the literal `✕` character and announces as "Close heavy multiplication x button" (Chrome/NVDA) or "Close cross button" (Safari/VoiceOver); neither matches the expected "Close, button" pattern. All three buttons lack focus ring classes: by contrast, `Sidebar.tsx:76` and `AnalysisView.tsx:300` both explicitly apply `focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-light`. Since `theme-light.css` defines no universal `:focus-visible` fallback, sighted keyboard-only users see no focus indicator on these three buttons in any theme. PROPOSAL: Add `aria-label="Previous month"` to the Prev button at `CalendarView.tsx:119`; add `aria-label="Next month"` to the Next button at `CalendarView.tsx:128`; add `aria-label="Close day detail"` and replace the `✕` character with a proper SVG `×` icon on the Close button at `CalendarView.tsx:287`; append `focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-light` to all three buttons' class strings — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `Dashboard.tsx:480-499` — The `renderDateFilter()` function renders two `<input type="month">` elements with no programmatic label associations. The outer `<label>` element at line 482 contains the text "Filter Date Range:" but has no `htmlFor` attribute, making it a non-associated label. Neither date input has an `id` attribute (the start input at line 484 and end input at line 492 are plain `<input type="month">` tags with no `id`). The only visual differentiation between start and end dates is their left-to-right position separated by a hyphen (`-` at line 490), which is purely presentational. Per WCAG 2.1 SC 1.3.1 (Info and Relationships), form inputs require programmatically determinable labels; per SC 3.3.2, visible labels are required for inputs. A screen reader user tabbing to either date input will hear only the browser's native date-picker role ("spinbutton" on Chrome for month inputs) with no accessible label text — they cannot distinguish "start date" from "end date" without visual inspection. The same pattern occurs in the `AnalysisView.tsx` date inputs at lines 339-347 and 352-360, which do have `htmlFor`/`id` pairings (`start-date`, `end-date`) as a correct reference. PROPOSAL: Add `id="filter-start"` to the start date input at `Dashboard.tsx:484`; add `id="filter-end"` to the end date input at `Dashboard.tsx:492`; replace the outer `<label>` with a `<fieldset>`/`<legend>` containing "Date Range", and add individual `<label htmlFor="filter-start">From</label>` and `<label htmlFor="filter-end">To</label>` adjacent to their respective inputs — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `DataExplorer.tsx:169-183` — The data source toggle buttons communicate selection state only through visual styling (selected buttons receive an inline `backgroundColor`/`borderColor` from `meta.color`; unselected buttons use gray `text-slate-400 border-slate-600` classes) but carry no `aria-pressed` attribute. Per WCAG 2.1 SC 4.1.2 (Name, Role, Value), user interface components must expose their current state to accessibility APIs; for toggle buttons, `aria-pressed="true"` when selected and `aria-pressed="false"` when not selected is the standard pattern. A screen reader user cannot determine which data sources are active without tabbing through all buttons and relying solely on visual class changes that are not exposed to the accessibility tree. By contrast, the analysis tool buttons at `AnalysisView.tsx:297` correctly use `aria-pressed={tool === key}`. Additionally, the "Data Sources" `<label>` at `DataExplorer.tsx:167` has no `htmlFor` attribute and no group element role (`role="group"` with `aria-labelledby`) connecting it to the set of toggle buttons — the label floats disconnected from its controlled region. PROPOSAL: Add `aria-pressed={selected.includes(key)}` to the source toggle `<button>` at `DataExplorer.tsx:170`; wrap the source buttons `<div>` at line 168 in `<div role="group" aria-labelledby="datasource-label">`; add `id="datasource-label"` to the `<label>` at line 167 and change it to a `<span>` or `<div>` — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Replace deprecated `onKeyPress` with `onKeyDown` + `isComposing` guard at `ChatView.tsx:84` — M/L, score 2.0
- Add `aria-label` and `focus:ring-*` classes to Prev/Next/Close buttons in `CalendarView.tsx:119,128,287` — M/L, score 2.0
- Add `id`/`label` associations to date range filter inputs in `Dashboard.tsx:484,492`; restructure as fieldset — M/L, score 2.0
- Add `aria-pressed={selected.includes(key)}` to source toggle buttons at `DataExplorer.tsx:170`; wrap in `role="group"` with `aria-labelledby` — M/L, score 2.0

## 📚 Archive (one line per past run)
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
