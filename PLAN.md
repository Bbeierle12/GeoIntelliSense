# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-03T03:10:00Z
Last run: #135 — Lens: Live-time claim audit

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
### Run #135 — 2026-06-03 — Lens: Live-time claim audit
**Scope:** Tenth live-time claim audit pass. Examined: `geointellisense-ingestion/src/broadcast.rs` (full); `geointellisense-ingestion/src/config.rs` (full); `geointellisense-ingestion/src/main.rs` (full); `geointellisense-ingestion/src/routes/sse.rs` (full); `geointellisense-ingestion/src/routes/aqi.rs` (full); `geointellisense-ingestion/src/aqi.rs` (lines 1–140); `geointellisense-ingestion/src/purpleair.rs` (full); `geointellisense-analytics/app/context.py` (lines 15–55); `geointellisense-analytics/app/routes/predict.py` (full); `geointellisense-analytics/app/main.py` (full); `hooks/useLiveData.ts` (full); `hooks/useRealtimeAQI.ts` (full); `components/AirQualityMapView.tsx` (lines 60–82, 193–215, 267–285, 390–430); `components/dashboard/widgets/AqiForecastWidget.tsx` (full). Cross-checked against Active Recommendations and runs #133–#134 (Latest Findings) plus archived live-time audit runs #15, #30, #45, #60, #75, #90, #105, #120 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:75-80` and `geointellisense-ingestion/src/routes/aqi.rs:22-28` — Both the SSE broadcast ticker and the `/api/aqi-snapshot` REST handler re-stamp every `AqiReading.timestamp` field with `Utc::now()` at the moment of dispatch, not at the moment of sensor measurement. The PurpleAir fetch cycle defaults to 600 seconds (`config.rs:21: purpleair_interval_secs: 600`); the cached readings sit unchanged in memory for up to that interval. On each 5-second broadcast tick the broadcaster rebuilds the `readings` vector as `live.iter().map(|r| AqiReading { timestamp: now, ..r.clone() })`, overwriting the original PurpleAir measurement timestamp. Clients receive readings that appear to have been measured at the instant of SSE delivery, while the actual measurement may be up to 600 seconds old. `AirQualityMapView.tsx:416` displays `lastUpdate.toLocaleTimeString()` as "the time the data arrived", which coincides with the re-stamped `now` — so there is no client-visible signal that the underlying sensor observation is up to 10 minutes old. The `source: "purpleair"` field does survive, so the MapView "LIVE" badge (`components/MapView.tsx:256`) still shows for PurpleAir readings; however, neither the badge nor the timestamp conveys measurement age. PROPOSAL: Preserve the original PurpleAir fetch timestamp in a separate `measuredAt` field (set once in `purpleair.rs` from `Utc::now()` at fetch time); populate `AqiReading.timestamp` with it; add a `broadcastAt` field for the dispatch time if needed for stream bookkeeping — consumers can then compute `age_seconds = broadcastAt - measuredAt` and surface it in the UI — L/M effort.

- OBSERVATION: `geointellisense-analytics/app/context.py:20` — `SOURCE_INTERVALS["purpleair"] = 120` (comment: "PurpleAir fetcher runs every 2 min"). The staleness threshold is `age_seconds > interval * 2 = 240s`. But the actual default polling period is `config.rs:21: purpleair_interval_secs = 600` (10 minutes). Under default configuration, any PurpleAir data older than 4 minutes (240s) is classified as `status: "stale"` in the analytics context. Since the broadcast cycle is 5 seconds and the fetch cycle is 600 seconds, the cached data age at any given moment is uniformly distributed from 0 to 600 seconds; the probability of the data being ≤240s old is 240/600 = 40%. Consequently, on 60% of Claude API calls the system prompt assembled by `build_live_context()` includes the line "STALE data sources (may be outdated): purpleair" (`context.py:88-89`), causing Claude to caveat or discount real-time PurpleAir AQI values even when the system is operating exactly as designed. PROPOSAL: Correct `context.py:20` to `"purpleair": 600` to match `config.rs:21`; the stale threshold will become 1200s, accurately reflecting a 10-minute cycle — L/L effort (one integer change).

- OBSERVATION: `geointellisense-ingestion/src/purpleair.rs:118-119` + `hooks/useRealtimeAQI.ts:405-406` + `components/AirQualityMapView.tsx:281, 405` — PurpleAir v1 API does not provide wind data; `purpleair.rs:118-119` explicitly sets `wind_speed: 0.0` and `wind_direction: 0.0` on all live readings. In `useRealtimeAQI.ts`, the derived `windData` array applies `speed: city.windSpeed || 10` (JavaScript falsy coercion: `0.0 || 10 = 10`) but no direction fallback: `direction: city.windDirection` remains `0.0` (due North) for every city. `AirQualityMapView.tsx:281` selects `realtimeWindData` over `staticWindData` whenever `useRealtimeData && realtimeWindData.length > 0` — which is always true when the SSE stream is connected with PurpleAir data. The result: the 3D wind field visualization renders all wind arrows pointing due North at exactly 10 mph for all six SJV stations when live PurpleAir data is active. Meanwhile `AirQualityMapView.tsx:405` renders the static subtitle "Live 3D WebGL Statistical Model • San Joaquin Valley" unconditionally. The `staticWindData` from `generateWindData(new Date())` (lines 67–82) would provide directionally-varying, time-of-day-aware estimates (NW mornings, SE afternoons), which is more physically plausible than all-North. PROPOSAL: In `useRealtimeAQI.ts:406`, add a direction fallback `direction: city.windDirection || defaultWindDirection(city.lat)`, or fall back to `staticWindData` for the wind layer when live readings have `windSpeed === 0` — prevents the all-North artifact and the subtitle "Live … Statistical Model" from implying live wind data when none exists — L/L effort.

- OBSERVATION: `components/dashboard/widgets/AqiForecastWidget.tsx:40` + `geointellisense-analytics/app/routes/predict.py:17, 40-41` — The `AqiForecastWidget` renders `data.predictedAqi`, `data.category`, and `data.modelR2` but does not render `data.trainedAt` (available in `PredictionResult` at `hooks/useLiveData.ts:134`). The ML model retrains weekly (`predict.py:17: MODEL_TTL = 604800`) via a background loop that sleeps 7 days first (`predict.py:40-41: await asyncio.sleep(604800)` before first training). Prediction results are cached for 30 minutes (`predict.py:17: PREDICT_TTL = 1800`). The `WidgetShell` "lastUpdated" time shown to users reflects when the widget last fetched the prediction endpoint (refreshInterval 300,000ms), not when the model was trained. A user seeing the dashboard "AQI Forecast (24h)" widget — which shows a prominent AQI number with "AQI Forecast (24h)" title — has no indication that the forecast may be derived from a model trained up to 7 days ago on data up to 7 days old. The R² score shown (`R²={data.modelR2}`) conveys accuracy but not freshness. PROPOSAL: Add a `trainedAt` display to `AqiForecastWidget.tsx` — render `data.trainedAt` as a small "Model trained: X days ago" line below the R² badge — L/L effort (one additional JSX line using `data.trainedAt`).

**Proposed actions:**
- Add `measuredAt` field to `AqiReading` in `purpleair.rs`, preserving original fetch timestamp; expose `broadcastAt` separately; update client to compute and display data age — prevents misleading "now" timestamps on stale readings — L/M effort
- Fix `context.py:20` `SOURCE_INTERVALS["purpleair"]` from `120` to `600` — eliminates false "STALE" Claude context warnings on 60% of calls at default config — L/L effort
- In `useRealtimeAQI.ts:406` add direction fallback when `windDirection === 0` (or when `source === "purpleair"`); prevents all-North-wind artifact in 3D wind field when SSE is connected — L/L effort
- Add `trainedAt` display to `AqiForecastWidget.tsx:40` — surface model age to users who rely on the "AQI Forecast (24h)" widget — L/L effort

### Run #134 — 2026-06-03 — Lens: Competitive scan (web)
**Scope:** Tenth competitive scan pass. Examined: `components/SettingsView.tsx` (full — notifications section); `contexts/UserPreferencesContext.tsx` (full — `NotificationSettings` interface); all `hooks/*.ts` files (grep for `aqiAlertThreshold`, `new Notification`, `showNotification`, `serviceWorker`); `geointellisense-analytics/app/claude.py:15-21` (`SJV_SYSTEM` prompt); `geointellisense-analytics/app/routes/inversion.py` (full); `geointellisense-analytics/app/routes/explore.py` (partial). Web searches: "AI air quality monitoring platform AQI alerts 2025 2026 features comparison"; "AQI.in Ambee Breezometer air quality AI features health recommendations 2026"; "AI environmental health app AQI personal exposure notifications wearable 2026"; "AQI air quality app outdoor route optimization exercise planning feature 2025 2026"; "San Joaquin Valley air quality tool app interactive features comparison 2025 2026"; "air quality LLM AI chatbot feature comparison PurpleAir AirNow 2025 2026 geospatial". Cross-checked against Active Recommendations and runs #132–#133 (Latest Findings) plus archived competitive scan runs #14, #29, #44, #59, #74, #89, #104, #119 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `contexts/UserPreferencesContext.tsx:19-29,96-99` + `components/SettingsView.tsx:552-784` — The UI exposes a complete "Notifications & Alerts" section: a toggle to enable notifications (`Notification.requestPermission()` is called at `SettingsView.tsx:554-555`), an AQI threshold slider (`aqiAlertThreshold`, default 100), temperature high/low sliders (`temperatureAlertHigh`, `temperatureAlertLow`), and a sound toggle (`soundEnabled`). But `grep -rn "aqiAlertThreshold"` across the entire codebase returns exactly two files: `SettingsView.tsx:739-740` (renders the slider) and `UserPreferencesContext.tsx:21,98` (declares and initialises the value). The threshold is stored but never read by any hook, service, or background task. No `new Notification(...)`, no `self.registration.showNotification(...)`, and no service worker file exist anywhere. Every direct competitor — IQAir AirVisual, Valley Air RAAN, AQI.in — fires actual device notifications when the AQI crosses a user threshold. GeoIntelliSense presents the settings UI but delivers zero runtime alerts; the permission prompt is called but the browser permission is never acted upon. PROPOSAL: Implement threshold-crossing alert delivery in `hooks/useRealtimeAQI.ts` (or a new `hooks/useAQIAlerts.ts`): read `preferences.notifications.aqiAlertThreshold`; when live AQI exceeds it fire `new Notification("AQI Alert", { body: ... })` — L/L effort (≈20 lines leveraging the already-granted permission and live AQI stream already provided by `useLiveData`).

- OBSERVATION: `geointellisense-analytics/app/routes/inversion.py` (full) — The inversion-detection subsystem correctly identifies the meteorological precursor to Spare the Air advisories (strong temperature inversion = trapped pollutants = burn ban likely), but the app has no integration with the Valley Air District's official residential wood-burning restriction advisory. The Valley Air District — the SJV's own air regulator, and GeoIntelliSense's most geographically relevant competitor — publishes daily burn-day status via its RAAN system and prominently exposes it in its official mobile app for all 8 SJV counties during the burning season (November–February). The advisory is available as a daily data point (allowed / not allowed / weather exception) distinct from the AQI value. The app already tracks inversion conditions at `inversion.py:_wrap_status` with the advisory string "Sensitive groups should limit outdoor activity" — but nothing about wood-burning restriction status, which directly affects hundreds of thousands of SJV residents with wood stoves. The Valley Air RAAN endpoint (`https://apps.valleyair.org/myRAAN/`) publishes county-level daily status. PROPOSAL: Add a `GET /api/burn-day` route that scrapes or queries the Valley Air District's burn-day status endpoint; surface the result in the Dashboard alongside the inversion-status widget — M/M effort (new route, client, and 1 dashboard widget).

- OBSERVATION: `geointellisense-analytics/app/claude.py:15-21` (`SJV_SYSTEM`) — The Claude system prompt is identical for every caller regardless of their health profile: "expert San Joaquin Valley environmental analyst … public health outcomes." No request model in any route accepts a `sensitiveGroup` or `healthProfile` parameter. BreezoMeter's platform (Copernicus-validated, 2025) delivers explicitly differentiated recommendations for sensitive groups (asthma, COPD, elderly, children under 14) vs. healthy adults, citing the different AQI breakpoints at which each group should act. The P-STEP app (PMC11395691, 2025 feasibility study) links physiological data (respiratory rate, activity level) to air quality to compute personal exposure. AirGPT (Nature npj Climate Atm. Science, 2025) fuses geo-coordinates and temporal features into the LLM's context — not just a flat text AQI value. GeoIntelliSense sends the same Claude prompt to a user with COPD and a healthy athlete. Adding an optional `healthProfile` field to the chat request body — propagated to `SJV_SYSTEM` as an additional paragraph when present — would require no model changes. PROPOSAL: Add an optional `healthProfile: str` field to `ChatRequest` in `chat.py` (and to the corresponding TypeScript `ChatMessage` type in `services/aiService.ts`); when non-empty, append a sensitivity-aware paragraph to `SJV_SYSTEM` before calling Claude — L/M effort (2 backend lines + 1 UI settings option).

- OBSERVATION: Competitive landscape gap — none of GeoIntelliSense's routes or UI components expose an "optimal time or route" recommendation for outdoor activity. IQAir explicitly promotes using its AQI forecasting to determine when and where to exercise. The Breathing Green (arXiv 2307.15401) research prototype demonstrated a 17.87% average reduction in pollutant intake for cyclists and pedestrians using AQI-aware route planning with the existing OpenRouteService API. The P-STEP feasibility study (2025, PMC11395691) integrates walking route planning with real-time AQI. GeoIntelliSense has all the ingredients — a 7-day AQI forecast endpoint (`/api/weather-forecast`), NWS weather data, real-time PurpleAir coverage for SJV — but no endpoint or UI surface that synthesises them into "best time to go outside today" or "here is a lower-AQI walking route." The deep-analysis route (`/api/deep-analysis`, Claude Opus + extended thinking) could answer this question but only if the user knows to phrase the prompt correctly; there is no guided UI for it. PROPOSAL: Add a `/api/exercise-advisory` route that accepts a time window and optionally a location, queries the AQI forecast and inversion status, and returns a Claude-generated structured advisory (best hour, risk level, sensitive-group caveat) — M/M effort (new route reusing existing forecast data + a 200-token Claude call).

**Proposed actions:**
- Implement actual AQI threshold-crossing `new Notification()` dispatch in `hooks/useRealtimeAQI.ts` (or new `hooks/useAQIAlerts.ts`) reading `preferences.notifications.aqiAlertThreshold` — closes the dead-UI gap vs. all major competitors — L/L effort
- Add `GET /api/burn-day` route polling Valley Air District burn-day status; surface result in Dashboard alongside inversion widget — closes the most locally relevant competitive gap (Valley Air RAAN) — M/M effort
- Add optional `healthProfile: str` to `ChatRequest` in `chat.py`; append sensitivity-aware paragraph to `SJV_SYSTEM` when present; expose in `SettingsView.tsx` — L/M effort
- Add `/api/exercise-advisory` route: synthesise AQI forecast + inversion status into a Claude-generated structured outdoor activity advisory — M/M effort

### Run #133 — 2026-06-03 — Lens: LLM integration quality
**Scope:** Ninth LLM integration quality pass. Examined: `geointellisense-analytics/app/claude.py` (full); `geointellisense-analytics/app/routes/chat.py` (full); `geointellisense-analytics/app/routes/deep_analysis.py` (full); `geointellisense-analytics/app/routes/predictive_analysis.py` (full); `geointellisense-analytics/app/routes/weather_forecast.py` (full); `geointellisense-analytics/app/routes/grounded_maps.py` (full); `geointellisense-analytics/app/routes/grounded_search.py` (full); `geointellisense-analytics/app/routes/low_latency.py` (full); `geointellisense-analytics/app/routes/ai_context.py` (full); `geointellisense-analytics/app/context.py` (partial — lines 1–191); `geointellisense-analytics/requirements.txt` (full). Cross-checked against Active Recommendations and runs #131–#132 (Latest Findings) plus archived LLM integration runs #13, #28, #43, #58, #73, #88, #103, #118 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `claude.py:74-75` — `get_client()` instantiates a new `anthropic.Anthropic(api_key=settings.anthropic_api_key)` SDK client on every invocation. Internally, `anthropic.Anthropic` creates a new `httpx.Client` with its own connection pool, meaning every Claude API call pays a fresh TLS handshake to `api.anthropic.com` with zero keep-alive reuse across requests. The Anthropic SDK is explicitly designed to be instantiated once and shared. More critically: `anthropic.Anthropic` is the *synchronous* client; all seven call sites — `chat.py:43,70`, `deep_analysis.py:33,61`, `grounded_maps.py:46,69`, `grounded_search.py:39,62`, `low_latency.py:31`, `predictive_analysis.py:91`, `weather_forecast.py:75` — are in `async def` FastAPI handlers. The blocking `client.messages.create()` runs on the asyncio event loop thread and freezes it for the full API response duration — up to 30+ seconds for Opus + 32,768-token extended thinking in `deep_analysis.py:34-44`. During that time the uvicorn worker cannot accept or respond to any other request, serialising all concurrency through the most expensive code path. Fix: declare a module-level `_async_client: anthropic.AsyncAnthropic` singleton in `claude.py`; expose it instead of the per-call `get_client()` factory; switch all seven `messages.create()` calls to `await _async_client.messages.create()`. PROPOSAL: Replace sync `anthropic.Anthropic` per-call pattern with a module-level `anthropic.AsyncAnthropic` singleton in `claude.py:74-75`; switch all 7 `messages.create()` call sites to `await` — eliminates event-loop blocking and per-call TLS handshake overhead — H/M effort (seven call sites across five files).

- OBSERVATION: `deep_analysis.py:61-75` (identical pattern at `grounded_maps.py:62-79` and `grounded_search.py:49-72`) — The multi-round tool-use loop resets the message history on every iteration rather than accumulating it. At the start of each round, `assistant_content = resp.content` captures the current assistant response; then `messages` is built as exactly three items: `[original_user_prompt, latest_assistant_content, latest_tool_results]`. When `rounds == 2`, the round-1 assistant response and round-1 tool results are absent from the `messages` list — only the round-2 state is visible. Claude on round 2 has no memory of which tools it called in round 1, what they returned, or what reasoning it produced from those results. This can cause redundant repeat tool calls or analysis that ignores round-1 discoveries. The bug is most costly in `deep_analysis.py`, which uses Opus with a 32,768-token extended thinking budget; each wasted round costs approximately $0.48 in thinking tokens alone at current Opus pricing. Compare: `chat.py:66-68` correctly grows the message list by reading `get_session_history(session_id)`. Fix: maintain a growing `messages` list across loop iterations, appending two entries per round (the assistant turn and the user/tool-result turn). PROPOSAL: Refactor the tool-use loop in `deep_analysis.py`, `grounded_maps.py`, and `grounded_search.py` to accumulate message history across rounds (growing list, not 3-message reset) — references the working pattern in `chat.py:66-68` — L/L effort (6–8 line change per file).

- OBSERVATION: `predictive_analysis.py:33` (`customFactors: str`) and `weather_forecast.py:28` (`customFactors: str`) — Both Pydantic request models accept `customFactors` as a bare `str` with no `Field(max_length=...)` constraint. The value is interpolated verbatim into a triple-backtick code block in the Claude prompt at `predictive_analysis.py:51-57` and `weather_forecast.py:38-45`. This creates two distinct problems. (1) **Token amplification**: an anonymous caller can send `customFactors` of arbitrary length (e.g., 200,000 characters), passed unchanged to Claude, burning proportional input tokens at full price with no upper bound. (2) **Prompt injection**: wrapping the field in `` ``` `` does not prevent a payload that itself contains `` ``` `` followed by arbitrary instruction text from closing the code block and injecting instructions into the otherwise-structured prompt (e.g., "Ignore all previous instructions"). Since `/api/predictive-analysis` and `/api/weather-forecast` have no authentication (Active Rec #9), any anonymous caller can exploit both vectors. Fix: add `customFactors: str = Field(default="", max_length=2000)` to both request models; truncate or escape backtick sequences before interpolation. PROPOSAL: Add `Field(max_length=2000)` to `customFactors` in `predictive_analysis.py:33` and `weather_forecast.py:28` — caps token amplification and closes prompt-injection surface — L/L effort (two one-line changes).

- OBSERVATION: `chat.py:43` / `deep_analysis.py:33,61` / `grounded_maps.py:46,69` / `grounded_search.py:39,62` / `low_latency.py:31` / `predictive_analysis.py:91` / `weather_forecast.py:75` — None of the seven `client.messages.create()` call sites pass `cache_control` on the `system` parameter, forfeiting Anthropic's prompt-caching cost discount. The system prompt assembled by `get_system_with_live_context` is identical for all requests within the 60-second `_cached_context_ts` window (`claude.py:88`), making it an ideal cache candidate: same bytes, reused repeatedly. Anthropic prompt caching charges ~10% of the standard input-token rate for cache hits. For the `deep_analysis.py` Opus route, a 3,000-token system prompt saves approximately $0.40/MTok; for `chat.py` (Sonnet), ~$0.27/MTok. The `anthropic==0.49.*` SDK (`requirements.txt:9`) fully supports prompt caching via the structured-system-block form: `system=[{"type": "text", "text": ..., "cache_control": {"type": "ephemeral"}}]`. None of the seven call sites use this form — all pass `system=system` (a plain string). PROPOSAL: Change all seven `system=system` parameters to `system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]` — L/L effort (seven one-line changes, or a helper wrapper in `claude.py`).

**Proposed actions:**
- Replace `get_client()` pattern with a module-level `anthropic.AsyncAnthropic` singleton in `claude.py:74-75`; switch all 7 `messages.create()` call sites to `await` — eliminates event-loop blocking and per-call TLS handshake overhead — H/M effort
- Refactor tool-use loop in `deep_analysis.py:61-75`, `grounded_maps.py:62-79`, `grounded_search.py:49-72` to accumulate messages across rounds rather than resetting to 3-message list — L/L effort
- Add `Field(max_length=2000)` to `customFactors` in `predictive_analysis.py:33` and `weather_forecast.py:28` — caps token amplification and closes prompt-injection surface — L/L effort
- Pass `cache_control: {"type": "ephemeral"}` on `system` at all 7 `messages.create()` call sites — enables Anthropic prompt-caching discount (~10% of standard input rate for cached tokens) — L/L effort

## 📚 Archive (one line per past run)
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
