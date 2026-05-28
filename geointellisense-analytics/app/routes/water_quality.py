import asyncio
import logging
import traceback
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.wqp import (
    fetch_key_contaminants,
    fetch_results,
    fetch_sites,
    classify_contamination,
    WQSample,
    PARAMETERS,
    MCL_LOOKUP,
    KERN_COUNTY_FIPS,
)
from app.database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

WQ_TTL = 2592000  # 30 days — water quality data updates infrequently

# Backfill state
_backfill_task: asyncio.Task | None = None
_backfill_status: dict[str, Any] = {"state": "idle"}


@router.get("/api/water-quality/wells")
async def wells_with_chemistry(
    bbox: str = Query(..., description="south_lat,west_lng,north_lat,east_lng"),
    parameter: str | None = Query(None, description="Filter by parameter (Arsenic, Nitrate, pH, TDS, etc.)"),
    exceeds_only: bool = Query(False, description="Only return sites exceeding MCL"),
    limit: int = Query(500, ge=1, le=5000),
):
    """Wells with latest water chemistry within a bounding box."""
    parts = [float(x.strip()) for x in bbox.split(",")]
    if len(parts) != 4:
        return JSONResponse(status_code=400, content={"error": "bbox must be south_lat,west_lng,north_lat,east_lng"})

    south, west, north, east = parts
    cache_key = {"bbox": bbox, "param": parameter or "all", "exceeds": exceeds_only, "limit": limit}
    cached, hit = await get_cached("wq-wells", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, WQ_TTL))

    pool = await get_pool()

    # Build query — get latest measurement per site per parameter
    query = """
        SELECT DISTINCT ON (wq.site_id, wq.parameter)
            wq.site_id, wq.site_name, wq.parameter, wq.value, wq.unit,
            wq.detection_condition, wq.sample_fraction, wq.time, wq.organization,
            ST_Y(wq.geom) AS lat, ST_X(wq.geom) AS lng
        FROM water_quality wq
        WHERE ST_Within(
            wq.geom,
            ST_MakeEnvelope($1, $2, $3, $4, 4326)
        )
    """
    params: list = [west, south, east, north]
    idx = 4

    if parameter:
        idx += 1
        query += f" AND wq.parameter ILIKE ${idx}"
        params.append(f"%{parameter}%")

    query += " ORDER BY wq.site_id, wq.parameter, wq.time DESC"
    query += f" LIMIT ${idx + 1}"
    params.append(limit)

    rows = await pool.fetch(query, *params)

    # Group by site
    sites: dict[str, dict] = {}
    for r in rows:
        sid = r["site_id"]
        if sid not in sites:
            sites[sid] = {
                "siteId": sid,
                "siteName": r["site_name"],
                "lat": r["lat"],
                "lng": r["lng"],
                "organization": r["organization"],
                "parameters": {},
            }

        param_name = r["parameter"]
        classification = classify_contamination(param_name, r["value"])

        sites[sid]["parameters"][param_name] = {
            "value": r["value"],
            "unit": r["unit"],
            "time": r["time"].isoformat(),
            "detectionCondition": r["detection_condition"],
            "sampleFraction": r["sample_fraction"],
            **classification,
        }

    # Filter to exceeds-only if requested
    if exceeds_only:
        sites = {
            sid: s for sid, s in sites.items()
            if any(p.get("exceedsMCL") for p in s["parameters"].values())
        }

    # Compute summary stats
    total_exceeds = sum(
        1 for s in sites.values()
        if any(p.get("exceedsMCL") for p in s["parameters"].values())
    )

    result = {
        "count": len(sites),
        "exceedingMCL": total_exceeds,
        "bbox": {"south": south, "west": west, "north": north, "east": east},
        "wells": list(sites.values()),
    }

    await set_cached("wq-wells", cache_key, result, WQ_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, WQ_TTL))


@router.get("/api/water-quality/trends")
async def well_trends(
    site: str = Query(..., description="Monitoring site ID"),
    parameter: str | None = Query(None, description="Filter to one parameter"),
):
    """Time series of water chemistry for a specific well."""
    cache_key = f"trends-{site}-{parameter or 'all'}"
    cached, hit = await get_cached("wq-trends", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, WQ_TTL))

    pool = await get_pool()

    query = """
        SELECT parameter, value, unit, time, detection_condition, sample_fraction,
               site_name, ST_Y(geom) AS lat, ST_X(geom) AS lng
        FROM water_quality
        WHERE site_id = $1
    """
    params: list = [site]

    if parameter:
        query += " AND parameter ILIKE $2"
        params.append(f"%{parameter}%")

    query += " ORDER BY parameter, time"

    rows = await pool.fetch(query, *params)

    if not rows:
        return JSONResponse(status_code=404, content={"error": f"No data for site {site}. Run /api/water-quality/backfill first."})

    # Group by parameter
    by_param: dict[str, list] = {}
    site_name = rows[0]["site_name"] if rows else site
    lat = rows[0]["lat"] if rows else None
    lng = rows[0]["lng"] if rows else None

    for r in rows:
        p = r["parameter"]
        if p not in by_param:
            by_param[p] = []
        by_param[p].append({
            "time": r["time"].isoformat(),
            "value": r["value"],
            "unit": r["unit"],
            "detectionCondition": r["detection_condition"],
        })

    # Add MCL reference lines
    param_summaries = {}
    for p, measurements in by_param.items():
        values = [m["value"] for m in measurements if m["value"] is not None]
        mcl = MCL_LOOKUP.get(p)
        param_summaries[p] = {
            "count": len(measurements),
            "mcl": mcl,
            "latestValue": values[-1] if values else None,
            "minValue": min(values) if values else None,
            "maxValue": max(values) if values else None,
            "exceedanceCount": sum(1 for v in values if mcl and v > mcl) if mcl else None,
            "measurements": measurements,
        }

    result = {
        "siteId": site,
        "siteName": site_name,
        "lat": lat,
        "lng": lng,
        "parameters": param_summaries,
    }

    await set_cached("wq-trends", cache_key, result, WQ_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, WQ_TTL))


@router.get("/api/water-quality/oil-well-proximity")
async def oil_well_proximity(
    radius_km: float = Query(3.0, ge=0.5, le=50, description="Search radius around contaminated wells"),
    parameter: str = Query("Arsenic", description="Contaminant to analyze"),
    min_value: float | None = Query(None, description="Minimum contaminant value (uses MCL if omitted)"),
):
    """Cross-reference contaminated groundwater wells with CalGEM oil/gas operations.

    Finds water quality wells exceeding the MCL for a given parameter,
    then searches for oil/gas wells within the specified radius.
    """
    cache_key = {"r": radius_km, "param": parameter, "min": min_value}
    cached, hit = await get_cached("wq-oilgas", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, WQ_TTL))

    pool = await get_pool()

    # Determine threshold
    threshold = min_value
    if threshold is None:
        threshold = MCL_LOOKUP.get(parameter, 0)
        if threshold == 0:
            return JSONResponse(status_code=400, content={"error": f"No MCL defined for '{parameter}'. Provide min_value."})

    radius_m = radius_km * 1000

    # Find contaminated water wells and nearby oil/gas wells
    rows = await pool.fetch(
        """
        WITH contaminated AS (
            SELECT DISTINCT ON (wq.site_id)
                wq.site_id, wq.site_name, wq.value, wq.unit, wq.time, wq.geom,
                ST_Y(wq.geom) AS wq_lat, ST_X(wq.geom) AS wq_lng
            FROM water_quality wq
            WHERE wq.parameter ILIKE $1
              AND wq.value >= $2
              AND wq.geom IS NOT NULL
            ORDER BY wq.site_id, wq.time DESC
        )
        SELECT
            c.site_id AS wq_site_id,
            c.site_name AS wq_site_name,
            c.value AS contaminant_value,
            c.unit AS contaminant_unit,
            c.time AS sample_time,
            c.wq_lat, c.wq_lng,
            w.api_number,
            w.name AS well_name,
            w.well_type,
            w.status AS well_status,
            w.operator,
            ST_Y(w.geom) AS oil_lat,
            ST_X(w.geom) AS oil_lng,
            ST_Distance(c.geom::geography, w.geom::geography) / 1000 AS distance_km
        FROM contaminated c
        JOIN wells w
            ON ST_DWithin(c.geom::geography, w.geom::geography, $3)
        ORDER BY c.site_id, distance_km
        """,
        f"%{parameter}%",
        threshold,
        radius_m,
    )

    # Group by contaminated well
    sites: dict[str, dict] = {}
    for r in rows:
        sid = r["wq_site_id"]
        if sid not in sites:
            sites[sid] = {
                "siteId": sid,
                "siteName": r["wq_site_name"],
                "contaminantValue": r["contaminant_value"],
                "contaminantUnit": r["contaminant_unit"],
                "sampleTime": r["sample_time"].isoformat(),
                "lat": r["wq_lat"],
                "lng": r["wq_lng"],
                "nearbyOilGasWells": [],
            }

        sites[sid]["nearbyOilGasWells"].append({
            "apiNumber": r["api_number"],
            "name": r["well_name"],
            "wellType": r["well_type"],
            "status": r["well_status"],
            "operator": r["operator"],
            "lat": r["oil_lat"],
            "lng": r["oil_lng"],
            "distanceKm": round(r["distance_km"], 2),
        })

    total_oil_wells = sum(len(s["nearbyOilGasWells"]) for s in sites.values())

    result = {
        "parameter": parameter,
        "threshold": threshold,
        "radiusKm": radius_km,
        "contaminatedWellCount": len(sites),
        "nearbyOilGasWellCount": total_oil_wells,
        "sites": list(sites.values()),
    }

    await set_cached("wq-oilgas", cache_key, result, WQ_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, WQ_TTL))


# ── Backfill ─────────────────────────────────────────

@router.post("/api/water-quality/backfill")
async def start_backfill(
    county_fips: str = Query(KERN_COUNTY_FIPS, description="County FIPS code (e.g. US:06:029 for Kern)"),
    start_date: str = Query("01-01-2015", description="Start date (MM-DD-YYYY)"),
):
    """Fetch water quality data from WQP for Kern County wells.

    Source toggle: wqp (must be enabled via /api/admin/sources/wqp/enable)
    """
    global _backfill_task, _backfill_status

    if _backfill_task and not _backfill_task.done():
        return JSONResponse(status_code=409, content={"error": "Backfill in progress", "status": _backfill_status})

    from app.source_toggles import is_enabled
    if not await is_enabled("wqp"):
        return JSONResponse(status_code=503, content={"error": "WQP source is disabled", "details": "Enable via POST /api/admin/sources/wqp/enable"})

    _backfill_status = {"state": "running", "samplesFetched": 0, "samplesInserted": 0, "errors": [], "countyFips": county_fips, "startDate": start_date}
    _backfill_task = asyncio.create_task(_run_backfill(county_fips, start_date))
    return {"message": "Water quality backfill started", "status": _backfill_status}


@router.get("/api/water-quality/backfill/status")
async def backfill_status():
    return _backfill_status


async def _run_backfill(county_fips: str, start_date: str) -> None:
    global _backfill_status

    pool = await get_pool()

    try:
        samples = await fetch_key_contaminants(county_fips=county_fips, start_date=start_date)
        _backfill_status["samplesFetched"] = len(samples)

        inserted = await _persist_samples(pool, samples)
        _backfill_status["samplesInserted"] = inserted
        _backfill_status["state"] = "completed"
        logger.info("WQP backfill: %d/%d samples", inserted, len(samples))

    except Exception as e:
        traceback.print_exc()
        _backfill_status["state"] = "failed"
        _backfill_status["errors"].append(str(e))


# ── Helpers ──────────────────────────────────────────

async def _persist_samples(pool, samples: list[WQSample]) -> int:
    inserted = 0
    for s in samples:
        try:
            result = await pool.execute(
                """
                INSERT INTO water_quality (
                    time, site_id, site_name, geom, parameter, value, unit,
                    detection_limit, detection_condition, sample_fraction, organization
                ) VALUES (
                    $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326),
                    $6, $7, $8, $9, $10, $11, $12
                )
                ON CONFLICT (time, site_id, parameter, sample_fraction) DO NOTHING
                """,
                s.time, s.site_id, s.site_name, s.longitude, s.latitude,
                s.parameter, s.value, s.unit,
                s.detection_limit, s.detection_condition, s.sample_fraction, s.organization,
            )
            if "INSERT" in result:
                inserted += 1
        except Exception as e:
            logger.error("WQ persist error for %s/%s: %s", s.site_id, s.parameter, e)
    return inserted
