import { useGameStore } from '../../store/gameStore';
import { SCORE_CATEGORIES, RulesCategory } from '@yacht/core';

export function Scoreboard() {
  const { scores, previewScores, updateScore, currentTurn, endTurn } = useGameStore();

  const handleScoreClick = (cat: RulesCategory) => {
    // 1. 보너스 칸은 클릭해도 아무 일 안 일어남
    if (cat === 'Bonus') return;

    // 2. 현재 턴(p1 또는 p2)인 사람의 점수판을 확인
    const currentPlayerScores = scores[currentTurn];

    // 3. 이미 점수가 적혀있는 칸이면 클릭 무시
    if (currentPlayerScores[cat] !== null) return;

    // 4. 현재 주사위로 계산된 예상 점수 가져오기
    const scoreToRecord = previewScores[cat] ?? 0;

    // 5. 점수 기록 (p1/p2 구분 없이 currentTurn에 기록)
    updateScore(currentTurn, cat, scoreToRecord);

    // 6. 턴 종료 및 교체 (이 함수가 실행되면 p1 <-> p2가 바뀝니다)
    endTurn();
  };

  return (
    <div style={{ padding: '10px', background: '#1a1a1a', borderRadius: '8px', color: '#fff' }}>
      <h3 style={{ borderBottom: '1px solid #444', paddingBottom: '10px', color: '#4CAF50' }}>
        {currentTurn === 'p1' ? "내 차례 (P1)" : "상대방 차례 (P2)"}
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #555', color: '#aaa' }}>
            <th style={{ padding: '8px', textAlign: 'left' }}>Category</th>
            <th>P1</th>
            <th>P2</th>
          </tr>
        </thead>
        <tbody>
          {SCORE_CATEGORIES.map((cat) => {
            const p1Val = scores.p1[cat];
            const p2Val = scores.p2[cat];
            const preview = previewScores[cat];

            return (
              <tr 
                key={cat} 
                onClick={() => handleScoreClick(cat)}
                style={{ 
                  borderBottom: '1px solid #333',
                  // 이미 기록된 칸이 아닐 때만 손가락 커서 표시
                  cursor: (currentTurn === 'p1' ? p1Val : p2Val) === null && cat !== 'Bonus' ? 'pointer' : 'default'
                }}
              >
                <td style={{ padding: '10px 5px', textAlign: 'left', fontSize: '14px', color: cat === 'Bonus' ? '#FFD700' : '#eee' }}>
                  {cat}
                </td>

                {/* P1 점수 영역 */}
                <td style={{ color: p1Val !== null ? '#4CAF50' : '#666' }}>
                  {p1Val !== null ? p1Val : (currentTurn === 'p1' && cat !== 'Bonus' ? preview : '-')}
                </td>

                {/* P2 점수 영역 */}
                <td style={{ color: p2Val !== null ? '#2196F3' : '#666' }}>
                  {p2Val !== null ? p2Val : (currentTurn === 'p2' && cat !== 'Bonus' ? preview : '-')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
