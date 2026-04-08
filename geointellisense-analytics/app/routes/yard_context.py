"""
Composite yard context endpoint.

Concurrently fetches elevation, weather, AQI, and soil data for a location,
returning a single unified response. Cached in Redis with 30-minute TTL.
"""

import asyncio
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

YARD_CONTEXT_TTL = 1800  # 30 minutes


async def _fetch_elevation(client: httpx.AsyncClient, lat: float, lng: float) -> dict:
    """Fetch elevation at a point from the local elevation endpoint."""
    try:
        resp = await client.get(
            f"http://localhost:{settings.port}/api/elevation/point",
            params={"lat": lat, "lon": lng},
        )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "meters": data.get("elevation"),
                "feet": data.get("elevationFt"),
                "source": data.get("source", "USGS 3DEP"),
            }
    except Exception as e:
        logger.warning("Yard context: elevation fetch failed: %s", e)
    return {"meters": None, "feet": None, "source": None, "error": "unavailable"}


async def _fetch_weather(client: httpx.AsyncClient, lat: float, lng: float) -> dict:
    """Fetch NWS forecast from the local forecast endpoint."""
    try:
        resp = await client.get(
            f"http://localhost:{settings.port}/api/forecast",
            params={"lat": lat, "lon": lng},
        )
        if resp.status_code == 200:
            periods = resp.json()
            if periods and isinstance(periods, list) and len(periods) > 0:
                first = periods[0]
                temp = first.get("tempHigh") or first.get("tempLow")
                temp_str = f"{temp}\u00b0F" if temp is not None else "N/A"
                # Build a short multi-period summary
                forecast_parts = []
                for p in periods[:4]:
                    t = p.get("tempHigh") or p.get("tempLow")
                    cond = p.get("conditions", "")
                    if t is not None:
                        forecast_parts.append(f"{cond} {t}\u00b0F")
                return {
                    "temperature": temp_str,
                    "conditions": first.get("conditions", ""),
                    "windSpeed": first.get("windSpeed", ""),
                    "precipProbability": first.get("precipProbability", 0),
                    "forecast": " | ".join(forecast_parts) if forecast_parts else "",
                }
    except Exception as e:
        logger.warning("Yard context: weather fetch failed: %s", e)
    return {"temperature": None, "conditions": None, "forecast": None, "error": "unavailable"}


async def _fetch_aqi(client: httpx.AsyncClient) -> dict:
    """Fetch current AQI from the AirNow or AQI snapshot endpoint."""
    try:
        resp = await client.get(f"http://localhost:{settings.port}/api/airnow/current")
        if resp.status_code == 200:
            data = resp.json()
            readings = data.get("readings", [])
            if readings:
                # Use the first (nearest) reading
                r = readings[0]
                aqi_val = r.get("aqi")
                # Derive category from AQI value
                category = _aqi_category(aqi_val) if aqi_val is not None else "Unknown"
                return {"aqi": aqi_val, "category": category, "pm25": r.get("pm25")}
    except Exception as e:
        logger.warning("Yard context: AQI fetch failed: %s", e)
    return {"aqi": None, "category": None, "error": "unavailable"}


async def _fetch_soil(client: httpx.AsyncClient, lat: float, lng: float) -> dict:
    """Fetch soil data from the existing /api/soil/report endpoint (USDA SDA via PostGIS)."""
    try:
        resp = await client.get(
            f"http://localhost:{settings.port}/api/soil/report",
            params={"lat": lat, "lng": lng},
        )
        if resp.status_code == 200:
            data = resp.json()
            # Extract dominant component summary for the composite response
            mgmt = data.get("yardManagement", {})
            texture = mgmt.get("soilTexture", {}) if mgmt else {}
            dominant = data.get("components", [{}])[0] if data.get("components") else {}
            top_hz = dominant.get("horizons", [{}])[0] if dominant.get("horizons") else {}

            return {
                "type": texture.get("textureClass") or dominant.get("compname", "Unknown"),
                "mapUnit": data.get("mapUnit", {}).get("muname"),
                "drainage": dominant.get("drainagecl", "Unknown"),
                "ph": top_hz.get("ph") if top_hz else None,
                "sandPct": top_hz.get("sandPct") if top_hz else None,
                "siltPct": top_hz.get("siltPct") if top_hz else None,
                "clayPct": top_hz.get("clayPct") if top_hz else None,
                "organicMatterPct": top_hz.get("organicMatterPct") if top_hz else None,
                "yardManagement": mgmt,
                "source": "USDA Soil Data Access (SSURGO)",
            }
    except Exception as e:
        logger.warning("Yard context: soil fetch failed: %s", e)

    return {"type": None, "drainage": None, "ph": None, "error": "unavailable"}


def _aqi_category(aqi: int | None) -> str:
    """Map AQI value to EPA category."""
    if aqi is None:
        return "Unknown"
    if aqi <= 50:
        return "Good"
    if aqi <= 100:
        return "Moderate"
    if aqi <= 150:
        return "Unhealthy for Sensitive Groups"
    if aqi <= 200:
        return "Unhealthy"
    if aqi <= 300:
        return "Very Unhealthy"
    return "Hazardous"


@router.get("/api/yard/context")
async def yard_context(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
):
    """Composite yard context: elevation, weather, AQI, and soil in one call.

    Cached for 30 minutes in Redis.
    """
    cache_key = f"yard-ctx-{round(lat, 4)}_{round(lng, 4)}"
    cached, hit = await get_cached("yard-context", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, YARD_CONTEXT_TTL))

    async with httpx.AsyncClient(timeout=30.0) as client:
        elevation, weather, aqi, soil = await asyncio.gather(
            _fetch_elevation(client, lat, lng),
            _fetch_weather(client, lat, lng),
            _fetch_aqi(client),
            _fetch_soil(client, lat, lng),
            return_exceptions=True,
        )

    # Handle any exceptions that slipped through
    if isinstance(elevation, Exception):
        logger.warning("Elevation gather exception: %s", elevation)
        elevation = {"meters": None, "feet": None, "error": str(elevation)}
    if isinstance(weather, Exception):
        logger.warning("Weather gather exception: %s", weather)
        weather = {"temperature": None, "conditions": None, "error": str(weather)}
    if isinstance(aqi, Exception):
        logger.warning("AQI gather exception: %s", aqi)
        aqi = {"aqi": None, "category": None, "error": str(aqi)}
    if isinstance(soil, Exception):
        logger.warning("Soil gather exception: %s", soil)
        soil = {"type": None, "drainage": None, "error": str(soil)}

    result = {
        "lat": lat,
        "lng": lng,
        "elevation": elevation,
        "weather": weather,
        "airQuality": aqi,
        "soil": soil,
        "cachedAt": datetime.now(timezone.utc).isoformat(),
    }

    await set_cached("yard-context", cache_key, result, YARD_CONTEXT_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, YARD_CONTEXT_TTL))
