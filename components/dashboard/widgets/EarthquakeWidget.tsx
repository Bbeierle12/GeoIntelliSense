import React from 'react';
import { WidgetShell } from '../WidgetShell';
import { useEarthquakes } from '../../../hooks/useLiveData';

function magColor(mag: number): string {
  if (mag >= 4.0) return 'text-red-400';
  if (mag >= 3.0) return 'text-orange-400';
  return 'text-yellow-400';
}

export const EarthquakeWidget: React.FC = () => {
  const { data, loading, error, lastUpdated, refetch } = useEarthquakes();

  const events = data?.events || [];
  const maxMag = events.length ? Math.max(...events.map(e => e.magnitude)) : 0;

  return (
    <WidgetShell title="Earthquakes (7 days)" loading={loading} error={error} lastUpdated={lastUpdated} onRetry={refetch}>
      <div className="flex items-center gap-4 mb-3">
        <div className="text-center">
          <p className="text-3xl font-bold text-slate-200">{events.length}</p>
          <p className="text-[10px] text-slate-500">Events M2.0+</p>
        </div>
        {maxMag > 0 && (
          <div className="text-center">
            <p className={`text-3xl font-bold ${magColor(maxMag)}`}>M{maxMag.toFixed(1)}</p>
            <p className="text-[10px] text-slate-500">Largest</p>
          </div>
        )}
      </div>

      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {events.slice(0, 8).map(e => (
          <div key={e.eventId} className="flex items-center justify-between text-xs">
            <span className={`font-semibold w-10 ${magColor(e.magnitude)}`}>M{e.magnitude.toFixed(1)}</span>
            <span className="text-slate-400 flex-1 truncate mx-2">{e.place}</span>
            <span className="text-slate-500 flex-shrink-0">{e.distanceFromBakersfieldKm.toFixed(0)} km</span>
          </div>
        ))}
        {events.length === 0 && !loading && (
          <p className="text-xs text-slate-500 text-center py-2">No recent seismic activity</p>
        )}
      </div>
    </WidgetShell>
  );
};
