import { useGameStore } from '../../store/gameStore';
import { SCORE_CATEGORIES } from '@yacht/core';

export function Scoreboard() {
  const myScore = useGameStore((state) => state.myScore);

  return (
    <div style={{ padding: '10px', background: '#333', borderRadius: '8px' }}>
      <h3 style={{ borderBottom: '1px solid #555', paddingBottom: '10px' }}>Scoreboard</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr>
            <th style={{ padding: '5px' }}>Category</th>
            <th style={{ padding: '5px' }}>Score</th>
          </tr>
        </thead>
        <tbody>
          {SCORE_CATEGORIES.map((cat) => (
            <tr key={cat} style={{ borderBottom: '1px solid #444' }}>
              <td style={{ padding: '5px 0' }}>{cat}</td>
              <td style={{ padding: '5px 0', color: myScore[cat] !== null ? '#4CAF50' : '#888' }}>
                {myScore[cat] !== null ? myScore[cat] : '-'}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 'bold', marginTop: '10px' }}>
            <td style={{ padding: '10px 0' }}>Total</td>
            <td style={{ padding: '10px 0', color: '#fff' }}>
              {Object.values(myScore).reduce((sum, val) => (sum || 0) + (val || 0), 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
