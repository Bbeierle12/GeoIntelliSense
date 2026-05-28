import traceback

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.claude import (
    get_client, CHAT_SYSTEM, get_system_with_live_context,
    create_session, get_session_history, append_to_session, reset_session,
    TOOLS, execute_tool,
)
from app.middleware import check_rate_limit, check_ai_auth

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None


@router.post("/api/chat")
async def chat(req: ChatRequest, request: Request):
    # Auth check
    auth_err = check_ai_auth(request)
    if auth_err:
        return auth_err

    # Rate limit check
    rate_err = await check_rate_limit(request, "ai_chat")
    if rate_err:
        return rate_err

    try:
        # Get or create session
        session_id = req.session_id or create_session()
        append_to_session(session_id, "user", req.message)

        system = await get_system_with_live_context(CHAT_SYSTEM)
        client = get_client()

        # Initial request with tools
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=system,
            messages=get_session_history(session_id),
            tools=TOOLS,
        )

        # Tool use loop (max 5 rounds to prevent runaway)
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

            # Continue conversation with tool results
            messages = get_session_history(session_id) + [
                {"role": "assistant", "content": resp.content},
                {"role": "user", "content": tool_results},
            ]
            resp = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2048,
                system=system,
                messages=messages,
                tools=TOOLS,
            )

        # Extract final text
        text = ""
        for block in resp.content:
            if hasattr(block, "text"):
                text += block.text

        append_to_session(session_id, "assistant", text)

        return {"text": text, "sessionId": session_id}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to get chat response", "details": str(e)},
        )


@router.post("/api/chat/reset")
async def chat_reset(request: Request):
    """Reset a chat session."""
    body = await request.json()
    session_id = body.get("session_id", "")
    if session_id:
        reset_session(session_id)
    return {"reset": True, "sessionId": session_id}


@router.post("/api/chat/session")
async def new_session():
    """Create a new chat session."""
    return {"sessionId": create_session()}
