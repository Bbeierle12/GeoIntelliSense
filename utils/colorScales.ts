/**
 * Color Scales and Mappings for Air Quality Visualization
 * Includes AQI-specific colors, gradient generators, and texture utilities
 */

import * as THREE from 'three';

// =============================================================================
// AQI STANDARD COLOR SCALES
// =============================================================================

/**
 * EPA AQI Categories and Colors
 */
export const AQI_CATEGORIES = {
  good: { range: [0, 50], color: '#00e400', label: 'Good', description: 'Air quality is satisfactory' },
  moderate: { range: [51, 100], color: '#ffff00', label: 'Moderate', description: 'Acceptable air quality' },
  unhealthySensitive: { range: [101, 150], color: '#ff7e00', label: 'Unhealthy for Sensitive Groups', description: 'Sensitive individuals may experience effects' },
  unhealthy: { range: [151, 200], color: '#ff0000', label: 'Unhealthy', description: 'Everyone may experience effects' },
  veryUnhealthy: { range: [201, 300], color: '#8f3f97', label: 'Very Unhealthy', description: 'Health alert: everyone may experience serious effects' },
  hazardous: { range: [301, 500], color: '#7e0023', label: 'Hazardous', description: 'Emergency conditions' },
} as const;

/**
 * Get AQI category for a given value
 */
export function getAQICategory(aqi: number): keyof typeof AQI_CATEGORIES {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthySensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'veryUnhealthy';
  return 'hazardous';
}

/**
 * Get color for AQI value
 */
export function getAQIColor(aqi: number): string {
  const category = getAQICategory(aqi);
  return AQI_CATEGORIES[category].color;
}

/**
 * Get AQI color as THREE.Color
 */
export function getAQIColorThree(aqi: number): THREE.Color {
  return new THREE.Color(getAQIColor(aqi));
}

// =============================================================================
// CONTINUOUS COLOR GRADIENTS
// =============================================================================

/**
 * Color stop definition
 */
export interface ColorStop {
  position: number; // 0-1 normalized position
  color: string;
}

/**
 * Standard AQI gradient stops (0-500 scale normalized to 0-1)
 */
export const AQI_GRADIENT_STOPS: ColorStop[] = [
  { position: 0, color: '#00e400' },       // Good (0)
  { position: 0.1, color: '#00e400' },     // Good (50)
  { position: 0.2, color: '#ffff00' },     // Moderate (100)
  { position: 0.3, color: '#ff7e00' },     // USG (150)
  { position: 0.4, color: '#ff0000' },     // Unhealthy (200)
  { position: 0.6, color: '#8f3f97' },     // Very Unhealthy (300)
  { position: 1.0, color: '#7e0023' },     // Hazardous (500)
];

/**
 * Temperature gradient (cold to hot)
 */
export const TEMPERATURE_GRADIENT_STOPS: ColorStop[] = [
  { position: 0, color: '#313695' },     // Very cold (dark blue)
  { position: 0.2, color: '#4575b4' },   // Cold (blue)
  { position: 0.4, color: '#74add1' },   // Cool (light blue)
  { position: 0.5, color: '#ffffbf' },   // Mild (yellow)
  { position: 0.6, color: '#fdae61' },   // Warm (orange)
  { position: 0.8, color: '#f46d43' },   // Hot (red-orange)
  { position: 1.0, color: '#a50026' },   // Very hot (dark red)
];

/**
 * Humidity gradient (dry to wet)
 */
export const HUMIDITY_GRADIENT_STOPS: ColorStop[] = [
  { position: 0, color: '#ffffd4' },     // Very dry (light yellow)
  { position: 0.25, color: '#fed98e' },  // Dry (yellow-orange)
  { position: 0.5, color: '#41b6c4' },   // Moderate (teal)
  { position: 0.75, color: '#225ea8' },  // Humid (blue)
  { position: 1.0, color: '#081d58' },   // Very humid (dark blue)
];

/**
 * Wind speed gradient
 */
export const WIND_SPEED_GRADIENT_STOPS: ColorStop[] = [
  { position: 0, color: '#f7fcf0' },     // Calm (light green)
  { position: 0.2, color: '#addd8e' },   // Light (green)
  { position: 0.4, color: '#78c679' },   // Moderate (medium green)
  { position: 0.6, color: '#238b45' },   // Fresh (dark green)
  { position: 0.8, color: '#005a32' },   // Strong (forest green)
  { position: 1.0, color: '#004529' },   // Gale (very dark green)
];

// =============================================================================
// COLOR INTERPOLATION
// =============================================================================

/**
 * Parse hex color to RGB components
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Convert RGB to hex string
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Interpolate between color stops at a given position
 */
export function interpolateColorStops(stops: ColorStop[], position: number): string {
  // Clamp position
  const t = Math.max(0, Math.min(1, position));

  // Find surrounding stops
  let lower = stops[0];
  let upper = stops[stops.length - 1];

  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].position && t <= stops[i + 1].position) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  // Calculate local interpolation factor
  const range = upper.position - lower.position;
  const localT = range > 0 ? (t - lower.position) / range : 0;

  // Interpolate RGB
  const lowerRgb = hexToRgb(lower.color);
  const upperRgb = hexToRgb(upper.color);

  const r = lowerRgb.r + (upperRgb.r - lowerRgb.r) * localT;
  const g = lowerRgb.g + (upperRgb.g - lowerRgb.g) * localT;
  const b = lowerRgb.b + (upperRgb.b - lowerRgb.b) * localT;

  return rgbToHex(r, g, b);
}

/**
 * Get interpolated AQI color for smooth gradients
 */
export function getInterpolatedAQIColor(aqi: number, maxAqi: number = 500): string {
  const position = Math.max(0, Math.min(1, aqi / maxAqi));
  return interpolateColorStops(AQI_GRADIENT_STOPS, position);
}

// =============================================================================
// THREE.JS TEXTURE GENERATION
// =============================================================================

/**
 * Generate a gradient texture from color stops
 */
export function createGradientTexture(
  stops: ColorStop[],
  width: number = 256,
  height: number = 1
): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);

  for (let x = 0; x < width; x++) {
    const position = x / (width - 1);
    const color = interpolateColorStops(stops, position);
    const rgb = hexToRgb(color);

    const index = x * 4;
    data[index] = rgb.r;
    data[index + 1] = rgb.g;
    data[index + 2] = rgb.b;
    data[index + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Create AQI lookup texture (1D)
 */
export function createAQILookupTexture(maxAqi: number = 500): THREE.DataTexture {
  return createGradientTexture(AQI_GRADIENT_STOPS, maxAqi + 1);
}

/**
 * Generate a 2D data texture from a value matrix
 */
export function createDataTexture(
  values: Float32Array,
  width: number,
  height: number,
  colorStops: ColorStop[] = AQI_GRADIENT_STOPS,
  minValue: number = 0,
  maxValue: number = 500
): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  const range = maxValue - minValue;

  for (let i = 0; i < values.length; i++) {
    const normalizedValue = range > 0 ? (values[i] - minValue) / range : 0;
    const color = interpolateColorStops(colorStops, normalizedValue);
    const rgb = hexToRgb(color);

    const index = i * 4;
    data[index] = rgb.r;
    data[index + 1] = rgb.g;
    data[index + 2] = rgb.b;
    data[index + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/**
 * Generate a volumetric density texture (3D)
 */
export function createVolumeTexture(
  values: Float32Array,
  width: number,
  height: number,
  depth: number,
  minValue: number = 0,
  maxValue: number = 500
): THREE.Data3DTexture {
  const data = new Uint8Array(width * height * depth * 4);
  const range = maxValue - minValue;

  for (let i = 0; i < values.length; i++) {
    const normalizedValue = range > 0 ? (values[i] - minValue) / range : 0;
    const color = interpolateColorStops(AQI_GRADIENT_STOPS, normalizedValue);
    const rgb = hexToRgb(color);

    const index = i * 4;
    data[index] = rgb.r;
    data[index + 1] = rgb.g;
    data[index + 2] = rgb.b;
    // Alpha based on density (higher values = more opaque)
    data[index + 3] = Math.floor(normalizedValue * 200);
  }

  const texture = new THREE.Data3DTexture(data, width, height, depth);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

// =============================================================================
// CSS GRADIENT GENERATION
// =============================================================================

/**
 * Generate a CSS linear gradient string from color stops
 */
export function createCSSGradient(
  stops: ColorStop[],
  direction: string = 'to right'
): string {
  const colorStops = stops
    .map((s) => `${s.color} ${s.position * 100}%`)
    .join(', ');
  return `linear-gradient(${direction}, ${colorStops})`;
}

/**
 * Generate AQI legend gradient CSS
 */
export function createAQILegendGradient(direction: string = 'to right'): string {
  return createCSSGradient(AQI_GRADIENT_STOPS, direction);
}

// =============================================================================
// COLOR UTILITIES
// =============================================================================

/**
 * Blend two colors with a given factor
 */
export function blendColors(color1: string, color2: string, factor: number): string {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  const t = Math.max(0, Math.min(1, factor));

  return rgbToHex(
    rgb1.r + (rgb2.r - rgb1.r) * t,
    rgb1.g + (rgb2.g - rgb1.g) * t,
    rgb1.b + (rgb2.b - rgb1.b) * t
  );
}

/**
 * Adjust brightness of a color
 */
export function adjustBrightness(color: string, factor: number): string {
  const rgb = hexToRgb(color);
  return rgbToHex(
    rgb.r * factor,
    rgb.g * factor,
    rgb.b * factor
  );
}

/**
 * Get contrasting text color (black or white) for a background
 */
export function getContrastColor(backgroundColor: string): string {
  const rgb = hexToRgb(backgroundColor);
  // Use relative luminance formula
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Convert AQI value to opacity (for overlay visualization)
 */
export function aqiToOpacity(aqi: number, minOpacity: number = 0.1, maxOpacity: number = 0.8): number {
  const normalized = Math.min(aqi / 500, 1);
  return minOpacity + (maxOpacity - minOpacity) * Math.pow(normalized, 0.5);
}

/**
 * Get RGBA color string with opacity based on AQI
 */
export function getAQIRGBA(aqi: number, baseOpacity: number = 0.6): string {
  const rgb = hexToRgb(getAQIColor(aqi));
  const opacity = aqiToOpacity(aqi) * baseOpacity;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity.toFixed(2)})`;
}

// =============================================================================
// LEGEND HELPERS
// =============================================================================

/**
 * Generate legend items for AQI scale
 */
export interface LegendItem {
  color: string;
  label: string;
  range: [number, number];
  description: string;
}

export function generateAQILegendItems(): LegendItem[] {
  return Object.values(AQI_CATEGORIES).map((cat) => ({
    color: cat.color,
    label: cat.label,
    range: cat.range as [number, number],
    description: cat.description,
  }));
}
