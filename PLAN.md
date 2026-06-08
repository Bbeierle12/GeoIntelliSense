# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-08T23:05:00Z
Last run: #218 — Lens: Data pipeline integrity

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
### Run #218 — 2026-06-08 — Lens: Data pipeline integrity
**Scope:** Fifteenth data-pipeline-integrity pass. Full reads of: `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/purpleair.rs`, `geointellisense-ingestion/src/usgs.rs`, `geointellisense-ingestion/src/db/persist.rs`, `geointellisense-analytics/app/http_client.py`, `geointellisense-analytics/app/clients/airnow.py`, `geointellisense-analytics/app/clients/epa_aqs.py`, `geointellisense-analytics/app/clients/nasa_firms.py`, `geointellisense-analytics/app/clients/usgs_water.py`, `geointellisense-analytics/app/routes/airnow.py`, `geointellisense-analytics/app/routes/epa_aqi.py`, `geointellisense-analytics/app/routes/fires.py`, `geointellisense-analytics/app/routes/water.py`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/source_toggles.py`. Cross-checked against Active Recommendations and archived data-pipeline runs #8, 23, 38, 53, 68, 83, 98, 113, 128, 143, 158, 173, 188, 203 to confirm findings are new.

**Findings:**

- OBSERVATION: `clients/airnow.py:48,64,79` — The most recent commit on `main` refactored NASA FIRMS (`nasa_firms.py:17`: `from app.http_client import fetch as http_fetch`) and USGS Water (`usgs_water.py:13`: same import) to use the shared `http_client.py`, whose module docstring at line 5 states: "All outbound API calls should use this instead of raw httpx." However, `AirNowClient` was NOT updated: it creates `self._http = httpx.AsyncClient(timeout=15.0)` at line 48 and calls it directly at `get_current_observations:64` (`resp = await self._http.get(url, params=params)`) and `get_forecast:79`. The shared `http_client.fetch()` retries up to 3 times on 429 (with `Retry-After` support) and on 5xx with exponential backoff; the AirNow client has neither. AirNow documents a 500 req/hour rate limit; fetching all 6 SJV cities sequentially in `get_all_sjv_current` issues 6 requests per invocation. A momentary 429 on any city during high-request periods is not retried: the city is silently dropped from the current snapshot (the exception is caught at line 99 and the city is skipped). PROPOSAL: Replace `self._http.get(url, params=params)` at lines 64 and 79 with `from app.http_client import fetch as http_fetch; resp = await http_fetch(url, params=params)`, and remove the `httpx.AsyncClient` instance from `__init__` and `close()` (~10 lines changed; aligns with the existing NASA FIRMS / USGS Water refactor pattern and adds 429/5xx retry for all AirNow city fetches).

- OBSERVATION: `clients/epa_aqs.py:64,83-86` — Same shared-http_client bypass: `EpaAqsClient.__init__` creates `self._http = httpx.AsyncClient(timeout=60.0)` at line 64. The `_throttled_get` method at line 70 implements rate-limit throttling but no retry: `resp.raise_for_status()` at line 86 immediately propagates any 5xx as an exception. The EPA AQS API is documented to return 503 during its daily data-processing windows (typically 6–7am EST). Without retry, any 503 during that window causes the entire backfill request for a county+parameter+year tuple to be recorded as an error in `_backfill_status["errors"]` (`epa_aqi.py:138`). Over a full 6-county × 3-parameter × N-year backfill, a single maintenance window can silently skip dozens of county-parameter-year combinations without ever retrying. PROPOSAL: Migrate `_throttled_get` to use the shared http_client `fetch()` function; the rate-limiting throttle (`asyncio.sleep`) can be retained before calling `http_fetch` — L/L effort (~8 lines; adds 3-attempt backoff for EPA AQS 503s while preserving the 6s inter-request pause).

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:68-73` — Inside `spawn_ticker`'s PurpleAir polling loop, lines 69–73 gate every PurpleAir API call behind Redis availability: if `*guard` is `None` (Redis connection is `None`, meaning `connect()` in `redis_cache.rs` returned `None` or Redis went down), the code executes `continue` with only a `tracing::debug!` message and skips the fetch. The comment reads "If Redis is down, skip fetch (fail-safe: don't burn API points)." This reasoning is wrong: the PurpleAir API rate limit is enforced by the API key, not by Redis. The actual consequence: any Redis restart (container restart, OOM kill, network partition) silently and indefinitely halts ALL PurpleAir fetches. The live cache (`cache_w`) is never refreshed during the Redis outage. The broadcast loop at `broadcast.rs:102-113` then reads the stale cache or falls back to `aqi::generate_readings()` (mock random numbers), which are persisted to `sensor_readings` as real rows. There is no WARN/ERROR log, no metric increment, and no UI indicator that live data has been replaced by mock data. PROPOSAL: Remove the Redis availability gate for PurpleAir API calls (the gate should only apply to toggle-checking, not to actual API calls); move the `is_source_enabled` check to a separate non-blocking Redis read that defaults to `true` if Redis is unavailable (fail-open for API calls, fail-closed only for disabling) — L/L effort (~5 lines; eliminates silent mock-data fallback during Redis downtime and matches how Python `source_toggles.py:54-55` handles Redis failures: `return False` which is fail-closed for calls, but the Rust gate is fail-closed in the wrong direction by blocking the API call entirely).

- OBSERVATION: `clients/airnow.py:171` — `_normalize_observations` constructs the observation timestamp as: `timestamp = first.get("DateObserved", "").strip() + "T" + first.get("HourObserved", "12").zfill(2) + ":00:00"`. The AirNow API returns `HourObserved` as a JSON integer (e.g., `14`, not `"14"`). Python's `str.zfill` method does not exist on `int`; calling `.zfill(2)` on `14` raises `AttributeError: 'int' object has no attribute 'zfill'`. This exception propagates out of `_normalize_observations` into `get_all_sjv_current():99` where it is caught per-city by `except Exception as e: logger.warning("AirNow fetch failed for %s: %s", ...)`. Because the exception occurs inside `_normalize_observations` (called at line 95), every call to `get_current_observations` for every SJV city raises `AttributeError` and is silently dropped. The result: `/api/airnow/current` always returns `{"count": 0, "readings": []}` when using a live API key — the AirNow source appears to be "working" (no error returned to the client) but produces no data. The fix is `str(first.get("HourObserved", "12")).zfill(2)` — L/L effort (1-character change at line 171; unblocks all AirNow current observations from returning real EPA monitor data).

**Proposed actions:**
- Migrate `AirNowClient` at `clients/airnow.py:48,64,79` to use shared `http_client.fetch()`; remove raw `httpx.AsyncClient` — L/L effort (~10 lines; aligns with existing FIRMS/USGS Water refactor, adds 429/5xx retry for all 6 SJV city fetches)
- Migrate `EpaAqsClient._throttled_get` at `clients/epa_aqs.py:83-86` to use shared `http_client.fetch()`; retain 6s throttle — L/L effort (~8 lines; adds 3-attempt retry for EPA AQS 503s during maintenance windows)
- Remove Redis availability gate for PurpleAir API calls in `broadcast.rs:68-73`; make Redis failure fail-open for toggle checks — L/L effort (~5 lines; prevents silent mock-data substitution during Redis downtime)
- Fix `AttributeError` in `clients/airnow.py:171`: change `.zfill(2)` to `str(...).zfill(2)` — L/L effort (1 character; unblocks AirNow current-observation endpoint from returning empty results)

### Run #217 — 2026-06-08 — Lens: UX / UI flaws
**Scope:** Fifteenth UX/UI flaws pass. Full reads of: `index.html`, `styles/theme-light.css`, `App.tsx`, `components/Header.tsx`, `components/Sidebar.tsx`, `components/ChatView.tsx`, `components/AnalysisView.tsx`, `components/CalendarView.tsx`, `components/SettingsView.tsx`, `components/LoadingStates.tsx`, `components/AccessibleChartWrapper.tsx`, `components/dashboard/widgets/AqiGaugeWidget.tsx`. Cross-checked against Active Recommendations and archived UX runs #7, 22, 37, 52, 67, 82, 97, 112, 127, 142, 157, 172, 187, 202 to confirm findings are new.

**Findings:**

- OBSERVATION: `Sidebar.tsx:97` and `SettingsView.tsx:80,328` — The Tailwind utility class `border-border-color` is used as a row/item separator in both files. The Tailwind config in `index.html:16-28` extends Tailwind with five brand custom color names (`brand-primary`, `brand-secondary`, `brand-bg-dark`, `brand-bg-light`, `brand-bg-lighter`). The CSS custom property `--border-color` is defined only inside `.light` and `.high-contrast` class scopes in `theme-light.css:19` and `theme-light.css:114` — it is never defined for dark mode (the default). As a result, `border-border-color` silently generates no border in dark mode: the Tailwind CDN JIT engine does not recognize `border-color` as a configured color token, so no border-color CSS is emitted. The separator line between the main nav items and the Settings link (`Sidebar.tsx:97`) is therefore invisible in dark mode; the `border-b` bottom borders on every `SettingRow` in `SettingsView.tsx:80` and every data-source row at `SettingsView.tsx:328` are similarly absent. Additionally, `SettingsView.tsx` uses `text-text-primary` (lines 52, 84, 161), `text-text-muted` (lines 89, 196, 342), and `text-text-secondary` (line 196) throughout — CSS variables defined only in `.light` scope — so in dark mode all Settings section headings and row labels fall back to the inherited `body` color (`text-slate-200`) rather than the intended semantic dark-mode contrast values. PROPOSAL: Add `'text-text-primary': 'var(--text-primary, #f1f5f9)'`, `'text-text-secondary': 'var(--text-secondary, #94a3b8)'`, `'text-text-muted': 'var(--text-muted, #64748b)'`, and `'border-color': 'var(--border-color, #334155)'` to the Tailwind color extensions in `index.html:19-25`; add matching CSS variable defaults for dark mode in `theme-light.css` — L/L effort (~10 lines; fixes invisible row separators in Sidebar and all SettingsView rows in dark mode, and restores intended semantic text colors).

- OBSERVATION: `components/CalendarView.tsx` — This 581-line component (featuring a monthly calendar grid, list view for 1-day through 1-year ranges, per-day detail panel with five hourly Recharts graphs, moon phase, and evapotranspiration) is imported nowhere in the application. A repo-wide search finds `CalendarView` referenced only in its own file (`components/CalendarView.tsx`) and the co-located `components/icons/CalendarIcon.tsx` (which is also unused). `App.tsx` has no `/calendar` route; `Dashboard.tsx` does not import it; `Sidebar.tsx`'s `navItems` array does not include it. Additionally, `CalendarView.tsx:21` hardcodes the initial display month as `useState(new Date('2025-11-13'))` — November 2025, which is 7 months before the current date of June 2026. If the component were wired up today, every user would land on a 7-month-stale month and must click "Next →" repeatedly to reach the current date. PROPOSAL: (a) Wire a `/calendar` route in `App.tsx` (~4 lines) and add a Calendar nav entry to `Sidebar.tsx`'s `navItems` array (~6 lines), making the feature reachable; or delete the file entirely if the feature is intentionally shelved — M/L effort; (b) regardless, replace the hardcoded `new Date('2025-11-13')` at `CalendarView.tsx:21` with `new Date()` so the calendar opens on the current month — L/L effort (1 character change; prevents stale initial state).

- OBSERVATION: `AnalysisView.tsx:420-426` — The `<textarea>` rendered for non-forecast analysis tools (Quick Insight, Web Search, Local Info, Deep Dive) has no `id`, no wrapping `<label>` element, and no `aria-label` or `aria-labelledby` attribute. A screen reader user navigating to this field via Tab hears only "text area, editable" with no indication of its purpose. The `placeholder` value (`currentTool.placeholder`, e.g. "e.g., Define atmospheric river.") is not an accessible substitute: WCAG 2.1 Success Criterion 1.3.1 (Info and Relationships, Level A) and 2.4.6 (Headings and Labels, Level AA) both require programmatically determinable labels; placeholder text disappears when text is entered and is inconsistently announced by assistive technology. By contrast, the forecast tool inputs (location select at line 319, start-date at line 336, end-date at line 350, custom-factors textarea at line 406) are all properly labeled with `<label htmlFor="…">` elements. The four non-forecast tool paths are the only unlabeled controls in the component. PROPOSAL: Add `id="analysis-prompt"` to the textarea at line 420 and insert `<label htmlFor="analysis-prompt" className="block text-sm font-medium text-slate-400 mb-2">{currentTool.name} Prompt:</label>` directly above it — L/L effort (~2 lines; resolves a WCAG 2.1 Level A violation for 4 of the 6 analysis tools).

- OBSERVATION: `ChatView.tsx:84` — The chat input uses `onKeyPress={(e) => e.key === 'Enter' && handleSend()}`. `onKeyPress` was deprecated in the DOM specification and flagged as deprecated in React 17; in React 19.2.0 (the version used per `index.html:37`), it produces a browser console warning on each keystroke. More critically, `onKeyPress` does not fire during CJK (Chinese/Japanese/Korean) IME composition sessions: a user composing Japanese or Chinese characters who presses Enter to confirm a character candidate (advancing the composition) will unintentionally submit the partially-composed chat message rather than completing the character. The standard replacement `onKeyDown` fires before composition is finalized but can be guarded with `event.isComposing` to prevent mid-composition submission. PROPOSAL: Replace `onKeyPress` with `onKeyDown` at `ChatView.tsx:84` and add an `e.isComposing` guard: `onKeyDown={(e) => !e.isComposing && e.key === 'Enter' && handleSend()}` — L/L effort (1 line change; removes deprecation warning, fixes Enter-key behavior during IME composition for CJK users).

**Proposed actions:**
- Add `border-color`, `text-text-primary`, `text-text-secondary`, `text-text-muted` entries to Tailwind color config in `index.html:19-25`; add dark-mode CSS variable defaults in `theme-light.css` — L/L effort (~10 lines; fixes invisible SettingsView row separators and Sidebar separator in dark mode)
- Wire `/calendar` route in `App.tsx` and nav entry in `Sidebar.tsx`, OR delete `CalendarView.tsx`; fix hardcoded `new Date('2025-11-13')` to `new Date()` at `CalendarView.tsx:21` — M/L or L/L effort
- Add `<label htmlFor="analysis-prompt">` and `id="analysis-prompt"` to the prompt textarea in `AnalysisView.tsx:420` — L/L effort (~2 lines; WCAG 2.1 Level A fix for 4 analysis tools)
- Replace deprecated `onKeyPress` with `onKeyDown` + `!e.isComposing` guard at `ChatView.tsx:84` — L/L effort (1 line; fixes IME composition handling for CJK users)

### Run #216 — 2026-06-08 — Lens: TS ↔ Python contract
**Scope:** Sixteenth TS ↔ Python contract pass. Files read in full: `types.ts`, `services/aiService.ts`, `services/dataService.ts`, `components/AnalysisView.tsx` (lines 1–260), `hooks/useLiveData.ts`, `hooks/useNormalizedData.ts`, `data/dashboardData.ts` (lines 1–80), `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/historical_aqi.py`, `geointellisense-analytics/app/routes/historical_weather.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/routes/weather_forecast.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/grounded_maps.py`, `geointellisense-analytics/app/routes/nws_forecast.py`, `geointellisense-analytics/app/routes/predict.py`, `geointellisense-analytics/app/routes/ai_context.py`, `geointellisense-analytics/app/routes/explore.py`, `geointellisense-analytics/app/routes/weather_historical.py`, `geointellisense-analytics/app/ml/aqi_model.py:285–311`. Cross-checked against Active Recommendations and archived TS↔Python contract runs #6, 21, 36, 51, 66, 81, 96, 111, 126, 141, 156, 171, 186, 201 to confirm findings are new.

**Findings:**

- OBSERVATION: `historical_weather.py:98` — `"totalPrecipitation": 0.0` is hardcoded as a placeholder comment reads `# sensor_readings doesn't have precip; placeholder`. The TypeScript `HistoricalWeatherRecord` interface at `dataService.ts:68` declares `totalPrecipitation: number` (non-optional), and the TS mock fallback at `dataService.ts:383` returns `monthData.precipitation` from `dashboardData` (non-zero values, e.g. Bakersfield January: 3.9 in). This means: (1) any Dashboard chart that graphs `totalPrecipitation` over time will display flat zero from the live backend and non-zero from the fallback — the difference is invisible in the UI and a developer cannot distinguish "no rain" from "precipitation data unavailable"; (2) `Dashboard.tsx:277–303` includes `mergedHistoricalWeather` and `mergedAgriculturalData` memos that process `totalPrecipitation` — users in the San Joaquin Valley will see zero precipitation for all historical months even during the January–March rainy season, directly undermining the app's environmental accuracy claims. PROPOSAL: (a) Either add a `precipitation` column to `sensor_readings` (or join `weather_observations.PRCP` in `historical_weather.py`) and remove the placeholder — M/H effort (~20 SQL migration + Python join); (b) or return `null` / omit the field and reflect that in the TypeScript type as `totalPrecipitation?: number | null`, so charts can render "no data" rather than "zero rain" — L/L effort (~5 lines on each side; correct representation of missing data).

- OBSERVATION: `geointellisense-analytics/app/ml/aqi_model.py:310` — `predict_aqi()` returns a `"currentFeatures"` key in the `/api/predict/aqi` response, containing a dict of all 13 model features (aqi, pm25, temperature, humidity, wind_speed, wind_direction_sin, wind_direction_cos, fire_count_200km, fire_total_frp, inversion_strength, day_of_week, month, hour) mapped to their current numeric values. The TypeScript `PredictionResult` interface at `useLiveData.ts:131–141` does NOT include a `currentFeatures` field: the interface has only `predictedAqi`, `confidenceInterval`, `category`, `horizon`, `modelR2`, `modelMAE`, `trainedAt`, `topFactors`, and optional `airnowComparison`. As a result, `currentFeatures` is silently discarded after `useLiveData` fetches `/api/predict/aqi` — any component using `data?.currentFeatures` will get `undefined` at runtime (TypeScript will also flag this as a type error for strictly-typed access). The feature values are particularly useful for displaying "which current conditions are driving today's 24h forecast" alongside the `topFactors` list. PROPOSAL: Add `currentFeatures?: Record<string, number>` to `PredictionResult` in `useLiveData.ts:141` — L/L effort (1 line; surfaces already-returned data to the UI without any backend change).

- OBSERVATION: `geointellisense-analytics/app/routes/predict.py:133–138` — the `/api/predict/factors` GET endpoint returns `{modelR2, modelMAE, trainedAt, trainingSamples, factors: [{feature, importance, pctContribution, description}]}` (note: `factors` array with four fields each). No TypeScript type or hook wraps this endpoint in `useLiveData.ts` or any other TS file. The closest related type, `PredictionResult` at `useLiveData.ts:131–141`, has `topFactors: Array<{feature: string; importance: number}>` (two fields, different key name). If a developer calls `/api/predict/factors` by reusing `PredictionResult`, two contract violations occur: (1) the top-level key is `factors` not `topFactors` — `data.topFactors` would be `undefined`; (2) each entry has `pctContribution: number` and `description: string` that are not in the `topFactors` element type. No runtime error would surface (TypeScript structural types allow extra fields), but `pctContribution` — the percentage of the prediction variance attributed to each feature — would be inaccessible to any consumer that typed against `PredictionResult`. PROPOSAL: Add `FactorsResult` interface to `useLiveData.ts` for `/api/predict/factors` responses, with `factors: Array<{feature: string; importance: number; pctContribution: number; description: string}>` — L/L effort (~12 lines; avoids silent schema mismatch if `/api/predict/factors` is consumed in the future dashboard).

- OBSERVATION: `types.ts:14–30` — the `GroundingChunk` interface exposes a `maps.placeAnswerSources.reviewSnippets` nested structure (with `uri`, `text`, and `author` fields on each snippet) that mirrors the Gemini 1.5 Pro grounding API response format. Both Python grounding routes unconditionally return `"groundingChunks": []`: `grounded_search.py:79` and `grounded_maps.py:86`. This means: (1) `AnalysisView.tsx:85` maintains `const [groundingChunks, setGroundingChunks] = useState<GroundingChunk[]>([])` and `setGroundingChunks(searchRes.groundingChunks)` at line 177, but the array is permanently empty — the TypeScript UI code for rendering citations (if any) is dead at runtime; (2) the `maps.placeAnswerSources.reviewSnippets.author` path is a Gemini-specific field (Gemini Maps grounding returns review snippets with authors); Claude's tool-use results do not map to this shape. The Python backend migrated from Gemini to Claude (both endpoints now use `claude-sonnet-4-20250514`) but the TypeScript contract was never updated to reflect that no grounding metadata is returned. PROPOSAL: (a) Short-term: remove the `maps.placeAnswerSources` nesting from `GroundingChunk` or replace the whole interface with a minimal `{text: string; uri?: string}[]` reflecting what the Python could realistically populate from tool results — L/L effort (~8 lines in `types.ts`); (b) long-term: populate `groundingChunks` from `tool_result` content returned by Claude's web-search tool calls in `grounded_search.py` — M/M effort (~20 lines extracting URLs from tool responses).

**Proposed actions:**
- Fix `historical_weather.py:98`: join `weather_observations.PRCP` or return `null` for `totalPrecipitation`; update TS type if null — H/L impact, L/L (schema change) or M/H (SQL join) effort (Active Recommendation #10)
- Add `currentFeatures?: Record<string, number>` to `PredictionResult` in `useLiveData.ts:141` — M/L effort (1 line; surfaces model explainability data already returned by `/api/predict/aqi`)
- Add `FactorsResult` interface in `useLiveData.ts` for `/api/predict/factors` response shape — M/L effort (~12 lines; prevents shape mismatch if endpoint is consumed)
- Remove Gemini-era `maps.placeAnswerSources.reviewSnippets` nesting from `GroundingChunk` in `types.ts:14–30`; align with Claude's tool-use output — M/L effort (~8 lines; cleans dead Gemini-era schema)

## 📚 Archive (one line per past run)
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
