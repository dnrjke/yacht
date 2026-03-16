import { useRef, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import * as THREE from 'three';
import { YACHT_CONSTANTS } from '@yacht/core';
import { useFrame } from '@react-three/fiber';

export function PhysicsDice() {
  const socket = useGameStore(state => state.socket);
  const setCurrentDiceValues = useGameStore(state => state.setCurrentDiceValues);
  const diceRefs = useRef<(THREE.Mesh | null)[]>([]);
  
  // Playback state
  const playbackData = useRef<{ frames: any[], currentFrame: number } | null>(null);

  useEffect(() => {
    if (!socket) return;

    // Phase 1: Realtime sync during shaking
    const handleDiceUpdate = (diceStates: any[]) => {
      // Ignore live updates if we are currently playing back a roll
      if (playbackData.current) return;
      
      diceStates.forEach((state, idx) => {
        const mesh = diceRefs.current[idx];
        if (mesh) {
          mesh.position.set(state.position.x, state.position.y, state.position.z);
          mesh.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
        }
      });
    };

    // Phase 2: Playback precalculated roll
    const handleRollResult = (result: { trajectory: any[], finalValues: number[] }) => {
      // Start playback
      playbackData.current = {
        frames: result.trajectory,
        currentFrame: 0
      };
      // Once playback starts, we might also want to set UI state (currentDiceValues)
      // but let's wait till playback ends or do it immediately. Doing it immediately for now:
      setCurrentDiceValues(result.finalValues);
    };

    socket.on('DICE_STATES', handleDiceUpdate);
    socket.on('ROLL_RESULT', handleRollResult);

    return () => {
      socket.off('DICE_STATES', handleDiceUpdate);
      socket.off('ROLL_RESULT', handleRollResult);
    };
  }, [socket, setCurrentDiceValues]);

  useFrame(() => {
    // If we have playback data, step through it frame by frame
    if (playbackData.current) {
      const { frames, currentFrame } = playbackData.current;
      
      if (currentFrame < frames.length) {
        const frameState = frames[currentFrame];
        frameState.forEach((state: any, idx: number) => {
          const mesh = diceRefs.current[idx];
          if (mesh) {
            mesh.position.set(state.position.x, state.position.y, state.position.z);
            mesh.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
          }
        });
        playbackData.current.currentFrame++;
      } else {
        // Playback finished
        playbackData.current = null;
      }
    }
  });

  return (
    <>
      {Array.from({ length: YACHT_CONSTANTS.DICE_COUNT }).map((_, idx) => (
        <mesh 
          key={idx} 
          ref={el => diceRefs.current[idx] = el}
          castShadow 
          receiveShadow
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="white" />
          {/* Add pip visual mapping later, right now it's just a blank cube */}
        </mesh>
      ))}
    </>
  );
}
