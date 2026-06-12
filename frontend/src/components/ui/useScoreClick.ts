import { useGameStore } from '../../store/gameStore';
import { SCORE_CATEGORIES, RulesCategory } from '@yacht/core';
import { soundManager } from '../../utils/soundManager';

// 점수 기입 + 게임 종료 판정 + 턴 전환 로직.
// Scoreboard(가로)와 PortraitScoreboard(세로)가 공유 — 종료 판정 이중 관리 방지.
export function useScoreClick() {
  const { scores, previewScores, updateScore, currentTurn, endTurn, isInPlacementMode, setPhase } = useGameStore();

  const scorableCategories = SCORE_CATEGORIES.filter(c => c !== 'Bonus');

  const handleScoreClick = (cat: RulesCategory) => {
    if (!isInPlacementMode) return;
    if (cat === 'Bonus') return;

    const currentPlayerScores = scores[currentTurn];
    if (currentPlayerScores[cat] !== null) return;

    const scoreToRecord = previewScores[cat] ?? 0;
    updateScore(currentTurn, cat, scoreToRecord);
    soundManager.play('score');

    const updatedCurrent = { ...scores[currentTurn], [cat]: scoreToRecord };
    const otherPlayer = currentTurn === 'p1' ? 'p2' : 'p1';
    const currentDone = scorableCategories.every(c => updatedCurrent[c] !== null);
    const otherDone = scorableCategories.every(c => scores[otherPlayer][c] !== null);

    if (currentDone && otherDone) {
      setPhase('GAME_OVER');
    } else {
      endTurn();
    }
  };

  return handleScoreClick;
}
