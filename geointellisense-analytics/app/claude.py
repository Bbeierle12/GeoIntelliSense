import logging

import anthropic

from app.config import settings

logger = logging.getLogger(__name__)

CHAT_SYSTEM = (
    "You are an expert geospatial and environmental analyst specializing in "
    "the San Joaquin Valley. Provide clear, data-driven answers."
)

SJV_SYSTEM = (
    "You are an expert San Joaquin Valley environmental analyst. "
    "You specialize in air quality, agricultural impacts, water resources, "
    "wildfire smoke dispersion, and public health outcomes across Fresno, Kern, "
    "San Joaquin, Stanislaus, Tulare, and Merced counties. "
    "Provide data-driven, actionable insights. Use markdown formatting."
)

_chat_history: list[dict] = []

# Cached live context text (updated by get_system_with_live_context)
_cached_context: str = ""
_cached_context_ts: float = 0


def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


async def get_system_with_live_context(base_system: str) -> str:
    """Inject full live data context into system prompt.

    Caches for 60s to avoid hammering DB on every chat message.
    Falls back to fire-only context if the full context builder fails.
    """
    import time
    global _cached_context, _cached_context_ts

    now = time.time()
    if _cached_context and (now - _cached_context_ts) < 60:
        return f"{base_system}\n\n{_cached_context}"

    try:
        from app.context import build_context_text
        ctx_text = await build_context_text()
        if ctx_text:
            _cached_context = ctx_text
            _cached_context_ts = now
            return f"{base_system}\n\n{ctx_text}"
    except Exception as e:
        logger.warning("Live context build failed, falling back to fire context: %s", e)

    # Fallback: fire-only context (original behavior)
    try:
        from app.routes.fires import get_current_smoke_context
        ctx = get_current_smoke_context()
        if ctx:
            return f"{base_system}\n\nCURRENT CONDITIONS:\n{ctx}"
    except ImportError:
        pass

    return base_system


def get_system_with_fire_context(base_system: str) -> str:
    """Legacy sync wrapper — only used if async isn't available."""
    try:
        from app.routes.fires import get_current_smoke_context
        ctx = get_current_smoke_context()
        if ctx:
            return f"{base_system}\n\nCURRENT CONDITIONS:\n{ctx}"
    except ImportError:
        pass
    return base_system


def chat_history() -> list[dict]:
    return _chat_history


def append_chat(role: str, content: str) -> None:
    _chat_history.append({"role": role, "content": content})


def reset_chat() -> None:
    _chat_history.clear()
