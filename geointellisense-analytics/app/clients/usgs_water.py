"""
USGS Water Services API client.

Docs: https://waterservices.usgs.gov/
Public API — no key needed. Rate limit: be reasonable (we poll every 15 min).
"""

import logging
from datetime import datetime
from typing import Any

import httpx
from app.http_client import fetch as http_fetch

logger = logging.getLogger(__name__)

USGS_IV_URL = "https://waterservices.usgs.gov/nwis/iv/"    # instantaneous values
USGS_DV_URL = "https://waterservices.usgs.gov/nwis/dv/"    # daily values

# Parameter codes
PARAM_DISCHARGE = "00060"    # Streamflow, ft³/s
PARAM_GAGE_HEIGHT = "00065"  # Gage height, ft
PARAM_WATER_TEMP = "00010"   # Water temperature, °C

PARAMS_ALL = f"{PARAM_DISCHARGE},{PARAM_GAGE_HEIGHT},{PARAM_WATER_TEMP}"

# Kern County / SJV USGS stations with real-time data
SJV_STATIONS = {
    "11189500": "SF Kern River near Onyx",
    "11194152": "Kern River at Enos Park near Bakersfield",
    "11199500": "White River near Ducor",
    "11200800": "Deer Creek near Fountain Springs",
    "11136600": "Santa Barbara Canyon Creek near Ventucopa",
    "11136710": "Cuyama River near New Cuyama",
    "353229119050601": "Kern County Groundwater Monitor",
}

PARAM_NAMES = {
    PARAM_DISCHARGE: "discharge",
    PARAM_GAGE_HEIGHT: "gage_height",
    PARAM_WATER_TEMP: "water_temp",
}

PARAM_UNITS = {
    PARAM_DISCHARGE: "ft³/s",
    PARAM_GAGE_HEIGHT: "ft",
    PARAM_WATER_TEMP: "°C",
}

SENTINEL_VALUE = -999999.0


class WaterReading:
    __slots__ = ("time", "site_id", "site_name", "parameter", "value", "units", "qualifier", "latitude", "longitude")

    def __init__(self, **kwargs):
        for k in self.__slots__:
            setattr(self, k, kwargs.get(k))

    def to_dict(self) -> dict[str, Any]:
        return {k: getattr(self, k) for k in self.__slots__}


async def fetch_current(
    sites: list[str] | None = None,
    bbox: tuple[float, float, float, float] | None = None,
) -> list[WaterReading]:
    """Fetch latest instantaneous values. Accepts sites list or (south,west,north,east) bbox."""
    params: dict[str, str] = {
        "format": "json",
        "parameterCd": PARAMS_ALL,
        "siteStatus": "active",
    }

    if bbox:
        # USGS expects bBox=west,south,east,north
        south, west, north, east = bbox
        params["bBox"] = f"{west},{south},{east},{north}"
    else:
        if sites is None:
            sites = list(SJV_STATIONS.keys())
        params["sites"] = ",".join(sites)

    resp = await http_fetch(USGS_IV_URL, params=params, timeout=30.0)
    body = resp.json()

    return _parse_iv_response(body)


async def fetch_historical(site: str, start: str, end: str) -> list[WaterReading]:
    """Fetch daily values for a station over a date range."""
    params = {
        "format": "json",
        "sites": site,
        "parameterCd": PARAMS_ALL,
        "startDT": start,
        "endDT": end,
        "siteStatus": "all",
    }

    resp = await http_fetch(USGS_DV_URL, params=params, timeout=60.0)
    body = resp.json()

    return _parse_iv_response(body)


def _parse_iv_response(body: dict) -> list[WaterReading]:
    readings: list[WaterReading] = []

    time_series = body.get("value", {}).get("timeSeries", [])

    for ts in time_series:
        site_info = ts.get("sourceInfo", {})
        site_id = site_info.get("siteCode", [{}])[0].get("value", "")
        site_name = site_info.get("siteName", "")
        geo = site_info.get("geoLocation", {}).get("geogLocation", {})
        lat = geo.get("latitude")
        lng = geo.get("longitude")

        var = ts.get("variable", {})
        param_code = var.get("variableCode", [{}])[0].get("value", "")
        param_name = PARAM_NAMES.get(param_code, param_code)
        units = PARAM_UNITS.get(param_code, "")

        for val_set in ts.get("values", []):
            for v in val_set.get("value", []):
                raw_value = v.get("value")
                if raw_value is None:
                    continue

                try:
                    numeric = float(raw_value)
                except (ValueError, TypeError):
                    continue

                # Skip sentinel/error values
                if numeric <= SENTINEL_VALUE:
                    continue

                qualifier = ""
                qualifiers = v.get("qualifiers", [])
                if qualifiers:
                    qualifier = ",".join(qualifiers)

                readings.append(WaterReading(
                    time=v.get("dateTime", ""),
                    site_id=site_id,
                    site_name=site_name,
                    parameter=param_name,
                    value=numeric,
                    units=units,
                    qualifier=qualifier,
                    latitude=lat,
                    longitude=lng,
                ))

    logger.info("USGS Water: %d readings parsed", len(readings))
    return readings
