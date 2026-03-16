import { useEffect } from 'react';
import { useGameStore } from './store/gameStore';
import { SplashScreen } from './components/screens/SplashScreen';
import { TouchScreen } from './components/screens/TouchScreen';
import { MainMenuScreen } from './components/screens/MainMenuScreen';
import { GameScreen } from './components/screens/GameScreen';
import { io } from 'socket.io-client';

export default function App() {
  const { phase, setIsDebug, setSocket, socket } = useGameStore();

  useEffect(() => {
    // Check for ?debug flag in URL
    const params = new URLSearchParams(window.location.search);
    if (params.has('debug')) {
      setIsDebug(true);
    }

    // Initialize socket connection
    if (!socket) {
      const newSocket = io('http://localhost:3001'); // Point to backend
      setSocket(newSocket);
    }
    
    return () => {
      // Cleanup happens via Zustand store or explicitly here if needed
    };
  }, [setIsDebug, setSocket, socket]);

  return (
    <>
      {phase === 'LOBBY' && <SplashScreen />}
      {phase === 'TOUCH_TO_START' && <TouchScreen />}
      {phase === 'MAIN_MENU' && <MainMenuScreen />}
      {phase === 'GAME' && <GameScreen />}
      {/* We reuse phase definitions to loosely map to these screens for now */}
    </>
  );
}
