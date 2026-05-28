from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.context import build_live_context

router = APIRouter()

CONTEXT_TTL = 60  # 1 minute — fresh enough for AI, avoids hammering DB


@router.get("/api/ai/context")
async def ai_context():
    """Returns the assembled live data context for debugging and inspection."""
    cached, hit = await get_cached("ai-context", "live")
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, CONTEXT_TTL))

    ctx = await build_live_context()

    # Flatten freshness into sources dict
    for source_key in ("aqi", "forecast", "fires", "earthquakes", "water", "enviroscreen"):
        section = ctx.get(source_key, {})
        freshness = section.get("freshness")
        if freshness:
            source_name = section.pop("_source", source_key)
            ctx["sources"][source_name] = freshness
            # Remove freshness from the section to avoid duplication
            section.pop("freshness", None)

    await set_cached("ai-context", "live", ctx, CONTEXT_TTL)
    return JSONResponse(content=ctx, headers=cache_headers(False, CONTEXT_TTL))
