import traceback

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.claude import get_client, SJV_SYSTEM, get_system_with_live_context
from app.middleware import check_rate_limit, check_ai_auth

router = APIRouter()


class LowLatencyRequest(BaseModel):
    prompt: str


@router.post("/api/low-latency")
async def low_latency(req: LowLatencyRequest, request: Request):
    # Auth check
    auth_err = check_ai_auth(request)
    if auth_err:
        return auth_err

    # Rate limit check
    rate_err = await check_rate_limit(request, "ai_low_latency")
    if rate_err:
        return rate_err

    try:
        system = await get_system_with_live_context(SJV_SYSTEM)
        resp = get_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": req.prompt}],
        )
        return {"text": resp.content[0].text}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "error": "Failed to get low-latency response",
                "details": str(e),
            },
        )
