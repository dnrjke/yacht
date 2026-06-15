import type { PourResult } from '../physics/PhysicsWorld';

export const SPECTATOR_POUR_BUFFER_MS = 250;

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
  const scheduledStartAt = queuedAt + SPECTATOR_POUR_BUFFER_MS;
  const updatedAt = Date.now();

  spectatorBufferDebugSnapshot = {
    updatedAt,
    updatedAtIso: new Date(updatedAt).toISOString(),
    bufferMs: SPECTATOR_POUR_BUFFER_MS,
    queuedAt,
    scheduledStartAt,
    remainingMs: SPECTATOR_POUR_BUFFER_MS,
    turnNumber: result.turnNumber,
    rollId: result.rollId,
    frames: result.diceTrajectory.length,
  };

  return {
    ...result,
    spectator: true,
    spectatorBufferMs: SPECTATOR_POUR_BUFFER_MS,
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
