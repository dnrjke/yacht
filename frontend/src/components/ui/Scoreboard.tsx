import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { SCORE_CATEGORIES, RulesCategory } from '@yacht/core';
import { useScoreClick } from './useScoreClick';
import { useI18n } from '../../utils/useI18n';
import { TurnTimer } from './TurnTimer';

type ScoreboardProps = {
  uiScale?: number;
  compact?: boolean;
  supernarrow?: boolean;
};

const TITLE_MIN_PX = 13;
const BODY_MIN_PX = 10;
const SECONDARY_MIN_PX = 9;

const COMPACT_TITLE_MIN_PX = 11;
const COMPACT_BODY_MIN_PX = 9;
const COMPACT_SECONDARY_MIN_PX = 8;

export function Scoreboard({ uiScale = 1, compact = false, supernarrow: _supernarrow = false }: ScoreboardProps) {
  const { scores, previewScores, currentTurn, isInPlacementMode, gameMode } = useGameStore();
  const handleScoreClick = useScoreClick();
  const { t } = useI18n();

  const upperCats: RulesCategory[] = ['Aces', 'Deuces', 'Threes', 'Fours', 'Fives', 'Sixes'];
  const p1Sub = upperCats.reduce((sum, c) => sum + (Number(scores.p1[c]) || 0), 0);
  const p2Sub = upperCats.reduce((sum, c) => sum + (Number(scores.p2[c]) || 0), 0);

  const titleMin = compact ? COMPACT_TITLE_MIN_PX : TITLE_MIN_PX;
  const bodyMin = compact ? COMPACT_BODY_MIN_PX : BODY_MIN_PX;
  const secondaryMin = compact ? COMPACT_SECONDARY_MIN_PX : SECONDARY_MIN_PX;

  const fontScale = uiScale < 1 ? Math.max(uiScale, 0.78) : uiScale;
  const scaledPx = (value: number, min = 0) => `${Math.max(min, Math.round(value * uiScale))}px`;
  const borderPx = (value: number) => `${Math.max(1, Math.round(value * uiScale))}px`;
  const fontPx = (value: number, min: number) => `${Math.max(min, Math.round(value * fontScale))}px`;
  const titleFontPx = (value: number) => fontPx(value, titleMin);
  const bodyFontPx = (value: number) => fontPx(value, bodyMin);
  const secondaryFontPx = (value: number) => fontPx(value, secondaryMin);

  const pad = compact ? 4 : 10;
  const cellPadV = compact ? 3 : 10;
  const cellPadH = compact ? 4 : 8;
  const opponentName = useGameStore(s => s.opponentName);
  const myRole = useGameStore(s => s.myRole);
  const isSingle = gameMode === 'single';
  const isOnline = gameMode === 'online';
  const isMyTurnNow = isOnline ? currentTurn === myRole : currentTurn === 'p1';
  const turnLabel = isMyTurnNow
    ? t('myTurn')
    : isSingle ? t('aiTurn') : (compact ? t('opponentShort') : t('opponentTurn'));
  const turnColor = isMyTurnNow ? '#4CAF50' : '#2196F3';
  const autoPlayActive = useGameStore(s => s.autoPlayActive);
  const opponentQuality = useGameStore(s => s.opponentConnectionQuality);
  const opponentRole = myRole === 'p1' ? 'p2' : 'p1';
  const opponentAutoPlay = isOnline && autoPlayActive === opponentRole;
  const p2Label = isOnline ? (opponentName ?? 'Opponent') : isSingle ? 'AI' : 'P2';

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: scaledPx(pad), background: '#1a1a1a', borderRadius: scaledPx(compact ? 4 : 8), color: '#fff', fontSize: bodyFontPx(14) }}>
      {!compact && (
        <h3 style={{ borderBottom: `${borderPx(1)} solid #444`, paddingBottom: scaledPx(10), margin: `${scaledPx(14)} 0 ${scaledPx(16)}`, color: turnColor, textAlign: 'center', fontSize: titleFontPx(18), lineHeight: 1.2, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: scaledPx(8) }}>
          {turnLabel}
          {isOnline && <TurnTimer fontSize={titleFontPx(14)} />}
        </h3>
      )}

      <table style={{ width: '100%', flex: 1, minHeight: 0, borderCollapse: 'collapse', tableLayout: 'fixed', textAlign: 'center' }}>
        <thead>
          <tr style={{ borderBottom: `${borderPx(2)} solid #555`, color: '#aaa', fontSize: bodyFontPx(14) }}>
            <th style={{ padding: scaledPx(compact ? 4 : 8), textAlign: 'left', ...(compact ? { color: turnColor, fontSize: titleFontPx(14) } : {}) }}>
              {compact ? <>{turnLabel}{isOnline && <>{' '}<TurnTimer fontSize={secondaryFontPx(11)} /></>}</> : 'Category'}
            </th>
            <th style={{ width: scaledPx(60, 40) }}>P1</th>
            <th style={{ width: scaledPx(60, 40) }}>
              {p2Label}
              {isOnline && opponentQuality !== 'good' && (
                <span style={{ fontSize: secondaryFontPx(9), color: opponentQuality === 'poor' ? '#FF5252' : '#FFC107' }}> ⚡</span>
              )}
              {opponentAutoPlay && <span style={{ fontSize: secondaryFontPx(9), color: '#FFD700', display: 'block' }}>[자동]</span>}
            </th>
          </tr>
        </thead>
        <tbody>
          {SCORE_CATEGORIES.map((cat) => {
            const p1Val = scores.p1[cat];
            const p2Val = scores.p2[cat];
            const preview = previewScores[cat];

            const subtotalRow = cat === 'Bonus' && (
              <tr key="subtotal-row" style={{ background: 'rgba(255,255,255,0.05)', fontSize: secondaryFontPx(12) }}>
                <td style={{ textAlign: 'left', padding: `${scaledPx(compact ? 2 : 5)} ${scaledPx(cellPadH)}`, color: '#888' }}>Subtotal</td>
                <td style={{ color: p1Sub >= 63 ? '#4CAF50' : '#FFD700', fontWeight: 'bold'  }}>{p1Sub} / 63</td>
                <td style={{ color: p2Sub >= 63 ? '#2196F3' : '#FFD700', fontWeight: 'bold' }}>{p2Sub} / 63</td>
              </tr>
            );

            return (
              <React.Fragment key={cat}>
                {subtotalRow}
                <tr
                  onClick={() => handleScoreClick(cat)}
                  style={{
                    borderBottom: `${borderPx(1)} solid #333`,
                    cursor: isInPlacementMode && (currentTurn === 'p1' ? p1Val : p2Val) === null && cat !== 'Bonus' ? 'pointer' : 'default'
                  }}
                >
                  <td style={{ padding: `${scaledPx(cellPadV)} ${scaledPx(cellPadH)}`, textAlign: 'left', fontSize: bodyFontPx(14), lineHeight: 1.1, color: cat === 'Bonus' ? '#FFD700' : '#eee', whiteSpace: 'nowrap' }}>
                    {cat}
                  </td>
                  <td style={{ color: p1Val !== null ? '#4CAF50' : (currentTurn === 'p1' ? '#888' : '#444') }}>
                    {p1Val !== null ? p1Val : (isInPlacementMode && currentTurn === 'p1' && cat !== 'Bonus' ? preview : '-')}
                  </td>
                  <td style={{ color: p2Val !== null ? '#2196F3' : (currentTurn === 'p2' ? '#888' : '#444') }}>
                    {p2Val !== null ? p2Val : (isInPlacementMode && currentTurn === 'p2' && cat !== 'Bonus' ? preview : '-')}
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: `${borderPx(2)} solid #555`, background: 'rgba(255,255,255,0.1)' }}>
            <td style={{ padding: `${scaledPx(compact ? 4 : 12)} ${scaledPx(cellPadH)}`, textAlign: 'left', fontWeight: 'bold', color: '#FFD700' }}>
              TOTAL
            </td>
            <td style={{ padding: `${scaledPx(compact ? 4 : 12)} ${scaledPx(compact ? 3 : 5)}`, fontSize: titleFontPx(15.4), fontWeight: 'bold', color: '#4CAF50' }}>
              {Object.values(scores.p1).reduce((acc: number, v) => acc + (Number(v) || 0), 0)}
            </td>
            <td style={{ padding: `${scaledPx(compact ? 4 : 12)} ${scaledPx(compact ? 3 : 5)}`, fontSize: titleFontPx(15.4), fontWeight: 'bold', color: '#2196F3' }}>
              {Object.values(scores.p2).reduce((acc: number, v) => acc + (Number(v) || 0), 0)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
