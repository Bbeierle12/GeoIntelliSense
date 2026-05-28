/**
 * useRealtimeAQI - Hook for consuming real-time AQI data via SSE
 * Provides live updates from the backend streaming endpoint
 * Includes historical data caching for playback functionality
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { CityData } from '../components/3d/CityMarkers';
import type { DataPoint } from '../utils/interpolation';

// =============================================================================
// TYPES
// =============================================================================

export interface RealtimeCityData extends CityData {
  pm10?: number;
  o3?: number;
  no2?: number;
  windDirection: number;
  timestamp: string;
}

export interface RealtimeStats {
  averageAQI: number;
  maxAQI: number;
  minAQI: number;
  timestamp: string;
}

export interface RealtimeAQIData {
  cities: RealtimeCityData[];
  stats: RealtimeStats;
}

export interface HistoricalSnapshot {
  timestamp: Date;
  data: RealtimeAQIData;
}

export interface UseRealtimeAQIOptions {
  enabled?: boolean;
  fallbackToMock?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  cacheHistory?: boolean;
  maxHistorySize?: number;
}

export interface UseRealtimeAQIReturn {
  data: RealtimeAQIData | null;
  cities: RealtimeCityData[];
  stats: RealtimeStats | null;
  aqiDataPoints: DataPoint[];
  windData: Array<{ lat: number; lng: number; speed: number; direction: number }>;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  reconnect: () => void;
  lastUpdate: Date | null;
  // Historical data access
  history: HistoricalSnapshot[];
  getDataAtTime: (time: Date) => RealtimeAQIData | null;
  timeRange: { start: Date; end: Date };
  clearHistory: () => void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const API_BASE_URL = import.meta.env.VITE_INGESTION_URL || 'http://localhost:3001';
const DEFAULT_RECONNECT_INTERVAL = 5000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

// =============================================================================
// MOCK DATA GENERATOR (fallback when server unavailable)
// =============================================================================

const mockCityData: Record<string, { lat: number; lng: number; baseAqi: number; basePm25: number }> = {
  'Bakersfield': { lat: 35.3733, lng: -119.0187, baseAqi: 95, basePm25: 28 },
  'Fresno': { lat: 36.7378, lng: -119.7871, baseAqi: 78, basePm25: 22 },
  'Visalia': { lat: 36.3302, lng: -119.2921, baseAqi: 82, basePm25: 24 },
  'Merced': { lat: 37.3022, lng: -120.4830, baseAqi: 65, basePm25: 18 },
  'Modesto': { lat: 37.6391, lng: -120.9969, baseAqi: 58, basePm25: 15 },
  'Stockton': { lat: 37.9577, lng: -121.2908, baseAqi: 52, basePm25: 12 },
};

function generateMockData(): RealtimeAQIData {
  const timestamp = new Date().toISOString();
  const hour = new Date().getHours();
  const timeMultiplier = hour < 8 || hour > 18 ? 1.15 : hour < 12 ? 0.95 : 1.05;

  const cities: RealtimeCityData[] = Object.entries(mockCityData).map(([name, data]) => {
    const variation = (Math.random() - 0.5) * 20;
    const aqi = Math.max(0, Math.min(500, Math.round(data.baseAqi * timeMultiplier + variation)));
    const pm25 = Math.max(0, Math.round(data.basePm25 * timeMultiplier + variation * 0.5));
    const windDirection = (270 + Math.random() * 90) % 360;
    const windSpeed = 5 + Math.random() * 15;
    const baseTemp = 72;
    const tempVariation = hour < 8 ? -10 : hour < 12 ? 0 : hour < 18 ? 15 : 5;
    const temperature = Math.round(baseTemp + tempVariation + (Math.random() - 0.5) * 8);
    const humidity = Math.round(35 + Math.random() * 30);

    return {
      id: name,
      name,
      lat: data.lat,
      lng: data.lng,
      aqi,
      pm25,
      pm10: Math.round(pm25 * 1.4),
      o3: Math.round(20 + Math.random() * 40),
      no2: Math.round(10 + Math.random() * 25),
      windSpeed,
      windDirection,
      temperature,
      humidity,
      timestamp,
    };
  });

  const aqiValues = cities.map(c => c.aqi);
  const stats: RealtimeStats = {
    averageAQI: Math.round(aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length),
    maxAQI: Math.max(...aqiValues),
    minAQI: Math.min(...aqiValues),
    timestamp,
  };

  return { cities, stats };
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

const DEFAULT_MAX_HISTORY_SIZE = 288; // 24 hours at 5-minute intervals

export function useRealtimeAQI(options: UseRealtimeAQIOptions = {}): UseRealtimeAQIReturn {
  const {
    enabled = true,
    fallbackToMock = true,
    reconnectInterval = DEFAULT_RECONNECT_INTERVAL,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
    cacheHistory = true,
    maxHistorySize = DEFAULT_MAX_HISTORY_SIZE,
  } = options;

  const [data, setData] = useState<RealtimeAQIData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [history, setHistory] = useState<HistoricalSnapshot[]>([]);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mockIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Add data to history cache
  const addToHistory = useCallback((newData: RealtimeAQIData) => {
    if (!cacheHistory) return;
    
    setHistory(prev => {
      const snapshot: HistoricalSnapshot = {
        timestamp: new Date(),
        data: newData,
      };
      
      // Add to history, maintaining max size
      const updated = [...prev, snapshot];
      if (updated.length > maxHistorySize) {
        return updated.slice(-maxHistorySize);
      }
      return updated;
    });
  }, [cacheHistory, maxHistorySize]);

  // Get data at a specific time (for playback)
  const getDataAtTime = useCallback((time: Date): RealtimeAQIData | null => {
    if (history.length === 0) return null;
    
    // Find the closest historical snapshot
    const targetTime = time.getTime();
    let closest = history[0];
    let minDiff = Math.abs(closest.timestamp.getTime() - targetTime);
    
    for (const snapshot of history) {
      const diff = Math.abs(snapshot.timestamp.getTime() - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snapshot;
      }
    }
    
    return closest.data;
  }, [history]);

  // Calculate time range from history
  const timeRange = useMemo(() => {
    if (history.length === 0) {
      const now = new Date();
      return {
        start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        end: now,
      };
    }
    
    return {
      start: history[0].timestamp,
      end: history[history.length - 1].timestamp,
    };
  }, [history]);

  // Clear history
  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  // Clean up function
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (mockIntervalRef.current) {
      clearInterval(mockIntervalRef.current);
      mockIntervalRef.current = null;
    }
  }, []);

  // Start mock data generation
  const startMockData = useCallback(() => {
    if (!fallbackToMock) return;

    console.log('[useRealtimeAQI] Starting mock data fallback');
    
    // Generate initial data
    const initialData = generateMockData();
    setData(initialData);
    addToHistory(initialData);
    setLastUpdate(new Date());
    setIsLoading(false);
    setError('Using simulated data (server unavailable)');

    // Update every 5 seconds
    mockIntervalRef.current = setInterval(() => {
      const newData = generateMockData();
      setData(newData);
      addToHistory(newData);
      setLastUpdate(new Date());
    }, 5000);
  }, [fallbackToMock, addToHistory]);

  // Connect to SSE endpoint
  const connect = useCallback(() => {
    if (!enabled) return;

    cleanup();
    setIsLoading(true);
    setError(null);

    try {
      const eventSource = new EventSource(`${API_BASE_URL}/api/aqi-stream`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[useRealtimeAQI] SSE connection established');
        setIsConnected(true);
        setIsLoading(false);
        setError(null);
        reconnectAttemptsRef.current = 0;
        
        // Stop mock data if running
        if (mockIntervalRef.current) {
          clearInterval(mockIntervalRef.current);
          mockIntervalRef.current = null;
        }
      };

      eventSource.addEventListener('aqi-update', (event) => {
        try {
          const readings = JSON.parse(event.data) as Array<{
            stationId: string;
            stationName: string;
            lat: number;
            lng: number;
            county: string;
            timestamp: string;
            aqi: number;
            pm25: number;
            pm10: number;
            o3: number;
            no2: number;
            so2: number;
            co: number;
            temperature: number;
            humidity: number;
            windSpeed: number;
            windDirection: number;
          }>;

          const timestamp = readings[0]?.timestamp || new Date().toISOString();
          const cities: RealtimeCityData[] = readings.map(r => ({
            id: r.stationName.split('-')[0],
            name: r.stationName.split('-')[0],
            lat: r.lat,
            lng: r.lng,
            aqi: r.aqi,
            pm25: r.pm25,
            pm10: r.pm10,
            o3: r.o3,
            no2: r.no2,
            windSpeed: r.windSpeed,
            windDirection: r.windDirection,
            temperature: r.temperature,
            humidity: r.humidity,
            timestamp,
          }));

          const aqiValues = cities.map(c => c.aqi);
          const parsedData: RealtimeAQIData = {
            cities,
            stats: {
              averageAQI: Math.round(aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length),
              maxAQI: Math.max(...aqiValues),
              minAQI: Math.min(...aqiValues),
              timestamp,
            },
          };

          setData(parsedData);
          addToHistory(parsedData);
          setLastUpdate(new Date());
        } catch (parseError) {
          console.error('[useRealtimeAQI] Failed to parse SSE data:', parseError);
        }
      });

      eventSource.onerror = (err) => {
        console.error('[useRealtimeAQI] SSE error:', err);
        setIsConnected(false);
        eventSource.close();
        eventSourceRef.current = null;

        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(`[useRealtimeAQI] Reconnect attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else {
          setError('Failed to connect to real-time data stream');
          setIsLoading(false);
          startMockData();
        }
      };
    } catch (err) {
      console.error('[useRealtimeAQI] Failed to create EventSource:', err);
      setError('Failed to initialize real-time connection');
      setIsLoading(false);
      startMockData();
    }
  }, [enabled, cleanup, reconnectInterval, maxReconnectAttempts, startMockData, addToHistory]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  // Effect to manage connection lifecycle
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      cleanup();
      setIsConnected(false);
      setIsLoading(false);
    }

    return cleanup;
  }, [enabled, connect, cleanup]);

  // Derived data for 3D visualization
  const cities = data?.cities || [];
  const stats = data?.stats || null;

  const aqiDataPoints: DataPoint[] = cities.map(city => ({
    lat: city.lat,
    lng: city.lng,
    value: city.aqi,
  }));

  const windData = cities.map(city => ({
    lat: city.lat,
    lng: city.lng,
    speed: city.windSpeed || 10,
    direction: city.windDirection,
  }));

  return {
    data,
    cities,
    stats,
    aqiDataPoints,
    windData,
    isConnected,
    isLoading,
    error,
    reconnect,
    lastUpdate,
    // Historical data access
    history,
    getDataAtTime,
    timeRange,
    clearHistory,
  };
}

export default useRealtimeAQI;
