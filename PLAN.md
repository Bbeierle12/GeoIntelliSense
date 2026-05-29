# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-29T10:06:00Z
Last run: #30 — Lens: Live-time claim audit

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
### Run #30 — 2026-05-29 — Lens: Live-time claim audit
**Scope:** Second pass. All files relevant to the "live-time" data pipeline: `geointellisense-ingestion/src/aqi.rs`, `geointellisense-ingestion/src/broadcast.rs`, `geointellisense-ingestion/src/config.rs`, `geointellisense-ingestion/src/routes/aqi.rs`, `geointellisense-analytics/app/context.py`, `components/AirQualityMapView.tsx`, `components/dashboard/widgets/AqiTrendWidget.tsx`, `hooks/useRealtimeAQI.ts`, `db/migrations/002_sensor_readings.sql`, `db/migrations/006_sensor_readings_source.sql`. Prior Run #15 findings excluded from re-reporting.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/routes/aqi.rs:64-72` — The `/api/aqi-history` route handler calls `aqi::generate_history(&params.station_id, hours)` unconditionally. `generate_history()` (defined in `aqi.rs:138-162`) is a pure random walk: it seeds a `base_aqi` of 85.0 if the `station_id` string contains `"0002"`, and 60.0 for all other IDs, then applies ±5 random steps per 5-minute point across the requested window. The `sensor_readings` TimescaleDB hypertable — populated by `broadcast.rs:persist::write_readings()` every 5 seconds — is never queried. Additionally, `AqiTrendWidget.tsx:21` hard-codes `station_id=AQ-001`, which is not a valid UUID and matches the 60-AQI fallback path. The resulting 24-hour AQI trend chart displayed on the dashboard is entirely fabricated: even when the live SSE stream delivers genuine PurpleAir readings that are persisted to the DB, the trend chart shows only synthetic data. Fix: replace `aqi::generate_history()` in the route handler with a DB query: `SELECT time, aqi, pm25 FROM sensor_readings WHERE location_id = $1 AND time > now() - interval '$2 hours' ORDER BY time ASC`; pass the correct station UUID; fall back to `generate_history()` only when the table returns zero rows.

- OBSERVATION: `geointellisense-analytics/app/context.py:204` — `_get_aqi_context()` issues the query `SELECT … sr.category … FROM sensor_readings sr`. The `sensor_readings` schema (defined by `db/migrations/002_sensor_readings.sql` and extended by `006_sensor_readings_source.sql`) has no `category` column — the `AqiReading` Rust struct carries `category` in memory but `persist.rs:5-35` never writes it. PostgreSQL raises `column "sr.category" does not exist`; the `except Exception as e: logger.warning(...)` block at line 223 silently swallows the error; `readings` stays `[]` and `last_updated` stays `None`. The function returns `{"readings": [], "freshness": {"status": "unavailable"}, "_source": "purpleair"}` on every call. `build_context_text()` (called by every AI route) therefore always presents the AI with an empty AQI section, directly negating the stated purpose of the live context builder: *"Assembles a snapshot of all available real-time and recent data so Claude can reason from LIVE conditions"* (`context.py:1-6`). Fix: remove `sr.category` from the SELECT; derive category in Python from the returned `aqi` integer using EPA breakpoints (e.g., `"Good" if aqi <= 50 else "Moderate" if aqi <= 100 else ...`).

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:106-109` — The AQI broadcast ticker fires every `broadcast_interval_secs` (default 5 s). When PurpleAir cache is populated it re-stamps every cached reading with `timestamp: now` before broadcasting: `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() }).collect()`. The PurpleAir fetcher polls at `purpleair_interval_secs` (default 600 s). This means SSE `aqi-update` events carry a freshly-minted timestamp every 5 seconds even though the underlying sensor values may be up to 600 seconds old. `useRealtimeAQI.ts:339` calls `setLastUpdate(new Date())` on every SSE event; `AirQualityMapView.tsx:413-416` then renders `{isConnected ? '🔴 Live' : 'Last Updated'} {lastUpdate.toLocaleTimeString()}` — showing e.g. "🔴 Live 10:05:32" when the PurpleAir measurements are from 10:00:00. Fix: add a `sensorDataAgeMs` field to the broadcast payload (current time minus the last successful PurpleAir fetch time, tracked in a shared `AtomicI64`); surface it in the UI as "Sensor data: Xs old" when `sensorDataAgeMs > 60_000`.

- OBSERVATION: `geointellisense-analytics/app/context.py:19-27` — `SOURCE_INTERVALS["purpleair"]` is hardcoded to `120` (2 minutes). `_freshness()` marks data stale when `age_seconds > interval * 2`, i.e., after 240 seconds. But `geointellisense-ingestion/src/config.rs:27` defaults `purpleair_interval_secs` to `600` (10 minutes), documented inline as *"PurpleAir free tier is 1000 pts/day."* Under normal operating conditions, AQI data age will be 0–600 seconds; `_freshness()` declares it stale at 241 seconds. Claude's system prompt will say `status: "stale"` for roughly 60% of the PurpleAir polling window, causing the model to hedge with "data may not be current" even when the sensor just updated 5 minutes ago — which is entirely within spec. Fix: read `SOURCE_INTERVALS["purpleair"]` from an env var `PURPLEAIR_INTERVAL_SECS` with the same default as the Rust config (600), so both services share the same polling cadence assumption.

- OBSERVATION: `components/AirQualityMapView.tsx:177` — The city marker popup tooltip reads `"Real-time data from EPA monitoring station."` The real-time SSE stream (`/api/aqi-stream`) is sourced exclusively from PurpleAir sensor readings when `PURPLEAIR_API_KEY` is configured, or from `aqi::generate_readings()` (random mock) when it is not. EPA AQS data is only accessed by the Python analytics client `clients/epa_aqs.py` for historical analysis; it does not feed the SSE stream or the 3D map markers. The `AqiReading.source` field (`"purpleair"` or `"mock"`) is correctly serialized in the SSE event payload but is silently dropped during parsing in `useRealtimeAQI.ts:308-321` (no `source` field is mapped to the `RealtimeCityData` interface). Consequently, users viewing the map tooltip always see an attribution that is factually incorrect regardless of the active data source. Fix: map `source` from the SSE payload into `RealtimeCityData`; render `"PurpleAir sensor network"` when `source === "purpleair"`, `"Simulated data"` when `source === "mock"`, removing the false EPA attribution.

**Proposed actions:**
- Replace mock `generate_history()` call in `routes/aqi.rs:64` with a DB query against `sensor_readings`; update `AqiTrendWidget.tsx:21` to use a valid station UUID — H/L, score 3.0; ties current top 10, does not displace
- Remove `sr.category` from `context.py:204` SELECT; compute category from `aqi` in Python — H/L, score 3.0; ties current top 10, does not displace
- Add `sensorDataAgeMs` to SSE broadcast payload in `broadcast.rs`; surface as "Sensor data: Xs old" in `AirQualityMapView.tsx:413-416` — M/L, score 2.0; does not enter top 10
- Set `SOURCE_INTERVALS["purpleair"]` in `context.py:19` from env var `PURPLEAIR_INTERVAL_SECS` defaulting to 600 — M/L, score 2.0; does not enter top 10
- Map `source` from SSE payload into `RealtimeCityData`; replace false "EPA" tooltip at `AirQualityMapView.tsx:177` with source-accurate label — M/L, score 2.0; does not enter top 10

### Run #29 — 2026-05-29 — Lens: Competitive scan (web)
**Scope:** Competitive feature audit of similar AQI+AI tools (IQAir/AirVisual, BreezoMeter/Google, Clarity, AirNow Fire and Smoke Map, ZYRTEC AllergyCast, PurpleAir). Cross-referenced against GeoIntelliSense feature surface: `source_toggles.py`, `contexts/UserPreferencesContext.tsx`, `hooks/useRealtimeAQI.ts`, `clients/airnow.py`, `components/AirQualityMapView.tsx`, `components/Dashboard.tsx`, `components/3d/PollutionVolume.tsx`, `components/SettingsView.tsx`. Prior Run #14 findings excluded from re-reporting.

**Findings:**

- OBSERVATION: `contexts/UserPreferencesContext.tsx:21-27` defines `NotificationSettings` with `enabled: boolean` and `aqiAlertThreshold: number` (default `100` at line 98). `components/SettingsView.tsx:719,739-740` renders the enable toggle and threshold slider in the UI. However, `hooks/useRealtimeAQI.ts` receives live per-city AQI data via SSE but never imports or reads `preferences.notifications` — no code path compares incoming AQI values against `aqiAlertThreshold` and no code path calls `Notification.requestPermission()`, `Notification()`, or any backend webhook/email endpoint. The AQI threshold control in Settings is fully inert: it updates localStorage but never causes any alert to fire. Competitors Clarity, IQAir, and BreezoMeter all deliver threshold-based alerts via push/email; the SSE data stream already flowing through `useRealtimeAQI` makes this the natural integration point. Proposed fix: in `useRealtimeAQI.ts`, after each SSE update, compare `stats.averageAQI` (or `cities.find(c => c.location === preferences.selectedLocations[0]).aqi`) against `preferences.notifications.aqiAlertThreshold`; if `notifications.enabled && aqi >= threshold`, call the Web Notifications API with `new Notification(...)` and debounce to once per 30 min.

- OBSERVATION: `clients/airnow.py:153-158, 182-185` — `_normalize_observations()` correctly extracts `pm10` and `o3` AQI values from AirNow's per-parameter observation list and returns them in the normalized dict (alongside placeholder `no2: None, so2: None, co: None`). The `hooks/useRealtimeAQI.ts:18-20` `RealtimeCityData` interface already declares `pm10?: number; o3?: number; no2?: number`. Despite both layers being prepared for multi-pollutant data, `components/AirQualityMapView.tsx:153-156` renders only `pm25` per station, `components/Dashboard.tsx:390` shows only a PM2.5 bar chart, and no component renders O₃ or PM10. The `components/3d/PollutionVolume.tsx:1` has `pollutantType?: 'aqi' | 'pm25' | 'ozone'` already modeled but there is no data pipeline feeding `o3` values to the 3D scene — the ozone visualization mode is a dead switch. Competitors like Clarity surface PM2.5, NO₂, and O₃ as separate panels. The SJV has significant afternoon O₃ spikes (photochemical smog peaks 14:00–18:00 in summer) distinct from PM2.5 episodes; displaying them together as a single AQI value hides the dominant pollutant driving health impact. Proposed fix: add an O₃ AQI row in the AirNow station popup in `AirQualityMapView.tsx`; add a PM10/O₃ toggle to the Dashboard chart; wire the existing `o3` field from `/api/airnow/current` responses to `PollutionVolume.tsx`'s ozone mode.

- OBSERVATION: `source_toggles.py:14` registers `nasa_firms` for background fire detection polling, and `geointellisense-ingestion/src/routes/aqi.rs` stores detected fire points in `fire_detections`. GeoIntelliSense answers "where are active fires right now?" but cannot answer "where will smoke be in 12–48 hours?" — the question most relevant to SJV residents during wildfire events. NOAA's HRRR-Smoke model (operational since December 2020) provides 48-hour surface PM2.5 from smoke at 3 km resolution; its WMS tiles are publicly accessible without an API key via `https://hwp-viz.gsd.esrl.noaa.gov/smoke/index.html` and the NOMADS `dods/hrrr` GRIB2 archive. AirNow's Fire and Smoke Map (`fire.airnow.gov`) integrates HRRR-Smoke to show animated smoke plume forecasts alongside ground-truth monitors. This is the highest-traffic feature during California fire season — the existing `FiresWidget.tsx` shows fire count but offers no trajectory context. Proposed fix: add a `smoke_forecast` layer to the map by loading HRRR-Smoke WMS tiles as an optional overlay in `components/MapView.tsx`; add a thin `/api/smoke-forecast` proxy endpoint to the analytics service to avoid CORS issues with the NOAA WMS origin.

- OBSERVATION: `source_toggles.py:12-32` lists 18 data sources but none covers pollen. GeoIntelliSense integrates CalEnviroScreen (`clients/calenviroscreen.py`) for environmental health burden data, demonstrating concern for allergy-and-asthma-affected communities. The SJV is one of the highest tree-pollen-burden regions in the US (almond/citrus bloom February–April; grass pollen May–June; ragweed August–September) and has disproportionately high asthma rates. BreezoMeter's Pollen API v2 (now part of Google Maps Platform) returns species-level daily pollen counts (tree/grass/weed, with species breakdown) for any lat/lng — the same coordinate system used across all SJV location lookups in the app. ZYRTEC AllergyCast and IQAir both overlay pollen + AQI into a combined daily health score. The absence of pollen data means GeoIntelliSense cannot answer "is today's breathing difficulty due to wildfire smoke, traffic PM2.5, or tree pollen?" — a question that determines the correct protective action. Proposed fix: add a `pollen` client in `clients/pollen.py` calling the Google Maps Air Quality API's `v1/forecast:lookup` endpoint (which subsumes BreezoMeter); add a `pollen` source to `source_toggles.py`; surface a `PollenWidget` in the dashboard alongside `AqiGaugeWidget`.

- OBSERVATION: `contexts/UserPreferencesContext.tsx:43-69` — `UserPreferences` has detailed `notifications`, `accessibility`, `dataSettings` and `analysis` sub-objects but no health-sensitivity profile. The AI system prompt in `context.py:build_context_text()` includes live AQI, weather, fire, inversion, and earthquake context but has no knowledge of the user's health sensitivity (asthma, cardiovascular condition, age group, pregnancy). Competitors ZYRTEC AllergyCast and BreezoMeter present different impact scores for the same AQI depending on whether the user has declared a sensitive condition. The AI chat (`routes/chat.py`) could proactively warn an asthmatic user that AQI 95 is already in the "Unhealthy for Sensitive Groups" category, rather than delivering the generic response that AQI 95 is "Moderate." A `healthProfile?: { asthma: boolean; cardiovascular: boolean; elderly: boolean; pregnant: boolean }` field added to `UserPreferences` and passed into `context.py:96-99` would enable this. Proposed fix: add optional `healthProfile` to `UserPreferences`; add a Health Profile card to `SettingsView.tsx`; pass `preferences.healthProfile` in the `X-Health-Profile` request header on AI calls from `aiService.ts`; read and inject it in `context.py:build_context_text()`.

- OBSERVATION: GeoIntelliSense has no mechanism to share a view of current conditions with external stakeholders or the public. Clarity allows publishing a read-only public dashboard URL; PurpleAir's map is freely embeddable. GeoIntelliSense's environmental-justice use case (CalEnviroScreen integration, SJV community focus) means community groups and environmental advocates would benefit from sharing real-time conditions, but the app is entirely single-tenant with no shareable URL. The existing `/api/aqi-snapshot` endpoint returns live data without authentication (which is a security concern per Active Recommendation #6 in the context of the Maps API key, but here is a feature opportunity) — a read-only `/share/:token` route serving a static snapshot view would complete the loop. Proposed fix: add a `POST /api/share` endpoint that creates a short-lived signed token stored in Redis; add a `/share/:token` frontend route rendering a stripped-down read-only dashboard view of current conditions for the selected location.

**Proposed actions:**
- Wire `preferences.notifications.aqiAlertThreshold` in `useRealtimeAQI.ts`: compare live AQI against threshold, call Web Notifications API when `enabled && aqi >= threshold` — H/M, score 1.5; does not enter top 10
- Render `o3` and `pm10` fields (already returned by `/api/airnow/current`) in `AirQualityMapView.tsx` popup and Dashboard chart; wire `o3` to `PollutionVolume.tsx` ozone mode — M/L, score 2.0; does not enter top 10
- Add HRRR-Smoke WMS tile overlay to `MapView.tsx` and a `/api/smoke-forecast` CORS proxy in analytics service — H/M, score 1.5; does not enter top 10
- Add `clients/pollen.py` (Google Maps Air Quality / BreezoMeter Pollen API v2); add `pollen` source to `source_toggles.py`; add `PollenWidget` to dashboard — M/L, score 2.0; does not enter top 10
- Add optional `healthProfile` to `UserPreferences`; pass via `X-Health-Profile` header from `aiService.ts`; inject in `context.py:build_context_text()` — M/L, score 2.0; does not enter top 10
- Add `POST /api/share` + `/share/:token` read-only dashboard view for community sharing — L/M, score 0.5; does not enter top 10

### Run #28 — 2026-05-29 — Lens: LLM integration quality
**Scope:** Second LLM integration quality pass. `claude.py`, `context.py`, `routes/chat.py`, `routes/deep_analysis.py`, `routes/grounded_search.py`, `routes/grounded_maps.py`, `routes/low_latency.py`, `routes/predictive_analysis.py`, `routes/weather_forecast.py`, `services/aiService.ts`. Prior Run #13 findings excluded from re-reporting.

**Findings:**

- OBSERVATION: `routes/chat.py:43,70`, `routes/deep_analysis.py:33,61`, `routes/grounded_search.py:39,62`, `routes/grounded_maps.py:46,69`, `routes/low_latency.py:31`, `routes/predictive_analysis.py:91`, `routes/weather_forecast.py:75` — All seven AI route handlers are declared `async def` but invoke the **synchronous** `anthropic.Anthropic` client (`claude.py:75`). Each `client.messages.create(...)` call is a blocking `httpx.Client.send()` operation that occupies the uvicorn event loop for the full duration of the Anthropic API response — typically 0.5–5 s for Sonnet, 2–30 s for Opus with extended thinking. While any one AI call is in progress, every other coroutine on the event loop is stalled: Redis operations, DB pool acquires, SSE broadcast tasks, and all background poll loops. Under concurrent load (two users chatting simultaneously), requests queue behind one another rather than executing concurrently. Fix: replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:74-75`; prefix all `client.messages.create(...)` calls with `await`; update `get_client()` return type and all seven call sites.

- OBSERVATION: `claude.py:74-75` — `get_client()` instantiates `anthropic.Anthropic(api_key=settings.anthropic_api_key)` on every invocation. The Anthropic Python SDK wraps an `httpx.Client` that establishes a new TLS connection pool per instance. Every AI API call (seven routes, up to 5 tool-use rounds each) creates and discards a separate connection pool, preventing TCP/TLS connection reuse. A module-level singleton pattern eliminates this waste: `_client: anthropic.AsyncAnthropic | None = None` initialized once on first call and reused thereafter.

- OBSERVATION: `claude.py:233` — In `execute_tool()`, the fallback path for `get_air_quality` (line 232–233) hardcodes `http://localhost:3001/api/aqi-snapshot`. Inside the Docker Compose network, the ingestion service runs in a container named `ingestion` and is reachable only as `http://ingestion:3001/api/aqi-snapshot` — not `localhost:3001`. `localhost` within the analytics container refers to the analytics container itself, which has no listener on port 3001, so this fallback always raises `httpx.ConnectError` silently caught at line 271 and returns `{"error": "Tool execution failed: ..."}`. The primary path (`f"http://localhost:{settings.port}/api/aqi-snapshot"`) also hits `localhost:3002` (analytics self-call), which is correct within the container, so only the fallback is broken. Fix: replace the hardcoded fallback URL with an `INGESTION_URL` env var (default `http://ingestion:3001`) read via `settings`; update the fallback to `f"{settings.ingestion_url}/api/aqi-snapshot"`.

- OBSERVATION: `routes/grounded_search.py:47-72` and `routes/grounded_maps.py:56-79` — The tool use loops in both endpoints reconstruct the `messages` list from scratch on every iteration: `[user:original_prompt, assistant:latest_content, user:latest_tool_results]`. If the model makes two tool calls across two rounds, the second `messages.create()` call sees only round-2 state, not round-1 tool data. Claude loses awareness that Tool A was already called and what it returned; it may re-call Tool A or reason incorrectly about whether certain data was already fetched. The correct pattern is an accumulating list: start with `[user:prompt]`, then append `[assistant:content, user:tool_results]` after each round. Fix: initialize `messages = [{"role": "user", "content": req.prompt}]` before the loop; inside the loop append the assistant content and tool results blocks so each iteration sends the full history.

- OBSERVATION: `routes/chat.py:66-84` — The chat endpoint's tool use loop (lines 66–76) runs intermediate tool exchanges as inline ephemeral messages. When the loop exits, only the final assistant text is saved to session history via `append_to_session(session_id, "assistant", text)` at line 84. The assistant's tool-use content blocks and the user's tool-result blocks are never written to `_sessions[session_id]`. In a follow-up turn, the session history shows the model's summary answer but omits which tool it called and what live data it returned. The model cannot refer back to a previously fetched AQI snapshot or weather reading within the same conversation, leading to redundant tool calls on follow-up questions. Fix: after assembling `tool_results` in the loop body but before the continuation `messages.create()`, call `append_to_session(session_id, "assistant", resp.content)` and `append_to_session(session_id, "user", tool_results)` so the full turn — including tool exchanges — is preserved.

- OBSERVATION: `context.py:96-99` — `build_context_text()` includes every AQI sensor reading from `sensor_readings` within the last hour, one line per station. The DB query at `context.py:201-219` returns `DISTINCT ON (location_id)` rows with no `LIMIT`. The SJV PurpleAir network has 400–800 active sensors in a dense deployment. At ~30 tokens per station line, 500 stations add ~15,000 tokens to the system prompt. This context block is injected into every AI API call — including each tool-use round — multiplying cost by up to 5 for chat calls. At Sonnet input pricing (~$3/MTok), a 5-round chat interaction with 500 AQI stations incurs ~$0.225 in system prompt input tokens alone per message. There is no `max_tokens` guard, no station count cap, and no cost estimate logged. Fix: add `LIMIT 25` to the AQI DB query in `context.py:201` (or post-filter to `aqi["readings"][:25]` before rendering), keeping only the 25 most-recent or highest-AQI stations; log `len(context_text)` at INFO if it exceeds 5,000 characters as an early-warning signal.

**Proposed actions:**
- Replace sync `anthropic.Anthropic` with `anthropic.AsyncAnthropic`; `await` all `messages.create()` calls across all 7 AI routes — H/L, score 3.0; ties current top 10, does not displace
- Introduce module-level `_client` singleton in `claude.py` instead of per-call `get_client()` factory — M/L, score 2.0; does not enter top 10
- Fix `execute_tool()` Docker fallback URL: replace `http://localhost:3001/api/aqi-snapshot` with `{settings.ingestion_url}/api/aqi-snapshot` — H/L, score 3.0; ties current top 10, does not displace
- Accumulate `messages` list across tool-use rounds in `grounded_search.py` and `grounded_maps.py` — M/L, score 2.0; does not enter top 10
- Persist intermediate tool-use/tool-result turns into session history in `chat.py:66-84` — M/L, score 2.0; does not enter top 10
- Add `LIMIT 25` to AQI context query in `context.py:201`; log context length if > 5,000 chars — M/L, score 2.0; does not enter top 10

## 📚 Archive (one line per past run)
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
