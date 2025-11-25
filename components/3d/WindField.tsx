/**
 * WindField - Animated particle streamlines for wind visualization
 * Shows wind direction and speed using flowing particles
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  SAN_JOAQUIN_BOUNDS,
  WORLD_SCALE,
  latLngToWorld,
} from '../../utils/geo3d';

// =============================================================================
// TYPES
// =============================================================================

export interface WindData {
  lat: number;
  lng: number;
  speed: number; // mph or m/s
  direction: number; // degrees from north (0-360)
}

export interface WindFieldProps {
  windData: WindData[];
  particleCount?: number;
  particleSize?: number;
  particleSpeed?: number;
  particleColor?: string;
  trailLength?: number;
  opacity?: number;
  height?: number;
  showArrows?: boolean;
}

// =============================================================================
// WIND ARROW COMPONENT
// =============================================================================

interface WindArrowProps {
  position: THREE.Vector3;
  direction: number;
  speed: number;
  color: string;
}

function WindArrow({ position, direction, speed, color }: WindArrowProps) {
  const arrowRef = useRef<THREE.Group>(null);

  // Convert direction to radians (0 degrees = north = negative Z)
  const rotationY = useMemo(() => {
    return -(direction * Math.PI) / 180 + Math.PI;
  }, [direction]);

  // Scale arrow based on wind speed
  const scale = useMemo(() => {
    return 0.5 + (speed / 30) * 1.5; // Normalize for typical wind speeds
  }, [speed]);

  // Subtle animation
  useFrame(({ clock }) => {
    if (arrowRef.current) {
      const pulse = Math.sin(clock.elapsedTime * 2) * 0.1 + 1;
      arrowRef.current.scale.setScalar(scale * pulse);
    }
  });

  return (
    <group ref={arrowRef} position={position} rotation={[0, rotationY, 0]}>
      {/* Arrow shaft */}
      <mesh position={[0, 0, 1]}>
        <boxGeometry args={[0.3, 0.3, 2]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.7}
          emissive={color}
          emissiveIntensity={0.2}
        />
      </mesh>

      {/* Arrow head */}
      <mesh position={[0, 0, 2.5]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.6, 1, 8]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.8}
          emissive={color}
          emissiveIntensity={0.3}
        />
      </mesh>
    </group>
  );
}

// =============================================================================
// PARTICLE SYSTEM SHADER
// =============================================================================

const particleVertexShader = `
  attribute float aSize;
  attribute float aLife;
  attribute vec3 aVelocity;
  
  uniform float time;
  uniform float particleSize;
  
  varying float vLife;
  varying float vSpeed;
  
  void main() {
    vLife = aLife;
    vSpeed = length(aVelocity);
    
    // Animate position along velocity direction
    vec3 animated = position + aVelocity * mod(time + aLife * 10.0, 5.0);
    
    vec4 mvPosition = modelViewMatrix * vec4(animated, 1.0);
    gl_PointSize = particleSize * aSize * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragmentShader = `
  uniform vec3 color;
  uniform float opacity;
  
  varying float vLife;
  varying float vSpeed;
  
  void main() {
    // Circular particle shape
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;
    
    // Soft edges
    float alpha = smoothstep(0.5, 0.2, dist);
    
    // Fade based on life
    alpha *= smoothstep(0.0, 0.2, vLife) * smoothstep(1.0, 0.8, vLife);
    
    // Brighter for faster wind
    vec3 finalColor = color * (0.8 + vSpeed * 0.4);
    
    gl_FragColor = vec4(finalColor, alpha * opacity);
  }
`;

// =============================================================================
// PARTICLE SYSTEM COMPONENT
// =============================================================================

interface WindParticleSystemProps {
  windData: WindData[];
  count: number;
  size: number;
  speed: number;
  color: string;
  opacity: number;
  height: number;
}

function WindParticleSystem({
  windData,
  count,
  size,
  speed,
  color,
  opacity,
  height,
}: WindParticleSystemProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Generate particle attributes
  const { positions, sizes, lives, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const lives = new Float32Array(count);
    const velocities = new Float32Array(count * 3);

    const halfSize = WORLD_SCALE / 2;

    for (let i = 0; i < count; i++) {
      // Random position within bounds
      const x = (Math.random() - 0.5) * WORLD_SCALE;
      const y = height + Math.random() * 10;
      const z = (Math.random() - 0.5) * WORLD_SCALE;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Find nearest wind data point
      let nearestWind: WindData | null = null;
      let nearestDist = Infinity;

      for (const wind of windData) {
        const { x: wx, z: wz } = latLngToWorld(wind.lat, wind.lng);
        const dist = Math.sqrt(Math.pow(x - wx, 2) + Math.pow(z - wz, 2));
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestWind = wind;
        }
      }

      // Set velocity based on wind direction
      if (nearestWind) {
        const dirRad = (nearestWind.direction * Math.PI) / 180;
        const windSpeed = nearestWind.speed * speed * 0.1;
        
        velocities[i * 3] = Math.sin(dirRad) * windSpeed;
        velocities[i * 3 + 1] = 0;
        velocities[i * 3 + 2] = -Math.cos(dirRad) * windSpeed;
      } else {
        // Default wind direction
        velocities[i * 3] = speed * 0.5;
        velocities[i * 3 + 1] = 0;
        velocities[i * 3 + 2] = 0;
      }

      sizes[i] = 0.5 + Math.random() * 1.5;
      lives[i] = Math.random();
    }

    return { positions, sizes, lives, velocities };
  }, [windData, count, speed, height]);

  // Shader uniforms
  const uniforms = useMemo(() => ({
    time: { value: 0 },
    particleSize: { value: size },
    color: { value: new THREE.Color(color) },
    opacity: { value: opacity },
  }), [size, color, opacity]);

  // Animation
  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = clock.elapsedTime;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-aSize"
          count={count}
          array={sizes}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-aLife"
          count={count}
          array={lives}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-aVelocity"
          count={count}
          array={velocities}
          itemSize={3}
        />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={particleVertexShader}
        fragmentShader={particleFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// =============================================================================
// STREAMLINE COMPONENT
// =============================================================================

interface StreamlineProps {
  startPosition: THREE.Vector3;
  direction: number;
  speed: number;
  color: string;
  length: number;
}

function Streamline({ startPosition, direction, speed, color, length }: StreamlineProps) {
  const lineRef = useRef<THREE.Line>(null);
  const progressRef = useRef(0);

  // Calculate end position based on direction
  const points = useMemo(() => {
    const dirRad = (direction * Math.PI) / 180;
    const segmentLength = length / 20;
    
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      // Add some curvature for more natural look
      const curve = Math.sin(t * Math.PI) * 2;
      pts.push(new THREE.Vector3(
        startPosition.x + Math.sin(dirRad) * t * length + curve * Math.cos(dirRad),
        startPosition.y + Math.sin(t * Math.PI * 2) * 0.5,
        startPosition.z - Math.cos(dirRad) * t * length + curve * Math.sin(dirRad)
      ));
    }
    return pts;
  }, [startPosition, direction, length]);

  const geometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [points]);

  // Animate opacity along line
  useFrame(({ clock }) => {
    if (lineRef.current) {
      progressRef.current = (clock.elapsedTime * speed * 0.2) % 1;
    }
  });

  return (
    <primitive object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 }))} />
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function WindField({
  windData,
  particleCount = 500,
  particleSize = 15,
  particleSpeed = 1,
  particleColor = '#87CEEB',
  trailLength = 15,
  opacity = 0.6,
  height = 15,
  showArrows = true,
}: WindFieldProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Convert wind data to 3D positions
  const windPositions = useMemo(() => {
    return windData.map((wind) => {
      const { x, z } = latLngToWorld(wind.lat, wind.lng);
      return {
        ...wind,
        position: new THREE.Vector3(x, height, z),
      };
    });
  }, [windData, height]);

  // Generate streamlines between wind points
  const streamlines = useMemo(() => {
    return windPositions.map((wind, i) => ({
      key: `streamline-${i}`,
      startPosition: wind.position,
      direction: wind.direction,
      speed: wind.speed,
      length: trailLength,
    }));
  }, [windPositions, trailLength]);

  if (windData.length === 0) {
    return null;
  }

  return (
    <group ref={groupRef}>
      {/* Particle system */}
      <WindParticleSystem
        windData={windData}
        count={particleCount}
        size={particleSize}
        speed={particleSpeed}
        color={particleColor}
        opacity={opacity}
        height={height}
      />

      {/* Wind arrows at data points */}
      {showArrows && windPositions.map((wind, i) => (
        <WindArrow
          key={`arrow-${i}`}
          position={wind.position}
          direction={wind.direction}
          speed={wind.speed}
          color={particleColor}
        />
      ))}

      {/* Streamlines */}
      {streamlines.map((line) => (
        <Streamline
          key={line.key}
          startPosition={line.startPosition}
          direction={line.direction}
          speed={line.speed}
          color={particleColor}
          length={line.length}
        />
      ))}
    </group>
  );
}

export default WindField;
