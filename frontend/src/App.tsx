import { useEffect } from 'react';
import { useGameStore } from './store/gameStore';
import { SplashScreen } from './components/screens/SplashScreen';
import { MainMenuScreen } from './components/screens/MainMenuScreen';
import { GameScreen } from './components/screens/GameScreen';
import { io } from 'socket.io-client';

export default function App() {
  const { phase, setIsDebug, setSocket, socket } = useGameStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('debug')) {
      setIsDebug(true);
    }

    if (!socket) {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
      const newSocket = io(serverUrl);
      setSocket(newSocket);
    }

    return () => {};
  }, [setIsDebug, setSocket, socket]);

  return (
    <>
      {phase === 'LOBBY' && <SplashScreen />}
      {phase === 'MAIN_MENU' && <MainMenuScreen />}
      {(phase === 'GAME' || phase === 'GAME_OVER') && <GameScreen />}
    </>
  );
}
