import { useRef, useEffect, useMemo } from 'react';
import { useGameStore, isAiTurnNow } from '../../store/gameStore';
import { getPhysicsEngine, onPourResult } from '../../physics/physicsEngine';
import type { PourResult } from '../../physics/PhysicsWorld';
import * as THREE from 'three';
import { YACHT_CONSTANTS, BOARD_CONSTANTS, detectCombo, CUP_DICE_OFFSETS, getTraySlotPosition } from '@yacht/core';
import { soundManager } from '../../utils/soundManager';
import { useFrame } from '@react-three/fiber';

const FACE_NORMALS: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0),
  2: new THREE.Vector3(1, 0, 0),
  3: new THREE.Vector3(0, 0, 1),
  4: new THREE.Vector3(0, 0, -1),
  5: new THREE.Vector3(-1, 0, 0),
  6: new THREE.Vector3(0, -1, 0),
};

const TOWARD_CAMERA = new THREE.Vector3(0, 0, 1);
const UP_VECTOR = new THREE.Vector3(0, 1, 0);

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _center = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _correction = new THREE.Quaternion();
const _localY = new THREE.Vector3(0, 1, 0);
const _targetPos = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function createDiceTexture(value: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 128, 128);

  ctx.fillStyle = 'black';
  const drawPip = (x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
  };

  const center = 64;
  const offset = 32;

  if ([1, 3, 5].includes(value)) drawPip(center, center);
  if ([2, 3, 4, 5, 6].includes(value)) {
    drawPip(center - offset, center - offset);
    drawPip(center + offset, center + offset);
  }
  if ([4, 5, 6].includes(value)) {
    drawPip(center - offset, center + offset);
    drawPip(center + offset, center - offset);
  }
  if (value === 6) {
    drawPip(center - offset, center);
    drawPip(center + offset, center);
  }

  ctx.lineWidth = 4;
  ctx.strokeStyle = '#cccccc';
  ctx.strokeRect(2, 2, 124, 124);

  return new THREE.CanvasTexture(canvas);
}

export function PhysicsDice() {
  const setCurrentDiceValues = useGameStore(state => state.setCurrentDiceValues);
  const isInPlacementMode = useGameStore(state => state.isInPlacementMode);
  const diceRefs = useRef<(THREE.Mesh | null)[]>([]);
  const playbackData = useRef<{ frames: any[]; currentFrame: number } | null>(null);
  const placementTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placementAnim = useRef<{
    startTime: number;
    startPositions: THREE.Vector3[];
    startQuaternions: THREE.Quaternion[];
    startScales: number[];
    duration: number;
  } | null>(null);
  const returnAnim = useRef<{
    startTime: number;
    startPositions: THREE.Vector3[];
    startQuaternions: THREE.Quaternion[];
    startScales: number[];
    duration: number;
  } | null>(null);
  const lastPlacementCount = useRef(5);

  const diceMaterials = useMemo(() => [
    new THREE.MeshStandardMaterial({ map: createDiceTexture(2), roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createDiceTexture(5), roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createDiceTexture(1), roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createDiceTexture(6), roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createDiceTexture(3), roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createDiceTexture(4), roughness: 0.3 }),
  ], []);

  useEffect(() => {
    const handlePourResult = (r: PourResult) => {
      if (placementTimer.current) clearTimeout(placementTimer.current);
      const store = useGameStore.getState();
      if (store.isInPlacementMode) store.setIsInPlacementMode(false);
      if (store.isWaitingForPlacement) store.setIsWaitingForPlacement(false);
      if (store.isSyncingDice) store.setIsSyncingDice(false);

      playbackData.current = { frames: r.diceTrajectory, currentFrame: 0 };
      setCurrentDiceValues(r.finalValues);
      useGameStore.getState().incrementRollCount();
      useGameStore.getState().setCanPour(false);
    };

    const unsubscribe = onPourResult(handlePourResult);

    return () => {
      unsubscribe();
      if (placementTimer.current) clearTimeout(placementTimer.current);
    };
  }, [setCurrentDiceValues]);

  useFrame(({ camera, clock }) => {
    const store = useGameStore.getState();
    const cam = camera as THREE.PerspectiveCamera;

    // Placement mode
    if (store.isInPlacementMode) {
      const hudDepth = 15;
      const fovRad = cam.fov * Math.PI / 180;
      const visibleHeight = 2 * Math.tan(fovRad / 2) * hudDepth;
      const visibleWidth = visibleHeight * cam.aspect;

      _forward.set(0, 0, -1).applyQuaternion(cam.quaternion);
      _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      _center.copy(cam.position).addScaledVector(_forward, hudDepth);

      const hudDice = store.placementOrder;
      const hudCount = hudDice.length;

      if (hudCount !== lastPlacementCount.current) {
        lastPlacementCount.current = hudCount;
        placementAnim.current = {
          startTime: clock.elapsedTime,
          startPositions: diceRefs.current.map(m => m ? m.position.clone() : new THREE.Vector3()),
          startQuaternions: diceRefs.current.map(m => m ? m.quaternion.clone() : new THREE.Quaternion()),
          startScales: diceRefs.current.map(m => m ? m.scale.x : 1),
          duration: 0.3,
        };
      }

      if (!placementAnim.current) {
        placementAnim.current = {
          startTime: clock.elapsedTime,
          startPositions: diceRefs.current.map(m => m ? m.position.clone() : new THREE.Vector3()),
          startQuaternions: diceRefs.current.map(m => m ? m.quaternion.clone() : new THREE.Quaternion()),
          startScales: diceRefs.current.map(m => m ? m.scale.x : 1),
          duration: 0.5,
        };
      }

      const rawT = Math.min((clock.elapsedTime - placementAnim.current.startTime) / placementAnim.current.duration, 1);
      const t = easeOutCubic(rawT);

      if (hudCount > 0) {
        const slotWidth = (visibleWidth * 0.85) / Math.max(hudCount, 1);
        const dieScale = Math.min(slotWidth * 0.65, 1.8) / 2;
        const spacing = slotWidth;
        const totalWidth = (hudCount - 1) * spacing;
        const startX = -totalWidth / 2;

        hudDice.forEach((dieIdx, i) => {
          const mesh = diceRefs.current[dieIdx];
          if (!mesh) return;

          const xOffset = startX + i * spacing;
          const yOffset = visibleHeight * 0.05;

          _targetPos.copy(_center)
            .addScaledVector(_right, xOffset)
            .addScaledVector(_up, yOffset);

          _targetQuat.copy(cam.quaternion);
          const perspAngle = -Math.atan2(xOffset, hudDepth) * 0.85;
          _correction.setFromAxisAngle(_localY, perspAngle);
          _targetQuat.multiply(_correction);
          const value = store.currentDiceValues[dieIdx];
          const faceNormal = FACE_NORMALS[value] ?? FACE_NORMALS[1];
          _quat.setFromUnitVectors(faceNormal, TOWARD_CAMERA);
          _targetQuat.multiply(_quat);

          mesh.position.lerpVectors(placementAnim.current!.startPositions[dieIdx], _targetPos, t);
          mesh.quaternion.slerpQuaternions(placementAnim.current!.startQuaternions[dieIdx], _targetQuat, t);
          const startScale = placementAnim.current!.startScales[dieIdx];
          mesh.scale.setScalar(startScale + (dieScale - startScale) * t);
        });
      }

      store.keptDiceSlots.forEach((dieIdx, slotIdx) => {
        if (dieIdx === null) return;
        const mesh = diceRefs.current[dieIdx];
        if (!mesh) return;

        const trayPos = getTraySlotPosition(slotIdx);
        _targetPos.set(trayPos.x, trayPos.y, trayPos.z);
        const value = store.currentDiceValues[dieIdx];
        const faceNormal = FACE_NORMALS[value] ?? FACE_NORMALS[1];
        _targetQuat.setFromUnitVectors(faceNormal, UP_VECTOR);

        mesh.position.lerpVectors(placementAnim.current!.startPositions[dieIdx], _targetPos, t);
        mesh.quaternion.slerpQuaternions(placementAnim.current!.startQuaternions[dieIdx], _targetQuat, t);
        const startScale = placementAnim.current!.startScales[dieIdx];
        mesh.scale.setScalar(startScale + (1 - startScale) * t);
      });

      return;
    }

    if (placementAnim.current) {
      placementAnim.current = null;
    }

    // Return-to-cup animation
    if (store.isReturningToCup) {
      if (!returnAnim.current) {
        returnAnim.current = {
          startTime: clock.elapsedTime,
          startPositions: diceRefs.current.map(m => m ? m.position.clone() : new THREE.Vector3()),
          startQuaternions: diceRefs.current.map(m => m ? m.quaternion.clone() : new THREE.Quaternion()),
          startScales: diceRefs.current.map(m => m ? m.scale.x : 1),
          duration: 0.5,
        };
      }

      const rawT = Math.min((clock.elapsedTime - returnAnim.current.startTime) / returnAnim.current.duration, 1);
      const t = easeOutCubic(rawT);

      const cupX = BOARD_CONSTANTS.CUP_REST_X;
      const cupY = BOARD_CONSTANTS.CUP_REST_Y;
      const cupZ = BOARD_CONSTANTS.CUP_REST_Z;
      const keptSet = new Set(store.keptDiceSlots.filter(s => s !== null));
      let cupSlot = 0;

      for (let idx = 0; idx < diceRefs.current.length; idx++) {
        const mesh = diceRefs.current[idx];
        if (!mesh) continue;

        if (keptSet.has(idx)) {
          const slotIdx = store.keptDiceSlots.indexOf(idx);
          if (slotIdx >= 0) {
            const trayPos = getTraySlotPosition(slotIdx);
            mesh.position.set(trayPos.x, trayPos.y, trayPos.z);
            const value = store.currentDiceValues[idx];
            const faceNormal = FACE_NORMALS[value] ?? FACE_NORMALS[1];
            _quat.setFromUnitVectors(faceNormal, UP_VECTOR);
            mesh.quaternion.copy(_quat);
            mesh.scale.setScalar(1);
          }
          continue;
        }

        const off = CUP_DICE_OFFSETS[cupSlot % CUP_DICE_OFFSETS.length];
        cupSlot++;
        _targetPos.set(cupX + off.x, cupY + off.y, cupZ + off.z);
        mesh.position.lerpVectors(returnAnim.current.startPositions[idx], _targetPos, t);

        const val = store.currentDiceValues[idx];
        const faceNorm = FACE_NORMALS[val] ?? FACE_NORMALS[1];
        _targetQuat.setFromUnitVectors(faceNorm, UP_VECTOR);

        mesh.quaternion.slerpQuaternions(returnAnim.current.startQuaternions[idx], _targetQuat, t);
        const startScale = returnAnim.current.startScales[idx];
        mesh.scale.setScalar(startScale + (1 - startScale) * t);
      }

      if (rawT >= 1) {
        returnAnim.current = null;
        store.setIsReturningToCup(false);

        const physics = getPhysicsEngine();
        if (physics) {
          physics.spawnNonKeptDiceInCup(store.keptDiceSlots);
        }

        store.setIsSyncingDice(false);
        store.setCanPour(true);
      }
      return;
    }
    if (returnAnim.current) returnAnim.current = null;

    for (let idx = 0; idx < diceRefs.current.length; idx++) {
      const mesh = diceRefs.current[idx];
      if (mesh && mesh.scale.x !== 1) mesh.scale.setScalar(1);
    }

    // Trajectory playback
    if (playbackData.current) {
      const { frames, currentFrame } = playbackData.current;

      if (currentFrame < frames.length) {
        frames[currentFrame].forEach((state: any, idx: number) => {
          const mesh = diceRefs.current[idx];
          if (mesh) {
            mesh.position.set(state.position.x, state.position.y, state.position.z);
            mesh.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
          }
        });
        playbackData.current.currentFrame++;
      } else {
        playbackData.current = null;
        useGameStore.getState().setIsWaitingForPlacement(true);
        placementTimer.current = setTimeout(() => {
          const s = useGameStore.getState();
          s.setIsWaitingForPlacement(false);
          const keptSet = new Set(s.keptDiceSlots.filter(v => v !== null));
          const nonKeptValues = s.currentDiceValues
            .map((v, i) => ({ v, i }))
            .filter(x => !keptSet.has(x.i))
            .sort((a, b) => a.v !== b.v ? a.v - b.v : a.i - b.i)
            .map(x => x.i);
          s.setPlacementOrder(nonKeptValues);
          s.setActiveCombo(detectCombo(s.currentDiceValues));
          s.setIsInPlacementMode(true);
        }, 400);
      }
      return;
    }

    // Live physics: step engine and apply dice positions
    const physics = getPhysicsEngine();
    if (physics) {
      physics.step();
      const keptSet = new Set(
        store.keptDiceSlots.filter((s): s is number => s !== null)
      );
      const diceStates = physics.getDiceStates();
      diceStates.forEach((state, idx) => {
        if (keptSet.has(idx)) return;
        const mesh = diceRefs.current[idx];
        if (mesh) {
          mesh.position.set(state.position.x, state.position.y, state.position.z);
          mesh.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
        }
      });
    }
  });

  return (
    <>
      {Array.from({ length: YACHT_CONSTANTS.DICE_COUNT }).map((_, idx) => {
        const off = CUP_DICE_OFFSETS[idx];
        return (
        <mesh
          key={idx}
          ref={el => { diceRefs.current[idx] = el; }}
          position={[
            BOARD_CONSTANTS.CUP_REST_X + off.x,
            BOARD_CONSTANTS.CUP_REST_Y + off.y,
            BOARD_CONSTANTS.CUP_REST_Z + off.z,
          ]}
          castShadow
          receiveShadow
          material={diceMaterials}
          onPointerDown={isInPlacementMode ? (e) => {
            e.stopPropagation();
            if (isAiTurnNow()) return;
            const s = useGameStore.getState();
            const isKept = s.keptDiceSlots.includes(idx);
            if (isKept) {
              s.unkeepDie(idx);
              soundManager.play('tap_smooth');
            } else if (s.placementOrder.includes(idx)) {
              s.keepDie(idx);
              soundManager.play('tap');
            }
          } : undefined}
        >
          <boxGeometry args={[2, 2, 2]} />
        </mesh>
        );
      })}
    </>
  );
}
