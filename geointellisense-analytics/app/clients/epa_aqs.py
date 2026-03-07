"""
EPA AQS (Air Quality System) API client.

Docs: https://aqs.epa.gov/aqsweb/documents/data_api.html
Rate limit: 10 requests/minute — we enforce a 6s pause between calls.

Authentication: register at https://aqs.epa.gov/data/api/signup?email=YOUR_EMAIL
Then confirm via email to receive your key.
"""

import asyncio
import logging
from datetime import date
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

AQS_BASE = "https://aqs.epa.gov/data/api"

# SJV county FIPS codes (state = 06 California)
SJV_COUNTIES: dict[str, str] = {
    "019": "Fresno",
    "029": "Kern",
    "047": "Merced",
    "077": "San Joaquin",
    "099": "Stanislaus",
    "107": "Tulare",
}

# EPA parameter codes
PARAM_PM25 = "88101"   # PM2.5 - Local Conditions (FRM/FEM)
PARAM_PM10 = "81102"   # PM10
PARAM_OZONE = "44201"  # Ozone

# Pause between requests to stay under 10 req/min
REQUEST_PAUSE_SECS = 6.0


class DailySummary(BaseModel):
    date: str
    county: str
    county_code: str
    site_number: str
    aqi: int | None = None
    arithmetic_mean: float | None = None
    first_max_value: float | None = None
    units: str = ""
    parameter: str = ""
    latitude: float | None = None
    longitude: float | None = None


class EpaAqsClient:
    def __init__(self, email: str, key: str):
        self.email = email
        self.key = key
        self._http = httpx.AsyncClient(timeout=30.0)
        self._last_request: float = 0.0

    async def close(self) -> None:
        await self._http.aclose()

    async def _throttled_get(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        """GET with rate-limit throttle."""
        now = asyncio.get_event_loop().time()
        elapsed = now - self._last_request
        if elapsed < REQUEST_PAUSE_SECS:
            await asyncio.sleep(REQUEST_PAUSE_SECS - elapsed)

        params["email"] = self.email
        params["key"] = self.key

        logger.info("EPA AQS request: %s params=%s", url.split("/")[-1], {k: v for k, v in params.items() if k not in ("email", "key")})

        resp = await self._http.get(url, params=params)
        self._last_request = asyncio.get_event_loop().time()

        resp.raise_for_status()
        body = resp.json()

        header = body.get("Header", [{}])
        if isinstance(header, list) and header:
            status = header[0].get("status", "")
            if "No data" in status or "Failed" in status:
                logger.warning("EPA AQS: %s", status)
                return {"Data": []}
            rows = header[0].get("rows", 0)
            logger.info("EPA AQS: %s — %s rows", status, rows)

        return body

    # ── Public methods ───────────────────────────────

    async def get_daily_pm25_by_county(
        self,
        county_code: str,
        bdate: date,
        edate: date,
        state: str = "06",
    ) -> list[DailySummary]:
        """Fetch PM2.5 daily summaries for a single county."""
        url = f"{AQS_BASE}/dailyData/byCounty"
        params = {
            "param": PARAM_PM25,
            "bdate": bdate.strftime("%Y%m%d"),
            "edate": edate.strftime("%Y%m%d"),
            "state": state,
            "county": county_code,
        }
        body = await self._throttled_get(url, params)
        return _parse_daily(body, "PM2.5")

    async def get_daily_pm25_all_sjv(
        self,
        bdate: date,
        edate: date,
    ) -> list[DailySummary]:
        """Fetch PM2.5 daily summaries for all 6 SJV counties, respecting rate limits."""
        all_results: list[DailySummary] = []
        for code, name in SJV_COUNTIES.items():
            logger.info("Fetching PM2.5 for %s (county %s)...", name, code)
            results = await self.get_daily_pm25_by_county(code, bdate, edate)
            all_results.extend(results)
        return all_results

    async def get_daily_by_county(
        self,
        county_code: str,
        param: str,
        bdate: date,
        edate: date,
        state: str = "06",
    ) -> list[DailySummary]:
        """Fetch daily summaries for any parameter code."""
        url = f"{AQS_BASE}/dailyData/byCounty"
        params = {
            "param": param,
            "bdate": bdate.strftime("%Y%m%d"),
            "edate": edate.strftime("%Y%m%d"),
            "state": state,
            "county": county_code,
        }
        body = await self._throttled_get(url, params)
        param_name = {"88101": "PM2.5", "81102": "PM10", "44201": "Ozone"}.get(param, param)
        return _parse_daily(body, param_name)

    async def signup(self, email: str) -> str:
        """Request an API key — EPA sends a confirmation email."""
        url = f"{AQS_BASE}/signup"
        params = {"email": email}
        resp = await self._http.get(url, params=params)
        resp.raise_for_status()
        return resp.text


def _parse_daily(body: dict[str, Any], parameter: str) -> list[DailySummary]:
    """Parse the EPA AQS daily data response into DailySummary models."""
    raw = body.get("Data", [])
    if not raw:
        return []

    results: list[DailySummary] = []
    for row in raw:
        results.append(DailySummary(
            date=row.get("date_local", ""),
            county=row.get("county", ""),
            county_code=row.get("county_code", ""),
            site_number=row.get("site_number", ""),
            aqi=row.get("aqi"),
            arithmetic_mean=row.get("arithmetic_mean"),
            first_max_value=row.get("first_max_value"),
            units=row.get("units_of_measure", ""),
            parameter=parameter,
            latitude=row.get("latitude"),
            longitude=row.get("longitude"),
        ))
    return results
