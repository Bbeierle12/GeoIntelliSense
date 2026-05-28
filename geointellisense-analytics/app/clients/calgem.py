"""
CalGEM (California Geologic Energy Management Division) well data client.

Public data — no API key required.
Source: CalGEM WellSTAR ArcGIS Feature Service.
"""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

FEATURE_URL = (
    "https://gis.conservation.ca.gov/server/rest/services/WellSTAR/Wells/MapServer/0/query"
)

OUT_FIELDS = "API,LeaseName,Latitude,Longitude,WellStatus,WellType,WellTypeLabel,OperatorName,CountyName"

SJV_COUNTIES = ["Kern", "Fresno", "Tulare", "Kings", "Merced", "San Joaquin", "Stanislaus", "Madera"]
DEFAULT_COUNTY = "Kern"


class CalgemWell:
    __slots__ = ("api_number", "latitude", "longitude", "well_status", "well_type", "operator", "county", "depth_ft", "name")

    def __init__(self, **kwargs):
        for k in self.__slots__:
            setattr(self, k, kwargs.get(k))

    def to_dict(self) -> dict[str, Any]:
        return {k: getattr(self, k) for k in self.__slots__}


async def fetch_wells_for_county(county: str = DEFAULT_COUNTY) -> list[CalgemWell]:
    """Fetch well locations for a county from CalGEM ArcGIS feature service."""
    wells: list[CalgemWell] = []

    async with httpx.AsyncClient(timeout=120.0) as client:
        offset = 0
        while True:
            params = {
                "where": f"CountyName='{county}'",
                "outFields": OUT_FIELDS,
                "returnGeometry": "false",
                "f": "json",
                "resultRecordCount": "10000",
                "resultOffset": str(offset),
            }

            logger.info("CalGEM: fetching %s wells offset=%d", county, offset)

            resp = await client.get(FEATURE_URL, params=params)
            resp.raise_for_status()
            body = resp.json()

            features = body.get("features", [])
            if not features:
                break

            for f in features:
                attrs = f.get("attributes", {})
                lat = attrs.get("Latitude")
                lng = attrs.get("Longitude")

                if lat is None or lng is None or lat == 0 or lng == 0:
                    continue

                wells.append(CalgemWell(
                    api_number=attrs.get("API", ""),
                    latitude=lat,
                    longitude=lng,
                    well_status=attrs.get("WellStatus", ""),
                    well_type=attrs.get("WellTypeLabel") or attrs.get("WellType", ""),
                    operator=attrs.get("OperatorName", ""),
                    county=attrs.get("CountyName", county),
                    depth_ft=None,
                    name=attrs.get("LeaseName", ""),
                ))

            if len(features) < 10000:
                break
            offset += 10000

    logger.info("CalGEM: %d wells fetched for %s", len(wells), county)
    return wells
