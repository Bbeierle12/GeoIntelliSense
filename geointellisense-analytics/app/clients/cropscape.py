"""
USDA NASS CropScape (Cropland Data Layer) client.

Public API — no key needed.
Statistics API: https://nassgeodata.gmu.edu/axis2/services/CDLService/
WMS tiles: https://nassgeodata.gmu.edu/CropScapeService/wms_cdlall

Kern County FIPS: 06029
"""

import json
import logging
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

CDL_STAT_URL = "https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLStat"
CDL_CACHE_BASE = "https://nassgeodata.gmu.edu/webservice/nass_data_cache/byfips"
CDL_WMS_URL = "https://nassgeodata.gmu.edu/CropScapeService/wms_cdlall"

KERN_FIPS = "06029"

# SJV county FIPS codes
SJV_FIPS = {
    "06019": "Fresno",
    "06029": "Kern",
    "06047": "Merced",
    "06077": "San Joaquin",
    "06099": "Stanislaus",
    "06107": "Tulare",
}

# Crop categories relevant to air quality impact
AQ_IMPACT_CROPS = {
    "Cotton": "high",       # harvest dust
    "Almonds": "high",      # harvest dust, pesticides
    "Pistachios": "moderate",
    "Corn": "moderate",     # harvest, fertilizer
    "Alfalfa": "moderate",  # harvest dust cycles
    "Winter Wheat": "moderate",
    "Grapes": "moderate",   # pesticides
    "Citrus": "moderate",   # pesticides
}


class CropStat:
    __slots__ = ("crop_code", "crop_name", "acreage", "pixel_count", "color")

    def __init__(self, **kwargs):
        for k in self.__slots__:
            setattr(self, k, kwargs.get(k))

    def to_dict(self) -> dict[str, Any]:
        d = {k: getattr(self, k) for k in self.__slots__}
        d["aqImpact"] = AQ_IMPACT_CROPS.get(self.crop_name)
        return d


async def fetch_crop_stats(fips: str = KERN_FIPS, year: int = 2023) -> list[CropStat]:
    """Fetch crop acreage statistics for a county."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Step 1: trigger the stats generation
        resp = await client.get(CDL_STAT_URL, params={"year": str(year), "fips": fips, "format": "json"})
        resp.raise_for_status()

        # Step 2: fetch the cached JSON
        cache_url = f"{CDL_CACHE_BASE}/CDL_{year}_{fips}.json"
        resp2 = await client.get(cache_url)
        resp2.raise_for_status()

    return _parse_stats(resp2.text)


def get_wms_tile_url(year: int = 2023) -> str:
    """WMS tile URL template for Google Maps overlay (EPSG:4326)."""
    return (
        f"{CDL_WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
        f"&LAYERS=cdl_{year}&SRS=EPSG:4326"
        "&BBOX={{bbox}}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE"
    )


def _parse_stats(text: str) -> list[CropStat]:
    # Fix non-standard JSON (unquoted keys)
    fixed = re.sub(r'(\{|,)\s*([a-zA-Z_]\w*)\s*:', r'\1"\2":', text)
    data = json.loads(fixed)

    crops: list[CropStat] = []
    for row in data.get("rows", []):
        crops.append(CropStat(
            crop_code=row.get("value"),
            crop_name=row.get("category", ""),
            acreage=row.get("acreage", 0),
            pixel_count=row.get("count", 0),
            color=row.get("color", ""),
        ))

    logger.info("CropScape: %d crop types, %.0f total acres", len(crops), sum(c.acreage for c in crops))
    return crops
