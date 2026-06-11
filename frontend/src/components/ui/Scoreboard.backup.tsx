import { useGameStore } from '../../store/gameStore';
import { SCORE_CATEGORIES, RulesCategory, getTotalScore } from '@yacht/core';
import { soundManager } from '../../utils/soundManager';

export function Scoreboard() {
  const { scores, previewScores, updateScore, currentTurn, endTurn, isInPlacementMode } = useGameStore();

  const handleScoreClick = (cat: RulesCategory) => {
    // 0. 배치 모드(주사위 결과 확인 중)가 아니면 점수 기입 불가
    if (!isInPlacementMode) return;

    // 1. 보너스 칸은 클릭해도 아무 일 안 일어남
    if (cat === 'Bonus') return;

    // 2. 현재 턴(p1 또는 p2)인 사람의 점수판을 확인
    const currentPlayerScores = scores[currentTurn];

    // 3. 이미 점수가 적혀있는 칸이면 클릭 무시
    if (currentPlayerScores[cat] !== null) return;

    // 4. 현재 주사위로 계산된 예상 점수 가져오기
    const scoreToRecord = previewScores[cat] ?? 0;

    updateScore(currentTurn, cat, scoreToRecord);
    soundManager.play('score');

    endTurn();
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: '#1a1a1a',
      borderRadius: '8px',
      color: '#fff',
      padding: 'clamp(2px, 0.4vh, 6px)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid #444',
        paddingBottom: 'clamp(2px, 0.3vh, 6px)',
        marginBottom: 'clamp(1px, 0.2vh, 4px)',
        fontWeight: 'bold',
      }}>
        <div style={{
          flex: 2,
          display: 'flex',
          alignItems: 'center',
          fontSize: 'clamp(14px, 2vh, 22px)',
          color: '#4CAF50',
          paddingLeft: '4px',
        }}>
          {currentTurn === 'p1' ? "P1's Turn" : "P2's Turn"}
          <span style={{
            borderLeft: '2px solid #555',
            marginLeft: 'clamp(6px, 0.8vw, 12px)',
            paddingLeft: 'clamp(6px, 0.8vw, 12px)',
            color: '#888',
            fontSize: 'clamp(13px, 1.7vh, 18px)',
            fontWeight: 'normal',
          }}>Total</span>
        </div>
        <div style={{ flex: 1, textAlign: 'center', color: '#4CAF50', fontSize: 'clamp(14px, 2vh, 22px)' }}>
          {getTotalScore(scores.p1)}
        </div>
        <div style={{ flex: 1, textAlign: 'center', color: '#2196F3', fontSize: 'clamp(14px, 2vh, 22px)' }}>
          {getTotalScore(scores.p2)}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          borderBottom: '2px solid #555',
          color: '#aaa',
          fontSize: 'clamp(12px, 1.6vh, 16px)',
          padding: 'clamp(1px, 0.2vh, 3px) 0',
        }}>
          <div style={{ flex: 2, textAlign: 'left', paddingLeft: '4px' }}>Category</div>
          <div style={{ flex: 1, textAlign: 'center' }}>P1</div>
          <div style={{ flex: 1, textAlign: 'center' }}>P2</div>
        </div>

        {/* Rows */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {SCORE_CATEGORIES.map((cat) => {
            const p1Val = scores.p1[cat];
            const p2Val = scores.p2[cat];
            const preview = previewScores[cat];
            const isClickable = isInPlacementMode && (currentTurn === 'p1' ? p1Val : p2Val) === null && cat !== 'Bonus';

            return (
              <div
                key={cat}
                onClick={() => handleScoreClick(cat)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  borderBottom: '1px solid #333',
                  cursor: isClickable ? 'pointer' : 'default',
                  fontSize: 'clamp(13px, 1.7vh, 18px)',
                }}
              >
                <div style={{
                  flex: 2,
                  textAlign: 'left',
                  paddingLeft: '4px',
                  color: cat === 'Bonus' ? '#FFD700' : '#eee',
                }}>
                  {cat}
                </div>
                <div style={{ flex: 1, textAlign: 'center', color: p1Val !== null ? '#4CAF50' : '#666' }}>
                  {p1Val !== null ? p1Val : (isInPlacementMode && currentTurn === 'p1' && cat !== 'Bonus' ? preview : '-')}
                </div>
                <div style={{ flex: 1, textAlign: 'center', color: p2Val !== null ? '#2196F3' : '#666' }}>
                  {p2Val !== null ? p2Val : (isInPlacementMode && currentTurn === 'p2' && cat !== 'Bonus' ? preview : '-')}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
