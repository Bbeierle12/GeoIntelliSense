/**
 * Input Validation Constants
 *
 * This file contains shared validation limits for user inputs
 * to ensure consistency across the application.
 */

/**
 * Search input validation
 */
export const SEARCH_INPUT = {
  MIN_LENGTH: 2,
  MAX_LENGTH: 100,
} as const;

/**
 * Analysis prompt validation
 */
export const ANALYSIS_PROMPT = {
  MIN_LENGTH: 2,
  MAX_LENGTH: 5000,
} as const;

/**
 * Custom factors validation (for predictive analysis)
 */
export const CUSTOM_FACTORS = {
  MAX_LENGTH: 2000,
} as const;

/**
 * Error messages for validation
 */
export const VALIDATION_ERRORS = {
  EMPTY_INPUT: 'Please enter a search term.',
  TOO_SHORT: (min: number) => `Please enter at least ${min} characters.`,
  TOO_LONG: (max: number) => `Input is too long. Please limit to ${max} characters.`,
  INVALID_DATE_RANGE: 'Start date cannot be after end date.',
  LOCATION_UNAVAILABLE: 'Location not available. Please enable location services.',
  INVALID_DATA: 'Invalid data received.',
} as const;
