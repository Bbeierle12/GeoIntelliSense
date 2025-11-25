import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

interface PM25TrendChartProps {
  data: any[];
  selectedLocations: string[];
  comparisonColors: string[];
}

export const PM25TrendChart: React.FC<PM25TrendChartProps> = ({
  data,
  selectedLocations,
  comparisonColors
}) => {
  return (
    <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
      <h3 className="text-xl font-semibold text-slate-200 mb-4">Monthly Average PM2.5 Trend</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
          <XAxis dataKey="month" stroke="#94a3b8" />
          <YAxis
            stroke="#94a3b8"
            domain={[0, 'dataMax + 10']}
            label={{ value: 'PM2.5 (µg/m³)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
            labelStyle={{ color: '#cbd5e1' }}
          />
          <Legend />
          <ReferenceLine
            y={35}
            label={{ value: "High", position: "insideTopLeft", fill: '#f97316' }}
            stroke="#f97316"
            strokeDasharray="4 4"
          />
          {selectedLocations.map((loc, i) => (
            <Line
              key={loc}
              type="monotone"
              dataKey={loc}
              stroke={comparisonColors[i % comparisonColors.length]}
              name={loc}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};