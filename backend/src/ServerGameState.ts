import { GAME_CONSTANTS, SCORE_CATEGORIES, calculateScore, checkBonus, RulesCategory, TurnPhase, GameSnapshot } from '@yacht/core';

const ALLOWED_EVENTS: Record<TurnPhase, string[]> = {
  waiting_pour: ['CUP_SHAKE_STATE', 'POUR_CUP'],
  simulating: [],
  placement: ['KEEP_DIE', 'UNKEEP_DIE', 'REROLL', 'SUBMIT_SCORE'],
  collecting: ['COLLECTION_DONE'],
  scoring: [],
};

export class ServerGameState {
  currentTurn: 'p1' | 'p2' = 'p1';
  rollCount = 0;
  turnNumber = 1;
  turnPhase: TurnPhase = 'waiting_pour';

  currentDiceValues: number[] = [0, 0, 0, 0, 0];
  keptDiceSlots: (number | null)[] = [null, null, null, null, null];

  scores: {
    p1: Record<string, number | null>;
    p2: Record<string, number | null>;
  };

  canPour = true;
  isSimulating = false;
  finished = false;

  // Turn timer
  turnTimer: ReturnType<typeof setTimeout> | null = null;
  turnTimerStart = 0;
  turnTimerFrozen = false;
  turnRemainingOnFreeze = 0;
  static readonly TURN_TIMEOUT_MS = 60_000;

  // Timeout callback — set externally by server
  onTurnTimeout: (() => void) | null = null;

  constructor() {
    const empty: Record<string, number | null> = {};
    for (const cat of SCORE_CATEGORIES) {
      empty[cat] = cat === 'Bonus' ? 0 : null;
    }
    this.scores = {
      p1: { ...empty },
      p2: { ...empty },
    };
  }

  isEventAllowed(event: string): boolean {
    return ALLOWED_EVENTS[this.turnPhase].includes(event);
  }

  validatePour(playerRole: 'p1' | 'p2'): string | null {
    if (this.currentTurn !== playerRole) return 'not_your_turn';
    if (this.rollCount >= GAME_CONSTANTS.MAX_ROLLS_PER_TURN) return 'max_rolls';
    if (!this.canPour) return 'cannot_pour';
    if (this.turnPhase !== 'waiting_pour') return 'wrong_phase';
    return null;
  }

  validateKeep(playerRole: 'p1' | 'p2', dieIndex: number): boolean {
    if (this.currentTurn !== playerRole) return false;
    if (this.rollCount === 0) return false;
    if (dieIndex < 0 || dieIndex >= 5) return false;
    if (this.turnPhase !== 'placement') return false;
    return true;
  }

  validateSubmitScore(playerRole: 'p1' | 'p2', category: string): string | null {
    if (this.currentTurn !== playerRole) return 'not_your_turn';
    if (this.rollCount === 0) return 'must_roll_first';
    if (this.turnPhase !== 'placement') return 'wrong_phase';

    const playerScores = this.scores[playerRole];
    if (category === 'Bonus') return 'cannot_score_bonus';
    if (playerScores[category] !== null) return 'already_scored';
    if (!SCORE_CATEGORIES.includes(category as RulesCategory)) return 'invalid_category';
    return null;
  }

  validateReroll(playerRole: 'p1' | 'p2'): string | null {
    if (this.currentTurn !== playerRole) return 'not_your_turn';
    if (this.rollCount >= GAME_CONSTANTS.MAX_ROLLS_PER_TURN) return 'max_rolls';
    if (this.turnPhase !== 'placement') return 'wrong_phase';
    return null;
  }

  applyKeep(dieIndex: number): void {
    const firstEmpty = this.keptDiceSlots.findIndex(s => s === null);
    if (firstEmpty === -1) return;
    if (this.keptDiceSlots.includes(dieIndex)) return;
    this.keptDiceSlots[firstEmpty] = dieIndex;
  }

  applyUnkeep(dieIndex: number): void {
    this.keptDiceSlots = this.keptDiceSlots.map(s => s === dieIndex ? null : s);
  }

  applyScore(playerRole: 'p1' | 'p2', category: string): { value: number; gameOver: boolean } {
    const value = calculateScore(this.currentDiceValues, category as RulesCategory);
    const playerScores = this.scores[playerRole];
    playerScores[category] = value;
    playerScores['Bonus'] = checkBonus(playerScores);

    const gameOver = this.checkGameOver();
    if (gameOver) {
      this.finished = true;
    }

    return { value, gameOver };
  }

  advanceTurn(): void {
    this.currentTurn = this.currentTurn === 'p1' ? 'p2' : 'p1';
    this.rollCount = 0;
    this.turnNumber++;
    this.keptDiceSlots = [null, null, null, null, null];
    this.canPour = false;
    this.turnPhase = 'waiting_pour';
  }

  private checkGameOver(): boolean {
    const scorable = SCORE_CATEGORIES.filter(c => c !== 'Bonus');
    const p1Done = scorable.every(c => this.scores.p1[c] !== null);
    const p2Done = scorable.every(c => this.scores.p2[c] !== null);
    return p1Done && p2Done;
  }

  getWinner(): 'p1' | 'p2' | 'draw' {
    const p1Total = Object.values(this.scores.p1).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0;
    const p2Total = Object.values(this.scores.p2).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0;
    if (p1Total > p2Total) return 'p1';
    if (p2Total > p1Total) return 'p2';
    return 'draw';
  }

  buildSnapshot(playerId: string, playerIndex: number, opponentName: string, opponentConnected: boolean, autoPlayPlayer: 'p1' | 'p2' | null = null): GameSnapshot {
    const myRole = playerIndex === 0 ? 'p1' : 'p2';
    return {
      currentTurn: this.currentTurn,
      rollCount: this.rollCount,
      turnNumber: this.turnNumber,
      currentDiceValues: this.currentDiceValues,
      keptDiceSlots: this.keptDiceSlots,
      scores: this.scores,
      phase: this.finished ? 'finished' : 'playing',
      turnPhase: this.turnPhase,
      canPour: this.canPour,
      isSimulating: this.isSimulating,
      myRole: myRole as 'p1' | 'p2',
      opponentName,
      opponentConnected,
      autoPlayActive: autoPlayPlayer,
    };
  }

  startTurnTimer(): void {
    this.clearTurnTimer();
    this.turnTimerStart = Date.now();
    this.turnTimerFrozen = false;
    this.turnTimer = setTimeout(() => {
      if (this.onTurnTimeout) this.onTurnTimeout();
    }, ServerGameState.TURN_TIMEOUT_MS);
  }

  resetTurnTimer(): void {
    this.startTurnTimer();
  }

  freezeTurnTimer(): void {
    if (this.turnTimer && !this.turnTimerFrozen) {
      const elapsed = Date.now() - this.turnTimerStart;
      this.turnRemainingOnFreeze = Math.max(0, ServerGameState.TURN_TIMEOUT_MS - elapsed);
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
      this.turnTimerFrozen = true;
    }
  }

  resumeTurnTimer(): void {
    if (this.turnTimerFrozen) {
      this.turnTimerFrozen = false;
      this.turnTimerStart = Date.now() - (ServerGameState.TURN_TIMEOUT_MS - this.turnRemainingOnFreeze);
      this.turnTimer = setTimeout(() => {
        if (this.onTurnTimeout) this.onTurnTimeout();
      }, this.turnRemainingOnFreeze);
    }
  }

  clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnTimerFrozen = false;
  }

  getRemainingMs(): number {
    if (this.turnTimerFrozen) return this.turnRemainingOnFreeze;
    const elapsed = Date.now() - this.turnTimerStart;
    return Math.max(0, ServerGameState.TURN_TIMEOUT_MS - elapsed);
  }

  reset(): void {
    this.clearTurnTimer();
    this.currentTurn = 'p1';
    this.rollCount = 0;
    this.turnNumber = 1;
    this.turnPhase = 'waiting_pour';
    this.currentDiceValues = [0, 0, 0, 0, 0];
    this.keptDiceSlots = [null, null, null, null, null];
    this.canPour = true;
    this.isSimulating = false;
    this.finished = false;

    const empty: Record<string, number | null> = {};
    for (const cat of SCORE_CATEGORIES) {
      empty[cat] = cat === 'Bonus' ? 0 : null;
    }
    this.scores = {
      p1: { ...empty },
      p2: { ...empty },
    };
  }
}
