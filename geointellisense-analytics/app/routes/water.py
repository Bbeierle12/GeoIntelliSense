import asyncio
import logging
import traceback
from datetime import date, timedelta

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.usgs_water import fetch_current, fetch_historical, SJV_STATIONS, WaterReading
from app.database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

CURRENT_TTL = 900     # 15 minutes
HISTORICAL_TTL = 86400  # 24 hours

# Background polling task
_poll_task: asyncio.Task | None = None


async def start_water_polling():
    """Start background task that polls USGS every 15 minutes."""
    global _poll_task
    if _poll_task and not _poll_task.done():
        return
    _poll_task = asyncio.create_task(_poll_loop())
    logger.info("USGS Water polling started (15 min interval)")


async def _poll_loop():
    while True:
        try:
            from app.source_toggles import is_enabled
            if not await is_enabled("usgs_water"):
                await asyncio.sleep(900)
                continue

            readings = await fetch_current()
            if readings:
                pool = await get_pool()
                inserted = await _persist_readings(pool, readings)
                logger.info("USGS Water poll: %d readings, %d new", len(readings), inserted)

                # Update cache
                current = _format_current(readings)
                await set_cached("water-current", "all", current, CURRENT_TTL)
        except Exception as e:
            logger.error("USGS Water poll failed: %s", e)

        await asyncio.sleep(900)  # 15 minutes


def _parse_bbox(bbox_str: str | None) -> tuple[float, float, float, float] | None:
    if not bbox_str:
        return None
    try:
        parts = [float(x) for x in bbox_str.split(",")]
        if len(parts) == 4:
            return (parts[0], parts[1], parts[2], parts[3])
    except ValueError:
        pass
    return None


@router.get("/api/water/current")
async def water_current(
    site_ids: str | None = Query(None, description="Comma-separated USGS site IDs (defaults to SJV stations)"),
    bbox: str | None = Query(None, description="Bounding box: south,west,north,east"),
):
    custom_sites = None
    if site_ids:
        custom_sites = [s.strip() for s in site_ids.split(",") if s.strip()]

    bbox_tuple = _parse_bbox(bbox)

    cache_key = bbox or site_ids or "all"
    cached, hit = await get_cached("water-current", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, CURRENT_TTL))

    # Check DB for recent readings before hitting external API
    # (the poll loop may have data even if the cache expired)
    pool = await get_pool()
    try:
        if custom_sites:
            rows = await pool.fetch(
                """
                SELECT DISTINCT ON (site_id)
                    site_id, site_name, parameter, value, units AS unit, time
                FROM water_readings
                WHERE time > now() - interval '2 hours'
                  AND site_id = ANY($1::text[])
                ORDER BY site_id, time DESC
                """,
                custom_sites,
            )
        else:
            rows = await pool.fetch(
                """
                SELECT DISTINCT ON (site_id)
                    site_id, site_name, parameter, value, units AS unit, time
                FROM water_readings
                WHERE time > now() - interval '2 hours'
                ORDER BY site_id, time DESC
                """
            )
    except Exception:
        rows = []

    if rows:
        result = _format_db_current(rows)
        await set_cached("water-current", cache_key, result, CURRENT_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, CURRENT_TTL))

    # No DB data and no cache — fetch from USGS only if source is enabled
    from app.source_toggles import is_enabled
    if not await is_enabled("usgs_water"):
        return JSONResponse(status_code=503, content={"error": "USGS Water source is disabled", "details": "Enable via POST /api/admin/sources/usgs_water/enable"})

    try:
        readings = await fetch_current(sites=custom_sites, bbox=bbox_tuple)

        if readings:
            await _persist_readings(pool, readings)

        result = _format_current(readings)
        await set_cached("water-current", cache_key, result, CURRENT_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, CURRENT_TTL))
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=502, content={"error": "USGS Water request failed", "details": str(e)})


@router.get("/api/water/historical")
async def water_historical(
    site: str = Query("11189500", description="USGS site ID"),
    start: date | None = Query(None),
    end: date | None = Query(None),
):
    if end is None:
        end = date.today()
    if start is None:
        start = end - timedelta(days=365)

    cache_key = {"site": site, "s": str(start), "e": str(end)}
    cached, hit = await get_cached("water-historical", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, HISTORICAL_TTL))

    # Check DB first
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT time, site_id, site_name, parameter, value, units, qualifier
        FROM water_readings
        WHERE site_id = $1 AND time >= $2 AND time <= $3
        ORDER BY time, parameter
        """,
        site, start, end,
    )

    if rows:
        result = _format_historical_from_db(rows, site, start, end)
        await set_cached("water-historical", cache_key, result, HISTORICAL_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, HISTORICAL_TTL))

    # Fetch from USGS
    try:
        readings = await fetch_historical(site, start.isoformat(), end.isoformat())
        if readings:
            await _persist_readings(pool, readings)

        result = _format_historical(readings, site, start, end)
        await set_cached("water-historical", cache_key, result, HISTORICAL_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, HISTORICAL_TTL))
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=502, content={"error": "USGS Water historical request failed", "details": str(e)})


# ── Helpers ──────────────────────────────────────────

def _format_db_current(rows) -> dict:
    """Format DB rows as current water readings (avoids external API call)."""
    sites: dict = {}
    for r in rows:
        site_id = r["site_id"]
        if site_id not in sites:
            sites[site_id] = {
                "siteId": site_id,
                "siteName": r["site_name"],
                "readings": {},
            }
        sites[site_id]["readings"][r["parameter"]] = {
            "value": r["value"],
            "units": r["unit"],
            "time": r["time"].isoformat(),
        }
    return {
        "count": len(sites),
        "source": "usgs",
        "stations": list(sites.values()),
    }


def _format_current(readings: list[WaterReading]) -> dict:
    # Group by site
    sites: dict = {}
    for r in readings:
        if r.site_id not in sites:
            sites[r.site_id] = {
                "siteId": r.site_id,
                "siteName": r.site_name,
                "lat": r.latitude,
                "lng": r.longitude,
                "readings": {},
            }
        sites[r.site_id]["readings"][r.parameter] = {
            "value": r.value,
            "units": r.units,
            "time": r.time,
            "qualifier": r.qualifier,
        }

    return {
        "count": len(sites),
        "source": "usgs",
        "stations": list(sites.values()),
    }


def _format_historical(readings: list[WaterReading], site: str, start, end) -> dict:
    data = []
    for r in readings:
        data.append({
            "time": r.time,
            "parameter": r.parameter,
            "value": r.value,
            "units": r.units,
            "qualifier": r.qualifier,
        })
    site_name = SJV_STATIONS.get(site, site)
    return {
        "count": len(data),
        "siteId": site,
        "siteName": site_name,
        "startDate": start.isoformat() if hasattr(start, 'isoformat') else str(start),
        "endDate": end.isoformat() if hasattr(end, 'isoformat') else str(end),
        "data": data,
    }


def _format_historical_from_db(rows, site, start, end) -> dict:
    data = []
    site_name = ""
    for r in rows:
        if not site_name:
            site_name = r["site_name"] or ""
        data.append({
            "time": r["time"].isoformat(),
            "parameter": r["parameter"],
            "value": r["value"],
            "units": r["units"],
            "qualifier": r["qualifier"] or "",
        })
    return {
        "count": len(data),
        "siteId": site,
        "siteName": site_name or SJV_STATIONS.get(site, site),
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "data": data,
    }


async def _persist_readings(pool, readings: list[WaterReading]) -> int:
    from datetime import datetime as dt

    inserted = 0
    for r in readings:
        try:
            # Parse ISO timestamp string to datetime
            ts = r.time
            if isinstance(ts, str):
                ts = dt.fromisoformat(ts.replace(".000", ""))

            result = await pool.execute(
                """
                INSERT INTO water_readings (time, site_id, site_name, parameter, value, units, qualifier, latitude, longitude)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (time, site_id, parameter) DO NOTHING
                """,
                ts, r.site_id, r.site_name, r.parameter, r.value, r.units, r.qualifier or "", r.latitude, r.longitude,
            )
            if "INSERT" in result:
                inserted += 1
        except Exception as e:
            logger.error("Water persist error for %s: %s", r.site_id, e)
    return inserted
