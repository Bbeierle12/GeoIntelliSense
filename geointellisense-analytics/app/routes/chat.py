import traceback

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.claude import get_client, CHAT_SYSTEM, chat_history, append_chat

router = APIRouter()


class ChatRequest(BaseModel):
    message: str


@router.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        append_chat("user", req.message)

        resp = get_client().messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=CHAT_SYSTEM,
            messages=chat_history(),
        )

        text = resp.content[0].text
        append_chat("assistant", text)

        return {"text": text}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to get chat response", "details": str(e)},
        )
