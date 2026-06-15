import { useRef, useEffect, useMemo } from 'react';
import { useGameStore, isMyTurn } from '../../store/gameStore';
import { getPhysicsEngine, onPourResult } from '../../physics/physicsEngine';
import { getSocket } from '../../network/socket';
import { interpolateShake, isShakeActive } from '../../network/shakeBuffer';
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
const _lerpQA = new THREE.Quaternion();
const _lerpQB = new THREE.Quaternion();
const _renderedFaceNormal = new THREE.Vector3();
const _cameraDir = new THREE.Vector3();

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface RenderedDiceDebugSnapshot {
  updatedAt: number;
  updatedAtIso: string;
  positions: Array<{ x: number; y: number; z: number }>;
  quaternions: Array<{ x: number; y: number; z: number; w: number }>;
  topValues: number[];
  cameraValues: number[];
}

interface DicePlaybackDebugSnapshot {
  status: 'idle' | 'buffering' | 'playing' | 'waitingForServer' | 'reconciling' | 'waitingForPlacement' | 'placement';
  updatedAt: number;
  updatedAtIso: string;
  totalFrames: number;
  currentFrame: number;
  elapsedMs: number;
  remainingMs: number;
}

let renderedDiceDebugSnapshot: RenderedDiceDebugSnapshot | null = null;
let dicePlaybackDebugSnapshot: DicePlaybackDebugSnapshot | null = null;
let lastPreviewPlaybackTime = 0;

export function getRenderedDiceDebugSnapshot(): RenderedDiceDebugSnapshot | null {
  return renderedDiceDebugSnapshot;
}

export function getDicePlaybackDebugSnapshot(): DicePlaybackDebugSnapshot | null {
  return dicePlaybackDebugSnapshot;
}

function updateDicePlaybackDebugSnapshot(snapshot: Omit<DicePlaybackDebugSnapshot, 'updatedAt' | 'updatedAtIso'>): void {
  const updatedAt = Date.now();
  dicePlaybackDebugSnapshot = {
    ...snapshot,
    updatedAt,
    updatedAtIso: new Date(updatedAt).toISOString(),
  };
}

function detectFaceValue(meshQuat: THREE.Quaternion, direction: THREE.Vector3): number {
  let bestValue = 1;
  let bestDot = -Infinity;

  for (const [rawValue, localNormal] of Object.entries(FACE_NORMALS)) {
    _renderedFaceNormal.copy(localNormal).applyQuaternion(meshQuat);
    const dot = _renderedFaceNormal.dot(direction);
    if (dot > bestDot) {
      bestDot = dot;
      bestValue = Number(rawValue);
    }
  }

  return bestValue;
}

function updateRenderedDiceDebugSnapshot(
  diceRefs: { current: (THREE.Mesh | null)[] },
  camera: THREE.Camera,
): void {
  camera.getWorldDirection(_cameraDir);
  _cameraDir.multiplyScalar(-1);
  const updatedAt = Date.now();

  renderedDiceDebugSnapshot = {
    updatedAt,
    updatedAtIso: new Date(updatedAt).toISOString(),
    positions: diceRefs.current.map(mesh => ({
      x: mesh ? +mesh.position.x.toFixed(2) : 0,
      y: mesh ? +mesh.position.y.toFixed(2) : 0,
      z: mesh ? +mesh.position.z.toFixed(2) : 0,
    })),
    quaternions: diceRefs.current.map(mesh => ({
      x: mesh ? +mesh.quaternion.x.toFixed(3) : 0,
      y: mesh ? +mesh.quaternion.y.toFixed(3) : 0,
      z: mesh ? +mesh.quaternion.z.toFixed(3) : 0,
      w: mesh ? +mesh.quaternion.w.toFixed(3) : 1,
    })),
    topValues: diceRefs.current.map(mesh => mesh ? detectFaceValue(mesh.quaternion, UP_VECTOR) : 1),
    cameraValues: diceRefs.current.map(mesh => mesh ? detectFaceValue(mesh.quaternion, _cameraDir) : 1),
  };
}

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
  const playbackData = useRef<{ frames: any[]; time: number; preview?: boolean; scheduledStartAt?: number } | null>(null);
  const pendingAuthoritativeResult = useRef<PourResult | null>(null);
  const authoritativeBlend = useRef<{
    startTime: number;
    duration: number;
    startPositions: THREE.Vector3[];
    startQuaternions: THREE.Quaternion[];
    targetFrame: any[];
    result: PourResult;
  } | null>(null);
  const physicsAccum = useRef(0);
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

  const enterPlacementFromValues = (values: number[]) => {
    const s = useGameStore.getState();
    const keptSet = new Set(s.keptDiceSlots.filter(v => v !== null));
    const nonKeptValues = values
      .map((v, i) => ({ v, i }))
      .filter(x => !keptSet.has(x.i))
      .sort((a, b) => a.v !== b.v ? a.v - b.v : a.i - b.i)
      .map(x => x.i);
    s.setIsWaitingForPlacement(false);
    s.setPlacementOrder(nonKeptValues);
    s.setActiveCombo(detectCombo(values));
    s.setIsInPlacementMode(true);
  };

  const commitAuthoritativePreviewResult = (result: PourResult) => {
    const previewElapsedMs = Math.round(lastPreviewPlaybackTime * 1000);
    pendingAuthoritativeResult.current = null;
    authoritativeBlend.current = null;
    playbackData.current = null;
    lastPreviewPlaybackTime = 0;
    placementAnim.current = null;

    setCurrentDiceValues(result.finalValues);
    const physics = getPhysicsEngine();
    if (physics) physics.applyAuthoritativePourResult(result);

    enterPlacementFromValues(result.finalValues);
    updateDicePlaybackDebugSnapshot({
      status: 'placement',
      totalFrames: result.diceTrajectory.length,
      currentFrame: Math.max(0, result.diceTrajectory.length - 1),
      elapsedMs: previewElapsedMs,
      remainingMs: 0,
    });
  };

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

      if (!r.preview && (playbackData.current?.preview || lastPreviewPlaybackTime > 0)) {
        pendingAuthoritativeResult.current = r;
        return;
      }

      const FRAME_DT = 1 / 60;
      const initialTime = !r.preview && lastPreviewPlaybackTime > 0
        ? Math.min(lastPreviewPlaybackTime, Math.max(0, (r.diceTrajectory.length - 1) * FRAME_DT))
        : 0;
      if (!r.preview) lastPreviewPlaybackTime = 0;

      playbackData.current = { frames: r.diceTrajectory, time: initialTime, preview: r.preview, scheduledStartAt: r.scheduledStartAt };
      updateDicePlaybackDebugSnapshot({
        status: r.scheduledStartAt && performance.now() < r.scheduledStartAt ? 'buffering' : 'playing',
        totalFrames: r.diceTrajectory.length,
        currentFrame: Math.floor(initialTime / FRAME_DT),
        elapsedMs: Math.round(initialTime * 1000),
        remainingMs: r.scheduledStartAt && performance.now() < r.scheduledStartAt
          ? Math.round(r.scheduledStartAt - performance.now())
          : Math.max(0, Math.round(((r.diceTrajectory.length - 1) * FRAME_DT - initialTime) * 1000)),
      });
      if (!r.preview) setCurrentDiceValues(r.finalValues);
      const s = useGameStore.getState();
      if (s.gameMode !== 'online') {
        s.incrementRollCount();
      }
      s.setCanPour(false);

      const physics = getPhysicsEngine();
      if (physics && s.gameMode === 'online' && !r.preview) {
        physics.applyAuthoritativePourResult(r);
      }
    };

    const unsubscribe = onPourResult(handlePourResult);

    return () => {
      unsubscribe();
      if (placementTimer.current) clearTimeout(placementTimer.current);
    };
  }, [setCurrentDiceValues]);

  useFrame(({ camera, clock }, delta) => {
    const store = useGameStore.getState();
    const cam = camera as THREE.PerspectiveCamera;

    if (!playbackData.current && !authoritativeBlend.current && pendingAuthoritativeResult.current && lastPreviewPlaybackTime > 0) {
      const result = pendingAuthoritativeResult.current;
      commitAuthoritativePreviewResult(result);
      updateRenderedDiceDebugSnapshot(diceRefs, camera);
      return;
    }

    if (playbackData.current?.preview && store.canPour) {
      playbackData.current = null;
      lastPreviewPlaybackTime = 0;
      pendingAuthoritativeResult.current = null;
      authoritativeBlend.current = null;
      updateDicePlaybackDebugSnapshot({
        status: 'idle',
        totalFrames: 0,
        currentFrame: 0,
        elapsedMs: 0,
        remainingMs: 0,
      });
    }

    if (authoritativeBlend.current) {
      const blend = authoritativeBlend.current;
      const rawT = Math.min((clock.elapsedTime - blend.startTime) / blend.duration, 1);
      const t = easeOutCubic(rawT);

      blend.targetFrame.forEach((targetState: any, idx: number) => {
        const mesh = diceRefs.current[idx];
        if (!mesh) return;
        mesh.position.lerpVectors(
          blend.startPositions[idx],
          _targetPos.set(targetState.position.x, targetState.position.y, targetState.position.z),
          t,
        );
        _lerpQA.copy(blend.startQuaternions[idx]);
        _lerpQB.set(targetState.quaternion.x, targetState.quaternion.y, targetState.quaternion.z, targetState.quaternion.w);
        _lerpQA.slerp(_lerpQB, t);
        mesh.quaternion.copy(_lerpQA);
      });

      updateDicePlaybackDebugSnapshot({
        status: 'reconciling',
        totalFrames: blend.result.diceTrajectory.length,
        currentFrame: blend.result.diceTrajectory.length - 1,
        elapsedMs: Math.round(lastPreviewPlaybackTime * 1000),
        remainingMs: Math.max(0, Math.round((1 - rawT) * blend.duration * 1000)),
      });

      if (rawT >= 1) {
        const result = blend.result;
        authoritativeBlend.current = null;
        lastPreviewPlaybackTime = 0;
        setCurrentDiceValues(result.finalValues);
        const physics = getPhysicsEngine();
        if (physics) physics.applyAuthoritativePourResult(result);
        const s = useGameStore.getState();
        s.setIsWaitingForPlacement(true);
        placementTimer.current = setTimeout(() => {
          const latest = useGameStore.getState();
          latest.setIsWaitingForPlacement(false);
          const keptSet = new Set(latest.keptDiceSlots.filter(v => v !== null));
          const nonKeptValues = latest.currentDiceValues
            .map((v, i) => ({ v, i }))
            .filter(x => !keptSet.has(x.i))
            .sort((a, b) => a.v !== b.v ? a.v - b.v : a.i - b.i)
            .map(x => x.i);
          latest.setPlacementOrder(nonKeptValues);
          latest.setActiveCombo(detectCombo(latest.currentDiceValues));
          latest.setIsInPlacementMode(true);
          updateDicePlaybackDebugSnapshot({
            status: 'placement',
            totalFrames: result.diceTrajectory.length,
            currentFrame: result.diceTrajectory.length - 1,
            elapsedMs: Math.round(lastPreviewPlaybackTime * 1000),
            remainingMs: 0,
          });
        }, 200);
      }

      updateRenderedDiceDebugSnapshot(diceRefs, camera);
      return;
    }

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

      updateRenderedDiceDebugSnapshot(diceRefs, camera);
      return;
    }

    if (placementAnim.current) {
      placementAnim.current = null;
    }

    // Return-to-cup animation
    if (store.isReturningToCup) {
      if (placementTimer.current) {
        clearTimeout(placementTimer.current);
        placementTimer.current = null;
      }

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

        if (store.gameMode === 'online') {
          const physics = getPhysicsEngine();
          if (physics) {
            physics.resetCupToRest();
            if (store.returnReason === 'turnEnd') {
              physics.spawnNonKeptDiceInCup([null, null, null, null, null]);
            } else {
              physics.spawnNonKeptDiceInCup(store.keptDiceSlots);
            }
          }

          const isMine = store.currentTurn === store.myRole;
          if (isMine && store.returnReason === 'reroll') {
            const sock = getSocket();
            if (sock) sock.emit('COLLECTION_DONE', { turnNumber: store.onlineTurnNumber });
          }
          store.setReturnReason(null);
          store.setIsSyncingDice(false);
        } else {
          const physics = getPhysicsEngine();
          if (physics) {
            physics.spawnNonKeptDiceInCup(store.keptDiceSlots);
          }
          store.setIsSyncingDice(false);
          store.setCanPour(true);
        }
      }
      updateRenderedDiceDebugSnapshot(diceRefs, camera);
      return;
    }
    if (returnAnim.current) returnAnim.current = null;

    for (let idx = 0; idx < diceRefs.current.length; idx++) {
      const mesh = diceRefs.current[idx];
      if (mesh && mesh.scale.x !== 1) mesh.scale.setScalar(1);
    }

    // Trajectory playback
    if (playbackData.current) {
      const FRAME_DT = 1 / 60;
      const pb = playbackData.current;
      const lastIdx = pb.frames.length - 1;

      if (pb.scheduledStartAt && performance.now() < pb.scheduledStartAt) {
        updateDicePlaybackDebugSnapshot({
          status: 'buffering',
          totalFrames: pb.frames.length,
          currentFrame: 0,
          elapsedMs: 0,
          remainingMs: Math.round(pb.scheduledStartAt - performance.now()),
        });
        updateRenderedDiceDebugSnapshot(diceRefs, camera);
        return;
      }
      pb.scheduledStartAt = undefined;
      pb.time += Math.min(delta, FRAME_DT);
      const fi = pb.time / FRAME_DT;
      if (pb.preview) lastPreviewPlaybackTime = pb.time;
      updateDicePlaybackDebugSnapshot({
        status: 'playing',
        totalFrames: pb.frames.length,
        currentFrame: Math.min(Math.floor(fi), lastIdx),
        elapsedMs: Math.round(pb.time * 1000),
        remainingMs: Math.max(0, Math.round((lastIdx - fi) * FRAME_DT * 1000)),
      });

      if (fi < lastIdx) {
        const f0 = Math.floor(fi);
        const f1 = f0 + 1;
        const alpha = fi - f0;
        const frameA = pb.frames[f0];
        const frameB = pb.frames[f1];
        frameA.forEach((stateA: any, idx: number) => {
          const mesh = diceRefs.current[idx];
          if (!mesh) return;
          const stateB = frameB[idx];
          mesh.position.set(
            stateA.position.x + (stateB.position.x - stateA.position.x) * alpha,
            stateA.position.y + (stateB.position.y - stateA.position.y) * alpha,
            stateA.position.z + (stateB.position.z - stateA.position.z) * alpha,
          );
          _lerpQA.set(stateA.quaternion.x, stateA.quaternion.y, stateA.quaternion.z, stateA.quaternion.w);
          _lerpQB.set(stateB.quaternion.x, stateB.quaternion.y, stateB.quaternion.z, stateB.quaternion.w);
          _lerpQA.slerp(_lerpQB, alpha);
          mesh.quaternion.copy(_lerpQA);
        });
      } else {
        playbackData.current = null;
        if (pb.preview) {
          updateDicePlaybackDebugSnapshot({
            status: 'waitingForServer',
            totalFrames: pb.frames.length,
            currentFrame: lastIdx,
            elapsedMs: Math.round(pb.time * 1000),
            remainingMs: 0,
          });
          updateRenderedDiceDebugSnapshot(diceRefs, camera);
          return;
        }
        useGameStore.getState().setIsWaitingForPlacement(true);
        updateDicePlaybackDebugSnapshot({
          status: 'waitingForPlacement',
          totalFrames: pb.frames.length,
          currentFrame: lastIdx,
          elapsedMs: Math.round(pb.time * 1000),
          remainingMs: 400,
        });
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
          updateDicePlaybackDebugSnapshot({
            status: 'placement',
            totalFrames: pb.frames.length,
            currentFrame: lastIdx,
            elapsedMs: Math.round(pb.time * 1000),
            remainingMs: 0,
          });
        }, 400);
      }
      updateRenderedDiceDebugSnapshot(diceRefs, camera);
      return;
    }

    // Online opponent shake: apply interpolated dice data from network
    if (store.gameMode === 'online' && !isMyTurn() && isShakeActive()) {
      const frame = interpolateShake();
      if (frame && frame.diceStates.length === 5) {
        frame.diceStates.forEach((ds, idx) => {
          const mesh = diceRefs.current[idx];
          if (mesh) {
            mesh.position.set(ds.position.x, ds.position.y, ds.position.z);
            mesh.quaternion.set(ds.quaternion.x, ds.quaternion.y, ds.quaternion.z, ds.quaternion.w);
          }
        });
      }
      updateRenderedDiceDebugSnapshot(diceRefs, camera);
      return;
    }

    // Live physics: fixed-rate accumulator so speed is independent of display refresh rate
    const PHYSICS_DT = 1 / 60;
    const physics = getPhysicsEngine();
    if (physics) {
      physicsAccum.current += Math.min(delta, 0.1);
      while (physicsAccum.current >= PHYSICS_DT) {
        physics.step();
        physicsAccum.current -= PHYSICS_DT;
      }
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
      updateRenderedDiceDebugSnapshot(diceRefs, camera);
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
            if (!isMyTurn()) return;
            const s = useGameStore.getState();
            const isKept = s.keptDiceSlots.includes(idx);
            if (isKept) {
              s.unkeepDie(idx);
              soundManager.play('tap_smooth');
              if (s.gameMode === 'online') {
                const sock = getSocket();
                if (sock) sock.emit('UNKEEP_DIE', { turnNumber: s.onlineTurnNumber, dieIndex: idx });
              }
            } else if (s.placementOrder.includes(idx)) {
              s.keepDie(idx);
              soundManager.play('tap');
              if (s.gameMode === 'online') {
                const sock = getSocket();
                if (sock) sock.emit('KEEP_DIE', { turnNumber: s.onlineTurnNumber, dieIndex: idx });
              }
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
