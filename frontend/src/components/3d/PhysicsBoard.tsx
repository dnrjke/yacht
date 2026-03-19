import * as THREE from 'three';
import { BOARD_CONSTANTS } from '@yacht/core';

const {
  BOARD_SIZE,
  BOARD_THICKNESS,
  WALL_THICKNESS,
  PLAY_WALL_HEIGHT,
  TRAY_DEPTH,
  TRAY_SLOT_COUNT,
  TRAY_SLOT_SPACING,
} = BOARD_CONSTANTS;

// Keep Tray wall height: matches the playing area wall height
const TRAY_WALL_HEIGHT = PLAY_WALL_HEIGHT;

// Derived geometry values
const halfSize        = BOARD_SIZE / 2;          // 8
const hw              = WALL_THICKNESS / 2;       // 0.5
const baseCenterY     = -BOARD_THICKNESS / 2;     // -0.5
const wallCenterY     = PLAY_WALL_HEIGHT / 2;     // 2  (playing area)
const trayWallCenterY = TRAY_WALL_HEIGHT / 2;     // 1  (keep tray)

// Keep Tray Z positions (derived so they stay in sync with TRAY_DEPTH / WALL_THICKNESS)
const trayCenterZ        = -(halfSize + WALL_THICKNESS + TRAY_DEPTH / 2);        // -11
const trayFarBorderCenterZ = -(halfSize + WALL_THICKNESS + TRAY_DEPTH + hw);     // -13.5

export function PhysicsBoard() {
  // Board base (Green felt)
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: '#2d4a22',
    roughness: 0.9,
    metalness: 0.1,
  });

  // Borders (Wood)
  const borderMaterial = new THREE.MeshStandardMaterial({
    color: '#5c3a21',
    roughness: 0.7,
    metalness: 0.1,
  });

  const totalBoardWidth = BOARD_SIZE + WALL_THICKNESS * 2; // 18

  return (
    <group>
      {/* ── Playing Area ── */}
      <mesh position={[0, baseCenterY, 0]} receiveShadow material={baseMaterial}>
        <boxGeometry args={[BOARD_SIZE, BOARD_THICKNESS, BOARD_SIZE]} />
      </mesh>

      {/* Top Border (-z) */}
      <mesh position={[0, wallCenterY, -(halfSize + hw)]} castShadow receiveShadow material={borderMaterial}>
        <boxGeometry args={[totalBoardWidth, PLAY_WALL_HEIGHT, WALL_THICKNESS]} />
      </mesh>

      {/* Bottom Border (+z) */}
      <mesh position={[0, wallCenterY, halfSize + hw]} castShadow receiveShadow material={borderMaterial}>
        <boxGeometry args={[totalBoardWidth, PLAY_WALL_HEIGHT, WALL_THICKNESS]} />
      </mesh>

      {/* Left Border (-x) */}
      <mesh position={[-(halfSize + hw), wallCenterY, 0]} castShadow receiveShadow material={borderMaterial}>
        <boxGeometry args={[WALL_THICKNESS, PLAY_WALL_HEIGHT, BOARD_SIZE]} />
      </mesh>

      {/* Right Border (+x) */}
      <mesh position={[halfSize + hw, wallCenterY, 0]} castShadow receiveShadow material={borderMaterial}>
        <boxGeometry args={[WALL_THICKNESS, PLAY_WALL_HEIGHT, BOARD_SIZE]} />
      </mesh>

      {/* ── Keep Tray ── */}
      <mesh position={[0, baseCenterY, trayCenterZ]} receiveShadow material={borderMaterial}>
        <boxGeometry args={[totalBoardWidth, BOARD_THICKNESS, TRAY_DEPTH]} />
      </mesh>

      {/* Keep Tray Far Border */}
      <mesh position={[0, trayWallCenterY, trayFarBorderCenterZ]} castShadow receiveShadow material={borderMaterial}>
        <boxGeometry args={[totalBoardWidth, TRAY_WALL_HEIGHT, WALL_THICKNESS]} />
      </mesh>

      {/* Keep Tray Left Border */}
      <mesh position={[-(halfSize + hw), trayWallCenterY, trayCenterZ]} castShadow receiveShadow material={borderMaterial}>
        <boxGeometry args={[WALL_THICKNESS, TRAY_WALL_HEIGHT, TRAY_DEPTH]} />
      </mesh>

      {/* Keep Tray Right Border */}
      <mesh position={[halfSize + hw, trayWallCenterY, trayCenterZ]} castShadow receiveShadow material={borderMaterial}>
        <boxGeometry args={[WALL_THICKNESS, TRAY_WALL_HEIGHT, TRAY_DEPTH]} />
      </mesh>

      {/* Keep Slots (Darker Felt Indicators) */}
      {Array.from({ length: TRAY_SLOT_COUNT }).map((_, i) => {
        const startX = -((TRAY_SLOT_COUNT - 1) * TRAY_SLOT_SPACING) / 2;
        return (
          <mesh
            key={`slot-${i}`}
            position={[startX + i * TRAY_SLOT_SPACING, baseCenterY + BOARD_THICKNESS / 2 + 0.01, trayCenterZ]}
            receiveShadow
            material={baseMaterial}
          >
            <boxGeometry args={[2.5, 0.05, 2.5]} />
          </mesh>
        );
      })}
    </group>
  );
}
