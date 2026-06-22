import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGameStore, isMyTurn } from '../../store/gameStore';
import { soundManager } from '../../utils/soundManager';
import { getPhysicsEngine, emitPourResult, onPourResult, onAiPour } from '../../physics/physicsEngine';
import { getSocket } from '../../network/socket';
import { interpolateShake, isShakeActive } from '../../network/shakeBuffer';
import type { PourResult } from '../../physics/PhysicsWorld';
import { pushDebugLog } from '../ui/DebugOverlay';
import * as THREE from 'three';
import { BOARD_CONSTANTS } from '@yacht/core';

const { CUP_REST_X, CUP_REST_Y, CUP_REST_Z } = BOARD_CONSTANTS;

const POURING_DELAY_MS = 1000;
const AI_SHAKE_DURATION = 1.1;
const AI_SHAKE_TIMEOUT = 5;

const _slerp = new THREE.Quaternion();
const _slerpB = new THREE.Quaternion();
const _cupRestPos = new THREE.Vector3(CUP_REST_X, CUP_REST_Y, CUP_REST_Z);
const FIXED_INPUT_DT = 1 / 60;
const MAX_FIXED_INPUT_STEPS = 5;
const CUP_FOLLOW_ALPHA = 0.2;
const OPPONENT_SHAKE_HOLD_MS = 700;
let lastPreviewCupPlaybackTime = 0;
let awaitingAuthoritativeCupResult = false;

type CupPlayback = { frames: any[], time: number, preview?: boolean, scheduledStartAt?: number };

interface CupVisualDebugSnapshot {
  updatedAt: number;
  updatedAtIso: string;
  source: 'idle' | 'dragging' | 'anticipation' | 'cupPlayback' | 'opponentShake' | 'shakeHold' | 'restLerp' | 'cancelled';
  visualPosition: { x: number; y: number; z: number };
  visualQuaternion: { x: number; y: number; z: number; w: number };
  physicsPosition?: { x: number; y: number; z: number };
  physicsQuaternion?: { x: number; y: number; z: number; w: number };
  visualPhysicsDelta?: number;
  playback?: {
    preview: boolean;
    currentFrame: number;
    totalFrames: number;
    elapsedMs: number;
    remainingMs: number;
    buffering?: boolean;
  };
  lastPointerUp?: {
    at: number;
    ageMs: number;
    position: { x: number; y: number; z: number };
    turnNumber: number;
    rollId: number;
  };
}

let cupVisualDebugSnapshot: CupVisualDebugSnapshot | null = null;
let lastCupPointerUp: Omit<NonNullable<CupVisualDebugSnapshot['lastPointerUp']>, 'ageMs'> | null = null;

export function getCupVisualDebugSnapshot(): CupVisualDebugSnapshot | null {
  return cupVisualDebugSnapshot;
}

interface FrameSample {
  t: number;
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number; qw: number;
  src: string;
}

const FRAME_RING_SIZE = 180;
const frameRing: FrameSample[] = [];
let frameRingIdx = 0;
let prevSource: string = '';
const phaseTransitions: Array<{ from: string; to: string; at: number }> = [];
const MAX_TRANSITIONS = 20;

function recordFrame(cup: THREE.Group, source: string): void {
  const sample: FrameSample = {
    t: performance.now(),
    px: cup.position.x, py: cup.position.y, pz: cup.position.z,
    qx: cup.quaternion.x, qy: cup.quaternion.y, qz: cup.quaternion.z, qw: cup.quaternion.w,
    src: source,
  };
  if (frameRing.length < FRAME_RING_SIZE) {
    frameRing.push(sample);
  } else {
    frameRing[frameRingIdx] = sample;
  }
  frameRingIdx = (frameRingIdx + 1) % FRAME_RING_SIZE;

  if (prevSource && source !== prevSource) {
    phaseTransitions.push({ from: prevSource, to: source, at: sample.t });
    if (phaseTransitions.length > MAX_TRANSITIONS) phaseTransitions.shift();
  }
  prevSource = source;
}

export function isCurrentlyFreezing(): boolean {
  const len = frameRing.length;
  if (len < 6) return false;

  const newest = frameRing[(frameRingIdx - 1 + len) % len];
  if (newest.src !== 'opponentShake' && newest.src !== 'shakeHold') return false;

  const samples: FrameSample[] = [];
  for (let k = 0; k < 6; k++) {
    samples.unshift(frameRing[(frameRingIdx - 1 - k + len * 2) % len]);
  }

  const speeds: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const dt = b.t - a.t;
    if (dt <= 0) { speeds.push(0); continue; }
    const dx = b.px - a.px, dy = b.py - a.py, dz = b.pz - a.pz;
    speeds.push(Math.sqrt(dx * dx + dy * dy + dz * dz) / dt);
  }

  const recentSpeed = speeds[speeds.length - 1];
  const priorAvg = speeds.slice(0, -2).reduce((a, b) => a + b, 0) / Math.max(1, speeds.length - 2);

  if (recentSpeed < 0.0001 && priorAvg > 0.001) return true;
  if (priorAvg > 0.005 && recentSpeed < priorAvg * 0.1) return true;

  return false;
}

export function getCupFrameTrace() {
  const ordered: FrameSample[] = [];
  const len = frameRing.length;
  for (let i = 0; i < len; i++) {
    ordered.push(frameRing[(frameRingIdx + i) % len]);
  }

  const freezes: Array<{ startIdx: number; frames: number; durationMs: number; source: string }> = [];
  let freezeStart = -1;
  let freezeCount = 0;
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1];
    const b = ordered[i];
    const dx = b.px - a.px, dy = b.py - a.py, dz = b.pz - a.pz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dq = Math.abs(a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw);
    const isFrozen = dist < 0.001 && dq > 0.9999;
    if (isFrozen) {
      if (freezeStart < 0) freezeStart = i - 1;
      freezeCount++;
    } else if (freezeStart >= 0) {
      if (freezeCount >= 3) {
        freezes.push({
          startIdx: freezeStart,
          frames: freezeCount + 1,
          durationMs: Math.round(ordered[i - 1].t - ordered[freezeStart].t),
          source: ordered[freezeStart].src,
        });
      }
      freezeStart = -1;
      freezeCount = 0;
    }
  }
  if (freezeStart >= 0 && freezeCount >= 3) {
    const last = ordered[ordered.length - 1];
    freezes.push({
      startIdx: freezeStart,
      frames: freezeCount + 1,
      durationMs: Math.round(last.t - ordered[freezeStart].t),
      source: ordered[freezeStart].src,
    });
  }

  const frameGaps = ordered.slice(1).map((b, i) => Math.round(b.t - ordered[i].t));
  const sortedGaps = [...frameGaps].sort((a, b) => a - b);

  return {
    totalFrames: ordered.length,
    frameGap: sortedGaps.length > 0 ? {
      min: sortedGaps[0],
      median: sortedGaps[Math.floor(sortedGaps.length / 2)],
      max: sortedGaps[sortedGaps.length - 1],
    } : null,
    freezes,
    phaseTransitions: phaseTransitions.map(t => ({
      from: t.from,
      to: t.to,
      atIso: new Date(performance.timeOrigin + t.at).toISOString(),
    })),
  };
}

export function PhysicsCup() {
  const cupRef = useRef<THREE.Group>(null);
  const isDragging = useRef(false);
  const isPouring = useRef(false);
  const prevCupPos = useRef(new THREE.Vector3());
  const canPour = useGameStore(state => state.canPour);
  const { camera, pointer } = useThree();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CUP_REST_Y);
  const raycaster = useRef(new THREE.Raycaster());
  const rayTarget = useRef(new THREE.Vector3());

  const cupPlayback = useRef<CupPlayback | null>(null);
  const aiShake = useRef<{ t: number; center: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const fixedInputAccum = useRef(0);
  const shakeSeq = useRef(0);
  const opponentShakeSound = useRef(false);
  const lastOpponentShakeAt = useRef(0);

  // 사람/AI 공용 붓기 진입점 — 성공 시 PourResult가 발행되어 재생이 시작된다
  const tryPour = (): boolean => {
    const physics = getPhysicsEngine();
    if (!physics || !cupRef.current) return false;
    physics.reconcileDiceInCupPositions();
    if (!physics.allDiceReadyToPour()) return false;
    const result = physics.simulatePour(
      {
        x: cupRef.current.position.x,
        y: cupRef.current.position.y,
        z: cupRef.current.position.z
      },
      {
        x: cupRef.current.quaternion.x,
        y: cupRef.current.quaternion.y,
        z: cupRef.current.quaternion.z,
        w: cupRef.current.quaternion.w
      }
    );
    emitPourResult(result);
    return true;
  };
  const tryPourRef = useRef(tryPour);
  tryPourRef.current = tryPour;

  // 붓기 결과 재생 — 사람 붓기든 AI 붓기든 같은 경로
  useEffect(() => {
    const unsubPour = onPourResult((result) => {
      aiShake.current = null;
      if (!result.preview && awaitingAuthoritativeCupResult) {
        awaitingAuthoritativeCupResult = false;
        lastPreviewCupPlaybackTime = 0;
        return;
      }
      if (result.preview) {
        awaitingAuthoritativeCupResult = true;
      }
      const frames = result.cupTrajectory;
      const FRAME_DT = 1 / 60;
      const initialTime = !result.preview && lastPreviewCupPlaybackTime > 0
        ? Math.min(lastPreviewCupPlaybackTime, Math.max(0, (frames.length - 1) * FRAME_DT))
        : 0;
      if (!result.preview) lastPreviewCupPlaybackTime = 0;
      isPouring.current = true;
      cupPlayback.current = { frames, time: initialTime, preview: result.preview, scheduledStartAt: result.scheduledStartAt };
      soundManager.stopLoop('rolling_dice', 200);
      if (result.preview || initialTime === 0) {
        soundManager.play('pouring_dice', { delay: POURING_DELAY_MS });
      }
    });

    // AI 붓기 요청 → 보드 위 랜덤 지점으로 이동하며 셰이크 시작
    const unsubAi = onAiPour(() => {
      if (isPouring.current || aiShake.current || !cupRef.current) return;
      if (!useGameStore.getState().canPour) return;
      const target = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        CUP_REST_Y,
        (Math.random() - 0.5) * 4 - 1
      );
      aiShake.current = { t: 0, center: cupRef.current.position.clone(), target };
      soundManager.startLoop('rolling_dice', 0);
    });

    return () => {
      unsubPour();
      unsubAi();
      soundManager.stopLoop('rolling_dice');
    };
  }, []);

  useEffect(() => {
    const handleUp = () => {
      if (!isDragging.current || !cupRef.current) {
        isDragging.current = false;
        return;
      }

      soundManager.stopLoop('rolling_dice', 500);

      const s = useGameStore.getState();
      const sock = getSocket();
      pushDebugLog('POUR_POINTER_UP', {
        canPourHook: canPour,
        storeCanPour: s.canPour,
        gameMode: s.gameMode,
        connected: s.isConnected,
        hasSocket: Boolean(sock),
        turnNumber: s.onlineTurnNumber,
        rollId: s.onlineRollId,
        shakeEmitted: shakeSeq.current,
        pos: {
          x: +cupRef.current.position.x.toFixed(2),
          y: +cupRef.current.position.y.toFixed(2),
          z: +cupRef.current.position.z.toFixed(2),
        },
      });
      lastCupPointerUp = {
        at: Date.now(),
        position: {
          x: cupRef.current.position.x,
          y: cupRef.current.position.y,
          z: cupRef.current.position.z,
        },
        turnNumber: s.onlineTurnNumber,
        rollId: s.onlineRollId,
      };

      if (canPour) {
        if (s.gameMode === 'online') {
          s.setCanPour(false);
          if (sock) {
            const physics = getPhysicsEngine();
            const pourPos = { x: cupRef.current!.position.x, y: cupRef.current!.position.y, z: cupRef.current!.position.z };
            const pourQuat = { x: cupRef.current!.quaternion.x, y: cupRef.current!.quaternion.y, z: cupRef.current!.quaternion.z, w: cupRef.current!.quaternion.w };

            // Client-authoritative motion: simulate the pour locally (exactly
            // what this player sees), then ship the result so the spectator
            // replays the identical trajectory instead of a server re-sim.
            let localResult: PourResult | null = null;
            if (physics) {
              // Final shake frame: cup + dice from the same physics snapshot.
              const cupState = physics.getCupState();
              sock.emit('CUP_SHAKE_STATE', {
                turnNumber: s.onlineTurnNumber,
                seq: shakeSeq.current++,
                clientSentAt: Date.now(),
                cupPosition: cupState.position,
                cupQuaternion: cupState.quaternion,
                diceStates: physics.getDiceStates(),
              });
              physics.reconcileDiceInCupPositions();
              if (physics.allDiceReadyToPour()) {
                const simStartedAt = Date.now();
                localResult = physics.simulatePour(pourPos, pourQuat);
                pushDebugLog('LOCAL_FINAL_POUR', {
                  frames: localResult.diceTrajectory.length,
                  simMs: Date.now() - simStartedAt,
                });
              } else {
                pushDebugLog('LOCAL_PREVIEW_SKIPPED', { reason: 'dice_not_ready' });
              }
            }

            sock.emit('POUR_CUP', {
              turnNumber: s.onlineTurnNumber,
              position: pourPos,
              quaternion: pourQuat,
              ...(localResult ? {
                finalValues: localResult.finalValues,
                diceTrajectory: localResult.diceTrajectory,
                cupTrajectory: localResult.cupTrajectory,
              } : {}),
            });
            pushDebugLog('POUR_CUP_EMIT', {
              turnNumber: s.onlineTurnNumber,
              rollId: s.onlineRollId,
              connected: s.isConnected,
              hasResult: Boolean(localResult),
              pos: { x: +pourPos.x.toFixed(2), y: +pourPos.y.toFixed(2), z: +pourPos.z.toFixed(2) },
            });

            if (localResult) {
              // Play our own result as final — no preview, no server reconcile.
              emitPourResult(localResult);
            }
            // If dice weren't ready, the server falls back to its own sim and
            // broadcasts POUR_RESULT to the whole room (roller included).
          } else {
            s.setCanPour(true);
            pushDebugLog('POUR_CUP_BLOCKED', { reason: 'missing_socket' });
          }
        } else {
          tryPourRef.current();
        }
      }

      isDragging.current = false;
    };
    window.addEventListener('pointerup', handleUp);
    return () => window.removeEventListener('pointerup', handleUp);
  }, [canPour]);

  useFrame((_, delta) => {
    if (!cupRef.current) return;

    if (cupPlayback.current?.preview && useGameStore.getState().canPour) {
      cupPlayback.current = null;
      isPouring.current = false;
      lastPreviewCupPlaybackTime = 0;
      cupRef.current.position.set(CUP_REST_X, CUP_REST_Y, CUP_REST_Z);
      cupRef.current.quaternion.set(0, 0, 0, 1);
      updateCupVisualDebugSnapshot('cancelled', cupRef.current, cupPlayback.current);
      return;
    }

    if (cupPlayback.current) {
      const FRAME_DT = 1 / 60;
      const pb = cupPlayback.current;
      const lastIdx = pb.frames.length - 1;

      if (pb.scheduledStartAt && performance.now() < pb.scheduledStartAt) {
        updateCupVisualDebugSnapshot('cupPlayback', cupRef.current, pb);
        return;
      }
      pb.scheduledStartAt = undefined;
      pb.time += Math.min(delta, FRAME_DT);
      if (pb.preview) lastPreviewCupPlaybackTime = pb.time;
      const fi = pb.time / FRAME_DT;

      if (fi < lastIdx) {
        const f0 = Math.floor(fi);
        const f1 = f0 + 1;
        const alpha = fi - f0;
        const a = pb.frames[f0];
        const b = pb.frames[f1];
        cupRef.current.position.set(
          a.position.x + (b.position.x - a.position.x) * alpha,
          a.position.y + (b.position.y - a.position.y) * alpha,
          a.position.z + (b.position.z - a.position.z) * alpha,
        );
        _slerp.set(a.quaternion.x, a.quaternion.y, a.quaternion.z, a.quaternion.w);
        _slerpB.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        _slerp.slerp(_slerpB, alpha);
        cupRef.current.quaternion.copy(_slerp);
      } else {
        cupPlayback.current = null;
        isPouring.current = false;
        cupRef.current.position.set(CUP_REST_X, CUP_REST_Y, CUP_REST_Z);
        cupRef.current.quaternion.set(0, 0, 0, 1);
      }
      updateCupVisualDebugSnapshot('cupPlayback', cupRef.current, pb);
      return;
    }

    // AI 셰이크: 목표 지점으로 이동하며 진동 — 내부 주사위도 실제로 덜그럭거림
    if (aiShake.current) {
      const shake = aiShake.current;
      shake.t += delta;
      const physics = getPhysicsEngine();

      shake.center.lerp(shake.target, Math.min(1, delta * 4));
      const damp = Math.min(1, shake.t / 0.25);
      const amp = 0.55 * damp;
      cupRef.current.position.set(
        shake.center.x + Math.sin(shake.t * 24) * amp,
        shake.center.y + Math.abs(Math.sin(shake.t * 12)) * 0.2 * damp,
        shake.center.z + Math.cos(shake.t * 17) * amp * 0.6
      );

      soundManager.setLoopVolume('rolling_dice', 0.35 + 0.3 * damp);

      if (physics) {
        physics.updateCupTransform(
          { x: cupRef.current.position.x, y: cupRef.current.position.y, z: cupRef.current.position.z },
          { x: cupRef.current.quaternion.x, y: cupRef.current.quaternion.y, z: cupRef.current.quaternion.z, w: cupRef.current.quaternion.w }
        );
      }

      const ready = physics ? physics.allDiceReadyToPour() : false;
      if (shake.t >= AI_SHAKE_DURATION && ready && useGameStore.getState().canPour) {
        aiShake.current = null;
        soundManager.stopLoop('rolling_dice', 400);
        tryPourRef.current();
      } else if (shake.t >= AI_SHAKE_TIMEOUT) {
        // 안전장치: 비정상 상태에서 무한 셰이크 방지 — 마지막으로 붓기 시도
        aiShake.current = null;
        soundManager.stopLoop('rolling_dice', 200);
        if (!tryPourRef.current()) {
          console.warn('[AI] pour failed after shake timeout');
        }
      }
      updateCupVisualDebugSnapshot('dragging', cupRef.current, null);
      return;
    }

    // Opponent shake interpolation (online, not my turn)
    const s = useGameStore.getState();
    if (s.gameMode === 'online' && !isMyTurn() && !isDragging.current) {
      if (isShakeActive()) {
        if (!opponentShakeSound.current) {
          opponentShakeSound.current = true;
          soundManager.startLoop('rolling_dice', 0.35);
        }
        const frame = interpolateShake();
        if (frame) {
          lastOpponentShakeAt.current = performance.now();
          cupRef.current.position.set(frame.cupPosition.x, frame.cupPosition.y, frame.cupPosition.z);
          if (frame.cupQuaternion) {
            cupRef.current.quaternion.set(frame.cupQuaternion.x, frame.cupQuaternion.y, frame.cupQuaternion.z, frame.cupQuaternion.w);
          }
          updateCupVisualDebugSnapshot('opponentShake', cupRef.current, null);
        }
      } else if (opponentShakeSound.current) {
        const shouldReturnToRest = performance.now() - lastOpponentShakeAt.current > OPPONENT_SHAKE_HOLD_MS;
        if (shouldReturnToRest) {
          opponentShakeSound.current = false;
          soundManager.stopLoop('rolling_dice', 200);
          cupRef.current.position.lerp(_cupRestPos, Math.min(1, delta * 8));
          cupRef.current.quaternion.slerp(_slerp.set(0, 0, 0, 1), Math.min(1, delta * 8));
          updateCupVisualDebugSnapshot('restLerp', cupRef.current, null);
        } else {
          updateCupVisualDebugSnapshot('shakeHold', cupRef.current, null);
        }
      } else {
        cupRef.current.position.lerp(_cupRestPos, Math.min(1, delta * 8));
        cupRef.current.quaternion.slerp(_slerp.set(0, 0, 0, 1), Math.min(1, delta * 8));
        updateCupVisualDebugSnapshot('restLerp', cupRef.current, null);
      }
      return;
    }

    if (!isDragging.current) {
      updateCupVisualDebugSnapshot('idle', cupRef.current, null);
      return;
    }

    const physics = getPhysicsEngine();
    if (!physics) {
      updateCupVisualDebugSnapshot('dragging', cupRef.current, null);
      return;
    }

    raycaster.current.setFromCamera(pointer, camera);
    raycaster.current.ray.intersectPlane(plane, rayTarget.current);
    if (!rayTarget.current) {
      updateCupVisualDebugSnapshot('dragging', cupRef.current, null);
      return;
    }

    fixedInputAccum.current += Math.min(delta, 0.1);
    let steps = 0;

    while (fixedInputAccum.current >= FIXED_INPUT_DT && steps < MAX_FIXED_INPUT_STEPS) {
      cupRef.current.position.lerp(rayTarget.current, CUP_FOLLOW_ALPHA);

      const speed = cupRef.current.position.distanceTo(prevCupPos.current);
      prevCupPos.current.copy(cupRef.current.position);
      const volume = Math.min(speed / 0.8, 1);
      soundManager.setLoopVolume('rolling_dice', volume);

      physics.updateCupTransform(
        { x: cupRef.current.position.x, y: cupRef.current.position.y, z: cupRef.current.position.z },
        { x: cupRef.current.quaternion.x, y: cupRef.current.quaternion.y, z: cupRef.current.quaternion.z, w: cupRef.current.quaternion.w }
      );

      if (s.gameMode === 'online') {
        const sock = getSocket();
        if (sock) {
          // Send the cup and dice from the SAME physics snapshot (last step) so
          // they stay glued for the spectator. Using the rendered cupRef here
          // (one frame ahead of the not-yet-stepped dice) makes the dice look
          // detached from the cup on the spectator's screen.
          const cupState = physics.getCupState();
          sock.emit('CUP_SHAKE_STATE', {
            turnNumber: s.onlineTurnNumber,
            seq: shakeSeq.current++,
            clientSentAt: Date.now(),
            cupPosition: cupState.position,
            cupQuaternion: cupState.quaternion,
            diceStates: physics.getDiceStates(),
          });
        }
      }

      fixedInputAccum.current -= FIXED_INPUT_DT;
      steps++;
    }

    if (steps >= MAX_FIXED_INPUT_STEPS) {
      fixedInputAccum.current = 0;
    }
    updateCupVisualDebugSnapshot('dragging', cupRef.current, null);
  });

  return (
    <group
      ref={cupRef}
      position={[CUP_REST_X, CUP_REST_Y, CUP_REST_Z]}
      onPointerDown={(e) => {
        if (isPouring.current || aiShake.current || !canPour || !isMyTurn()) return;
        e.stopPropagation();
        isDragging.current = true;
        fixedInputAccum.current = 0;
        if (cupRef.current) prevCupPos.current.copy(cupRef.current.position);
        soundManager.startLoop('rolling_dice', 0);
      }}
      onPointerOver={() => document.body.style.cursor = 'grab'}
      onPointerOut={() => document.body.style.cursor = 'auto'}
    >
      <mesh castShadow receiveShadow position={[0, -4, 0]}>
        <cylinderGeometry args={[4.4, 4.4, 0.4, 32]} />
        <meshStandardMaterial color="#8B4513" />
      </mesh>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[4.4, 4.4, 8, 32, 1, true]} />
        <meshStandardMaterial color="#8B4513" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function updateCupVisualDebugSnapshot(
  source: CupVisualDebugSnapshot['source'],
  cup: THREE.Group,
  playback: CupPlayback | null,
): void {
  recordFrame(cup, source);
  const updatedAt = Date.now();
  const physicsCup = getPhysicsEngine()?.getCupState();
  const dx = physicsCup ? cup.position.x - physicsCup.position.x : 0;
  const dy = physicsCup ? cup.position.y - physicsCup.position.y : 0;
  const dz = physicsCup ? cup.position.z - physicsCup.position.z : 0;
  const frameDt = 1 / 60;
  const currentFrame = playback ? Math.min(Math.floor(playback.time / frameDt), Math.max(0, playback.frames.length - 1)) : 0;

  cupVisualDebugSnapshot = {
    updatedAt,
    updatedAtIso: new Date(updatedAt).toISOString(),
    source,
    visualPosition: {
      x: +cup.position.x.toFixed(2),
      y: +cup.position.y.toFixed(2),
      z: +cup.position.z.toFixed(2),
    },
    visualQuaternion: {
      x: +cup.quaternion.x.toFixed(3),
      y: +cup.quaternion.y.toFixed(3),
      z: +cup.quaternion.z.toFixed(3),
      w: +cup.quaternion.w.toFixed(3),
    },
    physicsPosition: physicsCup ? {
      x: +physicsCup.position.x.toFixed(2),
      y: +physicsCup.position.y.toFixed(2),
      z: +physicsCup.position.z.toFixed(2),
    } : undefined,
    physicsQuaternion: physicsCup ? {
      x: +physicsCup.quaternion.x.toFixed(3),
      y: +physicsCup.quaternion.y.toFixed(3),
      z: +physicsCup.quaternion.z.toFixed(3),
      w: +physicsCup.quaternion.w.toFixed(3),
    } : undefined,
    visualPhysicsDelta: physicsCup ? +Math.sqrt(dx * dx + dy * dy + dz * dz).toFixed(2) : undefined,
    playback: playback ? {
      preview: Boolean(playback.preview),
      currentFrame,
      totalFrames: playback.frames.length,
      elapsedMs: Math.round(playback.time * 1000),
      remainingMs: playback.scheduledStartAt && performance.now() < playback.scheduledStartAt
        ? Math.round(playback.scheduledStartAt - performance.now())
        : Math.max(0, Math.round(((playback.frames.length - 1) * frameDt - playback.time) * 1000)),
      buffering: Boolean(playback.scheduledStartAt && performance.now() < playback.scheduledStartAt),
    } : undefined,
    lastPointerUp: lastCupPointerUp ? {
      ...lastCupPointerUp,
      ageMs: updatedAt - lastCupPointerUp.at,
      position: {
        x: +lastCupPointerUp.position.x.toFixed(2),
        y: +lastCupPointerUp.position.y.toFixed(2),
        z: +lastCupPointerUp.position.z.toFixed(2),
      },
    } : undefined,
  };
}
