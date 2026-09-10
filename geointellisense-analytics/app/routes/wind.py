"""
Observed surface wind for the Kern communities, from NWS station observations.

Why this exists: the map's wind-field layer used to call generateWindData(),
which invented `speed: 5 + Math.random() * 15` and a direction from a hardcoded
"NW in the morning, SE in the afternoon" rule, and drew the result as a data
layer with no label. Nothing in the stack ingests wind — sensor_readings.wind_speed
is 100% NULL — so those arrows were fiction, and the upwind-fire and inversion
reasoning the app presents leans on them.

This returns measured wind or nothing. A community whose station has no usable
observation is omitted from `communities` and named in `unavailable`, so the
absence is visible in the payload rather than filled in.
"""

import asyncio
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.source_health import record_failure, record_success
from app.source_toggles import is_enabled

router = APIRouter()
logger = logging.getLogger(__name__)

NWS_BASE = "https://api.weather.gov"
NWS_HEADERS = {
    "User-Agent": "(GeoIntelliSense, contact@geointellisense.dev)",
    "Accept": "application/geo+json",
}

WIND_TTL = 600          # 10 min — NWS stations report roughly hourly
STATION_TTL = 604800    # 7 days — the nearest station to a fixed point rarely changes
MAX_OBS_AGE_SECS = 7200  # an observation older than 2h is not "current wind"

# Same nine communities the rest of the Kern-only stack uses.
KERN_COMMUNITIES: dict[str, tuple[float, float]] = {
    "Bakersfield": (35.3733, -119.0187),
    "Delano": (35.7688, -119.2471),
    "Shafter-Wasco": (35.5941, -119.3390),
    "Taft": (35.1425, -119.4565),
    "Tehachapi": (35.1322, -118.4490),
    "Ridgecrest": (35.6225, -117.6709),
    "Lake Isabella": (35.6180, -118.4730),
    "California City": (35.1258, -117.9859),
    "Mojave-Rosamond": (34.9500, -118.1700),
}

# NWS reports wind in km/h (wmoUnit:km_h-1). The map and the rest of the UI
# are imperial, so convert once here rather than in three places downstream.
KMH_TO_MPH = 0.621371


async def _nearest_station(client: httpx.AsyncClient, name: str, lat: float, lon: float) -> str | None:
    """Resolve the closest NWS observation station, cached for a week."""
    cached, _ = await get_cached("wind-station", name)
    if cached:
        return cached

    resp = await client.get(f"{NWS_BASE}/points/{lat},{lon}/stations")
    resp.raise_for_status()
    features = resp.json().get("features") or []
    if not features:
        return None

    station_id = features[0].get("properties", {}).get("stationIdentifier")
    if station_id:
        await set_cached("wind-station", name, station_id, STATION_TTL)
    return station_id


async def _observed_wind(client: httpx.AsyncClient, name: str, lat: float, lon: float) -> dict | None:
    """Latest observed wind for one community, or None if it cannot be measured.

    Returns None rather than a default on every failure path: no station, no
    observation, a null wind field, or an observation too old to be current.
    """
    station = await _nearest_station(client, name, lat, lon)
    if not station:
        logger.info("wind: no NWS station for %s", name)
        return None

    resp = await client.get(f"{NWS_BASE}/stations/{station}/observations/latest")
    resp.raise_for_status()
    props = resp.json().get("properties") or {}

    speed_kmh = (props.get("windSpeed") or {}).get("value")
    direction = (props.get("windDirection") or {}).get("value")
    # A calm reading has speed 0 and direction null, which is meaningful.
    # An unreported speed is not, and must not become 0.
    if speed_kmh is None:
        logger.info("wind: %s (%s) reported no wind speed", name, station)
        return None

    observed_at = props.get("timestamp")
    age_seconds = None
    if observed_at:
        try:
            ts = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
            age_seconds = int((datetime.now(timezone.utc) - ts).total_seconds())
            if age_seconds > MAX_OBS_AGE_SECS:
                logger.info("wind: %s observation is %ds old — dropping", name, age_seconds)
                return None
        except ValueError:
            observed_at = None

    gust_kmh = (props.get("windGust") or {}).get("value")

    return {
        "community": name,
        "lat": lat,
        "lng": lon,
        "speedMph": round(speed_kmh * KMH_TO_MPH, 1),
        "directionDegrees": round(direction) if direction is not None else None,
        "gustMph": round(gust_kmh * KMH_TO_MPH, 1) if gust_kmh is not None else None,
        "station": station,
        "observedAt": observed_at,
        "ageSeconds": age_seconds,
        "source": "nws_observations",
    }


@router.get("/api/weather/wind")
async def observed_wind():
    """Measured surface wind per Kern community.

    `communities` holds only what was actually measured. `unavailable` names the
    rest, so a caller can tell "no wind data" apart from "no wind".
    """
    cached, hit = await get_cached("wind-observed", "kern")
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, WIND_TTL))

    if not await is_enabled("nws_observations"):
        return JSONResponse(
            status_code=503,
            content={
                "error": "NWS observations source is disabled",
                "details": "Enable via POST /api/admin/sources/nws_observations/enable",
            },
        )

    # follow_redirects is required: NWS answers /points/{lat},{lon}/stations
    # with a 301 to /gridpoints/{office}/{x},{y}/stations, and httpx does not
    # follow redirects by default — without this every station lookup raises.
    async with httpx.AsyncClient(headers=NWS_HEADERS, timeout=15.0, follow_redirects=True) as client:
        results = await asyncio.gather(
            *(_observed_wind(client, n, lat, lon) for n, (lat, lon) in KERN_COMMUNITIES.items()),
            return_exceptions=True,
        )

    communities, unavailable = [], []
    for name, result in zip(KERN_COMMUNITIES, results):
        if isinstance(result, BaseException):
            logger.warning("wind: %s failed: %s", name, result)
            unavailable.append({"community": name, "reason": type(result).__name__})
        elif result is None:
            unavailable.append({"community": name, "reason": "no usable observation"})
        else:
            communities.append(result)

    payload = {
        "communities": communities,
        "unavailable": unavailable,
        "measured": len(communities),
        "requested": len(KERN_COMMUNITIES),
        "source": "nws_observations",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }

    # Measuring nothing is a failure of the source, not a successful empty read.
    if communities:
        await record_success("nws_observations", f"{len(communities)}/{len(KERN_COMMUNITIES)} stations")
    else:
        await record_failure("nws_observations", "no station returned a usable observation")

    # Cache even an all-empty result: a failing upstream should not be retried
    # on every map pan, and an empty payload is a truthful answer.
    await set_cached("wind-observed", "kern", payload, WIND_TTL)
    return JSONResponse(content=payload, headers=cache_headers(False, WIND_TTL))
