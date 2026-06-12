import { useGameStore, isAiTurnNow } from '../../store/gameStore';
import { SCORE_CATEGORIES, RulesCategory } from '@yacht/core';
import { soundManager } from '../../utils/soundManager';

const scorableCategories = SCORE_CATEGORIES.filter(c => c !== 'Bonus');

// 점수 기입 + 게임 종료 판정 + 턴 전환 로직.
// 사람(점수판 클릭)과 AI(AiController)가 공유 — 종료 판정 이중 관리 방지.
export function applyScoreAndAdvance(cat: RulesCategory): void {
  const s = useGameStore.getState();
  if (!s.isInPlacementMode) return;
  if (cat === 'Bonus') return;

  const currentPlayerScores = s.scores[s.currentTurn];
  if (currentPlayerScores[cat] !== null) return;

  const scoreToRecord = s.previewScores[cat] ?? 0;
  s.updateScore(s.currentTurn, cat, scoreToRecord);
  soundManager.play('score');

  const updatedCurrent = { ...s.scores[s.currentTurn], [cat]: scoreToRecord };
  const otherPlayer = s.currentTurn === 'p1' ? 'p2' : 'p1';
  const currentDone = scorableCategories.every(c => updatedCurrent[c] !== null);
  const otherDone = scorableCategories.every(c => s.scores[otherPlayer][c] !== null);

  if (currentDone && otherDone) {
    s.setPhase('GAME_OVER');
  } else {
    s.endTurn();
  }
}

// 점수판 클릭용 핸들러 — AI 턴엔 사람 입력 차단
export function useScoreClick() {
  const handleScoreClick = (cat: RulesCategory) => {
    if (isAiTurnNow()) return;
    applyScoreAndAdvance(cat);
  };

  return handleScoreClick;
}
