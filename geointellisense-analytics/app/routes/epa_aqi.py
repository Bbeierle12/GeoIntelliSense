import traceback
from datetime import date, timedelta

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.config import settings
from app.clients.epa_aqs import EpaAqsClient, SJV_COUNTIES

router = APIRouter()


@router.get("/api/epa-aqi")
async def epa_aqi(
    county: str | None = Query(None, description="County FIPS code (e.g. 029 for Kern). Omit for all SJV."),
    start_date: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: date | None = Query(None, description="End date (YYYY-MM-DD)"),
    param: str = Query("88101", description="EPA parameter code (88101=PM2.5, 81102=PM10, 44201=Ozone)"),
):
    if not settings.epa_aqs_email or not settings.epa_aqs_key:
        return JSONResponse(
            status_code=503,
            content={"error": "EPA AQS not configured", "details": "Set EPA_AQS_EMAIL and EPA_AQS_KEY"},
        )

    # Default to last 30 days
    if end_date is None:
        end_date = date.today()
    if start_date is None:
        start_date = end_date - timedelta(days=30)

    # EPA AQS limits queries to 1 year max
    if (end_date - start_date).days > 365:
        return JSONResponse(
            status_code=400,
            content={"error": "Date range too large", "details": "EPA AQS limits queries to 365 days"},
        )

    client = EpaAqsClient(settings.epa_aqs_email, settings.epa_aqs_key)
    try:
        if county:
            results = await client.get_daily_by_county(county, param, start_date, end_date)
        else:
            # All SJV counties — sequential with rate limiting
            results = []
            for code in SJV_COUNTIES:
                batch = await client.get_daily_by_county(code, param, start_date, end_date)
                results.extend(batch)

        return {
            "count": len(results),
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
            "parameter": param,
            "data": [r.model_dump() for r in results],
        }
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=502,
            content={"error": "EPA AQS request failed", "details": str(e)},
        )
    finally:
        await client.close()
