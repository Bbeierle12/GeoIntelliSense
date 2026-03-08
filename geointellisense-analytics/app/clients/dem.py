"""
USGS 3DEP DEM client.

Downloads and manages 1/3 arc-second (~10m) DEM tiles from the
USGS National Map. Provides elevation lookups and profile extraction
from GeoTIFF files stored locally.

Coverage: Bakersfield metro + surrounding valley and mountain ranges
for terrain-aware air quality analysis.
"""

import logging
import math
import os
from pathlib import Path
from typing import Any

import httpx
import numpy as np

logger = logging.getLogger(__name__)

# Data directory for DEM tiles
DATA_DIR = Path(os.environ.get("DEM_DATA_DIR", "/app/data/dem"))

# USGS 3DEP 1/3 arc-second DEM — covers 1°x1° tiles
# The SJV bowl spans roughly 34.5°N-37°N, 121°W-118°W
# Key tiles for Bakersfield + surrounding terrain:
#   n36w120 — Bakersfield metro, southern SJV
#   n36w119 — Eastern Kern County, Sierra foothills
#   n35w119 — Southern Kern, Tehachapi area
#   n36w121 — Coast Ranges west of SJV

TILES = {
    "n36w120": {
        "name": "Bakersfield Metro / Southern SJV",
        "url": "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/historical/n36w120/USGS_13_n36w120.tif",
        "bounds": {"north": 36.0, "south": 35.0, "east": -119.0, "west": -120.0},
    },
    "n36w119": {
        "name": "Eastern Kern / Sierra Foothills",
        "url": "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/historical/n36w119/USGS_13_n36w119.tif",
        "bounds": {"north": 36.0, "south": 35.0, "east": -118.0, "west": -119.0},
    },
    "n35w119": {
        "name": "Southern Kern / Tehachapi",
        "url": "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/historical/n35w119/USGS_13_n35w119.tif",
        "bounds": {"north": 35.0, "south": 34.0, "east": -118.0, "west": -119.0},
    },
    "n36w121": {
        "name": "Coast Ranges",
        "url": "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/historical/n36w121/USGS_13_n36w121.tif",
        "bounds": {"north": 36.0, "south": 35.0, "east": -120.0, "west": -121.0},
    },
}

# Bakersfield reference
BAKERSFIELD_LAT = 35.3733
BAKERSFIELD_LNG = -119.0187

# Cache open rasterio datasets
_open_datasets: dict[str, Any] = {}


def add_tile(tile_id: str, name: str, bounds: dict[str, float]) -> None:
    """Register a new DEM tile for any CONUS location.

    The USGS 3DEP 1/3 arc-second tiles follow a naming convention:
      tile_id: "n{north_lat}w{abs_west_lon}" e.g. "n41w112" for Salt Lake City area
      URL auto-generated from tile_id.
      bounds: {"north": N, "south": S, "east": E, "west": W}

    Usage: add_tile("n41w112", "Salt Lake City", {"north": 41, "south": 40, "east": -111, "west": -112})
    Then call download_tile("n41w112") to fetch it.
    """
    url = f"https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/historical/{tile_id}/USGS_13_{tile_id}.tif"
    TILES[tile_id] = {"name": name, "url": url, "bounds": bounds}


def add_tile(tile_id: str, name: str, url: str, bounds: dict[str, float]) -> None:
    """Register an additional DEM tile at runtime.

    Args:
        tile_id: Unique identifier for the tile (e.g. "n37w122").
        name: Human-readable name (e.g. "San Francisco Bay Area").
        url: Download URL for the GeoTIFF.
        bounds: Dict with keys north, south, east, west (EPSG:4326).
    """
    for key in ("north", "south", "east", "west"):
        if key not in bounds:
            raise ValueError(f"bounds must include '{key}'")
    TILES[tile_id] = {"name": name, "url": url, "bounds": bounds}
    logger.info("Registered DEM tile %s (%s)", tile_id, name)


def _tile_for_point(lat: float, lon: float) -> str | None:
    """Find which DEM tile covers a given lat/lon."""
    for tile_id, info in TILES.items():
        b = info["bounds"]
        if b["south"] <= lat <= b["north"] and b["west"] <= lon <= b["east"]:
            return tile_id
    return None


def _tile_path(tile_id: str) -> Path:
    return DATA_DIR / f"{tile_id}.tif"


def get_available_tiles() -> list[dict[str, Any]]:
    """List which tiles are downloaded and which are pending."""
    result = []
    for tile_id, info in TILES.items():
        path = _tile_path(tile_id)
        result.append({
            "id": tile_id,
            "name": info["name"],
            "bounds": info["bounds"],
            "downloaded": path.exists(),
            "sizeMB": round(path.stat().st_size / 1048576, 1) if path.exists() else None,
        })
    return result


async def download_tile(tile_id: str) -> Path:
    """Download a DEM tile from USGS 3DEP if not already present."""
    if tile_id not in TILES:
        raise ValueError(f"Unknown tile: {tile_id}. Available: {list(TILES.keys())}")

    path = _tile_path(tile_id)
    if path.exists():
        logger.info("DEM tile %s already exists (%d MB)", tile_id, path.stat().st_size // 1048576)
        return path

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    url = TILES[tile_id]["url"]
    logger.info("Downloading DEM tile %s from USGS 3DEP...", tile_id)

    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()

        with open(path, "wb") as f:
            f.write(resp.content)

    size_mb = path.stat().st_size / 1048576
    logger.info("DEM tile %s downloaded: %.1f MB", tile_id, size_mb)
    return path


async def download_all_tiles() -> list[str]:
    """Download all configured DEM tiles."""
    downloaded = []
    for tile_id in TILES:
        try:
            await download_tile(tile_id)
            downloaded.append(tile_id)
        except Exception as e:
            logger.error("Failed to download DEM tile %s: %s", tile_id, e)
    return downloaded


def _get_dataset(tile_id: str):
    """Get or open a rasterio dataset for a tile."""
    import rasterio

    if tile_id in _open_datasets:
        return _open_datasets[tile_id]

    path = _tile_path(tile_id)
    if not path.exists():
        return None

    ds = rasterio.open(path)
    _open_datasets[tile_id] = ds
    return ds


def elevation_at_point(lat: float, lon: float) -> float | None:
    """Get elevation in meters at a lat/lon point."""
    tile_id = _tile_for_point(lat, lon)
    if tile_id is None:
        return None

    ds = _get_dataset(tile_id)
    if ds is None:
        return None

    # Convert lat/lon to pixel coordinates
    row, col = ds.index(lon, lat)

    # Read the single pixel
    band = ds.read(1, window=((row, row + 1), (col, col + 1)))
    val = float(band[0, 0])

    # NoData check
    if ds.nodata is not None and val == ds.nodata:
        return None

    return round(val, 1)


def elevation_profile(
    lat1: float, lon1: float, lat2: float, lon2: float, num_points: int = 200
) -> list[dict[str, float]]:
    """Extract an elevation profile along a line between two points.

    Returns a list of {lat, lon, elevation, distanceKm} dicts.
    """
    points = []

    for i in range(num_points):
        frac = i / (num_points - 1)
        lat = lat1 + frac * (lat2 - lat1)
        lon = lon1 + frac * (lon2 - lon1)
        elev = elevation_at_point(lat, lon)

        # Calculate distance from start using Haversine
        dist_km = _haversine(lat1, lon1, lat, lon)

        points.append({
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "elevation": elev,
            "distanceKm": round(dist_km, 2),
        })

    return points


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in km between two lat/lon points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def render_terrain_tile(z: int, x: int, y: int) -> bytes | None:
    """Render a 256x256 terrain visualization PNG tile from DEM data.

    Uses windowed reads for performance, then hillshading + hypsometric tinting.
    Returns PNG bytes or None if no DEM data covers this tile.
    """
    from rasterio.windows import from_bounds as window_from_bounds

    # Convert XYZ tile coords to lat/lon bbox
    n = 2 ** z
    west = x / n * 360 - 180
    east = (x + 1) / n * 360 - 180
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))

    # Find which DEM tiles cover this bbox
    covering_tiles = []
    for tile_id, info in TILES.items():
        b = info["bounds"]
        if b["east"] > west and b["west"] < east and b["north"] > south and b["south"] < north:
            ds = _get_dataset(tile_id)
            if ds is not None:
                covering_tiles.append((tile_id, ds))

    if not covering_tiles:
        return None

    size = 256
    grid = np.full((size, size), np.nan, dtype=np.float32)

    # Use windowed reads — much faster than per-pixel
    for tile_id, ds in covering_tiles:
        b = TILES[tile_id]["bounds"]
        # Clamp request bbox to tile bounds
        req_west = max(west, b["west"])
        req_east = min(east, b["east"])
        req_south = max(south, b["south"])
        req_north = min(north, b["north"])

        if req_west >= req_east or req_south >= req_north:
            continue

        try:
            window = window_from_bounds(req_west, req_south, req_east, req_north, ds.transform)
            # Read with output shape for automatic resampling
            # Calculate which portion of the 256x256 tile this covers
            col_start = int((req_west - west) / (east - west) * size)
            col_end = int((req_east - west) / (east - west) * size)
            row_start = int((north - req_north) / (north - south) * size)
            row_end = int((north - req_south) / (north - south) * size)

            out_h = max(row_end - row_start, 1)
            out_w = max(col_end - col_start, 1)

            data = ds.read(1, window=window, out_shape=(out_h, out_w)).astype(np.float32)

            # Replace nodata with NaN
            if ds.nodata is not None:
                data[data == ds.nodata] = np.nan

            grid[row_start:row_start + out_h, col_start:col_start + out_w] = data

        except Exception:
            continue

    if np.all(np.isnan(grid)):
        return None

    # Generate hillshade + hypsometric tint
    rgba = _hillshade_tint(grid)

    # Encode as PNG
    return _encode_png(rgba)


def _hillshade_tint(grid: np.ndarray) -> np.ndarray:
    """Produce RGBA terrain visualization from elevation grid.

    Combines hypsometric tinting (elevation → color) with hillshading.
    """
    h, w = grid.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    # Replace NaN for computation
    valid = ~np.isnan(grid)
    if not np.any(valid):
        return rgba

    clean = np.where(valid, grid, 0)

    # Hillshade: compute using gradients
    dy, dx = np.gradient(clean)
    azimuth = math.radians(315)
    altitude = math.radians(45)
    slope = np.arctan(np.sqrt(dx**2 + dy**2))
    aspect = np.arctan2(-dy, dx)
    shade = (
        np.sin(altitude) * np.cos(slope)
        + np.cos(altitude) * np.sin(slope) * np.cos(azimuth - aspect)
    )
    shade = np.clip(shade, 0, 1)

    # Hypsometric color ramp (meters → RGB)
    # Valley floor (~100m): green/tan
    # Foothills (~500m): olive/brown
    # Mountains (~1500m+): gray/white
    elev_min = float(np.nanmin(grid))
    elev_max = float(np.nanmax(grid))
    elev_range = max(elev_max - elev_min, 1.0)

    norm = np.clip((clean - elev_min) / elev_range, 0, 1)

    # Color stops: [elevation_fraction, R, G, B]
    stops = [
        (0.00, 110, 140, 90),   # valley floor — muted green
        (0.15, 160, 155, 100),  # low foothills — olive
        (0.35, 180, 160, 120),  # foothills — tan
        (0.55, 160, 140, 120),  # mid mountains — brown-gray
        (0.75, 180, 180, 180),  # high mountains — gray
        (1.00, 240, 240, 245),  # peaks — near white
    ]

    # Interpolate colors
    r_vals = np.interp(norm, [s[0] for s in stops], [s[1] for s in stops])
    g_vals = np.interp(norm, [s[0] for s in stops], [s[2] for s in stops])
    b_vals = np.interp(norm, [s[0] for s in stops], [s[3] for s in stops])

    # Blend with hillshade
    shade_factor = 0.3 + 0.7 * shade  # Don't go fully black in shadows
    rgba[:, :, 0] = np.clip(r_vals * shade_factor, 0, 255).astype(np.uint8)
    rgba[:, :, 1] = np.clip(g_vals * shade_factor, 0, 255).astype(np.uint8)
    rgba[:, :, 2] = np.clip(b_vals * shade_factor, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = np.where(valid, 200, 0).astype(np.uint8)  # Semi-transparent

    return rgba


def _encode_png(rgba: np.ndarray) -> bytes:
    """Encode RGBA numpy array as PNG bytes using zlib (no PIL dependency)."""
    import struct
    import zlib

    h, w, _ = rgba.shape

    # PNG signature
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    ihdr = _png_chunk(b'IHDR', ihdr_data)

    # IDAT chunk — raw pixel data with filter byte 0 (none) per row
    raw = b''
    for row in range(h):
        raw += b'\x00'  # filter byte
        raw += rgba[row].tobytes()
    compressed = zlib.compress(raw)
    idat = _png_chunk(b'IDAT', compressed)

    # IEND chunk
    iend = _png_chunk(b'IEND', b'')

    return sig + ihdr + idat + iend


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    """Create a PNG chunk with CRC."""
    import struct
    import zlib

    chunk = chunk_type + data
    return struct.pack('>I', len(data)) + chunk + struct.pack('>I', zlib.crc32(chunk) & 0xFFFFFFFF)
