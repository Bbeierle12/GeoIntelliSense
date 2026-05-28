import React from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

interface TemperaturePrecipitationChartProps {
  data: any[];
  selectedLocations: string[];
  comparisonColors: string[];
}

export const TemperaturePrecipitationChart: React.FC<TemperaturePrecipitationChartProps> = ({
  data,
  selectedLocations,
  comparisonColors
}) => {
  return (
    <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
      <h3 className="text-xl font-semibold text-slate-200 mb-4">Historical Temperature & Precipitation</h3>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
          <XAxis dataKey="month" stroke="#94a3b8" />
          <YAxis
            yAxisId="left"
            stroke="#ef4444"
            label={{ value: 'Temp (°F)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#3b82f6"
            label={{ value: 'Precip (in)', angle: -90, position: 'insideRight', fill: '#cbd5e1' }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
            labelStyle={{ color: '#cbd5e1' }}
          />
          <Legend />
          {selectedLocations.map((loc, i) => (
            <Bar
              key={`${loc}_precip`}
              yAxisId="right"
              dataKey={`${loc}_precip`}
              fill={comparisonColors[i % comparisonColors.length]}
              name={`Precip in ${loc}`}
              opacity={0.7}
            />
          ))}
          {selectedLocations.map((loc, i) => (
            <Line
              key={`${loc}_temp`}
              yAxisId="left"
              type="monotone"
              dataKey={`${loc}_temp`}
              stroke={comparisonColors[i % comparisonColors.length]}
              strokeWidth={2}
              name={`Temp in ${loc}`}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};