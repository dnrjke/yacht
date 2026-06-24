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
const FRAME_DT = 1000 / 60;

const MIN_DELAY_MS = 30;
const MAX_DELAY_MS = 120;
const INTERP_RATIO = 3;
const JITTER_EWMA_ALPHA = 0.1;

const RATE_MIN = 0.95;
const RATE_MAX = 1.05;
const RATE_ADJUST_SPEED = 0.002;
const TARGET_BUFFER_FRAMES = 3;

const BURST_THRESHOLD_MS = 8;
const RAMP_FRAMES = 6;
const RAMP_DURATION_MS = 100;

let lastReceived = 0;
let shakeStartTime = 0;
let frameCount = 0;
let lastConsumedFrame: ShakeFrame | null = null;

let targetDelay = MIN_DELAY_MS;
let jitterEwma = 0;
let lastArrivalTime = 0;

let consumeRate = 1.0;
let virtualTime = 0;
let lastConsumeWall = 0;

const TIMELINE_CAP = 300;
let arrivalTimeline: number[] = [];
let consumeTimeline: number[] = [];
let timelineBase = 0;
let serverArrivalTimeline: number[] | null = null;
let p1EmitTimeline: number[] | null = null;
let lastArrivalTimeline: number[] = [];
let lastConsumeTimeline: number[] = [];

interface ShakeMetrics {
  arrivalGaps: number[];
  underruns: number;
  interpolations: number;
  lastArrival: number;
  lastConsumeT: number;
  bufferSizeAtConsume: number[];
  seqGaps: number[];
  lastSeq: number;
  burstSpreads: number;
  frameDropsDueToOverflow: number;
  currentConsumeRate: number;
}

const metrics: ShakeMetrics = {
  arrivalGaps: [],
  underruns: 0,
  interpolations: 0,
  lastArrival: 0,
  lastConsumeT: 0,
  bufferSizeAtConsume: [],
  seqGaps: [],
  lastSeq: -1,
  burstSpreads: 0,
  frameDropsDueToOverflow: 0,
  currentConsumeRate: 1.0,
};

function updateJitter(now: number): void {
  if (lastArrivalTime === 0) { lastArrivalTime = now; return; }
  const gap = now - lastArrivalTime;
  lastArrivalTime = now;
  const deviation = Math.abs(gap - FRAME_DT);
  jitterEwma = jitterEwma * (1 - JITTER_EWMA_ALPHA) + deviation * JITTER_EWMA_ALPHA;
  const ratioDelay = INTERP_RATIO * FRAME_DT;
  const jitterDelay = jitterEwma * 2 + MIN_DELAY_MS;
  targetDelay = Math.max(ratioDelay, Math.min(MAX_DELAY_MS, jitterDelay));
}

function spreadBurstFrames(): void {
  if (buffer.length < 3) return;

  let burstEnd = buffer.length - 1;
  let burstStart = burstEnd;
  while (burstStart > 0) {
    if (buffer[burstStart].receivedAt - buffer[burstStart - 1].receivedAt < BURST_THRESHOLD_MS)
      burstStart--;
    else break;
  }

  const burstLen = burstEnd - burstStart + 1;
  if (burstLen < 2) return;

  const anchorTime = burstStart > 0
    ? buffer[burstStart - 1].receivedAt + FRAME_DT
    : buffer[burstStart].receivedAt;

  for (let i = 0; i < burstLen; i++) {
    buffer[burstStart + i].receivedAt = anchorTime + i * FRAME_DT;
  }
  metrics.burstSpreads++;
}

function updateConsumeRate(): void {
  if (buffer.length > TARGET_BUFFER_FRAMES + 2) {
    consumeRate = Math.min(RATE_MAX, consumeRate + RATE_ADJUST_SPEED);
  } else if (buffer.length < TARGET_BUFFER_FRAMES - 1 && buffer.length > 0) {
    consumeRate = Math.max(RATE_MIN, consumeRate - RATE_ADJUST_SPEED);
  } else {
    consumeRate += (1.0 - consumeRate) * 0.05;
  }
}

function getEffectiveDelay(now: number): number {
  if (frameCount < RAMP_FRAMES || shakeStartTime === 0) return 0;
  const elapsed = now - shakeStartTime;
  const rampProgress = Math.min(1, (elapsed - RAMP_FRAMES * FRAME_DT) / RAMP_DURATION_MS);
  return targetDelay * Math.max(0, rampProgress);
}

function getTargetTime(now: number): number {
  if (lastConsumeWall === 0) {
    lastConsumeWall = now;
    virtualTime = now;
    return now;
  }
  const wallDelta = now - lastConsumeWall;
  lastConsumeWall = now;
  virtualTime += wallDelta * consumeRate;
  return virtualTime - getEffectiveDelay(now);
}

export function getShakeMetrics() {
  const gaps = metrics.arrivalGaps;
  const sorted = [...gaps].sort((a, b) => a - b);
  const sizes = metrics.bufferSizeAtConsume;
  return {
    totalFrames: gaps.length,
    underruns: metrics.underruns,
    interpolations: metrics.interpolations,
    arrivalGap: gaps.length > 0 ? {
      min: sorted[0],
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1],
      mean: Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length),
    } : null,
    bufferSize: sizes.length > 0 ? {
      min: Math.min(...sizes),
      max: Math.max(...sizes),
      mean: +(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1),
    } : null,
    lastConsumeT: +metrics.lastConsumeT.toFixed(3),
    seqGaps: metrics.seqGaps.length > 0 ? [...metrics.seqGaps] : null,
    driftResets: 0,
    burstSpreads: metrics.burstSpreads,
    adaptiveDelay: Math.round(targetDelay),
    jitterEwma: +jitterEwma.toFixed(1),
    frameDropsDueToOverflow: metrics.frameDropsDueToOverflow,
    currentConsumeRate: +metrics.currentConsumeRate.toFixed(3),
  };
}

export function resetShakeMetrics(): void {
  metrics.arrivalGaps.length = 0;
  metrics.underruns = 0;
  metrics.interpolations = 0;
  metrics.lastArrival = 0;
  metrics.lastConsumeT = 0;
  metrics.bufferSizeAtConsume.length = 0;
  metrics.seqGaps.length = 0;
  metrics.lastSeq = -1;
  metrics.burstSpreads = 0;
  metrics.frameDropsDueToOverflow = 0;
  metrics.currentConsumeRate = 1.0;
  if (arrivalTimeline.length > 0) lastArrivalTimeline = arrivalTimeline;
  if (consumeTimeline.length > 0) lastConsumeTimeline = consumeTimeline;
  arrivalTimeline = [];
  consumeTimeline = [];
  timelineBase = 0;
}

export function pushShakeFrame(data: Omit<ShakeFrame, 'receivedAt'> & { seq?: number }): void {
  const now = performance.now();

  if (metrics.lastArrival > 0) {
    metrics.arrivalGaps.push(Math.round(now - metrics.lastArrival));
  }
  metrics.lastArrival = now;

  if (timelineBase === 0) timelineBase = now;
  if (shakeStartTime === 0) shakeStartTime = now;

  const seq = (data as any).seq;
  if (arrivalTimeline.length < TIMELINE_CAP * 3) {
    arrivalTimeline.push(
      Math.round(now - timelineBase),
      typeof seq === 'number' ? seq : -1,
      buffer.length,
    );
  }

  if (typeof seq === 'number') {
    if (metrics.lastSeq >= 0 && seq > metrics.lastSeq + 1) {
      metrics.seqGaps.push(seq - metrics.lastSeq - 1);
    }
    metrics.lastSeq = seq;
  }

  updateJitter(now);

  buffer.push({
    cupPosition: data.cupPosition,
    cupQuaternion: data.cupQuaternion,
    diceStates: data.diceStates,
    receivedAt: now,
  });

  spreadBurstFrames();

  frameCount++;
  lastReceived = now;

  while (buffer.length > BUFFER_MAX) {
    buffer.shift();
    metrics.frameDropsDueToOverflow++;
  }
}

export function interpolateShake(): ShakeFrame | null {
  const now = performance.now();

  if (buffer.length === 0) {
    return lastConsumedFrame;
  }

  while (buffer.length > 0 && now - buffer[0].receivedAt > STALE_MS) buffer.shift();
  if (buffer.length === 0) return lastConsumedFrame;

  updateConsumeRate();

  if (buffer.length === 1) {
    metrics.bufferSizeAtConsume.push(buffer.length);
    if (timelineBase > 0 && consumeTimeline.length < TIMELINE_CAP * 4) {
      consumeTimeline.push(Math.round(now - timelineBase), buffer.length, 0, 0);
    }
    lastConsumedFrame = buffer[0];
    return buffer[0];
  }

  const targetTime = getTargetTime(now);

  while (buffer.length >= 2 && buffer[1].receivedAt <= targetTime) {
    lastConsumedFrame = buffer[0];
    buffer.shift();
  }

  if (buffer.length < 2) {
    metrics.underruns++;
    metrics.bufferSizeAtConsume.push(buffer.length);
    if (timelineBase > 0 && consumeTimeline.length < TIMELINE_CAP * 4) {
      consumeTimeline.push(Math.round(now - timelineBase), buffer.length, 0, 1);
    }
    lastConsumedFrame = buffer[0] ?? lastConsumedFrame;
    return buffer[0] ?? lastConsumedFrame;
  }

  const a = buffer[0], b = buffer[1];
  const span = b.receivedAt - a.receivedAt;
  if (span <= 0) { buffer.shift(); lastConsumedFrame = b; return b; }

  const elapsed = Math.max(0, targetTime - a.receivedAt);
  const t = Math.min(elapsed / span, 1);

  metrics.interpolations++;
  metrics.lastConsumeT = t;
  metrics.currentConsumeRate = consumeRate;
  metrics.bufferSizeAtConsume.push(buffer.length);
  if (timelineBase > 0 && consumeTimeline.length < TIMELINE_CAP * 4) {
    consumeTimeline.push(Math.round(now - timelineBase), buffer.length, Math.round(t * 1000), 0);
  }

  if (t >= 1) { lastConsumedFrame = a; buffer.shift(); return b; }

  lastConsumedFrame = a;
  return lerpFrames(a, b, t);
}

export function isShakeActive(): boolean {
  return buffer.length > 0 && (performance.now() - lastReceived) < STALE_MS;
}

export function clearShakeBuffer(): void {
  buffer.length = 0;
  lastReceived = 0;
  shakeStartTime = 0;
  frameCount = 0;
  lastConsumedFrame = null;
  targetDelay = MIN_DELAY_MS;
  jitterEwma = 0;
  lastArrivalTime = 0;
  consumeRate = 1.0;
  virtualTime = 0;
  lastConsumeWall = 0;
  if (arrivalTimeline.length > 0) lastArrivalTimeline = arrivalTimeline;
  if (consumeTimeline.length > 0) lastConsumeTimeline = consumeTimeline;
  arrivalTimeline = [];
  consumeTimeline = [];
  timelineBase = 0;
}

export function getShakeTimeline(): {
  clientArrival: number[];
  consumeTrace: number[];
  serverArrival: number[] | null;
  p1Emit: number[] | null;
} {
  return {
    clientArrival: arrivalTimeline.length > 0 ? arrivalTimeline : lastArrivalTimeline,
    consumeTrace: consumeTimeline.length > 0 ? consumeTimeline : lastConsumeTimeline,
    serverArrival: serverArrivalTimeline,
    p1Emit: p1EmitTimeline,
  };
}

export function setServerTimelines(serverArrival: number[] | null, p1Emit: number[] | null): void {
  serverArrivalTimeline = serverArrival;
  p1EmitTimeline = p1Emit;
}

export function getShakeConsumeState(): { bufSz: number; consumeT: number } {
  return { bufSz: buffer.length, consumeT: +metrics.lastConsumeT.toFixed(3) };
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
    bufferMs: Math.round(targetDelay),
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
