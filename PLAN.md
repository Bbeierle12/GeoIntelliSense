# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-08T06:20:00Z
Last run: #210 — Lens: Live-time claim audit

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
### Run #210 — 2026-06-08 — Lens: Live-time claim audit
**Scope:** Fifteenth live-time claim audit pass. Files examined in full: `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/routes/inversion.py`, `geointellisense-analytics/app/routes/water.py`. Cross-checked against Active Recommendations and archived live-time runs #15, #30, #45, #60, #75, #90, #105, #120, #135, #150, #165, #180, #195 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:106-108` — The broadcast ticker loop (`spawn_ticker`) runs every `broadcast_secs` seconds (default 5s) and publishes AQI readings to all SSE subscribers. On each tick it reads the `LiveCache` (populated by the PurpleAir fetcher every `purpleair_secs` seconds, default 120s) and constructs outbound readings with `AqiReading { timestamp: now, ..r.clone() }` where `now = chrono::Utc::now()` is evaluated at broadcast time, not at fetch time. Between PurpleAir fetches (e.g., from T=0s to T=120s), the broadcast loop fires 24 times (every 5s) and each time brands the same stale PurpleAir sensor values with a freshly-minted `Utc::now()` timestamp. The frontend's `useRealtimeAQI` hook extracts `timestamp` from each SSE event and displays it as the reading time — so a user sees a sensor value that is 110 seconds old labelled with a timestamp 110 seconds in the future relative to when it was actually measured. The fix is to preserve the original sensor timestamp: change `AqiReading { timestamp: now, ..r.clone() }` to simply `r.clone()` (since `r.timestamp` was set when PurpleAir returned the reading). The `now` timestamp is still useful for the Redis heartbeat (`redis_cache::set_heartbeat`) and persist call but should not be stamped onto the reading itself. PROPOSAL: Remove timestamp overwrite at `broadcast.rs:107-108` — replace `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()` with `live.clone()` — L/L effort (1 line change; ensures SSE-broadcast timestamps reflect actual sensor measurement time rather than broadcast time, eliminating fabricated freshness signal).

- OBSERVATION: `geointellisense-analytics/app/context.py:57` vs. `context.py:82-91` — `build_live_context()` initialises `context["sources"]` as an empty dict `{}` (line 57) and none of the eight downstream fetchers (`_get_aqi_context`, `_get_forecast_context`, etc.) writes into it. Each fetcher attaches its freshness dict to its own key (e.g., `context["aqi"]["freshness"]`, `context["fires"]["freshness"]`), but `build_context_text()` reads freshness from `ctx.get("sources", {}).items()` (line 82), which is always the empty initialised dict. As a result, the three staleness-aware header lines — `LIVE data sources: …` (line 87), `STALE data sources (may be outdated): …` (line 89), and `⚠ IMPORTANT: Stale data sources may not reflect current conditions.` (line 186) — are all unreachable dead code. Claude's system prompt never receives any staleness warning regardless of how old the underlying data is. The fix is to populate `context["sources"]` from the freshness sub-dicts: after all eight `context[key] = await ...` calls in `build_live_context()`, add a line that extracts each source's freshness status — e.g., `context["sources"] = {k: v["freshness"] for k, v in context.items() if isinstance(v, dict) and "freshness" in v}`. PROPOSAL: Populate `context["sources"]` from per-source freshness dicts at the end of `build_live_context()` (`context.py:70`) — H/L effort (~3 lines; re-activates the existing staleness-warning infrastructure so Claude correctly receives "STALE data sources" caveats when data is outdated, as originally intended).

- OBSERVATION: `geointellisense-analytics/app/context.py:394-399` vs. `geointellisense-analytics/app/routes/water.py:16,52` — `_get_water_context()` queries the DB with `WHERE time > now() - interval '2 hours'` to find recent water readings for Claude's system prompt. The USGS water background poller (`water.py:52`) runs every 900 seconds (15 min) with a 900-second cache TTL. The maximum staleness for data served via the `/api/water/current` endpoint is therefore ~1800s (30 min). But the context builder's 2-hour window allows it to present to Claude water readings up to 7200 seconds (2 hours) old — a 4× larger staleness window than what the endpoint exposes to the frontend. A user sees "current" water levels on the dashboard (max 30 min old); Claude's AI reasoning context can contain water values up to 2 hours old for the same query. The source interval in `SOURCE_INTERVALS["water"] = 900` marks data as stale after `900 * 2 = 1800` seconds, but because the dead `sources` dict bug (finding above) prevents that warning from reaching Claude, even the 2-hour-old readings appear without any staleness caveat in Claude's reasoning context. PROPOSAL: Tighten the water context query window at `context.py:398` from `'2 hours'` to `'30 minutes'` — L/L effort (1 character change; aligns the AI context freshness window with the polling interval, prevents Claude from reasoning from 2-hour-old water data labeled as current conditions).

- OBSERVATION: `geointellisense-analytics/app/context.py:67` — `_get_inversion_context()` is the only synchronous (non-async) call in `build_live_context()`. It reads the module-level `_current_status` variable from `geointellisense-analytics/app/routes/inversion.py:22`. On analytics service cold start, `_current_status = None` (line 22). `start_inversion_polling()` spawns the background task at lifespan startup (`main.py`), but the first `get_inversion_status()` call inside `_poll_loop()` must complete before `_current_status` is set — and `_poll_loop()` runs via `asyncio.create_task()` which yields to the event loop rather than blocking startup. The inversion status endpoint's first poll fires after the task scheduler's first `interval.tick()`, which for a `time::interval`-style task fires immediately, but `asyncio.create_task` with `asyncio.sleep(1800)` at the tail means a service restart causes `_current_status = None` to persist until the first poll completes — which can be delayed if the external NWS sounding API is slow or unavailable. During this window (potentially several minutes or longer on API timeout), every call to `build_live_context()` receives `None` for inversion context, which silently omits the `── Temperature Inversion Status ──` section from Claude's system prompt — with no warning or indication that the data is missing. On a day with an active thermal inversion (common in SJV winter months), Claude would reason about AQI without the inversion context that normally explains why pollutants are trapped. PROPOSAL: Add an explicit cold-start fallback in `_get_inversion_context()` or in the caller at `context.py:67` that checks whether the status is `None` and returns a dict with `status = "unavailable"` rather than silently omitting the entire section — L/L effort (~5 lines; restores `⚠ UNAVAILABLE: inversion status` warning to system prompt during polling gaps, rather than silently dropping the section).

**Proposed actions:**
- Remove timestamp overwrite at `broadcast.rs:107-108` — replace fabricated `now` timestamp on cached readings with original sensor measurement timestamp — L/L effort (1 line; fixes SSE-broadcast timestamps reflecting broadcast time rather than sensor measurement time)
- Populate `context["sources"]` from per-source freshness dicts at end of `build_live_context()` at `context.py:70` — H/L effort (~3 lines; re-activates dead staleness-warning code so Claude receives "STALE data sources" caveats as intended)
- Tighten water context query window at `context.py:398` from `'2 hours'` to `'30 minutes'` — L/L effort (1 change; aligns AI context staleness window with frontend and polling interval)
- Add `None`-guard in `_get_inversion_context()` returning `{"status": "unavailable"}` on cold start — L/L effort (~5 lines; prevents silent omission of inversion section in Claude prompts during startup/polling gaps)

### Run #209 — 2026-06-08 — Lens: Competitive scan (web)
**Scope:** Fifteenth competitive scan pass. Sources consulted: IQAir AirVisual product pages, Plume Labs Air Report feature listing (aqitocigarettescalculator.org/blog/best-air-quality-apps-2026), Google Air Quality API / BreezoMeter documentation (developers.google.com/maps/documentation/air-quality), WeAIR wearable swarm deployment coverage (World Economic Forum, February 2026), arXiv 2505.10556v2 (AI-Respire: personalized pollution health response, May 2025), AirGradient UNDP toolkit data-sharing documentation. Cross-checked against Active Recommendations and archived competitive scan runs #14, #29, #44, #59, #74, #89, #104, #119, #134, #149, #164, #179, #194 to confirm findings are new.

**Findings:**

- OBSERVATION: `AI-Respire framework (arXiv 2505.10556v2, May 2025)` demonstrates a production-viable architecture that predicts individualized cardiorespiratory responses to pollution by combining smartwatch physiological data (heart rate, respiratory rate, step count from Apple Health, Fitbit, Garmin) with real-time environmental sensor readings via an Adversarial Autoencoder with LSTM layers and transfer learning fine-tuned per user. Outputs are physiologically grounded: breathing rate ±3.5% and heart rate ±2.5% under extreme pollution scenarios, validated against clinical biomarkers (FeNO, asthma burden scores). GeoIntelliSense has zero per-user physiological profile infrastructure: no user account schema, no OAuth flow for health APIs, and all seven Claude route handlers embed population-average WHO/EPA thresholds in their system prompts with no per-session health sensitivity weighting. The `context.py` live context builder constructs a uniform system prompt for all users regardless of age, health conditions, or activity level. Competing apps (IQAir, Plume Labs) already offer condition-based UI differentiation for "sensitive groups"; the research frontier represented by AI-Respire moves toward true physiological personalization — predicting individual health impact before symptoms emerge, not merely broadcasting a shared population-level AQI threshold. PROPOSAL: Define a user preference schema (health conditions, age group, activity level) stored in `UserPreferencesContext` (already exists at `contexts/UserPreferencesContext.tsx`), pass it as a system-prompt injection modifier in `context.py`, and document the wearable OAuth integration path as a future milestone — L/M effort for the preference injection (~15 lines across context and preferences); H/H effort for full wearable API integration.

- OBSERVATION: `Plume Labs Air Report` offers two distinct features absent from every GeoIntelliSense view: (a) a **Personal AQI** — cumulative daily pollution exposure that accounts for time spent indoors vs. outdoors and current activity (resting, walking, cycling) rather than displaying a single ambient reading — and (b) an **Activity recommendation** widget that proactively identifies the lowest-pollution hour window in the coming 24 hours for outdoor exercise using hourly AQI forecasts. GeoIntelliSense's `Dashboard.tsx` LiveDashboard displays current sensor readings and historical trends; `geointellisense-analytics/app/routes/predictive_analysis.py` outputs 3-month outlook text; the `low_latency.py` Haiku endpoint can respond to an ad-hoc "when should I exercise today?" query but requires the user to explicitly know to ask. No proactive widget exists in `Dashboard.tsx`, no cumulative daily exposure counter is tracked across a user session, and no hourly-resolution "best exercise window" component appears in any `.tsx` file. The backend prerequisites are largely in place: `nws_forecast.py` provides hourly NWS forecast data, `historical_aqi.py` provides trends, and the `low_latency.py` endpoint already uses Haiku for speed-sensitive interactions. PROPOSAL: Add a "Best Time to Exercise Today" card to `Dashboard.tsx` that calls the `low_latency.py` endpoint with a structured prompt containing today's hourly NWS forecast and current AQI — M/L effort (~30 lines of frontend + a prompt template; no new backend route needed; directly matches a feature Plume Labs advertises as a differentiator).

- OBSERVATION: `WeAIR system (2025, cited in World Economic Forum AI air quality monitoring briefing, February 2026)` deployed wearable swarm sensors among urban volunteers and delivered AI-powered street-by-street route recommendations, achieving a measured 20–30% reduction in participants' daily personal pollution exposure for those who followed the alternative route suggestions. GeoIntelliSense already holds all three infrastructure prerequisites for a minimal version of this feature: (1) the Google Maps JavaScript API is active via `maps_config.py` + `GOOGLE_MAPS_API_KEY`, (2) live sensor snapshot data is available at `/api/aqi-snapshot` from the Rust ingestion service with `lat`/`lng`/`aqi` per reading (`AirQualityService.ts:17-19`), and (3) the nearest-sensor spatial lookup is already implemented in `AirQualityService.ts:56-61` using Euclidean distance. However, `AirQualityMapView.tsx` renders only static station markers with no route-drawing, no polyline AQI interpolation, and no A→B input form. The Google Maps Directions API (already authorized under the same key) returns ordered waypoints along a route; combining these waypoints with the nearest-sensor AQI lookup already in `AirQualityService.ts:56-61` would produce per-waypoint AQI values, and their average would yield a route-level exposure score. PROPOSAL: Add a "Compare Routes" mode to `AirQualityMapView.tsx` with origin + destination inputs, two Directions API calls (e.g., fastest vs. least-polluted), and a side-by-side average AQI score display — M/M effort (~80 lines of frontend + minor extension of `AirQualityService.ts`; leverages existing Google Maps key and sensor snapshot without any new backend route).

- OBSERVATION: `Google Air Quality API (BreezoMeter, integrated 2022)` supports 70+ national AQI index standards simultaneously, enabling apps to display EU CAQI, China National AQI, India NAQI, Australia NEPM, Canada AQHI, and US EPA AQI for the same coordinate. `AirQualityService.ts:13` declares only `usAqi?: number` as an optional index variant; `AirQualityService.ts:63-64` sets `aqi: closest.aqi` and `usAqi: closest.aqi` to the same PurpleAir US AQI integer with no index-system selection. The `AirQualityMapView.tsx` legend and tooltip labels hard-code US EPA category strings ("Good", "Moderate", "Unhealthy for Sensitive Groups", "Very Unhealthy", "Hazardous"). While GeoIntelliSense's sensor data sources are currently US-centric (PurpleAir Central Valley), the Claude AI endpoints (`chat.py`, `deep_analysis.py`, `grounded_search.py`) have no geographic restriction and can receive queries from international users who will receive US-standard AQI interpretations without any caveat or conversion option. As the project's description and marketing language (README references "global" environmental intelligence) imply broader scope, the hard-coded US-only AQI standard is both a UX limitation for international users and a factual accuracy risk for AI responses where Claude interprets a US AQI value for a non-US context. PROPOSAL: Add an `aqiStandard` field to `UserPreferencesContext` (enum: `"us_epa" | "eu_caqi" | "india_naqi" | "china_aqi"`), add a per-standard AQI breakpoint table and color mapping in `AirQualityService.ts`, and display the selected standard label in `AirQualityMapView.tsx` tooltip — M/M effort (~50 lines; non-US users can select a familiar standard while US EPA remains the default).

**Proposed actions:**
- Inject user health preference modifiers (health conditions, age group, activity level) from `UserPreferencesContext` into `context.py` system prompt — L/M effort (~15 lines; closes the population-average-threshold gap vs. Plume Labs / IQAir condition-aware alerts)
- Add "Best Time to Exercise Today" dashboard card calling `low_latency.py` with hourly NWS forecast — M/L effort (~30 lines frontend; no new backend route needed; matches Plume Labs' activity recommendation feature)
- Add "Compare Routes" mode to `AirQualityMapView.tsx` with A→B route comparison using existing Directions API key + nearest-sensor AQI lookup — M/M effort (~80 lines; leverages existing infra; matches WeAIR-validated 20-30% exposure reduction use case)
- Add `aqiStandard` to `UserPreferencesContext` with per-standard breakpoint tables in `AirQualityService.ts` — M/M effort (~50 lines; supports EU/India/China users; eliminates US-only AQI hard-coding)

### Run #208 — 2026-06-08 — Lens: LLM integration quality
**Scope:** Fourteenth LLM integration quality pass. Files examined in full: `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/config.py`, `geointellisense-analytics/app/context.py`, `geointellisense-analytics/app/routes/chat.py`, `geointellisense-analytics/app/routes/deep_analysis.py`, `geointellisense-analytics/app/routes/low_latency.py`, `geointellisense-analytics/app/routes/grounded_search.py`, `geointellisense-analytics/app/routes/grounded_maps.py`, `geointellisense-analytics/app/routes/predictive_analysis.py`, `geointellisense-analytics/app/routes/weather_forecast.py`, `services/aiService.ts`. Cross-checked against Active Recommendations and archived LLM runs #13, #28, #43, #58, #73, #88, #103, #118, #133, #148, #163, #178, #193 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:43,70`, `deep_analysis.py:33,61`, `low_latency.py:31`, `grounded_search.py:39,62`, `grounded_maps.py:46,69`, `predictive_analysis.py:91`, `weather_forecast.py:75` — All 11 Claude API invocations use `client.messages.create(...)` (synchronous), where `client` is an `anthropic.Anthropic` instance returned by `claude.py:get_client()`. All of these call sites live inside `async def` FastAPI route handlers. The `anthropic.Anthropic` client is the synchronous SDK variant and its `.messages.create()` method performs a blocking HTTP call via `httpx.Client`. When a synchronous blocking call runs inside an `async def` coroutine under uvicorn's asyncio event loop, it occupies the single event loop thread for the full duration of the call — typically 1–5 seconds for Haiku, 5–30 seconds for Sonnet, and 30–90+ seconds for Opus with extended thinking (`deep_analysis.py:33`). During this blocking period, the asyncio event loop cannot service any other coroutine: all other concurrent HTTP requests to the analytics service (health checks, water queries, fire queries, AQI snapshots, other chat requests) are queued and cannot make progress. A single `POST /api/deep-analysis` call thus stalls the entire analytics service for up to 90 seconds. The fix is to replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` at `claude.py:74` and change all 11 `.create()` calls to `await client.messages.create(...)` — the Anthropic Python SDK ships `AsyncAnthropic` with an identical interface. PROPOSAL: Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:74` and add `await` to all 11 `messages.create()` call sites — H/M effort (~12 one-line changes across 7 files; eliminates event-loop blocking that currently serializes all analytics service traffic behind each LLM API call).

- OBSERVATION: `geointellisense-analytics/app/claude.py:74-75` — `get_client()` constructs a brand-new `anthropic.Anthropic(api_key=settings.anthropic_api_key)` object on every invocation. The `anthropic.Anthropic` constructor creates a new `httpx.Client` instance with its own connection pool. Every call to any of the 7 Claude-backed route handlers calls `get_client()` (directly or via the imported reference), which means every single LLM API request establishes a new TCP connection + TLS 1.3 handshake to `api.anthropic.com`. TLS handshake overhead to a remote API endpoint is typically 50–250ms (1 full round-trip for TCP + 1–2 for TLS, depending on session resumption availability). This overhead is paid even for the `low_latency.py` endpoint, which uses Haiku specifically for speed. The `httpx.Client` already supports keep-alive connection pooling — the overhead is entirely self-inflicted by creating a new client per request. The fix is a module-level singleton: `_client: anthropic.AsyncAnthropic | None = None` with a `get_client()` that initialises it once and returns the cached instance — or, better, initialise it once at `main.py` lifespan startup and inject it via FastAPI's dependency system. PROPOSAL: Convert `get_client()` at `claude.py:74` to a module-level singleton (or lifespan-scoped dependency) so the underlying `httpx` connection pool is reused across requests — L/L effort (~5 lines; eliminates per-request TLS handshake overhead, especially impactful for the Haiku low-latency endpoint).

- OBSERVATION: `geointellisense-analytics/app/context.py:61-68` — `build_live_context()` awaits each of its seven data-source fetchers sequentially with no concurrency: `context["aqi"] = await _get_aqi_context(pool)`, then `context["forecast"] = await _get_forecast_context(pool)`, then `context["fires"] = await _get_fire_context(pool)`, etc. The seven fetchers are entirely independent: they read from different tables (`sensor_readings`, Redis forecast cache, `fire_detections`, `earthquake_events`, `water_readings`, `census_tracts`) and have no data dependencies on each other. Under asyncpg with a 5ms average round-trip, the sequential chain of 8 awaits (7 DB fetchers + 1 Redis scan) accumulates ~40ms of serial latency minimum, in addition to actual query execution time. Since `build_live_context()` runs on every request that calls `get_system_with_live_context()` when the 60-second module-level cache expires — affecting `/api/chat`, `/api/deep-analysis`, `/api/low-latency`, `/api/grounded-search`, `/api/grounded-maps` — this serial pattern directly adds latency to the user-visible first response after each cache expiry boundary. Replacing lines 61-68 with a single `asyncio.gather(...)` call would reduce total context build time from the sum of all query latencies to the maximum of any single query latency — roughly a 6× speedup for the cold-cache path. PROPOSAL: Replace the sequential `await` chain at `context.py:61-68` with `asyncio.gather(_get_aqi_context(pool), _get_forecast_context(pool), ..., _get_prediction_context(pool))` and unpack the results into the `context` dict — L/L effort (~10 lines; reduces context build latency from sequential sum to concurrent max, directly improving user-facing response time for all AI endpoints on cache-miss).

- OBSERVATION: `geointellisense-analytics/app/routes/weather_forecast.py:75` and `geointellisense-analytics/app/routes/predictive_analysis.py:90` — Both endpoints call `await get_system_with_live_context(FORECAST_SYSTEM)` / `await get_system_with_live_context(PREDICTIVE_SYSTEM)`. These two endpoints receive historical data in the request body and ask Claude to extrapolate statistical trends for the next 3 months — a task that is purely statistical and has no need for real-time sensor data. `get_system_with_live_context()` (`claude.py:78-110`) injects the full live context including AQI station readings, fire detections, earthquake events, water levels, inversion status, ML predictions, and CalEnviroScreen data — a payload of 500–2,000 tokens depending on how many data sources are currently live. `weather_forecast.py:72` explicitly instructs Claude: "Do NOT include any analysis or forecast related to air quality (AQI, PM2.5)" — yet the system prompt immediately preceding this instruction contains AQI readings for multiple stations. The live context is not only irrelevant to the prompt's task but actively contradicts the prompt's own instructions; Claude must expend reasoning effort to reconcile the system-prompt data it has been told to ignore. At `claude-sonnet-4-20250514` input pricing (~$3/MTok), a 1,000-token live context injected on every call to these two endpoints costs ~$0.003/call before any other token use, and is replicated across each tool-continuation round. Since neither endpoint has auth/rate limiting (Active Recommendation row #4), these tokens are also billable for unauthenticated callers. PROPOSAL: Replace `await get_system_with_live_context(PREDICTIVE_SYSTEM)` with `PREDICTIVE_SYSTEM` at `predictive_analysis.py:90` and `await get_system_with_live_context(FORECAST_SYSTEM)` with `FORECAST_SYSTEM` at `weather_forecast.py:75` — L/L effort (~2 one-line changes; eliminates up to 2,000 irrelevant input tokens per call and removes the instruction–context contradiction in the weather forecast prompt).

**Proposed actions:**
- Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:74` and add `await` to all 11 `messages.create()` call sites in `chat.py`, `deep_analysis.py`, `low_latency.py`, `grounded_search.py`, `grounded_maps.py`, `predictive_analysis.py`, `weather_forecast.py` — H/M effort (~12 lines; eliminates event-loop blocking that serializes analytics service traffic behind each LLM API call)
- Convert `claude.py:get_client()` to a module-level singleton so the httpx connection pool is reused — L/L effort (~5 lines; eliminates TLS handshake overhead on every API call)
- Replace sequential `await` chain at `context.py:61-68` with `asyncio.gather(...)` — L/L effort (~10 lines; reduces context build time from serial sum to concurrent max)
- Remove `get_system_with_live_context()` from `predictive_analysis.py:90` and `weather_forecast.py:75`; use base system strings directly — L/L effort (~2 lines; removes irrelevant/contradictory live context from statistical forecast prompts)

## 📚 Archive (one line per past run)
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
