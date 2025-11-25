/**
 * TerrainMesh - Ground plane with heightmap for San Joaquin Valley
 * Creates a realistic terrain base for the 3D visualization
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  generateTerrainGeometry,
  SAN_JOAQUIN_BOUNDS,
  WORLD_SCALE,
  latLngToWorld,
} from '../../utils/geo3d';
import {
  createDataTexture,
  AQI_GRADIENT_STOPS,
  hexToRgb,
} from '../../utils/colorScales';
import { generateInterpolatedMatrix, DataPoint } from '../../utils/interpolation';

// =============================================================================
// TYPES
// =============================================================================

export interface TerrainMeshProps {
  aqiData?: DataPoint[];
  showAQIOverlay?: boolean;
  overlayOpacity?: number;
  wireframe?: boolean;
  resolution?: number;
  heightScale?: number;
  textureResolution?: number;
  baseColor?: string;
  showContours?: boolean;
}

// =============================================================================
// TERRAIN MATERIAL SHADER
// =============================================================================

const terrainVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vElevation;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    vElevation = position.y;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const terrainFragmentShader = `
  uniform sampler2D aqiTexture;
  uniform float overlayOpacity;
  uniform vec3 baseColor;
  uniform float showOverlay;
  uniform float time;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vElevation;

  void main() {
    // Base terrain color with subtle variation based on elevation
    vec3 terrainColor = baseColor;
    float elevationFactor = smoothstep(-2.0, 5.0, vElevation);
    terrainColor = mix(terrainColor * 0.8, terrainColor * 1.2, elevationFactor);
    
    // Simple lighting
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
    float diffuse = max(dot(vNormal, lightDir), 0.0);
    float ambient = 0.3;
    float light = ambient + diffuse * 0.7;
    
    // Apply AQI overlay if enabled
    vec3 finalColor = terrainColor * light;
    
    if (showOverlay > 0.5) {
      vec4 aqiColor = texture2D(aqiTexture, vUv);
      finalColor = mix(finalColor, aqiColor.rgb, overlayOpacity * aqiColor.a);
    }
    
    // Subtle fog effect at edges
    float fogFactor = smoothstep(0.0, 0.1, min(vUv.x, min(vUv.y, min(1.0 - vUv.x, 1.0 - vUv.y))));
    finalColor *= fogFactor * 0.3 + 0.7;
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function createAQIOverlayTexture(
  aqiData: DataPoint[],
  resolution: number
): THREE.DataTexture {
  if (aqiData.length === 0) {
    // Return transparent texture if no data
    const data = new Uint8Array(resolution * resolution * 4);
    const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }

  // Generate interpolated matrix
  const matrix = generateInterpolatedMatrix(
    aqiData,
    SAN_JOAQUIN_BOUNDS,
    resolution,
    resolution,
    'idw'
  );

  // Convert to colored texture with transparency
  return createDataTexture(matrix, resolution, resolution, AQI_GRADIENT_STOPS, 0, 300);
}

// =============================================================================
// CONTOUR LINES COMPONENT
// =============================================================================

interface ContourLinesProps {
  visible: boolean;
  levels: number[];
  color: string;
}

function ContourLines({ visible, levels, color }: ContourLinesProps) {
  const linesRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    if (!visible) return null;

    // Generate contour geometry
    const group = new THREE.Group();
    const halfSize = WORLD_SCALE / 2;

    levels.forEach((level, index) => {
      const y = level * 0.5; // Scale elevation
      const points = [
        new THREE.Vector3(-halfSize, y, -halfSize),
        new THREE.Vector3(halfSize, y, -halfSize),
        new THREE.Vector3(halfSize, y, halfSize),
        new THREE.Vector3(-halfSize, y, halfSize),
        new THREE.Vector3(-halfSize, y, -halfSize),
      ];

      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.3 + (index % 2) * 0.2,
      });
      
      const line = new THREE.Line(lineGeometry, lineMaterial);
      group.add(line);
    });

    return group;
  }, [visible, levels, color]);

  if (!visible || !geometry) return null;

  return <primitive object={geometry} />;
}

// =============================================================================
// CITY BOUNDARY OUTLINE
// =============================================================================

function RegionBoundary() {
  const lineRef = useRef<THREE.Line>(null);

  const geometry = useMemo(() => {
    // Create boundary outline for San Joaquin Valley
    const corners = [
      { lat: SAN_JOAQUIN_BOUNDS.north, lng: SAN_JOAQUIN_BOUNDS.west },
      { lat: SAN_JOAQUIN_BOUNDS.north, lng: SAN_JOAQUIN_BOUNDS.east },
      { lat: SAN_JOAQUIN_BOUNDS.south, lng: SAN_JOAQUIN_BOUNDS.east },
      { lat: SAN_JOAQUIN_BOUNDS.south, lng: SAN_JOAQUIN_BOUNDS.west },
      { lat: SAN_JOAQUIN_BOUNDS.north, lng: SAN_JOAQUIN_BOUNDS.west }, // Close loop
    ];

    const points = corners.map((corner) => {
      const { x, z } = latLngToWorld(corner.lat, corner.lng);
      return new THREE.Vector3(x, 0.5, z);
    });

    return new THREE.BufferGeometry().setFromPoints(points);
  }, []);

  return (
    <primitive object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#4CAF50', transparent: true, opacity: 0.6 }))} />
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TerrainMesh({
  aqiData = [],
  showAQIOverlay = true,
  overlayOpacity = 0.6,
  wireframe = false,
  resolution = 64,
  heightScale = 1.0,
  textureResolution = 128,
  baseColor = '#3d5c3d',
  showContours = false,
}: TerrainMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Generate terrain geometry
  const geometry = useMemo(() => {
    const geoData = generateTerrainGeometry(resolution);
    
    // Create BufferGeometry
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(geoData.positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(geoData.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(geoData.indices, 1));
    geo.computeVertexNormals();
    
    return geo;
  }, [resolution]);

  // Generate AQI overlay texture
  const aqiTexture = useMemo(() => {
    return createAQIOverlayTexture(aqiData, textureResolution);
  }, [aqiData, textureResolution]);

  // Shader uniforms
  const uniforms = useMemo(() => ({
    aqiTexture: { value: aqiTexture },
    overlayOpacity: { value: overlayOpacity },
    baseColor: { value: new THREE.Color(baseColor) },
    showOverlay: { value: showAQIOverlay ? 1.0 : 0.0 },
    time: { value: 0 },
  }), [aqiTexture, overlayOpacity, baseColor, showAQIOverlay]);

  // Update uniforms when props change
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.aqiTexture.value = aqiTexture;
      materialRef.current.uniforms.overlayOpacity.value = overlayOpacity;
      materialRef.current.uniforms.showOverlay.value = showAQIOverlay ? 1.0 : 0.0;
      materialRef.current.uniforms.baseColor.value = new THREE.Color(baseColor);
    }
  }, [aqiTexture, overlayOpacity, showAQIOverlay, baseColor]);

  // Animate time uniform
  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = clock.elapsedTime;
    }
  });

  // Contour levels (elevation values)
  const contourLevels = useMemo(() => [0, 2, 4, 6, 8], []);

  return (
    <group>
      {/* Main terrain mesh */}
      <mesh
        ref={meshRef}
        geometry={geometry}
        receiveShadow
        castShadow
      >
        {wireframe ? (
          <meshBasicMaterial color={baseColor} wireframe />
        ) : (
          <shaderMaterial
            ref={materialRef}
            vertexShader={terrainVertexShader}
            fragmentShader={terrainFragmentShader}
            uniforms={uniforms}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>

      {/* Region boundary outline */}
      <RegionBoundary />

      {/* Optional contour lines */}
      <ContourLines
        visible={showContours}
        levels={contourLevels}
        color="#ffffff"
      />
    </group>
  );
}

export default TerrainMesh;
