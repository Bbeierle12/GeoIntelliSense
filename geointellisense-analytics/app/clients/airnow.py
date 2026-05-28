"""
AirNow API client — EPA-grade air quality monitor data.

Docs: https://docs.airnowapi.org/
Rate limit: 500 requests/hour (generous). We cache for 1 hour.
"""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

AIRNOW_BASE = "https://www.airnowapi.org/aq"

# SJV cities with their coordinates for observation lookups
SJV_LOCATIONS = [
    {"name": "Bakersfield", "lat": 35.3733, "lng": -119.0187, "county": "Kern"},
    {"name": "Fresno", "lat": 36.7378, "lng": -119.7871, "county": "Fresno"},
    {"name": "Visalia", "lat": 36.3302, "lng": -119.2921, "county": "Tulare"},
    {"name": "Merced", "lat": 37.3022, "lng": -120.4830, "county": "Merced"},
    {"name": "Modesto", "lat": 37.6391, "lng": -120.9969, "county": "Stanislaus"},
    {"name": "Stockton", "lat": 37.9577, "lng": -121.2908, "county": "San Joaquin"},
]

# AirNow AQI category mapping (matches our existing model)
AQI_CATEGORIES = [
    (50, "Good", "#00e400"),
    (100, "Moderate", "#ffff00"),
    (150, "Unhealthy for Sensitive Groups", "#ff7e00"),
    (200, "Unhealthy", "#ff0000"),
    (300, "Very Unhealthy", "#8f3f97"),
    (500, "Hazardous", "#7e0023"),
]


def _aqi_category(aqi: int) -> tuple[str, str]:
    for threshold, name, color in AQI_CATEGORIES:
        if aqi <= threshold:
            return name, color
    return "Hazardous", "#7e0023"


class AirNowClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self._http = httpx.AsyncClient(timeout=15.0)

    async def close(self) -> None:
        await self._http.aclose()

    async def get_current_observations(self, lat: float, lng: float, distance_miles: int = 50) -> list[dict]:
        """Fetch current observations near a lat/lng point."""
        url = f"{AIRNOW_BASE}/observation/latLong/current/"
        params = {
            "format": "application/json",
            "latitude": str(lat),
            "longitude": str(lng),
            "distance": str(distance_miles),
            "API_KEY": self.api_key,
        }

        resp = await self._http.get(url, params=params)
        resp.raise_for_status()
        return resp.json()

    async def get_forecast(self, lat: float, lng: float, distance_miles: int = 50) -> list[dict]:
        """Fetch AQI forecast near a lat/lng point."""
        url = f"{AIRNOW_BASE}/forecast/latLong/"
        params = {
            "format": "application/json",
            "latitude": str(lat),
            "longitude": str(lng),
            "distance": str(distance_miles),
            "API_KEY": self.api_key,
        }

        resp = await self._http.get(url, params=params)
        resp.raise_for_status()
        return resp.json()

    async def get_all_sjv_current(self) -> list[dict[str, Any]]:
        """Fetch current observations for all 6 SJV cities, normalized."""
        results = []

        for loc in SJV_LOCATIONS:
            try:
                obs_list = await self.get_current_observations(loc["lat"], loc["lng"], distance_miles=25)
                if not obs_list:
                    continue

                # Group by reporting area — take the first (closest) set
                # AirNow returns one entry per parameter (PM2.5, O3, etc.)
                reading = _normalize_observations(obs_list, loc)
                if reading:
                    results.append(reading)

            except Exception as e:
                logger.warning("AirNow fetch failed for %s: %s", loc["name"], e)
                continue

        return results

    async def get_all_sjv_forecast(self) -> list[dict[str, Any]]:
        """Fetch AQI forecast for all 6 SJV cities, normalized."""
        results = []

        for loc in SJV_LOCATIONS:
            try:
                forecasts = await self.get_forecast(loc["lat"], loc["lng"], distance_miles=25)
                for f in forecasts:
                    aqi = f.get("AQI", -1)
                    if aqi < 0:
                        continue
                    category, color = _aqi_category(aqi)
                    results.append({
                        "stationName": loc["name"],
                        "lat": loc["lat"],
                        "lng": loc["lng"],
                        "county": loc["county"],
                        "date": f.get("DateForecast", "").strip(),
                        "aqi": aqi,
                        "category": category,
                        "color": color,
                        "parameter": f.get("ParameterName", ""),
                        "discussion": f.get("Discussion", ""),
                        "source": "airnow",
                        "dataSource": "EPA Monitor (AirNow)",
                    })
            except Exception as e:
                logger.warning("AirNow forecast failed for %s: %s", loc["name"], e)
                continue

        return results


def _normalize_observations(obs_list: list[dict], loc: dict) -> dict[str, Any] | None:
    """Normalize AirNow observation entries into a single reading matching our data model."""
    pm25 = None
    pm10 = None
    o3 = None
    aqi = 0

    for obs in obs_list:
        param = obs.get("ParameterName", "")
        obs_aqi = obs.get("AQI", 0)

        if param == "PM2.5":
            pm25 = obs_aqi  # AirNow returns AQI not raw concentration for this endpoint
            if obs_aqi > aqi:
                aqi = obs_aqi
        elif param == "PM10":
            pm10 = obs_aqi
            if obs_aqi > aqi:
                aqi = obs_aqi
        elif param == "O3" or param == "OZONE":
            o3 = obs_aqi
            if obs_aqi > aqi:
                aqi = obs_aqi

    if aqi == 0:
        return None

    category, color = _aqi_category(aqi)

    # Get reporting area info from first observation
    first = obs_list[0]
    reporting_area = first.get("ReportingArea", loc["name"])
    state = first.get("StateCode", "CA")
    timestamp = first.get("DateObserved", "").strip() + "T" + first.get("HourObserved", "12").zfill(2) + ":00:00"

    return {
        "stationId": f"airnow-{loc['name'].lower()}",
        "stationName": f"{loc['name']}-EPA",
        "reportingArea": reporting_area,
        "lat": first.get("Latitude", loc["lat"]),
        "lng": first.get("Longitude", loc["lng"]),
        "county": loc["county"],
        "timestamp": timestamp,
        "aqi": aqi,
        "category": category,
        "color": color,
        "pm25": pm25,
        "pm10": pm10,
        "o3": o3,
        "no2": None,
        "so2": None,
        "co": None,
        "temperature": None,
        "humidity": None,
        "windSpeed": None,
        "windDirection": None,
        "source": "airnow",
        "dataSource": "EPA Monitor (AirNow)",
    }
