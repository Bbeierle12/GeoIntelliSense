# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-29T09:15:00Z
Last run: #29 — Lens: Competitive scan (web)

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

### Run #27 — 2026-05-29 — Lens: Deployment / Docker
**Scope:** Second deployment/Docker pass. `docker-compose.yml`, `Caddyfile`, `geointellisense-ingestion/Dockerfile` (runtime stage), `geointellisense-ingestion/src/main.rs`, `geointellisense-ingestion/src/routes/mod.rs`, `geointellisense-analytics/app/main.py`. Prior Run #12 findings (image size, libgdal-dev, analytics USER directive, cargo stderr suppression, Python urllib healthcheck, missing gateway healthcheck, .dockerignore glob, mem_limit/OOM state) excluded from re-reporting.

**Findings:**

- OBSERVATION: `docker-compose.yml:11,32,61,99,124` — All four internal service ports are published to the host: PostgreSQL at `${DB_PORT}:5432` (line 11), Redis at `${REDIS_PORT}:6379` (line 32), ingestion at `${INGESTION_PORT}:3001` (line 61), and analytics at `${ANALYTICS_PORT}:3002` (line 99). In a production deployment, only the Caddy gateway port (`${GATEWAY_PORT}:8080`) should be externally accessible; the four internal services are designed to communicate exclusively through the `geointellisense` Docker bridge network. Publishing PostgreSQL and Redis ports to the host means any process on the deployment machine — and any internet-reachable attacker if the host lacks a strict firewall — can connect directly to the database and cache, bypassing every application-level authentication and rate-limiting layer. Fix: remove `ports:` blocks from the `db`, `redis`, `ingestion`, and `analytics` services (they are already reachable by service name within the Docker network), or scope them to loopback-only (`127.0.0.1:${DB_PORT:-5432}:5432`) for local development convenience.

- OBSERVATION: `docker-compose.yml:30,58,96` — Redis has no authentication. The startup command (line 30) is `redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru` with no `--requirepass` or ACL file. Both `REDIS_URL` values (ingestion line 58, analytics line 96) are `redis://redis:6379` — no password embedded. Redis stores sliding-window rate-limit counters keyed by client IP and API key (`middleware.py`), AQI broadcast cache state (`redis_cache.rs`), and fire/earthquake poll results. An unauthenticated connection to Redis allows any reachable process to flush all rate limits with `FLUSHDB`, inspect and forge cached sensor payloads, or decrement rate-limit counters to un-throttle blocked clients. Combined with the host-port finding above, the Redis instance is directly reachable from the host without any credential. Fix: add `--requirepass ${REDIS_PASSWORD}` to the Redis command; add `REDIS_PASSWORD` to the ingestion and analytics environment blocks; update both `REDIS_URL` values to `redis://:${REDIS_PASSWORD}@redis:6379`.

- OBSERVATION: `Caddyfile:20-22` and `geointellisense-ingestion/src/routes/mod.rs:18` — The Caddyfile `handle /api/* { reverse_proxy analytics:3002 }` catch-all matches `/api/admin/cache/flush` before any ingestion-specific rule, so `POST /api/admin/cache/flush` through the gateway is proxied to the Python analytics service. Python has no such route and returns 404 or 405. The ingestion service registers this route at `routes/mod.rs:18` (`.route("/api/admin/cache/flush", post(admin::cache_flush))`), but there is no Caddyfile `handle` block forwarding ingestion admin paths to `ingestion:3001`. The cache-flush endpoint is therefore functionally unreachable through the gateway; only callers who directly access `ingestion:3001` (published to host per finding above) can invoke it. Fix: add `handle /api/admin/cache/flush { reverse_proxy ingestion:3001 }` before the `handle /api/*` catch-all in the Caddyfile (Caddy evaluates `handle` blocks in definition order, so more-specific blocks must appear first).

- OBSERVATION: `geointellisense-ingestion/src/main.rs:86` — The ingestion service mounts `CorsLayer::permissive()` (tower-http) unconditionally for all environments. `CorsLayer::permissive()` sets `Access-Control-Allow-Origin: *` and permits all methods and headers on every response. Unlike the analytics service, which at least distinguishes production and dev CORS in `main.py:63-70` (though that logic is also flawed per Run #24), the ingestion CORS has zero production hardening and no configuration path. Because the ingestion service port is published to the host (finding above), any web page served from the deployment host's loopback address can make cross-origin requests directly to `/api/aqi-snapshot`, `/api/aqi-history`, and `/api/earthquakes/cached`, bypassing the Caddy gateway and all analytics-side auth middleware. Fix: replace `CorsLayer::permissive()` with a configurable allowlist driven by an `ALLOWED_ORIGINS` env var; permit `*` only when `cfg.admin_token.is_none()` (dev mode), mirroring the analytics `main.py` pattern.

- OBSERVATION: `docker-compose.yml:11,32,61,99,124` — The five port-mapping variables (`${DB_PORT}`, `${REDIS_PORT}`, `${INGESTION_PORT}`, `${ANALYTICS_PORT}`, `${GATEWAY_PORT}`) are referenced with no `:-<default>` fallback notation. Every other configurable variable in the file uses `:-` syntax (e.g., line 55: `${PURPLEAIR_API_KEY:-}`, line 56: `${PURPLEAIR_INTERVAL_SECS:-600}`). Without a `.env` file that defines all five port vars, `docker compose up` fails immediately with a Docker Compose variable substitution error before any image is pulled or container is started. There is no `.env.example` or `docker-compose.override.yml.example` in the repository documenting the expected values. Fix: add `:-<default>` notation to each port variable (e.g., `${DB_PORT:-5432}`, `${REDIS_PORT:-6379}`, `${INGESTION_PORT:-3001}`, `${ANALYTICS_PORT:-3002}`, `${GATEWAY_PORT:-8080}`) or add a committed `.env.example` file with documented port defaults.

- OBSERVATION: `geointellisense-ingestion/Dockerfile:16-26` — The runtime stage of the ingestion Dockerfile (based on `debian:bookworm-slim`) has no `USER` directive. The compiled binary `geointellisense-ingestion` runs as UID 0 (root) inside the container. Run #12 noted this gap for the analytics Dockerfile; the ingestion runtime stage has the identical issue. The ingestion binary binds a raw TCP port (`TcpListener::bind` at `main.rs:91`), maintains a PostgreSQL pool, and serves SSE streams — none of these require root privileges. Ports ≥1024 can be bound by any user; port 3001 is above the privileged range and requires no special capability. Fix: add `RUN useradd -u 1001 -m appuser` and `USER appuser` before the `CMD` line in the runtime stage of `geointellisense-ingestion/Dockerfile`.

**Proposed actions:**
- Remove host `ports:` from `db`, `redis`, `ingestion`, `analytics` services in `docker-compose.yml`; keep only `gateway` port exposed — H/L, score 3.0; ties current top 10, does not displace
- Add `--requirepass ${REDIS_PASSWORD}` to Redis command; add `REDIS_PASSWORD` to env blocks and `REDIS_URL` — H/L, score 3.0; ties current top 10, does not displace
- Add `handle /api/admin/cache/flush { reverse_proxy ingestion:3001 }` before `handle /api/*` in Caddyfile — M/L, score 2.0; does not enter top 10
- Replace `CorsLayer::permissive()` in `main.rs:86` with env-var-driven allowlist; permit `*` only in dev mode — M/L, score 2.0; does not enter top 10
- Add `:-<default>` fallbacks to all five port variables in `docker-compose.yml`, or add `.env.example` with port defaults — M/L, score 2.0; does not enter top 10
- Add `RUN useradd -u 1001 -m appuser && USER appuser` to ingestion Dockerfile runtime stage — M/L, score 2.0; does not enter top 10

## 📚 Archive (one line per past run)
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
