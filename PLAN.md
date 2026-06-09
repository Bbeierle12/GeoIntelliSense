# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-09T08:15:00Z
Last run: #226 — Lens: Type safety

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
| 10 | `historical_weather.py:98` hardcodes `"totalPrecipitation": 0.0` as placeholder — live API always returns zero while TS fallback (`dataService.ts:383`) returns non-zero mock precipitation, silently diverging and making precipitation charts show all-zero data in production | TS↔Python/Data | H | L | 216 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #226 — 2026-06-09 — Lens: Type safety
**Scope:** Sixteenth type-safety pass. Full reads of: `tsconfig.json`, `services/AirQualityService.ts`, `services/WeatherService.ts`, `services/aiService.ts`, `services/dataService.ts`, `hooks/useDashboardData.ts` (lines 170–342), `hooks/useLiveData.ts`, `components/AccessibleChart.tsx`, `components/AnalysisView.tsx:245–260`, `components/charts/AQITrendChart.tsx`, `components/charts/PM25TrendChart.tsx`, `components/charts/TemperaturePrecipitationChart.tsx`, `components/charts/WeatherForecastChart.tsx`, `components/3d/AQI3DScene.tsx`. Grep for `: any`, `as any`, `<any>` across all `.ts`/`.tsx` files. Cross-checked against Active Recommendations and archived type-safety runs #1, 16, 31, 46, 61, 76, 91, 106, 121, 136, 151, 166, 181, 196, 211 to confirm findings are new.

**Findings:**

- OBSERVATION: `services/AirQualityService.ts:47` stores `data.readings as SnapshotReading[]` — an `as` cast that suppresses the `any` origin of `response.json()` and coerces a potentially-`undefined` field (when the ingestion service returns `{"error":"service unavailable"}` with no `readings` key) to `SnapshotReading[]`. TypeScript accepts this because `strict` mode is absent from `tsconfig.json`. At line 56-60, the result is used immediately as the initial value to `Array.prototype.reduce`: `readings.reduce((best, r) => ..., readings[0])`. When `readings` is empty (a valid snapshot response during AQI station outages — the ingestion service omits `readings` or returns `[]`), `readings[0]` is `undefined`, and the reduce callback dereferences `best.lat` on the first iteration, throwing `TypeError: Cannot read properties of undefined (reading 'lat')`. This exception propagates to `DataService.getCurrentAQI:126` (in `dataService.ts`), which catches it silently with `console.error` and falls back to static mock data. The user sees fabricated AQI values with no error indicator. `noUncheckedIndexedAccess: true` (absent from `tsconfig.json`) would type `readings[0]` as `SnapshotReading | undefined` and require an explicit guard, making the crash impossible to introduce. PROPOSAL: (a) Add a guard at `AirQualityService.ts:54`: `if (!readings.length) throw new Error('AQI snapshot returned no station readings')`; (b) add `"noUncheckedIndexedAccess": true` to `tsconfig.json` `compilerOptions` — L/L effort (~3 lines; closes both the immediate crash path and the class of unsafe array-index dereferences throughout the codebase).

- OBSERVATION: `hooks/useDashboardData.ts` has four aggregation loops — humidity (line 179), wind speed (line 223), UV index (line 267), agricultural metrics (line 311) — each iterating over `locEntry.dailyForecast` (a typed array from the typed `dashboardData` import). In each loop, the forEach callback explicitly annotates the parameter as `day: any`: `locEntry.dailyForecast.forEach((day: any) => ...)`. This discards the inferred element type that TypeScript would otherwise provide from the typed `dashboardData` array. As a result, `day.humidity` (line 190), `day.wind.speed` (line 234), `day.uv` (line 278), `day.evapotranspiration` (line 322), and `day.solarRadiation` (line 323) are untyped accesses — TypeScript cannot check whether these property names exist on the actual element type. For instance, if `dashboardData` uses `windSpeed: number` rather than `wind: { speed: number }`, `day.wind.speed` silently evaluates to `NaN` in the chart rather than a compile error. The four result arrays (`result: any[]` at lines 197, 241, 285, 330) propagate this untyped data downstream to chart components. PROPOSAL: Remove the `: any` annotation from each `forEach` callback parameter — TypeScript will infer the correct element type from the typed `dailyForecast` array and immediately surface any property-name mismatches; replace the four `result: any[]` with `{ month: string; [loc: string]: number | string }[]` — L/L effort (~8 annotation changes; zero runtime change, purely eliminates an any-escape hatch that masks shape mismatches in four aggregation paths).

- OBSERVATION: All six functions in `services/aiService.ts` follow the pattern `const data = await response.json()` (which TypeScript types as `any`) followed by immediate field access: `return data.text` at lines 23, 89, 111; `return data.text` at line 147; `return data.text` at line 180; and `return { text: data.text, groundingChunks: data.groundingChunks }` at line 45. Since `response.json()` returns `any`, the field accesses (`data.text`, `data.groundingChunks`) are also typed `any` — which is silently assignable to the declared return types `Promise<string>` and `Promise<{ text: string; groundingChunks: GroundingChunk[] }>`. If the Python analytics backend is refactored to return `{ "response": "..." }` instead of `{ "text": "..." }`, `data.text` evaluates to `undefined` at runtime with no TypeScript error. The callers in `AnalysisView.tsx` (`setResult(resultText)`) would receive `undefined`, rendering a blank result with no error UI. This affects every AI-powered feature in the application (chat, grounded search, maps, low-latency, deep analysis, predictive analysis, weather forecast) simultaneously. PROPOSAL: Define `type ApiTextResponse = { text: string }` and `type ApiGroundedResponse = { text: string; groundingChunks: GroundingChunk[] }` at the top of `aiService.ts`; cast `response.json()` to the appropriate type at each call site: `const data = await response.json() as ApiTextResponse` — L/L effort (~8 lines; makes the expected API contract explicit, causes TypeScript to flag the field accesses as typed rather than any, and provides a single definition to update when the backend schema changes).

- OBSERVATION: `services/dataService.ts:297` declares `async getDashboardMetrics(locationIds?: string[])` with no explicit return type annotation. TypeScript infers `Promise<{ totalLocations: number; avgAqi: number; avgTemp: number; alertLocations: number; lastUpdated: Date }>` from the method body — which is correct today, but the inferred type is invisible in the method signature and will silently change if a field is added, renamed, or removed. Separately, `components/AccessibleChart.tsx:66` declares `format?: (value: any) => string` in the `DataTableColumn` interface, and lines 79 and 165 declare `data: Record<string, any>[]` in both `AccessibleChartProps` and `DataTableProps`. These `any`-typed props mean a caller can pass `Record<string, any>[]` data with silently missing keys — the table renders `undefined` cells as `'-'` via the `?? '-'` fallback at line 200, masking structural mismatches between the data shape and the column definitions. PROPOSAL: (a) Add an exported `interface DashboardMetrics { totalLocations: number; avgAqi: number; avgTemp: number; alertLocations: number; lastUpdated: Date }` in `dataService.ts` and annotate `getDashboardMetrics` return type as `Promise<DashboardMetrics>`; (b) replace `Record<string, any>[]` with `Record<string, unknown>[]` in `AccessibleChart.tsx:79,165` and `(value: any) => string` with `(value: unknown) => string` at line 66 — L/L effort (~6 lines; makes the DataService contract explicit and eliminates the any-escape in the chart component's public API).

**Proposed actions:**
- Add empty-array guard in `AirQualityService.ts:54`; add `noUncheckedIndexedAccess: true` to `tsconfig.json` — L/L effort (~3 lines; closes silent crash-to-mock-fallback when AQI snapshot has no stations)
- Remove explicit `day: any` annotations in `useDashboardData.ts:179,223,267,311` and replace `result: any[]` with typed result arrays — L/L effort (~8 changes; lets TypeScript enforce property names in four aggregation loops)
- Define `ApiTextResponse` / `ApiGroundedResponse` types in `aiService.ts` and cast `response.json()` at each of the 6 call sites — L/L effort (~8 lines; makes backend schema contract explicit across all AI features)
- Add `DashboardMetrics` interface + return type to `dataService.ts:297`; replace `Record<string, any>[]` with `Record<string, unknown>[]` in `AccessibleChart.tsx:66,79,165` — L/L effort (~6 lines; closes any-escape in service public API and chart component props)

### Run #225 — 2026-06-09 — Lens: Live-time claim audit
**Scope:** Sixteenth live-time claim audit pass. Full reads of: `index.html`, `hooks/useRealtimeAQI.ts`, `hooks/useLiveData.ts`, `components/dashboard/LiveDashboard.tsx`, `components/dashboard/WidgetShell.tsx`, `components/MapView.tsx`, `components/AirQualityMapView.tsx`, `geointellisense-ingestion/src/routes/sse.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-analytics/app/routes/fires.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/routes/airnow.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/routes/inversion.py`. Cross-checked against Active Recommendations and archived Live-time audit runs #15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210 to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:2` contains a docstring stating "Hook for consuming real-time AQI data via SSE" and `geointellisense-ingestion/src/routes/sse.rs:15-73` confirms the `/api/aqi-stream` SSE endpoint is fully implemented with per-client channel management and reconnection support. However, a grep across all files under `src/components/dashboard/` confirms ZERO imports of `useRealtimeAQI` in any dashboard widget — the hook is dead from the dashboard's perspective. `components/AirQualityMapView.tsx:23` is the only file that imports it (used in the 3D visualization overlay, not the primary dashboard). `components/dashboard/LiveDashboard.tsx:17` renders the heading "Real-time environmental monitoring" while all seven data-fetch hooks in `hooks/useLiveData.ts:128,144,160,179,199,213,228` use HTTP polling intervals ranging from 30 seconds (AQI snapshot) to 3,600,000 ms (weather forecast) — bypassing the SSE stream entirely. Additionally, `hooks/useRealtimeAQI.ts:137` sets `maxHistory = 288` samples, which at 5-second SSE emission intervals equals 24 minutes of history; but at 5-minute polling intervals it equals 24 hours — suggesting the hook was designed for a polling context, not a continuous SSE stream. PROPOSAL: Either (a) mount `useRealtimeAQI()` in `LiveDashboard.tsx` to replace the 30-second AQI snapshot poll with the sub-5-second SSE stream already implemented; OR (b) rename the hook to `useHistoricalAqiReplay` and update its docstring to reflect actual polling semantics — L/L effort (~5 lines for option a; completes the already-built SSE infrastructure for the primary dashboard use case).

- OBSERVATION: `geointellisense-analytics/app/routes/fires.py:17` sets `FIRE_TTL = 1800` (30-minute Redis cache TTL). `fires.py:47` sleeps 1800 seconds between NASA FIRMS fetch cycles. `components/MapView.tsx:120` polls `/api/fires/active` every 300,000 ms (5 minutes). The UI widget label is "Active Fires" with no qualifier. The root data source (NASA FIRMS) has an inherent satellite detection lag: MODIS has a ~5-7 day revisit period; VIIRS has a ~24-hour minimum detection latency for thermal anomalies. Compounding: 30-minute backend poll + 30-minute cache TTL = up to 60 minutes of server-side lag, plus 5 minutes of frontend poll lag = 65 minutes server latency on top of the 24-48 hour satellite detection window. A fire ignited 23 hours ago may not appear in the UI for up to 25+ hours. The phrase "Active Fires" implies near-real-time situational awareness, but MODIS/VIIRS data is fundamentally a post-hoc detection feed, not a live sensor stream. No disclosure exists anywhere in the component tree (`fires.py`, `MapView.tsx`, or any widget wrapper) that this data reflects satellite passes from the prior day. PROPOSAL: Add a static informational badge to the Active Fires widget — e.g., `<Tooltip content="Satellite detection data — ~24h minimum lag (VIIRS/MODIS)">` wrapping the widget title — L/L effort (~3 lines in the fires widget; prevents users from treating day-old satellite detections as a live incident map during wildfire emergencies).

- OBSERVATION: `components/dashboard/WidgetShell.tsx:44-46` renders `lastUpdated.toLocaleTimeString()` where `lastUpdated` is set to `new Date()` at the moment the HTTP fetch resolves — it is the client-side fetch completion time, not the data's own timestamp. Meanwhile, `hooks/useLiveData.ts:118-124` defines `AqiSnapshot` with a `timestamp: string` field returned in the API body, and `geointellisense-analytics/app/routes/airnow.py:12` sets `AIRNOW_TTL = 3600` — meaning the server can return AirNow data that is up to 1 hour old, with the original `timestamp` reflecting when the data was fetched from AirNow's API, not when this HTTP response was generated. When a widget receives a cache hit for data fetched 58 minutes ago, `WidgetShell` displays the current clock time (e.g., "3:00 PM") rather than the data's actual origin time (e.g., "2:02 PM") — making hour-old data appear to have just been fetched. The same issue applies to `predict.py:16` (PREDICT_TTL = 1800, 30-minute ML prediction cache) and `inversion.py:17-18` (INVERSION_TTL = 1800). Users relying on the "last updated" timestamp to assess data freshness during AQI spikes are misled. PROPOSAL: In `hooks/useLiveData.ts`, after parsing the response body, extract `data.timestamp ?? data.time ?? data.updated_at` and return it as `dataTimestamp`; update `WidgetShell.tsx:44` to display `new Date(dataTimestamp).toLocaleTimeString()` (falling back to fetch time if absent) — L/L effort (~4 lines; makes the displayed "last updated" time reflect when the data was actually collected, not when the browser fetched a cached copy of it).

- OBSERVATION: `index.html:6` meta description reads "Real-time environmental monitoring" and "Live AQI"; `index.html:9` Open Graph description reads "Real-time air quality". These claims are most accurate for the 30-second AQI snapshot poll, but do not hold for: (a) `hooks/useLiveData.ts:228` — weather forecast polls every 3,600,000 ms (1 hour), while NWS itself updates every 6 hours; the "real-time" label is applied to data that is between 1-6 hours old; (b) `geointellisense-analytics/app/routes/airnow.py:12` AIRNOW_TTL=3600 — AirNow data up to 1 hour old; (c) `geointellisense-analytics/app/routes/predict.py:16` PREDICT_TTL=1800 — ML-predicted AQI cached 30 minutes. Additionally, no per-widget refresh interval is disclosed anywhere in the UI — a user reading the meta description and then observing the "Last updated: 2:00 PM" timestamp at 3:00 PM has no explanation for the 1-hour gap. PROPOSAL: (a) Change `index.html:6` meta description from "Real-time environmental monitoring" to "Environmental monitoring with live AQI updates and AI-powered analysis for California's San Joaquin Valley" — removes the unsupportable "real-time" claim for multi-source data; (b) add a per-widget `refreshInterval` prop to `WidgetShell.tsx` that renders a tooltip "Updates every 30 sec" / "Updates every 5 min" / "Updates every 1 hour" on hover next to the timestamp — L/L effort (~12 lines total; makes freshness guarantees transparent to users and aligns marketing claims with actual implementation).

**Proposed actions:**
- Mount `useRealtimeAQI()` in `LiveDashboard.tsx` OR rename hook to reflect polling semantics — L/L effort (~5 lines; closes SSE-vs-polling terminology gap)
- Add satellite-lag disclaimer badge to Active Fires widget in `MapView.tsx` — L/L effort (~3 lines; prevents misuse during wildfire emergencies)
- Extract `data.timestamp` from response in `useLiveData.ts` and pass to `WidgetShell.tsx:44` instead of fetch-completion time — L/L effort (~4 lines; makes displayed "last updated" reflect actual data age)
- Update `index.html:6,9` meta descriptions and add per-widget refresh-interval tooltip in `WidgetShell.tsx` — L/L effort (~12 lines; honest disclosure of freshness guarantees)

### Run #224 — 2026-06-09 — Lens: Competitive scan (web)
**Scope:** Fifteenth competitive scan pass. Full reads of: `components/SettingsView.tsx`, `contexts/UserPreferencesContext.tsx`, `components/dashboard/LiveDashboard.tsx`, `components/dashboard/widgets/AqiGaugeWidget.tsx`, `hooks/useLiveData.ts`, `components/ChatView.tsx`, `geointellisense-analytics/app/routes/explore.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/routes/chat.py`. Web research via WebSearch on: IQAir AirVisual (2026 feature set), BreezoMeter/Google Air Quality API health recommendation groups, Plume Labs Flow route comparison, AirNow push notification system, PurpleAir crowdsourced coverage, personal exposure tracking with wearables, and PDF/shareable report generation. Cross-checked against Active Recommendations and archived competitive scan runs #14, 29, 44, 59, 74, 89, 104, 119, 134, 149, 164, 179, 194, 209 to confirm findings are new.

**Findings:**

- OBSERVATION: `contexts/UserPreferencesContext.tsx:21,98` and `components/SettingsView.tsx:553-558,739-770` — The Settings UI presents a fully-featured notifications panel: users can grant browser notification permission (`requestNotificationPermission()` at `SettingsView.tsx:553`), set an `aqiAlertThreshold` (default 100, stored at `UserPreferencesContext.tsx:98`), set high/low temperature thresholds, and toggle sound. The notification permission flow is correct. However, `new Notification()` is NEVER constructed anywhere in the entire codebase (confirmed by exhaustive grep over all `.ts`/`.tsx` files). The `aqiAlertThreshold` preference value is defined at `UserPreferencesContext.tsx:21` but is NEVER read by any component, hook, or polling loop. The `useLiveData` hook at `hooks/useLiveData.ts` polls `/api/aqi-snapshot` at a configurable interval but does not import `UserPreferencesContext` and makes no threshold comparison. The `AqiGaugeWidget.tsx:20-25` computes `avgAqi` from the poll response but does not check preferences. Result: every user who opens Settings, enables notifications, grants browser permission, and sets a threshold gets zero notifications — the feature is silently dead despite appearing functional. Competitors (AirNow EPA mobile app, IQAir AirVisual, Plume Labs Flow) all deliver browser/push notifications when AQI crosses a user-configured threshold, making this a clear baseline competitive gap. PROPOSAL: Add a `useAqiNotifications` hook in a new file `hooks/useAqiNotifications.ts` that (a) calls `useAqiSnapshot()`, (b) reads `preferences.notifications` from `UserPreferencesContext`, (c) on each poll response where `avgAqi > aqiAlertThreshold` and `notifications.enabled && Notification.permission === 'granted'`, dispatches `new Notification('AQI Alert — GeoIntelliSense', { body: \`Current AQI ${avgAqi} exceeds your threshold of ${threshold}\`, icon: '/icon.png' })` with a debounce to prevent repeated firings; (d) mount the hook in `LiveDashboard.tsx` — L/L effort (~25 lines; completes the half-wired notification feature that users see in Settings but that currently never fires).

- OBSERVATION: `geointellisense-analytics/app/context.py` (confirmed in archived runs) builds a single generic system prompt with no user health profile parameters. `components/SettingsView.tsx` has no health/sensitivity profile field beyond the notifications section. The Google Air Quality API (powered by BreezoMeter) provides structured health recommendations tailored to six at-risk groups: general population, elderly (65+), children (≤14), people with lung disease (asthma, COPD), people with heart disease, and active adults/athletes. IQAir AirVisual has a dedicated "Sensitive Groups" display mode. Plume Labs Flow gives activity-specific coaching (running, cycling, playground). GeoIntelliSense's Claude-powered responses (in `chat.py`, `predictive_analysis.py`, `weather_forecast.py`) are entirely generic — Claude has no information about whether the requesting user is an asthma patient, a child, or an elderly person, so health advice defaults to the "healthy adult" baseline. For the San Joaquin Valley (the app's target region), which has among the highest rates of pediatric asthma in the US (confirmed by CalEnviroScreen data already ingested at `enviroscreen.py`), this gap is particularly significant. PROPOSAL: (a) Add a `healthProfile: { sensitiveGroup: 'none' | 'asthma' | 'heart' | 'elderly' | 'children' | 'pregnant' | 'athlete' }` field to `UserPreferencesContext.tsx` with a Settings UI row in the existing Notifications section; (b) pass `sensitiveGroup` as a query parameter to `/api/chat`, `/api/predictive-analysis`, `/api/weather-forecast`; (c) in `context.py`'s `build_context()` function, append a conditional clause to the system prompt such as `f"The user has indicated a health sensitivity profile: {sensitive_group}. Tailor health recommendations and activity advice accordingly."` — M/L effort (~30 lines across 4 files; enables at-risk group personalization matching the Google Air Quality API competitive baseline and directly relevant to GeoIntelliSense's target demographic).

- OBSERVATION: `geointellisense-analytics/app/routes/explore.py:92-135` (`GET /api/analysis/explore/csv`) is the ONLY export mechanism in the application. It generates a flat CSV of time-bucketed multi-source data. There is no PDF report, no formatted summary, and no shareable link. IQAir publishes annual PDF World Air Quality Reports. BreezoMeter's enterprise API generates structured JSON health summaries that clients render as printable reports. Plume Labs allows users to export their personal exposure history as a PDF. The data richness in GeoIntelliSense (ML-predicted AQI with confidence intervals from `predict.py`, multi-source correlation matrices from `explore.py:74`, inversion event history, fire FRP trends, demographic overlays from `enviroscreen.py`) is sufficient for a compelling summary report, but no report template or generation endpoint exists. Additionally, the CSV filename `geointellisense_export_{days}d.csv` at `explore.py:134` strips all metadata — the exported file contains no column descriptions, no units header row, and no location context, making it difficult to interpret outside the app. PROPOSAL: (a) Add a `GET /api/analysis/report/summary?days=30&format=json` endpoint in a new `report.py` route that calls into the existing predict, explore, inversion, and fire endpoints and assembles a structured summary object; (b) in the CSV export at `explore.py:118`, prepend a two-line header block (`# GeoIntelliSense Data Export`, `# Units: {source: unit, ...}`) before the column headers — L/M effort (~40 lines; closes the structured-export gap for the most competitive value, and the CSV metadata fix is a 3-line addition that immediately improves usability).

- OBSERVATION: Searching codebase confirms no `public/` directory, no `manifest.json`, no `vite-plugin-pwa` or `workbox` dependency in `package.json`, and no `serviceWorker` registration anywhere in the frontend. The application is a pure browser SPA with no install prompt (`beforeinstallprompt` is not handled). GeoIntelliSense therefore cannot be installed as a home screen or desktop app, has no offline capability, and cannot deliver background push notifications via the Push API (which requires a service worker). Every major competitor — AirNow's mobile app, IQAir AirVisual (iOS/Android), Plume Labs Flow — is available as a native or installable web app with offline access to last-known readings. The BreezoMeter-powered Google Air Quality integration is available on Google Assistant and Nest Hub. For a tool targeting San Joaquin Valley residents who need air quality alerts while commuting or during wildfire smoke events (scenarios where connectivity may be degraded), the absence of offline capability and native install is a meaningful usability gap. PROPOSAL: Add `vite-plugin-pwa` to `package.json`; configure `vite.config.ts` with a `VitePWA({ registerType: 'autoUpdate', manifest: { name: 'GeoIntelliSense', ... }, workbox: { runtimeCaching: [{ urlPattern: /\/api\/aqi-snapshot/, handler: 'NetworkFirst', options: { cacheName: 'aqi-cache', expiration: { maxAgeSeconds: 3600 } } }] } })` plugin to cache the last AQI snapshot for offline viewing — M/M effort (~20 lines of config; enables app installability and last-known-AQI offline access, matching the baseline capability of all major competitors).

**Proposed actions:**
- Add `hooks/useAqiNotifications.ts` and mount it in `LiveDashboard.tsx` to complete the notification dispatch that `SettingsView.tsx` configures but never fires — L/L effort (~25 lines; closes the silent-notification regression)
- Add `healthProfile.sensitiveGroup` to `UserPreferencesContext.tsx` + Settings UI + inject into Claude system prompt in `context.py` — M/L effort (~30 lines; enables at-risk group tailoring matching Google Air Quality API)
- Add metadata header to `explore.py:118` CSV export; add `/api/analysis/report/summary` endpoint in new `report.py` — L/M effort (~40 lines; closes structured-export gap)
- Add `vite-plugin-pwa` to `package.json` and configure PWA manifest + AQI snapshot service worker cache in `vite.config.ts` — M/M effort (~20 lines; enables offline mode and home-screen install)

## 📚 Archive (one line per past run)
- Run #223 (2026-06-09) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #222 (2026-06-09) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #221 (2026-06-09) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #220 (2026-06-09) — Lens: Observability — 4 findings — 0 promoted to Active
- Run #219 (2026-06-09) — Lens: Security — 4 findings — 0 promoted to Active
- Run #218 (2026-06-08) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #217 (2026-06-08) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
- Run #216 (2026-06-08) — Lens: TS ↔ Python contract — 4 findings — 0 promoted to Active
- Run #215 (2026-06-08) — Lens: Test coverage gaps — 4 findings — 0 promoted to Active
- Run #214 (2026-06-08) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #213 (2026-06-08) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #212 (2026-06-08) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #211 (2026-06-08) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #210 (2026-06-08) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #209 (2026-06-08) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #208 (2026-06-08) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #207 (2026-06-08) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
- Run #206 (2026-06-08) — Lens: Docs — 4 findings — 0 promoted to Active
- Run #205 (2026-06-08) — Lens: Observability — 5 findings — 0 promoted to Active
- Run #204 (2026-06-08) — Lens: Security — 4 findings — 0 promoted to Active
- Run #203 (2026-06-07) — Lens: Data pipeline integrity — 4 findings — 0 promoted to Active
- Run #202 (2026-06-07) — Lens: UX / UI flaws — 4 findings — 0 promoted to Active
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
- Run #205: lens 10 (Observability) — findings added
- Run #206: lens 11 (Docs) — findings added
- Run #207: lens 12 (Deployment / Docker) — findings added
- Run #208: lens 13 (LLM integration quality) — findings added
- Run #209: lens 14 (Competitive scan) — findings added
- Run #210: lens 15 (Live-time claim audit) — findings added
- Run #211: lens 1 (Type safety) — findings added
- Run #212: lens 2 (Module boundaries) — findings added
- Run #213: lens 3 (Dependency health) — findings added
- Run #214: lens 4 (Perf hot paths) — findings added
- Run #215: lens 5 (Test coverage gaps) — findings added
- Run #216: lens 6 (TS ↔ Python contract) — findings added
- Run #217: lens 7 (UX / UI flaws) — findings added
- Run #218: lens 8 (Data pipeline integrity) — findings added
- Run #219: lens 9 (Security) — findings added
- Run #220: lens 10 (Observability) — findings added
- Run #221: lens 11 (Docs) — findings added
- Run #222: lens 12 (Deployment / Docker) — findings added
- Run #223: lens 13 (LLM integration quality) — findings added
- Run #224: lens 14 (Competitive scan) — findings added
- Run #225: lens 15 (Live-time claim audit) — findings added
- Run #226: lens 1 (Type safety) — findings added
