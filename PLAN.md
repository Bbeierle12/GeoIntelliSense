# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-09T23:10:00Z
Last run: #232 — Lens: UX / UI flaws

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
### Run #232 — 2026-06-09 — Lens: UX / UI flaws
**Scope:** Eighteenth UX/UI-flaws pass. Full reads of: `components/DataExplorer.tsx` (lines 385–404), `components/Header.tsx` (full, 73 lines), `components/AnalysisView.tsx` (lines 440–460), `components/Dashboard.tsx` (lines 330–345), `components/Toast.tsx` (full), `components/Sidebar.tsx` (lines 64–130). Grep for `dangerouslySetInnerHTML` across all `.tsx`; grep for `focus:ring` across all `.tsx`; grep for `role="alert"` across all `.tsx`; grep for `window\.location\.reload` across all `.tsx`. Cross-checked against Active Recommendations and archived UX/UI-flaws runs #7, 22, 37, 52, 67, 82, 97, 112, 127, 142, 157, 172, 187, 202, 217 (one-line summaries) and Latest Findings runs #229–231 to confirm all findings are new.

**Findings:**

- OBSERVATION: `DataExplorer.tsx:391-394` renders Claude's analysis result via `dangerouslySetInnerHTML={{ __html: claudeResult.replace(/\n/g, '<br />') }}`. This is a second unsanitized AI-output injection surface beyond Active Rec #1 (which covers `AnalysisView.tsx:450`). `claudeResult` is the raw string returned from `/api/analyze`; the only transformation before DOM injection is a `\n → <br />` replacement, which does not strip `<script>`, `<img onerror=...>`, or any other executable tags. The surrounding `prose prose-invert prose-sm` Tailwind classes apply full typography CSS to any HTML the string contains, making injected markup render visually normally. If a prompt injection in sensor metadata (e.g., a malicious PurpleAir station name containing `<img src=x onerror="fetch(...)">`) causes Claude to echo the HTML in its response, the string would execute in the user's browser. PROPOSAL: Replace `dangerouslySetInnerHTML={{ __html: claudeResult.replace(/\n/g, '<br />') }}` at `DataExplorer.tsx:393` with `<pre className="whitespace-pre-wrap text-slate-300">{claudeResult}</pre>` (same treatment as Active Rec #1 for `AnalysisView.tsx`) — L/L effort (~1 line; closes the second XSS surface without requiring a new dependency).

- OBSERVATION: `Header.tsx:56-59` renders the theme toggle button with only `"p-2 rounded-lg bg-brand-bg-lighter hover:bg-brand-bg-dark transition-colors"` — no `focus:ring-*`, `focus-visible:ring-*`, or explicit `focus:outline-*` styling. Keyboard-navigating users who tab to this button see no visible indicator that it is focused, violating WCAG 2.1 SC 2.4.7 (Focus Visible, Level AA). By contrast, all navigation buttons in `Sidebar.tsx:76` use `focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-dark`, establishing a consistent app-wide focus pattern. The Header button does have an `aria-label` (line 60: `"Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} mode"`), so screen reader users can identify it — but the missing ring makes it invisible to sighted keyboard users. In Chromium (default UA stylesheet), `button:focus` renders no outline when a custom `className` is present, so the button's focus state is completely invisible across all major browsers. PROPOSAL: Add `focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-light` to the button className at `Header.tsx:58` — L/L effort (~1 line; aligns the app's most visible interactive element with the established Sidebar focus-ring pattern and achieves WCAG 2.4.7 AA compliance).

- OBSERVATION: Two error-display surfaces conditionally mount a plain `<div>` or `<p>` containing error text without any ARIA live-region semantics: (a) `AnalysisView.tsx:445`: `{error && <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg">{error}</div>}` — when `error` transitions from `null` to a string the `<div>` is inserted into the DOM but carries no `role="alert"` and no `aria-live` attribute; (b) `Dashboard.tsx:334-335`: `<p className="text-red-400 mb-3">{error}</p>` inside a static wrapper `<div>`, same omission. Screen readers announce live-region mutations; without one, keyboard or AT users focused elsewhere on the page (e.g., on the "Generate Analysis" button that caused the error) will not hear the error message and may not realize the action failed. The existing `ErrorMessage.tsx:75` component already implements `role="alert" aria-live="assertive"` correctly and is imported nowhere in `AnalysisView.tsx` or `Dashboard.tsx`. PROPOSAL: At `AnalysisView.tsx:445`, replace the inline error `<div>` with `<ErrorMessage message={error} onDismiss={() => setError(null)} />` using the existing component; apply the same replacement at `Dashboard.tsx:334–342` — L/L effort (~4 lines; re-uses the accessible error component already in the codebase, ensuring error messages are announced immediately by screen readers).

- OBSERVATION: `Dashboard.tsx:337` `onClick={() => { setError(null); setLoading(true); window.location.reload(); }}` triggers a full browser navigation reload as the "Retry" action for data-fetch failures. This unconditionally discards all React state: `selectedLocations` (user's chosen city comparisons), `isComparisonMode`, `startDate`, `endDate` (set via `DateFilter`), and `predictiveLocation`. After the reload the app re-initializes with default values (first location, comparison off, default date range), forcing users to re-enter all filter parameters from scratch. The `setLoading(true)` call immediately before `window.location.reload()` is also vestigial — the state mutation is never committed to the DOM because the reload begins synchronously, discarding it. The correct behavior is to re-invoke only the data-fetching logic (the same `useEffect` dependency that runs on mount or on `selectedLocations` change), not the full navigation stack. PROPOSAL: Replace `window.location.reload()` at `Dashboard.tsx:337` with `setRetryCount(c => c + 1)` (adding `const [retryCount, setRetryCount] = useState(0)` and `retryCount` to the relevant `useEffect` dependency array) — L/L effort (~5 lines; retries only the failed fetch, preserves all user-selected filter state, and removes the vestigial `setLoading(true)` before the reload).

**Proposed actions:**
- Replace `dangerouslySetInnerHTML` at `DataExplorer.tsx:393` with `<pre className="whitespace-pre-wrap text-slate-300">{claudeResult}</pre>` — L/L effort (~1 line; closes second XSS surface, mirrors Active Rec #1 fix)
- Add `focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-light` to theme toggle button className at `Header.tsx:58` — L/L effort (~1 line; achieves WCAG 2.4.7 AA focus-visible compliance for the app's most prominent button)
- Replace inline error `<div>` at `AnalysisView.tsx:445` and error `<p>` at `Dashboard.tsx:334–342` with existing `<ErrorMessage>` component — L/L effort (~4 lines; ensures errors are announced by screen readers via `role="alert"`)
- Replace `window.location.reload()` at `Dashboard.tsx:337` with `setRetryCount(c => c + 1)` + retryCount useEffect dependency — L/L effort (~5 lines; retries data fetch without discarding user filter state)

### Run #231 — 2026-06-09 — Lens: TS ↔ Python contract
**Scope:** Seventeenth TS↔Python-contract pass. Full reads of: `services/dataService.ts`, `services/aiService.ts`, `services/WeatherService.ts`, `hooks/useLiveData.ts`, `components/ChatView.tsx`, `components/AnalysisView.tsx`, `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/historical_weather.py`, `geointellisense-analytics/app/routes/historical_aqi.py`, `geointellisense-analytics/app/routes/nws_forecast.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/routes/earthquakes.py`, `geointellisense-analytics/app/routes/inversion.py`, `geointellisense-analytics/app/routes/weather_forecast.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/ml/aqi_model.py`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-analytics/app/clients/nws_sounding.py`. Cross-checked against Active Recommendations and archived TS↔Python runs #6, 21, 36, 51, 66, 81, 96, 111, 126, 141, 156, 171, 186, 201, 216 (one-line summaries) and Latest Findings runs #228–230 to confirm all findings are new.

**Findings:**

- OBSERVATION: `chat.py:17-19` defines `ChatRequest(BaseModel)` with `session_id: str | None = None`; `chat.py:86` returns `{"text": text, "sessionId": session_id}`; `claude.py` exports `create_session()`, `get_session_history()`, and `append_to_session()` which maintain per-session message arrays. The Python side therefore implements a full stateful multi-turn conversation: each call to `/api/chat` appends messages to a session and sends the full history to Claude via `get_session_history(session_id)` at line 47. However, `aiService.ts:8-28` sends only `{ message }` without `session_id`, and reads only `data.text` from the response — `sessionId` in the response is silently discarded. `ChatView.tsx:41` calls `getChatResponse(input)` with a single string argument; there is no state variable for `sessionId` anywhere in `ChatView.tsx`. The result is that a new Python session is created on every chat turn (`session_id = req.session_id or create_session()` always takes the `create_session()` branch), so Claude in Python never sees any prior turns from the UI — the displayed conversation in the browser is a client-side illusion only. The Python session infrastructure (session creation, history tracking, `append_to_session`) runs but produces sessions that are written to and immediately abandoned. PROPOSAL: Update `getChatResponse(message: string, sessionId?: string)` in `aiService.ts` to send `{ message, session_id: sessionId }` and return `{ text: string, sessionId: string }`; add `sessionId` to `ChatView.tsx` state and pass it on every `handleSend()` call — L/L effort (~12 lines; connects the Python session-history feature to the frontend and gives Claude true multi-turn memory).

- OBSERVATION: `grounded_search.py:79` unconditionally returns `{"text": text, "groundingChunks": []}` — `groundingChunks` is always an empty array regardless of what Claude's tool calls retrieved. The TS `aiService.ts:44-46` reads `data.groundingChunks` and returns `{ text: data.text, groundingChunks: data.groundingChunks }` to `AnalysisView.tsx`. At `AnalysisView.tsx:176-177`, `setGroundingChunks(searchRes.groundingChunks)` stores the empty array, and any rendered citation links (`GroundingChunk` with `web.uri` / `web.title`) are never shown to the user. The Python `grounded_search.py` does run a full tool-use loop (lines 48-72) that calls `execute_tool()`, but `TOOLS` in `claude.py` uses the Anthropic tools API — citations from tool calls are embedded in `resp.content` as `tool_use` and `tool_result` blocks, not in a `groundingChunks` response key (which is a Google Gemini API concept). So `groundingChunks` was a frontend contract inherited from a prior Google-Vertex-based implementation; the Python side never populated it and the TS `GroundingChunk` type (`types.ts:14-30`) with `.web.uri` and `.web.title` matches neither Anthropic's tool schema nor any server-side response. PROPOSAL: Either (a) parse Claude's tool results in `grounded_search.py` to extract URLs/titles cited during tool-use and populate `groundingChunks` accordingly, or (b) replace `GroundingChunk` with a Anthropic-native citation type and remove the now-meaningless `groundingChunks: []` from the response — M/M effort (~20 lines; fixes dead citation UX on grounded search results).

- OBSERVATION: `historical_weather.py:56` returns a bare Python list `return []` when no sensor rows exist. FastAPI auto-serializes this as `200 OK` with body `[]` and `Content-Type: application/json`, but with no `Cache-Control` or `X-Cache` headers. Compare to the sibling `historical_aqi.py:64` which uses `return JSONResponse(content=[], headers=cache_headers(False, HIST_TTL))` — correctly emitting `Cache-Control: max-age=300` and `X-Cache: MISS` on the empty-result case. The full-data path in `historical_weather.py` (line 106) also uses a bare `return records` (not `JSONResponse`), meaning `/api/historical-weather` never emits cache headers for any response (empty or populated). If the Caddy reverse proxy is configured to respect `Cache-Control` for upstream caching, the weather endpoint's responses are never cached at the proxy layer while the AQI endpoint's are. This asymmetry is invisible to the TS client (`dataService.ts:225-233` checks only `response.ok`) but causes unnecessary repeated upstream fetches for the same data. PROPOSAL: Wrap the `return []` at `historical_weather.py:56` and `return records` at line 106 in `JSONResponse(..., headers=cache_headers(False, HIST_TTL))` — L/L effort (~4 lines; aligns historical-weather with historical-aqi's caching contract and enables proxy-layer response caching).

- OBSERVATION: `nws_forecast.py:79` passes `"windSpeed": p.get("windSpeed", "")` directly from the NWS API into the JSON response. The NWS API delivers `windSpeed` as a human-readable string: `"10 mph"`, `"Calm"`, `"10 to 20 mph"`, or `"NA"`. The TS `ForecastPeriod.windSpeed: string` in `useLiveData.ts:224` correctly types it as string — `useNwsForecast()` users see the string. However, `dataService.ts:84` declares `ForecastRecord.windSpeed: number` as a numeric field, and `WeatherService.getForecast()` at `WeatherService.ts:98-140` fetches from `/api/forecast`, deliberately ignores `windSpeed` in its destructuring at line 103-111, and `dataService.ts:258` hardcodes `windSpeed: 0` in every `ForecastRecord`. Consequently, any component consuming `ForecastRecord` (e.g., `Dashboard.tsx:10` imports `ForecastRecord`) always receives `windSpeed: 0` — NWS live wind data is silently discarded. With 7 days of forecast periods × up to 6 locations = 84 records, each carrying `windSpeed: 0`, Dashboard wind charts display flat zero lines despite live NWS data being available. PROPOSAL: In `WeatherService.getForecast()`, parse the `windSpeed` string to a number (regex to extract the first integer: `parseInt(r.windSpeed?.match(/\d+/)?.[0] ?? "0", 10)`), add `windSpeed` to the `ForecastData` interface, and pass it through to `ForecastRecord` — L/L effort (~5 lines; surfaces live NWS wind data and removes the silent constant-zero wind from dashboard forecast charts).

**Proposed actions:**
- Update `getChatResponse()` in `aiService.ts` to send `session_id` and return `sessionId`; add `sessionId` state to `ChatView.tsx` and pass it per turn — L/L effort (~12 lines; enables Python session history and gives Claude multi-turn memory)
- Populate `groundingChunks` from tool-call URL citations in `grounded_search.py`, or replace `GroundingChunk` type with Anthropic-native citations — M/M effort (~20 lines; fixes dead citation display on grounded search)
- Wrap `return []` and `return records` in `historical_weather.py` with `JSONResponse(..., headers=cache_headers(False, HIST_TTL))` — L/L effort (~4 lines; aligns caching contract with `historical_aqi.py`)
- In `WeatherService.getForecast()`, parse NWS `windSpeed` string to int; add to `ForecastData`; pass through to `ForecastRecord` — L/L effort (~5 lines; surfaces live NWS wind data on Dashboard)

### Run #230 — 2026-06-09 — Lens: Test coverage gaps
**Scope:** Sixteenth test-coverage-gaps pass. Full reads of: `utils/weatherUtils.ts`, `utils/interpolation.ts`, `utils/colorScales.ts`, `utils/geo3d.ts`, `geointellisense-ingestion/src/aqi.rs`, `geointellisense-analytics/app/http_client.py`, `geointellisense-analytics/app/ml/aqi_model.py`. Grep for `#\[cfg(test)\]` across all `.rs`; grep for `test_` across all `.py`; grep for `conftest` in analytics dir. Surveyed all existing test files: `App.test.tsx`, `tests/accessibility.test.tsx`, `tests/errorHandling.test.tsx`, `tests/integration.test.tsx`, `tests/routing.test.tsx`, `tests/security.test.tsx`, `tests/userPreferences.test.tsx`. Cross-checked against Active Recommendations and archived test-coverage runs #5, 20, 35, 50, 65, 80, 95, 110, 125, 140, 155, 170, 185, 200, 215 (one-line summaries only) and Latest Findings runs #227–229 to confirm findings are new.

**Findings:**

- OBSERVATION: `utils/weatherUtils.ts` exports four non-trivial pure functions — `calculateFeelsLike` (lines 1–16), `calculateET0` (lines 18–31), `calculateSunTimes` (lines 33–56), and `determineWeatherCondition` (lines 58–69) — with zero test coverage. `calculateFeelsLike` applies three distinct branches: heat index when `temp >= 80 && humidity >= 40`, wind chill when `temp <= 50 && windSpeed >= 3`, and identity otherwise. The gap between these conditions (50 < temp < 80) silently returns dry-bulb temperature regardless of humidity or wind, which is correct per NOAA but never verified by a test. `calculateET0` applies the FAO Penman-Monteith equation; if `tempC = -237.3` (physically impossible, -395.7°F) the denominator of `es` (line 21: `tempC + 237.3`) would be zero — but no test confirms the safe operating range or the `max(0, et0)` clamp at line 30. `determineWeatherCondition` at line 59 has precedence-ordered conditions where `precipProb > 70 → Rainy` supersedes all others; with `cloudCover = 90` and `precipProb = 75`, the function returns `'Rainy'` (not `'Overcast'`). This precedence is intentional but never asserted. These functions are consumed by `WeatherWidget` and `services/WeatherService.ts` and directly affect weather display. PROPOSAL: Add `tests/weatherUtils.test.ts` covering boundary conditions for all four functions: heat-index/wind-chill/identity boundaries in `calculateFeelsLike`; saturation edge in `calculateET0`; solstice/equinox day-length values in `calculateSunTimes`; precedence ordering in `determineWeatherCondition` — L/L effort (~60 lines; pure synchronous functions, zero mocking needed).

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs:88-97` defines `aqi_category(aqi: u32) → (&'static str, &'static str)` mapping AQI integers to `(label, hex_color)` using Rust inclusive-range match arms. An identical category boundary table is independently defined in TypeScript at `utils/colorScales.ts:15-22` (`AQI_CATEGORIES` object with `range: [0,50]`, `[51,100]`, etc.) and again in Python at `geointellisense-analytics/app/ml/aqi_model.py:371-382` (`_aqi_category`). These three implementations are entirely independent — no shared schema, no contract test, no codegen. A boundary discrepancy (e.g., one implementation treating AQI=100 as 'moderate' while another treats it as 'unhealthy for sensitive groups') would cause different parts of the app to show different categories for the same AQI value. Currently, the Rust file has zero `#[cfg(test)]` modules anywhere in `geointellisense-ingestion/src/` — `cargo test` passes vacuously with no test functions. PROPOSAL: Add a `#[cfg(test)] mod tests` block in `aqi.rs` asserting each of the 7 boundary values (AQI 0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301); add a matching `tests/colorScales.test.ts` asserting `getAQICategory(50) === 'good'` and `getAQICategory(51) === 'moderate'` at each boundary — L/L effort (~20 Rust lines + 15 TS lines; prevents silent three-way category divergence).

- OBSERVATION: `utils/interpolation.ts:57-61` returns `{ value: 0, confidence: 0 }` when `dataPoints.length < minPoints` (default `minPoints = 1`). This means calling `interpolateIDW([], targetLat, targetLng)` silently returns `value: 0` — an AQI of 0, which maps to `getAQICategory(0) = 'good'` and renders as green on the 3D city markers and pollution volume. In production, if the SSE connection to the ingestion service drops and `useRealtimeAQI.ts` feeds an empty readings array to `generateInterpolatedGrid`, the entire valley would display as AQI=0 (Good) rather than showing a stale-data or error state. No test covers the empty-input path, the `minPoints` threshold path, or the `searchRadius` filter at line 71 (`.filter((p) => p.distance <= searchRadius)`) — which can also produce an empty filtered set that returns `{ value: 0, confidence: 0 }`. PROPOSAL: Add `tests/interpolation.test.ts` with cases: empty-array → `{ value: 0, confidence: 0 }`, single-point exact match → `{ value: point.value, confidence: 1 }`, `searchRadius` smaller than nearest point → `{ value: 0, confidence: 0 }`, two-point IDW midpoint → verified weighted average — L/L effort (~40 lines; pure math functions, no mocking needed; documents and validates silent-zero behavior so callers know to guard against it).

- OBSERVATION: `geointellisense-analytics/app/http_client.py` contains a 7-path retry state machine (lines 31-81) with no corresponding test infrastructure in the entire `geointellisense-analytics/` package: there is no `tests/` directory, no `conftest.py`, no `pytest.ini`, and no `pyproject.toml` `[tool.pytest]` section — `find` returns zero Python test files across all 60+ `.py` source files. The most important untested path is lines 47-52: when a 500 response is received on the final attempt (`attempt == max_retries`), the condition `attempt < max_retries` is False and execution falls through to `resp.raise_for_status()` at line 55. There is also a structural dead-code issue at lines 78-81: the `if last_error: raise last_error; raise RuntimeError(...)` block is only reachable if the loop completes without a `return`, `continue`, or `raise` — but given the branch structure (every path either returns, continues, or raises), the `raise RuntimeError` at line 81 is unreachable in all practical cases. With `respx` (the httpx-compatible mock library), all 7 paths could be covered in approximately 50 pytest lines. PROPOSAL: Create `geointellisense-analytics/tests/test_http_client.py` with `pytest` + `respx`; cover: (a) success on first attempt, (b) 429 → sleep → retry → success, (c) 500 × 3 → HTTPStatusError on attempt 4, (d) TimeoutException → retry → success, (e) TimeoutException × 4 → propagates; also add `pytest` to `requirements.txt` and a `conftest.py` — L/M effort (~50 lines + config; provides the first automated coverage for the Python analytics service and documents the retry contract).

**Proposed actions:**
- Add `tests/weatherUtils.test.ts` covering boundary conditions for `calculateFeelsLike`, `calculateET0`, `calculateSunTimes`, `determineWeatherCondition` — L/L effort (~60 lines; zero mocking needed)
- Add `#[cfg(test)] mod tests` in `aqi.rs` for all 11 AQI boundary values; add matching boundary assertions in a new `tests/colorScales.test.ts` — L/L effort (~35 lines; prevents silent three-way Rust/TS/Python category divergence)
- Add `tests/interpolation.test.ts` covering empty-input, exact-match, searchRadius-exclusion, and two-point midpoint paths in `interpolateIDW` — L/L effort (~40 lines; documents silent-zero behavior that can masquerade as AQI=0 on empty data)
- Create `geointellisense-analytics/tests/test_http_client.py` with `pytest` + `respx`; add `pytest` + `respx` to `requirements.txt`; add `conftest.py` — L/M effort (~50 lines + config; first test coverage for the entire Python analytics package)

## 📚 Archive (one line per past run)
- Run #229 (2026-06-09) — Lens: Perf hot paths — 4 findings — 0 promoted to Active
- Run #228 (2026-06-09) — Lens: Dependency health — 4 findings — 0 promoted to Active
- Run #227 (2026-06-09) — Lens: Module boundaries — 4 findings — 0 promoted to Active
- Run #226 (2026-06-09) — Lens: Type safety — 4 findings — 0 promoted to Active
- Run #225 (2026-06-09) — Lens: Live-time claim audit — 4 findings — 0 promoted to Active
- Run #224 (2026-06-09) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
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
- Run #227: lens 2 (Module boundaries) — findings added
- Run #228: lens 3 (Dependency health) — findings added
- Run #229: lens 4 (Perf hot paths) — findings added
- Run #230: lens 5 (Test coverage gaps) — findings added
- Run #231: lens 6 (TS ↔ Python contract) — findings added
- Run #232: lens 7 (UX / UI flaws) — findings added
