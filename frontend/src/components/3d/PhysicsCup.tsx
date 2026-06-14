import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGameStore, isAiTurnNow } from '../../store/gameStore';
import { soundManager } from '../../utils/soundManager';
import { getPhysicsEngine, emitPourResult, onPourResult, onAiPour } from '../../physics/physicsEngine';
import * as THREE from 'three';
import { BOARD_CONSTANTS } from '@yacht/core';

const { CUP_REST_X, CUP_REST_Y, CUP_REST_Z } = BOARD_CONSTANTS;

const POURING_DELAY_MS = 1000;
const AI_SHAKE_DURATION = 1.1;
const AI_SHAKE_TIMEOUT = 5;

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
  const aiShake = useRef<{ t: number; center: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  // 사람/AI 공용 붓기 진입점 — 성공 시 PourResult가 발행되어 재생이 시작된다
  const tryPour = (): boolean => {
    const physics = getPhysicsEngine();
    if (!physics || !cupRef.current || !physics.allDiceReadyToPour()) return false;
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
      isPouring.current = true;
      cupPlayback.current = { frames: result.cupTrajectory, time: 0 };
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
        tryPourRef.current();
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
      cupPlayback.current.time += delta;
      const frameIndex = Math.min(
        Math.floor(cupPlayback.current.time / FRAME_DT),
        cupPlayback.current.frames.length - 1
      );
      if (frameIndex < cupPlayback.current.frames.length - 1) {
        const frame = cupPlayback.current.frames[frameIndex];
        cupRef.current.position.set(frame.position.x, frame.position.y, frame.position.z);
        cupRef.current.quaternion.set(frame.quaternion.x, frame.quaternion.y, frame.quaternion.z, frame.quaternion.w);
      } else {
        cupPlayback.current = null;
        isPouring.current = false;
        cupRef.current.position.set(CUP_REST_X, CUP_REST_Y, CUP_REST_Z);
        cupRef.current.quaternion.set(0, 0, 0, 1);
      }
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

    if (!isDragging.current) return;

    const physics = getPhysicsEngine();
    if (!physics) return;

    raycaster.current.setFromCamera(pointer, camera);
    raycaster.current.ray.intersectPlane(plane, rayTarget.current);

    if (rayTarget.current) {
      const target = rayTarget.current;
      cupRef.current.position.lerp(target, 0.2);

      const speed = cupRef.current.position.distanceTo(prevCupPos.current);
      prevCupPos.current.copy(cupRef.current.position);
      const volume = Math.min(speed / 0.8, 1);
      soundManager.setLoopVolume('rolling_dice', volume);

      physics.updateCupTransform(
        { x: cupRef.current.position.x, y: cupRef.current.position.y, z: cupRef.current.position.z },
        { x: cupRef.current.quaternion.x, y: cupRef.current.quaternion.y, z: cupRef.current.quaternion.z, w: cupRef.current.quaternion.w }
      );
    }
  });

  return (
    <group
      ref={cupRef}
      position={[CUP_REST_X, CUP_REST_Y, CUP_REST_Z]}
      onPointerDown={(e) => {
        if (isPouring.current || aiShake.current || !canPour || isAiTurnNow()) return;
        e.stopPropagation();
        isDragging.current = true;
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
