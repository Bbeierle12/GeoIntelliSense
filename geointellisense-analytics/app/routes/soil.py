"""
Soil data routes backed by USDA Soil Data Access (SSURGO/SDA).

Provides soil profile reports with yard management interpretations.
Caches in Redis (30-day TTL) and PostGIS (permanent).
"""

import json
import logging
import traceback
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.sda import fetch_soil_by_point, SoilProfile
from app.database import get_pool
from app.source_toggles import is_enabled

router = APIRouter()
logger = logging.getLogger(__name__)

SOIL_TTL = 2592000  # 30 days


@router.get("/api/soil/report")
async def soil_report(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
):
    """
    Return a soil profile with yard management interpretations.

    Checks Redis cache first, then PostGIS, then fetches from SDA.
    """
    cache_key = {"lat": round(lat, 6), "lng": round(lng, 6)}

    # 1. Redis cache
    cached, hit = await get_cached("soil-report", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, SOIL_TTL))

    pool = await get_pool()

    # 2. PostGIS cache — check if we already have soil data for this point
    db_profile = await _load_from_db(pool, lat, lng)
    if db_profile:
        result = _build_response(db_profile, lat, lng)
        await set_cached("soil-report", cache_key, result, SOIL_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, SOIL_TTL))

    # 3. Fetch from SDA
    if not await is_enabled("ssurgo"):
        return JSONResponse(
            status_code=503,
            content={"error": "SSURGO source is disabled. Enable via POST /api/admin/sources/ssurgo/enable"},
        )

    try:
        profile = await fetch_soil_by_point(lat, lng)
        if not profile:
            return JSONResponse(status_code=404, content={"error": f"No soil data found at ({lat}, {lng})"})

        # Persist to PostGIS
        await _persist_profile(pool, profile, lat, lng)

        result = _build_response(profile, lat, lng)
        await set_cached("soil-report", cache_key, result, SOIL_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, SOIL_TTL))

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=502, content={"error": "SDA request failed", "details": str(e)})


# -- DB read/write --

async def _load_from_db(pool, lat: float, lng: float) -> SoilProfile | None:
    """Load soil data from PostGIS if we have a map unit covering this point."""
    row = await pool.fetchrow(
        """
        SELECT mu.mukey, mu.muname
        FROM soil_map_units mu
        WHERE ST_Contains(mu.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        LIMIT 1
        """,
        lng, lat,
    )
    if not row:
        return None

    mukey = row["mukey"]

    comp_rows = await pool.fetch(
        """
        SELECT cokey, compname, comppct_r, drainagecl, hydgrp,
               taxclname, frostact, flodfreqcl, wtdepannmin
        FROM soil_components WHERE mukey = $1 ORDER BY comppct_r DESC
        """,
        mukey,
    )

    components = []
    for cr in comp_rows:
        hz_rows = await pool.fetch(
            """
            SELECT chkey, hzname, hzdept_r, hzdepb_r,
                   sandtotal_r, silttotal_r, claytotal_r,
                   om_r, ph1to1h2o_r, ksat_r, awc_r
            FROM soil_horizons WHERE cokey = $1 ORDER BY hzdept_r
            """,
            cr["cokey"],
        )
        horizons = [dict(h) for h in hz_rows]
        comp = dict(cr)
        comp["horizons"] = horizons
        components.append(comp)

    return {"mukey": mukey, "muname": row["muname"], "components": components}


async def _persist_profile(pool, profile: SoilProfile, lat: float, lng: float) -> None:
    """Persist soil profile to PostGIS tables."""
    mukey = profile["mukey"]

    # Upsert map unit (store point as a tiny buffer polygon for spatial lookup)
    await pool.execute(
        """
        INSERT INTO soil_map_units (mukey, muname, geom)
        VALUES ($1, $2, ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, 100)::geometry))
        ON CONFLICT (mukey) DO UPDATE SET muname = EXCLUDED.muname, fetched_at = now()
        """,
        mukey, profile["muname"], lng, lat,
    )

    for comp in profile.get("components", []):
        cokey = comp.get("cokey", "")
        await pool.execute(
            """
            INSERT INTO soil_components (cokey, mukey, compname, comppct_r, drainagecl,
                                         hydgrp, taxclname, frostact, flodfreqcl, wtdepannmin)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (cokey) DO UPDATE SET
                compname = EXCLUDED.compname, comppct_r = EXCLUDED.comppct_r,
                drainagecl = EXCLUDED.drainagecl, hydgrp = EXCLUDED.hydgrp
            """,
            cokey, mukey, comp.get("compname", ""),
            comp.get("comppct_r"), comp.get("drainagecl"), comp.get("hydgrp"),
            comp.get("taxclname"), comp.get("frostact"), comp.get("flodfreqcl"),
            comp.get("wtdepannmin"),
        )

        for hz in comp.get("horizons", []):
            chkey = hz.get("chkey", "")
            await pool.execute(
                """
                INSERT INTO soil_horizons (chkey, cokey, hzname, hzdept_r, hzdepb_r,
                                           sandtotal_r, silttotal_r, claytotal_r,
                                           om_r, ph1to1h2o_r, ksat_r, awc_r)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (chkey) DO UPDATE SET
                    hzname = EXCLUDED.hzname, sandtotal_r = EXCLUDED.sandtotal_r,
                    claytotal_r = EXCLUDED.claytotal_r, om_r = EXCLUDED.om_r,
                    ph1to1h2o_r = EXCLUDED.ph1to1h2o_r, ksat_r = EXCLUDED.ksat_r
                """,
                chkey, cokey, hz.get("hzname"),
                hz.get("hzdept_r"), hz.get("hzdepb_r"),
                hz.get("sandtotal_r"), hz.get("silttotal_r"), hz.get("claytotal_r"),
                hz.get("om_r"), hz.get("ph1to1h2o_r"), hz.get("ksat_r"), hz.get("awc_r"),
            )


# -- Response formatting --

def _build_response(profile: dict, lat: float, lng: float) -> dict:
    """Build the full soil report response with yard management interpretations."""
    dominant = profile["components"][0] if profile.get("components") else None

    result: dict[str, Any] = {
        "location": {"lat": lat, "lng": lng},
        "mapUnit": {
            "mukey": profile["mukey"],
            "muname": profile["muname"],
        },
        "components": [],
        "yardManagement": _interpret_yard_management(dominant) if dominant else None,
    }

    for comp in profile.get("components", []):
        c: dict[str, Any] = {
            "compname": comp.get("compname"),
            "comppctR": comp.get("comppct_r"),
            "drainagecl": comp.get("drainagecl"),
            "hydgrp": comp.get("hydgrp"),
            "taxclname": comp.get("taxclname"),
            "frostact": comp.get("frostact"),
            "flodfreqcl": comp.get("flodfreqcl"),
            "wtdepannmin": comp.get("wtdepannmin"),
            "horizons": [],
        }
        for hz in comp.get("horizons", []):
            c["horizons"].append({
                "hzname": hz.get("hzname"),
                "depthTopCm": hz.get("hzdept_r"),
                "depthBottomCm": hz.get("hzdepb_r"),
                "sandPct": hz.get("sandtotal_r"),
                "siltPct": hz.get("silttotal_r"),
                "clayPct": hz.get("claytotal_r"),
                "organicMatterPct": hz.get("om_r"),
                "ph": hz.get("ph1to1h2o_r"),
                "ksatUmPerSec": hz.get("ksat_r"),
                "awcCmPerCm": hz.get("awc_r"),
            })
        result["components"].append(c)

    return result


def _interpret_yard_management(comp: dict) -> dict:
    """
    Generate yard management interpretations from the dominant soil component.

    Returns ratings for drainage, amendments, and planting suitability.
    """
    drainage_cl = (comp.get("drainagecl") or "").lower()
    hydgrp = (comp.get("hydgrp") or "").upper()
    frost = (comp.get("frostact") or "").lower()
    flood = (comp.get("flodfreqcl") or "").lower()
    wtdepth = comp.get("wtdepannmin")

    # Top horizon for texture/pH analysis
    top_hz = comp.get("horizons", [None])[0] if comp.get("horizons") else None

    # -- Drainage rating --
    if drainage_cl in ("excessively drained", "somewhat excessively drained"):
        drainage_rating = "excessive"
        drainage_note = "Soil drains very quickly. Water deeply and less frequently. Consider mulch to retain moisture."
    elif drainage_cl in ("well drained", "moderately well drained"):
        drainage_rating = "good"
        drainage_note = "Good natural drainage. Standard watering practices apply."
    elif drainage_cl in ("somewhat poorly drained",):
        drainage_rating = "fair"
        drainage_note = "Drainage is marginal. Avoid overwatering. Raised beds may help sensitive plants."
    elif drainage_cl in ("poorly drained", "very poorly drained"):
        drainage_rating = "poor"
        drainage_note = "Soil holds water. Use raised beds or drainage amendments (perlite, coarse sand). Choose water-tolerant species."
    else:
        drainage_rating = "unknown"
        drainage_note = "Drainage class not available."

    # -- Amendment needs --
    amendments = []
    if top_hz:
        ph = top_hz.get("ph1to1h2o_r")
        om = top_hz.get("om_r")
        clay = top_hz.get("claytotal_r")
        sand = top_hz.get("sandtotal_r")

        if ph is not None:
            if ph < 5.5:
                amendments.append({"type": "lime", "reason": f"pH {ph} is very acidic. Add lime to raise pH."})
            elif ph < 6.0:
                amendments.append({"type": "lime", "reason": f"pH {ph} is slightly acidic. Light liming may help."})
            elif ph > 8.0:
                amendments.append({"type": "sulfur", "reason": f"pH {ph} is alkaline. Add sulfur or acidifying fertilizer."})
            elif ph > 7.5:
                amendments.append({"type": "sulfur", "reason": f"pH {ph} is slightly alkaline. Consider sulfur for acid-loving plants."})

        if om is not None and om < 2.0:
            amendments.append({"type": "compost", "reason": f"Organic matter {om}% is low. Add compost to improve structure and fertility."})

        if clay is not None and clay > 40:
            amendments.append({"type": "gypsum", "reason": f"Clay content {clay}% is high. Gypsum can improve structure."})

        if sand is not None and sand > 70:
            amendments.append({"type": "compost", "reason": f"Sand content {sand}% is high. Add compost to improve water retention."})

    # -- Planting suitability --
    suitability = "good"
    suitability_notes = []

    if drainage_rating == "poor":
        suitability = "limited"
        suitability_notes.append("Poor drainage limits plant selection.")

    if frost and frost not in ("none", "low"):
        suitability_notes.append(f"Frost action: {frost}. Protect shallow-rooted plants in winter.")

    if flood and flood not in ("none", "very rare"):
        suitability = "limited"
        suitability_notes.append(f"Flood frequency: {flood}. Avoid low-lying planting areas.")

    if wtdepth is not None and wtdepth < 50:
        suitability_notes.append(f"Water table at {wtdepth}cm. Deep-rooted trees may struggle.")

    if hydgrp in ("C", "D", "C/D"):
        suitability_notes.append(f"Hydrologic group {hydgrp}: high runoff potential. Grade away from structures.")

    if not suitability_notes:
        suitability_notes.append("No significant limitations detected.")

    return {
        "drainage": {
            "rating": drainage_rating,
            "class": comp.get("drainagecl"),
            "hydrologicGroup": hydgrp or None,
            "note": drainage_note,
        },
        "amendments": amendments,
        "plantingSuitability": {
            "rating": suitability,
            "notes": suitability_notes,
        },
        "soilTexture": _texture_summary(top_hz) if top_hz else None,
    }


def _texture_summary(hz: dict) -> dict | None:
    """Summarize soil texture from the top horizon."""
    sand = hz.get("sandtotal_r")
    silt = hz.get("silttotal_r")
    clay = hz.get("claytotal_r")

    if sand is None or silt is None or clay is None:
        return None

    # Simple texture class determination
    if sand >= 70:
        texture_class = "sandy"
    elif clay >= 40:
        texture_class = "clay"
    elif silt >= 50:
        texture_class = "silty"
    elif sand >= 50 and clay >= 20:
        texture_class = "sandy clay loam"
    elif clay >= 27:
        texture_class = "clay loam"
    else:
        texture_class = "loam"

    return {
        "sandPct": sand,
        "siltPct": silt,
        "clayPct": clay,
        "textureClass": texture_class,
    }
