# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-30T08:15:00Z
Last run: #52 — Lens: UX / UI flaws

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
### Run #52 — 2026-05-30 — Lens: UX / UI flaws
**Scope:** Fourth UX/UI pass. Examined: `App.tsx`, `index.html`, `components/Header.tsx`, `components/Sidebar.tsx`, `components/ChatView.tsx`, `components/CalendarView.tsx`, `components/Dashboard.tsx`, `components/AnalysisView.tsx`, `components/DataExplorer.tsx`, `components/SettingsView.tsx`, `components/LoadingStates.tsx`, `components/dashboard/widgets/AqiGaugeWidget.tsx`, `styles/theme-light.css`. Prior UX/UI run details (runs #7, #22, #37) archived as one-liners; findings below verified as new against all visible prior-run detail.

**Findings:**

- OBSERVATION: `components/Dashboard.tsx:96` — `getAqiColor(aqi)` returns `'text-maroon-500'` for `aqi > 300` (the EPA "Hazardous" category). Tailwind CSS has no built-in `maroon` color palette and no `maroon` entry is defined in the inline `tailwind.config` in `index.html:16-28` (which only extends with `brand-primary`, `brand-secondary`, `brand-bg-dark`, `brand-bg-light`, `brand-bg-lighter`). Using Tailwind from CDN (`index.html:14`) means no JIT scan generates the class; `text-maroon-500` produces no CSS rule and renders as the default text color. Concretely: when any city's AQI exceeds 300, the large AQI number displayed in `Dashboard.tsx:403`, `453` and the corresponding PM2.5 figures appear in default `text-slate-200` — visually indistinguishable from normal conditions. The public-health severity of a Hazardous AQI event is therefore invisible in the most prominent data display. The other five categories (good → very unhealthy) all map to valid Tailwind colors (`text-green-500`, `text-yellow-400`, `text-orange-500`, `text-red-500`, `text-purple-500`). PROPOSAL: Replace `'text-maroon-500'` with `'text-rose-900'` or `'text-red-950'` (both exist in Tailwind's default palette) at `Dashboard.tsx:96`; also add a `bg-rose-900/20` background tint to the hazardous-level card to provide a redundant visual cue beyond color alone.

- OBSERVATION: `components/CalendarView.tsx:21` — The calendar's initial view state is hardcoded: `const [currentDate, setCurrentDate] = useState(new Date('2025-11-13'))`. As of 2026-05-30, this is 6.5 months in the past. Every user who opens the CalendarView sees November 2025 by default and must click the "Next →" button 6 times to navigate to the current month — the very data most relevant to them. The calendar month navigation buttons (`handlePrevMonth`/`handleNextMonth` at lines 96-102) are the only way to move forward; there is no "Go to Today" button. Furthermore, the two navigation buttons (`← Prev` at line 120, `Next →` at line 131) have no `aria-label` attributes — their accessible name is the raw text `"← Prev"` and `"Next →"` including the arrow characters, which screen readers announce as "left arrow Prev" and "Next right arrow". There is no `role="heading"` or `aria-level` on the month/year heading at line 125, meaning the calendar navigation section is inaccessible to non-visual users. PROPOSAL: (a) Change `useState(new Date('2025-11-13'))` to `useState(new Date())` so the calendar opens to the current month. (b) Add `aria-label="Previous month"` and `aria-label="Next month"` to the navigation buttons. (c) Add a "Today" button that calls `setCurrentDate(new Date())`. (d) Add `role="heading" aria-level={3}` to the month/year display at line 125.

- OBSERVATION: `App.tsx:1-202` + `components/Sidebar.tsx:11-52` + `components/ChatView.tsx` + `components/CalendarView.tsx` — Both `ChatView` and `CalendarView` are defined and exported as standalone components but are entirely absent from the application's routing and navigation. `App.tsx` lazy-loads six views: `Dashboard`, `AirQualityMapView`, `AnalysisView`, `DataExplorer`, `MapView`, `SettingsView` — `ChatView` and `CalendarView` are never imported. The `Sidebar.tsx` navItems array defines paths for five sections (lines 12-52): `/dashboard`, `/air-quality-map`, `/maps`, `/explore`, `/analysis`; there is no `/chat` or `/calendar` entry. `CalendarView` is referenced only by its own file (`CalendarView.tsx:581`) — zero other files import it, making it entirely dead code at runtime. `ChatView` is imported only in `tests/integration.test.tsx:16` for unit testing but is unreachable in the deployed app. The chat feature — a conversational AI assistant for SJV environmental queries — is described in `README.md` as a primary feature, yet there is no route, no sidebar link, and no keyboard shortcut (`App.tsx:32-86` registers `Alt+D/M/E/A/S` but not `Alt+C`). PROPOSAL: (a) Register `ChatView` as a lazy-loaded route at `/chat` in `App.tsx`; add a `ChatIcon`-backed entry to `Sidebar.tsx` navItems with shortcut `Alt+C`. (b) Either register `CalendarView` at a route (e.g., `/calendar`) or remove the file if it is intentionally retired — its dead presence misleads contributors. (c) Add `Alt+C` keyboard shortcut in the `Layout` shortcuts array in `App.tsx:32`.

- OBSERVATION: `components/ChatView.tsx:84` — The chat input uses `onKeyPress={(e) => e.key === 'Enter' && handleSend()}`. `onKeyPress` was deprecated in the DOM Level 3 Events spec and was removed from the HTML Living Standard; React 17+ emits a console deprecation warning when `onKeyPress` is used (`Warning: This synthetic event is deprecated and will be removed in a future release`). Additionally, `onKeyPress` does not fire for non-printable keys in all browser implementations — though `Enter` is typically handled, the behavior is not guaranteed by the spec. The correct replacement is `onKeyDown` (which fires on key-down for all keys, including `Enter`, with reliable cross-browser behavior). This is the only keyboard-activated action in the chat input; if `onKeyPress` is silently dropped by a future React or browser update, users lose the ability to submit messages via keyboard entirely. PROPOSAL: Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84`: `onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}`. Adding the `!e.shiftKey` guard allows users to press `Shift+Enter` for a newline if multi-line input is ever enabled.

- OBSERVATION: `components/DataExplorer.tsx:393` + `components/AnalysisView.tsx:450` — Active Recommendations row #1 (first seen run #7) documents unsanitized `dangerouslySetInnerHTML` in `AnalysisView.tsx:450`. The same pattern exists in `DataExplorer.tsx:393`: `dangerouslySetInnerHTML={{ __html: claudeResult.replace(/\n/g, '<br />') }}`. This means two separate entry points exist where AI-generated content is injected as raw HTML without sanitization. The `claudeResult` state in `DataExplorer.tsx:52` is set from `getDeepAnalysisResponse()` at line 131, which returns any text the Anthropic API returns including any `<script>`, `<img onerror>`, or anchor-based injection sequences. The existing row #1 in Active Recommendations addresses `AnalysisView.tsx` but not `DataExplorer.tsx` — the fix scope must be expanded. PROPOSAL: Expand the scope of row #1 to include `DataExplorer.tsx:393`; apply `DOMPurify.sanitize()` (or equivalent) to both locations before passing to `dangerouslySetInnerHTML`, or replace both with a Markdown renderer that does not interpret arbitrary HTML tags.

**Proposed actions:**
- Replace `'text-maroon-500'` with `'text-rose-900'` at `Dashboard.tsx:96`; add background tint for hazardous AQI card — H/L, score 3.0; ties current top 10, does not displace
- Change CalendarView initial date to `new Date()`, add aria-labels to nav buttons, add "Today" button — H/L, score 3.0; ties current top 10, does not displace
- Register `/chat` route for `ChatView` and add Sidebar entry; register or remove `CalendarView` dead code — H/M, score 1.5; does not enter top 10
- Replace deprecated `onKeyPress` with `onKeyDown` in `ChatView.tsx:84` — M/L, score 2.0; does not enter top 10
- Expand `dangerouslySetInnerHTML` sanitization fix (row #1) to cover `DataExplorer.tsx:393` — H/L, extends existing row #1

### Run #51 — 2026-05-30 — Lens: TS ↔ Python contract
**Scope:** Fourth TS↔Python contract pass. Examined: `types.ts`, `services/aiService.ts`, `services/dataService.ts`, `hooks/useLiveData.ts`, `hooks/useRealtimeAQI.ts`, `components/3d/CityMarkers.tsx`, `components/AnalysisView.tsx`, `components/Dashboard.tsx`, `data/dashboardData.ts`, `geointellisense-analytics/app/routes/chat.py`, `grounded_search.py`, `grounded_maps.py`, `historical_weather.py`, `predictive_analysis.py`, `weather_forecast.py`, `geointellisense-ingestion/src/aqi.rs`, `routes/aqi.rs`. Prior TS↔Py run details (runs #6, #21, #36) unavailable in full; findings verified as new against all visible prior-run detail.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:296-306` + `hooks/useRealtimeAQI.ts:309-324` — The SSE parser typed inline at lines 288-306 correctly declares `so2: number` (line 300) and `co: number` (line 301), matching the Rust `AqiReading` struct fields (serialized as camelCase via `#[serde(rename_all = "camelCase")]` at `aqi.rs:17`). However, the `readings.map(r => ({...}))` at lines 309-324 only maps `r.no2` into the resulting `RealtimeCityData` (line 318); `r.so2` and `r.co` are parsed from the wire but never assigned to any output field. Since `RealtimeCityData` (line 15) extends `CityData` (`CityMarkers.tsx:20`) which has no `so2` or `co` fields, and `RealtimeCityData` itself adds none, both pollutants are permanently dropped after SSE parsing on every tick. On the snapshot path, `hooks/useLiveData.ts:AqiReading` (lines 102-119) similarly omits `so2` and `co`, so neither the SSE nor the REST snapshot consumers expose these pollutants to the UI. The Rust service faithfully computes and transmits `so2` and `co` on every AQI reading, but the frontend has no typed surface to receive or display them. PROPOSAL: Add `so2?: number; co?: number` to `RealtimeCityData` (`useRealtimeAQI.ts:15`) and to `AqiReading` (`useLiveData.ts:102`); add `so2: r.so2, co: r.co` to the `readings.map` transform at `useRealtimeAQI.ts:309-324`. Propagate to any tooltip or detail panel that currently shows `no2`.

- OBSERVATION: `data/dashboardData.ts:28` vs `services/dataService.ts:67` vs `geointellisense-analytics/app/routes/historical_weather.py:98` — The static historical weather dataset in `dashboardData.ts` uses the field name `precipitation` (`{ month: 'Jul \'23', avgTemp: 98, precipitation: 0.1 }`), while the `HistoricalWeatherRecord` TypeScript interface at `dataService.ts:67` uses `totalPrecipitation: number` for the live API data path. Python's `historical_weather.py:98` returns `"totalPrecipitation": 0.0` — hardcoded, with an inline comment "sensor_readings doesn't have precip; placeholder". This creates two concrete bugs: (a) `Dashboard.tsx:217` computes `entry[${record.locationName}_precip] = record.totalPrecipitation` for the precipitation chart, which always equals 0.0 for all locations and all months — the ComposedChart precipitation bars at `Dashboard.tsx:634` render as a flat zero line; (b) AI predictive/forecast endpoints (`aiService.ts:121,156`) receive `{ month, avgTemp, precipitation }` from `dashboardData.ts` (correct field name and actual values), not from the live API — so the AI reasoning is built on static data while the chart displays live-API zeros. The field name discrepancy between `precipitation` (static) and `totalPrecipitation` (API) means a future attempt to feed live API data to the AI endpoints would require renaming at the call site. PROPOSAL: (a) Add a `precipitation` column to the `sensor_readings` schema (or integrate an external precipitation source); update `historical_weather.py` to query it. (b) Rename `totalPrecipitation` to `precipitation` in `HistoricalWeatherRecord` (`dataService.ts:67`) to align with both the static data shape and the AI endpoint contract. (c) Update `Dashboard.tsx:217,634` references accordingly.

- OBSERVATION: `types.ts:14-30` + `services/aiService.ts:45,67` vs `geointellisense-analytics/app/routes/grounded_search.py:79` + `grounded_maps.py:86` — The `GroundingChunk` interface at `types.ts:14-30` defines detailed `.web` (`uri`, `title`) and `.maps` (`uri`, `title`, `placeAnswerSources`) variants, and `aiService.ts:45` passes `data.groundingChunks` directly to callers. Both Python grounding routes exit with `return {"text": text, "groundingChunks": []}` — always an empty array. Inspection of `grounded_search.py:51` shows `tool_results = []` initialized but never populated from Anthropic's tool-use response blocks; `grounded_maps.py:58` does the same. The Anthropic Claude API does not natively return Google-style grounding chunks — the `GroundingChunk` type appears to be modeled after the Google Gemini grounding API format, which is not applicable here. As a result: the grounded search and maps UI features display no source citations despite the TS type declaring a rich citation structure. The `tool_results = []` dead code in both routes suggests an incomplete tool-call extraction loop was stubbed but never finished. PROPOSAL: Either (a) implement proper tool-call extraction from Anthropic's `content` blocks (extract `tool_use` type blocks and map their `input` to a simplified citation shape); or (b) remove `GroundingChunk` from the response contract, change the Python response to `{"text": text}` only, update `aiService.ts:45,67` return types accordingly, and delete the vestigial `tool_results = []` lines — eliminating the false citation promise.

- OBSERVATION: `hooks/useLiveData.ts:AqiReading:102-119` vs `geointellisense-ingestion/src/aqi.rs:17-41` — The snapshot-endpoint `AqiReading` type in `useLiveData.ts` is missing three fields the Rust struct serializes: (1) `color: &'static str` (e.g. `"#00e400"`) — the hex color for the AQI category, emitted at `aqi.rs:120` via camelCase serde; (2) `rawSensorCount: number | null` — `Option<i32>` at `aqi.rs:40`, serialized as `rawSensorCount` (omitted if null via `skip_serializing_if`); (3) `no2: f64`, `so2: f64`, `co: f64` — all three pollutants present in the Rust struct at `aqi.rs:31-33` but absent from `useLiveData.ts:AqiReading`. The omission of `color` is particularly wasteful: the UI currently re-derives AQI category colors in `utils/colorScales.ts:getAQICategory` using its own category-string→hex table, but the Rust side already computes the canonical hex color in `aqi_category()` at `aqi.rs:88`. If `colorScales.ts` and `aqi.rs:aqi_category` ever diverge (e.g. one updates a boundary while the other doesn't), the UI color and the server-computed color will silently differ. PROPOSAL: Add `color: string; rawSensorCount?: number; no2: number; so2: number; co: number` to `useLiveData.ts:AqiReading`; consider consuming `color` directly for AQI marker display rather than re-deriving it client-side, which would eliminate a cross-language color duplication risk.

**Proposed actions:**
- Add `so2?: number; co?: number` to `RealtimeCityData` and `AqiReading`; map `r.so2`/`r.co` in SSE transform at `useRealtimeAQI.ts:309` — M/L, score 2.0; does not enter top 10
- Rename `totalPrecipitation` → `precipitation` in `HistoricalWeatherRecord` (`dataService.ts:67`); fix Python `historical_weather.py:98` to query actual precip data — H/M, score 1.5; does not enter top 10
- Remove vestigial `tool_results = []` from `grounded_search.py:51` and `grounded_maps.py:58`; align Python response to match actual Anthropic API output or strip `GroundingChunk` from contract — M/L, score 2.0; does not enter top 10
- Add `color: string; rawSensorCount?: number; no2: number; so2: number; co: number` to `useLiveData.ts:AqiReading:102` — M/L, score 2.0; does not enter top 10

### Run #50 — 2026-05-30 — Lens: Test coverage gaps
**Scope:** Fourth test-coverage pass. Examined all 7 existing test files (`App.test.tsx`, `tests/accessibility.test.tsx`, `tests/errorHandling.test.tsx`, `tests/integration.test.tsx`, `tests/routing.test.tsx`, `tests/security.test.tsx`, `tests/userPreferences.test.tsx`), `vite.config.ts`, `package.json`, `utils/weatherUtils.ts`, `utils/colorScales.ts`, `utils/geo3d.ts`, `utils/interpolation.ts`, `services/aiService.ts`, `geointellisense-analytics/app/ml/aqi_model.py`, `geointellisense-ingestion/src/aqi.rs` (and all other Rust source files). Archive summaries for runs #5, #20, #35 unavailable in full; findings below verified as new against all visible prior-run detail.

**Findings:**

- OBSERVATION: `utils/weatherUtils.ts:1-69` — All 4 exported functions are pure mathematical computations with zero test coverage. `calculateFeelsLike(temp, humidity, windSpeed)` at line 1 has two hard threshold boundaries: `temp >= 80 && humidity >= 40` switches to the Rothfusz heat-index polynomial (9 terms), while `temp <= 50 && windSpeed >= 3` switches to the NWS wind-chill formula. The boundary values themselves (temp=80/humidity=40 and temp=50/windSpeed=3) are on the exact formula-selection thresholds — no test verifies that (80, 39, any) returns raw temp but (80, 40, any) triggers the polynomial. `calculateET0` at line 18 expects `temp` in °F (based on the comparison implicit in input convention) but converts internally at line 19 (`const tempC = (temp - 32) * 5 / 9`) — if a caller passes Celsius directly (a plausible mistake), the Penman-Monteith result would be silently wrong by a factor of ~2–3x. `calculateSunTimes` at line 33 uses an astronomical day-of-year formula with known-ground-truth outputs: for date=2026-06-21 (summer solstice) at latitude=36.7 (Fresno), sunrise ≈ 5:47 AM, dayLength ≈ 14.5 hours — fully verifiable. `determineWeatherCondition` at line 58 has 9 branches; not a single branch is exercised by any existing test. PROPOSAL: Add `utils/weatherUtils.test.ts` with: (a) exact-boundary tests for `calculateFeelsLike` at temp=80/humidity=39 vs 40 and temp=50/windSpeed=2 vs 3; (b) known-output test for `calculateSunTimes` on the solstice; (c) branch-coverage tests for all 9 `determineWeatherCondition` paths.

- OBSERVATION: `utils/colorScales.ts:27,143` — `getAQICategory(aqi: number)` at line 27 uses `<=` boundaries (≤50 → 'good', ≤100 → 'moderate', etc.). The exact-boundary values AQI=50, 51, 100, 101, 150, 151, 200, 201, 300, 301 have concrete public-health significance (crossing any boundary changes the displayed health advisory label on the UI), yet no test verifies any of them. `interpolateColorStops(stops, position)` at line 143 initialises `lower = stops[0]` and `upper = stops[stops.length - 1]` as defaults before the loop. When `position=0.0` the loop at line 151 correctly selects `stops[0]/stops[1]` (condition `0 >= 0 && 0 <= 0.1` = true). When `position=1.0` the loop selects `stops[5]/stops[6]` (condition `1.0 >= 0.6 && 1.0 <= 1.0` = true). However, when `position` falls in the gap between the initial `lower.position` default (0) and the actual first stop beyond clamping, a future change from `<=` to `<` in the loop guard would silently snap all colors to the defaults `stops[0]` and `stops[last]` for any value at exact stop positions — a hard-to-notice regression. Zero tests cover these exact-stop inputs. The `vite.config.ts` test block at lines 35–41 has no `coverage` key despite `@vitest/coverage-v8` being installed and `"test:coverage": "vitest --coverage"` being defined in `package.json:13` — no minimum threshold prevents coverage regressions from merging silently. PROPOSAL: Add `utils/colorScales.test.ts` exercising: all AQI boundary values (50/51, 100/101, 150/151, 200/201, 300/301) in `getAQICategory`; `interpolateColorStops` at position=0.0, 0.5, 1.0, and a mid-stop exact value; `hexToRgb`/`rgbToHex` round-trip. Add coverage thresholds to `vite.config.ts` (e.g., `branches: 80, functions: 80`).

- OBSERVATION: `utils/geo3d.ts:38-68,115-138` — `latLngToWorld(lat, lng, elevation)` at line 38 returns a `THREE.Vector3` and `worldToLatLng(position)` at line 57 accepts a `THREE.Vector3` — they are an algebraic inverse pair. The round-trip `worldToLatLng(latLngToWorld(lat, lng))` must return `{lat, lng}` within floating-point tolerance, but no test verifies this. The three.js `Vector3` constructor is pure JavaScript with no WebGL dependency, so the jsdom test environment can exercise these functions without a canvas or WebGL context. `haversineDistance(lat1, lng1, lat2, lng2)` at line 115 uses `EARTH_RADIUS_KM = 6371` (line 28); the known city-pair Fresno (36.7378°N, 119.7871°W) → Bakersfield (35.3733°N, 119.0187°W) is approximately 156 km — a computable ground truth for a unit test. Both `latLngToWorld` and `haversineDistance` are cited in Run #49 findings (perf lens) as functions whose call frequency matters; a future perf-optimization refactor (e.g., inlining the arithmetic) could silently introduce a sign error without a round-trip test to catch it. PROPOSAL: Add `utils/geo3d.test.ts` with: (a) `worldToLatLng(latLngToWorld(lat, lng))` round-trip for three representative San Joaquin Valley lat/lng pairs; (b) `haversineDistance(Fresno, Bakersfield)` vs. expected ~156 km ±1 km; (c) `latLngToWorld` sign check (north of center → negative z, east of center → positive x).

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs:88` — The entire Rust service has zero `#[cfg(test)] mod tests` blocks across all 9 source files (`aqi.rs`, `broadcast.rs`, `config.rs`, `db/mod.rs`, `db/persist.rs`, `main.rs`, `purpleair.rs`, `redis_cache.rs`, `usgs.rs`, `routes/*.rs`). `aqi_category(aqi: u32) -> (&'static str, &'static str)` at `aqi.rs:88` is a pure function returning the EPA AQI label and hex color; it has no I/O, no async, and no external dependencies — `cargo test` can exercise it in under 1 ms. The critical boundary: `aqi=150` must return `("Unhealthy for Sensitive Groups", "#ff7e00")` but `aqi=151` must return `("Unhealthy", "#ff0000")`. `round2(v: f64) -> f64` at `aqi.rs:164` performs `(v * 100.0).round() / 100.0`; used throughout `generate_readings()` to round simulated sensor values, but zero tests verify its behavior at boundary inputs (e.g., `round2(0.005)` — banker's rounding in Rust's `f64::round` rounds half to nearest even, not always up). PROPOSAL: Add `#[cfg(test)] mod tests` block at bottom of `aqi.rs` with tests for: all 6 AQI category boundaries in `aqi_category`; `round2(1.005) → 1.01` and `round2(0.005)` (documenting the f64 rounding behavior).

- OBSERVATION: `geointellisense-analytics/` — Complete absence of pytest infrastructure: no `conftest.py`, no `pytest.ini`, no `pyproject.toml [tool.pytest.ini_options]`, and `requirements.txt` does not include `pytest` or `pytest-asyncio`. With 30+ route modules, 15 external-API client modules, and the ML pipeline in `aqi_model.py`, zero Python tests exist. The most tractable starting point is `_aqi_category(aqi: int) -> str` at `aqi_model.py:371`, a pure function with 6 conditional branches — identical in structure to `aqi_category` in `aqi.rs:88` and `getAQICategory` in `colorScales.ts:27`. All three are unsynchronized copies: Python uses `if aqi <= 50` returning `"Good"`, Rust uses `if aqi <= 50` returning `"Good"` label and a hex color, TypeScript uses `if (aqi <= 50)` returning string key `'good'`. A label divergence (e.g., Python boundary accidentally changed to `< 50`) would produce inconsistent category strings in ML prediction responses vs. UI display without any test to surface it. `get_model_status()` at line 71 is also pure (reads module-level `_model` variable) and trivially testable. PROPOSAL: (a) Add `pytest>=7.4` and `pytest-asyncio>=0.23` to `requirements.txt`; (b) create `geointellisense-analytics/tests/test_aqi_model.py` with parametrized tests for all 6 `_aqi_category` boundaries; (c) add a cross-language boundary-parity comment in all three implementations documenting that they must agree.

**Proposed actions:**
- Add `utils/weatherUtils.test.ts` with formula-boundary and branch-coverage tests for all 4 functions — M/L, score 2.0; does not enter top 10
- Add `utils/colorScales.test.ts` covering AQI boundary values and `interpolateColorStops` exact-stop inputs; add coverage thresholds to `vite.config.ts` — M/L, score 2.0; does not enter top 10
- Add `utils/geo3d.test.ts` with `latLngToWorld`/`worldToLatLng` round-trip and `haversineDistance` vs. known city-pair ground truth — H/M, score 1.5; does not enter top 10
- Add `#[cfg(test)] mod tests` block to `aqi.rs` covering `aqi_category` boundaries and `round2` rounding behavior — M/L, score 2.0; does not enter top 10
- Add `pytest`/`pytest-asyncio` to `requirements.txt`; create `tests/test_aqi_model.py` with parametrized `_aqi_category` boundary tests — H/M, score 1.5; does not enter top 10

## 📚 Archive (one line per past run)
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
