import React from 'react';
import { WidgetShell } from '../WidgetShell';
import { useAqiSnapshot } from '../../../hooks/useLiveData';

const AQI_COLORS = [
  { max: 50, bg: 'bg-green-500', text: 'text-green-400', label: 'Good' },
  { max: 100, bg: 'bg-yellow-400', text: 'text-yellow-400', label: 'Moderate' },
  { max: 150, bg: 'bg-orange-500', text: 'text-orange-400', label: 'USG' },
  { max: 200, bg: 'bg-red-500', text: 'text-red-400', label: 'Unhealthy' },
  { max: 300, bg: 'bg-purple-600', text: 'text-purple-400', label: 'Very Unhealthy' },
  { max: 500, bg: 'bg-rose-900', text: 'text-rose-400', label: 'Hazardous' },
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
  const style = getAqiStyle(avgAqi);

  return (
    <WidgetShell title="Air Quality Index" loading={loading} error={error} lastUpdated={lastUpdated} onRetry={refetch}>
      <div className="flex flex-col items-center py-2">
        <div className={`w-28 h-28 rounded-full flex items-center justify-center border-4 ${style.bg}/20 border-current ${style.text}`}>
          <div className="text-center">
            <span className="text-4xl font-bold">{avgAqi}</span>
            <p className="text-[10px] mt-0.5">{style.label}</p>
          </div>
        </div>
        <div className="mt-4 w-full space-y-1.5">
          {readings.slice(0, 6).map(r => {
            const rs = getAqiStyle(r.aqi);
            return (
              <div key={r.station_name} className="flex items-center justify-between text-xs">
                <span className="text-slate-400 truncate mr-2">{r.station_name}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`font-semibold ${rs.text}`}>{r.aqi}</span>
                  <span className="text-slate-600 text-[10px]">{r.source === 'purpleair' ? 'PA' : r.source === 'airnow' ? 'EPA' : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </WidgetShell>
  );
};
