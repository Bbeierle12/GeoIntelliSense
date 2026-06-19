import logging
import uuid

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

YARD_SYSTEM = (
    "You are also a yard and garden management advisor. You have access to the "
    "user's yard measurements, local soil data, elevation, and weather conditions. "
    "Reference actual yard dimensions, soil type, climate, and elevation when "
    "advising on yard care. Provide actionable, seasonal advice."
)

# ── Per-session chat history ─────────────────────────
# Maps session_id -> list of messages. Sessions expire after MAX_SESSIONS.

MAX_SESSIONS = 100
MAX_HISTORY_PER_SESSION = 50

_sessions: dict[str, list[dict]] = {}
_session_order: list[str] = []  # LRU tracking


def create_session() -> str:
    """Create a new chat session and return its ID."""
    session_id = str(uuid.uuid4())
    _sessions[session_id] = []
    _session_order.append(session_id)
    # Evict oldest sessions if over limit
    while len(_session_order) > MAX_SESSIONS:
        old = _session_order.pop(0)
        _sessions.pop(old, None)
    return session_id


def get_session_history(session_id: str) -> list[dict]:
    """Get chat history for a session. Returns empty list if not found."""
    return _sessions.get(session_id, [])


def append_to_session(session_id: str, role: str, content: str) -> None:
    """Append a message to a session's history."""
    if session_id not in _sessions:
        _sessions[session_id] = []
        _session_order.append(session_id)
    history = _sessions[session_id]
    history.append({"role": role, "content": content})
    # Trim oldest messages if over limit
    if len(history) > MAX_HISTORY_PER_SESSION:
        _sessions[session_id] = history[-MAX_HISTORY_PER_SESSION:]


def reset_session(session_id: str) -> None:
    """Clear a session's history."""
    if session_id in _sessions:
        _sessions[session_id].clear()


# ── Cached live context ──────────────────────────────

_cached_context: str = ""
_cached_context_ts: float = 0


def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


async def get_system_with_live_context(base_system: str) -> str:
    """Inject full live data context into system prompt.

    Caches for 60s to avoid hammering DB on every chat message.
    Falls back to fire-only context if the full context builder fails.
    Always appends yard advisor capability.
    """
    import time
    global _cached_context, _cached_context_ts

    # Always include yard advisor persona
    base_system = f"{base_system}\n\n{YARD_SYSTEM}"

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


# ── Tool definitions for Claude ──────────────────────

TOOLS = [
    {
        "name": "get_air_quality",
        "description": "Get current air quality readings for a location or region. Returns AQI, PM2.5, and other pollutant levels.",
        "input_schema": {
            "type": "object",
            "properties": {
                "bbox": {
                    "type": "string",
                    "description": "Bounding box as 'south,west,north,east' decimal degrees. Example: '34.5,-121.0,37.5,-117.5'",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_earthquakes",
        "description": "Get recent earthquake events for a region. Returns magnitude, location, depth, and time.",
        "input_schema": {
            "type": "object",
            "properties": {
                "bbox": {
                    "type": "string",
                    "description": "Bounding box as 'south,west,north,east'",
                },
                "days": {
                    "type": "integer",
                    "description": "Number of days to look back (1-365, default 7)",
                },
                "min_magnitude": {
                    "type": "number",
                    "description": "Minimum magnitude threshold (default 2.0)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_active_fires",
        "description": "Get active fire/hotspot detections from NASA satellite data.",
        "input_schema": {
            "type": "object",
            "properties": {
                "bbox": {
                    "type": "string",
                    "description": "Bounding box as 'south,west,north,east'",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_water_levels",
        "description": "Get current water level readings (streamflow, gage height) from USGS monitoring stations.",
        "input_schema": {
            "type": "object",
            "properties": {
                "bbox": {
                    "type": "string",
                    "description": "Bounding box as 'south,west,north,east'",
                },
                "site_ids": {
                    "type": "string",
                    "description": "Comma-separated USGS site IDs (optional, overrides bbox)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_weather_forecast",
        "description": "Get NWS weather forecast for a specific location.",
        "input_schema": {
            "type": "object",
            "properties": {
                "lat": {
                    "type": "number",
                    "description": "Latitude of the location",
                },
                "lng": {
                    "type": "number",
                    "description": "Longitude of the location",
                },
            },
            "required": ["lat", "lng"],
        },
    },
    {
        "name": "get_yard_features",
        "description": "Get all saved yard measurements and features",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_soil_data",
        "description": "Get soil composition, drainage, and pH for a location",
        "input_schema": {
            "type": "object",
            "properties": {
                "lat": {
                    "type": "number",
                    "description": "Latitude of the location",
                },
                "lng": {
                    "type": "number",
                    "description": "Longitude of the location",
                },
            },
            "required": ["lat", "lng"],
        },
    },
    {
        "name": "get_elevation_profile",
        "description": "Get elevation along a line across the yard",
        "input_schema": {
            "type": "object",
            "properties": {
                "from_lat": {
                    "type": "number",
                    "description": "Starting latitude",
                },
                "from_lng": {
                    "type": "number",
                    "description": "Starting longitude",
                },
                "to_lat": {
                    "type": "number",
                    "description": "Ending latitude",
                },
                "to_lng": {
                    "type": "number",
                    "description": "Ending longitude",
                },
            },
            "required": ["from_lat", "from_lng", "to_lat", "to_lng"],
        },
    },
]


async def execute_tool(tool_name: str, tool_input: dict) -> str:
    """Execute a tool call and return the result as a string."""
    import json
    import httpx

    base = f"http://localhost:{settings.port}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if tool_name == "get_air_quality":
                params = {}
                if tool_input.get("bbox"):
                    params["bbox"] = tool_input["bbox"]
                resp = await client.get(f"{base}/api/aqi-snapshot", params=params)
                # Fall back to DB-based snapshot
                if resp.status_code != 200:
                    resp = await client.get("http://localhost:3001/api/aqi-snapshot")

            elif tool_name == "get_earthquakes":
                params = {
                    "days": tool_input.get("days", 7),
                    "min_magnitude": tool_input.get("min_magnitude", 2.0),
                }
                if tool_input.get("bbox"):
                    params["bbox"] = tool_input["bbox"]
                resp = await client.get(f"{base}/api/earthquakes/recent", params=params)

            elif tool_name == "get_active_fires":
                params = {}
                if tool_input.get("bbox"):
                    params["bbox"] = tool_input["bbox"]
                resp = await client.get(f"{base}/api/fires/active", params=params)

            elif tool_name == "get_water_levels":
                params = {}
                if tool_input.get("bbox"):
                    params["bbox"] = tool_input["bbox"]
                if tool_input.get("site_ids"):
                    params["site_ids"] = tool_input["site_ids"]
                resp = await client.get(f"{base}/api/water/current", params=params)

            elif tool_name == "get_weather_forecast":
                lat = tool_input["lat"]
                lng = tool_input["lng"]
                resp = await client.get(f"{base}/api/forecast", params={"lat": lat, "lng": lng})

            elif tool_name == "get_yard_features":
                resp = await client.get(f"{base}/api/yard/features")

            elif tool_name == "get_soil_data":
                lat = tool_input["lat"]
                lng = tool_input["lng"]
                resp = await client.get(f"{base}/api/soil/report", params={"lat": lat, "lng": lng})

            elif tool_name == "get_elevation_profile":
                from_coords = f"{tool_input['from_lat']},{tool_input['from_lng']}"
                to_coords = f"{tool_input['to_lat']},{tool_input['to_lng']}"
                resp = await client.get(
                    f"{base}/api/elevation/profile",
                    params={"from": from_coords, "to": to_coords, "points": 50},
                )

            else:
                return json.dumps({"error": f"Unknown tool: {tool_name}"})

            if resp.status_code == 200:
                return resp.text
            else:
                return json.dumps({"error": f"API returned {resp.status_code}", "body": resp.text[:500]})

    except Exception as e:
        return json.dumps({"error": f"Tool execution failed: {str(e)}"})
