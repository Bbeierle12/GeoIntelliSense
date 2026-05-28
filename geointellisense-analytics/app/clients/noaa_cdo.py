"""
NOAA Climate Data Online (CDO) API client.

Docs: https://www.ncdc.noaa.gov/cdo-web/webservices/v2
Rate limit: 5 requests/second, 10,000/day.
Max 1 year per request, 1000 results per page.
"""

import asyncio
import logging
from datetime import date
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

CDO_BASE = "https://www.ncei.noaa.gov/cdo-web/api/v2"

# SJV NOAA stations — closest GHCND station per city
SJV_STATIONS: dict[str, str] = {
    "GHCND:USW00023155": "Bakersfield Meadows Field",
    "GHCND:USW00093193": "Fresno Yosemite Intl",
    "GHCND:USW00023188": "Stockton Metro",
    "GHCND:USC00045738": "Modesto City",
    "GHCND:USC00049855": "Visalia",
    "GHCND:USC00045532": "Merced Muni",
}

DEFAULT_STATION = "GHCND:USW00023155"  # Bakersfield

# Parameters we fetch
PARAMS = ["TMAX", "TMIN", "PRCP", "AWND"]


class WeatherObs(BaseModel):
    date: str
    station_id: str
    station_name: str
    parameter: str
    value: float
    units: str
    quality_flag: str = ""


class NoaaCdoClient:
    def __init__(self, token: str):
        self.token = token
        self._http = httpx.AsyncClient(
            timeout=30.0,
            headers={"token": token},
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def fetch_daily(
        self,
        station_id: str,
        start: date,
        end: date,
    ) -> list[WeatherObs]:
        """Fetch daily observations for a station. Handles pagination."""
        # CDO limits to 1 year per request
        if (end - start).days > 365:
            return await self._fetch_multi_year(station_id, start, end)

        station_name = SJV_STATIONS.get(station_id, station_id)
        all_results: list[WeatherObs] = []
        offset = 1

        while True:
            params = {
                "datasetid": "GHCND",
                "stationid": station_id,
                "datatypeid": ",".join(PARAMS),
                "startdate": start.isoformat(),
                "enddate": end.isoformat(),
                "units": "standard",
                "limit": "1000",
                "offset": str(offset),
            }

            logger.info("NOAA CDO: %s %s→%s offset=%d", station_id, start, end, offset)
            resp = await self._http.get(f"{CDO_BASE}/data", params=params)

            if resp.status_code == 429:
                logger.warning("NOAA CDO rate limited, waiting 2s...")
                await asyncio.sleep(2)
                continue

            resp.raise_for_status()
            body = resp.json()

            results = body.get("results", [])
            if not results:
                break

            for r in results:
                all_results.append(WeatherObs(
                    date=r["date"][:10],
                    station_id=station_id,
                    station_name=station_name,
                    parameter=r["datatype"],
                    value=r["value"],
                    units=_units(r["datatype"]),
                    quality_flag=r.get("attributes", "").split(",")[0] if r.get("attributes") else "",
                ))

            metadata = body.get("metadata", {}).get("resultset", {})
            total = metadata.get("count", 0)
            if offset + 1000 > total:
                break
            offset += 1000
            await asyncio.sleep(0.25)  # stay under 5 req/s

        logger.info("NOAA CDO: %d observations for %s", len(all_results), station_name)
        return all_results

    async def _fetch_multi_year(
        self, station_id: str, start: date, end: date,
    ) -> list[WeatherObs]:
        """Split multi-year range into 1-year chunks."""
        all_results: list[WeatherObs] = []
        current_start = start

        while current_start < end:
            chunk_end = date(current_start.year, 12, 31)
            if chunk_end > end:
                chunk_end = end
            results = await self.fetch_daily(station_id, current_start, chunk_end)
            all_results.extend(results)
            current_start = date(current_start.year + 1, 1, 1)

        return all_results

    async def fetch_all_sjv(self, start: date, end: date) -> list[WeatherObs]:
        """Fetch for all SJV stations."""
        all_results: list[WeatherObs] = []
        for station_id in SJV_STATIONS:
            results = await self.fetch_daily(station_id, start, end)
            all_results.extend(results)
        return all_results


def _units(param: str) -> str:
    return {
        "TMAX": "°F",
        "TMIN": "°F",
        "PRCP": "in",
        "AWND": "mph",
    }.get(param, "")
