import asyncio
import logging
import traceback
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.config import settings
from app.clients.epa_aqs import EpaAqsClient, SJV_COUNTIES, PARAMS_ALL, DailySummary
from app.database import get_pool
from app.middleware import check_admin_auth

router = APIRouter()
logger = logging.getLogger(__name__)

EPA_DAILY_TTL = 86400  # 24 hours — historical data doesn't change

# ── Backfill state (in-memory, single-worker) ────────
_backfill_task: asyncio.Task | None = None
_backfill_status: dict[str, Any] = {"state": "idle"}


@router.get("/api/epa-aqi")
async def epa_aqi(
    county: str | None = Query(None, description="County FIPS code (e.g. 029 for Kern). Omit for all SJV."),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    param: str = Query("88101", description="EPA parameter code (88101=PM2.5, 81102=PM10, 44201=Ozone)"),
):
    if not settings.epa_aqs_email or not settings.epa_aqs_key:
        return JSONResponse(status_code=503, content={"error": "EPA AQS not configured", "details": "Set EPA_AQS_EMAIL and EPA_AQS_KEY"})

    if end_date is None:
        end_date = date.today()
    if start_date is None:
        start_date = end_date - timedelta(days=30)

    if (end_date - start_date).days > 365:
        return JSONResponse(status_code=400, content={"error": "Date range too large", "details": "EPA AQS limits queries to 365 days"})

    cache_key = {"county": county or "all", "s": str(start_date), "e": str(end_date), "p": param}
    cached, hit = await get_cached("epa-aqi", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, EPA_DAILY_TTL))

    client = EpaAqsClient(settings.epa_aqs_email, settings.epa_aqs_key)
    try:
        if county:
            results = await client.get_daily_by_county(county, param, start_date, end_date)
        else:
            results = []
            for code in SJV_COUNTIES:
                batch = await client.get_daily_by_county(code, param, start_date, end_date)
                results.extend(batch)

        response = {
            "count": len(results),
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
            "parameter": param,
            "data": [r.model_dump() for r in results],
        }

        await set_cached("epa-aqi", cache_key, response, EPA_DAILY_TTL)
        return JSONResponse(content=response, headers=cache_headers(False, EPA_DAILY_TTL))
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=502, content={"error": "EPA AQS request failed", "details": str(e)})
    finally:
        await client.close()


# ── Backfill endpoints ───────────────────────────────

@router.post("/api/epa-aqs/backfill")
async def start_backfill(
    request: Request,
    start_year: int = Query(2023, description="Start year"),
    end_year: int = Query(2025, description="End year (inclusive)"),
):
    auth_err = check_admin_auth(request)
    if auth_err:
        return auth_err

    global _backfill_task, _backfill_status

    if not settings.epa_aqs_email or not settings.epa_aqs_key:
        return JSONResponse(status_code=503, content={"error": "EPA AQS not configured"})

    if _backfill_task and not _backfill_task.done():
        return JSONResponse(status_code=409, content={"error": "Backfill already in progress", "status": _backfill_status})

    _backfill_status = {
        "state": "running",
        "startYear": start_year,
        "endYear": end_year,
        "currentCounty": "",
        "currentYear": 0,
        "currentParam": "",
        "rowsInserted": 0,
        "errors": [],
    }

    _backfill_task = asyncio.create_task(_run_backfill(start_year, end_year))
    return {"message": "Backfill started", "status": _backfill_status}


@router.get("/api/epa-aqs/backfill/status")
async def backfill_status():
    return _backfill_status


async def _run_backfill(start_year: int, end_year: int) -> None:
    global _backfill_status

    pool = await get_pool()
    client = EpaAqsClient(settings.epa_aqs_email, settings.epa_aqs_key)

    total_inserted = 0

    try:
        for year in range(start_year, end_year + 1):
            for county_code, county_name in SJV_COUNTIES.items():
                for param in PARAMS_ALL:
                    param_name = {"88101": "PM2.5", "81102": "PM10", "44201": "Ozone"}.get(param, param)
                    _backfill_status.update({
                        "currentCounty": county_name,
                        "currentYear": year,
                        "currentParam": param_name,
                    })

                    try:
                        results = await client.backfill_county_year(county_code, param, year)
                        if results:
                            inserted = await _persist_summaries(pool, results)
                            total_inserted += inserted
                            _backfill_status["rowsInserted"] = total_inserted
                            logger.info("Backfill: %s/%s/%d — %d rows inserted", county_name, param_name, year, inserted)
                    except Exception as e:
                        err = f"{county_name}/{param_name}/{year}: {e}"
                        logger.error("Backfill error: %s", err)
                        _backfill_status["errors"].append(err)

        _backfill_status["state"] = "completed"
    except Exception as e:
        _backfill_status["state"] = "failed"
        _backfill_status["errors"].append(str(e))
    finally:
        await client.close()
        _backfill_status["rowsInserted"] = total_inserted


async def _persist_summaries(pool, summaries: list[DailySummary]) -> int:
    inserted = 0
    for s in summaries:
        try:
            result = await pool.execute(
                """
                INSERT INTO epa_daily_summaries
                    (date, state_code, county_code, county_name, site_number,
                     parameter_code, parameter_name, aqi, arithmetic_mean,
                     first_max_value, units, latitude, longitude, geom)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                        CASE WHEN $12 IS NOT NULL AND $13 IS NOT NULL
                             THEN ST_SetSRID(ST_MakePoint($13, $12), 4326)
                             ELSE NULL END)
                ON CONFLICT (date, state_code, county_code, site_number, parameter_code)
                DO NOTHING
                """,
                s.date,
                s.state_code,
                s.county_code,
                s.county,
                s.site_number,
                s.parameter_code,
                s.parameter,
                s.aqi,
                s.arithmetic_mean,
                s.first_max_value,
                s.units,
                s.latitude,
                s.longitude,
            )
            if "INSERT" in result:
                inserted += 1
        except Exception as e:
            logger.error("EPA persist error: %s", e)
    return inserted
