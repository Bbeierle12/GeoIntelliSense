"""
USDA Soil Data Access (SDA) client.

Public API — no key needed.
Endpoint: https://sdmdataaccess.sc.egov.usda.gov/Tabular/SDMTabularService/post.rest

Queries SSURGO data for soil map units, components, and horizons
at a given lat/lng point.
"""

import logging
from typing import Any, TypedDict

import httpx

logger = logging.getLogger(__name__)

SDA_URL = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/SDMTabularService/post.rest"


class SoilHorizon(TypedDict, total=False):
    chkey: str
    hzname: str | None
    hzdept_r: float | None
    hzdepb_r: float | None
    sandtotal_r: float | None
    silttotal_r: float | None
    claytotal_r: float | None
    om_r: float | None
    ph1to1h2o_r: float | None
    ksat_r: float | None
    awc_r: float | None


class SoilComponent(TypedDict, total=False):
    cokey: str
    compname: str
    comppct_r: int | None
    drainagecl: str | None
    hydgrp: str | None
    taxclname: str | None
    frostact: str | None
    flodfreqcl: str | None
    wtdepannmin: float | None
    horizons: list[SoilHorizon]


class SoilProfile(TypedDict, total=False):
    mukey: str
    muname: str
    components: list[SoilComponent]


async def _post_query(sql: str) -> list[dict[str, Any]]:
    """Post a SQL query to SDA and return the table rows."""
    payload = {"query": sql, "format": "JSON"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(SDA_URL, json=payload)
        resp.raise_for_status()
        data = resp.json()

    table = data.get("Table")
    if not table:
        return []
    return table


def _safe_float(val: Any) -> float | None:
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _safe_int(val: Any) -> int | None:
    if val is None or val == "":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


async def fetch_soil_by_point(lat: float, lng: float) -> SoilProfile | None:
    """
    Fetch soil data for a point: map unit, dominant component, and horizons.

    Returns a SoilProfile dict or None if no data found.
    """
    # Step 1: Get map unit key at the point
    mukey_sql = f"""
        SELECT mukey, muname
        FROM mapunit mu
        INNER JOIN SDA_Get_Mukey_from_intersection_with_WktWgs84(
            'POINT({lng} {lat})'
        ) AS t ON mu.mukey = t.mukey
    """
    mu_rows = await _post_query(mukey_sql)
    if not mu_rows:
        logger.info("No soil map unit found at (%s, %s)", lat, lng)
        return None

    mukey = mu_rows[0].get("mukey")
    muname = mu_rows[0].get("muname", "")

    # Step 2: Get dominant component(s) for this map unit
    comp_sql = f"""
        SELECT cokey, compname, comppct_r, drainagecl, hydgrp,
               taxclname, frostact, flodfreqcl, wtdepannmin
        FROM component
        WHERE mukey = '{mukey}'
        ORDER BY comppct_r DESC
    """
    comp_rows = await _post_query(comp_sql)

    components: list[SoilComponent] = []
    for cr in comp_rows:
        cokey = cr.get("cokey")

        # Step 3: Get horizons for this component
        hz_sql = f"""
            SELECT chkey, hzname, hzdept_r, hzdepb_r,
                   sandtotal_r, silttotal_r, claytotal_r,
                   om_r, ph1to1h2o_r, ksat_r, awc_r
            FROM chorizon
            WHERE cokey = '{cokey}'
            ORDER BY hzdept_r
        """
        hz_rows = await _post_query(hz_sql)

        horizons: list[SoilHorizon] = []
        for hr in hz_rows:
            horizons.append(SoilHorizon(
                chkey=hr.get("chkey", ""),
                hzname=hr.get("hzname"),
                hzdept_r=_safe_float(hr.get("hzdept_r")),
                hzdepb_r=_safe_float(hr.get("hzdepb_r")),
                sandtotal_r=_safe_float(hr.get("sandtotal_r")),
                silttotal_r=_safe_float(hr.get("silttotal_r")),
                claytotal_r=_safe_float(hr.get("claytotal_r")),
                om_r=_safe_float(hr.get("om_r")),
                ph1to1h2o_r=_safe_float(hr.get("ph1to1h2o_r")),
                ksat_r=_safe_float(hr.get("ksat_r")),
                awc_r=_safe_float(hr.get("awc_r")),
            ))

        components.append(SoilComponent(
            cokey=cokey or "",
            compname=cr.get("compname", ""),
            comppct_r=_safe_int(cr.get("comppct_r")),
            drainagecl=cr.get("drainagecl"),
            hydgrp=cr.get("hydgrp"),
            taxclname=cr.get("taxclname"),
            frostact=cr.get("frostact"),
            flodfreqcl=cr.get("flodfreqcl"),
            wtdepannmin=_safe_float(cr.get("wtdepannmin")),
            horizons=horizons,
        ))

    return SoilProfile(
        mukey=mukey,
        muname=muname,
        components=components,
    )
