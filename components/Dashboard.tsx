import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine, ComposedChart
} from 'recharts';
import { WarningIcon } from './icons/WarningIcon';
import {
  dataService,
  AQIRecord,
  WeatherRecord,
  ForecastRecord,
  HistoricalAQIRecord,
  HistoricalWeatherRecord
} from '../services/dataService';
import { locations, LocationKey } from '../data/dashboardData';

const comparisonColors = ['#3b82f6', '#ef4444', '#10b981', '#f97316', '#8b5cf6', '#eab308'];

const parseMonthString = (monthStr: string): Date => {
  const [month, year] = monthStr.replace("'", "").split(' ');
  const monthIndex = new Date(Date.parse(month + " 1, 2012")).getMonth();
  return new Date(parseInt(`20${year}`), monthIndex);
};

const Dashboard: React.FC = () => {
  const [selectedLocations, setSelectedLocations] = useState<LocationKey[]>(['Valley Average']);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [weatherGranularity, setWeatherGranularity] = useState<'daily' | 'monthly'>('monthly');

  const [aqiData, setAqiData] = useState<AQIRecord[]>([]);
  const [weatherData, setWeatherData] = useState<WeatherRecord[]>([]);
  const [forecastData, setForecastData] = useState<ForecastRecord[]>([]);
  const [historicalAqi, setHistoricalAqi] = useState<HistoricalAQIRecord[]>([]);
  const [historicalWeather, setHistoricalWeather] = useState<HistoricalWeatherRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [aqi, weather, forecast, histAqi, histWeather] = await Promise.all([
          dataService.getCurrentAQI(),
          dataService.getCurrentWeather(),
          dataService.getWeatherForecast(),
          dataService.getHistoricalAQI(),
          dataService.getHistoricalWeather()
        ]);
        setAqiData(aqi);
        setWeatherData(weather);
        setForecastData(forecast);
        setHistoricalAqi(histAqi);
        setHistoricalWeather(histWeather);

        if (histAqi.length > 0) {
          const valleyData = histAqi.filter(r => r.locationName === 'Valley Average');
          if (valleyData.length > 0) {
            const firstMonth = parseMonthString(valleyData[0].month);
            const lastMonth = parseMonthString(valleyData[valleyData.length - 1].month);
            const formatToInput = (date: Date) => date.toISOString().slice(0, 7);
            setStartDate(formatToInput(firstMonth));
            setEndDate(formatToInput(lastMonth));
          }
        }
      } catch (err) {
        console.error("Failed to fetch dashboard data", err);
        setError("Failed to load data. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleLocationToggle = (location: LocationKey) => {
    setSelectedLocations(prev => {
      const isSelected = prev.includes(location);
      if (isSelected) {
        if (prev.length === 1) return prev;
        return prev.filter(l => l !== location);
      } else {
        return [...prev, location];
      }
    });
  };

  const isComparisonMode = selectedLocations.length > 1;

  const getAqiColor = (aqi: number) => {
    if (aqi <= 50) return 'text-green-500';
    if (aqi <= 100) return 'text-yellow-400';
    if (aqi <= 150) return 'text-orange-500';
    if (aqi <= 200) return 'text-red-500';
    if (aqi <= 300) return 'text-purple-500';
    return 'text-maroon-500';
  }

  const activeAlerts = useMemo(() => {
    const alerts: { name: string; aqi: number }[] = [];
    const relevantRecords = aqiData.filter(r =>
      selectedLocations.includes('Valley Average') || selectedLocations.includes(r.locationName as LocationKey)
    );

    relevantRecords.forEach(r => {
      if (r.aqi > 100) {
        alerts.push({ name: r.locationName, aqi: r.aqi });
      }
    });

    // Deduplicate by name
    return Array.from(new Set(alerts.map(a => a.name)))
      .map(name => alerts.find(a => a.name === name)!);

  }, [selectedLocations, aqiData]);

  const mergedForecastData = useMemo(() => {
    const dayMap = new Map<string, Record<string, any>>();

    forecastData.forEach(record => {
      if (selectedLocations.includes(record.locationName as LocationKey)) {
        const dayName = record.date.toLocaleDateString('en-US', { weekday: 'short' });

        if (!dayMap.has(dayName)) {
          dayMap.set(dayName, { day: dayName });
        }
        const entry = dayMap.get(dayName)!;
        entry[`${record.locationName}_temp`] = record.tempHigh;
        entry[`${record.locationName}_humidity`] = record.humidity;
      }
    });
    return Array.from(dayMap.values());
  }, [selectedLocations, forecastData]);

  const getFilteredHistoricalData = useCallback((dataType: 'historicalAqi' | 'historicalWeather') => {
    if (!startDate || !endDate) return { filteredMonthOrder: [] };

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setMonth(end.getMonth() + 1, 0);

    return { start, end };
  }, [startDate, endDate]);

  const mergedHistoricalAqi = useMemo(() => {
    if (!startDate || !endDate) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setMonth(end.getMonth() + 1, 0);

    const monthMap = new Map<string, Record<string, any>>();

    historicalAqi.forEach(record => {
      if (selectedLocations.includes(record.locationName as LocationKey)) {
        const monthIndex = new Date(Date.parse(record.month + " 1, 2012")).getMonth();
        const rDate = new Date(record.year, monthIndex);

        if (rDate >= start && rDate <= end) {
          const monthKey = `${record.month} '${record.year.toString().slice(-2)}`;
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, { month: monthKey, date: rDate });
          }
          monthMap.get(monthKey)![record.locationName] = record.avgAqi;
        }
      }
    });

    return Array.from(monthMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [selectedLocations, startDate, endDate, historicalAqi]);

  const mergedHistoricalPm25 = useMemo(() => {
    if (!startDate || !endDate) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setMonth(end.getMonth() + 1, 0);

    const monthMap = new Map<string, Record<string, any>>();

    historicalAqi.forEach(record => {
      if (selectedLocations.includes(record.locationName as LocationKey)) {
        const monthIndex = new Date(Date.parse(record.month + " 1, 2012")).getMonth();
        const rDate = new Date(record.year, monthIndex);

        if (rDate >= start && rDate <= end) {
          const monthKey = `${record.month} '${record.year.toString().slice(-2)}`;
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, { month: monthKey, date: rDate });
          }
          monthMap.get(monthKey)![record.locationName] = record.avgPm25;
        }
      }
    });

    return Array.from(monthMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [selectedLocations, startDate, endDate, historicalAqi]);

  const mergedHistoricalWeather = useMemo(() => {
    if (!startDate || !endDate) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setMonth(end.getMonth() + 1, 0);

    const monthMap = new Map<string, Record<string, any>>();

    historicalWeather.forEach(record => {
      if (selectedLocations.includes(record.locationName as LocationKey)) {
        const monthIndex = new Date(Date.parse(record.month + " 1, 2012")).getMonth();
        const rDate = new Date(record.year, monthIndex);

        if (rDate >= start && rDate <= end) {
          const monthKey = `${record.month} '${record.year.toString().slice(-2)}`;
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, { month: monthKey, date: rDate });
          }
          const entry = monthMap.get(monthKey)!;
          entry[`${record.locationName}_temp`] = record.avgTemp;
          entry[`${record.locationName}_precip`] = record.totalPrecipitation;
        }
      }
    });

    return Array.from(monthMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [selectedLocations, startDate, endDate, historicalWeather]);

  const mergedHumidityData = useMemo(() => {
    if (!startDate || !endDate) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setMonth(end.getMonth() + 1, 0);

    const monthMap = new Map<string, Record<string, any>>();

    historicalWeather.forEach(record => {
      if (selectedLocations.includes(record.locationName as LocationKey)) {
        const monthIndex = new Date(Date.parse(record.month + " 1, 2012")).getMonth();
        const rDate = new Date(record.year, monthIndex);

        if (rDate >= start && rDate <= end) {
          const monthKey = `${record.month} '${record.year.toString().slice(-2)}`;
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, { month: monthKey, date: rDate });
          }
          monthMap.get(monthKey)![record.locationName] = record.avgHumidity;
        }
      }
    });

    return Array.from(monthMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [selectedLocations, startDate, endDate, historicalWeather]);

  const mergedWindData = useMemo(() => {
    if (!startDate || !endDate) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setMonth(end.getMonth() + 1, 0);

    const monthMap = new Map<string, Record<string, any>>();

    historicalWeather.forEach(record => {
      if (selectedLocations.includes(record.locationName as LocationKey)) {
        const monthIndex = new Date(Date.parse(record.month + " 1, 2012")).getMonth();
        const rDate = new Date(record.year, monthIndex);

        if (rDate >= start && rDate <= end) {
          const monthKey = `${record.month} '${record.year.toString().slice(-2)}`;
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, { month: monthKey, date: rDate });
          }
          monthMap.get(monthKey)![record.locationName] = record.avgWindSpeed;
        }
      }
    });

    return Array.from(monthMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [selectedLocations, startDate, endDate, historicalWeather]);

  const mergedUVData = useMemo(() => {
    if (!startDate || !endDate) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setMonth(end.getMonth() + 1, 0);

    const monthMap = new Map<string, Record<string, any>>();

    historicalWeather.forEach(record => {
      if (selectedLocations.includes(record.locationName as LocationKey)) {
        const monthIndex = new Date(Date.parse(record.month + " 1, 2012")).getMonth();
        const rDate = new Date(record.year, monthIndex);

        if (rDate >= start && rDate <= end) {
          const monthKey = `${record.month} '${record.year.toString().slice(-2)}`;
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, { month: monthKey, date: rDate });
          }
          monthMap.get(monthKey)![record.locationName] = record.maxUV;
        }
      }
    });

    return Array.from(monthMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [selectedLocations, startDate, endDate, historicalWeather]);

  const mergedAgriculturalData = useMemo(() => {
    if (!startDate || !endDate) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setMonth(end.getMonth() + 1, 0);

    const monthMap = new Map<string, Record<string, any>>();

    historicalWeather.forEach(record => {
      if (selectedLocations.includes(record.locationName as LocationKey)) {
        const monthIndex = new Date(Date.parse(record.month + " 1, 2012")).getMonth();
        const rDate = new Date(record.year, monthIndex);

        if (rDate >= start && rDate <= end) {
          const monthKey = `${record.month} '${record.year.toString().slice(-2)}`;
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, { month: monthKey, date: rDate });
          }
          const entry = monthMap.get(monthKey)!;
          entry[`${record.locationName}_et0`] = record.avgEt0;
          entry[`${record.locationName}_solar`] = record.avgSolarRad;
        }
      }
    });

    return Array.from(monthMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [selectedLocations, startDate, endDate, historicalWeather]);

  const renderCurrentConditions = () => {
    if (loading) return <div className="text-slate-400 p-8 text-center">Loading data...</div>;
    if (error) return (
      <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-6 text-center">
        <p className="text-red-400 mb-3">{error}</p>
        <button
          onClick={() => { setError(null); setLoading(true); window.location.reload(); }}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
        >
          Retry
        </button>
      </div>
    );

    if (!isComparisonMode) {
      const location = selectedLocations[0];
      const aqi = aqiData.find(r => r.locationName === location);
      const weather = weatherData.find(r => r.locationName === location);

      if (!aqi && !weather) return null;

      if (location === 'Valley Average') {
        const regionalData = aqiData.filter(r => r.locationName !== 'Valley Average').map(r => ({
          name: r.locationName,
          aqi: r.aqi,
          pm25: r.pm25
        }));

        const avgTemp = weatherData.length > 0 ? Math.round(weatherData.reduce((sum, r) => sum + r.temperature, 0) / weatherData.length) : 0;
        const avgHum = weatherData.length > 0 ? Math.round(weatherData.reduce((sum, r) => sum + r.humidity, 0) / weatherData.length) : 0;

        return (
          <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-semibold text-slate-200">Regional Air Quality Index (AQI)</h3>
                <p className="text-sm text-slate-400">Real-time AQI and PM2.5 levels across major cities.</p>
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <div className="flex items-center justify-end gap-2">
                  <span className="text-2xl font-bold text-slate-200">{avgTemp}°F</span>
                  <TemperatureIcon className="w-6 h-6 text-red-400" />
                </div>
                <p className="text-sm text-slate-400">Avg. Temperature</p>
                <div className="flex items-center justify-end gap-2 mt-2">
                  <span className="text-2xl font-bold text-slate-200">{avgHum}%</span>
                  <HumidityIcon className="w-6 h-6 text-sky-400" />
                </div>
                <p className="text-sm text-slate-400">Avg. Humidity</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={regionalData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                <Legend />
                <Bar dataKey="aqi" fill="#ef4444" name="AQI" />
                <Bar dataKey="pm25" fill="#f97316" name="PM2.5" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      } else {
        return (
          <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-slate-200 mb-2">Current Conditions in {location}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center py-4">
              {aqi && (
                <>
                  <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-brand-bg-dark/50">
                    <p className={`text-5xl font-bold ${getAqiColor(aqi.aqi)}`}>{aqi.aqi}</p>
                    <p className="text-slate-400 font-semibold mt-1">AQI</p>
                  </div>
                  <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-brand-bg-dark/50">
                    <p className={`text-5xl font-bold ${getAqiColor(aqi.pm25 * 2.5)}`}>{aqi.pm25}</p>
                    <p className="text-slate-400 font-semibold mt-1 text-sm">PM2.5 (&micro;g/m³)</p>
                  </div>
                </>
              )}
              {weather && (
                <>
                  <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-brand-bg-dark/50">
                    <p className="text-5xl font-bold text-slate-200 flex items-baseline justify-center">
                      {weather.temperature}<span className="text-3xl">°F</span>
                    </p>
                    <p className="text-slate-400 font-semibold flex items-center gap-1.5 mt-1">
                      <TemperatureIcon className="w-5 h-5 text-red-400" />
                      Temperature
                    </p>
                  </div>
                  <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-brand-bg-dark/50">
                    <p className="text-5xl font-bold text-slate-200 flex items-baseline justify-center">
                      {weather.humidity}<span className="text-3xl">%</span>
                    </p>
                    <p className="text-slate-400 font-semibold flex items-center gap-1.5 mt-1">
                      <HumidityIcon className="w-5 h-5 text-sky-400" />
                      Humidity
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      }
    }

    const cityLocations = selectedLocations.filter(loc => loc !== 'Valley Average') as Exclude<LocationKey, 'Valley Average'>[];
    return (
      <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
        <h3 className="text-xl font-semibold text-slate-200 mb-4">Current Conditions Comparison</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4">
          {cityLocations.map(loc => {
            const aqi = aqiData.find(r => r.locationName === loc);
            const weather = weatherData.find(r => r.locationName === loc);

            if (aqi) {
              return (
                <div key={loc} className="text-center bg-brand-bg-dark p-3 rounded-md">
                  <h4 className="font-bold text-slate-300">{loc}</h4>
                  <p className={`text-4xl font-bold ${getAqiColor(aqi.aqi)}`}>{aqi.aqi}</p>
                  <p className="text-sm text-slate-400">AQI</p>
                  <p className={`text-2xl font-bold mt-2 ${getAqiColor(aqi.pm25 * 2.5)}`}>{aqi.pm25}</p>
                  <p className="text-xs text-slate-500">PM2.5</p>
                  {weather &&
                    <div className="flex justify-around mt-3 pt-3 border-t border-brand-bg-lighter">
                      <div className="text-center flex items-center gap-1.5 text-slate-300">
                        <TemperatureIcon className="w-4 h-4 text-red-400" />
                        <span className="font-semibold">{weather.temperature}°F</span>
                      </div>
                      <div className="text-center flex items-center gap-1.5 text-slate-300">
                        <HumidityIcon className="w-4 h-4 text-sky-400" />
                        <span className="font-semibold">{weather.humidity}%</span>
                      </div>
                    </div>
                  }
                </div>
              )
            }
            return null;
          })}
          {cityLocations.length === 0 && <p className="text-slate-400 col-span-full text-center">Select one or more cities to see a comparison.</p>}
        </div>
      </div>
    )
  }

  const renderDateFilter = () => (
    <div className="flex flex-col md:flex-row gap-4 items-center bg-brand-bg-dark/50 p-3 rounded-md border border-brand-secondary">
      <label className="text-sm font-medium text-slate-300 flex-shrink-0">Filter Date Range:</label>
      <div className="flex gap-4 w-full md:w-auto">
        <input
          type="month"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full p-2 bg-brand-bg-lighter border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-sm"
        />
        <span className="text-slate-400 self-center">-</span>
        <input
          type="month"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-full p-2 bg-brand-bg-lighter border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-sm"
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-100 mb-2">Welcome to GeoIntelliSense</h2>
        <p className="text-slate-400 max-w-3xl">
          This dashboard provides an analytical view of air quality and weather data for the San Joaquin Valley.
          Select one or more locations below to analyze trends and compare data.
        </p>
      </div>

      <div className="space-y-4">
        <label className="block text-sm font-medium text-slate-400 mb-2">Select Locations for Comparison:</label>
        <div className="flex flex-wrap gap-2">
          {locations.map(loc => (
            <button
              key={loc}
              onClick={() => handleLocationToggle(loc)}
              className={`px-4 py-2 text-sm font-semibold rounded-full transition-all duration-200 ${selectedLocations.includes(loc)
                ? 'bg-brand-primary text-white shadow-md'
                : 'bg-brand-bg-lighter text-slate-300 hover:bg-brand-secondary'
                }`}
            >
              {loc}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-8">
        {activeAlerts.length > 0 && (
          <div className="bg-orange-900/50 border border-orange-700 text-orange-200 p-4 rounded-lg flex items-start space-x-3">
            <WarningIcon className="w-6 h-6 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-bold">Air Quality Alert</h4>
              <p className="text-sm">
                Air quality is 'Unhealthy for Sensitive Groups' or worse in: {activeAlerts.map(a => `${a.name} (AQI: ${a.aqi})`).join(', ')}.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {renderCurrentConditions()}
          <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-slate-200 mb-4">7-Day Weather Forecast</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={mergedForecastData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="day" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                <Legend />
                {selectedLocations.map((loc, i) => (
                  <Line key={`${loc}_temp`} type="monotone" dataKey={`${loc}_temp`} stroke={comparisonColors[i % comparisonColors.length]} name={`Temp in ${loc} (°F)`} strokeWidth={2} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-6 pt-8 border-t border-brand-secondary">
          <div className="flex flex-col md:flex-row justify-between items-end gap-4">
            <div>
              <h3 className="text-2xl font-bold text-slate-100">Historical Analysis</h3>
              <p className="text-slate-400">Long-term patterns in air quality and weather.</p>
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-sm font-medium text-slate-300">View:</span>
              <button
                onClick={() => setWeatherGranularity('monthly')}
                className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${weatherGranularity === 'monthly'
                  ? 'bg-brand-primary text-white'
                  : 'bg-brand-bg-lighter text-slate-300 hover:bg-brand-secondary'
                  }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setWeatherGranularity('daily')}
                className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${weatherGranularity === 'daily'
                  ? 'bg-brand-primary text-white'
                  : 'bg-brand-bg-lighter text-slate-300 hover:bg-brand-secondary'
                  }`}
                disabled
              >
                Daily (Coming Soon)
              </button>
            </div>
          </div>

          {renderDateFilter()}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-slate-200 mb-4">Monthly Average AQI Trend</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={mergedHistoricalAqi}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                  <XAxis dataKey="month" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" domain={[0, 'dataMax + 20']} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                  <Legend />
                  <ReferenceLine y={100} label={{ value: "Unhealthy (Sensitive)", position: "insideTopLeft", fill: '#fde047' }} stroke="#fde047" strokeDasharray="4 4" />
                  {selectedLocations.map((loc, i) => (
                    <Line key={loc} type="monotone" dataKey={loc} stroke={comparisonColors[i % comparisonColors.length]} name={loc} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-slate-200 mb-4">Monthly Average PM2.5 Trend</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={mergedHistoricalPm25}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                  <XAxis dataKey="month" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" domain={[0, 'dataMax + 10']} label={{ value: 'PM2.5 (µg/m³)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                  <Legend />
                  <ReferenceLine y={35} label={{ value: "High", position: "insideTopLeft", fill: '#f97316' }} stroke="#f97316" strokeDasharray="4 4" />
                  {selectedLocations.map((loc, i) => (
                    <Line key={loc} type="monotone" dataKey={loc} stroke={comparisonColors[i % comparisonColors.length]} name={loc} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-slate-200 mb-4">Historical Temperature & Precipitation</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={mergedHistoricalWeather}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="month" stroke="#94a3b8" />
                <YAxis yAxisId="left" stroke="#ef4444" label={{ value: 'Temp (°F)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" label={{ value: 'Precip (in)', angle: -90, position: 'insideRight', fill: '#cbd5e1' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                <Legend />
                {selectedLocations.map((loc, i) => (
                  <Bar key={`${loc}_precip`} yAxisId="right" dataKey={`${loc}_precip`} fill={comparisonColors[i % comparisonColors.length]} name={`Precip in ${loc}`} opacity={0.7} />
                ))}
                {selectedLocations.map((loc, i) => (
                  <Line key={`${loc}_temp`} yAxisId="left" type="monotone" dataKey={`${loc}_temp`} stroke={comparisonColors[i % comparisonColors.length]} strokeWidth={2} name={`Temp in ${loc}`} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-slate-200 mb-4">Humidity Trends</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={mergedHumidityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                  <XAxis dataKey="month" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" domain={[0, 100]} label={{ value: 'Humidity (%)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                  <Legend />
                  {selectedLocations.map((loc, i) => (
                    <Line key={loc} type="monotone" dataKey={loc} stroke={comparisonColors[i % comparisonColors.length]} name={loc} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-slate-200 mb-4">Wind Speed Patterns</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={mergedWindData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                  <XAxis dataKey="month" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" domain={[0, 'dataMax + 5']} label={{ value: 'Wind Speed (mph)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                  <Legend />
                  {selectedLocations.map((loc, i) => (
                    <Line key={loc} type="monotone" dataKey={loc} stroke={comparisonColors[i % comparisonColors.length]} name={loc} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-slate-200 mb-4">UV Index Trends</h3>
            <p className="text-sm text-slate-400 mb-4">Monthly maximum UV index values (0-2: Low, 3-5: Moderate, 6-7: High, 8-10: Very High, 11+: Extreme)</p>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mergedUVData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="month" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" domain={[0, 11]} label={{ value: 'UV Index', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                <Legend />
                <ReferenceLine y={6} label={{ value: "High", position: "insideTopRight", fill: '#f97316' }} stroke="#f97316" strokeDasharray="4 4" />
                <ReferenceLine y={8} label={{ value: "Very High", position: "insideTopRight", fill: '#ef4444' }} stroke="#ef4444" strokeDasharray="4 4" />
                {selectedLocations.map((loc, i) => (
                  <Bar key={loc} dataKey={loc} fill={comparisonColors[i % comparisonColors.length]} name={loc} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg border-2 border-green-900/50">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-xl font-semibold text-slate-200">Agricultural Metrics</h3>
              <span className="text-xs bg-green-900/50 text-green-300 px-2 py-1 rounded-full">For Valley Farming</span>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              Evapotranspiration (ET0) and Solar Radiation are critical for irrigation scheduling and crop water management.
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={mergedAgriculturalData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="month" stroke="#94a3b8" />
                <YAxis yAxisId="left" stroke="#10b981" label={{ value: 'ET0 (mm/day)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                <YAxis yAxisId="right" orientation="right" stroke="#fbbf24" label={{ value: 'Solar Rad (W/m²)', angle: -90, position: 'insideRight', fill: '#cbd5e1' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                <Legend />
                {selectedLocations.map((loc, i) => (
                  <Bar key={`${loc}_solar`} yAxisId="right" dataKey={`${loc}_solar`} fill={comparisonColors[i % comparisonColors.length]} name={`Solar Rad in ${loc}`} opacity={0.5} />
                ))}
                {selectedLocations.map((loc, i) => (
                  <Line key={`${loc}_et0`} yAxisId="left" type="monotone" dataKey={`${loc}_et0`} stroke={comparisonColors[i % comparisonColors.length]} strokeWidth={2} name={`ET0 in ${loc}`} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

    </div>
  );
};

const TemperatureIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
  </svg>
);

const HumidityIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
  </svg>
);

export default Dashboard;
