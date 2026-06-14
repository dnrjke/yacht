import { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore, isAiTurnNow } from '../../store/gameStore';
import { GAME_CONSTANTS } from '@yacht/core';
import { soundManager } from '../../utils/soundManager';
import { useI18n } from '../../utils/useI18n';
import { getPhysicsEngine } from '../../physics/physicsEngine';
import * as THREE from 'three';

// Scratch vectors — reused every frame
const _forward = new THREE.Vector3();
const _right   = new THREE.Vector3();
const _up      = new THREE.Vector3();
const _center  = new THREE.Vector3();

function createButtonTexture(hovered: boolean, remainingRolls: number, disabled: boolean, rerollLabel: string) {
  const W = 320, H = 80;
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const bg = disabled ? '#2a2a2a' : hovered ? '#3a6a3a' : '#1e4a1e';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = disabled ? '#444' : hovered ? '#88dd88' : '#4a8a4a';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  ctx.fillStyle = disabled ? '#666' : '#ffffff';
  ctx.font = 'bold 38px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${rerollLabel} (${remainingRolls})`, W / 2, H / 2);

  return new THREE.CanvasTexture(canvas);
}

export function DecisionButton() {
  const isInPlacementMode = useGameStore(state => state.isInPlacementMode);
  const rollCount = useGameStore(state => state.rollCount);
  const placementOrder = useGameStore(state => state.placementOrder);
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const { t } = useI18n();

  const remainingRolls = GAME_CONSTANTS.MAX_ROLLS_PER_TURN - rollCount;
  const canRollAgain = remainingRolls > 0;
  const allKept = placementOrder.length === 0;
  const disabled = allKept || !canRollAgain;

  const rerollLabel = t('reroll');
  const material = useMemo(() => {
    const tex = createButtonTexture(disabled ? false : hovered, remainingRolls, disabled, rerollLabel);
    return new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }, [hovered, remainingRolls, disabled, rerollLabel]);

  useFrame(({ camera }) => {
    if (!meshRef.current || !isInPlacementMode) return;

    const cam = camera as THREE.PerspectiveCamera;
    const hudDepth = 15;
    const fovRad = cam.fov * Math.PI / 180;
    const visibleHeight = 2 * Math.tan(fovRad / 2) * hudDepth;
    const visibleWidth = visibleHeight * cam.aspect;

    // Camera basis vectors
    _forward.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);

    // Position: center of view at hudDepth, then shift 30% down
    _center.copy(cam.position).addScaledVector(_forward, hudDepth);
    meshRef.current.position.copy(_center)
      .addScaledVector(_up, -visibleHeight * 0.30);

    // Scale button: 20% of visible width (40% on mobile portrait), height follows 4:1 texture aspect
    const mobileFactor = cam.aspect < 1 ? 2 : 1;
    const btnW = visibleWidth * 0.20 * mobileFactor;
    const btnH = btnW / 4;
    meshRef.current.scale.set(btnW, btnH, 1);

    // Billboard
    meshRef.current.quaternion.copy(cam.quaternion);
  });

  if (!isInPlacementMode) return null;

  return (
    <mesh
      ref={meshRef}
      renderOrder={100}
      material={material}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (disabled || isAiTurnNow()) return;
        soundManager.play('reroll');
        const store = useGameStore.getState();
        store.setIsInPlacementMode(false);
        store.setIsSyncingDice(true);

        if (store.placementOrder.length > 0) {
          store.setIsReturningToCup(true);
        } else {
          const physics = getPhysicsEngine();
          if (physics) {
            physics.spawnNonKeptDiceInCup(store.keptDiceSlots);
          }
          store.setIsSyncingDice(false);
          store.setCanPour(true);
        }
      }}
      onPointerOver={() => {
        if (!disabled) {
          document.body.style.cursor = 'pointer';
          setHovered(true);
        }
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
        setHovered(false);
      }}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
