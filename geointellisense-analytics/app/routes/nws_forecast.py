from datetime import datetime

import httpx
from fastapi import APIRouter, Query

from app.database import get_pool

router = APIRouter()

NWS_BASE = "https://api.weather.gov"
NWS_HEADERS = {"User-Agent": "(GeoIntelliSense, contact@geointellisense.dev)", "Accept": "application/geo+json"}


@router.get("/api/forecast")
async def forecast(
    location_ids: str | None = Query(None, description="Comma-separated location UUIDs"),
):
    pool = await get_pool()

    # Fetch locations from DB
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
            except Exception as e:
                # If NWS fails for a location, skip it rather than failing the whole request
                import traceback
                traceback.print_exc()
                continue

    return records


async def _fetch_nws_forecast(client: httpx.AsyncClient, lat: float, lng: float) -> list[dict]:
    """Two-step NWS API: /points → /forecast."""
    points_resp = await client.get(f"{NWS_BASE}/points/{lat},{lng}")
    points_resp.raise_for_status()
    forecast_url = points_resp.json()["properties"]["forecast"]

    forecast_resp = await client.get(forecast_url)
    forecast_resp.raise_for_status()
    return forecast_resp.json()["properties"]["periods"]
