import { RulesCategory, calculateScore } from '../scoring.js';

export type AiDecision =
  | { action: 'score'; category: RulesCategory }
  | { action: 'reroll'; keepIndices: number[] };

type Board = Record<RulesCategory, number | null>;

const UPPER_FACE: Partial<Record<RulesCategory, number>> = {
  Aces: 1, Deuces: 2, Threes: 3, Fours: 4, Fives: 5, Sixes: 6,
};

const SACRIFICE_COST: Partial<Record<RulesCategory, number>> = {
  Aces: 1, Deuces: 2, Threes: 4, Fours: 6, Fives: 8, Sixes: 10,
  SmallStraight: 9, FullHouse: 11, Choice: 12, FourOfAKind: 13,
  LargeStraight: 15, Yacht: 18,
};

const STRAIGHT_WINDOWS = [
  [1, 2, 3, 4, 5],
  [2, 3, 4, 5, 6],
];

function openCategories(board: Board): RulesCategory[] {
  return (Object.keys(board) as RulesCategory[]).filter(c => c !== 'Bonus' && board[c] === null);
}

function faceCounts(dice: number[]): number[] {
  const counts = new Array(7).fill(0);
  dice.forEach(v => counts[v]++);
  return counts;
}

function bestStraightMatch(dice: number[]): { matched: number[]; missing: number[] } {
  const unique = new Set(dice);
  let best: { matched: number[]; missing: number[] } = { matched: [], missing: [] };
  for (const win of STRAIGHT_WINDOWS) {
    const matched = win.filter(v => unique.has(v));
    if (matched.length > best.matched.length) {
      best = { matched, missing: win.filter(v => !unique.has(v)) };
    }
  }
  return best;
}

function indicesForValues(dice: number[], values: number[]): number[] {
  const remaining = [...values];
  const indices: number[] = [];
  dice.forEach((v, i) => {
    const pos = remaining.indexOf(v);
    if (pos !== -1) {
      remaining.splice(pos, 1);
      indices.push(i);
    }
  });
  return indices;
}

function indicesOfFace(dice: number[], face: number): number[] {
  return dice.map((v, i) => ({ v, i })).filter(x => x.v === face).map(x => x.i);
}

function pickScoringCategory(dice: number[], board: Board): RulesCategory {
  const open = openCategories(board);
  let best: RulesCategory = open[0];
  let bestVal = -Infinity;

  for (const cat of open) {
    const score = calculateScore(dice, cat);
    let val = score;

    const face = UPPER_FACE[cat];
    if (face !== undefined) {
      const count = dice.filter(v => v === face).length;
      if (count >= 3) val += 4;
    }

    if (score === 0) val -= SACRIFICE_COST[cat] ?? 5;
    if (cat === 'Choice' && score < 20) val -= (20 - score) * 0.5;

    if (val > bestVal) {
      bestVal = val;
      best = cat;
    }
  }
  return best;
}

export function chooseAction(dice: number[], board: Board, rollsLeft: number): AiDecision {
  const open = openCategories(board);
  const counts = faceCounts(dice);

  const scoreNow = (): AiDecision => ({ action: 'score', category: pickScoringCategory(dice, board) });

  if (rollsLeft <= 0 || open.length === 0) return scoreNow();

  if (open.includes('Yacht') && calculateScore(dice, 'Yacht') > 0) {
    return { action: 'score', category: 'Yacht' };
  }
  if (open.includes('LargeStraight') && calculateScore(dice, 'LargeStraight') > 0) {
    return { action: 'score', category: 'LargeStraight' };
  }

  const quadFace = counts.findIndex(c => c >= 4);
  if (quadFace !== -1) {
    if (open.includes('Yacht')) {
      return { action: 'reroll', keepIndices: indicesOfFace(dice, quadFace).slice(0, 4) };
    }
    if (open.includes('FourOfAKind')) {
      return { action: 'score', category: 'FourOfAKind' };
    }
  }

  if (open.includes('FullHouse') && calculateScore(dice, 'FullHouse') > 0) {
    return { action: 'score', category: 'FullHouse' };
  }

  const straight = bestStraightMatch(dice);
  const smallMade = calculateScore(dice, 'SmallStraight') > 0;
  if (smallMade && open.includes('LargeStraight') && straight.matched.length === 4) {
    return { action: 'reroll', keepIndices: indicesForValues(dice, straight.matched) };
  }
  if (smallMade && open.includes('SmallStraight') && !open.includes('LargeStraight')) {
    return { action: 'score', category: 'SmallStraight' };
  }

  const straightOpen = open.includes('SmallStraight') || open.includes('LargeStraight');
  const maxCount = Math.max(...counts);
  if (straightOpen && (
    straight.matched.length >= 4 ||
    (straight.matched.length === 3 && maxCount <= 2 && rollsLeft >= 2)
  )) {
    return { action: 'reroll', keepIndices: indicesForValues(dice, straight.matched) };
  }

  let targetFace = 0;
  let targetScore = -Infinity;
  for (let face = 1; face <= 6; face++) {
    if (counts[face] === 0) continue;
    const upperCat = (Object.keys(UPPER_FACE) as RulesCategory[]).find(c => UPPER_FACE[c] === face)!;
    let s = counts[face] * 10 + face;
    if (board[upperCat] === null) s += 5;
    if (s > targetScore) {
      targetScore = s;
      targetFace = face;
    }
  }

  if (targetFace > 0 && counts[targetFace] >= 2) {
    const keep = indicesOfFace(dice, targetFace);
    if (keep.length >= 5) return scoreNow();
    return { action: 'reroll', keepIndices: keep };
  }

  if (targetFace > 0) {
    const keep = straightOpen ? indicesForValues(dice, straight.matched) : indicesOfFace(dice, targetFace);
    return { action: 'reroll', keepIndices: keep };
  }

  return { action: 'reroll', keepIndices: [] };
}
