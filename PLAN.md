# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-29T18:07:36Z
Last run: #38 — Lens: Data pipeline integrity

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

### Run #37 — 2026-05-29 — Lens: UX / UI flaws
**Scope:** Third UX/UI pass. All components in `components/` (ChatView, AnalysisView, DataExplorer, Dashboard, CalendarView, Sidebar, Header, SettingsView, LoadingStates, Toast); route configuration in `App.tsx`; test files `tests/routing.test.tsx` and `tests/accessibility.test.tsx`. Cross-referenced archived findings from runs #7 and #22 to exclude previously-reported items.

**Findings:**

- OBSERVATION: `App.tsx:1-202` and `components/ChatView.tsx`, `components/CalendarView.tsx` — Both `ChatView` and `CalendarView` are fully-implemented components that are never imported or mounted anywhere in the application's route tree. `App.tsx` defines six routes (`/dashboard`, `/air-quality-map`, `/analysis`, `/explore`, `/maps`, `/settings`) but neither `/chat` nor any calendar path exists. `Sidebar.tsx` lists five nav items with no reference to either component. Both components are functionally complete — `ChatView` has a working message loop and input field; `CalendarView` has a full month/list view with hourly charts and forecast data. However, end-users can never navigate to either view. The `tests/routing.test.tsx:69-243` and `tests/accessibility.test.tsx:300` test suite, by contrast, asserts the existence of a `/chat` route with a "Chat Analyst" sidebar link — meaning those tests will fail in any browser-based integration test run (the tests render a stub `Sidebar` that references `/chat`, but real users get no such link). Fix: add `/chat` and `/calendar` routes to `App.tsx`; add corresponding nav items to `Sidebar.tsx` with shortcuts `Alt+C` / `Alt+L`; lazy-import both components analogously to existing routes.

- OBSERVATION: `components/CalendarView.tsx:21` — `useState(new Date('2025-11-13'))` hardcodes the calendar's initial view month to November 2025. As of today (2026-05-29), this is 6+ months in the past. If `CalendarView` were mounted, the calendar would open 6+ months behind the current date; users would need to click "Next →" repeatedly to reach the current month. The `dashboardData`'s `dailyForecast` array contains dates starting at `2025-11-13`, so the data availability happens to match — but the UX implication is that the calendar doesn't initialize at "today." Fix: replace the hardcoded date with `useState(new Date())` so the calendar opens at the current month, then let `getDayData` return `null` for out-of-range dates (which is already handled via the `!dayData` disabled-button path).

- OBSERVATION: `components/DataExplorer.tsx:393` and `components/AnalysisView.tsx:450` — Active Recommendation row #1 flags `AnalysisView.tsx` for `dangerouslySetInnerHTML` XSS, but the identical unsafe pattern exists in `DataExplorer.tsx:393`: `dangerouslySetInnerHTML={{ __html: claudeResult.replace(/\n/g, '<br />') }}`. `claudeResult` originates from `getDeepAnalysisResponse()` (`aiService.ts`), which passes the raw backend LLM response string to the component. The `.replace(/\n/g, '<br />')` transformation only converts newlines; it leaves all other HTML tags and script elements intact. A backend response containing `<img src=x onerror=alert(1)>` or any `<script>` tag would execute in the user's browser context. Since the analytics route does not sanitize LLM output before returning it (`geointellisense-analytics/app/routes/deep_analysis.py` returns `{"analysis": result}` verbatim), both components are live XSS vectors whenever the backend is online. Fix: apply DOMPurify or a structural markdown renderer (e.g., `react-markdown`) in both `AnalysisView.tsx:450` and `DataExplorer.tsx:393`, replacing the unsafe `dangerouslySetInnerHTML` pattern.

- OBSERVATION: `components/ChatView.tsx:84` — The chat input uses `onKeyPress={(e) => e.key === 'Enter' && handleSend()}`. `onKeyPress` is marked as deprecated in the HTML5 spec and in React (deprecated since React 17). Modern browsers remove it from the event model in various edge cases; it also does not fire for all keys on non-US keyboard layouts and does not fire for `Enter` in combination with `Ctrl` or `Meta` on some platforms. Keyboard users who submit via Enter may encounter silent failures as browsers phase out `onKeyPress` support. The correct replacement is `onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}` (with `!e.shiftKey` to allow multi-line input via Shift+Enter, which is a common chat-UX expectation). Fix: replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84`.

- OBSERVATION: `components/AnalysisView.tsx:420-426` — The prompt `<textarea>` rendered for non-forecast analysis tools has no accessible label. It has no `id`, no `htmlFor`/`aria-labelledby` association, and no `aria-label` — only a `placeholder` attribute. WCAG 2.1 Success Criterion 1.3.1 (Info and Relationships) requires form controls to have a programmatic label; `placeholder` alone does not satisfy this criterion because assistive technologies do not announce placeholder text as a label when the field has focus or is navigated to by form scan. Additionally, `Dashboard.tsx:516-528` renders location toggle buttons (Valley Average, Bakersfield, etc.) without `aria-pressed` attributes — screen readers cannot communicate the selected/deselected state of these buttons even though the visual styling changes. Fix: add `id="prompt-input"` and a visually-hidden `<label htmlFor="prompt-input">Analysis prompt</label>` at `AnalysisView.tsx:420`; add `aria-pressed={selectedLocations.includes(loc)}` to each location button at `Dashboard.tsx:520`.

**Proposed actions:**
- Add `/chat` and `/calendar` routes to `App.tsx`; add nav items to `Sidebar.tsx` — H/L, score 3.0; ties current top 10, does not displace
- Replace hardcoded `new Date('2025-11-13')` with `new Date()` in `CalendarView.tsx:21` — M/L, score 2.0; does not enter top 10
- Extend row #1 fix scope to `DataExplorer.tsx:393` — apply DOMPurify or `react-markdown` in both components — H/L, score 3.0; ties current top 10, does not displace
- Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84` — M/L, score 2.0; does not enter top 10
- Add programmatic label to `AnalysisView.tsx:420` textarea; add `aria-pressed` to Dashboard location buttons — M/L, score 2.0; does not enter top 10

### Run #36 — 2026-05-29 — Lens: TS ↔ Python contract
**Scope:** Third TS↔Python contract pass. All TypeScript interfaces in `hooks/useLiveData.ts`, `services/dataService.ts`, `services/aiService.ts`, `types.ts`; Python route handlers in `geointellisense-analytics/app/routes/` (chat, grounded_search, grounded_maps, low_latency, deep_analysis, predictive_analysis, weather_forecast, predict, historical_aqi, historical_weather, inversion, fires, water, earthquakes, nws_forecast); Python models in `geointellisense-analytics/app/clients/nasa_firms.py`, `app/clients/nws_sounding.py`, `app/ml/aqi_model.py`; `components/MapView.tsx` for field access patterns. Cross-referenced against run #6 (4 promoted to Active) and run #21 (0 promoted, archived) to exclude previously-reported items.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/clients/nasa_firms.py` and `hooks/useLiveData.ts:137-148` — `FireDetection.to_dict()` serializes raw `__slots__` keys directly: the dict keys are `latitude` and `longitude` (matching the slot names). However, TypeScript `FiresData.fires[]` declares `lat: number` and `lng: number`, and `components/MapView.tsx:274` accesses `position: { lat: f.lat, lng: f.lng }`. Because no key named `lat` or `lng` exists in the Python response, `f.lat` and `f.lng` are `undefined` at runtime. Google Maps ignores a marker whose position contains `undefined` coordinates and silently declines to render it. As a result, the fire layer is always empty on the map regardless of how many detections the FIRMS API returns. This is a functional regression: the fire marker loop at `MapView.tsx:271-281` runs without error but produces zero visible markers in every case where the FIRMS API returns fire data. Fix: in `nasa_firms.py`, change the `to_dict` method to emit `"lat"` and `"lng"` instead of `"latitude"` and `"longitude"`, or add explicit remapping before returning (`d["lat"] = d.pop("latitude"); d["lng"] = d.pop("longitude")`); alternatively rename the TypeScript interface fields to `latitude`/`longitude` and update `MapView.tsx:274` accordingly.

- OBSERVATION: `services/dataService.ts:163-175` and `geointellisense-analytics/app/routes/historical_aqi.py:47-48` / `historical_weather.py:37-38` — `DataService.getLocations()` constructs location IDs as `name.toLowerCase().replace(/\s+/g, '_')` (e.g., `"fresno"`, `"bakersfield"`, `"modesto"`). These name-based IDs are passed verbatim in the `location_ids` query parameter when `getHistoricalAQI()` and `getHistoricalWeather()` call the analytics endpoints. Both Python handlers split on commas and then execute `AND sr.location_id = ANY(${idx}::uuid[])`, which instructs PostgreSQL to cast the string `"fresno"` to a UUID. PostgreSQL raises `invalid input syntax for type uuid: "fresno"` for every such request. The `asyncpg` driver propagates this as an exception, FastAPI returns HTTP 500, and the TypeScript `DataService` catches the error at line 184 and silently falls back to `getHistoricalAQIFallback()` (mock data). As a result, real historical data is never fetched from the database; every `DataExplorer` and `CalendarView` render is driven entirely by static mock data regardless of what is stored in TimescaleDB. Fix: either (a) update `DataService.getLocations()` to use the actual UUID from the `locations` table (requires a `GET /api/locations` endpoint), or (b) change both Python handlers to filter by `l.name = ANY($1::text[])` so that human-readable names are accepted.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:264-274` and `hooks/useLiveData.ts:103-113` — `predict_aqi()` returns the dict keys `"modelR2": meta.get("r2_score")`, `"modelMAE": meta.get("mae")`, and `"trainedAt": meta.get("trained_at")`. All three call `.get()` on the in-memory meta dict without a default, returning Python `None` (JSON `null`) when the corresponding key is absent. This occurs if the model was loaded from a `.joblib` file that was saved before these metadata fields were introduced, or if a training run fails after saving the model file but before saving the meta file. TypeScript `PredictionResult` at `useLiveData.ts:105-110` declares `modelR2: number`, `modelMAE: number`, and `trainedAt: string` — all non-optional. Any consumer that accesses `data.modelR2.toFixed(3)` or `data.trainedAt.slice(0, 10)` will throw `TypeError: Cannot read properties of null` at runtime. Additionally, `predict_aqi()` includes a key `"currentFeatures"` (line 273) that is not declared in `PredictionResult`, meaning it is silently present in every prediction response but invisible to TypeScript consumers. Fix: (a) supply defaults in `predict_aqi()` — `meta.get("r2_score", 0)`, `meta.get("mae", 0)`, `meta.get("trained_at", "")` — and (b) add `currentFeatures?: Record<string, number>` to `PredictionResult` for correctness.

- OBSERVATION: `geointellisense-analytics/app/routes/predict.py:_get_airnow_comparison()` and `hooks/useLiveData.ts:109` — The optional `airnowComparison` field on `PredictionResult` is typed `{ source: string; aqi: number; category: string }`. In `_get_airnow_comparison()`, the returned dict uses `"aqi": f.get("aqi")` and `"category": f.get("category")` where `f` is a cached AirNow forecast dict. Neither key is guaranteed to exist: if the AirNow forecast was cached before these fields were added, or if the station data format changes, both `.get()` calls return `None`. TypeScript sees `aqi: null` where `number` is required. The function also returns two extra undeclared fields — `"date": f.get("date")` and `"parameter": f.get("parameter")` — that are absent from the TypeScript type. Fix: supply defaults (`f.get("aqi", 0)`, `f.get("category", "Unknown")`) in `_get_airnow_comparison()`; extend `airnowComparison` in `PredictionResult` to include `date?: string` and `parameter?: string` for complete type coverage.

- OBSERVATION: `geointellisense-analytics/app/routes/water.py:_format_current()` and `hooks/useLiveData.ts:202-213` — `_format_current()` includes `"lat": r.latitude` and `"lng": r.longitude` on every station object. TypeScript `WaterData.stations[]` is declared as `{ siteId: string; siteName: string; readings: Record<...> }` with no `lat` or `lng` fields. Any code that needs to geo-locate a USGS water station from `WaterData` must use a type assertion or cast, and TypeScript strict mode would flag direct property access as a type error. This is a type-completeness gap: the data is present in the network response but absent from the declared contract. Fix: add `lat: number; lng: number` to the `WaterData.stations[]` item type in `useLiveData.ts`.

**Proposed actions:**
- In `nasa_firms.py:to_dict`, rename `latitude`→`lat` and `longitude`→`lng` in the returned dict so fire marker positions are no longer undefined — H/L, score 3.0; ties current top 10, does not displace
- Update `DataService.getHistoricalAQI/Weather` to either (a) fetch UUID-based location IDs from a `/api/locations` endpoint, or (b) change the Python handlers to filter by name (`l.name = ANY(...)`) instead of UUID cast — H/L, score 3.0; ties current top 10, does not displace
- Supply `.get()` defaults for `r2_score`, `mae`, `trained_at` in `aqi_model.py:predict_aqi()` and declare `currentFeatures?` in `PredictionResult` — M/L, score 2.0; does not enter top 10
- Provide fallback values for `aqi` and `category` in `_get_airnow_comparison()`; add `date?`/`parameter?` to `PredictionResult.airnowComparison` — L/L, score 1.0; does not enter top 10
- Add `lat: number; lng: number` to `WaterData.stations[]` item type in `useLiveData.ts:206` — L/L, score 1.0; does not enter top 10

## 📚 Archive (one line per past run)
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
