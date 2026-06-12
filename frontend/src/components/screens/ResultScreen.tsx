import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getTotalScore } from '@yacht/core';
import { soundManager } from '../../utils/soundManager';
import { useI18n } from '../../utils/useI18n';

const REVEAL_DELAY_MS = 1000;

export function ResultOverlay() {
  const { scores, setPhase, resetGame, gameMode } = useGameStore();
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  const p1Total = getTotalScore(scores.p1);
  const p2Total = getTotalScore(scores.p2);
  const diff = Math.abs(p1Total - p2Total);
  const winner = p1Total > p2Total ? 'p1' : p2Total > p1Total ? 'p2' : null;

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true);
      soundManager.play('victory');
    }, REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const p2Name = gameMode === 'single' ? 'AI' : 'Player 2';
  const winnerColor = winner === 'p1' ? '#4CAF50' : winner === 'p2' ? '#2196F3' : '#FFD700';
  const winnerText = winner === 'p1' ? 'Player 1 Wins!' : winner === 'p2' ? `${p2Name} Wins!` : 'Draw!';

  const handleRematch = () => {
    resetGame();
    setPhase('GAME');
  };

  const handleMenu = () => {
    resetGame();
    setPhase('MAIN_MENU');
  };

  if (!visible) return null;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      animation: 'resultFadeIn 0.6s ease-out',
    }}>
      <style>{`
        @keyframes resultFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      <div style={{
        background: '#121212',
        borderRadius: '16px',
        border: '1px solid #444',
        padding: '40px 56px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px',
        color: '#fff',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
      }}>
        <h1 style={{ fontSize: '1.8rem', margin: 0, color: '#aaa', letterSpacing: '0.1em' }}>
          GAME OVER
        </h1>

        <div style={{ display: 'flex', gap: '48px', alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: '#999', marginBottom: '8px' }}>Player 1</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#4CAF50' }}>{p1Total}</div>
          </div>
          <div style={{ fontSize: '1.2rem', color: '#666' }}>vs</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: '#999', marginBottom: '8px' }}>{p2Name}</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#2196F3' }}>{p2Total}</div>
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: winnerColor }}>
            {winnerText}
          </div>
          {diff > 0 && (
            <div style={{ fontSize: '0.9rem', color: '#888', marginTop: '4px' }}>
              {diff}{t('scoreDiff')}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <button
            onClick={handleRematch}
            style={{
              padding: '12px 28px',
              fontSize: '1rem',
              background: '#4CAF50',
              color: '#fff',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            {t('rematch')}
          </button>
          <button
            onClick={handleMenu}
            style={{
              padding: '12px 28px',
              fontSize: '1rem',
              background: '#555',
              color: '#fff',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            {t('mainMenu')}
          </button>
        </div>
      </div>
    </div>
  );
}
