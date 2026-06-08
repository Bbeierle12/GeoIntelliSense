# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-08T09:15:00Z
Last run: #213 — Lens: Dependency health

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
| 10 | `aiService.ts:getChatResponse` reads only `data.text`, discarding the `sessionId` returned by `chat.py:86` — every request creates a new Python session via `create_session()` so multi-turn context is silently lost | TS↔Python/UX | H | L | 201 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #213 — 2026-06-08 — Lens: Dependency health
**Scope:** Fifteenth dependency-health pass. Files read in full: `package.json`, `package-lock.json` (parsed for resolved versions), `geointellisense-ingestion/Cargo.toml`, `geointellisense-ingestion/Cargo.lock` (rand, redis, getrandom, h2, openssl sections), `geointellisense-analytics/requirements.txt`, `vite.config.ts`, `geointellisense-ingestion/Dockerfile`, `geointellisense-ingestion/src/aqi.rs`. Cross-checked against Active Recommendations and archived dep-health runs #3, 18, 33, 48, 63, 78, 93, 108, 123, 138, 153, 168, 183, 198 to confirm findings are new.

**Findings:**

- OBSERVATION: `package.json` (production `dependencies` section) — `"@googlemaps/markerclusterer": "latest"` is the only dependency in the entire `dependencies` block using the npm `"latest"` dist-tag rather than a semver range. The dist-tag `"latest"` is resolved at install time to whatever the current `@latest` tag points to on the npm registry; it is not a range constraint like `"^2.6.0"`. The lockfile currently pins the resolved version to `2.6.2`, so existing installs are reproducible. However, any deployment scenario that does not use or regenerates the lockfile — including Docker multistage builds that copy only `package.json`, `npm install --ignore-scripts` in a cold CI cache, or a deliberate `npm install --force` — will silently resolve to whatever version is tagged `@latest` at that moment. If `@googlemaps/markerclusterer` releases a major version (e.g., v3.0.0 with breaking `MarkerClusterer` API changes), this will break the map clustering feature with no compile-time error and no npm warning about a major-version jump. All other 19 dependencies in `package.json` use explicit semver ranges (`^`, `~`, or exact pins). PROPOSAL: Replace `"latest"` with `"^2.6.0"` (or the current latest major, pinning to the installed version) in `package.json` — L/L effort (1-character change; prevents silent major-version drift in the only unranged production dependency).

- OBSERVATION: `vite.config.ts:24` — the developer comment `// Split Three.js + React Three Fiber into its own chunk (~800KB)` documents that the `three-vendor` manual chunk — containing `three@0.181.2`, `@react-three/fiber@9.4.0`, and `@react-three/drei@10.7.7` — is approximately 800KB. Yet `vite.config.ts:38` sets `chunkSizeWarningLimit: 500`, establishing 500KB as the project's own bundle-size warning threshold. The `manualChunks` configuration at lines 24–33 explicitly splits these libraries into a named chunk, which suppresses Vite's automatic `chunkSizeWarningLimit` warning for this chunk — meaning CI/CD and local builds produce no warning about a chunk that is 60% above the declared threshold. Three.js 0.181.2 minified is ~660KB alone; fiber and drei add approximately 120KB and 200KB respectively. No bundle analysis tool (`rollup-plugin-visualizer`, `source-map-explorer`) is present in `package.json` scripts to track growth over time. First-time visitors cannot see the 3D AQI visualization until this ~800KB chunk (plus the main bundle and react-vendor chunk) downloads and parses. PROPOSAL: (a) Short-term: add `rollup-plugin-visualizer` to `devDependencies` and run `vite build --mode analyze` in CI to track `three-vendor` size over time — L/L effort (~3 lines in `vite.config.ts`); (b) Long-term: lazy-load the `AQI3DScene` component via `React.lazy()` so the 3D chunk downloads only on demand — M/M effort (~10 line changes in the component and its parent).

- OBSERVATION: `geointellisense-ingestion/Cargo.toml` declares `rand = "0.8"`, resolved to `rand 0.8.5` in `Cargo.lock`. rand 0.9 was released in January 2025, making 0.8 a two-major-series-old release. The rand 0.9 release removed `rand::thread_rng()` (replaced by `rand::rng()`) and the `Rng::gen()` shorthand (replaced by `Rng::random()`). Both removed APIs are called in `geointellisense-ingestion/src/aqi.rs`: `rand::thread_rng()` at lines 100 and 139, and `rng.gen_range(...)` at lines 106–130 and 149–158 (gen_range itself still exists in 0.9 but the receiver type changes). Beyond the API migration: any future `cargo add` of a crate that has migrated its own public API to require `rand ≥ 0.9` as a dependency will introduce a duplicate-crate compile situation — Cargo resolves semver-incompatible crates independently, doubling binary size for rand and its transitive deps (`getrandom`, `rand_core`, `rand_chacha`) and making trait-based interop between the two rand versions impossible. The ingestion service uses rand only for mock/fallback AQI data generation (non-security-sensitive), so the migration carries no behavioral risk. PROPOSAL: Update `Cargo.toml` to `rand = "0.9"` and migrate `aqi.rs:100,139` from `rand::thread_rng()` to `rand::rng()` — M/M effort (~30 call-site changes across `aqi.rs`; straightforward mechanical migration following the rand 0.8→0.9 upgrade guide).

- OBSERVATION: `geointellisense-analytics/requirements.txt` uses loose version constraints (`==1.24.*`, `>=1.5,<1.7`, `>=1.26,<2.1`, etc.) with no companion lock file. The JS sub-project has `package-lock.json` (present, 2.1MB, pinning every transitive dep to a content-addressed checksum) and the Rust sub-project has `Cargo.lock` (present, pinning all crates to verified checksums). The Python analytics service has neither a `pip freeze`-style lock file nor a `uv.lock` / `poetry.lock`. Running `pip install -r requirements.txt` on two different dates can resolve to different versions of numpy, scipy, scikit-learn, polars, or anthropic — any of which may introduce behavioral regressions, scikit-learn estimator changes, or dtype changes in polars. The `Dockerfile` for the analytics service (if using standard pip) will produce a non-reproducible image. This also means vulnerability scanners (Dependabot, pip-audit) cannot produce per-transitive-dep advisories since the exact installed versions are unknown outside a running container. PROPOSAL: Add a pip lock file for the analytics service by running `pip freeze > requirements.lock.txt` (or `uv pip compile requirements.txt -o requirements.lock.txt` if using uv) — L/L effort (1 command; aligns the Python service with the reproducibility guarantees already in place for the JS and Rust sub-projects).

**Proposed actions:**
- Replace `"latest"` with `"^2.6.0"` in `package.json` production deps — L/L effort (1 line; eliminates sole unranged production dependency)
- Add `rollup-plugin-visualizer` to vite config to surface `three-vendor` ~800KB chunk in CI; long-term lazy-load `AQI3DScene` — L/L + M/M effort (aligns `chunkSizeWarningLimit: 500` intent with actual measurement)
- Update `Cargo.toml` `rand` to `"0.9"` and migrate `aqi.rs` API call sites (`thread_rng()` → `rng()`) — M/M effort (~30 lines; unblocks ecosystem crates that have migrated to rand 0.9)
- Add `requirements.lock.txt` (pip freeze output or uv compile) for `geointellisense-analytics` — L/L effort (1 command; achieves reproducible Python builds matching JS/Rust lockfile standard)

### Run #212 — 2026-06-08 — Lens: Module boundaries
**Scope:** Fifteenth module-boundaries pass. Full reads of all TypeScript/TSX imports across `hooks/` (6 files), `services/` (4 files), `components/` (all subdirectories recursively), `contexts/`, `utils/`, `data/`, `types.ts`, `App.tsx`; Python import chains in `geointellisense-analytics/app/` (all .py files). Cross-checked against Active Recommendations and archived module-boundary runs #2, #17, #32, #47, #62, #77, #92, #107, #122, #137, #152, #167, #182, #197 to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` — `import type { CityData } from '../components/3d/CityMarkers'` — a hook (state/logic layer) imports a type from a specific component leaf file (presentation layer), inverting the standard unidirectional dependency direction. `RealtimeCityData extends CityData` at line 15, so `CityData` is the base type the hook builds on. Yet `CityData` is defined at `components/3d/CityMarkers.tsx:20` as a pure domain interface with fields `name`, `lat`, `lng`, `aqi`, `pm25`, `color` — no React or component-specific logic. Any rename, move, or split of `CityMarkers.tsx` forces a matching change in `useRealtimeAQI.ts` — the opposite of encapsulation. `types.ts` already serves as the canonical shared interface registry (imported by both hooks and components), making it the correct home for `CityData`. PROPOSAL: Move `CityData` from `components/3d/CityMarkers.tsx:20` to `types.ts`; update `CityMarkers.tsx` and `useRealtimeAQI.ts:8` to import from `types.ts` — L/L effort (~4 line changes across 3 files; eliminates the sole hook-to-component-leaf coupling in the repo, restores correct unidirectional flow).

- OBSERVATION: `hooks/useLiveData.ts:18,102,121,131,147,163,182,202,216` — exports 9 domain data interfaces (`ErrorKind`, `AqiReading`, `AqiSnapshot`, `PredictionResult`, `InversionData`, `FiresData`, `EarthquakeData`, `WaterData`, `ForecastPeriod`) describing API response shapes — not hook behavior. All 8 dashboard widget components (`AqiGaugeWidget.tsx`, `AqiTrendWidget.tsx`, `AqiForecastWidget.tsx`, `WeatherWidget.tsx`, `InversionWidget.tsx`, `FiresWidget.tsx`, `WaterWidget.tsx`, `EarthquakeWidget.tsx`) import directly from `hooks/useLiveData` — in several cases only to obtain a type annotation. This makes `useLiveData.ts` simultaneously a React hooks module and a type registry — a single-file two-responsibility violation. A component that only needs to type a prop (e.g., `fireData: FiresData`) must import the entire hook module, coupling it to hook runtime implementations. PROPOSAL: Move the 9 domain interfaces from `hooks/useLiveData.ts` to `types.ts` — M/L effort (~30 lines moved across 2 files; decouples domain-type consumers from hook-implementation imports, enables reuse in services, test fixtures, and TS↔Python contract utilities without importing React hooks).

- OBSERVATION: `services/dataService.ts` defines and exports `HistoricalAQIRecord`, `HistoricalWeatherRecord`, `LocationsRecord`, `DashboardDataRecord` as exported interfaces describing API response shapes, and `hooks/useNormalizedData.ts:3-10` imports all four from the service file. These 4 interfaces represent the data contract between the Python analytics API and the TypeScript frontend — they are domain types, not service-layer implementation details. Co-locating them inside `dataService.ts` means any module that needs to type-annotate or validate these shapes must take a dependency on the service implementation module. This mirrors the pattern in finding #2: domain types accumulated in implementation modules rather than in the shared boundary file. PROPOSAL: Move `HistoricalAQIRecord`, `HistoricalWeatherRecord`, `LocationsRecord`, `DashboardDataRecord` from `services/dataService.ts` to `types.ts` — L/L effort (~20 lines moved; consolidates all API-contract types in the canonical types file, aligns with the TS↔Python contract lens principle that shared shapes belong at the boundary layer).

- OBSERVATION: `hooks/`, `services/`, `utils/`, and `contexts/` all lack barrel (`index.ts`) files. In contrast, `components/3d/` and `components/charts/` both have `index.ts` barrels, demonstrating the pattern is known and intentional in those subdirectories. Without barrels in the non-component directories: (a) 8 dashboard widget components import via 3-level relative paths (`'../../../hooks/useLiveData'`); (b) there is no enforced public surface — any internal file is importable directly by any consumer; (c) `App.tsx` imports from 6 separate hook/service/context files via long direct paths. The asymmetry means only `3d` and `charts` module consumers are shielded from internal refactors; hooks, services, utils, and contexts are fully transparent, making internal reorganization a cross-cutting change. PROPOSAL: Add `index.ts` barrel files to `services/`, `hooks/`, `utils/`, and `contexts/` — L/L effort (~4 files × ~5 lines each; mirrors the pattern in `components/3d/index.ts` and `components/charts/index.ts`, flattens dashboard widget relative paths, creates enforced public module surfaces for each boundary layer).

**Proposed actions:**
- Move `CityData` from `components/3d/CityMarkers.tsx:20` to `types.ts`; update imports in `CityMarkers.tsx` and `useRealtimeAQI.ts:8` — L/L effort (~4 lines; eliminates sole hook-to-component-leaf coupling)
- Move 9 domain interfaces from `hooks/useLiveData.ts:18-227` to `types.ts` — M/L effort (~30 lines; decouples 8 dashboard widgets from hook-implementation import)
- Move 4 API-response interfaces from `services/dataService.ts` to `types.ts` — L/L effort (~20 lines; consolidates all domain types at the shared boundary file)
- Add `index.ts` barrel files to `services/`, `hooks/`, `utils/`, `contexts/` — L/L effort (~20 lines total; matches pattern established in `components/3d/` and `components/charts/`)

### Run #211 — 2026-06-08 — Lens: Type safety
**Scope:** Fifteenth type safety pass. Full reads of: `hooks/useDashboardData.ts`, `components/charts/AQITrendChart.tsx`, `components/charts/PM25TrendChart.tsx`, `components/charts/WeatherForecastChart.tsx`, `components/charts/TemperaturePrecipitationChart.tsx`, `components/AccessibleChart.tsx`, `components/3d/AQI3DScene.tsx`, `services/aiService.ts`, `services/dataService.ts`, `services/AirQualityService.ts`, `hooks/useRealtimeAQI.ts`, `types.ts`, `utils/errorHandling.ts`, `data/dashboardData.ts`; `any`-pattern grep across all `*.ts`/`*.tsx`. Cross-checked against Active Recommendations and archived type-safety runs #1, 16, 31, 46, 61, 76, 91, 106, 121, 136, 151, 166, 181, 196 to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useDashboardData.ts:179,223,267,311` — Four `locEntry.dailyForecast.forEach((day: any) => { ... })` callbacks each carry an explicit `: any` annotation for the `day` parameter. The `dailyForecast` property is produced by `generateDailyForecast()` at `data/dashboardData.ts:195`, whose return type TypeScript can fully infer: an array of objects with `.humidity: number`, `.wind.speed: number`, `.uv: number`, `.evapotranspiration: number`, `.solarRadiation: number`, `.date: string`. All four callbacks access precisely these fields, but with `day: any` TypeScript silently accepts typos such as `day.windSpeed` (flat, wrong) vs. `day.wind.speed` (nested, correct, used at line 234) and cannot flag them. The explicit `: any` annotation suppresses the inferred element type that would flow naturally from the `'dailyForecast' in locEntry` narrowing guard. PROPOSAL: Export `type DailyForecastEntry = ReturnType<typeof generateDailyForecast>[number]` from `data/dashboardData.ts` (alongside the existing `LocationKey` export) and replace the four `(day: any)` annotations in `useDashboardData.ts:179,223,267,311` with `(day: DailyForecastEntry)` — L/L effort (~5 lines across 2 files; eliminates explicit `any` overrides and restores TypeScript's ability to detect field-access errors on daily forecast entries).

- OBSERVATION: `components/charts/AQITrendChart.tsx:15`, `PM25TrendChart.tsx:15`, `WeatherForecastChart.tsx:14`, `TemperaturePrecipitationChart.tsx:15` — All four chart component props interfaces declare `data: any[]`. The actual shapes produced by `useDashboardData`'s `useMemo` functions are: for monthly trend charts (`AQITrendChart`, `PM25TrendChart`, `TemperaturePrecipitationChart`), `{ month: string, [loc: string]: number | string }[]`; for the 7-day forecast chart, `{ day: string, [loc: string]: number }[]`. With `data: any[]`, TypeScript cannot warn if a caller passes `mergedHistoricalWeather` (whose keys use `${loc}_temp` / `${loc}_precip` suffixes) to `AQITrendChart` (which renders `<Line dataKey={loc}>` using bare location names as keys) — this mismatch causes silent blank lines at runtime with no compile-time signal. PROPOSAL: Define `type MonthlyTrendPoint = { month: string } & Record<string, number | string>` and `type WeatherForecastPoint = { day: string } & Record<string, number>` in `types.ts` and replace `data: any[]` in all four chart prop interfaces — L/L effort (~10 lines across 5 files; prevents silent wrong-data-type passes to chart components, closes the mismatch gap between `useDashboardData`'s data-building logic and chart rendering).

- OBSERVATION: `components/AccessibleChart.tsx:66,79,165` — Three `any` occurrences in the shared chart accessibility wrapper: (1) `DataTableColumn.format?: (value: any) => string` at line 66; (2) `data: Record<string, any>[]` at line 79 in `AccessibleChartProps`; (3) `data: Record<string, any>[]` at line 165 in a second props interface. The `format` callback is called inside the table row renderer as `format(row[col.key])` where `row[col.key]` is `any`; a formatter written as `(v: any) => v.toFixed(2)` passes TypeScript even if the actual column holds a string value — the error surfaces only at runtime. Tightening to `Record<string, unknown>[]` and `format?: (value: unknown) => string` requires explicit narrowing in all formatter implementations (e.g., `if (typeof v === 'number') return v.toFixed(2); return String(v)`), which is a backward-safe improvement for every chart instance using this wrapper. PROPOSAL: Replace `Record<string, any>[]` with `Record<string, unknown>[]` at `AccessibleChart.tsx:79,165` and `format?: (value: any) => string` with `format?: (value: unknown) => string` at `:66` — L/L effort (~3 line changes; removes `any` from the shared accessibility wrapper and enforces explicit narrowing in all data-table formatters).

- OBSERVATION: `components/3d/AQI3DScene.tsx:57` — `const controlsRef = useRef<any>(null)` holds the imperative handle for the `OrbitControls` component from `@react-three/drei`. The ref is accessed at line 69 as `controlsRef.current.getTarget(target)` where `target` is `new THREE.Vector3()` and the result is passed to `onCameraMove(camera.position, target)`. With `useRef<any>`, TypeScript cannot verify that `getTarget` is a valid method on the controls object, does not enforce that it accepts a `THREE.Vector3` argument, and will not flag it if a future refactor passes a plain `{x,y,z}` literal instead. The `@react-three/drei` package (v`^10.7.7` in `package.json`) exports `OrbitControlsImpl` — the underlying three-stdlib `OrbitControls` class that is forwarded via `React.forwardRef` to the `OrbitControls` component's `ref`. The correct typing is `useRef<OrbitControlsImpl | null>(null)` with `import { type OrbitControlsImpl } from '@react-three/drei'`. PROPOSAL: Replace `useRef<any>(null)` at `AQI3DScene.tsx:57` with `useRef<OrbitControlsImpl | null>(null)` and add the type import — L/L effort (~2 lines; removes the sole `any`-typed ref in the 3D module and enables TypeScript to validate OrbitControls API calls at lines 69 and 72).

**Proposed actions:**
- Export `type DailyForecastEntry = ReturnType<typeof generateDailyForecast>[number]` from `data/dashboardData.ts` and replace four `(day: any)` forEach annotations in `useDashboardData.ts:179,223,267,311` — L/L effort (~5 lines)
- Define `MonthlyTrendPoint` and `WeatherForecastPoint` chart data types in `types.ts`; replace `data: any[]` in all four chart component props interfaces — L/L effort (~10 lines across 5 files)
- Replace `Record<string, any>[]` with `Record<string, unknown>[]` and `format?: (value: any)` with `(value: unknown)` in `AccessibleChart.tsx:66,79,165` — L/L effort (~3 lines)
- Replace `useRef<any>` at `AQI3DScene.tsx:57` with `useRef<OrbitControlsImpl | null>` — L/L effort (~2 lines)

## 📚 Archive (one line per past run)
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
