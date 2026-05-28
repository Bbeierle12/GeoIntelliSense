/**
 * CrossSectionView - Vertical slice visualization of pollution distribution
 * Shows altitude-based pollution density along a user-defined transect line
 */

import React, { useMemo, useRef, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { DataPoint } from '../../utils/interpolation';
import { getAQIColor } from '../../utils/colorScales';

// =============================================================================
// TYPES
// =============================================================================

export interface TransectLine {
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
}

export interface CrossSectionProps {
  dataPoints: DataPoint[];
  transect: TransectLine;
  maxAltitude?: number; // meters
  resolution?: number; // number of horizontal samples
  verticalLayers?: number; // number of vertical layers
  showGrid?: boolean;
  showLabels?: boolean;
  animated?: boolean;
  className?: string;
}

interface CrossSectionSlice {
  distance: number; // distance along transect (0-1)
  groundLevel: number;
  layers: Array<{
    altitude: number;
    aqi: number;
    color: string;
  }>;
}

// =============================================================================
// HELPERS
// =============================================================================

// Haversine distance between two coordinates
function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// IDW interpolation at a point
function interpolateAQI(
  lat: number,
  lng: number,
  dataPoints: DataPoint[],
  power: number = 2
): number {
  let weightSum = 0;
  let valueSum = 0;
  
  for (const point of dataPoints) {
    const dist = haversineDistance(lat, lng, point.lat, point.lng);
    if (dist < 0.001) return point.value; // Very close to a data point
    
    const weight = 1 / Math.pow(dist, power);
    weightSum += weight;
    valueSum += weight * point.value;
  }
  
  return weightSum > 0 ? valueSum / weightSum : 0;
}

// Altitude decay factor - pollution decreases with altitude
function altitudeDecay(altitude: number, groundAQI: number): number {
  // Exponential decay with height, mixing layer ~500m
  const mixingHeight = 500; // meters
  const decayFactor = Math.exp(-altitude / mixingHeight);
  
  // Temperature inversion effect - can trap pollution
  const inversionHeight = 800;
  const inversionFactor = altitude > inversionHeight 
    ? 0.1 
    : 1 - 0.3 * (altitude / inversionHeight);
  
  return groundAQI * decayFactor * inversionFactor;
}

// Simulate terrain elevation (simplified)
function getTerrainElevation(lat: number, lng: number): number {
  // San Joaquin Valley terrain simulation
  // Valley floor ~100m, hills on edges ~300-600m
  const centerLat = 36.5;
  const centerLng = -120.0;
  const distFromCenter = Math.abs(lat - centerLat) + Math.abs(lng - centerLng) * 0.7;
  
  // Valley bowl shape
  const baseElevation = 100;
  const edgeRise = Math.min(500, distFromCenter * 200);
  
  // Add some noise for realism
  const noise = Math.sin(lat * 100) * Math.cos(lng * 100) * 50;
  
  return baseElevation + edgeRise + noise;
}

// =============================================================================
// 3D COMPONENTS
// =============================================================================

interface SliceMeshProps {
  slices: CrossSectionSlice[];
  totalDistance: number;
  maxAltitude: number;
  animated: boolean;
}

function SliceMesh({ slices, totalDistance, maxAltitude, animated }: SliceMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  
  // Create geometry from slices
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    
    const width = 10; // 3D world units
    const height = 5; // 3D world units
    
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i];
      const x = (slice.distance / totalDistance) * width - width / 2;
      const groundY = (slice.groundLevel / maxAltitude) * height * 0.2;
      
      for (let j = 0; j < slice.layers.length; j++) {
        const layer = slice.layers[j];
        const y = groundY + (layer.altitude / maxAltitude) * height;
        
        // Add vertex
        positions.push(x, y, 0);
        
        // Parse color
        const color = new THREE.Color(layer.color);
        colors.push(color.r, color.g, color.b);
      }
    }
    
    // Create faces
    const layerCount = slices[0]?.layers.length || 1;
    for (let i = 0; i < slices.length - 1; i++) {
      for (let j = 0; j < layerCount - 1; j++) {
        const a = i * layerCount + j;
        const b = (i + 1) * layerCount + j;
        const c = (i + 1) * layerCount + j + 1;
        const d = i * layerCount + j + 1;
        
        indices.push(a, b, c);
        indices.push(a, c, d);
      }
    }
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    
    return geo;
  }, [slices, totalDistance, maxAltitude]);
  
  // Animation
  useFrame((state) => {
    if (materialRef.current && animated) {
      materialRef.current.uniforms.time.value = state.clock.elapsedTime;
    }
  });
  
  const shader = useMemo(() => ({
    uniforms: {
      time: { value: 0 },
      opacity: { value: 0.85 },
    },
    vertexShader: `
      attribute vec3 color;
      varying vec3 vColor;
      varying vec2 vUv;
      void main() {
        vColor = color;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float opacity;
      varying vec3 vColor;
      varying vec2 vUv;
      void main() {
        float shimmer = 0.95 + 0.05 * sin(time * 2.0 + vUv.y * 10.0);
        gl_FragColor = vec4(vColor * shimmer, opacity);
      }
    `,
  }), []);
  
  return (
    <mesh ref={meshRef} geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        {...shader}
        transparent
        side={THREE.DoubleSide}
        vertexColors
      />
    </mesh>
  );
}

interface GridOverlayProps {
  width: number;
  height: number;
  horizontalDivisions: number;
  verticalDivisions: number;
  maxAltitude: number;
  totalDistance: number;
}

function GridOverlay({ 
  width, 
  height, 
  horizontalDivisions, 
  verticalDivisions,
  maxAltitude,
  totalDistance 
}: GridOverlayProps) {
  const points = useMemo(() => {
    const lines: [THREE.Vector3, THREE.Vector3][] = [];
    const halfWidth = width / 2;
    
    // Vertical lines
    for (let i = 0; i <= horizontalDivisions; i++) {
      const x = (i / horizontalDivisions) * width - halfWidth;
      lines.push([
        new THREE.Vector3(x, 0, 0.01),
        new THREE.Vector3(x, height, 0.01)
      ]);
    }
    
    // Horizontal lines
    for (let i = 0; i <= verticalDivisions; i++) {
      const y = (i / verticalDivisions) * height;
      lines.push([
        new THREE.Vector3(-halfWidth, y, 0.01),
        new THREE.Vector3(halfWidth, y, 0.01)
      ]);
    }
    
    return lines;
  }, [width, height, horizontalDivisions, verticalDivisions]);
  
  return (
    <group>
      {points.map((line, i) => (
        <Line
          key={i}
          points={line}
          color="#ffffff"
          lineWidth={0.5}
          opacity={0.2}
          transparent
        />
      ))}
      
      {/* Altitude labels */}
      {Array.from({ length: verticalDivisions + 1 }, (_, i) => {
        const altitude = Math.round((i / verticalDivisions) * maxAltitude);
        const y = (i / verticalDivisions) * height;
        return (
          <Text
            key={`alt-${i}`}
            position={[-width / 2 - 0.3, y, 0]}
            fontSize={0.2}
            color="#9ca3af"
            anchorX="right"
          >
            {altitude}m
          </Text>
        );
      })}
      
      {/* Distance labels */}
      {Array.from({ length: horizontalDivisions + 1 }, (_, i) => {
        const distance = ((i / horizontalDivisions) * totalDistance).toFixed(1);
        const x = (i / horizontalDivisions) * width - width / 2;
        return (
          <Text
            key={`dist-${i}`}
            position={[x, -0.3, 0]}
            fontSize={0.18}
            color="#9ca3af"
            anchorX="center"
          >
            {distance}km
          </Text>
        );
      })}
    </group>
  );
}

interface AQILegendProps {
  position: [number, number, number];
}

function AQILegend({ position }: AQILegendProps) {
  const levels = [
    { range: '0-50', label: 'Good', color: '#22c55e' },
    { range: '51-100', label: 'Moderate', color: '#facc15' },
    { range: '101-150', label: 'Unhealthy (Sensitive)', color: '#fb923c' },
    { range: '151-200', label: 'Unhealthy', color: '#ef4444' },
    { range: '201-300', label: 'Very Unhealthy', color: '#a855f7' },
    { range: '301+', label: 'Hazardous', color: '#881337' },
  ];
  
  return (
    <Html position={position} style={{ pointerEvents: 'none' }}>
      <div className="bg-gray-900/90 backdrop-blur-sm rounded-lg p-3 border border-gray-700 text-xs min-w-[140px]">
        <div className="text-gray-400 font-medium mb-2">AQI Scale</div>
        {levels.map((level, i) => (
          <div key={i} className="flex items-center gap-2 mb-1">
            <div 
              className="w-3 h-3 rounded-sm" 
              style={{ backgroundColor: level.color }}
            />
            <span className="text-gray-300">{level.range}</span>
          </div>
        ))}
      </div>
    </Html>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function CrossSectionScene({ 
  slices, 
  totalDistance, 
  maxAltitude,
  showGrid,
  showLabels,
  animated 
}: {
  slices: CrossSectionSlice[];
  totalDistance: number;
  maxAltitude: number;
  showGrid: boolean;
  showLabels: boolean;
  animated: boolean;
}) {
  const { camera } = useThree();
  
  // Set up orthographic-like view
  React.useEffect(() => {
    camera.position.set(0, 2.5, 8);
    camera.lookAt(0, 2.5, 0);
  }, [camera]);
  
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.4} />
      
      {/* Background plane */}
      <mesh position={[0, 2.5, -0.5]}>
        <planeGeometry args={[12, 6]} />
        <meshBasicMaterial color="#0f172a" />
      </mesh>
      
      {/* Cross-section visualization */}
      <SliceMesh 
        slices={slices}
        totalDistance={totalDistance}
        maxAltitude={maxAltitude}
        animated={animated}
      />
      
      {/* Grid overlay */}
      {showGrid && (
        <GridOverlay
          width={10}
          height={5}
          horizontalDivisions={10}
          verticalDivisions={5}
          maxAltitude={maxAltitude}
          totalDistance={totalDistance}
        />
      )}
      
      {/* Labels */}
      {showLabels && (
        <>
          <Text
            position={[0, -0.6, 0]}
            fontSize={0.25}
            color="#9ca3af"
            anchorX="center"
          >
            Distance Along Transect
          </Text>
          <Text
            position={[-5.8, 2.5, 0]}
            fontSize={0.25}
            color="#9ca3af"
            rotation={[0, 0, Math.PI / 2]}
          >
            Altitude
          </Text>
          <AQILegend position={[6, 3, 0]} />
        </>
      )}
    </>
  );
}

export function CrossSectionView({
  dataPoints,
  transect,
  maxAltitude = 2000,
  resolution = 50,
  verticalLayers = 20,
  showGrid = true,
  showLabels = true,
  animated = true,
  className = '',
}: CrossSectionProps) {
  // Calculate total transect distance
  const totalDistance = useMemo(() => {
    return haversineDistance(
      transect.start.lat, transect.start.lng,
      transect.end.lat, transect.end.lng
    );
  }, [transect]);
  
  // Generate cross-section slices
  const slices: CrossSectionSlice[] = useMemo(() => {
    const result: CrossSectionSlice[] = [];
    
    for (let i = 0; i <= resolution; i++) {
      const t = i / resolution;
      
      // Interpolate position along transect
      const lat = transect.start.lat + t * (transect.end.lat - transect.start.lat);
      const lng = transect.start.lng + t * (transect.end.lng - transect.start.lng);
      
      // Get ground-level AQI at this point
      const groundAQI = interpolateAQI(lat, lng, dataPoints);
      
      // Get terrain elevation
      const groundLevel = getTerrainElevation(lat, lng);
      
      // Generate vertical layers
      const layers = [];
      for (let j = 0; j < verticalLayers; j++) {
        const altitude = (j / (verticalLayers - 1)) * maxAltitude;
        const aqi = altitudeDecay(altitude, groundAQI);
        
        layers.push({
          altitude,
          aqi,
          color: getAQIColor(aqi),
        });
      }
      
      result.push({
        distance: t * totalDistance,
        groundLevel,
        layers,
      });
    }
    
    return result;
  }, [dataPoints, transect, resolution, verticalLayers, maxAltitude, totalDistance]);
  
  // Stats for display
  const stats = useMemo(() => {
    if (slices.length === 0) return { maxAQI: 0, avgGroundAQI: 0 };
    
    const groundAQIs = slices.map(s => s.layers[0]?.aqi || 0);
    const maxAQI = Math.max(...groundAQIs);
    const avgGroundAQI = groundAQIs.reduce((a, b) => a + b, 0) / groundAQIs.length;
    
    return { maxAQI, avgGroundAQI };
  }, [slices]);
  
  return (
    <div className={`relative ${className}`}>
      {/* Header */}
      <div className="absolute top-2 left-2 z-10 bg-gray-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-gray-700">
        <div className="text-sm font-medium text-white">Vertical Cross-Section</div>
        <div className="text-xs text-gray-400 mt-1">
          {transect.start.lat.toFixed(2)}°N, {transect.start.lng.toFixed(2)}°W →{' '}
          {transect.end.lat.toFixed(2)}°N, {transect.end.lng.toFixed(2)}°W
        </div>
        <div className="text-xs text-gray-400">
          Distance: {totalDistance.toFixed(1)} km • Max Altitude: {maxAltitude}m
        </div>
      </div>
      
      {/* Stats */}
      <div className="absolute top-2 right-2 z-10 bg-gray-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-gray-700">
        <div className="text-xs text-gray-400">Peak Ground AQI</div>
        <div className="text-lg font-bold" style={{ color: getAQIColor(stats.maxAQI) }}>
          {Math.round(stats.maxAQI)}
        </div>
        <div className="text-xs text-gray-400 mt-1">Avg Ground AQI</div>
        <div className="text-sm font-medium" style={{ color: getAQIColor(stats.avgGroundAQI) }}>
          {Math.round(stats.avgGroundAQI)}
        </div>
      </div>
      
      {/* 3D Canvas */}
      <Canvas
        camera={{ fov: 45, near: 0.1, far: 100 }}
        style={{ background: '#0f172a' }}
      >
        <CrossSectionScene
          slices={slices}
          totalDistance={totalDistance}
          maxAltitude={maxAltitude}
          showGrid={showGrid}
          showLabels={showLabels}
          animated={animated}
        />
      </Canvas>
    </div>
  );
}

export default CrossSectionView;
