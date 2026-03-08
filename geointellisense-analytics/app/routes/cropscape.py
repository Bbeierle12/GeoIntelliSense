import logging
import traceback
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response

from app.cache import get_cached, set_cached, cache_headers, get_redis_binary
from app.clients.cropscape import fetch_crop_stats, CropStat, KERN_FIPS, SJV_FIPS, CDL_WMS_URL
from app.database import get_pool

import httpx

router = APIRouter()
logger = logging.getLogger(__name__)

CROP_TTL = 2592000  # 30 days — annual dataset
TILE_TTL = 604800   # 7 days for WMS tiles


@router.get("/api/cropscape/summary")
async def crop_summary(
    county: str = Query(KERN_FIPS, description="County FIPS code (e.g. 06029)"),
    year: int = Query(2023, description="CDL year"),
    min_acreage: float = Query(100, description="Min acreage to include"),
):
    cache_key = {"county": county, "year": year, "min": min_acreage}
    cached, hit = await get_cached("cropscape-summary", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, CROP_TTL))

    # Check DB first
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT crop_code, crop_name, acreage, pixel_count, color FROM crop_coverage WHERE county_fips = $1 AND year = $2 AND acreage >= $3 ORDER BY acreage DESC",
        county, year, min_acreage,
    )

    if rows:
        result = _format_db_summary(rows, county, year)
        await set_cached("cropscape-summary", cache_key, result, CROP_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, CROP_TTL))

    # Fetch from CropScape
    try:
        crops = await fetch_crop_stats(county, year)
        if crops:
            await _persist_crops(pool, crops, county, year)

        filtered = [c for c in crops if c.acreage >= min_acreage]
        filtered.sort(key=lambda c: -c.acreage)

        result = _format_summary(filtered, county, year)
        await set_cached("cropscape-summary", cache_key, result, CROP_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, CROP_TTL))
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=502, content={"error": "CropScape request failed", "details": str(e)})


@router.get("/api/cropscape/coverage")
async def crop_coverage_bbox(
    bbox: str = Query(..., description="south_lat,west_lng,north_lat,east_lng"),
    year: int = Query(2023),
):
    """Returns a WMS tile URL for crop coverage within the bounding box."""
    parts = [float(x.strip()) for x in bbox.split(",")]
    if len(parts) != 4:
        return JSONResponse(status_code=400, content={"error": "bbox must be south_lat,west_lng,north_lat,east_lng"})

    south, west, north, east = parts

    return {
        "bbox": {"south": south, "west": west, "north": north, "east": east},
        "year": year,
        "wmsUrl": f"{CDL_WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=cdl_{year}&SRS=EPSG:4326&BBOX={west},{south},{east},{north}&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE",
        "tileUrlTemplate": f"/api/cropscape/tile/{year}/{{z}}/{{x}}/{{y}}.png",
    }


@router.get("/api/cropscape/tile/{year}/{z}/{x}/{y}.png")
async def crop_tile(year: int, z: int, x: int, y: int):
    """Proxy CropScape WMS as XYZ tiles for Google Maps overlay."""
    import math

    # Convert XYZ tile coords to lat/lng bbox
    n = 2 ** z
    west = x / n * 360 - 180
    east = (x + 1) / n * 360 - 180
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))

    cache_key = f"geointelli:tile:crop:{year}:{z}:{x}:{y}"
    try:
        redis = await get_redis_binary()
        cached = await redis.get(cache_key)
        if cached:
            return Response(content=cached, media_type="image/png", headers={"Cache-Control": f"public, max-age={TILE_TTL}", "X-Cache": "HIT"})
    except Exception:
        pass

    wms_url = (
        f"{CDL_WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
        f"&LAYERS=cdl_{year}&SRS=EPSG:4326"
        f"&BBOX={west},{south},{east},{north}"
        f"&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE"
    )

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(wms_url)
        if resp.status_code != 200 or "xml" in resp.headers.get("content-type", ""):
            return Response(status_code=resp.status_code, content=b"", media_type="text/plain")

        tile_bytes = resp.content

    try:
        redis = await get_redis_binary()
        await redis.setex(cache_key, TILE_TTL, tile_bytes)
    except Exception:
        pass

    return Response(content=tile_bytes, media_type="image/png", headers={"Cache-Control": f"public, max-age={TILE_TTL}", "X-Cache": "MISS"})


# ── Helpers ──────────────────────────────────────────

def _format_summary(crops: list[CropStat], county: str, year: int) -> dict:
    total = sum(c.acreage for c in crops)
    return {
        "county": county,
        "countyName": SJV_FIPS.get(county, county),
        "year": year,
        "totalAcreage": round(total),
        "cropCount": len(crops),
        "crops": [c.to_dict() for c in crops],
    }


def _format_db_summary(rows, county: str, year: int) -> dict:
    from app.clients.cropscape import AQ_IMPACT_CROPS
    total = sum(r["acreage"] for r in rows)
    crops = []
    for r in rows:
        crops.append({
            "crop_code": r["crop_code"],
            "crop_name": r["crop_name"],
            "acreage": r["acreage"],
            "pixel_count": r["pixel_count"],
            "color": r["color"],
            "aqImpact": AQ_IMPACT_CROPS.get(r["crop_name"]),
        })
    return {
        "county": county,
        "countyName": SJV_FIPS.get(county, county),
        "year": year,
        "totalAcreage": round(total),
        "cropCount": len(crops),
        "crops": crops,
    }


async def _persist_crops(pool, crops: list[CropStat], county: str, year: int) -> int:
    inserted = 0
    for c in crops:
        try:
            result = await pool.execute(
                """
                INSERT INTO crop_coverage (year, county_fips, crop_code, crop_name, acreage, pixel_count, color)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (year, county_fips, crop_code) DO UPDATE SET
                    acreage = EXCLUDED.acreage, crop_name = EXCLUDED.crop_name
                """,
                year, county, c.crop_code, c.crop_name, c.acreage, c.pixel_count, c.color,
            )
            if "INSERT" in result:
                inserted += 1
        except Exception as e:
            logger.error("Crop persist error: %s", e)
    return inserted
