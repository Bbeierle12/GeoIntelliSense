import asyncio
import logging
import traceback
from typing import Any

from fastapi import APIRouter, Query, Path
from fastapi.responses import JSONResponse, Response

from app.cache import get_cached, set_cached, cache_headers, get_redis_binary
from app.clients.landsat import (
    search_scenes,
    get_target_scenes,
    compute_ndvi_change,
    render_ndvi_change_tile,
    get_computed_products,
    BAKERSFIELD_BBOX,
)

router = APIRouter()
logger = logging.getLogger(__name__)

SCENES_TTL = 86400      # 24 hours — scene catalog doesn't change fast
TILE_TTL = 604800        # 7 days — computed products are static

# Background task state
_ndvi_task: asyncio.Task | None = None
_ndvi_status: dict[str, Any] = {"state": "idle"}


@router.get("/api/landsat/scenes")
async def list_scenes(
    bbox: str | None = Query(None, description="west,south,east,north (default: Bakersfield area)"),
    max_cloud: int = Query(15, ge=0, le=100, description="Max cloud cover %"),
    date_range: str | None = Query(None, description="STAC datetime e.g. 2024-01-01/2024-12-31"),
    limit: int = Query(10, ge=1, le=50),
):
    """Search available Landsat scenes. Provide bbox for any location worldwide."""
    search_bbox = BAKERSFIELD_BBOX
    if bbox:
        search_bbox = [float(x.strip()) for x in bbox.split(",")]

    cache_key = {"bbox": str(search_bbox), "cloud": max_cloud, "dates": date_range, "limit": limit}
    cached, hit = await get_cached("landsat-scenes", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, SCENES_TTL))

    try:
        scenes = await search_scenes(
            bbox=search_bbox,
            max_cloud=max_cloud,
            date_range=date_range,
            limit=limit,
        )

        result = {
            "count": len(scenes),
            "bbox": search_bbox,
            "maxCloudCover": max_cloud,
            "scenes": scenes,
        }

        await set_cached("landsat-scenes", cache_key, result, SCENES_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, SCENES_TTL))

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=502,
            content={"error": "STAC search failed", "details": str(e)},
        )


@router.get("/api/landsat/scenes/comparison")
async def comparison_scenes(
    max_cloud: int = Query(15, ge=0, le=100),
):
    """Get scenes grouped by era for change detection:
    current (last 2 years), 5 years ago, 10 years ago.
    """
    cache_key = f"comparison-{max_cloud}"
    cached, hit = await get_cached("landsat-comparison", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, SCENES_TTL))

    try:
        eras = await get_target_scenes(max_cloud=max_cloud)

        result = {
            "bbox": BAKERSFIELD_BBOX,
            "maxCloudCover": max_cloud,
            "eras": {
                era: {
                    "count": len(scenes),
                    "scenes": scenes,
                }
                for era, scenes in eras.items()
            },
        }

        await set_cached("landsat-comparison", cache_key, result, SCENES_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, SCENES_TTL))

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=502,
            content={"error": "STAC search failed", "details": str(e)},
        )


@router.post("/api/landsat/ndvi-change")
async def start_ndvi_change(
    compare_year: int = Query(2016, description="Historical year to compare against"),
    max_cloud: int = Query(15, ge=0, le=100),
):
    """Compute NDVI change map between current and a historical year.

    This is compute-heavy — runs as an async background task.
    Poll /api/landsat/ndvi-change/status for progress.
    """
    global _ndvi_task, _ndvi_status

    if _ndvi_task and not _ndvi_task.done():
        return JSONResponse(
            status_code=409,
            content={"error": "NDVI computation already in progress", "status": _ndvi_status},
        )

    _ndvi_status = {
        "state": "running",
        "compareYear": compare_year,
        "steps": [],
        "result": None,
        "errors": [],
    }
    _ndvi_task = asyncio.create_task(_run_ndvi_change(compare_year, max_cloud))

    return {"message": f"NDVI change computation started (current vs {compare_year})", "status": _ndvi_status}


@router.get("/api/landsat/ndvi-change/status")
async def ndvi_change_status():
    """Poll the background NDVI change computation status."""
    return _ndvi_status


@router.get("/api/landsat/products")
async def list_products():
    """List computed NDVI change maps available for tile serving."""
    products = get_computed_products()
    return {
        "count": len(products),
        "products": products,
    }


@router.get("/api/landsat/tile/ndvi-change/{product}/{z}/{x}/{y}.png")
async def ndvi_change_tile(
    product: str = Path(..., description="Product stem name (without .tif)"),
    z: int = Path(..., ge=0, le=15),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
):
    """Serve NDVI change map as XYZ tiles for Google Maps overlay."""

    filename = f"{product}.tif"

    # Check Redis cache
    cache_key = f"geointelli:tile:ndvi-change:{product}:{z}:{x}:{y}"
    try:
        redis = await get_redis_binary()
        cached = await redis.get(cache_key)
        if cached:
            return Response(
                content=cached,
                media_type="image/png",
                headers={"Cache-Control": f"public, max-age={TILE_TTL}", "X-Cache": "HIT"},
            )
    except Exception:
        pass

    tile_bytes = render_ndvi_change_tile(filename, z, x, y)

    if tile_bytes is None:
        return Response(
            content=_TRANSPARENT_PNG,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    # Cache
    try:
        redis = await get_redis_binary()
        await redis.setex(cache_key, TILE_TTL, tile_bytes)
    except Exception:
        pass

    return Response(
        content=tile_bytes,
        media_type="image/png",
        headers={"Cache-Control": f"public, max-age={TILE_TTL}", "X-Cache": "MISS"},
    )


# ── Background Task ─────────────────────────────────

async def _run_ndvi_change(compare_year: int, max_cloud: int) -> None:
    global _ndvi_status

    try:
        # Step 1: Search for current scenes
        _ndvi_status["steps"].append("Searching for current scenes...")
        current_year_range = f"{compare_year + 8}-01-01/{compare_year + 10}-12-31"
        # Use a broad recent window
        from datetime import date
        this_year = date.today().year
        current_scenes = await search_scenes(
            date_range=f"{this_year - 1}-01-01/{this_year}-12-31",
            max_cloud=max_cloud,
            limit=3,
        )

        if not current_scenes:
            _ndvi_status["state"] = "failed"
            _ndvi_status["errors"].append(f"No current scenes found with <{max_cloud}% cloud cover")
            return

        _ndvi_status["steps"].append(f"Found {len(current_scenes)} current scene(s)")

        # Step 2: Search for historical scenes
        _ndvi_status["steps"].append(f"Searching for {compare_year} scenes...")
        hist_scenes = await search_scenes(
            date_range=f"{compare_year}-01-01/{compare_year}-12-31",
            max_cloud=max_cloud,
            limit=3,
        )

        if not hist_scenes:
            # Try broadening to ±1 year
            hist_scenes = await search_scenes(
                date_range=f"{compare_year - 1}-01-01/{compare_year + 1}-12-31",
                max_cloud=max_cloud + 10,
                limit=3,
            )

        if not hist_scenes:
            _ndvi_status["state"] = "failed"
            _ndvi_status["errors"].append(f"No historical scenes found for {compare_year}")
            return

        _ndvi_status["steps"].append(f"Found {len(hist_scenes)} historical scene(s)")

        # Step 3: Compute NDVI change
        current_scene = current_scenes[0]
        hist_scene = hist_scenes[0]

        _ndvi_status["steps"].append(
            f"Computing NDVI: {current_scene['id'][:25]} vs {hist_scene['id'][:25]}..."
        )

        result = await compute_ndvi_change(current_scene, hist_scene)

        if result is None:
            _ndvi_status["state"] = "failed"
            _ndvi_status["errors"].append("NDVI computation returned no data")
            return

        _ndvi_status["steps"].append("NDVI change map computed and saved")
        _ndvi_status["result"] = result
        _ndvi_status["state"] = "completed"

        logger.info(
            "NDVI change complete: %s → mean=%.4f, loss=%.1f%%, gain=%.1f%%",
            result["filename"],
            result["stats"]["mean"],
            result["stats"]["vegetationLossPct"],
            result["stats"]["vegetationGainPct"],
        )

    except Exception as e:
        traceback.print_exc()
        _ndvi_status["state"] = "failed"
        _ndvi_status["errors"].append(str(e))


# Transparent 1x1 PNG
_TRANSPARENT_PNG = (
    b'\x89PNG\r\n\x1a\n'
    b'\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89'
    b'\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4'
    b'\x00\x00\x00\x00IEND\xaeB`\x82'
)
