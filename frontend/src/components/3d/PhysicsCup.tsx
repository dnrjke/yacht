import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGameStore } from '../../store/gameStore';
import * as THREE from 'three';

export function PhysicsCup() {
  const cupRef = useRef<THREE.Group>(null);
  const isDragging = useRef(false);
  const socket = useGameStore(state => state.socket);
  const { camera, pointer } = useThree();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -5); // Match physics cup Y position

  useEffect(() => {
    const handleUp = () => { isDragging.current = false; };
    window.addEventListener('pointerup', handleUp);
    return () => window.removeEventListener('pointerup', handleUp);
  }, []);

  useFrame(() => {
    if (!cupRef.current || !socket || !isDragging.current) return;
    
    // Simple drag logic: map pointer to a 3D plane at y=5
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);
    
    if (target) {
      // Lerp for smooth visual following (optional, or just set it)
      cupRef.current.position.lerp(target, 0.2);
      
      // Emit the real-time position to the server
      socket.emit('CUP_TRANSFORM', {
        position: { x: cupRef.current.position.x, y: cupRef.current.position.y, z: cupRef.current.position.z },
        quaternion: { x: cupRef.current.quaternion.x, y: cupRef.current.quaternion.y, z: cupRef.current.quaternion.z, w: cupRef.current.quaternion.w }
      });
    }
  });

  return (
    <group 
      ref={cupRef} 
      position={[0, 5, 0]}
      onPointerDown={(e) => {
        e.stopPropagation();
        isDragging.current = true;
      }}
      // Change cursor to grab/grabbing for better UX
      onPointerOver={() => document.body.style.cursor = 'grab'}
      onPointerOut={() => document.body.style.cursor = 'auto'}
    >
      {/* Visual representation of an open cylinder/cup */}
      <mesh castShadow receiveShadow position={[0, -2, 0]}>
        <cylinderGeometry args={[2.2, 2.2, 0.2, 32]} />
        <meshStandardMaterial color="#8B4513" />
      </mesh>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[2.2, 2.2, 4, 32, 1, true]} />
        <meshStandardMaterial color="#8B4513" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
