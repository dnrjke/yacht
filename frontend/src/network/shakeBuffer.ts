interface ShakeFrame {
  cupPosition: { x: number; y: number; z: number };
  cupQuaternion: { x: number; y: number; z: number; w: number };
  diceStates: Array<{
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
  }>;
  receivedAt: number;
}

import { spectatorTuning } from '../debug/spectatorTuning';

const buffer: ShakeFrame[] = [];
const BUFFER_MAX = 24;
const STALE_MS = 900;
const EXTRAP_MAX_MS = 50;

let lastReceived = 0;
let cachedResult: ShakeFrame | null = null;
let cacheTime = 0;
let prevFrame: ShakeFrame | null = null;

export function pushShakeFrame(data: Omit<ShakeFrame, 'receivedAt'>): void {
  const now = performance.now();
  buffer.push({ ...data, receivedAt: now });
  lastReceived = now;
  while (buffer.length > BUFFER_MAX) buffer.shift();
}

export function interpolateShake(): ShakeFrame | null {
  const now = performance.now();
  if (now - cacheTime < 2 && cachedResult !== null) return cachedResult;
  cacheTime = now;

  if (buffer.length === 0) {
    cachedResult = null;
    return null;
  }

  if (buffer.length === 1) {
    cachedResult = extrapolateIfPossible(buffer[0], now);
    return cachedResult;
  }

  const targetTime = now - spectatorTuning.shakeInterpolationDelayMs;
  while (buffer.length >= 2 && buffer[1].receivedAt <= targetTime) {
    prevFrame = buffer[0];
    buffer.shift();
  }

  if (buffer.length < 2) {
    const sole = buffer[0] ?? null;
    cachedResult = sole ? extrapolateIfPossible(sole, now) : null;
    return cachedResult;
  }

  const a = buffer[0];
  const b = buffer[1];
  const frameDuration = b.receivedAt - a.receivedAt;
  if (frameDuration <= 0) {
    prevFrame = a;
    buffer.shift();
    cachedResult = b;
    return cachedResult;
  }

  const elapsed = Math.max(0, targetTime - a.receivedAt);
  const t = Math.min(elapsed / frameDuration, 1);

  if (t >= 1) {
    prevFrame = a;
    buffer.shift();
    cachedResult = b;
    return cachedResult;
  }

  prevFrame = a;
  cachedResult = lerpFrames(a, b, t);
  return cachedResult;
}

export function isShakeActive(): boolean {
  return buffer.length > 0 && (performance.now() - lastReceived) < STALE_MS;
}

export function clearShakeBuffer(): void {
  buffer.length = 0;
  lastReceived = 0;
  prevFrame = null;
}

export function getShakeBufferDebugSnapshot(): {
  bufferMs: number;
  size: number;
  lastReceivedAgeMs: number | null;
  oldestAgeMs: number | null;
  newestAgeMs: number | null;
} {
  const now = performance.now();
  return {
    bufferMs: spectatorTuning.shakeInterpolationDelayMs,
    size: buffer.length,
    lastReceivedAgeMs: lastReceived > 0 ? Math.round(now - lastReceived) : null,
    oldestAgeMs: buffer[0] ? Math.round(now - buffer[0].receivedAt) : null,
    newestAgeMs: buffer[buffer.length - 1] ? Math.round(now - buffer[buffer.length - 1].receivedAt) : null,
  };
}

function lerp3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function slerpQuat(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number },
  t: number,
) {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const bSign = dot < 0 ? -1 : 1;
  dot = Math.abs(dot);

  let s0: number, s1: number;
  if (dot > 0.9999) {
    s0 = 1 - t;
    s1 = t * bSign;
  } else {
    const omega = Math.acos(dot);
    const sinOmega = Math.sin(omega);
    s0 = Math.sin((1 - t) * omega) / sinOmega;
    s1 = Math.sin(t * omega) / sinOmega * bSign;
  }

  return {
    x: s0 * a.x + s1 * b.x,
    y: s0 * a.y + s1 * b.y,
    z: s0 * a.z + s1 * b.z,
    w: s0 * a.w + s1 * b.w,
  };
}

function extrapolateIfPossible(latest: ShakeFrame, now: number): ShakeFrame {
  if (!spectatorTuning.extrapolation || !prevFrame) return latest;
  const dt = latest.receivedAt - prevFrame.receivedAt;
  if (dt <= 0) return latest;
  const overshot = Math.min(now - latest.receivedAt, EXTRAP_MAX_MS);
  if (overshot <= 0) return latest;
  const t = overshot / dt;
  return lerpFrames(prevFrame, latest, 1 + t);
}

function lerpFrames(a: ShakeFrame, b: ShakeFrame, t: number): ShakeFrame {
  return {
    cupPosition: lerp3(a.cupPosition, b.cupPosition, t),
    cupQuaternion: slerpQuat(a.cupQuaternion, b.cupQuaternion, t),
    diceStates: a.diceStates.map((ad, i) => ({
      position: lerp3(ad.position, b.diceStates[i].position, t),
      quaternion: slerpQuat(ad.quaternion, b.diceStates[i].quaternion, t),
    })),
    receivedAt: a.receivedAt + (b.receivedAt - a.receivedAt) * t,
  };
}
