import { calculateFeelsLike, calculateET0 } from '../utils/weatherUtils';

const INGESTION_URL = 'http://localhost:3001/api';
const ANALYTICS_URL = 'http://localhost:3002/api';

export interface WeatherData {
    temp: number;
    humidity: number;
    windSpeed: number;
    windDirection: number;
    pressure: number;
    cloudCover: number;
    description: string;
    icon: string;
    feelsLike: number;
    et0: number;
    solarRadiation: number;
}

export interface ForecastData {
    date: string;
    temp: { min: number; max: number };
    humidity: number;
    description: string;
    icon: string;
}

export class WeatherService {
    private static instance: WeatherService;

    private constructor() { }

    public static getInstance(): WeatherService {
        if (!WeatherService.instance) {
            WeatherService.instance = new WeatherService();
        }
        return WeatherService.instance;
    }

    async getCurrentWeather(lat: number, _lon: number): Promise<WeatherData> {
        try {
            const response = await fetch(`${INGESTION_URL}/aqi-snapshot`);
            if (!response.ok) throw new Error('Snapshot request failed');

            const data = await response.json();
            const readings = data.readings as Array<{
                lat: number; lng: number;
                temperature: number; humidity: number;
                windSpeed: number; windDirection: number;
            }>;

            // Find closest station
            const closest = readings.reduce((best, r) => {
                const dist = Math.hypot(r.lat - lat, r.lng - _lon);
                const bestDist = Math.hypot(best.lat - lat, best.lng - _lon);
                return dist < bestDist ? r : best;
            }, readings[0]);

            const solarRadiation = 600; // Estimated default
            return {
                temp: Math.round(closest.temperature),
                humidity: Math.round(closest.humidity),
                windSpeed: Math.round(closest.windSpeed),
                windDirection: Math.round(closest.windDirection),
                pressure: 1013,
                cloudCover: 20,
                description: 'Live data',
                icon: '01d',
                feelsLike: calculateFeelsLike(closest.temperature, closest.humidity, closest.windSpeed),
                et0: calculateET0(closest.temperature, closest.humidity, closest.windSpeed, solarRadiation),
                solarRadiation,
            };
        } catch (error) {
            console.error('Error fetching weather from ingestion:', error);
            return this.getMockWeather();
        }
    }

    async getForecast(lat: number, lon: number): Promise<ForecastData[]> {
        try {
            const response = await fetch(`${ANALYTICS_URL}/forecast`);
            if (!response.ok) throw new Error('Forecast request failed');

            const records = await response.json() as Array<{
                locationName: string;
                date: string;
                tempHigh: number | null;
                tempLow: number | null;
                humidity: number | null;
                conditions: string;
                icon: string;
            }>;

            // Group NWS day/night periods into daily forecasts
            const dailyMap = new Map<string, { highs: number[]; lows: number[]; humidities: number[]; conditions: string; icon: string }>();

            for (const r of records) {
                const dateKey = r.date.split('T')[0];
                if (!dailyMap.has(dateKey)) {
                    dailyMap.set(dateKey, { highs: [], lows: [], humidities: [], conditions: r.conditions, icon: r.icon });
                }
                const day = dailyMap.get(dateKey)!;
                if (r.tempHigh != null) day.highs.push(r.tempHigh);
                if (r.tempLow != null) day.lows.push(r.tempLow);
                if (r.humidity != null) day.humidities.push(r.humidity);
            }

            return Array.from(dailyMap.entries()).slice(0, 7).map(([date, v]) => ({
                date,
                temp: {
                    min: v.lows.length ? Math.min(...v.lows) : 60,
                    max: v.highs.length ? Math.max(...v.highs) : 80,
                },
                humidity: v.humidities.length ? Math.round(v.humidities.reduce((a, b) => a + b, 0) / v.humidities.length) : 50,
                description: v.conditions,
                icon: v.icon,
            }));
        } catch (error) {
            console.error('Error fetching forecast:', error);
            return this.getMockForecast();
        }
    }

    private getMockWeather(): WeatherData {
        return {
            temp: 72,
            humidity: 45,
            windSpeed: 5,
            windDirection: 180,
            pressure: 1013,
            cloudCover: 20,
            description: 'Partly Cloudy (Mock)',
            icon: '02d',
            feelsLike: 72,
            et0: 4.5,
            solarRadiation: 600
        };
    }

    private getMockForecast(): ForecastData[] {
        return Array.from({ length: 7 }, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() + i);
            return {
                date: date.toISOString().split('T')[0],
                temp: { min: 60, max: 80 },
                humidity: 50,
                description: 'Sunny (Mock)',
                icon: '01d'
            };
        });
    }
}

export const weatherService = WeatherService.getInstance();
