/**
 * Air Quality Index (AQI) Constants
 *
 * This file contains shared constants for AQI thresholds, colors, and categories
 * used across the application to ensure consistency.
 */

export interface AQICategory {
  name: string;
  range: string;
  color: string;
  minValue: number;
  maxValue: number;
}

export const AQI_CATEGORIES: AQICategory[] = [
  { name: 'Good', range: '0-50', color: '#22c55e', minValue: 0, maxValue: 50 },
  { name: 'Moderate', range: '51-100', color: '#facc15', minValue: 51, maxValue: 100 },
  { name: 'Unhealthy for Sensitive', range: '101-150', color: '#f97316', minValue: 101, maxValue: 150 },
  { name: 'Unhealthy', range: '151-200', color: '#ef4444', minValue: 151, maxValue: 200 },
  { name: 'Very Unhealthy', range: '201-300', color: '#a855f7', minValue: 201, maxValue: 300 },
  { name: 'Hazardous', range: '301+', color: '#881337', minValue: 301, maxValue: Infinity },
];

/**
 * Get the color for a given AQI value
 * @param aqi - The AQI value
 * @returns Hex color code for the AQI level
 */
export const getAqiColor = (aqi: number): string => {
  if (aqi <= 50) return '#22c55e'; // green-500
  if (aqi <= 100) return '#facc15'; // yellow-400
  if (aqi <= 150) return '#f97316'; // orange-500
  if (aqi <= 200) return '#ef4444'; // red-500
  if (aqi <= 300) return '#a855f7'; // purple-500
  return '#881337'; // maroon-500
};

/**
 * Get the Tailwind CSS color class for a given AQI value
 * @param aqi - The AQI value
 * @returns Tailwind CSS color class
 */
export const getAqiColorClass = (aqi: number): string => {
  if (aqi <= 50) return 'text-green-500';
  if (aqi <= 100) return 'text-yellow-400';
  if (aqi <= 150) return 'text-orange-500';
  if (aqi <= 200) return 'text-red-500';
  if (aqi <= 300) return 'text-purple-500';
  return 'text-maroon-500';
};

/**
 * Get the AQI category for a given AQI value
 * @param aqi - The AQI value
 * @returns AQI category object
 */
export const getAqiCategory = (aqi: number): AQICategory => {
  const category = AQI_CATEGORIES.find(
    (cat) => aqi >= cat.minValue && aqi <= cat.maxValue
  );
  return category || AQI_CATEGORIES[AQI_CATEGORIES.length - 1]; // Return Hazardous as fallback
};

/**
 * Alert threshold - AQI values above this are considered alerts
 */
export const AQI_ALERT_THRESHOLD = 100;
