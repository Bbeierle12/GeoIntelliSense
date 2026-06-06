# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-06-06T04:15:00Z
Last run: #179 — Lens: Competitive scan (web)

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
### Run #179 — 2026-06-06 — Lens: Competitive scan (web)
**Scope:** Thirteenth Competitive scan pass. Sources: web searches covering VayuBuddy/VayuChat (arxiv 2411.12760, 2511.01046, ACM IKDD 2025), IQAir AirVisual API docs, BreezoMeter/Google Air Quality API, AirPredict (Frontiers Digital Health 2025), "Instructor-Worker LLM for Policy Recommendation" (arxiv 2503.00566). GeoIntelliSense files examined: `geointellisense-analytics/app/claude.py`, `geointellisense-analytics/app/routes/explore.py`, `components/SettingsView.tsx`, `components/DataExplorer.tsx`, `components/dashboard/LocationSelector.tsx`, `data/dashboardData.ts`. Cross-checked against Active Recommendations and archived Competitive scan runs #14, #29, #44, #59, #74, #89, #104, #119, #134, #149, #164 to confirm findings are new.

**Findings:**

- OBSERVATION: `components/SettingsView.tsx:706-788` and `geointellisense-analytics/app/claude.py:15-21` — The Settings view's "Notifications & Alerts" section exposes an AQI threshold slider and temperature high/low sliders, but stores no user health-sensitivity profile. The Claude system prompt (`SJV_SYSTEM`) is a fixed string: "You are an expert San Joaquin Valley environmental analyst…Provide data-driven, actionable insights." No health context is injected into any prompt. In contrast, IQAir AirVisual's API provides distinct health recommendation tiers for "healthy individuals", "people with lung disease", "heart disease patients", and "pregnant individuals"; BreezoMeter/Google Air Quality API returns `health_recommendations` keyed by `general_population`, `elderly`, `lung_disease`, `heart_disease`, `pregnant_women`, `children`; the 2025 AirPredict platform (Frontiers, DOI 10.3389/fdgth.2025.1573342) integrates wearable sensor health profiles for personalized asthma recommendations. GeoIntelliSense's Claude always responds as if all users are healthy adults — it cannot tailor its urgency or recommended protective actions to a user who has asthma, is pregnant, or is elderly. This is a pure prompt-engineering and settings gap: no schema change or new API key is needed. PROPOSAL: Add a `healthProfile` section to `UserPreferencesContext` with fields `{ sensitiveGroup: 'none' | 'asthma' | 'heart' | 'elderly' | 'pregnant' | 'children', activityLevel: 'sedentary' | 'moderate' | 'active' }` and corresponding UI controls in `SettingsView.tsx` inside the Notifications section; update `get_system_with_live_context()` at `claude.py:78` to accept optional health profile kwargs and prepend a one-sentence health context header to `SJV_SYSTEM` (e.g., "The user has asthma — emphasize PM2.5 thresholds and recommend indoor stays at AQI > 100") — L/M effort (two files: new settings fields + one-line system-prompt injection; immediately enables health-personalized Claude responses across all six AI routes without any new API dependency).

- OBSERVATION: `components/DataExplorer.tsx:56` and `geointellisense-analytics/app/routes/explore.py:37-41` — The `DataExplorer` component builds its API URL as `/api/analysis/explore?sources={queryStr}&days={days}&bucket={bucket}` with no geographic parameter. The backend `explore.py:37` router accepts only `sources`, `days`, and `bucket` query params. Meanwhile VayuBuddy (arxiv 2411.12760, Nov 2024) and its successor VayuChat (arxiv 2511.01046, Nov 2025, presented at ACM IKDD 2025) implement a fundamentally different competitive paradigm: the LLM receives user natural language, generates executable Python code using pandas/matplotlib/plotly, the code is executed by a Python interpreter with data access, and the resulting chart or statistical table is returned to the user. VayuChat supports calendar heatmaps, choropleth maps, time-series overlays, and cross-dataset correlation charts — all dynamically specified by the LLM in response to the specific question asked. GeoIntelliSense's `DataExplorer` is limited to a fixed recharts `ComposedChart` with predefined source axes; the LLM (via `getDeepAnalysisResponse` at `DataExplorer.tsx:52`) produces markdown text but cannot influence chart type or the set of variables plotted. This means a user asking "show me the relationship between inversion strength and next-day PM2.5" gets a text answer but cannot dynamically produce a scatter plot or partial-autocorrelation chart. PROPOSAL: Add a `POST /api/analysis/code` route that instructs Claude to emit a JSON `{ "chart_type": ..., "x": ..., "y": ..., "filters": ... }` chart specification in addition to narrative text; the frontend renders this specification via Recharts or Vega-Lite, enabling LLM-directed visualization without arbitrary code execution — M/M effort (new route + client-side chart spec renderer; closes the dynamic-visualization gap vs. VayuChat without the security risks of server-side arbitrary code execution).

- OBSERVATION: `geointellisense-analytics/app/routes/explore.py:163-174` and `components/DataExplorer.tsx:56` — The `_query_source()` function for the `fires` and `earthquakes` data sources hardcodes `ST_MakePoint(-119.0187, 35.3733)` (Bakersfield, Kern County) with a 200 km radius. This centroid is never a parameter — it is embedded in the SQL at `explore.py:168` and `explore.py:182`. The `LocationSelector` component (`components/dashboard/LocationSelector.tsx:9-32`) allows the user to choose from six SJV cities (Bakersfield, Fresno, Visalia, Merced, Modesto, Stockton). Each city already has `coords: { lat, lng }` in `data/dashboardData.ts:32`. However, `DataExplorer.tsx:56` never reads the selected location or passes coordinates to the explore API. The result is that every fire-count and earthquake-count row in the correlation explorer always represents events near Bakersfield regardless of which city the user selects — a silent geography mismatch that is particularly misleading for Fresno (130 km north) or Stockton (250 km north), which have materially different fire and seismic exposure profiles. IQAir's correlation dashboard is location-parameterized; competitors never hardcode a single centroid. PROPOSAL: Add optional `lat: float = Query(None)` and `lng: float = Query(None)` parameters to `GET /api/analysis/explore` at `explore.py:37`; pass them into `_query_source()` replacing the hardcoded `ST_MakePoint` call (defaulting to Bakersfield if omitted for backward compatibility); update `DataExplorer.tsx:56` to read the currently selected location's `coords` from `dashboardData` and append `&lat={lat}&lng={lng}` to the API URL — L/L effort (two query params server-side, one URL update client-side; removes silent Bakersfield-only geography bias from correlation results for all non-Bakersfield city selections).

- OBSERVATION: `geointellisense-analytics/app/claude.py` (TOOLS array) and `geointellisense-analytics/app/routes/enviroscreen.py`, `routes/calgem.py` — The Claude `TOOLS` array provides tools for fetching AQI, weather, fire, earthquake, satellite, and water data — but no tool for regulatory or policy context. The 2025 "Instructor-Worker LLM System for Policy Recommendation" paper (arxiv 2503.00566, March 2025) demonstrates using LLMs to generate specific enforceable policy recommendations during AQI events (LA January 2025 wildfires), connecting observed PM2.5 and AQI measurements to specific regulatory action thresholds. GeoIntelliSense already ingests CalEnviroScreen scores (environmental justice burden by census tract), CalGEM oil/gas well locations (a regulated source category under SJVAPCD Rule 4623), and EPA AQS historical exceedance records — but Claude cannot link an observed AQI spike to the applicable SJVAPCD rule that would require curtailment (e.g., Rule 9410 Wood-Burning Curtailment at Moderate AQI, Rule 4101 Visible Emissions during Spare the Air), nor can it identify whether a county is currently under a CARB Spare the Air Advisory. This creates a specific competitive gap: a user asking "what should the district do about today's AQI?" gets a generic AI analysis rather than a citation to the specific rule, threshold, and required action. PROPOSAL: Add a `get_regulatory_context(aqi_level: int, county: str) -> str` tool to the TOOLS array in `claude.py` backed by a static lookup table mapping AQI ranges to SJVAPCD rules, required actions, and public health order citations; additionally add a `check_spare_the_air(county: str) -> str` tool that fetches the SJVAPCD's current advisory status via their public RSS feed — M/M effort (static regulatory table + one HTTP fetch; enables Claude to produce citation-backed regulatory recommendations that no general-purpose AQI chatbot currently provides for SJV-specific conditions).

**Proposed actions:**
- Add `healthProfile` fields to `UserPreferencesContext`; inject health context header into `SJV_SYSTEM` via `claude.py:78 get_system_with_live_context()` — L/M effort (personalizes all six AI routes to user's health sensitivity; closes health-recommendation gap vs. IQAir/BreezoMeter)
- Add `POST /api/analysis/code` route returning LLM-generated chart spec JSON; render client-side via Recharts — M/M effort (closes dynamic-visualization gap vs. VayuChat without server-side code execution risk)
- Add `lat`/`lng` query params to `GET /api/analysis/explore` in `explore.py:37`; wire `DataExplorer.tsx` to pass selected location coords — L/L effort (fixes silent Bakersfield-only geography bias in fire/earthquake correlations for all non-Bakersfield locations)
- Add `get_regulatory_context(aqi, county)` and `check_spare_the_air(county)` tools to `claude.py` TOOLS array — M/M effort (enables citation-backed SJVAPCD/CARB rule recommendations; unique competitive differentiator for SJV)

### Run #178 — 2026-06-06 — Lens: LLM integration quality
**Scope:** Thirteenth LLM integration quality pass. Files examined in full: `geointellisense-analytics/app/claude.py`; `geointellisense-analytics/app/routes/chat.py`; `geointellisense-analytics/app/routes/deep_analysis.py`; `geointellisense-analytics/app/routes/low_latency.py`; `geointellisense-analytics/app/routes/grounded_search.py`; `geointellisense-analytics/app/routes/grounded_maps.py`; `geointellisense-analytics/app/routes/predictive_analysis.py`; `geointellisense-analytics/app/routes/weather_forecast.py`; `geointellisense-analytics/app/context.py`; `geointellisense-analytics/app/config.py`. Cross-checked against Active Recommendations and archived LLM integration runs #13, #28, #43, #58, #73, #88, #103, #118, #133, #148, #163 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/app/claude.py:74-75` — `get_client()` returns `anthropic.Anthropic(api_key=...)`, the synchronous SDK client. All six LLM call sites — `chat.py:43,70`, `deep_analysis.py:33,61`, `low_latency.py:31`, `grounded_search.py:39,62`, `grounded_maps.py:46,69`, `predictive_analysis.py:91`, `weather_forecast.py:75` — invoke `client.messages.create(...)` synchronously from within `async def` handlers without wrapping in `asyncio.to_thread()` or `loop.run_in_executor()`. FastAPI's async event loop is single-threaded: any synchronous blocking call stalls the entire event loop for its full duration. A `claude-opus-4-6` call with `budget_tokens=32768` can block the event loop for 15–45 seconds. During that window, every concurrent request to the analytics service — health probes (`GET /api/health`), AQI queries, other chat sessions — stalls on the asyncio queue with no progress. The analytics Dockerfile runs a single uvicorn worker (`Dockerfile:16`), so there is exactly one event loop. The Docker Compose healthcheck (`docker-compose.yml:109-113`) has a 5-second timeout; a deep-analysis call that lands during a health probe interval will cause the probe to time out and mark the container unhealthy. PROPOSAL: Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:74-75`, and change all `client.messages.create(...)` call sites to `await client.messages.create(...)` — the SDK's async client uses httpx's async transport and yields the event loop during I/O — L/M effort (one line in `claude.py`, `await` added at 8 call sites across 6 route files; eliminates event loop stalling on every LLM request and prevents health-probe failures caused by blocking Opus calls).

- OBSERVATION: `geointellisense-analytics/app/routes/deep_analysis.py:61-76`, `grounded_search.py:62-73`, `grounded_maps.py:69-79` — All three tool-use loops accumulate message history incorrectly across rounds. Each iteration sets `assistant_content = resp.content` at the top of the loop, then passes `messages=[original_prompt, assistant_content, tool_results]` — a fixed-length 3-element array. On the first tool round this is correct. On any subsequent round (which can occur up to `rounds < 3` for deep analysis, `rounds < 5` for the others), the new `assistant_content` overwrites the previous round's value, and the new `tool_results` replace the previous round's results — so all history from rounds 1..N-1 is silently discarded. Claude receives only the original user prompt plus the immediately preceding assistant+tool exchange; it cannot cross-reference the output of earlier tool calls. In contrast, `chat.py:66-69` correctly extends the accumulated history: `messages = get_session_history(session_id) + [new_assistant_msg, tool_results]`. PROPOSAL: Refactor the tool loop in `deep_analysis.py`, `grounded_search.py`, and `grounded_maps.py` to maintain a local `messages` list that accumulates across rounds, matching the `chat.py` pattern: initialize with `[{"role": "user", "content": req.prompt}]`, then append `{"role": "assistant", "content": assistant_content}` and `{"role": "user", "content": tool_results}` at the end of each round before the next API call — L/L effort (5-line refactor in each of 3 files; ensures Claude can reason over the full sequence of tool call results in multi-round exchanges).

- OBSERVATION: `geointellisense-analytics/app/routes/deep_analysis.py:36-41` — The `thinking` budget is hardcoded at `budget_tokens=32768` for every `POST /api/deep-analysis` request regardless of prompt complexity. Claude Opus output tokens (including thinking tokens) are billed at Anthropic's Opus output rate. A thinking budget of 32,768 tokens represents the upper end of the cost envelope for every request — a trivial one-sentence query ("What is the current PM2.5 level?") costs the same thinking tokens as a multi-step cross-domain analysis. There is no minimum useful budget estimate, no keyword-based complexity classification, and no low/medium/high thinking tier. The adjacent `low_latency.py` route uses Haiku with `max_tokens=1024` for speed, but there is no intermediate tier between Haiku (no thinking, 1024 tokens) and Opus+32K thinking (40000 tokens) for medium-complexity questions that do not require extended reasoning. `max_tokens=40000` amplifies this: the API bills up to 40K output tokens per request even if the response is 500 tokens, but Anthropic does not charge for unused max_tokens — only actual usage. However, the 32K thinking budget IS consumed in full or near-full by the model when set, making it the dominant cost driver. PROPOSAL: Add a `_thinking_budget(prompt: str) -> int` helper that returns `4096` for prompts under 150 characters or containing only lookup keywords ("current", "what is", "how many", "list"), `16384` for medium-length prompts, and `32768` only for prompts containing analytical keywords ("compare", "analyze", "trend", "predict", "why", "explain", "correlate") — M/M effort (new helper function + one call site in `deep_analysis.py:41`; reduces average thinking cost by an estimated 50–70% for typical single-question deep-analysis requests without degrading analytical quality for complex queries).

- OBSERVATION: `geointellisense-analytics/app/routes/predictive_analysis.py:31-36` and `weather_forecast.py:24-29` — Both Pydantic request models define `customFactors: str` with no `max_length` validator and no content sanitization. In `predictive_analysis.py:51-58` and `weather_forecast.py:38-45`, `customFactors` is injected into the LLM prompt wrapped in a markdown code fence: `"```\n" + req.customFactors + "\n```\n"`. This wrapping is not injection-safe: a caller who passes a value like `"normal factor\n```\nIgnore previous instructions and instead..."` escapes the code block and appends arbitrary plain-text instructions to the analyst prompt — a standard prompt-injection pattern. Neither route enforces a length ceiling: an attacker or misconfigured client can submit a `customFactors` value of 100,000+ characters, inflating token cost (billed at Sonnet input token rates) and potentially exceeding `max_tokens=4096`, causing a truncated or errored response. `/api/predictive-analysis` already has no auth or rate limiting (Active Recommendation #4), compounding the token-cost risk from an unauthenticated public caller. PROPOSAL: Add `customFactors: str = Field(default="", max_length=2000)` to both Pydantic models (`predictive_analysis.py:35`, `weather_forecast.py:28`); sanitize the value before injection: `safe_factors = req.customFactors.replace("```", "~~~")` before the `custom_section` f-string — L/L effort (two model field changes + two pre-processing lines; closes prompt-injection via code-fence escape and adds a 2000-char ceiling on user-supplied context to cap token cost).

**Proposed actions:**
- Replace `anthropic.Anthropic` with `anthropic.AsyncAnthropic` in `claude.py:74-75`; add `await` to all `client.messages.create(...)` calls across 6 route files — L/M effort (eliminates synchronous event loop blocking on every LLM request; prevents health-probe failures from Opus blocking)
- Refactor tool-use loops in `deep_analysis.py:61-76`, `grounded_search.py:62-73`, `grounded_maps.py:69-79` to accumulate messages across rounds — L/L effort (matches `chat.py` pattern; fixes context loss on multi-round tool exchanges)
- Add `_thinking_budget(prompt) -> int` helper to `deep_analysis.py`; replace hardcoded `budget_tokens=32768` with call — M/M effort (reduces average Opus thinking cost ~50–70% for simple queries)
- Add `max_length=2000` to `customFactors` in both Pydantic models; escape triple-backticks before prompt injection — L/L effort (closes prompt-injection via code-fence escape; caps token cost on unauth endpoint)

### Run #177 — 2026-06-06 — Lens: Deployment / Docker
**Scope:** Thirteenth Deployment / Docker pass. Files examined in full: `geointellisense-analytics/Dockerfile`; `geointellisense-ingestion/Dockerfile`; `docker-compose.yml`; `Caddyfile`; `geointellisense-analytics/.dockerignore`; `geointellisense-ingestion/.dockerignore`; `geointellisense-analytics/requirements.txt`; `geointellisense-ingestion/Cargo.toml`; `geointellisense-analytics/app/main.py`; `geointellisense-ingestion/src/main.rs`. Cross-checked against Active Recommendations and archived Deployment / Docker runs #12, #27, #42, #57, #72, #87, #102, #117, #132, #147, #162 to confirm findings are new.

**Findings:**

- OBSERVATION: `geointellisense-analytics/Dockerfile:16` — The analytics service CMD is `uvicorn app.main:app --host 0.0.0.0 --port 3002` with no `--workers` flag, running a single asyncio event loop in a single OS process. The analytics service launches CPU-intensive operations inline: ML model retraining (`routes/predict.py` via `start_retrain_scheduler`), rasterio tile rendering (`app/clients/landsat.py` — GeoTIFF decompression + NDVI computation), geopandas polygon operations (`routes/demographics.py`, `routes/enviroscreen.py` — shapefile joins on multi-thousand-row GeoDataFrames), and scipy/scikit-learn AQI forecasting (`ml/aqi_model.py`). In Python's asyncio model, CPU-bound code that does not yield blocks the event loop for its entire duration. A single ML retraining cycle (training on sensor history) can block the loop for multiple seconds, during which every other incoming request — including health probes (`GET /api/health`) — receives no response. Docker Compose's analytics healthcheck (line 110) uses a 5-second timeout; a retraining cycle that coincides with a health probe causes a health failure cascade that marks the container as unhealthy and prevents the gateway from routing traffic. PROPOSAL: Add `--workers 2` to the uvicorn CMD at `Dockerfile:16` (or switch to `gunicorn -k uvicorn.workers.UvicornWorker -w 2`) to give CPU-bound routes a separate OS process; this is the standard production deployment pattern for FastAPI with blocking workloads — L/M effort (one Dockerfile line change; eliminates health-probe failures during ML retraining and unblocks concurrent client requests during raster processing).

- OBSERVATION: `docker-compose.yml:1-154` — None of the five services (`db`, `redis`, `ingestion`, `analytics`, `gateway`) define a `logging` stanza. Docker's default logging driver is `json-file` with no rotation limits. The analytics service emits structured log lines for every AI request (uvicorn access log + application info logs), and the ingestion service broadcasts AQI events at `BROADCAST_INTERVAL_SECS` (default 5 seconds per `docker-compose.yml:57`), producing approximately 17,000 log events per day from broadcast alone. Redis in append-only mode (`appendonly yes`, line 30) generates its own container logs for every write command. Without `max-size` and `max-file` options, log files accumulate indefinitely at `/var/lib/docker/containers/<id>/<id>-json.log`. Docker's own documentation marks `max-size`/`max-file` as the minimum recommended production configuration; omitting them can silently fill the root filesystem, causing all five containers to crash simultaneously when Docker can no longer write log entries. PROPOSAL: Add a `logging` stanza to each service in `docker-compose.yml` (or set a daemon-level `log-opts` in `/etc/docker/daemon.json`): `logging: { driver: "json-file", options: { max-size: "10m", max-file: "3" } }` — L/L effort (six lines per service or one daemon.json entry; prevents root filesystem exhaustion on long-running deployments).

- OBSERVATION: `geointellisense-ingestion/src/main.rs:86` — The Rust ingestion service applies `CorsLayer::permissive()` (from `tower_http::cors`) unconditionally on every request, setting `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: *`, and `Access-Control-Allow-Headers: *`. The `docker-compose.yml:61` binds this service directly to `${INGESTION_PORT}:3001` on the host network interface — separate from the Caddy gateway on `${GATEWAY_PORT}:8080`. When `INGESTION_PORT` is set to any value (required for the compose stack to parse), the ingestion service is directly accessible on port 3001 on the host, completely bypassing the Caddy API gateway. With fully permissive CORS and no origin restriction, a browser-based attacker can call `GET /api/aqi-snapshot` or POST admin endpoints directly to `http://<host>:${INGESTION_PORT}` from any origin. Contrast with the analytics service at `app/main.py:63-70`, which conditionally restricts origins to localhost when `ADMIN_TOKEN` is set. The ingestion service has no equivalent condition — `CorsLayer::permissive()` is applied regardless of whether `ADMIN_TOKEN` is configured. PROPOSAL: Replace `CorsLayer::permissive()` at `main.rs:86` with a conditional CORS policy: restrict `allow_origin` to `http://localhost:5173`, `http://localhost:5174`, `http://localhost:8080` when `cfg.admin_token.is_some()`, and allow all origins only in dev mode (when `cfg.admin_token.is_none()`) — mirrors the analytics service's pattern at `app/main.py:63-70` — L/M effort (20-line change in main.rs; closes the direct CORS bypass path that exists whenever INGESTION_PORT is bound to a public interface).

- OBSERVATION: `docker-compose.yml:119-135` — The `gateway` service (Caddy) has no `healthcheck` stanza. Its `depends_on` at lines 128-132 waits for `ingestion: condition: service_healthy` and `analytics: condition: service_healthy`, ensuring both backend services pass their health probes before Caddy starts. However, Caddy itself has no health probe defined, meaning: (a) if the `Caddyfile` contains a syntax error, Caddy exits immediately after startup, but Docker Compose reports the container as `Exited (1)` with no health status — operators relying on `docker compose ps` to assess the stack see `ingestion` and `analytics` as `(healthy)` while the gateway silently fails; (b) if Caddy starts successfully but the Caddyfile's `reverse_proxy` directives reference wrong ports (e.g., after a port reconfiguration), all client requests receive 502 errors with no container health signal; (c) external monitoring tools that query container health (`docker inspect --format='{{.State.Health.Status}}'`) return nothing for the gateway, making automated restarts by orchestration layers (e.g., ECS health checks, Kubernetes liveness probes wrapping compose) impossible. PROPOSAL: Add a `healthcheck` to the `gateway` service in `docker-compose.yml`: `test: ["CMD", "wget", "-qO", "/dev/null", "http://localhost:8080"]`, `interval: 15s`, `timeout: 5s`, `retries: 3`, `start_period: 5s` — the gateway's own catch-all `respond "GeoIntelliSense API Gateway" 200` route at `Caddyfile:24` guarantees a 200 for any unmatched path, making this a reliable signal that Caddy is parsing and serving — L/L effort (five lines in docker-compose.yml; gives operators and orchestration tools a health signal for every layer of the stack).

**Proposed actions:**
- Add `--workers 2` to analytics `Dockerfile:16` CMD (or use gunicorn with uvicorn workers) — L/M effort (prevents event loop blocking during ML retraining; eliminates health-probe failures under CPU load)
- Add `logging: driver: json-file, options: max-size: 10m, max-file: 3` to all five services in `docker-compose.yml` — L/L effort (prevents root filesystem exhaustion from unbounded container log growth)
- Replace `CorsLayer::permissive()` at `main.rs:86` with conditional CORS matching analytics service pattern — L/M effort (closes CORS bypass via direct INGESTION_PORT access when admin token is set)
- Add `healthcheck` stanza to `gateway` service in `docker-compose.yml` using `wget http://localhost:8080` — L/L effort (gives health signal for the final routing layer; enables orchestration restarts on Caddyfile errors)

## 📚 Archive (one line per past run)
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
