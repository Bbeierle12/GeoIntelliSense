from fastapi import APIRouter, Header, Path
from fastapi.responses import JSONResponse

from app.cache import flush_all
from app.config import settings
from app.source_toggles import SOURCES, is_enabled, set_enabled, get_all_states

router = APIRouter()


def _check_admin(token: str | None) -> JSONResponse | None:
    if not settings.admin_token:
        return JSONResponse(status_code=403, content={"error": "Admin token not configured"})
    if token != settings.admin_token:
        return JSONResponse(status_code=401, content={"error": "Invalid admin token"})
    return None


@router.post("/api/admin/cache/flush")
async def cache_flush(x_admin_token: str = Header(None)):
    err = _check_admin(x_admin_token)
    if err:
        return err

    count = await flush_all()
    return {"flushed": count}


# ── Data Source Toggles ─────────────────────────────

@router.get("/api/admin/sources")
async def list_sources():
    """List all data source toggle states. No auth required for read."""
    return {"sources": await get_all_states()}


@router.post("/api/admin/sources/{source}/enable")
async def enable_source(
    source: str = Path(..., description="Source key"),
    x_admin_token: str = Header(None),
):
    err = _check_admin(x_admin_token)
    if err:
        return err

    if source not in SOURCES:
        return JSONResponse(status_code=400, content={"error": f"Unknown source: {source}", "available": list(SOURCES.keys())})

    await set_enabled(source, True)
    return {"source": source, "enabled": True, "message": f"{source} enabled — polling will start on next cycle"}


@router.post("/api/admin/sources/{source}/disable")
async def disable_source(
    source: str = Path(..., description="Source key"),
    x_admin_token: str = Header(None),
):
    err = _check_admin(x_admin_token)
    if err:
        return err

    if source not in SOURCES:
        return JSONResponse(status_code=400, content={"error": f"Unknown source: {source}", "available": list(SOURCES.keys())})

    await set_enabled(source, False)
    return {"source": source, "enabled": False, "message": f"{source} disabled — polling stopped"}


@router.post("/api/admin/sources/enable-all")
async def enable_all(x_admin_token: str = Header(None)):
    err = _check_admin(x_admin_token)
    if err:
        return err

    for source in SOURCES:
        await set_enabled(source, True)
    return {"message": "All sources enabled", "sources": list(SOURCES.keys())}


@router.post("/api/admin/sources/disable-all")
async def disable_all(x_admin_token: str = Header(None)):
    err = _check_admin(x_admin_token)
    if err:
        return err

    for source in SOURCES:
        await set_enabled(source, False)
    return {"message": "All sources disabled", "sources": list(SOURCES.keys())}
