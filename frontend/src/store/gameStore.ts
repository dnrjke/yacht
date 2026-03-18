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
}));
