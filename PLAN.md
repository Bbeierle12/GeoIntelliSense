# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-06T07:10:00Z
Last run: #182 — Lens: Module boundaries

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
### Run #182 — 2026-06-06 — Lens: Module boundaries
**Scope:** Thirteenth Module boundaries pass. Files examined in full: `hooks/useRealtimeAQI.ts`; `components/3d/CityMarkers.tsx`; `components/3d/index.ts`; `components/AirQualityMapView.tsx`; `utils/geo3d.ts`; `geointellisense-analytics/app/source_toggles.py`; `geointellisense-analytics/app/routes/fires.py`; `geointellisense-analytics/app/routes/inversion.py`; `geointellisense-analytics/app/routes/water.py`; `geointellisense-analytics/app/routes/nws_forecast.py`; `geointellisense-analytics/app/routes/airnow.py`; `geointellisense-analytics/app/routes/water_quality.py`; `geointellisense-analytics/app/routes/admin.py`; `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/context.py`; `geointellisense-ingestion/src/aqi.rs`; `geointellisense-ingestion/src/routes/aqi.rs`; `geointellisense-ingestion/src/broadcast.rs`. Cross-checked against Active Recommendations and archived Module boundaries runs #2, #17, #32, #47, #62, #77, #92, #107, #122, #137, #152, #167 to confirm findings are new.

**Findings:**

- OBSERVATION: `hooks/useRealtimeAQI.ts:8` imports `import type { CityData } from '../components/3d/CityMarkers'` and at line 15 declares `export interface RealtimeCityData extends CityData`. This creates an architectural inversion: a data-layer hook (`hooks/`) has a compile-time dependency on a presentation-layer 3D component (`components/3d/CityMarkers.tsx`). `CityData` (defined at `CityMarkers.tsx:20-30`) is a rendering-agnostic data shape (`{ id, name, lat, lng, aqi, temperature?, humidity?, windSpeed?, pm25? }`) with no THREE.js-specific fields, yet it lives inside the 3D component file. Any refactor that moves, renames, or splits `CityMarkers.tsx` — e.g., extracting it into a different 3D library — breaks the hook's type import. The `AirQualityMapView.tsx:30` imports `CityData` from `'./3d'` (the barrel); the barrel re-exports from `CityMarkers.tsx:16`. So the type flows: `hooks/useRealtimeAQI.ts → components/3d/CityMarkers.tsx → (Three.js/react-three-fiber)`. A data hook should never depend on a component module with external rendering framework dependencies. PROPOSAL: Move `CityData` to `types.ts` (which already exists and defines `GroundingChunk`, `TemperatureUnit`, etc.) as a top-level interface; update `CityMarkers.tsx` to import `CityData` from `../../types`; update `useRealtimeAQI.ts:8` to `import type { CityData } from '../types'`; update the barrel re-export in `components/3d/index.ts:16` to `export type { CityData } from '../../types'` — L/L effort (three import updates; severs the hook's compile-time coupling to a Three.js-resident component file and makes `CityData` discoverable in the canonical types location).

- OBSERVATION: `components/AirQualityMapView.tsx:44-51` defines a local constant `const CITY_ELEVATIONS: Record<string, number> = { 'Bakersfield': 404, 'Fresno': 308, 'Visalia': 334, 'Merced': 174, 'Modesto': 91, 'Stockton': 13 }` (values in **feet**, used for hover card display at line 173: `{CITY_ELEVATIONS[city.name] || 'N/A'} ft`). `utils/geo3d.ts:274` exports `export const CITY_ELEVATIONS: Record<string, number> = { Bakersfield: 123, Fresno: 94, Visalia: 102, Merced: 53, Modesto: 28, Stockton: 4 }` (values in **meters**, used by `CityMarkers.tsx:76` for 3D terrain height scaling). Both constants are named identically, both cover the same six SJV cities, but they use different units with no annotation. There is no canonical source of truth that relates the two: when a new city is added to the platform (e.g., Hanford), a developer must update both files, in different units, with no compiler or linter enforcement. A developer who adds a city to `geo3d.ts` in meters will not see a type error or warning when `AirQualityMapView.tsx` returns `undefined` for the same city (the `|| 'N/A'` fallback at line 173 silently masks the omission). PROPOSAL: In `utils/geo3d.ts`, add a companion export `export const CITY_ELEVATIONS_FT: Record<string, number>` derived from the existing meters table (e.g., `Object.fromEntries(Object.entries(CITY_ELEVATIONS).map(([k, v]) => [k, Math.round(v * 3.28084)]))`); in `AirQualityMapView.tsx:44`, remove the local definition and add `import { CITY_ELEVATIONS_FT } from '../utils/geo3d'`, replacing `CITY_ELEVATIONS[city.name]` at line 173 with `CITY_ELEVATIONS_FT[city.name]` — L/L effort (one derived export + one import replacement; makes both units derive from a single source of truth so city additions in `geo3d.ts` propagate automatically to the hover card display).

- OBSERVATION: `source_toggles.is_enabled` is imported lazily inside polling loop bodies in six route files — a total of 12 in-function `from app.source_toggles import is_enabled` statements: `fires.py:45,112`; `inversion.py:38,85`; `water.py:35,118`; `nws_forecast.py:41,100`; `airnow.py:30,75`; `water_quality.py:327`. By contrast, `admin.py:6` imports it at module top level as `from app.source_toggles import SOURCES, is_enabled, set_enabled, get_all_states`. The deferred pattern was presumably adopted to avoid a circular import, but `source_toggles.py` only imports `app.cache` (`get_redis`) — it has no dependency on any of these route modules, so no circular import can exist. The practical consequence: a rename of `is_enabled` (e.g., to `is_source_enabled` for clarity) would not produce an `ImportError` at module load time, because the import is never executed until a polling loop fires. In production this means a breaking rename would go undetected through startup and first requests, only surfacing as an exception inside an asyncio task at the next poll interval (up to 30 minutes for inversion, 15 for water), with no traceback visible to a health-check endpoint. PROPOSAL: Move all 12 deferred `from app.source_toggles import is_enabled` statements to module-level top imports in each of the six files — `fires.py`, `inversion.py`, `water.py`, `nws_forecast.py`, `airnow.py`, `water_quality.py` — matching `admin.py`'s pattern — L/L effort (12 statement relocations, no logic change; makes import failures visible at startup rather than after the first polling cycle).

- OBSERVATION: `claude.py:get_system_with_live_context()` (lines 78–117) implements a two-path context assembly with a leaky abstraction at the fallback boundary. The primary path calls `from app.context import build_context_text` and injects the full multi-source context (AQI, forecast, fires, earthquakes, water, inversion, prediction). On any `Exception` from `build_context_text`, the fallback calls `from app.routes.fires import get_current_smoke_context` directly, injecting only fire data. However, `app.context` already encapsulates fire data internally via `_get_fire_context()` (context.py:~460), which itself calls `from app.routes.fires import get_current_smoke_context`. This means the fallback in `claude.py` bypasses the `context.py` abstraction boundary by reaching directly into `app.routes.fires` — the same internal detail that `context.py` already manages. More critically, the fallback swallows the original exception (logged only as a warning) and returns a partial system prompt to Claude with no indication that AQI, forecast, earthquake, water, and inversion data are all absent — Claude will reason as if "no fires are currently active" means air quality is good, without knowing DB/network context was unavailable. PROPOSAL: Remove the direct `from app.routes.fires` fallback in `claude.py:103-109`; instead, catch specific exceptions (`asyncio.TimeoutError`, `OSError`) rather than bare `Exception` in the primary path; if `build_context_text` fails, inject a single diagnostic line `"NOTE: live data context unavailable — DB/network error; respond based on training knowledge only"` into the system prompt as the fallback — L/L effort (removes the cross-boundary dependency on `app.routes.fires` from `claude.py`; makes context unavailability explicit to Claude rather than causing it to silently reason from incomplete context).

**Proposed actions:**
- Move `CityData` interface from `components/3d/CityMarkers.tsx:20` to `types.ts`; update imports in `CityMarkers.tsx`, `useRealtimeAQI.ts:8`, and `components/3d/index.ts:16` — L/L effort (severs hook-to-3D-component compile-time coupling; places shared type in canonical location)
- Add `CITY_ELEVATIONS_FT` derived export to `utils/geo3d.ts`; replace local definition at `AirQualityMapView.tsx:44-51` with import from `geo3d` — L/L effort (single source of truth for city elevations; auto-propagates new cities from geo3d to hover card display)
- Promote 12 deferred `from app.source_toggles import is_enabled` statements to module-level in `fires.py`, `inversion.py`, `water.py`, `nws_forecast.py`, `airnow.py`, `water_quality.py` — L/L effort (makes breaking renames detectable at startup rather than silently at next poll interval)
- Remove direct `app.routes.fires` fallback from `claude.py:103-109`; inject explicit context-unavailable diagnostic line on `build_context_text` failure — L/L effort (removes cross-boundary coupling; makes live context failures visible to Claude rather than silently degrading to fire-only)

### Run #181 — 2026-06-06 — Lens: Type safety
**Scope:** Thirteenth Type safety pass. Files examined in full: `data/dashboardData.ts`; `hooks/useDashboardData.ts`; `components/DataExplorer.tsx`; `components/AccessibleChart.tsx`; `components/Dashboard.tsx`; `components/charts/AQITrendChart.tsx`; `components/charts/PM25TrendChart.tsx`; `components/charts/TemperaturePrecipitationChart.tsx`; `components/charts/WeatherForecastChart.tsx`; `services/AirQualityService.ts`; `services/WeatherService.ts`; `services/dataService.ts`; `hooks/useLiveData.ts`; `utils/errorHandling.ts`; `tsconfig.json`. Cross-checked against Active Recommendations and archived Type safety runs #1, #16, #31, #46, #61, #76, #91, #106, #121, #136, #151, #166 to confirm findings are new.

**Findings:**

- OBSERVATION: `data/dashboardData.ts:195` and `hooks/useDashboardData.ts:179,223,267,311` — `generateDailyForecast(location, days)` at `dashboardData.ts:195` has no explicit return type annotation, but TypeScript infers a precise structural type from the literal objects pushed to `forecast[]` at lines 297–332: `{ date: string; dayOfWeek: string; temp: { current: number; min: number; max: number; feelsLike: number }; humidity: number; wind: { speed: number; gust: number; direction: string }; uv: number; precipitation: { probability: number; amount: number; type: string }; solarRadiation: number; evapotranspiration: number; ...hourlyData: Array<...> }`. This inferred type is available on every `locEntry.dailyForecast` array access in `useDashboardData.ts`. However, all four `forEach` loops — at lines 179, 223, 267, and 311 — annotate the iteration variable as `day: any`, erasing the inferred type entirely. As a result, TypeScript silently allows `day.humidity`, `day.wind.speed`, `day.uv`, `day.evapotranspiration`, and `day.solarRadiation` without checking field existence: if `generateDailyForecast` were refactored to rename `evapotranspiration` to `et0` (its own local variable name), all four callsites would silently read `undefined` at runtime while TypeScript reports no error. PROPOSAL: Add an exported type alias `export type DailyForecastEntry = ReturnType<typeof generateDailyForecast>[number]` at `dashboardData.ts:337` immediately before the `LocationKey` export; replace `day: any` with `day: DailyForecastEntry` at `useDashboardData.ts:179,223,267,311` — L/L effort (one type alias + four annotation replacements; eliminates the `any` erasure and makes field renames in `generateDailyForecast` produce compile errors rather than silent `undefined`s at runtime).

- OBSERVATION: `components/DataExplorer.tsx:37-44` and `components/DataExplorer.tsx:78-87` — The `ExploreResponse` interface at line 37 types the API data as `data: Array<Record<string, any>>`. The chart rendering block at lines 78–87 maps over this array as `data.data.map(d => ({ ...d, time: new Date(d.time).toLocaleDateString(...) }))`. Since `d` is `Record<string, any>`, `d.time` is of type `any` — TypeScript does not enforce that `time` is a string. If `explore.py` returns a row without a `time` key (e.g., a partial row during a data gap), `new Date(undefined)` produces `Invalid Date` silently; the chart receives `"Invalid Date"` as the x-axis label with no compile-time or runtime indication that a structural mismatch occurred. The `corrMatrix` at line 92 is typed `Record<string, Record<string, number>>` from the interface but is populated from `data?.correlations`, which is also unvalidated. PROPOSAL: Narrow `ExploreResponse.data` to `Array<{ time: string } & Record<string, number | null>>` at `DataExplorer.tsx:42` — this preserves the dynamic key pattern while requiring `time` to be present and typed; add a `?.` optional chain at `DataExplorer.tsx:82` (`new Date(d.time ?? '').toLocaleDateString(...)`) to handle absent `time` gracefully — L/L effort (one interface field change + one optional chain; eliminates silent `Invalid Date` x-axis labels from structural API mismatches).

- OBSERVATION: `hooks/useDashboardData.ts:197-199,241-243,285-287,330-332` — Four `useMemo` blocks (`mergedHumidityData`, `mergedWindData`, `mergedUVData`, `mergedAgriculturalData`) each declare `const result: any[]` and push `const entry: any = { month }`. These arrays are the return values of the hook and are consumed as the `data` prop by chart components. Because `result` is `any[]`, TypeScript will not catch: (a) a typo in a key name (e.g., `entry[loc] = day.uv` vs. `entry[loc] = day.uV`); (b) a numeric key being passed as a string (e.g., `entry[loc] = day.evapotranspiration` produces `number`, but if `calculateET0` were changed to return `string`, the chart renderer would receive a string instead of a number with no type error); (c) a missing aggregator field (e.g., `entry[${loc}_et0]` vs. `entry[${loc}_solar]` — both are correctly spelled here but TypeScript has no way to verify it). All four blocks follow the identical shape `{ month: string, [key: string]: string | number }`, which TypeScript can express as an index signature type. PROPOSAL: Replace `const result: any[]` and `const entry: any` with `const result: Array<{ month: string } & Record<string, number>>` and `const entry: { month: string } & Record<string, number> = { month }` in all four useMemo blocks — L/L effort (8 type annotation changes across 4 blocks; enables TypeScript to type-check aggregation writes and catches key-name mismatches at compile time).

- OBSERVATION: `components/Dashboard.tsx:113` — The active-alerts `useMemo` at lines 99–115 builds an `alerts` array, deduplicates names via a `Set`, then reconstructs via `.map(name => alerts.find(a => a.name === name)!)`. The non-null assertion `!` at the end suppresses TypeScript's awareness that `Array.prototype.find()` returns `T | undefined`. The invariant that the name came from the same `alerts` array makes the `!` logically safe today, but TypeScript cannot verify this: if a future refactor filters or transforms `alerts` between the `Set` construction and the `.find()` call (e.g., adding a deduplicate-by-aqi step that removes lower entries), the `!` will promote `undefined` to `{name: string; aqi: number}` and cause a `TypeError` at render time with no compile-time warning. The `alerts.find(...)!` pattern appears only here in the codebase and is the single use of a non-null assertion on a `find()` result. PROPOSAL: Replace the two-step deduplication at `Dashboard.tsx:111-113` with a `Map`-based deduplication that is both type-safe and logically equivalent: `const seen = new Map<string, {name: string; aqi: number}>(); alerts.forEach(a => { if (!seen.has(a.name)) seen.set(a.name, a); }); return Array.from(seen.values())` — the `Map` lookup never returns `undefined` and the `Array.from` produces a correctly typed result — L/L effort (4-line refactor; eliminates the non-null assertion on `find()` and makes the deduplication logic explicit and type-safe).

**Proposed actions:**
- Export `DailyForecastEntry = ReturnType<typeof generateDailyForecast>[number]` from `dashboardData.ts:337`; replace `day: any` with `day: DailyForecastEntry` at `useDashboardData.ts:179,223,267,311` — L/L effort (restores inferred type safety to all four `dailyForecast` forEach loops)
- Narrow `ExploreResponse.data` to `Array<{ time: string } & Record<string, number | null>>` at `DataExplorer.tsx:42`; add optional chain at line 82 — L/L effort (prevents silent `Invalid Date` x-axis labels from API structural mismatches)
- Replace `result: any[]` / `entry: any` with typed index-signature types in all four `useMemo` blocks at `useDashboardData.ts:197-199,241-243,285-287,330-332` — L/L effort (makes aggregation key writes type-checkable)
- Replace `alerts.find(...)!` non-null assertion at `Dashboard.tsx:113` with `Map`-based deduplication — L/L effort (eliminates unsafe non-null assertion on `find()`; makes deduplication logic type-safe)

### Run #180 — 2026-06-06 — Lens: Live-time claim audit
**Scope:** Twelfth Live-time claim audit pass. Files examined in full: `geointellisense-ingestion/src/routes/aqi.rs`; `geointellisense-ingestion/src/aqi.rs`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/routes/sse.rs`; `hooks/useRealtimeAQI.ts`; `hooks/useLiveData.ts`; `services/WeatherService.ts`; `components/AirQualityMapView.tsx`; `components/dashboard/widgets/AqiTrendWidget.tsx`; `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/context.py`; `data/dashboardData.ts`. Cross-checked against Active Recommendations and archived Live-time audit runs #15, #30, #45, #60, #75, #90, #105, #120, #135, #150, #165 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/routes/aqi.rs:64-73` — The `history` handler unconditionally calls `aqi::generate_history(&params.station_id, hours)` (line 66) which produces a synthetic random walk from `base_aqi=85.0` (Bakersfield station `0002`) or `60.0` (all others), anchored to `Utc::now()` and stepped backward in 5-minute increments. No SQL query is issued against the PostgreSQL database where `persist::write_readings()` (`broadcast.rs:115`) stores actual AQI readings from PurpleAir. `AqiTrendWidget.tsx:20-22` polls `/api/aqi-history?station_id=AQ-001&hours=24` every 120 seconds and renders the result as a "AQI Trend (24h)" recharts `LineChart` with genuine timestamps and labeled PM2.5 and AQI axes. Because `generate_history` reseeds on every call, the 288-point trend line is completely regenerated on each 2-minute poll — so two successive renders may show AQI swinging from 45 to 120 and back regardless of actual SJV air quality. Users relying on this chart for planning (e.g., outdoor work scheduling) see fabricated history, not real measured values. The persisted readings table is populated and queried elsewhere in the analytics service; the ingestion service simply does not expose it. PROPOSAL: Replace `aqi::generate_history()` in `routes/aqi.rs:66` with a SQL query: `SELECT timestamp, aqi, pm25, pm10, o3 FROM aqi_readings WHERE station_id = $1 AND timestamp >= NOW() - $2 * INTERVAL '1 hour' ORDER BY timestamp` against the service's `PgPool` (`AppState.pool`); fall back to `generate_history` only when the query returns zero rows (i.e., DB not yet seeded) — M/M effort (add pool to handler signature; one SQL query; eliminates synthetic 24-hour trend and makes chart reflect actual measured air quality history).

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:107-109` AND `routes/aqi.rs:24` — Both the SSE broadcast loop and the REST snapshot handler overwrite the original PurpleAir reading timestamp with `now` before sending: `AqiReading { timestamp: now, ..r.clone() }`. The PurpleAir fetch cycle runs at `PURPLEAIR_SECS` (separate interval from `BROADCAST_INTERVAL_SECS` at `docker-compose.yml:55-57`). If the PurpleAir API returns an error or the Redis toggle check at `broadcast.rs:62-74` skips the fetch (e.g., because Redis is briefly unavailable), the last successful reading remains in `cache` unchanged. The broadcast loop continues emitting this stale reading every broadcast cycle with `timestamp: now` — so a reading cached 10 or 30 minutes ago is presented with the current wall-clock time. The frontend hook `useRealtimeAQI.ts:339` sets `setLastUpdate(new Date())` on SSE event receipt — this is the SSE delivery time, not the original sensor measurement time. The `'🔴 Live'` badge at `AirQualityMapView.tsx:413` shows whenever `isConnected = true` (SSE open), regardless of how old the underlying data is. Concretely: if PurpleAir's API has a 20-minute outage, users see the pre-outage cached reading served every 5 seconds with a current timestamp and a live indicator. PROPOSAL: Preserve the original `timestamp` from the PurpleAir reading in the broadcast and snapshot paths (remove the `timestamp: now` override in `broadcast.rs:107` and `routes/aqi.rs:24`); add a `fetchedAt: now` field to `AqiReading` to record the cache-hit time separately; in `AirQualityMapView.tsx:413-416`, display the original reading timestamp rather than the SSE arrival time, and change the badge to `'🔴 Live'` only when `(now - lastReadingTimestamp) < 5 * 60 * 1000` (5-minute staleness threshold) — L/L effort (two-line change in Rust, one timestamp comparison in React; exposes actual data age to users and prevents stale-cache readings from appearing fresh).

- OBSERVATION: `services/WeatherService.ts:78-91` — The `getCurrentWeather()` method returns a `WeatherData` object where `pressure: 1013`, `cloudCover: 20`, `icon: '01d'`, and `solarRadiation: 600` are hardcoded constants (lines 83-88), never sourced from any sensor, forecast API, or AQI snapshot field. The `description` field is set to `'Live data'` (line 86) regardless of whether the underlying `aqi-snapshot` served PurpleAir readings or `aqi::generate_readings()` mock data. The `solarRadiation: 600` constant is passed to `calculateET0()` at line 89 to compute evapotranspiration — a formula that requires accurate solar radiation to produce agronomically valid irrigation estimates. At midnight, solar radiation is 0 W/m²; `calculateET0` with `solarRadiation=600` computes an ET0 roughly 3× higher than reality. The `icon: '01d'` value always renders as "clear sky, day" in any weather icon library (OpenWeatherMap naming convention), so nighttime and overcast conditions are always shown as clear daytime. Any UI component that renders `cloudCover` or `pressure` (or derives irrigation schedules from `et0`) will show static placeholder values with a 'Live data' label. PROPOSAL: Replace `solarRadiation: 600` with a time-of-day estimate: `const hour = new Date().getHours(); const solarRadiation = Math.max(0, Math.sin(Math.PI * (hour - 6) / 12) * 800)` (a sinusoidal daytime approximation — zero at night, peaks ~800 W/m² at solar noon) as an immediate improvement; add `NWS forecast` or `open-meteo` as a source for `pressure` and `cloudCover` when a real weather API is available; remove the hardcoded `description: 'Live data'` and instead derive it from the nearest reading's `source` field (`reading.source === 'purpleair' ? 'Live sensor data' : 'Simulated data'`) — L/M effort (sinusoidal solar radiation: 3 lines; source-aware description: 2 lines; eliminates midnight ET0 overestimation and removes 'Live data' label on mock-source responses).

- OBSERVATION: `components/AirQualityMapView.tsx:284-293` — The `metrics` object computed in the `useMemo` block unconditionally hardcodes `dominantPollutant: 'PM2.5'` and `affectedPopulation: 4200000` even when real SSE data is available (`realtimeStats` is defined, line 285). The SSE `aqi-update` event delivers per-station `o3`, `no2`, `pm10`, and `pm25` fields for all cities (parsed at `useRealtimeAQI.ts:309-323`), so the actual dominant pollutant is computable from the current readings. `affectedPopulation: 4200000` is a static approximation of the San Joaquin Valley's total population — it never reflects which cities are above unhealthy thresholds (AQI > 100) at the current moment. A `MetricsPanel` component renders both fields as live statistics in the 3D visualization panel; users see "Dominant pollutant: PM2.5" and "Affected population: 4,200,000" as if these are dynamically calculated from live data. On days when ozone is the leading pollutant (common SJV summer afternoons), or when only Bakersfield is above threshold (affecting ~400,000), the panel shows materially incorrect values. PROPOSAL: Replace the hardcoded `dominantPollutant: 'PM2.5'` with a computed value: find the pollutant with the highest average across all `realtimeCities` readings (compare `avg(pm25) * 10`, `avg(o3) * 1000`, `avg(no2) * 500` to produce comparable AQI-proxy scales, then pick the leader); replace `affectedPopulation: 4200000` with `realtimeCities.filter(c => c.aqi > 100).reduce((sum, c) => sum + (CITY_POPULATION[c.name] || 0), 0)` using a small static lookup of the six SJV city populations (~400K–550K each) — L/L effort (two computed values replacing two hardcoded constants; makes MetricsPanel reflect real-time pollutant leadership and accurate affected-population estimates for the current air quality episode).

**Proposed actions:**
- Replace `aqi::generate_history()` in `routes/aqi.rs:66` with a SQL query against `aqi_readings` table; fall back to mock only when zero rows returned — M/M effort (makes AQI trend chart reflect actual measured history rather than freshly randomized synthetic data)
- Remove `timestamp: now` override in `broadcast.rs:107` and `routes/aqi.rs:24`; add `fetchedAt` field; update `AirQualityMapView.tsx:413` live badge to check data age — L/L effort (prevents stale cached readings from appearing current to users)
- Replace `solarRadiation: 600` in `WeatherService.ts:88` with sinusoidal daytime estimate; remove hardcoded `description: 'Live data'` — L/M effort (corrects nighttime ET0 overestimation; removes 'Live data' label on mock-sourced weather responses)
- Replace hardcoded `dominantPollutant` and `affectedPopulation` in `AirQualityMapView.tsx:292-293` with computed values from real-time city readings — L/L effort (makes MetricsPanel reflect actual dominant pollutant and affected population for the current air quality episode)

## 📚 Archive (one line per past run)
- Run #179 (2026-06-06) — Lens: Competitive scan (web) — 4 findings — 0 promoted to Active
- Run #178 (2026-06-06) — Lens: LLM integration quality — 4 findings — 0 promoted to Active
- Run #177 (2026-06-06) — Lens: Deployment / Docker — 4 findings — 0 promoted to Active
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
