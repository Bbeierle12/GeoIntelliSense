import React from 'react';
import { AqiGaugeWidget } from './widgets/AqiGaugeWidget';
import { AqiTrendWidget } from './widgets/AqiTrendWidget';
import { AqiForecastWidget } from './widgets/AqiForecastWidget';
import { WeatherWidget } from './widgets/WeatherWidget';
import { FiresWidget } from './widgets/FiresWidget';
import { InversionWidget } from './widgets/InversionWidget';
import { EarthquakeWidget } from './widgets/EarthquakeWidget';
import { WaterWidget } from './widgets/WaterWidget';

const LiveDashboard: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Live Dashboard</h2>
        <p className="text-sm text-slate-400 mt-1">
          Real-time environmental monitoring for the San Joaquin Valley
        </p>
      </div>

      {/* Responsive grid: 2 cols desktop, 1 mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Row 1: AQI gauge + trend */}
        <AqiGaugeWidget />
        <AqiTrendWidget />

        {/* Row 2: Forecast + weather */}
        <AqiForecastWidget />
        <WeatherWidget />

        {/* Row 3: Fires + inversion */}
        <FiresWidget />
        <InversionWidget />

        {/* Row 4: Earthquakes + water */}
        <EarthquakeWidget />
        <WaterWidget />
      </div>
    </div>
  );
};

export default LiveDashboard;
