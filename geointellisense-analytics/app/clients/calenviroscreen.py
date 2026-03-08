"""
CalEnviroScreen 4.0 data loader.

Source: OEHHA via data.ca.gov
SHP download with census tract polygons + all CES component scores.
No API key required — public dataset.
"""

import io
import logging
import os
import tempfile
import zipfile
from typing import Any

import geopandas as gpd
import httpx

logger = logging.getLogger(__name__)

CES_SHP_URL = (
    "https://data.ca.gov/dataset/11eb2b90-f3c1-46b4-bdf2-ba1dab939dac/"
    "resource/8e6a8be3-bfc6-4592-b0c3-7aafd77bba2e/download/"
    "calenviroscreen40shp_f_2021.shp.zip"
)

# Map SHP column names → our DB column names
FIELD_MAP = {
    "Tract": "geoid",
    "ZIP": "zip",
    "County": "county",
    "ApproxLoc": "approx_location",
    "TotPop19": "population",
    "CIscore": "ces_score",
    "CIscoreP": "ces_percentile",
    "PollBurd": "pollution_burden",
    "PolBurdSc": "pollution_burden_score",
    "PolBurdP": "pollution_burden_pctl",
    "Ozone": "ozone",
    "OzoneP": "ozone_pctl",
    "PM2_5": "pm25",
    "PM2_5_P": "pm25_pctl",
    "DieselPM": "diesel_pm",
    "DieselPM_P": "diesel_pm_pctl",
    "Pesticide": "pesticides",
    "PesticideP": "pesticides_pctl",
    "Tox_Rel": "toxic_releases",
    "Tox_Rel_P": "toxic_releases_pctl",
    "Traffic": "traffic",
    "TrafficP": "traffic_pctl",
    "DrinkWat": "drinking_water",
    "DrinkWatP": "drinking_water_pctl",
    "Lead": "lead",
    "Lead_P": "lead_pctl",
    "Cleanup": "cleanup_sites",
    "CleanupP": "cleanup_sites_pctl",
    "GWThreat": "groundwater_threats",
    "GWThreatP": "groundwater_threats_pctl",
    "HazWaste": "haz_waste",
    "HazWasteP": "haz_waste_pctl",
    "SolWaste": "solid_waste",
    "SolWasteP": "solid_waste_pctl",
    "PopChar": "pop_characteristics",
    "PopCharSc": "pop_char_score",
    "PopCharP": "pop_char_pctl",
    "Asthma": "asthma",
    "AsthmaP": "asthma_pctl",
    "LowBirtWt": "low_birth_weight",
    "LowBirWP": "low_birth_weight_pctl",
    "Cardiovas": "cardiovascular",
    "CardiovasP": "cardiovascular_pctl",
    "Educatn": "education",
    "EducatP": "education_pctl",
    "Ling_Isol": "linguistic_isolation",
    "Ling_IsolP": "linguistic_isolation_pctl",
    "Poverty": "poverty",
    "PovertyP": "poverty_pctl",
    "Unempl": "unemployment",
    "UnemplP": "unemployment_pctl",
    "HousBurd": "housing_burden",
    "HousBurdP": "housing_burden_pctl",
}

# SJV county names to filter
SJV_COUNTIES = {"Kern", "Fresno", "Tulare", "Kings", "Merced", "San Joaquin", "Stanislaus", "Madera"}


async def download_and_parse(counties: set[str] | None = None) -> gpd.GeoDataFrame:
    """Download CES 4.0 SHP, filter to specified counties, return GeoDataFrame."""
    if counties is None:
        counties = SJV_COUNTIES

    logger.info("Downloading CalEnviroScreen 4.0 shapefile...")

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        resp = await client.get(CES_SHP_URL)
        resp.raise_for_status()

    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = os.path.join(tmpdir, "ces40.zip")
        with open(zip_path, "wb") as f:
            f.write(resp.content)

        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmpdir)

        # Find the .shp file
        shp_files = [f for f in os.listdir(tmpdir) if f.endswith(".shp")]
        if not shp_files:
            raise RuntimeError("No .shp file found in CalEnviroScreen ZIP")

        shp_path = os.path.join(tmpdir, shp_files[0])
        gdf = gpd.read_file(shp_path)

    # Filter to requested counties
    gdf = gdf[gdf["County"].isin(counties)].copy()

    # Ensure WGS84
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    logger.info("CalEnviroScreen: %d tracts loaded for %s", len(gdf), counties)
    return gdf


def gdf_to_records(gdf: gpd.GeoDataFrame) -> list[dict[str, Any]]:
    """Convert GeoDataFrame rows to dicts with our column names."""
    records = []
    for _, row in gdf.iterrows():
        rec: dict[str, Any] = {}
        for shp_col, db_col in FIELD_MAP.items():
            val = row.get(shp_col)
            if val is not None and hasattr(val, '__float__'):
                try:
                    import math
                    if math.isnan(float(val)):
                        val = None
                except (TypeError, ValueError):
                    pass
            rec[db_col] = val

        # Convert tract ID to string geoid
        if rec.get("geoid") is not None:
            rec["geoid"] = str(int(float(rec["geoid"])))

        # WKT geometry for PostGIS
        rec["geom_wkt"] = row.geometry.wkt if row.geometry else None

        records.append(rec)
    return records
