import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine
} from 'recharts';
import { WarningIcon } from './icons/WarningIcon';
import { dashboardData, locations, LocationKey } from '../data/dashboardData';

const comparisonColors = ['#3b82f6', '#ef4444', '#10b981', '#f97316', '#8b5cf6', '#eab308'];


const Dashboard: React.FC = () => {
  const [selectedLocations, setSelectedLocations] = useState<LocationKey[]>(['Valley Average']);

  const handleLocationToggle = (location: LocationKey) => {
    setSelectedLocations(prev => {
        const isSelected = prev.includes(location);
        if (isSelected) {
            if (prev.length === 1) return prev; // Don't allow unselecting the last one
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
    const checkedLocations = new Set<string>();
    
    selectedLocations.forEach(loc => {
        if (loc === 'Valley Average') {
            dashboardData[loc].regionalAqi.forEach(city => {
                if (city.aqi > 100 && !checkedLocations.has(city.name)) {
                    alerts.push({ name: city.name, aqi: city.aqi });
                    checkedLocations.add(city.name);
                }
            });
        } else {
            if (!checkedLocations.has(loc)) {
                const data = dashboardData[loc];
                if ('currentAqi' in data && data.currentAqi && data.currentAqi.aqi > 100) {
                    alerts.push({ name: loc, aqi: data.currentAqi.aqi });
                    checkedLocations.add(loc);
                }
            }
        }
    });
    return alerts;
  }, [selectedLocations]);

  // Memoize merged data for performance
  const mergedForecastData = useMemo(() => {
    const dayMap = new Map<string, Record<string, any>>();
    selectedLocations.forEach(loc => {
        const locData = dashboardData[loc].weatherForecast;
        locData.forEach(dataPoint => {
            if (!dayMap.has(dataPoint.day)) {
                dayMap.set(dataPoint.day, { day: dataPoint.day });
            }
            const entry = dayMap.get(dataPoint.day)!;
            entry[`${loc}_temp`] = dataPoint.temp;
            entry[`${loc}_humidity`] = dataPoint.humidity;
        });
    });
    const dayOrder = dashboardData['Valley Average'].weatherForecast.map(d => d.day);
    return dayOrder.map(day => dayMap.get(day)).filter(Boolean);
  }, [selectedLocations]);

  const mergedHistoricalAqi = useMemo(() => {
    const monthMap = new Map<string, Record<string, any>>();
    selectedLocations.forEach(loc => {
        const locData = dashboardData[loc].historicalAqi;
        locData.forEach(dataPoint => {
            if (!monthMap.has(dataPoint.month)) {
                monthMap.set(dataPoint.month, { month: dataPoint.month });
            }
            monthMap.get(dataPoint.month)![loc] = dataPoint.avgAqi;
        });
    });
    const monthOrder = dashboardData['Valley Average'].historicalAqi.map(d => d.month);
    return monthOrder.map(month => monthMap.get(month)).filter(Boolean);
  }, [selectedLocations]);
  
  const mergedHistoricalPm25 = useMemo(() => {
    const monthMap = new Map<string, Record<string, any>>();
    selectedLocations.forEach(loc => {
        const locData = dashboardData[loc].historicalAqi;
        locData.forEach(dataPoint => {
            if (!monthMap.has(dataPoint.month)) {
                monthMap.set(dataPoint.month, { month: dataPoint.month });
            }
            monthMap.get(dataPoint.month)![loc] = dataPoint.avgPm25;
        });
    });
    const monthOrder = dashboardData['Valley Average'].historicalAqi.map(d => d.month);
    return monthOrder.map(month => monthMap.get(month)).filter(Boolean);
  }, [selectedLocations]);

  const mergedHistoricalWeather = useMemo(() => {
    const monthMap = new Map<string, Record<string, any>>();
    selectedLocations.forEach(loc => {
        const locData = dashboardData[loc].historicalWeather;
        locData.forEach(dataPoint => {
            if (!monthMap.has(dataPoint.month)) {
                monthMap.set(dataPoint.month, { month: dataPoint.month });
            }
            const entry = monthMap.get(dataPoint.month)!;
            entry[`${loc}_temp`] = dataPoint.avgTemp;
            entry[`${loc}_precip`] = dataPoint.precipitation;
        });
    });
     const monthOrder = dashboardData['Valley Average'].historicalWeather.map(d => d.month);
    return monthOrder.map(month => monthMap.get(month)).filter(Boolean);
  }, [selectedLocations]);

  const renderCurrentConditions = () => {
    if (!isComparisonMode) {
      const location = selectedLocations[0];
      const data = dashboardData[location];
      if (location === 'Valley Average') {
        return (
          <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-slate-200 mb-4">Regional Air Quality Index (AQI)</h3>
              <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.regionalAqi}>
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
        const currentData = dashboardData[location];
        if ('currentAqi' in currentData) {
            return (
                <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
                    <h3 className="text-xl font-semibold text-slate-200 mb-4">Current Conditions in {location}</h3>
                    <div className="flex justify-around items-center h-full pt-8 pb-4">
                        <div className="text-center">
                            <p className={`text-6xl font-bold ${getAqiColor(currentData.currentAqi.aqi)}`}>{currentData.currentAqi.aqi}</p>
                            <p className="text-slate-400 font-semibold">AQI</p>
                        </div>
                        <div className="text-center">
                            <p className={`text-6xl font-bold ${getAqiColor(currentData.currentAqi.pm25 * 2.5)}`}>{currentData.currentAqi.pm25}</p> 
                            <p className="text-slate-400 font-semibold">PM2.5 (&micro;g/m³)</p>
                        </div>
                    </div>
                </div>
            )
        }
        return null;
      }
    }

    // Comparison view for current conditions
    const cityLocations = selectedLocations.filter(loc => loc !== 'Valley Average') as Exclude<LocationKey, 'Valley Average'>[];
    return (
      <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
        <h3 className="text-xl font-semibold text-slate-200 mb-4">Current Conditions Comparison</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4">
            {cityLocations.map(loc => {
                const data = dashboardData[loc];
                if ('currentAqi' in data) {
                    return (
                        <div key={loc} className="text-center bg-brand-bg-dark p-3 rounded-md">
                            <h4 className="font-bold text-slate-300">{loc}</h4>
                            <p className={`text-4xl font-bold ${getAqiColor(data.currentAqi.aqi)}`}>{data.currentAqi.aqi}</p>
                            <p className="text-sm text-slate-400">AQI</p>
                            <p className={`text-2xl font-bold mt-2 ${getAqiColor(data.currentAqi.pm25 * 2.5)}`}>{data.currentAqi.pm25}</p>
                            <p className="text-xs text-slate-500">PM2.5</p>
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
                    className={`px-4 py-2 text-sm font-semibold rounded-full transition-all duration-200 ${
                        selectedLocations.includes(loc)
                        ? 'bg-brand-primary text-white shadow-md'
                        : 'bg-brand-bg-lighter text-slate-300 hover:bg-brand-secondary'
                    }`}
                >
                    {loc}
                </button>
            ))}
          </div>
          {activeAlerts.length > 0 && (
             <div className="bg-orange-900/50 border border-orange-700 text-orange-200 p-4 rounded-lg flex items-start space-x-3 mt-4">
                <WarningIcon className="w-6 h-6 flex-shrink-0 mt-1" />
                <div>
                    <h4 className="font-bold">Air Quality Alert</h4>
                    <p className="text-sm">
                        Air quality is 'Unhealthy for Sensitive Groups' or worse in: {activeAlerts.map(a => `${a.name} (AQI: ${a.aqi})`).join(', ')}.
                    </p>
                </div>
            </div>
          )}
      </div>

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

      <div className="space-y-6 pt-8">
        <div>
            <h3 className="text-2xl font-bold text-slate-100">Historical Data Trends (Past 12 Months)</h3>
            <p className="text-slate-400">Analyzing long-term patterns in air quality and weather.</p>
        </div>
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
                        <Line key={loc} type="monotone" dataKey={loc} stroke={comparisonColors[i % comparisonColors.length]} name={loc} strokeWidth={2}/>
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
                    <YAxis stroke="#94a3b8" domain={[0, 'dataMax + 10']} label={{ value: 'PM2.5 (µg/m³)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }}/>
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }}/>
                    <Legend />
                    <ReferenceLine y={35} label={{ value: "High", position: "insideTopLeft", fill: '#f97316' }} stroke="#f97316" strokeDasharray="4 4" />
                     {selectedLocations.map((loc, i) => (
                        <Line key={loc} type="monotone" dataKey={loc} stroke={comparisonColors[i % comparisonColors.length]} name={loc} strokeWidth={2}/>
                    ))}
                </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-slate-200 mb-4">Monthly Average Temperature</h3>
             <ResponsiveContainer width="100%" height={300}>
                <LineChart data={mergedHistoricalWeather}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                    <XAxis dataKey="month" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" label={{ value: 'Temp (°F)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }}/>
                    <Legend />
                    {selectedLocations.map((loc, i) => (
                        <Line key={`${loc}_temp`} type="monotone" dataKey={`${loc}_temp`} stroke={comparisonColors[i % comparisonColors.length]} strokeWidth={2} name={`Temp in ${loc}`} />
                    ))}
                </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-slate-200 mb-4">Monthly Total Precipitation</h3>
             <ResponsiveContainer width="100%" height={300}>
                <BarChart data={mergedHistoricalWeather}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                    <XAxis dataKey="month" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" label={{ value: 'Precip (in)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }}/>
                    <Legend />
                    {selectedLocations.map((loc, i) => (
                        <Bar key={`${loc}_precip`} dataKey={`${loc}_precip`} fill={comparisonColors[i % comparisonColors.length]} name={`Precip in ${loc}`} />
                    ))}
                </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
