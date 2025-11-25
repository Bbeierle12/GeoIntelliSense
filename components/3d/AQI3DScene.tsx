/**
 * AQI3DScene - Main React Three Fiber Scene Component
 * Manages the 3D canvas, camera, lighting, and scene composition
 */

import React, { useRef, useMemo, Suspense, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { getOptimalCameraPosition, SAN_JOAQUIN_BOUNDS, WORLD_SCALE } from '../../utils/geo3d';

// =============================================================================
// TYPES
// =============================================================================

export interface AQI3DSceneProps {
  children?: React.ReactNode;
  showStats?: boolean;
  enableControls?: boolean;
  backgroundColor?: string;
  ambientLightIntensity?: number;
  directionalLightIntensity?: number;
  fogEnabled?: boolean;
  fogColor?: string;
  fogNear?: number;
  fogFar?: number;
  onCameraMove?: (position: THREE.Vector3, target: THREE.Vector3) => void;
  className?: string;
}

export interface SceneContextValue {
  bounds: typeof SAN_JOAQUIN_BOUNDS;
  worldScale: number;
  camera: THREE.PerspectiveCamera | null;
}

// =============================================================================
// CONTEXT
// =============================================================================

export const SceneContext = React.createContext<SceneContextValue>({
  bounds: SAN_JOAQUIN_BOUNDS,
  worldScale: WORLD_SCALE,
  camera: null,
});

// =============================================================================
// CAMERA CONTROLLER
// =============================================================================

interface CameraControllerProps {
  enableControls: boolean;
  onCameraMove?: (position: THREE.Vector3, target: THREE.Vector3) => void;
}

function CameraController({ enableControls, onCameraMove }: CameraControllerProps) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();

  // Set initial camera position based on San Joaquin Valley bounds
  useEffect(() => {
    // Position camera to view the entire San Joaquin Valley
    camera.position.set(60, 80, 60);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useFrame(() => {
    if (controlsRef.current && onCameraMove) {
      const target = new THREE.Vector3();
      controlsRef.current.getTarget(target);
      onCameraMove(camera.position, target);
    }
  });

  if (!enableControls) return null;

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.05}
      minDistance={20}
      maxDistance={200}
      maxPolarAngle={Math.PI / 2.2} // Prevent going below ground
      minPolarAngle={0.1}
      enablePan
      panSpeed={0.5}
      rotateSpeed={0.5}
      zoomSpeed={0.8}
    />
  );
}

// =============================================================================
// SCENE LIGHTING
// =============================================================================

interface SceneLightingProps {
  ambientIntensity: number;
  directionalIntensity: number;
  time?: 'day' | 'sunset' | 'night';
}

function SceneLighting({ ambientIntensity, directionalIntensity, time = 'day' }: SceneLightingProps) {
  const directionalRef = useRef<THREE.DirectionalLight>(null);

  // Calculate light color and position based on time of day
  const lightConfig = useMemo(() => {
    switch (time) {
      case 'sunset':
        return {
          color: new THREE.Color('#ffa07a'),
          position: [50, 20, 30] as [number, number, number],
          ambientColor: new THREE.Color('#ffb088'),
        };
      case 'night':
        return {
          color: new THREE.Color('#4169e1'),
          position: [30, 60, 20] as [number, number, number],
          ambientColor: new THREE.Color('#1a1a2e'),
        };
      default: // day
        return {
          color: new THREE.Color('#ffffff'),
          position: [50, 80, 50] as [number, number, number],
          ambientColor: new THREE.Color('#87ceeb'),
        };
    }
  }, [time]);

  return (
    <>
      {/* Ambient light for overall scene illumination */}
      <ambientLight
        intensity={ambientIntensity}
        color={lightConfig.ambientColor}
      />
      
      {/* Main directional light (sun) */}
      <directionalLight
        ref={directionalRef}
        position={lightConfig.position}
        intensity={directionalIntensity}
        color={lightConfig.color}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={200}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      
      {/* Fill light from opposite side */}
      <directionalLight
        position={[-30, 40, -30]}
        intensity={directionalIntensity * 0.3}
        color="#b0c4de"
      />
      
      {/* Hemisphere light for more natural outdoor lighting */}
      <hemisphereLight
        args={['#87ceeb', '#8b4513', ambientIntensity * 0.5]}
      />
    </>
  );
}

// =============================================================================
// LOADING FALLBACK
// =============================================================================

function LoadingFallback() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.elapsedTime;
    }
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#4CAF50" wireframe />
    </mesh>
  );
}

// =============================================================================
// GROUND GRID (DEBUG/REFERENCE)
// =============================================================================

interface GroundGridProps {
  visible?: boolean;
  size?: number;
  divisions?: number;
}

function GroundGrid({ visible = true, size = 100, divisions = 20 }: GroundGridProps) {
  if (!visible) return null;

  return (
    <gridHelper
      args={[size, divisions, '#666666', '#333333']}
      rotation={[0, 0, 0]}
      position={[0, 0.01, 0]}
    />
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function AQI3DScene({
  children,
  showStats = false,
  enableControls = true,
  backgroundColor = '#1a1a2e',
  ambientLightIntensity = 0.4,
  directionalLightIntensity = 1.0,
  fogEnabled = true,
  fogColor = '#1a1a2e',
  fogNear = 50,
  fogFar = 200,
  onCameraMove,
  className = '',
}: AQI3DSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Scene context value
  const contextValue = useMemo<SceneContextValue>(() => ({
    bounds: SAN_JOAQUIN_BOUNDS,
    worldScale: WORLD_SCALE,
    camera: null,
  }), []);

  return (
    <div className={`relative w-full h-full ${className}`}>
      <Canvas
        ref={canvasRef}
        shadows
        dpr={[1, 2]} // Pixel ratio for retina displays
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true,
        }}
        onCreated={({ gl, scene }) => {
          // Set background color
          gl.setClearColor(new THREE.Color(backgroundColor));
          
          // Enable fog if configured
          if (fogEnabled) {
            scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);
          }
        }}
      >
        <SceneContext.Provider value={contextValue}>
          {/* Camera */}
          <PerspectiveCamera
            makeDefault
            fov={60}
            near={0.1}
            far={1000}
            position={[60, 80, 60]}
          />

          {/* Controls */}
          <CameraController
            enableControls={enableControls}
            onCameraMove={onCameraMove}
          />

          {/* Lighting */}
          <SceneLighting
            ambientIntensity={ambientLightIntensity}
            directionalIntensity={directionalLightIntensity}
          />

          {/* Debug grid */}
          <GroundGrid visible={false} />

          {/* Scene content with suspense for async loading */}
          <Suspense fallback={<LoadingFallback />}>
            {children}
          </Suspense>

          {/* Performance stats (development) */}
          {showStats && <Stats />}
        </SceneContext.Provider>
      </Canvas>
    </div>
  );
}

// =============================================================================
// HOOK FOR ACCESSING SCENE CONTEXT
// =============================================================================

export function useSceneContext() {
  const context = React.useContext(SceneContext);
  if (!context) {
    throw new Error('useSceneContext must be used within AQI3DScene');
  }
  return context;
}

export default AQI3DScene;
