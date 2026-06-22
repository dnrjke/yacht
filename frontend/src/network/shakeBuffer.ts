interface ShakeFrame {
  cupPosition: { x: number; y: number; z: number };
  cupQuaternion: { x: number; y: number; z: number; w: number };
  diceStates: Array<{
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
  }>;
  receivedAt: number;
}

const buffer: ShakeFrame[] = [];
const BUFFER_MAX = 24;
const STALE_MS = 900;
const SHAKE_INTERPOLATION_DELAY_MS = 180;

let lastReceived = 0;
let cachedResult: ShakeFrame | null = null;
let cacheTime = 0;

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
    cachedResult = buffer[0];
    return cachedResult;
  }

  const targetTime = now - SHAKE_INTERPOLATION_DELAY_MS;
  while (buffer.length >= 2 && buffer[1].receivedAt <= targetTime) {
    buffer.shift();
  }

  if (buffer.length < 2) {
    cachedResult = buffer[0] ?? null;
    return cachedResult;
  }

  const a = buffer[0];
  const b = buffer[1];
  const frameDuration = b.receivedAt - a.receivedAt;
  if (frameDuration <= 0) {
    buffer.shift();
    cachedResult = b;
    return cachedResult;
  }

  const elapsed = Math.max(0, targetTime - a.receivedAt);
  const t = Math.min(elapsed / frameDuration, 1);

  if (t >= 1) {
    buffer.shift();
    cachedResult = b;
    return cachedResult;
  }

  cachedResult = lerpFrames(a, b, t);
  return cachedResult;
}

export function isShakeActive(): boolean {
  return buffer.length > 0 && (performance.now() - lastReceived) < STALE_MS;
}

export function clearShakeBuffer(): void {
  buffer.length = 0;
  lastReceived = 0;
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
    bufferMs: SHAKE_INTERPOLATION_DELAY_MS,
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
