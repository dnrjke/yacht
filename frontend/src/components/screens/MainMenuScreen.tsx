import { useGameStore } from '../../store/gameStore';

export function MainMenuScreen() {
  const setPhase = useGameStore((state) => state.setPhase);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', background: '#222', color: '#fff' }}>
      <h1>Main Menu</h1>
      <button 
        onClick={() => setPhase('GAME')}
        style={{ padding: '15px 30px', fontSize: '1.2rem', margin: '10px', cursor: 'pointer', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}
      >
        Multiplayer
      </button>
      <button 
        style={{ padding: '15px 30px', fontSize: '1.2rem', margin: '10px', cursor: 'pointer', background: '#666', color: 'white', border: 'none', borderRadius: '5px' }}
      >
        Settings
      </button>
    </div>
  );
}
