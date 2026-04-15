import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { SCORE_CATEGORIES, RulesCategory } from '@yacht/core';

export function Scoreboard() {
  const { scores, previewScores, updateScore, currentTurn, endTurn } = useGameStore();

  // 1. 상단 항목 합계 계산 로직
  const upperCats: RulesCategory[] = ['Aces', 'Deuces', 'Threes', 'Fours', 'Fives', 'Sixes'];
  const p1Sub = upperCats.reduce((sum, c) => sum + (Number(scores.p1[c]) || 0), 0);
  const p2Sub = upperCats.reduce((sum, c) => sum + (Number(scores.p2[c]) || 0), 0);

  const handleScoreClick = (cat: RulesCategory) => {
    if (cat === 'Bonus') return;

    const currentPlayerScores = scores[currentTurn];
    if (currentPlayerScores[cat] !== null) return;

    const scoreToRecord = previewScores[cat] ?? 0;
    updateScore(currentTurn, cat, scoreToRecord);
    endTurn();
  };

  return (
    <div style={{ padding: '10px', background: '#1a1a1a', borderRadius: '8px', color: '#fff' }}>
      <h3 style={{ borderBottom: '1px solid #444', paddingBottom: '10px', color: '#4CAF50', textAlign: 'center' }}>
        {currentTurn === 'p1' ? "내 차례 (P1)" : "상대방 차례 (P2)"}
      </h3>
      
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #555', color: '#aaa', fontSize: '14px' }}>
            <th style={{ padding: '8px', textAlign: 'left' }}>Category</th>
            <th style={{ width: '60px' }}>P1</th>
            <th style={{ width: '60px' }}>P2</th>
          </tr>
        </thead>
        <tbody>
          {SCORE_CATEGORIES.map((cat) => {
            const p1Val = scores.p1[cat];
            const p2Val = scores.p2[cat];
            const preview = previewScores[cat];

            // Bonus 항목 바로 위에 Subtotal 행 삽입
            const subtotalRow = cat === 'Bonus' && (
              <tr key="subtotal-row" style={{ background: 'rgba(255,255,255,0.05)', fontSize: '12px' }}>
                <td style={{ textAlign: 'left', padding: '5px 8px', color: '#888' }}>Subtotal</td>
                <td style={{ color: p1Sub >= 63 ? '#4CAF50' : '#FFD700', fontWeight: 'bold'  }}>{p1Sub} / 63</td>
                <td style={{ color: p2Sub >= 63 ? '#2196F3' : '#FFD700', fontWeight: 'bold' }}>{p2Sub} / 63</td>
              </tr>
            );

            return (
              <React.Fragment key={cat}>
                {subtotalRow}
                <tr 
                  onClick={() => handleScoreClick(cat)}
                  style={{ 
                    borderBottom: '1px solid #333',
                    cursor: (currentTurn === 'p1' ? p1Val : p2Val) === null && cat !== 'Bonus' ? 'pointer' : 'default'
                  }}
                >
                  <td style={{ padding: '10px 8px', textAlign: 'left', fontSize: '14px', color: cat === 'Bonus' ? '#FFD700' : '#eee' }}>
                    {cat}
                  </td>
                  <td style={{ color: p1Val !== null ? '#4CAF50' : (currentTurn === 'p1' ? '#888' : '#444') }}>
                    {p1Val !== null ? p1Val : (currentTurn === 'p1' ? preview : '-')}
                  </td>
                  <td style={{ color: p2Val !== null ? '#2196F3' : (currentTurn === 'p2' ? '#888' : '#444') }}>
                    {p2Val !== null ? p2Val : (currentTurn === 'p2' ? preview : '-')}
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid #555', background: 'rgba(255,255,255,0.1)' }}>
            <td style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 'bold', color: '#FFD700' }}>
              TOTAL
            </td>
            
            {/* P1 총합: 초기값 0을 명시하고 acc 타입을 number로 고정 */}
            <td style={{ padding: '12px 5px', fontSize: '1.1rem', fontWeight: 'bold', color: '#4CAF50' }}>
              {Object.values(scores.p1).reduce((acc: number, v) => acc + (Number(v) || 0), 0)}
            </td>
            
            {/* P2 총합 */}
            <td style={{ padding: '12px 5px', fontSize: '1.1rem', fontWeight: 'bold', color: '#2196F3' }}>
              {Object.values(scores.p2).reduce((acc: number, v) => acc + (Number(v) || 0), 0)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
