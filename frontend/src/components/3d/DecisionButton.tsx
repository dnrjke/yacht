import { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../../store/gameStore';
import * as THREE from 'three';

// Scratch vectors — reused every frame
const _forward = new THREE.Vector3();
const _right   = new THREE.Vector3();
const _up      = new THREE.Vector3();
const _center  = new THREE.Vector3();

function createButtonTexture(hovered: boolean) {
  const W = 320, H = 80;
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const bg = hovered ? '#3a6a3a' : '#1e4a1e';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = hovered ? '#88dd88' : '#4a8a4a';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 38px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('결  정', W / 2, H / 2);

  return new THREE.CanvasTexture(canvas);
}

export function DecisionButton() {
  const isInPlacementMode = useGameStore(state => state.isInPlacementMode);
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const material = useMemo(() => {
    const tex = createButtonTexture(hovered);
    return new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }, [hovered]);

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

    // Scale button: 20% of visible width, height follows 4:1 texture aspect
    const btnW = visibleWidth * 0.20;
    const btnH = btnW / 4; // matches texture ratio 320:80
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
        const store = useGameStore.getState();
        store.setIsInPlacementMode(false);
        store.setIsSyncingDice(true);

        if (store.placementOrder.length > 0) {
          // There are non-kept dice → animate them back to cup
          store.setIsReturningToCup(true);
        } else {
          // All dice are kept → just tell server directly
          const keptIndices = store.keptDiceSlots; // send the array containing nulls as well
          if (store.socket) {
            store.socket.emit('COLLECT_TO_CUP', { keptIndices });
          }
        }
      }}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer';
        setHovered(true);
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
