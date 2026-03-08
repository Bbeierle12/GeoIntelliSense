import asyncio
import logging
import traceback
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.calgem import fetch_wells_for_county, SJV_COUNTIES, CalgemWell
from app.database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

WELLS_TTL = 604800  # 7 days — well data is mostly static

# ── Backfill state ───
_backfill_task: asyncio.Task | None = None
_backfill_status: dict[str, Any] = {"state": "idle"}


@router.get("/api/calgem/wells")
async def wells_bbox(
    bbox: str = Query(..., description="Bounding box: south_lat,west_lng,north_lat,east_lng"),
    status: str | None = Query(None, description="Filter by well status (e.g. Active, Idle, Plugged)"),
    limit: int = Query(1000, ge=1, le=10000),
):
    """Wells within a bounding box. Uses PostGIS ST_Within."""
    parts = [float(x.strip()) for x in bbox.split(",")]
    if len(parts) != 4:
        return JSONResponse(status_code=400, content={"error": "bbox must be south_lat,west_lng,north_lat,east_lng"})

    south, west, north, east = parts

    cache_key = {"bbox": bbox, "status": status or "all", "limit": limit}
    cached, hit = await get_cached("calgem-bbox", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, WELLS_TTL))

    pool = await get_pool()

    query = """
        SELECT api_number, name, well_type, status, operator, county, depth_ft,
               ST_Y(geom) AS lat, ST_X(geom) AS lng
        FROM wells
        WHERE ST_Within(
            geom,
            ST_MakeEnvelope($1, $2, $3, $4, 4326)
        )
    """
    params: list = [west, south, east, north]
    idx = 4

    if status:
        idx += 1
        query += f" AND status ILIKE ${idx}"
        params.append(f"%{status}%")

    query += f" LIMIT ${idx + 1}"
    params.append(limit)

    rows = await pool.fetch(query, *params)

    result = {
        "count": len(rows),
        "bbox": {"south": south, "west": west, "north": north, "east": east},
        "wells": [_row_to_dict(r) for r in rows],
    }

    await set_cached("calgem-bbox", cache_key, result, WELLS_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, WELLS_TTL))


@router.get("/api/calgem/wells/nearby")
async def wells_nearby(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
    radius_km: float = Query(5.0, ge=0.1, le=100, description="Radius in km"),
    status: str | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
):
    """Wells near a point. Uses PostGIS ST_DWithin on geography."""
    cache_key = {"lat": lat, "lon": lon, "r": radius_km, "status": status or "all", "limit": limit}
    cached, hit = await get_cached("calgem-nearby", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, WELLS_TTL))

    pool = await get_pool()
    radius_m = radius_km * 1000

    query = """
        SELECT api_number, name, well_type, status, operator, county, depth_ft,
               ST_Y(geom) AS lat, ST_X(geom) AS lng,
               ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m
        FROM wells
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3
        )
    """
    params: list = [lon, lat, radius_m]
    idx = 3

    if status:
        idx += 1
        query += f" AND status ILIKE ${idx}"
        params.append(f"%{status}%")

    query += f" ORDER BY distance_m LIMIT ${idx + 1}"
    params.append(limit)

    rows = await pool.fetch(query, *params)

    result = {
        "count": len(rows),
        "center": {"lat": lat, "lon": lon},
        "radiusKm": radius_km,
        "wells": [
            {**_row_to_dict(r), "distanceKm": round(r["distance_m"] / 1000, 2)}
            for r in rows
        ],
    }

    await set_cached("calgem-nearby", cache_key, result, WELLS_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, WELLS_TTL))


# ── Backfill ─────────────────────────────────────────

@router.post("/api/calgem/backfill")
async def start_backfill(
    county: str = Query("Kern", description="County name"),
):
    global _backfill_task, _backfill_status

    if _backfill_task and not _backfill_task.done():
        return JSONResponse(status_code=409, content={"error": "Backfill in progress", "status": _backfill_status})

    _backfill_status = {
        "state": "running",
        "county": county,
        "wellsFetched": 0,
        "wellsInserted": 0,
        "errors": [],
    }

    _backfill_task = asyncio.create_task(_run_backfill(county))
    return {"message": f"CalGEM backfill started for {county}", "status": _backfill_status}


@router.get("/api/calgem/backfill/status")
async def backfill_status():
    return _backfill_status


async def _run_backfill(county: str) -> None:
    global _backfill_status

    pool = await get_pool()

    try:
        wells = await fetch_wells_for_county(county)
        _backfill_status["wellsFetched"] = len(wells)

        inserted = 0
        for w in wells:
            try:
                result = await pool.execute(
                    """
                    INSERT INTO wells (api_number, name, geom, well_type, status, depth_ft, county, operator, source)
                    VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, $9, 'calgem')
                    ON CONFLICT (api_number) DO UPDATE SET
                        status = EXCLUDED.status,
                        operator = EXCLUDED.operator,
                        depth_ft = EXCLUDED.depth_ft
                    """,
                    w.api_number,
                    w.name,
                    w.longitude,
                    w.latitude,
                    w.well_type,
                    w.well_status,
                    w.depth_ft,
                    w.county,
                    w.operator,
                )
                if "INSERT" in result or "UPDATE" in result:
                    inserted += 1
            except Exception as e:
                _backfill_status["errors"].append(f"{w.api_number}: {e}")
                if len(_backfill_status["errors"]) > 50:
                    _backfill_status["errors"] = _backfill_status["errors"][-50:]

        _backfill_status["wellsInserted"] = inserted
        _backfill_status["state"] = "completed"
        logger.info("CalGEM backfill: %d/%d wells for %s", inserted, len(wells), county)

    except Exception as e:
        traceback.print_exc()
        _backfill_status["state"] = "failed"
        _backfill_status["errors"].append(str(e))


def _row_to_dict(r) -> dict:
    return {
        "apiNumber": r["api_number"],
        "name": r["name"],
        "wellType": r["well_type"],
        "status": r["status"],
        "operator": r["operator"],
        "county": r["county"],
        "depthFt": r["depth_ft"],
        "lat": r["lat"],
        "lng": r["lng"],
    }
