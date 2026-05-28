"""
Redis cache layer for the analytics service.

Key namespace: geointelli:analytics:{endpoint}:{params_hash}
TTL defaults:
  - NWS forecast: 3600s (1 hour)
  - Historical aggregation: 300s (5 min)
  - Snapshot proxy: 120s (2 min)
"""

import hashlib
import json
import logging
import time
from typing import Any

import redis.asyncio as redis

from app.config import settings

logger = logging.getLogger(__name__)

_client: redis.Redis | None = None
_binary_client: redis.Redis | None = None

PREFIX = "geointelli:analytics"


async def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


async def get_redis_binary() -> redis.Redis:
    """Redis connection that returns bytes (for tile/binary caching)."""
    global _binary_client
    if _binary_client is None:
        _binary_client = redis.from_url(settings.redis_url, decode_responses=False)
    return _binary_client


async def close_redis() -> None:
    global _client, _binary_client
    if _client is not None:
        await _client.aclose()
        _client = None
    if _binary_client is not None:
        await _binary_client.aclose()
        _binary_client = None


def _key(endpoint: str, params: dict[str, Any] | str = "") -> str:
    if isinstance(params, dict):
        raw = json.dumps(params, sort_keys=True, default=str)
    else:
        raw = params
    h = hashlib.md5(raw.encode()).hexdigest()[:12]
    return f"{PREFIX}:{endpoint}:{h}"


async def get_cached(endpoint: str, params: dict[str, Any] | str = "") -> tuple[Any | None, bool]:
    """Returns (data, hit). data is None on miss."""
    try:
        r = await get_redis()
        key = _key(endpoint, params)
        val = await r.get(key)
        if val is not None:
            logger.info("cache HIT %s", key)
            return json.loads(val), True
        logger.info("cache MISS %s", key)
        return None, False
    except Exception as e:
        logger.warning("Redis error on GET: %s", e)
        return None, False


async def set_cached(endpoint: str, params: dict[str, Any] | str, data: Any, ttl: int) -> None:
    """Store data in cache with TTL in seconds."""
    try:
        r = await get_redis()
        key = _key(endpoint, params)
        await r.setex(key, ttl, json.dumps(data, default=str))
        logger.debug("cache SET %s ttl=%ds", key, ttl)
    except Exception as e:
        logger.warning("Redis error on SET: %s", e)


async def flush_all() -> int:
    """Flush all geointelli:analytics:* keys. Returns count deleted."""
    try:
        r = await get_redis()
        keys = []
        async for key in r.scan_iter(f"{PREFIX}:*"):
            keys.append(key)
        if keys:
            await r.delete(*keys)
        logger.info("cache FLUSH %d keys", len(keys))
        return len(keys)
    except Exception as e:
        logger.warning("Redis error on FLUSH: %s", e)
        return 0


def cache_headers(hit: bool, ttl: int) -> dict[str, str]:
    """Return Cache-Control and X-Cache headers."""
    return {
        "Cache-Control": f"public, max-age={ttl}",
        "X-Cache": "HIT" if hit else "MISS",
    }
