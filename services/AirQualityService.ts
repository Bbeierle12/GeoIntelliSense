const INGESTION_URL = 'http://localhost:3001/api';

export interface AQIData {
    aqi: number;
    pm25: number;
    pm10: number;
    no2: number;
    so2: number;
    co: number;
    o3: number;
    usAqi?: number;
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

    async getCurrentAQI(_lat: number, _lng: number): Promise<AQIData> {
        try {
            const response = await fetch(`${INGESTION_URL}/aqi-snapshot`);
            if (!response.ok) throw new Error('AQI snapshot request failed');

            const data = await response.json();
            // Find the closest station to the requested coordinates
            const readings = data.readings as Array<{
                lat: number; lng: number;
                aqi: number; pm25: number; pm10: number;
                no2: number; so2: number; co: number; o3: number;
            }>;

            const closest = readings.reduce((best, r) => {
                const dist = Math.hypot(r.lat - _lat, r.lng - _lng);
                const bestDist = Math.hypot(best.lat - _lat, best.lng - _lng);
                return dist < bestDist ? r : best;
            }, readings[0]);

            return {
                aqi: closest.aqi,
                usAqi: closest.aqi,
                pm25: closest.pm25,
                pm10: closest.pm10,
                no2: closest.no2,
                so2: closest.so2,
                co: closest.co,
                o3: closest.o3,
            };
        } catch (error) {
            console.error('Error fetching AQI from ingestion service:', error);
            return this.getMockAQI();
        }
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
