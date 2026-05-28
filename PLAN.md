# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T11:15:00Z
Last run: #7 — Lens: UX / UI flaws

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Sanitize AI result before `dangerouslySetInnerHTML` in `AnalysisView.tsx` | UX/Security | H | L | 7 | Open |
| 2 | Propagate `sessionId` through chat calls in `aiService.ts` | TS↔Py contract | H | L | 6 | Open |
| 3 | Batch DB writes in `persist.rs` with UNNEST | Perf | H | L | 4 | Open |
| 4 | Add `trainedAt` to `predict_aqi()` return dict (or remove from `PredictionResult` TS type) | TS↔Py contract | M | L | 6 | Open |
| 5 | Expose `category`, `color`, `source` from SSE `aqi-update` in `RealtimeCityData` | TS↔Py contract | M | L | 6 | Open |
| 6 | Align `windSpeed` type: `ForecastPeriod.windSpeed: string` vs `ForecastRecord.windSpeed: number` | TS↔Py contract | M | L | 6 | Open |
| 7 | Annotate AI service `response.json()` shapes | Type safety | M | L | 1 | Open |
| 8 | Use `asyncio.gather` in `build_live_context` | Perf | M | L | 4 | Open |
| 9 | Add Vitest coverage thresholds to `vite.config.ts` | Test coverage | M | L | 5 | Open |
| 10 | Add unit tests for `interpolation.ts`, `weatherUtils.ts`, `colorScales.ts` pure functions | Test coverage | M | L | 5 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #7 — 2026-05-28 — Lens: UX / UI flaws
**Scope:** `index.html`; `components/AnalysisView.tsx`; `components/MapView.tsx`; `components/ChatView.tsx`; `components/LoadingStates.tsx`; `components/Toast.tsx`; `components/ErrorBoundary.tsx`; `components/dashboard/widgets/AqiForecastWidget.tsx`; `components/dashboard/widgets/InversionWidget.tsx`; `components/dashboard/widgets/AqiGaugeWidget.tsx`; `components/dashboard/WidgetShell.tsx`; `components/3d/UIPanels.tsx`; `styles/theme-light.css`; `contexts/UserPreferencesContext.tsx`.

**Findings:**

- OBSERVATION: `components/AnalysisView.tsx:450` — `dangerouslySetInnerHTML={{ __html: result.replace(/\n/g, '<br />') }}` renders the raw AI-returned analysis string as HTML with no sanitization beyond newline→`<br />` conversion. `result` comes from the Python analytics server which forwards Claude/Gemini output. If an adversarial prompt causes the model to emit HTML tags (e.g. `<img onerror="…">`, `<script>…</script>`), those tags execute in the browser with full DOM access. The only escape path is `DOMPurify.sanitize(result)` before injection, or switching to `whitespace-pre-wrap` text rendering (which also avoids the need for `<br />` replacement).

- OBSERVATION: `components/MapView.tsx:253-264, 279-291, 305-317, 327-342, 354-367` — All five Google Maps `InfoWindow` popups are built by interpolating **server-returned external data** directly into raw HTML template literals. Specifically: `r.stationName` (PurpleAir station names, line ~255), `e.place` (USGS earthquake place-name string, line ~308), `w.name` / `w.operator` (CalGEM well names/operators, lines ~332-337), `w.siteName` (water quality site name, line ~358), and the `paramHtml` variable assembled from `Object.entries(w.parameters || {}).map(([name, p]) => …)` (line ~350-352, where `name` is a contaminant name from the backend). None of these values are HTML-escaped before insertion. A maliciously named station (`"><img src=x onerror=alert(1)>`) would execute in the info window's sandboxed but same-origin context. All info windows also hardcode `background:#0f172a;color:#cbd5e1` inline styles, so they remain permanently dark-themed in light mode, ignoring the `.light` class toggle controlled by `UserPreferencesContext`.

- OBSERVATION: `components/LoadingStates.tsx:8, 26, 47, 71, 160, 180, 216` — Every skeleton loader and the `StatusDot` pulse use Tailwind's `animate-pulse` class with no `motion-safe:` prefix and no `@media (prefers-reduced-motion: reduce)` guard anywhere in the codebase. Tailwind provides first-class `motion-safe:animate-pulse` and `motion-reduce:animate-none` utilities for exactly this case. Users who enable `prefers-reduced-motion` in their OS (commonly done by users with vestibular disorders or epilepsy triggers) receive continuous animation. No component or global CSS anywhere in the project addresses this.

- OBSERVATION: `components/ChatView.tsx:14` — `scrollToBottom` calls `messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })` unconditionally. Every incoming AI message triggers a smooth animated scroll in the chat pane. There is no check for `window.matchMedia('(prefers-reduced-motion: reduce)').matches`; affected users experience motion on every response. Fix: detect reduced-motion preference and use `behavior: "instant"` when active.

- OBSERVATION: `components/dashboard/widgets/InversionWidget.tsx:26, 33, 37` — Three temperature values are displayed on the same card using two different unit systems: line 33 shows `surfaceTempF` in °F (`data.surfaceTempF`), line 37 shows `temp850mbC` in °C (`data.temp850mbC`), and line 26 shows the temperature difference `tempDiffC` in °C. A user reading "Surface: 68°F / 850mb: 15°C / Diff: +5°C" cannot mentally verify the inversion without converting units. The Python backend (`inversion.py`) already returns both `surfaceTempC` and `surfaceTempF`; the widget should pick a consistent unit per the user's preference in `UserPreferencesContext.temperatureUnit`.

- OBSERVATION: `components/dashboard/widgets/AqiForecastWidget.tsx:62` — "Top Drivers" feature names are rendered as `<span className="text-slate-400 w-28 truncate">{f.feature.replace(/_/g, ' ')}</span>` with a fixed `w-28` (112 px) width and the `truncate` class, but **no `title` attribute**. Names like `"relative_humidity_percent"` or `"wind_speed_10m_ms"` are silently clipped. The user has no way to discover the full name on hover or via keyboard focus. Adding `title={f.feature.replace(/_/g, ' ')}` to the span is a one-line fix.

- OBSERVATION: `index.html:15` — Tailwind CSS is loaded from `https://cdn.tailwindcss.com` (the Play CDN). The Tailwind docs explicitly state: *"The Play CDN is designed for development purposes only, and is not the best choice for production."* The CDN build (~313 KB unminified) attaches a `MutationObserver` to the document to detect new class names and generate CSS at runtime. In a data-heavy app that constantly adds new React elements to the DOM (3D canvas updates, real-time SSE markers, chart re-renders), this observer fires continuously and adds measurable CPU overhead on lower-end devices. Production builds should use `@tailwindcss/vite` with a proper purge/scan config to emit a static, tree-shaken CSS bundle of ~8–20 KB.

- OBSERVATION: `components/3d/UIPanels.tsx:352-355` — The camera-controls help text uses emoji characters (🖱️ ⚲ ⇧) as the sole visual representation of mouse/keyboard actions. These glyphs are not supported in all emoji fonts and render as blank boxes on some Android WebViews and older Windows Chrome builds. No fallback text (e.g. "Left-click to rotate") is provided, and the emoji lack `aria-label` alternatives. Screen reader users cannot discover the available controls at all from this section.

**Proposed actions:**
- Replace `dangerouslySetInnerHTML` with `DOMPurify.sanitize()` or plain-text rendering in `AnalysisView.tsx:450` → Active Recommendation #1
- HTML-escape all externally-sourced strings before interpolation in `MapView.tsx` info windows (add a 5-line `escapeHtml(s)` helper); apply theme-aware CSS class to info window container — not in top 10 (M/M, score 1.0, info window DOM is Google's)
- Replace `animate-pulse` with `motion-safe:animate-pulse motion-reduce:animate-none` across all 7 occurrences in `LoadingStates.tsx` — not in top 10 (M/L=2.0 ties existing items)
- Use reduced-motion-aware scroll in `ChatView.tsx:14` — not in top 10 (L/L, score 1.0)
- Unify temperature units in `InversionWidget.tsx` by reading `UserPreferencesContext.temperatureUnit` — not in top 10 (M/L=2.0 ties existing items)
- Add `title` attribute to truncated feature names in `AqiForecastWidget.tsx:62` — not in top 10 (L/L, score 1.0)
- Replace Tailwind CDN with `@tailwindcss/vite` build pipeline in `index.html` and `vite.config.ts` — not in top 10 (M/M, score 1.0)
- Replace emoji control hints with labelled SVG icons in `UIPanels.tsx:352-355` — not in top 10 (L/L, score 1.0)

### Run #6 — 2026-05-28 — Lens: TS ↔ Python contract
**Scope:** `types.ts`, `services/dataService.ts`, `services/aiService.ts`, `hooks/useRealtimeAQI.ts`, `hooks/useLiveData.ts`; Python routes `chat.py`, `grounded_search.py`, `grounded_maps.py`, `historical_aqi.py`, `historical_weather.py`, `predictive_analysis.py`, `weather_forecast.py`, `nws_forecast.py`, `predict.py`, `inversion.py`; Rust structs `aqi.rs` (`AqiReading`), `routes/aqi.rs` (`SnapshotResponse`); Python `clients/nws_sounding.py` (`InversionStatus.to_dict`, `_wrap_status`); Python `ml/aqi_model.py` (`predict_aqi`).

**Findings:**

- OBSERVATION: `services/aiService.ts:getChatResponse` — the function posts `{ message }` with no `session_id` field. Python `geointellisense-analytics/app/routes/chat.py:ChatRequest` accepts `session_id: str | None` and returns `{ "text": text, "sessionId": session_id }`. TypeScript only reads `data.text` and discards `sessionId`. Because `session_id` is never sent in subsequent calls, the Python handler calls `create_session()` on every request (line: `session_id = req.session_id or create_session()`). The multi-turn session history that `append_to_session` / `get_session_history` manage is permanently lost between calls: every user message starts a fresh conversation with no prior context.

- OBSERVATION: `hooks/useLiveData.ts:PredictionResult` — TypeScript declares `trainedAt: string` as a required field (line ~83). Python `geointellisense-analytics/app/ml/aqi_model.py:predict_aqi` (lines ~return dict) does NOT include `trainedAt` in its return value — the dict contains `predictedAqi`, `confidenceInterval`, `category`, `horizon`, `modelR2`, `modelMAE`, `topFactors`, and `currentFeatures`. `trainedAt` is available in `get_model_status()` but is never forwarded by `/api/predict/aqi`. Any component that renders `result.trainedAt` receives `undefined` at runtime with no type error. Additionally, Python returns `currentFeatures: dict` (the raw feature vector used for prediction) which has no corresponding declaration in `PredictionResult`, so this diagnostic field is silently discarded.

- OBSERVATION: `hooks/useRealtimeAQI.ts` — the inline `aqi-update` event type (lines ~180-197) declares: `stationId`, `stationName`, `lat`, `lng`, `county`, `timestamp`, `aqi`, `pm25`, `pm10`, `o3`, `no2`, `so2`, `co`, `temperature`, `humidity`, `windSpeed`, `windDirection`. Rust `geointellisense-ingestion/src/aqi.rs:AqiReading` (`#[serde(rename_all = "camelCase")]`) also emits: `category` (e.g. "Moderate"), `color` (hex e.g. "#ffff00"), `source` ("mock" or "purpleair"), and optionally `rawSensorCount`. These four fields are absent from the TypeScript inline type. The mapping to `RealtimeCityData` (lines ~200-213) never reads them. The 3D view therefore cannot distinguish mock from live PurpleAir data, and discards the EPA-authoritative category/color in favour of recomputing them locally in `colorScales.ts`.

- OBSERVATION: `geointellisense-analytics/app/routes/historical_weather.py:historical_weather` — every record in the response includes `"totalPrecipitation": 0.0` unconditionally (line ~`"totalPrecipitation": 0.0,  # sensor_readings doesn't have precip; placeholder`). TypeScript `services/dataService.ts:HistoricalWeatherRecord.totalPrecipitation: number` gives no indication to callers that the value is always zero. Components consuming the live endpoint receive silent zeros for all precipitation data. The fallback in `DataService.getHistoricalWeatherFallback` generates random synthetic precipitation values using `Math.random()`, meaning the mock path inadvertently produces more realistic-looking data than the live path.

- OBSERVATION: `services/aiService.ts:getGroundedSearchResponse` / `getGroundedMapsResponse` — both functions read `data.groundingChunks` from the response (lines ~36, ~55). Python `geointellisense-analytics/app/routes/grounded_search.py` returns `{"text": text, "groundingChunks": []}` and `grounded_maps.py` identically returns `{"text": text, "groundingChunks": []}` — both routes hard-code an empty list. TypeScript `types.ts:GroundingChunk` defines a complex interface with `web.uri`, `web.title`, `maps.uri`, `maps.placeAnswerSources`, etc. This interface describes citations that can never be populated via the current Python backend.

- OBSERVATION: `hooks/useLiveData.ts:ForecastPeriod` / `services/dataService.ts:ForecastRecord` — two TypeScript types represent weather forecast periods but have conflicting types for the same field: `useLiveData.ts:ForecastPeriod.windSpeed: string` (line ~120) vs `dataService.ts:ForecastRecord.windSpeed: number` (line ~52). Python `geointellisense-analytics/app/routes/nws_forecast.py` returns `"windSpeed": p.get("windSpeed", "")` — the NWS API always returns a string like `"10 mph"`. `dataService.ts:getWeatherForecast` sets `windSpeed: 0` (hardcoded number) when building `ForecastRecord`. Any code reading `ForecastRecord.windSpeed` as a string will silently get `"0"` after coercion; any code reading `ForecastPeriod.windSpeed` as a number will get `NaN` on `parseFloat("10 mph")` without explicit parsing.

- OBSERVATION: `hooks/useLiveData.ts:InversionData` — TypeScript declares 9 fields: `inversionStrength`, `surfaceTempC`, `surfaceTempF`, `temp850mbC`, `tempDiffC`, `fogLikely`, `advisory`, `aqiImpact`, `time`. Python `_wrap_status` in `inversion.py` (line ~`def _wrap_status`) spreads `InversionStatus.to_dict()` which returns 13 fields; 6 are not declared in the TS type: `temp850mbF`, `surfaceDewpointC`, `windSpeedKts`, `mixingHeightM`, `source`, `soundingStation`. The `InversionWidget` cannot display these meteorologically significant fields without TS type updates.

**Proposed actions:**
- Store `sessionId` in React state in `ChatView.tsx`; send `session_id` in each `getChatResponse` call → Active Recommendation #2
- Add `trainedAt` to `predict_aqi()` return via `meta.get("trained_at")`, or update `PredictionResult` to mark it optional → Active Recommendation #4
- Add `category`, `color`, `source` to the `aqi-update` inline type in `useRealtimeAQI.ts` and map to `RealtimeCityData` → Active Recommendation #5
- Change `ForecastRecord.windSpeed` to `string` in `dataService.ts` and update callsites → Active Recommendation #6
- Widen `InversionData` to include all 13 Python-returned fields → not in top 10 (L/L, score 1.0)
- `totalPrecipitation` fix requires a DB schema change or external weather API integration — not in top 10 (H/H, score 1.0)
- `groundingChunks` population would require implementing citation extraction from tool call results — not in top 10 (M/H, score 0.67)

### Run #5 — 2026-05-28 — Lens: Test coverage gaps
**Scope:** All files under `components/`, `hooks/`, `utils/`, `services/`, `contexts/`; `App.test.tsx`; `tests/*.test.tsx`; `vite.config.ts`; `package.json`; all `.rs` files in `geointellisense-ingestion/src/`; all `.py` files in `geointellisense-analytics/`; `geointellisense-ingestion/Cargo.toml`; `geointellisense-analytics/requirements.txt`.

**Findings:**

- OBSERVATION: `vite.config.ts:36-40` — the `test` block configures `globals`, `environment`, `setupFiles`, and `css`, but has no `coverage` key. `@vitest/coverage-v8` is present in `package.json:devDependencies`, and `"test:coverage": "vitest --coverage"` exists as an npm script, but without a `coverage.thresholds` section, `vitest --coverage` always exits 0 regardless of how little code is exercised. Any CI step running `npm run test:coverage` passes even at 0 % branch/statement coverage.

- OBSERVATION: `geointellisense-analytics/` — the entire Python analytics service (30 route files, 10 client files, `ml/aqi_model.py`, `cache.py`, `http_client.py`, `middleware.py`, `context.py`) has **zero test files**. `pytest` does not appear in `requirements.txt`. There is no `conftest.py`, no `tests/` directory, and no `pyproject.toml` with a `[tool.pytest]` section. This means the FastAPI routes (`/api/chat`, `/api/low-latency`, `/api/predict`, all 30 others) ship with no automated validation. The `middleware.py` rate-limiter and the `ml/aqi_model.py` prediction pipeline are the highest-risk untested paths.

- OBSERVATION: `geointellisense-ingestion/src/` — all 15 Rust source files (`aqi.rs`, `broadcast.rs`, `config.rs`, `db/persist.rs`, `db/mod.rs`, `main.rs`, `purpleair.rs`, `redis_cache.rs`, `routes/admin.rs`, `routes/aqi.rs`, `routes/earthquakes.rs`, `routes/health.rs`, `routes/mod.rs`, `routes/sse.rs`, `usgs.rs`) contain **zero `#[test]` functions** and zero `#[cfg(test)]` modules. `Cargo.toml` has no `[dev-dependencies]` section. The `aqi.rs` AQI calculation logic and the `persist.rs` database write path (already flagged in Run #4 for correctness issues) are both completely untested.

- OBSERVATION: `utils/interpolation.ts`, `utils/weatherUtils.ts`, `utils/colorScales.ts` — these three files contain exclusively **pure, side-effect-free functions** (`interpolateIDW`, `generateInterpolatedMatrix`, `calculateFeelsLike`, `calculateET0`, `calculateSunTimes`, `getAQIColor`, `getAQICategory`) with no network calls, DOM access, or React state — yet none appears in any test file. `interpolation.ts` is 441 lines with non-trivial spatial algorithms; a boundary case bug (e.g. zero data points passed to `interpolateIDW`) silently returns `{ value: 0, confidence: 0 }` and would corrupt the terrain map without any test catching it. `weatherUtils.ts` implements the NOAA Heat Index formula and ET₀ (Penman-Monteith) — physical equations that are independently verifiable but currently unverified.

- OBSERVATION: `hooks/useRealtimeAQI.ts` — contains SSE connection management, exponential-backoff reconnection (`reconnectInterval`, `maxReconnectAttempts`), history ring-buffer caching (`maxHistorySize`), and a mock-data fallback path (`fallbackToMock`). None of these behaviours appear in any test. The hook is a central reliability contract: if reconnection logic is broken, the live 3D view silently stalls. The mock fallback path (used in development and possibly in CI) is also untested.

- OBSERVATION: `hooks/useDashboardData.ts`, `hooks/useLiveData.ts`, `hooks/useNormalizedData.ts`, `hooks/useViewport.ts` — all four hooks have **zero test coverage**. `useLiveData.ts` classifies HTTP status codes into `ErrorKind` enum values (`'network'`, `'disabled'`, `'client'`, `'server'`) and drives the polling loop; incorrect classification would surface as wrong UI error states. `useDashboardData.ts` was identified in Run #4 as containing performance-critical transformation logic that is now also known to be untested.

- OBSERVATION: `services/AirQualityService.ts`, `services/WeatherService.ts`, `services/dataService.ts`, `services/aiService.ts` — the entire service layer has **zero test coverage**. `AirQualityService` implements a singleton with a 4-second TTL cache (`CACHE_TTL_MS = 4000`) that deduplicates `fetch` calls; the cache-miss vs. cache-hit branching is untested. `dataService.ts` defines all the TypeScript interfaces consumed by hooks and components but its fetch paths are never exercised in tests.

- OBSERVATION: `App.test.tsx` — the only top-level test file contains **three smoke assertions** (container `.flex.h-screen` exists, `<main>` exists, `<main>` has the expected CSS classes). There are no tests for view routing, sidebar navigation, error boundary activation, or any feature flag. The file satisfies "we have App tests" but provides effectively no regression safety.

**Proposed actions:**
- Add `coverage.thresholds` block to `vite.config.ts` `test` section (e.g. `lines: 60, branches: 50`) → Active Recommendation #9
- Add pure-function unit tests for `utils/interpolation.ts`, `utils/weatherUtils.ts`, `utils/colorScales.ts` → Active Recommendation #10
- Add `pytest`, `httpx[test]`, and `pytest-asyncio` to `requirements.txt`; create `geointellisense-analytics/tests/` with smoke tests for `/health`, `/api/chat`, and middleware — not in top 10 (H/H, score 1.0)
- Add `#[cfg(test)]` modules to `geointellisense-ingestion/src/aqi.rs` and `persist.rs`; add `tokio-test` to `[dev-dependencies]` — not in top 10 (M/M, score 1.0)
- Add `renderHook` tests for `useRealtimeAQI` reconnection and mock fallback — not in top 10 (M/M, score 1.0)
- Add `renderHook` tests for `useLiveData` error-kind classification — not in top 10 (M/M, score 1.0)

## 📚 Archive (one line per past run)
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
