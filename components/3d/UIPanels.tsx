/**
 * UI Panel Components for 3D Air Quality Map
 * LayerControls, TimeControls, MetricsPanel, and Legend
 */

import React, { useState, useCallback } from 'react';
import { AQI_CATEGORIES, createAQILegendGradient, generateAQILegendItems } from '../../utils/colorScales';

// =============================================================================
// TYPES
// =============================================================================

export interface LayerSettings {
  terrain: boolean;
  aqiOverlay: boolean;
  pollutionClouds: boolean;
  cityMarkers: boolean;
  windField: boolean;
  labels: boolean;
  contours: boolean;
}

export interface TimeSettings {
  currentTime: Date;
  playing: boolean;
  playbackSpeed: number; // 1x, 2x, 4x
  timeRange: {
    start: Date;
    end: Date;
  };
}

export interface MetricsData {
  averageAQI: number;
  maxAQI: number;
  minAQI: number;
  affectedPopulation?: number;
  dominantPollutant?: string;
  trend?: 'improving' | 'worsening' | 'stable';
}

// =============================================================================
// LAYER CONTROLS PANEL
// =============================================================================

interface LayerControlsProps {
  layers: LayerSettings;
  onLayerChange: (layer: keyof LayerSettings, enabled: boolean) => void;
  className?: string;
}

export function LayerControls({ layers, onLayerChange, className = '' }: LayerControlsProps) {
  const [collapsed, setCollapsed] = useState(false);

  const layerOptions: Array<{ key: keyof LayerSettings; label: string; icon: string }> = [
    { key: 'terrain', label: 'Terrain', icon: '🏔️' },
    { key: 'aqiOverlay', label: 'AQI Overlay', icon: '🌈' },
    { key: 'pollutionClouds', label: 'Pollution Clouds', icon: '☁️' },
    { key: 'cityMarkers', label: 'City Markers', icon: '📍' },
    { key: 'windField', label: 'Wind Field', icon: '💨' },
    { key: 'labels', label: 'Labels', icon: '🏷️' },
    { key: 'contours', label: 'Contour Lines', icon: '〰️' },
  ];

  return (
    <div className={`bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-xl border border-gray-700 ${className}`}>
      {/* Header */}
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <span className="font-semibold text-white text-sm">Layers</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Layer toggles */}
      {!collapsed && (
        <div className="p-3 pt-0 space-y-2">
          {layerOptions.map(({ key, label, icon }) => (
            <label
              key={key}
              className="flex items-center gap-2 cursor-pointer hover:bg-gray-800/30 p-1 rounded"
            >
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={(e) => onLayerChange(key, e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500 focus:ring-offset-gray-900"
              />
              <span className="text-sm">{icon}</span>
              <span className="text-gray-300 text-sm">{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// TIME CONTROLS PANEL
// =============================================================================

interface TimeControlsProps {
  settings: TimeSettings;
  onTimeChange: (time: Date) => void;
  onPlayPause: () => void;
  onSpeedChange: (speed: number) => void;
  className?: string;
}

export function TimeControls({
  settings,
  onTimeChange,
  onPlayPause,
  onSpeedChange,
  className = '',
}: TimeControlsProps) {
  const { currentTime, playing, playbackSpeed, timeRange } = settings;

  const formatTime = (date: Date) => {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTimeProgress = () => {
    const total = timeRange.end.getTime() - timeRange.start.getTime();
    const current = currentTime.getTime() - timeRange.start.getTime();
    return (current / total) * 100;
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const progress = parseFloat(e.target.value);
    const total = timeRange.end.getTime() - timeRange.start.getTime();
    const newTime = new Date(timeRange.start.getTime() + (progress / 100) * total);
    onTimeChange(newTime);
  };

  return (
    <div className={`bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-xl border border-gray-700 p-3 ${className}`}>
      {/* Time display */}
      <div className="text-center mb-3">
        <div className="text-white font-mono text-lg">{formatTime(currentTime)}</div>
      </div>

      {/* Timeline slider */}
      <div className="mb-3">
        <input
          type="range"
          min="0"
          max="100"
          value={getTimeProgress()}
          onChange={handleSliderChange}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>{formatTime(timeRange.start)}</span>
          <span>{formatTime(timeRange.end)}</span>
        </div>
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-center gap-4">
        {/* Play/Pause button */}
        <button
          onClick={onPlayPause}
          className="p-2 rounded-full bg-green-600 hover:bg-green-500 transition-colors"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Speed selector */}
        <div className="flex items-center gap-1">
          {[1, 2, 4].map((speed) => (
            <button
              key={speed}
              onClick={() => onSpeedChange(speed)}
              className={`px-2 py-1 text-xs rounded ${
                playbackSpeed === speed
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              } transition-colors`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// METRICS PANEL
// =============================================================================

interface MetricsPanelProps {
  metrics: MetricsData;
  className?: string;
}

export function MetricsPanel({ metrics, className = '' }: MetricsPanelProps) {
  const getTrendIcon = () => {
    switch (metrics.trend) {
      case 'improving':
        return <span className="text-green-400">↓</span>;
      case 'worsening':
        return <span className="text-red-400">↑</span>;
      default:
        return <span className="text-gray-400">→</span>;
    }
  };

  const getAQIStatusColor = (aqi: number) => {
    if (aqi <= 50) return 'text-green-400';
    if (aqi <= 100) return 'text-yellow-400';
    if (aqi <= 150) return 'text-orange-400';
    if (aqi <= 200) return 'text-red-400';
    if (aqi <= 300) return 'text-purple-400';
    return 'text-rose-700';
  };

  return (
    <div className={`bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-xl border border-gray-700 p-4 ${className}`}>
      <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
        <span>📊</span>
        Region Metrics
      </h3>

      <div className="space-y-3">
        {/* Average AQI */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Average AQI</span>
          <div className="flex items-center gap-2">
            <span className={`font-bold text-lg ${getAQIStatusColor(metrics.averageAQI)}`}>
              {Math.round(metrics.averageAQI)}
            </span>
            {getTrendIcon()}
          </div>
        </div>

        {/* Max AQI */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Peak AQI</span>
          <span className={`font-semibold ${getAQIStatusColor(metrics.maxAQI)}`}>
            {Math.round(metrics.maxAQI)}
          </span>
        </div>

        {/* Min AQI */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Best AQI</span>
          <span className={`font-semibold ${getAQIStatusColor(metrics.minAQI)}`}>
            {Math.round(metrics.minAQI)}
          </span>
        </div>

        {/* Dominant Pollutant */}
        {metrics.dominantPollutant && (
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Main Pollutant</span>
            <span className="text-white font-medium">{metrics.dominantPollutant}</span>
          </div>
        )}

        {/* Affected Population */}
        {metrics.affectedPopulation !== undefined && (
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Affected Pop.</span>
            <span className="text-white font-medium">
              {(metrics.affectedPopulation / 1000000).toFixed(1)}M
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// AQI LEGEND
// =============================================================================

interface AQILegendProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function AQILegend({ orientation = 'vertical', className = '' }: AQILegendProps) {
  const legendItems = generateAQILegendItems();
  const gradientCSS = createAQILegendGradient(orientation === 'horizontal' ? 'to right' : 'to top');

  if (orientation === 'horizontal') {
    return (
      <div className={`bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-xl border border-gray-700 p-3 ${className}`}>
        {/* Gradient bar */}
        <div
          className="h-4 rounded mb-2"
          style={{ background: gradientCSS }}
        />
        
        {/* Labels */}
        <div className="flex justify-between text-xs text-gray-300">
          <span>0</span>
          <span>50</span>
          <span>100</span>
          <span>150</span>
          <span>200</span>
          <span>300</span>
          <span>500</span>
        </div>
        <div className="text-center text-xs text-gray-500 mt-1">Air Quality Index</div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-xl border border-gray-700 p-3 ${className}`}>
      <div className="text-xs text-gray-400 mb-2 text-center">AQI Scale</div>
      
      <div className="flex gap-2">
        {/* Gradient bar */}
        <div
          className="w-4 rounded"
          style={{ background: gradientCSS, minHeight: '120px' }}
        />
        
        {/* Labels */}
        <div className="flex flex-col justify-between text-xs text-gray-300">
          <span>500</span>
          <span>300</span>
          <span>200</span>
          <span>150</span>
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
      </div>

      {/* Category labels */}
      <div className="mt-3 space-y-1">
        {legendItems.slice().reverse().map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-xs text-gray-400 truncate" title={item.description}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// CAMERA CONTROLS INFO
// =============================================================================

interface CameraControlsInfoProps {
  className?: string;
}

export function CameraControlsInfo({ className = '' }: CameraControlsInfoProps) {
  return (
    <div className={`bg-gray-900/80 backdrop-blur-sm rounded-lg border border-gray-700 px-3 py-2 ${className}`}>
      <div className="flex gap-4 text-xs text-gray-400">
        <span>🖱️ Drag: Rotate</span>
        <span>⚲ Scroll: Zoom</span>
        <span>⇧+Drag: Pan</span>
      </div>
    </div>
  );
}

// Types are already exported above via interface declarations
