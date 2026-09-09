"""
Authoritative AQI per Kern County community.

The dashboard used to headline a PurpleAir-derived PM2.5 index, which can never
match a public source: the published AQI is the *maximum* across pollutants, and
in Kern the driver is usually PM10 dust or ozone, neither of which a PurpleAir
sensor measures. On 9 Sep 2026 AirNow reported Bakersfield at 77 (PM10) while
the corrected sensor PM2.5 index was 43.

This endpoint reports the official AirNow value as the headline and carries the
local sensor reading alongside it, clearly labelled, so both are visible without
either being mistaken for the other.
"""

import traceback

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.airnow import AirNowClient, _aqi_category
from app.config import settings

router = APIRouter()

HEADLINE_TTL = 900  # 15 minutes
LAST_GOOD_TTL = 21600  # 6 hours — how long a stale official value stays usable

# Ingestion service, in-cluster.
INGESTION_SNAPSHOT_URL = "http://ingestion:3001/api/aqi-snapshot"

# Which AirNow reporting area serves each community. Delano and Lake Isabella
# have no reporting area within 30 miles, so they are sensor-only.
COMMUNITY_TO_REPORTING_AREA = {
    "Bakersfield": "Bakersfield",
    "Shafter-Wasco": "Bakersfield",
    "Taft": "Bakersfield",
    "Tehachapi": "Mojave",
    "California City": "Mojave",
    "Mojave-Rosamond": "Mojave",
    "Ridgecrest": "Trona",
    "Delano": None,
    "Lake Isabella": None,
}


async def _sensor_readings() -> dict[str, dict]:
    """PurpleAir community readings from the ingestion service, by station name."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.get(INGESTION_SNAPSHOT_URL)
            resp.raise_for_status()
            data = resp.json()
        return {r["stationName"]: r for r in data.get("readings", [])}
    except Exception as e:
        # The official value still stands without it.
        print(f"headline: sensor snapshot unavailable: {e}")
        return {}


async def _airnow_by_area() -> dict[str, dict]:
    """AirNow observations keyed by reporting area.

    Any area missing from a live fetch falls back to the last value we stored
    for it, marked stale. Dropping the area instead would hand the headline to
    a PM2.5-only sensor value, understating a PM10 or ozone event.
    """
    live: dict[str, dict] = {}
    if settings.airnow_api_key:
        client = AirNowClient(settings.airnow_api_key)
        try:
            live = {r["reportingArea"]: r for r in await client.get_all_sjv_current()}
        except Exception as e:
            print(f"headline: AirNow unavailable: {e}")
        finally:
            await client.close()

    for area in ("Bakersfield", "Mojave", "Trona"):
        if area in live:
            await set_cached("airnow-last-good", area, live[area], LAST_GOOD_TTL)
            continue
        previous, _ = await get_cached("airnow-last-good", area)
        if previous is not None:
            print(f"headline: using last-known-good AirNow for {area}")
            live[area] = {**previous, "stale": True}

    return live


@router.get("/api/aqi/headline")
async def aqi_headline():
    """Official AQI per Kern community, with the local sensor value alongside."""
    cached, hit = await get_cached("aqi-headline", "kern")
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, HEADLINE_TTL))

    try:
        sensors = await _sensor_readings()
        airnow = await _airnow_by_area()
    except Exception:
        traceback.print_exc()
        return JSONResponse(status_code=502, content={"error": "headline build failed"})

    communities = []
    for name, area in COMMUNITY_TO_REPORTING_AREA.items():
        official = airnow.get(area) if area else None
        sensor = sensors.get(name)

        # The headline is the official multi-pollutant AQI where one exists.
        # Where it does not, the sensor PM2.5 index is shown and explicitly
        # marked as PM2.5-only so it is not read as a full AQI.
        if official:
            aqi = official["aqi"]
            category, color = _aqi_category(aqi)
            basis = "airnow"
            dominant = official.get("dominantPollutant")
        elif sensor:
            aqi = sensor["aqi"]
            category, color = sensor["category"], sensor["color"]
            basis = "purpleair_pm25_only"
            dominant = "PM2.5"
        else:
            communities.append({
                "community": name,
                "aqi": None,
                "basis": "unavailable",
                "note": "No EPA reporting area and no usable sensors right now.",
            })
            continue

        communities.append({
            "community": name,
            "aqi": aqi,
            "category": category,
            "color": color,
            "basis": basis,
            "dominantPollutant": dominant,
            "official": {
                "reportingArea": area,
                "aqi": official["aqi"],
                "pm25Aqi": official.get("pm25Aqi"),
                "pm10Aqi": official.get("pm10Aqi"),
                "o3Aqi": official.get("o3Aqi"),
                "observedAt": official.get("timestamp"),
                "stale": official.get("stale", False),
                "dataSource": "EPA Monitor (AirNow)",
            } if official else None,
            "sensors": {
                "pm25": sensor["pm25"],
                "pm25Aqi": sensor["aqi"],
                "sensorCount": sensor.get("rawSensorCount"),
                "correction": sensor.get("correction"),
                "dataSource": "PurpleAir (EPA-corrected)",
            } if sensor else None,
        })

    # Bakersfield leads; the rest follow by descending AQI.
    communities.sort(
        key=lambda c: (c["community"] != "Bakersfield", -(c["aqi"] or -1))
    )

    primary = next((c for c in communities if c["community"] == "Bakersfield"), None)

    result = {
        "county": "Kern",
        "primary": primary,
        "communities": communities,
        "note": (
            "Headline AQI is the EPA AirNow value, which is the maximum across "
            "PM2.5, PM10 and ozone. PurpleAir sensor values are PM2.5 only and "
            "are corrected with the EPA/Barkjohn equation."
        ),
    }

    await set_cached("aqi-headline", "kern", result, HEADLINE_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, HEADLINE_TTL))
