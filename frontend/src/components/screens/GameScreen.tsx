import { useGameStore } from '../../store/gameStore';
import { GameScene } from '../GameScene';
import { Scoreboard } from '../ui/Scoreboard';

export function GameScreen() {
  const isDebug = useGameStore((state) => state.isDebug);
  const socket = useGameStore((state) => state.socket);

  const handleRoll = () => {
    if (!socket) return;
    // Emit a request to roll dice with some base throwing force
    socket.emit('ROLL_DICE', {
      velocity: { x: 0, y: -5, z: 5 }, // throw downwards and forwards
      angularVelocity: { x: Math.random() * 10, y: Math.random() * 10, z: Math.random() * 10 }
    });
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* 좌측 스코어보드 UI 영역 */}
      <div style={{ width: '350px', minWidth: '350px', background: '#2a2a2a', color: 'white', borderRight: '2px solid #444', padding: '20px', zIndex: 10, overflowY: 'auto' }}>
        <h2>Yacht Dice</h2>
        
        <div style={{ background: '#111', padding: '10px', borderRadius: '5px', marginBottom: '20px', display: 'flex', justifyContent: 'space-around' }}>
          {useGameStore(state => state.currentDiceValues).map((val, i) => (
            <div key={i} style={{ width: '40px', height: '40px', background: 'white', color: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold', borderRadius: '5px' }}>
              {val}
            </div>
          ))}
        </div>

        <Scoreboard />
        <button 
          onClick={handleRoll}
          style={{ padding: '15px', width: '100%', marginTop: '20px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 'bold' }}>
          ROLL DICE
        </button>
      </div>

      {/* 우측 3D 렌더링 영역 */}
      <div style={{ flex: 1, position: 'relative' }}>
        <GameScene />
        {isDebug && (
          <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(0,0,0,0.7)', color: 'lime', padding: '10px', fontFamily: 'monospace', zIndex: 100 }}>
            <p>DEBUG MODE ACTIVE</p>
            {/* FPS counter can be added via r3f performance components */}
          </div>
        )}
      </div>
    </div>
  );
}
