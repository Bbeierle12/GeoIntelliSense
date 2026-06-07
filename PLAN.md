# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-07T07:10:00Z
Last run: #196 — Lens: Type safety

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
### Run #196 — 2026-06-07 — Lens: Type safety
**Scope:** Fourteenth type safety pass. Files examined in full: all 92 TypeScript/TSX files via glob and targeted reads. Primary focus: `components/charts/PM25TrendChart.tsx`, `components/charts/AQITrendChart.tsx`, `components/charts/WeatherForecastChart.tsx`, `components/charts/TemperaturePrecipitationChart.tsx`, `components/AccessibleChart.tsx`, `hooks/useDashboardData.ts`, `components/Dashboard.tsx`, `components/MapView.tsx`. Cross-checked against Active Recommendations and archived type safety runs #1, #16, #31, #46, #61, #76, #91, #106, #121, #136, #151, #166, #181 to confirm findings are new.

**Findings:**

- OBSERVATION: `components/charts/PM25TrendChart.tsx:15`, `components/charts/AQITrendChart.tsx:15`, `components/charts/WeatherForecastChart.tsx:14`, `components/charts/TemperaturePrecipitationChart.tsx:15` — All four Recharts-based chart components declare their props interface with `data: any[]`. The Recharts `<LineChart>`, `<BarChart>`, and related components consume the `data` prop and look up values by the string keys supplied to `dataKey` props (e.g., `dataKey="Bakersfield_aqi"`). Because `data` is `any[]`, TypeScript cannot detect a mismatch between the actual object shape in `data` and the `dataKey` strings used in `<Line>` / `<Bar>` elements — the chart silently renders nothing (no data points, no error, no console warning) when key names differ. In practice, the keys are constructed dynamically as `${record.locationName}_temp`, `${record.locationName}_humidity` etc. in `useDashboardData.ts` and `Dashboard.tsx`. If a location name contains a space or special character that differs between the data-builder and the chart's hardcoded `dataKey`, the failure is invisible at compile time and silent at runtime. Replacing `data: any[]` with a proper discriminated union or generic type parameter `<T extends Record<string, unknown>>` across all four chart components would make key mismatches detectable. PROPOSAL: Define a shared `ChartDataPoint = Record<string, string | number>` type (or a generic `T extends Record<string, unknown>`) in `types/chart.ts` and replace `any[]` in all four chart props interfaces; additionally annotate the `<Line dataKey={...}>` with a satisfies check against the expected key set — L/M effort (~15 lines across 5 files; catches silent Recharts rendering failures at compile time).

- OBSERVATION: `hooks/useDashboardData.ts:179,197,199,223,241,243,267,285,287,311,330,332` — The file contains four parallel data-aggregation `useMemo` hooks (humidity trend, wind speed trend, temperature trend, precipitation trend), each structurally identical. In each, the inner `forEach` callback types the `day` parameter as `any` (e.g., line 179: `locEntry.dailyForecast.forEach((day: any) => {`), and the result accumulator is typed `const result: any[] = []` with each row as `const entry: any = { month }`. The `day` variable then has all property accesses unchecked: `day.humidity` (line 190), `day.wind.speed` (line 234), `day.tempHigh` (approximately), etc. The `dailyForecast` array originates from `dashboardData[loc]`, whose type is declared in the context — if the context type were properly threaded, `day` would be fully typed. The copy-paste of this `any`-heavy pattern across four functions means a shape change to the forecast data structure (e.g., renaming `wind.speed` to `windSpeed`) would silently produce `NaN` in all wind-related chart data without a TypeScript error. PROPOSAL: Extract a `ForecastDay` interface (with at minimum `date: string | Date`, `humidity: number`, `wind: { speed: number; direction: number }`, `tempHigh: number`, `tempLow: number`, `precipProbability: number`) to `types/weather.ts`, use it in the `dailyForecast` array type in `DashboardDataContext`, and replace the four `(day: any)` callbacks with `(day: ForecastDay)` — L/L effort (~10 lines: one interface + four one-word substitutions; eliminates 12 `any` annotations and unguarded property accesses simultaneously).

- OBSERVATION: `components/Dashboard.tsx:113` — The deduplication expression `.map(name => alerts.find(a => a.name === name)!)` asserts non-null on the result of `.find()`. The `!` is technically safe in this specific context (the `Set` is derived from the same `alerts` array, so every name in the Set must exist in `alerts`), but TypeScript cannot verify this invariant and the assertion silently suppresses the `T | undefined` type. More critically, `Dashboard.tsx:118` declares `const dayMap = new Map<string, Record<string, any>>()` for the `mergedForecastData` computation — any value inserted via `entry[\`${record.locationName}_temp\`]` or `entry[\`${record.locationName}_humidity\`]` is `any`, so the downstream chart prop is typed as `Record<string, any>[]` even when passed to a chart component that accepts `data: any[]`. This compounds the chart-type-safety gap identified in the first finding: the `data` is `any[]` at the prop level AND `any` at the element level, giving TypeScript zero visibility into the chart's data shape end to end. PROPOSAL: Replace `Record<string, any>` at `Dashboard.tsx:118` with `Record<string, number | string>`, and for the `.find()!` at line 113, either use `Array.from(new Set(...))` with a `filter` guard (`alerts.filter((a, i, arr) => arr.findIndex(b => b.name === a.name) === i)`) that preserves type safety — L/L effort (~4 lines; closes the end-to-end `any` chain from data builder to Recharts consumer).

- OBSERVATION: `components/MapView.tsx:390,393,394` — Inside `handleSearch` (lines 386–399), the early guard `if (!searchQuery || !mapInstanceRef.current) return;` at line 388 correctly narrows `mapInstanceRef.current` to non-null for the `service` construction on line 389. However, the callback passed to `service.textSearch` on lines 390–398 is asynchronous: it executes after the Google Maps API processes the search. By the time the callback fires, the component may have been unmounted and `mapInstanceRef.current` may be `null` again (React refs are mutable). The `!` assertions on lines 393 (`mapInstanceRef.current!.setCenter(...)`) and 394 (`mapInstanceRef.current!.setZoom(12)`) inside the async callback are therefore unsound — the narrowing from line 388 does not carry into the async closure. Additionally, `results[0].geometry!.location!` at line 393 applies two consecutive `!` assertions: the Google Maps Places API `PlaceResult.geometry` field is typed `PlaceGeometry | undefined` and `PlaceGeometry.location` is typed `google.maps.LatLng | undefined`; real API responses can return results with no geometry (e.g., for certain business listings or when the result is a chain with no specific address). Both `!` assertions will throw `Cannot read properties of undefined` when such a result is returned. PROPOSAL: Replace the `!` chain at line 393 with an explicit guard (`if (!mapInstanceRef.current || !results[0].geometry?.location) return;`) before calling `setCenter`/`setZoom`, eliminating both the stale-ref risk and the geometry-null crash — L/L effort (~3 lines; prevents unmount-race crash and Places API geometry-null crash in the map search feature).

**Proposed actions:**
- Define `ChartDataPoint = Record<string, string | number>` in `types/chart.ts` and replace `data: any[]` in `PM25TrendChart.tsx:15`, `AQITrendChart.tsx:15`, `WeatherForecastChart.tsx:14`, `TemperaturePrecipitationChart.tsx:15`, `AccessibleChart.tsx:66` — L/M effort (~15 lines; catches silent Recharts key-mismatch failures at compile time)
- Extract `ForecastDay` interface to `types/weather.ts` and replace 12 `any` annotations in `useDashboardData.ts:179,197,199,223,241,243,267,285,287,311,330,332` — L/L effort (~10 lines; eliminates entire copy-paste `any` cluster across 4 parallel functions)
- Replace `Record<string, any>` at `Dashboard.tsx:118` with `Record<string, number | string>` and replace `.find()!` at line 113 with a dedup-filter — L/L effort (~4 lines; closes end-to-end `any` chain to Recharts)
- Add null guard in `MapView.tsx:393-394` async callback: `if (!mapInstanceRef.current || !results[0].geometry?.location) return;` — L/L effort (~3 lines; prevents stale-ref crash on unmount and Places API geometry-null crash)

### Run #195 — 2026-06-07 — Lens: Live-time claim audit
**Scope:** Thirteenth live-time claim audit pass. Files examined in full: `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/aqi.rs`; `geointellisense-ingestion/src/config.rs`; `hooks/useRealtimeAQI.ts`; `geointellisense-analytics/app/routes/fires.py`; `geointellisense-analytics/app/clients/nasa_firms.py`; `index.html`. Cross-checked against Active Recommendations and archived live-time audit runs #15, #30, #45, #60, #75, #90, #105, #120, #135, #150, #165, #180 to confirm findings are new.

**Findings:**

- OBSERVATION: `broadcast.rs:106-108` — The broadcast task iterates over the cached PurpleAir readings and constructs each outgoing `AqiReading` via `AqiReading { timestamp: now, ..r.clone() }`, where `now = chrono::Utc::now()` (line 106). This overwrites the original sensor measurement timestamp on every broadcast cycle (every `BROADCAST_INTERVAL_SECS=5` seconds). The result is that all SSE `aqi-update` events carry a `timestamp` field equal to the time of broadcast, not the time of actual sensor measurement. The true measurement age (determined by the 10-minute PurpleAir poll interval) is irretrievably lost by the time data reaches the frontend. The frontend's `useRealtimeAQI.ts:294` extracts `timestamp` from the SSE payload and stores it as the reading's `lastUpdate` — so the UI always shows the data as being a few seconds old, regardless of whether the underlying sensor values were captured 1 second or 9 minutes 59 seconds ago. This is timestamp laundering: the broadcast time displaces the measurement time, making stale PurpleAir data appear continuously fresh in the live dashboard. PROPOSAL: Preserve the original measurement timestamp from the PurpleAir fetch — do not overwrite `r.timestamp` in `broadcast.rs:108`. Separately, expose a `broadcastedAt` field on the SSE event for connection-health purposes, and display the original `timestamp` in the UI as "Sensor reading from X seconds ago" to correctly surface measurement age.

- OBSERVATION: `broadcast.rs:111` and `aqi.rs:99-136` — When the in-memory PurpleAir cache is `None` (e.g., during the first `PURPLEAIR_INTERVAL_SECS=600` seconds of startup before the initial PurpleAir fetch completes, or after sustained PurpleAir API failures that leave the cache unreset), the broadcast fallback at `broadcast.rs:111` calls `aqi::generate_readings(&stations)`. This function (`aqi.rs:99-136`) generates fully synthetic readings using `base_aqi + rand(-20..25)` with random temperature, humidity, wind values and `source: "mock"` — but these are then passed to `persist::write_readings(&pool, &readings)` at `broadcast.rs:115`, permanently writing synthetic readings into the TimescaleDB `sensor_readings` table every 5 seconds during the entire cold-start window (up to 120 rows per startup sequence). The ML training pipeline in `geointellisense-analytics/app/ml/aqi_model.py` queries the `sensor_readings` table without any `WHERE source != 'mock'` filter, so startup artefacts contaminate the gradient-boosting regressor's training data and skew predictions toward the hardcoded `base_aqi` values (85, 55, 60, 65, 50 — see `aqi.rs:58-85`). This is distinct from the partial mock fill at `broadcast.rs:80-85` (which is narrower) and represents a systematic training-data integrity failure that worsens with every redeploy. PROPOSAL: Add a `source` filter to `persist::write_readings()` so readings with `source == "mock"` are not written to TimescaleDB, and add a corresponding `WHERE source <> 'mock'` guard to the `aqi_model.py` training CTE as a safety net.

- OBSERVATION: `nasa_firms.py:4-8` and `fires.py:50,62` — The FIRMS client uses NASA's MODIS Aqua/Terra satellites and VIIRS (NPP/NOAA-20/21) instruments (`nasa_firms.py:4-5`). NASA FIRMS publishes documented latencies: VIIRS NRT (Near Real-Time) data carries a 3-hour processing lag from satellite overpass to API availability; MODIS standard-processing data has a 3–12 hour lag. The poll at `fires.py:50` calls `fetch_all_sources(days=2)` which fetches the full 48-hour detection window. The endpoint's `_format_active(fires)` at line 62 formats all returned `FireDetection` objects as currently active regardless of their `acq_datetime` attribute — there is no filter such as `acq_datetime > now - timedelta(hours=N)`. The UI consequently labels fire markers as "Active fires" when the underlying detections could be from a satellite overpass 11 hours ago, and the fire itself may have been extinguished hours before the data reached the API. For wildfire events — the app's primary use case — this means the "live fire" map layer may display extinguished fires while missing new ignitions that have not yet cleared the FIRMS processing pipeline. PROPOSAL: In `_format_active()`, filter detections to those with `acq_datetime >= datetime.now(timezone.utc) - timedelta(hours=24)`, and surface the `acq_datetime` as a `detectedAt` field in the API response so the UI can label each point with "Detected X hours ago" rather than an undifferentiated "active" status.

- OBSERVATION: `aqi.rs:131` and `useRealtimeAQI.ts:286-299` — The Rust broadcast emits `source: "mock"` in SSE payloads whenever a synthetic reading is included (either full-broadcast mock from `broadcast.rs:111`, or partial-fill mock from `broadcast.rs:80-84`). The frontend's SSE event parser at `useRealtimeAQI.ts:286-299` destructures only `stationId`, `stationName`, `lat`, `lng`, `county`, `timestamp`, `aqi`, `pm25`, `pm10`, `o3`, `no2` from the JSON payload. The `source` field is not destructured and is silently discarded. As a result, mock readings are rendered on the AQI map and in the live dashboard with the same visual styling as real PurpleAir readings — no badge, warning colour, or tooltip distinguishes a `base_aqi + rand(-20..25)` synthetic value from a calibrated sensor. The only user-visible indication of mock mode is `setError('Using simulated data (server unavailable)')` at `useRealtimeAQI.ts:249`, which fires exclusively for the full-SSE-down scenario, not for individual station-level mock fills. A user monitoring a specific station's AQI during a period when that station has no nearby PurpleAir sensor (or during a cold start) sees fabricated values with no indication. PROPOSAL: Pass the `source` field through the destructuring at `useRealtimeAQI.ts:296-299`, add a `isMock: boolean` property to `RealtimeCityData`, and render a visual indicator (e.g., a grey badge "Estimated" vs green "Live") on map markers and dashboard values when `source === "mock"`.

**Proposed actions:**
- Preserve original PurpleAir measurement `timestamp` through broadcast — do not overwrite with `chrono::Utc::now()` at `broadcast.rs:108`; add `broadcastedAt` field for health tracking — L/L effort (~2 lines; restores measurement age visibility to UI)
- Guard `persist::write_readings()` at `broadcast.rs:115` against writing mock-sourced data to TimescaleDB, and add `WHERE source <> 'mock'` to `aqi_model.py` training query — L/L effort (~4 lines; prevents ML training data contamination from cold-start artefacts)
- Filter `_format_active()` in `fires.py:62` by `acq_datetime` recency (e.g., last 24h) and expose `detectedAt` per fire — L/L effort (~5 lines; prevents extinct fires from being labeled "active"; surfaces FIRMS processing lag to users)
- Destructure and propagate `source` field from SSE payload in `useRealtimeAQI.ts:296`; render "Estimated" vs "Live" badge on mock-sourced station readings — M/L effort (~15 lines; makes mock/live distinction visible to users)

### Run #194 — 2026-06-07 — Lens: Competitive scan (web)
**Scope:** Fourteenth competitive scan pass. Full read of `geointellisense-ingestion/src/purpleair.rs`; `geointellisense-ingestion/src/aqi.rs`; `geointellisense-analytics/app/ml/aqi_model.py`; `geointellisense-analytics/app/routes/predict.py`; `components/SettingsView.tsx`; `contexts/UserPreferencesContext.tsx`; `services/AirQualityService.ts`; `services/dataService.ts`; `components/Dashboard.tsx`; all 33 analytics route files (directory listing). Web searches on IQAir, BreezoMeter, Tomorrow.io, Ambee, AirNow, Pollen Sense, and 2026 AQI platform feature landscape. Cross-checked against Active Recommendations and archived competitive scan runs #14, #29, #44, #59, #74, #89, #104, #119, #134, #149, #164, #179 to confirm findings are new.

**Findings:**

- OBSERVATION: `purpleair.rs:91-97` and `purpleair.rs:202-219` — PurpleAir PM2.5 readings are averaged raw (`bucket.iter().map(|s| s.pm25).sum::<f64>() / n` at line 91) and passed directly to `pm25_to_aqi()` at line 97 with no EPA correction factor applied. The `pm25_to_aqi()` function at line 202 correctly implements the EPA AQI breakpoint linear interpolation but receives uncorrected optical-particle-counter PM2.5 values. Since 2021 the US EPA (via its Air Sensor Performance Evaluation Center) has published and recommended a correction equation for PurpleAir PA-II sensors used with the CF=1 channel: `PM2.5_corrected = 0.534 × pm25_cf1 − 0.0862 × RH + 5.75` (with a subsequent 2022 update: `0.52 × pm25_cf1 − 0.085 × RH + 5.71`). PurpleAir's own map (since Aug 2021), AirNow's Fire & Smoke Map, and IQAir all apply this or a functionally equivalent LRAPA correction by default. The SJV is the highest-wildfire-smoke-impact region in California; during smoke events, uncorrected PurpleAir optical sensors over-report PM2.5 by 30-60% (due to misclassification of large smoke particles as fine PM2.5). GeoIntelliSense therefore displays systematically inflated AQI readings during the app's most critical use-case period — a wildfire smoke event — and the inflation propagates into the ML training dataset (`aqi_model.py` pulls `pm25` from `sensor_readings`, which originates from uncorrected PurpleAir ingestion), compounding prediction error over time. The humidity value needed for the correction is already present in `RawSensor.humidity` (ingested at `purpleair.rs:15` field list: `humidity`) and already averaged into `humidity` at line 94. PROPOSAL: Insert a `pm25_corrected = 0.534 * pm25 - 0.0862 * humidity + 5.75` computation between lines 91-94 and 97 in `purpleair.rs`, replacing the `pm25` argument to `pm25_to_aqi()` with `pm25_corrected.max(0.0)` — L/L effort (~4 lines in a single file; aligns readings with AirNow, IQAir, and PurpleAir's own display; reduces ML training noise from smoke events).

- OBSERVATION: `SettingsView.tsx:719-784` and `contexts/UserPreferencesContext.tsx:19-25` — The `NotificationSettings` interface defines `aqiAlertThreshold: number` (default 100) and `soundEnabled: boolean`. `SettingsView.tsx` renders a threshold slider (line 739) and an "Enable Notifications" toggle (line 718) that calls `Notification.requestPermission()` at line 722. A codebase-wide search across all components, services, hooks, and utilities confirms that `aqiAlertThreshold` is written only at `SettingsView.tsx:740` (the slider `onChange` handler) and `notifications.enabled` is read only at `SettingsView.tsx:719` (as a checkbox display state) — neither value is ever read by a polling loop, `useEffect`, `setInterval`, service worker, or any other execution path that could fire `new Notification(...)`. The user experience is: enable notifications → grant browser permission → set threshold to 75 → receive zero alerts regardless of actual AQI. Every primary competitor (IQAir, AirNow, BreezoMeter, AQI.IN) delivers actual threshold-crossing browser or push alerts. The infrastructure for firing browser notifications is already present (`Notification.permission` is granted); what is missing is a polling hook, e.g., a `useEffect` in `AirQualityService.ts` or the dashboard root that reads live AQI at each `refreshInterval`, compares against `preferences.notifications.aqiAlertThreshold`, and calls `new Notification('AQI Alert', { body: 'AQI in Bakersfield has exceeded 75' })` — M/L effort (~30 lines; makes the Settings notification UI functional).

- OBSERVATION: `ml/aqi_model.py:267-311` (function `predict_aqi`) and `predict.py:54` — GeoIntelliSense's ML forecast produces a single scalar: `predictedAqi` for a fixed `"horizon": "24 hours"`. IQAir, Tomorrow.io, AirNow, and BreezoMeter all provide 24 individual per-hour AQI forecasts (e.g., 06:00 → AQI 42, 12:00 → AQI 88, 18:00 → AQI 61) that allow users to identify the safest window for outdoor exercise, commuting, or opening windows. This is the feature users most commonly cite as a reason for switching from one air quality app to another. The historical data in `hourly_aqi` CTE (`aqi_model.py:92-145`) is already stored at hourly granularity and includes all features needed to train multiple-horizon models; the gap is purely in training logic and response format. Two implementation paths exist: (a) train 24 independent GBR models, one per horizon (1h, 2h, …, 24h), each predicting `AQI_t+h` from the same current feature vector — stored as `aqi_gbr_h01.joblib` through `aqi_gbr_h24.joblib`; or (b) replace the single GBR with a LightGBM or XGBoost multi-output regressor trained on a `(n_samples, 24)` target matrix. Option (a) is simpler and reuses all existing infrastructure. The `/api/predict/aqi` response would change from a single `predictedAqi` to a `forecast: [{hour: 1, aqi: 72}, …, {hour: 24, aqi: 88}]` array — M/H effort (significant ML retraining; response format change propagates to frontend); a direct competitive gap with IQAir's core differentiator.

- OBSERVATION: Codebase-wide grep for "pollen", "allergen", and "allergy" in `geointellisense-analytics/app/` and all frontend directories returns zero results. GeoIntelliSense covers AQI (PM2.5, PM10, O3), weather, temperature inversions, wildfires, earthquakes, water quality, demographics, satellite imagery (Landsat, Sentinel), CalGEM oil wells, CalEnviroScreen, elevation, and traffic — but has no pollen or allergen data. The San Joaquin Valley is California's agricultural heartland: almond, cotton, and alfalfa pollen from April–September, combined with native grasses and trees, produces some of the highest pollen concentrations in the US. Pollen is a major compounding trigger for asthma and respiratory illness alongside PM2.5 — the two together produce multiplicative (not additive) respiratory risk. BreezoMeter, IQAir, Ambee, and Pollen Sense all provide concurrent pollen-type breakdowns alongside AQI. The ECMWF Copernicus Atmosphere Monitoring Service (CAMS) provides a free JSON API for regional pollen type + concentration forecasts at 0.1° resolution covering 15 pollen types (alder, birch, grass, olive, ragweed, etc.); the Open-Meteo Air Quality API also exposes CAMS pollen data at no cost. Adding a `/api/pollen` route that fetches CAMS pollen data for the SJV bounding box and a pollen overlay on the `AirQualityMapView` would give GeoIntelliSense a unique combined respiratory risk view that no pure-AQI competitor offers in a geographically targeted SJV context — M/M effort (~50 lines: new route + frontend overlay + CAMS API integration).

**Proposed actions:**
- Apply EPA 2021 PM2.5 correction factor (`0.534 × pm25_cf1 − 0.0862 × RH + 5.75`) before calling `pm25_to_aqi()` in `purpleair.rs:91-97` — L/L effort (~4 lines; aligns with AirNow/IQAir; reduces smoke-event AQI over-inflation by 30-60%; cleans ML training data going forward)
- Wire `aqiAlertThreshold` and `notifications.enabled` from `UserPreferencesContext` to a polling `useEffect` in `AirQualityService.ts` that fires `new Notification()` when AQI crosses the threshold — M/L effort (~30 lines; makes the Settings notification UI functional; closes parity gap with every major competitor)
- Extend `/api/predict/aqi` from a single 24h scalar to a 24-point hourly forecast array by training 24 horizon-specific GBR models — M/H effort (significant ML work; closes the primary IQAir/Tomorrow.io UX differentiator)
- Add `/api/pollen` route consuming CAMS/Open-Meteo pollen API and a pollen overlay in `AirQualityMapView` — M/M effort (~50 lines; unique combined respiratory risk view for SJV context)

## 📚 Archive (one line per past run)
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
