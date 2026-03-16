import { create } from 'zustand';
import { Socket } from 'socket.io-client';
import { GamePhase, RulesCategory, SCORE_CATEGORIES } from '@yacht/core';

interface GameState {
  socket: Socket | null;
  setSocket: (socket: Socket) => void;
  
  roomId: string | null;
  setRoomId: (id: string | null) => void;

  phase: GamePhase;
  setPhase: (phase: GamePhase) => void;

  isDebug: boolean;
  setIsDebug: (val: boolean) => void;

  myScore: Record<RulesCategory, number | null>;
  setScore: (category: RulesCategory, score: number) => void;
  
  // Temporary: current roll dice values for UI display
  currentDiceValues: number[];
  setCurrentDiceValues: (vals: number[]) => void;
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

  myScore: initialScores,
  setScore: (category, score) => set((state) => ({
    myScore: { ...state.myScore, [category]: score }
  })),

  currentDiceValues: [1, 1, 1, 1, 1], // Default placeholder
  setCurrentDiceValues: (currentDiceValues) => set({ currentDiceValues }),
}));
