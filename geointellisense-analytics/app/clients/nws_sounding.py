"""
NWS upper-air sounding client for temperature inversion detection.

Uses two data sources:
1. University of Wyoming sounding archive (historical + near-real-time)
   - Provides decoded upper-air data in text format
   - Station VBG (Vandenberg AFB) is nearest to SJV
   - Station OAK (Oakland) as backup
2. NWS surface observations via api.weather.gov
   - Current surface conditions at Bakersfield (KBFL)

Inversion detection logic:
- A temperature inversion exists when T(850mb) > T(surface)
- The stronger the difference, the more pollutants get trapped
- Low wind speeds + inversions = worst AQI conditions
- High dewpoint depression < 3°C in winter = tule fog likely
"""

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# University of Wyoming sounding data URL
UWYO_URL = "https://weather.uwyo.edu/cgi-bin/sounding.py"

# NWS API
NWS_BASE = "https://api.weather.gov"
NWS_HEADERS = {
    "User-Agent": "(GeoIntelliSense, contact@geointellisense.dev)",
    "Accept": "application/geo+json",
}

# Stations
SOUNDING_STATION = "VBG"  # Vandenberg AFB — nearest upper-air to SJV
SURFACE_STATION = "KBFL"  # Bakersfield Meadows Field
BAKERSFIELD_LAT = 35.3733
BAKERSFIELD_LNG = -119.0187

# Sounding launch times (UTC): 00Z and 12Z daily
SOUNDING_TIMES = [0, 12]


@dataclass
class InversionStatus:
    time: datetime
    surface_temp_c: float | None
    temp_850mb_c: float | None
    temp_diff_c: float | None      # 850mb - surface; positive = inversion
    surface_dewpoint_c: float | None
    wind_speed_kts: float | None
    mixing_height_m: float | None
    inversion_strength: str         # none, weak, moderate, strong
    fog_likely: bool
    source: str
    sounding_station: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "time": self.time.isoformat(),
            "surfaceTempC": self.surface_temp_c,
            "surfaceTempF": round(self.surface_temp_c * 9 / 5 + 32, 1) if self.surface_temp_c is not None else None,
            "temp850mbC": self.temp_850mb_c,
            "temp850mbF": round(self.temp_850mb_c * 9 / 5 + 32, 1) if self.temp_850mb_c is not None else None,
            "tempDiffC": self.temp_diff_c,
            "surfaceDewpointC": self.surface_dewpoint_c,
            "windSpeedKts": self.wind_speed_kts,
            "mixingHeightM": self.mixing_height_m,
            "inversionStrength": self.inversion_strength,
            "fogLikely": self.fog_likely,
            "source": self.source,
            "soundingStation": self.sounding_station,
        }


def classify_inversion(temp_diff: float | None) -> str:
    """Classify inversion strength from temperature difference."""
    if temp_diff is None:
        return "unknown"
    if temp_diff <= 0:
        return "none"
    if temp_diff < 2:
        return "weak"
    if temp_diff < 5:
        return "moderate"
    return "strong"


def is_fog_likely(
    surface_temp_c: float | None,
    dewpoint_c: float | None,
    wind_kts: float | None,
    inversion: str,
) -> bool:
    """Estimate tule fog likelihood from surface conditions.

    Tule fog forms when:
    - Temperature inversion exists (traps moisture)
    - Dewpoint depression < 3°C (near-saturated air)
    - Low wind speeds (< 5 kts)
    - Cool season (Oct-Feb) — caller should check separately
    """
    if surface_temp_c is None or dewpoint_c is None:
        return False
    if inversion == "none":
        return False

    dewpoint_depression = surface_temp_c - dewpoint_c
    low_wind = wind_kts is None or wind_kts < 5

    return dewpoint_depression < 3.0 and low_wind


async def fetch_surface_obs() -> dict[str, float | None]:
    """Get current surface observations from NWS for Bakersfield."""
    result: dict[str, float | None] = {
        "temp_c": None,
        "dewpoint_c": None,
        "wind_speed_kts": None,
        "wind_direction": None,
        "humidity": None,
    }

    try:
        async with httpx.AsyncClient(headers=NWS_HEADERS, timeout=15.0) as client:
            # Get latest observation from KBFL
            resp = await client.get(
                f"{NWS_BASE}/stations/{SURFACE_STATION}/observations/latest"
            )
            resp.raise_for_status()
            props = resp.json().get("properties", {})

            result["temp_c"] = _extract_value(props.get("temperature"))
            result["dewpoint_c"] = _extract_value(props.get("dewpoint"))

            wind_ms = _extract_value(props.get("windSpeed"))
            if wind_ms is not None:
                result["wind_speed_kts"] = round(wind_ms * 1.94384, 1)  # m/s → knots

            result["wind_direction"] = _extract_value(props.get("windDirection"))
            result["humidity"] = _extract_value(props.get("relativeHumidity"))

    except Exception as e:
        logger.warning("Surface obs fetch failed for %s: %s", SURFACE_STATION, e)

    return result


async def fetch_sounding_850mb(station: str = SOUNDING_STATION) -> dict[str, float | None]:
    """Fetch the most recent upper-air sounding and extract 850mb temperature.

    Uses the University of Wyoming sounding archive which provides decoded
    sounding data in a parseable text format.
    """
    result: dict[str, float | None] = {
        "temp_850mb_c": None,
        "mixing_height_m": None,
        "sounding_time": None,
    }

    now = datetime.now(timezone.utc)

    # Try the most recent sounding time (00Z or 12Z)
    for hours_back in [0, 12, 24]:
        target = now.replace(
            hour=12 if (now.hour >= 6) else 0,
            minute=0, second=0, microsecond=0
        )
        if hours_back:
            from datetime import timedelta
            target = target - timedelta(hours=hours_back)

        try:
            params = {
                "region": "naconf",
                "TYPE": "TEXT:LIST",
                "YEAR": str(target.year),
                "MONTH": f"{target.month:02d}",
                "FROM": f"{target.day:02d}{target.hour:02d}",
                "TO": f"{target.day:02d}{target.hour:02d}",
                "STNM": station,
            }

            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(UWYO_URL, params=params)
                if resp.status_code != 200:
                    continue

                text = resp.text

                # Parse the sounding data table
                temp_850 = _parse_850mb_temp(text)
                if temp_850 is not None:
                    result["temp_850mb_c"] = temp_850
                    result["sounding_time"] = target.isoformat()

                    # Try to extract mixing height from station info section
                    mixing = _parse_mixing_height(text)
                    if mixing is not None:
                        result["mixing_height_m"] = mixing

                    return result

        except Exception as e:
            logger.debug("Sounding fetch attempt failed (%s, %s): %s", station, target, e)
            continue

    logger.warning("No sounding data found for station %s", station)
    return result


def _parse_850mb_temp(text: str) -> float | None:
    """Parse 850mb temperature from UWyo sounding text output.

    The data table has columns:
    PRES  HGHT  TEMP  DWPT  RELH  MIXR  DRCT  SKNT  THTA  THTE  THTV
    hPa     m     C     C     %   g/kg  deg  knot    K     K     K

    We look for the row where PRES is closest to 850.
    """
    in_data = False
    for line in text.split("\n"):
        line = line.strip()

        # Data section starts after the header dashes
        if line.startswith("------"):
            in_data = True
            continue

        if not in_data:
            continue

        # End of data section
        if line.startswith("</pre>") or not line:
            in_data = False
            continue

        parts = line.split()
        if len(parts) < 4:
            continue

        try:
            pres = float(parts[0])
            if 845 <= pres <= 855:  # Close to 850mb
                return float(parts[2])  # TEMP column
        except (ValueError, IndexError):
            continue

    return None


def _parse_mixing_height(text: str) -> float | None:
    """Try to extract mixing height from sounding indices section."""
    # Look for "Mixing ratio" or other mixing height indicators
    for line in text.split("\n"):
        if "Mean mixed layer" in line or "Mixed layer" in line:
            match = re.search(r'(\d+\.?\d*)\s*m', line)
            if match:
                return float(match.group(1))
    return None


async def get_inversion_status() -> InversionStatus:
    """Determine current temperature inversion status.

    Combines NWS surface observations with upper-air sounding data.
    """
    # Fetch both in parallel-ish
    surface = await fetch_surface_obs()
    sounding = await fetch_sounding_850mb()

    surface_temp = surface.get("temp_c")
    temp_850 = sounding.get("temp_850mb_c")
    dewpoint = surface.get("dewpoint_c")
    wind_kts = surface.get("wind_speed_kts")
    mixing_height = sounding.get("mixing_height_m")

    # Calculate temperature difference
    temp_diff = None
    if surface_temp is not None and temp_850 is not None:
        temp_diff = round(temp_850 - surface_temp, 1)

    strength = classify_inversion(temp_diff)
    fog = is_fog_likely(surface_temp, dewpoint, wind_kts, strength)

    return InversionStatus(
        time=datetime.now(timezone.utc),
        surface_temp_c=surface_temp,
        temp_850mb_c=temp_850,
        temp_diff_c=temp_diff,
        surface_dewpoint_c=dewpoint,
        wind_speed_kts=wind_kts,
        mixing_height_m=mixing_height,
        inversion_strength=strength,
        fog_likely=fog,
        source="nws_sounding",
        sounding_station=SOUNDING_STATION,
    )


def _extract_value(prop: dict | None) -> float | None:
    """Extract numeric value from NWS API property object."""
    if prop is None:
        return None
    val = prop.get("value")
    if val is None:
        return None
    try:
        return round(float(val), 1)
    except (ValueError, TypeError):
        return None
