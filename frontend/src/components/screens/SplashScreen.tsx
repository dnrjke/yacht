import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';

export function SplashScreen() {
  const setPhase = useGameStore((state) => state.setPhase);

  useEffect(() => {
    // 최소 2초 대기 + 핵심 자산 로드 시뮬레이션
    const timer = setTimeout(() => {
      // 실제로는 여기서 useGLTF.preload() 등을 기다립니다.
      setPhase('TOUCH_TO_START');
    }, 2500);
    return () => clearTimeout(timer);
  }, [setPhase]);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff' }}>
      <h1>YACHT DICE</h1>
      <p style={{ position: 'absolute', bottom: '10%' }}>Loading Core Assets...</p>
    </div>
  );
}
