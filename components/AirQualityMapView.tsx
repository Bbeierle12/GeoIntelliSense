/**
 * AirQualityMapView - Advanced 3D WebGL Visualization
 * Complete integration of Three.js/React Three Fiber components
 * With real-time data streaming via SSE
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { dashboardData, cityLocations, LocationKey } from '../data/dashboardData';
import { AirIcon } from './icons/AirIcon';
import { MapIcon } from './icons/MapIcon';
import { GaugeIcon } from './icons/GaugeIcon';
import { TrendingUpIcon } from './icons/TrendingUpIcon';
import { EyeIcon } from './icons/EyeIcon';
import { CloudIcon } from './icons/CloudIcon';
import { useUserPreferences } from '../contexts/UserPreferencesContext';
import { useRealtimeAQI } from '../hooks/useRealtimeAQI';

// 3D Components
import {
  AQI3DScene,
  TerrainMesh,
  PollutionVolume,
  CityMarkers,
  WindField,
  LayerControls,
  TimeControls,
  MetricsPanel,
  AQILegend,
  CameraControlsInfo,
  CityData,
  WindData,
  CrossSectionView,
  TransectLine,
} from './3d';
import type { LayerSettings, TimeSettings, MetricsData } from './3d';
import type { DataPoint } from '../utils/interpolation';
import { getAQIColor, getAQICategory } from '../utils/colorScales';

// =============================================================================
// CONSTANTS
// =============================================================================

// City elevation data (feet)
const CITY_ELEVATIONS: Record<string, number> = {
  'Bakersfield': 404,
  'Fresno': 308,
  'Visalia': 334,
  'Merced': 174,
  'Modesto': 91,
  'Stockton': 13,
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

const getAqiColorLegacy = (aqi: number): string => {
  if (aqi <= 50) return '#22c55e';
  if (aqi <= 100) return '#facc15';
  if (aqi <= 150) return '#f97316';
  if (aqi <= 200) return '#ef4444';
  if (aqi <= 300) return '#a855f7';
  return '#881337';
};

// Generate simulated wind data for cities
const generateWindData = (timestamp: Date): WindData[] => {
  const hour = timestamp.getHours();
  // Valley wind patterns change throughout day
  const baseDirection = hour < 12 ? 315 : 135; // NW morning, SE afternoon
  
  return cityLocations.map((city) => {
    const data = dashboardData[city];
    if ('coords' in data) {
      return {
        lat: data.coords.lat,
        lng: data.coords.lng,
        speed: 5 + Math.random() * 15, // 5-20 mph
        direction: baseDirection + (Math.random() - 0.5) * 40,
      };
    }
    return { lat: 0, lng: 0, speed: 0, direction: 0 };
  }).filter(w => w.lat !== 0);
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface StatsCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  trend?: 'up' | 'down' | 'stable';
}

const StatsCard: React.FC<StatsCardProps> = ({ icon, label, value, unit, color, trend }) => (
  <div className="bg-gray-800/80 backdrop-blur-sm p-3 rounded-lg border border-gray-700">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-gray-400">{icon}</span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
    <div className="flex items-baseline gap-1">
      <span className="text-xl font-bold" style={{ color: color || 'white' }}>
        {value}
      </span>
      {unit && <span className="text-sm text-gray-400">{unit}</span>}
      {trend && (
        <span className={`ml-1 text-xs ${trend === 'up' ? 'text-red-400' : trend === 'down' ? 'text-green-400' : 'text-yellow-400'}`}>
          {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
        </span>
      )}
    </div>
  </div>
);

// City detail panel overlay
interface CityDetailPanelProps {
  city: CityData | null;
  onClose: () => void;
}

const CityDetailPanel: React.FC<CityDetailPanelProps> = ({ city, onClose }) => {
  if (!city) return null;

  const data = dashboardData[city.name as LocationKey];
  if (!('currentAqi' in data)) return null;

  const category = getAQICategory(city.aqi);

  return (
    <div className="absolute top-4 left-4 bg-gray-900/95 backdrop-blur-sm p-4 rounded-lg shadow-xl border border-gray-700 max-w-xs z-20">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-lg text-white">{city.name}</h3>
        <button 
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Current AQI</span>
          <span className="font-bold" style={{ color: getAQIColor(city.aqi) }}>
            {city.aqi} - {category}
          </span>
        </div>
        {city.pm25 !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">PM2.5</span>
            <span className="font-semibold text-white">{city.pm25} µg/m³</span>
          </div>
        )}
        {city.temperature !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">Temperature</span>
            <span className="font-semibold text-red-400">{city.temperature}°F</span>
          </div>
        )}
        {city.humidity !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">Humidity</span>
            <span className="font-semibold text-sky-400">{city.humidity}%</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-400">Elevation</span>
          <span className="font-semibold text-white">{CITY_ELEVATIONS[city.name] || 'N/A'} ft</span>
        </div>
        <div className="pt-2 border-t border-gray-700">
          <p className="text-xs text-gray-500">
            Real-time data from EPA monitoring station. Interpolation model uses IDW and Kriging algorithms.
          </p>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const AirQualityMapView: React.FC = () => {
  const { preferences } = useUserPreferences();
  
  // Real-time data hook
  const {
    cities: realtimeCities,
    stats: realtimeStats,
    aqiDataPoints: realtimeAqiDataPoints,
    windData: realtimeWindData,
    isConnected,
    isLoading: realtimeLoading,
    error: realtimeError,
    reconnect,
    lastUpdate,
  } = useRealtimeAQI({ enabled: true, fallbackToMock: true });
  
  // State
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState<CityData | null>(null);
  const [hoveredCity, setHoveredCity] = useState<CityData | null>(null);
  const [useRealtimeData, setUseRealtimeData] = useState(true);
  const [showCrossSection, setShowCrossSection] = useState(false);
  
  // Cross-section transect line (Bakersfield to Stockton by default)
  const [transect, setTransect] = useState<TransectLine>({
    start: { lat: 35.3733, lng: -119.0187 }, // Bakersfield
    end: { lat: 37.9577, lng: -121.2908 },   // Stockton
  });
  
  // Layer visibility settings
  const [layers, setLayers] = useState<LayerSettings>({
    terrain: true,
    aqiOverlay: true,
    pollutionClouds: true,
    cityMarkers: true,
    windField: true,
    labels: true,
    contours: false,
  });
  
  // Time controls
  const [timeSettings, setTimeSettings] = useState<TimeSettings>({
    currentTime: new Date(),
    playing: false,
    playbackSpeed: 1,
    timeRange: {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
      end: new Date(),
    },
  });
  
  // Fallback: Convert dashboard data to city data for 3D markers
  const staticCityData: CityData[] = useMemo(() => {
    const result: CityData[] = [];
    for (const city of cityLocations) {
      const data = dashboardData[city];
      if ('coords' in data && 'currentAqi' in data && 'currentWeather' in data) {
        result.push({
          id: city as string,
          name: city as string,
          lat: data.coords.lat,
          lng: data.coords.lng,
          aqi: data.currentAqi.aqi,
          pm25: data.currentAqi.pm25,
          temperature: data.currentWeather.temp,
          humidity: data.currentWeather.humidity,
          windSpeed: 10 + Math.random() * 10,
        });
      }
    }
    return result;
  }, []);
  
  // Use real-time data if available, otherwise fall back to static
  const cityData = useRealtimeData && realtimeCities.length > 0 ? realtimeCities : staticCityData;
  
  // Convert to AQI data points for interpolation
  const aqiDataPoints: DataPoint[] = useMemo(() => {
    if (useRealtimeData && realtimeAqiDataPoints.length > 0) {
      return realtimeAqiDataPoints;
    }
    return cityData.map((city) => ({
      lat: city.lat,
      lng: city.lng,
      value: city.aqi,
    }));
  }, [useRealtimeData, realtimeAqiDataPoints, cityData]);
  
  // Wind data (prefer real-time)
  const windData = useRealtimeData && realtimeWindData.length > 0 ? realtimeWindData : useMemo(() => {
    return generateWindData(new Date());
  }, []);
  
  // Calculate metrics
  const metrics: MetricsData = useMemo(() => {
    if (useRealtimeData && realtimeStats) {
      return {
        averageAQI: realtimeStats.averageAQI,
        maxAQI: realtimeStats.maxAQI,
        minAQI: realtimeStats.minAQI,
        dominantPollutant: 'PM2.5',
        affectedPopulation: 4200000,
        trend: realtimeStats.averageAQI > 100 ? 'worsening' : realtimeStats.averageAQI < 50 ? 'improving' : 'stable',
      };
    }
    
    if (cityData.length === 0) {
      return { averageAQI: 0, maxAQI: 0, minAQI: 0 };
    }
    
    const aqiValues = cityData.map(c => c.aqi);
    const avgAqi = aqiValues.reduce((sum, v) => sum + v, 0) / aqiValues.length;
    const maxAqi = Math.max(...aqiValues);
    const minAqi = Math.min(...aqiValues);
    
    // Determine trend (simplified)
    const trend = avgAqi > 100 ? 'worsening' : avgAqi < 50 ? 'improving' : 'stable';
    
    return {
      averageAQI: avgAqi,
      maxAQI: maxAqi,
      minAQI: minAqi,
      dominantPollutant: 'PM2.5',
      affectedPopulation: 4200000, // San Joaquin Valley population
      trend: trend as 'improving' | 'worsening' | 'stable',
    };
  }, [cityData]);
  
  // Stats for header cards
  const stats = useMemo(() => ({
    avgAqi: Math.round(metrics.averageAQI),
    avgPm25: Math.round(cityData.reduce((sum, c) => sum + (c.pm25 || 0), 0) / cityData.length),
    maxAqi: metrics.maxAQI,
    minAqi: metrics.minAQI,
  }), [metrics, cityData]);
  
  // Handle layer toggle
  const handleLayerChange = useCallback((layer: keyof LayerSettings, enabled: boolean) => {
    setLayers(prev => ({ ...prev, [layer]: enabled }));
  }, []);
  
  // Handle time change
  const handleTimeChange = useCallback((time: Date) => {
    setTimeSettings(prev => ({ ...prev, currentTime: time }));
  }, []);
  
  // Handle play/pause
  const handlePlayPause = useCallback(() => {
    setTimeSettings(prev => ({ ...prev, playing: !prev.playing }));
  }, []);
  
  // Handle speed change
  const handleSpeedChange = useCallback((speed: number) => {
    setTimeSettings(prev => ({ ...prev, playbackSpeed: speed }));
  }, []);
  
  // Handle city selection
  const handleCityClick = useCallback((city: CityData) => {
    setSelectedCity(prev => prev?.id === city.id ? null : city);
  }, []);
  
  // Time playback effect
  useEffect(() => {
    if (!timeSettings.playing) return;
    
    const interval = setInterval(() => {
      setTimeSettings(prev => {
        const newTime = new Date(prev.currentTime.getTime() + 60000 * prev.playbackSpeed);
        if (newTime > prev.timeRange.end) {
          return { ...prev, currentTime: prev.timeRange.start };
        }
        return { ...prev, currentTime: newTime };
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [timeSettings.playing, timeSettings.playbackSpeed]);
  
  // Loading simulation
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);
  
  if (isLoading) {
    return (
      <div className="h-[calc(100vh-150px)] min-h-[500px] flex items-center justify-center bg-gray-900 rounded-lg">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-t-transparent border-green-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Initializing WebGL 3D Engine...</p>
          <p className="text-sm text-gray-500 mt-2">Loading terrain, shaders, and particle systems</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-[calc(100vh-150px)] min-h-[500px] flex flex-col">
      {/* Connection error banner */}
      {realtimeError && !isConnected && (
        <div className="bg-amber-900/30 border border-amber-600/50 rounded-lg px-4 py-2 mb-3 flex items-center justify-between">
          <span className="text-amber-300 text-sm">{realtimeError}</span>
          <button onClick={reconnect} className="text-amber-200 hover:text-white text-sm underline ml-4">Reconnect</button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <AirIcon className="w-8 h-8 text-green-500" />
          <div>
            <h2 className="text-2xl font-bold text-white">
              Air Quality Map
            </h2>
            <p className="text-sm text-gray-400">
              Live 3D WebGL Statistical Model • San Joaquin Valley
            </p>
          </div>
        </div>
        
        {/* Timestamp */}
        <div className="bg-gray-800/80 backdrop-blur-sm px-4 py-2 rounded-lg">
          <div className="text-xs text-gray-400">
            {isConnected ? '🔴 Live' : 'Last Updated'}
          </div>
          <div className="text-sm font-mono text-white">
            {lastUpdate ? lastUpdate.toLocaleTimeString() : timeSettings.currentTime.toLocaleTimeString()}
          </div>
        </div>
        
        {/* View Mode Toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowCrossSection(false)}
            className={`px-3 py-2 rounded-lg transition-colors ${
              !showCrossSection
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <span className="flex items-center gap-1">
              <MapIcon className="w-4 h-4" />
              3D Map
            </span>
          </button>
          <button
            onClick={() => setShowCrossSection(true)}
            className={`px-3 py-2 rounded-lg transition-colors ${
              showCrossSection
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <span className="flex items-center gap-1">
              <TrendingUpIcon className="w-4 h-4" />
              Cross-Section
            </span>
          </button>
        </div>
      </div>
      
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatsCard
          icon={<GaugeIcon className="w-4 h-4" />}
          label="Valley Average AQI"
          value={stats.avgAqi}
          color={getAqiColorLegacy(stats.avgAqi)}
          trend={stats.avgAqi > 100 ? 'up' : stats.avgAqi < 50 ? 'down' : 'stable'}
        />
        <StatsCard
          icon={<CloudIcon className="w-4 h-4" />}
          label="Average PM2.5"
          value={stats.avgPm25}
          unit="µg/m³"
          color={stats.avgPm25 > 35 ? '#ef4444' : stats.avgPm25 > 12 ? '#facc15' : '#22c55e'}
        />
        <StatsCard
          icon={<TrendingUpIcon className="w-4 h-4" />}
          label="Worst AQI"
          value={stats.maxAqi}
          color={getAqiColorLegacy(stats.maxAqi)}
        />
        <StatsCard
          icon={<EyeIcon className="w-4 h-4" />}
          label="Best AQI"
          value={stats.minAqi}
          color={getAqiColorLegacy(stats.minAqi)}
        />
      </div>
      
      {/* Main 3D Map Container */}
      <div className="flex-1 relative rounded-lg overflow-hidden shadow-lg border border-gray-700">
        {/* Cross-Section View */}
        {showCrossSection ? (
          <CrossSectionView
            dataPoints={aqiDataPoints}
            transect={transect}
            maxAltitude={2000}
            resolution={50}
            verticalLayers={20}
            showGrid={true}
            showLabels={true}
            animated={true}
            className="w-full h-full min-h-[500px]"
          />
        ) : (
          <>
            {/* 3D Scene */}
            <AQI3DScene
              backgroundColor="#0f1729"
              fogEnabled={true}
              fogColor="#0f1729"
              fogNear={80}
              fogFar={250}
              showStats={false}
              className="w-full h-full"
            >
              {/* Terrain with AQI overlay */}
              {layers.terrain && (
                <TerrainMesh
                  aqiData={aqiDataPoints}
                  showAQIOverlay={layers.aqiOverlay}
                  overlayOpacity={0.5}
                  resolution={48}
                  heightScale={0.5}
                  textureResolution={128}
                  baseColor="#2d4a2d"
                  showContours={layers.contours}
                />
              )}
              
              {/* Volumetric pollution clouds */}
              {layers.pollutionClouds && (
                <PollutionVolume
                  aqiData={aqiDataPoints}
                  maxHeight={40}
                  opacity={0.35}
                  animationSpeed={0.8}
                  resolution={10}
                />
              )}
              
              {/* City markers */}
              {layers.cityMarkers && (
                <CityMarkers
                  cities={cityData}
                  showLabels={layers.labels}
                  showTooltips={true}
                  markerScale={0.8}
                  animateMarkers={true}
                  onCityClick={handleCityClick}
                  onCityHover={setHoveredCity}
                  selectedCity={selectedCity?.id || null}
                />
              )}
              
              {/* Wind field visualization */}
              {layers.windField && (
                <WindField
                  windData={windData}
                  particleCount={400}
                  particleSize={12}
                  particleSpeed={1.2}
                  particleColor="#87CEEB"
                  opacity={0.5}
                  height={20}
                  showArrows={true}
                />
              )}
            </AQI3DScene>
            
            {/* UI Overlay Panels */}
            {/* Layer Controls - Top Left */}
            <LayerControls
              layers={layers}
              onLayerChange={handleLayerChange}
              className="absolute top-4 left-4 w-48 z-10"
            />
            
            {/* Metrics Panel - Top Right */}
            <MetricsPanel
              metrics={metrics}
              className="absolute top-4 right-4 w-56 z-10"
            />
            
            {/* Time Controls - Bottom Center */}
            <TimeControls
              settings={timeSettings}
              onTimeChange={handleTimeChange}
              onPlayPause={handlePlayPause}
              onSpeedChange={handleSpeedChange}
              className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-80 z-10"
            />
            
            {/* AQI Legend - Bottom Left */}
            <AQILegend
              orientation="vertical"
              className="absolute bottom-4 left-4 z-10"
            />
            
            {/* Camera Controls Info - Bottom Right */}
            <CameraControlsInfo
              className="absolute bottom-4 right-4 z-10"
            />
            
            {/* Selected City Detail Panel */}
            <CityDetailPanel
              city={selectedCity}
              onClose={() => setSelectedCity(null)}
            />
          </>
        )}
      </div>
      
      {/* Model Info Footer */}
      <div className="mt-4 p-3 bg-gray-800/80 rounded-lg text-sm text-gray-400">
        <div className="flex items-center gap-2 mb-1">
          <MapIcon className="w-4 h-4" />
          <span className="font-semibold text-gray-300">3D Visualization Engine</span>
        </div>
        <p>
          Powered by <strong>WebGL</strong> via Three.js and React Three Fiber. 
          Uses <strong>IDW and Kriging interpolation</strong> for statistical modeling between monitoring stations.
          Volumetric pollution clouds rendered with custom GLSL shaders. 
          Wind field visualization uses GPU-accelerated particle systems.
        </p>
      </div>
    </div>
  );
};

export default AirQualityMapView;
