import { calculateFeelsLike, calculateET0, determineWeatherCondition } from '../utils/weatherUtils';

const API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

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
    solarRadiation: number; // Estimated
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

    async getCurrentWeather(lat: number, lon: number): Promise<WeatherData> {
        if (!API_KEY) {
            console.warn('OpenWeatherMap API key not found. Using mock data.');
            return this.getMockWeather();
        }

        try {
            const response = await fetch(`${BASE_URL}/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${API_KEY}`);
            if (!response.ok) throw new Error('Weather API request failed');

            const data = await response.json();

            // Estimate solar radiation based on cloud cover and time of day (simplified)
            const cloudCover = data.clouds.all;
            const hour = new Date().getHours();
            const isDay = hour > 6 && hour < 20;
            const maxSolar = 1000;
            const solarRadiation = isDay ? Math.round(maxSolar * (1 - cloudCover / 100)) : 0;

            return {
                temp: Math.round(data.main.temp),
                humidity: data.main.humidity,
                windSpeed: Math.round(data.wind.speed),
                windDirection: data.wind.deg,
                pressure: data.main.pressure,
                cloudCover: data.clouds.all,
                description: data.weather[0].description,
                icon: data.weather[0].icon,
                feelsLike: calculateFeelsLike(data.main.temp, data.main.humidity, data.wind.speed),
                et0: calculateET0(data.main.temp, data.main.humidity, data.wind.speed, solarRadiation),
                solarRadiation
            };
        } catch (error) {
            console.error('Error fetching weather:', error);
            return this.getMockWeather();
        }
    }

    async getForecast(lat: number, lon: number): Promise<ForecastData[]> {
        if (!API_KEY) {
            return this.getMockForecast();
        }

        try {
            const response = await fetch(`${BASE_URL}/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${API_KEY}`);
            if (!response.ok) throw new Error('Forecast API request failed');

            const data = await response.json();

            // Process 3-hour forecast into daily forecast
            const dailyMap = new Map<string, any>();

            data.list.forEach((item: any) => {
                const date = item.dt_txt.split(' ')[0];
                if (!dailyMap.has(date)) {
                    dailyMap.set(date, {
                        temps: [],
                        humidities: [],
                        descriptions: [],
                        icons: []
                    });
                }
                const day = dailyMap.get(date);
                day.temps.push(item.main.temp);
                day.humidities.push(item.main.humidity);
                day.descriptions.push(item.weather[0].description);
                day.icons.push(item.weather[0].icon);
            });

            return Array.from(dailyMap.entries()).slice(0, 7).map(([date, values]) => ({
                date,
                temp: {
                    min: Math.round(Math.min(...values.temps)),
                    max: Math.round(Math.max(...values.temps))
                },
                humidity: Math.round(values.humidities.reduce((a: number, b: number) => a + b, 0) / values.humidities.length),
                description: values.descriptions[Math.floor(values.descriptions.length / 2)],
                icon: values.icons[Math.floor(values.icons.length / 2)]
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
