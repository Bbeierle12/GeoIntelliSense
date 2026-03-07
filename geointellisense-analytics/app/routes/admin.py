from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

from app.cache import flush_all
from app.config import settings

router = APIRouter()


@router.post("/api/admin/cache/flush")
async def cache_flush(x_admin_token: str = Header(None)):
    if not settings.admin_token:
        return JSONResponse(status_code=403, content={"error": "Admin token not configured"})

    if x_admin_token != settings.admin_token:
        return JSONResponse(status_code=401, content={"error": "Invalid admin token"})

    count = await flush_all()
    return {"flushed": count}
