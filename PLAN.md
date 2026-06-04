# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-04T04:15:00Z
Last run: #150 — Lens: Live-time claim audit

## 🎯 Active Recommendations (top 10, re-ranked every run)
| # | Title | Axis | Impact (H/M/L) | Effort (H/M/L) | First seen (run #) | Status |
|---|-------|------|----------------|----------------|--------------------|--------|
| 1 | Sanitize AI result before `dangerouslySetInnerHTML` in `AnalysisView.tsx` | UX/Security | H | L | 7 | Open |
| 2 | Add retry+backoff to Rust `PurpleAirClient::fetch_sensors` | Data pipeline | H | L | 8 | Open |
| 3 | Redis-down skips all PurpleAir/earthquake polling — default toggle to ON when Redis unavailable | Data pipeline | H | L | 8 | Open |
| 4 | Propagate `sessionId` through chat calls in `aiService.ts` | TS↔Py contract | H | L | 6 | Open |
| 5 | `GET /api/maps-config` exposes Google Maps API key to unauthenticated callers | Security | H | L | 9 | Open |
| 6 | `POST /api/predict/train` is unauthenticated — any client can trigger expensive model retraining | Security | H | L | 9 | Open |
| 7 | No logging configuration in analytics `main.py` — all `logger.info/debug` calls silently dropped | Observability | H | L | 10 | Open |
| 8 | Health checks return static `"ok"` without probing DB or Redis — failing containers pass healthcheck | Observability | H | L | 10 | Open |
| 9 | `/api/predictive-analysis` and `/api/weather-forecast` have no auth or rate limiting — any public caller can burn Anthropic credits | Security/LLM | H | L | 13 | Open |
| 10 | `context.py:394` SELECT uses `unit` instead of `units` — water-level data silently absent from all Claude system prompts | Data pipeline | H | L | 113 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #150 — 2026-06-04 — Lens: Live-time claim audit
**Scope:** Tenth live-time claim audit pass. Files examined in full: `geointellisense-ingestion/src/aqi.rs`; `geointellisense-ingestion/src/broadcast.rs`; `geointellisense-ingestion/src/config.rs`; `geointellisense-ingestion/src/routes/aqi.rs`; `geointellisense-ingestion/src/routes/sse.rs`; `hooks/useRealtimeAQI.ts`; `hooks/useLiveData.ts`; `components/dashboard/LiveDashboard.tsx`; `components/dashboard/WidgetShell.tsx`; `components/dashboard/widgets/AqiGaugeWidget.tsx`; `components/dashboard/widgets/AqiTrendWidget.tsx`; `components/dashboard/widgets/FiresWidget.tsx`; `components/dashboard/widgets/AqiForecastWidget.tsx`; `index.html`; `metadata.json`; `.env.local.example`; `geointellisense-analytics/app/context.py` (lines 1–100). Grep scans for "live", "real-time", "mock", "generate" across all TS/Rust/Python. Cross-checked against Active Recommendations and Latest Findings runs #147–#149 plus archived Live-time lens runs #135, #120, #105, #90, #75, #60, #45, #30, #15 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:107` + `geointellisense-ingestion/src/routes/aqi.rs:24` — Both the SSE broadcaster and the REST `/api/aqi-snapshot` endpoint overwrite every sensor reading's original `timestamp` field with `Utc::now()` before sending data to clients. In the broadcast loop (interval default 5 seconds from `config.rs:32`), `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() })` stamps cached readings — which are up to 600 seconds (10 min) old under the default `purpleair_interval_secs = 600` — with the current clock time. The REST snapshot at `aqi.rs:24` does the same: `aqi::AqiReading { timestamp: now, ..r.clone() }`. `WidgetShell.tsx:44-48` renders `lastUpdated.toLocaleTimeString()` as the widget's "last updated" label. `useLiveData.ts:75` sets `lastUpdated = new Date()` on each successful fetch. The result: the "Air Quality Index" widget (`AqiGaugeWidget.tsx`) shows a timestamp that refreshes every 30 seconds (`useLiveData.ts:128`) giving the impression sensor data was just measured, while the underlying PurpleAir sensor values are up to 10 minutes old. No field in the API response carries the actual measurement timestamp. The original `AqiReading.timestamp` field value (the time data was written to the cache by the PurpleAir fetcher task at `broadcast.rs:88`) is discarded before clients see it. PROPOSAL: Preserve the original PurpleAir fetch timestamp in a separate `sensorTimestamp` field on the `AqiReading` struct and include it in both the SSE event payload and REST snapshot response; update `WidgetShell`/`AqiGaugeWidget` to display sensor age ("data from 8 min ago") alongside the fetch time — M/L effort (Rust struct change + frontend display update).

- OBSERVATION: `geointellisense-analytics/app/context.py:20` vs `geointellisense-ingestion/src/config.rs:27` — `context.py` declares `SOURCE_INTERVALS = {"purpleair": 120, ...}` meaning it expects PurpleAir to update every 2 minutes; the staleness threshold is `interval * 2 = 240 seconds` (line 44: `stale = age_seconds > interval * 2`). However, `config.rs:27` defaults `purpleair_interval_secs = 600` (10 minutes), and `docker-compose.yml` passes `PURPLEAIR_INTERVAL_SECS: ${PURPLEAIR_INTERVAL_SECS:-600}`. Under the default configuration, PurpleAir data will be marked "STALE" in Claude's system prompt at t+240s after any fetch, and continue appearing stale for the remaining 360s until the next fetch — meaning Claude sees the AQI data as stale for 60% of the 600-second fetch cycle. `context.py:185-188` appends "⚠ IMPORTANT: Stale data sources may not reflect current conditions. Caveat any analysis that depends on stale sources." to every Claude system prompt when any source is stale. Because `purpleair` is stale 60% of the time under default config, Claude will routinely add staleness caveats to AQI analysis in responses — contradicting the "Real-time AQI and PM2.5 levels" promise in `components/Dashboard.tsx:367` and "Live AQI" in `index.html:6`. PROPOSAL: Synchronise `context.py:20` to `"purpleair": 600` (matching the actual default fetch interval) so staleness is only flagged when data is genuinely overdue (>1200 seconds); alternatively add a `PURPLEAIR_CONTEXT_INTERVAL_SECS` env var so the freshness threshold tracks the configured fetch interval at runtime — L/L effort.

- OBSERVATION: `geointellisense-ingestion/src/routes/aqi.rs:64-73` + `geointellisense-ingestion/src/aqi.rs:138-162` — the `GET /api/aqi-history` endpoint handler (`aqi.rs:64-73`) calls `aqi::generate_history(station_id, hours)` unconditionally with no database query. `generate_history()` (`aqi.rs:138-162`) is a pure synthetic random-walk generator: it creates `hours * 12` data points using `rand::Rng` values around a hard-coded `base_aqi` (85.0 for station `0002`, 60.0 for all others), with no access to TimescaleDB. Meanwhile, `broadcast.rs:115` calls `persist::write_readings(&pool, &readings).await` every 5 seconds, writing real sensor readings (PurpleAir or mock) to the database. TimescaleDB accumulates this history, but the `/api/aqi-history` endpoint never queries it. `AqiTrendWidget.tsx:21` fetches `/api/aqi-history?station_id=AQ-001&hours=24` every 120 seconds and renders the result as the "AQI Trend (24h)" chart on the `LiveDashboard` — which carries the heading "Real-time environmental monitoring for the San Joaquin Valley" (`LiveDashboard.tsx:17`). The entire 24-hour trend chart displayed prominently on the live dashboard is entirely fabricated synthetic data. PROPOSAL: Replace `history()` in `routes/aqi.rs` with a TimescaleDB query (e.g., `SELECT time_bucket('5 minutes', time) AS bucket, ROUND(AVG(aqi)) AS aqi, ROUND(AVG(pm25)::numeric, 1) AS pm25 FROM sensor_readings WHERE location_id = $1 AND time >= now() - $2 * interval '1 hour' GROUP BY bucket ORDER BY bucket`) using the real `persist`-written data — M/M effort (Rust route + query, requires passing pool to the handler).

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:49-95` + `.env.local.example:5` + `geointellisense-ingestion/src/aqi.rs:130` + `components/dashboard/widgets/AqiGaugeWidget.tsx:67` — when `PURPLEAIR_API_KEY` is absent or empty, `config.rs:22-24` sets `purpleair_api_key = None` and `broadcast.rs:49` skips spawning the PurpleAir polling task entirely. The `LiveCache` (`cache`) remains `None`. Every broadcast tick then falls back to `aqi::generate_readings(&stations)` (`broadcast.rs:111`) which creates fully synthetic data with `source: "mock"` (`aqi.rs:131`). The REST snapshot handler `aqi.rs:26-29` has the identical fallback. `.env.local.example:5` ships `PURPLEAIR_API_KEY=` (empty), marking it "Optional". New deployments following only the README instructions (which only require `ANTHROPIC_API_KEY` and `GOOGLE_MAPS_API_KEY`) will serve mock AQI data indefinitely. In `AqiGaugeWidget.tsx:67`, the source badge for `source === 'mock'` evaluates to an empty string (`r.source === 'purpleair' ? 'PA' : r.source === 'airnow' ? 'EPA' : ''`) — no badge is shown, making mock readings visually indistinguishable from live sensor data. The "Live Dashboard" heading and `index.html:6` meta description "Live AQI, weather, fire detection, and groundwater data" are materially false when `PURPLEAIR_API_KEY` is absent. PROPOSAL: Add a visible "Demo Data" or "Simulated" banner/badge in `AqiGaugeWidget.tsx` (and `LiveDashboard.tsx`) when `source === 'mock'`; update the README to call out that the PURPLEAIR_API_KEY is required for actual live AQI; consider adding a `REACT_APP_MOCK_MODE` flag or a `/api/data-status` endpoint the frontend can query to know whether real sensor data is available — L/L effort.

**Proposed actions:**
- Preserve original PurpleAir fetch timestamp in a `sensorTimestamp` field on `AqiReading`; display data age in `AqiGaugeWidget` ("data from Xm ago") — `broadcast.rs:107`, `aqi.rs:24` — M/L effort
- Set `context.py:20` `"purpleair"` interval to 600 (matching `config.rs` default) to stop falsely flagging AQI as stale 60% of the time under default config — L/L effort
- Replace mock `generate_history()` call in `routes/aqi.rs:64-73` with a TimescaleDB time-bucket query against real `sensor_readings` data — M/M effort
- Add visible "Simulated" badge to `AqiGaugeWidget.tsx:67` when `source === 'mock'`; document `PURPLEAIR_API_KEY` as required for live data in README — L/L effort

### Run #149 — 2026-06-04 — Lens: Competitive scan (web)
**Scope:** Tenth competitive scan pass. Web searches: "AI-powered air quality monitoring platform 2026 features LLM environmental intelligence"; "BreezoMeter Plume Labs IQAir AI features 2025 2026 air quality prediction"; "satellite air quality monitoring TROPOMI GEMS AI analytics platform 2026"; "AirNow air quality chatbot AI assistant conversational interface 2025 2026"; "environmental monitoring SaaS platform agricultural air quality health advisory AI 2026"; "San Joaquin Valley air quality tool monitoring platform CalEnviroScreen 2025 2026"; "LLM OR large language model air quality platform MCP model context protocol 2025 arxiv features"; "AirVisual IQAir BreezoMeter personal health profile air quality alert wearable integration feature 2025"; "air quality platform multilingual Spanish community alert wildfire smoke plume tracking AI 2025 2026". Source files examined: `geointellisense-analytics/app/routes/fires.py` (full); `components/SettingsView.tsx` (full); `contexts/UserPreferencesContext.tsx` (lines 1–80); `geointellisense-analytics/app/claude.py` (lines 1–50). Cross-checked against Active Recommendations and Latest Findings runs #146–#148 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/claude.py:127-214` — GeoIntelliSense implements Claude tool use via a static Python list `TOOLS` of JSON-schema dicts that is passed directly to each `client.messages.create()` call. This is a closed, proprietary tool interface: no external AI client can discover or call these tools without going through GeoIntelliSense's own API routes. A peer-reviewed paper published November 2025 (arxiv:2511.03706, "LLM-enhanced Air Quality Monitoring Interface via Model Context Protocol," accepted ISAECT 2025) demonstrates a competitive architecture where an air quality platform exposes its sensor query functions as standardized Model Context Protocol (MCP) server tools, making the LLM an "active operator rather than a passive responder." The competitive gap is composability: with a proper MCP server wrapping GeoIntelliSense's existing tool functions (`get_aqi_data`, `get_earthquake_data`, `get_fire_data`, `get_water_data`, `get_weather_data`), any MCP-compatible AI client (Claude.ai Desktop, Cursor, other agents) could use SJV environmental data without the GeoIntelliSense frontend. Competitors now publish this as a best-practice architecture; GeoIntelliSense's equivalent capability is locked behind proprietary FastAPI routes. The five tool-dispatch functions that back the `TOOLS` list (in `chat.py`, `grounded_search.py`, `grounded_maps.py`, `deep_analysis.py`) could be wrapped as an MCP server in under 200 lines using the `mcp` Python package. PROPOSAL: Add a `geointellisense-analytics/app/mcp_server.py` that re-exports the five existing tool functions as MCP server endpoints with the existing JSON schemas — this makes GeoIntelliSense's data layer accessible to the broader LLM ecosystem — M/M effort.

- OBSERVATION: `geointellisense-analytics/app/routes/fires.py:57` + `fires.py:22` (`_smoke_context`) — GeoIntelliSense's smoke risk assessment is based on fire location, Fire Radiative Power (FRP), and wind direction (the `isUpwind` field in `_format_active()`). FRP measures instantaneous fire energy output; it does not indicate smoke plume altitude. Wildfire smoke at high altitude (above the planetary boundary layer, typically 500–2000m AGL) remains aloft and does not directly affect ground-level air quality. A 2025 satellite study cited in The Conversation ("Which wildfire smoke plumes are hazardous? New satellite tech can map them in 3D for air quality alerts at neighborhood scale") demonstrates that the altitude of a smoke plume — not just its location — determines whether it poses a breathing hazard. AirNow's Fire and Smoke Map integrates satellite-derived smoke height data from NOAA. GeoIntelliSense's `get_smoke_context()` in the NASA FIRMS client generates a narrative that may flag a high-altitude smoke plume as a `smokeRisk: "high"` event (`fires.py:197-201`) purely because `upwindCount > 3`, even if all detected fires are generating stratospheric smoke with no surface impact. The free NOAA Hazard Mapping System (HMS) Fire and Smoke Product provides smoke category ("light", "medium", "heavy") at surface level and is available as a daily GeoJSON at `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/`. The USFS AirFire BlueSky Playground REST API provides model-estimated PM2.5 ground concentrations from smoke. Neither is integrated. PROPOSAL: Integrate NOAA HMS smoke polygon GeoJSON into the fire polling pipeline (`fires.py:50`) so that `_smoke_context` includes surface smoke category alongside FRP-based risk — distinguish "smoke aloft (no ground impact)" from "surface smoke (health risk)"; this directly improves Claude's fire/smoke analysis quality — M/M effort.

- OBSERVATION: `components/SettingsView.tsx:736-745` + `contexts/UserPreferencesContext.tsx:19-25` — the notifications settings expose a single `aqiAlertThreshold` slider (min 50, max 300, default likely 100) stored in `NotificationSettings.aqiAlertThreshold`. There is no concept of a user health sensitivity profile. IQAir AirVisual (the leading global AQI app) provides "Sensitive Group" information that lowers recommended AQI thresholds for users with respiratory conditions (asthma, COPD), cardiovascular disease, pregnancy, or age-based vulnerability (children, elderly). The competitive gap is acutely relevant for GeoIntelliSense's SJV audience: CalEnviroScreen 4.0 (data GeoIntelliSense already integrates via `routes/enviroscreen.py`) shows childhood asthma emergency department visit rates of 14-18% in Fresno and Kern counties — among the highest in California. An asthmatic user should ideally receive alerts at AQI ≥50 (EPA "Moderate — unusually sensitive individuals should consider reducing prolonged outdoor exertion") rather than the standard alert default of ≥100. Currently, `claude.py:10-13` (`CHAT_SYSTEM`) has no per-user health context, so Claude's analysis is generic for all users regardless of their vulnerability. `UserPreferencesContext.tsx:47-71` (`UserPreferences` interface) has no `healthProfile` field; `SettingsView.tsx` (approx. 880 lines) has no "Health Profile" settings section. PROPOSAL: Add a `HealthProfile` interface to `UserPreferencesContext.tsx` with boolean flags (`asthma`, `copd`, `cardiovascular`, `pregnant`, `child`, `elderly`); add a Health Profile section to `SettingsView.tsx`; forward the active flags in the `X-Health-Profile` header or request body to analytics routes so Claude's system prompt can customize thresholds and recommendations — M/L effort.

- OBSERVATION: `components/SettingsView.tsx` (all 1030 lines), `index.html`, `App.tsx`, `package.json` — GeoIntelliSense has zero internationalization (i18n) infrastructure. There is no `react-i18next`, no `i18next`, no locale JSON files, and no language selector in `SettingsView.tsx`. The `UserPreferences` interface (`UserPreferencesContext.tsx:47-71`) has no `language` or `locale` field. The `<html>` element in `index.html:1` has `lang="en"` (hardcoded). The Claude system prompts (`claude.py:10-13` and `15-21`) are English-only with no instruction to detect or match user language. Competitive platforms that explicitly target California and SJV communities offer Spanish-language resources: AirNow provides air quality content in Spanish, Simplified Chinese, Traditional Chinese, Korean, Navajo, Tagalog, and Vietnamese; the San Joaquin Valley Air Pollution Control District (valleyair.org) offers a Spanish-language section. In Fresno, Tulare, and Kern counties — the core GeoIntelliSense service area — approximately 50-70% of the agricultural workforce and rural community members are native Spanish speakers. A Spanish-speaking user who submits a chat message in Spanish will receive a Spanish-language Claude response (Claude code-switches naturally) but experiences an entirely English UI (sidebar labels, settings, dashboard headers, chart axes). The absence of i18n infrastructure means supporting any second language requires a full code refactor rather than adding a locale file. PROPOSAL: Install `react-i18next` + `i18next`, extract all user-visible strings in `Sidebar.tsx`, `Header.tsx`, `Dashboard.tsx`, `SettingsView.tsx`, and `AnalysisView.tsx` into `src/locales/en.json`; add `es.json` with Spanish translations; add a language selector to `SettingsView.tsx`; pass `Accept-Language` to Claude routes so responses match the selected language — M/M effort (i18n scaffolding is well-defined but touches many files).

**Proposed actions:**
- Add `geointellisense-analytics/app/mcp_server.py` wrapping the five existing Claude tool functions as MCP server endpoints — makes GeoIntelliSense's SJV data layer usable by external AI clients — M/M effort
- Integrate NOAA HMS smoke polygon GeoJSON into `fires.py:50` poll loop to distinguish surface smoke from aloft smoke in Claude's `_smoke_context` — M/M effort
- Add `HealthProfile` to `UserPreferencesContext.tsx` and a Health Profile section to `SettingsView.tsx`; forward health flags to Claude routes so system prompts personalize thresholds for SJV's high-asthma population — M/L effort
- Install `react-i18next`; extract strings to `en.json`/`es.json` locale files; add language selector to `SettingsView.tsx` — M/M effort

### Run #148 — 2026-06-04 — Lens: LLM integration quality
**Scope:** Tenth LLM integration quality pass. Examined: `geointellisense-analytics/app/claude.py` (full); `geointellisense-analytics/app/routes/chat.py` (full); `geointellisense-analytics/app/routes/deep_analysis.py` (full); `geointellisense-analytics/app/routes/low_latency.py` (full); `geointellisense-analytics/app/routes/grounded_search.py` (full); `geointellisense-analytics/app/routes/grounded_maps.py` (full); `geointellisense-analytics/app/routes/predictive_analysis.py` (full); `geointellisense-analytics/app/routes/weather_forecast.py` (full); `geointellisense-analytics/requirements.txt` (full); `geointellisense-analytics/app/context.py` (lines 1–50). Grep scans for `cache_control`, `ephemeral`, and all model ID strings across the repo. Cross-checked against Active Recommendations and Latest Findings runs #145–#147 plus archived LLM lens runs #13, #28, #43, #58, #73, #88, #103, #118, #133 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `chat.py:66-76`, `grounded_search.py:62-72`, `grounded_maps.py:69-79`, `deep_analysis.py:61-76` — all four tool-use loops share the same message-accumulation bug: on each iteration, they rebuild the `messages` list using only the CURRENT round's `resp.content` and `tool_results`, discarding the exchange from all prior rounds. Tracing `chat.py`: round 1 builds `messages = get_session_history(session_id) + [assistant_round1_content, tool_results_round1]`, submits to Claude, gets `resp_round1`. Round 2 builds `messages = get_session_history(session_id) + [resp_round1.content, tool_results_round2]` — this replaces the round 1 exchange with round 2's and Claude never sees the round 1 tool calls or their results. For `deep_analysis.py`, `grounded_search.py`, and `grounded_maps.py` the same pattern: `messages = [user_prompt, assistant_content, tool_results]` is reset on every iteration from a local `assistant_content = resp.content` assignment, meaning round 2 omits round 1's initial tool-call block and results entirely. The consequence: any request that triggers more than one tool-use round (e.g., Claude queries air quality, gets a result, then decides to also query earthquakes) has an incoherent message thread from round 2 onward. Claude on round 2 sees an assistant turn that references tool-use IDs it never asked for in this context, causing it to re-derive or ignore results. The correct fix is to maintain a single accumulating `messages` list that is extended by two entries on each round rather than reset: `messages += [{"role":"assistant","content":resp.content}, {"role":"user","content":tool_results}]`. PROPOSAL: Fix the accumulation in all four routes so that multi-round tool use correctly preserves the full exchange chain — M/M effort (4 files, ~5 line change each).

- OBSERVATION: `chat.py:44,71`, `grounded_search.py:40,63`, `grounded_maps.py:47,70`, `predictive_analysis.py:92`, `weather_forecast.py:76` — five routes hard-code the model ID `"claude-sonnet-4-20250514"`. This is the Claude 3.7 Sonnet model (a claude-3.x series model released in February 2025), identified by its YYYYMMDD release-date suffix convention. The other two Claude routes in the project have already migrated to the Claude 4 model family: `deep_analysis.py:34,62` uses `"claude-opus-4-6"` and `low_latency.py:32` uses `"claude-haiku-4-5-20251001"`. The project therefore operates in a split-generation state: the two specialty routes use Claude 4 while the five highest-traffic routes (chat, grounded search, grounded maps, predictive analysis, weather forecast) remain on Claude 3.7. The Claude 4 Sonnet model (`claude-sonnet-4-6`) offers improved instruction following and reasoning versus 3.7 Sonnet. Additionally, `requirements.txt:9` pins `anthropic==0.49.*`; the current model IDs for the Claude 4 family are fully supported by this version, so the migration is a string replacement with no dependency changes. PROPOSAL: Replace `"claude-sonnet-4-20250514"` with `"claude-sonnet-4-6"` in all five routes — L/L effort (5 string replacements across 5 files).

- OBSERVATION: `claude.py:74-110` + all 7 Claude API call sites — no route in the analytics application uses Anthropic's prompt caching feature. Every `client.messages.create()` call omits `cache_control` parameters on system message content blocks, meaning the full system prompt (static SJV/chat/forecast/predictive text + the live context block built by `get_system_with_live_context()`) is billed at full input token price on every API call. The in-process 60-second context cache at `claude.py:88-89` reduces DB round-trips but does NOT reduce token billing — the same context string is billed again on every Claude call within the 60-second window. The static portions (e.g., `SJV_SYSTEM` at `claude.py:15-21`, the tool definitions array `TOOLS` at `claude.py:127-214`, and `SEARCH_SUFFIX` at `grounded_search.py:12-16`) never change between calls and are ideal `ephemeral` cache candidates. The cost impact is highest for `deep_analysis.py`: up to 4 Opus 4.6 calls per request (1 initial + 3 tool-use rounds), each re-billing the same `SJV_SYSTEM` + live context + 5 tool definitions (~600–1000 tokens). Using `cache_control: {"type": "ephemeral"}` on the system message would reduce rounds 2–4 to ~10% of normal input price for that prefix. Prompt caching is supported in `anthropic>=0.28` (the project pins `0.49.*`) and requires passing `system` as a list of content blocks with a `cache_control` key rather than a plain string, e.g., `system=[{"type":"text","text":system_text,"cache_control":{"type":"ephemeral"}}]`. PROPOSAL: Refactor `get_system_with_live_context()` to return a structured list rather than a plain string, and update all 7 Claude call sites to use the list form so the system prompt prefix is eligible for caching — M/M effort (1 helper function + 7 call sites).

- OBSERVATION: `predictive_analysis.py:51-58` and `weather_forecast.py:38-45` — both routes construct a Claude prompt by embedding the raw user-supplied string `req.customFactors` inside a markdown code fence: `f"```\n{req.customFactors}\n```\n"`. Markdown code-fence enclosure provides no prompt-injection protection because the fence can be trivially closed by a user who submits `customFactors = "```\nIGNORE ALL PREVIOUS INSTRUCTIONS. ..."`. A malicious caller can therefore inject arbitrary instruction text into Claude's prompt context, redirect the model's behavior, attempt to exfiltrate the system prompt, or produce misleading environmental analysis output. Both endpoints are unauthenticated: `predictive_analysis.py:39-40` and `weather_forecast.py:33` have no `check_ai_auth` or `check_rate_limit` calls (confirmed by source inspection; `check_ai_auth` is present in `chat.py:25`, `deep_analysis.py:20`, `low_latency.py:20`, `grounded_search.py:27`, `grounded_maps.py:27` — but absent on these two routes). The combination of anonymous access + unsanitized user-string injection means the operator's Anthropic API key is exposed to unlimited prompt-injection attacks from any public caller. Minimum mitigation: add `req.customFactors = req.customFactors.replace("```", "")` before interpolation (breaks code-fence escape) and enforce a character limit via Pydantic `Field(max_length=2000)`. Longer-term: the auth gap (Active Rec #9) must also be closed. PROPOSAL: Add `Field(max_length=2000)` to `customFactors` in both Pydantic models; strip triple-backtick sequences from `req.customFactors` before prompt interpolation; add `check_ai_auth` + `check_rate_limit` to both routes — L/L effort.

**Proposed actions:**
- Fix multi-round tool-use message accumulation in `chat.py:66`, `grounded_search.py:62`, `grounded_maps.py:69`, `deep_analysis.py:61` to extend a cumulative `messages` list per round instead of resetting it — M/M effort
- Replace `"claude-sonnet-4-20250514"` with `"claude-sonnet-4-6"` in `chat.py:44,71`, `grounded_search.py:40,63`, `grounded_maps.py:47,70`, `predictive_analysis.py:92`, `weather_forecast.py:76` — L/L effort
- Refactor `get_system_with_live_context()` in `claude.py:78` to return a structured content-block list and enable `cache_control: ephemeral` on the static system prefix across all 7 Claude call sites — M/M effort
- Sanitize `customFactors` in `predictive_analysis.py:52-58` and `weather_forecast.py:39-45`: strip triple-backtick sequences, add Pydantic `Field(max_length=2000)`, add `check_ai_auth`+`check_rate_limit` — L/L effort

## 📚 Archive (one line per past run)
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
