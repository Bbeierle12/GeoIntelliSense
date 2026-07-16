import traceback

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.claude import get_client, SJV_SYSTEM, get_system_with_live_context, TOOLS, execute_tool
from app.middleware import check_rate_limit, check_ai_auth

router = APIRouter()

SEARCH_SUFFIX = (
    "When answering, cite specific sources, studies, or data points you reference. "
    "Format citations as inline references with titles and URLs where possible. "
    "Always ground your analysis in verifiable facts about SJV environmental conditions."
)


class GroundedSearchRequest(BaseModel):
    prompt: str


@router.post("/api/grounded-search")
async def grounded_search(req: GroundedSearchRequest, request: Request):
    # Auth check
    auth_err = check_ai_auth(request)
    if auth_err:
        return auth_err

    # Rate limit check
    rate_err = await check_rate_limit(request, "ai_search")
    if rate_err:
        return rate_err

    try:
        system = await get_system_with_live_context(f"{SJV_SYSTEM}\n\n{SEARCH_SUFFIX}")
        client = get_client()

        messages = [{"role": "user", "content": req.prompt}]
        resp = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=system,
            messages=messages,
            tools=TOOLS,
        )

        # Tool use loop
        rounds = 0
        while resp.stop_reason == "tool_use" and rounds < 5:
            rounds += 1
            tool_results = []
            for block in resp.content:
                if block.type == "tool_use":
                    result = await execute_tool(block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })

            # Accumulate the full history so later rounds keep the context of
            # what tools were already called and what they returned.
            messages.extend([
                {"role": "assistant", "content": resp.content},
                {"role": "user", "content": tool_results},
            ])
            resp = await client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                system=system,
                messages=messages,
                tools=TOOLS,
            )

        text = ""
        for block in resp.content:
            if hasattr(block, "text"):
                text += block.text

        return {"text": text, "groundingChunks": []}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "error": "Failed to get grounded search response",
                "details": str(e),
            },
        )
