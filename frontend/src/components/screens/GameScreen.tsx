import { useGameStore } from '../../store/gameStore';
import { GameScene } from '../GameScene';
import { Scoreboard } from '../ui/Scoreboard';

export function GameScreen() {
  const isDebug = useGameStore((state) => state.isDebug);
  const currentDiceValues = useGameStore((state) => state.currentDiceValues);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* 좌측 스코어보드 UI 영역 */}
      <div style={{ width: '350px', minWidth: '350px', background: '#2a2a2a', color: 'white', borderRight: '2px solid #444', padding: '20px', zIndex: 10, overflowY: 'auto' }}>
        <h2>Yacht Dice</h2>
        
        {/* 상단 주사위 숫자 미리보기 (HUD 대용) */}
        <div style={{ background: '#111', padding: '10px', borderRadius: '5px', marginBottom: '20px', display: 'flex', justifyContent: 'space-around' }}>
          {currentDiceValues.map((val, i) => (
            <div key={i} style={{ width: '40px', height: '40px', background: 'white', color: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold', borderRadius: '5px' }}>
              {val}
            </div>
          ))}
        </div>
        
        <Scoreboard />
        
      </div> 

      {/* 우측 3D 렌더링 영역 */}
      <div style={{ flex: 1, position: 'relative' }}>
        <GameScene />
        {isDebug && (
          <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(0,0,0,0.7)', color: 'lime', padding: '10px', fontFamily: 'monospace', zIndex: 100 }}>
            <p>DEBUG MODE ACTIVE</p>
          </div>
        )}
      </div>
    </div>
  );
}
