"""
Per-source liveness, recorded where fetches actually succeed or fail.

The backend was down for 2h47m on 2026-09-09 and nothing reported it; the
historical-weather endpoint had been 500-ing since it was written and nothing
reported that either. Both were invisible for the same reason: nothing in the
stack answers "is this source actually working right now".

Design rule, deliberately: a source that has never reported is `unknown`, never
`live`. A health endpoint that guesses is the same failure it exists to catch.
"""

import logging
import time
from typing import Any

from app.source_toggles import SOURCES, is_enabled

logger = logging.getLogger(__name__)

SUCCESS_PREFIX = "geointelli:source-last-success"
FAILURE_PREFIX = "geointelli:source-last-failure"
STATE_TTL = 172800  # 2 days — long enough that a weekend outage is still visible

# How often each source is expected to produce data. Anything older than twice
# this is stale. Mirrors context.SOURCE_INTERVALS, extended to the full registry.
EXPECTED_INTERVAL_SECS: dict[str, int] = {
    "purpleair": 120,
    "usgs_earthquakes": 300,
    "nasa_firms": 1800,
    "usgs_water": 900,
    "inversion": 1800,
    "airnow": 3600,
    "nws_forecast": 3600,
    "nws_observations": 3600,
    "noaa_cdo": 86400,
    "epa_aqs": 86400,
    "census": 604800,
    "calgem": 604800,
    "calenviroscreen": 604800,
    "cropscape": 604800,
    "caltrans": 604800,
    "wqp": 604800,
    "landsat": 86400,
    "sentinel": 86400,
    "dem": 604800,
    "ssurgo": 604800,
}


async def record_success(source: str, detail: str = "") -> None:
    """Call on every successful fetch. Never raises — health must not break work."""
    try:
        from app.cache import get_redis
        r = await get_redis()
        await r.setex(f"{SUCCESS_PREFIX}:{source}", STATE_TTL, f"{int(time.time())}|{detail}")
    except Exception as e:
        logger.debug("health: could not record success for %s: %s", source, e)


async def record_failure(source: str, error: str) -> None:
    """Call on every failed fetch. Never raises."""
    try:
        from app.cache import get_redis
        r = await get_redis()
        await r.setex(f"{FAILURE_PREFIX}:{source}", STATE_TTL, f"{int(time.time())}|{error[:200]}")
    except Exception as e:
        logger.debug("health: could not record failure for %s: %s", source, e)


def _split(raw: str | None) -> tuple[int | None, str]:
    if not raw:
        return None, ""
    ts, _, detail = raw.partition("|")
    try:
        return int(ts), detail
    except ValueError:
        return None, detail


def _classify(enabled: bool, success_ts: int | None, failure_ts: int | None, interval: int) -> str:
    """live | stale | failing | disabled | unknown. Never guesses 'live'."""
    if not enabled:
        return "disabled"
    if success_ts is None:
        # Either it has never succeeded, or nothing at this source records health.
        return "failing" if failure_ts is not None else "unknown"

    age = int(time.time()) - success_ts
    if failure_ts is not None and failure_ts > success_ts:
        return "failing"
    return "stale" if age > interval * 2 else "live"


async def get_source_health() -> dict[str, Any]:
    """Liveness for every registered source, plus a one-line summary."""
    try:
        from app.cache import get_redis
        r = await get_redis()
    except Exception as e:
        return {"error": "redis unavailable", "detail": str(e), "sources": []}

    sources: list[dict[str, Any]] = []
    now = int(time.time())

    for name, description in SOURCES.items():
        enabled = await is_enabled(name)
        interval = EXPECTED_INTERVAL_SECS.get(name, 3600)

        try:
            success_raw = await r.get(f"{SUCCESS_PREFIX}:{name}")
            failure_raw = await r.get(f"{FAILURE_PREFIX}:{name}")
        except Exception:
            success_raw = failure_raw = None

        success_ts, success_detail = _split(success_raw)
        failure_ts, failure_detail = _split(failure_raw)
        status = _classify(enabled, success_ts, failure_ts, interval)

        sources.append({
            "source": name,
            "description": description,
            "enabled": enabled,
            "status": status,
            # False means this source does not yet report health, so `unknown`
            # is the honest answer rather than an assumption either way.
            "instrumented": success_ts is not None or failure_ts is not None,
            "lastSuccess": success_ts,
            "lastSuccessAgeSeconds": (now - success_ts) if success_ts else None,
            "lastSuccessDetail": success_detail or None,
            "lastFailure": failure_ts,
            "lastFailureError": failure_detail or None,
            "expectedIntervalSeconds": interval,
        })

    counts: dict[str, int] = {}
    for s in sources:
        counts[s["status"]] = counts.get(s["status"], 0) + 1

    return {
        "generatedAt": now,
        "counts": counts,
        "problems": [s["source"] for s in sources if s["status"] in ("failing", "stale")],
        "uninstrumented": [s["source"] for s in sources if not s["instrumented"] and s["enabled"]],
        "sources": sources,
    }
