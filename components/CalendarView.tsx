import React, { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, startOfWeek, endOfWeek, isSameMonth, isSameDay, addDays, subDays } from 'date-fns';
import { dashboardData, LocationKey } from '../data/dashboardData';

type TimeRange = '1day' | '1week' | '1month' | '3months' | '6months' | '1year';

interface CalendarViewProps {
  selectedLocations: LocationKey[];
}

const CalendarView: React.FC<CalendarViewProps> = ({ selectedLocations }) => {
  const [currentDate, setCurrentDate] = useState(new Date('2025-11-13'));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('1month');

  const getAqiColor = (aqi: number) => {
    if (aqi <= 50) return 'bg-green-500';
    if (aqi <= 100) return 'bg-yellow-400';
    if (aqi <= 150) return 'bg-orange-500';
    if (aqi <= 200) return 'bg-red-500';
    if (aqi <= 300) return 'bg-purple-500';
    return 'bg-maroon-500';
  };

  const getAqiTextColor = (aqi: number) => {
    if (aqi <= 50) return 'text-green-500';
    if (aqi <= 100) return 'text-yellow-400';
    if (aqi <= 150) return 'text-orange-500';
    if (aqi <= 200) return 'text-red-500';
    if (aqi <= 300) return 'text-purple-500';
    return 'text-maroon-500';
  };

  // Get days to display based on time range
  const daysToDisplay = useMemo(() => {
    const location = selectedLocations[0];
    const locationData = dashboardData[location];
    
    if (!locationData || !('dailyForecast' in locationData)) return [];

    const forecast = locationData.dailyForecast;
    const today = new Date('2025-11-13');
    
    switch (timeRange) {
      case '1day':
        return forecast.slice(0, 1);
      case '1week':
        return forecast.slice(0, 7);
      case '1month':
        return forecast.slice(0, 30);
      case '3months':
        return forecast.slice(0, 90);
      case '6months':
        return forecast.slice(0, 180);
      case '1year':
        return forecast.slice(0, 365);
      default:
        return forecast.slice(0, 30);
    }
  }, [selectedLocations, timeRange]);

  // For calendar grid view (used for 1month)
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
        {/* Month Navigation */}
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

        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center font-semibold text-slate-400 text-sm py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7 gap-2">
          {calendarDays.map(day => {
            const dayData = getDayData(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isSelected = selectedDate && isSameDay(day, selectedDate);
            
            return (
              <button
                key={day.toISOString()}
                onClick={() => handleDateClick(day)}
                disabled={!dayData}
                className={`
                  relative p-3 rounded-lg min-h-[100px] transition-all duration-200
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
                      <div className="text-lg font-bold text-slate-100">
                        {dayData.temp.max}°
                      </div>
                      <div className="text-xs text-slate-400">
                        {dayData.temp.min}°
                      </div>
                      <div className="flex items-center gap-1 mt-2">
                        <div className={`w-2 h-2 rounded-full ${getAqiColor(dayData.aqi)}`} />
                        <span className={`text-xs font-semibold ${getAqiTextColor(dayData.aqi)}`}>
                          {dayData.aqi}
                        </span>
                      </div>
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
          {daysToDisplay.map((day, index) => (
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
                  <div className="text-center">
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
                    
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${getAqiColor(day.aqi)}`} />
                      <span className="text-sm text-slate-300">
                        AQI <span className={`font-bold ${getAqiTextColor(day.aqi)}`}>{day.aqi}</span>
                      </span>
                    </div>
                    
                    <div className="text-sm text-slate-400">
                      💧 {day.humidity}%
                    </div>
                    
                    <div className="text-sm text-slate-400">
                      🌬️ {day.wind.speed} mph {day.wind.direction}
                    </div>
                    
                    {day.precipitation.probability > 30 && (
                      <div className="text-sm text-sky-400">
                        🌧️ {day.precipitation.probability}%
                      </div>
                    )}
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
            <h3 className="text-2xl font-bold text-slate-100">
              {format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </h3>
            <p className="text-slate-400">Detailed weather analysis</p>
          </div>
          <button
            onClick={() => setSelectedDate(null)}
            className="px-4 py-2 bg-brand-bg-dark hover:bg-brand-secondary rounded-md transition-colors text-slate-300"
          >
            Close ✕
          </button>
        </div>

        {/* Weather Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">Temperature</div>
            <div className="text-3xl font-bold text-slate-100">
              {dayData.temp.current}°F
            </div>
            <div className="text-sm text-slate-400 mt-1">
              H: {dayData.temp.max}° L: {dayData.temp.min}°
            </div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">Air Quality</div>
            <div className={`text-3xl font-bold ${getAqiTextColor(dayData.aqi)}`}>
              {dayData.aqi}
            </div>
            <div className="text-sm text-slate-400 mt-1">
              PM2.5: {dayData.pm25}
            </div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">Humidity</div>
            <div className="text-3xl font-bold text-sky-400">
              {dayData.humidity}%
            </div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">Wind</div>
            <div className="text-3xl font-bold text-slate-100">
              {dayData.wind.speed}
            </div>
            <div className="text-sm text-slate-400 mt-1">
              mph {dayData.wind.direction}
            </div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">UV Index</div>
            <div className="text-3xl font-bold text-yellow-400">
              {dayData.uv}
            </div>
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">Precipitation</div>
            <div className="text-3xl font-bold text-blue-400">
              {dayData.precipitation.probability}%
            </div>
            {dayData.precipitation.amount > 0 && (
              <div className="text-sm text-slate-400 mt-1">
                {dayData.precipitation.amount} in
              </div>
            )}
          </div>

          <div className="bg-brand-bg-dark p-4 rounded-lg">
            <div className="text-sm text-slate-400 mb-1">Cloud Cover</div>
            <div className="text-3xl font-bold text-slate-100">
              {dayData.cloudCover}%
            </div>
          </div>
        </div>

        {/* Hourly Chart Placeholder */}
        <div className="bg-brand-bg-dark p-6 rounded-lg">
          <h4 className="text-xl font-semibold text-slate-200 mb-4">Hourly Forecast</h4>
          <div className="overflow-x-auto">
            <div className="flex gap-4 min-w-max">
              {dayData.hourlyData.map((hour) => (
                <div key={hour.hour} className="text-center min-w-[60px]">
                  <div className="text-xs text-slate-400 mb-2">
                    {hour.hour === 0 ? '12am' : hour.hour < 12 ? `${hour.hour}am` : hour.hour === 12 ? '12pm' : `${hour.hour - 12}pm`}
                  </div>
                  <div className="text-lg font-bold text-slate-100 mb-1">
                    {hour.temp}°
                  </div>
                  <div className={`w-2 h-2 rounded-full mx-auto mb-1 ${getAqiColor(hour.aqi)}`} />
                  <div className="text-xs text-slate-400">
                    {hour.aqi}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    💧{hour.humidity}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-slate-100 mb-2">Weather Calendar</h2>
        <p className="text-slate-400">
          Detailed daily weather forecast and analysis for {selectedLocations[0]}
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
