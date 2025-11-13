/**
 * Location Constants
 *
 * This file contains shared location coordinates and configuration
 * for the San Joaquin Valley region.
 */

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * San Joaquin Valley center coordinates (Fresno area)
 * Used as the default/fallback location for the application
 */
export const SAN_JOAQUIN_VALLEY_CENTER: Coordinates = {
  lat: 36.7378,
  lng: -119.7871,
};

/**
 * Default map zoom level for city view
 */
export const DEFAULT_CITY_ZOOM = 12;

/**
 * Default map zoom level for valley overview
 */
export const DEFAULT_VALLEY_ZOOM = 8;

/**
 * Search radius for location searches (in meters)
 */
export const SEARCH_RADIUS_METERS = 50000; // 50km
