from datetime import date

import polars as pl
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.database import get_pool

router = APIRouter()

HIST_TTL = 300  # 5 minutes


@router.get("/api/historical-aqi")
async def historical_aqi(
    location_ids: str | None = Query(None, description="Comma-separated location UUIDs"),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
):
    cache_params = {"loc": location_ids or "all", "s": str(start_date), "e": str(end_date)}

    cached, hit = await get_cached("historical-aqi", cache_params)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, HIST_TTL))

    pool = await get_pool()

    query = """
        SELECT
            sr.time,
            sr.location_id,
            l.name AS location_name,
            sr.aqi,
            sr.pm25
        FROM sensor_readings sr
        JOIN locations l ON sr.location_id = l.id
        WHERE 1=1
    """
    params: list = []
    idx = 0

    if location_ids:
        ids = [uid.strip() for uid in location_ids.split(",")]
        idx += 1
        query += f" AND sr.location_id = ANY(${idx}::uuid[])"
        params.append(ids)

    if start_date:
        idx += 1
        query += f" AND sr.time >= ${idx}"
        params.append(start_date)

    if end_date:
        idx += 1
        query += f" AND sr.time <= ${idx}"
        params.append(end_date)

    query += " ORDER BY sr.time"

    rows = await pool.fetch(query, *params)

    if not rows:
        return JSONResponse(content=[], headers=cache_headers(False, HIST_TTL))

    df = pl.DataFrame({
        "time": [r["time"] for r in rows],
        "location_id": [str(r["location_id"]) for r in rows],
        "location_name": [r["location_name"] for r in rows],
        "aqi": [r["aqi"] for r in rows],
        "pm25": [r["pm25"] for r in rows],
    })

    aggregated = (
        df.with_columns(
            pl.col("time").dt.strftime("%b").alias("month"),
            pl.col("time").dt.year().alias("year"),
        )
        .group_by(["location_id", "location_name", "month", "year"])
        .agg(
            pl.col("aqi").mean().round(0).cast(pl.Int32).alias("avgAqi"),
            pl.col("pm25").mean().round(1).alias("avgPm25"),
        )
        .sort(["location_name", "year", "month"])
    )

    records = []
    for row in aggregated.iter_rows(named=True):
        loc_id = row["location_id"]
        records.append({
            "id": f"hist_aqi_{loc_id}_{row['month']}_{row['year']}",
            "locationId": loc_id,
            "locationName": row["location_name"],
            "month": row["month"],
            "year": row["year"],
            "avgAqi": row["avgAqi"],
            "avgPm25": row["avgPm25"],
        })

    await set_cached("historical-aqi", cache_params, records, HIST_TTL)
    return JSONResponse(content=records, headers=cache_headers(False, HIST_TTL))
