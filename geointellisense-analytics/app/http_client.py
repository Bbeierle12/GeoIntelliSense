"""
Shared HTTP client with retry/backoff and 429 handling.

All outbound API calls should use this instead of raw httpx.
"""

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30.0
MAX_RETRIES = 3
RETRY_BACKOFF = [1.0, 2.0, 4.0]  # seconds between retries


async def fetch(
    url: str,
    *,
    method: str = "GET",
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    max_retries: int = MAX_RETRIES,
) -> httpx.Response:
    """Fetch a URL with automatic retry on 429/5xx and exponential backoff."""
    last_error: Exception | None = None

    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.request(method, url, params=params, headers=headers)

                # Success
                if resp.status_code < 400:
                    return resp

                # Rate limited — respect Retry-After header
                if resp.status_code == 429:
                    retry_after = float(resp.headers.get("Retry-After", RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]))
                    logger.warning("429 from %s, retrying in %.1fs (attempt %d/%d)", url, retry_after, attempt + 1, max_retries)
                    await asyncio.sleep(retry_after)
                    continue

                # Server error — retry with backoff
                if resp.status_code >= 500 and attempt < max_retries:
                    wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                    logger.warning("%d from %s, retrying in %.1fs (attempt %d/%d)", resp.status_code, url, wait, attempt + 1, max_retries)
                    await asyncio.sleep(wait)
                    continue

                # Client error or final retry — raise
                resp.raise_for_status()

        except httpx.TimeoutException as e:
            last_error = e
            if attempt < max_retries:
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                logger.warning("Timeout fetching %s, retrying in %.1fs (attempt %d/%d)", url, wait, attempt + 1, max_retries)
                await asyncio.sleep(wait)
                continue
            raise

        except httpx.HTTPStatusError:
            raise

        except Exception as e:
            last_error = e
            if attempt < max_retries:
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                logger.warning("Error fetching %s: %s, retrying in %.1fs", url, e, wait)
                await asyncio.sleep(wait)
                continue
            raise

    # Should not reach here, but just in case
    if last_error:
        raise last_error
    raise RuntimeError(f"Failed to fetch {url} after {max_retries} retries")
