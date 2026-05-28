import { useState, useEffect } from 'react';
import { dataService } from '../services/dataService';
import type {
  AQIRecord,
  WeatherRecord,
  HistoricalAQIRecord,
  HistoricalWeatherRecord,
  ForecastRecord,
  LocationInfo
} from '../services/dataService';

interface UseNormalizedDataOptions {
  locationIds?: string[];
  startDate?: Date;
  endDate?: Date;
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

export const useNormalizedData = (options: UseNormalizedDataOptions = {}) => {
  const {
    locationIds,
    startDate,
    endDate,
    autoRefresh = false,
    refreshInterval = 60000 // Default 1 minute
  } = options;

  const [currentAqi, setCurrentAqi] = useState<AQIRecord[]>([]);
  const [currentWeather, setCurrentWeather] = useState<WeatherRecord[]>([]);
  const [historicalAqi, setHistoricalAqi] = useState<HistoricalAQIRecord[]>([]);
  const [historicalWeather, setHistoricalWeather] = useState<HistoricalWeatherRecord[]>([]);
  const [forecast, setForecast] = useState<ForecastRecord[]>([]);
  const [locations, setLocations] = useState<LocationInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [
        aqiData,
        weatherData,
        histAqiData,
        histWeatherData,
        forecastData,
        locationData
      ] = await Promise.all([
        dataService.getCurrentAQI(locationIds),
        dataService.getCurrentWeather(locationIds),
        dataService.getHistoricalAQI(locationIds, startDate, endDate),
        dataService.getHistoricalWeather(locationIds, startDate, endDate),
        dataService.getWeatherForecast(locationIds),
        dataService.getLocations()
      ]);

      setCurrentAqi(aqiData);
      setCurrentWeather(weatherData);
      setHistoricalAqi(histAqiData);
      setHistoricalWeather(histWeatherData);
      setForecast(forecastData);
      setLocations(locationData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch data'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    if (autoRefresh && refreshInterval > 0) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [locationIds?.join(','), startDate?.getTime(), endDate?.getTime(), autoRefresh, refreshInterval]);

  const refresh = () => {
    fetchData();
  };

  // Helper functions for common operations
  const getAverageAqi = () => {
    if (currentAqi.length === 0) return 0;
    return Math.round(
      currentAqi.reduce((sum, record) => sum + record.aqi, 0) / currentAqi.length
    );
  };

  const getAverageTemperature = () => {
    if (currentWeather.length === 0) return 0;
    return Math.round(
      currentWeather.reduce((sum, record) => sum + record.temperature, 0) / currentWeather.length
    );
  };

  const getAlertsCount = () => {
    return currentAqi.filter(record => record.aqi > 100).length;
  };

  const getLocationById = (locationId: string) => {
    return locations.find(loc => loc.id === locationId);
  };

  return {
    // Data
    currentAqi,
    currentWeather,
    historicalAqi,
    historicalWeather,
    forecast,
    locations,

    // State
    isLoading,
    error,

    // Actions
    refresh,

    // Computed values
    averageAqi: getAverageAqi(),
    averageTemperature: getAverageTemperature(),
    alertsCount: getAlertsCount(),

    // Helper functions
    getLocationById
  };
};