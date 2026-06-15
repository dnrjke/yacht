// Shared types and logic will go here
export const YACHT_CONSTANTS = {
  DICE_COUNT: 5,
  SIDES: 6,
} as const;

/**
 * Board geometry constants — single source of truth for frontend visuals,
 * backend physics colliders, and camera placement.
 *
 * Changing PLAY_WALL_HEIGHT automatically updates:
 *   - Keep Tray wall height  (PLAY_WALL_HEIGHT / 2)
 *   - Camera Y position      (requiredHeight + PLAY_WALL_HEIGHT * 0.5)
 *
 * Changing TRAY_DEPTH automatically updates:
 *   - Camera Z position      (-(TRAY_DEPTH / 4))
 *   - Camera lookAt Z        (-(TRAY_DEPTH / 2 + WALL_THICKNESS / 2))
 */
export const GAME_CONSTANTS = {
  MAX_ROLLS_PER_TURN: 3,
} as const;

export const BOARD_CONSTANTS = {
  // Playing area (XZ dimensions)
  BOARD_SIZE: 16,
  BOARD_THICKNESS: 1,
  WALL_THICKNESS: 1,

  // ↓ Change this one value to resize the playing area walls everywhere
  PLAY_WALL_HEIGHT: 2,

  // Keep Tray
  TRAY_DEPTH: 4,
  TRAY_SLOT_COUNT: 5,
  TRAY_SLOT_SPACING: 3,

  // Physics-only invisible walls + ceiling.
  // 200 units exceeds 2× the maximum possible camera height (≈ 84 on extreme-portrait mobile)
  // so the containment volume is always above the camera's field of view.
  PHYSICS_WALL_HEIGHT: 200,

  // Cup default resting position (outside the board, to the right)
  // CUP_REST_Y must be > PLAY_WALL_HEIGHT + 4.2 (cup visual bottom offset)
  // so the cup clears the visual walls when dragged across the board.
  // CUP_REST_X must be > BOARD_SIZE/2 + WALL_THICKNESS + cup_visual_radius(4.4) + gap
  // so the cup doesn't visually overlap with the board wall.
  CUP_REST_Y: 7,
  CUP_REST_X: 15,
  CUP_REST_Z: -3,

  // Pour boundary — dice must land inside this margin from the wall
  POUR_BOUNDARY_MARGIN: 2,
} as const;

// 컵 내부 주사위 5개 상대 위치 (컵 중심 기준)
export const CUP_DICE_OFFSETS = [
  { x: -1.2, y: -2.5, z: -1.2 },
  { x:  1.2, y: -2.5, z: -1.2 },
  { x: -1.2, y: -2.5, z:  1.2 },
  { x:  1.2, y: -2.5, z:  1.2 },
  { x:  0.0, y: -0.5, z:  0.0 },
] as const;

// 트레이 슬롯 월드 좌표 계산
export function getTraySlotPosition(slotIdx: number): { x: number; y: number; z: number } {
  const { TRAY_SLOT_COUNT, TRAY_SLOT_SPACING, BOARD_SIZE, WALL_THICKNESS, TRAY_DEPTH } = BOARD_CONSTANTS;
  const trayStartX = -((TRAY_SLOT_COUNT - 1) * TRAY_SLOT_SPACING) / 2;
  const trayCenterZ = -(BOARD_SIZE / 2 + WALL_THICKNESS + TRAY_DEPTH / 2);
  return { x: trayStartX + slotIdx * TRAY_SLOT_SPACING, y: 1.0, z: trayCenterZ };
}

export type GamePhase = 'LOBBY' | 'MAIN_MENU' | 'ONLINE_LOBBY' | 'GAME' | 'GAME_OVER';

export type GameMode = 'local' | 'single' | 'online';

export type TurnPhase =
  | 'waiting_pour'
  | 'simulating'
  | 'placement'
  | 'collecting'
  | 'scoring';

export type ConnectionQuality = 'good' | 'unstable' | 'poor';

export interface PlayerIdentity {
  playerId: string;
  secret: string;
  playerName: string;
}

export interface GameSnapshot {
  currentTurn: 'p1' | 'p2';
  rollCount: number;
  turnNumber: number;
  rollId: number;
  currentDiceValues: (number | null)[];
  keptDiceSlots: (number | null)[];
  scores: {
    p1: Record<string, number | null>;
    p2: Record<string, number | null>;
  };
  phase: 'playing' | 'finished';
  turnPhase: TurnPhase;
  canPour: boolean;
  isSimulating: boolean;
  myRole: 'p1' | 'p2';
  opponentName: string;
  opponentConnected: boolean;
  autoPlayActive: 'p1' | 'p2' | null;
}

export interface OnlineTurnContext {
  turnNumber: number;
  rollId: number;
}

export interface OnlineTransform {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
}

export interface OnlineDiceFrame {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
}

export interface OnlineRollResult extends OnlineTurnContext {
  rollCount: number;
  serverStartedAt: number;
  finalValues: number[];
  diceTrajectory: OnlineDiceFrame[][];
  cupTrajectory: OnlineTransform[];
}

export function derivePlacementOrder(
  keptDiceSlots: (number | null)[],
  diceValues: number[]
): number[] {
  const keptSet = new Set(keptDiceSlots.filter((v): v is number => v !== null));
  return [0, 1, 2, 3, 4]
    .filter(i => !keptSet.has(i))
    .map(i => ({ v: diceValues[i], i }))
    .sort((a, b) => a.v !== b.v ? a.v - b.v : a.i - b.i)
    .map(x => x.i);
}

export type { RulesCategory, ScoreBoard, ComboResult } from './scoring.js';
export { SCORE_CATEGORIES, calculateScore, checkBonus, getUpperTotal, getTotalScore, detectCombo } from './scoring.js';

export type { AiDecision } from './ai/yachtAi.js';
export { chooseAction } from './ai/yachtAi.js';
