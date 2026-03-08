import asyncio
import logging
import traceback
from typing import Any

from fastapi import APIRouter, Query, Path
from fastapi.responses import JSONResponse, Response

from app.cache import get_redis_binary, cache_headers
from app.clients.dem import (
    elevation_at_point,
    elevation_profile,
    render_terrain_tile,
    get_available_tiles,
    download_tile,
    download_all_tiles,
    add_tile,
    TILES,
    BAKERSFIELD_LAT,
    BAKERSFIELD_LNG,
)

router = APIRouter()
logger = logging.getLogger(__name__)

TILE_TTL = 604800  # 7 days — DEM doesn't change

# Backfill state
_download_task: asyncio.Task | None = None
_download_status: dict[str, Any] = {"state": "idle"}

# Classic "valley bowl" transects
TRANSECTS = {
    "sierra-to-coast": {
        "name": "Sierra Nevada → Coast Ranges (through Bakersfield)",
        "description": "Shows the SJV bowl: Sierra foothills → valley floor → Coast Ranges",
        "from": {"lat": 35.37, "lon": -118.50},
        "to": {"lat": 35.37, "lon": -120.10},
    },
    "north-south": {
        "name": "North-South Valley Floor",
        "description": "Bakersfield north toward Fresno along the valley floor",
        "from": {"lat": 35.00, "lon": -119.02},
        "to": {"lat": 36.50, "lon": -119.80},
    },
    "tehachapi-pass": {
        "name": "Valley Floor → Tehachapi Pass",
        "description": "Southern escape route for valley air — the Tehachapi gap",
        "from": {"lat": 35.37, "lon": -119.02},
        "to": {"lat": 35.13, "lon": -118.45},
    },
}


@router.get("/api/elevation/point")
async def point_elevation(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
):
    """Get elevation at a single point."""
    elev = elevation_at_point(lat, lon)

    if elev is None:
        return JSONResponse(
            status_code=404,
            content={
                "error": "No DEM data for this location",
                "lat": lat,
                "lon": lon,
                "hint": "Run POST /api/elevation/download to fetch DEM tiles",
            },
        )

    return {
        "lat": lat,
        "lon": lon,
        "elevation": elev,
        "unit": "meters",
        "elevationFt": round(elev * 3.28084, 1),
        "source": "USGS 3DEP 1/3 arc-second",
    }


@router.get("/api/elevation/profile")
async def profile(
    transect: str | None = Query(None, description="Named transect: sierra-to-coast, north-south, tehachapi-pass"),
    from_coords: str | None = Query(None, alias="from", description="Start: lat,lon"),
    to_coords: str | None = Query(None, alias="to", description="End: lat,lon"),
    points: int = Query(200, ge=10, le=1000, description="Number of sample points"),
):
    """Extract an elevation profile along a line.

    Either provide a named transect or from/to coordinates.
    """
    if transect:
        if transect not in TRANSECTS:
            return JSONResponse(
                status_code=400,
                content={"error": f"Unknown transect: {transect}", "available": list(TRANSECTS.keys())},
            )
        t = TRANSECTS[transect]
        lat1, lon1 = t["from"]["lat"], t["from"]["lon"]
        lat2, lon2 = t["to"]["lat"], t["to"]["lon"]
        name = t["name"]
        description = t["description"]
    elif from_coords and to_coords:
        try:
            lat1, lon1 = [float(x.strip()) for x in from_coords.split(",")]
            lat2, lon2 = [float(x.strip()) for x in to_coords.split(",")]
        except (ValueError, IndexError):
            return JSONResponse(status_code=400, content={"error": "Coordinates must be lat,lon"})
        name = f"Custom ({lat1},{lon1}) → ({lat2},{lon2})"
        description = None
    else:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Provide either 'transect' name or 'from' and 'to' coordinates",
                "availableTransects": {k: v["name"] for k, v in TRANSECTS.items()},
            },
        )

    profile_data = elevation_profile(lat1, lon1, lat2, lon2, points)

    # Compute stats
    elevations = [p["elevation"] for p in profile_data if p["elevation"] is not None]
    if not elevations:
        return JSONResponse(
            status_code=404,
            content={"error": "No DEM data along this transect. Run POST /api/elevation/download first."},
        )

    min_elev = min(elevations)
    max_elev = max(elevations)
    total_dist = profile_data[-1]["distanceKm"] if profile_data else 0

    # Find the valley floor (lowest point)
    valley_idx = elevations.index(min_elev)
    valley_point = [p for p in profile_data if p["elevation"] is not None][valley_idx]

    return {
        "name": name,
        "description": description,
        "from": {"lat": lat1, "lon": lon1},
        "to": {"lat": lat2, "lon": lon2},
        "pointCount": len(profile_data),
        "totalDistanceKm": round(total_dist, 1),
        "stats": {
            "minElevation": round(min_elev, 1),
            "maxElevation": round(max_elev, 1),
            "relief": round(max_elev - min_elev, 1),
            "minElevationFt": round(min_elev * 3.28084),
            "maxElevationFt": round(max_elev * 3.28084),
            "valleyFloor": {
                "elevation": round(min_elev, 1),
                "lat": valley_point["lat"],
                "lon": valley_point["lon"],
                "distanceKm": valley_point["distanceKm"],
            },
        },
        "unit": "meters",
        "source": "USGS 3DEP 1/3 arc-second",
        "profile": profile_data,
    }


@router.get("/api/elevation/transects")
async def list_transects():
    """List available named transects for the SJV bowl."""
    return {
        "transects": {
            k: {"name": v["name"], "description": v["description"], "from": v["from"], "to": v["to"]}
            for k, v in TRANSECTS.items()
        },
    }


@router.get("/api/elevation/terrain-tile/{z}/{x}/{y}.png")
async def terrain_tile(
    z: int = Path(..., ge=0, le=15),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
):
    """Render a terrain visualization tile from DEM data for Google Maps overlay."""

    # Check Redis cache
    cache_key = f"geointelli:tile:terrain-dem:{z}:{x}:{y}"
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

    tile_bytes = render_terrain_tile(z, x, y)

    if tile_bytes is None:
        # Return transparent 1x1 PNG for tiles outside DEM coverage
        return Response(
            content=_TRANSPARENT_PNG,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    # Cache in Redis
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


# ── DEM Download Management ─────────────────────────

@router.get("/api/elevation/tiles")
async def list_tiles():
    """List DEM tile download status."""
    return {"tiles": get_available_tiles()}


@router.post("/api/elevation/download")
async def start_download(
    tile_id: str | None = Query(None, description="Specific tile ID, or omit for all"),
):
    """Download DEM tile(s) from USGS 3DEP."""
    global _download_task, _download_status

    if _download_task and not _download_task.done():
        return JSONResponse(status_code=409, content={"error": "Download in progress", "status": _download_status})

    _download_status = {"state": "running", "tile": tile_id or "all", "downloaded": [], "errors": []}
    _download_task = asyncio.create_task(_run_download(tile_id))
    return {"message": f"DEM download started: {tile_id or 'all tiles'}", "status": _download_status}


@router.post("/api/elevation/tiles/add")
async def add_dem_tile(
    tile_id: str = Query(..., description="Tile ID e.g. n41w112 (north_lat + west_lon)"),
    name: str = Query("Custom tile", description="Human-readable name"),
    north: float = Query(...), south: float = Query(...),
    east: float = Query(...), west: float = Query(...),
):
    """Register a new USGS 3DEP tile for any CONUS location, then download it."""
    if tile_id in TILES:
        return {"message": f"Tile {tile_id} already registered", "tile": TILES[tile_id]}

    add_tile(tile_id, name, {"north": north, "south": south, "east": east, "west": west})
    return {"message": f"Tile {tile_id} registered. POST /api/elevation/download?tile_id={tile_id} to fetch it.", "tile": TILES[tile_id]}


@router.get("/api/elevation/download/status")
async def download_status():
    return _download_status


async def _run_download(tile_id: str | None) -> None:
    global _download_status

    try:
        if tile_id:
            await download_tile(tile_id)
            _download_status["downloaded"].append(tile_id)
        else:
            downloaded = await download_all_tiles()
            _download_status["downloaded"] = downloaded

        _download_status["state"] = "completed"
        logger.info("DEM download complete: %s", _download_status["downloaded"])

    except Exception as e:
        traceback.print_exc()
        _download_status["state"] = "failed"
        _download_status["errors"].append(str(e))


# Transparent 1x1 PNG for tiles outside coverage
_TRANSPARENT_PNG = (
    b'\x89PNG\r\n\x1a\n'
    b'\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89'
    b'\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4'
    b'\x00\x00\x00\x00IEND\xaeB`\x82'
)
