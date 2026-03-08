const INGESTION_URL = import.meta.env.VITE_INGESTION_URL
  ? `${import.meta.env.VITE_INGESTION_URL}/api`
  : 'http://localhost:3001/api';

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

interface SnapshotReading {
    lat: number; lng: number;
    aqi: number; pm25: number; pm10: number;
    no2: number; so2: number; co: number; o3: number;
}

export class AirQualityService {
    private static instance: AirQualityService;
    private cachedReadings: SnapshotReading[] | null = null;
    private cacheTimestamp = 0;
    private readonly CACHE_TTL_MS = 4000; // 4s — shorter than the 5s broadcast interval

    private constructor() { }

    public static getInstance(): AirQualityService {
        if (!AirQualityService.instance) {
            AirQualityService.instance = new AirQualityService();
        }
        return AirQualityService.instance;
    }

    private async getReadings(): Promise<SnapshotReading[]> {
        const now = Date.now();
        if (this.cachedReadings && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
            return this.cachedReadings;
        }

        const response = await fetch(`${INGESTION_URL}/aqi-snapshot`);
        if (!response.ok) throw new Error('AQI snapshot request failed');

        const data = await response.json();
        this.cachedReadings = data.readings as SnapshotReading[];
        this.cacheTimestamp = now;
        return this.cachedReadings;
    }

    async getCurrentAQI(lat: number, lng: number): Promise<AQIData> {
        try {
            const readings = await this.getReadings();

            const closest = readings.reduce((best, r) => {
                const dist = Math.hypot(r.lat - lat, r.lng - lng);
                const bestDist = Math.hypot(best.lat - lat, best.lng - lng);
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
            throw error;
        }
    }
}

export const airQualityService = AirQualityService.getInstance();
