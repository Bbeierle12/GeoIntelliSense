import json
import traceback

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.claude import get_client
from app.middleware import check_rate_limit, check_ai_auth

router = APIRouter()

FORECAST_SYSTEM = (
    "You are an expert meteorologist specializing in "
    "California's San Joaquin Valley."
)


class WeatherDataPoint(BaseModel):
    month: str
    avgTemp: float
    precipitation: float


class WeatherForecastRequest(BaseModel):
    locationName: str
    historicalWeather: list[WeatherDataPoint]
    customFactors: str
    startDate: str
    endDate: str


@router.post("/api/weather-forecast")
async def weather_forecast(req: WeatherForecastRequest, request: Request):
    # Auth check
    auth_err = check_ai_auth(request)
    if auth_err:
        return auth_err

    # Rate limit check
    rate_err = await check_rate_limit(request, "ai_forecast")
    if rate_err:
        return rate_err

    try:
        weather_data = [d.model_dump() for d in req.historicalWeather]

        custom_section = ""
        if req.customFactors and req.customFactors.strip():
            custom_section = (
                "\n**User-Provided Influencing Factors:**\n"
                "Please take the following user-provided context into account:\n"
                "```\n"
                f"{req.customFactors}\n"
                "```\n"
            )

        # Exact prompt template ported from server/index.js lines 410-435
        prompt = f"""
You are an expert meteorologist specializing in California's San Joaquin Valley. Your task is to provide a predictive analysis of weather trends for the next three months.

**Location:** {req.locationName}

**Provided Historical Data:**
**Date Range of Data:** {req.startDate} to {req.endDate}
```json
{json.dumps(weather_data, indent=2)}
```
{custom_section}
**Instructions:**
Based on the provided historical data, general seasonal patterns for the region, and any user-provided factors, generate a detailed weather forecast for the next 3 months.

Present the forecast in a clear, well-structured Markdown format:

**1. Weather Forecast:**
*   **Predicted Temperature Trend:** Forecast the expected average temperature (°F) for each of the next three months, explaining your reasoning (e.g., seasonal shifts, heat dome potential, ocean temperature influences).
*   **Predicted Precipitation Trend:** Forecast the expected total precipitation (in inches) for each month, explaining your reasoning (e.g., storm track possibilities, atmospheric river potential).

**2. Overall Analysis:**
*   **Impact of Custom Factors:** If custom factors were provided, explicitly state how they influenced your prediction. If not, omit this section.
*   **Confidence Level:** State your confidence in this prediction (e.g., High, Medium, Low) and mention potential variables that could alter the outcome (e.g., unexpected shifts in jet stream, El Niño/La Niña status).

**IMPORTANT:** Do NOT include any analysis or forecast related to air quality (AQI, PM2.5). Focus exclusively on meteorological conditions.
"""

        resp = get_client().messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=FORECAST_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        return {"text": resp.content[0].text}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "error": "Failed to get weather forecast response",
                "details": str(e),
            },
        )
