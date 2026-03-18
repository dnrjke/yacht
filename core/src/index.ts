// Shared types and logic will go here
export const YACHT_CONSTANTS = {
  DICE_COUNT: 5,
  SIDES: 6,
};

export type GamePhase = 'LOBBY' | 'TOUCH_TO_START' | 'MAIN_MENU' | 'GAME' | 'GAME_OVER';

export type { RulesCategory, ScoreBoard } from './scoring.js';
export { SCORE_CATEGORIES, calculateScore, checkBonus, getUpperTotal } from './scoring';
