"""
Hourly sensor-vs-EPA drift check.

Records our corrected PurpleAir PM2.5 index alongside AirNow's PM2.5 sub-index
for the same community, so a persistent divergence is visible instead of being
discovered by eye months later.
"""

import asyncio
import logging

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.database import get_pool
from app.routes.aqi_headline import _airnow_by_area, _sensor_readings, COMMUNITY_TO_REPORTING_AREA

router = APIRouter()
logger = logging.getLogger(__name__)

INTERVAL_SECS = 3600
_task: asyncio.Task | None = None


async def record_once() -> int:
    """Write one comparison row per community. Returns rows written."""
    sensors = await _sensor_readings()
    airnow = await _airnow_by_area()
    if not sensors and not airnow:
        return 0

    pool = await get_pool()
    written = 0

    for community, area in COMMUNITY_TO_REPORTING_AREA.items():
        sensor = sensors.get(community)
        official = airnow.get(area) if area else None
        if sensor is None and official is None:
            continue

        sensor_aqi = sensor["aqi"] if sensor else None
        airnow_pm25 = official.get("pm25Aqi") if official else None
        delta = (
            sensor_aqi - airnow_pm25
            if sensor_aqi is not None and airnow_pm25 is not None
            else None
        )

        try:
            await pool.execute(
                """
                INSERT INTO aqi_validation
                    (time, community, reporting_area, sensor_pm25, sensor_pm25_aqi,
                     sensor_count, airnow_pm25_aqi, airnow_aqi, airnow_dominant,
                     delta_pm25_aqi)
                VALUES (now(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                community,
                area,
                sensor["pm25"] if sensor else None,
                sensor_aqi,
                sensor.get("rawSensorCount") if sensor else None,
                airnow_pm25,
                official["aqi"] if official else None,
                official.get("dominantPollutant") if official else None,
                delta,
            )
            written += 1
        except Exception as e:
            logger.error("validation insert failed for %s: %s", community, e)

    logger.info("aqi validation: wrote %d comparison rows", written)
    return written


async def _loop() -> None:
    # Let the first PurpleAir poll land before the first comparison.
    await asyncio.sleep(120)
    while True:
        try:
            await record_once()
        except Exception as e:
            logger.error("aqi validation loop error: %s", e)
        await asyncio.sleep(INTERVAL_SECS)


async def start_validation_logging() -> None:
    global _task
    if _task and not _task.done():
        return
    _task = asyncio.create_task(_loop())
    logger.info("AQI validation logging started (hourly)")


@router.get("/api/aqi/validation")
async def aqi_validation(
    days: int = Query(7, ge=1, le=90),
    community: str | None = Query(None),
):
    """Recent sensor-vs-EPA drift, newest first, plus a per-community summary."""
    pool = await get_pool()

    where = "time >= now() - make_interval(days => $1)"
    params: list = [days]
    if community:
        where += " AND community = $2"
        params.append(community)

    rows = await pool.fetch(
        f"""
        SELECT time, community, reporting_area, sensor_pm25, sensor_pm25_aqi,
               sensor_count, airnow_pm25_aqi, airnow_aqi, airnow_dominant,
               delta_pm25_aqi
          FROM aqi_validation
         WHERE {where}
         ORDER BY time DESC
         LIMIT 500
        """,
        *params,
    )

    summary = await pool.fetch(
        f"""
        SELECT community,
               count(*) AS samples,
               round(avg(delta_pm25_aqi)::numeric, 1) AS mean_delta,
               max(abs(delta_pm25_aqi)) AS max_abs_delta
          FROM aqi_validation
         WHERE {where} AND delta_pm25_aqi IS NOT NULL
         GROUP BY community
         ORDER BY abs(avg(delta_pm25_aqi)) DESC
        """,
        *params,
    )

    return JSONResponse(content={
        "days": days,
        "summary": [dict(r) for r in summary],
        "samples": [
            {**dict(r), "time": r["time"].isoformat()} for r in rows
        ],
        "note": (
            "delta_pm25_aqi is our corrected sensor PM2.5 index minus AirNow's "
            "PM2.5 sub-index for the same community. A persistent offset means "
            "the correction, the sensor bucketing or the sensor population "
            "needs review."
        ),
    })
