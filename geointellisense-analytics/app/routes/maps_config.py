import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/api/maps-config")
async def maps_config():
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    if not api_key:
        return JSONResponse(
            status_code=500,
            content={"error": "GOOGLE_MAPS_API_KEY not configured"},
        )
    return {"apiKey": api_key}
