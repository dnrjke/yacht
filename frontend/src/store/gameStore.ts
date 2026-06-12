import { create } from 'zustand';
import { GamePhase, RulesCategory, SCORE_CATEGORIES, checkBonus, calculateScore, ComboResult, GAME_CONSTANTS } from '@yacht/core';

export type GameMode = 'local' | 'single';

interface GameState {
  phase: GamePhase;
  setPhase: (phase: GamePhase) => void;

  gameMode: GameMode;
  setGameMode: (mode: GameMode) => void;

  isDebug: boolean;
  setIsDebug: (val: boolean) => void;

  scores: {
    p1: Record<RulesCategory, number | null>;
    p2: Record<RulesCategory, number | null>;
  };
  updateScore: (player: 'p1' | 'p2', category: RulesCategory, score: number) => void;

  currentDiceValues: number[];
  setCurrentDiceValues: (vals: number[]) => void;

  previewScores: Record<RulesCategory, number>;

  canPour: boolean;
  setCanPour: (val: boolean) => void;

  isInPlacementMode: boolean;
  setIsInPlacementMode: (val: boolean) => void;
  isWaitingForPlacement: boolean;
  setIsWaitingForPlacement: (val: boolean) => void;
  isReturningToCup: boolean;
  setIsReturningToCup: (val: boolean) => void;
  isSyncingDice: boolean;
  setIsSyncingDice: (val: boolean) => void;
  placementOrder: number[];
  setPlacementOrder: (val: number[]) => void;

  keptDiceSlots: (number | null)[];
  keepDie: (dieIndex: number) => void;
  unkeepDie: (dieIndex: number) => void;

  activeCombo: ComboResult | null;
  setActiveCombo: (combo: ComboResult | null) => void;

  currentTurn: 'p1' | 'p2';
  rollCount: number;
  incrementRollCount: () => void;
  endTurn: () => void;
  resetGame: () => void;
}

const initialScores = SCORE_CATEGORIES.reduce((acc, cat) => {
  acc[cat] = null;
  return acc;
}, {} as Record<RulesCategory, number | null>);

export const useGameStore = create<GameState>((set) => ({
  phase: 'LOBBY',
  setPhase: (phase) => set({ phase }),

  gameMode: 'local',
  setGameMode: (gameMode) => set({ gameMode }),

  isDebug: false,
  setIsDebug: (isDebug) => set({ isDebug }),

  scores: {
    p1: { ...initialScores, Bonus: 0 },
    p2: { ...initialScores, Bonus: 0 },
  },

  updateScore: (player, category, score) => set((state) => {
    const newPlayerScore = { ...state.scores[player], [category]: score };
    newPlayerScore['Bonus'] = checkBonus(newPlayerScore);

    return {
      scores: {
        ...state.scores,
        [player]: newPlayerScore
      }
    };
  }),

  currentDiceValues: [1, 1, 1, 1, 1],
  previewScores: {} as Record<RulesCategory, number>,
  setCurrentDiceValues: (vals) => set(() => {
    const newPreviews = {} as Record<RulesCategory, number>;

    SCORE_CATEGORIES.forEach((cat) => {
      if (cat === 'Bonus') {
        newPreviews[cat] = 0;
      } else {
        newPreviews[cat] = calculateScore(vals, cat);
      }
    });

    return {
      currentDiceValues: vals,
      previewScores: newPreviews
    };
  }),

  canPour: true,
  setCanPour: (canPour) => set({ canPour }),

  isInPlacementMode: false,
  setIsInPlacementMode: (isInPlacementMode) => set({ isInPlacementMode }),
  isWaitingForPlacement: false,
  setIsWaitingForPlacement: (isWaitingForPlacement) => set({ isWaitingForPlacement }),
  isReturningToCup: false,
  setIsReturningToCup: (isReturningToCup) => set({ isReturningToCup }),
  isSyncingDice: false,
  setIsSyncingDice: (isSyncingDice) => set({ isSyncingDice }),
  placementOrder: [0, 1, 2, 3, 4],
  setPlacementOrder: (placementOrder) => set({ placementOrder }),

  keptDiceSlots: [null, null, null, null, null],
  keepDie: (dieIndex) => set((state) => {
    const newSlots = [...state.keptDiceSlots];
    const firstEmpty = newSlots.findIndex(s => s === null);
    if (firstEmpty === -1) return state;
    newSlots[firstEmpty] = dieIndex;
    const newOrder = state.placementOrder.filter(idx => idx !== dieIndex);
    return { keptDiceSlots: newSlots, placementOrder: newOrder };
  }),
  unkeepDie: (dieIndex) => set((state) => {
    const newSlots = state.keptDiceSlots.map(s => s === dieIndex ? null : s);
    const allHUDDice = [...state.placementOrder, dieIndex];
    const values = state.currentDiceValues;
    const newOrder = allHUDDice
      .map(i => ({ v: values[i], i }))
      .sort((a, b) => a.v !== b.v ? a.v - b.v : a.i - b.i)
      .map(x => x.i);
    return { keptDiceSlots: newSlots, placementOrder: newOrder };
  }),
  activeCombo: null,
  setActiveCombo: (activeCombo) => set({ activeCombo }),

  currentTurn: 'p1',
  rollCount: 0,
  incrementRollCount: () => set((state) => ({
    rollCount: Math.min(state.rollCount + 1, GAME_CONSTANTS.MAX_ROLLS_PER_TURN),
  })),

  endTurn: () => set((state) => ({
    currentTurn: state.currentTurn === 'p1' ? 'p2' : 'p1',
    rollCount: 0,
    previewScores: {} as Record<RulesCategory, number>,
    keptDiceSlots: [null, null, null, null, null],
    canPour: false,
    isInPlacementMode: false,
    isReturningToCup: true,
    isSyncingDice: true,
    placementOrder: [0, 1, 2, 3, 4],
    activeCombo: null,
  })),

  resetGame: () => set({
    scores: { p1: { ...initialScores, Bonus: 0 }, p2: { ...initialScores, Bonus: 0 } },
    currentTurn: 'p1',
    rollCount: 0,
    currentDiceValues: [1, 1, 1, 1, 1],
    previewScores: {} as Record<RulesCategory, number>,
    keptDiceSlots: [null, null, null, null, null],
    canPour: true,
    isInPlacementMode: false,
    isWaitingForPlacement: false,
    isReturningToCup: false,
    isSyncingDice: false,
    placementOrder: [0, 1, 2, 3, 4],
    activeCombo: null,
  }),
}));

// 싱글 모드에서 현재가 AI(P2) 턴인지 — 이벤트 핸들러용 getState 기반 헬퍼
export function isAiTurnNow(): boolean {
  const s = useGameStore.getState();
  return s.gameMode === 'single' && s.currentTurn === 'p2';
}
