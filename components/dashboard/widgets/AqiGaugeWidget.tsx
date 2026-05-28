import React from 'react';
import { WidgetShell } from '../WidgetShell';
import { useAqiSnapshot } from '../../../hooks/useLiveData';
import { getAqiAccessibleLabel } from '../../../utils/accessibility';

const AQI_COLORS = [
  { max: 50, bg: 'bg-green-500', text: 'text-green-400', label: 'Good', pattern: 'none' },
  { max: 100, bg: 'bg-yellow-400', text: 'text-yellow-400', label: 'Moderate', pattern: 'diagonal' },
  { max: 150, bg: 'bg-orange-500', text: 'text-orange-400', label: 'Unhealthy for Sensitive Groups', pattern: 'dots' },
  { max: 200, bg: 'bg-red-500', text: 'text-red-400', label: 'Unhealthy', pattern: 'cross' },
  { max: 300, bg: 'bg-purple-600', text: 'text-purple-400', label: 'Very Unhealthy', pattern: 'dense' },
  { max: 500, bg: 'bg-rose-900', text: 'text-rose-400', label: 'Hazardous', pattern: 'solid' },
];

function getAqiStyle(aqi: number) {
  return AQI_COLORS.find(c => aqi <= c.max) || AQI_COLORS[AQI_COLORS.length - 1];
}

export const AqiGaugeWidget: React.FC = () => {
  const { data, loading, error, lastUpdated, refetch } = useAqiSnapshot();

  const readings = data?.readings || [];
  const avgAqi = readings.length
    ? Math.round(readings.reduce((s, r) => s + r.aqi, 0) / readings.length)
    : 0;
  const avgPm25 = readings.length
    ? Math.round(readings.reduce((s, r) => s + (r.pm25 || 0), 0) / readings.length * 10) / 10
    : 0;
  const style = getAqiStyle(avgAqi);

  const srDescription = avgAqi > 0
    ? `Air quality is ${style.label}, AQI ${avgAqi}. PM2.5 is ${avgPm25} micrograms per cubic meter across ${readings.length} stations.`
    : 'No air quality data available.';

  return (
    <WidgetShell title="Air Quality Index" loading={loading} error={error} lastUpdated={lastUpdated} onRetry={refetch}>
      <div className="flex flex-col items-center py-2" role="img" aria-label={srDescription}>
        {/* Gauge circle with pattern fill for colorblind accessibility */}
        <div
          className={`w-28 h-28 rounded-full flex items-center justify-center border-4 ${style.bg}/20 border-current ${style.text}`}
          style={{ backgroundImage: patternStyle(style.pattern, style.text) }}
        >
          <div className="text-center bg-brand-bg-light/90 rounded-full w-24 h-24 flex flex-col items-center justify-center">
            <span className="text-4xl font-bold" aria-hidden="true">{avgAqi}</span>
            <p className="text-[10px] mt-0.5" aria-hidden="true">{style.label}</p>
          </div>
        </div>

        {/* Screen reader summary */}
        <span className="sr-only">{srDescription}</span>

        {/* Per-station readings */}
        <div className="mt-4 w-full space-y-1.5" role="list" aria-label="Station readings">
          {readings.slice(0, 6).map(r => {
            const rs = getAqiStyle(r.aqi);
            return (
              <div
                key={r.stationName}
                className="flex items-center justify-between text-xs"
                role="listitem"
                aria-label={`${r.stationName}: AQI ${r.aqi}, ${rs.label}`}
              >
                <span className="text-slate-400 truncate mr-2" aria-hidden="true">{r.stationName}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`font-semibold ${rs.text}`} aria-hidden="true">{r.aqi}</span>
                  <span className="text-slate-600 text-[10px]" aria-hidden="true">
                    {r.source === 'purpleair' ? 'PA' : r.source === 'airnow' ? 'EPA' : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </WidgetShell>
  );
};

/** Generate CSS background pattern for colorblind accessibility */
function patternStyle(pattern: string, _color: string): string | undefined {
  switch (pattern) {
    case 'diagonal':
      return 'repeating-linear-gradient(45deg, transparent, transparent 4px, currentColor 4px, currentColor 5px)';
    case 'dots':
      return 'radial-gradient(circle, currentColor 1px, transparent 1px)';
    case 'cross':
      return 'repeating-linear-gradient(0deg, transparent, transparent 3px, currentColor 3px, currentColor 4px), repeating-linear-gradient(90deg, transparent, transparent 3px, currentColor 3px, currentColor 4px)';
    case 'dense':
      return 'repeating-linear-gradient(45deg, transparent, transparent 2px, currentColor 2px, currentColor 3px)';
    case 'solid':
      return undefined;
    default:
      return undefined;
  }
}
