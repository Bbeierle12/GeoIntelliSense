/**
 * Generic data fetching hook with auto-refresh.
 * Polls at a configurable interval, tracks loading/error/staleness.
 * All API calls go through the Caddy gateway or direct service URLs.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8080';
const INGESTION_URL = import.meta.env.VITE_INGESTION_URL || 'http://localhost:3001';

interface UseLiveDataOptions {
  refreshInterval?: number; // ms, 0 = no auto-refresh
  enabled?: boolean;
}

interface UseLiveDataReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refetch: () => void;
}

export function useLiveData<T>(
  path: string,
  options: UseLiveDataOptions = {},
): UseLiveDataReturn<T> {
  const { refreshInterval = 0, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    try {
      // Route to ingestion service for Rust endpoints
      const base = path.startsWith('/api/aqi-') || path === '/health'
        ? INGESTION_URL
        : GATEWAY_URL;
      const res = await fetch(`${base}${path}`);
      if (!res.ok) {
        // 503 = source disabled, show that cleanly
        if (res.status === 503) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || 'Source disabled');
          setLoading(false);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    setLoading(true);
    fetchData();

    if (refreshInterval > 0 && enabled) {
      intervalRef.current = setInterval(fetchData, refreshInterval);
      return () => clearInterval(intervalRef.current);
    }
  }, [fetchData, refreshInterval, enabled]);

  return { data, loading, error, lastUpdated, refetch: fetchData };
}

// ── Typed hooks for each data source ──────────────────

export interface AqiSnapshot {
  readings: Array<{
    station_id: number;
    station_name: string;
    aqi: number;
    pm25: number;
    pm10: number;
    o3: number;
    temperature: number;
    humidity: number;
    wind_speed: number;
    category: string;
    source: string;
  }>;
  station_count: number;
  timestamp: string;
}

export function useAqiSnapshot() {
  return useLiveData<AqiSnapshot>('/api/aqi-snapshot', { refreshInterval: 30_000 });
}

export interface PredictionResult {
  predictedAqi: number;
  confidenceInterval: { low: number; high: number };
  category: string;
  horizon: string;
  modelR2: number;
  modelMAE: number;
  trainedAt: string;
  topFactors: Array<{ feature: string; importance: number }>;
  airnowComparison?: { source: string; aqi: number; category: string };
}

export function useAqiPrediction() {
  return useLiveData<PredictionResult>('/api/predict/aqi', { refreshInterval: 300_000 });
}

export interface InversionData {
  inversionStrength: string;
  surfaceTempC: number | null;
  surfaceTempF: number | null;
  temp850mbC: number | null;
  tempDiffC: number | null;
  fogLikely: boolean;
  advisory: string;
  aqiImpact: string;
  time: string;
}

export function useInversionStatus() {
  return useLiveData<InversionData>('/api/weather/inversion-status', { refreshInterval: 300_000 });
}

export interface FiresData {
  count: number;
  upwindCount: number;
  smokeRisk: string;
  fires: Array<{
    lat: number;
    lng: number;
    brightness: number;
    frp: number;
    confidence: string;
    distanceKm: number;
    isUpwind: boolean;
  }>;
}

export function useActiveFires() {
  return useLiveData<FiresData>('/api/fires/active', { refreshInterval: 300_000 });
}

export interface EarthquakeData {
  count: number;
  days: number;
  minMagnitude: number;
  events: Array<{
    eventId: string;
    time: string;
    magnitude: number;
    depthKm: number;
    place: string;
    distanceFromBakersfieldKm: number;
  }>;
}

export function useEarthquakes() {
  return useLiveData<EarthquakeData>('/api/earthquakes/recent?days=7&min_magnitude=2.0', { refreshInterval: 300_000 });
}

export interface WaterData {
  count: number;
  source: string;
  stations: Array<{
    siteId: string;
    siteName: string;
    readings: Record<string, { value: number; units: string; time: string }>;
  }>;
}

export function useWaterLevels() {
  return useLiveData<WaterData>('/api/water/current', { refreshInterval: 900_000 });
}

export interface ForecastPeriod {
  locationName: string;
  date: string;
  tempHigh: number | null;
  tempLow: number | null;
  humidity: number | null;
  precipProbability: number;
  windSpeed: string;
  conditions: string;
}

export function useNwsForecast() {
  return useLiveData<ForecastPeriod[]>('/api/forecast', { refreshInterval: 3_600_000 });
}
