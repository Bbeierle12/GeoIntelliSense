"""
Data source on/off toggles stored in Redis.

All sources default to OFF. Toggle them on via:
  POST /api/admin/sources/{source}/enable
  POST /api/admin/sources/{source}/disable
  GET  /api/admin/sources — list all toggle states

This prevents API calls from consuming quota when you're not actively
using the platform. Polling loops check their toggle before each fetch.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Redis key prefix for toggles
TOGGLE_PREFIX = "geointelli:source-toggle"

# All controllable data sources and their descriptions
SOURCES = {
    "purpleair": "PurpleAir live AQI sensors (Rust ingestion service)",
    "airnow": "AirNow EPA monitor data",
    "nasa_firms": "NASA FIRMS fire detections",
    "usgs_water": "USGS Water Services",
    "nws_forecast": "NWS weather forecast",
    "inversion": "Temperature inversion detection (NWS sounding)",
    "usgs_earthquakes": "USGS earthquake data (Rust ingestion service)",
    "wqp": "Water Quality Portal (groundwater chemistry)",
}


async def is_enabled(source: str) -> bool:
    """Check if a data source is enabled. Defaults to OFF."""
    try:
        from app.cache import get_redis
        r = await get_redis()
        val = await r.get(f"{TOGGLE_PREFIX}:{source}")
        return val == "1"
    except Exception as e:
        logger.warning("Toggle check failed for %s: %s", source, e)
        return False


async def set_enabled(source: str, enabled: bool) -> None:
    """Set a data source toggle."""
    try:
        from app.cache import get_redis
        r = await get_redis()
        await r.set(f"{TOGGLE_PREFIX}:{source}", "1" if enabled else "0")
        logger.info("Source toggle %s: %s", source, "ENABLED" if enabled else "DISABLED")
    except Exception as e:
        logger.warning("Toggle set failed for %s: %s", source, e)


async def get_all_states() -> dict[str, Any]:
    """Get all toggle states."""
    states = {}
    for source, description in SOURCES.items():
        enabled = await is_enabled(source)
        states[source] = {
            "enabled": enabled,
            "description": description,
        }
    return states
