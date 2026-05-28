# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T06:30:00Z
Last run: #2 — Lens: Module boundaries

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Annotate AI service `response.json()` shapes | Type safety | M | L | 1 | Open |
| 2 | Extract shared base URL config module | Module boundaries | M | L | 2 | Open |
| 3 | Move `CityData` type out of `CityMarkers` into `types.ts` | Module boundaries | M | L | 2 | Open |
| 4 | Move `LocationKey` from `dashboardData` into `types.ts` | Module boundaries | M | L | 2 | Open |
| 5 | Enable TypeScript strict mode in `tsconfig.json` | Type safety | H | M | 1 | Open |
| 6 | Replace `Record<string, any>` chart-row maps | Type safety | M | M | 1 | Open |
| 7 | Define `DailyForecast` interface & eliminate `(day: any)` | Type safety | M | M | 1 | Open |
| 8 | Validate `safeJsonParse<T>` at runtime (Zod/type guard) | Type safety | M | M | 1 | Open |
| 9 | Remove static `dashboardData` fallback from `DataService` | Module boundaries | M | M | 2 | Open |
| 10 | Add explicit return type to `getDashboardMetrics` | Type safety | L | L | 1 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #2 — 2026-05-28 — Lens: Module boundaries
**Scope:** All import statements in `hooks/`, `services/`, `contexts/`, `components/`, `data/` on `main` branch; traced cross-layer import chains; checked for duplicated constants and parallel type hierarchies.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` imports `type { CityData }` from `../components/3d/CityMarkers`. A hook reaching into a component module inverts the normal dependency direction (`components` → `hooks`). `CityData` is used to extend `RealtimeCityData`; because `CityMarkers` does not import `useRealtimeAQI` the dep graph is acyclic today, but the coupling is fragile — any refactor of the 3-D component layer risks breaking an unrelated hook. The shared type belongs in `types.ts`.

- OBSERVATION: `contexts/UserPreferencesContext.tsx:2` imports `LocationKey` from `../data/dashboardData`. A React context (global singleton) should not depend on a data-layer module. `LocationKey` is a plain union type that belongs in `types.ts`, not embedded inside static mock data.

- OBSERVATION: `services/dataService.ts:4` imports `dashboardData, cityLocations` from `../data/dashboardData` with the comment `// Keep for fallback`. The service also performs a dynamic `import('../data/dashboardData')` (~line 274) for a second code path. This silently serves stale mock data when the backend is unavailable, hiding outages and giving users false confidence in the data. The fallback bypasses the error-surface that `useLiveData` implements correctly.

- OBSERVATION: `GATEWAY_URL`/`ANALYTICS_URL` and `INGESTION_URL` base-URL constants are independently re-declared in four files: `services/dataService.ts`, `services/WeatherService.ts`, `services/AirQualityService.ts`, and `hooks/useLiveData.ts`. Each has a slightly different form — `dataService.ts` appends `/api` in the const itself while `useLiveData.ts` appends it per-call — creating subtle inconsistency. Any port or path change requires editing 4+ files.

- OBSERVATION: `services/WeatherService.ts` exports `WeatherData` and `ForecastData`; `services/dataService.ts` exports `WeatherRecord` and `ForecastRecord`. Both describe weather readings with heavily overlapping fields (temperature/temp, humidity, windSpeed, etc.) but different field names and shapes. `DataService` wraps `WeatherService` internally but never re-exports or canonicalises the type, so consumers can pull from either service producing two incompatible weather shapes in the same codebase.

- OBSERVATION: `components/Dashboard.tsx` imports both from `services/dataService.ts` (for `AQIRecord`, `WeatherRecord`, etc.) and directly from `data/dashboardData.ts` (for `locations`, `LocationKey`). The service abstraction is leaky: it covers data-record types but not the location metadata that drives queries, forcing the view to reach past the service layer into raw static data.

**Proposed actions:**
- Move `CityData` type from `components/3d/CityMarkers.tsx` to `types.ts` → Active Recommendation #3
- Move `LocationKey` from `data/dashboardData.ts` to `types.ts`; update all importers → Active Recommendation #4
- Create `services/config.ts` exporting `GATEWAY_URL` and `INGESTION_URL`; replace 4 inline declarations → Active Recommendation #2
- Delete the static-data fallback paths from `DataService`; let `useLiveData` error handling surface failures → Active Recommendation #9
- Decide on one canonical weather type (`WeatherRecord` vs `WeatherData`) and remove the duplicate — not yet in top 10 (M/H ratio 0.67)

### Run #1 — 2026-05-28 — Lens: Type safety
**Scope:** `tsconfig.json`, `types.ts`, `hooks/useDashboardData.ts`, `hooks/useLiveData.ts`, `hooks/useRealtimeAQI.ts`, `services/aiService.ts`, `services/dataService.ts`, `data/dashboardData.ts`, `utils/errorHandling.ts` — read via GitHub API on `main` branch.

**Findings:**

- OBSERVATION: `tsconfig.json` has no `"strict"`, `"noImplicitAny"`, or `"strictNullChecks"` flags. The compiler runs in its most permissive mode, silently accepting all implicit `any` types and unchecked nulls throughout the codebase. (`tsconfig.json:1-22`)

- OBSERVATION: `hooks/useDashboardData.ts` uses `Map<string, Record<string, any>>` for every chart-data merge function — `mergedForecastData` (~line 63), `mergedHistoricalAqi` (~line 101), `mergedHistoricalPm25` (~line 117), `mergedHistoricalWeather` (~line 133) — discarding all structural type information for downstream Recharts consumers.

- OBSERVATION: `hooks/useDashboardData.ts` iterates `dailyForecast` entries as `(day: any)` in four separate `useMemo` blocks (~lines 154, 187, 222, 257) because `generateDailyForecast` in `data/dashboardData.ts` has no return type annotation, making its inferred element type opaque.

- OBSERVATION: `hooks/useDashboardData.ts` declares `result: any[]` and `entry: any` temporaries in every merged-weather memo (humidity, wind, UV, agricultural), stripping shape information from the hook's public return values. (~lines 163–168, 200–205, 235–240, 270–275)

- OBSERVATION: `data/dashboardData.ts` — `generateDailyForecast` (a ~120-line function near the bottom of the file) has no return type annotation. TypeScript infers a complex structural type that is not exported or named, forcing every consumer to fall back to `any`.

- OBSERVATION: `services/aiService.ts` — every `await response.json()` call returns the implicit `any` type. Properties `.text` and `.groundingChunks` are accessed without type assertions or runtime guards. Any backend contract change produces a silent runtime `undefined` instead of a compile-time error. (All six exported functions, e.g., `getChatResponse`, `getGroundedSearchResponse`, `getDeepAnalysisResponse`, etc.)

- OBSERVATION: `services/dataService.ts` — `getDashboardMetrics` returns an anonymous object literal with no declared return interface. Consumers cannot rely on compile-time shape checking. (`services/dataService.ts`, `getDashboardMetrics` method)

- OBSERVATION: `utils/errorHandling.ts` — `safeJsonParse<T>` performs `JSON.parse(json) as T` (~line 247) with no runtime validation. The generic type parameter is purely cosmetic; any malformed payload silently passes as `T`.

**Proposed actions:**
- Add `"strict": true` to `tsconfig.json` → Active Recommendation #5
- Export a `DailyForecast` interface from `data/dashboardData.ts` and annotate the return type of `generateDailyForecast` → Active Recommendation #7
- Replace `Record<string, any>` maps and `any[]`/`any` temporaries in `useDashboardData.ts` with typed chart-row interfaces → Active Recommendation #6
- Add typed `interface` for each `response.json()` result in `services/aiService.ts` → Active Recommendation #1
- Add explicit return-type interface to `getDashboardMetrics` in `services/dataService.ts` → Active Recommendation #10
- Replace `safeJsonParse` cast with a Zod schema or type guard → Active Recommendation #8

## 📚 Archive (one line per past run)
_(no archived runs yet)_

## 🔁 Lens rotation log
- Run #1: lens 1 (Type safety) — findings added
- Run #2: lens 2 (Module boundaries) — findings added
