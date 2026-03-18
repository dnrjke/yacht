import { useGameStore } from '../../store/gameStore';
import { SCORE_CATEGORIES } from '@yacht/core';

export function Scoreboard() {
  const scores = useGameStore((state) => state.scores);

  return (
    <div style={{ padding: '10px', background: '#333', borderRadius: '8px', color: '#fff' }}>
      <h3 style={{ borderBottom: '1px solid #555', paddingBottom: '10px' }}>Scoreboard</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #555' }}>
            <th style={{ padding: '5px', textAlign: 'left' }}>Category</th>
            <th style={{ padding: '5px' }}>P1 (Me)</th>
            <th style={{ padding: '5px' }}>P2 (Opp)</th>
          </tr>
        </thead>
        <tbody>
          {SCORE_CATEGORIES.map((cat) => (
            <tr key={cat} style={{ borderBottom: '1px solid #444' }}>
              <td style={{ padding: '8px 0', textAlign: 'left', fontSize: '14px' }}>{cat}</td>
              {/* 플레이어 1 점수 */}
              <td style={{ padding: '8px 0', color: scores.p1[cat] !== null ? '#4CAF50' : '#888' }}>
                {scores.p1[cat] !== null ? scores.p1[cat] : '-'}
              </td>
              {/* 플레이어 2 점수 */}
              <td style={{ padding: '8px 0', color: scores.p2[cat] !== null ? '#2196F3' : '#888' }}>
                {scores.p2[cat] !== null ? scores.p2[cat] : '-'}
              </td>
            </tr>
          ))}
          
          {/* 하단 총합 섹션 */}
          <tr style={{ fontWeight: 'bold', borderTop: '2px solid #555' }}>
            <td style={{ padding: '10px 0', textAlign: 'left' }}>Total</td>
            <td style={{ padding: '10px 0', color: '#FFD700' }}>
              {Object.values(scores.p1).reduce((sum, val) => (sum ?? 0) + (val ?? 0), 0)}
            </td>
            <td style={{ padding: '10px 0', color: '#FFD700' }}>
              {Object.values(scores.p2).reduce((sum, val) => (sum ?? 0) + (val ?? 0), 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
