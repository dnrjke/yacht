import { create } from 'zustand';
import { Socket } from 'socket.io-client';
import { GamePhase, RulesCategory, SCORE_CATEGORIES, checkBonus} from '@yacht/core';

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

  // Dice-in-cup tracking
  diceInCup: boolean[];
  setDiceInCup: (val: boolean[]) => void;
  allDiceCollected: boolean;

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

  currentDiceValues: [1, 1, 1, 1, 1],
  setCurrentDiceValues: (currentDiceValues) => set({ currentDiceValues }),

  diceInCup: [true, true, true, true, true],
  setDiceInCup: (diceInCup) => set((state) => {
    // allDiceCollected only considers non-kept dice
    const keptSet = new Set(state.keptDiceSlots.filter(s => s !== null));
    const allCollected = diceInCup.every((inCup, i) => inCup || keptSet.has(i));
    return { diceInCup, allDiceCollected: allCollected };
  }),
  allDiceCollected: true,

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
}));
