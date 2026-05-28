import math
from datetime import date, timedelta

from fastapi import APIRouter, Query

from app.database import get_pool

router = APIRouter()

# Bakersfield reference point for distance calc
BAKERSFIELD_LAT = 35.3733
BAKERSFIELD_LNG = -119.0187


def _parse_bbox(bbox_str: str | None) -> tuple[float, float, float, float] | None:
    if not bbox_str:
        return None
    try:
        parts = [float(x) for x in bbox_str.split(",")]
        if len(parts) == 4:
            return (parts[0], parts[1], parts[2], parts[3])
    except ValueError:
        pass
    return None


@router.get("/api/earthquakes/recent")
async def recent_earthquakes(
    days: int = Query(30, ge=1, le=365),
    min_magnitude: float = Query(0.5),
    max_distance_km: float | None = Query(None, description="Max distance from reference point in km"),
    lat: float = Query(BAKERSFIELD_LAT, description="Reference point latitude"),
    lon: float = Query(BAKERSFIELD_LNG, description="Reference point longitude"),
    bbox: str | None = Query(None, description="Bounding box: south,west,north,east"),
):
    pool = await get_pool()

    cutoff = date.today() - timedelta(days=days)

    bbox_tuple = _parse_bbox(bbox)

    # Use viewport center as reference point if bbox provided
    if bbox_tuple and lat == BAKERSFIELD_LAT and lon == BAKERSFIELD_LNG:
        ref_lat = (bbox_tuple[0] + bbox_tuple[2]) / 2
        ref_lng = (bbox_tuple[1] + bbox_tuple[3]) / 2
    else:
        ref_lat = lat
        ref_lng = lon

    # Build query with optional bbox filter
    if bbox_tuple:
        south, west, north, east = bbox_tuple
        rows = await pool.fetch(
            """
            SELECT
                event_id,
                time,
                magnitude,
                depth_km,
                ST_Y(geom) AS lat,
                ST_X(geom) AS lng,
                place,
                felt,
                tsunami,
                alert,
                status,
                source,
                ST_Distance(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
                ) / 1000.0 AS distance_km
            FROM earthquake_events
            WHERE time >= $1
              AND magnitude >= $2
              AND ST_Y(geom) BETWEEN $5 AND $6
              AND ST_X(geom) BETWEEN $7 AND $8
            ORDER BY time DESC
            """,
            cutoff,
            min_magnitude,
            ref_lng,
            ref_lat,
            south,
            north,
            west,
            east,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT
                event_id,
                time,
                magnitude,
                depth_km,
                ST_Y(geom) AS lat,
                ST_X(geom) AS lng,
                place,
                felt,
                tsunami,
                alert,
                status,
                source,
                ST_Distance(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
                ) / 1000.0 AS distance_km
            FROM earthquake_events
            WHERE time >= $1
              AND magnitude >= $2
            ORDER BY time DESC
            """,
            cutoff,
            min_magnitude,
            ref_lng,
            ref_lat,
        )

    events = []
    for r in rows:
        dist = r["distance_km"]
        if max_distance_km is not None and dist > max_distance_km:
            continue

        events.append({
            "eventId": r["event_id"],
            "time": r["time"].isoformat(),
            "magnitude": r["magnitude"],
            "depthKm": r["depth_km"],
            "lat": r["lat"],
            "lng": r["lng"],
            "place": r["place"],
            "felt": r["felt"],
            "tsunami": r["tsunami"],
            "alert": r["alert"],
            "status": r["status"],
            "source": r["source"],
            "distanceKm": round(dist, 1),
        })

    return {
        "count": len(events),
        "days": days,
        "minMagnitude": min_magnitude,
        "referencePoint": {"lat": ref_lat, "lon": ref_lng},
        "events": events,
    }
