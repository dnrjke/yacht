import type { PourResult } from '../physics/PhysicsWorld';
import { spectatorTuning } from '../debug/spectatorTuning';


interface SpectatorBufferDebugSnapshot {
  updatedAt: number;
  updatedAtIso: string;
  bufferMs: number;
  queuedAt: number;
  scheduledStartAt: number;
  remainingMs: number;
  turnNumber?: number;
  rollId?: number;
  frames: number;
}

let spectatorBufferDebugSnapshot: SpectatorBufferDebugSnapshot | null = null;

export function applySpectatorPourBuffer(result: PourResult & { turnNumber?: number; rollId?: number }): PourResult {
  const queuedAt = performance.now();
  const bufferMs = spectatorTuning.spectatorPourBufferMs;
  const scheduledStartAt = queuedAt + bufferMs;
  const updatedAt = Date.now();

  spectatorBufferDebugSnapshot = {
    updatedAt,
    updatedAtIso: new Date(updatedAt).toISOString(),
    bufferMs,
    queuedAt,
    scheduledStartAt,
    remainingMs: bufferMs,
    turnNumber: result.turnNumber,
    rollId: result.rollId,
    frames: result.diceTrajectory.length,
  };

  return {
    ...result,
    spectator: true,
    spectatorBufferMs: bufferMs,
    scheduledStartAt,
  };
}

export function getSpectatorBufferDebugSnapshot(): SpectatorBufferDebugSnapshot | null {
  if (!spectatorBufferDebugSnapshot) return null;
  return {
    ...spectatorBufferDebugSnapshot,
    remainingMs: Math.max(0, Math.round(spectatorBufferDebugSnapshot.scheduledStartAt - performance.now())),
  };
}
