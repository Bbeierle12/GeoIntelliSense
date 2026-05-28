# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T13:10:00Z
Last run: #9 — Lens: Security

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
| 8 | Add `trainedAt` to `predict_aqi()` return dict (or remove from `PredictionResult` TS type) | TS↔Py contract | M | L | 6 | Open |
| 9 | Expose `category`, `color`, `source` from SSE `aqi-update` in `RealtimeCityData` | TS↔Py contract | M | L | 6 | Open |
| 10 | Align `windSpeed` type: `ForecastPeriod.windSpeed: string` vs `ForecastRecord.windSpeed: number` | TS↔Py contract | M | L | 6 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #9 — 2026-05-28 — Lens: Security
**Scope:** `app/middleware.py`, `app/config.py`, `app/main.py`, `app/routes/admin.py`, `app/routes/chat.py`, `app/routes/deep_analysis.py`, `app/routes/predict.py`, `app/routes/maps_config.py`, `app/routes/ai_context.py`, `app/routes/explore.py`, `app/claude.py`; `src/routes/admin.rs`, `src/config.rs`; `docker-compose.yml`; `Caddyfile`.

**Findings:**

- OBSERVATION: `app/routes/maps_config.py:11-12` — `GET /api/maps-config` returns `GOOGLE_MAPS_API_KEY` in plaintext JSON to any unauthenticated caller with no `check_ai_auth`, no rate limit, and no referrer restriction check. The Caddyfile routes all `/api/*` paths through the public gateway with no path-level restriction. Any browser or script can retrieve the API key and use the project's Maps quota/billing.

- OBSERVATION: `app/routes/predict.py:start_training()` — `POST /api/predict/train` calls neither `check_ai_auth` nor `check_rate_limit`. An unauthenticated caller can repeatedly trigger background RandomForest retraining (full sensor-readings DB scan for up to 730 days). The 409 guard `if _train_task and not _train_task.done()` prevents concurrent runs but not sequential flooding: once the task completes, the endpoint immediately accepts the next training request.

- OBSERVATION: `app/routes/chat.py:chat_reset()` and `new_session()` — `POST /api/chat/reset` and `POST /api/chat/session` carry no auth check and no rate limit. `chat_reset` accepts any `session_id` in the POST body and clears that session's history via `reset_session(session_id)`. A caller who discovers any valid UUID can silently erase another user's conversation context (IDOR). `chat/session` can be spammed to cycle through the 100-session LRU (evicting active sessions) without throttle.

- OBSERVATION: `app/routes/ai_context.py:ai_context()` — `GET /api/ai/context` has no auth check. The endpoint assembles and returns the full internal live-data context (current AQI readings, NWS forecast, fire detections, earthquake events, USGS water levels, enviroscreen data) that is injected verbatim into AI system prompts. The docstring labels it "debugging and inspection," but it is publicly accessible through the Caddy gateway on the same `/api/*` passthrough rule.

- OBSERVATION: `app/main.py:63-70` — In dev mode (`settings.admin_token` is empty), `_allowed_origins = ["*"]` while `allow_credentials=True` remains set unconditionally. FastAPI/Starlette `CORSMiddleware` either raises `ValueError: Cannot use allow_credentials=True with wildcard allow_origins` (crashing the dev server at startup) or silently drops the `Access-Control-Allow-Credentials` header, breaking auth-header sharing. The intent — unrestricted dev access — is not achieved; the fix is `allow_credentials=False` when the origin list is `["*"]`.

- OBSERVATION: `app/middleware.py:check_ai_auth():89` and `app/routes/admin.py:_check_admin():12-13` — Both functions compare provided tokens with configured secrets using Python's `==` operator (`if api_key == settings.admin_token:`, `if token != settings.admin_token:`). CPython `str.__eq__` short-circuits on first mismatch, so comparison time correlates with matching prefix length. The same issue exists in `src/routes/admin.rs:31` (`if provided != token`). The correct fixes are `hmac.compare_digest()` (Python stdlib) and `subtle::ConstantTimeEq` (Rust) to eliminate timing oracle risk.

- OBSERVATION: `app/routes/chat.py`, `deep_analysis.py`, `grounded_search.py`, `predict.py` — All `except Exception as e` 500 handlers return `"details": str(e)` directly in the JSON response body. Exception messages from `asyncpg`, `anthropic`, and `httpx` can contain database DSN fragments, API key prefixes, internal file paths, and model identifiers. These details are forwarded to unauthenticated external callers, aiding stack fingerprinting.

- OBSERVATION: `docker-compose.yml:Redis service` — Redis runs with no `--requirepass` option. The `geointellisense` bridge network is shared by all four containers (db, redis, ingestion, analytics). Any process running inside the analytics container — including code executed via the AI tool loop in `app/claude.py:execute_tool()`, which makes unrestricted `httpx` calls to internal service endpoints — can connect to `redis://redis:6379` without credentials and delete `geointelli:ratelimit:*` keys to bypass all AI-endpoint rate limiting.

**Proposed actions:**
- Add `check_ai_auth` to `GET /api/maps-config`; or restrict Maps API key by HTTP Referrer in Google Cloud Console → Active Recommendation #6
- Add `check_ai_auth` + `check_rate_limit(..., "ai_deep")` to `POST /api/predict/train` → Active Recommendation #7
- Add `check_ai_auth` to `GET /api/ai/context` — not in top 10 (M/L, score 2.0; ties items 8-10)
- Fix dev-mode CORS: set `allow_credentials=False` when `allow_origins=["*"]` — not in top 10 (M/L, score 2.0)
- Replace `==` / `!=` token comparisons with `hmac.compare_digest` (Python) and `subtle::ConstantTimeEq` (Rust) — not in top 10 (M/L, score 2.0)
- Replace `"details": str(e)` with sanitized messages in all 500 handlers — not in top 10 (M/L, score 2.0)
- Add `--requirepass` to Redis in docker-compose and update `REDIS_URL` env vars — not in top 10 (M/M, score 1.0)
- Add rate limit to `POST /api/chat/reset` and `POST /api/chat/session` — not in top 10 (M/M, score 1.0)

### Run #8 — 2026-05-28 — Lens: Data pipeline integrity
**Scope:** `geointellisense-ingestion/src/purpleair.rs`, `broadcast.rs`, `redis_cache.rs`, `usgs.rs`, `db/persist.rs`, `config.rs`; `geointellisense-analytics/app/http_client.py`; all 14 Python API clients (`airnow.py`, `epa_aqs.py`, `noaa_cdo.py`, `nws_sounding.py`, `calenviroscreen.py`, `calgem.py`, `caltrans.py`, `census.py`, `cropscape.py`, `dem.py`, `landsat.py`, `wqp.py`, `nasa_firms.py`, `usgs_water.py`); `app/source_toggles.py`; `app/routes/inversion.py`.

**Findings:**

- OBSERVATION: `geointellisense-ingestion/src/purpleair.rs:fetch_sensors` — the method creates `reqwest::Client::new()` and makes a single HTTP GET with no retry, no exponential backoff, and no timeout on the client. If PurpleAir API returns 5xx or the request hangs, the `Err(e)` branch in `broadcast.rs:spawn_ticker` logs `"PurpleAir fetch failed: {e}, cache unchanged"` and the in-memory cache stays stale for the full `purpleair_interval_secs` (default 600 s). On first startup before any successful fetch, the cache is `None`, so every broadcast tick falls back to mock data for 10+ minutes after any transient API failure.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:spawn_ticker` and `spawn_earthquake_poller` — both polling loops call `redis_cache::is_source_enabled()` before fetching; the `else { continue; }` branch (Redis connection is `None`) skips the fetch entirely when Redis is unavailable. `redis_cache.rs:is_source_enabled` also returns `false` on missing keys (`Ok(None) | _ => false`). If Redis restarts (OOM kill, rolling restart), every toggle resets to `false` and both the PurpleAir loop and the earthquake loop silently stop fetching even if the external APIs are healthy. There is no "use last toggle state when Redis is down" logic. A Redis outage of any duration creates a silent AQI data gap until an admin POSTs to `/api/admin/sources/{source}/enable`.

- OBSERVATION: `geointellisense-analytics/app/` — the shared `http_client.py` provides retry-with-backoff for 429 and 5xx, yet only **2 of 14 Python API clients** import it: `nasa_firms.py` (`from app.http_client import fetch as http_fetch`) and `usgs_water.py` (same). The remaining 12 clients — `airnow.py`, `epa_aqs.py`, `noaa_cdo.py`, `nws_sounding.py`, `calenviroscreen.py`, `calgem.py`, `caltrans.py`, `census.py`, `cropscape.py`, `dem.py`, `landsat.py`, `wqp.py` — all construct their own `httpx.AsyncClient(timeout=...)` inline and call `resp.raise_for_status()` directly with no retry. A single transient 503 from AirNow, NOAA CDO, CalGEM ArcGIS, Census API, or the NWS sounding service surfaces immediately as a 502 to the frontend.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs:spawn_earthquake_poller` — after `let events = usgs::fetch_and_persist(&pool).await`, the significant-event filter and cache write run unconditionally: `*quake_cache.write().await = significant;`. When `usgs::fetch_and_persist_bbox` encounters a network error it returns `Vec::new()` (`usgs.rs` → `Err(e) => { tracing::warn!(...); Vec::new() }`), so `significant` is always empty on failure. This overwrites the cache with an empty `Vec`, erasing all previously cached M3.0+ earthquakes. SSE clients lose their earthquake stream on every USGS network hiccup.

- OBSERVATION: `geointellisense-analytics/app/clients/noaa_cdo.py:NoaaCdoClient._throttled_get` — the pagination loop is `while True:` with a `429` handler that does `await asyncio.sleep(2); continue` but carries **no per-request retry counter**. If NOAA CDO continuously returns 429 for a given offset, the loop runs forever. The `2.0`-second sleep also ignores the `Retry-After` header that CDO sets on 429 responses. Additionally, `resp.raise_for_status()` is called directly for 5xx — a single 503 from NOAA CDO aborts the entire historical fetch with no retry.

- OBSERVATION: `geointellisense-analytics/app/clients/nws_sounding.py` and `routes/inversion.py` — the module docstring names OAK (Oakland) as a backup station, but `get_inversion_status()` calls `await fetch_sounding_850mb()` with the default `station=SOUNDING_STATION` (VBG) only. There is no fallback to OAK when all three `hours_back` attempts for VBG return `None` (balloon launch failure, parser failure, or server downtime). When this occurs `temp_850mb_c` is `None`, `temp_diff_c` is `None`, `classify_inversion(None)` returns `"unknown"`, and the `/api/weather/inversion-status` endpoint returns `inversionStrength: "unknown"` indefinitely rather than degrading gracefully to OAK data.

- OBSERVATION: `geointellisense-analytics/app/clients/epa_aqs.py:EpaAqsClient._throttled_get` — `asyncio.get_event_loop().time()` is called at two points for rate-limit throttling. `asyncio.get_event_loop()` has been deprecated since Python 3.10 when called from inside a running coroutine and will raise `RuntimeError` in a future Python release. The correct replacement is `asyncio.get_running_loop().time()`.

**Proposed actions:**
- Add 3-attempt retry with exponential backoff to `PurpleAirClient::fetch_sensors` in `purpleair.rs`; add a `timeout(Duration::from_secs(30))` to the reqwest call → Active Recommendation #2
- Change `broadcast.rs` source-toggle else-branch from `continue` to proceed with fetch (treat Redis-unavailable as "all sources enabled"), or cache the last-known toggle value in a local `HashMap` → Active Recommendation #3
- Migrate `airnow.py` and `noaa_cdo.py` to `app.http_client.fetch` first (highest AQI impact); then remaining 10 clients — not in top 10 (H/H effort across 12 files, score 1.0)
- Only overwrite `quake_cache` when `events` is non-empty in `broadcast.rs:spawn_earthquake_poller` → (demoted from Active this run due to new H/L security items)
- Add retry counter to NOAA CDO `429` handler; honour `Retry-After` header — not in top 10 (M/M, score 1.0)
- Add OAK station fallback to `get_inversion_status()` when VBG returns all-None → (demoted from Active this run due to new H/L security items)
- Replace `asyncio.get_event_loop().time()` with `asyncio.get_running_loop().time()` in `epa_aqs.py` — not in top 10 (L/L, score 1.0)

### Run #7 — 2026-05-28 — Lens: UX / UI flaws
**Scope:** `index.html`; `components/AnalysisView.tsx`; `components/MapView.tsx`; `components/ChatView.tsx`; `components/LoadingStates.tsx`; `components/Toast.tsx`; `components/ErrorBoundary.tsx`; `components/dashboard/widgets/AqiForecastWidget.tsx`; `components/dashboard/widgets/InversionWidget.tsx`; `components/dashboard/widgets/AqiGaugeWidget.tsx`; `components/dashboard/WidgetShell.tsx`; `components/3d/UIPanels.tsx`; `styles/theme-light.css`; `contexts/UserPreferencesContext.tsx`.

**Findings:**

- OBSERVATION: `components/AnalysisView.tsx:450` — `dangerouslySetInnerHTML={{ __html: result.replace(/\n/g, '<br />') }}` renders the raw AI-returned analysis string as HTML with no sanitization beyond newline→`<br />` conversion. `result` comes from the Python analytics server which forwards Claude/Gemini output. If an adversarial prompt causes the model to emit HTML tags (e.g. `<img onerror="…">`, `<script>…</script>`), those tags execute in the browser with full DOM access. The only escape path is `DOMPurify.sanitize(result)` before injection, or switching to `whitespace-pre-wrap` text rendering (which also avoids the need for `<br />` replacement).

- OBSERVATION: `components/MapView.tsx:253-264, 279-291, 305-317, 327-342, 354-367` — All five Google Maps `InfoWindow` popups are built by interpolating **server-returned external data** directly into raw HTML template literals. Specifically: `r.stationName` (PurpleAir station names, line ~255), `e.place` (USGS earthquake place-name string, line ~308), `w.name` / `w.operator` (CalGEM well names/operators, lines ~332-337), `w.siteName` (water quality site name, line ~358), and the `paramHtml` variable assembled from `Object.entries(w.parameters || {}).map(([name, p]) => …)` (line ~350-352, where `name` is a contaminant name from the backend). None of these values are HTML-escaped before insertion. A maliciously named station (`"><img src=x onerror=alert(1)>`) would execute in the info window's sandboxed but same-origin context. All info windows also hardcode `background:#0f172a;color:#cbd5e1` inline styles, so they remain permanently dark-themed in light mode, ignoring the `.light` class toggle controlled by `UserPreferencesContext`.

- OBSERVATION: `components/LoadingStates.tsx:8, 26, 47, 71, 160, 180, 216` — Every skeleton loader and the `StatusDot` pulse use Tailwind's `animate-pulse` class with no `motion-safe:` prefix and no `@media (prefers-reduced-motion: reduce)` guard anywhere in the codebase. Tailwind provides first-class `motion-safe:animate-pulse` and `motion-reduce:animate-none` utilities for exactly this case. Users who enable `prefers-reduced-motion` in their OS receive continuous animation with no opt-out.

- OBSERVATION: `components/ChatView.tsx:14` — `scrollToBottom` calls `messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })` unconditionally. There is no check for `window.matchMedia('(prefers-reduced-motion: reduce)').matches`; affected users experience motion on every AI response.

- OBSERVATION: `components/dashboard/widgets/InversionWidget.tsx:26, 33, 37` — Three temperature values on the same card use two different unit systems: line 33 shows `surfaceTempF` in °F, line 37 shows `temp850mbC` in °C, line 26 shows `tempDiffC` in °C. The Python backend already returns both `surfaceTempC` and `surfaceTempF`; the widget should pick a consistent unit per `UserPreferencesContext.temperatureUnit`.

- OBSERVATION: `components/dashboard/widgets/AqiForecastWidget.tsx:62` — "Top Drivers" feature names use `<span className="text-slate-400 w-28 truncate">` with no `title` attribute. Names like `"relative_humidity_percent"` are silently clipped with no hover disclosure.

- OBSERVATION: `index.html:15` — Tailwind CSS is loaded from `https://cdn.tailwindcss.com` (the Play CDN, explicitly labelled "development only" in Tailwind docs). The ~313 KB CDN build attaches a `MutationObserver` that fires on every DOM update. Production builds should use `@tailwindcss/vite` for a tree-shaken ~8–20 KB static bundle.

- OBSERVATION: `components/3d/UIPanels.tsx:352-355` — Camera-controls help text uses emoji glyphs (🖱️ ⚲ ⇧) as the sole representation of controls. These render as blank boxes on some Android WebViews and older Chrome builds, and have no `aria-label` alternatives for screen readers.

**Proposed actions:**
- Replace `dangerouslySetInnerHTML` with `DOMPurify.sanitize()` or plain-text rendering in `AnalysisView.tsx:450` → Active Recommendation #1
- HTML-escape externally-sourced strings in `MapView.tsx` info windows — not in top 10 (M/M, score 1.0)
- Replace `animate-pulse` with `motion-safe:animate-pulse motion-reduce:animate-none` across `LoadingStates.tsx` — not in top 10 (M/L=2.0, ties existing items)
- Use reduced-motion-aware scroll in `ChatView.tsx:14` — not in top 10 (L/L, score 1.0)
- Unify temperature units in `InversionWidget.tsx` via `UserPreferencesContext.temperatureUnit` — not in top 10 (M/L=2.0)
- Add `title` attribute to truncated feature names in `AqiForecastWidget.tsx:62` — not in top 10 (L/L)
- Replace Tailwind CDN with `@tailwindcss/vite` — not in top 10 (M/M, score 1.0)
- Replace emoji control hints with labelled SVG icons in `UIPanels.tsx:352-355` — not in top 10 (L/L)

## 📚 Archive (one line per past run)
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
