import { useGameStore } from '../../store/gameStore';
import { GAME_CONSTANTS } from '@yacht/core';

export function TurnIndicator() {
  const rollCount = useGameStore((s) => s.rollCount);

  return (
    <div style={{
      position: 'absolute',
      bottom: 16,
      left: 16,
      background: '#2a2a2a',
      color: '#fff',
      padding: '8px 14px',
      borderRadius: '6px',
      fontFamily: 'monospace',
      fontSize: '14px',
      zIndex: 10,
      border: '1px solid #444',
    }}>
      굴림 {rollCount} / {GAME_CONSTANTS.MAX_ROLLS_PER_TURN}
    </div>
  );
}
