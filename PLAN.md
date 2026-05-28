# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T21:10:00Z
Last run: #17 — Lens: Module boundaries

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
### Run #17 — 2026-05-28 — Lens: Module boundaries
**Scope:** All `.ts` and `.tsx` files in `components/`, `hooks/`, `services/`, `data/`, `utils/`, `contexts/`, and root on `origin/main`; full import graph traversal; `geointellisense-analytics/app/` Python route imports; `geointellisense-ingestion/src/` Rust module declarations. Checked for circular deps (A→B→A chains), leaky abstractions, layer violations, and type co-location issues.

**Findings:**

- OBSERVATION: `data/dashboardData.ts:1` carries the comment "This file centralizes the mock data for the dashboard" and `services/dataService.ts:3` annotates it "Keep for fallback," using it only inside catch blocks at lines ~116 and ~162. Despite this intended internal-only status, the module is imported directly by `components/Dashboard.tsx:12`, `components/AirQualityMapView.tsx:1`, `components/AnalysisView.tsx:27`, `contexts/UserPreferencesContext.tsx:2`, and `hooks/useDashboardData.ts:2` — five non-service consumers. The exported `LocationKey` type (line ~1151, `export type LocationKey = keyof typeof dashboardData`) has become a de-facto public API used across context and component props, coupling the entire component layer to a module whose primary content is static mock data. This is the structural root cause of the live-vs-mock data confusion found in Run #15: components can render mock data directly without passing through `dataService`'s fallback guard.

- OBSERVATION: `components/AnalysisView.tsx:12-17` imports six raw functions from `services/aiService` — `getGroundedSearchResponse`, `getGroundedMapsResponse`, `getLowLatencyResponse`, `getDeepAnalysisResponse`, `getPredictiveAnalysisResponse`, `getWeatherForecastResponse` — with no intermediate hook. State is set directly from service responses at lines 91 (`setResult(...)`) and 136 (`setGroundingChunks(...)`), and error/loading management is implemented inline within the component. `components/ChatView.tsx:2` and `components/DataExplorer.tsx:3` also import from `services/aiService` directly. This means three separate components independently re-implement error handling, loading state, and response parsing for semantically identical "call AI service" operations, with no shared abstraction point where a retry policy, timeout, or cancellation token could be applied consistently.

- OBSERVATION: Root `types.ts` co-locates four unrelated type families: `ViewType` (a page-routing union used in `App.tsx`), `AnalysisTool` (an analysis-feature-only enum used solely in `components/AnalysisView.tsx`), `GroundingChunk` (an AI service response shape consumed by `services/aiService.ts` and `components/AnalysisView.tsx`), and `ChatMessage` (a chat-session shape consumed by `services/aiService.ts` and `components/ChatView.tsx`). The placement of `GroundingChunk` and `ChatMessage` in the global root type file means `services/aiService.ts` must import from the root rather than owning its own response types, inverting the natural dependency direction (feature module → root instead of root → feature module).

- OBSERVATION: `components/MapView.tsx` calls `fetch()` directly at approximately lines 101–106 to retrieve `/api/maps-config`, while every other data operation in the same file is abstracted through `useLiveData`, `useAqiSnapshot`, and `useViewport` hooks. There is no `useMapConfig` hook and no service function for this endpoint. This is the same endpoint flagged in Active Recommendations row #6 (Google Maps API key returned to unauthenticated callers): because the call is an inline `fetch` with no wrapper, there is no single interception point to add an Authorization header, cache the response, or suppress the call for unauthenticated users.

- OBSERVATION: **No circular dependencies (A→B→A chains) were found in any layer.** TypeScript: the import graph is strictly acyclic — the only service-to-service import is `services/dataService.ts` importing `AirQualityService` and `WeatherService` (a documented one-directional facade). Python: the 25+ route modules in `geointellisense-analytics/app/routes/` share `app.claude`, `app.cache`, and `app.database` infrastructure but do not import each other. Rust: module dependencies follow a clean unidirectional chain (`main → broadcast → {aqi, usgs, db, redis_cache}`) with no back-edges.

**Proposed actions:**
- Extract `LocationKey` type and `locations` array from `data/dashboardData.ts` (line ~1151) into `types/locations.ts`; update the 4 direct component/context import sites; restrict `data/dashboardData.ts` imports to `services/dataService.ts` only — M/L, score 2.0; does not enter top 10 (all existing rows H/L = 3.0)
- Create `hooks/useAnalysis.ts` wrapping the 6 `aiService` function calls with unified error/loading/cancellation state; update `components/AnalysisView.tsx:12-17` and `components/DataExplorer.tsx:3` to use the hook — M/M, score 1.0; does not enter top 10
- Create `hooks/useChat.ts` wrapping `getChatResponse`; update `components/ChatView.tsx:2` — M/L, score 2.0; does not enter top 10
- Create `hooks/useMapConfig.ts` wrapping the direct `fetch('/api/maps-config')` in `MapView.tsx:101`; this also provides the single interception point needed to fix Active Recommendations row #6 (add auth check before returning key) — M/L, score 2.0; does not enter top 10
- Split `types.ts` into `types/ui.ts` (`ViewType`, `TemperatureUnit`), `types/analysis.ts` (`AnalysisTool`, `GroundingChunk`), `types/chat.ts` (`ChatMessage`); update all import sites — M/M, score 1.0; does not enter top 10
- No circular dependency remediation needed: none found

### Run #16 — 2026-05-28 — Lens: Type safety
**Scope:** All 23 `.ts` and 41 `.tsx` files on `origin/main`; `tsconfig.json`; searched for `: any`, `as any`, `<any>`, `Record<string, any>`, implicit parameter annotations, `@ts-ignore`, and `@ts-nocheck` directives.

**Findings:**

- OBSERVATION: `tsconfig.json` — The compiler options object contains no `"strict": true` flag and no individual `"noImplicitAny"`, `"strictNullChecks"`, `"strictFunctionTypes"`, `"strictBindCallApply"`, or `"strictPropertyInitialization"` flags. All five strict-mode checks therefore default to `false`. TypeScript silently infers `any` for parameters with no type annotation, permits `null`/`undefined` to flow into any variable, and skips function signature compatibility checking. Every explicit `any` annotation found in the files below is a symptom of this root-cause gap; enabling `strict` would cause the compiler to surface all of them as errors.

- OBSERVATION: `data/dashboardData.ts:195-336` — `generateDailyForecast()` builds and returns an array of objects with ~25 typed fields (nested `temp`, `wind`, `precipitation`, `hourlyData` sub-objects) but its return type is inferred and never named. No `DailyForecast` interface or type alias is exported from this module. Because the return type is opaque to consumers, every call site that iterates the array must annotate loop variables as `day: any` to access fields without a TypeScript error (confirmed: 4 separate `forEach((day: any) => {...})` calls in `hooks/useDashboardData.ts`). Adding `export interface DailyForecast { date: string; dayOfWeek: string; temp: { current: number; min: number; max: number; feelsLike: number }; humidity: number; ... }` and annotating `generateDailyForecast(): DailyForecast[]` would fix all downstream `day: any` annotations in one change.

- OBSERVATION: `hooks/useDashboardData.ts:179,197,199,223,241,243,267,285,287,311,330,332` — Twelve explicit `any` annotations in five `useMemo` blocks (`mergedHumidityData`, `mergedWindData`, `mergedUVData`, `mergedAgriculturalData`, and an intermediate `mergedForecastData` Map). Four are `(day: any)` parameter annotations that cascade from the missing `DailyForecast` type in `dashboardData.ts` (see above). Eight are `result: any[]` / `entry: any` intermediate accumulators that collect `{ month: string; [location: string]: number }` objects — a shape that could be expressed as `type MonthlySeriesPoint = { month: string } & Record<string, number>`. The `Map<string, Record<string, any>>` at line ~68 likewise loses value types.

- OBSERVATION: `components/charts/AQITrendChart.tsx:15`, `components/charts/PM25TrendChart.tsx:15`, `components/charts/TemperaturePrecipitationChart.tsx:15`, `components/charts/WeatherForecastChart.tsx:14` — All four chart components declare `data: any[]` in their props interface. The actual data produced by the five corresponding `useMemo` blocks in `useDashboardData.ts` always has `{ month: string } & Record<string, number>` (AQI/PM25/temperature) or `{ day: string } & Record<string, number>` (forecast) shapes. Replacing `any[]` with `Array<{ month: string } & Record<string, number>>` (or a shared `ChartDataPoint` type alias) would let TypeScript verify that callers pass correctly-shaped data.

- OBSERVATION: `components/AccessibleChart.tsx:66,79,165` — The `DataTableColumn.format` callback is typed `(value: any) => string` (line 66). The `AccessibleChartProps.data` field is `Record<string, any>[]` (line 79). The internal `DataTable` component's `data` prop repeats `Record<string, any>[]` at line 165. Because `AccessibleChart` is the project's accessibility wrapper used by every chart, these `any` types flow through all chart data in the accessible table path. The fix — making `AccessibleChart` generic: `AccessibleChart<T extends Record<string, unknown>>` with `data: T[]` and `format?: (value: T[keyof T]) => string` — would propagate type safety from each chart's data type without requiring per-usage annotation.

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `const controlsRef = useRef<any>(null)` is the only `useRef<any>` in the entire codebase. `@react-three/drei` exports `OrbitControls` whose imperative handle type is `OrbitControlsImpl` from `three-stdlib`. The ref is accessed via `controlsRef.current.getTarget(target)` at line 70 — if the library renames or removes `getTarget`, TypeScript gives no warning. The fix is `useRef<OrbitControlsImpl | null>(null)` with `import type { OrbitControlsImpl } from 'three-stdlib'`.

- OBSERVATION: `components/AnalysisView.tsx:255` — `catch (e: any)` then `e.message`. `catch (e: any)` is technically legal without `useUnknownInCatchVariables` (part of `strict`), but it bypasses type narrowing. The `utils/errorHandling.ts` module (used elsewhere in the project) already provides `toDataServiceError(error: unknown)` which performs safe narrowing. The consistent pattern would be `catch (e: unknown) { setError(toDataServiceError(e).getUserMessage()); }`.

- OBSERVATION: `components/DataExplorer.tsx:42` — `ExploreResponse.data: Array<Record<string, any>>`. The `/api/analysis/explore` endpoint returns TimescaleDB time-bucketed rows where columns are the selected source keys (`aqi`, `temperature`, `fires`, etc.) plus a `time` string. The `chartData` memo at line ~80 then does `d.time` (implicitly typed `any`), losing all type checking. The type could be narrowed to `Array<{ time: string } & Record<string, number | null>>` which still allows dynamic source columns while narrowing `time` and value types.

**Proposed actions:**
- Add `"strict": true` to `tsconfig.json` `compilerOptions`; then progressively fix resulting errors (the most impactful being the `any` annotations below) — H/M, score 1.5; not in top 10
- Export `DailyForecast` interface from `data/dashboardData.ts` and annotate `generateDailyForecast(): DailyForecast[]`; remove all `(day: any)` annotations in `useDashboardData.ts` — M/L, score 2.0; not in top 10 (newer than existing 3.0 items)
- Replace `result: any[]` and `entry: any` accumulators in `useDashboardData.ts` with `type MonthlySeriesPoint = { month: string } & Record<string, number>` — M/L, score 2.0; not in top 10
- Replace `data: any[]` props in the four chart components with a shared `ChartDataPoint` type alias — M/L, score 2.0; not in top 10
- Make `AccessibleChart` generic (`AccessibleChart<T extends Record<string, unknown>>`) to propagate data types through the accessible table path — M/M, score 1.0; not in top 10
- Replace `useRef<any>(null)` in `AQI3DScene.tsx:57` with `useRef<OrbitControlsImpl | null>(null)` — L/L, score 1.0; not in top 10
- Replace `catch (e: any)` in `AnalysisView.tsx:255` with `catch (e: unknown)` + `toDataServiceError(e).getUserMessage()` — L/L, score 1.0; not in top 10
- Narrow `ExploreResponse.data` in `DataExplorer.tsx:42` to `Array<{ time: string } & Record<string, number | null>>` — M/L, score 2.0; not in top 10

### Run #15 — 2026-05-28 — Lens: Live-time claim audit
**Scope:** `components/dashboard/LiveDashboard.tsx`, `components/Dashboard.tsx`, `components/AirQualityMapView.tsx`, `hooks/useRealtimeAQI.ts`, `hooks/useLiveData.ts`, `hooks/useDashboardData.ts`, `data/dashboardData.ts`, `services/dataService.ts`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/config.rs`, `docker-compose.yml`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/claude.py`

**Findings:**

- OBSERVATION: `components/Dashboard.tsx:367` — The "Regional Air Quality Index" panel carries the subtitle "Real-time AQI and PM2.5 levels across major cities." The data rendered by this panel comes from `dataService.getCurrentAQI()` (`services/dataService.ts:104`), which on any network or backend failure immediately falls back to hardcoded values in `data/dashboardData.ts` (`dataService.ts:128-136`). `dashboardData.ts:1` is explicitly labeled "This file centralizes the mock data for the dashboard." The fallback values — e.g., Bakersfield AQI 155, Fresno AQI 140 — are compile-time constants. No visual indicator distinguishes the live-fetch path from the mock-fallback path, so users reading "Real-time AQI" may be looking at values that are months old.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:83-90` + `config.rs:19-22` + `docker-compose.yml` — The broadcast ticker loop overwrites every reading's `timestamp` field with `chrono::Utc::now()` before each broadcast: `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() })`. The PurpleAir fetch interval defaults to 600 seconds (`config.rs:20`: `unwrap_or(600)`; confirmed by `docker-compose.yml`: `PURPLEAIR_INTERVAL_SECS: ${PURPLEAIR_INTERVAL_SECS:-600}`). Consequently every SSE event arriving at the browser carries a `timestamp` at most a few milliseconds old, while the `aqi`, `pm25`, and other sensor fields inside it may be up to 10 minutes stale. `AirQualityMapView.tsx:413` displays `{isConnected ? '🔴 Live' : 'Last Updated'}` — when connected, the "🔴 Live" badge is shown regardless of sensor age. The comment at `AirQualityMapView.tsx:4` ("With real-time data streaming via SSE") and the tooltip at `:177` ("Real-time data from EPA monitoring station") similarly overstate data freshness.

- OBSERVATION: `geointellisense-analytics/app/context.py:20` — `SOURCE_INTERVALS["purpleair"] = 120` declares the expected PurpleAir update cadence as 2 minutes. The staleness guard at `context.py:37` marks data stale when `age_seconds > interval * 2` (threshold: 240 seconds). Under the default deployment the actual poll interval is 600 seconds (`PURPLEAIR_INTERVAL_SECS=600`). At any random moment between polls, PurpleAir data in the DB is between 0 and 600 seconds old; any reading older than 240 seconds — the majority at any given moment in steady state — is classified as `"stale"` and triggers the Claude system prompt warning "STALE data sources (may be outdated): purpleair." This means that in a default deployment, virtually every AI chat request injects a staleness caveat for PurpleAir data even when the data is as fresh as the intended 10-minute interval allows, unnecessarily degrading Claude's confidence and response quality. The fix is one character: change `context.py:20` to `"purpleair": 600`.

- OBSERVATION: `hooks/useDashboardData.ts` — This hook, which drives all historical trend charts on the Dashboard page (humidity, wind, UV index, historical AQI, agricultural metrics), contains zero API calls. It imports `dashboardData` from `data/dashboardData.ts` and performs only in-memory aggregations. All data presented is from the pre-baked 12-month range "Jul '23" through "Jun '24" embedded in the source file. There is no UI indicator — no "Last updated" timestamp, no "(historical mock data)" label — to distinguish these static trend charts from genuinely live or fetched data.

- OBSERVATION: `hooks/useRealtimeAQI.ts` (lines ~180-210) — After `maxReconnectAttempts` (default 10) consecutive SSE failures, `startMockData()` is called, which generates AQI values using `Math.random()` for 6 hardcoded city entries. The 3D map view at `AirQualityMapView.tsx:203` is initialized with `fallbackToMock: true`, meaning this switch happens automatically on any sustained SSE outage. The `isConnected` flag flips to `false`, causing `AirQualityMapView.tsx:413` to render "Last Updated" instead of "🔴 Live" — the primary live-state indicator does correctly reflect the disconnect. However, the 3D visualization continues to animate with plausible-looking per-city AQI values (e.g., "Bakersfield: 95 ± random") without any persistent "SIMULATED DATA" watermark. A user who notices the status line switch but remains watching the 3D scene has no persistent visual cue that the moving data is random noise.

**Proposed actions:**
- Fix `context.py:20`: change `"purpleair": 120` → `"purpleair": 600` to match the actual default polling interval; this eliminates the always-stale classification of PurpleAir under standard deployment — H/L, score 3.0; ties all existing top-10 rows (first-seen #15 > first-seen #1–13); does not displace
- Stop overwriting sensor timestamps in `broadcast.rs:83-90`: preserve the original sensor `timestamp` and add a separate `broadcastAt` field so "🔴 Live" indicators can display the true sensor-read time rather than the broadcast time — H/L, score 3.0; ties; does not displace
- Replace "Real-time AQI and PM2.5 levels across major cities." at `Dashboard.tsx:367` with "Latest AQI and PM2.5 levels" and append a `(data as of <timestamp>)` annotation; show "Using cached data" when the fallback activates — M/L, score 2.0
- Add a `useDashboardData` note or UI badge "(Historical data: Jul '23–Jun '24)" to trend charts driven purely from `data/dashboardData.ts` — M/L, score 2.0
- Add a full-viewport "SIMULATED DATA" overlay badge in `AirQualityMapView.tsx` when `useRealtimeAQI` is in mock mode (detect via `error === 'Using simulated data (server unavailable)'`) — M/L, score 2.0

## 📚 Archive (one line per past run)
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
