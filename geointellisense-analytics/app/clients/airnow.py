"""
AirNow API client — EPA-grade air quality monitor data.

Docs: https://docs.airnowapi.org/
Rate limit: 500 requests/hour (generous). We cache for 1 hour.
"""

import asyncio
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

AIRNOW_BASE = "https://www.airnowapi.org/aq"

# AirNow reporting areas covering Kern County.
#
# AirNow reports by reporting area, not by town, and all of Kern is served by
# just three: Bakersfield (which also covers Shafter, Wasco, Taft and
# Arvin/Lamont), Mojave (Tehachapi, California City, Rosamond) and Trona
# (Ridgecrest, ozone and PM10 only). Querying individual towns returned the same
# reporting area several times over and produced duplicate rows.
#
# Delano and Lake Isabella have no reporting area within 30 miles and therefore
# no EPA reference value; they are sensor-only communities.
KERN_LOCATIONS = [
    {"name": "Bakersfield", "lat": 35.3733, "lng": -119.0187, "county": "Kern"},
    {"name": "Mojave", "lat": 35.0525, "lng": -118.1739, "county": "Kern"},
    {"name": "Ridgecrest", "lat": 35.6225, "lng": -117.6709, "county": "Kern"},
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

    async def _get_with_retry(self, url: str, params: dict, attempts: int = 3) -> list[dict]:
        """GET with retries.

        AirNow returns intermittent 502s. Without a retry a single blip drops a
        reporting area from the response, and any caller that falls back to
        sensor data then silently reports a PM2.5-only value as the area's AQI —
        which reads "Good" during a PM10 dust event.
        """
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                resp = await self._http.get(url, params=params)
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                last_error = e
                status = getattr(getattr(e, "response", None), "status_code", None)
                # 4xx is a bad request; retrying will not help.
                if status is not None and 400 <= status < 500:
                    raise
                if attempt < attempts - 1:
                    await asyncio.sleep(1.5 * (attempt + 1))
        raise last_error  # type: ignore[misc]

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

        return await self._get_with_retry(url, params)

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

        return await self._get_with_retry(url, params)

    async def get_all_sjv_current(self) -> list[dict[str, Any]]:
        """Fetch current observations for every Kern reporting area, normalized."""
        results = []

        for loc in KERN_LOCATIONS:
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
        """Fetch AQI forecast for every Kern reporting area, normalized."""
        results = []

        for loc in KERN_LOCATIONS:
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
    # This endpoint returns an AQI sub-index per pollutant, never a µg/m³ or ppm
    # concentration. These were previously stored as `pm25`/`pm10`/`o3`, which
    # the rest of the stack reads as concentrations — a PM2.5 sub-index of 70
    # was being rendered as "70 µg/m³". The *Aqi suffix keeps that unambiguous.
    pm25_aqi = None
    pm10_aqi = None
    o3_aqi = None
    aqi = 0
    dominant = None

    for obs in obs_list:
        param = obs.get("ParameterName", "")
        obs_aqi = obs.get("AQI")
        if obs_aqi is None or obs_aqi < 0:
            continue

        if param == "PM2.5":
            pm25_aqi = obs_aqi
        elif param == "PM10":
            pm10_aqi = obs_aqi
        elif param in ("O3", "OZONE"):
            o3_aqi = obs_aqi
        else:
            continue

        # The reported AQI is the maximum across pollutants, and the pollutant
        # that produced it is the "dominant" one.
        if obs_aqi > aqi:
            aqi = obs_aqi
            dominant = "PM2.5" if param == "PM2.5" else ("PM10" if param == "PM10" else "O3")

    if dominant is None:
        return None

    category, color = _aqi_category(aqi)

    # Get reporting area info from first observation
    first = obs_list[0]
    reporting_area = first.get("ReportingArea", loc["name"])
    state = first.get("StateCode", "CA")
    timestamp = first.get("DateObserved", "").strip() + "T" + str(first.get("HourObserved", 12)).zfill(2) + ":00:00"

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
        "dominantPollutant": dominant,
        # AQI sub-indices, not concentrations — see the note above.
        "pm25Aqi": pm25_aqi,
        "pm10Aqi": pm10_aqi,
        "o3Aqi": o3_aqi,
        "pm25": None,
        "pm10": None,
        "o3": None,
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
