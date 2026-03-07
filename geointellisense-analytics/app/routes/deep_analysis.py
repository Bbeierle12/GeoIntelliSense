import traceback

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.claude import get_client, SJV_SYSTEM

router = APIRouter()


class DeepAnalysisRequest(BaseModel):
    prompt: str


@router.post("/api/deep-analysis")
async def deep_analysis(req: DeepAnalysisRequest):
    try:
        resp = get_client().messages.create(
            model="claude-opus-4-6",
            max_tokens=40000,
            temperature=1,  # required for extended thinking
            system=SJV_SYSTEM,
            thinking={
                "type": "enabled",
                "budget_tokens": 32768,
            },
            messages=[{"role": "user", "content": req.prompt}],
        )

        # Extract the text block (skip thinking blocks)
        text = ""
        for block in resp.content:
            if block.type == "text":
                text = block.text
                break

        return {"text": text}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "error": "Failed to get deep analysis response",
                "details": str(e),
            },
        )
