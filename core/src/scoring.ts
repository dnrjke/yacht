//1. 카테고리 타입 정의
export type RulesCategory = 
  | 'Aces' | 'Deuces' | 'Threes' | 'Fours' | 'Fives' | 'Sixes' | 'Bonus'
  | 'Choice' | 'FourOfAKind' | 'FullHouse' | 'SmallStraight'
  | 'LargeStraight' | 'Yacht';

//2. 점수판 인터페이스 (기록 안 된 칸은 null)
export interface ScoreBoard {
  [category: string]: number | null;
}

//3. 카테고리 목록 (순서대로)
export const SCORE_CATEGORIES: RulesCategory[] = [
  'Aces', 'Deuces', 'Threes', 'Fours', 'Fives', 'Sixes', 'Bonus',
  'Choice', 'FourOfAKind', 'FullHouse', 'SmallStraight',
  'LargeStraight', 'Yacht'
];

//4. 카테고리에 따른 점수 계산
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

//5. 특정 플레이어의 상단 항목(Acces~Sixes) 합계 구하기
export function getUpperTotal(ScoreBoard: ScoreBoard): number {
  const upperCategories: RulesCategory[] = ['Aces', 'Deuces', 'Threes', 'Fours', 'Fives', 'Sixes'];
  return upperCategories.reduce((acc, cat) => acc + (ScoreBoard[cat] ?? 0), 0);
}

//6. 상단 합계를 기준으로 보너스 점수 +35 결정
export function checkBonus(scoreBoard: ScoreBoard): number {
  return getUpperTotal(scoreBoard) >= 63 ? 35 : 0;
}

//최종 합계
export function getTotalScore(scoreBoard: ScoreBoard): number { 
  const allCategories = Object.keys(scoreBoard) as RulesCategory[];
  return allCategories.reduce((acc, cat) => acc + (scoreBoard[cat] ?? 0), 0);
}
