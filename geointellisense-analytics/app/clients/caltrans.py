"""
Caltrans Traffic AADT (Annual Average Daily Traffic) client.

Source: Caltrans ArcGIS Feature Service — public, no key needed.
Provides traffic volume counts for state highway segments.
"""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

AADT_URL = "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0/query"

OUT_FIELDS = "RTE,PM,DESCRIPTION,AHEAD_AADT,AHEAD_PEAK_HOUR,AHEAD_PEAK_MADT,BACK_AADT,BACK_PEAK_HOUR,CNTY"

# Key Bakersfield corridors
KEY_ROUTES = ["5", "58", "99", "178", "46", "65"]


class TrafficStation:
    __slots__ = ("route", "postmile", "description", "county", "ahead_aadt", "ahead_peak_hour", "back_aadt", "geom_wkt")

    def __init__(self, **kwargs):
        for k in self.__slots__:
            setattr(self, k, kwargs.get(k))

    def to_dict(self) -> dict[str, Any]:
        return {
            "route": self.route,
            "postmile": self.postmile,
            "description": self.description,
            "county": self.county,
            "aheadAADT": self.ahead_aadt,
            "aheadPeakHour": self.ahead_peak_hour,
            "backAADT": self.back_aadt,
        }


async def fetch_county_traffic(county: str = "KER", routes: list[str] | None = None) -> list[TrafficStation]:
    """Fetch AADT data for a county from Caltrans ArcGIS."""
    where = f"CNTY='{county}'"
    if routes:
        route_list = ",".join(f"'{r}'" for r in routes)
        where += f" AND RTE IN ({route_list})"

    stations: list[TrafficStation] = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        offset = 0
        while True:
            params = {
                "where": where,
                "outFields": OUT_FIELDS,
                "returnGeometry": "true",
                "f": "json",
                "resultRecordCount": "2000",
                "resultOffset": str(offset),
                "outSR": "4326",
            }

            resp = await client.get(AADT_URL, params=params)
            resp.raise_for_status()
            body = resp.json()

            features = body.get("features", [])
            if not features:
                break

            for f in features:
                a = f.get("attributes", {})
                g = f.get("geometry", {})

                # Build WKT from paths
                geom_wkt = _paths_to_wkt(g.get("paths", []))

                stations.append(TrafficStation(
                    route=str(a.get("RTE", "")),
                    postmile=_to_float(a.get("PM")),
                    description=a.get("DESCRIPTION", ""),
                    county=a.get("CNTY", county),
                    ahead_aadt=_to_int(a.get("AHEAD_AADT")),
                    ahead_peak_hour=_to_int(a.get("AHEAD_PEAK_HOUR")),
                    back_aadt=_to_int(a.get("BACK_AADT")),
                    geom_wkt=geom_wkt,
                ))

            if len(features) < 2000:
                break
            offset += 2000

    logger.info("Caltrans: %d traffic stations for %s", len(stations), county)
    return stations


def _paths_to_wkt(paths: list) -> str | None:
    if not paths:
        return None
    lines = []
    for path in paths:
        coords = ",".join(f"{p[0]} {p[1]}" for p in path)
        lines.append(f"({coords})")
    return f"MULTILINESTRING({','.join(lines)})"


def _to_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _to_int(val) -> int | None:
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None
