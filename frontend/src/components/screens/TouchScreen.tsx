import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';

export function TouchScreen() {
  const setPhase = useGameStore((state) => state.setPhase);

  useEffect(() => {
    const handleInteraction = () => {
      // 여기서 오디오 컨텍스트 초기화 등을 수행할 수 있습니다.
      setPhase('MAIN_MENU');
    };

    window.addEventListener('click', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);

    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };
  }, [setPhase]);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#fff', cursor: 'pointer' }}>
      <h2 style={{ animation: 'pulse 1.5s infinite' }}>Touch or Press Any Key to Start</h2>
      <style>{`
        @keyframes pulse {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
