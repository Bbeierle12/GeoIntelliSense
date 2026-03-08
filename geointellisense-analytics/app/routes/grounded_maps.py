import traceback

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.claude import get_client, SJV_SYSTEM, get_system_with_live_context

router = APIRouter()


class Location(BaseModel):
    latitude: float
    longitude: float


class GroundedMapsRequest(BaseModel):
    prompt: str
    location: Location


@router.post("/api/grounded-maps")
async def grounded_maps(req: GroundedMapsRequest):
    try:
        location_context = (
            f"The user is located at coordinates ({req.location.latitude}, {req.location.longitude}). "
            f"This is in the San Joaquin Valley region of California. "
            f"Consider nearby monitoring stations, geographic features, land use, "
            f"and proximity to pollution sources when answering."
        )

        system = await get_system_with_live_context(f"{SJV_SYSTEM}\n\n{location_context}")
        resp = get_client().messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": req.prompt}],
        )

        return {"text": resp.content[0].text, "groundingChunks": []}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "error": "Failed to get map-grounded response",
                "details": str(e),
            },
        )
