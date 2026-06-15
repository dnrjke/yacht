import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGameStore, isMyTurn } from '../../store/gameStore';
import { soundManager } from '../../utils/soundManager';
import { getPhysicsEngine, emitPourResult, onPourResult, onAiPour } from '../../physics/physicsEngine';
import { getSocket } from '../../network/socket';
import { interpolateShake, isShakeActive } from '../../network/shakeBuffer';
import * as THREE from 'three';
import { BOARD_CONSTANTS } from '@yacht/core';

const { CUP_REST_X, CUP_REST_Y, CUP_REST_Z } = BOARD_CONSTANTS;

const POURING_DELAY_MS = 1000;
const AI_SHAKE_DURATION = 1.1;
const AI_SHAKE_TIMEOUT = 5;
const ONLINE_ANTICIPATION_DURATION = 0.18;
const ONLINE_BRIDGE_FRAMES = 8;

const _slerp = new THREE.Quaternion();
const _slerpB = new THREE.Quaternion();
const _anticipationStartQuat = new THREE.Quaternion();
const _anticipationTargetQuat = new THREE.Quaternion();
const _anticipationTilt = new THREE.Quaternion();
const _anticipationAxis = new THREE.Vector3();
const _cupRestPos = new THREE.Vector3(CUP_REST_X, CUP_REST_Y, CUP_REST_Z);
const FIXED_INPUT_DT = 1 / 60;
const MAX_FIXED_INPUT_STEPS = 5;
const CUP_FOLLOW_ALPHA = 0.2;
const OPPONENT_SHAKE_HOLD_MS = 700;

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

  const cupPlayback = useRef<{ frames: any[], time: number } | null>(null);
  const anticipation = useRef<{
    time: number;
    startPos: THREE.Vector3;
    startQuat: THREE.Quaternion;
    targetPos: THREE.Vector3;
    targetQuat: THREE.Quaternion;
  } | null>(null);
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
      const frames = cupRef.current && anticipation.current
        ? buildCupBridgeFrames(cupRef.current, result.cupTrajectory)
        : result.cupTrajectory;
      anticipation.current = null;
      isPouring.current = true;
      cupPlayback.current = { frames, time: 0 };
      soundManager.stopLoop('rolling_dice', 200);
      soundManager.play('pouring_dice', { delay: POURING_DELAY_MS });
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

      if (canPour) {
        const s = useGameStore.getState();
        if (s.gameMode === 'online') {
          s.setCanPour(false);
          anticipation.current = createOnlineAnticipation(cupRef.current);
          const sock = getSocket();
          if (sock) {
            const physics = getPhysicsEngine();
            if (physics) {
              sock.emit('CUP_SHAKE_STATE', {
                turnNumber: s.onlineTurnNumber,
                seq: shakeSeq.current++,
                clientSentAt: Date.now(),
                cupPosition: { x: cupRef.current!.position.x, y: cupRef.current!.position.y, z: cupRef.current!.position.z },
                cupQuaternion: { x: cupRef.current!.quaternion.x, y: cupRef.current!.quaternion.y, z: cupRef.current!.quaternion.z, w: cupRef.current!.quaternion.w },
                diceStates: physics.getDiceStates(),
              });
            }
            sock.emit('POUR_CUP', {
              turnNumber: s.onlineTurnNumber,
              position: { x: cupRef.current!.position.x, y: cupRef.current!.position.y, z: cupRef.current!.position.z },
              quaternion: { x: cupRef.current!.quaternion.x, y: cupRef.current!.quaternion.y, z: cupRef.current!.quaternion.z, w: cupRef.current!.quaternion.w },
            });
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

    if (cupPlayback.current) {
      const FRAME_DT = 1 / 60;
      const pb = cupPlayback.current;
      const lastIdx = pb.frames.length - 1;

      pb.time += Math.min(delta, FRAME_DT);
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
      return;
    }

    if (anticipation.current && useGameStore.getState().canPour) {
      anticipation.current = null;
      cupRef.current.position.set(CUP_REST_X, CUP_REST_Y, CUP_REST_Z);
      cupRef.current.quaternion.set(0, 0, 0, 1);
      return;
    }

    if (anticipation.current) {
      const a = anticipation.current;
      a.time = Math.min(a.time + delta, ONLINE_ANTICIPATION_DURATION);
      const t = 1 - Math.pow(1 - a.time / ONLINE_ANTICIPATION_DURATION, 3);
      cupRef.current.position.lerpVectors(a.startPos, a.targetPos, t);
      cupRef.current.quaternion.slerpQuaternions(a.startQuat, a.targetQuat, t);
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
        }
      } else if (opponentShakeSound.current) {
        const shouldReturnToRest = performance.now() - lastOpponentShakeAt.current > OPPONENT_SHAKE_HOLD_MS;
        if (shouldReturnToRest) {
          opponentShakeSound.current = false;
          soundManager.stopLoop('rolling_dice', 200);
          cupRef.current.position.lerp(_cupRestPos, Math.min(1, delta * 8));
          cupRef.current.quaternion.slerp(_slerp.set(0, 0, 0, 1), Math.min(1, delta * 8));
        }
      } else {
        cupRef.current.position.lerp(_cupRestPos, Math.min(1, delta * 8));
        cupRef.current.quaternion.slerp(_slerp.set(0, 0, 0, 1), Math.min(1, delta * 8));
      }
      return;
    }

    if (!isDragging.current) return;

    const physics = getPhysicsEngine();
    if (!physics) return;

    raycaster.current.setFromCamera(pointer, camera);
    raycaster.current.ray.intersectPlane(plane, rayTarget.current);
    if (!rayTarget.current) return;

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
          sock.emit('CUP_SHAKE_STATE', {
            turnNumber: s.onlineTurnNumber,
            seq: shakeSeq.current++,
            clientSentAt: Date.now(),
            cupPosition: { x: cupRef.current.position.x, y: cupRef.current.position.y, z: cupRef.current.position.z },
            cupQuaternion: { x: cupRef.current.quaternion.x, y: cupRef.current.quaternion.y, z: cupRef.current.quaternion.z, w: cupRef.current.quaternion.w },
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

function createOnlineAnticipation(cup: THREE.Group): {
  time: number;
  startPos: THREE.Vector3;
  startQuat: THREE.Quaternion;
  targetPos: THREE.Vector3;
  targetQuat: THREE.Quaternion;
} {
  const startPos = cup.position.clone();
  const targetPos = startPos.clone();
  const dx = -startPos.x;
  const dz = -startPos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist > 0.1) {
    _anticipationAxis.set(dz / dist, 0, -dx / dist);
  } else {
    _anticipationAxis.set(0, 0, 1);
  }

  _anticipationStartQuat.copy(cup.quaternion);
  _anticipationTilt.setFromAxisAngle(_anticipationAxis, (22 * Math.PI) / 180);
  _anticipationTargetQuat.copy(_anticipationTilt).multiply(_anticipationStartQuat);

  targetPos.y += 0.25;

  return {
    time: 0,
    startPos,
    startQuat: _anticipationStartQuat.clone(),
    targetPos,
    targetQuat: _anticipationTargetQuat.clone(),
  };
}

function buildCupBridgeFrames(cup: THREE.Group, trajectory: any[]): any[] {
  if (trajectory.length === 0) return trajectory;

  const first = trajectory[0];
  const bridge = [];
  _slerp.set(cup.quaternion.x, cup.quaternion.y, cup.quaternion.z, cup.quaternion.w);
  _slerpB.set(first.quaternion.x, first.quaternion.y, first.quaternion.z, first.quaternion.w);

  for (let i = 1; i <= ONLINE_BRIDGE_FRAMES; i++) {
    const t = i / ONLINE_BRIDGE_FRAMES;
    const eased = 1 - Math.pow(1 - t, 3);
    const q = _slerp.clone().slerp(_slerpB, eased);
    bridge.push({
      position: {
        x: cup.position.x + (first.position.x - cup.position.x) * eased,
        y: cup.position.y + (first.position.y - cup.position.y) * eased,
        z: cup.position.z + (first.position.z - cup.position.z) * eased,
      },
      quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
    });
  }

  return [...bridge, ...trajectory];
}
