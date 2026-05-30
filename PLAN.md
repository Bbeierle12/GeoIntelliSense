# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T02:15:00Z
Last run: #46 — Lens: Type safety

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
### Run #46 — 2026-05-30 — Lens: Type safety
**Scope:** Fourth type-safety pass. Examined: `data/dashboardData.ts`, `hooks/useDashboardData.ts`, `services/aiService.ts`, `services/WeatherService.ts`, `services/AirQualityService.ts`, `services/dataService.ts`, `contexts/UserPreferencesContext.tsx`, `hooks/useRealtimeAQI.ts`, `hooks/useLiveData.ts`, `components/charts/AQITrendChart.tsx`, `components/charts/PM25TrendChart.tsx`, `components/charts/WeatherForecastChart.tsx`, `components/charts/TemperaturePrecipitationChart.tsx`, `components/AccessibleChart.tsx`, `types.ts`. Cross-referenced archived findings from runs #1, #16, #31 (summary lines only — no detail available to cross-check at the individual-finding level) and noted that zero type-safety findings have ever been promoted to Active Recommendations, implying all prior type-safety findings were M/L or below.

**Findings:**

- OBSERVATION: `data/dashboardData.ts:195-196` — `function generateDailyForecast(location: string, days: number)` has no return type annotation. The function assembles and returns objects with 20+ distinct fields (`date`, `dayOfWeek`, `temp.current/min/max/feelsLike`, `humidity`, `dewPoint`, `pressure`, `wind.speed/gust/direction`, `uv`, `precipitation.probability/amount/type`, `cloudCover`, `visibility`, `solarRadiation`, `evapotranspiration`, `moonPhase`, `sunrise`, `sunset`, `dayLength`, `condition`, `aqi`, `pm25`, `hourlyData[{hour, temp, feelsLike, humidity, ...}]`). Because no `DailyForecastEntry` interface is declared, TypeScript infers a wide, anonymous object-literal type from the `forecast.push({...})` call at line 297. This unannotated return type is the root cause of 13 `any` annotations downstream in `useDashboardData.ts:179,197,199,223,241,243,267,285,287,311,330,332` — four separate `forEach((day: any) => {...})` loops and eight `result: any[], entry: any` declarations — because there is no named type to import for the element of `locEntry.dailyForecast`. PROPOSAL: Declare an explicit `export interface DailyForecastEntry` (or `export type DailyForecastEntry = ReturnType<typeof generateDailyForecast>[number]`) in `data/dashboardData.ts`; import it in `useDashboardData.ts` and replace every `day: any` with `day: DailyForecastEntry` and every `result: any[], entry: any` with typed alternatives.

- OBSERVATION: `services/aiService.ts:22,44,66,88,110,146,180` — Seven `response.json()` calls across all seven API-wrapper functions return the implicit TypeScript type `any` (the standard library types `Response.json()` as `Promise<any>`). Each function then immediately property-accesses the result (`data.text`, `data.groundingChunks`) without any type annotation or runtime validation. Typos (`data.tex`, `data.groundindChunks`) are invisible to the compiler. The `getChatResponse` function at line 8 declares `Promise<string>` as its return type, and the sole line `return data.text` compiles silently even if the backend changes its response shape to `{ result: string }` — the type error is absorbed silently since `data` is `any`. This affects every LLM-backed feature in the UI. PROPOSAL: For each function, add an inline type to the `response.json()` call: e.g. `const data = await response.json() as { text: string }` for single-field responses and `const data = await response.json() as { text: string; groundingChunks: GroundingChunk[] }` for grounded responses; alternatively, define a small `interface ChatApiResponse { text: string }` etc. at the top of `aiService.ts` and cast to it.

- OBSERVATION: `contexts/UserPreferencesContext.tsx:139,290` — Two `JSON.parse()` calls produce untyped `any` values that are immediately spread into `UserPreferences`-shaped objects without shape validation. At line 139 (`const parsed = JSON.parse(stored)`), `parsed` has type `any`; the spread `{ ...defaultPreferences, ...parsed, dataSettings: { ...defaultDataSettings, ...parsed.dataSettings }, ... }` silently absorbs any malformed stored preferences (wrong field types, extra fields, missing fields). At line 290 (`importPreferences`), `const imported = JSON.parse(json)` produces `any`; if `imported` is a primitive (e.g. `JSON.parse("42")` returns the number `42`), accessing `imported.dataSettings` yields `undefined`, and `{ ...defaultDataSettings, ...undefined }` silently uses defaults; if `imported.theme` is `"purple"` (invalid `Theme` literal), the type `UserPreferences` is violated at runtime without any TS error since `imported` is `any`. The `typeof imported !== 'object'` guard is absent. PROPOSAL: Annotate `JSON.parse` return as `unknown` (requires TypeScript `5.x` — already compatible since `tsconfig.json` does not set `strict: false`), then narrow: `if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid preferences format')` before spreading; this catches shape errors at import/load time.

- OBSERVATION: `components/charts/AQITrendChart.tsx:15`, `PM25TrendChart.tsx:15`, `WeatherForecastChart.tsx:14`, `TemperaturePrecipitationChart.tsx:15` — All four chart components declare `data: any[]` in their props interfaces. The actual data arrays produced by `useDashboardData` are always `Array<{ month: string; [location: string]: number | string }>` (for trend/history charts) or `Array<{ day: string; [key: string]: number }>` (for weekly forecast). With `any[]`, recharts can receive literally any value — an array of strings, an array of nulls, a nested array — without compile-time error. Because `recharts` charts consume these arrays via dynamic `dataKey` string lookups, TypeScript has no way to verify that `dataKey={loc}` resolves to a numeric value in the data; `any[]` makes this even worse by removing all checking on the array elements. PROPOSAL: Define `type ChartDataRow = { month: string } & Record<string, number | string>` in a shared `types.ts` or inline per chart; replace all four `data: any[]` props with `data: ChartDataRow[]`.

- OBSERVATION: `services/dataService.ts:297` — `async getDashboardMetrics(locationIds?: string[])` has no return type annotation. The inferred return type is `Promise<{ totalLocations: number; avgAqi: number; avgTemp: number; alertLocations: number; lastUpdated: Date }>`. While TypeScript infers this correctly today, without a declared `DashboardMetrics` interface the signature is invisible to consumers and any refactoring of the `return {...}` literal would silently change the inferred type without alerting callers. Specifically, if a future developer renames `alertLocations` to `alertCount` inside the function body, callers accessing `metrics.alertLocations` would get `undefined` at runtime but no compile-time error because there is no named contract. PROPOSAL: Declare `export interface DashboardMetrics { totalLocations: number; avgAqi: number; avgTemp: number; alertLocations: number; lastUpdated: Date }` and annotate the method as `async getDashboardMetrics(locationIds?: string[]): Promise<DashboardMetrics>`.

**Proposed actions:**
- Declare `DailyForecastEntry` interface in `data/dashboardData.ts:195`; import and apply in `useDashboardData.ts` — H/L, score 3.0; ties current top 10, does not displace (all rows at 3.0)
- Add inline response type casts to all 7 `response.json()` calls in `services/aiService.ts` — M/L, score 2.0; does not enter top 10
- Narrow `JSON.parse` return to `unknown` in `UserPreferencesContext.tsx:139,290`; add object-shape guard — H/L, score 3.0; ties current top 10, does not displace
- Replace `data: any[]` with `data: ChartDataRow[]` in all 4 chart component props — M/L, score 2.0; does not enter top 10
- Declare `DashboardMetrics` interface and annotate `getDashboardMetrics` return type in `dataService.ts:297` — M/L, score 2.0; does not enter top 10

### Run #45 — 2026-05-30 — Lens: Live-time claim audit
**Scope:** Third live-time claim audit pass. Examined: `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-analytics/app/context.py`, `hooks/useRealtimeAQI.ts`, `hooks/useLiveData.ts`, `components/AirQualityMapView.tsx`, `components/dashboard/LiveDashboard.tsx`, `components/dashboard/widgets/AqiGaugeWidget.tsx`, `components/dashboard/widgets/AqiTrendWidget.tsx`. Cross-referenced archived findings from runs #15 and #30 to exclude previously-reported items.

**Findings:**

- OBSERVATION: `context.py:20` declares `SOURCE_INTERVALS["purpleair"] = 120` (2 minutes), while `config.rs:27` shows the actual default poll interval is `600` seconds (10 minutes). The `_freshness()` function at `context.py:45` marks a source as stale when `age_seconds > interval * 2`, making the threshold 240 seconds (4 minutes). Under the default configuration, PurpleAir data is fetched every 10 minutes but the analytics service declares it stale after only 4 minutes — meaning for 6 of every 10 minutes, Claude receives a context string with `STALE data sources: purpleair` and the warning `⚠ IMPORTANT: Stale data sources may not reflect current conditions`. Claude then adds unnecessary uncertainty caveats to every AQI response during those 6 minutes, even though the data is only 4–9 minutes old and perfectly within the intended refresh window. The mismatch also propagates to `build_context_text():85-91` which lists sources as `stale_sources` and injects them into every prompt. PROPOSAL: Align `SOURCE_INTERVALS["purpleair"]` in `context.py:20` to match `config.rs:27`'s default of `600`; or better, read the interval from a shared config/environment variable so both services stay in sync automatically.

- OBSERVATION: `broadcast.rs:106-108` — inside the broadcast ticker (runs every `broadcast_interval_secs`, default 5 s), cached `AqiReading` structs are re-stamped with a fresh `now` before broadcast: `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()`. The `AqiReading.timestamp` field (declared in `aqi.rs:24`) is intended to represent when the sensor measurement was taken, but it is unconditionally overwritten with the current system time at every broadcast tick. The same pattern appears in the REST snapshot handler at `routes/aqi.rs:17-24`: `live.iter().map(|r| aqi::AqiReading { timestamp: now, ..r.clone() }).collect()`. Because PurpleAir is polled every 10 minutes but broadcast every 5 seconds, each `sensor_readings` DB row (written by `persist::write_readings`) receives a timestamp 0–5 seconds old even if the underlying sensor measurement was made 9 minutes ago. The `lastUpdated` value shown in `WidgetShell` is derived from the HTTP response timestamp, not from the sensor fetch time — so users and Claude see the data as perpetually "just updated" when it may be up to 10 minutes stale. PROPOSAL: Add a `fetched_at: DateTime<Utc>` field to `AqiReading` that is set when the PurpleAir API call returns and never overwritten; propagate it through `broadcast.rs` and `routes/aqi.rs`; expose it in the SSE event JSON and REST response so the frontend can display the true data age rather than the broadcast age.

- OBSERVATION: `routes/aqi.rs:64-73` — the `GET /api/aqi-history` handler calls `aqi::generate_history(&params.station_id, hours)` unconditionally. `aqi::generate_history()` at `aqi.rs:138-162` is a pure **random-walk generator** with no database access — it produces a synthetic 24-hour AQI series by random-walking `aqi_walk` with `rng.gen_range(-5.0..5.0)` increments. It never queries `sensor_readings`. The handler also accepts `station_id=AQ-001` (from `default_station()` at `aqi.rs:50`) — a string that has no corresponding row in the database; the real stations use UUIDs (`a1b2c3d4-0001-4000-8000-000000000001` etc.). `AqiTrendWidget.tsx:21` calls this endpoint with `station_id=AQ-001&hours=24` and renders the result as the "AQI Trend (24h)" chart on the Live Dashboard. **Every data point in the 24-hour trend chart is fabricated**, refreshed with new random values every 2 minutes (`refreshInterval: 120_000`). Users who look at the trend chart to decide outdoor activity timing, and Claude when it queries `/api/aqi-history` via tool use, receive entirely synthetic data while the real historical measurements sit unused in the `sensor_readings` TimescaleDB table. PROPOSAL: Replace the `history` handler body in `routes/aqi.rs:64-73` with a `SELECT time, aqi, pm25, pm10, o3 FROM sensor_readings WHERE location_id = $1 AND time > now() - make_interval(hours => $2) ORDER BY time ASC` query; accept the real UUID format station IDs; update `AqiTrendWidget.tsx` to pass a valid UUID.

- OBSERVATION: `useRealtimeAQI.ts:286-306` — the SSE `aqi-update` event parser destructures `stationId, stationName, lat, lng, county, timestamp, aqi, pm25, pm10, o3, no2, so2, co, temperature, humidity, windSpeed, windDirection` from each reading, but **omits the `source` field**. The Rust ingestion service (`aqi.rs:38`) includes `source: &'static str` in the serialized SSE payload — values can be `"purpleair"` (real sensor), `"mock"` (generated gap-fill for stations with no nearby PurpleAir sensor), or `"airnow"`. When `broadcast.rs:76-94` fills in stations with no nearby sensors using `aqi::generate_readings()`, those mock readings (with `source: "mock"`) are merged into the broadcast and pushed over the SSE stream — but `useRealtimeAQI` silently discards `source`, making mock in-service gap-fills indistinguishable from real PurpleAir readings in the frontend. The `AirQualityMapView.tsx:413` status indicator shows `'🔴 Live'` whenever `isConnected` is true, regardless of whether the stream contains real sensor data or mock gap-fills. The subtitle at `AirQualityMapView.tsx:405` always reads "Live 3D WebGL Statistical Model" even when all city readings originate from the random generator. The `AqiGaugeWidget.tsx:67` does correctly display "PA" / "EPA" badge for readings from `useAqiSnapshot()` (the REST path), but the SSE-driven 3D map has no equivalent disclosure. PROPOSAL: Add `source: string` to the parsed reading shape in `useRealtimeAQI.ts:288-306`; pass it through `RealtimeCityData`; render a small "⚠ Simulated" badge on map markers whose `source === "mock"`; conditionally change `AirQualityMapView.tsx:405` subtitle to "Live 3D WebGL Statistical Model (partial simulated data)" when any city source is `"mock"`.

**Proposed actions:**
- Align `SOURCE_INTERVALS["purpleair"]` in `context.py:20` with `config.rs:27` default (600 s); or inject via shared env var — M/L, score 2.0; does not enter top 10
- Add `fetched_at` field to `AqiReading` in `aqi.rs`; stop overwriting `timestamp` in `broadcast.rs:106-108` and `routes/aqi.rs:24` — H/L, score 3.0; ties current top 10, does not displace
- Replace synthetic `aqi::generate_history()` in `routes/aqi.rs:64-73` with real DB query against `sensor_readings`; update `AqiTrendWidget.tsx` station ID — H/L, score 3.0; ties current top 10, does not displace
- Add `source` to `useRealtimeAQI.ts:288-306` parsed shape; render "Simulated" badge on mock map markers; update `AirQualityMapView.tsx:405` subtitle conditionally — M/L, score 2.0; does not enter top 10

### Run #44 — 2026-05-30 — Lens: Competitive scan (web)
**Scope:** Fourth competitive-scan pass. Web searches on IQAir, BreezoMeter, Plume Labs, Ambee, AQI.IN, AQIWatch, AirNow, and 2025–2026 air-quality-app market analyses. Cross-referenced in-repo code: `components/SettingsView.tsx`, `contexts/UserPreferencesContext.tsx`, `geointellisense-analytics/app/ml/aqi_model.py`, `app/routes/predict.py`, `app/clients/caltrans.py`, `utils/accessibility.tsx`, `app/routes/enviroscreen.py`. Checked archive of runs #14 and #29 to avoid duplicates.

**Findings:**

- OBSERVATION: Pollen/allergen data is entirely absent from GeoIntelliSense. Searching all `.py`, `.ts`, and `.tsx` files for "pollen" returns zero matches. All major competitors — IQAir AirVisual, BreezoMeter, and Plume Labs — expose pollen count as a first-class data layer alongside PM2.5/O₃. BreezoMeter's pollen API covers tree, grass, and weed species with daily counts and forecasts. The platform already pulls from 30+ environmental data sources including CalEnviroScreen, NOAA, NWS, and PurpleAir; there is no architectural barrier to adding a pollen client. The EPA's National Allergy Bureau data and Google Pollen API are both REST-accessible. The absence means users with hay fever or allergic asthma cannot use GeoIntelliSense to plan their outdoor activity around pollen peaks — a feature category where every leading competitor is differentiated. PROPOSAL: Add a `pollen.py` client (e.g. consuming Google Pollen API or Ambee pollen endpoint) under `geointellisense-analytics/app/clients/`; add a `/api/pollen` route; surface pollen data in the Claude context in `context.py` and in a new `PollenWidget` component.

- OBSERVATION: The AQI alert threshold collected in `contexts/UserPreferencesContext.tsx:98` (`aqiAlertThreshold: 100`) and rendered via the slider at `components/SettingsView.tsx:739` is never acted upon. A full-text search of all `.ts` and `.tsx` files finds zero calls to `new Notification(...)` or `new Audio(...)`. The Web Notification permission is requested at `SettingsView.tsx:553–558` when the user enables notifications, but the SSE stream in the frontend (which receives live AQI readings via `EventSource`) never checks incoming values against `preferences.notifications.aqiAlertThreshold` and never fires the browser Notification API. The `soundEnabled` preference at `UserPreferencesContext.tsx` is similarly collected but never read outside the settings UI. Competitors such as IQAir AirVisual and AQI.IN both fire push alerts when AQI crosses a user-defined threshold. In GeoIntelliSense the alert infrastructure is UI-complete but data-dead: users who enable notifications and set thresholds will never receive them. PROPOSAL: In the SSE handler (or in the hook that consumes the AQI stream), compare each incoming AQI value against `preferences.notifications.aqiAlertThreshold`; when crossed, call `new Notification('AQI Alert', { body: ... })` if permission is granted; play an alert tone if `soundEnabled` is true. Effort is low — the permission and preference plumbing already exist.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:155` trains exclusively with a 24-hour lookahead (`target = AQI at T+24h`). The `/api/predict/aqi` endpoint (`app/routes/predict.py:52`) returns a single scalar prediction — one value for "24 hours from now." IQAir offers 7-day AQI forecasts; BreezoMeter's air-quality API includes hourly forecasts up to 4 days; Plume Labs provides 7-day forecasts. Trace Air Quality's physics-based AI model, highlighted at the 2026 American Meteorological Society meeting, provides 4-day advance warning with verified accuracy during the 2025 wildfire season. GeoIntelliSense shows one data point in its prediction widget while competitors show a multi-day forecast chart that users can use for trip/activity planning. The model training loop in `aqi_model.py:84–202` already produces rich feature vectors (PM2.5, temperature, inversion, fire proximity, day-of-week, hour); extending it to output a 48h/72h/7-day forecast requires generating separate target columns or a multi-step regression and adding corresponding prediction rows to the `/api/predict/aqi` response. PROPOSAL: Extend `build_training_data()` to produce targets at T+24h, T+48h, and T+72h; return a `forecasts: [{hour, predicted_aqi, confidence_interval}]` array from `/api/predict/aqi`; add a `AqiForecastChart` that renders the multi-step series.

- OBSERVATION: BreezoMeter's "Cleanest Route API" scores each proposed travel route from 0–100 by integrating spatially-weighted AQI, traffic density, and noise along the route waypoints — allowing navigation apps to offer the least-polluted commute option. GeoIntelliSense has real-time traffic data from the CalTrans client (`geointellisense-analytics/app/clients/caltrans.py`) stored in the `traffic_readings` table, fire detections in `fire_detections` with PostGIS geometry (`db/migrations/012_fire_detections.sql`), and per-station AQI in `sensor_readings`. All the spatial data needed for route-pollution scoring is present in TimescaleDB, but no endpoint exposes it in a route context. The `MapView.tsx` and `AirQualityMapView.tsx` components render pollution overlays on a static map but do not accept origin/destination inputs or score routes. This is a differentiating feature that no open-source AQI tool currently offers outside of proprietary commercial APIs. PROPOSAL: Add a `POST /api/route-aqi` endpoint that accepts a polyline of route waypoints and queries `sensor_readings` for the nearest station within a configurable radius for each segment; return a per-segment AQI array and an overall route score; wire the result into a route-comparison panel in `MapView.tsx`.

- OBSERVATION: IQAir AirVisual, AQI.IN, and the AirBuddy asthma app (published in _Frontiers in Digital Health_, 2025) all support a health profile where users declare conditions such as asthma, COPD, heart disease, or membership in a sensitive age group (child/elderly) and receive differentiated advice — e.g., an asthmatic user sees a stricter alert threshold and condition-specific activity guidance ("avoid prolonged outdoor exertion when AQI > 50 for sensitive groups"). GeoIntelliSense's `utils/accessibility.tsx:283–291` hard-codes standard EPA AQI health descriptions that are identical for all users. The `aqiAlertThreshold` in settings is a single slider with no association to a health condition. Claude's chat context (`geointellisense-analytics/app/context.py`) does not include any user health profile, so the AI responses apply generic guidance rather than condition-specific advice even though the CalEnviroScreen `asthma_pctl` field (`routes/enviroscreen.py:244`) already provides census-tract asthma burden data that could seed personalized guidance. PROPOSAL: Add a `healthProfile` object to `UserPreferencesContext` (conditions: `["asthma"|"copd"|"heart"|"child"|"elderly"]`); inject it into Claude's system context in `context.py` so chat and analysis responses reference the user's declared condition; lower the default `aqiAlertThreshold` for sensitive conditions; show condition-specific advice in `utils/accessibility.tsx` descriptions.

**Proposed actions:**
- Add pollen client + `/api/pollen` route + `PollenWidget` — M/M, score 1.0; does not enter top 10
- Wire SSE AQI stream to check `aqiAlertThreshold` and fire `new Notification()` — H/L, score 3.0; ties current top 10, does not displace
- Extend `aqi_model.py` to 48h/72h multi-step forecast; update `/api/predict/aqi` response shape — H/M, score 1.5; does not enter top 10
- Add `POST /api/route-aqi` endpoint; add route comparison panel in `MapView.tsx` — M/H, score 0.67; does not enter top 10
- Add `healthProfile` to `UserPreferencesContext`; inject into Claude context in `context.py` — M/M, score 1.0; does not enter top 10

## 📚 Archive (one line per past run)
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
