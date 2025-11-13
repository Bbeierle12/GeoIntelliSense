// FIX: Import useCallback hook from React.
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine, ComposedChart
} from 'recharts';
import { WarningIcon } from './icons/WarningIcon';
import { EyeIcon } from './icons/EyeIcon';
import { WindIcon } from './icons/WindIcon';
import { CloudIcon } from './icons/CloudIcon';
import { dashboardData, locations, LocationKey } from '../data/dashboardData';

const comparisonColors = ['#3b82f6', '#ef4444', '#10b981', '#f97316', '#8b5cf6', '#eab308'];

type DashboardTab = 'overview' | 'aqi' | 'weather';

const parseMonthString = (monthStr: string): Date => {
    const [month, year] = monthStr.replace("'", "").split(' ');
    const monthIndex = new Date(Date.parse(month +" 1, 2012")).getMonth();
    return new Date(parseInt(`20${year}`), monthIndex);
};

const Dashboard: React.FC = () => {
  const [selectedLocations, setSelectedLocations] = useState<LocationKey[]>(['Valley Average']);
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  useEffect(() => {
    // Set default date range to the full 12 months of available data.
    const sampleData = dashboardData['Valley Average'].historicalAqi;
    if (sampleData.length > 0) {
        const firstMonth = parseMonthString(sampleData[0].month);
        const lastMonth = parseMonthString(sampleData[sampleData.length - 1].month);
        const formatToInput = (date: Date) => date.toISOString().slice(0, 7);
        setStartDate(formatToInput(firstMonth));
        setEndDate(formatToInput(lastMonth));
    }
  }, []);

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

  const getFilteredHistoricalData = useCallback((dataType: 'historicalAqi' | 'historicalWeather') => {
    if (!startDate || !endDate) return { filteredMonthOrder: [] };
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setMonth(end.getMonth() + 1, 0); // Set to last day of month to be inclusive

    const allMonths = dashboardData['Valley Average'][dataType].map(d => d.month);
    const filteredMonthOrder = allMonths.filter(monthStr => {
        const date = parseMonthString(monthStr);
        return date >= start && date <= end;
    });

    return { filteredMonthOrder };
  }, [startDate, endDate]);

  const mergedHistoricalAqi = useMemo(() => {
    const { filteredMonthOrder } = getFilteredHistoricalData('historicalAqi');
    if (filteredMonthOrder.length === 0) return [];
    
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
    return filteredMonthOrder.map(month => monthMap.get(month)).filter(Boolean);
  }, [selectedLocations, getFilteredHistoricalData]);
  
  const mergedHistoricalPm25 = useMemo(() => {
    const { filteredMonthOrder } = getFilteredHistoricalData('historicalAqi');
    if (filteredMonthOrder.length === 0) return [];

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
    return filteredMonthOrder.map(month => monthMap.get(month)).filter(Boolean);
  }, [selectedLocations, getFilteredHistoricalData]);

  const mergedHistoricalWeather = useMemo(() => {
    const { filteredMonthOrder } = getFilteredHistoricalData('historicalWeather');
    if (filteredMonthOrder.length === 0) return [];

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
    return filteredMonthOrder.map(month => monthMap.get(month)).filter(Boolean);
  }, [selectedLocations, getFilteredHistoricalData]);

  const renderCurrentConditions = () => {
    if (!isComparisonMode) {
      const location = selectedLocations[0];
      const data = dashboardData[location];
      if (location === 'Valley Average') {
        return (
          <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-semibold text-slate-200">Regional Air Quality Index (AQI)</h3>
                   <p className="text-sm text-slate-400">Real-time AQI and PM2.5 levels across major cities.</p>
                </div>
                { 'currentWeather' in data && data.currentWeather && (
                     <div className="text-right flex-shrink-0 ml-4">
                        <div className="flex items-center justify-end gap-2">
                            <span className="text-2xl font-bold text-slate-200">{data.currentWeather.temp}°F</span>
                            <TemperatureIcon className="w-6 h-6 text-red-400" />
                        </div>
                        <p className="text-sm text-slate-400">Avg. Temperature</p>
                         <div className="flex items-center justify-end gap-2 mt-2">
                            <span className="text-2xl font-bold text-slate-200">{data.currentWeather.humidity}%</span>
                            <HumidityIcon className="w-6 h-6 text-sky-400" />
                        </div>
                        <p className="text-sm text-slate-400">Avg. Humidity</p>
                    </div>
                )}
              </div>
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
                    <h3 className="text-xl font-semibold text-slate-200 mb-2">Current Conditions in {location}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center py-4">
                        <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-brand-bg-dark/50">
                            <p className={`text-5xl font-bold ${getAqiColor(currentData.currentAqi.aqi)}`}>{currentData.currentAqi.aqi}</p>
                            <p className="text-slate-400 font-semibold mt-1">AQI</p>
                        </div>
                        <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-brand-bg-dark/50">
                            <p className={`text-5xl font-bold ${getAqiColor(currentData.currentAqi.pm25 * 2.5)}`}>{currentData.currentAqi.pm25}</p> 
                            <p className="text-slate-400 font-semibold mt-1 text-sm">PM2.5 (&micro;g/m³)</p>
                        </div>
                         { 'currentWeather' in currentData && currentData.currentWeather && (
                            <>
                                <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-brand-bg-dark/50">
                                     <p className="text-5xl font-bold text-slate-200 flex items-baseline justify-center">
                                        {currentData.currentWeather.temp}<span className="text-3xl">°F</span>
                                    </p>
                                    <p className="text-slate-400 font-semibold flex items-center gap-1.5 mt-1">
                                        <TemperatureIcon className="w-5 h-5 text-red-400" />
                                        Temperature
                                    </p>
                                </div>
                                <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-brand-bg-dark/50">
                                     <p className="text-5xl font-bold text-slate-200 flex items-baseline justify-center">
                                        {currentData.currentWeather.humidity}<span className="text-3xl">%</span>
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
                            { 'currentWeather' in data && data.currentWeather &&
                                <div className="flex justify-around mt-3 pt-3 border-t border-brand-bg-lighter">
                                    <div className="text-center flex items-center gap-1.5 text-slate-300">
                                        <TemperatureIcon className="w-4 h-4 text-red-400" />
                                        <span className="font-semibold">{data.currentWeather.temp}°F</span>
                                    </div>
                                    <div className="text-center flex items-center gap-1.5 text-slate-300">
                                        <HumidityIcon className="w-4 h-4 text-sky-400" />
                                        <span className="font-semibold">{data.currentWeather.humidity}%</span>
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

  const tabs: { id: DashboardTab; label: string; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
    { id: 'overview', label: 'Overview', icon: EyeIcon },
    { id: 'aqi', label: 'Air Quality Trends', icon: WindIcon },
    { id: 'weather', label: 'Weather Trends', icon: CloudIcon },
  ];

  const renderContent = () => {
    switch (activeTab) {
        case 'overview':
            return (
                <div className="space-y-8">
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
                </div>
            );
        case 'aqi':
            return (
                 <div className="space-y-6">
                    <div>
                        <h3 className="text-2xl font-bold text-slate-100">Historical Air Quality</h3>
                        <p className="text-slate-400">Analyzing long-term patterns in air quality for the selected date range.</p>
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
                    </div>
                </div>
            );
        case 'weather':
            return (
                 <div className="space-y-6">
                    <div>
                        <h3 className="text-2xl font-bold text-slate-100">Historical Weather</h3>
                        <p className="text-slate-400">Analyzing long-term patterns in weather for the selected date range.</p>
                    </div>
                     {renderDateFilter()}
                    <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
                        <h3 className="text-xl font-semibold text-slate-200 mb-4">Historical Temperature & Precipitation</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <ComposedChart data={mergedHistoricalWeather}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                                <XAxis dataKey="month" stroke="#94a3b8" />
                                <YAxis yAxisId="left" stroke="#ef4444" label={{ value: 'Temp (°F)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                                <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" label={{ value: 'Precip (in)', angle: -90, position: 'insideRight', fill: '#cbd5e1' }} />
                                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }}/>
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
                </div>
            );
        default:
            return null;
    }
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
      </div>
      
      <div className="border-b border-brand-secondary flex space-x-2 md:space-x-4">
        {tabs.map(tab => (
            <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-3 font-semibold text-sm transition-colors duration-200 border-b-2
                    ${activeTab === tab.id
                        ? 'border-brand-primary text-slate-100'
                        : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-brand-secondary'
                    }`
                }
            >
                <tab.icon className="w-5 h-5" />
                <span>{tab.label}</span>
            </button>
        ))}
      </div>
        
      <div className="mt-6">
        {renderContent()}
      </div>

    </div>
  );
};

const TemperatureIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
  </svg>
);

const HumidityIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>
  </svg>
);

export default Dashboard;