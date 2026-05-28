import React, { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, startOfWeek, endOfWeek, isSameMonth, isSameDay } from 'date-fns';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart
} from 'recharts';
import { dashboardData, LocationKey } from '../data/dashboardData';
import { SunIcon } from './icons/SunIcon';
import { MoonIcon } from './icons/MoonIcon';
import { DropletIcon } from './icons/DropletIcon';
import { WindIcon } from './icons/WindIcon';
import { GaugeIcon } from './icons/GaugeIcon';

type TimeRange = '1day' | '1week' | '1month' | '3months' | '6months' | '1year';

interface CalendarViewProps {
  selectedLocations: LocationKey[];
}

const CalendarView: React.FC<CalendarViewProps> = ({ selectedLocations }) => {
  const [currentDate, setCurrentDate] = useState(new Date('2025-11-13'));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('1month');

  const getWeatherIcon = (condition: string) => {
    switch (condition.toLowerCase()) {
      case 'clear': return '☀️';
      case 'partly cloudy': return '⛅';
      case 'cloudy': return '☁️';
      case 'overcast': return '☁️';
      case 'rainy': return '🌧️';
      case 'showers': return '🌦️';
      case 'windy': return '💨';
      case 'hot':
      case 'very hot': return '🌡️';
      case 'cold': return '❄️';
      default: return '🌤️';
    }
  };

  const getMoonPhaseIcon = (phase: number) => {
    if (phase < 0.05 || phase > 0.95) return '🌑'; // New moon
    if (phase < 0.20) return '🌒'; // Waxing crescent
    if (phase < 0.30) return '🌓'; // First quarter
    if (phase < 0.45) return '🌔'; // Waxing gibbous
    if (phase < 0.55) return '🌕'; // Full moon
    if (phase < 0.70) return '🌖'; // Waning gibbous
    if (phase < 0.80) return '🌗'; // Last quarter
    return '🌘'; // Waning crescent
  };

  const daysToDisplay = useMemo(() => {
    const location = selectedLocations[0];
    const locationData = dashboardData[location];
    
    if (!locationData || !('dailyForecast' in locationData)) return [];

    const forecast = locationData.dailyForecast;
    
    switch (timeRange) {
      case '1day': return forecast.slice(0, 1);
      case '1week': return forecast.slice(0, 7);
      case '1month': return forecast.slice(0, 30);
      case '3months': return forecast.slice(0, 90);
      case '6months': return forecast.slice(0, 180);
      case '1year': return forecast.slice(0, 365);
      default: return forecast.slice(0, 30);
    }
  }, [selectedLocations, timeRange]);

  const calendarDays = useMemo(() => {
    if (timeRange !== '1month') return [];
    
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentDate, timeRange]);

  const getDayData = (date: Date) => {
    const location = selectedLocations[0];
    const locationData = dashboardData[location];
    
    if (!locationData || !('dailyForecast' in locationData)) return null;

    const dateStr = format(date, 'yyyy-MM-dd');
    return locationData.dailyForecast.find(d => d.date === dateStr);
  };

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
  };

  const handlePrevMonth = () => {
    setCurrentDate(prev => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => addMonths(prev, 1));
  };

  const timeRanges: { id: TimeRange; label: string }[] = [
    { id: '1day', label: '1 Day' },
    { id: '1week', label: '1 Week' },
    { id: '1month', label: '1 Month' },
    { id: '3months', label: '3 Months' },
    { id: '6months', label: '6 Months' },
    { id: '1year', label: '1 Year' },
  ];

  const renderCalendarGrid = () => {
    if (timeRange !== '1month') return null;

    return (
      <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={handlePrevMonth}
            className="px-4 py-2 bg-brand-bg-dark hover:bg-brand-secondary rounded-md transition-colors"
          >
            ← Prev
          </button>
          <h3 className="text-2xl font-bold text-slate-100">
            {format(currentDate, 'MMMM yyyy')}
          </h3>
          <button
            onClick={handleNextMonth}
            className="px-4 py-2 bg-brand-bg-dark hover:bg-brand-secondary rounded-md transition-colors"
          >
            Next →
          </button>
        </div>

        <div className="grid grid-cols-7 gap-2 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center font-semibold text-slate-400 text-sm py-2">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {calendarDays.map(day => {
            const dayData = getDayData(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isSelected = selectedDate && isSameDay(day, selectedDate);
            
            return (
              <button
                key={day.toISOString()}
                onClick={() => dayData && handleDateClick(day)}
                disabled={!dayData}
                className={`
                  relative p-3 rounded-lg min-h-[110px] transition-all duration-200
                  ${!isCurrentMonth ? 'opacity-30' : ''}
                  ${!dayData ? 'cursor-not-allowed bg-brand-bg-dark/20' : 'cursor-pointer hover:ring-2 hover:ring-brand-primary'}
                  ${isSelected ? 'ring-2 ring-brand-primary bg-brand-bg-dark' : 'bg-brand-bg-dark'}
                `}
              >
                <div className="text-left">
                  <div className="text-sm font-semibold text-slate-300 mb-1">
                    {format(day, 'd')}
                  </div>
                  {dayData && (
                    <div className="space-y-1">
                      <div className="text-2xl mb-1">{getWeatherIcon(dayData.condition)}</div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-lg font-bold text-slate-100">{dayData.temp.max}°</span>
                        <span className="text-xs text-slate-400">{dayData.temp.min}°</span>
                      </div>
                      {dayData.precipitation.probability > 30 && (
                        <div className="text-xs text-sky-400">
                          💧 {dayData.precipitation.probability}%
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderListView = () => {
    if (timeRange === '1month') return null;

    return (
      <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg">
        <h3 className="text-2xl font-bold text-slate-100 mb-6">
          Weather Forecast - {timeRanges.find(r => r.id === timeRange)?.label}
        </h3>
        
        <div className="space-y-3 max-h-[600px] overflow-y-auto">
          {daysToDisplay.map((day) => (
            <button
              key={day.date}
              onClick={() => handleDateClick(new Date(day.date))}
              className={`
                w-full p-4 rounded-lg transition-all duration-200 text-left
                ${selectedDate && isSameDay(new Date(day.date), selectedDate)
                  ? 'bg-brand-bg-dark ring-2 ring-brand-primary'
                  : 'bg-brand-bg-dark hover:bg-brand-secondary'
                }
              `}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-4xl">{getWeatherIcon(day.condition)}</div>
                  
                  <div className="text-center min-w-[80px]">
                    <div className="text-sm font-semibold text-slate-400">
                      {day.dayOfWeek}
                    </div>
                    <div className="text-lg font-bold text-slate-100">
                      {format(new Date(day.date), 'MMM d')}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <span className="text-3xl font-bold text-slate-100">
                        {day.temp.max}°
                      </span>
                      <span className="text-xl text-slate-400">
                        {day.temp.min}°
                      </span>
                    </div>
                    
                    <div className="text-sm text-slate-300">
                      Feels: {day.temp.feelsLike}°
                    </div>
                    
                    <div className="text-sm text-slate-400 flex items-center gap-1">
                      <DropletIcon className="w-4 h-4" />
                      {day.humidity}%
                    </div>
                    
                    <div className="text-sm text-slate-400 flex items-center gap-1">
                      <WindIcon className="w-4 h-4" />
                      {day.wind.speed} mph {day.wind.direction}
                    </div>
                    
                    {day.precipitation.probability > 20 && (
                      <div className="text-sm text-sky-400">
                        💧 {day.precipitation.probability}%
                      </div>
                    )}
                    
                    <div className="text-sm text-slate-400">
                      ☀️ {day.sunrise} - {day.sunset}
                    </div>
                  </div>
                </div>
                
                <div className="text-slate-400">
                  →
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderDetailedView = () => {
    if (!selectedDate) return null;

    const dayData = getDayData(selectedDate);
    if (!dayData) return null;

    return (
      <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg mt-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
              <span className="text-4xl">{getWeatherIcon(dayData.condition)}</span>
              {format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </h3>
            <p className="text-lg text-slate-300 mt-1">{dayData.condition} conditions</p>
          </div>
          <button
            onClick={() => setSelectedDate(null)}
            className="px-4 py-2 bg-brand-bg-dark hover:bg-brand-secondary rounded-md transition-colors text-slate-300"
          >
            Close ✕
          </button>
        </div>

        {/* Primary Weather Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-brand-bg-dark p-4 rounded-lg border border-slate-700">
            <div className="text-sm text-slate-400 mb-1 flex items-center gap-2">
              <span className="text-xl">🌡️</span>
              Temperature
            </div>
            <div className="text-4xl font-bold text-slate-100 mb-1">
              {dayData.temp.current}°F
            </div>
            <div className="text-sm text-slate-400">
              H: {dayData.temp.max}° L: {dayData.temp.min}°
            </div>
            <div className="text-sm text-yellow-400 mt-1">
              Feels like: {dayData.temp.feelsLike}°
            </div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg border border-slate-700">
            <div className="text-sm text-slate-400 mb-1 flex items-center gap-2">
              <DropletIcon className="w-5 h-5 text-sky-400" />
              Humidity & Dew Point
            </div>
            <div className="text-4xl font-bold text-sky-400 mb-1">
              {dayData.humidity}%
            </div>
            <div className="text-sm text-slate-400">
              Dew Point: {dayData.dewPoint}°F
            </div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg border border-slate-700">
            <div className="text-sm text-slate-400 mb-1 flex items-center gap-2">
              <WindIcon className="w-5 h-5 text-green-400" />
              Wind
            </div>
            <div className="text-4xl font-bold text-slate-100 mb-1">
              {dayData.wind.speed}
            </div>
            <div className="text-sm text-slate-400">
              mph {dayData.wind.direction}
            </div>
            <div className="text-sm text-yellow-400 mt-1">
              Gusts: {dayData.wind.gust} mph
            </div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg border border-slate-700">
            <div className="text-sm text-slate-400 mb-1 flex items-center gap-2">
              <GaugeIcon className="w-5 h-5 text-purple-400" />
              Pressure
            </div>
            <div className="text-4xl font-bold text-purple-400 mb-1">
              {dayData.pressure}
            </div>
            <div className="text-sm text-slate-400">
              inHg
            </div>
          </div>
        </div>

        {/* Secondary Weather Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">UV Index</div>
            <div className="text-3xl font-bold text-yellow-400">{dayData.uv}</div>
            <div className="text-xs text-slate-500 mt-1">
              {dayData.uv <= 2 ? 'Low' : dayData.uv <= 5 ? 'Moderate' : dayData.uv <= 7 ? 'High' : 'Very High'}
            </div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">Precipitation</div>
            <div className="text-3xl font-bold text-blue-400">{dayData.precipitation.probability}%</div>
            {dayData.precipitation.amount > 0 && (
              <div className="text-xs text-slate-400 mt-1">
                {dayData.precipitation.amount} in
              </div>
            )}
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">Cloud Cover</div>
            <div className="text-3xl font-bold text-slate-100">{dayData.cloudCover}%</div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">Visibility</div>
            <div className="text-3xl font-bold text-slate-100">{dayData.visibility}</div>
            <div className="text-xs text-slate-500 mt-1">miles</div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">Solar Rad.</div>
            <div className="text-3xl font-bold text-orange-400">{dayData.solarRadiation}</div>
            <div className="text-xs text-slate-500 mt-1">W/m²</div>
          </div>
        </div>

        {/* Sun & Moon Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="bg-brand-bg-dark p-4 rounded-lg border border-yellow-900/50">
            <div className="flex items-center gap-2 mb-3">
              <SunIcon className="w-6 h-6 text-yellow-400" />
              <h4 className="text-lg font-semibold text-slate-200">Sun Information</h4>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-sm text-slate-400">Sunrise</div>
                <div className="text-xl font-bold text-yellow-400">{dayData.sunrise}</div>
              </div>
              <div>
                <div className="text-sm text-slate-400">Sunset</div>
                <div className="text-xl font-bold text-orange-400">{dayData.sunset}</div>
              </div>
              <div>
                <div className="text-sm text-slate-400">Day Length</div>
                <div className="text-xl font-bold text-slate-100">{dayData.dayLength}h</div>
              </div>
            </div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg border border-blue-900/50">
            <div className="flex items-center gap-2 mb-3">
              <MoonIcon className="w-6 h-6 text-slate-300" />
              <h4 className="text-lg font-semibold text-slate-200">Moon & Agriculture</h4>
            </div>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className="text-sm text-slate-400">Moon Phase</div>
                <div className="text-4xl">{getMoonPhaseIcon(dayData.moonPhase)}</div>
              </div>
              <div>
                <div className="text-sm text-slate-400">Evapotranspiration</div>
                <div className="text-xl font-bold text-green-400">{dayData.evapotranspiration}</div>
                <div className="text-xs text-slate-500">in/day</div>
              </div>
            </div>
          </div>
        </div>

        {/* Hourly Charts */}
        <div className="space-y-6">
          <div className="bg-brand-bg-dark p-6 rounded-lg">
            <h4 className="text-xl font-semibold text-slate-200 mb-4">Hourly Temperature & Feels Like</h4>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={dayData.hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis 
                  dataKey="hour" 
                  stroke="#94a3b8"
                  tickFormatter={(hour) => hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
                />
                <YAxis stroke="#94a3b8" label={{ value: 'Temperature (°F)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                  labelFormatter={(hour) => `${hour}:00`}
                />
                <Legend />
                <Line type="monotone" dataKey="temp" stroke="#ef4444" strokeWidth={2} name="Temperature" />
                <Line type="monotone" dataKey="feelsLike" stroke="#f97316" strokeWidth={2} strokeDasharray="5 5" name="Feels Like" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-brand-bg-dark p-6 rounded-lg">
            <h4 className="text-xl font-semibold text-slate-200 mb-4">Hourly Humidity & Dew Point</h4>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={dayData.hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis 
                  dataKey="hour" 
                  stroke="#94a3b8"
                  tickFormatter={(hour) => hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
                />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} />
                <Legend />
                <Area type="monotone" dataKey="humidity" fill="#0ea5e9" fillOpacity={0.3} stroke="#0ea5e9" name="Humidity %" />
                <Line type="monotone" dataKey="dewPoint" stroke="#06b6d4" strokeWidth={2} name="Dew Point (°F)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-brand-bg-dark p-6 rounded-lg">
            <h4 className="text-xl font-semibold text-slate-200 mb-4">Hourly Wind Speed & Gusts</h4>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={dayData.hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis 
                  dataKey="hour" 
                  stroke="#94a3b8"
                  tickFormatter={(hour) => hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
                />
                <YAxis stroke="#94a3b8" label={{ value: 'Speed (mph)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} />
                <Legend />
                <Bar dataKey="windSpeed" fill="#10b981" name="Wind Speed" />
                <Line type="monotone" dataKey="windGust" stroke="#f59e0b" strokeWidth={2} name="Gusts" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-brand-bg-dark p-6 rounded-lg">
            <h4 className="text-xl font-semibold text-slate-200 mb-4">Hourly Solar Radiation & UV Index</h4>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={dayData.hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis 
                  dataKey="hour" 
                  stroke="#94a3b8"
                  tickFormatter={(hour) => hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
                />
                <YAxis yAxisId="left" stroke="#f97316" label={{ value: 'Solar Rad. (W/m²)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                <YAxis yAxisId="right" orientation="right" stroke="#eab308" label={{ value: 'UV Index', angle: -90, position: 'insideRight', fill: '#cbd5e1' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} />
                <Legend />
                <Area yAxisId="left" type="monotone" dataKey="solarRadiation" fill="#f97316" fillOpacity={0.3} stroke="#f97316" name="Solar Radiation" />
                <Line yAxisId="right" type="monotone" dataKey="uv" stroke="#eab308" strokeWidth={2} name="UV Index" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-brand-bg-dark p-6 rounded-lg">
            <h4 className="text-xl font-semibold text-slate-200 mb-4">Hourly Pressure & Cloud Cover</h4>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={dayData.hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis 
                  dataKey="hour" 
                  stroke="#94a3b8"
                  tickFormatter={(hour) => hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
                />
                <YAxis yAxisId="left" stroke="#8b5cf6" label={{ value: 'Pressure (inHg)', angle: -90, position: 'insideLeft', fill: '#cbd5e1' }} />
                <YAxis yAxisId="right" orientation="right" stroke="#64748b" label={{ value: 'Cloud Cover (%)', angle: -90, position: 'insideRight', fill: '#cbd5e1' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="pressure" stroke="#8b5cf6" strokeWidth={2} name="Pressure" />
                <Area yAxisId="right" type="monotone" dataKey="cloudCover" fill="#64748b" fillOpacity={0.3} stroke="#64748b" name="Cloud Cover" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-slate-100 mb-2">Comprehensive Weather Calendar</h2>
        <p className="text-slate-400">
          Advanced meteorological analysis and forecasts for {selectedLocations[0]}
        </p>
      </div>

      {/* Time Range Selector */}
      <div className="flex flex-wrap gap-2">
        {timeRanges.map(range => (
          <button
            key={range.id}
            onClick={() => {
              setTimeRange(range.id);
              setSelectedDate(null);
            }}
            className={`px-4 py-2 rounded-full font-semibold transition-all duration-200 ${
              timeRange === range.id
                ? 'bg-brand-primary text-white shadow-md'
                : 'bg-brand-bg-lighter text-slate-300 hover:bg-brand-secondary'
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>

      {/* Calendar or List View */}
      {renderCalendarGrid()}
      {renderListView()}

      {/* Detailed Day View */}
      {renderDetailedView()}
    </div>
  );
};

export default CalendarView;
