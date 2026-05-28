import httpx
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.database import get_pool

router = APIRouter()

NWS_BASE = "https://api.weather.gov"
NWS_HEADERS = {"User-Agent": "(GeoIntelliSense, contact@geointellisense.dev)", "Accept": "application/geo+json"}
NWS_TTL = 3600  # 1 hour


@router.get("/api/forecast")
async def forecast(
    location_ids: str | None = Query(None, description="Comma-separated location UUIDs"),
    lat: float | None = Query(None, description="Latitude for a single ad-hoc point forecast"),
    lon: float | None = Query(None, description="Longitude for a single ad-hoc point forecast"),
):
    # Ad-hoc single-point mode when lat/lon are provided
    if lat is not None and lon is not None:
        return await _adhoc_point_forecast(lat, lon)

    cache_key_params = location_ids or "all"

    cached, hit = await get_cached("forecast", cache_key_params)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, NWS_TTL))

    # If requesting specific locations, try filtering from the "all" cache first
    if location_ids:
        all_cached, all_hit = await get_cached("forecast", "all")
        if all_cached is not None:
            ids_set = {uid.strip() for uid in location_ids.split(",")}
            filtered = [r for r in all_cached if r.get("locationId") in ids_set]
            if filtered:
                await set_cached("forecast", cache_key_params, filtered, NWS_TTL)
                return JSONResponse(content=filtered, headers=cache_headers(all_hit, NWS_TTL))

    from app.source_toggles import is_enabled
    if not await is_enabled("nws_forecast"):
        return JSONResponse(status_code=503, content={"error": "NWS forecast source is disabled", "details": "Enable via POST /api/admin/sources/nws_forecast/enable"})

    pool = await get_pool()

    if location_ids:
        ids = [uid.strip() for uid in location_ids.split(",")]
        rows = await pool.fetch(
            "SELECT id, name, ST_Y(geom) AS lat, ST_X(geom) AS lng FROM locations WHERE id = ANY($1::uuid[])",
            ids,
        )
    else:
        rows = await pool.fetch("SELECT id, name, ST_Y(geom) AS lat, ST_X(geom) AS lng FROM locations ORDER BY name")

    records = []

    async with httpx.AsyncClient(headers=NWS_HEADERS, timeout=15.0) as client:
        for loc in rows:
            loc_id = str(loc["id"])
            loc_name = loc["name"]
            lat, lng = round(loc["lat"], 4), round(loc["lng"], 4)

            try:
                periods = await _fetch_nws_forecast(client, lat, lng)
                for p in periods:
                    records.append({
                        "id": f"forecast_{loc_id}_{p['number']}",
                        "locationId": loc_id,
                        "locationName": loc_name,
                        "date": p["startTime"],
                        "tempHigh": p["temperature"] if p["isDaytime"] else None,
                        "tempLow": p["temperature"] if not p["isDaytime"] else None,
                        "humidity": p.get("relativeHumidity", {}).get("value") if p.get("relativeHumidity") else None,
                        "precipProbability": (
                            p.get("probabilityOfPrecipitation", {}).get("value", 0)
                            if p.get("probabilityOfPrecipitation") else 0
                        ),
                        "windSpeed": p.get("windSpeed", ""),
                        "uvIndex": 0,
                        "conditions": p.get("shortForecast", ""),
                        "icon": p.get("icon", ""),
                    })
            except Exception:
                import traceback
                traceback.print_exc()
                continue

    await set_cached("forecast", cache_key_params, records, NWS_TTL)
    return JSONResponse(content=records, headers=cache_headers(False, NWS_TTL))


async def _adhoc_point_forecast(lat: float, lon: float):
    """Fetch a forecast for an arbitrary lat/lon point (not in the DB)."""
    cache_key = f"adhoc_{round(lat, 4)}_{round(lon, 4)}"
    cached, hit = await get_cached("forecast", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, NWS_TTL))

    from app.source_toggles import is_enabled
    if not await is_enabled("nws_forecast"):
        return JSONResponse(status_code=503, content={"error": "NWS forecast source is disabled", "details": "Enable via POST /api/admin/sources/nws_forecast/enable"})

    try:
        async with httpx.AsyncClient(headers=NWS_HEADERS, timeout=15.0) as client:
            periods = await _fetch_nws_forecast(client, round(lat, 4), round(lon, 4))
            records = []
            for p in periods:
                records.append({
                    "id": f"forecast_adhoc_{round(lat, 4)}_{round(lon, 4)}_{p['number']}",
                    "locationId": None,
                    "locationName": f"({round(lat, 4)}, {round(lon, 4)})",
                    "date": p["startTime"],
                    "tempHigh": p["temperature"] if p["isDaytime"] else None,
                    "tempLow": p["temperature"] if not p["isDaytime"] else None,
                    "humidity": p.get("relativeHumidity", {}).get("value") if p.get("relativeHumidity") else None,
                    "precipProbability": (
                        p.get("probabilityOfPrecipitation", {}).get("value", 0)
                        if p.get("probabilityOfPrecipitation") else 0
                    ),
                    "windSpeed": p.get("windSpeed", ""),
                    "uvIndex": 0,
                    "conditions": p.get("shortForecast", ""),
                    "icon": p.get("icon", ""),
                })
        await set_cached("forecast", cache_key, records, NWS_TTL)
        return JSONResponse(content=records, headers=cache_headers(False, NWS_TTL))
    except Exception:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=502, content={"error": "NWS forecast request failed"})


async def _fetch_nws_forecast(client: httpx.AsyncClient, lat: float, lng: float) -> list[dict]:
    points_resp = await client.get(f"{NWS_BASE}/points/{lat},{lng}")
    points_resp.raise_for_status()
    forecast_url = points_resp.json()["properties"]["forecast"]

    forecast_resp = await client.get(forecast_url)
    forecast_resp.raise_for_status()
    return forecast_resp.json()["properties"]["periods"]
