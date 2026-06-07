# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-07T19:00:00Z
Last run: #198 — Lens: Dependency health

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
### Run #198 — 2026-06-07 — Lens: Dependency health
**Scope:** Fourteenth dependency health pass. Files examined in full: `package.json`, `package-lock.json` (all 122 direct packages), `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml`, `geointellisense-ingestion/Cargo.lock`, `vite.config.ts`, `geointellisense-analytics/app/database.py`. Cross-checked against Active Recommendations and archived dependency health runs #3, #18, #33, #48, #63, #78, #93, #108, #123, #138, #153, #168, #183 to confirm findings are new.

**Findings:**

- OBSERVATION: `package.json:16` — `"@googlemaps/markerclusterer": "latest"` uses the npm dist-tag `"latest"` rather than a semver range. All other 9 production dependencies use caret or tilde ranges (`^x.y.z`). The dist-tag `"latest"` is resolved at install time to the most recently published version regardless of semver compatibility: a future `@googlemaps/markerclusterer@3.0.0` (major breaking release) would be silently installed on any `npm install` run not strictly constrained by the lockfile (e.g., Dependabot version bumps, `npm install <new-package>`, CI environments using `npm install` instead of `npm ci`). The current lockfile resolves it to `2.6.2`, but that is no protection outside of `npm ci` workflows. PROPOSAL: Replace `"latest"` with `"^2.6.2"` in `package.json:16` — L/L effort (1 line; pins to the current major while allowing non-breaking patch/minor upgrades).

- OBSERVATION: `geointellisense-analytics/requirements.txt:4` — `psycopg[binary]==3.2.*` is listed as a production dependency but is never imported anywhere in the analytics codebase. A full-codebase grep finds zero occurrences of `import psycopg`, `from psycopg`, or any `psycopg.` attribute access across all Python files under `geointellisense-analytics/`. The only active PostgreSQL driver is `asyncpg`, imported at `geointellisense-analytics/app/database.py:1` and used exclusively throughout the data access layer. `psycopg[binary]` installs the psycopg3 C extension plus its native libpq binaries (~8–15 MB), extending build time and Docker image size with no benefit. It also introduces a second PostgreSQL driver that must be kept current for security patches independently of `asyncpg`, doubling the pg-driver CVE surface area for no functional gain. PROPOSAL: Remove `psycopg[binary]==3.2.*` from `requirements.txt:4` — L/L effort (1 line deletion; verify no alembic migration scripts or management commands outside `app/` import psycopg before removing).

- OBSERVATION: `geointellisense-ingestion/Cargo.toml:22` + `geointellisense-ingestion/src/aqi.rs:2,100,139` — The Rust ingestion service declares `rand = "0.8"` in Cargo.toml, resolving to `0.8.5` in Cargo.lock — the last published 0.8.x release. `aqi.rs` uses `rand::Rng` (line 2) and calls `rand::thread_rng()` at lines 100 and 139 to generate retry back-off jitter and synthetic fallback reading values. In rand 0.9.0 (released January 2025), `thread_rng()` was renamed to `rng()` and `ThreadRng` was relocated. The project already uses `edition = "2024"` (`Cargo.toml:4`), making the rand 0.8 pin an asymmetry with the language edition. More concretely, if any other crate in the Cargo dependency graph begins requiring `rand ≥ 0.9` as its minimum, Cargo will install both rand 0.8 and rand 0.9 in parallel — inflating the binary size and causing duplicate `Rng` trait implementations that force explicit disambiguation at all call sites. PROPOSAL: Bump `rand = "0.8"` to `rand = "0.9"` at `Cargo.toml:22` and update call sites in `aqi.rs:100,139` from `rand::thread_rng()` to `rand::rng()` — L/M effort (~5 lines; eliminates future dual-rand binary inflation risk and aligns with edition 2024).

- OBSERVATION: `geointellisense-analytics/requirements.txt:15,17` — The Python requirements pin `numpy>=1.26,<2.1` (line 15) and `scipy>=1.13,<1.15` (line 17) with hard upper bounds that jointly exclude numpy 2.1+ and scipy 1.15+. Both are the current stable releases as of mid-2026. The combined constraint creates: (a) a potential resolver conflict if `scikit-learn>=1.5,<1.7` (line 18) transitively requires scipy 1.15+ in a future minor release — pip would fail with `No matching distribution found`; (b) an incompatibility with `geopandas==1.0.*` (line 7) if geopandas 1.1+ (which requires scipy ≥ 1.14) is pulled transitively, since scipy 1.14 would be blocked by the `<1.15` bound and scipy 1.15 by the upper limit; (c) numpy `<2.1` excludes numpy 2.1+ whose C-extension ABI improvements benefit the geopandas/shapely spatial operations that underpin the analytics service's query paths. The double upper-bound is the root cause: each pin alone might be tolerable, but together they create a narrow window that makes `pip install` progressively more likely to fail as transitive dependencies drift upward. PROPOSAL: Relax to `numpy>=1.26,<3` and `scipy>=1.13,<2` at `requirements.txt:15,17` — L/L effort (2 lines; requires running the analytics test suite against numpy 2.2 and scipy 1.15 to confirm no regressions in spatial computations).

**Proposed actions:**
- Replace `"latest"` with `"^2.6.2"` at `package.json:16` — L/L effort (1 line; removes dist-tag build instability)
- Remove `psycopg[binary]==3.2.*` from `requirements.txt:4` — L/L effort (1 line; eliminates unused ~15 MB PostgreSQL driver from Docker image)
- Bump `rand = "0.8"` to `"0.9"` at `Cargo.toml:22`; update `rand::thread_rng()` → `rand::rng()` at `aqi.rs:100,139` — L/M effort (~5 lines; prevents future dual-rand binary inflation)
- Relax numpy and scipy upper bounds to `<3` and `<2` respectively at `requirements.txt:15,17` — L/L effort (2 lines; prevents pip resolution failures as transitive dependencies upgrade)

### Run #197 — 2026-06-07 — Lens: Module boundaries
**Scope:** Fourteenth module boundaries pass. Files examined in full: `hooks/useLiveData.ts`; `hooks/useApiStatus.ts`; `services/WeatherService.ts`; `services/dataService.ts`; `services/AirQualityService.ts`; `services/aiService.ts`; `components/MapView.tsx` (lines 168-199); `components/SettingsView.tsx` (lines 200-260, 356-380); `geointellisense-analytics/app/claude.py` (lines 217-273); `geointellisense-analytics/app/config.py`; `geointellisense-analytics/app/main.py`. Cross-checked against Active Recommendations and archived module boundary runs #2, #17, #32, #47, #62, #77, #92, #107, #122, #137, #152, #167, #182 to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useLiveData.ts:49-51` — The `useLiveData` generic data-fetching hook embeds a backend-routing table based on URL path prefixes: `const base = path.startsWith('/api/aqi-') || path === '/health' ? INGESTION_URL : GATEWAY_URL;`. This is a leaky abstraction — a hook that is otherwise entirely generic (accepting any URL `path`, any response type `T`) silently encodes knowledge of the service deployment topology: which path prefixes are served by the Rust ingestion service (port 3001) versus the Python analytics gateway (port 8080). The routing table is incomplete: the Rust service also serves `/api/aqi-snapshot`, which does match the prefix, but `/api/stations`, `/api/broadcast-status`, or any future Rust endpoints that don't begin with `/api/aqi-` would silently route to the Python gateway and receive 404s. Additionally, `path === '/health'` uses exact equality — a caller passing `/health/liveness` or `/health/ready` would route to the wrong service. PROPOSAL: Remove the routing table from `useLiveData`; add a `service?: 'ingestion' | 'gateway'` option parameter that defaults to `'gateway'`, resolving the base URL in one place (e.g., a `getBaseUrl(service)` helper in `services/`). Callers already know which service they're targeting — shifting this knowledge back to the callsite makes the hook generic and eliminates the implicit routing table — L/L effort (~10 lines across hook + callers).

- OBSERVATION: `geointellisense-analytics/app/claude.py:222-233` — `execute_tool()` constructs `base = f"http://localhost:{settings.port}"`, where `settings.port = 3002` (`config.py:6`) — the analytics service's own port. The function then issues `httpx.AsyncClient` GET requests to `http://localhost:3002/api/aqi-snapshot`, `/api/earthquakes/recent`, `/api/fires/active`, etc. (lines 230, 242, 248, 256, 261). This means the analytics FastAPI service issues full HTTP requests to itself — creating a new connection pool (`async with httpx.AsyncClient(timeout=30.0)`) per Claude tool call, traversing the OS network stack, and being matched by the FastAPI router as an inbound request — all to call route handlers that are functions in the same Python process. The fallback at line 233 (`http://localhost:3001/api/aqi-snapshot`) then bypasses the Caddy gateway to reach the Rust service directly, violating the gateway-as-single-entry-point design. PROPOSAL: Replace `execute_tool()` with direct function imports from the relevant route handlers or data-access modules, eliminating the self-HTTP loopback entirely. For the Rust fallback, add `ingestion_url: str = "http://localhost:3001"` to `config.py` and use `settings.ingestion_url` rather than a hardcoded literal — M/L effort (~30 lines; eliminates per-tool-call TCP overhead and gateway bypass).

- OBSERVATION: `components/SettingsView.tsx:209` — The `DataSourceToggles` React component declares `const adminToken = 'geointelli-admin-dev';` as a hardcoded string literal and sends it as `X-Admin-Token: geointelli-admin-dev` in every POST to `/api/admin/sources/*` (lines 230, 248). While `geointellisense-analytics/app/config.py:15` defines `admin_token: str = ""` (an environment-configurable field), the frontend unconditionally uses the hardcoded dev value regardless of deployment environment. This is a module boundary violation: auth credential configuration belongs in the environment layer (`import.meta.env.VITE_ADMIN_TOKEN`), not inside a React component. The compiled JS bundle ships the token in plaintext, making it trivially extractable via browser DevTools. Any user who finds the literal can invoke the admin toggle endpoints to enable or disable all data sources (PurpleAir, USGS, NASA FIRMS, etc.) — a denial-of-service against data ingestion. PROPOSAL: Replace the literal with `import.meta.env.VITE_ADMIN_TOKEN ?? ''` and add `VITE_ADMIN_TOKEN=geointelli-admin-dev` to `.env.local.example`, enabling production deployments to override via a real secret — L/L effort (~3 lines; moves auth config out of the component layer; enables proper secret management).

- OBSERVATION: `services/WeatherService.ts:59,100` — `WeatherService` silently spans two different backend service contracts: `getCurrentWeather()` at line 59 fetches from `${INGESTION_URL}/aqi-snapshot` (Rust ingestion port 3001), extracting `temperature`, `humidity`, `windSpeed`, `windDirection` from PurpleAir sensor readings; `getForecast()` at line 100 fetches from `${ANALYTICS_URL}/forecast` (Python analytics port 8080). From the perspective of `dataService.ts` (which imports only `WeatherService`), it appears to be a single-source boundary, but internally it traverses two backends with different data contracts, failure modes, and update frequencies. The boundary inversion in `getCurrentWeather()` is particularly subtle: it returns a `WeatherData` object with hardcoded constants (`pressure: 1013`, `cloudCover: 20`, `solarRadiation: 600`) masking that the underlying source is an AQI PM2.5 sensor snapshot, not a weather station. A schema change in the Rust `aqi-snapshot` response (e.g., renaming `temperature` → `ambientTemp`) would silently produce `undefined` weather values that TypeScript cannot detect because the response is cast via `data.readings as SnapshotReading[]` at line 63 with no runtime validation. PROPOSAL: Split `WeatherService` into `SensorWeatherService` (encapsulating the Ingestion dependency) and `ForecastService` (encapsulating the Analytics dependency), reflecting the actual two-service boundary — M/L effort (~30 lines; makes dual-backend dependency explicit; eliminates hidden schema-change risk and boundary-inversion confusion for callers).

**Proposed actions:**
- Add `service?: 'ingestion' | 'gateway'` parameter to `useLiveData` and remove path-prefix routing table at `hooks/useLiveData.ts:49-51` — L/L effort (~10 lines; eliminates silent mis-routing for future non-`/api/aqi-` Rust endpoints)
- Replace `execute_tool()` self-HTTP calls in `claude.py:222-233` with direct Python function imports; add `ingestion_url` to `config.py` to replace hardcoded `localhost:3001` fallback — M/L effort (~30 lines; eliminates per-Claude-tool TCP round-trip to same process)
- Replace `const adminToken = 'geointelli-admin-dev'` at `SettingsView.tsx:209` with `import.meta.env.VITE_ADMIN_TOKEN ?? ''` and add the var to `.env.local.example` — L/L effort (~3 lines; removes plaintext credential from JS bundle)
- Split `WeatherService` into `SensorWeatherService` and `ForecastService` to make the Rust-vs-Python dual-backend dependency explicit — M/L effort (~30 lines; eliminates boundary-inversion confusion and hidden schema-change risk)

### Run #196 — 2026-06-07 — Lens: Type safety
**Scope:** Fourteenth type safety pass. Files examined in full: all 92 TypeScript/TSX files via glob and targeted reads. Primary focus: `components/charts/PM25TrendChart.tsx`, `components/charts/AQITrendChart.tsx`, `components/charts/WeatherForecastChart.tsx`, `components/charts/TemperaturePrecipitationChart.tsx`, `components/AccessibleChart.tsx`, `hooks/useDashboardData.ts`, `components/Dashboard.tsx`, `components/MapView.tsx`. Cross-checked against Active Recommendations and archived type safety runs #1, #16, #31, #46, #61, #76, #91, #106, #121, #136, #151, #166, #181 to confirm findings are new.

**Findings:**

- OBSERVATION: `components/charts/PM25TrendChart.tsx:15`, `components/charts/AQITrendChart.tsx:15`, `components/charts/WeatherForecastChart.tsx:14`, `components/charts/TemperaturePrecipitationChart.tsx:15` — All four Recharts-based chart components declare their props interface with `data: any[]`. The Recharts `<LineChart>`, `<BarChart>`, and related components consume the `data` prop and look up values by the string keys supplied to `dataKey` props (e.g., `dataKey="Bakersfield_aqi"`). Because `data` is `any[]`, TypeScript cannot detect a mismatch between the actual object shape in `data` and the `dataKey` strings used in `<Line>` / `<Bar>` elements — the chart silently renders nothing (no data points, no error, no console warning) when key names differ. In practice, the keys are constructed dynamically as `${record.locationName}_temp`, `${record.locationName}_humidity` etc. in `useDashboardData.ts` and `Dashboard.tsx`. If a location name contains a space or special character that differs between the data-builder and the chart's hardcoded `dataKey`, the failure is invisible at compile time and silent at runtime. Replacing `data: any[]` with a proper discriminated union or generic type parameter `<T extends Record<string, unknown>>` across all four chart components would make key mismatches detectable. PROPOSAL: Define a shared `ChartDataPoint = Record<string, string | number>` type (or a generic `T extends Record<string, unknown>`) in `types/chart.ts` and replace `any[]` in all four chart props interfaces; additionally annotate the `<Line dataKey={...}>` with a satisfies check against the expected key set — L/M effort (~15 lines across 5 files; catches silent Recharts rendering failures at compile time).

- OBSERVATION: `hooks/useDashboardData.ts:179,197,199,223,241,243,267,285,287,311,330,332` — The file contains four parallel data-aggregation `useMemo` hooks (humidity trend, wind speed trend, temperature trend, precipitation trend), each structurally identical. In each, the inner `forEach` callback types the `day` parameter as `any` (e.g., line 179: `locEntry.dailyForecast.forEach((day: any) => {`), and the result accumulator is typed `const result: any[] = []` with each row as `const entry: any = { month }`. The `day` variable then has all property accesses unchecked: `day.humidity` (line 190), `day.wind.speed` (line 234), `day.tempHigh` (approximately), etc. The `dailyForecast` array originates from `dashboardData[loc]`, whose type is declared in the context — if the context type were properly threaded, `day` would be fully typed. The copy-paste of this `any`-heavy pattern across four functions means a shape change to the forecast data structure (e.g., renaming `wind.speed` to `windSpeed`) would silently produce `NaN` in all wind-related chart data without a TypeScript error. PROPOSAL: Extract a `ForecastDay` interface (with at minimum `date: string | Date`, `humidity: number`, `wind: { speed: number; direction: number }`, `tempHigh: number`, `tempLow: number`, `precipProbability: number`) to `types/weather.ts`, use it in the `dailyForecast` array type in `DashboardDataContext`, and replace the four `(day: any)` callbacks with `(day: ForecastDay)` — L/L effort (~10 lines: one interface + four one-word substitutions; eliminates 12 `any` annotations and unguarded property accesses simultaneously).

- OBSERVATION: `components/Dashboard.tsx:113` — The deduplication expression `.map(name => alerts.find(a => a.name === name)!)` asserts non-null on the result of `.find()`. The `!` is technically safe in this specific context (the `Set` is derived from the same `alerts` array, so every name in the Set must exist in `alerts`), but TypeScript cannot verify this invariant and the assertion silently suppresses the `T | undefined` type. More critically, `Dashboard.tsx:118` declares `const dayMap = new Map<string, Record<string, any>>()` for the `mergedForecastData` computation — any value inserted via `entry[\`${record.locationName}_temp\`]` or `entry[\`${record.locationName}_humidity\`]` is `any`, so the downstream chart prop is typed as `Record<string, any>[]` even when passed to a chart component that accepts `data: any[]`. This compounds the chart-type-safety gap identified in the first finding: the `data` is `any[]` at the prop level AND `any` at the element level, giving TypeScript zero visibility into the chart's data shape end to end. PROPOSAL: Replace `Record<string, any>` at `Dashboard.tsx:118` with `Record<string, number | string>`, and for the `.find()!` at line 113, either use `Array.from(new Set(...))` with a `filter` guard (`alerts.filter((a, i, arr) => arr.findIndex(b => b.name === a.name) === i)`) that preserves type safety — L/L effort (~4 lines; closes the end-to-end `any` chain from data builder to Recharts consumer).

- OBSERVATION: `components/MapView.tsx:390,393,394` — Inside `handleSearch` (lines 386–399), the early guard `if (!searchQuery || !mapInstanceRef.current) return;` at line 388 correctly narrows `mapInstanceRef.current` to non-null for the `service` construction on line 389. However, the callback passed to `service.textSearch` on lines 390–398 is asynchronous: it executes after the Google Maps API processes the search. By the time the callback fires, the component may have been unmounted and `mapInstanceRef.current` may be `null` again (React refs are mutable). The `!` assertions on lines 393 (`mapInstanceRef.current!.setCenter(...)`) and 394 (`mapInstanceRef.current!.setZoom(12)`) inside the async callback are therefore unsound — the narrowing from line 388 does not carry into the async closure. Additionally, `results[0].geometry!.location!` at line 393 applies two consecutive `!` assertions: the Google Maps Places API `PlaceResult.geometry` field is typed `PlaceGeometry | undefined` and `PlaceGeometry.location` is typed `google.maps.LatLng | undefined`; real API responses can return results with no geometry (e.g., for certain business listings or when the result is a chain with no specific address). Both `!` assertions will throw `Cannot read properties of undefined` when such a result is returned. PROPOSAL: Replace the `!` chain at line 393 with an explicit guard (`if (!mapInstanceRef.current || !results[0].geometry?.location) return;`) before calling `setCenter`/`setZoom`, eliminating both the stale-ref risk and the geometry-null crash — L/L effort (~3 lines; prevents unmount-race crash and Places API geometry-null crash in the map search feature).

**Proposed actions:**
- Define `ChartDataPoint = Record<string, string | number>` in `types/chart.ts` and replace `data: any[]` in `PM25TrendChart.tsx:15`, `AQITrendChart.tsx:15`, `WeatherForecastChart.tsx:14`, `TemperaturePrecipitationChart.tsx:15`, `AccessibleChart.tsx:66` — L/M effort (~15 lines; catches silent Recharts key-mismatch failures at compile time)
- Extract `ForecastDay` interface to `types/weather.ts` and replace 12 `any` annotations in `useDashboardData.ts:179,197,199,223,241,243,267,285,287,311,330,332` — L/L effort (~10 lines; eliminates entire copy-paste `any` cluster across 4 parallel functions)
- Replace `Record<string, any>` at `Dashboard.tsx:118` with `Record<string, number | string>` and replace `.find()!` at line 113 with a dedup-filter — L/L effort (~4 lines; closes end-to-end `any` chain to Recharts)
- Add null guard in `MapView.tsx:393-394` async callback: `if (!mapInstanceRef.current || !results[0].geometry?.location) return;` — L/L effort (~3 lines; prevents stale-ref crash on unmount and Places API geometry-null crash)

## 📚 Archive (one line per past run)
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
