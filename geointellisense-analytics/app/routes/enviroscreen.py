import asyncio
import logging
import traceback
from typing import Any

from fastapi import APIRouter, Path, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.calenviroscreen import download_and_parse, gdf_to_records, SJV_COUNTIES
from app.database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

CES_TTL = 604800  # 7 days — static dataset

# Backfill state
_backfill_task: asyncio.Task | None = None
_backfill_status: dict[str, Any] = {"state": "idle"}

# Columns to return in list queries (subset for performance)
LIST_COLS = """
    geoid, name, county, approx_location, population, zip,
    ces_score, ces_percentile,
    pollution_burden_pctl, pm25_pctl, ozone_pctl,
    pop_char_pctl, poverty_pctl, asthma_pctl,
    ST_AsGeoJSON(ST_Simplify(geom, 0.001)) AS geojson
"""

# All score columns for detail query
DETAIL_COLS = """
    geoid, name, county, approx_location, population, zip,
    ces_score, ces_percentile,
    pollution_burden, pollution_burden_score, pollution_burden_pctl,
    ozone, ozone_pctl, pm25, pm25_pctl,
    diesel_pm, diesel_pm_pctl, pesticides, pesticides_pctl,
    toxic_releases, toxic_releases_pctl, traffic, traffic_pctl,
    drinking_water, drinking_water_pctl, lead, lead_pctl,
    cleanup_sites, cleanup_sites_pctl,
    groundwater_threats, groundwater_threats_pctl,
    haz_waste, haz_waste_pctl, solid_waste, solid_waste_pctl,
    pop_characteristics, pop_char_score, pop_char_pctl,
    asthma, asthma_pctl, low_birth_weight, low_birth_weight_pctl,
    cardiovascular, cardiovascular_pctl,
    education, education_pctl, linguistic_isolation, linguistic_isolation_pctl,
    poverty, poverty_pctl, unemployment, unemployment_pctl,
    housing_burden, housing_burden_pctl,
    ST_AsGeoJSON(geom) AS geojson
"""


@router.get("/api/enviroscreen/tracts")
async def tracts_bbox(
    bbox: str = Query(..., description="south_lat,west_lng,north_lat,east_lng"),
    min_ces: float | None = Query(None, description="Minimum CES percentile"),
    limit: int = Query(500, ge=1, le=5000),
):
    parts = [float(x.strip()) for x in bbox.split(",")]
    if len(parts) != 4:
        return JSONResponse(status_code=400, content={"error": "bbox must be south_lat,west_lng,north_lat,east_lng"})

    south, west, north, east = parts
    cache_key = {"bbox": bbox, "min": min_ces, "limit": limit}
    cached, hit = await get_cached("ces-tracts", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, CES_TTL))

    pool = await get_pool()

    query = f"""
        SELECT {LIST_COLS}
        FROM census_tracts
        WHERE ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    """
    params: list = [west, south, east, north]
    idx = 4

    if min_ces is not None:
        idx += 1
        query += f" AND ces_percentile >= ${idx}"
        params.append(min_ces)

    query += f" ORDER BY ces_percentile DESC NULLS LAST LIMIT ${idx + 1}"
    params.append(limit)

    rows = await pool.fetch(query, *params)

    result = {
        "count": len(rows),
        "tracts": [_row_to_summary(r) for r in rows],
    }

    await set_cached("ces-tracts", cache_key, result, CES_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, CES_TTL))


@router.get("/api/enviroscreen/tract/{tract_id}")
async def tract_detail(tract_id: str = Path(..., description="Census tract GEOID")):
    cache_key = f"detail-{tract_id}"
    cached, hit = await get_cached("ces-detail", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, CES_TTL))

    pool = await get_pool()

    row = await pool.fetchrow(
        f"SELECT {DETAIL_COLS} FROM census_tracts WHERE geoid = $1",
        tract_id,
    )

    if not row:
        return JSONResponse(status_code=404, content={"error": f"Tract {tract_id} not found"})

    result = _row_to_detail(row)
    await set_cached("ces-detail", cache_key, result, CES_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, CES_TTL))


# ── Backfill ─────────────────────────────────────────

@router.post("/api/enviroscreen/backfill")
async def start_backfill(
    counties: str | None = Query(None, description="Comma-separated county names (default: SJV counties). Use 'all' for all California."),
):
    global _backfill_task, _backfill_status

    if _backfill_task and not _backfill_task.done():
        return JSONResponse(status_code=409, content={"error": "Backfill in progress", "status": _backfill_status})

    if counties == "all":
        county_set = None  # download_and_parse(None) returns all CA tracts
    elif counties:
        county_set = {c.strip() for c in counties.split(",")}
    else:
        county_set = SJV_COUNTIES

    _backfill_status = {"state": "running", "tractsLoaded": 0, "tractsInserted": 0, "errors": [], "counties": counties or "SJV"}
    _backfill_task = asyncio.create_task(_run_backfill(county_set))
    return {"message": f"CalEnviroScreen backfill started for {counties or 'SJV'}", "status": _backfill_status}


@router.get("/api/enviroscreen/backfill/status")
async def backfill_status():
    return _backfill_status


async def _run_backfill(county_set: set[str] | None = None) -> None:
    global _backfill_status

    pool = await get_pool()

    try:
        gdf = await download_and_parse(county_set)
        records = gdf_to_records(gdf)
        _backfill_status["tractsLoaded"] = len(records)

        inserted = 0
        for rec in records:
            geoid = rec.pop("geoid", None)
            geom_wkt = rec.pop("geom_wkt", None)
            if not geoid or not geom_wkt:
                continue

            try:
                await pool.execute(
                    """
                    INSERT INTO census_tracts (
                        geoid, name, geom, county, approx_location, population, zip,
                        ces_score, ces_percentile,
                        pollution_burden, pollution_burden_score, pollution_burden_pctl,
                        ozone, ozone_pctl, pm25, pm25_pctl,
                        diesel_pm, diesel_pm_pctl, pesticides, pesticides_pctl,
                        toxic_releases, toxic_releases_pctl, traffic, traffic_pctl,
                        drinking_water, drinking_water_pctl, lead, lead_pctl,
                        cleanup_sites, cleanup_sites_pctl,
                        groundwater_threats, groundwater_threats_pctl,
                        haz_waste, haz_waste_pctl, solid_waste, solid_waste_pctl,
                        pop_characteristics, pop_char_score, pop_char_pctl,
                        asthma, asthma_pctl, low_birth_weight, low_birth_weight_pctl,
                        cardiovascular, cardiovascular_pctl,
                        education, education_pctl,
                        linguistic_isolation, linguistic_isolation_pctl,
                        poverty, poverty_pctl, unemployment, unemployment_pctl,
                        housing_burden, housing_burden_pctl,
                        source
                    ) VALUES (
                        $1, $2, ST_GeomFromText($3, 4326), $4, $5, $6, $7,
                        $8, $9, $10, $11, $12, $13, $14, $15, $16,
                        $17, $18, $19, $20, $21, $22, $23, $24,
                        $25, $26, $27, $28, $29, $30, $31, $32,
                        $33, $34, $35, $36, $37, $38, $39,
                        $40, $41, $42, $43, $44, $45, $46, $47,
                        $48, $49, $50, $51, $52, $53, $54, $55, 'ces40'
                    )
                    ON CONFLICT (geoid) DO UPDATE SET
                        ces_score = EXCLUDED.ces_score,
                        ces_percentile = EXCLUDED.ces_percentile,
                        pollution_burden_pctl = EXCLUDED.pollution_burden_pctl,
                        pm25_pctl = EXCLUDED.pm25_pctl,
                        pop_char_pctl = EXCLUDED.pop_char_pctl,
                        poverty_pctl = EXCLUDED.poverty_pctl,
                        geom = EXCLUDED.geom
                    """,
                    geoid,
                    rec.get("approx_location", ""),
                    geom_wkt,
                    rec.get("county"),
                    rec.get("approx_location"),
                    int(rec["population"]) if rec.get("population") else None,
                    str(int(rec["zip"])) if rec.get("zip") else None,
                    rec.get("ces_score"),
                    rec.get("ces_percentile"),
                    rec.get("pollution_burden"),
                    rec.get("pollution_burden_score"),
                    rec.get("pollution_burden_pctl"),
                    rec.get("ozone"),
                    rec.get("ozone_pctl"),
                    rec.get("pm25"),
                    rec.get("pm25_pctl"),
                    rec.get("diesel_pm"),
                    rec.get("diesel_pm_pctl"),
                    rec.get("pesticides"),
                    rec.get("pesticides_pctl"),
                    rec.get("toxic_releases"),
                    rec.get("toxic_releases_pctl"),
                    rec.get("traffic"),
                    rec.get("traffic_pctl"),
                    rec.get("drinking_water"),
                    rec.get("drinking_water_pctl"),
                    rec.get("lead"),
                    rec.get("lead_pctl"),
                    rec.get("cleanup_sites"),
                    rec.get("cleanup_sites_pctl"),
                    rec.get("groundwater_threats"),
                    rec.get("groundwater_threats_pctl"),
                    rec.get("haz_waste"),
                    rec.get("haz_waste_pctl"),
                    rec.get("solid_waste"),
                    rec.get("solid_waste_pctl"),
                    rec.get("pop_characteristics"),
                    rec.get("pop_char_score"),
                    rec.get("pop_char_pctl"),
                    rec.get("asthma"),
                    rec.get("asthma_pctl"),
                    rec.get("low_birth_weight"),
                    rec.get("low_birth_weight_pctl"),
                    rec.get("cardiovascular"),
                    rec.get("cardiovascular_pctl"),
                    rec.get("education"),
                    rec.get("education_pctl"),
                    rec.get("linguistic_isolation"),
                    rec.get("linguistic_isolation_pctl"),
                    rec.get("poverty"),
                    rec.get("poverty_pctl"),
                    rec.get("unemployment"),
                    rec.get("unemployment_pctl"),
                    rec.get("housing_burden"),
                    rec.get("housing_burden_pctl"),
                )
                inserted += 1
            except Exception as e:
                _backfill_status["errors"].append(f"{geoid}: {e}")
                if len(_backfill_status["errors"]) > 20:
                    _backfill_status["errors"] = _backfill_status["errors"][-20:]

        _backfill_status["tractsInserted"] = inserted
        _backfill_status["state"] = "completed"
        logger.info("CalEnviroScreen backfill: %d/%d tracts", inserted, len(records))

    except Exception as e:
        traceback.print_exc()
        _backfill_status["state"] = "failed"
        _backfill_status["errors"].append(str(e))


# ── Formatters ───────────────────────────────────────

def _row_to_summary(r) -> dict:
    import json as _json
    return {
        "geoid": r["geoid"],
        "name": r["name"],
        "county": r["county"],
        "location": r["approx_location"],
        "population": r["population"],
        "cesScore": r["ces_score"],
        "cesPercentile": r["ces_percentile"],
        "pollutionBurdenPctl": r["pollution_burden_pctl"],
        "pm25Pctl": r["pm25_pctl"],
        "ozonePctl": r["ozone_pctl"],
        "popCharPctl": r["pop_char_pctl"],
        "povertyPctl": r["poverty_pctl"],
        "asthmaPctl": r["asthma_pctl"],
        "geometry": _json.loads(r["geojson"]) if r["geojson"] else None,
    }


def _row_to_detail(r) -> dict:
    import json as _json
    return {
        "geoid": r["geoid"],
        "name": r["name"],
        "county": r["county"],
        "location": r["approx_location"],
        "population": r["population"],
        "cesScore": r["ces_score"],
        "cesPercentile": r["ces_percentile"],
        "pollutionBurden": {
            "composite": r["pollution_burden"],
            "score": r["pollution_burden_score"],
            "percentile": r["pollution_burden_pctl"],
            "components": {
                "ozone": {"value": r["ozone"], "percentile": r["ozone_pctl"]},
                "pm25": {"value": r["pm25"], "percentile": r["pm25_pctl"]},
                "dieselPM": {"value": r["diesel_pm"], "percentile": r["diesel_pm_pctl"]},
                "pesticides": {"value": r["pesticides"], "percentile": r["pesticides_pctl"]},
                "toxicReleases": {"value": r["toxic_releases"], "percentile": r["toxic_releases_pctl"]},
                "traffic": {"value": r["traffic"], "percentile": r["traffic_pctl"]},
                "drinkingWater": {"value": r["drinking_water"], "percentile": r["drinking_water_pctl"]},
                "lead": {"value": r["lead"], "percentile": r["lead_pctl"]},
                "cleanupSites": {"value": r["cleanup_sites"], "percentile": r["cleanup_sites_pctl"]},
                "groundwaterThreats": {"value": r["groundwater_threats"], "percentile": r["groundwater_threats_pctl"]},
                "hazWaste": {"value": r["haz_waste"], "percentile": r["haz_waste_pctl"]},
                "solidWaste": {"value": r["solid_waste"], "percentile": r["solid_waste_pctl"]},
            },
        },
        "populationCharacteristics": {
            "composite": r["pop_characteristics"],
            "score": r["pop_char_score"],
            "percentile": r["pop_char_pctl"],
            "components": {
                "asthma": {"value": r["asthma"], "percentile": r["asthma_pctl"]},
                "lowBirthWeight": {"value": r["low_birth_weight"], "percentile": r["low_birth_weight_pctl"]},
                "cardiovascular": {"value": r["cardiovascular"], "percentile": r["cardiovascular_pctl"]},
                "education": {"value": r["education"], "percentile": r["education_pctl"]},
                "linguisticIsolation": {"value": r["linguistic_isolation"], "percentile": r["linguistic_isolation_pctl"]},
                "poverty": {"value": r["poverty"], "percentile": r["poverty_pctl"]},
                "unemployment": {"value": r["unemployment"], "percentile": r["unemployment_pctl"]},
                "housingBurden": {"value": r["housing_burden"], "percentile": r["housing_burden_pctl"]},
            },
        },
        "geometry": _json.loads(r["geojson"]) if r["geojson"] else None,
    }
