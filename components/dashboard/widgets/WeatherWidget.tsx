import React from 'react';
import { WidgetShell } from '../WidgetShell';
import { useNwsForecast, useAqiSnapshot } from '../../../hooks/useLiveData';

export const WeatherWidget: React.FC = () => {
  const { data: snapshot, loading: snapLoading } = useAqiSnapshot();
  const { data: forecast, loading: fcLoading, error, lastUpdated, refetch } = useNwsForecast();

  const loading = snapLoading && fcLoading;

  // Current conditions from AQI snapshot (includes temp/humidity from PurpleAir)
  const readings = snapshot?.readings || [];
  const avgTemp = readings.length
    ? Math.round(readings.reduce((s, r) => s + (r.temperature || 0), 0) / readings.length)
    : null;
  const avgHumidity = readings.length
    ? Math.round(readings.reduce((s, r) => s + (r.humidity || 0), 0) / readings.length)
    : null;
  const avgWind = readings.length
    ? Math.round(readings.reduce((s, r) => s + (r.wind_speed || 0), 0) / readings.length * 10) / 10
    : null;

  // Take first few distinct forecast periods
  const periods = (forecast || [])
    .filter((p, i, arr) => i === arr.findIndex(x => x.date === p.date && x.locationName === p.locationName))
    .slice(0, 4);

  return (
    <WidgetShell title="Weather" loading={loading} error={error} lastUpdated={lastUpdated} onRetry={refetch}>
      {/* Current conditions */}
      {avgTemp !== null && (
        <div className="grid grid-cols-3 gap-2 text-center mb-4 pb-3 border-b border-slate-700">
          <div>
            <p className="text-2xl font-bold text-slate-200">{avgTemp}°F</p>
            <p className="text-[10px] text-slate-500">Temperature</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-200">{avgHumidity}%</p>
            <p className="text-[10px] text-slate-500">Humidity</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-200">{avgWind}</p>
            <p className="text-[10px] text-slate-500">Wind (mph)</p>
          </div>
        </div>
      )}

      {/* Forecast periods */}
      <div className="space-y-2">
        {periods.map((p, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-slate-400 w-20 truncate">{p.conditions || 'Forecast'}</span>
            <span className="text-slate-300 font-medium">
              {p.tempHigh != null ? `${p.tempHigh}°` : ''}
              {p.tempLow != null ? ` / ${p.tempLow}°` : ''}
            </span>
            <span className="text-slate-500">{p.windSpeed}</span>
          </div>
        ))}
        {periods.length === 0 && !loading && (
          <p className="text-sm text-slate-500 text-center py-2">No forecast data</p>
        )}
      </div>
    </WidgetShell>
  );
};
