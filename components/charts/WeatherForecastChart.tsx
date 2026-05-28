import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

interface WeatherForecastChartProps {
  data: any[];
  selectedLocations: string[];
  comparisonColors: string[];
}

export const WeatherForecastChart: React.FC<WeatherForecastChartProps> = ({
  data,
  selectedLocations,
  comparisonColors
}) => {
  return (
    <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
      <h3 className="text-xl font-semibold text-slate-200 mb-4">7-Day Weather Forecast</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
          <XAxis dataKey="day" stroke="#94a3b8" />
          <YAxis stroke="#94a3b8" />
          <Tooltip
            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
            labelStyle={{ color: '#cbd5e1' }}
          />
          <Legend />
          {selectedLocations.map((loc, i) => (
            <Line
              key={`${loc}_temp`}
              type="monotone"
              dataKey={`${loc}_temp`}
              stroke={comparisonColors[i % comparisonColors.length]}
              name={`Temp in ${loc} (°F)`}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};