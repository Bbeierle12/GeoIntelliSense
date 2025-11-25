/**
 * Geospatial 3D Coordinate Utilities
 * Converts lat/lng coordinates to 3D world space for Three.js rendering
 */

import * as THREE from 'three';

// =============================================================================
// CONSTANTS
// =============================================================================

// San Joaquin Valley bounds
export const SAN_JOAQUIN_BOUNDS = {
  north: 38.5,
  south: 34.8,
  east: -118.5,
  west: -121.5,
  center: {
    lat: 36.65,
    lng: -120.0,
  },
};

// World scale factor (how many 3D units per degree)
export const WORLD_SCALE = 100;

// Earth radius in km for accurate calculations
export const EARTH_RADIUS_KM = 6371;

// =============================================================================
// COORDINATE TRANSFORMATIONS
// =============================================================================

/**
 * Convert latitude/longitude to 3D world coordinates
 * Uses Web Mercator projection centered on San Joaquin Valley
 */
export function latLngToWorld(
  lat: number,
  lng: number,
  elevation: number = 0
): THREE.Vector3 {
  const centerLat = SAN_JOAQUIN_BOUNDS.center.lat;
  const centerLng = SAN_JOAQUIN_BOUNDS.center.lng;

  // Convert to world units (x = east-west, z = north-south, y = up)
  const x = (lng - centerLng) * WORLD_SCALE;
  const z = -(lat - centerLat) * WORLD_SCALE; // Negative because Three.js z goes "into" screen
  const y = elevation * 0.001 * WORLD_SCALE; // Convert meters to scaled units

  return new THREE.Vector3(x, y, z);
}

/**
 * Convert 3D world coordinates back to latitude/longitude
 */
export function worldToLatLng(
  position: THREE.Vector3
): { lat: number; lng: number; elevation: number } {
  const centerLat = SAN_JOAQUIN_BOUNDS.center.lat;
  const centerLng = SAN_JOAQUIN_BOUNDS.center.lng;

  const lat = centerLat - position.z / WORLD_SCALE;
  const lng = centerLng + position.x / WORLD_SCALE;
  const elevation = (position.y / WORLD_SCALE) * 1000; // Convert back to meters

  return { lat, lng, elevation };
}

/**
 * Get the world bounds as a Three.js Box3
 */
export function getWorldBounds(): THREE.Box3 {
  const sw = latLngToWorld(SAN_JOAQUIN_BOUNDS.south, SAN_JOAQUIN_BOUNDS.west);
  const ne = latLngToWorld(SAN_JOAQUIN_BOUNDS.north, SAN_JOAQUIN_BOUNDS.east);

  return new THREE.Box3(
    new THREE.Vector3(Math.min(sw.x, ne.x), 0, Math.min(sw.z, ne.z)),
    new THREE.Vector3(Math.max(sw.x, ne.x), 10, Math.max(sw.z, ne.z))
  );
}

/**
 * Get the center of the world in 3D coordinates
 */
export function getWorldCenter(): THREE.Vector3 {
  return latLngToWorld(
    SAN_JOAQUIN_BOUNDS.center.lat,
    SAN_JOAQUIN_BOUNDS.center.lng
  );
}

/**
 * Calculate the approximate dimensions of the viewing area
 */
export function getWorldDimensions(): { width: number; height: number; depth: number } {
  const latRange = SAN_JOAQUIN_BOUNDS.north - SAN_JOAQUIN_BOUNDS.south;
  const lngRange = Math.abs(SAN_JOAQUIN_BOUNDS.east - SAN_JOAQUIN_BOUNDS.west);

  return {
    width: lngRange * WORLD_SCALE,
    height: 10 * WORLD_SCALE, // Max altitude in world units
    depth: latRange * WORLD_SCALE,
  };
}

// =============================================================================
// DISTANCE & CALCULATIONS
// =============================================================================

/**
 * Calculate the great-circle distance between two lat/lng points (in km)
 * Uses Haversine formula
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Convert degrees to radians
 */
export function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 */
export function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

// =============================================================================
// GRID GENERATION
// =============================================================================

/**
 * Generate a grid of 3D points covering the San Joaquin Valley
 */
export function generateWorldGrid(
  resolution: number = 20
): Array<{ position: THREE.Vector3; lat: number; lng: number }> {
  const points: Array<{ position: THREE.Vector3; lat: number; lng: number }> = [];

  const latRange = SAN_JOAQUIN_BOUNDS.north - SAN_JOAQUIN_BOUNDS.south;
  const lngRange = SAN_JOAQUIN_BOUNDS.east - SAN_JOAQUIN_BOUNDS.west;

  for (let i = 0; i <= resolution; i++) {
    for (let j = 0; j <= resolution; j++) {
      const lat = SAN_JOAQUIN_BOUNDS.south + (i / resolution) * latRange;
      const lng = SAN_JOAQUIN_BOUNDS.west + (j / resolution) * lngRange;
      const position = latLngToWorld(lat, lng);

      points.push({ position, lat, lng });
    }
  }

  return points;
}

/**
 * Generate terrain vertices for a plane mesh
 */
export function generateTerrainGeometry(
  resolution: number = 50,
  heightData?: Float32Array
): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const vertexCount = (resolution + 1) * (resolution + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  const bounds = getWorldBounds();
  const width = bounds.max.x - bounds.min.x;
  const depth = bounds.max.z - bounds.min.z;

  let vertexIndex = 0;
  let uvIndex = 0;

  for (let i = 0; i <= resolution; i++) {
    for (let j = 0; j <= resolution; j++) {
      const u = j / resolution;
      const v = i / resolution;

      const x = bounds.min.x + u * width;
      const z = bounds.min.z + v * depth;
      const y = heightData ? heightData[vertexIndex / 3] : 0;

      positions[vertexIndex++] = x;
      positions[vertexIndex++] = y;
      positions[vertexIndex++] = z;

      uvs[uvIndex++] = u;
      uvs[uvIndex++] = v;
    }
  }

  // Generate indices for triangles
  const indexCount = resolution * resolution * 6;
  const indices = new Uint32Array(indexCount);
  let index = 0;

  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      const topLeft = i * (resolution + 1) + j;
      const topRight = topLeft + 1;
      const bottomLeft = (i + 1) * (resolution + 1) + j;
      const bottomRight = bottomLeft + 1;

      // First triangle
      indices[index++] = topLeft;
      indices[index++] = bottomLeft;
      indices[index++] = topRight;

      // Second triangle
      indices[index++] = topRight;
      indices[index++] = bottomLeft;
      indices[index++] = bottomRight;
    }
  }

  return { positions, uvs, indices };
}

// =============================================================================
// CAMERA UTILITIES
// =============================================================================

/**
 * Calculate optimal camera position to view the entire valley
 */
export function getOptimalCameraPosition(
  pitch: number = 45,
  distance: number = 200
): THREE.Vector3 {
  const center = getWorldCenter();
  const pitchRad = toRadians(pitch);

  return new THREE.Vector3(
    center.x,
    center.y + distance * Math.sin(pitchRad),
    center.z + distance * Math.cos(pitchRad)
  );
}

/**
 * Calculate camera look-at target (center of valley)
 */
export function getCameraTarget(): THREE.Vector3 {
  return getWorldCenter();
}

// =============================================================================
// ELEVATION DATA
// =============================================================================

// Approximate elevation data for San Joaquin Valley cities (in meters)
export const CITY_ELEVATIONS: Record<string, number> = {
  Bakersfield: 123,
  Fresno: 94,
  Visalia: 102,
  Merced: 53,
  Modesto: 28,
  Stockton: 4,
};

/**
 * Generate a simple elevation model for the valley
 * Valley is lower in center, higher at edges (Sierra Nevada to east, Coast Range to west)
 */
export function getElevationAtPoint(lat: number, lng: number): number {
  const centerLat = SAN_JOAQUIN_BOUNDS.center.lat;
  const centerLng = SAN_JOAQUIN_BOUNDS.center.lng;

  // Distance from center (normalized 0-1)
  const latDist = Math.abs(lat - centerLat) / 2;
  const lngDist = Math.abs(lng - centerLng) / 1.5;

  // Valley floor is around 50-100m, edges rise to ~500m
  const baseElevation = 75;
  const edgeElevation = 400;

  // Simple bowl shape
  const distFromCenter = Math.sqrt(latDist * latDist + lngDist * lngDist);
  const elevation = baseElevation + distFromCenter * distFromCenter * edgeElevation;

  return Math.min(elevation, 500);
}

/**
 * Generate a height map for the terrain
 */
export function generateHeightMap(resolution: number = 50): Float32Array {
  const heightMap = new Float32Array((resolution + 1) * (resolution + 1));

  const latRange = SAN_JOAQUIN_BOUNDS.north - SAN_JOAQUIN_BOUNDS.south;
  const lngRange = SAN_JOAQUIN_BOUNDS.east - SAN_JOAQUIN_BOUNDS.west;

  let index = 0;
  for (let i = 0; i <= resolution; i++) {
    for (let j = 0; j <= resolution; j++) {
      const lat = SAN_JOAQUIN_BOUNDS.south + (i / resolution) * latRange;
      const lng = SAN_JOAQUIN_BOUNDS.west + (j / resolution) * lngRange;

      // Get elevation and convert to world units
      const elevation = getElevationAtPoint(lat, lng);
      heightMap[index++] = elevation * 0.001 * WORLD_SCALE * 0.1; // Scale down for visual
    }
  }

  return heightMap;
}
