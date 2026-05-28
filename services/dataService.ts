// Normalized data interfaces
import { weatherService } from './WeatherService';
import { airQualityService } from './AirQualityService';
import { dashboardData, cityLocations } from '../data/dashboardData'; // Keep for fallback

const ANALYTICS_URL = import.meta.env.VITE_GATEWAY_URL
  ? `${import.meta.env.VITE_GATEWAY_URL}/api`
  : 'http://localhost:8080/api';

export interface AQIRecord {
  id: string;
  locationId: string;
  locationName: string;
  timestamp: Date;
  aqi: number;
  pm25: number;
  pm10?: number;
  no2?: number;
  so2?: number;
  co?: number;
  o3?: number;
}

export interface WeatherRecord {
  id: string;
  locationId: string;
  locationName: string;
  timestamp: Date;
  temperature: number;
  humidity: number;
  precipitation: number;
  windSpeed: number;
  windDirection?: number;
  pressure?: number;
  uvIndex?: number;
  visibility?: number;
  conditions?: string;
}

export interface LocationInfo {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  population?: number;
  county?: string;
  elevation?: number;
}

export interface HistoricalAQIRecord {
  id: string;
  locationId: string;
  locationName: string;
  month: string;
  year: number;
  avgAqi: number;
  avgPm25: number;
}

export interface HistoricalWeatherRecord {
  id: string;
  locationId: string;
  locationName: string;
  month: string;
  year: number;
  avgTemp: number;
  totalPrecipitation: number;
  avgHumidity: number;
  avgWindSpeed: number;
  maxUV: number;
  avgSolarRad: number;
  avgEt0: number;
}

export interface ForecastRecord {
  id: string;
  locationId: string;
  locationName: string;
  date: Date;
  tempHigh: number;
  tempLow: number;
  humidity: number;
  precipProbability: number;
  windSpeed: number;
  uvIndex: number;
  conditions: string;
  icon?: string;
}

// Data service class
export class DataService {
  private static instance: DataService;

  private constructor() { }

  public static getInstance(): DataService {
    if (!DataService.instance) {
      DataService.instance = new DataService();
    }
    return DataService.instance;
  }

  // Fetch current AQI data for all locations
  async getCurrentAQI(locationIds?: string[]): Promise<AQIRecord[]> {
    const locations = await this.getLocations();
    const records: AQIRecord[] = [];

    const promises = locations.map(async (loc) => {
      if (locationIds && !locationIds.includes(loc.id)) return;

      try {
        const data = await airQualityService.getCurrentAQI(loc.latitude, loc.longitude);
        records.push({
          id: `aqi_${loc.id}_${Date.now()}`,
          locationId: loc.id,
          locationName: loc.name,
          timestamp: new Date(),
          aqi: data.usAqi || data.aqi,
          pm25: data.pm25,
          pm10: data.pm10,
          no2: data.no2,
          so2: data.so2,
          co: data.co,
          o3: data.o3
        });
      } catch (error) {
        console.error(`Failed to fetch AQI for ${loc.name}`, error);
        const mockData = dashboardData[loc.name as keyof typeof dashboardData];
        if (mockData && 'currentAqi' in mockData) {
          records.push({
            id: `aqi_${loc.id}_${Date.now()}`,
            locationId: loc.id,
            locationName: loc.name,
            timestamp: new Date(),
            aqi: mockData.currentAqi.aqi,
            pm25: mockData.currentAqi.pm25
          });
        }
      }
    });

    await Promise.all(promises);
    return records;
  }

  // Fetch current weather data for all locations
  async getCurrentWeather(locationIds?: string[]): Promise<WeatherRecord[]> {
    const locations = await this.getLocations();
    const records: WeatherRecord[] = [];

    const promises = locations.map(async (loc) => {
      if (locationIds && !locationIds.includes(loc.id)) return;

      try {
        const data = await weatherService.getCurrentWeather(loc.latitude, loc.longitude);
        records.push({
          id: `weather_${loc.id}_${Date.now()}`,
          locationId: loc.id,
          locationName: loc.name,
          timestamp: new Date(),
          temperature: data.temp,
          humidity: data.humidity,
          precipitation: 0,
          windSpeed: data.windSpeed,
          windDirection: data.windDirection,
          pressure: data.pressure,
          conditions: data.description
        });
      } catch (error) {
        console.error(`Failed to fetch weather for ${loc.name}`, error);
        const mockData = dashboardData[loc.name as keyof typeof dashboardData];
        if (mockData && 'currentWeather' in mockData) {
          records.push({
            id: `weather_${loc.id}_${Date.now()}`,
            locationId: loc.id,
            locationName: loc.name,
            timestamp: new Date(),
            temperature: mockData.currentWeather.temp,
            humidity: mockData.currentWeather.humidity,
            precipitation: 0,
            windSpeed: 0
          });
        }
      }
    });

    await Promise.all(promises);
    return records;
  }

  // Fetch historical AQI data from Python analytics service
  async getHistoricalAQI(
    locationIds?: string[],
    startDate?: Date,
    endDate?: Date
  ): Promise<HistoricalAQIRecord[]> {
    try {
      const params = new URLSearchParams();
      if (locationIds?.length) params.set('location_ids', locationIds.join(','));
      if (startDate) params.set('start_date', startDate.toISOString().split('T')[0]);
      if (endDate) params.set('end_date', endDate.toISOString().split('T')[0]);

      const response = await fetch(`${ANALYTICS_URL}/historical-aqi?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      return await response.json() as HistoricalAQIRecord[];
    } catch (error) {
      console.error('Failed to fetch historical AQI from analytics, falling back to mock:', error);
      return this.getHistoricalAQIFallback(locationIds, startDate, endDate);
    }
  }

  // Fetch historical weather data from Python analytics service
  async getHistoricalWeather(
    locationIds?: string[],
    startDate?: Date,
    endDate?: Date
  ): Promise<HistoricalWeatherRecord[]> {
    try {
      const params = new URLSearchParams();
      if (locationIds?.length) params.set('location_ids', locationIds.join(','));
      if (startDate) params.set('start_date', startDate.toISOString().split('T')[0]);
      if (endDate) params.set('end_date', endDate.toISOString().split('T')[0]);

      const response = await fetch(`${ANALYTICS_URL}/historical-weather?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      return await response.json() as HistoricalWeatherRecord[];
    } catch (error) {
      console.error('Failed to fetch historical weather from analytics, falling back to mock:', error);
      return this.getHistoricalWeatherFallback(locationIds, startDate, endDate);
    }
  }

  // Fetch weather forecast
  async getWeatherForecast(
    locationIds?: string[]
  ): Promise<ForecastRecord[]> {
    const locations = await this.getLocations();
    const records: ForecastRecord[] = [];

    const promises = locations.map(async (loc) => {
      if (locationIds && !locationIds.includes(loc.id)) return;

      try {
        const forecast = await weatherService.getForecast(loc.latitude, loc.longitude);
        forecast.forEach(day => {
          records.push({
            id: `forecast_${loc.id}_${day.date}`,
            locationId: loc.id,
            locationName: loc.name,
            date: new Date(day.date),
            tempHigh: day.temp.max,
            tempLow: day.temp.min,
            humidity: day.humidity,
            precipProbability: 0,
            windSpeed: 0,
            uvIndex: 0,
            conditions: day.description,
            icon: day.icon
          });
        });
      } catch (error) {
        console.error(`Failed to fetch forecast for ${loc.name}`, error);
      }
    });

    await Promise.all(promises);
    return records;
  }

  // Get location information
  async getLocations(): Promise<LocationInfo[]> {
    const { dashboardData, cityLocations } = await import('../data/dashboardData');

    const locations: LocationInfo[] = cityLocations.map((name) => {
      const data = dashboardData[name];
      return {
        id: name.toLowerCase().replace(/\s+/g, '_'),
        name,
        latitude: 'coords' in data ? data.coords.lat : 0,
        longitude: 'coords' in data ? data.coords.lng : 0
      };
    });

    locations.unshift({
      id: 'valley_average',
      name: 'Valley Average',
      latitude: 36.7378,
      longitude: -119.7871
    });

    return locations;
  }

  // Aggregate data for dashboard metrics
  async getDashboardMetrics(locationIds?: string[]) {
    const [currentAqi, currentWeather, locations] = await Promise.all([
      this.getCurrentAQI(locationIds),
      this.getCurrentWeather(locationIds),
      this.getLocations()
    ]);

    const validAqi = currentAqi.filter(r => r.locationId !== 'valley_average');
    const validWeather = currentWeather.filter(r => r.locationId !== 'valley_average');

    return {
      totalLocations: locations.length - 1,
      avgAqi: validAqi.length ? Math.round(validAqi.reduce((sum, r) => sum + r.aqi, 0) / validAqi.length) : 0,
      avgTemp: validWeather.length ? Math.round(validWeather.reduce((sum, r) => sum + r.temperature, 0) / validWeather.length) : 0,
      alertLocations: validAqi.filter(r => r.aqi > 100).length,
      lastUpdated: new Date()
    };
  }

  // ---- Fallback methods using dashboardData ----

  private getHistoricalAQIFallback(
    locationIds?: string[],
    startDate?: Date,
    endDate?: Date
  ): HistoricalAQIRecord[] {
    const records: HistoricalAQIRecord[] = [];

    Object.entries(dashboardData).forEach(([locationName, data]) => {
      const locationId = locationName.toLowerCase().replace(/\s+/g, '_');

      if ((!locationIds || locationIds.includes(locationId)) &&
        'historicalAqi' in data) {
        data.historicalAqi.forEach(monthData => {
          const [monthStr, yearStr] = monthData.month.split(' ');
          const year = 2000 + parseInt(yearStr.replace("'", ""));

          records.push({
            id: `hist_aqi_${locationId}_${monthData.month}`,
            locationId,
            locationName,
            month: monthStr,
            year,
            avgAqi: monthData.avgAqi,
            avgPm25: monthData.avgPm25
          });
        });
      }
    });

    if (startDate || endDate) {
      return records.filter(record => {
        const recordDate = new Date(record.year, getMonthNumber(record.month));
        if (startDate && recordDate < startDate) return false;
        if (endDate && recordDate > endDate) return false;
        return true;
      });
    }

    return records;
  }

  private getHistoricalWeatherFallback(
    locationIds?: string[],
    startDate?: Date,
    endDate?: Date
  ): HistoricalWeatherRecord[] {
    const records: HistoricalWeatherRecord[] = [];

    Object.entries(dashboardData).forEach(([locationName, data]) => {
      const locationId = locationName.toLowerCase().replace(/\s+/g, '_');

      if ((!locationIds || locationIds.includes(locationId)) &&
        'historicalWeather' in data) {
        data.historicalWeather.forEach(monthData => {
          const [monthStr, yearStr] = monthData.month.split(' ');
          const year = 2000 + parseInt(yearStr.replace("'", ""));

          records.push({
            id: `hist_weather_${locationId}_${monthData.month}`,
            locationId,
            locationName,
            month: monthStr,
            year,
            avgTemp: monthData.avgTemp,
            totalPrecipitation: monthData.precipitation,
            avgHumidity: Math.round(Math.max(20, 80 - (monthData.avgTemp - 50) * 0.8 + (Math.random() * 10))),
            avgWindSpeed: Math.round(5 + Math.random() * 5),
            maxUV: Math.round(Math.max(2, Math.min(11, (monthData.avgTemp - 40) / 5))),
            avgSolarRad: Math.round(Math.max(200, (monthData.avgTemp - 30) * 10)),
            avgEt0: Math.round(Math.max(1, (monthData.avgTemp - 40) / 10) * 10) / 10
          });
        });
      }
    });

    if (startDate || endDate) {
      return records.filter(record => {
        const recordDate = new Date(record.year, getMonthNumber(record.month));
        if (startDate && recordDate < startDate) return false;
        if (endDate && recordDate > endDate) return false;
        return true;
      });
    }

    return records;
  }
}

function getMonthNumber(month: string): number {
  const months: { [key: string]: number } = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3,
    'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7,
    'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };
  return months[month] || 0;
}

export const dataService = DataService.getInstance();
