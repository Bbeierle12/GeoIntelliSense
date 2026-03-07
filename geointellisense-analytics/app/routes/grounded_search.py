import traceback

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.claude import get_client, SJV_SYSTEM

router = APIRouter()

SEARCH_SYSTEM = (
    SJV_SYSTEM + "\n\n"
    "When answering, cite specific sources, studies, or data points you reference. "
    "Format citations as inline references with titles and URLs where possible. "
    "Always ground your analysis in verifiable facts about SJV environmental conditions."
)


class GroundedSearchRequest(BaseModel):
    prompt: str


@router.post("/api/grounded-search")
async def grounded_search(req: GroundedSearchRequest):
    try:
        resp = get_client().messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=SEARCH_SYSTEM,
            messages=[{"role": "user", "content": req.prompt}],
        )

        return {"text": resp.content[0].text, "groundingChunks": []}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "error": "Failed to get grounded search response",
                "details": str(e),
            },
        )
