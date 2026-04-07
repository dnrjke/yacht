import { useRef, useEffect, useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import * as THREE from 'three';
import { YACHT_CONSTANTS, BOARD_CONSTANTS, detectCombo } from '@yacht/core';
import { useFrame } from '@react-three/fiber';

// Face normal in local die space for each value.
// Matches PhysicsWorld material mapping: +x=2, -x=5, +y=1, -y=6, +z=3, -z=4
const FACE_NORMALS: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0),
  2: new THREE.Vector3(1, 0, 0),
  3: new THREE.Vector3(0, 0, 1),
  4: new THREE.Vector3(0, 0, -1),
  5: new THREE.Vector3(-1, 0, 0),
  6: new THREE.Vector3(0, -1, 0),
};

// In camera local space, +Z points behind the camera (toward the viewer).
// We rotate each die so its rolled-value face aligns with local +Z → visible to user.
const TOWARD_CAMERA = new THREE.Vector3(0, 0, 1);
const UP_VECTOR = new THREE.Vector3(0, 1, 0); // for tray dice facing up

// Scratch objects — allocated once, reused every frame to avoid GC pressure
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
  const socket = useGameStore(state => state.socket);
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

  // ── DEBUG: track quaternion snaps ──
  const prevQuats = useRef<THREE.Quaternion[]>(Array.from({ length: 5 }, () => new THREE.Quaternion()));
  const debugReadFace = (q: THREE.Quaternion): number => {
    const normals: [THREE.Vector3, number][] = [
      [new THREE.Vector3(0, 1, 0), 1], [new THREE.Vector3(0, -1, 0), 6],
      [new THREE.Vector3(1, 0, 0), 2], [new THREE.Vector3(-1, 0, 0), 5],
      [new THREE.Vector3(0, 0, 1), 3], [new THREE.Vector3(0, 0, -1), 4],
    ];
    let best = 1, maxDot = -Infinity;
    for (const [n, v] of normals) {
      const rotN = n.clone().applyQuaternion(q);
      const dot = rotN.y; // dot with UP
      if (dot > maxDot) { maxDot = dot; best = v; }
    }
    return best;
  };
  const debugCheckSnap = (source: string) => {
    for (let i = 0; i < diceRefs.current.length; i++) {
      const mesh = diceRefs.current[i];
      if (!mesh) continue;
      const angle = prevQuats.current[i].angleTo(mesh.quaternion);
      if (angle > 0.15) { // ~8.6° threshold
        const oldFace = debugReadFace(prevQuats.current[i]);
        const newFace = debugReadFace(mesh.quaternion);
        const store = useGameStore.getState();
        const faceChanged = oldFace !== newFace ? '⚠️ FACE CHANGED' : '';
        console.log(
          `[SNAP] die=${i} src=${source} angle=${(angle * 180 / Math.PI).toFixed(1)}° ` +
          `face:${oldFace}→${newFace} ${faceChanged} ` +
          `storedVal=${store.currentDiceValues[i]} ` +
          `kept=${store.keptDiceSlots.includes(i)} ` +
          `flags={plc=${store.isInPlacementMode},ret=${store.isReturningToCup},sync=${store.isSyncingDice},wait=${store.isWaitingForPlacement}}`
        );
      }
      prevQuats.current[i].copy(mesh.quaternion);
    }
  };
  // ── END DEBUG ──

  const diceMaterials = useMemo(() => [
    new THREE.MeshStandardMaterial({ map: createDiceTexture(2), roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createDiceTexture(5), roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createDiceTexture(1), roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createDiceTexture(6), roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createDiceTexture(3), roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createDiceTexture(4), roughness: 0.3 }),
  ], []);

  useEffect(() => {
    if (!socket) return;

    const handleDiceUpdate = (data: { diceStates: any[] }) => {
      if (playbackData.current) return;
      if (useGameStore.getState().isInPlacementMode) return;
      if (useGameStore.getState().isWaitingForPlacement) return;
      if (useGameStore.getState().isReturningToCup) return;
      if (useGameStore.getState().isSyncingDice) return;

      const keptSet = new Set(
        useGameStore.getState().keptDiceSlots.filter((s): s is number => s !== null)
      );
      data.diceStates.forEach((state, idx) => {
        if (keptSet.has(idx)) return;
        const mesh = diceRefs.current[idx];
        if (mesh) {
          mesh.position.set(state.position.x, state.position.y, state.position.z);
          mesh.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
        }
      });
      debugCheckSnap('DICE_STATES');
    };

    const startPlayback = (frames: any[], finalValues: number[]) => {
      // Cancel any pending placement timer if a new roll starts
      if (placementTimer.current) clearTimeout(placementTimer.current);
      // Exit placement/waiting mode if active
      const store = useGameStore.getState();
      if (store.isInPlacementMode) store.setIsInPlacementMode(false);
      if (store.isWaitingForPlacement) store.setIsWaitingForPlacement(false);
      if (store.isSyncingDice) store.setIsSyncingDice(false);

      playbackData.current = { frames, currentFrame: 0 };
      setCurrentDiceValues(finalValues);
    };

    const handlePourResult = (r: { diceTrajectory: any[]; finalValues: number[] }) => {
      startPlayback(r.diceTrajectory, r.finalValues);
      useGameStore.getState().incrementRollCount();
      useGameStore.getState().setCanPour(false);
    };

    const handleCollectionDone = () => {
      console.log('[DEBUG] COLLECTION_DONE received');
      debugCheckSnap('pre-COLLECTION_DONE');
      const s = useGameStore.getState();
      s.setIsReturningToCup(false);
      s.setIsSyncingDice(false);
      s.setCanPour(true);
    };

    socket.on('DICE_STATES', handleDiceUpdate);
    socket.on('POUR_RESULT', handlePourResult);
    socket.on('COLLECTION_DONE', handleCollectionDone);

    return () => {
      socket.off('DICE_STATES', handleDiceUpdate);
      socket.off('POUR_RESULT', handlePourResult);
      socket.off('COLLECTION_DONE', handleCollectionDone);
      if (placementTimer.current) clearTimeout(placementTimer.current);
    };
  }, [socket, setCurrentDiceValues]);

  useFrame(({ camera, clock }) => {
    const store = useGameStore.getState();
    const cam = camera as THREE.PerspectiveCamera;

    // ── Placement mode: animated camera-attached HUD + tray ─────────────────
    if (store.isInPlacementMode) {
      const hudDepth = 15;
      const fovRad = cam.fov * Math.PI / 180;
      const visibleHeight = 2 * Math.tan(fovRad / 2) * hudDepth;
      const visibleWidth = visibleHeight * cam.aspect;

      _forward.set(0, 0, -1).applyQuaternion(cam.quaternion);
      _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      _center.copy(cam.position).addScaledVector(_forward, hudDepth);

      const hudDice = store.placementOrder; // non-kept dice indices
      const hudCount = hudDice.length;

      // Detect HUD count change → restart animation from current positions
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

      // First-frame init
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

      // ─ HUD row: dynamically centered based on current count ───────────
      if (hudCount > 0) {
        const slotWidth = (visibleWidth * 0.85) / Math.max(hudCount, 1);
        // Halve the scale because the base physics/mesh geometry is now 2x2x2 instead of 1x1x1
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

      // ─ Kept dice: world-space tray slot positions ──────────────────────
      const halfBoard = BOARD_CONSTANTS.BOARD_SIZE / 2;
      const trayCenterZ = -(halfBoard + BOARD_CONSTANTS.WALL_THICKNESS + BOARD_CONSTANTS.TRAY_DEPTH / 2);
      const trayStartX = -((BOARD_CONSTANTS.TRAY_SLOT_COUNT - 1) * BOARD_CONSTANTS.TRAY_SLOT_SPACING) / 2;

      store.keptDiceSlots.forEach((dieIdx, slotIdx) => {
        if (dieIdx === null) return;
        const mesh = diceRefs.current[dieIdx];
        if (!mesh) return;

        _targetPos.set(
          trayStartX + slotIdx * BOARD_CONSTANTS.TRAY_SLOT_SPACING,
          1.0, // half-die sitting on tray surface (dice size 2 implies half height 1)
          trayCenterZ
        );
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

    // ── Exited placement mode: clear animation + reset scale ─────────────────
    if (placementAnim.current) {
      debugCheckSnap('exit-placement');
      placementAnim.current = null;
    }

    // ── Return-to-cup animation (non-kept dice only) ────────────────────
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
      const cupOffsets = [
        { x: cupX - 1.2, y: cupY - 2.5, z: cupZ - 1.2 },
        { x: cupX + 1.2, y: cupY - 2.5, z: cupZ - 1.2 },
        { x: cupX - 1.2, y: cupY - 2.5, z: cupZ + 1.2 },
        { x: cupX + 1.2, y: cupY - 2.5, z: cupZ + 1.2 },
        { x: cupX,       y: cupY - 0.5, z: cupZ       },
      ];
      let cupSlot = 0;

      // Tray positions for kept dice
      const halfBoard = BOARD_CONSTANTS.BOARD_SIZE / 2;
      const trayCenterZ = -(halfBoard + BOARD_CONSTANTS.WALL_THICKNESS + BOARD_CONSTANTS.TRAY_DEPTH / 2);
      const trayStartX = -((BOARD_CONSTANTS.TRAY_SLOT_COUNT - 1) * BOARD_CONSTANTS.TRAY_SLOT_SPACING) / 2;

      for (let idx = 0; idx < diceRefs.current.length; idx++) {
        const mesh = diceRefs.current[idx];
        if (!mesh) continue;

        if (keptSet.has(idx)) {
          // Kept dice: stay at tray position (no animation needed, already placed)
          const slotIdx = store.keptDiceSlots.indexOf(idx);
          if (slotIdx >= 0) {
            mesh.position.set(
              trayStartX + slotIdx * BOARD_CONSTANTS.TRAY_SLOT_SPACING,
              1.0,
              trayCenterZ
            );
            const value = store.currentDiceValues[idx];
            const faceNormal = FACE_NORMALS[value] ?? FACE_NORMALS[1];
            _quat.setFromUnitVectors(faceNormal, UP_VECTOR);
            mesh.quaternion.copy(_quat);
            mesh.scale.setScalar(1);
          }
          continue;
        }

        // Non-kept dice: animate to cup
        const off = cupOffsets[cupSlot % cupOffsets.length];
        cupSlot++;
        _targetPos.set(off.x, off.y, off.z);
        mesh.position.lerpVectors(returnAnim.current.startPositions[idx], _targetPos, t);

        const val = store.currentDiceValues[idx];
        const faceNorm = FACE_NORMALS[val] ?? FACE_NORMALS[1];
        _targetQuat.setFromUnitVectors(faceNorm, UP_VECTOR);

        mesh.quaternion.slerpQuaternions(returnAnim.current.startQuaternions[idx], _targetQuat, t);
        const startScale = returnAnim.current.startScales[idx];
        mesh.scale.setScalar(startScale + (1 - startScale) * t);
      }

      debugCheckSnap('returnAnim-frame');

      if (rawT >= 1) {
        returnAnim.current = null;
        console.log('[DEBUG] returnAnim complete, emitting COLLECT_TO_CUP');
        debugCheckSnap('returnAnim-done');
        // isReturningToCup is cleared in handleCollectionDone to keep the guard active
        const keptIndices = store.keptDiceSlots;
        const socket = store.socket;
        if (socket) {
          socket.emit('COLLECT_TO_CUP', { keptIndices });
        }
      }
      return;
    }
    if (returnAnim.current) returnAnim.current = null;

    for (let idx = 0; idx < diceRefs.current.length; idx++) {
      const mesh = diceRefs.current[idx];
      if (mesh && mesh.scale.x !== 1) mesh.scale.setScalar(1);
    }

    // ── Trajectory playback ─────────────────────────────────────────────────
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
        // Playback finished — freeze positions and wait 1s before entering placement mode
        debugCheckSnap('playback-done');
        playbackData.current = null;
        useGameStore.getState().setIsWaitingForPlacement(true);
        placementTimer.current = setTimeout(() => {
          const s = useGameStore.getState();
          s.setIsWaitingForPlacement(false);
          // Exclude already-kept dice from the new placement order
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
    }
  });

  return (
    <>
      {Array.from({ length: YACHT_CONSTANTS.DICE_COUNT }).map((_, idx) => (
        <mesh
          key={idx}
          ref={el => { diceRefs.current[idx] = el; }}
          castShadow
          receiveShadow
          material={diceMaterials}
          onPointerDown={isInPlacementMode ? (e) => {
            e.stopPropagation();
            const s = useGameStore.getState();
            const isKept = s.keptDiceSlots.includes(idx);
            if (isKept) {
              s.unkeepDie(idx);
            } else if (s.placementOrder.includes(idx)) {
              s.keepDie(idx);
            }
          } : undefined}
        >
          <boxGeometry args={[2, 2, 2]} />
        </mesh>
      ))}
    </>
  );
}
