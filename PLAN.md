# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T23:10:00Z
Last run: #114 — Lens: Security

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
### Run #114 — 2026-06-01 — Lens: Security
**Scope:** Eighth security pass. Examined: `geointellisense-analytics/app/main.py` (full), `geointellisense-analytics/app/middleware.py` (full), `geointellisense-analytics/app/config.py` (full), `geointellisense-analytics/app/routes/admin.py` (full), `geointellisense-analytics/app/routes/maps_config.py` (full), `geointellisense-analytics/app/routes/predict.py` (full), `geointellisense-analytics/app/routes/explore.py` (full), `geointellisense-analytics/app/routes/ai_context.py` (full), `geointellisense-analytics/app/routes/landsat.py` (full, route side), `geointellisense-analytics/app/clients/landsat.py` (lines 1–30, 323–345), `geointellisense-analytics/app/routes/chat.py` (middleware imports), `geointellisense-analytics/app/routes/deep_analysis.py` (middleware imports). Enumerated all routes for `check_ai_auth`/`check_rate_limit` calls. Cross-checked against Active Recommendations and runs #112–#113 (Latest Findings) plus archived security runs #9, #24, #39, #54, #69, #84, #99 (one-line archive) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/main.py:69-78` — The CORS middleware is configured with `allow_credentials=True` unconditionally (line 77), but in dev mode (when `settings.admin_token` is the empty string default from `config.py:15`) the `_allowed_origins` list is overridden to `["*"]` at line 70. Per the CORS Level 2 specification (and Starlette's own warning: `"CORS: Cannot use allow_credentials=True with wildcard 'allow_origins'"`) this combination is **invalid**: the `Access-Control-Allow-Origin: *` header and `Access-Control-Allow-Credentials: true` header cannot legally appear together in the same response. Modern browsers (Chrome 119+, Firefox 121+, Safari 17+) silently discard cross-origin responses that present this combination and reject the request with a CORS error — the front-end SPA at `http://localhost:5173` therefore cannot make credentialed cross-origin calls to the API in dev mode when no `admin_token` is set. The fix is straightforward: move `allow_credentials=True` inside the production branch only (when `_allowed_origins != ["*"]`), or remove it entirely since the API currently uses `x-api-key` header-based auth (which does not require `allow_credentials`) rather than cookies. PROPOSAL: At `main.py:72–78`, pass `allow_credentials=False` when `_allowed_origins == ["*"]`; alternatively, remove `allow_credentials=True` from the `CORSMiddleware` call entirely since no route relies on cookies — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/landsat.py:159-166` and `geointellisense-analytics/app/clients/landsat.py:331` — The `GET /api/landsat/tile/ndvi-change/{product}/{z}/{x}/{y}.png` endpoint declares `product: str = Path(...)` with no validation constraint. At line 166 the handler constructs `filename = f"{product}.tif"` and at `clients/landsat.py:331` resolves `path = DATA_DIR / filename`. Python's `pathlib.Path` does NOT canonicalize traversal sequences during division: `Path("/app/data/landsat") / "../../etc/someconfig.tif"` yields the path `/app/data/landsat/../../etc/someconfig.tif`, which resolves to `/app/etc/someconfig.tif`. The `.tif` suffix prevents reading most OS-level secrets, but rasterio's `open()` at `clients/landsat.py:343` will attempt to parse any reachable file with that extension as a GeoTIFF — triggering a rasterio error that bubbles up and is caught by the bare `except Exception: return None` at line 368, so no information is leaked. The risk is that a determined attacker could fingerprint the filesystem layout by probing which paths exist (transparent PNG returned from non-existent `.tif`) versus which paths produce rasterio parse errors (different response timing). The correct fix is to validate `product` against the output of `get_computed_products()` (which lists all valid product stems via `DATA_DIR.glob("ndvi_change_*.tif")` at `clients/landsat.py:430`) before building the filename. PROPOSAL: In the `ndvi_change_tile` handler at `routes/landsat.py:163`, call `get_computed_products()` and validate that `product` is in the returned list; return HTTP 404 immediately if not — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/explore.py:41-42` and `explore.py:151-160` — The `GET /api/analysis/explore` endpoint accepts a `bucket: str` query parameter with no allowlist constraint (`bucket: str = Query("1 day", description="Time bucket: 1 hour, 6 hours, 1 day")`). The value is passed as the first positional parameter to PostgreSQL's `time_bucket($1::interval, time)` function in all five source queries at `explore.py:151-218`. An attacker can pass `bucket=1 second` combined with `days=365`, instructing TimescaleDB to compute 31,536,000 one-second buckets across a full year of `sensor_readings` rows per query. The `/api/analysis/explore` endpoint applies only the `data_default` rate limit (60 req/min per client IP) inherited from `middleware.py:26`, meaning a single client can issue 60 such queries per minute. Each query scans the full `sensor_readings` table partitioned by day and performs a massive GROUP BY — this is sufficient to saturate the DB at high ingestion volumes. The hint in the description (`"1 hour, 6 hours, 1 day"`) documents the intended values but they are not enforced. PROPOSAL: Replace the `bucket: str` parameter at `explore.py:41` with `bucket: Literal["1 hour", "6 hours", "1 day"] = Query("1 day")` (using `typing.Literal` or a FastAPI `Enum`), which causes FastAPI to reject any other value with HTTP 422 before the query is issued — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/ai_context.py:12-32` — The `GET /api/ai/context` endpoint is completely unauthenticated and does not call `check_ai_auth` or `check_rate_limit`. It returns `build_live_context()` — the full assembled object that is injected into Claude's system prompt on every AI request — including live AQI readings from all PurpleAir sensors, active fire locations with FRP values, earthquake events, water levels, EnviroScreen scores, and inversion layer state. The `freshness` sub-objects for each data source (e.g. `{"status": "unavailable", "last_seen": null}` or `{"status": "fresh", "age_seconds": 12}`) reveal which data pollers are active, which are failing, and how recently each data pipeline wrote to the DB. An unauthenticated external caller can use this endpoint to: (a) extract all real-time sensor readings without going through the intended data endpoints; (b) perform reconnaissance on poller health to identify which pipelines to target for disruption; (c) observe inversion layer and AQI data ahead of time before a premium alert feature would surface it. The 60-second cache at `CONTEXT_TTL = 60` limits DB load but not attacker query rate. PROPOSAL: Add `check_ai_auth(request)` (at minimum a rate-limit check via `check_rate_limit(request, "data_default")`) to `ai_context()` at `ai_context.py:12`; import `Request` from FastAPI and `check_rate_limit` from `app.middleware` — L/L effort.

**Proposed actions:**
- Fix CORS misconfiguration at `main.py:72-78`: pass `allow_credentials=False` when `allow_origins=["*"]` (dev mode), or remove `allow_credentials=True` entirely — L/L effort
- Validate `product` path parameter against `get_computed_products()` at `routes/landsat.py:163` before constructing filesystem path — L/L effort
- Change `bucket: str` to `bucket: Literal["1 hour", "6 hours", "1 day"]` at `explore.py:41` to block expensive sub-hour timeseries queries — L/L effort
- Add `check_rate_limit(request, "data_default")` (and optionally `check_ai_auth`) to `GET /api/ai/context` at `ai_context.py:12` — L/L effort

### Run #113 — 2026-06-01 — Lens: Data pipeline integrity
**Scope:** Ninth data pipeline integrity pass. Examined: `geointellisense-ingestion/src/purpleair.rs` (full), `geointellisense-ingestion/src/usgs.rs` (full), `geointellisense-ingestion/src/redis_cache.rs` (full), `geointellisense-ingestion/src/broadcast.rs` (full), `geointellisense-ingestion/src/main.rs` (full), `geointellisense-ingestion/src/aqi.rs` (full), `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-analytics/app/http_client.py` (full), `geointellisense-analytics/app/clients/nasa_firms.py` (full), `geointellisense-analytics/app/clients/usgs_water.py` (full), `geointellisense-analytics/app/routes/fires.py` (full), `geointellisense-analytics/app/routes/water.py` (full), `geointellisense-analytics/app/context.py` (full), `geointellisense-analytics/app/source_toggles.py`, `db/migrations/011_water_readings.sql`. Cross-checked against Active Recommendations and runs #111–#112 (Latest Findings) plus archived data pipeline runs #8, #23, #38, #53, #68, #83, #98 (one-line archive) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/context.py:397,419` — The `_get_water_context()` function (called inside `build_live_context()` which feeds Claude's system prompt) executes a query that selects the column `unit` (singular) from the `water_readings` table: `SELECT DISTINCT ON (site_id) site_id, site_name, value, unit, time FROM water_readings`. However, `db/migrations/011_water_readings.sql:7` defines the column as `units` (plural), and the corresponding `_persist_readings()` at `routes/water.py:291` inserts into `units`. The correct pattern — aliasing the real column as the shorter name — is used in `routes/water.py:91` and `routes/water.py:103` which both write `units AS unit`. The context.py query omits the alias, so PostgreSQL/asyncpg raises `UndefinedColumnError: column "unit" does not exist` at runtime. This exception is caught by the bare `except Exception as e: logger.warning(...)` at `context.py:404`, which silently returns `{"stations": [], "freshness": {"status": "unavailable"}}`. The consequence is that water-level data (USGS discharge readings for 7 SJV stations) is **never** injected into Claude's live context, regardless of whether the USGS Water poller is active and has fresh DB data — active recs rows for data pipeline assume the source is wired up, but this bug severs the final delivery step. PROPOSAL: In `_get_water_context()` at `context.py:397`, replace `value, unit, time` with `value, units AS unit, time` — L/L effort; promotes to Active Recommendations as row #10.

- OBSERVATION: `geointellisense-ingestion/src/usgs.rs:107` — The `fetch_recent()` function contains `let client = reqwest::Client::new();` inside the function body. `fetch_recent()` is called by `fetch_and_persist_bbox()` which is called by `fetch_and_persist()` on every earthquake poll cycle. With the default `earthquake_interval_secs = 300` (5 minutes, from `config.rs:35`), this means a new `reqwest::Client` is constructed 288 times per day. Each `Client::new()` allocates a new connection pool, a new TLS session cache, and new keep-alive state — none of which carry over to the next poll cycle, preventing TCP connection reuse. This contrasts with `purpleair.rs:44` where `PurpleAirClient::new()` creates the client once in the constructor and reuses `self.http` across all `fetch_sensors()` calls. The USGS API endpoint (`earthquake.usgs.gov`) supports keep-alive and benefits from connection reuse; eliminating repeated TLS handshakes reduces per-poll latency by ~100–200ms. PROPOSAL: Add a `UsgsClient` struct holding `http: reqwest::Client` (mirroring the `PurpleAirClient` pattern), pass it into `spawn_earthquake_poller()` and `fetch_recent()`, and initialize it once in `main.rs` alongside `PurpleAirClient` — M/M effort.

- OBSERVATION: `geointellisense-analytics/app/http_client.py:31-34` — The retry loop creates a new `httpx.AsyncClient` on every attempt:
  ```python
  for attempt in range(max_retries + 1):
      try:
          async with httpx.AsyncClient(timeout=timeout) as client:
              resp = await client.request(...)
  ```
  Because `async with httpx.AsyncClient(...) as client:` is **inside** the `for attempt in range(max_retries + 1):` loop body, each retry attempt (whether triggered by a `TimeoutException`, a 5xx response, or a 429) creates a brand-new connection pool and discards the previous one. This means: (a) the TCP connection established on attempt 0 is closed before the retry wait begins, so attempt 1 must perform a full new DNS lookup and TLS handshake; (b) `Retry-After` sleep (line 44) delays the retry but the connection teardown still happens before the sleep, so the wait time is wasted; (c) the intent of the shared `http_client.py` module — to improve over raw one-off `httpx` calls — is partially defeated for the 5xx/429 retry path. This affects all six clients that use `http_fetch`: `nasa_firms.py`, `usgs_water.py`, `airnow.py`, `epa_aqs.py`, `noaa_cdo.py`, and others. PROPOSAL: Move the `async with httpx.AsyncClient(timeout=timeout) as client:` block to wrap the entire `for attempt` loop, replacing lines 31–34 with a single outer `async with` and an inner loop that calls `client.request(...)` directly — L/L effort; eliminates connection teardown between retry attempts.

- OBSERVATION: `geointellisense-analytics/app/context.py:61-68` — `build_live_context()` awaits eight data-fetching coroutines sequentially:
  ```python
  context["aqi"] = await _get_aqi_context(pool)
  context["forecast"] = await _get_forecast_context(pool)
  context["fires"] = await _get_fire_context(pool)
  context["earthquakes"] = await _get_earthquake_context(pool)
  context["water"] = await _get_water_context(pool)
  context["enviroscreen"] = await _get_enviroscreen_context(pool)
  context["inversion"] = _get_inversion_context()
  context["prediction"] = await _get_prediction_context(pool)
  ```
  Each coroutine issues one or more asyncpg queries. `_get_fire_context()` alone executes three queries (aggregate count, nearest-fire lookup, upwind count). `_get_prediction_context()` invokes the ML model. Because they are awaited sequentially, the total `build_live_context()` latency is the sum of all eight durations. Since asyncpg uses connection pooling, all DB-bound coroutines can run concurrently without additional connections. `build_live_context()` is called on every request to any Claude AI endpoint (via `claude.py:get_system_with_live_context`), so its latency directly adds to every AI response time. Using `asyncio.gather()` would reduce the latency to the duration of the slowest individual query rather than the total sum. PROPOSAL: Replace the eight sequential awaits in `build_live_context()` at `context.py:61-68` with a single `asyncio.gather()` call using `return_exceptions=True` so a slow or failing query does not block others — L/L effort.

**Proposed actions:**
- Fix `unit` → `units AS unit` in `_get_water_context()` at `context.py:397`; also fix `r["unit"]` → `r["units"]` at `context.py:419` — L/L effort (promotes to Active Recommendations row #10)
- Introduce a `UsgsClient` struct in `usgs.rs` holding a reusable `reqwest::Client`; pass it into the earthquake poller in `broadcast.rs` and `main.rs` — M/M effort
- Move `async with httpx.AsyncClient(timeout=timeout) as client:` outside the retry loop in `http_client.py:31-34` to eliminate connection teardown between retry attempts — L/L effort
- Replace eight sequential `await` calls in `build_live_context()` at `context.py:61-68` with `asyncio.gather()` — L/L effort

### Run #112 — 2026-06-01 — Lens: UX / UI flaws
**Scope:** Eighth UX / UI flaws pass. Examined: `index.html` (meta tags, viewport, importmap), `styles/theme-light.css` (light/high-contrast/font-size/reduced-motion classes), `App.tsx` (layout structure, skip links, keyboard shortcuts), `components/Header.tsx`, `components/Sidebar.tsx`, `components/ChatView.tsx`, `components/AnalysisView.tsx`, `components/Dashboard.tsx`, `components/SettingsView.tsx`, `components/LoadingStates.tsx`, `components/Toast.tsx`, `components/DataExplorer.tsx` (first 80 lines), `components/CalendarView.tsx` (first 50 lines), `components/dashboard/widgets/AqiGaugeWidget.tsx`. Cross-checked against Active Recommendations and runs #110–#111 (Latest Findings) plus archived UX/UI runs #7, #22, #37, #52, #67, #82, #97 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `components/Dashboard.tsx:96` — The `getAqiColor` helper function returns `'text-maroon-500'` for AQI > 300 (Hazardous tier). `maroon` is not part of Tailwind's built-in color palette (the palette includes `red`, `rose`, `pink`, `orange`, `amber`, etc. — not `maroon`). Tailwind generates only classes for colors that appear in its config or safelist; because `text-maroon-500` is never generated, it silently produces no color rule and the element inherits its parent color (`text-slate-200` from the body). The consequence: at `Dashboard.tsx:403`, `453`, and `455` — the three call-sites that apply `getAqiColor()` to AQI values — any reading above 300 (Hazardous) renders in the default pale-grey text instead of a visually distinct danger color. This breaks the color-coding UX precisely for the most dangerous AQI tier. By contrast, `components/dashboard/widgets/AqiGaugeWidget.tsx:12` correctly uses `bg-rose-900` / `text-rose-400` for Hazardous, confirming the intended color family is `rose`. PROPOSAL: In `getAqiColor` at `Dashboard.tsx:96`, replace `return 'text-maroon-500'` with `return 'text-rose-400'` to match the established Hazardous color in `AqiGaugeWidget.tsx` — L/L effort.

- OBSERVATION: `components/ChatView.tsx:84` — The chat input uses `onKeyPress={(e) => e.key === 'Enter' && handleSend()}`. `onKeyPress` is deprecated in the DOM specification (deprecated since Chrome 116 / Safari 16 / Firefox 117) and React has flagged it as deprecated since React 17. MDN documents it as "No longer recommended" with browsers guaranteed to support it only for backward compatibility. React will emit a deprecation warning in development mode when `onKeyPress` is referenced. The functional behavior is currently preserved because browsers still fire the event for alphanumeric keys including Enter, but this is a fragile guarantee. The drop-in replacement `onKeyDown` fires at the same interaction point, uses the same `e.key` API, and handles Enter on all keyboard types (including virtual keyboards on iOS/Android which do not reliably fire `onKeyPress` for the Return key). PROPOSAL: Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84` — L/L effort.

- OBSERVATION: `components/Dashboard.tsx:480–499` — The `renderDateFilter()` function renders two `<input type="month" />` controls with no `id` attributes and no `aria-label` attributes. The function wraps them with a `<label>` element at line 482, but that `<label>` has no `htmlFor` attribute pointing to either input, making it a visual decoration only. Under WCAG 2.1 SC 1.3.1 (Info and Relationships) and SC 4.1.2 (Name, Role, Value), both inputs are programmatically unlabeled — a screen reader will announce them only as "month stepper" with no indication of which end of the date range they represent (start vs. end). The `<span class="text-slate-400 self-center">-</span>` between the two inputs is the only positional cue, which is also inaccessible. By contrast, the date inputs in `AnalysisView.tsx:335–362` have proper `<label htmlFor="start-date">` / `<label htmlFor="end-date">` pairings. PROPOSAL: Add `id="hist-start-date"` and `aria-label="Historical data start date"` to the first input at `Dashboard.tsx:484`; add `id="hist-end-date"` and `aria-label="Historical data end date"` to the second input at `Dashboard.tsx:491`; add `htmlFor="hist-start-date"` to the wrapping `<label>` at `Dashboard.tsx:482` or replace it with a `<fieldset>/<legend>` — L/L effort.

- OBSERVATION: `components/AnalysisView.tsx:420–427` — The `<textarea>` rendered for non-forecast analysis tools (quick, search, maps, deep) has no `id` attribute, no `aria-label`, and no `aria-labelledby`. Its only textual hint is the `placeholder` attribute (`currentTool.placeholder`). WCAG 2.1 SC 1.3.1 and SC 3.3.2 require that form inputs have programmatic labels; placeholder text alone does not count because it (a) disappears once the user begins typing, preventing them from referencing the instruction during input, and (b) is announced inconsistently across screen readers (some read it, some do not). Critically, the tool name (`currentTool.name`, e.g. "Quick Insight", "Deep Dive") and description (`currentTool.description`) are rendered in an `<h3>` above the input at `AnalysisView.tsx:310–315` but are not connected to the textarea with `aria-labelledby`. Compare with the forecast-tool inputs at `AnalysisView.tsx:319–362` which all have proper `<label htmlFor>` pairings and `aria-describedby="date-format-hint"`. PROPOSAL: Add `id="analysis-prompt"` to the `<textarea>` at `AnalysisView.tsx:420`; add `<label htmlFor="analysis-prompt" className="sr-only">{currentTool.name} — {currentTool.placeholder}</label>` immediately before the textarea; or add `aria-label={currentTool.name}` and `aria-describedby` pointing to the existing description paragraph — L/L effort.

**Proposed actions:**
- Replace `'text-maroon-500'` with `'text-rose-400'` in `getAqiColor` at `Dashboard.tsx:96` to restore Hazardous-tier color coding — L/L effort
- Replace `onKeyPress` with `onKeyDown` in chat input at `ChatView.tsx:84` — L/L effort
- Add `id`, `aria-label`, and `htmlFor` to the two unlabeled date filter inputs in `renderDateFilter()` at `Dashboard.tsx:484,491` — L/L effort
- Add `id="analysis-prompt"` and a `<label>` (or `aria-label`) to the non-forecast `<textarea>` at `AnalysisView.tsx:420` — L/L effort

## 📚 Archive (one line per past run)
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
