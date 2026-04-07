import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGameStore } from '../../store/gameStore';
import * as THREE from 'three';
import { BOARD_CONSTANTS } from '@yacht/core';

const { CUP_REST_X, CUP_REST_Y, CUP_REST_Z } = BOARD_CONSTANTS;

export function PhysicsCup() {
  const cupRef = useRef<THREE.Group>(null);
  const isDragging = useRef(false);
  const isPouring = useRef(false);
  const socket = useGameStore(state => state.socket);
  const canPour = useGameStore(state => state.canPour);
  const { camera, pointer } = useThree();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CUP_REST_Y);

  // Cup trajectory playback
  const cupPlayback = useRef<{ frames: any[], currentFrame: number } | null>(null);

  useEffect(() => {
    const handleUp = () => {
      if (!isDragging.current || !cupRef.current || !socket) {
        isDragging.current = false;
        return;
      }

      if (canPour) {
        socket.emit('POUR_CUP', {
          position: {
            x: cupRef.current.position.x,
            y: cupRef.current.position.y,
            z: cupRef.current.position.z
          },
          quaternion: {
            x: cupRef.current.quaternion.x,
            y: cupRef.current.quaternion.y,
            z: cupRef.current.quaternion.z,
            w: cupRef.current.quaternion.w
          }
        });
      }

      isDragging.current = false;
    };
    window.addEventListener('pointerup', handleUp);
    return () => window.removeEventListener('pointerup', handleUp);
  }, [socket, canPour]);

  // Listen for POUR_RESULT to play back cup trajectory
  useEffect(() => {
    if (!socket) return;

    const handlePourResult = (result: { cupTrajectory: any[] }) => {
      isPouring.current = true;
      cupPlayback.current = {
        frames: result.cupTrajectory,
        currentFrame: 0
      };
    };

    socket.on('POUR_RESULT', handlePourResult);
    return () => { socket.off('POUR_RESULT', handlePourResult); };
  }, [socket]);

  useFrame(() => {
    if (!cupRef.current) return;

    // Play back cup trajectory from pour
    if (cupPlayback.current) {
      const { frames, currentFrame } = cupPlayback.current;
      if (currentFrame < frames.length) {
        const frame = frames[currentFrame];
        cupRef.current.position.set(frame.position.x, frame.position.y, frame.position.z);
        cupRef.current.quaternion.set(frame.quaternion.x, frame.quaternion.y, frame.quaternion.z, frame.quaternion.w);
        cupPlayback.current.currentFrame++;
      } else {
        cupPlayback.current = null;
        isPouring.current = false;
        cupRef.current.position.set(CUP_REST_X, CUP_REST_Y, CUP_REST_Z);
        cupRef.current.quaternion.set(0, 0, 0, 1);
      }
      return;
    }

    // Normal drag logic
    if (!socket || !isDragging.current) return;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);

    if (target) {
      cupRef.current.position.lerp(target, 0.2);

      socket.emit('CUP_TRANSFORM', {
        position: { x: cupRef.current.position.x, y: cupRef.current.position.y, z: cupRef.current.position.z },
        quaternion: { x: cupRef.current.quaternion.x, y: cupRef.current.quaternion.y, z: cupRef.current.quaternion.z, w: cupRef.current.quaternion.w }
      });
    }
  });

  return (
    <group
      ref={cupRef}
      position={[CUP_REST_X, CUP_REST_Y, CUP_REST_Z]}
      onPointerDown={(e) => {
        if (isPouring.current || !canPour) return;
        e.stopPropagation();
        isDragging.current = true;
      }}
      onPointerOver={() => document.body.style.cursor = 'grab'}
      onPointerOut={() => document.body.style.cursor = 'auto'}
    >
      {/* Cup base */}
      <mesh castShadow receiveShadow position={[0, -4, 0]}>
        <cylinderGeometry args={[4.4, 4.4, 0.4, 32]} />
        <meshStandardMaterial color="#8B4513" />
      </mesh>
      {/* Cup wall */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[4.4, 4.4, 8, 32, 1, true]} />
        <meshStandardMaterial color="#8B4513" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
