from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.middleware import check_admin_auth, check_rate_limit

router = APIRouter()


@router.get("/api/maps-config")
async def maps_config(request: Request):
    auth_err = check_admin_auth(request)
    if auth_err:
        return auth_err

    rate_err = await check_rate_limit(request, "data_default")
    if rate_err:
        return rate_err

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
