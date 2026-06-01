# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T00:18:00Z
Last run: #91 — Lens: Type safety

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
### Run #91 — 2026-06-01 — Lens: Type safety
**Scope:** Seventh type safety pass. Examined: `components/charts/AQITrendChart.tsx`, `components/charts/PM25TrendChart.tsx`, `components/charts/TemperaturePrecipitationChart.tsx`, `components/charts/WeatherForecastChart.tsx`, `hooks/useDashboardData.ts`, `components/3d/AQI3DScene.tsx`, `data/dashboardData.ts`, `services/dataService.ts`, `components/AccessibleChart.tsx`, `hooks/useLiveData.ts`, `hooks/useNormalizedData.ts`, `services/aiService.ts`. Cross-checked against Active Recommendations and runs #88–#90 (Latest Findings) plus archived type safety runs #1, #16, #31, #46, #61, #76 to confirm all findings are new.

**Findings:**

- OBSERVATION: `components/charts/AQITrendChart.tsx:15`, `components/charts/PM25TrendChart.tsx:15`, `components/charts/TemperaturePrecipitationChart.tsx:15`, `components/charts/WeatherForecastChart.tsx:14` — All four chart components declare their `data` prop as `data: any[]`. Each component receives pivot-table rows whose shape is dynamically computed: `AQITrendChart` expects `{ month: string; [locationName: string]: number }`, `WeatherForecastChart` expects `{ day: string; [loc_temp: string]: number }`, `TemperaturePrecipitationChart` expects `{ month: string; [loc_temp: string]: number; [loc_precip: string]: number }`. With `data: any[]`, TypeScript performs no shape check on the passed arrays. A caller could silently pass `mergedHumidityData` (which has a `month` key) to `WeatherForecastChart` (which expects a `day` key) — TypeScript would not complain, but Recharts' `XAxis dataKey="day"` would silently render an empty axis. A shared alias `type ChartDataPoint = { [key: string]: string | number | undefined }` would at minimum distinguish chart data from arbitrary `unknown[]`, and individual per-chart interfaces would provide full safety. PROPOSAL: Export `type ChartDataPoint = { [key: string]: string | number | undefined }` from `components/charts/index.ts` and replace `data: any[]` in all four chart component interfaces with `data: ChartDataPoint[]` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `hooks/useDashboardData.ts:179,223,267,311` — The four weather-metric aggregate `useMemo` blocks (`mergedHumidityData` lines 167–208, `mergedWindData` lines 210–252, `mergedUVData` lines 254–296, `mergedAgriculturalData` lines 298–342) all include `locEntry.dailyForecast.forEach((day: any) =>`. The `generateDailyForecast` function at `data/dashboardData.ts:195` returns an inferred array of objects with fully typed fields including `humidity: number`, `wind: { speed: number; ... }`, `uv: number`, `evapotranspiration: number`, `solarRadiation: number`. TypeScript infers this type from the function body — no annotation is missing. The `(day: any)` annotation deliberately silences the compiler for those field accesses (lines 190, 234, 278, 322-323) rather than using the correct inferred type. If `generateDailyForecast` were to rename a field (e.g., `evapotranspiration` → `et0`), the mismatched access at line 322 (`day.evapotranspiration`) would produce `undefined` at runtime with no compile error. The correct fix is to derive the day's type from the return value: `type DailyForecastDay = ReturnType<typeof generateDailyForecast>[number]` and annotate `(day: DailyForecastDay)` in all four callbacks. Additionally, lines 197, 241, 285, and 330 all declare `const result: any[] = []` and `const entry: any = { month }` — the narrowly typed accumulator Maps are immediately discarded at the result-assembly step. PROPOSAL: Export `type DailyForecastDay = ReturnType<typeof generateDailyForecast>[number]` from `data/dashboardData.ts`; replace `(day: any)` with `(day: DailyForecastDay)` in the four forEach callbacks in `useDashboardData.ts`; replace `const result: any[]` and `const entry: any` with a concrete type (e.g., `type MonthChartPoint = { month: string; [locationKey: string]: string | number }`) — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `CameraController` declares `const controlsRef = useRef<any>(null)` for the ref attached to `<OrbitControls ref={controlsRef} ...>` (line 79). `OrbitControls` is imported from `@react-three/drei` (line 8), which wraps `three/examples/jsm/controls/OrbitControls`. The method `controlsRef.current.getTarget(target)` is called at line 71 — with `useRef<any>`, this call and all other `controlsRef.current.*` accesses are unchecked. The correct ref type is `import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls'` which exposes `getTarget(target: THREE.Vector3): THREE.Vector3`, `getPolarAngle(): number`, `getAzimuthalAngle(): number`, and the `enabled` setter used elsewhere in `OrbitControls`. Additionally, lines 105, 175 in the same file correctly use `useRef<THREE.DirectionalLight>(null)` and `useRef<THREE.Mesh>(null)` — the inconsistency is specific to the `OrbitControls` ref where the drei wrapper complicates the type. PROPOSAL: Add `import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls'` to `AQI3DScene.tsx` and change line 57 to `useRef<ThreeOrbitControls>(null)` — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `data/dashboardData.ts:195` and `services/dataService.ts:297` — Two public API surfaces lack explicit return type annotations, making their inferred types invisible to callers. `generateDailyForecast` at `dashboardData.ts:195` returns a complex array of ~30-field objects (date, temp, humidity, wind, aqi, pm25, hourlyData, etc.) but its return type is completely inferred — no `DailyForecastDay` interface is exported from the module. This is the structural root cause of the `(day: any)` pattern in `useDashboardData.ts` (Finding 2 above): without an exported named type, a developer faced with accessing forecast day fields has no autocomplete or type documentation, making `(day: any)` the path of least resistance. `DataService.getDashboardMetrics()` at `dataService.ts:297` similarly lacks a return type annotation — TypeScript infers `Promise<{ totalLocations: number; avgAqi: number; avgTemp: number; alertLocations: number; lastUpdated: Date }>`, but no `DashboardMetrics` interface is exported, so callers that access the result cannot validate field names or add new fields without risking silent omissions. PROPOSAL: (1) Export `interface DailyForecastDay { date: string; dayOfWeek: string; temp: { current: number; min: number; max: number; feelsLike: number }; humidity: number; wind: { speed: number; gust: number; direction: string }; uv: number; aqi: number; pm25: number; evapotranspiration: number; solarRadiation: number; /* ...rest */ }` from `data/dashboardData.ts` and annotate the function return `DailyForecastDay[]`; (2) export `interface DashboardMetrics { totalLocations: number; avgAqi: number; avgTemp: number; alertLocations: number; lastUpdated: Date }` from `services/dataService.ts` and annotate `getDashboardMetrics(): Promise<DashboardMetrics>` — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Export `type ChartDataPoint = { [key: string]: string | number | undefined }` from `components/charts/index.ts`; replace `data: any[]` in all four chart component Props interfaces — M/L, score 2.0
- Export `type DailyForecastDay` from `data/dashboardData.ts`; replace `(day: any)` and `const result: any[]` / `const entry: any` in the four aggregate blocks in `useDashboardData.ts` — M/L, score 2.0
- Add `import type { OrbitControls as ThreeOrbitControls }` from three.js and change `useRef<any>` to `useRef<ThreeOrbitControls>` at `AQI3DScene.tsx:57` — M/L, score 2.0
- Export `interface DailyForecastDay` from `dashboardData.ts` and `interface DashboardMetrics` from `dataService.ts`; annotate return types explicitly — M/L, score 2.0

### Run #90 — 2026-05-31 — Lens: Live-time claim audit
**Scope:** Sixth live-time claim audit pass. Examined: `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-ingestion/src/purpleair.rs`, `docker-compose.yml`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/routes/nws_forecast.py`, `geointellisense-analytics/app/routes/inversion.py`, `hooks/useRealtimeAQI.ts`, `hooks/useLiveData.ts`, `components/AirQualityMapView.tsx`, `components/dashboard/widgets/AqiTrendWidget.tsx`. Cross-checked against Active Recommendations and runs #87–#89 (Latest Findings) to confirm all findings are new.

**Findings:**

- OBSERVATION: `broadcast.rs:106-110` + `routes/aqi.rs:23-25` + `AirQualityMapView.tsx:413-416` — Both the broadcast ticker (`spawn_ticker`) and the REST `/api/aqi-snapshot` handler re-stamp every cached `AqiReading` with the current server time (`Utc::now()`) on every cycle (default every 5 seconds per `docker-compose.yml:57: BROADCAST_INTERVAL_SECS:-5`). With `PURPLEAIR_INTERVAL_SECS=600` (confirmed at `docker-compose.yml:56`), sensor values can be up to 10 minutes old while carrying a `timestamp` of "just now." `AirQualityMapView.tsx:413` renders `🔴 Live` when `isConnected` and line 416 shows `lastUpdate.toLocaleTimeString()`—which reflects the SSE receive time, not the measurement time. There is no `polledAt` or `measuredAt` field to distinguish broadcast time from measurement time in any API response. Users reading "🔴 Live — 11:09 PM" perceive freshly-measured data, when the PurpleAir sensors may have last been queried at 10:59 PM. PROPOSAL: Add a `polledAt: DateTime<Utc>` field to `AqiReading` in `aqi.rs`, set at PurpleAir fetch time in `purpleair.rs` and preserved (not overwritten) in the broadcaster; surface it in the UI as "Sensor data as of HH:MM" separate from the connection timestamp — H/M, score 1.5; does not displace top 10.

- OBSERVATION: `routes/aqi.rs:64-68` + `aqi.rs:138-162` + `AqiTrendWidget.tsx:20-22` — The `/api/aqi-history` endpoint always calls `aqi::generate_history()`, which is a pure Rust random-walk simulation using `rand::thread_rng()` (`aqi.rs:139`). It never issues a database query. This is the case even when PurpleAir data is configured and TimescaleDB has been receiving real readings via `persist::write_readings` every 5 seconds. `AqiTrendWidget.tsx:20-22` calls `useLiveData('/api/aqi-history?station_id=AQ-001&hours=24', { refreshInterval: 120_000 })` and renders the result as "AQI Trend (24h)" in the dashboard. Because `generate_history` is called fresh on each request with a new random seed, every 120-second refresh produces a completely different fictional 24-hour history. The trend chart has no continuity between renders—peaks and valleys in the previous render do not exist in the next. No disclaimer or label distinguishes the simulated curve from real historical data. PROPOSAL: Replace `aqi::generate_history()` in `routes/aqi.rs:66` with an async `sqlx` query against `sensor_readings WHERE location_id = $1 AND time > now() - interval '24 hours' ORDER BY time` to return real persisted data; fall back to the generator only when the result set is empty — H/M, score 1.5; does not displace top 10.

- OBSERVATION: `context.py:267-275` — `_get_forecast_context()` derives `last_updated` for the freshness check from `periods[0]["date"]`, which is the NWS period's `startTime` — a future timestamp (e.g., "2026-06-01T06:00:00-07:00"). Since this date is in the future, `age_seconds = (now - future_date).total_seconds()` is negative. `_freshness()` checks `stale = age_seconds > interval * 2` → `(negative) > 7200` → always `False`. The NWS forecast therefore always appears as `status: "live"` in Claude's context whenever cached data is present, regardless of how long ago it was fetched. If the Redis cache expired and a fresh NWS fetch failed silently (e.g., `httpx.TimeoutException`), the context returns `periods = []` → `last_updated = None` → `"unavailable"`. The "stale but present" state (cached data exists, but it is older than the TTL suggests) is structurally impossible for the forecast source. PROPOSAL: In `_get_forecast_context()`, use `datetime.now(timezone.utc)` as `last_updated` when periods are successfully loaded from Redis (trusting Redis TTL for cache expiry rather than attempting to derive fetch time from forecast dates); set `last_updated = None` only when no cached data exists — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `context.py:23` — `SOURCE_INTERVALS["purpleair"] = 120` with inline comment "PurpleAir fetcher runs every 2 min." The actual PurpleAir poll interval is `PURPLEAIR_INTERVAL_SECS`, which defaults to 600 seconds in both `config.rs:27` and `docker-compose.yml:56`. The staleness threshold derived from this value is `120 × 2 = 240 seconds`. In the current deployment (broadcast re-stamping, Finding 1), DB readings always appear seconds old so this does not cause a false "stale" alarm at runtime. However, if timestamp re-stamping is ever corrected (so `AqiReading.timestamp` reflects actual measurement time), any PurpleAir reading between 4 and 10 minutes old would be incorrectly flagged as stale—half the normal polling window. The wrong constant also misleads developers diagnosing freshness alerts. PROPOSAL: Change `context.py:23` to `"purpleair": 600` and update the comment to "# PurpleAir fetcher default: 10 min (PURPLEAIR_INTERVAL_SECS)" — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `AirQualityMapView.tsx:404-407` + `AirQualityMapView.tsx:390-395` — The component subtitle "Live 3D WebGL Statistical Model • San Joaquin Valley" (`AirQualityMapView.tsx:406`) is rendered unconditionally regardless of connection state. When the SSE connection fails and the `fallbackToMock` path activates (after 10 failed reconnect attempts, ~50 seconds), `AirQualityMapView.tsx:390-395` correctly shows an amber banner reading "Using simulated data (server unavailable)." The subtitle directly below continues to read "Live 3D WebGL Statistical Model," creating a contradictory signal: the header declares the visualization "live" while the banner says the underlying data is simulated. A user seeing both simultaneously receives conflicting information about data authenticity. PROPOSAL: Make the subtitle conditional: `{isConnected ? 'Live 3D WebGL Statistical Model' : (realtimeError ? 'Simulated Data — Server Unavailable' : 'Connecting…')} • San Joaquin Valley` at `AirQualityMapView.tsx:406` — L/L, score 1.0; does not displace top 10.

**Proposed actions:**
- Add `polledAt: DateTime<Utc>` to `AqiReading` in `aqi.rs`, preserve from PurpleAir fetch, do not overwrite in broadcaster; surface as "Sensor data as of HH:MM" distinct from SSE connection timestamp in `AirQualityMapView.tsx` — H/M, score 1.5
- Replace `aqi::generate_history()` in `routes/aqi.rs:66` with a real TimescaleDB query against `sensor_readings`; fall back to generator only when DB result is empty — H/M, score 1.5
- Fix `_get_forecast_context()` in `context.py:267-275` to use `datetime.now(timezone.utc)` as `last_updated` when cached periods exist, enabling accurate forecast staleness detection — M/L, score 2.0
- Update `SOURCE_INTERVALS["purpleair"]` in `context.py:23` from 120 to 600 and fix the comment — L/L, score 1.0
- Make the subtitle in `AirQualityMapView.tsx:406` conditional on `isConnected` to resolve the live/simulated contradiction — L/L, score 1.0

### Run #89 — 2026-05-31 — Lens: Competitive scan (web)
**Scope:** Sixth competitive scan pass. Examined: `contexts/UserPreferencesContext.tsx`, `components/SettingsView.tsx`, `hooks/useRealtimeAQI.ts`, `hooks/useDashboardData.ts`, `hooks/useLiveData.ts`, `geointellisense-analytics/app/routes/airnow.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/routes/weather_forecast.py`, `geointellisense-analytics/app/routes/explore.py`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-analytics/app/clients/airnow.py`. Web research: IQAir AirVisual, AirNow mobile app, EnviroFlash, AccuWeather AQI alerts, Clarity Movement OpenMap, Plume Labs Flow, AI Air Quality Insights (App Store), arxiv:2505.10556 (personalized health response framework). Cross-checked against Active Recommendations and prior competitive scan runs #14, #29, #44, #59, #74 (all archived) to confirm all findings are new.

**Findings:**

- OBSERVATION: `contexts/UserPreferencesContext.tsx:20-25` and `components/SettingsView.tsx:552-557` — GeoIntelliSense exposes a full notification settings UI: `NotificationSettings` defines `enabled: boolean`, `aqiAlertThreshold: number` (default 100), `temperatureAlertHigh`, `temperatureAlertLow`, and `soundEnabled`. `SettingsView.tsx:553-557` calls `Notification.requestPermission()` and stores `enabled: true` in `localStorage` when granted. A user who enables this feature reasonably expects to be notified when AQI crosses 100. However, a full-text search of `useRealtimeAQI.ts`, `useDashboardData.ts`, `useLiveData.ts`, `App.tsx`, and every other hook and component confirms that **no code anywhere reads `notifications.aqiAlertThreshold`** or calls `new Notification(...)` when a live reading arrives. The threshold is stored but never compared against the AQI values polled every 30 s by `useLiveData`. Every major competitor — IQAir, AirNow mobile, EnviroFlash, AccuWeather SkyGuard — delivers threshold-crossing alerts as a core feature; GeoIntelliSense's settings UI creates a false impression of a working alert system without the implementation behind it. PROPOSAL: In `hooks/useLiveData.ts` (or a new `hooks/useAqiAlerts.ts`), add a `useEffect` that compares the current AQI reading from the live data stream against `preferences.notifications.aqiAlertThreshold`; when `notifications.enabled && currentAqi >= aqiAlertThreshold && Notification.permission === 'granted'`, fire `new Notification('GeoIntelliSense Alert', { body: \`AQI is ${currentAqi} — above your threshold of ${aqiAlertThreshold}\`, icon: '/favicon.ico' })` with debounce to avoid re-firing on every poll — H/M, score 1.5; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/app/routes/airnow.py:60-97` — The analytics service implements a `/api/airnow/forecast` endpoint that queries `AirNowClient.get_all_sjv_forecast()` and returns per-city next-day AQI forecasts from the EPA AirNow program. This endpoint is registered in `main.py` and fully functional when `AIRNOW_API_KEY` is configured. A grep of all TypeScript source files (`services/dataService.ts`, `services/AirQualityService.ts`, `App.tsx`, all hooks, all components) returns **zero calls to `/api/airnow/forecast`** — the endpoint exists in the Python backend but is entirely absent from the frontend data layer and UI. By contrast, the NWS weather forecast is wired through `services/WeatherService.ts` and displayed in `components/CalendarView.tsx`. IQAir surfaces a 7-day AQI forecast; AirNow's mobile app surfaces a 72-hour hourly forecast with AQI category coloring; AccuWeather shows hourly AQI for the next 24 hours. GeoIntelliSense shows users a weather forecast but no corresponding AQI forecast, despite the data already being available from the backend. PROPOSAL: Add `fetchAirNowForecast(city?: string): Promise<AirNowForecast[]>` to `services/dataService.ts` calling `GET /api/airnow/forecast`; surface the multi-day AQI forecast in `components/CalendarView.tsx` alongside the existing NWS weather forecast with AQI category color bands — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `geointellisense-analytics/app/routes/predictive_analysis.py:18-31` and `app/routes/weather_forecast.py` — The `PredictiveAnalysisRequest` Pydantic model accepts `locationName`, `historicalAqi`, `historicalWeather`, `customFactors`, `startDate`, and `endDate`. The `customFactors` field is a free-text string. Neither endpoint accepts a structured user health profile. Claude's system prompts (`PREDICTIVE_SYSTEM` at `predictive_analysis.py:12-15`, and the `SJV_SYSTEM` injected by `get_system_with_live_context` in `context.py`) contain no reference to user health conditions. A user with asthma, COPD, or cardiovascular disease receives identical advice to a healthy adult. Recent competitive platforms — specifically the AI Air Quality Insights app (App Store, id6751322624) and the personalized health response framework (arxiv:2505.10556) — accept health profiles (condition type, age group, activity level, sensitivity) and use them to tailor advice: e.g., "Move your outdoor run to before 7 AM given your asthma and current ozone at 68 ppb" vs. the generic "Air quality is moderate today." GeoIntelliSense's deep SJV environmental justice focus makes this gap particularly visible, since CalEnviroScreen data already identifies high-vulnerability census tracts. PROPOSAL: Add an optional `healthProfile: { conditions: list[str], ageGroup: str, activityLevel: str }` field to `PredictiveAnalysisRequest` and `WeatherForecastRequest`; when present, inject it as a structured `<user_health_profile>` XML block into the Claude prompt before the data section so it shapes health recommendations — M/M, score 1.0; does not displace top 10.

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs:28-33` and `geointellisense-analytics/app/clients/airnow.py:140-188` — The Rust ingestion struct `SensorReading` records `o3: f64`, `no2: f64`, `so2: f64`, `co: f64` per reading (lines 30-33), and these fields are present in the broadcast payload. However, the AirNow client Python code at `airnow.py:187-189` hardcodes `"no2": None, "so2": None, "co": None` — only PM2.5 and O3 are populated from the AirNow API response (lines 140-158). The `explore.py` available-sources dict (lines 14-22) does not include O3, NO2, SO2, or CO as explorable series — only AQI, PM2.5, temperature, humidity, wind speed, fires, fire FRP, earthquakes, and inversion. The DB schema (`db/init/`) must also omit these columns since explore queries only target `sensor_readings.aqi` and `sensor_readings.pm25`. In the San Joaquin Valley, ozone is frequently the dominant AQI-driving pollutant in summer (Kern County routinely exceeds the 8-hour O3 NAAQS). IQAir, AirNow, and OpenAQ all surface per-pollutant AQI values and indicate which pollutant is driving the overall AQI. GeoIntelliSense cannot tell users whether their 120 AQI is driven by ozone (avoid afternoon outdoor exercise) vs. PM2.5 (wear a mask), limiting actionability of the data. PROPOSAL: (1) Verify and add `o3`, `no2`, `so2`, `co` columns to the `sensor_readings` TimescaleDB table; (2) persist these fields from the ingestion broadcast; (3) populate `o3` from AirNow at `airnow.py:158` (it is already parsed) and remove the hardcoded `None`s for no2/so2/co; (4) add these four series to `SOURCES_META` in `explore.py` — M/H, score 0.67; does not displace top 10.

- OBSERVATION: Codebase-wide — No shareable URL, no embeddable widget, and no permalink infrastructure exists anywhere in the codebase. A search across all `.ts`, `.tsx`, and `.py` files returns no results for `share`, `embed`, `permalink`, `public dashboard`, or `snapshot URL`. The app's map state (center, zoom, active layers), selected location(s), and time range are held in React component state and `UserPreferencesContext` — none of it is reflected in the URL's query string or hash. Clarity Movement's OpenMap, PurpleAir's public sensor pages, the AirNow interactive EPA map (embed widget at `gispub.epa.gov/airnow/`), and IQAir city pages are all publicly accessible and shareable via URL. Environmental advocacy organizations, local journalists, and community health researchers — a key GeoIntelliSense audience given its SJV/environmental-justice focus — routinely need to share a specific location's current conditions or embed a live widget in a report or website. Without a shareable URL, every user must re-navigate to the same view independently. PROPOSAL: Serialize current map center, zoom level, selected location keys, active overlay layers, and date range into URL query params (e.g., `?loc=Bakersfield&zoom=10&lat=35.37&lng=-119.02&layers=aqi,fires`) using `URLSearchParams` on state change; add a "Share" button that copies the current URL to clipboard — M/H, score 0.67; does not displace top 10.

**Proposed actions:**
- Wire `notifications.aqiAlertThreshold` in a `useEffect` inside `hooks/useLiveData.ts` to fire `new Notification(...)` when the live AQI exceeds the stored threshold — H/M, score 1.5; does not displace top 10
- Add `fetchAirNowForecast()` to `services/dataService.ts` and surface the existing `/api/airnow/forecast` endpoint in `CalendarView.tsx` alongside the NWS weather forecast — M/L, score 2.0; does not displace top 10
- Add optional `healthProfile` field to `PredictiveAnalysisRequest` / `WeatherForecastRequest` and inject it as a structured XML block into Claude prompts for personalized health advice — M/M, score 1.0; does not displace top 10
- Add O3/NO2/SO2/CO to `sensor_readings` schema, persist from ingestion broadcast, fix `airnow.py:187-189` hardcoded `None`s, and add these series to `explore.py:SOURCES_META` — M/H, score 0.67; does not displace top 10
- Serialize map state and selected filters into URL query params; add a "Share" button — M/H, score 0.67; does not displace top 10

## 📚 Archive (one line per past run)
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
