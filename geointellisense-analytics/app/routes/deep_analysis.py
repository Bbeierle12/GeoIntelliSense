import traceback

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.claude import get_client, SJV_SYSTEM, get_system_with_live_context, TOOLS, execute_tool
from app.middleware import check_rate_limit, check_ai_auth

router = APIRouter()


class DeepAnalysisRequest(BaseModel):
    prompt: str


@router.post("/api/deep-analysis")
async def deep_analysis(req: DeepAnalysisRequest, request: Request):
    # Auth check
    auth_err = check_ai_auth(request)
    if auth_err:
        return auth_err

    # Rate limit check (stricter — this uses Opus)
    rate_err = await check_rate_limit(request, "ai_deep")
    if rate_err:
        return rate_err

    try:
        system = await get_system_with_live_context(SJV_SYSTEM)
        client = get_client()

        resp = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=40000,
            temperature=1,  # required for extended thinking
            system=system,
            thinking={
                "type": "enabled",
                "budget_tokens": 32768,
            },
            messages=[{"role": "user", "content": req.prompt}],
            tools=TOOLS,
        )

        # Tool use loop (max 3 rounds for deep analysis)
        rounds = 0
        while resp.stop_reason == "tool_use" and rounds < 3:
            rounds += 1
            tool_results = []
            assistant_content = resp.content
            for block in resp.content:
                if block.type == "tool_use":
                    result = await execute_tool(block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })

            resp = client.messages.create(
                model="claude-opus-4-6",
                max_tokens=40000,
                temperature=1,
                system=system,
                thinking={
                    "type": "enabled",
                    "budget_tokens": 32768,
                },
                messages=[
                    {"role": "user", "content": req.prompt},
                    {"role": "assistant", "content": assistant_content},
                    {"role": "user", "content": tool_results},
                ],
                tools=TOOLS,
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
