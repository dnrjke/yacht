import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';

export function TurnTimer({ fontSize = '14px' }: { fontSize?: string }) {
  const turnTimerEnd = useGameStore(s => s.turnTimerEnd);
  const gameMode = useGameStore(s => s.gameMode);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (gameMode !== 'online' || turnTimerEnd === null) {
      setRemaining(null);
      return;
    }

    const tick = () => {
      const ms = turnTimerEnd - performance.now();
      setRemaining(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [turnTimerEnd, gameMode]);

  if (remaining === null) return null;

  const urgent = remaining <= 10;
  const color = urgent ? '#FF5252' : '#aaa';

  return (
    <>
      {urgent && <style>{`@keyframes timerBlink { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>}
      <span style={{
        fontSize,
        color,
        fontWeight: urgent ? 'bold' : 'normal',
        fontVariantNumeric: 'tabular-nums',
        animation: urgent ? 'timerBlink 1s ease-in-out infinite' : undefined,
      }}>
        {remaining}s
      </span>
    </>
  );
}
