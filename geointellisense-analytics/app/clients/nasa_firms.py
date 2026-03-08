"""
NASA FIRMS (Fire Information for Resource Management System) client.

Docs: https://firms.modaps.eosdis.nasa.gov/api/area/
Requires MAP_KEY from: https://firms.modaps.eosdis.nasa.gov/api/

Provides MODIS and VIIRS active fire detections.
"""

import csv
import io
import logging
import math
from datetime import datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"

# Bakersfield center
BAKERSFIELD_LAT = 35.3733
BAKERSFIELD_LNG = -119.0187

# Bounding box: 200km around Bakersfield (roughly ±1.8° lat, ±2.2° lng)
BBOX_SOUTH = 33.5
BBOX_NORTH = 37.2
BBOX_WEST = -121.5
BBOX_EAST = -117.0

# Prevailing wind direction in SJV — northwest winds carry smoke southeast
UPWIND_BEARING_MIN = 270  # west
UPWIND_BEARING_MAX = 360  # north (wrap)
UPWIND_BEARING_MIN2 = 0
UPWIND_BEARING_MAX2 = 45  # northeast


class FireDetection:
    __slots__ = (
        "latitude", "longitude", "brightness", "frp", "confidence",
        "satellite", "instrument", "acq_datetime", "daynight",
    )

    def __init__(self, **kwargs):
        for k in self.__slots__:
            setattr(self, k, kwargs.get(k))

    def to_dict(self) -> dict[str, Any]:
        d = {k: getattr(self, k) for k in self.__slots__}
        if self.acq_datetime:
            d["time"] = self.acq_datetime.isoformat() if hasattr(self.acq_datetime, "isoformat") else str(self.acq_datetime)
        d["distanceKm"] = round(_haversine(self.latitude, self.longitude, BAKERSFIELD_LAT, BAKERSFIELD_LNG), 1)
        d["isUpwind"] = _is_upwind(self.latitude, self.longitude)
        return d


async def fetch_active_fires(api_key: str, days: int = 2, source: str = "VIIRS_SNPP_NRT") -> list[FireDetection]:
    """Fetch active fire detections from FIRMS within the SJV bounding box."""
    bbox = f"{BBOX_WEST},{BBOX_SOUTH},{BBOX_EAST},{BBOX_NORTH}"
    url = f"{FIRMS_BASE}/{api_key}/{source}/{bbox}/{days}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url)
        if resp.status_code == 401:
            raise ValueError("Invalid NASA FIRMS MAP_KEY")
        resp.raise_for_status()

    return _parse_csv(resp.text, source)


async def fetch_all_sources(api_key: str, days: int = 2) -> list[FireDetection]:
    """Fetch from both VIIRS and MODIS."""
    all_fires: list[FireDetection] = []

    for source in ["VIIRS_SNPP_NRT", "MODIS_NRT"]:
        try:
            fires = await fetch_active_fires(api_key, days, source)
            all_fires.extend(fires)
            logger.info("FIRMS %s: %d detections", source, len(fires))
        except Exception as e:
            logger.warning("FIRMS %s failed: %s", source, e)

    return all_fires


def get_smoke_context(fires: list[FireDetection]) -> str:
    """Generate a text summary of fire activity for Claude AI context injection."""
    if not fires:
        return ""

    upwind = [f for f in fires if _is_upwind(f.latitude, f.longitude)]
    high_conf = [f for f in fires if f.confidence in ("high", "h", "nominal", "n")]
    high_frp = [f for f in fires if f.frp and f.frp > 50]

    lines = [f"ACTIVE FIRE ALERT: {len(fires)} fire detections within 200km of Bakersfield."]

    if upwind:
        lines.append(f"  - {len(upwind)} fires are UPWIND (NW-N direction) — smoke likely impacting SJV air quality.")

    if high_frp:
        max_frp = max(f.frp for f in high_frp)
        lines.append(f"  - {len(high_frp)} high-intensity fires (max FRP: {max_frp:.0f} MW).")

    closest = min(fires, key=lambda f: _haversine(f.latitude, f.longitude, BAKERSFIELD_LAT, BAKERSFIELD_LNG))
    dist = _haversine(closest.latitude, closest.longitude, BAKERSFIELD_LAT, BAKERSFIELD_LNG)
    lines.append(f"  - Closest fire: {dist:.0f}km from Bakersfield.")

    return "\n".join(lines)


def _parse_csv(text: str, source: str) -> list[FireDetection]:
    fires: list[FireDetection] = []
    reader = csv.DictReader(io.StringIO(text))

    for row in reader:
        try:
            lat = float(row.get("latitude", 0))
            lng = float(row.get("longitude", 0))
            if lat == 0 or lng == 0:
                continue

            # Parse acquisition date/time
            acq_date = row.get("acq_date", "")
            acq_time = row.get("acq_time", "0000")
            try:
                dt = datetime.strptime(f"{acq_date} {acq_time.zfill(4)}", "%Y-%m-%d %H%M")
            except ValueError:
                dt = None

            fires.append(FireDetection(
                latitude=lat,
                longitude=lng,
                brightness=_float_or_none(row.get("bright_ti4") or row.get("brightness")),
                frp=_float_or_none(row.get("frp")),
                confidence=row.get("confidence", "").lower(),
                satellite=row.get("satellite", source.split("_")[0]),
                instrument=source,
                acq_datetime=dt,
                daynight=row.get("daynight", ""),
            ))
        except Exception:
            continue

    return fires


def _float_or_none(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in km between two points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Bearing from point 1 to point 2 in degrees."""
    dlon = math.radians(lon2 - lon1)
    lat1r, lat2r = math.radians(lat1), math.radians(lat2)
    x = math.sin(dlon) * math.cos(lat2r)
    y = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _is_upwind(fire_lat: float, fire_lng: float) -> bool:
    """Check if fire is upwind (NW to N) of Bakersfield."""
    b = _bearing(BAKERSFIELD_LAT, BAKERSFIELD_LNG, fire_lat, fire_lng)
    return (UPWIND_BEARING_MIN <= b <= UPWIND_BEARING_MAX) or (UPWIND_BEARING_MIN2 <= b <= UPWIND_BEARING_MAX2)
