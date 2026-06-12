from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import settings, allowed_web_origins
from app.middleware import check_rate_limit

router = APIRouter()


def _origin_allowed(request: Request) -> bool:
    """In production (ADMIN_TOKEN set), only serve the key to known web origins.

    Browsers send Origin on cross-origin fetches and Referer on same-origin
    ones; curl and scrapers typically send neither. This is defense in depth —
    the Google Maps key itself must still be referrer-restricted in the
    Google Cloud Console.
    """
    if not settings.admin_token:
        return True
    candidates = [request.headers.get("origin", ""), request.headers.get("referer", "")]
    allowed = allowed_web_origins()
    return any(
        c and any(c == a or c.startswith(a + "/") for a in allowed)
        for c in candidates
    )


@router.get("/api/maps-config")
async def maps_config(request: Request):
    rate_err = await check_rate_limit(request, "data_default")
    if rate_err:
        return rate_err

    if not _origin_allowed(request):
        return JSONResponse(status_code=403, content={"error": "Origin not allowed"})

    api_key = settings.google_maps_api_key
    if not api_key:
        return JSONResponse(
            status_code=500,
            content={"error": "GOOGLE_MAPS_API_KEY not configured"},
        )
    return {
        "apiKey": api_key,
        "tileLayers": {
            "sentinel-true-color": "/api/sentinel/tile/true-color/{z}/{x}/{y}.png",
            "sentinel-2023": "/api/sentinel/tile/true-color-2023/{z}/{x}/{y}.png",
            "terrain": "/api/sentinel/tile/terrain/{z}/{x}/{y}.png",
            "overlay": "/api/sentinel/tile/overlay/{z}/{x}/{y}.png",
            "cropland-2023": "/api/cropscape/tile/2023/{z}/{x}/{y}.png",
            "terrain-dem": "/api/elevation/terrain-tile/{z}/{x}/{y}.png",
            "ndvi-change": "/api/landsat/tile/ndvi-change/{product}/{z}/{x}/{y}.png",
        },
        "dataOverlays": {
            "activeFires": "/api/fires/active",
            "wells": "/api/calgem/wells",
            "enviroscreen": "/api/enviroscreen/tracts",
            "waterStations": "/api/water/current",
            "demographics": "/api/demographics/summary",
            "waterQuality": "/api/water-quality/wells",
        },
    }
