"""
Yard feature management routes.

CRUD for polygon features drawn on the map (garden beds, lawn areas,
hardscape, etc.) stored in PostGIS with JSONB vertices.
"""

import json
import logging
import traceback

from fastapi import APIRouter, Path, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.database import get_pool

router = APIRouter()
logger = logging.getLogger(__name__)


class VertexPoint(BaseModel):
    lat: float
    lng: float


class YardFeatureCreate(BaseModel):
    name: str
    vertices: list[VertexPoint] = Field(..., min_length=3)
    area_sqft: float
    area_sqm: float
    perimeter_ft: float | None = None
    measurement_type: str = Field("map", pattern=r"^(map|manual|ar)$")
    metadata: dict = Field(default_factory=dict)


@router.post("/api/yard/features")
async def create_yard_feature(body: YardFeatureCreate):
    """Create a yard feature polygon. Computes PostGIS geometry from vertices."""
    pool = await get_pool()

    try:
        # Build WKT ring from vertices (close the ring)
        coords = body.vertices + [body.vertices[0]]
        ring = ", ".join(f"{v.lng} {v.lat}" for v in coords)
        wkt = f"POLYGON(({ring}))"

        row = await pool.fetchrow(
            """
            INSERT INTO yard_features (name, geom, vertices, area_sqft, area_sqm,
                                       perimeter_ft, measurement_type, metadata)
            VALUES ($1, ST_GeomFromText($2, 4326), $3::jsonb, $4, $5, $6, $7, $8::jsonb)
            RETURNING id, name, area_sqft, area_sqm, perimeter_ft,
                      measurement_type, metadata, vertices, created_at, updated_at,
                      ST_AsGeoJSON(geom) AS geojson
            """,
            body.name,
            wkt,
            json.dumps([v.model_dump() for v in body.vertices]),
            body.area_sqft,
            body.area_sqm,
            body.perimeter_ft,
            body.measurement_type,
            json.dumps(body.metadata),
        )

        return JSONResponse(status_code=201, content=_format_feature(row))

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": "Failed to create yard feature", "details": str(e)})


@router.get("/api/yard/features")
async def list_yard_features(
    bbox: str | None = Query(None, description="south_lat,west_lng,north_lat,east_lng"),
):
    """List all yard features, optionally filtered by bounding box."""
    pool = await get_pool()

    try:
        if bbox:
            parts = [float(x.strip()) for x in bbox.split(",")]
            if len(parts) != 4:
                return JSONResponse(status_code=400, content={"error": "bbox must be south_lat,west_lng,north_lat,east_lng"})
            south, west, north, east = parts
            rows = await pool.fetch(
                """
                SELECT id, name, vertices, area_sqft, area_sqm, perimeter_ft,
                       measurement_type, metadata, created_at, updated_at,
                       ST_AsGeoJSON(geom) AS geojson
                FROM yard_features
                WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                ORDER BY created_at DESC
                """,
                west, south, east, north,
            )
        else:
            rows = await pool.fetch(
                """
                SELECT id, name, vertices, area_sqft, area_sqm, perimeter_ft,
                       measurement_type, metadata, created_at, updated_at,
                       ST_AsGeoJSON(geom) AS geojson
                FROM yard_features
                ORDER BY created_at DESC
                """
            )

        return {"features": [_format_feature(r) for r in rows], "count": len(rows)}

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": "Failed to list yard features", "details": str(e)})


@router.get("/api/yard/features/{feature_id}")
async def get_yard_feature(feature_id: str = Path(..., description="Yard feature UUID")):
    """Get a single yard feature by ID."""
    pool = await get_pool()

    try:
        row = await pool.fetchrow(
            """
            SELECT id, name, vertices, area_sqft, area_sqm, perimeter_ft,
                   measurement_type, metadata, created_at, updated_at,
                   ST_AsGeoJSON(geom) AS geojson
            FROM yard_features
            WHERE id = $1::uuid
            """,
            feature_id,
        )

        if not row:
            return JSONResponse(status_code=404, content={"error": f"Yard feature {feature_id} not found"})

        return _format_feature(row)

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": "Failed to get yard feature", "details": str(e)})


@router.delete("/api/yard/features/{feature_id}")
async def delete_yard_feature(feature_id: str = Path(..., description="Yard feature UUID")):
    """Delete a yard feature."""
    pool = await get_pool()

    try:
        result = await pool.execute(
            "DELETE FROM yard_features WHERE id = $1::uuid",
            feature_id,
        )

        if "DELETE 0" in result:
            return JSONResponse(status_code=404, content={"error": f"Yard feature {feature_id} not found"})

        return {"message": f"Yard feature {feature_id} deleted"}

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": "Failed to delete yard feature", "details": str(e)})


# -- Helpers --

def _format_feature(row) -> dict:
    """Format a yard_features DB row into API response."""
    r = dict(row)
    result = {
        "id": str(r["id"]),
        "name": r["name"],
        "areaSqft": r["area_sqft"],
        "areaSqm": r["area_sqm"],
        "perimeterFt": r["perimeter_ft"],
        "measurementType": r["measurement_type"],
        "metadata": json.loads(r["metadata"]) if isinstance(r["metadata"], str) else r["metadata"],
        "vertices": json.loads(r["vertices"]) if isinstance(r["vertices"], str) else r["vertices"],
        "createdAt": str(r["created_at"]),
        "updatedAt": str(r["updated_at"]),
    }
    if r.get("geojson"):
        result["geometry"] = json.loads(r["geojson"]) if isinstance(r["geojson"], str) else r["geojson"]
    return result
