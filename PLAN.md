# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-31T01:15:00Z
Last run: #68 — Lens: Data pipeline integrity

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
### Run #68 — 2026-05-31 — Lens: Data pipeline integrity
**Scope:** Sixth data-pipeline-integrity pass. Examined: `geointellisense-ingestion/src/usgs.rs`, `purpleair.rs`, `aqi.rs`, `broadcast.rs`, `db/persist.rs`, `redis_cache.rs`, `main.rs`, `geointellisense-analytics/app/clients/nasa_firms.py`, `airnow.py`, `nws_sounding.py`, `usgs_water.py`, `noaa_cdo.py`, `http_client.py`, `source_toggles.py`, `app/routes/fires.py`, `water.py`, `inversion.py`, `earthquakes.py`, `historical_aqi.py`, `historical_weather.py`. Prior data-pipeline findings (#8, #23, #38, #53) archived; all findings verified as new via file:line specificity.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/usgs.rs:107` — `fetch_recent()` calls `let client = reqwest::Client::new()` on every invocation. This function is called by `fetch_and_persist()` → `fetch_and_persist_bbox()` every `earthquake_interval_secs` (e.g., 300 seconds, the default). Creating a new `reqwest::Client` per poll abandons TCP connection pooling: each earthquake poll opens a fresh TLS handshake to `earthquake.usgs.gov`, adding ~100–200ms of handshake overhead and consuming ephemeral port budget unnecessarily. This is architecturally inconsistent with `PurpleAirClient` at `purpleair.rs:44-46`, which correctly stores the HTTP client as a struct field (`http: reqwest::Client`) so it persists across polls and benefits from connection reuse. No prior run has flagged the USGS client lifecycle; Active Recommendation #2 addresses PurpleAir retry logic (a different concern). PROPOSAL: Move the `reqwest::Client` construction out of `fetch_recent` and into an `EarthquakeClient` struct analogous to `PurpleAirClient`; pass the struct through `spawn_earthquake_poller` and store it in `AppState` — or at minimum declare a `static` `OnceLock<reqwest::Client>` inside the module so one client is shared across all calls.

- OBSERVATION: `geointellisense-analytics/app/routes/fires.py:236` — The `_persist_fires` function silently drops any fire detection where `f.acq_datetime is None` (`if f.acq_datetime is None: continue`) with no log output at any level. `acq_datetime` is set to `None` in `_parse_csv` (line 138) when `datetime.strptime(...)` raises a `ValueError`, i.e., whenever the NASA FIRMS CSV date/time format differs from the expected `"%Y-%m-%d %H%M"` pattern. If NASA updates the FIRMS CSV format (which has happened historically — e.g., the move to millisecond timestamps in 2023 for some product variants), every detection record would have `acq_datetime = None` and be silently dropped. The background poll loop at `fires.py:54` logs `"FIRMS poll: {len(fires)} detections, {len(inserted)} new"` — but this log appears only when `fires` is non-empty (line 52: `if fires:`), so a date-format regression would produce the log `"FIRMS poll: N detections, 0 new"` with no distinction between a genuine fire-quiet period (legitimate 0 inserts) and a date-parse failure (every record silently discarded). The cache at `fires.py:63` would still be populated with fire objects (because `_format_active` calls `f.to_dict()` which doesn't require `acq_datetime`), so the API and UI would show fires — but the DB would accumulate no new rows, silently corrupting the historical record. PROPOSAL: Add `logger.warning("Skipping %d fire detections with unparseable acq_datetime — possible FIRMS format change", sum(1 for f in fires if f.acq_datetime is None))` in `_poll_loop` before calling `_persist_fires`; additionally guard `_persist_fires` with a count so it logs when `len(fires) > 0` and `inserted == 0`.

- OBSERVATION: `geointellisense-analytics/app/clients/nws_sounding.py:274-275` — `get_inversion_status()` awaits `fetch_surface_obs()` and `fetch_sounding_850mb()` sequentially on consecutive lines. These are fully independent external API calls (NWS `api.weather.gov` observations API and the University of Wyoming sounding archive at `weather.uwyo.edu`). `fetch_surface_obs()` carries a 15-second timeout (line 130: `httpx.AsyncClient(..., timeout=15.0)`). `fetch_sounding_850mb()` carries a 20-second timeout per attempt (line 189: `async with httpx.AsyncClient(timeout=20.0)`), with up to 3 attempts (the outer loop iterates `[0, 12, 24]` hours back). In the worst case both calls fail at timeout: `15 + (20 × 3) = 75 seconds` of blocked asyncio time per inversion check. The FastAPI event loop is single-threaded by default; a 75-second blocked await stalls all other concurrent requests (including AQI SSE streams, water polling responses, etc.) that share the same worker. The background poll at `inversion.py:43` runs every 30 minutes, so this latency hits even when there is no user request. The on-demand route at `inversion.py:90` also calls `get_inversion_status()` directly. PROPOSAL: Replace the two sequential `await` calls at `nws_sounding.py:274-275` with `surface, sounding = await asyncio.gather(fetch_surface_obs(), fetch_sounding_850mb())`, cutting worst-case latency to `max(15, 60) = 60` seconds and average-case by ~15 seconds; add `asyncio` to the import at line 26 of `nws_sounding.py`.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:115` + `geointellisense-analytics/app/routes/historical_aqi.py:29-59` — The broadcast ticker at `broadcast.rs:97-129` persists all readings (real and mock) to `sensor_readings` via `persist::write_readings`. When PurpleAir is unavailable (Redis down or source disabled — the existing Active Recommendation #3), `aqi::generate_readings()` at `broadcast.rs:111` generates synthetic data with `source: "mock"` (confirmed: `aqi.rs:131`). These mock rows are persisted to `sensor_readings` every `broadcast_secs` seconds with no DB-level flag distinguishing them from real observations. The analytics service queries `sensor_readings` without filtering by `source` at `historical_aqi.py:29-59` (SQL: `FROM sensor_readings sr ... WHERE 1=1` with no `AND sr.source != 'mock'` clause); likewise `historical_weather.py:20-51` contains the identical pattern. The ML training pipeline at `aqi_model.py` builds its dataset from `sensor_readings` without a `source` filter. The result: during any Redis outage period, randomly-generated mock AQI readings (with artificial Gaussian noise around fixed base values) silently pollute the historical record and the ML training dataset. An operator monitoring `sensor_readings` row counts would see continuous growth during an outage and have no way to distinguish genuine from synthetic data without checking the `source` column manually. PROPOSAL: Add `AND sr.source != 'mock'` to all `sensor_readings` analytical SQL queries in `historical_aqi.py:38`, `historical_weather.py:28`, and the `aqi_model.py` dataset query; additionally consider adding a `is_mock BOOLEAN NOT NULL DEFAULT FALSE` column to `sensor_readings` for unambiguous flagging independent of the string `source` field.

- OBSERVATION: `geointellisense-analytics/app/clients/airnow.py:48-65` — `AirNowClient` creates `self._http = httpx.AsyncClient(timeout=15.0)` directly in `__init__` (line 48) and provides `close()` at line 50-51 but implements neither `__aenter__` nor `__aexit__`, so it cannot be used as an async context manager. Route handlers that instantiate `AirNowClient()` must manually call `await client.close()` after use; if an exception is raised before `close()`, the underlying httpx connection pool and file descriptors leak. By contrast, `nasa_firms.py` and `usgs_water.py` use `from app.http_client import fetch as http_fetch` (the shared client at `app/http_client.py`) which implements retry + exponential backoff (3 retries, `[1.0, 2.0, 4.0]` second delays) and creates+closes the httpx client per request with `async with httpx.AsyncClient(...)`. `AirNowClient` at `airnow.py:64` calls `resp = await self._http.get(url, params=params)` followed immediately by `resp.raise_for_status()` (line 65) with no retry logic for 5xx responses or transient network errors. AirNow's documented rate limit is 500 requests/hour; a 429 response from AirNow propagates as an unhandled `HTTPStatusError` to callers. PROPOSAL: Refactor `AirNowClient` to use the shared `http_client.fetch()` at `airnow.py:64` and `airnow.py:80`, removing the stored `self._http` field and the `close()` method; alternatively, add `__aenter__`/`__aexit__` to `AirNowClient` and ensure all call sites use `async with AirNowClient(...) as c:` to guarantee cleanup.

**Proposed actions:**
- Refactor `usgs.rs:107` to reuse a long-lived `reqwest::Client` (struct or `OnceLock`) across earthquake polls — M/L, score 2.0; does not displace top 10
- Log warning in `fires.py:236` + `_poll_loop` when fire records are skipped due to null `acq_datetime` — M/L, score 2.0; does not displace top 10
- Parallelize `nws_sounding.py:274-275` with `asyncio.gather()` — M/L, score 2.0; does not displace top 10
- Add `AND sr.source != 'mock'` filter to `historical_aqi.py:38`, `historical_weather.py:28`, `aqi_model.py` dataset query — H/M, score 1.5; does not displace top 10
- Refactor `AirNowClient` to use shared `http_client.fetch()` for retry consistency; add async context manager support — M/L, score 2.0; does not displace top 10

### Run #67 — 2026-05-31 — Lens: UX / UI flaws
**Scope:** Fifth UX/UI-flaws pass. Examined: `App.tsx`, `components/Sidebar.tsx`, `components/Header.tsx`, `components/ChatView.tsx`, `components/AnalysisView.tsx`, `components/DataExplorer.tsx`, `components/CalendarView.tsx`, `components/ErrorBoundary.tsx`, `components/ErrorMessage.tsx`, `components/LoadingStates.tsx`, `components/Toast.tsx`, `components/dashboard/LiveDashboard.tsx`, `components/dashboard/WidgetShell.tsx`, `components/dashboard/DateFilter.tsx`, `components/dashboard/LocationSelector.tsx`, `components/dashboard/widgets/AqiGaugeWidget.tsx`, `components/dashboard/widgets/AqiTrendWidget.tsx`. Prior UX/UI details (#7, #22, #37, #52) archived; all findings verified as new via file:line specificity.

**Findings:**

- OBSERVATION: `components/CalendarView.tsx:21` — `const [currentDate, setCurrentDate] = useState(new Date('2025-11-13'))` hardcodes the calendar opening view to November 13, 2025. As of 2026-05-31, users opening the Calendar tab are immediately presented with a month that is approximately 6.5 months in the past. No auto-advance to the current month occurs on mount. The user must manually click the forward-navigation arrow 6–7 times to reach the current month before they can see today's data. Nothing in the UI communicates that the displayed month is not the current month; the header (driven by `format(currentDate, 'MMMM yyyy')` at line 126) simply shows "November 2025" with no visual distinction or indicator that this is stale. PROPOSAL: Replace `useState(new Date('2025-11-13'))` at `CalendarView.tsx:21` with `useState(new Date())` so the calendar initializes to the current month on every mount.

- OBSERVATION: `components/dashboard/WidgetShell.tsx:40` — The rendered `<section>` element is given `tabIndex={0}`. Every one of the 8 widgets in `LiveDashboard.tsx` (AQI Gauge, AQI Trend, AQI Forecast, Weather, Fires, Inversion, Earthquake, Water) uses `WidgetShell`, so there are 8 non-interactive container elements participating in the linear tab order. A keyboard user navigating the Live Dashboard with Tab must traverse all 8 container focus stops before reaching any actionable control (e.g., the "Retry" button inside a widget or a chart data point). The `<section>` is already semantically discoverable by screen readers as a landmark via its `aria-label={title}` without any `tabIndex`. Landmark navigation (F6 or browser/screen-reader region jump) provides access to each widget container without requiring tab-stop membership. Adding `tabIndex={0}` to non-interactive container elements is an anti-pattern per WCAG 2.5.3 guidance and adds gratuitous friction for keyboard-only users. PROPOSAL: Remove `tabIndex={0}` from the `<section>` at `WidgetShell.tsx:40`; the landmark semantics via `aria-label` already satisfy screen-reader discoverability.

- OBSERVATION: `components/dashboard/DateFilter.tsx:87-103` — The `<label>` element at line 87 reads "Filter Date Range:" and is rendered as a plain `<label>` without a `htmlFor` attribute. It is not programmatically associated with either `<input type="month">` via `htmlFor`, `aria-labelledby`, or `aria-label`. Neither input at lines 90-96 and 98-102 has an `id` attribute, so even if `htmlFor` were added, it would have no target. Both inputs are therefore completely anonymous in the accessibility tree — screen readers announce them only as generic "month" fields with no indication of whether they control the start or the end of the range. In contrast, the equivalent date inputs in `AnalysisView.tsx:339-362` correctly pair each input with its label via `id="start-date"` / `htmlFor="start-date"` and `id="end-date"` / `htmlFor="end-date"`. PROPOSAL: Add `id="df-start-date"` to the first input and `id="df-end-date"` to the second; replace the current `<label>` with two explicit labels: `<label htmlFor="df-start-date" className="...">Start Month</label>` and `<label htmlFor="df-end-date" className="...">End Month</label>`, or wrap both inputs in a `<fieldset>` with `<legend>Filter Date Range</legend>`.

- OBSERVATION: `components/DataExplorer.tsx:393` — The Claude analysis result is rendered via `dangerouslySetInnerHTML={{ __html: claudeResult.replace(/\n/g, '<br />') }}`. This is a second, independent occurrence of the same vulnerability class already tracked in Active Recommendation #1 (which covers `AnalysisView.tsx:450`). `claudeResult` is the raw string returned by `getDeepAnalysisResponse()` at line 143, passed through no sanitization. If a prompt injection in the user-supplied data summary (which is constructed from actual DB records via `data.data.slice(-30)` at line 113) causes Claude to include `<script>`, `<img onerror=...>`, or `<a href="javascript:...">` in its response, that content will execute in the browser. The attacker surface is indirect — a malicious actor would need to poison the underlying environmental data — but the code path is: DB record → JSON in prompt → Claude response → unsanitized `innerHTML`. PROPOSAL: Apply the same DOMPurify (or equivalent) sanitization at `DataExplorer.tsx:393` as should be applied per Active Rec #1; ideally, refactor both `AnalysisView.tsx:450` and `DataExplorer.tsx:393` to use a shared `<SanitizedMarkdown>` component that centralizes the fix and prevents future occurrences.

- OBSERVATION: `components/Sidebar.tsx:33` / `App.tsx:32-86` — The Google Maps nav item in `Sidebar.tsx` declares `shortcut: 'Alt+G'` at line 33. `NavLink.aria-label` at line 82 announces `"Google Maps (Alt+G)"` to screen readers. The `title` attribute at line 84 displays `"Google Maps - Alt+G"` in the browser tooltip. However, `App.tsx:32-86` defines only 5 keyboard shortcut handlers: `Alt+D` (Dashboard), `Alt+M` (Air Quality Map), `Alt+E` (Data Explorer), `Alt+A` (Analysis), `Alt+S` (Settings). There is no `Alt+G` handler in the shortcuts array. The `Shift+?` announcement at `App.tsx:82` says `"Alt+D for Dashboard, Alt+M for Air Quality Map, Alt+A for Analysis, Alt+S for Settings"` — it does not mention `Alt+G`. Screen reader users who rely on the sidebar's aria-label announcement will try `Alt+G`, which either does nothing or (on Windows) opens the browser menu/window. The advertised shortcut is a false affordance. PROPOSAL: Add `{ key: 'g', altKey: true, action: () => { navigate('/maps'); announce('Navigated to Google Maps'); }, description: 'Go to Google Maps' }` to the shortcuts array at `App.tsx:32`; update the `Shift+?` announcement string at `App.tsx:82` to include "Alt+G for Google Maps".

**Proposed actions:**
- Replace hardcoded `new Date('2025-11-13')` in `CalendarView.tsx:21` with `new Date()` — H/L, score 3.0; ties top 10 at 3.0, first seen #67, does not displace existing
- Remove `tabIndex={0}` from `<section>` at `WidgetShell.tsx:40` — M/L, score 2.0; does not displace top 10
- Add `id`/`htmlFor` pairing to `DateFilter.tsx:87-103` date inputs — M/L, score 2.0; does not displace top 10
- Apply DOMPurify sanitization at `DataExplorer.tsx:393`; extract shared `<SanitizedMarkdown>` component — H/L, score 3.0; ties top 10 at 3.0, first seen #67, does not displace existing
- Add `Alt+G` keyboard handler to `App.tsx:32` shortcuts array; update `Shift+?` announcement at `App.tsx:82` — M/L, score 2.0; does not displace top 10

### Run #66 — 2026-05-30 — Lens: TS ↔ Python contract
**Scope:** Sixth TS↔Python contract pass. Examined: `services/aiService.ts`, `services/AirQualityService.ts`, `services/dataService.ts`, `types.ts`, `hooks/useLiveData.ts`, `geointellisense-analytics/app/routes/grounded_search.py`, `grounded_maps.py`, `chat.py`, `predictive_analysis.py`, `weather_forecast.py`, `historical_aqi.py`, `historical_weather.py`, `predict.py`, `fires.py`, `earthquakes.py`, `water.py`, `inversion.py`, `nws_forecast.py`, `geointellisense-analytics/app/ml/aqi_model.py`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `clients/nasa_firms.py`, `clients/nws_sounding.py`, `components/dashboard/widgets/AqiForecastWidget.tsx`, `FiresWidget.tsx`, `WeatherWidget.tsx`, `InversionWidget.tsx`. Prior TS↔Py contract details (#6, #21, #36, #51) archived; all findings verified as new via specificity of file:line citations.

**Findings:**

- OBSERVATION: `hooks/useLiveData.ts:136-138` declares `PredictionResult` with three non-nullable fields: `modelR2: number`, `modelMAE: number`, `trainedAt: string`. The Python source at `geointellisense-analytics/app/ml/aqi_model.py:306-308` returns these via `meta.get("r2_score")`, `meta.get("mae")`, `meta.get("trained_at")` — Python `dict.get()` returns `None` when the key is absent, so all three fields may arrive as JSON `null`. TypeScript's structural typing treats the response as `PredictionResult` without any runtime null-check. `AqiForecastWidget.tsx:40` renders `data.modelR2` directly in JSX as `R²={data.modelR2}` — when `modelR2` is `null` this renders the literal string "R²=null" visible to users. The same potential appears at `data.modelMAE` and `data.trainedAt`. The model metadata is written by `train_model()` at `aqi_model.py:264`, which keys the dict `meta["r2_score"]` etc. only after a successful fit; if the joblib file was written before the `r2_score` key was added to the meta schema (i.e., a stale model file), all three fields return `null` on every `/api/predict/aqi` call. PROPOSAL: (a) Change `useLiveData.ts:136-138` to `modelR2: number | null`, `modelMAE: number | null`, `trainedAt: string | null`; (b) add null-guard in `AqiForecastWidget.tsx:40` — `R²={data.modelR2 != null ? data.modelR2.toFixed(3) : 'N/A'}`.

- OBSERVATION: `types.ts:14-31` defines a `GroundingChunk` interface modelled on the Gemini API citation structure: `web?: { uri: string; title: string }` and `maps?: { uri: string; title: string; placeAnswerSources?: ... }`. Both Python routes that return `groundingChunks` — `grounded_search.py:79` (`return {"text": text, "groundingChunks": []}`) and `grounded_maps.py:86` (`return {"text": text, "groundingChunks": []}`) — hardcode an empty array unconditionally. No code path in either route ever populates the `groundingChunks` list. The TypeScript consumer at `AnalysisView.tsx:177` calls `setGroundingChunks(searchRes.groundingChunks)` and `AnalysisView.tsx:187` calls `setGroundingChunks(mapsRes.groundingChunks)`, but the rendering block at `AnalysisView.tsx:451` guarded by `{groundingChunks.length > 0 && (...)}` can never execute — it is permanently dead code. The `GroundingChunk` interface in `types.ts` faithfully describes the old Gemini API source-citation format; the current Claude API backend uses tool-use callbacks to fetch data and embeds citations inline in the text response rather than returning structured source objects. PROPOSAL: (a) Remove the `GroundingChunk` interface from `types.ts:14-31` and the `groundingChunks` return field from `aiService.ts:30-50` and `aiService.ts:52-72`; (b) remove the dead `{groundingChunks.length > 0 && ...}` block at `AnalysisView.tsx:451-465`; (c) alternatively, if citation surfacing is desired, populate `groundingChunks` in Python from `tool_results` (db query summaries or web source data returned by tools during the tool-use loop).

- OBSERVATION: `hooks/useLiveData.ts:163-176` declares `FiresData.fires` as `Array<{ lat: number; lng: number; brightness: number; frp: number; confidence: string; distanceKm: number; isUpwind: boolean }>`, expecting each fire to have `lat` and `lng` fields. The actual Python JSON source is `FireDetection.to_dict()` in `geointellisense-analytics/app/clients/nasa_firms.py`. That method initializes `d = {k: getattr(self, k) for k in self.__slots__}`, and `__slots__` are `("latitude", "longitude", "brightness", "frp", "confidence", "satellite", "instrument", "acq_datetime", "daynight")`. The JSON keys are therefore `latitude` and `longitude`, not `lat` and `lng`. The TypeScript interface declares `lat`/`lng` as required fields, but at runtime every fire object has `undefined` for `fire.lat` and `fire.lng`. `FiresWidget.tsx` currently uses only `f.distanceKm`, `f.frp`, and `f.confidence`, so no visible rendering bug exists today — but any map component that renders a fire pin using `f.lat`/`f.lng` (e.g., a future `MapView.tsx` feature showing fire locations) would silently receive `undefined` coordinates, placing all fires at `(0, 0)` in the ocean. PROPOSAL: Either (a) rename the keys in `FireDetection.to_dict()` from `"latitude"` → `"lat"` and `"longitude"` → `"lng"` (aligning Python output with TS type), or (b) update `useLiveData.ts:168-169` to declare `latitude: number; longitude: number` (aligning TS type with Python output) — option (a) is preferred as `lat`/`lng` is already the convention used by `FiresWidget`, `EarthquakeData`, and `AqiReading`.

- OBSERVATION: `/api/aqi-snapshot` is consumed by two separate TypeScript type definitions that have diverged: `AirQualityService.ts:16-20` defines a private `SnapshotReading` interface with only 9 fields (`lat`, `lng`, `aqi`, `pm25`, `pm10`, `no2`, `so2`, `co`, `o3`), while `hooks/useLiveData.ts:102-119` defines the more complete `AqiReading` interface with 16 fields (adding `stationId`, `stationName`, `county`, `category`, `source`, `temperature`, `humidity`, `windSpeed`, `windDirection`, `timestamp`). Both cast `data.readings` from the same Rust endpoint (`routes/aqi.rs:11`) to their respective types. The Rust `AqiReading` struct (`aqi.rs:18-41`) emits all 16+ fields. `AirQualityService.ts` silently discards `stationId`, `stationName`, `county`, `category`, `temperature`, `humidity`, `windSpeed`, `windDirection`, `source`, and `timestamp`. If a future developer adds a field to the Rust `AqiReading` struct and wants it reflected in `AirQualityService`, they must update two independent type definitions. More concretely, `WeatherWidget.tsx:14-21` uses `snapshot.readings` via `useAqiSnapshot()` (typed as `AqiReading[]`) to compute average `r.temperature`, `r.humidity`, `r.windSpeed` — these fields are in `AqiReading` but absent from `SnapshotReading`. Any developer looking at `AirQualityService.ts:getCurrentAQI()` would have no indication that the same endpoint also carries weather fields consumed elsewhere. PROPOSAL: Delete the private `SnapshotReading` interface in `AirQualityService.ts:16-20`; import and use the exported `AqiReading` from `hooks/useLiveData.ts` instead, constraining the cast to `data.readings as AqiReading[]` so there is a single source of truth for the snapshot shape.

- OBSERVATION: `geointellisense-analytics/app/routes/historical_weather.py:98` emits `"totalPrecipitation": 0.0` with an inline comment `# sensor_readings doesn't have precip; placeholder` for every single historical weather record returned from the live API. The TypeScript `HistoricalWeatherRecord` in `dataService.ts:66` types this as `totalPrecipitation: number`, with no indication it may be structurally zero. The fallback path in `dataService.ts:376` uses `totalPrecipitation: monthData.precipitation` from `dashboardData`, which has real non-zero values (e.g., `4.1` inches in December for Bakersfield). Any chart or table rendering `totalPrecipitation` will display: (a) real precipitation data when the live DB is unavailable and fallback is active, and (b) a flat zero line for all months when the live DB is healthy. The behavior is indistinguishable in the TypeScript type system — both code paths return `HistoricalWeatherRecord[]` with a `number` field. This affects predictive analysis prompts: `getPredictiveAnalysisResponse()` passes `filteredWeather` from `dashboardData` (real values), not from the live API (which would be all zeros); however, if `dataService.getHistoricalWeather()` is used as the data source instead, the all-zero precipitation would flow into AI analysis as factual historical data. PROPOSAL: Add `precipitationIsPlaceholder?: boolean` to `HistoricalWeatherRecord` and set it `true` in the Python response; alternatively integrate a real precipitation source (PRISM or NOAA CDO) into the `sensor_readings` schema; at minimum add a `WARNING: totalPrecipitation is always 0` comment to `HistoricalWeatherRecord.totalPrecipitation` in `dataService.ts:66`.

**Proposed actions:**
- Fix `PredictionResult` nullable fields in `useLiveData.ts:136-138` (`modelR2/modelMAE: number | null`, `trainedAt: string | null`); add null-guard in `AqiForecastWidget.tsx:40` — M/L, score 2.0; does not displace top 10
- Remove dead `GroundingChunk` schema from `types.ts:14-31`; remove `groundingChunks` return from `aiService.ts:30-72`; remove unreachable block in `AnalysisView.tsx:451-465` — M/L, score 2.0; does not displace top 10
- Align `FireDetection.to_dict()` field names to `lat`/`lng` in `nasa_firms.py`; fix `useLiveData.ts:168-169` — H/L, score 3.0; ties top 10 but first seen #66, does not displace existing
- Consolidate two independent snapshot type definitions: delete `SnapshotReading` in `AirQualityService.ts:16-20`; import `AqiReading` from `useLiveData.ts` — M/L, score 2.0; does not displace top 10
- Add `precipitationIsPlaceholder` flag or warning comment for zero `totalPrecipitation` in `historical_weather.py:98` and `dataService.ts:66` — M/M, score 1.0; does not displace top 10

## 📚 Archive (one line per past run)
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
- Run #40 (2026-05-29) — Lens: Observability — 5 findings — 0 promoted to Active
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
