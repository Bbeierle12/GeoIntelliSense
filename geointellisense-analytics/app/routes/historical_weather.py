from datetime import date

import polars as pl
from fastapi import APIRouter, Query

from app.database import get_pool

router = APIRouter()


@router.get("/api/historical-weather")
async def historical_weather(
    location_ids: str | None = Query(None, description="Comma-separated location UUIDs"),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
):
    pool = await get_pool()

    query = """
        SELECT
            sr.time,
            sr.location_id,
            l.name AS location_name,
            sr.temperature,
            sr.humidity,
            sr.wind_speed
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
        return []

    # A column that is entirely NULL is inferred as pl.Null, and .round() on a
    # Null column raises InvalidOperationError. sensor_readings is currently fed
    # only by PurpleAir, which reports humidity but neither temperature nor
    # wind, so an all-null column is the normal case here, not an edge case.
    # Pin the dtypes rather than letting polars infer them.
    df = pl.DataFrame(
        {
            "time": [r["time"] for r in rows],
            "location_id": [str(r["location_id"]) for r in rows],
            "location_name": [r["location_name"] for r in rows],
            "temperature": [r["temperature"] for r in rows],
            "humidity": [r["humidity"] for r in rows],
            "wind_speed": [r["wind_speed"] for r in rows],
        },
        schema_overrides={
            "temperature": pl.Float64,
            "humidity": pl.Float64,
            "wind_speed": pl.Float64,
        },
    )

    aggregated = (
        df.with_columns(
            pl.col("time").dt.strftime("%b").alias("month"),
            pl.col("time").dt.year().alias("year"),
        )
        .group_by(["location_id", "location_name", "month", "year"])
        .agg(
            # Stay in Float64: a group with no readings for a column averages to
            # null, which must survive to the client as null rather than being
            # cast into a plausible-looking integer.
            pl.col("temperature").mean().round(1).alias("avgTemp"),
            pl.col("humidity").mean().round(1).alias("avgHumidity"),
            pl.col("wind_speed").mean().round(1).alias("avgWindSpeed"),
            pl.len().alias("sampleCount"),
        )
        .sort(["location_name", "year", "month"])
    )

    records = []
    for row in aggregated.iter_rows(named=True):
        loc_id = row["location_id"]

        records.append({
            "id": f"hist_weather_{loc_id}_{row['month']}_{row['year']}",
            "locationId": loc_id,
            "locationName": row["location_name"],
            "month": row["month"],
            "year": row["year"],
            "avgTemp": row["avgTemp"],
            "avgHumidity": row["avgHumidity"],
            "avgWindSpeed": row["avgWindSpeed"],
            # No ingested source measures these. They used to be derived from
            # avgTemp with invented formulas, and precipitation was hard-coded
            # to 0.0 — all four then rendered as ordinary chart series and were
            # indistinguishable from measurements. Report the absence instead.
            "totalPrecipitation": None,
            "maxUV": None,
            "avgSolarRad": None,
            "avgEt0": None,
            "sampleCount": row["sampleCount"],
            "source": "sensor_readings",
        })

    return records
