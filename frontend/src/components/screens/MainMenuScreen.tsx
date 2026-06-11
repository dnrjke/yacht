import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { soundManager } from '../../utils/soundManager';
import { useI18n } from '../../utils/useI18n';
import { LANGUAGE_LABELS, type Language } from '../../utils/i18n';

const PREVIEW_SOUNDS = [
  { name: 'pouring_dice' as const, label: 'Dice' },
  { name: 'score' as const, label: 'Score' },
  { name: 'yacht' as const, label: 'Yacht' },
] as const;

const LANGUAGES = Object.entries(LANGUAGE_LABELS) as [Language, string][];

export function MainMenuScreen() {
  const setPhase = useGameStore((state) => state.setPhase);
  const [showSettings, setShowSettings] = useState(false);
  const [volume, setVolume] = useState(soundManager.masterVolume);
  const { t, lang, setLanguage } = useI18n();

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    soundManager.setMasterVolume(v);
  };

  const btnStyle = {
    padding: '15px 30px',
    fontSize: '1.2rem',
    margin: '10px',
    cursor: 'pointer',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', background: '#222', color: '#fff' }}>
      <h1>Yacht Dice</h1>
      <button
        onClick={() => setPhase('GAME')}
        style={{ ...btnStyle, background: '#4CAF50' }}
      >
        Local Play
      </button>
      <button
        onClick={() => setShowSettings(true)}
        style={{ ...btnStyle, background: '#666' }}
      >
        Settings
      </button>

      {showSettings && (
        <div
          onClick={() => setShowSettings(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#1a1a1a',
            border: '1px solid #444',
            borderRadius: '12px',
            padding: '32px 40px',
            minWidth: '300px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}>
            <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#ddd' }}>Settings</h2>

            {/* Volume */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.95rem' }}>
                <span style={{ color: '#ccc' }}>Volume</span>
                <span style={{ color: '#888' }}>{Math.round(volume * 100)}%</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  style={{ flex: 1, accentColor: '#4CAF50', cursor: 'pointer' }}
                />
              </div>
            </div>

            {/* Sound test */}
            <div>
              <div style={{ fontSize: '0.85rem', color: '#888', marginBottom: '8px' }}>Test Sounds</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {PREVIEW_SOUNDS.map(({ name, label }) => (
                  <button
                    key={name}
                    onClick={() => soundManager.play(name)}
                    style={{
                      padding: '6px 14px',
                      fontSize: '0.85rem',
                      background: '#333',
                      color: '#ccc',
                      border: '1px solid #555',
                      borderRadius: '5px',
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Language */}
            <div>
              <div style={{ marginBottom: '8px', fontSize: '0.95rem' }}>
                <span style={{ color: '#ccc' }}>Language</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {LANGUAGES.map(([code, label]) => (
                  <button
                    key={code}
                    onClick={() => setLanguage(code)}
                    style={{
                      padding: '5px 12px',
                      fontSize: '0.85rem',
                      background: lang === code ? '#4CAF50' : '#333',
                      color: lang === code ? '#fff' : '#ccc',
                      border: `1px solid ${lang === code ? '#4CAF50' : '#555'}`,
                      borderRadius: '5px',
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowSettings(false)}
              style={{
                padding: '10px 24px',
                fontSize: '1rem',
                background: '#555',
                color: '#fff',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                alignSelf: 'center',
              }}
            >
              {t('close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
