import asyncio
import logging
import traceback
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.nws_sounding import get_inversion_status, InversionStatus
from app.database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

INVERSION_TTL = 1800  # 30 min — soundings update every 12 hours, surface obs hourly
CORRELATION_TTL = 3600  # 1 hour

# Background polling
_poll_task: asyncio.Task | None = None
_current_status: dict[str, Any] | None = None


async def start_inversion_polling():
    """Start background task that checks inversion status every 30 min."""
    global _poll_task
    if _poll_task and not _poll_task.done():
        return
    _poll_task = asyncio.create_task(_poll_loop())
    logger.info("Inversion detection polling started (30 min interval)")


async def _poll_loop():
    global _current_status
    while True:
        try:
            from app.source_toggles import is_enabled
            if not await is_enabled("inversion"):
                await asyncio.sleep(1800)
                continue

            status = await get_inversion_status()
            _current_status = status.to_dict()

            # Persist to DB
            pool = await get_pool()
            await _persist_event(pool, status)

            logger.info(
                "Inversion check: strength=%s, T_diff=%.1f°C, fog=%s",
                status.inversion_strength,
                status.temp_diff_c or 0,
                status.fog_likely,
            )

            # Update cache
            await set_cached("inversion-status", "current", _current_status, INVERSION_TTL)

        except Exception as e:
            logger.error("Inversion poll failed: %s", e)

        await asyncio.sleep(1800)  # 30 minutes


def get_current_inversion() -> dict[str, Any] | None:
    """Called by AI context builder to inject inversion status."""
    return _current_status


@router.get("/api/weather/inversion-status")
async def inversion_status():
    """Current temperature inversion detection for the SJV."""
    # Check cache first (populated by the 30-min poll loop)
    cached, hit = await get_cached("inversion-status", "current")
    if cached is not None:
        return JSONResponse(content=_wrap_status(cached), headers=cache_headers(hit, INVERSION_TTL))

    # Check in-memory status from poll loop before hitting external APIs
    if _current_status is not None:
        await set_cached("inversion-status", "current", _current_status, INVERSION_TTL)
        return JSONResponse(content=_wrap_status(_current_status), headers=cache_headers(False, INVERSION_TTL))

    # First-run scenario only — poll loop hasn't run yet; check toggle
    from app.source_toggles import is_enabled
    if not await is_enabled("inversion"):
        return JSONResponse(status_code=503, content={"error": "Inversion source is disabled", "details": "Enable via POST /api/admin/sources/inversion/enable"})

    try:
        status = await get_inversion_status()
        result = status.to_dict()

        pool = await get_pool()
        await _persist_event(pool, status)

        await set_cached("inversion-status", "current", result, INVERSION_TTL)
        return JSONResponse(content=_wrap_status(result), headers=cache_headers(False, INVERSION_TTL))

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=502,
            content={"error": "Inversion detection failed", "details": str(e)},
        )


@router.get("/api/weather/inversion-history")
async def inversion_history(
    days: int = Query(30, ge=1, le=365),
):
    """Historical inversion events."""
    cache_key = f"history-{days}"
    cached, hit = await get_cached("inversion-history", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, INVERSION_TTL))

    pool = await get_pool()

    rows = await pool.fetch(
        """
        SELECT time, surface_temp_c, temp_850mb_c, temp_diff_c,
               surface_dewpoint_c, wind_speed_kts, mixing_height_m,
               inversion_strength, fog_likely, source, sounding_station
        FROM inversion_events
        WHERE time >= now() - make_interval(days => $1)
        ORDER BY time DESC
        """,
        days,
    )

    events = []
    inversion_count = 0
    fog_count = 0
    strong_count = 0

    for r in rows:
        ev = {
            "time": r["time"].isoformat(),
            "surfaceTempC": r["surface_temp_c"],
            "temp850mbC": r["temp_850mb_c"],
            "tempDiffC": r["temp_diff_c"],
            "surfaceDewpointC": r["surface_dewpoint_c"],
            "windSpeedKts": r["wind_speed_kts"],
            "mixingHeightM": r["mixing_height_m"],
            "inversionStrength": r["inversion_strength"],
            "fogLikely": r["fog_likely"],
        }
        events.append(ev)

        if r["inversion_strength"] in ("weak", "moderate", "strong"):
            inversion_count += 1
        if r["inversion_strength"] == "strong":
            strong_count += 1
        if r["fog_likely"]:
            fog_count += 1

    result = {
        "days": days,
        "count": len(events),
        "inversionsDetected": inversion_count,
        "strongInversions": strong_count,
        "fogEvents": fog_count,
        "inversionRate": round(inversion_count / len(events) * 100, 1) if events else 0,
        "events": events,
    }

    await set_cached("inversion-history", cache_key, result, INVERSION_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, INVERSION_TTL))


@router.get("/api/analysis/inversion-aqi-correlation")
async def inversion_aqi_correlation(
    days: int = Query(90, ge=7, le=365),
):
    """Correlate temperature inversions with AQI spikes.

    Joins inversion_events with sensor_readings to show that AQI
    reliably rises during inversion conditions.
    """
    cache_key = f"corr-{days}"
    cached, hit = await get_cached("inversion-aqi-corr", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, CORRELATION_TTL))

    pool = await get_pool()

    # Get inversion events with corresponding AQI within a ±3 hour window
    rows = await pool.fetch(
        """
        WITH inversions AS (
            SELECT time AS inv_time, inversion_strength, temp_diff_c, fog_likely
            FROM inversion_events
            WHERE time >= now() - make_interval(days => $1)
              AND inversion_strength IS NOT NULL
        ),
        aqi_near AS (
            SELECT
                i.inv_time,
                i.inversion_strength,
                i.temp_diff_c,
                i.fog_likely,
                AVG(sr.aqi) AS avg_aqi,
                AVG(sr.pm25) AS avg_pm25,
                COUNT(sr.*) AS reading_count
            FROM inversions i
            LEFT JOIN sensor_readings sr
                ON sr.time BETWEEN i.inv_time - interval '3 hours'
                               AND i.inv_time + interval '3 hours'
            GROUP BY i.inv_time, i.inversion_strength, i.temp_diff_c, i.fog_likely
        )
        SELECT * FROM aqi_near
        ORDER BY inv_time DESC
        """,
        days,
    )

    # Aggregate by inversion strength
    by_strength: dict[str, dict] = {
        "none": {"count": 0, "totalAqi": 0, "totalPm25": 0, "fogCount": 0},
        "weak": {"count": 0, "totalAqi": 0, "totalPm25": 0, "fogCount": 0},
        "moderate": {"count": 0, "totalAqi": 0, "totalPm25": 0, "fogCount": 0},
        "strong": {"count": 0, "totalAqi": 0, "totalPm25": 0, "fogCount": 0},
    }

    data_points = []

    for r in rows:
        strength = r["inversion_strength"]
        avg_aqi = r["avg_aqi"]
        avg_pm25 = r["avg_pm25"]

        if strength in by_strength:
            by_strength[strength]["count"] += 1
            if avg_aqi is not None:
                by_strength[strength]["totalAqi"] += float(avg_aqi)
            if avg_pm25 is not None:
                by_strength[strength]["totalPm25"] += float(avg_pm25)
            if r["fog_likely"]:
                by_strength[strength]["fogCount"] += 1

        data_points.append({
            "time": r["inv_time"].isoformat(),
            "inversionStrength": strength,
            "tempDiffC": r["temp_diff_c"],
            "fogLikely": r["fog_likely"],
            "avgAqi": round(float(avg_aqi), 1) if avg_aqi else None,
            "avgPm25": round(float(avg_pm25), 1) if avg_pm25 else None,
            "readingCount": r["reading_count"],
        })

    # Compute averages per strength category
    summary = {}
    for strength, agg in by_strength.items():
        n = agg["count"]
        summary[strength] = {
            "count": n,
            "avgAqi": round(agg["totalAqi"] / n, 1) if n and agg["totalAqi"] else None,
            "avgPm25": round(agg["totalPm25"] / n, 1) if n and agg["totalPm25"] else None,
            "fogEvents": agg["fogCount"],
        }

    # Calculate correlation strength
    none_aqi = summary.get("none", {}).get("avgAqi")
    strong_aqi = summary.get("strong", {}).get("avgAqi")
    aqi_increase = None
    if none_aqi and strong_aqi:
        aqi_increase = round(strong_aqi - none_aqi, 1)

    result = {
        "days": days,
        "totalEvents": len(data_points),
        "summary": summary,
        "aqiIncreaseDuringStrongInversion": aqi_increase,
        "interpretation": _interpret_correlation(summary, aqi_increase),
        "dataPoints": data_points,
    }

    await set_cached("inversion-aqi-corr", cache_key, result, CORRELATION_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, CORRELATION_TTL))


# ── Helpers ──────────────────────────────────────────

def _wrap_status(status: dict) -> dict:
    """Add interpretive context to the raw inversion status."""
    strength = status.get("inversionStrength", "unknown")
    fog = status.get("fogLikely", False)
    temp_diff = status.get("tempDiffC")

    if strength == "strong":
        advisory = (
            "STRONG temperature inversion detected. Pollutants are trapped near the surface. "
            "Expect elevated PM2.5 and reduced visibility. "
            "Sensitive groups should limit outdoor activity."
        )
    elif strength == "moderate":
        advisory = (
            "Moderate temperature inversion detected. Pollutant dispersion is reduced. "
            "AQI may be elevated, especially in low-lying areas of the valley."
        )
    elif strength == "weak":
        advisory = (
            "Weak temperature inversion present. Some reduction in pollutant dispersion. "
            "Monitor AQI for potential moderate levels."
        )
    else:
        advisory = (
            "No temperature inversion detected. Normal atmospheric mixing conditions. "
            "Pollutant dispersion is favorable."
        )

    if fog:
        advisory += " Tule fog conditions are likely — expect near-zero visibility in valley areas."

    return {
        **status,
        "advisory": advisory,
        "aqiImpact": {
            "none": "minimal",
            "weak": "slight increase likely",
            "moderate": "moderate increase likely (AQI +20-40)",
            "strong": "significant increase likely (AQI +40-80+)",
        }.get(strength, "unknown"),
    }


def _interpret_correlation(summary: dict, aqi_increase: float | None) -> str:
    """Generate a human-readable interpretation of the correlation data."""
    if not summary or all(s.get("count", 0) == 0 for s in summary.values()):
        return "Insufficient data for correlation analysis. More inversion events need to be recorded."

    parts = []

    none_data = summary.get("none", {})
    strong_data = summary.get("strong", {})

    if none_data.get("avgAqi") and strong_data.get("avgAqi"):
        parts.append(
            f"Average AQI during no inversion: {none_data['avgAqi']}. "
            f"During strong inversions: {strong_data['avgAqi']}."
        )

    if aqi_increase is not None:
        if aqi_increase > 30:
            parts.append(
                f"Strong inversions increase AQI by ~{aqi_increase} points on average, "
                "confirming that the valley bowl effect significantly traps pollutants."
            )
        elif aqi_increase > 10:
            parts.append(
                f"Strong inversions increase AQI by ~{aqi_increase} points on average, "
                "showing a clear correlation between inversions and air quality degradation."
            )

    mod_data = summary.get("moderate", {})
    if mod_data.get("fogEvents", 0) > 0:
        parts.append(
            f"{mod_data['fogEvents']} fog events detected during moderate+ inversions."
        )

    return " ".join(parts) if parts else "Correlation data is being collected."


async def _persist_event(pool, status: InversionStatus) -> None:
    """Save an inversion detection event to the database."""
    try:
        await pool.execute(
            """
            INSERT INTO inversion_events (
                time, surface_temp_c, temp_850mb_c, temp_diff_c,
                surface_dewpoint_c, wind_speed_kts, mixing_height_m,
                inversion_strength, fog_likely, source, sounding_station
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            """,
            status.time,
            status.surface_temp_c,
            status.temp_850mb_c,
            status.temp_diff_c,
            status.surface_dewpoint_c,
            status.wind_speed_kts,
            status.mixing_height_m,
            status.inversion_strength,
            status.fog_likely,
            status.source,
            status.sounding_station,
        )
    except Exception as e:
        logger.error("Inversion persist error: %s", e)
