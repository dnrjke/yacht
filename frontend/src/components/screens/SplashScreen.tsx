import { useEffect, useState, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { soundManager } from '../../utils/soundManager';

export function SplashScreen() {
  const setPhase = useGameStore((state) => state.setPhase);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    soundManager.preload().then(() => setLoaded(true));
  }, []);

  const handleStart = useCallback(() => {
    if (!loaded) return;
    soundManager.ensureUnlocked();
    setPhase('MAIN_MENU');
  }, [loaded, setPhase]);

  useEffect(() => {
    if (!loaded) return;

    window.addEventListener('click', handleStart);
    window.addEventListener('keydown', handleStart);
    window.addEventListener('touchstart', handleStart);

    return () => {
      window.removeEventListener('click', handleStart);
      window.removeEventListener('keydown', handleStart);
      window.removeEventListener('touchstart', handleStart);
    };
  }, [loaded, handleStart]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: '25vh',
      background: '#000',
      color: '#fff',
      cursor: loaded ? 'pointer' : 'default',
    }}>
      <h1 style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', letterSpacing: '0.1em' }}>YACHT DICE</h1>
      <p className="splash-prompt" style={{
        position: 'absolute',
        bottom: '10%',
        fontSize: 'clamp(0.9rem, 2vw, 1.3rem)',
        animation: loaded ? 'pulse 1.5s infinite' : 'none',
        opacity: loaded ? 1 : 0.5,
      }}>
        {loaded ? 'Touch to Start' : 'Loading...'}
      </p>
      <style>{`
        @keyframes pulse {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
        }
        @media (min-width: 541px) {
          .splash-prompt { display: none !important; }
        }
      `}</style>
    </div>
  );
}
