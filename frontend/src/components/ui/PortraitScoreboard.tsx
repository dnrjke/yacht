import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { RulesCategory } from '@yacht/core';
import { useScoreClick } from './useScoreClick';

// 세로(DS형) 모드 전용 2단 점수판.
// 좌: 상단부(Aces~Sixes) + Subtotal + Bonus / 우: 하단부(Choice~Yacht) + TOTAL.
// 턴 표시는 GameScreen의 볼록 탭으로 이동했으므로 여기엔 없음.

const UPPER_CATS: RulesCategory[] = ['Aces', 'Deuces', 'Threes', 'Fours', 'Fives', 'Sixes'];
const LOWER_CATS: RulesCategory[] = ['Choice', 'FourOfAKind', 'FullHouse', 'SmallStraight', 'LargeStraight', 'Yacht'];

const BODY_MIN_PX = 10;
const SECONDARY_MIN_PX = 9;

type Props = { uiScale?: number };

export function PortraitScoreboard({ uiScale = 1 }: Props) {
  const { scores, previewScores, currentTurn, isInPlacementMode, gameMode } = useGameStore();
  const handleScoreClick = useScoreClick();

  const p1Sub = UPPER_CATS.reduce((sum, c) => sum + (Number(scores.p1[c]) || 0), 0);
  const p2Sub = UPPER_CATS.reduce((sum, c) => sum + (Number(scores.p2[c]) || 0), 0);
  const p1Total = Object.values(scores.p1).reduce((acc: number, v) => acc + (Number(v) || 0), 0);
  const p2Total = Object.values(scores.p2).reduce((acc: number, v) => acc + (Number(v) || 0), 0);

  const fontScale = uiScale < 1 ? Math.max(uiScale, 0.78) : uiScale;
  const scaledPx = (value: number, min = 0) => `${Math.max(min, Math.round(value * uiScale))}px`;
  const borderPx = (value: number) => `${Math.max(1, Math.round(value * uiScale))}px`;
  const bodyFontPx = (value: number) => `${Math.max(BODY_MIN_PX, Math.round(value * fontScale))}px`;
  const secondaryFontPx = (value: number) => `${Math.max(SECONDARY_MIN_PX, Math.round(value * fontScale))}px`;

  const scoreRow = (cat: RulesCategory) => {
    const p1Val = scores.p1[cat];
    const p2Val = scores.p2[cat];
    const preview = previewScores[cat];
    return (
      <tr
        key={cat}
        onClick={() => handleScoreClick(cat)}
        style={{
          borderBottom: `${borderPx(1)} solid #333`,
          cursor: isInPlacementMode && (currentTurn === 'p1' ? p1Val : p2Val) === null && cat !== 'Bonus' ? 'pointer' : 'default',
        }}
      >
        <td style={{ padding: `${scaledPx(3)} ${scaledPx(4)}`, textAlign: 'left', fontSize: bodyFontPx(13), lineHeight: 1.1, color: cat === 'Bonus' ? '#FFD700' : '#eee', whiteSpace: 'nowrap' }}>
          {cat}
        </td>
        <td style={{ color: p1Val !== null ? '#4CAF50' : (currentTurn === 'p1' ? '#888' : '#444') }}>
          {p1Val !== null ? p1Val : (isInPlacementMode && currentTurn === 'p1' && cat !== 'Bonus' ? preview : '-')}
        </td>
        <td style={{ color: p2Val !== null ? '#2196F3' : (currentTurn === 'p2' ? '#888' : '#444') }}>
          {p2Val !== null ? p2Val : (isInPlacementMode && currentTurn === 'p2' && cat !== 'Bonus' ? preview : '-')}
        </td>
      </tr>
    );
  };

  const headRow = (
    <tr style={{ borderBottom: `${borderPx(2)} solid #555`, color: '#aaa', fontSize: secondaryFontPx(12) }}>
      <th style={{ padding: scaledPx(4), textAlign: 'left' }}>Category</th>
      <th style={{ width: scaledPx(48, 36) }}>P1</th>
      <th style={{ width: scaledPx(48, 36) }}>{gameMode === 'single' ? 'AI' : 'P2'}</th>
    </tr>
  );

  const tableStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
    textAlign: 'center',
    fontSize: bodyFontPx(13),
  };

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', gap: scaledPx(8), padding: scaledPx(6), background: '#1a1a1a', color: '#fff', overflow: 'hidden' }}>
      <table style={tableStyle}>
        <thead>{headRow}</thead>
        <tbody>
          {UPPER_CATS.map(scoreRow)}
          <tr style={{ background: 'rgba(255,255,255,0.05)', fontSize: secondaryFontPx(11) }}>
            <td style={{ textAlign: 'left', padding: `${scaledPx(2)} ${scaledPx(4)}`, color: '#888' }}>Subtotal</td>
            <td style={{ color: p1Sub >= 63 ? '#4CAF50' : '#FFD700', fontWeight: 'bold' }}>{p1Sub} / 63</td>
            <td style={{ color: p2Sub >= 63 ? '#2196F3' : '#FFD700', fontWeight: 'bold' }}>{p2Sub} / 63</td>
          </tr>
          {scoreRow('Bonus')}
        </tbody>
      </table>

      <div style={{ width: borderPx(1), background: '#444', flex: 'none' }} />

      <table style={tableStyle}>
        <thead>{headRow}</thead>
        <tbody>{LOWER_CATS.map(scoreRow)}</tbody>
        <tfoot>
          <tr style={{ borderTop: `${borderPx(2)} solid #555`, background: 'rgba(255,255,255,0.1)' }}>
            <td style={{ padding: `${scaledPx(4)} ${scaledPx(4)}`, textAlign: 'left', fontWeight: 'bold', color: '#FFD700' }}>TOTAL</td>
            <td style={{ fontSize: bodyFontPx(14), fontWeight: 'bold', color: '#4CAF50' }}>{p1Total}</td>
            <td style={{ fontSize: bodyFontPx(14), fontWeight: 'bold', color: '#2196F3' }}>{p2Total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
