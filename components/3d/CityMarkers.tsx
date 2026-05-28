/**
 * CityMarkers - GPU-instanced 3D markers for cities
 * Shows city locations with AQI-colored indicators
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { Text, Billboard, Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  latLngToWorld,
  CITY_ELEVATIONS,
} from '../../utils/geo3d';
import { getAQIColor, getAQICategory, AQI_CATEGORIES } from '../../utils/colorScales';

// =============================================================================
// TYPES
// =============================================================================

export interface CityData {
  id: string;
  name: string;
  lat: number;
  lng: number;
  aqi: number;
  temperature?: number;
  humidity?: number;
  windSpeed?: number;
  pm25?: number;
}

export interface CityMarkersProps {
  cities: CityData[];
  showLabels?: boolean;
  showTooltips?: boolean;
  markerScale?: number;
  animateMarkers?: boolean;
  onCityClick?: (city: CityData) => void;
  onCityHover?: (city: CityData | null) => void;
  selectedCity?: string | null;
}

// =============================================================================
// INDIVIDUAL CITY MARKER
// =============================================================================

interface CityMarkerProps {
  city: CityData;
  showLabel: boolean;
  showTooltip: boolean;
  scale: number;
  animate: boolean;
  isSelected: boolean;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
}

function CityMarker({
  city,
  showLabel,
  showTooltip,
  scale,
  animate,
  isSelected,
  onClick,
  onHover,
}: CityMarkerProps) {
  const markerRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const pinRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = React.useState(false);

  // Get world position
  const position = useMemo(() => {
    const { x, z } = latLngToWorld(city.lat, city.lng);
    const elevation = CITY_ELEVATIONS[city.name as keyof typeof CITY_ELEVATIONS] || 100;
    const normalizedElevation = (elevation / 500) * 2; // Scale elevation to world units
    return new THREE.Vector3(x, normalizedElevation, z);
  }, [city.lat, city.lng, city.name]);

  // Get color based on AQI
  const color = useMemo(() => new THREE.Color(getAQIColor(city.aqi)), [city.aqi]);
  
  // Calculate marker height based on AQI
  const markerHeight = useMemo(() => {
    return 3 + (city.aqi / 500) * 10;
  }, [city.aqi]);

  // Handle pointer events
  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    onHover(true);
    document.body.style.cursor = 'pointer';
  };

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
    onHover(false);
    document.body.style.cursor = 'default';
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick();
  };

  // Animation
  useFrame(({ clock }) => {
    if (!animate || !markerRef.current) return;

    // Pulsing glow effect
    if (glowRef.current) {
      const pulse = Math.sin(clock.elapsedTime * 2 + city.aqi * 0.01) * 0.3 + 0.7;
      glowRef.current.scale.setScalar(pulse * (hovered || isSelected ? 1.5 : 1));
    }

    // Slight floating motion for selected marker
    if (isSelected && pinRef.current) {
      pinRef.current.position.y = markerHeight + Math.sin(clock.elapsedTime * 3) * 0.3;
    }
  });

  const category = getAQICategory(city.aqi);
  const categoryInfo = AQI_CATEGORIES[category];

  return (
    <group
      ref={markerRef}
      position={position}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      {/* Base circle on ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <circleGeometry args={[2 * scale, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.3}
        />
      </mesh>

      {/* Vertical column/pillar representing AQI level */}
      <mesh ref={pinRef} position={[0, markerHeight / 2, 0]}>
        <cylinderGeometry args={[0.8 * scale, 1.2 * scale, markerHeight, 16]} />
        <meshStandardMaterial
          color={color}
          metalness={0.3}
          roughness={0.6}
          emissive={color}
          emissiveIntensity={hovered || isSelected ? 0.5 : 0.2}
        />
      </mesh>

      {/* Top sphere */}
      <mesh position={[0, markerHeight + 1, 0]}>
        <sphereGeometry args={[1.5 * scale, 16, 16]} />
        <meshStandardMaterial
          color={color}
          metalness={0.5}
          roughness={0.3}
          emissive={color}
          emissiveIntensity={hovered || isSelected ? 0.8 : 0.4}
        />
      </mesh>

      {/* Glow effect */}
      <mesh ref={glowRef} position={[0, markerHeight + 1, 0]}>
        <sphereGeometry args={[2.5 * scale, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.2}
          depthWrite={false}
        />
      </mesh>

      {/* City label */}
      {showLabel && (
        <Billboard
          follow
          lockX={false}
          lockY={false}
          lockZ={false}
          position={[0, markerHeight + 5, 0]}
        >
          <Text
            fontSize={2.5}
            color="white"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.1}
            outlineColor="black"
          >
            {city.name}
          </Text>
          <Text
            fontSize={1.8}
            color={color}
            anchorX="center"
            anchorY="middle"
            position={[0, -2.5, 0]}
            outlineWidth={0.08}
            outlineColor="black"
          >
            AQI: {city.aqi}
          </Text>
        </Billboard>
      )}

      {/* Tooltip on hover */}
      {showTooltip && hovered && (
        <Html
          position={[0, markerHeight + 10, 0]}
          center
          distanceFactor={50}
          style={{
            pointerEvents: 'none',
          }}
        >
          <div className="bg-gray-900/95 backdrop-blur-sm rounded-lg p-3 shadow-xl border border-gray-700 min-w-[180px]">
            <div className="font-bold text-white text-sm mb-2">{city.name}</div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">AQI:</span>
                <span style={{ color: getAQIColor(city.aqi) }} className="font-semibold">
                  {city.aqi}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Status:</span>
                <span style={{ color: categoryInfo.color }} className="font-semibold">
                  {categoryInfo.label}
                </span>
              </div>
              {city.pm25 !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-400">PM2.5:</span>
                  <span className="text-white">{city.pm25} µg/m³</span>
                </div>
              )}
              {city.temperature !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Temp:</span>
                  <span className="text-white">{city.temperature}°F</span>
                </div>
              )}
              {city.windSpeed !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Wind:</span>
                  <span className="text-white">{city.windSpeed} mph</span>
                </div>
              )}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function CityMarkers({
  cities,
  showLabels = true,
  showTooltips = true,
  markerScale = 1,
  animateMarkers = true,
  onCityClick,
  onCityHover,
  selectedCity = null,
}: CityMarkersProps) {
  return (
    <group>
      {cities.map((city) => (
        <CityMarker
          key={city.id}
          city={city}
          showLabel={showLabels}
          showTooltip={showTooltips}
          scale={markerScale}
          animate={animateMarkers}
          isSelected={selectedCity === city.id}
          onClick={() => onCityClick?.(city)}
          onHover={(hovered) => onCityHover?.(hovered ? city : null)}
        />
      ))}
    </group>
  );
}

export default CityMarkers;
