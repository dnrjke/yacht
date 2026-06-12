import { useEffect } from 'react';
import { useGameStore } from './store/gameStore';
import { SplashScreen } from './components/screens/SplashScreen';
import { MainMenuScreen } from './components/screens/MainMenuScreen';
import { GameScreen } from './components/screens/GameScreen';

export default function App() {
  const { phase, setIsDebug } = useGameStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('debug')) {
      setIsDebug(true);
    }
  }, [setIsDebug]);

  return (
    <>
      {phase === 'LOBBY' && <SplashScreen />}
      {phase === 'MAIN_MENU' && <MainMenuScreen />}
      {(phase === 'GAME' || phase === 'GAME_OVER') && <GameScreen />}
    </>
  );
}
