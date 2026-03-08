import React from 'react';
import { WidgetShell } from '../WidgetShell';
import { useWaterLevels } from '../../../hooks/useLiveData';

function flowColor(value: number | undefined): string {
  if (value == null) return 'text-slate-400';
  if (value < 10) return 'text-red-400';
  if (value > 1000) return 'text-blue-400';
  return 'text-cyan-400';
}

export const WaterWidget: React.FC = () => {
  const { data, loading, error, lastUpdated, refetch } = useWaterLevels();

  const stations = data?.stations || [];

  return (
    <WidgetShell title="Water Levels" loading={loading} error={error} lastUpdated={lastUpdated} onRetry={refetch}>
      <div className="space-y-2.5">
        {stations.slice(0, 6).map(s => {
          const discharge = s.readings?.discharge || s.readings?.Discharge;
          const val = discharge?.value;
          const unit = discharge?.units || 'cfs';

          return (
            <div key={s.siteId} className="flex items-center justify-between">
              <span className="text-xs text-slate-400 truncate flex-1 mr-2">{s.siteName}</span>
              <span className={`text-sm font-semibold ${flowColor(val)}`}>
                {val != null ? `${val.toLocaleString()} ${unit}` : '—'}
              </span>
            </div>
          );
        })}
        {stations.length === 0 && !loading && (
          <p className="text-xs text-slate-500 text-center py-4">No water data available</p>
        )}
      </div>
    </WidgetShell>
  );
};
