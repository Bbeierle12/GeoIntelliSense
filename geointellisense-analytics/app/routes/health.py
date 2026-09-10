from fastapi import APIRouter

router = APIRouter()


@router.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "geointellisense-analytics",
        "version": "0.1.0",
    }


@router.get("/api/health/data")
async def data_health():
    """Which data sources are actually working, one call.

    /api/health only says the analytics process is up — it said "ok" for the
    whole period historical-weather was 500-ing on every request. This answers
    the question that actually matters: is anything still feeding this thing.

    `problems` and `uninstrumented` are the two lists worth looking at.
    """
    from app.source_health import get_source_health

    return await get_source_health()
