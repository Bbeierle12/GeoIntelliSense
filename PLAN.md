# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-31T09:05:00Z
Last run: #76 — Lens: Type safety

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
### Run #76 — 2026-05-31 — Lens: Type safety
**Scope:** Sixth type-safety pass. Examined: `tsconfig.json`, all `.ts`/`.tsx` files outside `node_modules`. Focused searches: `grep ": any"`, `grep "as any"`, `grep "useRef<any>"`, `grep "Record<string, any>"`, `grep "JSON.parse"`. Verified all findings as new vs. prior type-safety runs #1, #16, #31, #46, #61 (archived; full detail not available in this window).

**Findings:**

- OBSERVATION: `tsconfig.json` — The project's compiler options include no strictness flags. `"strict": true` is absent, as are the six individual flags it enables (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`). Without `noImplicitAny`, the `data: any[]` props in chart components and `(day: any)` casts in `useDashboardData.ts` are accepted silently rather than flagged as errors. Without `strictNullChecks`, the null-checks guarding `controlsRef.current` and `mapInstanceRef.current` do not receive exhaustiveness enforcement. The only strictness-adjacent option present is `"isolatedModules": true`, which enforces per-file transpilation but provides no type-soundness guarantees. The practical consequence is that TypeScript operates as a documentation tool rather than a correctness enforcer: callers can pass wrong shapes to typed functions and the compiler will not catch it. PROPOSAL: Add `"strict": true` to `tsconfig.json`'s `compilerOptions`. Then run `tsc --noEmit` to enumerate the resulting errors; the highest-density files to fix will be `hooks/useDashboardData.ts` (13 `any` usages at lines 179, 197, 199, 223, 241, 243, 267, 285, 287, 311, 330, 332) and the four chart component prop interfaces — H/M, score 1.5; does not displace top 10.

- OBSERVATION: `data/dashboardData.ts:195-334` — `generateDailyForecast(location: string, days: number)` has no explicit return type annotation. TypeScript infers the return type from the deeply-nested object literal pushed at lines 297-331: a complex structural anonymous type with nested objects `temp: { current, min, max, feelsLike }`, `wind: { speed, gust, direction }`, `precipitation: { probability, amount, type }`, and a 24-element `hourlyData` array. At consumer sites `useDashboardData.ts:179`, 223, 267, 311, accessing the elements of `locEntry.dailyForecast` requires the cast `(day: any)` because TypeScript cannot match the inferred structural type against the `locEntry` union type's `dailyForecast` member in its inference context. With `day` typed as `any`, accesses like `day.wind.speed` (line 239), `day.humidity` (line 204), `day.uv` (line 288), and `day.evapotranspiration` (line 307) are never type-checked. If `generateDailyForecast` were refactored to rename `wind` to `windData` or `evapotranspiration` to `et0` for brevity, all four consumer call sites would silently begin returning `undefined` at runtime with no TypeScript error. PROPOSAL: (a) Define an explicit `DailyForecast` interface in `data/dashboardData.ts` mirroring the object shape at lines 297-331; (b) annotate `generateDailyForecast` with `: DailyForecast[]` as its return type; (c) remove all four `(day: any)` casts in `useDashboardData.ts` — TypeScript will then verify `.wind.speed`, `.humidity`, `.uv`, `.evapotranspiration` at compile time — M/L, score 2.0; does not displace top 10.

- OBSERVATION: `components/charts/AQITrendChart.tsx:15`, `PM25TrendChart.tsx:15`, `WeatherForecastChart.tsx:14`, `TemperaturePrecipitationChart.tsx:15` — All four chart components declare `data: any[]` in their props interfaces. The actual runtime data flowing in is produced by the `mergedHistoricalAqi`, `mergedHistoricalPm25`, `mergedHistoricalWeather`, and `mergedForecastData` computations in `Dashboard.tsx` and `useDashboardData.ts` — each of which is a `Record<string, string | number | undefined>` where the string key is a location name or a `locationName_metric` composite. With `data: any[]`, recharts `dataKey` props such as `dataKey={loc}` (e.g., `AQITrendChart.tsx:40`) and `dataKey={\`${loc}_temp\`}` (e.g., `TemperaturePrecipitationChart.tsx`) are unchecked — a refactor that changes the key naming convention would produce silently empty chart lines. Additionally, `AccessibleChart.tsx:79` and `AccessibleChart.tsx:165` define the same pattern as `data: Record<string, any>[]`. PROPOSAL: Define a shared `ChartDataPoint = Record<string, string | number | undefined>` type alias in `components/charts/index.ts`; replace `data: any[]` with `data: ChartDataPoint[]` in all four chart component interfaces and in `AccessibleChart.tsx:79,165` — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `const controlsRef = useRef<any>(null)`. At line 66, `controlsRef.current.getTarget(target)` is called inside `useFrame` with the guard `if (controlsRef.current && onCameraMove)`. With `useRef<any>`, TypeScript performs no method-existence check on `getTarget` — the `@react-three/drei` `OrbitControls` component wraps `three-stdlib`'s `OrbitControlsImpl` class, and `getTarget` is a valid method on that class. However, if a future drei upgrade renames `getTarget` to `getAzimuthalAngle` or removes it, the null guard at line 66 does not prevent a runtime `TypeError`. Additionally, the `useRef<any>` declaration means the ref's `.current` property is typed `any` throughout the component — including the `controlsRef.current.enableDamping` and similar property accesses that could be added in future maintenance without compiler feedback. The `@react-three/drei` package and `three-stdlib` are both present in `package.json`. PROPOSAL: `import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'`; change `useRef<any>(null)` to `useRef<OrbitControlsImpl | null>(null)` — the `null` union is required because the ref is initialized as `null` — L/L, score 1.0; does not displace top 10.

- OBSERVATION: `contexts/UserPreferencesContext.tsx:139` and `contexts/UserPreferencesContext.tsx:290` — Both `JSON.parse(stored)` at line 139 and `JSON.parse(json)` at line 290 return `any`. Both values are immediately spread into objects with explicit `UserPreferences` type annotations at lines 141-148 and 292-298 respectively. TypeScript accepts the spread without complaint because spreading an `any` value is always valid. The deep merge at lines 141-148 (`{ ...defaultPreferences, ...parsed, dataSettings: { ...defaultDataSettings, ...parsed.dataSettings }, ... }`) silently accepts any value for `parsed.dataSettings` — if the stored value has `dataSettings: null` (possible from a buggy prior serialization), the spread `...null` throws a `TypeError` at runtime. The same risk exists at `UserPreferencesContext.tsx:295`: `dataSettings: { ...defaultDataSettings, ...imported.dataSettings }`. The `importPreferences` function at lines 288-306 does catch the thrown error and returns `false`, but the `localStorage` initialization path at lines 136-154 does not wrap the spread in a try-catch — it wraps `JSON.parse` but not the subsequent spread. PROPOSAL: (a) Type `JSON.parse` results as `unknown` via `const parsed = JSON.parse(stored) as unknown`; (b) add a guard `if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid preferences format')` before the spread; (c) narrow each nested field similarly (`parsed.dataSettings` should be checked as object-or-undefined before spreading) — M/L, score 2.0; does not displace top 10.

**Proposed actions:**
- Add `"strict": true` to `tsconfig.json`; enumerate and fix resulting errors in `useDashboardData.ts` and chart components — H/M, score 1.5; does not displace top 10
- Define `DailyForecast` interface in `data/dashboardData.ts:195`; annotate return type; remove `(day: any)` casts in `useDashboardData.ts:179,223,267,311` — M/L, score 2.0; does not displace top 10
- Replace `data: any[]` with `ChartDataPoint[]` in four chart components and `AccessibleChart.tsx` — L/L, score 1.0; does not displace top 10
- Replace `useRef<any>` with `useRef<OrbitControlsImpl | null>` at `AQI3DScene.tsx:57` — L/L, score 1.0; does not displace top 10
- Type `JSON.parse` as `unknown`; guard spread of nested preference sub-objects in `UserPreferencesContext.tsx:139,290` — M/L, score 2.0; does not displace top 10

### Run #75 — 2026-05-31 — Lens: Live-time claim audit
**Scope:** Fifth live-time claim audit pass. Examined: `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-analytics/app/context.py`, `components/AirQualityMapView.tsx`, `hooks/useRealtimeAQI.ts`, `index.html`. All findings verified as new via file:line specificity distinct from prior live-time runs #15, #30, #45, #60.

**Findings:**

- OBSERVATION: `context.py:19-20` vs `config.rs:25-27` — `context.py` declares `"purpleair": 120` as the expected PurpleAir update interval (seconds) used by `_freshness()` at `context.py:40-48` to decide whether data is "live" or "stale" (`stale = age_seconds > interval * 2`). This sets the staleness threshold at 240 seconds (4 minutes). However, `config.rs:25-27` sets `purpleair_interval_secs` with default `600` (10 minutes), documented in the comment `// 10 min default — PurpleAir free tier is 1000 pts/day`. The result: `build_context_text()` can inject data labeled `status: "live"` into Claude's system prompt when the underlying PurpleAir measurement is up to 599 seconds (nearly 10 minutes) old. Claude's analysis will assert current AQI values with confidence ("Current AQI at Fresno is 87") based on data that may be from the prior polling cycle. There is no synchronization between the Python side's freshness model and the Rust side's actual polling cadence — each evolved independently. PROPOSAL: Align the two sides: either update `context.py:20` to `"purpleair": 600` to match the Rust default, or add a `PURPLEAIR_INTERVAL_SECS` env var read to `context.py` so both services share the same configuration value. As a belt-and-suspenders check, stamp each `sensor_readings` row at ingestion write time (which already happens via `persist.rs`) and compute data age from the DB `time` column directly in `_get_aqi_context()` rather than inferring it from the polling interval.

- OBSERVATION: `broadcast.rs:104-109` — The broadcast tick spawned at `broadcast.rs:97-130` fires every `broadcast_interval_secs` (default 5 seconds). On each tick, it reads the cached PurpleAir readings and creates a new `Vec<AqiReading>` via `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()` where `now = chrono::Utc::now()` at tick time. This overwrites `r.timestamp` — which was set to the time of the last successful PurpleAir API call — with the current wall-clock time. The SSE `aqi-update` event therefore carries `timestamp` values that are always ≤5 seconds old, regardless of measurement age. `useRealtimeAQI.ts:308-323` parses `r.timestamp` as the reading timestamp and populates `RealtimeCityData.timestamp` and `RealtimeStats.timestamp` from it. The UI renders the stats timestamp as "last updated N seconds ago" — showing values like "last updated 2 seconds ago" for measurements that are actually 0–599 seconds stale. The `AirQualityMapView.tsx:413-416` status bar shows `isConnected ? '🔴 Live' : 'Last Updated'` next to `lastUpdate.toLocaleTimeString()` — which is the React state update time, not the measurement time. Users believe they are seeing sensor data from the last few seconds; in reality the measurements can be up to 10 minutes old. PROPOSAL: Stop overwriting `timestamp` in the broadcast tick; preserve the original `r.timestamp` from the PurpleAir fetch. In `broadcast.rs:104-109`, change the mapping to emit `r.clone()` directly (no field override). Separately, add a `broadcastedAt` field to the SSE payload if the broadcast-wall-clock time is needed. On the frontend, display both `reading.timestamp` (measurement time) and `lastUpdate` (SSE receive time) in the status bar so users can distinguish data age from connection recency.

- OBSERVATION: `geointellisense-ingestion/src/routes/aqi.rs:history()` (the `/api/aqi-history` endpoint registered at `mod.rs:16`) calls `aqi::generate_history(&params.station_id, hours)` — defined at `aqi.rs:138-162` — which generates a synthetic random-walk AQI time series: `aqi_walk += rng.gen_range(-5.0..5.0)`, one point every 5 minutes, clamped to 5–400 AQI. There is no `SELECT` from `sensor_readings` or any other DB table. The analytics service does have `historical_aqi.py:28-60` which queries the real DB (`sensor_readings` joined to `locations`), but the ingestion service's `/api/aqi-history` route is a completely separate endpoint that returns fabricated data. The two "history" endpoints are siloed: `useRealtimeAQI.ts:62` exposes `getDataAtTime` which uses the in-memory `history` buffer (SSE snapshots), not the `/api/aqi-history` REST endpoint. However, any client or developer calling `GET http://ingestion-host:3001/api/aqi-history` receives convincing-looking time-series JSON with station names ("Fresno-Garland"), 5-minute intervals, and a 24-hour span — all synthetic. An operator debugging AQI trends would receive misleading data from this endpoint. PROPOSAL: Replace `aqi::generate_history()` with a DB query: `SELECT time, aqi, pm25 FROM sensor_readings WHERE location_id = $1 AND time > now() - interval '<hours> hours' ORDER BY time` — using the station UUID derived from the station name. If the DB has insufficient data (recent install, first run), return an empty array with a `{"dataSource": "none", "reason": "insufficient_history"}` field rather than fabricated data.

- OBSERVATION: `purpleair.rs:117-118` — When live PurpleAir data is fetched by `PurpleAirClient::fetch_readings()`, the resulting `AqiReading` structs have `wind_speed: 0.0` and `wind_direction: 0.0` because the PurpleAir V1 API fields list at `purpleair.rs:16` (`"name,latitude,longitude,pm2.5,pm10.0,ozone1,humidity,temperature,pressure"`) does not include wind parameters. These zero-value readings are broadcast via SSE and parsed by `useRealtimeAQI.ts:316-318` into `RealtimeCityData.windSpeed` and `RealtimeCityData.windDirection`. `AirQualityMapView.tsx:279-281` uses `realtimeWindData` (from SSE) when `useRealtimeData && realtimeWindData.length > 0` is true — which is always true when the SSE connection is live. The result: when PurpleAir data IS available (the "real" mode), all wind arrows on the map point at 0° (due north) at 0 m/s. When the server falls back to mock data (no PURPLEAIR_API_KEY), the mock `generate_readings()` at `aqi.rs:127-129` produces `wind_speed: round2(rng.gen_range(0.0..25.0))` and `wind_direction: round2(rng.gen_range(0.0..360.0))` — so wind arrows are only animated and realistic-looking when the data is fabricated. The UI renders the wind arrows in both modes identically with no disclaimer that wind data is unavailable in live mode. PROPOSAL: (a) Add NWS gridpoint wind data to the analytics weather route and inject it into the SSE broadcast as a separate `wind-update` SSE event type, or (b) when `wind_speed == 0.0 && wind_direction == 0.0` in the received readings, fall back to the `generateWindData(new Date())` function already defined at `AirQualityMapView.tsx:66-67` — using simulated NWS-informed wind rather than the zero-value PurpleAir data. Add a tooltip on wind arrows clarifying the data source.

- OBSERVATION: `AirQualityMapView.tsx:176-178` — The city detail popup tooltip renders the hard-coded string `"Real-time data from EPA monitoring station. Interpolation model uses IDW and Kriging algorithms."` This text is static for every city regardless of actual data source. The actual data source in live mode is PurpleAir consumer sensors (branded `source: "purpleair"` at `aqi.rs:120`) — not EPA FEM (Federal Equivalent Method) reference monitors. PurpleAir PA-II sensors are consumer-grade optical particle counters; they are not EPA-certified, not used for regulatory determinations, and require application of a correction factor (the EPA recommends the US-wide correction factor CF = 0.52 × PA + 2.966 for PM2.5) before comparison to regulatory thresholds. In mock mode (no API key), `aqi.rs:131` tags readings `source: "mock"`. Neither case involves an EPA monitoring station. Stating "EPA monitoring station" is a false data provenance claim that could cause users to believe the readings carry regulatory standing they do not have. This is material misinformation in a health-context application. PROPOSAL: Replace the hard-coded string with a dynamic attribution: read the `source` field from the city reading (already present in `RealtimeCityData` as typed at `useRealtimeAQI.ts:15-21`) and render `source === "purpleair" ? "PurpleAir sensor network (consumer-grade, EPA correction applied)" : source === "mock" ? "Simulated data (server unavailable)" : "EPA AirNow monitor"`. Also confirm and apply the EPA PM2.5 correction factor before displaying AQI values derived from PurpleAir PM2.5 readings.

**Proposed actions:**
- Align `context.py:20` `"purpleair"` interval to match `config.rs:27` default (600s), or share via env var — M/L, score 2.0; does not displace top 10
- Remove `timestamp: now` override in `broadcast.rs:107`; preserve original measurement timestamp; add `broadcastedAt` field — M/L, score 2.0; does not displace top 10
- Replace `aqi::generate_history()` with real DB query in `geointellisense-ingestion/src/routes/aqi.rs:history()` — M/M, score 1.0; does not displace top 10
- Fall back to `generateWindData()` when `wind_speed == 0` in SSE readings; add tooltip disclosing wind source — L/L, score 1.0; does not displace top 10
- Replace hard-coded "EPA monitoring station" at `AirQualityMapView.tsx:177` with dynamic source attribution from `city.source` field — H/L, score 3.0; ties top 10 but first seen run #75, does not displace existing

### Run #74 — 2026-05-31 — Lens: Competitive scan (web)
**Scope:** Fifth competitive scan pass. Examined all 31 route files in `geointellisense-analytics/app/routes/`, `hooks/useRealtimeAQI.ts` (428 lines), `contexts/UserPreferencesContext.tsx`, `components/SettingsView.tsx`. Web sources consulted: sjvair.com, sjvair.com/about/integrations, sjvair.com/alerts, valleyair.org/air-quality-information/daily-air-quality-forecast, iqair.com/us/pollen/usa/california/san-joaquin, airnow.gov/fasm-v4/how-to-use, arl.noaa.gov/hysplit/smoke-forecasting, github.com/SJVAir/sjvair.com. Prior competitive scan runs #14, #29, #44, #59 are archived; all findings below verified as new via file:line specificity.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:286-339` + `contexts/UserPreferencesContext.tsx:20-24` + `contexts/UserPreferencesContext.tsx:97-101` — The user preferences context defines four notification fields: `enabled: boolean` (default `false`), `aqiAlertThreshold: number` (default `100`), `temperatureAlertHigh: number` (default `100`), `temperatureAlertLow: number` (default `32`), and `soundEnabled: boolean` (default `false`). `SettingsView.tsx:711-783` exposes a complete UI for users to configure these values. However, `useRealtimeAQI.ts:286-339` is the only place where live AQI data flows — it receives `aqi`, `pm25`, and `temperature` per sensor via SSE and calls `setData(parsedData)` at line 337 — and there is no code anywhere in the hook, or in any other file in the codebase, that reads `preferences.notifications.aqiAlertThreshold` and compares it against the incoming `parsedData.stats.averageAQI` (or any city's `.aqi` value) before firing `new Notification(...)`. A `grep -rn "aqiAlertThreshold\|Notification\." hooks/ contexts/ App.tsx` returns no results in the hook or context files except the preference definition itself. Users who set an AQI threshold of 100 and enable notifications will never receive a browser alert, even during active smoke events with AQI > 200. The direct SJV competitor SJVAir (sjvair.com/alerts) advertises "the only real-time alert system in California" offering SMS delivery; AirNow's updated app provides push notification delivery for AQI forecasts. GeoIntelliSense's notification infrastructure is entirely cosmetic. PROPOSAL: Add a `useEffect` in `useRealtimeAQI.ts` that fires after `setData(parsedData)` at line 337: read `preferences.notifications` from context; if `enabled && Notification.permission === 'granted'`, check whether `parsedData.stats.maxAQI >= aqiAlertThreshold` and fire `new Notification('GeoIntelliSense AQI Alert', { body: \`AQI has reached ${parsedData.stats.maxAQI}\`, icon: '/favicon.ico' })` — with a cooldown guard (e.g., `useRef<Date>` tracking last-fired time) to prevent repeat notifications on every SSE tick.

- OBSERVATION: Confirmed by listing all 31 files in `geointellisense-analytics/app/routes/` and `grep -rn "TEMPO\|AQview\|hms\|HYSPLIT" . --include="*.py" --include="*.rs"` returning zero matches — SJVAir (sjvair.com), the only SJV-specific air quality platform and GeoIntelliSense's most direct competitor, integrates three data sources that GeoIntelliSense entirely lacks: (a) **NASA TEMPO satellite** — TEMPO is a geostationary-orbit instrument providing hourly observations of NO2, O3, and HCHO at sub-county spatial resolution across North America; it fills the gap between PurpleAir's ground-level PM2.5 and regulatory ozone monitors, providing ozone and nitrogen dioxide data at scales appropriate for SJV valley floor analysis. GeoIntelliSense has Landsat/Sentinel routes (`landsat.py`, `sentinel.py`) but these are multi-day revisit polar-orbit instruments capturing surface reflectance, not atmospheric pollutant columns. (b) **CARB AQview (AB 617 communities)** — AQview provides regulatory-grade PM2.5 measurements from the California Air Resources Board's AB 617 environmental justice monitoring program, specifically covering communities most impacted by air pollution — communities that substantially overlap with GeoIntelliSense's CalEnviroScreen focus areas. AQview has no public API; SJVAir is one of only a few external platforms to have integrated it. (c) **NOAA Hazard Mapping System (HMS) smoke plumes** — HMS provides daily near-real-time maps of active fires and smoke plume extents derived from GOES geostationary satellite observations. GeoIntelliSense's `fires.py` uses NASA FIRMS for fire point detections, but FIRMS provides fire radiative power point locations, not the actual smoke plume spatial extent. HMS smoke polygons would let GeoIntelliSense show users whether their zip code is inside an active smoke plume — a qualitatively different and more actionable piece of information. PROPOSAL: (a) Add a TEMPO data client via the NASA Earthdata API (TEMPO Level 2 NO2 product, short-name `TEMPO_NO2_L2`); display TEMPO-derived NO2 as a map overlay alongside PM2.5; (b) contact CARB to discuss AQview data-sharing terms; (c) add a NOAA HMS smoke plume overlay route (`/api/fires/smoke-plumes`) fetching the HMS GIS shapefile endpoint and serving it as GeoJSON for the frontend map.

- OBSERVATION: `grep -rn "pollen" . --include="*.py" --include="*.ts" --include="*.tsx" --include="*.rs"` returns zero results in any route, client, component, or hook file. GeoIntelliSense has no pollen data source or display capability. The San Joaquin Valley is consistently ranked among the highest-pollen regions in the United States: it contains approximately 1.3 million acres of almonds (largest in the world), plus large-scale cotton, rice, grass seed, and row crop production. The annual almond bloom (February–March) and grass pollen season (April–June) routinely produce tree and grass pollen counts in the "Very High" or "Extreme" category for Fresno, Bakersfield, and Visalia. CalEnviroScreen data already integrated at `enviroscreen.py` includes `asthma_pctl` (asthma emergency room visits per census tract) as a health outcome indicator — pollen exposure is among the primary triggers for asthma exacerbations. IQAir provides a public pollen API endpoint for San Joaquin County (`iqair.com/us/pollen/usa/california/san-joaquin`) with tree, grass, and weed pollen index by day plus a 7-day forecast. The open-source pollen.com API (via IQVIA Allergy Plus) also provides 5-day county-level pollen forecasts. Neither is integrated. PROPOSAL: Add a `/api/pollen` route in `geointellisense-analytics/app/routes/pollen.py` that fetches the IQAir pollen endpoint (or alternatively the Open-Meteo API which provides free pollen data for US locations via its `air_quality` endpoint with `tree_pollen`, `grass_pollen`, and `weed_pollen` parameters); display pollen index alongside AQI on the Dashboard's health conditions section; surface pollen data in the AI chat context so Claude can factor allergy season into health recommendations.

- OBSERVATION: `grep -rn "widget\|iframe\|embed\|shareUrl\|permalink" . --include="*.ts" --include="*.tsx"` returns only internal dashboard widget component imports (`LiveDashboard.tsx:2-9`); there is no iframe-renderable mode, no `?embed=true` query parameter handling, no embeddable widget endpoint, and no shareable permalink URL in the codebase. SJVAir has a dedicated open-source embeddable widget (`github.com/SJVAir/web-widget`) specifically designed for embedding live sensor readings on school, clinic, or community organization websites via `<iframe src="https://www.sjvair.com/widget/#/[MONITOR_ID]">`. IQAir provides embeddable AQI widgets for any city. The Central California Asthma Collaborative, San Joaquin Valley school districts, environmental justice organizations like Earthjustice or Center on Race, Poverty & the Environment, and county public health departments all have websites where a live SJV AQI widget would be high-value. GeoIntelliSense's AI analysis and multi-source data fusion are differentiators that a widget could expose (even minimally — just AQI + AI health summary for a given sensor). Without embed support, GeoIntelliSense is only accessible to users who deliberately navigate to the app, not to visitors of partner websites. PROPOSAL: Add an `?embed=true` rendering mode to the Vite/React app: when the query parameter is present, render a stripped-down single-sensor card with AQI gauge + latest AI health summary text + "View full analysis" link back to the main app; configure `Caddyfile:24-30` to add the necessary `X-Frame-Options: SAMEORIGIN` → `ALLOWALL` and `Content-Security-Policy: frame-ancestors *` headers for embed routes only.

- OBSERVATION: No route in `geointellisense-analytics/app/routes/` fetches the San Joaquin Valley Air Pollution Control District (APCD / Valley Air) AQI forecast. The Valley Air District issues county-level daily AQI forecasts for all eight SJV counties and provides the data via a public `AirStatus.xml` endpoint (documented at `ww2.valleyair.org/air-quality-information/daily-air-quality-forecast/`) that is updated daily by 4:30 PM. The XML includes today's and tomorrow's AQI status per county, plus a wood-burning/residential smoke ("Spare the Air") restriction status for the November–February burn season. This is significant because: (1) the APCD forecast represents the *official* county-level forecast that triggers public health advisories and burn day restrictions — not the same as EPA AQI or AirNow; (2) Spare the Air restrictions are legally enforceable in SJV counties; residents are subject to fines for burning on restricted days. GeoIntelliSense has `epa_aqi.py` (EPA national data) and `airnow.py` (AirNow real-time) but no APCD-specific endpoint, and therefore lacks the county-specific tomorrow's forecast and the regulatory burn restriction status that are the primary daily air quality communications channel for SJV residents. PROPOSAL: Add a `/api/valleyair/forecast` route in `geointellisense-analytics/app/routes/valleyair.py` that fetches `AirStatus.xml` from the Valley Air District endpoint, parses the today/tomorrow AQI status per county, extracts wood-burning restriction status, caches for 4 hours (updates once daily at 4:30 PM), and returns structured JSON; surface the Spare the Air status prominently on the Dashboard with a distinct visual indicator during the November–February burn season.

**Proposed actions:**
- Implement AQI threshold check + `new Notification(...)` in `useRealtimeAQI.ts` after `setData()` at line 337 — H/L, score 3.0; ties top 10 but first seen run #74, does not displace existing
- Add NOAA HMS smoke plume GeoJSON route (`/api/fires/smoke-plumes`) as the highest-ROI of the three TEMPO/AQview/HMS data source gaps — H/M, score 1.5; does not displace top 10
- Add `/api/pollen` route via Open-Meteo free pollen API; display in Dashboard health section and inject into AI chat context — M/L, score 2.0; does not displace top 10
- Add `?embed=true` render mode to React app + Caddy header config for frame embedding — M/M, score 1.0; does not displace top 10
- Add `/api/valleyair/forecast` route fetching APCD `AirStatus.xml` with county AQI + Spare the Air burn restriction status — H/M, score 1.5; does not displace top 10

## 📚 Archive (one line per past run)
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
