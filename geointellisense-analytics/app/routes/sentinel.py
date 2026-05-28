"""
Sentinel-2 tile proxy and metadata.

Proxies tiles from EOX Sentinel-2 cloudless WMTS (public, no key needed).
Caches tiles in Redis to reduce upstream load and avoid CORS issues.

Layers:
  - true-color: Sentinel-2 cloudless mosaic (2024)
  - terrain: Terrain visualization
  - overlay: Map overlay with labels
"""

import logging
from datetime import date, timedelta

import httpx
from fastapi import APIRouter, Path
from fastapi.responses import Response, JSONResponse

from app.cache import get_redis_binary

router = APIRouter()
logger = logging.getLogger(__name__)

TILE_TTL = 86400  # 24 hours

# EOX WMTS tile URL templates (WebMercator / GoogleMapsCompatible)
LAYER_URLS = {
    "true-color": "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg",
    "true-color-2023": "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg",
    "terrain": "https://tiles.maps.eox.at/wmts/1.0.0/terrain-light_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg",
    "overlay": "https://tiles.maps.eox.at/wmts/1.0.0/overlay_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.png",
}

# Bakersfield coordinates for metadata
BAKERSFIELD_LAT = 35.3733
BAKERSFIELD_LNG = -119.0187


@router.get("/api/sentinel/tile/{layer}/{z}/{x}/{y}.png")
async def tile_proxy(
    layer: str = Path(..., description="Layer: true-color, terrain, overlay"),
    z: int = Path(..., ge=0, le=18),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
):
    if layer not in LAYER_URLS:
        return JSONResponse(
            status_code=400,
            content={"error": f"Unknown layer: {layer}", "available": list(LAYER_URLS.keys())},
        )

    # Check Redis cache
    cache_key = f"geointelli:tile:{layer}:{z}:{x}:{y}"
    try:
        redis = await get_redis_binary()
        cached = await redis.get(cache_key)
        if cached:
            logger.debug("tile cache HIT %s/%d/%d/%d", layer, z, x, y)
            content_type = "image/png" if layer == "overlay" else "image/jpeg"
            return Response(
                content=cached,
                media_type=content_type,
                headers={"Cache-Control": f"public, max-age={TILE_TTL}", "X-Cache": "HIT"},
            )
    except Exception:
        pass  # Redis down — fetch directly

    # Fetch from upstream
    url = LAYER_URLS[layer].format(z=z, x=x, y=y)

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url)
            if resp.status_code != 200:
                return Response(status_code=resp.status_code, content=b"", media_type="text/plain")

            tile_bytes = resp.content
            content_type = resp.headers.get("content-type", "image/jpeg")

            # Cache in Redis (store as bytes)
            try:
                redis = await get_redis_binary()
                await redis.setex(cache_key, TILE_TTL, tile_bytes)
                logger.debug("tile cache SET %s/%d/%d/%d", layer, z, x, y)
            except Exception:
                pass

            return Response(
                content=tile_bytes,
                media_type=content_type,
                headers={"Cache-Control": f"public, max-age={TILE_TTL}", "X-Cache": "MISS"},
            )
        except Exception as e:
            logger.error("Tile fetch failed: %s", e)
            return Response(status_code=502, content=b"Upstream tile fetch failed", media_type="text/plain")


@router.get("/api/sentinel/layers")
async def available_layers():
    """List available tile layers with URL templates."""
    return {
        "layers": [
            {
                "id": "true-color",
                "name": "Sentinel-2 True Color (2024)",
                "description": "Cloud-free Sentinel-2 mosaic",
                "tileUrl": "/api/sentinel/tile/true-color/{z}/{x}/{y}.png",
                "source": "EOX Sentinel-2 Cloudless",
                "year": 2024,
            },
            {
                "id": "true-color-2023",
                "name": "Sentinel-2 True Color (2023)",
                "description": "Previous year mosaic for comparison",
                "tileUrl": "/api/sentinel/tile/true-color-2023/{z}/{x}/{y}.png",
                "source": "EOX Sentinel-2 Cloudless",
                "year": 2023,
            },
            {
                "id": "terrain",
                "name": "Terrain",
                "description": "Terrain visualization with hillshading",
                "tileUrl": "/api/sentinel/tile/terrain/{z}/{x}/{y}.png",
                "source": "EOX",
            },
            {
                "id": "overlay",
                "name": "Labels Overlay",
                "description": "Transparent overlay with place names and roads",
                "tileUrl": "/api/sentinel/tile/overlay/{z}/{x}/{y}.png",
                "source": "EOX",
            },
        ],
        "note": "NDVI and false-color layers require Copernicus Data Space auth — planned for next phase.",
    }


@router.get("/api/sentinel/latest-pass")
async def latest_pass():
    """
    Returns metadata about the most recent Sentinel-2 pass over Bakersfield.
    Sentinel-2 has a 5-day revisit cycle. The EOX cloudless mosaic is annual.
    For actual pass dates, we'd query the Copernicus catalog — for now we
    estimate based on the 5-day cycle.
    """
    today = date.today()
    # Sentinel-2A/2B combined revisit is ~5 days at this latitude
    days_since = today.toordinal() % 5
    estimated_last = today - timedelta(days=days_since)
    estimated_next = estimated_last + timedelta(days=5)

    return {
        "satellite": "Sentinel-2A/2B",
        "revisitDays": 5,
        "estimatedLastPass": estimated_last.isoformat(),
        "estimatedNextPass": estimated_next.isoformat(),
        "mosaicYear": 2024,
        "mosaicSource": "EOX Sentinel-2 Cloudless",
        "location": {
            "name": "Bakersfield, CA",
            "lat": BAKERSFIELD_LAT,
            "lng": BAKERSFIELD_LNG,
        },
        "note": "Pass dates are estimated from the 5-day revisit cycle. For exact acquisition dates, use the Copernicus Data Space catalog.",
    }
