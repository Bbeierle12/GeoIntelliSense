import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { WidgetShell } from '../WidgetShell';
import { useLiveData } from '../../../hooks/useLiveData';
import { AccessibleChartWrapper } from '../../AccessibleChartWrapper';

interface HistoryPoint {
  time: string;
  aqi: number;
  pm25: number;
}

export const AqiTrendWidget: React.FC = () => {
  const { data, loading, error, lastUpdated, refetch } = useLiveData<HistoryPoint[]>(
    '/api/aqi-history?station_id=AQ-001&hours=24',
    { refreshInterval: 120_000 },
  );

  const chartData = (data || []).map(d => ({
    time: new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    aqi: d.aqi,
    pm25: d.pm25,
  }));

  // Build screen reader description from data
  const maxAqi = chartData.length ? Math.max(...chartData.map(d => d.aqi)) : 0;
  const minAqi = chartData.length ? Math.min(...chartData.map(d => d.aqi)) : 0;
  const srDesc = chartData.length > 0
    ? `AQI trend over the last 24 hours. AQI ranged from ${minAqi} to ${maxAqi}. ${chartData.length} readings shown.`
    : 'No AQI trend data available for the last 24 hours.';

  return (
    <WidgetShell title="AQI Trend (24h)" loading={loading} error={error} lastUpdated={lastUpdated} onRetry={refetch}>
      {chartData.length > 0 ? (
        <AccessibleChartWrapper
          title="AQI 24-hour trend chart"
          description={srDesc}
          dataPointCount={chartData.length}
        >
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 'auto']} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', fontSize: 12 }} />
              <ReferenceLine y={100} stroke="#fde047" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="aqi" stroke="#ef4444" strokeWidth={2} dot={false} name="AQI" />
              <Line type="monotone" dataKey="pm25" stroke="#f97316" strokeWidth={1.5} dot={false} name="PM2.5" strokeDasharray="5 3" />
            </LineChart>
          </ResponsiveContainer>
        </AccessibleChartWrapper>
      ) : (
        <p className="text-sm text-slate-500 text-center py-8" role="status">No trend data available</p>
      )}
    </WidgetShell>
  );
};
