import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getPhysicsEngine } from '../../physics/physicsEngine';
import { getCupVisualDebugSnapshot } from '../3d/PhysicsCup';
import { getDicePlaybackDebugSnapshot, getRenderedDiceDebugSnapshot } from '../3d/PhysicsDice';

interface LogEntry {
  time: number;
  label: string;
  data: Record<string, unknown>;
}

const MAX_LOG = 50;
const DEBUG_SCHEMA = 'online-pour-debug-v6';

let logBuffer: LogEntry[] = [];
let logSeq = 0;

export function pushDebugLog(label: string, data: Record<string, unknown>) {
  logBuffer.push({ time: Date.now(), label, data });
  if (logBuffer.length > MAX_LOG) logBuffer.shift();
  logSeq++;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length <= 6) {
      return `{${keys.map(k => `${k}:${fmt(o[k])}`).join(' ')}}`;
    }
    return JSON.stringify(v);
  }
  return String(v);
}

function buildSnapshot() {
  const s = useGameStore.getState();
  const physics = getPhysicsEngine();
  const diceStates = physics?.getDiceStates() ?? [];
  const copiedAt = Date.now();
  const cupVisual = getCupVisualDebugSnapshot();
  const renderedDice = getRenderedDiceDebugSnapshot();
  const dicePlayback = getDicePlaybackDebugSnapshot();

  const snap: Record<string, unknown> = {
    debugSchema: DEBUG_SCHEMA,
    ts: new Date(copiedAt).toISOString(),
    copiedAt,
    turn: s.currentTurn,
    myRole: s.myRole,
    onlineTurnNumber: s.onlineTurnNumber,
    onlineRollId: s.onlineRollId,
    rollCount: s.rollCount,
    turnPhase: getTurnPhase(s),
    canPour: s.canPour,
    diceValues: s.currentDiceValues,
    keptSlots: s.keptDiceSlots,
    isPlacement: s.isInPlacementMode,
    isWaitingForPlacement: s.isWaitingForPlacement,
    isReturning: s.isReturningToCup,
    isSyncing: s.isSyncingDice,
    returnReason: s.returnReason,
    autoPlay: s.autoPlayActive,
    connected: s.isConnected,
    opponentQuality: s.opponentConnectionQuality,
  };

  if (diceStates.length > 0) {
    snap.dicePositions = diceStates.map(d => ({
      x: +d.position.x.toFixed(2),
      y: +d.position.y.toFixed(2),
      z: +d.position.z.toFixed(2),
    }));
    snap.diceQuats = diceStates.map(d => ({
      x: +d.quaternion.x.toFixed(3),
      y: +d.quaternion.y.toFixed(3),
      z: +d.quaternion.z.toFixed(3),
      w: +d.quaternion.w.toFixed(3),
    }));
  }

  if (physics) {
    snap.diceInCup = physics.diceInCup;
    snap.keptDice = physics.keptDice;
    snap.physicsValues = physics.currentDiceValues;
  }

  snap.cupVisual = cupVisual ? {
    ...cupVisual,
    ageMs: copiedAt - cupVisual.updatedAt,
  } : null;

  if (renderedDice) {
    snap.renderedDice = {
      ...renderedDice,
      ageMs: copiedAt - renderedDice.updatedAt,
    };
  }

  if (dicePlayback) {
    snap.dicePlayback = {
      ...dicePlayback,
      ageMs: copiedAt - dicePlayback.updatedAt,
    };
  }

  return snap;
}

function getTurnPhase(s: ReturnType<typeof useGameStore.getState>): string {
  if (s.isSyncingDice) return 'syncing';
  if (s.isReturningToCup) return 'returning';
  if (s.isInPlacementMode) return 'placement';
  if (s.canPour) return 'waiting_pour';
  return 'other';
}

export function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (open) {
      intervalRef.current = setInterval(() => setTick(t => t + 1), 200);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [open]);

  const copySnapshot = useCallback(() => {
    const snap = buildSnapshot();
    const logs = logBuffer.slice(-20).map(e => {
      const t = new Date(e.time).toISOString().slice(11, 23);
      return `[${t}] ${e.label}: ${JSON.stringify(e.data)}`;
    });
    const text = JSON.stringify({ snapshot: snap, recentEvents: logs }, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  const gameMode = useGameStore(s => s.gameMode);
  if (gameMode !== 'online') return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          bottom: 8,
          right: 8,
          zIndex: 9999,
          background: 'rgba(0,0,0,0.6)',
          color: '#0f0',
          border: '1px solid #0f04',
          borderRadius: 4,
          padding: '4px 8px',
          fontSize: 11,
          fontFamily: 'monospace',
          cursor: 'pointer',
        }}
      >
        DBG
      </button>
    );
  }

  const s = useGameStore.getState();
  const physics = getPhysicsEngine();
  const diceStates = physics?.getDiceStates() ?? [];
  const cupVisual = getCupVisualDebugSnapshot();
  const renderedDice = getRenderedDiceDebugSnapshot();
  const dicePlayback = getDicePlaybackDebugSnapshot();
  const phase = getTurnPhase(s);

  return (
    <div style={{
      position: 'fixed',
      bottom: 8,
      right: 8,
      zIndex: 9999,
      width: 340,
      maxHeight: '60vh',
      overflow: 'auto',
      background: 'rgba(0,0,0,0.85)',
      color: '#0f0',
      border: '1px solid #0f04',
      borderRadius: 6,
      padding: 8,
      fontSize: 11,
      fontFamily: 'monospace',
      lineHeight: 1.5,
      userSelect: 'text',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 'bold' }}>Debug Overlay</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={copySnapshot} style={btnStyle}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={() => setOpen(false)} style={btnStyle}>
            Close
          </button>
        </div>
      </div>

      <Section title="State">
        <Row label="debugSchema" value={DEBUG_SCHEMA} />
        <Row label="turn" value={`${s.currentTurn} (me: ${s.myRole})`} />
        <Row label="roll" value={`${s.rollCount}/3`} />
        <Row label="phase" value={phase} />
        <Row label="canPour" value={s.canPour} />
        <Row label="waitingPlace" value={s.isWaitingForPlacement} />
        <Row label="connected" value={s.isConnected} />
        <Row label="oppQuality" value={s.opponentConnectionQuality} />
        <Row label="autoPlay" value={s.autoPlayActive} />
        <Row label="returnReason" value={s.returnReason} />
      </Section>

      <Section title="Dice Values">
        <Row label="store" value={fmt(s.currentDiceValues)} />
        {physics && <Row label="physics" value={fmt(physics.currentDiceValues)} />}
        {renderedDice && <Row label="renderTop" value={fmt(renderedDice.topValues)} />}
        {renderedDice && <Row label="renderAge" value={`${Date.now() - renderedDice.updatedAt}ms`} />}
        <Row label="keptSlots" value={fmt(s.keptDiceSlots)} />
      </Section>

      {dicePlayback && (
        <Section title="Dice Playback">
          <Row label="status" value={dicePlayback.status} />
          <Row label="frame" value={`${dicePlayback.currentFrame}/${dicePlayback.totalFrames}`} />
          <Row label="remaining" value={`${dicePlayback.remainingMs}ms`} warn={dicePlayback.remainingMs > 3000} />
          <Row label="age" value={`${Date.now() - dicePlayback.updatedAt}ms`} />
        </Section>
      )}

      {cupVisual && (
        <Section title="Cup Visual">
          <Row label="source" value={cupVisual.source} />
          <Row label="visual" value={`pos(${cupVisual.visualPosition.x}, ${cupVisual.visualPosition.y}, ${cupVisual.visualPosition.z})`} />
          {cupVisual.physicsPosition && (
            <Row label="physics" value={`pos(${cupVisual.physicsPosition.x}, ${cupVisual.physicsPosition.y}, ${cupVisual.physicsPosition.z})`} />
          )}
          <Row label="delta" value={`${cupVisual.visualPhysicsDelta ?? 'n/a'}`} warn={(cupVisual.visualPhysicsDelta ?? 0) > 1} />
          {cupVisual.playback && (
            <Row label="playback" value={`${cupVisual.playback.preview ? 'preview' : 'auth'} ${cupVisual.playback.currentFrame}/${cupVisual.playback.totalFrames}`} />
          )}
          {cupVisual.lastPointerUp && (
            <Row label="upAge" value={`${cupVisual.lastPointerUp.ageMs}ms`} />
          )}
          <Row label="age" value={`${Date.now() - cupVisual.updatedAt}ms`} />
        </Section>
      )}

      {diceStates.length > 0 && (
        <Section title="Dice Positions">
          {diceStates.map((d, i) => (
            <Row
              key={i}
              label={`d${i}`}
              value={`pos(${d.position.x.toFixed(1)}, ${d.position.y.toFixed(1)}, ${d.position.z.toFixed(1)}) q(${d.quaternion.x.toFixed(2)},${d.quaternion.y.toFixed(2)},${d.quaternion.z.toFixed(2)},${d.quaternion.w.toFixed(2)})`}
              warn={d.position.y < -10}
            />
          ))}
          {physics && (
            <>
              <Row label="inCup" value={fmt(physics.diceInCup)} />
              <Row label="kept" value={fmt(physics.keptDice)} />
            </>
          )}
        </Section>
      )}

      <Section title={`Events (last ${Math.min(logBuffer.length, 15)})`}>
        {logBuffer.slice(-15).reverse().map((e, i) => {
          const t = new Date(e.time).toISOString().slice(11, 23);
          return (
            <div key={i} style={{ color: '#aaa', wordBreak: 'break-all' }}>
              <span style={{ color: '#666' }}>{t}</span>{' '}
              <span style={{ color: '#0f0' }}>{e.label}</span>{' '}
              {Object.keys(e.data).length > 0 && <span>{fmt(e.data)}</span>}
            </div>
          );
        })}
        {logBuffer.length === 0 && <div style={{ color: '#666' }}>No events yet</div>}
      </Section>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#333',
  color: '#0f0',
  border: '1px solid #0f04',
  borderRadius: 3,
  padding: '2px 8px',
  fontSize: 10,
  fontFamily: 'monospace',
  cursor: 'pointer',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ color: '#888', borderBottom: '1px solid #333', marginBottom: 2, fontSize: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: unknown; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, color: warn ? '#f44' : undefined }}>
      <span style={{ color: '#888', minWidth: 80 }}>{label}:</span>
      <span>{typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value ?? 'null')}</span>
    </div>
  );
}
