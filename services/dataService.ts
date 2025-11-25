// Normalized data interfaces

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
  windDirection?: string;
  pressure?: number;
  uvIndex?: number;
  visibility?: number;
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
  maxAqi?: number;
  minAqi?: number;
  daysGood?: number;
  daysModerate?: number;
  daysUnhealthy?: number;
}

export interface HistoricalWeatherRecord {
  id: string;
  locationId: string;
  locationName: string;
  month: string;
  year: number;
  avgTemp: number;
  maxTemp?: number;
  minTemp?: number;
  totalPrecipitation: number;
  avgHumidity?: number;
  avgWindSpeed?: number;
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
}

// Data service class
export class DataService {
  private static instance: DataService;

  private constructor() {}

  public static getInstance(): DataService {
    if (!DataService.instance) {
      DataService.instance = new DataService();
    }
    return DataService.instance;
  }

  // Fetch current AQI data for all locations
  async getCurrentAQI(locationIds?: string[]): Promise<AQIRecord[]> {
    // This would typically make an API call
    // For now, we'll transform the existing data structure
    const records: AQIRecord[] = [];

    // Import existing data (this would be replaced with API call)
    const { dashboardData } = await import('../data/dashboardData');

    Object.entries(dashboardData).forEach(([locationName, data]) => {
      if ('currentAqi' in data && data.currentAqi) {
        const record: AQIRecord = {
          id: `aqi_${locationName}_${Date.now()}`,
          locationId: locationName.toLowerCase().replace(/\s+/g, '_'),
          locationName,
          timestamp: new Date(),
          aqi: data.currentAqi.aqi,
          pm25: data.currentAqi.pm25
        };

        if (!locationIds || locationIds.includes(record.locationId)) {
          records.push(record);
        }
      }
    });

    return records;
  }

  // Fetch current weather data for all locations
  async getCurrentWeather(locationIds?: string[]): Promise<WeatherRecord[]> {
    const records: WeatherRecord[] = [];

    const { dashboardData } = await import('../data/dashboardData');

    Object.entries(dashboardData).forEach(([locationName, data]) => {
      if ('currentWeather' in data && data.currentWeather) {
        const record: WeatherRecord = {
          id: `weather_${locationName}_${Date.now()}`,
          locationId: locationName.toLowerCase().replace(/\s+/g, '_'),
          locationName,
          timestamp: new Date(),
          temperature: data.currentWeather.temp,
          humidity: data.currentWeather.humidity,
          precipitation: 0, // Not in current data
          windSpeed: 0 // Not in current data
        };

        if (!locationIds || locationIds.includes(record.locationId)) {
          records.push(record);
        }
      }
    });

    return records;
  }

  // Fetch historical AQI data
  async getHistoricalAQI(
    locationIds?: string[],
    startDate?: Date,
    endDate?: Date
  ): Promise<HistoricalAQIRecord[]> {
    const records: HistoricalAQIRecord[] = [];

    const { dashboardData } = await import('../data/dashboardData');

    Object.entries(dashboardData).forEach(([locationName, data]) => {
      const locationId = locationName.toLowerCase().replace(/\s+/g, '_');

      if ((!locationIds || locationIds.includes(locationId)) &&
          'historicalAqi' in data) {
        data.historicalAqi.forEach(monthData => {
          // Parse month/year from string like "Jan '24"
          const [monthStr, yearStr] = monthData.month.split(' ');
          const year = 2000 + parseInt(yearStr.replace("'", ""));

          const record: HistoricalAQIRecord = {
            id: `hist_aqi_${locationId}_${monthData.month}`,
            locationId,
            locationName,
            month: monthStr,
            year,
            avgAqi: monthData.avgAqi,
            avgPm25: monthData.avgPm25
          };

          records.push(record);
        });
      }
    });

    // Filter by date range if provided
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

  // Fetch historical weather data
  async getHistoricalWeather(
    locationIds?: string[],
    startDate?: Date,
    endDate?: Date
  ): Promise<HistoricalWeatherRecord[]> {
    const records: HistoricalWeatherRecord[] = [];

    const { dashboardData } = await import('../data/dashboardData');

    Object.entries(dashboardData).forEach(([locationName, data]) => {
      const locationId = locationName.toLowerCase().replace(/\s+/g, '_');

      if ((!locationIds || locationIds.includes(locationId)) &&
          'historicalWeather' in data) {
        data.historicalWeather.forEach(monthData => {
          const [monthStr, yearStr] = monthData.month.split(' ');
          const year = 2000 + parseInt(yearStr.replace("'", ""));

          const record: HistoricalWeatherRecord = {
            id: `hist_weather_${locationId}_${monthData.month}`,
            locationId,
            locationName,
            month: monthStr,
            year,
            avgTemp: monthData.avgTemp,
            totalPrecipitation: monthData.precipitation
          };

          records.push(record);
        });
      }
    });

    // Filter by date range if provided
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

  // Fetch weather forecast
  async getWeatherForecast(
    locationIds?: string[]
  ): Promise<ForecastRecord[]> {
    const records: ForecastRecord[] = [];

    const { dashboardData } = await import('../data/dashboardData');

    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();

    Object.entries(dashboardData).forEach(([locationName, data]) => {
      const locationId = locationName.toLowerCase().replace(/\s+/g, '_');

      if ((!locationIds || locationIds.includes(locationId)) &&
          'weatherForecast' in data) {
        data.weatherForecast.forEach((dayData, index) => {
          const forecastDate = new Date(today);
          forecastDate.setDate(today.getDate() + index);

          const record: ForecastRecord = {
            id: `forecast_${locationId}_${dayData.day}`,
            locationId,
            locationName,
            date: forecastDate,
            tempHigh: dayData.temp + 5, // Simulated high
            tempLow: dayData.temp - 5, // Simulated low
            humidity: dayData.humidity,
            precipProbability: 0, // Not in current data
            windSpeed: 0, // Not in current data
            uvIndex: 0, // Not in current data
            conditions: 'Clear' // Not in current data
          };

          records.push(record);
        });
      }
    });

    return records;
  }

  // Get location information
  async getLocations(): Promise<LocationInfo[]> {
    const { cityLocations } = await import('../data/dashboardData');

    const locations: LocationInfo[] = Object.entries(cityLocations).map(([name, coords]) => ({
      id: name.toLowerCase().replace(/\s+/g, '_'),
      name,
      latitude: coords.lat,
      longitude: coords.lng
    }));

    return locations;
  }

  // Aggregate data for dashboard metrics
  async getDashboardMetrics(locationIds?: string[]) {
    const [currentAqi, currentWeather, locations] = await Promise.all([
      this.getCurrentAQI(locationIds),
      this.getCurrentWeather(locationIds),
      this.getLocations()
    ]);

    return {
      totalLocations: locations.length,
      avgAqi: Math.round(currentAqi.reduce((sum, r) => sum + r.aqi, 0) / currentAqi.length),
      avgTemp: Math.round(currentWeather.reduce((sum, r) => sum + r.temperature, 0) / currentWeather.length),
      alertLocations: currentAqi.filter(r => r.aqi > 100).length,
      lastUpdated: new Date()
    };
  }
}

// Helper function to convert month name to number
function getMonthNumber(month: string): number {
  const months: { [key: string]: number } = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3,
    'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7,
    'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };
  return months[month] || 0;
}

// Export singleton instance
export const dataService = DataService.getInstance();