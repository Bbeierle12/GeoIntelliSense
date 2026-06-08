# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-08T00:15:00Z
Last run: #204 — Lens: Security

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
| 10 | `aiService.ts:getChatResponse` reads only `data.text`, discarding the `sessionId` returned by `chat.py:86` — every request creates a new Python session via `create_session()` so multi-turn context is silently lost | TS↔Python/UX | H | L | 201 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #204 — 2026-06-08 — Lens: Security
**Scope:** Fourteenth security pass. Files examined in full: `geointellisense-analytics/app/middleware.py`, `geointellisense-analytics/app/config.py`, `geointellisense-analytics/app/routes/water_quality.py`, `geointellisense-analytics/app/routes/explore.py`, `geointellisense-analytics/app/routes/admin.py`, `geointellisense-analytics/app/routes/maps_config.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/deep_analysis.py`, `geointellisense-analytics/app/routes/grounded_maps.py`, `geointellisense-analytics/app/routes/low_latency.py`, `geointellisense-ingestion/src/routes/admin.rs`, `geointellisense-ingestion/src/config.rs`, `.env.local.example`. Cross-checked against Active Recommendations and archived security runs #9, #24, #39, #54, #69, #84, #99, #114, #129, #144, #159, #174, #189 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/routes/water_quality.py:313-333` — `POST /api/water-quality/backfill` has no authentication check. The handler accepts `county_fips` and `start_date` query parameters and immediately launches a background task (`asyncio.create_task(_run_backfill(...))`) that calls `fetch_key_contaminants()` to retrieve water quality records from the external WQP (Water Quality Portal) API and then inserts them into the `water_quality` PostgreSQL table via `_persist_samples()`. The only protection is `is_enabled("wqp")` — a source-toggle feature flag, not authentication. Any unauthenticated HTTP client on the internet can POST to `/api/water-quality/backfill` and trigger a multi-thousand-record external API fetch plus database write operation. This is the same root cause as Active Recommendations row #3 (`POST /api/predict/train` unauthenticated) but is a separate, unreported route. Compare: the Rust `/api/admin/cache/flush` requires an `x-admin-token` header (`admin.rs:18-30`), and the Python `admin.py` routes use `_check_admin()`. The backfill endpoint shares neither protection. PROPOSAL: Add `x_admin_token: str = Header(None)` and `_check_admin(x_admin_token)` call at the start of `water_quality.py:313`'s handler body, matching the pattern at `admin.py:20-23` — H/L effort (~3 lines; blocks unauthenticated WQP backfill triggering).

- OBSERVATION: `geointellisense-analytics/app/middleware.py:95` + `geointellisense-analytics/app/config.py:15` + `.env.local.example` — The `check_ai_auth()` function at `middleware.py:82-112` contains a deliberate "dev mode" bypass: `if not settings.admin_token: return None` (line 95). When `settings.admin_token` is falsy, the function returns `None` (access granted) without inspecting any request header. `config.py:15` sets the default `admin_token: str = ""` — an empty string, which is falsy in Python. The `.env.local.example` template file (the only setup documentation for the Python service) does not mention `ADMIN_TOKEN` at all, making it likely to be absent from operator-configured `.env` files. The consequence: any deployment where `ADMIN_TOKEN` is not explicitly set in `.env` — the default state per the example file — exposes all five AI endpoints (`/api/chat`, `/api/grounded-search`, `/api/deep-analysis`, `/api/grounded-maps`, `/api/low-latency`) to unauthenticated callers with unrestricted Anthropic API usage. The comment at `middleware.py:95` ("In dev mode (no admin_token), skip auth") frames this as intentional, but since `admin_token = ""` is the default, "dev mode" is also the default production mode. PROPOSAL: (a) Add `ADMIN_TOKEN=` with a comment to `.env.local.example` instructing operators to set it before deploying; (b) change `middleware.py:95` to log a `logger.warning("ADMIN_TOKEN not set — AI endpoints unprotected")` rather than silently bypassing; (c) consider changing the default behavior to deny-by-default when `ADMIN_TOKEN` is absent — H/L effort (~5 lines; converts silent open-access default into an explicit operator opt-in).

- OBSERVATION: `geointellisense-analytics/app/middleware.py:38-40` — The `_client_id()` function that drives all per-client rate-limit buckets reads the `x-forwarded-for` header directly from the request without any trusted-proxy validation: `forwarded = request.headers.get("x-forwarded-for", "")` then `ip = forwarded.split(",")[0].strip()`. Since this header is set by the HTTP client (not validated by the Python service), any caller can supply `X-Forwarded-For: 1.2.3.4` to claim an arbitrary IP address. By rotating through a sequence of fake IPs (e.g., `1.2.3.1`, `1.2.3.2`, ...), an attacker can make each request appear to come from a unique IP and bypass per-IP sliding-window limits entirely. The AI endpoint rate limits — 20/min for chat, 5/min for deep analysis, 15/min for search — are the primary cost-control mechanism against Anthropic API abuse; bypassing them via header spoofing makes them ineffective. The `x-api-key` path at `middleware.py:35-37` is not affected since it keys on the API key hash, not IP. In production behind a load balancer (e.g., the `Caddyfile` configuration at the repo root), the actual client IP should be trusted from the load balancer's own appended IP, not the client-supplied header. PROPOSAL: Either (a) ignore `x-forwarded-for` entirely and use `request.client.host` exclusively (safe when the load balancer is on the same host, per the `Caddyfile`), or (b) validate that `x-forwarded-for` is set by a trusted proxy by checking `request.client.host` against a `TRUSTED_PROXY_IPS` allowlist before trusting the header — H/L effort (~8 lines; closes IP-rotation rate-limit bypass for all AI endpoints).

- OBSERVATION: `geointellisense-analytics/app/routes/water_quality.py:315` — The `start_date` query parameter accepted by `POST /api/water-quality/backfill` is typed as `str` with no format or range validation: `start_date: str = Query("01-01-2015", description="Start date (MM-DD-YYYY)")`. This string is passed directly to `_run_backfill(county_fips, start_date)` at line 332, which passes it to `fetch_key_contaminants(county_fips=county_fips, start_date=start_date)`. The WQP API accepts date ranges and will return records from the provided start date to the present. An attacker (exploiting finding #1 above — no auth) can supply `start_date=01-01-1900` to force the server to request 125+ years of water quality records from the WQP API, resulting in a massive HTTP response payload, unbounded memory allocation during parsing, and a large burst of `INSERT` operations against the `water_quality` table. The in-process `asyncio.Task` holding this data has no timeout and no record-count cap; the only protection is the existing `ON CONFLICT DO NOTHING` clause in `_persist_samples()` which prevents duplicate inserts but does not limit the fetch size. PROPOSAL: Add a `start_date` validation regex (`re.fullmatch(r'\d{2}-\d{2}-\d{4}', start_date)`) and a minimum-year check (e.g., year ≥ 1990) in `water_quality.py:341` before calling `fetch_key_contaminants()` — M/L effort (~4 lines; prevents resource exhaustion via extreme date ranges; complements auth fix in finding #1).

**Proposed actions:**
- Add `_check_admin(x_admin_token)` guard to `POST /api/water-quality/backfill` at `water_quality.py:313`, matching the pattern in `admin.py:20-23` — H/L effort (~3 lines; blocks unauthenticated backfill triggers)
- Add `ADMIN_TOKEN=` with a warning comment to `.env.local.example`; add `logger.warning()` in `middleware.py:95` when admin_token is unset — H/L effort (~5 lines; prevents silent open-access deployment default)
- Replace `x-forwarded-for` IP extraction at `middleware.py:38-40` with `request.client.host` or trusted-proxy validation — H/L effort (~8 lines; closes per-IP rate-limit bypass via header spoofing)
- Add regex + year-range validation for `start_date` at `water_quality.py:315` — M/L effort (~4 lines; prevents resource exhaustion via extreme date ranges)

### Run #203 — 2026-06-07 — Lens: Data pipeline integrity
**Scope:** Sixteenth data pipeline integrity pass. Files examined in full: `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/db/persist.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-analytics/app/http_client.py`, `geointellisense-analytics/app/cache.py`, `geointellisense-analytics/app/context.py`. Cross-checked against Active Recommendations and archived data pipeline runs #8, #23, #38, #53, #68, #83, #98, #113, #128, #143, #158, #173, #188 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/routes/sse.rs:37` and `sse.rs:50` — Both `.data(serde_json::to_string(&*quakes).unwrap())` (line 37) and `.data(serde_json::to_string(readings.as_ref()).unwrap())` (line 50) call `.unwrap()` on the result of `serde_json::to_string()`. If the value being serialized contains an IEEE 754 special value — `NaN` or `±Infinity` — in any `f64` field, `serde_json` returns `Err(Error::Io(...))` because JSON does not have a representation for these values, and the `.unwrap()` causes the async task to panic. The `AqiReading` struct carries eight `f64` sensor fields (`pm25`, `pm10`, `o3`, `no2`, `so2`, `co`, `temperature`, `humidity`) all sourced from external hardware via `purpleair.rs`. PurpleAir API responses are parsed with `serde_json` from raw sensor payloads; a sensor malfunction or calibration event can produce `NaN` readings (e.g., a PM2.5 sensor reporting invalid calibration data). A single such reading in the broadcast channel causes the SSE handler task at line 50 to panic, disconnecting every connected SSE client simultaneously and stopping all future SSE broadcasts for the lifetime of the process. The panic at line 37 (initial earthquake snapshot) is lower-probability since USGS earthquake magnitudes are floats but always finite, but the pattern remains dangerous. Neither unwrap site is wrapped in a `serde_json::to_string().unwrap_or_else(|_| "{}".into())` fallback or `if let Ok(json) = serde_json::to_string(...) { ... }` guard. PROPOSAL: Replace both `.unwrap()` calls with `match serde_json::to_string(...) { Ok(json) => ..., Err(e) => { tracing::error!("Serialization failed: {e}"); return None; } }` in the SSE stream filter, and add a NaN/Inf sanitisation step in `purpleair.rs` before readings enter the `LiveCache` — H/L effort (~8 lines; prevents SSE-service crash on sensor NaN output).

- OBSERVATION: `geointellisense-ingestion/src/routes/aqi.rs:24` and `geointellisense-ingestion/src/broadcast.rs:107-108` — Both the REST snapshot handler and the broadcast ticker rewrite every `AqiReading.timestamp` to `chrono::Utc::now()` immediately before serving the data: `aqi.rs:24` does `aqi::AqiReading { timestamp: now, ..r.clone() }` and `broadcast.rs:107-108` does `AqiReading { timestamp: now, ..r.clone() }`. The PurpleAir polling task (`broadcast.rs:56-94`) caches raw readings into `LiveCache` with the timestamp set at fetch time; those timestamps are then overwritten before every REST response and every SSE broadcast message. This means: (a) when PurpleAir fetch succeeds, readings that are 5–10 minutes old (since the last poll) are served with `timestamp = <current second>`, making them indistinguishable from readings fetched 1 second ago; (b) when PurpleAir fetch fails (`broadcast.rs:91` — "cache unchanged"), the stale cache from the previous successful poll (potentially many minutes or hours old if PurpleAir is repeatedly unreliable) is re-served continuously, with each SSE message stamping it as fresh; (c) the snapshot endpoint at `aqi.rs:26-29` generates entirely synthetic mock data when `cache.as_ref()` is `None` and also stamps it with `now`. Consumers — including `hooks/useRealtimeAQI.ts` which uses the timestamp to display "last updated" in the UI — have no way to detect data staleness from the timestamp field alone. PROPOSAL: Remove the timestamp override in both `aqi.rs:24` and `broadcast.rs:107-108`; instead add a `served_at: DateTime<Utc>` field to `SnapshotResponse` for the REST case, keeping `readings[].timestamp` as the actual sensor measurement time — H/L effort (~6 lines; gives consumers accurate data age information and exposes PurpleAir unavailability via timestamp gaps).

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:111` and `broadcast.rs:115` — When `LiveCache` is `None` (i.e., PurpleAir has never returned a successful reading or the fetch key is missing), the broadcast ticker at line 111 calls `aqi::generate_readings(&stations)` to produce fully synthetic mock readings. These synthetic readings are then: (1) passed to `persist::write_readings(&pool, &readings)` at line 115, inserting mock sensor values into the `sensor_readings` PostgreSQL table as if they were real measurements; (2) serialized and cached in Redis at line 121-122 with no differentiation from real data; (3) sent to all SSE subscribers at line 128. The `AqiReading` struct has a `source: String` field (persisted at `persist.rs:25`), and `aqi::generate_readings` may set this to a value like `"mock"` or `"synthetic"` — but examining `broadcast.rs`, the source field is not checked before persist, and the persistence call at line 115 happens unconditionally regardless of whether readings came from PurpleAir or from the mock generator. If `source = "mock"` is written to the `sensor_readings` table, historical queries that do not filter by source will mix real and synthetic data silently. Additionally, `aqi.rs:26-29` (the REST snapshot) also returns mock data without any `"isMock": true` flag in the `SnapshotResponse` JSON schema. PROPOSAL: (a) Add a boolean `is_mock: bool` field to `SnapshotResponse` and to the SSE event payload; (b) skip `persist::write_readings()` when readings originate from mock generator at `broadcast.rs:115` — H/M effort (~10 lines; prevents mock contamination of historical DB and gives consumers a reliable liveness signal).

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:34` and `geointellisense-ingestion/src/routes/sse.rs:51` — The broadcast channel is created with capacity 64 (`broadcast::channel::<Arc<Vec<AqiReading>>>(64)` at `broadcast.rs:34`). Rust's `tokio::sync::broadcast` uses a ring-buffer; when a subscriber falls more than 64 messages behind, it receives `RecvError::Lagged(n)` on its next receive attempt, indicating it missed `n` messages. The SSE stream wraps this channel via `BroadcastStream::new(rx)` at `sse.rs:44`; the `.filter_map()` at line 45-53 handles errors with `Err(_) => None`, silently discarding lagged messages and continuing the stream. There is no counter increment, no tracing event, and no reconnection hint (e.g., an `event: lag` SSE frame) sent to the client when lag occurs. In normal operation (broadcast every few seconds, one reading per tick), the buffer is unlikely to fill; however, if the broadcast ticker runs at sub-second intervals or if network back-pressure causes an SSE client to slow down, the client loses data points with no indication of the gap. The `useRealtimeAQI.ts` hook in the frontend has no reconnect-on-gap logic triggered by missed messages, because it receives no signal that a gap occurred. PROPOSAL: In the `Err(_)` branch at `sse.rs:51`, send an SSE event of type `"lag"` with a JSON payload containing the number of missed messages (extractable from `RecvError::Lagged(n)`), and increment a `tracing::warn!` counter — M/L effort (~6 lines; makes data gaps visible to both clients and operations monitoring).

**Proposed actions:**
- Replace `.unwrap()` at `sse.rs:37` and `sse.rs:50` with structured error handling; add NaN/Inf sanitisation in `purpleair.rs` before readings enter `LiveCache` — H/L effort (~8 lines; prevents SSE-service panic on bad sensor values)
- Remove timestamp override in `aqi.rs:24` and `broadcast.rs:107-108`; add `served_at` to response types — H/L effort (~6 lines; exposes real data age to consumers)
- Add `is_mock: bool` flag to `SnapshotResponse` and SSE events; skip `persist::write_readings()` for mock readings at `broadcast.rs:115` — H/M effort (~10 lines; prevents mock contamination of DB and signals data source to clients)
- Emit `"lag"` SSE event in `Err(_)` branch at `sse.rs:51` with missed-message count — M/L effort (~6 lines; makes broadcast ring-buffer overflows visible to clients and operators)

### Run #202 — 2026-06-07 — Lens: UX / UI flaws
**Scope:** Fifteenth UX / UI flaws pass. Files examined in full: `components/CalendarView.tsx`, `components/ChatView.tsx`, `components/Dashboard.tsx`, `components/DataExplorer.tsx`, `components/AnalysisView.tsx`, `components/AirQualityMapView.tsx`, `components/Header.tsx`, `components/Sidebar.tsx`, `components/LoadingStates.tsx`, `App.tsx`. Cross-checked against Active Recommendations and archived UX/UI runs #7, #22, #37, #52, #67, #82, #97, #112, #127, #142, #157, #172, #187 to confirm findings are new.

**Findings:**

- OBSERVATION: `CalendarView.tsx:21` — `currentDate` state is initialized to `new Date('2025-11-13')` — a hardcoded date that was 7 months in the past by June 2026. A user opening the Calendar view sees November 2025 by default and must click "Next →" 7 times (one per month) to reach the current month, with no "Today" button, no keyboard shortcut, and no auto-advance logic. The `selectedDate` state (line 22) initializes to `null` with no auto-selection of today's date even when data exists for today. The hardcoded date also means `calendarDays` (line 71) will compute a grid anchored to Nov 2025, showing stale forecast data even though `dashboardData[].dailyForecast` is indexed by date string. PROPOSAL: Change `useState(new Date('2025-11-13'))` to `useState(new Date())` at `CalendarView.tsx:21` and optionally add a "Today" button in the navigation header — L/L effort (~1 line; surfaces current month immediately without requiring 7 "Next" clicks).

- OBSERVATION: `ChatView.tsx:84` — The chat input uses `onKeyPress={(e) => e.key === 'Enter' && handleSend()}`. The `keypress` event was deprecated by the WHATWG Living Standard and Chrome's intent-to-deprecate notes vendor removal; React 18 logs "Warning: The `onKeyPress` event will be removed from React 18" when `onKeyPress` is used. Functionally, `keypress` also does not fire for non-printable keys on certain virtual keyboards (Android soft keyboard), so pressing Enter on a mobile keyboard may silently fail to send the message — a broken primary interaction on mobile. The `onKeyDown` event fires reliably across all keyboard types (hardware, virtual, and accessibility). PROPOSAL: Replace `onKeyPress` at `ChatView.tsx:84` with `onKeyDown` — L/L effort (~5 characters; eliminates deprecated-event dependency and fixes the mobile Enter-to-send regression).

- OBSERVATION: `Dashboard.tsx:482-498` — The date range filter rendered by `renderDateFilter()` contains a `<label>` at line 482 ("Filter Date Range:") with no `htmlFor` attribute, and both `<input type="month">` elements at lines 484 and 491 lack `id` attributes. Without a `htmlFor`↔`id` link, the programmatic label association required by WCAG 1.3.1 (Info and Relationships, Level A) is absent — a screen reader user focusing either month input hears only the browser default ("month, year, edit") with no announcement of what the filter does or which end of the range it represents. Compare: the identical month inputs in `AnalysisView.tsx:336-362` correctly use `id="start-date"` + `htmlFor="start-date"` pairs. The Dashboard implementation regresses from that established pattern in the same codebase. PROPOSAL: Add `htmlFor="dash-start"` and `htmlFor="dash-end"` to a split label pair, and `id="dash-start"` / `id="dash-end"` to the inputs at `Dashboard.tsx:484-491` — L/L effort (~4 attribute additions; fixes WCAG 1.3.1 label association for both month inputs).

- OBSERVATION: `DataExplorer.tsx:392-394` — The Claude analysis result is rendered via `dangerouslySetInnerHTML={{ __html: claudeResult.replace(/\n/g, '<br />') }}` with no HTML sanitization. The prompt sent at `DataExplorer.tsx:122-140` includes raw JSON from `data.data.slice(-30)` — 30 data points sourced from the live AQI ingestion pipeline. If any ingested sensor reading contains unescaped HTML characters (e.g., a `windDirection` field set to a string like `"N<script>..."` inserted via the Rust ingestion pipeline at `geointellisense-ingestion/src/aqi.rs`), Claude may echo those characters in its response and they will be injected as raw HTML in the Explorer panel. This is the same root cause as Active Recommendations row #1 (which cites `AnalysisView.tsx:450`) but is a separate, previously unreported code path; the `DataExplorer` `askClaude` entrypoint passes ingested time-series data directly into Claude's context on every invocation, making it the higher-frequency XSS exposure. PROPOSAL: Apply the same `DOMPurify.sanitize()` (or plain-text render via `<pre>` wrapping) fix to `DataExplorer.tsx:392` when row #1 is fixed — H/L effort (~2 lines; extends XSS protection to the Explorer panel).

**Proposed actions:**
- Fix stale hardcoded date: change `new Date('2025-11-13')` to `new Date()` at `CalendarView.tsx:21` and add a "Today" button — L/L effort (~1–5 lines; makes Calendar open on current month)
- Replace deprecated `onKeyPress` with `onKeyDown` at `ChatView.tsx:84` — L/L effort (~5 characters; fixes mobile Enter-to-send and eliminates React 18 deprecation warning)
- Add `htmlFor`/`id` pairs to date range filter at `Dashboard.tsx:482-491` matching the `AnalysisView.tsx:336-362` pattern — L/L effort (~4 attribute additions; satisfies WCAG 1.3.1)
- Apply HTML sanitization to `DataExplorer.tsx:392` (same fix as Active Recommendations row #1) — H/L effort (~2 lines; closes second unguarded XSS path in Explorer panel)

## 📚 Archive (one line per past run)
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
