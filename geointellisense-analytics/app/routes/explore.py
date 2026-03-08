"""
Data exploration endpoint — returns time-aligned multi-source data
for the frontend correlation and overlay analysis view.
"""

import json
import logging
import math
import traceback
from datetime import date, timedelta

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response

from app.cache import get_cached, set_cached, cache_headers
from app.database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)

EXPLORE_TTL = 300  # 5 min

# Available data sources and their DB queries
SOURCES_META = {
    "aqi": {"label": "Air Quality (AQI)", "unit": "AQI", "color": "#ef4444"},
    "pm25": {"label": "PM2.5", "unit": "ug/m3", "color": "#f97316"},
    "temperature": {"label": "Temperature", "unit": "F", "color": "#eab308"},
    "humidity": {"label": "Humidity", "unit": "%", "color": "#3b82f6"},
    "wind_speed": {"label": "Wind Speed", "unit": "mph", "color": "#06b6d4"},
    "fires": {"label": "Fire Detections", "unit": "count", "color": "#dc2626"},
    "fire_frp": {"label": "Fire Intensity (FRP)", "unit": "MW", "color": "#b91c1c"},
    "earthquakes": {"label": "Earthquakes", "unit": "count", "color": "#8b5cf6"},
    "inversion": {"label": "Inversion Strength", "unit": "0-3", "color": "#a855f7"},
}


@router.get("/api/analysis/explore")
async def explore_data(
    sources: str = Query("aqi,temperature,fires", description="Comma-separated source keys"),
    days: int = Query(30, ge=1, le=365),
    bucket: str = Query("1 day", description="Time bucket: 1 hour, 6 hours, 1 day"),
):
    """Return time-aligned multi-source data for overlay charts and correlation."""
    source_list = [s.strip() for s in sources.split(",") if s.strip() in SOURCES_META]
    if not source_list:
        return JSONResponse(status_code=400, content={"error": "No valid sources", "available": list(SOURCES_META.keys())})

    cache_key = {"src": sources, "days": days, "bucket": bucket}
    cached, hit = await get_cached("explore", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, EXPLORE_TTL))

    pool = await get_pool()
    start_date = date.today() - timedelta(days=days)

    # Build time-aligned data — each source is a separate query, merged on bucket
    series: dict[str, dict] = {}  # bucket_key -> {time, source1, source2, ...}

    for src in source_list:
        try:
            rows = await _query_source(pool, src, start_date, bucket)
            for r in rows:
                bkey = r["bucket"].isoformat()
                if bkey not in series:
                    series[bkey] = {"time": bkey}
                series[bkey][src] = r["value"]
        except Exception as e:
            logger.warning("Explore query failed for %s: %s", src, e)

    # Sort by time
    data_points = sorted(series.values(), key=lambda d: d["time"])

    # Compute correlation matrix
    corr_matrix = _compute_correlations(data_points, source_list)

    # Source metadata for the frontend
    meta = {k: SOURCES_META[k] for k in source_list}

    result = {
        "sources": meta,
        "days": days,
        "bucket": bucket,
        "pointCount": len(data_points),
        "data": data_points,
        "correlations": corr_matrix,
    }

    await set_cached("explore", cache_key, result, EXPLORE_TTL)
    return JSONResponse(content=result, headers=cache_headers(False, EXPLORE_TTL))


@router.get("/api/analysis/explore/csv")
async def explore_csv(
    sources: str = Query("aqi,temperature,fires"),
    days: int = Query(30, ge=1, le=365),
    bucket: str = Query("1 day"),
):
    """Export exploration data as CSV."""
    source_list = [s.strip() for s in sources.split(",") if s.strip() in SOURCES_META]
    if not source_list:
        return JSONResponse(status_code=400, content={"error": "No valid sources"})

    pool = await get_pool()
    start_date = date.today() - timedelta(days=days)

    series: dict[str, dict] = {}
    for src in source_list:
        try:
            rows = await _query_source(pool, src, start_date, bucket)
            for r in rows:
                bkey = r["bucket"].isoformat()
                if bkey not in series:
                    series[bkey] = {"time": bkey}
                series[bkey][src] = r["value"]
        except Exception:
            pass

    data_points = sorted(series.values(), key=lambda d: d["time"])

    # Build CSV
    headers = ["time"] + source_list
    lines = [",".join(headers)]
    for dp in data_points:
        row = [dp.get("time", "")]
        for src in source_list:
            val = dp.get(src)
            row.append(str(round(val, 2)) if val is not None else "")
        lines.append(",".join(row))

    csv_content = "\n".join(lines)
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=geointellisense_export_{days}d.csv"},
    )


@router.get("/api/analysis/explore/sources")
async def list_sources():
    """List available data sources for exploration."""
    return {"sources": SOURCES_META}


# ── Query builders ───────────────────────────────────

async def _query_source(pool, source: str, start_date: date, bucket: str) -> list:
    """Query a specific data source, returning [{bucket, value}]."""

    if source in ("aqi", "pm25", "temperature", "humidity", "wind_speed"):
        col = source if source != "aqi" else "aqi"
        return await pool.fetch(
            f"""
            SELECT time_bucket($1::interval, time) AS bucket,
                   AVG({col}) AS value
            FROM sensor_readings
            WHERE time >= $2 AND {col} IS NOT NULL
            GROUP BY bucket ORDER BY bucket
            """,
            bucket, start_date,
        )

    if source == "fires":
        return await pool.fetch(
            """
            SELECT time_bucket($1::interval, time) AS bucket,
                   COUNT(*)::float AS value
            FROM fire_detections
            WHERE time >= $2
              AND ST_DWithin(geom::geography,
                  ST_SetSRID(ST_MakePoint(-119.0187, 35.3733), 4326)::geography, 200000)
            GROUP BY bucket ORDER BY bucket
            """,
            bucket, start_date,
        )

    if source == "fire_frp":
        return await pool.fetch(
            """
            SELECT time_bucket($1::interval, time) AS bucket,
                   COALESCE(SUM(frp), 0) AS value
            FROM fire_detections
            WHERE time >= $2
              AND ST_DWithin(geom::geography,
                  ST_SetSRID(ST_MakePoint(-119.0187, 35.3733), 4326)::geography, 200000)
            GROUP BY bucket ORDER BY bucket
            """,
            bucket, start_date,
        )

    if source == "earthquakes":
        return await pool.fetch(
            """
            SELECT time_bucket($1::interval, time) AS bucket,
                   COUNT(*)::float AS value
            FROM earthquake_events
            WHERE time >= $2 AND magnitude >= 2.0
            GROUP BY bucket ORDER BY bucket
            """,
            bucket, start_date,
        )

    if source == "inversion":
        return await pool.fetch(
            """
            SELECT time_bucket($1::interval, time) AS bucket,
                   AVG(CASE
                       WHEN inversion_strength = 'strong' THEN 3
                       WHEN inversion_strength = 'moderate' THEN 2
                       WHEN inversion_strength = 'weak' THEN 1
                       ELSE 0
                   END) AS value
            FROM inversion_events
            WHERE time >= $2
            GROUP BY bucket ORDER BY bucket
            """,
            bucket, start_date,
        )

    return []


def _compute_correlations(data_points: list[dict], sources: list[str]) -> dict:
    """Compute Pearson correlation coefficients between all source pairs."""
    if len(data_points) < 3 or len(sources) < 2:
        return {}

    # Extract arrays
    arrays: dict[str, list[float]] = {s: [] for s in sources}
    for dp in data_points:
        # Only use rows where all selected sources have values
        if all(dp.get(s) is not None for s in sources):
            for s in sources:
                arrays[s].append(float(dp[s]))

    n = len(arrays[sources[0]]) if sources else 0
    if n < 3:
        return {}

    matrix: dict[str, dict[str, float]] = {}
    for a in sources:
        matrix[a] = {}
        for b in sources:
            if a == b:
                matrix[a][b] = 1.0
            else:
                r = _pearson(arrays[a], arrays[b])
                matrix[a][b] = r

    return matrix


def _pearson(x: list[float], y: list[float]) -> float:
    """Compute Pearson correlation coefficient."""
    n = len(x)
    if n < 3:
        return 0.0

    mx = sum(x) / n
    my = sum(y) / n

    num = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
    dx = math.sqrt(sum((xi - mx) ** 2 for xi in x))
    dy = math.sqrt(sum((yi - my) ** 2 for yi in y))

    if dx == 0 or dy == 0:
        return 0.0

    return round(num / (dx * dy), 4)
