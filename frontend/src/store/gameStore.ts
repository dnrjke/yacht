import { create } from 'zustand';
import { GamePhase, GameMode, RulesCategory, SCORE_CATEGORIES, checkBonus, calculateScore, ComboResult, GAME_CONSTANTS, ConnectionQuality } from '@yacht/core';
import { resetPhysicsEngineState } from '../physics/physicsEngine';

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
  setScores: (scores: { p1: Record<string, number | null>; p2: Record<string, number | null> }) => void;

  currentDiceValues: number[];
  setCurrentDiceValues: (vals: number[]) => void;

  previewScores: Record<RulesCategory, number>;
  setPreviewScores: (previews: Record<string, number>) => void;

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
  setKeptDiceSlots: (slots: (number | null)[]) => void;

  activeCombo: ComboResult | null;
  setActiveCombo: (combo: ComboResult | null) => void;

  currentTurn: 'p1' | 'p2';
  setCurrentTurn: (turn: 'p1' | 'p2') => void;
  rollCount: number;
  setRollCount: (count: number) => void;
  incrementRollCount: () => void;
  endTurn: () => void;
  resetGame: () => void;

  // Online multiplayer fields
  myRole: 'p1' | 'p2' | null;
  setMyRole: (role: 'p1' | 'p2' | null) => void;
  roomId: string | null;
  setRoomId: (id: string | null) => void;
  opponentName: string | null;
  setOpponentName: (name: string | null) => void;
  isConnected: boolean;
  setIsConnected: (val: boolean) => void;
  opponentConnectionQuality: ConnectionQuality;
  setOpponentConnectionQuality: (q: ConnectionQuality) => void;
  turnTimerEnd: number | null;
  setTurnTimerEnd: (end: number | null) => void;
  returnReason: 'turnEnd' | 'reroll' | null;
  setReturnReason: (reason: 'turnEnd' | 'reroll' | null) => void;
  autoPlayActive: boolean;
  setAutoPlayActive: (active: boolean) => void;
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

  setScores: (scores) => set({ scores: scores as { p1: Record<RulesCategory, number | null>; p2: Record<RulesCategory, number | null> } }),

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

  setPreviewScores: (previews) => set({ previewScores: previews as Record<RulesCategory, number> }),

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
  setKeptDiceSlots: (slots) => set({ keptDiceSlots: slots }),
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
  setCurrentTurn: (currentTurn) => set({ currentTurn }),
  rollCount: 0,
  setRollCount: (rollCount) => set({ rollCount }),
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

  resetGame: () => {
    resetPhysicsEngineState();
    set({
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
    });
  },

  // Online multiplayer fields
  myRole: null,
  setMyRole: (myRole) => set({ myRole }),
  roomId: null,
  setRoomId: (roomId) => set({ roomId }),
  opponentName: null,
  setOpponentName: (opponentName) => set({ opponentName }),
  isConnected: false,
  setIsConnected: (isConnected) => set({ isConnected }),
  opponentConnectionQuality: 'good' as ConnectionQuality,
  setOpponentConnectionQuality: (opponentConnectionQuality) => set({ opponentConnectionQuality }),
  turnTimerEnd: null,
  setTurnTimerEnd: (turnTimerEnd) => set({ turnTimerEnd }),
  returnReason: null,
  setReturnReason: (returnReason) => set({ returnReason }),
  autoPlayActive: false,
  setAutoPlayActive: (autoPlayActive) => set({ autoPlayActive }),
}));

export function isAiTurnNow(): boolean {
  const s = useGameStore.getState();
  return s.gameMode === 'single' && s.currentTurn === 'p2';
}

export function isMyTurn(): boolean {
  const s = useGameStore.getState();
  if (s.gameMode === 'online') return s.currentTurn === s.myRole;
  if (s.gameMode === 'single') return s.currentTurn === 'p1';
  return true;
}

export type { GameMode };
