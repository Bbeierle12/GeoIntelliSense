import asyncio
import logging
import traceback
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.noaa_cdo import NoaaCdoClient, DEFAULT_STATION, SJV_STATIONS, WeatherObs
from app.config import settings
from app.database import get_pool
from app.middleware import check_admin_auth

router = APIRouter()
logger = logging.getLogger(__name__)

WEATHER_TTL = 86400  # 24 hours

# ── Backfill state ───
_backfill_task: asyncio.Task | None = None
_backfill_status: dict[str, Any] = {"state": "idle"}


@router.get("/api/weather/historical")
async def weather_historical(
    start: date | None = Query(None, description="Start date YYYY-MM-DD"),
    end: date | None = Query(None, description="End date YYYY-MM-DD"),
    station: str = Query(DEFAULT_STATION, description="NOAA station ID"),
):
    if end is None:
        end = date.today()
    if start is None:
        start = end - timedelta(days=365)

    pool = await get_pool()

    # Try DB first
    cache_key = {"s": str(start), "e": str(end), "st": station}
    cached, hit = await get_cached("weather-historical", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, WEATHER_TTL))

    rows = await pool.fetch(
        """
        SELECT date, station_id, station_name, parameter, value, units, quality_flag
        FROM weather_observations
        WHERE station_id = $1 AND date >= $2 AND date <= $3
        ORDER BY date, parameter
        """,
        station, start, end,
    )

    if rows:
        result = _format_response(rows, start, end, station)
        await set_cached("weather-historical", cache_key, result, WEATHER_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, WEATHER_TTL))

    # No DB data — try fetching from NOAA CDO if configured
    if not settings.noaa_cdo_token:
        return JSONResponse(
            status_code=503,
            content={"error": "No weather data available", "details": "Set NOAA_CDO_TOKEN to enable historical weather data"},
        )

    client = NoaaCdoClient(settings.noaa_cdo_token)
    try:
        obs = await client.fetch_daily(station, start, end)
        if obs:
            await _persist_observations(pool, obs)

        result = _format_from_obs(obs, start, end, station)
        await set_cached("weather-historical", cache_key, result, WEATHER_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, WEATHER_TTL))
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=502, content={"error": "NOAA CDO request failed", "details": str(e)})
    finally:
        await client.close()


@router.post("/api/weather/backfill")
async def start_weather_backfill(
    request: Request,
    start_year: int = Query(2021, description="Start year"),
    end_year: int = Query(2025, description="End year"),
    station: str = Query(DEFAULT_STATION),
):
    auth_err = check_admin_auth(request)
    if auth_err:
        return auth_err

    global _backfill_task, _backfill_status

    if not settings.noaa_cdo_token:
        return JSONResponse(status_code=503, content={"error": "NOAA CDO not configured"})

    if _backfill_task and not _backfill_task.done():
        return JSONResponse(status_code=409, content={"error": "Weather backfill in progress", "status": _backfill_status})

    _backfill_status = {
        "state": "running",
        "station": station,
        "startYear": start_year,
        "endYear": end_year,
        "currentYear": 0,
        "rowsInserted": 0,
        "errors": [],
    }

    _backfill_task = asyncio.create_task(_run_weather_backfill(station, start_year, end_year))
    return {"message": "Weather backfill started", "status": _backfill_status}


@router.get("/api/weather/backfill/status")
async def weather_backfill_status():
    return _backfill_status


# ── Correlation endpoint ─────────────────────────────

@router.get("/api/analysis/aqi-weather-correlation")
async def aqi_weather_correlation(
    start: date | None = Query(None),
    end: date | None = Query(None),
    station: str = Query(DEFAULT_STATION),
):
    if end is None:
        end = date.today()
    if start is None:
        start = end - timedelta(days=365)

    cache_key = {"corr": True, "s": str(start), "e": str(end), "st": station}
    cached, hit = await get_cached("aqi-weather-corr", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, WEATHER_TTL))

    pool = await get_pool()

    rows = await pool.fetch(
        """
        WITH daily_aqi AS (
            SELECT
                date_trunc('day', sr.time)::date AS date,
                avg(sr.aqi) AS avg_aqi,
                avg(sr.pm25) AS avg_pm25
            FROM sensor_readings sr
            WHERE sr.time >= $1 AND sr.time <= $2
              AND sr.source = 'purpleair'
            GROUP BY 1
        ),
        daily_weather AS (
            SELECT
                wo.date,
                max(CASE WHEN wo.parameter = 'TMAX' THEN wo.value END) AS tmax,
                min(CASE WHEN wo.parameter = 'TMIN' THEN wo.value END) AS tmin,
                max(CASE WHEN wo.parameter = 'PRCP' THEN wo.value END) AS precip,
                max(CASE WHEN wo.parameter = 'AWND' THEN wo.value END) AS wind_speed
            FROM weather_observations wo
            WHERE wo.station_id = $3 AND wo.date >= $1 AND wo.date <= $2
            GROUP BY 1
        )
        SELECT
            a.date,
            round(a.avg_aqi::numeric) AS aqi,
            round(a.avg_pm25::numeric, 1) AS pm25,
            w.tmax,
            w.tmin,
            w.precip,
            w.wind_speed
        FROM daily_aqi a
        JOIN daily_weather w ON a.date = w.date
        ORDER BY a.date
        """,
        start, end, station,
    )

    points = []
    for r in rows:
        points.append({
            "date": r["date"].isoformat(),
            "aqi": float(r["aqi"]) if r["aqi"] is not None else None,
            "pm25": float(r["pm25"]) if r["pm25"] is not None else None,
            "tmax": r["tmax"],
            "tmin": r["tmin"],
            "precip": r["precip"],
            "windSpeed": r["wind_speed"],
        })

    result = {
        "count": len(points),
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "station": station,
        "points": points,
    }

    if points:
        await set_cached("aqi-weather-corr", cache_key, result, WEATHER_TTL)

    return JSONResponse(content=result, headers=cache_headers(False, WEATHER_TTL))


# ── Helpers ──────────────────────────────────────────

def _format_response(rows, start, end, station) -> dict:
    data = []
    for r in rows:
        data.append({
            "date": r["date"].isoformat(),
            "stationId": r["station_id"],
            "stationName": r["station_name"],
            "parameter": r["parameter"],
            "value": r["value"],
            "units": r["units"],
            "qualityFlag": r["quality_flag"] or "",
        })
    return {
        "count": len(data),
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "station": station,
        "data": data,
    }


def _format_from_obs(obs: list[WeatherObs], start, end, station) -> dict:
    data = [
        {
            "date": o.date,
            "stationId": o.station_id,
            "stationName": o.station_name,
            "parameter": o.parameter,
            "value": o.value,
            "units": o.units,
            "qualityFlag": o.quality_flag,
        }
        for o in obs
    ]
    return {
        "count": len(data),
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "station": station,
        "data": data,
    }


async def _persist_observations(pool, obs: list[WeatherObs]) -> int:
    inserted = 0
    for o in obs:
        try:
            result = await pool.execute(
                """
                INSERT INTO weather_observations (date, station_id, station_name, parameter, value, units, quality_flag)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (date, station_id, parameter) DO NOTHING
                """,
                o.date, o.station_id, o.station_name, o.parameter, o.value, o.units, o.quality_flag,
            )
            if "INSERT" in result:
                inserted += 1
        except Exception as e:
            logger.error("Weather persist error: %s", e)
    return inserted


async def _run_weather_backfill(station: str, start_year: int, end_year: int) -> None:
    global _backfill_status

    pool = await get_pool()
    client = NoaaCdoClient(settings.noaa_cdo_token)
    total_inserted = 0

    try:
        for year in range(start_year, end_year + 1):
            _backfill_status["currentYear"] = year
            try:
                start = date(year, 1, 1)
                end = date(year, 12, 31)
                obs = await client.fetch_daily(station, start, end)
                if obs:
                    inserted = await _persist_observations(pool, obs)
                    total_inserted += inserted
                    _backfill_status["rowsInserted"] = total_inserted
                    logger.info("Weather backfill: %s/%d — %d rows", station, year, inserted)
            except Exception as e:
                err = f"{station}/{year}: {e}"
                logger.error("Weather backfill error: %s", err)
                _backfill_status["errors"].append(err)

        _backfill_status["state"] = "completed"
    except Exception as e:
        _backfill_status["state"] = "failed"
        _backfill_status["errors"].append(str(e))
    finally:
        await client.close()
        _backfill_status["rowsInserted"] = total_inserted
