"""
Landsat 8/9 client via Microsoft Planetary Computer STAC API.

Free access to Landsat Collection 2 Level-2 (surface reflectance).
No API key required for search or public COG access.

Uses cloud-optimized GeoTIFFs (COGs) served from Azure Blob Storage,
reading only the pixels needed via HTTP range requests (rasterio + vsicurl).
"""

import logging
import math
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import numpy as np

logger = logging.getLogger(__name__)

# Output directory for computed products (NDVI change maps)
DATA_DIR = Path(os.environ.get("LANDSAT_DATA_DIR", "/app/data/landsat"))

# Planetary Computer STAC endpoint
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

# Bakersfield AOI — bounding box [west, south, east, north]
BAKERSFIELD_BBOX = [-119.25, 35.20, -118.80, 35.55]

# WRS-2 path/row for Bakersfield area
BAKERSFIELD_PATH = 42
BAKERSFIELD_ROW = 35

# Landsat band names for surface reflectance (Collection 2 Level-2)
# Red = B4 (0.636-0.673 µm), NIR = B5 (0.851-0.879 µm)
RED_BAND = "red"    # SR_B4
NIR_BAND = "nir08"  # SR_B5


async def search_scenes(
    bbox: list[float] | None = None,
    date_range: str | None = None,
    max_cloud: int = 20,
    limit: int = 10,
    collections: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Search Planetary Computer STAC for Landsat scenes.

    Args:
        bbox: [west, south, east, north] in EPSG:4326
        date_range: STAC datetime string, e.g. "2024-01-01/2024-12-31"
        max_cloud: Maximum cloud cover percentage
        limit: Max results
        collections: STAC collection IDs (default: landsat-c2-l2)
    """
    if bbox is None:
        bbox = BAKERSFIELD_BBOX
    if collections is None:
        collections = ["landsat-c2-l2"]

    body: dict[str, Any] = {
        "collections": collections,
        "bbox": bbox,
        "limit": limit,
        "query": {
            "eo:cloud_cover": {"lt": max_cloud},
        },
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
    }

    if date_range:
        body["datetime"] = date_range

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{STAC_URL}/search", json=body)
        resp.raise_for_status()
        data = resp.json()

    features = data.get("features", [])
    logger.info("STAC search: %d scenes found (cloud<%d%%)", len(features), max_cloud)

    return [_parse_scene(f) for f in features]


def _parse_scene(feature: dict) -> dict[str, Any]:
    """Extract useful metadata from a STAC feature."""
    props = feature.get("properties", {})
    assets = feature.get("assets", {})

    # Get COG URLs for key bands
    band_urls = {}
    for band_key in [RED_BAND, NIR_BAND, "blue", "green", "swir16"]:
        asset = assets.get(band_key)
        if asset:
            band_urls[band_key] = asset.get("href", "")

    # Thumbnail
    thumbnail = ""
    for thumb_key in ["rendered_preview", "thumbnail"]:
        if thumb_key in assets:
            thumbnail = assets[thumb_key].get("href", "")
            break

    return {
        "id": feature.get("id", ""),
        "datetime": props.get("datetime", ""),
        "cloudCover": props.get("eo:cloud_cover"),
        "satellite": props.get("platform", ""),
        "instrument": props.get("instruments", []),
        "pathRow": f"{props.get('landsat:wrs_path', '?')}/{props.get('landsat:wrs_row', '?')}",
        "processingLevel": props.get("landsat:correction", ""),
        "bbox": feature.get("bbox"),
        "bandUrls": band_urls,
        "thumbnail": thumbnail,
        "stacId": feature.get("id"),
        "collection": props.get("collection", feature.get("collection", "")),
    }


async def get_target_scenes(
    max_cloud: int = 15,
) -> dict[str, list[dict]]:
    """Get the scenes needed for change detection:
    - 2 most recent cloud-free scenes
    - Scenes from ~5 years ago
    - Scenes from ~10 years ago

    Groups results by era for easy comparison.
    """
    current_year = date.today().year

    eras = {
        "current": f"{current_year - 1}-01-01/{current_year}-12-31",
        "5yr_ago": f"{current_year - 6}-01-01/{current_year - 5}-12-31",
        "10yr_ago": f"{current_year - 11}-01-01/{current_year - 10}-12-31",
    }

    result: dict[str, list[dict]] = {}

    for era_name, date_range in eras.items():
        limit = 2 if era_name == "current" else 1
        try:
            scenes = await search_scenes(
                date_range=date_range,
                max_cloud=max_cloud,
                limit=limit,
            )
            result[era_name] = scenes
        except Exception as e:
            logger.error("STAC search failed for %s: %s", era_name, e)
            result[era_name] = []

    return result


async def compute_ndvi(scene: dict, bbox: list[float] | None = None) -> np.ndarray | None:
    """Compute NDVI from a scene's Red and NIR bands.

    Reads COGs via HTTP range requests (rasterio vsicurl).
    Returns a 2D float32 array of NDVI values [-1, 1].
    """
    import rasterio
    from rasterio.windows import from_bounds as window_from_bounds

    red_url = scene.get("bandUrls", {}).get(RED_BAND)
    nir_url = scene.get("bandUrls", {}).get(NIR_BAND)

    if not red_url or not nir_url:
        logger.warning("Scene %s missing Red/NIR band URLs", scene.get("id"))
        return None

    if bbox is None:
        bbox = BAKERSFIELD_BBOX

    # Sign the URLs via Planetary Computer (required for Azure blob access)
    red_url = await _sign_url(red_url)
    nir_url = await _sign_url(nir_url)

    try:
        # Read Red band via vsicurl
        with rasterio.open(red_url) as red_ds:
            # Reproject bbox to the raster's CRS for windowed read
            from rasterio.warp import transform_bounds
            dst_bounds = transform_bounds("EPSG:4326", red_ds.crs, *bbox)
            window = window_from_bounds(*dst_bounds, red_ds.transform)

            red = red_ds.read(1, window=window).astype(np.float32)
            transform = red_ds.window_transform(window)
            nodata_r = red_ds.nodata

        with rasterio.open(nir_url) as nir_ds:
            dst_bounds_n = transform_bounds("EPSG:4326", nir_ds.crs, *bbox)
            window_n = window_from_bounds(*dst_bounds_n, nir_ds.transform)
            nir = nir_ds.read(1, window=window_n, out_shape=red.shape).astype(np.float32)
            nodata_n = nir_ds.nodata

        # Apply scale factor for Landsat Collection 2 Level-2
        # Surface reflectance scale: 0.0000275, offset: -0.2
        red = red * 0.0000275 - 0.2
        nir = nir * 0.0000275 - 0.2

        # Mask invalid pixels
        mask = np.ones_like(red, dtype=bool)
        if nodata_r is not None:
            mask &= red != (nodata_r * 0.0000275 - 0.2)
        if nodata_n is not None:
            mask &= nir != (nodata_n * 0.0000275 - 0.2)
        mask &= (red + nir) != 0  # Avoid division by zero
        mask &= (red > 0) & (nir > 0)  # Physical range

        ndvi = np.full_like(red, np.nan)
        ndvi[mask] = (nir[mask] - red[mask]) / (nir[mask] + red[mask])
        ndvi = np.clip(ndvi, -1.0, 1.0)

        return ndvi

    except Exception as e:
        logger.error("NDVI computation failed for %s: %s", scene.get("id"), e)
        return None


async def compute_ndvi_change(
    current_scene: dict,
    historical_scene: dict,
    bbox: list[float] | None = None,
) -> dict[str, Any] | None:
    """Compute NDVI difference between two scenes.

    Returns metadata + saves the change GeoTIFF to disk.
    Positive values = vegetation gain, negative = vegetation loss.
    """
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.warp import transform_bounds

    if bbox is None:
        bbox = BAKERSFIELD_BBOX

    logger.info(
        "Computing NDVI change: %s vs %s",
        current_scene.get("id"), historical_scene.get("id"),
    )

    ndvi_current = await compute_ndvi(current_scene, bbox)
    ndvi_historical = await compute_ndvi(historical_scene, bbox)

    if ndvi_current is None or ndvi_historical is None:
        return None

    # Resample to common shape if needed
    target_shape = ndvi_current.shape
    if ndvi_historical.shape != target_shape:
        from scipy.ndimage import zoom
        zoom_factors = (
            target_shape[0] / ndvi_historical.shape[0],
            target_shape[1] / ndvi_historical.shape[1],
        )
        ndvi_historical = zoom(ndvi_historical, zoom_factors, order=1)

    # Compute difference
    change = ndvi_current - ndvi_historical

    # Only where both are valid
    valid = ~np.isnan(ndvi_current) & ~np.isnan(ndvi_historical)
    change[~valid] = np.nan

    # Statistics
    valid_change = change[valid]
    if len(valid_change) == 0:
        return None

    current_dt = current_scene.get("datetime", "unknown")
    historical_dt = historical_scene.get("datetime", "unknown")

    # Save as GeoTIFF
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    current_id = current_scene.get("id", "current")[:20]
    hist_id = historical_scene.get("id", "historical")[:20]
    filename = f"ndvi_change_{hist_id}_to_{current_id}.tif"
    out_path = DATA_DIR / filename

    h, w = change.shape
    transform = from_bounds(bbox[0], bbox[1], bbox[2], bbox[3], w, h)

    with rasterio.open(
        out_path, "w",
        driver="GTiff",
        height=h, width=w,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=transform,
        nodata=np.nan,
    ) as dst:
        dst.write(change, 1)

    logger.info("NDVI change map saved: %s (%dx%d)", out_path, w, h)

    return {
        "currentScene": current_scene.get("id"),
        "historicalScene": historical_scene.get("id"),
        "currentDate": current_dt,
        "historicalDate": historical_dt,
        "filename": filename,
        "shape": [h, w],
        "bbox": bbox,
        "stats": {
            "mean": round(float(np.nanmean(valid_change)), 4),
            "median": round(float(np.nanmedian(valid_change)), 4),
            "std": round(float(np.nanstd(valid_change)), 4),
            "min": round(float(np.nanmin(valid_change)), 4),
            "max": round(float(np.nanmax(valid_change)), 4),
            "vegetationGainPct": round(float(np.sum(valid_change > 0.05) / len(valid_change) * 100), 1),
            "vegetationLossPct": round(float(np.sum(valid_change < -0.05) / len(valid_change) * 100), 1),
            "stablePct": round(float(np.sum(np.abs(valid_change) <= 0.05) / len(valid_change) * 100), 1),
            "validPixels": int(len(valid_change)),
        },
    }


def render_ndvi_change_tile(filename: str, z: int, x: int, y: int) -> bytes | None:
    """Render a 256x256 NDVI change visualization tile from a saved GeoTIFF.

    Green = vegetation gain, Red = vegetation loss, transparent = no data/stable.
    """
    import rasterio
    from rasterio.windows import from_bounds as window_from_bounds

    path = DATA_DIR / filename
    if not path.exists():
        return None

    # Convert XYZ tile coords to lat/lon bbox
    n = 2 ** z
    west = x / n * 360 - 180
    east = (x + 1) / n * 360 - 180
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))

    try:
        with rasterio.open(path) as ds:
            # Check if tile bbox overlaps raster bounds
            rb = ds.bounds
            if east <= rb.left or west >= rb.right or north <= rb.bottom or south >= rb.top:
                return None

            # Clamp to raster bounds
            req_west = max(west, rb.left)
            req_east = min(east, rb.right)
            req_south = max(south, rb.bottom)
            req_north = min(north, rb.top)

            window = window_from_bounds(req_west, req_south, req_east, req_north, ds.transform)

            size = 256
            col_start = int((req_west - west) / (east - west) * size)
            col_end = int((req_east - west) / (east - west) * size)
            row_start = int((north - req_north) / (north - south) * size)
            row_end = int((north - req_south) / (north - south) * size)

            out_h = max(row_end - row_start, 1)
            out_w = max(col_end - col_start, 1)

            data = ds.read(1, window=window, out_shape=(out_h, out_w)).astype(np.float32)

    except Exception:
        return None

    # Build full tile grid
    grid = np.full((256, 256), np.nan, dtype=np.float32)
    grid[row_start:row_start + out_h, col_start:col_start + out_w] = data

    if np.all(np.isnan(grid)):
        return None

    rgba = _ndvi_change_colormap(grid)

    from app.clients.dem import _encode_png
    return _encode_png(rgba)


def _ndvi_change_colormap(grid: np.ndarray) -> np.ndarray:
    """Colormap for NDVI change: red=loss, yellow=stable, green=gain."""
    h, w = grid.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    valid = ~np.isnan(grid)
    if not np.any(valid):
        return rgba

    # Diverging colormap centered at 0
    # Clamp to [-0.3, 0.3] for visualization
    clamped = np.clip(grid, -0.3, 0.3)
    norm = (clamped + 0.3) / 0.6  # Map to [0, 1]

    # Color stops: red → yellow → green
    stops = [
        (0.00, 180, 30, 30),    # strong loss — red
        (0.25, 220, 100, 40),   # moderate loss — orange-red
        (0.45, 240, 220, 80),   # slight loss — yellow
        (0.55, 200, 230, 100),  # slight gain — yellow-green
        (0.75, 80, 180, 60),    # moderate gain — green
        (1.00, 20, 120, 30),    # strong gain — dark green
    ]

    r_vals = np.interp(norm, [s[0] for s in stops], [s[1] for s in stops])
    g_vals = np.interp(norm, [s[0] for s in stops], [s[2] for s in stops])
    b_vals = np.interp(norm, [s[0] for s in stops], [s[3] for s in stops])

    rgba[:, :, 0] = np.where(valid, np.clip(r_vals, 0, 255).astype(np.uint8), 0)
    rgba[:, :, 1] = np.where(valid, np.clip(g_vals, 0, 255).astype(np.uint8), 0)
    rgba[:, :, 2] = np.where(valid, np.clip(b_vals, 0, 255).astype(np.uint8), 0)

    # Alpha: transparent for near-zero change, opaque for significant change
    abs_change = np.abs(grid)
    alpha = np.where(valid, np.clip(abs_change / 0.1 * 180, 40, 200).astype(np.uint8), 0)
    rgba[:, :, 3] = alpha

    return rgba


def get_computed_products() -> list[dict[str, Any]]:
    """List available computed NDVI change maps on disk."""
    if not DATA_DIR.exists():
        return []

    products = []
    for f in DATA_DIR.glob("ndvi_change_*.tif"):
        products.append({
            "filename": f.name,
            "sizeMB": round(f.stat().st_size / 1048576, 2),
            "tileUrl": f"/api/landsat/tile/ndvi-change/{f.stem}/{{z}}/{{x}}/{{y}}.png",
        })

    return products


async def _sign_url(url: str) -> str:
    """Sign a Planetary Computer URL for blob access.

    The PC provides a token endpoint that adds a SAS token to Azure blob URLs.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://planetarycomputer.microsoft.com/api/sas/v1/sign",
                params={"href": url},
            )
            resp.raise_for_status()
            return resp.json().get("href", url)
    except Exception as e:
        logger.warning("PC URL signing failed, trying unsigned: %s", e)
        return url
