"""
Rate limiting and authentication middleware for AI endpoints.

Uses Redis-backed sliding window rate limiting and optional API key auth.
"""

import hashlib
import logging
import time

from fastapi import Request
from fastapi.responses import JSONResponse

from app.cache import get_redis
from app.config import settings

logger = logging.getLogger(__name__)

# Rate limit tiers (requests per window)
RATE_LIMITS = {
    "ai_chat": {"requests": 20, "window": 60},       # 20 req/min for chat
    "ai_deep": {"requests": 5, "window": 60},         # 5 req/min for deep analysis (expensive)
    "ai_low_latency": {"requests": 30, "window": 60}, # 30 req/min for haiku
    "ai_search": {"requests": 15, "window": 60},      # 15 req/min for search
    "ai_maps": {"requests": 15, "window": 60},        # 15 req/min for maps
    "ai_forecast": {"requests": 5, "window": 60},     # 5 req/min for predictive/weather forecasts (expensive)
    "data_default": {"requests": 60, "window": 60},   # 60 req/min for data endpoints
}

RATE_LIMIT_PREFIX = "geointelli:ratelimit"


def _client_id(request: Request) -> str:
    """Extract a client identifier from the request."""
    # Use API key if provided, otherwise fall back to IP
    api_key = request.headers.get("x-api-key", "")
    if api_key:
        return f"key:{hashlib.md5(api_key.encode()).hexdigest()[:12]}"
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else request.client.host if request.client else "unknown"
    return f"ip:{ip}"


async def check_rate_limit(request: Request, tier: str = "data_default") -> JSONResponse | None:
    """Check rate limit for a request. Returns JSONResponse if rate limited, None if OK."""
    limits = RATE_LIMITS.get(tier, RATE_LIMITS["data_default"])
    client = _client_id(request)
    window = limits["window"]
    max_requests = limits["requests"]

    try:
        r = await get_redis()
        now = time.time()
        key = f"{RATE_LIMIT_PREFIX}:{tier}:{client}"

        # Sliding window: remove old entries, add new one, count
        pipe = r.pipeline()
        pipe.zremrangebyscore(key, 0, now - window)
        pipe.zadd(key, {str(now): now})
        pipe.zcard(key)
        pipe.expire(key, window + 1)
        results = await pipe.execute()
        count = results[2]

        if count > max_requests:
            retry_after = int(window - (now - float((await r.zrange(key, 0, 0))[0])))
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Rate limit exceeded",
                    "limit": max_requests,
                    "window": f"{window}s",
                    "retryAfter": max(1, retry_after),
                },
                headers={"Retry-After": str(max(1, retry_after))},
            )
    except Exception as e:
        logger.warning("Rate limit check failed (allowing request): %s", e)

    return None


def check_admin_auth(request: Request) -> JSONResponse | None:
    """Validate admin token for write/operator endpoints (backfills, training, downloads).

    Deny-by-default: if no ADMIN_TOKEN is configured, these endpoints are disabled.
    Mirrors the admin router's behavior so all operator actions share one policy.
    """
    if not settings.admin_token:
        return JSONResponse(status_code=403, content={"error": "Admin token not configured"})
    token = request.headers.get("x-admin-token", "")
    if token != settings.admin_token:
        return JSONResponse(status_code=401, content={"error": "Invalid admin token"})
    return None


def check_ai_auth(request: Request) -> JSONResponse | None:
    """Validate API key for AI endpoints. Returns JSONResponse if unauthorized, None if OK.

    If no ANTHROPIC_API_KEY is configured, AI endpoints are unavailable regardless.
    If no ADMIN_TOKEN is set, auth is skipped (dev mode).
    """
    if not settings.anthropic_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "AI endpoints not configured", "details": "Set ANTHROPIC_API_KEY in .env"},
        )

    # In dev mode (no admin_token), skip auth
    if not settings.admin_token:
        return None

    api_key = request.headers.get("x-api-key", "")
    if not api_key:
        return JSONResponse(
            status_code=401,
            content={"error": "API key required", "details": "Set x-api-key header"},
        )

    # Accept admin token as a valid API key
    if api_key == settings.admin_token:
        return None

    return JSONResponse(
        status_code=403,
        content={"error": "Invalid API key"},
    )
