import React, { useState, useCallback, useMemo } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { useLiveData } from '../hooks/useLiveData';
import { getDeepAnalysisResponse } from '../services/aiService';

const GATEWAY = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8080';

// ── Source definitions ──────────────────────────────

interface SourceMeta {
  label: string;
  unit: string;
  color: string;
}

const ALL_SOURCES: Record<string, SourceMeta> = {
  aqi: { label: 'AQI', unit: 'AQI', color: '#ef4444' },
  pm25: { label: 'PM2.5', unit: 'ug/m3', color: '#f97316' },
  temperature: { label: 'Temperature', unit: 'F', color: '#eab308' },
  humidity: { label: 'Humidity', unit: '%', color: '#3b82f6' },
  wind_speed: { label: 'Wind Speed', unit: 'mph', color: '#06b6d4' },
  fires: { label: 'Fire Detections', unit: 'count', color: '#dc2626' },
  fire_frp: { label: 'Fire Intensity', unit: 'MW', color: '#b91c1c' },
  earthquakes: { label: 'Earthquakes', unit: 'count', color: '#8b5cf6' },
  inversion: { label: 'Inversion', unit: '0-3', color: '#a855f7' },
};

const BUCKET_OPTIONS = [
  { value: '1 hour', label: 'Hourly' },
  { value: '6 hours', label: '6-Hour' },
  { value: '1 day', label: 'Daily' },
];

interface ExploreResponse {
  sources: Record<string, SourceMeta>;
  days: number;
  bucket: string;
  pointCount: number;
  data: Array<Record<string, any>>;
  correlations: Record<string, Record<string, number>>;
}

// ── Main component ──────────────────────────────────

const DataExplorer: React.FC = () => {
  const [selected, setSelected] = useState<string[]>(['aqi', 'temperature', 'fires']);
  const [days, setDays] = useState(30);
  const [bucket, setBucket] = useState('1 day');
  const [claudeResult, setClaudeResult] = useState<string | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);

  const queryStr = selected.join(',');
  const apiPath = `/api/analysis/explore?sources=${queryStr}&days=${days}&bucket=${encodeURIComponent(bucket)}`;

  const { data, loading, error, lastUpdated, refetch } = useLiveData<ExploreResponse>(apiPath);

  // ── Source toggle ──────────────────────────────────

  const toggleSource = (key: string) => {
    setSelected(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

  // ── Dual Y-axis grouping ──────────────────────────

  const { leftSources, rightSources } = useMemo(() => {
    if (selected.length <= 1) return { leftSources: selected, rightSources: [] };
    // Put the first source on left, rest on right
    return { leftSources: [selected[0]], rightSources: selected.slice(1) };
  }, [selected]);

  // ── Chart data ─────────────────────────────────────

  const chartData = useMemo(() => {
    if (!data?.data) return [];
    return data.data.map(d => ({
      ...d,
      time: new Date(d.time).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(bucket === '1 hour' ? { hour: '2-digit' } : {}),
      }),
    }));
  }, [data, bucket]);

  // ── Correlation matrix ─────────────────────────────

  const corrMatrix = data?.correlations || {};

  // ── CSV download ───────────────────────────────────

  const downloadCsv = useCallback(() => {
    const url = `${GATEWAY}/api/analysis/explore/csv?sources=${queryStr}&days=${days}&bucket=${encodeURIComponent(bucket)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `geointellisense_${days}d.csv`;
    a.click();
  }, [queryStr, days, bucket]);

  // ── Ask Claude ─────────────────────────────────────

  const askClaude = useCallback(async () => {
    if (!data?.data || data.data.length === 0) return;
    setClaudeLoading(true);
    setClaudeResult(null);

    // Build a data summary for Claude — include actual data points
    const sourceLabels = selected.map(s => ALL_SOURCES[s]?.label || s).join(', ');
    const sample = data.data.slice(-30); // Last 30 data points
    const corrSummary = Object.entries(corrMatrix)
      .flatMap(([a, pairs]) =>
        Object.entries(pairs)
          .filter(([b]) => a < b)
          .map(([b, r]) => `${a} vs ${b}: r=${r}`),
      )
      .join('; ');

    const prompt = `Analyze the following environmental data for the San Joaquin Valley (Bakersfield area) over the past ${days} days.

**Selected data sources:** ${sourceLabels}
**Time bucket:** ${bucket}

**Correlation matrix:** ${corrSummary || 'Not enough data'}

**Recent data points (last ${sample.length} buckets):**
\`\`\`json
${JSON.stringify(sample, null, 2)}
\`\`\`

Provide a narrative analysis that:
1. Identifies specific events and spikes in the data, referencing exact dates and values
2. Explains correlations or lack thereof between the selected variables
3. Highlights any concerning patterns (e.g., AQI spikes coinciding with fire detections or temperature inversions)
4. Provides actionable insights for Bakersfield residents

Reference the actual data points — do not use generic knowledge. If PM2.5 spiked, say when and by how much. If fires were detected, note the count and timing.`;

    try {
      const result = await getDeepAnalysisResponse(prompt);
      setClaudeResult(result);
    } catch (e) {
      setClaudeResult('Analysis request failed. Ensure the backend is running.');
    } finally {
      setClaudeLoading(false);
    }
  }, [data, selected, days, bucket, corrMatrix]);

  // ── Render ─────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Data Explorer</h2>
        <p className="text-sm text-slate-400 mt-1">
          Overlay multiple data sources, explore correlations, and ask Claude for insights.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-brand-bg-light rounded-lg p-5 space-y-4">
        {/* Source toggles */}
        <div>
          <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Data Sources</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(ALL_SOURCES).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => toggleSource(key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all border ${
                  selected.includes(key)
                    ? 'text-white shadow-md'
                    : 'text-slate-400 border-slate-600 hover:border-slate-400'
                }`}
                style={selected.includes(key) ? { backgroundColor: meta.color, borderColor: meta.color } : {}}
              >
                {meta.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date range + bucket */}
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Time Range</label>
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="bg-brand-bg-dark border border-brand-secondary rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>6 months</option>
              <option value={365}>1 year</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Granularity</label>
            <select
              value={bucket}
              onChange={e => setBucket(e.target.value)}
              className="bg-brand-bg-dark border border-brand-secondary rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            >
              {BUCKET_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={downloadCsv}
            disabled={!data?.data?.length}
            className="px-4 py-2 text-sm font-medium bg-brand-bg-dark border border-brand-secondary rounded-md hover:bg-brand-bg-lighter disabled:opacity-40 transition-colors"
          >
            Export CSV
          </button>

          <button
            onClick={askClaude}
            disabled={claudeLoading || !data?.data?.length}
            className="px-4 py-2 text-sm font-semibold bg-brand-primary text-white rounded-md hover:bg-sky-600 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {claudeLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin" />
                Analyzing...
              </>
            ) : (
              'Ask Claude'
            )}
          </button>
        </div>
      </div>

      {/* Loading / error */}
      {loading && (
        <div className="bg-brand-bg-light rounded-lg p-8 animate-pulse">
          <div className="h-64 bg-slate-700/50 rounded" />
        </div>
      )}
      {error && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-300 p-4 rounded-lg text-sm">
          {error}
          <button onClick={refetch} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* Time Series Chart */}
      {data && chartData.length > 0 && (
        <div className="bg-brand-bg-light rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-slate-200">Time Series Overlay</h3>
            <span className="text-[10px] text-slate-500">{data.pointCount} data points</span>
          </div>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} interval="preserveStartEnd" />

              {leftSources.length > 0 && (
                <YAxis
                  yAxisId="left"
                  stroke={ALL_SOURCES[leftSources[0]]?.color || '#64748b'}
                  tick={{ fontSize: 10 }}
                  label={{
                    value: ALL_SOURCES[leftSources[0]]?.unit || '',
                    angle: -90,
                    position: 'insideLeft',
                    fill: '#94a3b8',
                    fontSize: 11,
                  }}
                />
              )}
              {rightSources.length > 0 && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke={ALL_SOURCES[rightSources[0]]?.color || '#64748b'}
                  tick={{ fontSize: 10 }}
                />
              )}

              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', fontSize: 12 }}
                labelStyle={{ color: '#cbd5e1' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />

              {selected.includes('aqi') && (
                <ReferenceLine
                  yAxisId={leftSources.includes('aqi') ? 'left' : 'right'}
                  y={100}
                  stroke="#fde047"
                  strokeDasharray="4 4"
                  label={{ value: 'USG', position: 'insideTopLeft', fill: '#fde047', fontSize: 9 }}
                />
              )}

              {selected.map(src => {
                const meta = ALL_SOURCES[src];
                const axis = leftSources.includes(src) ? 'left' : 'right';
                // Use bars for count data, lines for continuous
                if (src === 'fires' || src === 'earthquakes') {
                  return (
                    <Bar
                      key={src}
                      yAxisId={axis}
                      dataKey={src}
                      fill={meta.color}
                      name={meta.label}
                      opacity={0.7}
                    />
                  );
                }
                return (
                  <Line
                    key={src}
                    yAxisId={axis}
                    type="monotone"
                    dataKey={src}
                    stroke={meta.color}
                    strokeWidth={2}
                    dot={false}
                    name={meta.label}
                    connectNulls
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Correlation Matrix */}
      {Object.keys(corrMatrix).length > 0 && selected.length >= 2 && (
        <div className="bg-brand-bg-light rounded-lg p-5">
          <h3 className="text-base font-semibold text-slate-200 mb-3">Correlation Matrix</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="p-2 text-left text-slate-500" />
                  {selected.map(s => (
                    <th key={s} className="p-2 text-center text-slate-400 font-medium">
                      {ALL_SOURCES[s]?.label || s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selected.map(row => (
                  <tr key={row}>
                    <td className="p-2 text-slate-400 font-medium">{ALL_SOURCES[row]?.label || row}</td>
                    {selected.map(col => {
                      const r = corrMatrix[row]?.[col] ?? 0;
                      return (
                        <td
                          key={col}
                          className="p-2 text-center font-mono"
                          style={{
                            backgroundColor: corrColor(r),
                            color: Math.abs(r) > 0.5 ? '#fff' : '#94a3b8',
                          }}
                        >
                          {row === col ? '1.00' : r.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-600 mt-2">
            Pearson r: -1 (inverse) to +1 (positive correlation). Values near 0 indicate no linear relationship.
          </p>
        </div>
      )}

      {/* Claude Analysis Result */}
      {claudeResult && (
        <div className="bg-brand-bg-light rounded-lg p-5 space-y-3">
          <h3 className="text-base font-semibold text-slate-200">Claude Analysis</h3>
          <div
            className="prose prose-invert prose-sm max-w-none text-slate-300 whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: claudeResult.replace(/\n/g, '<br />') }}
          />
        </div>
      )}

      {/* Last updated */}
      {lastUpdated && (
        <p className="text-[10px] text-slate-600 text-right">
          Data loaded {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
};

// ── Helpers ──────────────────────────────────────────

function corrColor(r: number): string {
  const abs = Math.abs(r);
  if (abs < 0.1) return 'transparent';
  const intensity = Math.round(abs * 200);
  if (r > 0) return `rgba(34, 197, 94, ${intensity / 255})`; // green
  return `rgba(239, 68, 68, ${intensity / 255})`; // red
}

export default DataExplorer;
