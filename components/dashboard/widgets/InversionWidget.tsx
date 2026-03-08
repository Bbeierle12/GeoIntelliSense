import React from 'react';
import { WidgetShell } from '../WidgetShell';
import { useInversionStatus } from '../../../hooks/useLiveData';

const STRENGTH_STYLES: Record<string, { color: string; ring: string }> = {
  none: { color: 'text-green-400', ring: 'ring-green-500/30' },
  weak: { color: 'text-yellow-400', ring: 'ring-yellow-500/30' },
  moderate: { color: 'text-orange-400', ring: 'ring-orange-500/30' },
  strong: { color: 'text-red-400', ring: 'ring-red-500/30' },
};

export const InversionWidget: React.FC = () => {
  const { data, loading, error, lastUpdated, refetch } = useInversionStatus();

  const strength = data?.inversionStrength || 'unknown';
  const style = STRENGTH_STYLES[strength] || { color: 'text-slate-400', ring: 'ring-slate-500/30' };

  return (
    <WidgetShell title="Temperature Inversion" loading={loading} error={error} lastUpdated={lastUpdated} onRetry={refetch}>
      {data && (
        <>
          <div className={`text-center mb-3 p-3 rounded-lg ring-2 ${style.ring}`}>
            <p className={`text-2xl font-bold uppercase ${style.color}`}>{strength}</p>
            {data.tempDiffC != null && (
              <p className="text-xs text-slate-500 mt-1">
                850mb - surface: {data.tempDiffC > 0 ? '+' : ''}{data.tempDiffC}°C
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-center text-xs mb-3">
            <div>
              <p className="text-slate-300 font-medium">{data.surfaceTempF != null ? `${data.surfaceTempF}°F` : '—'}</p>
              <p className="text-slate-500">Surface</p>
            </div>
            <div>
              <p className="text-slate-300 font-medium">{data.temp850mbC != null ? `${data.temp850mbC}°C` : '—'}</p>
              <p className="text-slate-500">850 mb</p>
            </div>
          </div>

          {data.fogLikely && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded p-2 text-xs text-yellow-300 text-center">
              Tule fog conditions likely
            </div>
          )}

          <p className="text-[10px] text-slate-500 mt-2">{data.aqiImpact}</p>
        </>
      )}
    </WidgetShell>
  );
};
