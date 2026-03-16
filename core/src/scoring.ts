export type RulesCategory = 
  | 'Aces' | 'Deuces' | 'Threes' | 'Fours' | 'Fives' | 'Sixes'
  | 'Choice' | 'FourOfAKind' | 'FullHouse' | 'SmallStraight'
  | 'LargeStraight' | 'Yacht';

export interface ScoreBoard {
  [category: string]: number | null;
}

export const SCORE_CATEGORIES: RulesCategory[] = [
  'Aces', 'Deuces', 'Threes', 'Fours', 'Fives', 'Sixes',
  'Choice', 'FourOfAKind', 'FullHouse', 'SmallStraight',
  'LargeStraight', 'Yacht'
];

export function calculateScore(dice: number[], category: RulesCategory): number {
  if (dice.length !== 5) return 0;
  
  const counts = new Array(7).fill(0);
  const sum = dice.reduce((acc, val) => {
    counts[val]++;
    return acc + val;
  }, 0);

  switch (category) {
    case 'Aces': return counts[1] * 1;
    case 'Deuces': return counts[2] * 2;
    case 'Threes': return counts[3] * 3;
    case 'Fours': return counts[4] * 4;
    case 'Fives': return counts[5] * 5;
    case 'Sixes': return counts[6] * 6;
    case 'Choice': return sum;
    case 'FourOfAKind': 
      return counts.some(c => c >= 4) ? sum : 0;
    case 'FullHouse':
      const hasThree = counts.some(c => c === 3);
      const hasTwo = counts.some(c => c === 2);
      // OR a FiveOfAKind counts as Full House usually in Yacht
      return (hasThree && hasTwo) || counts.some(c => c === 5) ? sum : 0;
    case 'SmallStraight':
      const uniqueStr = [...new Set(dice)].sort().join('');
      return (uniqueStr.includes('1234') || uniqueStr.includes('2345') || uniqueStr.includes('3456')) ? 15 : 0;
    case 'LargeStraight':
      const sortedStr = [...new Set(dice)].sort().join('');
      return (sortedStr === '12345' || sortedStr === '23456') ? 30 : 0;
    case 'Yacht':
      return counts.some(c => c === 5) ? 50 : 0;
    default:
      return 0;
  }
}
