# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T00:00:00Z
Last run: #1 — Lens: Type safety

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Annotate AI service `response.json()` shapes | Type safety | M | L | 1 | Open |
| 2 | Enable TypeScript strict mode in tsconfig.json | Type safety | H | M | 1 | Open |
| 3 | Replace `Record<string, any>` chart-row maps | Type safety | M | M | 1 | Open |
| 4 | Define `DailyForecast` interface & eliminate `(day: any)` | Type safety | M | M | 1 | Open |
| 5 | Validate `safeJsonParse<T>` at runtime (Zod/type guard) | Type safety | M | M | 1 | Open |
| 6 | Add explicit return type to `getDashboardMetrics` | Type safety | L | L | 1 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
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
- Add `"strict": true` to `tsconfig.json` → Active Recommendation #2
- Export a `DailyForecast` interface from `data/dashboardData.ts` and annotate the return type of `generateDailyForecast` → Active Recommendation #4
- Replace `Record<string, any>` maps and `any[]`/`any` temporaries in `useDashboardData.ts` with typed chart-row interfaces → Active Recommendation #3
- Add typed `interface` for each `response.json()` result in `services/aiService.ts` → Active Recommendation #1
- Add explicit return-type interface to `getDashboardMetrics` in `services/dataService.ts` → Active Recommendation #6
- Replace `safeJsonParse` cast with a Zod schema or type guard → Active Recommendation #5

## 📚 Archive (one line per past run)
_(no archived runs yet)_

## 🔁 Lens rotation log
- Run #1: lens 1 (Type safety) — findings added
