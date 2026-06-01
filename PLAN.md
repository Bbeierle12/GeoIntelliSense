# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-01T21:10:00Z
Last run: #112 — Lens: UX / UI flaws

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
### Run #112 — 2026-06-01 — Lens: UX / UI flaws
**Scope:** Eighth UX / UI flaws pass. Examined: `index.html` (meta tags, viewport, importmap), `styles/theme-light.css` (light/high-contrast/font-size/reduced-motion classes), `App.tsx` (layout structure, skip links, keyboard shortcuts), `components/Header.tsx`, `components/Sidebar.tsx`, `components/ChatView.tsx`, `components/AnalysisView.tsx`, `components/Dashboard.tsx`, `components/SettingsView.tsx`, `components/LoadingStates.tsx`, `components/Toast.tsx`, `components/DataExplorer.tsx` (first 80 lines), `components/CalendarView.tsx` (first 50 lines), `components/dashboard/widgets/AqiGaugeWidget.tsx`. Cross-checked against Active Recommendations and runs #110–#111 (Latest Findings) plus archived UX/UI runs #7, #22, #37, #52, #67, #82, #97 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `components/Dashboard.tsx:96` — The `getAqiColor` helper function returns `'text-maroon-500'` for AQI > 300 (Hazardous tier). `maroon` is not part of Tailwind's built-in color palette (the palette includes `red`, `rose`, `pink`, `orange`, `amber`, etc. — not `maroon`). Tailwind generates only classes for colors that appear in its config or safelist; because `text-maroon-500` is never generated, it silently produces no color rule and the element inherits its parent color (`text-slate-200` from the body). The consequence: at `Dashboard.tsx:403`, `453`, and `455` — the three call-sites that apply `getAqiColor()` to AQI values — any reading above 300 (Hazardous) renders in the default pale-grey text instead of a visually distinct danger color. This breaks the color-coding UX precisely for the most dangerous AQI tier. By contrast, `components/dashboard/widgets/AqiGaugeWidget.tsx:12` correctly uses `bg-rose-900` / `text-rose-400` for Hazardous, confirming the intended color family is `rose`. PROPOSAL: In `getAqiColor` at `Dashboard.tsx:96`, replace `return 'text-maroon-500'` with `return 'text-rose-400'` to match the established Hazardous color in `AqiGaugeWidget.tsx` — L/L effort.

- OBSERVATION: `components/ChatView.tsx:84` — The chat input uses `onKeyPress={(e) => e.key === 'Enter' && handleSend()}`. `onKeyPress` is deprecated in the DOM specification (deprecated since Chrome 116 / Safari 16 / Firefox 117) and React has flagged it as deprecated since React 17. MDN documents it as "No longer recommended" with browsers guaranteed to support it only for backward compatibility. React will emit a deprecation warning in development mode when `onKeyPress` is referenced. The functional behavior is currently preserved because browsers still fire the event for alphanumeric keys including Enter, but this is a fragile guarantee. The drop-in replacement `onKeyDown` fires at the same interaction point, uses the same `e.key` API, and handles Enter on all keyboard types (including virtual keyboards on iOS/Android which do not reliably fire `onKeyPress` for the Return key). PROPOSAL: Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84` — L/L effort.

- OBSERVATION: `components/Dashboard.tsx:480–499` — The `renderDateFilter()` function renders two `<input type="month" />` controls with no `id` attributes and no `aria-label` attributes. The function wraps them with a `<label>` element at line 482, but that `<label>` has no `htmlFor` attribute pointing to either input, making it a visual decoration only. Under WCAG 2.1 SC 1.3.1 (Info and Relationships) and SC 4.1.2 (Name, Role, Value), both inputs are programmatically unlabeled — a screen reader will announce them only as "month stepper" with no indication of which end of the date range they represent (start vs. end). The `<span class="text-slate-400 self-center">-</span>` between the two inputs is the only positional cue, which is also inaccessible. By contrast, the date inputs in `AnalysisView.tsx:335–362` have proper `<label htmlFor="start-date">` / `<label htmlFor="end-date">` pairings. PROPOSAL: Add `id="hist-start-date"` and `aria-label="Historical data start date"` to the first input at `Dashboard.tsx:484`; add `id="hist-end-date"` and `aria-label="Historical data end date"` to the second input at `Dashboard.tsx:491`; add `htmlFor="hist-start-date"` to the wrapping `<label>` at `Dashboard.tsx:482` or replace it with a `<fieldset>/<legend>` — L/L effort.

- OBSERVATION: `components/AnalysisView.tsx:420–427` — The `<textarea>` rendered for non-forecast analysis tools (quick, search, maps, deep) has no `id` attribute, no `aria-label`, and no `aria-labelledby`. Its only textual hint is the `placeholder` attribute (`currentTool.placeholder`). WCAG 2.1 SC 1.3.1 and SC 3.3.2 require that form inputs have programmatic labels; placeholder text alone does not count because it (a) disappears once the user begins typing, preventing them from referencing the instruction during input, and (b) is announced inconsistently across screen readers (some read it, some do not). Critically, the tool name (`currentTool.name`, e.g. "Quick Insight", "Deep Dive") and description (`currentTool.description`) are rendered in an `<h3>` above the input at `AnalysisView.tsx:310–315` but are not connected to the textarea with `aria-labelledby`. Compare with the forecast-tool inputs at `AnalysisView.tsx:319–362` which all have proper `<label htmlFor>` pairings and `aria-describedby="date-format-hint"`. PROPOSAL: Add `id="analysis-prompt"` to the `<textarea>` at `AnalysisView.tsx:420`; add `<label htmlFor="analysis-prompt" className="sr-only">{currentTool.name} — {currentTool.placeholder}</label>` immediately before the textarea; or add `aria-label={currentTool.name}` and `aria-describedby` pointing to the existing description paragraph — L/L effort.

**Proposed actions:**
- Replace `'text-maroon-500'` with `'text-rose-400'` in `getAqiColor` at `Dashboard.tsx:96` to restore Hazardous-tier color coding — L/L effort
- Replace `onKeyPress` with `onKeyDown` in chat input at `ChatView.tsx:84` — L/L effort
- Add `id`, `aria-label`, and `htmlFor` to the two unlabeled date filter inputs in `renderDateFilter()` at `Dashboard.tsx:484,491` — L/L effort
- Add `id="analysis-prompt"` and a `<label>` (or `aria-label`) to the non-forecast `<textarea>` at `AnalysisView.tsx:420` — L/L effort

### Run #111 — 2026-06-01 — Lens: TS ↔ Python contract
**Scope:** Eighth TS ↔ Python contract pass. Examined: `services/aiService.ts` (all seven exported functions, lines 1–186), `types.ts` (full file, `GroundingChunk` interface), `components/AnalysisView.tsx` (full file, `handleSubmit` switch, `groundingChunks` state, Sources panel at lines 451–463), `components/ChatView.tsx` (full file, `handleSend` at lines 32–50), `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/grounded_maps.py`, `geointellisense-analytics/app/routes/deep_analysis.py`, `geointellisense-analytics/app/routes/low_latency.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/routes/weather_forecast.py`, `geointellisense-analytics/app/claude.py` (full file — `get_system_with_live_context`, session helpers, TOOLS, `execute_tool`). Cross-checked against Active Recommendations and runs #109–#110 (Latest Findings) plus archived TS↔Python runs #6, #21, #36, #51, #66, #81, #96 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/routes/weather_forecast.py:76` — The `/api/weather-forecast` route passes `system=FORECAST_SYSTEM` directly to the Claude API call, bypassing `get_system_with_live_context`. Every other AI route in the analytics service calls `await get_system_with_live_context(base_system)` before making the Claude API call: `chat.py:39`, `grounded_search.py:36`, `grounded_maps.py:43`, `deep_analysis.py:30`, `low_latency.py:30`, and `predictive_analysis.py:90` all do so. `get_system_with_live_context` (`claude.py:78–110`) injects a 60-second-cached snapshot of live AQI readings, fire hotspots, earthquake data, and water levels into the system prompt — context directly relevant to weather forecasting. Because `weather_forecast.py` skips this call, the `/api/weather-forecast` endpoint silently produces forecasts with no real-time environmental context, while the TypeScript caller at `aiService.ts:154–185` sends an identical request shape and has no way to know the backend is operating with degraded context. The `import` at `weather_forecast.py:7` does not include `get_system_with_live_context` (it imports only `get_client`), confirming the omission is not a call-site bug but a missing import. PROPOSAL: Add `get_system_with_live_context` to the import at `weather_forecast.py:7`; replace `system=FORECAST_SYSTEM` at line 76 with `system = await get_system_with_live_context(FORECAST_SYSTEM)` and add the `async` keyword to the route function signature — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/grounded_search.py:79` and `grounded_maps.py:86` — Both the `/api/grounded-search` and `/api/grounded-maps` routes hard-code `"groundingChunks": []` in their response bodies. The TypeScript `GroundingChunk` interface in `types.ts:18–35` defines a detailed schema (`web.uri`, `web.title`, `maps.uri`, `maps.title`, `maps.placeAnswerSources`) that is never populated. The TypeScript `getGroundedSearchResponse` (`aiService.ts:30–50`) and `getGroundedMapsResponse` (`aiService.ts:52–72`) read `data.groundingChunks` and return the typed array to callers. `AnalysisView.tsx:177` calls `setGroundingChunks(searchRes.groundingChunks)` and `line 187` does the same for maps. The "Sources" UI panel at `AnalysisView.tsx:451–463` renders only when `groundingChunks.length > 0` — meaning it is permanently invisible. The root cause is that the original architecture used Google's Grounding API to produce real grounding chunks with source URLs; the rewrite to Claude tool use has no equivalent output format and never populates `groundingChunks`. The `GroundingChunk` type and the "Sources" rendering block are dead code at the protocol level. PROPOSAL: Either (a) remove the `groundingChunks` field from both Python responses, the `GroundingChunk` type from `types.ts`, and the Sources panel from `AnalysisView.tsx:451–463`, or (b) populate `groundingChunks` from Claude's tool-call results by extracting source URLs from `execute_tool` responses and mapping them to `GroundingChunk` objects — L/L effort for (a), M/M for (b).

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:18–19,86` — The `ChatRequest` Pydantic model defines `session_id: str | None = None` (snake_case, Python convention), but the response JSON at line 86 returns `{"text": text, "sessionId": session_id}` (camelCase, JS convention). Pydantic's default JSON parsing uses the exact Python attribute name; there is no `model_config = ConfigDict(alias_generator=...)` or `alias=` on the field. This creates a request/response naming asymmetry: a TypeScript developer implementing the fix for Active Recommendation #4 would naturally send `{ message, sessionId }` (matching the camelCase response field name), but Pydantic would silently discard `sessionId` and use `session_id=None`, creating a new session on every request despite the TypeScript attempting to continue a session. The correct fix requires sending `{ message, session_id: "..." }` (snake_case) in the request body while reading `data.sessionId` (camelCase) from the response. This bidirectional naming asymmetry is the specific technical blocker that makes Active Recommendation #4 non-obvious to implement correctly. PROPOSAL: Add `model_config = ConfigDict(populate_by_name=True)` plus `alias="sessionId"` to the `session_id` field in `ChatRequest` (`chat.py:17–19`) so the API accepts both `sessionId` (from TypeScript) and `session_id` (from Python clients); this aligns the request key with the already-camelCase response key — L/L effort.

- OBSERVATION: `geointellisense-analytics/app/routes/low_latency.py:37` — The route returns `{"text": resp.content[0].text}` using a hard-coded positional index and attribute access. If `resp.content` is an empty list (which the Anthropic SDK can return on certain API error paths before raising an exception), this line raises `IndexError`. If `resp.content[0]` is a `ThinkingBlock` or `ToolUseBlock` (not applicable to Haiku without extended thinking, but a latent contract risk if the model configuration changes), it raises `AttributeError: '...' has no attribute 'text'`. All other AI routes in the analytics service safely iterate with `for block in resp.content: if hasattr(block, "text"):` (see `grounded_search.py:74–78`, `grounded_maps.py:81–84`, `chat.py:79–83`) or check `block.type == "text"` (see `deep_analysis.py:79–83`). The TypeScript caller at `aiService.ts:74–94` reads `data.text` and expects a string; a Python crash here returns a FastAPI 500 before the `try/except` at `low_latency.py:29` can catch it (the exception is raised at line 37 before the `return`, inside the `try` block). Actually the `try/except Exception` at line 38–45 would catch it and return a JSONResponse with status 500. The TypeScript would then throw in its `response.ok` check and return the static fallback string `"Failed to get a low-latency response."` — so the user sees a generic error. PROPOSAL: Replace `return {"text": resp.content[0].text}` at `low_latency.py:37` with `text = next((b.text for b in resp.content if hasattr(b, "text")), ""); return {"text": text}` — L/L effort.

**Proposed actions:**
- Add `get_system_with_live_context` import and call to `weather_forecast.py:7,76`; add `async` to route function signature — L/L effort (references potential Active row)
- Remove dead `GroundingChunk` type from `types.ts`, `groundingChunks` field from `grounded_search.py:79` / `grounded_maps.py:86`, and Sources panel from `AnalysisView.tsx:451–463` (option a); or backfill with Claude tool-call source URLs (option b) — L/L or M/M
- Add `model_config = ConfigDict(populate_by_name=True)` with camelCase alias to `ChatRequest.session_id` at `chat.py:18` to resolve request/response naming asymmetry blocking Active Rec #4 — L/L effort
- Replace `resp.content[0].text` at `low_latency.py:37` with safe iteration using `hasattr` guard — L/L effort

### Run #110 — 2026-06-01 — Lens: Test coverage gaps
**Scope:** Eighth test coverage gaps pass. Examined: all files under `tests/` (7 test files), `vite.config.ts` (test block configuration), `utils/colorScales.ts` (396 lines), `utils/weatherUtils.ts` (69 lines), `utils/geo3d.ts` (328 lines), `utils/interpolation.ts` (441 lines), `data/dashboardData.ts` (private helper functions at lines 124–191), `geointellisense-ingestion/src/aqi.rs` (pure functions), all 15 Rust `.rs` files under `geointellisense-ingestion/src/` for `#[cfg(test)]` modules, `geointellisense-analytics/` tree for any Python test files. Cross-checked against Active Recommendations and runs #108–#109 (Latest Findings) plus archived test-coverage runs #5, #20, #35, #50, #65, #80, #95 (one-line archive only) to confirm findings are new.

**Findings:**

- OBSERVATION: `utils/colorScales.ts` (396 lines) — Zero test coverage. This file is imported by six components: `AirQualityMapView.tsx:37`, `components/3d/PollutionVolume.tsx:17`, `components/3d/CrossSectionView.tsx:11`, `components/3d/CityMarkers.tsx:14`, `components/3d/TerrainMesh.tsx:19`, `components/3d/UIPanels.tsx:7`. It exports approximately 15 pure, non-THREE.js functions: `getAQICategory`, `getAQIColor`, `hexToRgb`, `rgbToHex`, `interpolateColorStops`, `blendColors`, `adjustBrightness`, `getContrastColor`, `aqiToOpacity`, `generateAQILegendItems`, `getInterpolatedAQIColor`, and others. These functions drive all color rendering in the 2D map and 3D scene. Specific untested edge cases: `hexToRgb` at `colorScales.ts:119` silently returns `{r:0,g:0,b:0}` on malformed input (no thrown error); `getContrastColor` at `colorScales.ts:307` uses luminance threshold `> 0.5` — a boundary test at exactly 0.5 would verify the operator direction; `interpolateColorStops` at `colorScales.ts:154–175` clamps `position` to [0,1] then walks the stop array — a test with `position=0`, `position=1`, and `position=0.5` on a two-stop gradient would verify the linear interpolation math. The THREE.js-dependent texture functions (`createGradientTexture`, `createDataTexture`, `createVolumeTexture`) are harder to test in jsdom but the 15 pure functions have zero setup cost. PROPOSAL: Add `tests/colorScales.test.ts` covering `hexToRgb`/`rgbToHex` round-trip, `getAQICategory` boundary values (49/50/51, 100/101, 150/151, 200/201, 300/301), `interpolateColorStops` at edges, `getContrastColor` black/white selection, `blendColors` at factor=0 and factor=1 — L/L effort.

- OBSERVATION: `utils/weatherUtils.ts:1–69` and `data/dashboardData.ts:124–191` — Four meteorological formula functions are exported from `utils/weatherUtils.ts` (`calculateFeelsLike`, `calculateET0`, `calculateSunTimes`, `determineWeatherCondition`) and simultaneously duplicated as private functions in `data/dashboardData.ts:124–191`. Neither copy has any tests. `utils/weatherUtils.ts` is imported by `services/WeatherService.ts:1` and its `calculateFeelsLike` (9-term NOAA heat index polynomial) and `calculateET0` (Penman-Monteith evapotranspiration) are used to compute values surfaced directly to users at `WeatherService.ts:88–89`. The two implementations appear textually identical (no divergence observed in constants or formula structure), but because they live in separate files with no test linking them, any future edit to one copy would not be caught as a divergence. The NOAA heat index formula at `weatherUtils.ts:4–9` has nine terms; an off-by-one in any constant (e.g., `2.04901523` → `2.049015`) would produce wrong user-visible "feels like" temperatures under heat-index conditions (temp ≥ 80°F, humidity ≥ 40%). `determineWeatherCondition` at `weatherUtils.ts:58` has 10 conditions but no test for which branch takes precedence when multiple conditions are simultaneously true (e.g., `precipProb > 70` and `temp > 100`). PROPOSAL: Add `tests/weatherUtils.test.ts` covering all four functions; specifically test `calculateFeelsLike` at the heat-index boundary (temp=80, humidity=40), wind-chill boundary (temp=50, windSpeed=3), and neutral path; verify `calculateET0` returns 0 for `solarRadiation=0`; verify `determineWeatherCondition` precedence order; remove the private duplicate at `dashboardData.ts:124–191` and import from `utils/weatherUtils.ts` instead — L/L effort.

- OBSERVATION: `vite.config.ts:55–62` — The `test` configuration block has `globals: true`, `environment: 'jsdom'`, `setupFiles: './tests/setup.ts'`, and `css: true`, but contains no `coverage` sub-object. The `test:coverage` npm script at `package.json:11` runs `vitest --coverage` and `@vitest/coverage-v8@^4.0.13` is installed as a devDependency. However, without a `coverage.thresholds` block, `vitest --coverage` will always exit with code 0 regardless of the actual coverage percentage. There are also no `coverage.include` or `coverage.exclude` patterns, so the report will include test infrastructure files (`tests/setup.ts`, `tests/mocks/handlers.ts`) in coverage counts, inflating the apparent coverage metrics. No `coverage.reporter` setting means the output format defaults to `text` only — no `lcov` or `html` report is generated for CI artifact upload. Practically, coverage is measured but never enforced; a refactor that drops from 80% to 5% would not break any CI step. PROPOSAL: Add a `coverage` block to `vite.config.ts:test` with `provider: 'v8'`, `reporter: ['text', 'lcov', 'html']`, `include: ['**/*.{ts,tsx}']`, `exclude: ['tests/**', '**/*.d.ts', 'vite.config.ts']`, and `thresholds: { lines: 50, functions: 50, branches: 40, statements: 50 }` as an achievable starting baseline — L/L effort.

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs` and all 15 Rust source files — No `#[cfg(test)]` module exists anywhere in the ingestion service source tree (confirmed by grep across all `.rs` files). The `aqi_category` function at `aqi.rs:77–85` is the single canonical AQI-to-category mapping for the entire ingestion service; it drives the `category` and `color` fields on every `AqiReading` broadcast to SSE consumers. It has six match arms covering the EPA AQI scale. Untested boundary values: AQI=0 (should be "Good"), AQI=50 (should be "Good"), AQI=51 (should be "Moderate"), AQI=100 (should be "Moderate"), AQI=101 (should be "Unhealthy for Sensitive Groups"), AQI=150, AQI=151, AQI=200, AQI=201, AQI=300, AQI=301, AQI=500. The `round2` helper at `aqi.rs:130` is called for every sensor value in `generate_readings`; no test verifies its behavior at the floating-point boundary (e.g., `round2(0.005)` — banker's rounding vs. half-up). Cargo's built-in test harness (`cargo test`) requires zero new dependencies; a `#[cfg(test)] mod tests { ... }` block in `aqi.rs` with `#[test]` functions for `aqi_category` boundary values and a `round2` smoke test is the lowest-friction test addition in the entire codebase. PROPOSAL: Add a `#[cfg(test)]` module to `aqi.rs` with `#[test]` cases for all six AQI category boundaries (50, 51, 100, 101, 150, 151, 200, 201, 300, 301) and two `round2` cases; run `cargo test` in CI — L/L effort.

**Proposed actions:**
- Add `tests/colorScales.test.ts` covering `hexToRgb`/`rgbToHex` round-trip, `getAQICategory` at all 6 EPA boundary pairs, `interpolateColorStops` edge positions, `getContrastColor` luminance threshold — L/L effort
- Add `tests/weatherUtils.test.ts` covering all four formula functions with boundary conditions; remove private duplicate at `data/dashboardData.ts:124–191` — L/L effort
- Add `coverage` block to `vite.config.ts:test` with `v8` provider, `lcov`/`html` reporters, `include`/`exclude` patterns, and minimum thresholds (50% lines/functions as baseline) — L/L effort
- Add `#[cfg(test)]` module to `geointellisense-ingestion/src/aqi.rs` covering all `aqi_category` match-arm boundaries and `round2` edge cases; integrate `cargo test` into CI — L/L effort

## 📚 Archive (one line per past run)
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
