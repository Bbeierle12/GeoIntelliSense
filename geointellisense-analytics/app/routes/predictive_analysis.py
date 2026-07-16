import json
import traceback

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.claude import get_client, get_system_with_live_context
from app.middleware import check_ai_auth, check_rate_limit

router = APIRouter()

PREDICTIVE_SYSTEM = (
    "You are an expert environmental data scientist specializing in "
    "California's San Joaquin Valley."
)


class AqiDataPoint(BaseModel):
    month: str
    avgAqi: float
    avgPm25: float


class WeatherDataPoint(BaseModel):
    month: str
    avgTemp: float
    precipitation: float


class PredictiveAnalysisRequest(BaseModel):
    locationName: str
    historicalAqi: list[AqiDataPoint]
    historicalWeather: list[WeatherDataPoint]
    customFactors: str
    startDate: str
    endDate: str


@router.post("/api/predictive-analysis")
async def predictive_analysis(req: PredictiveAnalysisRequest, request: Request):
    auth_err = check_ai_auth(request)
    if auth_err:
        return auth_err

    rate_err = await check_rate_limit(request, "ai_chat")
    if rate_err:
        return rate_err

    try:
        # Merge AQI and weather data point-by-point, matching the Express logic
        combined = []
        for i, aqi in enumerate(req.historicalAqi):
            entry = aqi.model_dump()
            if i < len(req.historicalWeather):
                entry.update(req.historicalWeather[i].model_dump())
            combined.append(entry)

        custom_section = ""
        if req.customFactors and req.customFactors.strip():
            custom_section = (
                "\n**User-Provided Influencing Factors:**\n"
                "Please take the following user-provided context into account:\n"
                "```\n"
                f"{req.customFactors}\n"
                "```\n"
            )

        # Exact prompt template ported from server/index.js lines 350-377
        prompt = f"""
You are an expert environmental data scientist specializing in California's San Joaquin Valley. Your task is to provide a predictive analysis of air quality and weather trends for the next three months.

**Location:** {req.locationName}

**Provided Historical Data:**
**Date Range of Data:** {req.startDate} to {req.endDate}
```json
{json.dumps(combined, indent=2)}
```
{custom_section}
**Instructions:**
Based on the provided historical data, general seasonal patterns for the region, and any user-provided factors, generate a detailed forecast for the next 3 months.

Present the forecast in a clear, well-structured Markdown format with distinct sections:

**1. Air Quality Forecast:**
*   **Predicted AQI Trend:** Forecast the likely average AQI for each of the next three months, explaining the reasoning (e.g., heat, agricultural activity, stagnation, lack of rain).
*   **Predicted PM2.5 Trend:** Forecast the likely average PM2.5 levels for the same period.

**2. Weather Forecast:**
*   **Predicted Temperature Trend:** Forecast the expected average temperature (°F) for each of the next three months.
*   **Predicted Precipitation Trend:** Forecast the expected total precipitation (in inches) for each month.

**3. Overall Analysis:**
*   **Impact of Custom Factors:** If custom factors were provided, explicitly state how they influenced your prediction. If not, omit this section.
*   **Confidence Level:** State your confidence in this prediction (e.g., High, Medium, Low) and mention potential variables that could alter the outcome.
"""

        system = await get_system_with_live_context(PREDICTIVE_SYSTEM)
        resp = await get_client().messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return {"text": resp.content[0].text}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "error": "Failed to get predictive analysis response",
                "details": str(e),
            },
        )
