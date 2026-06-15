import { useGameStore, isMyTurn } from '../../store/gameStore';
import { SCORE_CATEGORIES, RulesCategory } from '@yacht/core';
import { soundManager } from '../../utils/soundManager';
import { getSocket } from '../../network/socket';

const scorableCategories = SCORE_CATEGORIES.filter(c => c !== 'Bonus');

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

export function useScoreClick() {
  const handleScoreClick = (cat: RulesCategory) => {
    if (!isMyTurn()) return;

    const s = useGameStore.getState();
    if (s.gameMode === 'online') {
      if (!s.isInPlacementMode) return;
      if (cat === 'Bonus') return;
      if (s.scores[s.currentTurn][cat] !== null) return;

      s.updateScore(s.currentTurn, cat, s.previewScores[cat] ?? 0);
      soundManager.play('score');
      s.setIsInPlacementMode(false);

      const sock = getSocket();
      if (sock) sock.emit('SUBMIT_SCORE', { category: cat });
      return;
    }

    applyScoreAndAdvance(cat);
  };

  return handleScoreClick;
}
