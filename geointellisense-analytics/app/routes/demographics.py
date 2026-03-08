import asyncio
import logging
import traceback
from typing import Any

from fastapi import APIRouter, Path, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.clients.census import fetch_tract_demographics, fetch_sjv_demographics, TractDemographics, SJV_COUNTIES, KERN_STATE, KERN_COUNTY
from app.config import settings
from app.database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

DEMO_TTL = 2592000  # 30 days — annual dataset

# Backfill state
_backfill_task: asyncio.Task | None = None
_backfill_status: dict[str, Any] = {"state": "idle"}


@router.get("/api/demographics/tract/{tract_id}")
async def tract_demographics(tract_id: str = Path(..., description="Census tract GEOID (e.g. 06029000100)")):
    cache_key = f"tract-{tract_id}"
    cached, hit = await get_cached("demographics", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, DEMO_TTL))

    pool = await get_pool()

    # Get demographics
    demo_row = await pool.fetchrow("SELECT * FROM demographics WHERE geoid = $1", tract_id)

    if not demo_row:
        return JSONResponse(status_code=404, content={"error": f"Tract {tract_id} not found. Run /api/demographics/backfill first."})

    # Get CES data for the same tract (environmental justice join)
    ces_row = await pool.fetchrow(
        """SELECT ces_score, ces_percentile, pollution_burden_pctl, pm25_pctl, ozone_pctl,
                  pop_char_pctl, poverty_pctl, asthma_pctl, county, approx_location,
                  ST_AsGeoJSON(geom) AS geojson
           FROM census_tracts WHERE geoid = $1""",
        tract_id,
    )

    result = _format_tract(demo_row, ces_row)
    await set_cached("demographics", cache_key, result, DEMO_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, DEMO_TTL))


@router.get("/api/demographics/summary")
async def demographics_summary(
    state: str = Query(KERN_STATE, description="State FIPS (e.g. 06 for California)"),
    county: str = Query(KERN_COUNTY, description="County FIPS (e.g. 029 for Kern)"),
):
    cache_key = f"summary-{state}-{county}"
    cached, hit = await get_cached("demographics-summary", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, DEMO_TTL))

    pool = await get_pool()

    # County-level aggregates from tract data
    agg = await pool.fetchrow(
        """
        SELECT
            COUNT(*) AS tract_count,
            SUM(total_population) AS total_population,
            ROUND(AVG(median_household_income)) AS avg_median_income,
            ROUND(AVG(poverty_rate)::numeric, 1) AS avg_poverty_rate,
            SUM(poverty_count) AS total_poverty,
            SUM(hispanic_latino) AS total_hispanic,
            SUM(white_non_hispanic) AS total_white_nh,
            SUM(black_alone) AS total_black,
            SUM(asian_alone) AS total_asian,
            SUM(aian_alone) AS total_aian,
            SUM(limited_english_hh) AS total_limited_english_hh,
            SUM(total_households) AS total_households,
            ROUND(AVG(median_age)::numeric, 1) AS avg_median_age,
            SUM(under_18) AS total_under_18,
            SUM(over_65) AS total_over_65,
            SUM(less_than_hs) AS total_less_than_hs,
            SUM(bachelors_plus) AS total_bachelors_plus,
            SUM(pop_25_plus) AS total_pop_25_plus,
            ROUND(AVG(median_rent)) AS avg_median_rent,
            ROUND(AVG(median_home_value)) AS avg_median_home_value,
            MAX(acs_year) AS acs_year
        FROM demographics
        WHERE geoid LIKE $1
        """,
        f"{state}{county}%",
    )

    if not agg or agg["tract_count"] == 0:
        return JSONResponse(status_code=404, content={"error": f"No demographics for county {county}. Run /api/demographics/backfill first."})

    county_name = SJV_COUNTIES.get(county, county)

    total_pop = agg["total_population"] or 0
    total_hh = agg["total_households"] or 0
    total_25 = agg["total_pop_25_plus"] or 0

    result = {
        "county": county,
        "countyName": county_name,
        "acsYear": agg["acs_year"],
        "tractCount": agg["tract_count"],
        "totalPopulation": total_pop,
        "avgMedianHouseholdIncome": int(agg["avg_median_income"]) if agg["avg_median_income"] else None,
        "avgPovertyRate": float(agg["avg_poverty_rate"]) if agg["avg_poverty_rate"] else None,
        "totalPoverty": agg["total_poverty"],
        "race": {
            "hispanicLatino": agg["total_hispanic"],
            "whiteNonHispanic": agg["total_white_nh"],
            "black": agg["total_black"],
            "asian": agg["total_asian"],
            "aian": agg["total_aian"],
            "hispanicPct": round(agg["total_hispanic"] / total_pop * 100, 1) if total_pop and agg["total_hispanic"] else None,
            "whiteNonHispanicPct": round(agg["total_white_nh"] / total_pop * 100, 1) if total_pop and agg["total_white_nh"] else None,
        },
        "linguisticIsolation": {
            "limitedEnglishHouseholds": agg["total_limited_english_hh"],
            "totalHouseholds": total_hh,
            "pct": round(agg["total_limited_english_hh"] / total_hh * 100, 1) if total_hh and agg["total_limited_english_hh"] else None,
        },
        "education": {
            "lessThanHSPct": round(agg["total_less_than_hs"] / total_25 * 100, 1) if total_25 and agg["total_less_than_hs"] else None,
            "bachelorsPlusPct": round(agg["total_bachelors_plus"] / total_25 * 100, 1) if total_25 and agg["total_bachelors_plus"] else None,
        },
        "age": {
            "avgMedianAge": float(agg["avg_median_age"]) if agg["avg_median_age"] else None,
            "totalUnder18": agg["total_under_18"],
            "totalOver65": agg["total_over_65"],
        },
        "housing": {
            "avgMedianRent": int(agg["avg_median_rent"]) if agg["avg_median_rent"] else None,
            "avgMedianHomeValue": int(agg["avg_median_home_value"]) if agg["avg_median_home_value"] else None,
        },
    }

    await set_cached("demographics-summary", cache_key, result, DEMO_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, DEMO_TTL))


# ── Backfill ─────────────────────────────────────────

@router.post("/api/demographics/backfill")
async def start_backfill(
    state: str = Query(KERN_STATE, description="State FIPS (e.g. 06 for California)"),
    county: str | None = Query(None, description="County FIPS. Omit for all SJV counties."),
    year: int = Query(2022, description="ACS 5-year dataset year"),
):
    global _backfill_task, _backfill_status

    if _backfill_task and not _backfill_task.done():
        return JSONResponse(status_code=409, content={"error": "Backfill in progress", "status": _backfill_status})

    _backfill_status = {"state": "running", "tractsFetched": 0, "tractsInserted": 0, "errors": [], "county": county or "all-sjv", "year": year}
    _backfill_task = asyncio.create_task(_run_backfill(state, county, year))
    return {"message": "Demographics backfill started", "status": _backfill_status}


@router.get("/api/demographics/backfill/status")
async def backfill_status():
    return _backfill_status


async def _run_backfill(state: str, county: str | None, year: int) -> None:
    global _backfill_status

    pool = await get_pool()
    api_key = getattr(settings, "census_api_key", "") or None

    try:
        if county:
            tracts = await fetch_tract_demographics(api_key, state, county, year)
        else:
            tracts = await fetch_sjv_demographics(api_key, year)

        _backfill_status["tractsFetched"] = len(tracts)

        inserted = await _persist_demographics(pool, tracts)
        _backfill_status["tractsInserted"] = inserted
        _backfill_status["state"] = "completed"
        logger.info("Demographics backfill: %d/%d tracts", inserted, len(tracts))

    except Exception as e:
        traceback.print_exc()
        _backfill_status["state"] = "failed"
        _backfill_status["errors"].append(str(e))


# ── Helpers ──────────────────────────────────────────

def _format_tract(demo_row, ces_row) -> dict:
    d = dict(demo_row)

    result: dict[str, Any] = {
        "geoid": d["geoid"],
        "acsYear": d["acs_year"],
        "totalPopulation": d["total_population"],
        "medianHouseholdIncome": d["median_household_income"],
        "perCapitaIncome": d["per_capita_income"],
        "povertyRate": d["poverty_rate"],
        "povertyCount": d["poverty_count"],
        "race": {
            "whiteAlone": d["white_alone"],
            "blackAlone": d["black_alone"],
            "aianAlone": d["aian_alone"],
            "asianAlone": d["asian_alone"],
            "nhpiAlone": d["nhpi_alone"],
            "otherAlone": d["other_alone"],
            "twoOrMore": d["two_or_more"],
            "hispanicLatino": d["hispanic_latino"],
            "whiteNonHispanic": d["white_non_hispanic"],
        },
        "linguisticIsolation": {
            "limitedEnglishHouseholds": d["limited_english_hh"],
            "totalHouseholds": d["total_households"],
            "pct": d["linguistic_isolation_pct"],
        },
        "education": {
            "pop25Plus": d["pop_25_plus"],
            "lessThanHS": d["less_than_hs"],
            "hsDiploma": d["hs_diploma"],
            "someCollege": d["some_college"],
            "bachelorsPlus": d["bachelors_plus"],
            "lessThanHSPct": d["education_less_than_hs_pct"],
            "bachelorsPlusPct": d["education_bachelors_plus_pct"],
        },
        "age": {
            "medianAge": d["median_age"],
            "under18": d["under_18"],
            "over65": d["over_65"],
        },
        "housing": {
            "ownerOccupied": d["owner_occupied"],
            "renterOccupied": d["renter_occupied"],
            "medianRent": d["median_rent"],
            "medianHomeValue": d["median_home_value"],
        },
    }

    # Join CalEnviroScreen data if available
    if ces_row:
        result["enviroscreen"] = {
            "cesScore": ces_row["ces_score"],
            "cesPercentile": ces_row["ces_percentile"],
            "pollutionBurdenPctl": ces_row["pollution_burden_pctl"],
            "pm25Pctl": ces_row["pm25_pctl"],
            "ozonePctl": ces_row["ozone_pctl"],
            "popCharPctl": ces_row["pop_char_pctl"],
            "povertyPctl": ces_row["poverty_pctl"],
            "asthmaPctl": ces_row["asthma_pctl"],
            "county": ces_row["county"],
            "location": ces_row["approx_location"],
        }
        import json as _json
        if ces_row["geojson"]:
            result["geometry"] = _json.loads(ces_row["geojson"])

    return result


async def _persist_demographics(pool, tracts: list[TractDemographics]) -> int:
    inserted = 0
    for t in tracts:
        try:
            result = await pool.execute(
                """
                INSERT INTO demographics (
                    geoid, acs_year, total_population, median_household_income, per_capita_income,
                    poverty_rate, poverty_count,
                    white_alone, black_alone, aian_alone, asian_alone, nhpi_alone, other_alone, two_or_more,
                    hispanic_latino, white_non_hispanic,
                    limited_english_hh, total_households, linguistic_isolation_pct,
                    pop_25_plus, less_than_hs, hs_diploma, some_college, bachelors_plus,
                    education_less_than_hs_pct, education_bachelors_plus_pct,
                    median_age, under_18, over_65,
                    owner_occupied, renter_occupied, median_rent, median_home_value
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                    $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
                    $27, $28, $29, $30, $31, $32, $33
                )
                ON CONFLICT (geoid) DO UPDATE SET
                    acs_year = EXCLUDED.acs_year,
                    total_population = EXCLUDED.total_population,
                    median_household_income = EXCLUDED.median_household_income,
                    poverty_rate = EXCLUDED.poverty_rate,
                    poverty_count = EXCLUDED.poverty_count,
                    hispanic_latino = EXCLUDED.hispanic_latino,
                    limited_english_hh = EXCLUDED.limited_english_hh,
                    linguistic_isolation_pct = EXCLUDED.linguistic_isolation_pct,
                    less_than_hs = EXCLUDED.less_than_hs,
                    bachelors_plus = EXCLUDED.bachelors_plus,
                    fetched_at = now()
                """,
                t.geoid, t.acs_year, t.total_population, t.median_household_income, t.per_capita_income,
                t.poverty_rate, t.poverty_count,
                t.white_alone, t.black_alone, t.aian_alone, t.asian_alone, t.nhpi_alone, t.other_alone, t.two_or_more,
                t.hispanic_latino, t.white_non_hispanic,
                t.limited_english_hh, t.total_households, t.linguistic_isolation_pct,
                t.pop_25_plus, t.less_than_hs, t.hs_diploma, t.some_college, t.bachelors_plus,
                t.education_less_than_hs_pct, t.education_bachelors_plus_pct,
                t.median_age, t.under_18, t.over_65,
                t.owner_occupied, t.renter_occupied, t.median_rent, t.median_home_value,
            )
            if "INSERT" in result or "UPDATE" in result:
                inserted += 1
        except Exception as e:
            logger.error("Demographics persist error for %s: %s", t.geoid, e)
    return inserted
