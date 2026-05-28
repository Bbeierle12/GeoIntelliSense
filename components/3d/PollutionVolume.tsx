/**
 * PollutionVolume - Volumetric pollution cloud visualization
 * Uses custom shaders for semi-transparent volumetric rendering
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  SAN_JOAQUIN_BOUNDS,
  WORLD_SCALE,
  latLngToWorld,
} from '../../utils/geo3d';
import {
  getInterpolatedAQIColor,
  hexToRgb,
} from '../../utils/colorScales';
import { generateInterpolatedGrid, DataPoint, GridPoint } from '../../utils/interpolation';

// =============================================================================
// TYPES
// =============================================================================

export interface PollutionVolumeProps {
  aqiData: DataPoint[];
  maxHeight?: number;
  opacity?: number;
  animationSpeed?: number;
  resolution?: number;
  showWireframe?: boolean;
  pollutantType?: 'aqi' | 'pm25' | 'ozone';
}

// =============================================================================
// VOLUMETRIC SHADER
// =============================================================================

const volumeVertexShader = `
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const volumeFragmentShader = `
  uniform vec3 color;
  uniform float opacity;
  uniform float time;
  uniform float density;
  uniform vec3 cameraPos;
  
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  
  // Simple noise function for volumetric effect
  float hash(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p.zxy, p.yxz + 19.19);
    return fract(p.x * p.y * p.z);
  }
  
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    return mix(
      mix(
        mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x),
        f.y
      ),
      mix(
        mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x),
        f.y
      ),
      f.z
    );
  }
  
  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    
    return value;
  }
  
  void main() {
    // Calculate view direction
    vec3 viewDir = normalize(cameraPos - vWorldPosition);
    
    // Animated noise for volumetric effect
    vec3 noiseCoord = vWorldPosition * 0.1 + vec3(time * 0.05, time * 0.02, time * 0.03);
    float noiseValue = fbm(noiseCoord);
    
    // Edge softening
    float edgeFade = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
    edgeFade *= smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
    
    // Fresnel effect for depth illusion
    float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.0);
    
    // Combine effects
    float alpha = opacity * density * (0.5 + noiseValue * 0.5) * edgeFade;
    alpha *= (0.6 + fresnel * 0.4);
    
    // Final color with subtle color variation
    vec3 finalColor = color * (0.9 + noiseValue * 0.2);
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// =============================================================================
// INDIVIDUAL POLLUTION CLOUD
// =============================================================================

interface PollutionCloudProps {
  position: [number, number, number];
  aqiValue: number;
  size: number;
  height: number;
  opacity: number;
  animationOffset: number;
}

function PollutionCloud({
  position,
  aqiValue,
  size,
  height,
  opacity,
  animationOffset,
}: PollutionCloudProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Get color based on AQI
  const color = useMemo(() => {
    const hexColor = getInterpolatedAQIColor(aqiValue);
    return new THREE.Color(hexColor);
  }, [aqiValue]);

  // Calculate density based on AQI (higher AQI = denser cloud)
  const density = useMemo(() => {
    return Math.min(1.0, aqiValue / 200);
  }, [aqiValue]);

  // Shader uniforms
  const uniforms = useMemo(() => ({
    color: { value: color },
    opacity: { value: opacity },
    time: { value: 0 },
    density: { value: density },
    cameraPos: { value: new THREE.Vector3() },
  }), [color, opacity, density]);

  // Animate
  useFrame(({ clock, camera }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = clock.elapsedTime + animationOffset;
      materialRef.current.uniforms.cameraPos.value.copy(camera.position);
    }
    
    // Subtle floating animation
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.5 + animationOffset) * 0.5;
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={position}
    >
      <boxGeometry args={[size, height, size]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={volumeVertexShader}
        fragmentShader={volumeFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// =============================================================================
// LAYERED POLLUTION VOLUME
// =============================================================================

interface PollutionLayerProps {
  gridPoints: GridPoint[];
  layerHeight: number;
  opacity: number;
  layerIndex: number;
}

function PollutionLayer({ gridPoints, layerHeight, opacity, layerIndex }: PollutionLayerProps) {
  const clouds = useMemo(() => {
    // Filter to significant AQI values and create clouds
    return gridPoints
      .filter(point => point.value > 30)
      .map((point, index) => {
        const { x, z } = latLngToWorld(point.lat, point.lng);
        const cloudHeight = Math.max(2, (point.value / 500) * 15);
        const cloudSize = 8 + (point.value / 500) * 8;
        
        return {
          key: `cloud-${layerIndex}-${index}`,
          position: [x, layerHeight + cloudHeight / 2, z] as [number, number, number],
          aqiValue: point.value,
          size: cloudSize,
          height: cloudHeight,
          animationOffset: index * 0.5,
        };
      });
  }, [gridPoints, layerHeight, layerIndex]);

  return (
    <>
      {clouds.map((cloud) => (
        <PollutionCloud
          key={cloud.key}
          position={cloud.position}
          aqiValue={cloud.aqiValue}
          size={cloud.size}
          height={cloud.height}
          opacity={opacity}
          animationOffset={cloud.animationOffset}
        />
      ))}
    </>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function PollutionVolume({
  aqiData,
  maxHeight = 30,
  opacity = 0.4,
  animationSpeed = 1.0,
  resolution = 12,
  showWireframe = false,
  pollutantType = 'aqi',
}: PollutionVolumeProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Generate interpolated grid from AQI data
  const gridPoints = useMemo(() => {
    if (aqiData.length === 0) return [];
    return generateInterpolatedGrid(
      aqiData,
      SAN_JOAQUIN_BOUNDS,
      resolution,
      'idw',
      { power: 2 }
    );
  }, [aqiData, resolution]);

  // Create multiple layers for depth
  const layers = useMemo(() => {
    const layerCount = 3;
    return Array.from({ length: layerCount }, (_, i) => ({
      height: 5 + (i * maxHeight) / layerCount,
      opacity: opacity * (1 - i * 0.2),
      index: i,
    }));
  }, [maxHeight, opacity]);

  // Animate the entire volume
  useFrame(({ clock }) => {
    if (groupRef.current) {
      // Subtle rotation for dynamic feel
      groupRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.1 * animationSpeed) * 0.02;
    }
  });

  if (aqiData.length === 0) {
    return null;
  }

  return (
    <group ref={groupRef}>
      {layers.map((layer) => (
        <PollutionLayer
          key={`layer-${layer.index}`}
          gridPoints={gridPoints}
          layerHeight={layer.height}
          opacity={layer.opacity}
          layerIndex={layer.index}
        />
      ))}
    </group>
  );
}

export default PollutionVolume;
