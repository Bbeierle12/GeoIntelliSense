# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-03T02:08:00Z
Last run: #134 — Lens: Competitive scan (web)

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

### Run #132 — 2026-06-03 — Lens: Deployment / Docker
**Scope:** Tenth Docker/Deployment pass. Examined: `geointellisense-analytics/Dockerfile` (full); `geointellisense-ingestion/Dockerfile` (full); `docker-compose.yml` (full); `Caddyfile` (full); `geointellisense-analytics/.dockerignore` (full); `geointellisense-ingestion/.dockerignore` (full); `geointellisense-analytics/requirements.txt` (full); `geointellisense-ingestion/Cargo.toml` (full); `geointellisense-analytics/app/routes/health.py` (full); `geointellisense-ingestion/src/routes/health.rs` (full). Cross-checked against Active Recommendations and runs #130–#131 (Latest Findings) plus archived Docker runs #12, #27, #42, #57, #72, #87, #102, #117 (one-line archive entries) to confirm findings are new.

**Findings:**

- OBSERVATION: `docker-compose.yml:119-135` — The `gateway` (Caddy) service is the only service in the compose stack with no `healthcheck:` block. The `db`, `redis`, `ingestion`, and `analytics` services all define healthchecks; `gateway` does not. Furthermore, `ingestion` and `analytics` both declare `depends_on: ... condition: service_healthy`, meaning Compose blocks until those services pass health checks before the gateway starts. But nothing downstream of the gateway monitors its continued health. If Caddy terminates or enters a crash-loop after its initial successful start, `docker ps` continues reporting the container as `Up` (not `unhealthy`), and `restart: unless-stopped` will restart it — but only after Docker detects the process exit, not before. A Caddy hang (process alive but not serving requests) is entirely invisible. The gateway is the sole public entry point for all API calls; its health is more critical than any individual backend service, yet it is the only one without a probe. Fix: add a healthcheck to the gateway service: `test: ["CMD", "wget", "-qO-", "http://localhost:8080/"]` (the Caddyfile's `respond "GeoIntelliSense API Gateway" 200` catch-all makes this safe) with `interval: 10s`, `timeout: 5s`, `retries: 3`, `start_period: 5s`. The `caddy:2-alpine` image already includes `wget`. PROPOSAL: Add a `healthcheck:` block to the `gateway` service in `docker-compose.yml` — L/L effort (6 lines).

- OBSERVATION: `docker-compose.yml:110` — The `analytics` service healthcheck invokes a full Python interpreter every 10 seconds: `["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:3002/api/health')"]`. Python startup alone takes 50–100 ms and loads the interpreter, stdlib, and C extensions before making a trivial HTTP request. Contrast: the `ingestion` service healthcheck at `docker-compose.yml:68` uses `curl -sf http://localhost:3001/health`, which completes in under 5 ms. The Python-based probe fires every 10 seconds across the container's lifetime; on a host running multiple analytics instances (e.g., in Docker Swarm or with `scale: N`), this compounds. The root cause is that `geointellisense-analytics/Dockerfile:1` bases on `python:3.12-slim`, which does not include `curl`. Adding `curl` to the analytics Dockerfile's `apt-get install` block alongside `libgdal-dev` (`Dockerfile:3-5`) would allow replacing the Python probe with `["CMD-SHELL", "curl -sf http://localhost:3002/api/health || exit 1"]`, matching the ingestion pattern. PROPOSAL: Add `curl` to `apt-get install` in `geointellisense-analytics/Dockerfile:3`; update the analytics healthcheck in `docker-compose.yml:110` to use `curl -sf` — L/L effort (one package added, one line changed).

- OBSERVATION: `docker-compose.yml:54` — The `ingestion` service environment block sets `RUST_LOG: info` as a hardcoded literal. Every other tunable in the same environment block follows the `${VAR:-default}` pattern that allows host-environment override: `PURPLEAIR_INTERVAL_SECS: ${PURPLEAIR_INTERVAL_SECS:-600}` (line 56), `BROADCAST_INTERVAL_SECS: ${BROADCAST_INTERVAL_SECS:-5}` (line 57). `RUST_LOG` is the sole exception. This means that to get `debug` or `trace` log output from the Rust ingestion service during incident investigation or development, an operator must edit `docker-compose.yml` directly — they cannot set `RUST_LOG=debug` in their shell and run `docker compose up` to pick it up. In a production deployment where `docker-compose.yml` is managed as infrastructure-as-code and changes require a PR, this creates unnecessary friction. PROPOSAL: Change `docker-compose.yml:54` from `RUST_LOG: info` to `RUST_LOG: ${RUST_LOG:-info}` — L/L effort (one character change: wrap in `${...:-...}`).

- OBSERVATION: `geointellisense-analytics/Dockerfile:3-5` — The analytics Dockerfile installs `libgdal-dev` in a single-stage build. `libgdal-dev` is a compile-time package: it includes C header files (`/usr/include/gdal/`) and static libraries that are needed only during `pip install` when `rasterio` and `geopandas` compile their native C extensions. After `RUN pip install --no-cache-dir -r requirements.txt` completes on line 10, those headers are never needed again. Because the Dockerfile is single-stage, the dev headers (~25–45 MB depending on the Debian gdal version) remain in the final image layer alongside the runtime. The correct approach is a two-stage build: Stage 1 (`FROM python:3.12-slim AS builder`) installs `libgdal-dev` and uses `pip install --prefix=/install` to collect wheels; Stage 2 (`FROM python:3.12-slim`) installs only the runtime `libgdal34` (the shared library) and copies `/install` from the builder stage. This also removes the `apt-get` cache from the final image entirely. An alternative single-stage mitigation — `apt-get install libgdal-dev && pip install ... && apt-get purge libgdal-dev && apt-get autoremove` — is unreliable because purging GDAL may pull runtime symbols that `rasterio`'s `.so` references. The multi-stage approach is the only safe fix. PROPOSAL: Convert `geointellisense-analytics/Dockerfile` to a two-stage build, replacing `libgdal-dev` in Stage 1 with `libgdal34` (runtime shared library) in Stage 2; estimate 30–50 MB reduction in final image size — M/M effort.

**Proposed actions:**
- Add `healthcheck:` block to the `gateway` service in `docker-compose.yml` using `wget` against the Caddy catch-all route — closes the only unhealthy-container blind spot in the stack — L/L effort
- Add `curl` to analytics `Dockerfile:3` and update `docker-compose.yml:110` to use `curl -sf` for healthcheck — removes 50–100 ms Python interpreter overhead every 10 seconds — L/L effort
- Change `docker-compose.yml:54` from `RUST_LOG: info` to `RUST_LOG: ${RUST_LOG:-info}` — enables runtime log-level override without editing compose file — L/L effort
- Convert `geointellisense-analytics/Dockerfile` to two-stage build, moving `libgdal-dev` to builder stage and installing only `libgdal34` at runtime — reduces final image by ~30–50 MB — M/M effort

## 📚 Archive (one line per past run)
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
