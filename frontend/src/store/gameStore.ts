import { create } from 'zustand';
import { Socket } from 'socket.io-client';
import { GamePhase, RulesCategory, SCORE_CATEGORIES, checkBonus, calculateScore, ComboResult, GAME_CONSTANTS } from '@yacht/core';

interface GameState {
  socket: Socket | null;
  setSocket: (socket: Socket) => void;
  
  roomId: string | null;
  setRoomId: (id: string | null) => void;

  phase: GamePhase;
  setPhase: (phase: GamePhase) => void;

  isDebug: boolean;
  setIsDebug: (val: boolean) => void;

  // 1. 점수판을 플레이어별로 관리
  scores: {
    p1: Record<RulesCategory, number | null>;
    p2: Record<RulesCategory, number | null>;
  };
  // 2. 점수 설정 함수 (보너스 자동 계산 로직 포함)
  updateScore: (player: 'p1' | 'p2', category: RulesCategory, score: number) => void;
  
  // Temporary: current roll dice values for UI display
  currentDiceValues: number[];
  setCurrentDiceValues: (vals: number[]) => void;

  //예상 점수 상태
  previewScores: Record<RulesCategory, number>;

  // Pour gate: true when all non-kept dice are in the cup
  canPour: boolean;
  setCanPour: (val: boolean) => void;

  // Placement mode: dice displayed in HUD after rolling
  isInPlacementMode: boolean;
  setIsInPlacementMode: (val: boolean) => void;
  isWaitingForPlacement: boolean;
  setIsWaitingForPlacement: (val: boolean) => void;
  isReturningToCup: boolean; // true while dice animate back into the cup
  setIsReturningToCup: (val: boolean) => void;
  isSyncingDice: boolean; // true while waiting for server's COLLECTION_DONE
  setIsSyncingDice: (val: boolean) => void;
  placementOrder: number[];
  setPlacementOrder: (val: number[]) => void;

  // Keep tray: which die index is in each of the 5 tray slots (null = empty)
  keptDiceSlots: (number | null)[];
  keepDie: (dieIndex: number) => void;   // HUD → first empty tray slot
  unkeepDie: (dieIndex: number) => void; // tray → back to HUD row

  // 콤보 연출
  activeCombo: ComboResult | null;
  setActiveCombo: (combo: ComboResult | null) => void;

  // 턴 관리 상태 추가
  currentTurn: 'p1' | 'p2';
  rollCount: number;
  incrementRollCount: () => void;
  endTurn: () => void; // 턴 종료 함수
}

const initialScores = SCORE_CATEGORIES.reduce((acc, cat) => {
  acc[cat] = null;
  return acc;
}, {} as Record<RulesCategory, number | null>);

export const useGameStore = create<GameState>((set) => ({
  socket: null,
  setSocket: (socket) => set({ socket }),

  roomId: null,
  setRoomId: (id) => set({ roomId: id }),

  phase: 'LOBBY',
  setPhase: (phase) => set({ phase }),

  isDebug: false,
  setIsDebug: (isDebug) => set({ isDebug }),

  // 초기 점수 설정 (두 명분)
  scores: {
    p1: { ...initialScores, Bonus: 0 },
    p2: { ...initialScores, Bonus: 0 },
  },

  // 점수 업데이트 로직
  updateScore: (player, category, score) => set((state) => {
    // 해당 플레이어의 새로운 점수판 생성
    const newPlayerScore = { ...state.scores[player], [category]: score };
    
    // 상단 점수 합계를 체크하여 Bonus(35점) 여부 결정 (core의 함수 활용)
    newPlayerScore['Bonus'] = checkBonus(newPlayerScore);

    return {
      scores: {
        ...state.scores,
        [player]: newPlayerScore
      }
    };
  }),

  //주사위 값이 바뀔 때 예상 점수(previewScores)를 함께 계산
  currentDiceValues: [1, 1, 1, 1, 1],
  previewScores: {} as Record<RulesCategory, number>, // 초기값
  setCurrentDiceValues: (vals) => set(() => {
    const newPreviews = {} as Record<RulesCategory, number>;
    
    // 주사위 5개 값을 바탕으로 각 카테고리별 점수 계산
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
    if (firstEmpty === -1) return state; // all 5 slots full
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
    currentDiceValues: [1, 1, 1, 1, 1],
    previewScores: {} as Record<RulesCategory, number>,
    keptDiceSlots: [null, null, null, null, null],
    canPour: true,
    isInPlacementMode: false,
    isReturningToCup: true,
    isSyncingDice: true,
    placementOrder: [0, 1, 2, 3, 4],
    activeCombo: null,
  })),
}));

