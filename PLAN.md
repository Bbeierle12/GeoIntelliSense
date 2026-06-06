# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-06T22:15:00Z
Last run: #187 — Lens: UX / UI flaws

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
### Run #187 — 2026-06-06 — Lens: UX / UI flaws
**Scope:** Thirteenth UX / UI flaws pass. Files examined in full: `components/ChatView.tsx`; `components/AirQualityMapView.tsx`; `components/CalendarView.tsx`; `components/DataExplorer.tsx`; `components/Toast.tsx`; `components/SettingsView.tsx`; `components/Sidebar.tsx`; `components/ErrorBoundary.tsx`; `components/dashboard/widgets/AqiForecastWidget.tsx`; `hooks/useDashboardData.ts`; `hooks/useRealtimeAQI.ts`; `styles/`; `index.html`. Cross-checked against Active Recommendations and archived UX/UI runs #7, #22, #37, #52, #67, #82, #97, #112, #127, #142, #157, #172 to confirm findings are new.

**Findings:**

- OBSERVATION: `components/ChatView.tsx:86` — The chat `<input>` element has `disabled={isLoading}` but its `className` does not include `disabled:opacity-50` or `disabled:cursor-not-allowed`. The adjacent Send button at line 92 has both `disabled:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed`. During a message send the input appears fully interactive (white border, no opacity change) while the button visibly grays out. Users have no visual signal that typing is suppressed, may continue typing and expect the message to be queued, and will likely try pressing Enter (which calls `handleSend()` at line 84 via `onKeyPress` — `handleSend` checks `isLoading` internally and no-ops, but the lack of visual feedback makes the no-op surprising). The fix is a one-character Tailwind addition: append `disabled:opacity-50 disabled:cursor-not-allowed` to the input's `className` to match the button. PROPOSAL: Add `disabled:opacity-50 disabled:cursor-not-allowed` to the `className` of the `<input>` at `ChatView.tsx:86` — L/L effort (two Tailwind modifiers; eliminates the visual inconsistency between input and button during message loading).

- OBSERVATION: `components/AirQualityMapView.tsx:370-371` — The loading overlay resolves via `setTimeout(() => setIsLoading(false), 1500)`, a hardcoded 1.5-second countdown with no connection to the actual Three.js/WebGL initialization lifecycle. React Three Fiber (used via `AQI3DScene.tsx`) emits an `onCreated` callback once the GL context is ready; this callback is never wired back to the parent. On capable desktop hardware 1.5 seconds may be sufficient, but on underpowered laptops, iOS Safari with WebGL limited to 256 MB, or during initial asset loading (GLSL shaders, particle buffers), WebGL initialization can take 3–8 seconds. After the fake spinner disappears, users see a black or partially-initialized canvas. Interactions with `CityMarkers`, `WindField`, or `PollutionVolume` during this window produce no visible response, since the Three.js scene is still compiling shaders. The correct fix is to lift an `onReady` callback prop from `AQI3DScene` that calls `setIsLoading(false)` inside the R3F `onCreated` handler — replacing the timer with a real signal. PROPOSAL: Add an `onReady?: () => void` prop to `AQI3DScene`; call it from the R3F `<Canvas onCreated={() => onReady?.()}>`; remove the `setTimeout` at `AirQualityMapView.tsx:370-371` and replace with the callback — L/M effort (prop thread + remove timer; eliminates the race between fake-spinner and actual WebGL readiness on slow devices).

- OBSERVATION: `components/AirQualityMapView.tsx:393` — The Reconnect button `<button onClick={reconnect} className="text-amber-200 hover:text-white text-sm underline ml-4">Reconnect</button>` has no `disabled` attribute, no `aria-busy` state, and no visual in-progress indicator. `useRealtimeAQI.reconnect()` calls `connect()` directly on each invocation; there is no debounce, guard flag, or exponential-backoff state exposed by the hook that could be checked. Rapid double-clicks (which are common when users are frustrated by a disconnection) trigger two concurrent `connect()` calls that both proceed to create WebSocket instances stored in `socketRef`, overwriting each other's reference and causing the earlier socket to become untracked — its `onmessage`, `onerror`, and `onclose` handlers still fire but `socketRef.current` no longer points to it, so cleanup (`socketRef.current?.close()`) in the effect teardown will only close the second socket. The first orphaned socket leaks until the server closes it. PROPOSAL: Track a `isReconnecting` boolean in `useRealtimeAQI` and expose it alongside `reconnect`; in `AirQualityMapView.tsx:393` add `disabled={isReconnecting}` and swap the label to "Reconnecting…" during reconnection — L/L effort (one state flag in the hook; prevents duplicate concurrent sockets and gives the user feedback that the reconnection is in progress).

- OBSERVATION: `components/CalendarView.tsx:144-183` — The calendar grid `<div className="grid grid-cols-7 gap-2">` at line 144 is missing `role="grid"`; each day `<button>` is missing `role="gridcell"`, an `aria-label` with the full date string, and `aria-selected`. The `isSelected` boolean at line 148 drives only a Tailwind ring class (`ring-2 ring-brand-primary`) but never sets `aria-selected="true"` on the button element. WCAG 2.1 SC 4.1.2 requires that UI components expose their name, role, and state to accessibility APIs. Screen readers announce each cell as only the date number (e.g., "3, button") with no month or year context, so navigating forward from December to January is indistinguishable from navigating within a month. The selected date is visually highlighted but programmatically indistinguishable from any other enabled cell. Users relying on VoiceOver or NVDA cannot determine the currently selected date without visually inspecting the screen. PROPOSAL: Add `role="grid"` to the outer grid `<div>` at line 144; add `role="gridcell"` and `aria-label={format(day, 'MMMM d, yyyy')}` to each day `<button>` at line 151; set `aria-selected={isSelected ? true : undefined}` at line 159 — L/L effort (four attribute additions across one component; brings the calendar into WCAG 2.1 SC 4.1.2 compliance and enables full keyboard+screen-reader navigation).

**Proposed actions:**
- Add `disabled:opacity-50 disabled:cursor-not-allowed` to `<input>` className at `ChatView.tsx:86` — L/L effort (eliminates visual inconsistency between disabled input and disabled button during message loading)
- Add `onReady?: () => void` prop to `AQI3DScene`; wire it to R3F `<Canvas onCreated>`; remove `setTimeout` at `AirQualityMapView.tsx:370-371` — L/M effort (replaces fake 1.5-second timer with actual WebGL readiness signal; eliminates race on slow devices)
- Expose `isReconnecting` state from `useRealtimeAQI`; add `disabled={isReconnecting}` + label update to reconnect button at `AirQualityMapView.tsx:393` — L/L effort (prevents orphaned WebSocket leak from rapid double-clicks; provides in-progress feedback)
- Add `role="grid"`, per-cell `role="gridcell"`, `aria-label={format(day, 'MMMM d, yyyy')}`, and `aria-selected` to `CalendarView.tsx:144-183` — L/L effort (WCAG 2.1 SC 4.1.2 compliance; enables screen-reader navigation of the calendar grid)

### Run #186 — 2026-06-06 — Lens: TS ↔ Python contract
**Scope:** Thirteenth TS ↔ Python contract pass. Files examined in full: `types.ts`; `services/AirQualityService.ts`; `services/WeatherService.ts`; `services/aiService.ts`; `geointellisense-ingestion/src/aqi.rs`; `geointellisense-analytics/app/routes/nws_forecast.py`; `geointellisense-analytics/app/routes/grounded_search.py`; `geointellisense-analytics/app/routes/grounded_maps.py`; `geointellisense-analytics/app/routes/water_quality.py`; `geointellisense-analytics/app/routes/water.py`. Cross-checked against Active Recommendations and archived TS ↔ Python contract runs #6, #21, #36, #51, #66, #81, #96, #111, #126, #141, #156, #171 to confirm findings are new.

**Findings:**

- OBSERVATION: `AirQualityService.ts:16-20` and `WeatherService.ts:32-36` both declare a private, module-local `interface SnapshotReading` that covers only the fields each service needs from the shared `/api/aqi-snapshot` endpoint. `AirQualityService.SnapshotReading` exposes `{lat, lng, aqi, pm25, pm10, no2, so2, co, o3}` (9 fields); `WeatherService.SnapshotReading` exposes `{lat, lng, temperature, humidity, windSpeed, windDirection}` (6 fields). The Rust struct `AqiReading` in `geointellisense-ingestion/src/aqi.rs:18-41` serializes 20 camelCase fields via `#[serde(rename_all = "camelCase")]`: `stationId`, `stationName`, `lat`, `lng`, `county`, `timestamp`, `aqi`, `category`, `color`, `pm25`, `pm10`, `o3`, `no2`, `so2`, `co`, `temperature`, `humidity`, `windSpeed`, `windDirection`, `source`. Neither TS interface is exported; both use the unsafe `data.readings as SnapshotReading[]` cast at `AirQualityService.ts:47` and `WeatherService.ts:63`. The dual private definitions mean there is no single source of truth for the shape of the AQI snapshot response, both casts bypass TypeScript's type checker, and fields like `stationId`, `stationName`, `county`, `timestamp`, `category`, `color`, and `source` are entirely absent from both interfaces. A future rename of `windSpeed` to `windSpeedMs` in `aqi.rs` would compile without error on either side and produce silent `NaN` in the weather panel. PROPOSAL: Consolidate into a single exported `AqiSnapshotReading` interface in `types.ts` covering all 20 Rust-serialized fields; replace both `as SnapshotReading[]` casts with a type guard so runtime payloads are validated — M/L effort (one shared type definition + replace two casts; eliminates dual partial-view interfaces and creates a validatable TS↔Rust boundary).

- OBSERVATION: `geointellisense-analytics/app/routes/nws_forecast.py:74-82` returns `precipProbability` (integer 0–100 sourced from `probabilityOfPrecipitation.value`) and `windSpeed` (a human-readable range string, e.g., `"10 to 15 mph"`) in every forecast record. `WeatherService.ts:103-111` casts the response to a locally-typed array that omits both fields: `{ locationName, date, tempHigh, tempLow, humidity, conditions, icon }`. The downstream `ForecastData` interface at `WeatherService.ts:24-30` also has no `precipProbability` or `windSpeed` fields. NWS `precipProbability` is 0–100 per 12-hour period and populated by the NWS API for all SJV forecast points; because the TS type cast silently drops this field, the frontend never has access to precipitation probability and all forecast display components render without it. Additionally, `windSpeed` from NWS is a range string (`"10 to 15 mph"`) while `WeatherData.windSpeed` (the current-weather equivalent at `WeatherService.ts:13`) is typed as `number` — the string-vs-number mismatch means any future attempt to reuse current-weather windSpeed logic with forecast data would produce `NaN` silently. PROPOSAL: Add `precipProbability: number` and `windSpeed: string` to the local forecast record type at `WeatherService.ts:103`; add `precipProbability?: number` and `windSpeed?: string` to the exported `ForecastData` interface at `WeatherService.ts:24`; surface precipitation probability in forecast UI components — L/L effort (two field additions in TS; zero Python changes; brings NWS-provided precipitation probability to users who currently see none).

- OBSERVATION: `grounded_search.py:79` returns `{"text": text, "groundingChunks": []}` (hardcoded empty array) and `grounded_maps.py:86` returns the same pattern. The `GroundingChunk` interface in `types.ts` is a fully-typed structure with `web?: { uri: string; title: string }` and `maps?: { uri: string; title: string; placeAnswerSources?: ... }` sub-objects. `aiService.ts:45` and `aiService.ts:66` parse `data.groundingChunks` and return them as `GroundingChunk[]`. Any UI component consuming `getGroundedSearchResponse` or `getGroundedMapsResponse` that renders grounding chunks (source citations, map attribution links) will always receive an empty array. The `GroundingChunk` type was designed for Google Gemini's grounding API (not the Claude tool-call pattern the backend actually uses). The backend DOES invoke live-data tools during the tool-use loop (`grounded_search.py:48-72` / `grounded_maps.py:55-79`) calling AQI, fire, water, and earthquake endpoints, but the tool-call metadata (which endpoints were called, what data was fetched) is never surfaced to the frontend. Users cannot verify which live-data sources contributed to an AI answer. PROPOSAL: In `grounded_search.py` and `grounded_maps.py`, collect tool call names during the tool-use loop and populate `groundingChunks` with entries like `{"web": {"uri": "/api/<tool-name>", "title": "<tool-name> live data"}}` for each tool invoked; update the `GroundingChunk` type in `types.ts` to match the Claude tool output shape rather than the Gemini grounding API shape — M/M effort (modifying tool-use loop in two Python files; enables source-traceability for AI answers).

- OBSERVATION: `geointellisense-analytics/app/routes/nws_forecast.py:80` hardcodes `"uvIndex": 0` for every forecast period. The NWS `periods` response at `nws_forecast.py:141` does not natively provide UV index, so the value was a placeholder. The historical weather endpoint at `geointellisense-analytics/app/routes/historical_weather.py` does compute and return `maxUV` per month via Open-Meteo historical data, so the project already has a UV data pipeline. The result is a cross-endpoint inconsistency: historical weather shows non-zero `maxUV` while `/api/forecast` always returns `uvIndex: 0`. The `ForecastData` interface at `WeatherService.ts:24-30` omits `uvIndex` entirely, so the field is silently dropped in TS. If a UV display widget were added to the forecast view it would always show zero even in peak summer (when SJV UV is extreme, creating a safety-relevant information failure). PROPOSAL: Either (a) change `nws_forecast.py:80` to `"uvIndex": None` and omit the field from forecast records to make the absence explicit, or (b) integrate Open-Meteo's hourly `uv_index` forecast endpoint (the project already calls Open-Meteo for historical ET₀) to populate real UV forecasts — L/L for option (a); M/M for option (b); prevents a misleading all-zero UV display and makes the data gap explicit.

**Proposed actions:**
- Consolidate `AirQualityService.ts:16` and `WeatherService.ts:32` private `SnapshotReading` interfaces into a single exported `AqiSnapshotReading` in `types.ts` covering all 20 fields of Rust `AqiReading`; replace both `as SnapshotReading[]` unsafe casts with a runtime type guard — M/L effort (single shared type; validatable TS↔Rust boundary; eliminates silent field loss on Rust-side renames)
- Add `precipProbability: number` and `windSpeed: string` to the local forecast record type at `WeatherService.ts:103` and the exported `ForecastData` interface at `WeatherService.ts:24` — L/L effort (exposes NWS precipitation probability to the UI for the first time; zero Python changes needed)
- Populate `groundingChunks` in `grounded_search.py:79` and `grounded_maps.py:86` by collecting tool-call names from the tool-use loop rather than always returning `[]`; update `GroundingChunk` type shape in `types.ts` — M/M effort (makes AI source traceability functional; currently the entire grounding citations feature is dead code)
- Change `nws_forecast.py:80` hardcoded `"uvIndex": 0` to `None` and exclude from forecast records; or integrate Open-Meteo UV forecast endpoint — L/L effort for explicit-null option (removes misleading all-zero UV from forecast display)

### Run #185 — 2026-06-06 — Lens: Test coverage gaps
**Scope:** Fifteenth Test coverage gaps pass. Files examined in full: `vite.config.ts`; `tests/setup.ts`; `App.test.tsx`; `tests/accessibility.test.tsx`; `tests/security.test.tsx`; `tests/integration.test.tsx`; `tests/userPreferences.test.tsx`; `tests/routing.test.tsx`; `tests/errorHandling.test.tsx`; `utils/interpolation.ts`; `utils/colorScales.ts`; `services/AirQualityService.ts`; `hooks/useDashboardData.ts`; `hooks/useNormalizedData.ts`. Cross-checked against Active Recommendations and archived Test coverage runs #5, #20, #35, #50, #65, #80, #95, #110, #125, #140, #155, #170 to confirm findings are new.

**Findings:**

- OBSERVATION: `vite.config.ts:35-40` — The `test` configuration block contains `globals: true`, `environment: 'jsdom'`, `setupFiles: './tests/setup.ts'`, and `css: true`, but has no `coverage` sub-key at all. The `package.json` script `"test:coverage": "vitest run --coverage"` triggers `@vitest/coverage-v8` but without a `coverage.thresholds` block in `vite.config.ts`, coverage can silently drop to 0% on any branch and the command still exits 0. CI (if wired to `test:coverage`) would pass with zero coverage, and there is no automated enforcement of a minimum bar. The project currently has 7 test files covering approximately 20% of source files (77 of 97 source files have no test counterpart). Without threshold enforcement, incremental deletions of test code or addition of new untested source files are invisible to the CI gate. A minimal threshold — e.g., `coverage: { thresholds: { lines: 20, functions: 20, branches: 15, statements: 20 } }` pinned to the current actual coverage — would at minimum prevent regression below the existing baseline. PROPOSAL: Add a `coverage` sub-key to the `test` block in `vite.config.ts:35` with `provider: 'v8'`, `reporter: ['text', 'lcov']`, and `thresholds` matching the current measured baseline — L/L effort (four added lines in vite.config.ts; creates an automated CI gate against coverage regression without requiring any new test authorship).

- OBSERVATION: `utils/interpolation.ts:125-192` and `utils/interpolation.ts:261-299` — `interpolateKriging()` is a 68-line spatial interpolation function implementing ordinary kriging with matrix-based weight calculation, and `solveLinearSystem()` is a 39-line Gaussian elimination solver with partial pivoting. Both are called by `generateInterpolatedGrid()` (line 325-327) and `generateInterpolatedMatrix()` (line 365-367), which drive the AQI heatmap textures displayed in the 3D visualization components. Zero test coverage exists for these functions. Key untested behaviors: (a) `interpolateKriging` falls back to `interpolateIDW` when `dataPoints.length < 3` (line 131-133) — a caller passing 2 stations would silently switch algorithms with no error; (b) `solveLinearSystem` returns `null` when the pivot is smaller than `1e-10` (line 276), causing `interpolateKriging` to fall back to IDW at line 172-174 — this fallback path is unreachable by inspection but has never been exercised by a test; (c) the three variogram models (`spherical`, `exponential`, `gaussian`) and the `estimateVariogramParams` function computing sill, range, and nugget from data variance are entirely untested; (d) `interpolateIDW` at line 80 uses `p.distance < 0.0001` as an exact-match threshold — a station at exactly the target coordinate returns `confidence: 1` but a station 0.0001° away (≈11m) does not, creating a discontinuity around the threshold boundary. A sign error or off-by-one in the kriging weights would produce plausible-looking but numerically incorrect AQI heatmaps with no observable failure at the UI layer. PROPOSAL: Add a `tests/interpolation.test.ts` file covering `interpolateIDW` (with exact match, single point, two-point, and radius-exclusion cases), `interpolateKriging` (with n<3 fallback, singular-matrix fallback, and all three variogram models), and `calculateGridStats` — M/L effort (new test file; validates the most mathematically complex frontend code in the project against known-good reference values).

- OBSERVATION: `services/AirQualityService.ts:30-76` — `AirQualityService` is a singleton with a 4-second TTL read-through cache (`CACHE_TTL_MS = 4000` at line 26) and a nearest-station lookup in `getCurrentAQI` (line 56: `readings.reduce` with `Math.hypot`). No test file exercises this class. Four critical behaviors are untested: (a) the singleton contract — calling `AirQualityService.getInstance()` twice must return the same object reference; if the singleton guard at line 31 ever fails (e.g., due to module re-evaluation in test isolation), multiple cache states coexist silently; (b) cache hit path — a second call to `getReadings()` within 4 seconds must return `cachedReadings` without invoking `fetch`; without a test, a future developer adding a parameter to `getReadings()` could silently invalidate the cache on every call; (c) cache miss path — after 4 seconds the `now - this.cacheTimestamp` condition at line 39 should trigger a new fetch; (d) nearest-station selection at line 56-59 — with mock readings at known coordinates, the `reduce` must select the closest station; a swap of `lat`/`lng` in `Math.hypot` would produce wrong-city AQI with no runtime error. Since `AirQualityService.getInstance()` is called by `useRealtimeAQI` on every poll cycle, a regression in any of these paths degrades live AQI display to stale or wrong-location data. PROPOSAL: Add a `tests/AirQualityService.test.ts` file using `vi.spyOn(global, 'fetch')` to assert singleton identity, cache-hit/miss fetch call counts, and correct nearest-station selection for a set of known coordinate pairs — L/L effort (new test file; covers the entire TTL cache and spatial lookup logic for the real-time AQI data path).

- OBSERVATION: `hooks/useDashboardData.ts:4-7` — `parseMonthString` is a module-level function at lines 4-7 used by `getFilteredHistoricalData` (line 96) to filter historical AQI and weather data by date range. It parses month strings of the form `"Jan '24"` via: `monthStr.replace("'", "")` → `"Jan 24"`, split by space → `["Jan", "24"]`, then `new Date(Date.parse("Jan 1, 2012")).getMonth()` to convert month name to index, then `new Date(parseInt(\`20${year}\`), monthIndex)`. Two bugs are latent and untested: (1) `String.prototype.replace` with a string first argument replaces only the FIRST occurrence — if a month string ever contains two apostrophes (e.g., from a malformed data entry or locale-variant format like `"Jan''24"`), the second apostrophe survives into the `split` and produces `["Jan", "'24"]`, causing `parseInt("'24")` to return `NaN` and `new Date(NaN, monthIndex)` to be an `Invalid Date`. All subsequent `date >= start && date <= end` comparisons evaluate to `false` (NaN comparisons), producing an empty chart with no error thrown. (2) The year reconstruction `\`20${year}\`` hardcodes a 21st-century assumption: month strings representing years 2000-2009 would parse correctly, but a year string of `"24"` correctly produces 2024 while `"100"` (theoretical future) would produce `20100`. The function is not exported and not tested. `getFilteredHistoricalData` is consumed by five `useMemo` calls (`mergedHistoricalAqi`, `mergedHistoricalPm25`, `mergedHistoricalWeather`, `mergedHumidityData`, `mergedWindData`) that silently return `[]` on parsing failure, making the entire DataExplorer and Dashboard chart area appear empty. PROPOSAL: Export `parseMonthString` from `useDashboardData.ts` and add tests to `tests/useDashboardData.test.ts` covering the happy path (`"Jan '24"` → January 2024), the apostrophe-replace edge case, and an invalid format producing a recognizable error rather than `NaN` propagation; additionally replace `String.replace("'", "")` with `String.replace(/'/g, "")` at line 5 — L/L effort (one regex fix at line 5; export + 5 unit tests; prevents silent empty-chart failures from malformed month strings in historical data).

**Proposed actions:**
- Add `coverage: { provider: 'v8', reporter: ['text', 'lcov'], thresholds: { lines: 20, functions: 20, branches: 15, statements: 20 } }` to the `test` block in `vite.config.ts:35` — L/L effort (automated CI gate against coverage regression; zero new tests required)
- Add `tests/interpolation.test.ts` covering `interpolateIDW` (exact match, n<minPoints, radius exclusion), `interpolateKriging` (n<3 fallback, singular-matrix fallback, all three variogram models), and `calculateGridStats` — M/L effort (validates most complex frontend math against known-good reference values)
- Add `tests/AirQualityService.test.ts` using `vi.spyOn(global, 'fetch')` for singleton identity, cache hit/miss call counts, and nearest-station selection with known coordinate fixtures — L/L effort (covers TTL cache and spatial lookup for the real-time AQI display path)
- Replace `monthStr.replace("'", "")` with `monthStr.replace(/'/g, "")` in `useDashboardData.ts:5`; export `parseMonthString`; add `tests/useDashboardData.test.ts` with edge-case month string parsing tests — L/L effort (fixes silent empty-chart failure; validates date-range filter for all Dashboard chart aggregations)

## 📚 Archive (one line per past run)
- Run #184 (2026-06-06) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #183 (2026-06-06) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #182 (2026-06-06) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #181 (2026-06-06) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #180 (2026-06-06) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #179 (2026-06-06) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #178 (2026-06-06) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #177 (2026-06-06) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
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
