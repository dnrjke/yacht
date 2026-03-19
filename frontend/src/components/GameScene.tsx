import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, PerformanceMonitor } from '@react-three/drei';
import { PhysicsBoard } from './3d/PhysicsBoard';
import { PhysicsCup } from './3d/PhysicsCup';
import { PhysicsDice } from './3d/PhysicsDice';
import { DecisionButton } from './3d/DecisionButton';
import { useState, useEffect } from 'react';
import * as THREE from 'three';
import { BOARD_CONSTANTS } from '@yacht/core';

const {
  BOARD_SIZE,
  WALL_THICKNESS,
  TRAY_DEPTH,
  PLAY_WALL_HEIGHT,
} = BOARD_CONSTANTS;

// Derived camera constants — automatically update when BOARD_CONSTANTS change:
//   boardWidth / boardLength → how much XZ area the camera must cover
//   cameraZ / lookAtZ        → slight Z offset to center board + tray in view
//   PLAY_WALL_HEIGHT * 0.5   → camera lifts proportionally as walls grow taller
const boardWidth  = BOARD_SIZE + WALL_THICKNESS * 2;                       // 18
const boardLength = BOARD_SIZE + WALL_THICKNESS * 3 + TRAY_DEPTH;          // 23
const cameraZ     = -(TRAY_DEPTH / 4);                                     // -1.0
const lookAtZ     = -(TRAY_DEPTH / 2 + WALL_THICKNESS / 2);                // -2.5

// 반응형 카메라: 모바일(세로형) 기기에서도 야추판 양옆이 잘리지 않도록 화면 비율에 따라 카메라 Y 높이를 동적으로 조절합니다.
function ResponsiveCameraManager() {
  const { camera, viewport } = useThree();

  useEffect(() => {
    const fovInRadians = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
    const padding = 1.15; // 15% 여백

    let requiredHeight: number;

    if (viewport.aspect < 1) {
      // 📱 모바일 (세로 모드): 가로 길이(boardWidth)가 모두 들어오도록 카메라를 위로 올립니다.
      requiredHeight = (boardWidth / (2 * Math.tan(fovInRadians / 2) * viewport.aspect)) * padding;
    } else {
      // 💻 데스크톱 (가로 모드): 세로 길이(boardLength)가 화면에 들어오도록 기준을 잡습니다.
      requiredHeight = (boardLength / (2 * Math.tan(fovInRadians / 2))) * padding;
    }

    // 벽이 높을수록 카메라를 약간 더 올려 전체 모습이 보이도록 조정합니다.
    const cameraY = requiredHeight + PLAY_WALL_HEIGHT * 0.5;

    camera.position.set(0, cameraY, cameraZ);
    camera.lookAt(0, 0, lookAtZ);
    camera.updateProjectionMatrix();
  }, [viewport.aspect, camera]);

  return null;
}

export function GameScene() {
  const [dpr, setDpr] = useState(1.5);

  return (
    <Canvas
      camera={{ position: [0, BOARD_SIZE + PLAY_WALL_HEIGHT * 2 + 1, cameraZ], fov: 45 }}
      dpr={dpr}
      shadows
    >
      <ResponsiveCameraManager />
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
      <color attach="background" args={['#1e1e1e']} />
      
      <ambientLight intensity={0.5} />
      <directionalLight 
        position={[10, 20, 5]} 
        intensity={1.5} 
        castShadow 
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-far={50}
      />

      <PhysicsBoard />
      <PhysicsCup />
      <PhysicsDice />
      <DecisionButton />

      <OrbitControls 
        makeDefault 
        target={[0, 0, -2.5]} // 회전축 및 바라보는 중심점을 야추판(중심 0)과 주사위 보관함(-11) 사이로 보정
        minDistance={10}
        maxDistance={60}
        minPolarAngle={0} 
        maxPolarAngle={Math.PI / 6} // 거의 수직(Top-down)에 가깝게 카메라 회전 범위를 제한
        mouseButtons={{
          LEFT: undefined, 
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.ROTATE
        }}
      />
      <Environment preset="city" />
    </Canvas>
  );
}
