import React from 'react';
import { WidgetShell } from '../WidgetShell';
import { useAqiHeadline } from '../../../hooks/useLiveData';

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

const observedLabel = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/**
 * Headline AQI for Bakersfield.
 *
 * This previously averaged the AQI of every station into a single number. With
 * stations spread across the county that average matched no published source;
 * it also used a PM2.5-only sensor index, which cannot match an official AQI
 * because the published value is the maximum across pollutants.
 */
export const AqiGaugeWidget: React.FC = () => {
  const { data, loading, error, lastUpdated, refetch } = useAqiHeadline();

  const primary = data?.primary ?? null;
  const others = (data?.communities ?? []).filter(c => c.community !== primary?.community);
  const aqi = primary?.aqi ?? null;
  const style = aqi === null ? null : getAqiStyle(aqi);
  const label = primary?.category ?? style?.label ?? 'Unknown';

  const srDescription = aqi === null
    ? 'No air quality data available for Bakersfield.'
    : `Air quality in ${primary?.community} is ${label}, AQI ${aqi}` +
      (primary?.dominantPollutant ? `, driven by ${primary.dominantPollutant}` : '') + '.';

  return (
    <WidgetShell title="Air Quality Index" loading={loading} error={error} lastUpdated={lastUpdated} onRetry={refetch}>
      <div className="flex flex-col items-center py-2" role="img" aria-label={srDescription}>
        <div
          className={`w-28 h-28 rounded-full flex items-center justify-center border-4 ${style?.bg ?? 'bg-slate-700'}/20 border-current ${style?.text ?? 'text-slate-500'}`}
          style={{ backgroundImage: patternStyle(style?.pattern ?? 'none', style?.text ?? '') }}
        >
          <div className="text-center bg-brand-bg-light/90 rounded-full w-24 h-24 flex flex-col items-center justify-center">
            <span className="text-4xl font-bold" aria-hidden="true">{aqi ?? '—'}</span>
            <p className="text-[10px] mt-0.5 px-1 leading-tight" aria-hidden="true">{label}</p>
          </div>
        </div>

        <span className="sr-only">{srDescription}</span>

        {/* Where the number came from, so it is never mistaken for a sensor value. */}
        {primary && (
          <div className="mt-2 text-center text-[10px] text-slate-400 leading-snug">
            <div className="font-semibold text-slate-300">{primary.community}</div>
            {primary.basis === 'airnow' && primary.official && (
              <div>
                EPA AirNow · {primary.official.reportingArea}
                {primary.dominantPollutant ? ` · ${primary.dominantPollutant}` : ''}
                {primary.official.observedAt ? ` · ${observedLabel(primary.official.observedAt)}` : ''}
                {primary.official.stale && <span className="text-yellow-500"> · last known</span>}
              </div>
            )}
            {primary.basis === 'purpleair_pm25_only' && (
              <div className="text-yellow-500">PM2.5 only — no EPA monitor nearby</div>
            )}
            {primary.sensors && (
              <div className="text-slate-500">
                Local sensors: PM2.5 {primary.sensors.pm25} µg/m³
                {primary.sensors.sensorCount ? ` (${primary.sensors.sensorCount})` : ''}
              </div>
            )}
          </div>
        )}

        {/* Other Kern communities */}
        <div className="mt-3 w-full space-y-1.5" role="list" aria-label="Other Kern communities">
          {others.map(c => {
            const cs = c.aqi === null ? null : getAqiStyle(c.aqi);
            return (
              <div
                key={c.community}
                className="flex items-center justify-between text-xs"
                role="listitem"
                aria-label={c.aqi === null
                  ? `${c.community}: no data`
                  : `${c.community}: AQI ${c.aqi}, ${c.category ?? cs?.label}`}
              >
                <span className="text-slate-400 truncate mr-2" aria-hidden="true">{c.community}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`font-semibold ${cs?.text ?? 'text-slate-600'}`} aria-hidden="true">
                    {c.aqi ?? '—'}
                  </span>
                  <span className="text-slate-600 text-[10px] w-8 text-right" aria-hidden="true">
                    {c.basis === 'airnow' ? 'EPA' : c.basis === 'purpleair_pm25_only' ? 'PA' : ''}
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
