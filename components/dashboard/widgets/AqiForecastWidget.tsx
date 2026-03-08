import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { WidgetShell } from '../WidgetShell';
import { useAqiPrediction } from '../../../hooks/useLiveData';

const AQI_FILL = (aqi: number) => {
  if (aqi <= 50) return '#22c55e';
  if (aqi <= 100) return '#eab308';
  if (aqi <= 150) return '#f97316';
  if (aqi <= 200) return '#ef4444';
  if (aqi <= 300) return '#9333ea';
  return '#be123c';
};

export const AqiForecastWidget: React.FC = () => {
  const { data, loading, error, lastUpdated, refetch } = useAqiPrediction();

  if (!data && !loading && !error) {
    return (
      <WidgetShell title="AQI Forecast (24h)" loading={false} error="Model not trained" lastUpdated={null} onRetry={refetch} />
    );
  }

  const chartData = data ? [
    { name: 'Low', value: data.confidenceInterval.low },
    { name: 'Predicted', value: data.predictedAqi },
    { name: 'High', value: data.confidenceInterval.high },
    ...(data.airnowComparison ? [{ name: 'AirNow', value: data.airnowComparison.aqi }] : []),
  ] : [];

  return (
    <WidgetShell title="AQI Forecast (24h)" loading={loading} error={error} lastUpdated={lastUpdated} onRetry={refetch}>
      {data && (
        <>
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-3xl font-bold" style={{ color: AQI_FILL(data.predictedAqi) }}>
              {data.predictedAqi}
            </span>
            <span className="text-sm text-slate-400">{data.category}</span>
            <span className="text-[10px] text-slate-600 ml-auto">R²={data.modelR2}</span>
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 'auto']} />
              <YAxis type="category" dataKey="name" stroke="#64748b" tick={{ fontSize: 10 }} width={60} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', fontSize: 12 }} />
              <ReferenceLine x={100} stroke="#fde047" strokeDasharray="4 4" />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {chartData.map((d, i) => <Cell key={i} fill={AQI_FILL(d.value)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {data.topFactors.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Top Drivers</p>
              {data.topFactors.slice(0, 3).map(f => (
                <div key={f.feature} className="flex items-center text-xs">
                  <div className="flex-1 bg-slate-700 rounded-full h-1.5 mr-2">
                    <div className="bg-brand-primary h-1.5 rounded-full" style={{ width: `${f.importance * 100}%` }} />
                  </div>
                  <span className="text-slate-400 w-28 truncate">{f.feature.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </WidgetShell>
  );
};
