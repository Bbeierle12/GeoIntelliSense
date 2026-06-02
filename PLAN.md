# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-02T18:15:00Z
Last run: #127 — Lens: UX / UI flaws

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
### Run #127 — 2026-06-02 — Lens: UX / UI flaws
**Scope:** Ninth UX/UI flaws pass. Examined: `components/ChatView.tsx` (full); `App.tsx` (full routing table); `components/Sidebar.tsx` (full); `components/icons/ChatIcon.tsx` (definition); `components/dashboard/WidgetShell.tsx` (full); `components/dashboard/widgets/WeatherWidget.tsx` (full); `services/dataService.ts:75-85` (ForecastRecord interface); `components/dashboard/widgets/AqiForecastWidget.tsx` (full); `components/dashboard/widgets/AqiGaugeWidget.tsx` (full); `components/dashboard/widgets/AqiTrendWidget.tsx` (full); `components/dashboard/widgets/FiresWidget.tsx` (full); `components/dashboard/widgets/EarthquakeWidget.tsx` (full); `components/dashboard/widgets/InversionWidget.tsx` (full); `components/dashboard/widgets/WaterWidget.tsx` (full); `components/dashboard/LiveDashboard.tsx` (full); `components/Header.tsx` (full); `utils/accessibility.tsx` (full); `styles/theme-light.css` (full). Cross-checked against Active Recommendations and runs #125–#126 (Latest Findings) plus archived UX/UI runs #7, #22, #37, #52, #67, #82, #97, #112 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `ChatView.tsx` (full file) / `App.tsx:132-193` / `Sidebar.tsx:11-52` — `ChatView.tsx` implements a fully functional chat interface (103 lines) complete with real-time loading indicators, a history-aware multi-turn conversation flow, and backend integration via `getChatResponse` from `aiService.ts`. However, `ChatView` is imported by no other file in the project: `App.tsx` defines routes for `/dashboard`, `/air-quality-map`, `/analysis`, `/explore`, `/maps`, and `/settings` but has no `/chat` route; `Sidebar.tsx` lists Dashboard, Air Quality Map, Google Maps, Data Explorer, AI Analysis, and Settings but no Chat item. `components/icons/ChatIcon.tsx` exists and is likewise imported nowhere. The entire chat feature is dead code from a user-navigation perspective — no user of the published app can reach it. The `/analysis` route offers six AI tools (Quick Insight, Web Search, Local Info, Deep Dive, Predictive AQI, Weather Forecast) but no free-form multi-turn conversational interface; `ChatView` fills exactly that gap yet is silently absent. PROPOSAL: Add a `<Route path="/chat">` in `App.tsx:193` and a Chat nav item to `Sidebar.tsx:11-52` using the existing `ChatIcon` — L/L effort (routing-only change; the component and icon are complete).

- OBSERVATION: `ChatView.tsx:54` — The messages container `<div className="flex-1 overflow-y-auto p-4 space-y-4">` has no ARIA role. For an asynchronously updated message log, the correct role is `role="log"`, which carries implicit `aria-live="polite"` and `aria-relevant="additions"`. Without it, when the assistant response is appended to the `messages` array (`ChatView.tsx:43`), screen readers have no mechanism to auto-announce the new message — a screen reader user who cannot see the typing-dots spinner completing (lines 65-74) receives no notification that a response has arrived. Additionally, each message bubble (`ChatView.tsx:57-63`) identifies sender only through visual alignment (`justify-end` for user, `justify-start` for assistant) with no accessible text label; screen readers announce only the message body without indicating whether the speaker is the user or the assistant. PROPOSAL: Add `role="log" aria-label="Chat messages"` to the container at `ChatView.tsx:54`; add `aria-label={\`${msg.role === 'assistant' ? 'Assistant' : 'You'}: ${msg.text}\`}` to each message `div` at line 57 — L/L effort.

- OBSERVATION: `components/dashboard/WidgetShell.tsx:40` — Every `WidgetShell` renders `<section ... tabIndex={0}>`. The Live Dashboard (`LiveDashboard.tsx:11-41`) renders 8 widgets simultaneously (AqiGauge, AqiTrend, AqiForecast, Weather, Fires, Inversion, Earthquake, Water); each widget's outer `<section>` is a non-interactive landmark with `tabIndex={0}`, injecting 8 non-functional Tab stops into the keyboard sequence. WCAG 2.4.3 requires focusable components to appear in a logical, meaningful order; a plain container element that provides no interactive affordance of its own should not be in the tab sequence. Keyboard users navigating the Dashboard must press Tab 8+ extra times through non-interactive containers before reaching actionable controls (e.g., the "Retry" button within a widget). The `<section>` landmark is already reachable by screen reader users via landmark navigation (iOS VoiceOver swipe, NVDA `F6`), making `tabIndex={0}` redundant. PROPOSAL: Remove `tabIndex={0}` from `WidgetShell.tsx:40`; if programmatic widget focus is needed after a refetch, use `tabIndex={-1}` with an imperative `.focus()` call instead — L/L effort (one-word removal).

- OBSERVATION: `WeatherWidget.tsx:50-59` / `services/dataService.ts:75-79` — The four forecast period rows in `WeatherWidget` render three columns: conditions (truncated at `w-20` ≈ 80 px), high/low temperature, and wind speed. The `ForecastRecord` interface (`dataService.ts:79`) declares `date: Date`, populated from the NWS API at `dataService.ts:252` (`date: new Date(day.date)`). This field is silently discarded in `WeatherWidget.tsx:51` — it is never rendered. The four rows therefore show conditions, temperature, and wind speed with no date anchor. A user sees four rows of "Sunny 85° / 60° 5mph" and cannot determine whether those rows represent today, tomorrow, Thursday, or a week from now. The NWS conditions strings ("Tonight", "Thursday Night", "Windy, then Mostly Cloudy") partially compensate, but they share a single `w-20 truncate` column with the weather description, so longer period names silently drop the weather description. Rendering `p.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })` as a leading column would give each row an unambiguous temporal anchor without truncation conflicts. PROPOSAL: Add a date column to each forecast row at `WeatherWidget.tsx:51` rendering `p.date` as a short locale date string (e.g., "Thu Jun 5"), and move the conditions text to a `title` tooltip attribute on that column — L/L effort.

**Proposed actions:**
- Add `/chat` route in `App.tsx:193` and Chat nav item in `Sidebar.tsx:11-52` using existing `ChatIcon` — surfaces the complete, functional `ChatView` to users — L/L effort
- Add `role="log" aria-label="Chat messages"` to messages container at `ChatView.tsx:54`; add sender label to each message bubble — L/L effort
- Remove `tabIndex={0}` from `WidgetShell.tsx:40` — eliminates 8+ redundant Tab stops on Live Dashboard — L/L effort
- Render `p.date` in forecast rows at `WeatherWidget.tsx:51` — gives each forecast entry an unambiguous date anchor — L/L effort

### Run #126 — 2026-06-02 — Lens: TS ↔ Python contract
**Scope:** Tenth TS ↔ Python contract pass. Examined: `types.ts` (full); `hooks/useLiveData.ts` (full); `hooks/useRealtimeAQI.ts` (full); `services/aiService.ts` (full); `services/dataService.ts` (full); `data/dashboardData.ts` (historicalWeather shape); `components/AnalysisView.tsx:1-200`; `geointellisense-analytics/app/routes/chat.py` (full); `geointellisense-analytics/app/routes/predict.py` (full); `geointellisense-analytics/app/routes/predictive_analysis.py` (full); `geointellisense-analytics/app/routes/weather_forecast.py` (full); `geointellisense-analytics/app/routes/grounded_search.py` (full); `geointellisense-analytics/app/routes/grounded_maps.py` (full); `geointellisense-analytics/app/routes/inversion.py` (full); `geointellisense-analytics/app/routes/nws_forecast.py` (full); `geointellisense-analytics/app/routes/water.py` (full); `geointellisense-analytics/app/routes/historical_aqi.py` (full); `geointellisense-analytics/app/routes/historical_weather.py` (full); `geointellisense-analytics/app/clients/nws_sounding.py:1-79`; `geointellisense-ingestion/src/aqi.rs:1-51`; `geointellisense-ingestion/src/routes/aqi.rs` (full). Cross-checked against Active Recommendations and runs #124–#125 (Latest Findings) plus archived TS↔Python contract runs #6, #21, #36, #51, #66, #81, #96, #111 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useLiveData.ts:102-119` — `AqiReading` TypeScript interface is missing five fields that the Rust `AqiReading` struct (`geointellisense-ingestion/src/aqi.rs:18-41`, serialized as camelCase via `#[serde(rename_all = "camelCase")]`) always emits: `color` (hex string, e.g. `"#ffff00"`), `no2` (f64), `so2` (f64), `co` (f64), and `rawSensorCount` (Option<i32>). The TypeScript interface declares `category` and `source` (which are also in Rust) but omits the four pollutant concentration fields and the sensor count. At runtime, `useAqiSnapshot()` receives these fields in every JSON payload but TypeScript code can only access them via unsafe `as any` casts. Concrete impact: `MapView.tsx` renders AQI-colored markers using only `aqi` and `pm25`, but NO₂ (which has an independent EPA 1-hour standard of 100 ppb) and CO (8-hour standard 9 ppm) are available in the payload and could drive additional marker overlays or info windows already scaffolded in the codebase. `rawSensorCount` is diagnostic data (how many PurpleAir sensors were averaged) relevant to data reliability display. PROPOSAL: Extend `AqiReading` in `hooks/useLiveData.ts:102-119` to add `color: string; no2: number; so2: number; co: number; rawSensorCount?: number` — L/L effort (interface-only change, no logic modifications; Rust side already serializes these).

- OBSERVATION: `hooks/useLiveData.ts:140` — The optional `airnowComparison` field of `PredictionResult` is typed as `{ source: string; aqi: number; category: string }`, but `geointellisense-analytics/app/routes/predict.py:204-211` returns a richer object: `{ "source": "AirNow EPA", "aqi": ..., "category": ..., "date": ..., "parameter": ... }`. The `date` field (ISO date string of the AirNow forecast issuance) and `parameter` field (pollutant code, e.g., `"PM2.5"`) are sent by the backend whenever an AirNow comparison is available but cannot be accessed through the typed interface. `components/dashboard/widgets/AqiForecastWidget.tsx` consumes `useAqiPrediction()` and renders the comparison; it currently cannot display which day the AirNow forecast covers or whether it is a PM2.5 or ozone comparison — data the backend already provides. PROPOSAL: Extend `PredictionResult.airnowComparison` to `{ source: string; aqi: number; category: string; date?: string; parameter?: string }` in `hooks/useLiveData.ts:140` — L/L effort (interface-only change; `predict.py` already sends the fields).

- OBSERVATION: `hooks/useLiveData.ts:147-157` — `InversionData` TypeScript interface declares 9 fields but `geointellisense-analytics/app/clients/nws_sounding.py:63-78` (`InversionStatus.to_dict()`) emits 13 fields, and `inversion.py:315-324` (`_wrap_status`) adds `advisory` and `aqiImpact` (declared in TS) while spreading all `to_dict()` fields. The six fields present in every Python response but absent from the TypeScript interface are: `temp850mbF` (850mb temperature in Fahrenheit), `surfaceDewpointC` (surface dewpoint in °C — direct tule fog indicator), `windSpeedKts` (wind speed in knots — key dispersion predictor), `mixingHeightM` (planetary boundary layer height in metres — the single most physically direct measure of how deeply pollutants are mixed), `source` (which data source provided the sounding), and `soundingStation` (e.g. `"VBG"` for Vandenberg). `InversionWidget.tsx` renders only `inversionStrength`, `tempDiffC`, `surfaceTempF`, `temp850mbC`, `fogLikely`, `aqiImpact`; it cannot render `mixingHeightM` (currently always received but inaccessible via the typed interface), which is arguably more actionable than `tempDiffC` for a user deciding whether to exercise outdoors. PROPOSAL: Extend `InversionData` in `hooks/useLiveData.ts:147-157` to add `temp850mbF?: number | null; surfaceDewpointC?: number | null; windSpeedKts?: number | null; mixingHeightM?: number | null; source?: string; soundingStation?: string` — L/L effort (interface-only; Python already sends all fields).

- OBSERVATION: `components/AnalysisView.tsx:125,147-153` — The predictive analysis and weather forecast features exclusively consume `dashboardData[predictiveLocation].historicalWeather` (static 2023–2024 mock data from `data/dashboardData.ts`) and never call the Python `/api/historical-weather` endpoint. The mock data uses the field name `precipitation` (e.g., `{ month: "Jul '23", avgTemp: 98, precipitation: 0.1 }`). The Python-backed `HistoricalWeatherRecord` interface (`services/dataService.ts:60-73`) uses `totalPrecipitation`. At `AnalysisView.tsx:147`, the code explicitly casts `weatherForMonth` as `{ avgTemp: number; precipitation: number }` — matching the mock data, not `HistoricalWeatherRecord`. Consequence: (1) Any migration from static mock to live data would silently read `undefined` for precipitation because the field name differs, causing Claude to receive `precipitation: undefined` in the `PredictiveAnalysisRequest` body (`predictive_analysis.py:23-28` expects `precipitation: float`), which Pydantic would reject with a 422 validation error. (2) Even if field naming were fixed, `historical_weather.py:98` hardcodes `"totalPrecipitation": 0.0` because `sensor_readings` has no precipitation column, so the live route would always send zeroes to Claude regardless. The two-part fix is: (a) add a `precipitation` alias or rename `totalPrecipitation` → `precipitation` across `HistoricalWeatherRecord` and `historical_weather.py`; (b) integrate a precipitation data source (NOAA CDO or NWS) into the historical weather route — `routes/historical_weather.py` already exists alongside `clients/noaa_cdo.py` which fetches NOAA CDO precipitation data. PROPOSAL: Rename `totalPrecipitation` → `precipitation` in `HistoricalWeatherRecord` (`dataService.ts:67`) and `historical_weather.py:98` for field-name consistency — L/L effort; separately, wire `noaa_cdo.py` precipitation data into `historical_weather.py` so the field is not a permanent zero — M/M effort.

**Proposed actions:**
- Extend `AqiReading` in `hooks/useLiveData.ts:102-119` to add `color`, `no2`, `so2`, `co`, `rawSensorCount` — enables rendering of additional pollutant overlays already supported by the Rust payload — L/L effort
- Extend `PredictionResult.airnowComparison` in `hooks/useLiveData.ts:140` to add `date?` and `parameter?` — enables `AqiForecastWidget` to show when the AirNow comparison was issued and which pollutant it covers — L/L effort
- Extend `InversionData` in `hooks/useLiveData.ts:147-157` to add `temp850mbF`, `surfaceDewpointC`, `windSpeedKts`, `mixingHeightM`, `source`, `soundingStation` — enables `InversionWidget` to render mixing height and dewpoint depression — L/L effort
- Rename `totalPrecipitation` → `precipitation` in `HistoricalWeatherRecord` (`dataService.ts:67`) and `historical_weather.py:98`; wire `noaa_cdo.py` into `historical_weather.py` so precipitation data is non-zero when live analytics data replaces the mock — L/L + M/M effort

### Run #125 — 2026-06-02 — Lens: Test coverage gaps
**Scope:** Ninth test coverage gaps pass. Examined: all 7 existing test files (`App.test.tsx`, `tests/accessibility.test.tsx`, `tests/errorHandling.test.tsx`, `tests/integration.test.tsx`, `tests/routing.test.tsx`, `tests/security.test.tsx`, `tests/userPreferences.test.tsx`) and their import graphs; all TypeScript source files under `utils/`, `services/`, `hooks/`; `geointellisense-analytics/app/ml/aqi_model.py` (full); `geointellisense-analytics/app/cache.py` (full); `geointellisense-analytics/app/http_client.py` (full); `utils/interpolation.ts` (full); `utils/geo3d.ts` (full); `services/aiService.ts` (full); confirmed zero `#[test]` / `#[cfg(test)]` modules in `geointellisense-ingestion/src/`; confirmed zero `def test_*` / `pytest` / `unittest` in `geointellisense-analytics/`. Cross-checked against Active Recommendations and runs #123–#124 (Latest Findings) plus archived test-coverage-gap runs #5, #20, #35, #50, #65, #80, #95, #110 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `utils/interpolation.ts:125-192` — `interpolateKriging` contains two fallback branches that are entirely untested. First: line 131 (`if (dataPoints.length < 3) { return interpolateIDW(...); }`) silently falls back to IDW when fewer than 3 data points are provided; no test verifies this path or asserts that IDW is used instead of Kriging under this condition. Second: `solveLinearSystem` (line 262) returns `null` when the Kriging matrix is singular (detected at line 276 when `|augmented[i][i]| < 1e-10`), and `interpolateKriging:173` then falls back to `interpolateIDW` — again no test exercises a degenerate colinear or near-degenerate data set that would trigger matrix singularity. `interpolateKriging` is called from `generateInterpolatedGrid:325-328` and `generateInterpolatedMatrix:361-368`, which produce the 3D AQI volume texture and the terrain overlay rendered in `AQI3DScene.tsx`. A regression that removes either fallback (e.g., returning 0 instead of calling IDW) would produce incorrect visual output silently — no test would catch it. Additionally, `interpolateTemporal:383-398` throws a `new Error('Grids must have the same size…')` when `grid1.length !== grid2.length`, but no test exercises this invariant. PROPOSAL: Add a `utils/interpolation.test.ts` file with tests for: (a) `interpolateKriging` with n<3 points falls back to IDW, (b) `interpolateKriging` with colinear points (singular matrix) falls back to IDW, (c) `interpolateTemporal` throws on mismatched grid sizes, (d) `calculateGridStats` with a single-point grid returns correct min/max/mean — L/L effort (pure functions, no DOM or network dependencies).

- OBSERVATION: `utils/geo3d.ts:38-67` — `latLngToWorld` and `worldToLatLng` are pure, inverse mathematical functions used throughout the 3D scene: `WindField.tsx:203` calls `latLngToWorld` 3,000 times per SSE tick (documented in run #124), `CityMarkers.tsx:30-45` calls it per city marker, and `TerrainMesh.tsx` uses it for terrain grid generation. The round-trip identity `worldToLatLng(latLngToWorld(lat, lng)).lat ≈ lat` and `.lng ≈ lng` is a testable invariant with no test. Similarly, `haversineDistance:115-134` implements the Haversine great-circle formula — a pure function whose correctness is verifiable against known distances (e.g., Fresno at 36.74°N 119.77°W to Bakersfield at 35.37°N 119.02°W ≈ 157 km). The function is sensitive to edge cases: `dLat=0 && dLng=0` (same point → 0 km) and near-antipodal inputs where `a > 1` due to floating-point error in `Math.sqrt(a)` and `Math.sqrt(1-a)` would produce `NaN` from `Math.atan2`. No test covers any of these. PROPOSAL: Add a `utils/geo3d.test.ts` file (Three.js can be mocked at the Vector3 level for unit tests) testing: (a) `latLngToWorld`/`worldToLatLng` round-trip to within 1e-9 precision, (b) `haversineDistance` for Fresno→Bakersfield within ±1 km, (c) `haversineDistance(lat, lng, lat, lng) === 0`, (d) `getElevationAtPoint` center-of-valley returns near 75m (base elevation) — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:371-382` — The private function `_aqi_category` maps integer AQI values to the six EPA health category strings. It is called at `predict_aqi:303` and its output is embedded directly in the JSON response consumed by `AnalysisView.tsx`. The function's correctness at EPA boundary values — exactly 50 ("Good"), 51 ("Moderate"), 100 ("Moderate"), 101 ("Unhealthy for Sensitive Groups"), 150, 151, 200, 201, 300, 301 — has health communication implications: a user asking whether air quality is "Good" or "Moderate" at AQI=50 receives one of two meaningfully different health advisories. Because Python `if aqi <= 50` is inclusive, `aqi=50` maps to `"Good"` and `aqi=51` maps to `"Moderate"` — the correct EPA thresholds — but no test asserts this. Additionally, the "Hazardous" branch (`aqi > 300`) is the final `return` with no upper bound check: `_aqi_category(9999)` returns `"Hazardous"` which is correct, but `_aqi_category(-1)` also returns `"Good"` (because -1 ≤ 50) — no test validates negative-input behavior. There are also zero Python tests anywhere in `geointellisense-analytics/` (no `tests/` directory, no `pytest.ini`, no `conftest.py`). PROPOSAL: Create `geointellisense-analytics/tests/test_aqi_model.py` with pytest tests for `_aqi_category` at all six EPA boundary values (50, 51, 100, 101, 150, 151, 200, 201, 300, 301) and at the edge case AQI=0 and AQI=500; also add `pytest` and `pytest-asyncio` to `requirements.txt` to enable the test runner — L/L effort (pure function, no DB or network dependencies).

- OBSERVATION: `services/aiService.ts:4-6` — `API_BASE_URL` is a module-level constant set at import time from `import.meta.env.VITE_GATEWAY_URL`. The two code paths are: (1) gateway path — `${VITE_GATEWAY_URL}/api` — used in production deployments; (2) localhost fallback — `'http://localhost:8080/api'` — used in development. All 6 existing test files that exercise frontend behavior (`integration.test.tsx`, `security.test.tsx`, etc.) mock `global.fetch` at the component level and assert against `localhost:3002` or `localhost:8080`; none import `aiService.ts` directly or set `import.meta.env.VITE_GATEWAY_URL`. This means the production code path — the only path used when the app is deployed behind an API gateway — has never been tested. A bug in the URL template (e.g., if `VITE_GATEWAY_URL` already contains a trailing slash, the constructed URL becomes `https://gateway.example.com//api/chat`) would be silently deployed. Furthermore, none of the 7 exported functions in `aiService.ts` (`getChatResponse`, `getGroundedSearchResponse`, `getGroundedMapsResponse`, `getLowLatencyResponse`, `getDeepAnalysisResponse`, `getPredictiveAnalysisResponse`, `getWeatherForecastResponse`) has a unit test asserting the correct request shape (`method: 'POST'`, `Content-Type: application/json`, body serialization), the correct success path (returns `data.text`), or the error fallback strings. PROPOSAL: Add `services/aiService.test.ts` with vi.mock on `import.meta.env`, testing: (a) URL construction with and without `VITE_GATEWAY_URL` including trailing-slash normalization, (b) each function's fetch body serialization, (c) HTTP error path returns the documented fallback string, (d) network failure (thrown error) returns the documented fallback string — L/L effort (pure fetch wrappers, mock with `vi.fn()`).

**Proposed actions:**
- Add `utils/interpolation.test.ts` testing Kriging fallback to IDW (n<3 and singular matrix), `interpolateTemporal` throw on size mismatch, `calculateGridStats` on minimal input — L/L effort
- Add `utils/geo3d.test.ts` testing `latLngToWorld`/`worldToLatLng` round-trip, `haversineDistance` against known city pair, and zero-distance edge case — L/L effort
- Create `geointellisense-analytics/tests/test_aqi_model.py` with pytest covering `_aqi_category` at all six EPA boundary values; add `pytest` + `pytest-asyncio` to `requirements.txt` — L/L effort
- Add `services/aiService.test.ts` covering URL construction with/without `VITE_GATEWAY_URL`, request body shape, HTTP error fallbacks, and network failure fallbacks for all 7 exported functions — L/L effort

## 📚 Archive (one line per past run)
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
