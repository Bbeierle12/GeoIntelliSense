const API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;
const BASE_URL = 'https://api.openweathermap.org/data/2.5/air_pollution';

export interface AQIData {
    aqi: number; // 1-5 scale from OWM, need to map to US AQI if possible or just use raw
    pm25: number;
    pm10: number;
    no2: number;
    so2: number;
    co: number;
    o3: number;
    usAqi?: number; // Calculated or fetched
}

export class AirQualityService {
    private static instance: AirQualityService;

    private constructor() { }

    public static getInstance(): AirQualityService {
        if (!AirQualityService.instance) {
            AirQualityService.instance = new AirQualityService();
        }
        return AirQualityService.instance;
    }

    async getCurrentAQI(lat: number, lon: number): Promise<AQIData> {
        if (!API_KEY) {
            console.warn('OpenWeatherMap API key not found. Using mock AQI data.');
            return this.getMockAQI();
        }

        try {
            const response = await fetch(`${BASE_URL}?lat=${lat}&lon=${lon}&appid=${API_KEY}`);
            if (!response.ok) throw new Error('AQI API request failed');

            const data = await response.json();
            const components = data.list[0].components;
            const owmAqi = data.list[0].main.aqi;

            // OWM returns AQI 1-5. We can approximate US AQI or just return raw components.
            // For this dashboard, we want US AQI (0-500).
            // Converting PM2.5 to US AQI is a common approximation.
            const usAqi = this.calculateUSAQI(components.pm2_5);

            return {
                aqi: owmAqi,
                usAqi: usAqi,
                pm25: components.pm2_5,
                pm10: components.pm10,
                no2: components.no2,
                so2: components.so2,
                co: components.co,
                o3: components.o3
            };
        } catch (error) {
            console.error('Error fetching AQI:', error);
            return this.getMockAQI();
        }
    }

    // Simplified PM2.5 to AQI conversion (approximate)
    private calculateUSAQI(pm25: number): number {
        if (pm25 <= 12.0) return Math.round((50 - 0) / (12.0 - 0) * (pm25 - 0) + 0);
        if (pm25 <= 35.4) return Math.round((100 - 51) / (35.4 - 12.1) * (pm25 - 12.1) + 51);
        if (pm25 <= 55.4) return Math.round((150 - 101) / (55.4 - 35.5) * (pm25 - 35.5) + 101);
        if (pm25 <= 150.4) return Math.round((200 - 151) / (150.4 - 55.5) * (pm25 - 55.5) + 151);
        if (pm25 <= 250.4) return Math.round((300 - 201) / (250.4 - 150.5) * (pm25 - 150.5) + 201);
        return Math.round((500 - 301) / (500.4 - 250.5) * (pm25 - 250.5) + 301);
    }

    private getMockAQI(): AQIData {
        return {
            aqi: 3,
            usAqi: 120,
            pm25: 45,
            pm10: 60,
            no2: 10,
            so2: 5,
            co: 200,
            o3: 40
        };
    }
}

export const airQualityService = AirQualityService.getInstance();
