import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, PerformanceMonitor } from '@react-three/drei';
import { PhysicsCup } from './3d/PhysicsCup';
import { PhysicsDice } from './3d/PhysicsDice';
import { useState } from 'react';

import * as THREE from 'three';

export function GameScene() {
  const [dpr, setDpr] = useState(1.5);

  return (
    <Canvas
      camera={{ position: [0, 15, 10], fov: 45 }}
      dpr={dpr}
      shadows
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
      <color attach="background" args={['#1e1e1e']} />
      
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 5]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />

      {/* Table Surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[50, 50]} />
        <meshStandardMaterial color="#2d4a22" roughness={0.8} />
      </mesh>

      <PhysicsCup />
      <PhysicsDice />

      <OrbitControls 
        makeDefault 
        minPolarAngle={0} 
        maxPolarAngle={Math.PI / 2.1} 
        mouseButtons={{
          LEFT: undefined, // 좌클릭은 야추통 드래그에만 사용 (카메라 회전 X)
          MIDDLE: THREE.MOUSE.PAN, // 휠클릭 드래그는 카메라 패닝
          RIGHT: THREE.MOUSE.ROTATE // 우클릭 드래그는 카메라 회전
        }}
      />
      <Environment preset="city" />
    </Canvas>
  );
}
