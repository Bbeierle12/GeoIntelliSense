import asyncio
import logging
import traceback
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.caltrans import fetch_county_traffic, KEY_ROUTES, TrafficStation
from app.database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

TRAFFIC_TTL = 300  # 5 minutes for "current" (AADT is static but we present it as current conditions)
HISTORICAL_TTL = 604800  # 7 days (AADT updates annually)

# Backfill state
_backfill_task: asyncio.Task | None = None
_backfill_status: dict[str, Any] = {"state": "idle"}


@router.get("/api/traffic/current")
async def traffic_current(
    corridor: str | None = Query(None, description="Route number (e.g. 99, 58, 5). Omit for all key corridors."),
):
    cache_key = corridor or "key-corridors"
    cached, hit = await get_cached("traffic-current", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, TRAFFIC_TTL))

    pool = await get_pool()

    # Check DB first
    if corridor:
        rows = await pool.fetch(
            "SELECT route, postmile, description, county, ahead_aadt, ahead_peak_hour, back_aadt FROM traffic_readings WHERE route = $1 ORDER BY postmile",
            corridor,
        )
    else:
        route_filter = ",".join(f"'{r}'" for r in KEY_ROUTES)
        rows = await pool.fetch(
            f"SELECT route, postmile, description, county, ahead_aadt, ahead_peak_hour, back_aadt FROM traffic_readings WHERE route IN ({route_filter}) ORDER BY route, postmile",
        )

    if rows:
        result = _format_db_rows(rows, corridor)
        await set_cached("traffic-current", cache_key, result, TRAFFIC_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, TRAFFIC_TTL))

    # No DB data — fetch from Caltrans
    try:
        routes = [corridor] if corridor else KEY_ROUTES
        stations = await fetch_county_traffic("KER", routes)
        if stations:
            await _persist_stations(pool, stations)

        result = _format_stations(stations, corridor)
        await set_cached("traffic-current", cache_key, result, TRAFFIC_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, TRAFFIC_TTL))
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=502, content={"error": "Caltrans request failed", "details": str(e)})


@router.get("/api/traffic/historical")
async def traffic_historical(
    corridor: str = Query("99", description="Route number"),
):
    cache_key = f"hist-{corridor}"
    cached, hit = await get_cached("traffic-historical", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, HISTORICAL_TTL))

    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT route, postmile, description, county, ahead_aadt, ahead_peak_hour, back_aadt
        FROM traffic_readings
        WHERE route = $1
        ORDER BY postmile
        """,
        corridor,
    )

    if not rows:
        # Fetch and persist
        try:
            stations = await fetch_county_traffic("KER", [corridor])
            if stations:
                await _persist_stations(pool, stations)
            rows = await pool.fetch(
                "SELECT route, postmile, description, county, ahead_aadt, ahead_peak_hour, back_aadt FROM traffic_readings WHERE route = $1 ORDER BY postmile",
                corridor,
            )
        except Exception as e:
            traceback.print_exc()
            return JSONResponse(status_code=502, content={"error": "Caltrans request failed", "details": str(e)})

    result = _format_db_rows(rows, corridor)
    await set_cached("traffic-historical", cache_key, result, HISTORICAL_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, HISTORICAL_TTL))


# ── Backfill ─────────────────────────────────────────

@router.post("/api/traffic/backfill")
async def start_backfill():
    global _backfill_task, _backfill_status

    if _backfill_task and not _backfill_task.done():
        return JSONResponse(status_code=409, content={"error": "Backfill in progress", "status": _backfill_status})

    _backfill_status = {"state": "running", "stationsFetched": 0, "stationsInserted": 0, "errors": []}
    _backfill_task = asyncio.create_task(_run_backfill())
    return {"message": "Traffic backfill started", "status": _backfill_status}


@router.get("/api/traffic/backfill/status")
async def backfill_status():
    return _backfill_status


async def _run_backfill():
    global _backfill_status

    pool = await get_pool()
    try:
        stations = await fetch_county_traffic("KER")
        _backfill_status["stationsFetched"] = len(stations)

        inserted = await _persist_stations(pool, stations)
        _backfill_status["stationsInserted"] = inserted
        _backfill_status["state"] = "completed"
        logger.info("Traffic backfill: %d/%d stations", inserted, len(stations))
    except Exception as e:
        traceback.print_exc()
        _backfill_status["state"] = "failed"
        _backfill_status["errors"].append(str(e))


# ── Helpers ──────────────────────────────────────────

def _format_stations(stations: list[TrafficStation], corridor: str | None) -> dict:
    by_route: dict[str, list] = {}
    for s in stations:
        if s.route not in by_route:
            by_route[s.route] = []
        by_route[s.route].append(s.to_dict())

    return {
        "count": len(stations),
        "corridor": corridor,
        "source": "caltrans_aadt",
        "routes": by_route,
    }


def _format_db_rows(rows, corridor: str | None) -> dict:
    by_route: dict[str, list] = {}
    for r in rows:
        rte = r["route"]
        if rte not in by_route:
            by_route[rte] = []
        by_route[rte].append({
            "route": rte,
            "postmile": r["postmile"],
            "description": r["description"],
            "county": r["county"],
            "aheadAADT": r["ahead_aadt"],
            "aheadPeakHour": r["ahead_peak_hour"],
            "backAADT": r["back_aadt"],
        })

    total = sum(len(v) for v in by_route.values())
    return {
        "count": total,
        "corridor": corridor,
        "source": "caltrans_aadt",
        "routes": by_route,
    }


async def _persist_stations(pool, stations: list[TrafficStation]) -> int:
    inserted = 0
    for s in stations:
        try:
            geom_sql = "ST_GeomFromText($8, 4326)" if s.geom_wkt else "NULL"
            params = [
                s.route, s.postmile, s.description, s.county,
                s.ahead_aadt, s.ahead_peak_hour, s.back_aadt,
            ]
            if s.geom_wkt:
                params.append(s.geom_wkt)

            result = await pool.execute(
                f"""
                INSERT INTO traffic_readings (route, postmile, description, county, ahead_aadt, ahead_peak_hour, back_aadt, geom)
                VALUES ($1, $2, $3, $4, $5, $6, $7, {geom_sql})
                ON CONFLICT (route, postmile, description) DO UPDATE SET
                    ahead_aadt = EXCLUDED.ahead_aadt,
                    ahead_peak_hour = EXCLUDED.ahead_peak_hour,
                    back_aadt = EXCLUDED.back_aadt,
                    updated_at = now()
                """,
                *params,
            )
            if "INSERT" in result or "UPDATE" in result:
                inserted += 1
        except Exception as e:
            logger.error("Traffic persist error for Rte %s PM %s: %s", s.route, s.postmile, e)
    return inserted
