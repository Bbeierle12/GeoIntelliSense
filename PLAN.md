# GeoIntelliSense — Living Improvement Plan
Last updated: 2026-05-28T16:15:00Z
Last run: #12 — Lens: Deployment / Docker

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
| 10 | Add `trainedAt` to `predict_aqi()` return dict (or remove from `PredictionResult` TS type) | TS↔Py contract | M | L | 6 | Open |

## 🔬 Latest Findings (last 3 runs, full detail)
### Run #12 — 2026-05-28 — Lens: Deployment / Docker
**Scope:** `geointellisense-ingestion/Dockerfile`, `geointellisense-analytics/Dockerfile`, `geointellisense-ingestion/.dockerignore`, `geointellisense-analytics/.dockerignore`, `docker-compose.yml`, `Caddyfile`; `geointellisense-analytics/requirements.txt`, `geointellisense-ingestion/Cargo.toml`.

**Findings:**

- OBSERVATION: `docker-compose.yml:4` — `timescale/timescaledb-ha:pg16` is the High-Availability (Patroni-based) variant of TimescaleDB. On amd64 this image is ~1.6 GB uncompressed vs ~400 MB for `timescale/timescaledb:latest-pg16`. The compose file configures no replication workers, no Patroni environment variables, and no streaming-replica endpoints — the HA feature set is entirely unused. Every `docker compose pull` on a fresh machine incurs the full 1.6 GB network cost for a single-node deployment.

- OBSERVATION: `geointellisense-analytics/Dockerfile:3-5` — `libgdal-dev` is installed in the single-stage runtime image. The `-dev` variant pulls compilation headers, pkg-config metadata, and static `.a` libraries (~50–80 MB). At runtime, `rasterio==1.4.*` ships pre-compiled manylinux binary wheels on PyPI that bundle their own GDAL shared objects; the system `libgdal-dev` package is not loaded by the running process. Consequently `libgdal-dev` is present in the final image but unused at runtime, inflating image size by 50–80 MB. If a binary wheel is unavailable and pip falls back to source compilation, `libgdal-dev` is a build-time dependency only and should be in a multi-stage builder stage.

- OBSERVATION: `geointellisense-analytics/Dockerfile:1-16` — The analytics Dockerfile is single-stage with no `USER` directive. The Uvicorn process (and every Python subprocess it may spawn) runs as UID 0 (root) inside the container. Combined with write access to `/app` and the `modeldata` volume, an exploit against any of the 12 `httpx` client routes (e.g., SSRF via a Claude tool call in `claude.py:execute_tool()`) could write arbitrary files as root. The `--security-opt no-new-privileges` flag and a non-root `USER` directive are both absent.

- OBSERVATION: `geointellisense-ingestion/Dockerfile:11` — `RUN cargo build --release 2>/dev/null || true` redirects all stderr to `/dev/null` and always exits 0. If `cargo` fails during the dependency-caching layer (crates.io network timeout, checksum mismatch, `pkg-config` not finding `libssl-dev`), the failure is completely invisible in build logs and the layer is cached as succeeded. The subsequent `RUN touch src/main.rs && cargo build --release` (line 14) will fail with a linking or compilation error, but the root cause from line 11 is already gone. Removing `2>/dev/null` allows the actual error to surface; the `|| true` alone is sufficient for cache-miss resilience.

- OBSERVATION: `docker-compose.yml:109-113` — The analytics healthcheck is `CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:3002/api/health')"`. This forks a full CPython interpreter for every probe. With `interval: 10s` the container launches ~8,640 Python processes per day purely for health probing. No `curl` or `wget` binary is installed in the analytics image (`Dockerfile` installs only `libgdal-dev`), so a lighter alternative requires a Dockerfile change (e.g., `RUN apt-get install -y --no-install-recommends curl`).

- OBSERVATION: `docker-compose.yml:119-135` — The `gateway` service (Caddy) has no `healthcheck:` block. If Caddy fails to start (Caddyfile syntax error evaluated at runtime, port conflict) or crashes post-startup, Docker marks the container running but with `health: unknown`. No other service declares `condition: service_healthy` on `gateway`, so upstream services continue to be marked healthy while the entry point is down. A `test: ["CMD", "wget", "-qO-", "http://localhost:8080"]` with appropriate interval would surface Caddy failures automatically.

- OBSERVATION: `geointellisense-analytics/.dockerignore:1` — The entry `__pycache__` without a `**/` prefix matches only the top-level `__pycache__/` directory in the build context. The generated bytecode directories inside the package — `app/__pycache__/`, `app/routes/__pycache__/`, `app/clients/__pycache__/`, `app/ml/__pycache__/` — are not excluded. On developer machines where those directories exist, stale `.pyc` files for the host Python version are copied into the image via `COPY . .` (Dockerfile line 14) and may shadow the correct bytecode generated inside the container. The fix is `**/__pycache__` (and `**/*.pyc`).

- OBSERVATION: `docker-compose.yml` — No `deploy.resources.limits` (or legacy `mem_limit`) is configured for any service. The analytics service trains a `GradientBoostingRegressor` (`aqi_model.py:223`) with `n_estimators=200` on up to 730 days of hourly sensor readings; peak RSS during training is unbounded. If the container OOM-kills mid-training (exit code 137), `_train_status` is left permanently as `{"state": "running"}` — no `finally` block resets it in `predict.py:_run_training` — and subsequent `POST /api/predict/train` calls return 409 until restart.

**Proposed actions:**
- Change `docker-compose.yml:4` from `timescale/timescaledb-ha:pg16` to `timescale/timescaledb:latest-pg16` — not in top 10 (M/L, score 2.0; newer first-seen than item 10)
- Convert analytics Dockerfile to multi-stage: builder installs `libgdal-dev` + builds wheels; runtime stage copies only site-packages and adds `USER 1000:1000` — not in top 10 (M/L, score 2.0; newer first-seen than item 10)
- Remove `2>/dev/null` from `geointellisense-ingestion/Dockerfile:11`; keep `|| true` — not in top 10 (L/L, score 1.0)
- Add `RUN apt-get install -y --no-install-recommends curl` to analytics Dockerfile and replace Python urllib healthcheck with `curl -sf http://localhost:3002/api/health` — not in top 10 (L/L, score 1.0)
- Add `healthcheck:` block to `gateway` service in `docker-compose.yml` — not in top 10 (M/L, score 2.0; newer first-seen than item 10)
- Fix analytics `.dockerignore` to use `**/__pycache__` and `**/*.pyc` — not in top 10 (L/L, score 1.0)
- Add `mem_limit: 2g` to analytics service and add `finally: _train_status = {"state": "failed"}` in `predict.py:_run_training` — not in top 10 (M/L, score 2.0; newer first-seen than item 10)

### Run #11 — 2026-05-28 — Lens: Docs
**Scope:** `README.md`, `IMPLEMENTATION_STATUS.md`, `.env.local.example`, `docker-compose.yml`; `geointellisense-analytics/app/config.py`, `app/main.py`, `app/routes/chat.py`, `app/routes/deep_analysis.py`, `app/routes/grounded_search.py`, `app/routes/admin.py`; `geointellisense-ingestion/src/aqi.rs`, `src/broadcast.rs`, `src/config.rs`, `src/main.rs`; `services/aiService.ts`; `components/dashboard/widgets/InversionWidget.tsx`, `WaterWidget.tsx`, `WeatherWidget.tsx`.

**Findings:**

- OBSERVATION: `README.md:64` — The Architecture section states "**Backend** (Express): Runs on `http://localhost:3001`." The actual production stack has no Express server in Docker: the Rust ingestion service listens on port 3001, a Python FastAPI analytics service on port 3002, and a Caddy API gateway on port 8080. The Express `server/index.js` is a dev-only proxy and does not appear in `docker-compose.yml` at all. A new contributor following the README will be confused about which backend serves which API routes. The "How to Run" section (`npm run dev:full`) also never mentions Docker Compose, which is the only way to start the Rust, Python, and database services.

- OBSERVATION: `.env.local.example` is materially incomplete. It documents only 5 variables (`ANTHROPIC_API_KEY`, `PURPLEAIR_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RUST_SERVICE_URL`, `PYTHON_SERVICE_URL`). The `docker-compose.yml` ingestion service block additionally requires `ADMIN_TOKEN`, `PURPLEAIR_INTERVAL_SECS`, and `BROADCAST_INTERVAL_SECS` (and the DB/Redis port variables). The analytics `config.py` (`Settings` class) reads `EPA_AQS_EMAIL`, `EPA_AQS_KEY`, `AIRNOW_API_KEY`, `NOAA_CDO_TOKEN`, `NASA_FIRMS_KEY`, and `CENSUS_API_KEY` — none of which appear in `.env.local.example`. Without these keys, the 12 Python API clients that lack retry logic (see Run #8) silently return empty results, but there is no documentation telling a deployer which keys are needed for which data source.

- OBSERVATION: `docker-compose.yml` analytics service block passes `GOOGLE_MAPS_API_KEY`, `DEM_DATA_DIR`, `LANDSAT_DATA_DIR`, and `MODEL_DIR` as environment variables into the container, but `geointellisense-analytics/app/config.py` (`Settings` class) does not declare any of these four fields. They are never read by the analytics service. Either they are vestigial from an earlier implementation, are silently consumed by child processes, or the `config.py` `Settings` class needs to be updated to reflect them.

- OBSERVATION: `IMPLEMENTATION_STATUS.md` is stale in two ways. (1) Phase 1.1 is marked "Secure API Key Management ✅ COMPLETED" and states the Maps key is "Protected via backend endpoint `/api/maps-config`," but this endpoint remains unauthenticated (Open in Active Recommendation #6, found Run #9). (2) The "How to Run" section instructs users to create a `.env` with only `ANTHROPIC_API_KEY` and `GOOGLE_MAPS_API_KEY`, which is insufficient for the Docker stack: the database, Redis, ingestion service, and analytics service each require additional variables documented nowhere in the file.

- OBSERVATION: `geointellisense-analytics/app/routes/chat.py:23` — `async def chat()`, the primary AI endpoint, has no docstring. It accepts `ChatRequest` (with fields `message: str` and `session_id: str | None`), performs auth + rate-limit checks, runs up to 5 Anthropic tool-call rounds, and returns `{"text": ..., "sessionId": ...}` — none of which is stated in the function signature, decorator, or body. `grounded_search.py:24` (`async def grounded_search()`) and `deep_analysis.py:18` (`async def deep_analysis()`) share the same gap. Together these three handle all AI-facing traffic but have zero inline documentation of auth requirements, input validation, return shape, or error codes.

- OBSERVATION: `geointellisense-ingestion/src/broadcast.rs` — Public type aliases and functions lack `///` doc comments. `AqiBroadcast` (line 13), `LiveCache` (line 16), and `EarthquakeCache` (line 20) are type aliases with no explanation of lock semantics or update frequency. `pub fn create() -> AqiBroadcast` (line 33) has no doc; `pub fn spawn_ticker` (line 38) takes 7 parameters with no `///` explaining what each does or what task it spawns. Only `spawn_earthquake_poller` (line 133) has a two-line doc comment.

- OBSERVATION: `geointellisense-ingestion/src/aqi.rs` — Five public functions have no `///` doc comments: `stations()` (line 53), `aqi_category()` (line 88), `generate_readings()` (line 99), `generate_history()` (line 138), and `round2()` (line 164). These are the only mock-data generators for the entire ingestion service; when `PURPLEAIR_API_KEY` is absent every SSE broadcast uses their output, but there is no inline documentation of the AQI formula, the bounding box, the mock station list, or the history generation algorithm.

- OBSERVATION: `services/aiService.ts` — Seven exported async functions (lines 8, 30, 52, 74, 96, 118, 154) have no JSDoc. There is no inline documentation of which backend endpoint each function calls, what `x-api-key` header value is expected, what the resolved Promise shape is, or what exceptions are thrown on 401/429/500 responses.

- OBSERVATION: `geointellisense-analytics/app/routes/admin.py:11` — `def _check_admin(token: str | None) -> JSONResponse | None:` has no docstring. This security-critical helper returns a 403/401 `JSONResponse` on failure or `None` on success, but nothing in the function explains this sentinel-return contract.

- OBSERVATION: `geointellisense-ingestion/src/config.rs` — `Config` struct and `pub fn from_env() -> Self` have no `///` doc comments. `config.rs` is the single source of truth for every environment variable consumed by the ingestion service, but none of the fields documents its default value, valid range, or effect. `earthquake_interval_secs` (default 300 s) and `broadcast_interval_secs` (default 5 s) are performance-sensitive tunables that affect SSE client freshness; their operational implications are undocumented.

**Proposed actions:**
- Update `README.md:37-64` to replace Express/3001 with Rust ingestion/3001 + Python FastAPI/3002 + Caddy/8080; add a "Docker Compose" section — not in top 10 (M/L, score 2.0)
- Extend `.env.local.example` to include all analytics API keys and ingestion tunables with comments — not in top 10 (M/L, score 2.0)
- Audit and remove or document `GOOGLE_MAPS_API_KEY`, `DEM_DATA_DIR`, `LANDSAT_DATA_DIR`, `MODEL_DIR` in `docker-compose.yml` analytics env block — not in top 10 (M/L, score 2.0)
- Update `IMPLEMENTATION_STATUS.md` to reflect open security items — not in top 10 (L/L, score 1.0)
- Add docstrings to `chat.py:23`, `grounded_search.py:24`, `deep_analysis.py:18` route handlers — not in top 10 (L/L, score 1.0)
- Add `///` doc comments to `broadcast.rs:create`, `spawn_ticker`, and type aliases — not in top 10 (L/L, score 1.0)
- Add JSDoc to all seven `services/aiService.ts` exports — not in top 10 (L/L, score 1.0)

## 📚 Archive (one line per past run)
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
