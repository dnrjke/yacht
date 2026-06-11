import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GameScene } from '../GameScene';
import { Scoreboard } from '../ui/Scoreboard';
import { ResultOverlay } from './ResultScreen';
import { soundManager } from '../../utils/soundManager';
import { useI18n } from '../../utils/useI18n';

const DESKTOP_BASE_HEIGHT = 1080;
const DESKTOP_MAX_HEIGHT = 2160;
const DESKTOP_MIN_SCALE = 0.3;
const COMPACT_THRESHOLD = 0.5;
const NARROW_THRESHOLD = 400 / DESKTOP_BASE_HEIGHT;
const SQUARISH_ASPECT_RATIO = 1.5;
const SIDEBAR_BASE_WIDTH = 350;
const SIDEBAR_MIN_WIDTH = 250;
const SIDEBAR_MID_MIN_WIDTH = 215;
const SIDEBAR_NARROW_MIN_WIDTH = 180;
const SIDEBAR_SUPERNARROW_MIN_WIDTH = 140;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getDesktopUiScale() {
  if (typeof window === 'undefined') {
    return 1;
  }

  return clamp(
    window.innerHeight / DESKTOP_BASE_HEIGHT,
    DESKTOP_MIN_SCALE,
    DESKTOP_MAX_HEIGHT / DESKTOP_BASE_HEIGHT
  );
}

function getAspectRatio() {
  if (typeof window === 'undefined') return 16 / 9;
  return window.innerWidth / window.innerHeight;
}

function HomeIcon({ size = 18, color = '#aaa' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12L12 3l9 9" />
      <path d="M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
    </svg>
  );
}

function SpeakerIcon({ size = 18, color = '#aaa', muted = false }: { size?: number; color?: string; muted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      {muted ? (
        <>
          <line x1="17" y1="9" x2="23" y2="15" />
          <line x1="23" y1="9" x2="17" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 010 7.07" />
          <path d="M19.07 4.93a10 10 0 010 14.14" />
        </>
      )}
    </svg>
  );
}

const PREVIEW_SOUNDS = [
  { name: 'pouring_dice' as const, label: 'Dice' },
  { name: 'score' as const, label: 'Score' },
  { name: 'yacht' as const, label: 'Yacht' },
] as const;

export function GameScreen() {
  const isDebug = useGameStore((state) => state.isDebug);
  const phase = useGameStore((state) => state.phase);
  const setPhase = useGameStore((state) => state.setPhase);
  const [uiScale, setUiScale] = useState(getDesktopUiScale);
  const [aspectRatio, setAspectRatio] = useState(getAspectRatio);
  const [showHomeConfirm, setShowHomeConfirm] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [volume, setVolume] = useState(soundManager.masterVolume);
  const volumePopoverRef = useRef<HTMLDivElement>(null);
  const volumeBtnRef = useRef<HTMLButtonElement>(null);
  const { t } = useI18n();

  const squarish = aspectRatio <= SQUARISH_ASPECT_RATIO;
  const compact = uiScale <= COMPACT_THRESHOLD;
  const narrow = uiScale <= NARROW_THRESHOLD;
  const supernarrow = squarish;
  const sidebarMinWidth = supernarrow ? SIDEBAR_SUPERNARROW_MIN_WIDTH : narrow ? SIDEBAR_NARROW_MIN_WIDTH : compact ? SIDEBAR_MID_MIN_WIDTH : SIDEBAR_MIN_WIDTH;
  const sidebarBaseWidth = supernarrow ? 280 : SIDEBAR_BASE_WIDTH;
  const sidebarWidth = Math.max(sidebarMinWidth, Math.round(sidebarBaseWidth * uiScale));
  const scaledPx = (value: number, min = 0) => `${Math.max(min, Math.round(value * uiScale))}px`;

  const btnSize = Math.max(28, Math.round(36 * uiScale));
  const iconSize = Math.max(16, Math.round(20 * uiScale));
  const toolbarGap = Math.max(4, Math.round(6 * uiScale));

  useEffect(() => {
    let frameId = 0;

    const updateScale = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        setUiScale(getDesktopUiScale());
        setAspectRatio(getAspectRatio());
      });
    };

    updateScale();
    window.addEventListener('resize', updateScale);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener('resize', updateScale);
    };
  }, []);

  useEffect(() => {
    if (!showVolume) return;
    const handleClick = (e: MouseEvent) => {
      if (
        volumePopoverRef.current && !volumePopoverRef.current.contains(e.target as Node) &&
        volumeBtnRef.current && !volumeBtnRef.current.contains(e.target as Node)
      ) {
        setShowVolume(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showVolume]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    soundManager.setMasterVolume(v);
  };

  const isMuted = volume === 0;

  const toolbarBtnStyle: React.CSSProperties = {
    width: `${btnSize}px`,
    height: `${btnSize}px`,
    background: 'rgba(255,255,255,0.08)',
    border: `${Math.max(1, Math.round(uiScale))}px solid #555`,
    borderRadius: `${Math.max(4, Math.round(6 * uiScale))}px`,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };

  const previewBtnFontSize = `${Math.max(10, Math.round(11 * uiScale))}px`;

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div style={{
        flex: `0 0 ${sidebarWidth}px`,
        width: `${sidebarWidth}px`,
        minWidth: `${sidebarMinWidth}px`,
        background: '#2a2a2a',
        color: 'white',
        borderRight: `${Math.max(1, Math.round(2 * uiScale))}px solid #444`,
        padding: scaledPx(20),
        zIndex: 10,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}>
        <Scoreboard uiScale={uiScale} compact={compact} supernarrow={supernarrow} />
      </div>

      {/* Toolbar: right outside scoreboard */}
      <div style={{
        position: 'absolute',
        left: `${sidebarWidth + Math.max(1, Math.round(2 * uiScale)) + Math.max(6, Math.round(8 * uiScale))}px`,
        top: `${Math.max(6, Math.round(8 * uiScale))}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: `${toolbarGap}px`,
        zIndex: 60,
      }}>
        <button onClick={() => setShowHomeConfirm(true)} style={toolbarBtnStyle}>
          <HomeIcon size={iconSize} color="#aaa" />
        </button>
        <div style={{ position: 'relative' }}>
          <button ref={volumeBtnRef} onClick={() => setShowVolume(!showVolume)} style={toolbarBtnStyle}>
            <SpeakerIcon size={iconSize} color="#aaa" muted={isMuted} />
          </button>
          {showVolume && (
            <div ref={volumePopoverRef} style={{
              position: 'absolute',
              left: `${btnSize + 8}px`,
              top: 0,
              background: '#1a1a1a',
              border: `${Math.max(1, Math.round(uiScale))}px solid #555`,
              borderRadius: `${Math.max(4, Math.round(6 * uiScale))}px`,
              padding: `${Math.max(6, Math.round(8 * uiScale))}px ${Math.max(10, Math.round(14 * uiScale))}px`,
              display: 'flex',
              flexDirection: 'column',
              gap: `${Math.max(6, Math.round(8 * uiScale))}px`,
              whiteSpace: 'nowrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: `${Math.max(8, Math.round(10 * uiScale))}px` }}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  style={{ width: `${Math.max(80, Math.round(120 * uiScale))}px`, accentColor: '#4CAF50', cursor: 'pointer' }}
                />
                <span style={{ color: '#888', fontSize: `${Math.max(11, Math.round(13 * uiScale))}px`, minWidth: '32px', textAlign: 'right' }}>
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <div style={{ display: 'flex', gap: `${Math.max(4, Math.round(4 * uiScale))}px` }}>
                {PREVIEW_SOUNDS.map(({ name, label }) => (
                  <button
                    key={name}
                    onClick={() => soundManager.play(name)}
                    style={{
                      padding: `${Math.max(3, Math.round(4 * uiScale))}px ${Math.max(6, Math.round(8 * uiScale))}px`,
                      fontSize: previewBtnFontSize,
                      background: '#333',
                      color: '#ccc',
                      border: `1px solid #555`,
                      borderRadius: `${Math.max(3, Math.round(4 * uiScale))}px`,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Home confirm dialog */}
      {showHomeConfirm && (
        <div
          onClick={() => setShowHomeConfirm(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#2a2a2a',
            border: '1px solid #555',
            borderRadius: '12px',
            padding: '24px 32px',
            textAlign: 'center',
            color: '#fff',
          }}>
            <p style={{ margin: '0 0 16px', fontSize: '0.95rem', lineHeight: 1.4 }}>
              {t('homeConfirmTitle')}<br />
              <span style={{ color: '#888', fontSize: '0.85rem' }}>{t('homeConfirmDesc')}</span>
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button
                onClick={() => { setShowHomeConfirm(false); setPhase('MAIN_MENU'); }}
                style={{ padding: '8px 20px', fontSize: '0.9rem', background: '#4CAF50', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
              >
                {t('confirm')}
              </button>
              <button
                onClick={() => setShowHomeConfirm(false)}
                style={{ padding: '8px 20px', fontSize: '0.9rem', background: '#555', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <GameScene />
        {isDebug && (
          <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(0,0,0,0.7)', color: 'lime', padding: '10px', fontFamily: 'monospace', zIndex: 100 }}>
            <p>DEBUG MODE ACTIVE</p>
          </div>
        )}
        {phase === 'GAME_OVER' && <ResultOverlay />}
      </div>
    </div>
  );
}
