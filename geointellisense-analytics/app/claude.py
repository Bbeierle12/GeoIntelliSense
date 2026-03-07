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

# In-memory conversation history keyed by a simple session approach.
# For a single-server deployment this is equivalent to the Express `let chat;` singleton.
_chat_history: list[dict] = []


def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def chat_history() -> list[dict]:
    return _chat_history


def append_chat(role: str, content: str) -> None:
    _chat_history.append({"role": role, "content": content})


def reset_chat() -> None:
    _chat_history.clear()
