import React from 'react';

interface AccessibleChartWrapperProps {
  title: string;
  description: string;
  children: React.ReactNode;
  dataPointCount?: number;
}

/**
 * Wraps a Recharts chart with proper ARIA attributes for screen readers.
 * Provides an accessible text description of the chart contents.
 */
export const AccessibleChartWrapper: React.FC<AccessibleChartWrapperProps> = ({
  title,
  description,
  children,
  dataPointCount,
}) => (
  <div role="figure" aria-label={title}>
    <span className="sr-only">
      {description}
      {dataPointCount != null && ` Chart contains ${dataPointCount} data points.`}
    </span>
    <div aria-hidden="true">
      {children}
    </div>
  </div>
);

/**
 * SVG pattern definitions for colorblind-accessible chart fills.
 * Add this inside any SVG/Recharts chart to define patterns.
 * Reference via `fill="url(#pattern-diagonal)"` etc.
 */
export const ChartPatternDefs: React.FC = () => (
  <defs>
    <pattern id="pattern-diagonal" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" />
    </pattern>
    <pattern id="pattern-dots" patternUnits="userSpaceOnUse" width="6" height="6">
      <circle cx="3" cy="3" r="1.5" fill="currentColor" />
    </pattern>
    <pattern id="pattern-cross" patternUnits="userSpaceOnUse" width="6" height="6">
      <line x1="0" y1="3" x2="6" y2="3" stroke="currentColor" strokeWidth="1" />
      <line x1="3" y1="0" x2="3" y2="6" stroke="currentColor" strokeWidth="1" />
    </pattern>
    <pattern id="pattern-horizontal" patternUnits="userSpaceOnUse" width="6" height="6">
      <line x1="0" y1="3" x2="6" y2="3" stroke="currentColor" strokeWidth="2" />
    </pattern>
    <pattern id="pattern-vertical" patternUnits="userSpaceOnUse" width="6" height="6">
      <line x1="3" y1="0" x2="3" y2="6" stroke="currentColor" strokeWidth="2" />
    </pattern>
  </defs>
);

/**
 * Generate accessible AQI description for screen readers
 */
export function aqiScreenReaderText(aqi: number, pm25?: number, station?: string): string {
  const category = getCategory(aqi);
  let text = station
    ? `${station}: Air quality is ${category}, AQI ${aqi}`
    : `Air quality is ${category}, AQI ${aqi}`;

  if (pm25 != null) {
    text += `, PM2.5 is ${pm25} micrograms per cubic meter`;
  }

  return text;
}

function getCategory(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}
