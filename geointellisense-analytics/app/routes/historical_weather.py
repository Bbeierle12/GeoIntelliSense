import math
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

    df = pl.DataFrame({
        "time": [r["time"] for r in rows],
        "location_id": [str(r["location_id"]) for r in rows],
        "location_name": [r["location_name"] for r in rows],
        "temperature": [r["temperature"] for r in rows],
        "humidity": [r["humidity"] for r in rows],
        "wind_speed": [r["wind_speed"] for r in rows],
    })

    aggregated = (
        df.with_columns(
            pl.col("time").dt.strftime("%b").alias("month"),
            pl.col("time").dt.year().alias("year"),
        )
        .group_by(["location_id", "location_name", "month", "year"])
        .agg(
            pl.col("temperature").mean().round(0).cast(pl.Int32).alias("avgTemp"),
            pl.col("humidity").mean().round(0).cast(pl.Int32).alias("avgHumidity"),
            pl.col("wind_speed").mean().round(0).cast(pl.Int32).alias("avgWindSpeed"),
        )
        .sort(["location_name", "year", "month"])
    )

    records = []
    for row in aggregated.iter_rows(named=True):
        loc_id = row["location_id"]
        avg_temp = row["avgTemp"]

        # Derived fields matching HistoricalWeatherRecord shape
        max_uv = round(max(2, min(11, (avg_temp - 40) / 5)))
        avg_solar_rad = round(max(200, (avg_temp - 30) * 10))
        avg_et0 = round(max(0.1, (avg_temp - 40) / 10), 1)

        records.append({
            "id": f"hist_weather_{loc_id}_{row['month']}_{row['year']}",
            "locationId": loc_id,
            "locationName": row["location_name"],
            "month": row["month"],
            "year": row["year"],
            "avgTemp": avg_temp,
            "totalPrecipitation": 0.0,  # sensor_readings doesn't have precip; placeholder
            "avgHumidity": row["avgHumidity"],
            "avgWindSpeed": row["avgWindSpeed"],
            "maxUV": max_uv,
            "avgSolarRad": avg_solar_rad,
            "avgEt0": avg_et0,
        })

    return records
