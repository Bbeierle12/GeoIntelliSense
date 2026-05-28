"""
Water Quality Portal (WQP) client.

Source: https://www.waterqualitydata.us/
Free, no API key required.
Provides water chemistry data from USGS NWIS, EPA STORET, and state agencies.

Focus: groundwater wells in Kern County with key contamination parameters.
"""

import csv
import io
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

WQP_BASE = "https://www.waterqualitydata.us"

# Kern County FIPS
KERN_COUNTY_FIPS = "US:06:029"

# Key contamination parameters and their WQP characteristic names
# These are the most relevant for Kern County groundwater issues
PARAMETERS = {
    "Arsenic": {"characteristic": "Arsenic", "mcl_ug_l": 10.0, "unit": "ug/l"},
    "Nitrate": {"characteristic": "Nitrate", "mcl_mg_l": 10.0, "unit": "mg/l"},
    "TDS": {"characteristic": "Total dissolved solids", "mcl_mg_l": 500.0, "unit": "mg/l"},
    "pH": {"characteristic": "pH", "unit": "std units"},
    "Conductivity": {"characteristic": "Specific conductance", "unit": "uS/cm"},
    "Uranium": {"characteristic": "Uranium", "mcl_ug_l": 30.0, "unit": "ug/l"},
    "Chromium": {"characteristic": "Chromium(VI)", "mcl_ug_l": 10.0, "unit": "ug/l"},
    "DBCP": {"characteristic": "1,2-Dibromo-3-chloropropane", "mcl_ug_l": 0.2, "unit": "ug/l"},
}

# MCL = Maximum Contaminant Level (EPA/CA drinking water standard)
MCL_LOOKUP = {
    "Arsenic": 10.0,           # ug/L
    "Nitrate": 10.0,           # mg/L as N
    "Total dissolved solids": 500.0,  # mg/L (secondary)
    "Uranium": 30.0,           # ug/L
    "Chromium(VI)": 10.0,      # ug/L
    "1,2-Dibromo-3-chloropropane": 0.2,  # ug/L
}


@dataclass
class WQSample:
    site_id: str
    site_name: str
    latitude: float
    longitude: float
    time: datetime
    parameter: str
    value: float | None
    unit: str | None
    detection_limit: float | None
    detection_condition: str | None
    sample_fraction: str | None
    organization: str | None


async def fetch_sites(
    county_fips: str = KERN_COUNTY_FIPS,
    site_type: str = "Well",
) -> list[dict[str, Any]]:
    """Fetch monitoring site locations from WQP."""
    params = {
        "countyfips": county_fips,
        "siteType": site_type,
        "mimeType": "csv",
        "sorted": "no",
        "zip": "no",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(f"{WQP_BASE}/data/Station/search", params=params)
        resp.raise_for_status()

    sites = []
    reader = csv.DictReader(io.StringIO(resp.text))
    for row in reader:
        lat = _safe_float(row.get("LatitudeMeasure"))
        lon = _safe_float(row.get("LongitudeMeasure"))
        if lat is None or lon is None:
            continue

        sites.append({
            "siteId": row.get("MonitoringLocationIdentifier", ""),
            "siteName": row.get("MonitoringLocationName", ""),
            "siteType": row.get("MonitoringLocationTypeName", ""),
            "lat": lat,
            "lon": lon,
            "county": row.get("CountyCode", ""),
            "state": row.get("StateCode", ""),
            "org": row.get("OrganizationIdentifier", ""),
            "huc": row.get("HUCEightDigitCode", ""),
        })

    logger.info("WQP sites: %d wells found in %s", len(sites), county_fips)
    return sites


async def fetch_results(
    county_fips: str = KERN_COUNTY_FIPS,
    characteristic: str | None = None,
    start_date: str | None = None,
    site_type: str = "Well",
    limit: int = 10000,
) -> list[WQSample]:
    """Fetch water quality results from WQP.

    Args:
        county_fips: County FIPS code
        characteristic: WQP characteristic name (e.g. "Arsenic")
        start_date: Start date string (MM-DD-YYYY format for WQP)
        site_type: Monitoring location type
        limit: Max results
    """
    params: dict[str, str] = {
        "countyfips": county_fips,
        "siteType": site_type,
        "mimeType": "csv",
        "sorted": "no",
        "zip": "no",
    }

    if characteristic:
        params["characteristicName"] = characteristic
    if start_date:
        params["startDateLo"] = start_date

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.get(f"{WQP_BASE}/data/Result/search", params=params)
        resp.raise_for_status()

    samples = []
    reader = csv.DictReader(io.StringIO(resp.text))
    count = 0

    for row in reader:
        if count >= limit:
            break

        lat = _safe_float(row.get("ActivityLocation/LatitudeMeasure"))
        lon = _safe_float(row.get("ActivityLocation/LongitudeMeasure"))

        # Fall back to monitoring location coords if activity coords are missing
        if lat is None:
            lat = _safe_float(row.get("MonitoringLocationLatitude"))
        if lon is None:
            lon = _safe_float(row.get("MonitoringLocationLongitude"))

        if lat is None or lon is None:
            continue

        time_str = row.get("ActivityStartDate", "")
        if not time_str:
            continue

        try:
            sample_time = datetime.fromisoformat(time_str)
        except ValueError:
            try:
                sample_time = datetime.strptime(time_str, "%Y-%m-%d")
            except ValueError:
                continue

        value = _safe_float(row.get("ResultMeasureValue"))
        detection = row.get("ResultDetectionConditionText", "")
        det_limit = _safe_float(row.get("DetectionQuantitationLimitMeasure/MeasureValue"))

        samples.append(WQSample(
            site_id=row.get("MonitoringLocationIdentifier", ""),
            site_name=row.get("MonitoringLocationName", ""),
            latitude=lat,
            longitude=lon,
            time=sample_time,
            parameter=row.get("CharacteristicName", ""),
            value=value,
            unit=row.get("ResultMeasure/MeasureUnitCode", ""),
            detection_limit=det_limit,
            detection_condition=detection if detection else None,
            sample_fraction=row.get("ResultSampleFractionText", ""),
            organization=row.get("OrganizationIdentifier", ""),
        ))
        count += 1

    logger.info(
        "WQP results: %d samples for %s in %s",
        len(samples),
        characteristic or "all parameters",
        county_fips,
    )
    return samples


async def fetch_key_contaminants(
    county_fips: str = KERN_COUNTY_FIPS,
    start_date: str = "01-01-2015",
) -> list[WQSample]:
    """Fetch all key contamination parameters for Kern County wells."""
    all_samples: list[WQSample] = []

    for param_name, info in PARAMETERS.items():
        try:
            samples = await fetch_results(
                county_fips=county_fips,
                characteristic=info["characteristic"],
                start_date=start_date,
                limit=5000,
            )
            all_samples.extend(samples)
        except Exception as e:
            logger.error("WQP fetch failed for %s: %s", param_name, e)

    return all_samples


def classify_contamination(parameter: str, value: float | None) -> dict[str, Any]:
    """Classify a measurement against drinking water standards."""
    if value is None:
        return {"level": "unknown", "exceedsMCL": False}

    mcl = MCL_LOOKUP.get(parameter)
    if mcl is None:
        return {"level": "detected", "exceedsMCL": False, "value": value}

    ratio = value / mcl
    if ratio >= 2.0:
        level = "high"
    elif ratio >= 1.0:
        level = "exceeds_mcl"
    elif ratio >= 0.5:
        level = "approaching"
    else:
        level = "safe"

    return {
        "level": level,
        "exceedsMCL": ratio >= 1.0,
        "value": value,
        "mcl": mcl,
        "ratio": round(ratio, 2),
    }


def _safe_float(val) -> float | None:
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None
