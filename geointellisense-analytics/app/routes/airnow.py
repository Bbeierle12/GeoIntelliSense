import traceback

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.airnow import AirNowClient
from app.config import settings

router = APIRouter()

AIRNOW_TTL = 3600  # 1 hour — AirNow updates hourly


@router.get("/api/airnow/current")
async def airnow_current(
    city: str | None = Query(None, description="Filter to a single SJV city name"),
):
    if not settings.airnow_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "AirNow not configured", "details": "Set AIRNOW_API_KEY in .env"},
        )

    cache_key = city or "all"
    cached, hit = await get_cached("airnow-current", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, AIRNOW_TTL))

    from app.source_toggles import is_enabled
    if not await is_enabled("airnow"):
        return JSONResponse(status_code=503, content={"error": "AirNow source is disabled", "details": "Enable via POST /api/admin/sources/airnow/enable"})

    client = AirNowClient(settings.airnow_api_key)
    try:
        readings = await client.get_all_sjv_current()

        if city:
            readings = [r for r in readings if r["stationName"].lower().startswith(city.lower())]

        result = {
            "count": len(readings),
            "source": "airnow",
            "dataSource": "EPA Monitor (AirNow)",
            "readings": readings,
        }

        await set_cached("airnow-current", cache_key, result, AIRNOW_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, AIRNOW_TTL))
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=502,
            content={"error": "AirNow request failed", "details": str(e)},
        )
    finally:
        await client.close()


@router.get("/api/airnow/forecast")
async def airnow_forecast(
    city: str | None = Query(None, description="Filter to a single SJV city name"),
):
    if not settings.airnow_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "AirNow not configured", "details": "Set AIRNOW_API_KEY in .env"},
        )

    cache_key = f"forecast-{city or 'all'}"
    cached, hit = await get_cached("airnow-forecast", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, AIRNOW_TTL))

    from app.source_toggles import is_enabled
    if not await is_enabled("airnow"):
        return JSONResponse(status_code=503, content={"error": "AirNow source is disabled", "details": "Enable via POST /api/admin/sources/airnow/enable"})

    client = AirNowClient(settings.airnow_api_key)
    try:
        forecasts = await client.get_all_sjv_forecast()

        if city:
            forecasts = [f for f in forecasts if f["stationName"].lower().startswith(city.lower())]

        result = {
            "count": len(forecasts),
            "source": "airnow",
            "dataSource": "EPA Monitor (AirNow)",
            "forecasts": forecasts,
        }

        await set_cached("airnow-forecast", cache_key, result, AIRNOW_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, AIRNOW_TTL))
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=502,
            content={"error": "AirNow forecast request failed", "details": str(e)},
        )
    finally:
        await client.close()
