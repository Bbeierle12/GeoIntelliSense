# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T07:15:00Z
Last run: #3 — Lens: Dependency health

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Annotate AI service `response.json()` shapes | Type safety | M | L | 1 | Open |
| 2 | Extract shared base URL config module | Module boundaries | M | L | 2 | Open |
| 3 | Move `CityData` type out of `CityMarkers` into `types.ts` | Module boundaries | M | L | 2 | Open |
| 4 | Move `LocationKey` from `dashboardData` into `types.ts` | Module boundaries | M | L | 2 | Open |
| 5 | Upgrade Anthropic Python SDK from `0.49.*` to `>=0.50` | Dep health | M | L | 3 | Open |
| 6 | Enable TypeScript strict mode in `tsconfig.json` | Type safety | H | M | 1 | Open |
| 7 | Split `colorScales.ts` — isolate THREE-dependent exports | Dep health | H | M | 3 | Open |
| 8 | Remove stale importmap CDN entries; adopt Tailwind PostCSS | Dep health | H | M | 3 | Open |
| 9 | Replace `Record<string, any>` chart-row maps | Type safety | M | M | 1 | Open |
| 10 | Remove static `dashboardData` fallback from `DataService` | Module boundaries | M | M | 2 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #3 — 2026-05-28 — Lens: Dependency health
**Scope:** `package.json`, `package-lock.json` (lockfileVersion 3, 368 packages), `vite.config.ts`, `index.html`, `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml` + `Cargo.lock` (283 packages), all `.tsx`/`.ts` import statements for three.js; checked for `"latest"` version pins, deprecated transitive deps, CDN dependencies, bundle-split effectiveness, and SDK version lag.

**Findings:**

- OBSERVATION: `utils/colorScales.ts:1` performs `import * as THREE from 'three'` at module top-level. The file also exports pure AQI color functions (`getAQIColor`, `getAQICategory`, `AQI_CATEGORIES`) that have zero dependency on THREE. `components/AirQualityMapView.tsx:37` imports those pure functions from `colorScales.ts`. Because the THREE namespace import is unconditional, any consumer of `colorScales.ts` — including non-3D views — forces the entire three.js package (~600 KB min) into their module graph. `vite.config.ts:17` places `three`, `@react-three/fiber`, and `@react-three/drei` in a `three-vendor` manual chunk with the comment `// Split Three.js + React Three Fiber into its own chunk (~800KB)`, but that split is only effective if the three-vendor modules are imported exclusively from lazy-loaded routes. Because `AirQualityMapView` (a non-lazy component) triggers the THREE import via `colorScales.ts`, the three-vendor chunk is pulled into the initial bundle load.

- OBSERVATION: `index.html` contains a `<script type="importmap">` block that maps `react`, `react-dom`, `recharts`, `@google/genai`, and `@googlemaps/markerclusterer` to third-party CDN URLs (`aistudiocdn.com`, `unpkg.com`). None of the `<script src>` or importmap entries carry Subresource Integrity (SRI) hashes. In a Vite build, all these packages are already resolved from `node_modules` and bundled; the importmap is a stale artifact from Google AI Studio development that introduces contradictory module paths. Additionally, `@google/genai` appears only in the importmap and nowhere in `package.json` or any TypeScript import — it is entirely unused dead weight. The `<script src="https://cdn.tailwindcss.com">` in the same file loads the full ~3 MB runtime Tailwind CDN build on every page load; Tailwind is absent from `package.json` and `vite.config.ts`, so no PostCSS purging ever runs.

- OBSERVATION: `package.json:dependencies` pins `@googlemaps/markerclusterer` to the bare string `"latest"` (line 9). `latest` is a floating tag that resolves at install time — different CI environments or developer machines may install different versions without a lock-file bump, breaking reproducible builds. The same package is separately loaded via the importmap CDN entry pointing to `unpkg.com/@googlemaps/markerclusterer/dist/index.mjs`, creating a dual-resolution path where the browser might use a different version than the Vite build.

- OBSERVATION: `geointellisense-ingestion/Cargo.toml` declares `rand = "0.8"`. Cargo.lock shows `rand 0.8.5`. The `rand` 0.8 branch has been in maintenance mode since the `rand` 0.9 release (early 2025); `rand 0.9` changes the default `ThreadRng` API and deprecates several distribution constructors used in 0.8. While 0.8.5 is not CVE-affected, keeping the ingestion service on an end-of-active-development crate means security patches are less likely to appear if new issues are found.

- OBSERVATION: `geointellisense-analytics/requirements.txt` pins `anthropic==0.49.*`. The Anthropic Python SDK 0.49.x predates structured tool result support and Managed Agents APIs that shipped in ≥0.50. The analytics service uses the SDK across at least 10 route files (`chat.py`, `deep_analysis.py`, `grounded_search.py`, etc.) calling `client.messages.create`. Staying on 0.49.x blocks access to claude-opus-4-7 Managed Tools, token-efficient tool use, and new streaming improvements; the SDK changelog for 0.50–0.51 documents no breaking changes to `messages.create`.

- OBSERVATION: `geointellisense-analytics/requirements.txt` specifies `numpy>=1.26,<2.1` — a range rather than a minor-pinned spec — while all other scientific deps (`scipy`, `scikit-learn`, `joblib`) also use range pins. This is intentional and correct for scientific stack. However, there is no `requirements.lock` / `pip-compile` artefact in the repo; the Docker image will install the latest-matching versions at build time with no reproducibility guarantee across builds.

**Proposed actions:**
- Split `utils/colorScales.ts` into `utils/aqiColors.ts` (pure JS, no THREE) and `utils/colorScalesThree.ts` (THREE textures); update `AirQualityMapView.tsx` and other non-3D importers to use the pure file → Active Recommendation #7
- Remove the `<script type="importmap">` block and the Tailwind CDN `<script>` from `index.html`; install `tailwindcss` as a dev dep and configure the PostCSS plugin in `vite.config.ts` → Active Recommendation #8
- Change `"@googlemaps/markerclusterer": "latest"` to `"^2.6.2"` in `package.json` → not in top 10 (L/L, displaced)
- Upgrade `rand` in `Cargo.toml` from `"0.8"` to `"0.9"` and run `cargo update` → not in top 10 (L/L, displaced)
- Bump `anthropic` in `requirements.txt` to `>=0.50,<0.52` → Active Recommendation #5

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
- Delete the static-data fallback paths from `DataService`; let `useLiveData` error handling surface failures → Active Recommendation #10
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
- Add `"strict": true` to `tsconfig.json` → Active Recommendation #6
- Export a `DailyForecast` interface from `data/dashboardData.ts` and annotate the return type of `generateDailyForecast` → (fell off top 10 this run, revisit)
- Replace `Record<string, any>` maps and `any[]`/`any` temporaries in `useDashboardData.ts` with typed chart-row interfaces → Active Recommendation #9
- Add typed `interface` for each `response.json()` result in `services/aiService.ts` → Active Recommendation #1
- Add explicit return-type interface to `getDashboardMetrics` in `services/dataService.ts` → (fell off top 10 this run, revisit)
- Replace `safeJsonParse` cast with a Zod schema or type guard → (fell off top 10 this run, revisit)

## 📚 Archive (one line per past run)
_(no archived runs yet)_

## 🔁 Lens rotation log
- Run #1: lens 1 (Type safety) — findings added
- Run #2: lens 2 (Module boundaries) — findings added
- Run #3: lens 3 (Dependency health) — findings added
