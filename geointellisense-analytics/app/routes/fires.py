import asyncio
import logging
import traceback
from datetime import datetime

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.nasa_firms import fetch_all_sources, get_smoke_context, FireDetection
from app.config import settings
from app.database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

FIRE_TTL = 1800  # 30 minutes

# Background polling
_poll_task: asyncio.Task | None = None
# Shared smoke context for Claude AI injection
_smoke_context: str = ""


def get_current_smoke_context() -> str:
    """Called by Claude AI routes to inject fire context."""
    return _smoke_context


async def start_fire_polling():
    global _poll_task
    if not settings.nasa_firms_key:
        logger.info("No NASA_FIRMS_KEY — fire polling disabled")
        return
    if _poll_task and not _poll_task.done():
        return
    _poll_task = asyncio.create_task(_poll_loop())
    logger.info("NASA FIRMS fire polling started (30 min interval)")


async def _poll_loop():
    global _smoke_context
    while True:
        try:
            from app.source_toggles import is_enabled
            if not await is_enabled("nasa_firms"):
                await asyncio.sleep(1800)
                continue

            fires = await fetch_all_sources(settings.nasa_firms_key, days=2)
            if fires:
                pool = await get_pool()
                inserted = await _persist_fires(pool, fires)
                logger.info("FIRMS poll: %d detections, %d new", len(fires), inserted)

                # Update smoke context for AI
                _smoke_context = get_smoke_context(fires)
                if _smoke_context:
                    logger.info("Smoke context updated: %s", _smoke_context.split("\n")[0])

                # Update cache
                result = _format_active(fires)
                await set_cached("fires-active", "all", result, FIRE_TTL)
            else:
                _smoke_context = ""
        except Exception as e:
            logger.error("FIRMS poll failed: %s", e)

        await asyncio.sleep(1800)  # 30 minutes


def _parse_bbox(bbox_str: str | None) -> tuple[float, float, float, float] | None:
    """Parse 'south,west,north,east' string into a tuple."""
    if not bbox_str:
        return None
    try:
        parts = [float(x) for x in bbox_str.split(",")]
        if len(parts) == 4:
            return (parts[0], parts[1], parts[2], parts[3])
    except ValueError:
        pass
    return None


@router.get("/api/fires/active")
async def fires_active(
    max_distance_km: float | None = Query(None, description="Max distance from reference point in km"),
    min_confidence: str | None = Query(None, description="Minimum confidence: low, nominal, high"),
    bbox: str | None = Query(None, description="Bounding box: south,west,north,east"),
):
    if not settings.nasa_firms_key:
        return JSONResponse(status_code=503, content={"error": "NASA FIRMS not configured", "details": "Set NASA_FIRMS_KEY in .env"})

    bbox_tuple = _parse_bbox(bbox)

    # Build cache key including bbox
    bbox_key = bbox or "default"
    cache_key = f"{bbox_key}-{max_distance_km or 'all'}-{min_confidence or 'all'}"
    cached, hit = await get_cached("fires-active", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, FIRE_TTL))

    # Check the poll loop's "all" cache (only useful when no custom bbox)
    if not bbox_tuple:
        all_cached, all_hit = await get_cached("fires-active", "all")
        if all_cached is not None and (max_distance_km or min_confidence):
            result = _refilter_cached(all_cached, max_distance_km, min_confidence)
            await set_cached("fires-active", cache_key, result, FIRE_TTL)
            return JSONResponse(content=result, headers=cache_headers(all_hit, FIRE_TTL))

    # Source must be enabled to make external API calls
    from app.source_toggles import is_enabled
    if not await is_enabled("nasa_firms"):
        return JSONResponse(status_code=503, content={"error": "NASA FIRMS source is disabled", "details": "Enable via POST /api/admin/sources/nasa_firms/enable"})

    try:
        fires = await fetch_all_sources(settings.nasa_firms_key, days=2, bbox_override=bbox_tuple)

        # Use viewport center as reference point for distance calc if bbox provided
        ref_lat, ref_lng = 35.3733, -119.0187  # Bakersfield default
        if bbox_tuple:
            ref_lat = (bbox_tuple[0] + bbox_tuple[2]) / 2
            ref_lng = (bbox_tuple[1] + bbox_tuple[3]) / 2

        result = _format_active(fires, max_distance_km, min_confidence, ref_lat=ref_lat, ref_lng=ref_lng)
        await set_cached("fires-active", cache_key, result, FIRE_TTL)

        # Persist
        if fires:
            pool = await get_pool()
            await _persist_fires(pool, fires)

        return JSONResponse(content=result, headers=cache_headers(False, FIRE_TTL))
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=502, content={"error": "FIRMS request failed", "details": str(e)})


@router.get("/api/fires/history")
async def fires_history(
    days: int = Query(30, ge=1, le=365),
):
    cache_key = f"history-{days}"
    cached, hit = await get_cached("fires-history", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, FIRE_TTL))

    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT time, latitude, longitude, brightness, frp, confidence, satellite, instrument, daynight,
               ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(-119.0187, 35.3733), 4326)::geography) / 1000 AS distance_km
        FROM fire_detections
        WHERE time >= now() - make_interval(days => $1)
        ORDER BY time DESC
        """,
        days,
    )

    fires = []
    for r in rows:
        fires.append({
            "time": r["time"].isoformat(),
            "lat": r["latitude"],
            "lng": r["longitude"],
            "brightness": r["brightness"],
            "frp": r["frp"],
            "confidence": r["confidence"],
            "satellite": r["satellite"],
            "instrument": r["instrument"],
            "daynight": r["daynight"],
            "distanceKm": round(r["distance_km"], 1),
        })

    result = {"count": len(fires), "days": days, "fires": fires}
    await set_cached("fires-history", cache_key, result, FIRE_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, FIRE_TTL))


@router.get("/api/fires/smoke-context")
async def smoke_context():
    """Returns the current smoke context string used for AI augmentation."""
    return {"context": _smoke_context, "hasActiveFires": bool(_smoke_context)}


def _refilter_cached(cached_result: dict, max_dist: float | None, min_conf: str | None) -> dict:
    """Re-filter an already-cached unfiltered fire result without hitting the API."""
    conf_order = {"low": 0, "l": 0, "nominal": 1, "n": 1, "high": 2, "h": 2}
    items = []
    for f in cached_result.get("fires", []):
        if max_dist and f.get("distanceKm", 999) > max_dist:
            continue
        if min_conf and conf_order.get(f.get("confidence", ""), 0) < conf_order.get(min_conf, 0):
            continue
        items.append(f)

    upwind_count = sum(1 for i in items if i.get("isUpwind"))
    return {
        "count": len(items),
        "upwindCount": upwind_count,
        "smokeRisk": "high" if upwind_count > 3 else "moderate" if upwind_count > 0 else "low",
        "fires": items,
    }


def _format_active(
    fires: list[FireDetection],
    max_dist: float | None = None,
    min_conf: str | None = None,
    ref_lat: float = 35.3733,
    ref_lng: float = -119.0187,
) -> dict:
    items = []
    for f in fires:
        d = f.to_dict(ref_lat=ref_lat, ref_lng=ref_lng)
        if max_dist and d["distanceKm"] > max_dist:
            continue
        if min_conf:
            conf_order = {"low": 0, "l": 0, "nominal": 1, "n": 1, "high": 2, "h": 2}
            if conf_order.get(f.confidence, 0) < conf_order.get(min_conf, 0):
                continue
        items.append(d)

    upwind_count = sum(1 for i in items if i.get("isUpwind"))
    return {
        "count": len(items),
        "upwindCount": upwind_count,
        "smokeRisk": "high" if upwind_count > 3 else "moderate" if upwind_count > 0 else "low",
        "fires": items,
    }


async def _persist_fires(pool, fires: list[FireDetection]) -> int:
    inserted = 0
    for f in fires:
        if f.acq_datetime is None:
            continue
        try:
            result = await pool.execute(
                """
                INSERT INTO fire_detections (time, latitude, longitude, geom, brightness, frp, confidence, satellite, instrument, daynight)
                VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, $10, $11)
                ON CONFLICT DO NOTHING
                """,
                f.acq_datetime, f.latitude, f.longitude, f.longitude, f.latitude,
                f.brightness, f.frp, f.confidence, f.satellite, f.instrument, f.daynight,
            )
            if "INSERT" in result:
                inserted += 1
        except Exception as e:
            logger.error("Fire persist error: %s", e)
    return inserted
