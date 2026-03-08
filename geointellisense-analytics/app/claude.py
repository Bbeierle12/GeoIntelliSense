import anthropic

from app.config import settings

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


def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def get_system_with_fire_context(base_system: str) -> str:
    """Inject active fire/smoke context into system prompt if fires are detected."""
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
