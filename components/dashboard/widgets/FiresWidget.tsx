import React from 'react';
import { WidgetShell } from '../WidgetShell';
import { useActiveFires } from '../../../hooks/useLiveData';

const RISK_COLORS: Record<string, string> = {
  low: 'text-green-400',
  moderate: 'text-yellow-400',
  high: 'text-red-400',
};

export const FiresWidget: React.FC = () => {
  const { data, loading, error, lastUpdated, refetch } = useActiveFires();

  const fires = data?.fires || [];
  const nearby = fires.filter(f => f.distanceKm <= 100);
  const riskColor = RISK_COLORS[data?.smokeRisk || 'low'] || 'text-slate-400';

  return (
    <WidgetShell title="Active Fires" loading={loading} error={error} lastUpdated={lastUpdated} onRetry={refetch}>
      <div className="flex items-center gap-4 mb-3">
        <div className="text-center">
          <p className="text-3xl font-bold text-orange-400">{data?.count ?? 0}</p>
          <p className="text-[10px] text-slate-500">Detections</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-red-400">{data?.upwindCount ?? 0}</p>
          <p className="text-[10px] text-slate-500">Upwind</p>
        </div>
        <div className="text-center ml-auto">
          <p className={`text-sm font-semibold uppercase ${riskColor}`}>{data?.smokeRisk || 'N/A'}</p>
          <p className="text-[10px] text-slate-500">Smoke Risk</p>
        </div>
      </div>

      {/* Mini fire list — nearest 5 */}
      <div className="space-y-1.5">
        {nearby.slice(0, 5).map((f, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-slate-400">{f.distanceKm.toFixed(0)} km</span>
            <span className="text-slate-500">FRP {f.frp?.toFixed(0) || '?'} MW</span>
            <span className={`font-medium ${f.confidence === 'high' || f.confidence === 'h' ? 'text-red-400' : 'text-slate-400'}`}>
              {f.confidence}
            </span>
          </div>
        ))}
        {nearby.length === 0 && !loading && (
          <p className="text-xs text-slate-500 text-center py-2">No fires within 100 km</p>
        )}
      </div>
    </WidgetShell>
  );
};
