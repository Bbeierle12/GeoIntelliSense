import math
from datetime import date, timedelta

from fastapi import APIRouter, Query

from app.database import get_pool

router = APIRouter()

# Bakersfield reference point for distance calc
BAKERSFIELD_LAT = 35.3733
BAKERSFIELD_LNG = -119.0187


@router.get("/api/earthquakes/recent")
async def recent_earthquakes(
    days: int = Query(30, ge=1, le=365),
    min_magnitude: float = Query(0.5),
    max_distance_km: float | None = Query(None, description="Max distance from reference point in km"),
    lat: float = Query(BAKERSFIELD_LAT, description="Reference point latitude"),
    lon: float = Query(BAKERSFIELD_LNG, description="Reference point longitude"),
):
    pool = await get_pool()

    cutoff = date.today() - timedelta(days=days)

    ref_lng = lon
    ref_lat = lat

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
