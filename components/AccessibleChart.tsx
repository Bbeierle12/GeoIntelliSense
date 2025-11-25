import React, { useState, useId } from 'react';
import { ResponsiveContainer } from 'recharts';

/**
 * SVG patterns for colorblind-accessible charts
 */
export const ChartPatterns: React.FC = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }}>
    <defs>
      {/* Pattern 1: Diagonal lines */}
      <pattern id="pattern-diagonal" patternUnits="userSpaceOnUse" width="8" height="8">
        <path d="M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4" stroke="currentColor" strokeWidth="1.5" />
      </pattern>
      
      {/* Pattern 2: Dots */}
      <pattern id="pattern-dots" patternUnits="userSpaceOnUse" width="8" height="8">
        <circle cx="4" cy="4" r="2" fill="currentColor" />
      </pattern>
      
      {/* Pattern 3: Horizontal lines */}
      <pattern id="pattern-horizontal" patternUnits="userSpaceOnUse" width="8" height="8">
        <line x1="0" y1="4" x2="8" y2="4" stroke="currentColor" strokeWidth="1.5" />
      </pattern>
      
      {/* Pattern 4: Vertical lines */}
      <pattern id="pattern-vertical" patternUnits="userSpaceOnUse" width="8" height="8">
        <line x1="4" y1="0" x2="4" y2="8" stroke="currentColor" strokeWidth="1.5" />
      </pattern>
      
      {/* Pattern 5: Cross-hatch */}
      <pattern id="pattern-crosshatch" patternUnits="userSpaceOnUse" width="8" height="8">
        <line x1="0" y1="4" x2="8" y2="4" stroke="currentColor" strokeWidth="1" />
        <line x1="4" y1="0" x2="4" y2="8" stroke="currentColor" strokeWidth="1" />
      </pattern>
      
      {/* Pattern 6: Zigzag */}
      <pattern id="pattern-zigzag" patternUnits="userSpaceOnUse" width="8" height="8">
        <path d="M0,4 L2,0 L4,4 L6,0 L8,4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </pattern>
    </defs>
  </svg>
);

/**
 * Pattern IDs for consistent use across charts
 */
export const CHART_PATTERNS = [
  'pattern-diagonal',
  'pattern-dots',
  'pattern-horizontal',
  'pattern-vertical',
  'pattern-crosshatch',
  'pattern-zigzag'
] as const;

/**
 * Get pattern ID by index
 */
export function getPatternId(index: number): string {
  return CHART_PATTERNS[index % CHART_PATTERNS.length];
}

interface DataTableColumn {
  key: string;
  header: string;
  format?: (value: any) => string;
}

interface AccessibleChartProps {
  /** The chart content to render */
  children: React.ReactNode;
  /** Height of the chart in pixels */
  height?: number;
  /** Accessible label for the chart */
  ariaLabel: string;
  /** Detailed description of what the chart shows */
  description?: string;
  /** Data for the accessible table alternative */
  data: Record<string, any>[];
  /** Column definitions for the data table */
  columns: DataTableColumn[];
  /** Chart title */
  title: string;
  /** Caption for the data table */
  tableCaption?: string;
}

/**
 * Accessible chart wrapper that provides:
 * - Proper ARIA attributes
 * - Toggle to show data table alternative
 * - Screen reader descriptions
 */
export const AccessibleChart: React.FC<AccessibleChartProps> = ({
  children,
  height = 300,
  ariaLabel,
  description,
  data,
  columns,
  title,
  tableCaption
}) => {
  const [showTable, setShowTable] = useState(false);
  const chartId = useId();
  const descId = `${chartId}-desc`;
  const tableId = `${chartId}-table`;

  return (
    <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
      <ChartPatterns />
      
      {/* Header with title and toggle */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-semibold text-slate-200">{title}</h3>
        <button
          onClick={() => setShowTable(!showTable)}
          className="px-3 py-1.5 text-sm bg-brand-bg-lighter hover:bg-brand-secondary text-slate-300 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-light"
          aria-expanded={showTable}
          aria-controls={tableId}
        >
          {showTable ? 'Show Chart' : 'Show Data Table'}
        </button>
      </div>

      {/* Screen reader description */}
      {description && (
        <p id={descId} className="sr-only">
          {description}
        </p>
      )}

      {/* Chart or Table view */}
      {showTable ? (
        <div id={tableId}>
          <DataTable 
            data={data} 
            columns={columns} 
            caption={tableCaption || `Data table for ${title}`}
          />
        </div>
      ) : (
        <div
          role="img"
          aria-label={ariaLabel}
          aria-describedby={description ? descId : undefined}
        >
          <ResponsiveContainer width="100%" height={height}>
            {children}
          </ResponsiveContainer>
        </div>
      )}

      {/* Additional screen reader context */}
      <p className="sr-only">
        {showTable 
          ? 'Showing data in table format. Press the Show Chart button to view as a chart.' 
          : 'Showing data as a chart. Press the Show Data Table button to view as an accessible table.'}
      </p>
    </div>
  );
};

interface DataTableProps {
  data: Record<string, any>[];
  columns: DataTableColumn[];
  caption: string;
}

/**
 * Accessible data table component
 */
export const DataTable: React.FC<DataTableProps> = ({ data, columns, caption }) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left text-slate-300">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs uppercase bg-brand-bg-dark text-slate-400">
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className="px-4 py-3 font-semibold">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr 
              key={rowIndex} 
              className="border-b border-brand-secondary hover:bg-brand-bg-lighter transition-colors"
            >
              {columns.map((col, colIndex) => (
                <td 
                  key={col.key} 
                  className="px-4 py-3"
                  // First column gets row header scope
                  {...(colIndex === 0 ? { scope: 'row', className: 'px-4 py-3 font-medium text-slate-200' } : {})}
                >
                  {col.format ? col.format(row[col.key]) : row[col.key] ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * AQI indicator with accessible text and icon
 */
export const AQIIndicator: React.FC<{
  value: number;
  showIcon?: boolean;
  showLabel?: boolean;
}> = ({ value, showIcon = true, showLabel = true }) => {
  const getAqiInfo = (aqi: number) => {
    if (aqi <= 50) return { label: 'Good', color: 'text-green-500', bgColor: 'bg-green-500', icon: '✓' };
    if (aqi <= 100) return { label: 'Moderate', color: 'text-yellow-400', bgColor: 'bg-yellow-400', icon: '!' };
    if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: 'text-orange-500', bgColor: 'bg-orange-500', icon: '⚠' };
    if (aqi <= 200) return { label: 'Unhealthy', color: 'text-red-500', bgColor: 'bg-red-500', icon: '⚠' };
    if (aqi <= 300) return { label: 'Very Unhealthy', color: 'text-purple-500', bgColor: 'bg-purple-500', icon: '☠' };
    return { label: 'Hazardous', color: 'text-red-900', bgColor: 'bg-red-900', icon: '☠' };
  };

  const info = getAqiInfo(value);

  return (
    <span className="inline-flex items-center gap-2">
      {showIcon && (
        <span 
          className={`w-5 h-5 rounded-full ${info.bgColor} flex items-center justify-center text-white text-xs`}
          aria-hidden="true"
        >
          {info.icon}
        </span>
      )}
      <span className={info.color}>{value}</span>
      {showLabel && (
        <span className="text-xs text-slate-400">({info.label})</span>
      )}
      <span className="sr-only">
        AQI {value}: {info.label}
      </span>
    </span>
  );
};

export default AccessibleChart;
