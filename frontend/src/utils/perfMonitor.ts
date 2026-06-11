// Singleton perf monitor — collects timing data, renders to HUD
export const perf = {
  // FPS
  frameTimes: [] as number[],
  lastFrameTime: 0,

  // Socket events per second
  diceStatesCount: 0,
  diceStatesPerSec: 0,
  cupTransformCount: 0,
  cupTransformPerSec: 0,

  // Handler durations (ms)
  diceHandlerSum: 0,
  diceHandlerCount: 0,
  diceHandlerAvg: 0,

  // useFrame durations
  useFrameCupSum: 0,
  useFrameCupCount: 0,
  useFrameCupAvg: 0,

  useFrameDiceSum: 0,
  useFrameDiceCount: 0,
  useFrameDiceAvg: 0,

  // Socket transport
  transport: '?',

  // Touch event rate
  touchCount: 0,
  touchPerSec: 0,

  // isDragging / pouring
  dragging: false,
  pouring: false,

  // Log buffer for clipboard
  logBuffer: [] as string[],

  tickFrame() {
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      this.frameTimes.push(now - this.lastFrameTime);
      if (this.frameTimes.length > 60) this.frameTimes.shift();
    }
    this.lastFrameTime = now;
  },

  getFPS(): number {
    if (this.frameTimes.length === 0) return 0;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return avg > 0 ? 1000 / avg : 0;
  },

  getFrameTime(): number {
    if (this.frameTimes.length === 0) return 0;
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  },

  snapshot(): string {
    const fps = this.getFPS().toFixed(1);
    const ft = this.getFrameTime().toFixed(1);
    const drag = this.dragging ? 'YES' : 'no';
    return [
      `FPS: ${fps} (${ft}ms)`,
      `drag: ${drag}`,
      `transport: ${this.transport}`,
      `touch/s: ${this.touchPerSec}`,
      `CUP_TX/s: ${this.cupTransformPerSec}`,
      `DICE_RX/s: ${this.diceStatesPerSec}`,
      `diceHandler: ${this.diceHandlerAvg.toFixed(2)}ms`,
      `ufCup: ${this.useFrameCupAvg.toFixed(2)}ms`,
      `ufDice: ${this.useFrameDiceAvg.toFixed(2)}ms`,
    ].join('\n');
  },
};

// 1-second ticker to compute per-sec rates and log
setInterval(() => {
  perf.diceStatesPerSec = perf.diceStatesCount;
  perf.diceStatesCount = 0;
  perf.cupTransformPerSec = perf.cupTransformCount;
  perf.cupTransformCount = 0;
  perf.touchPerSec = perf.touchCount;
  perf.touchCount = 0;

  if (perf.diceHandlerCount > 0) {
    perf.diceHandlerAvg = perf.diceHandlerSum / perf.diceHandlerCount;
  }
  perf.diceHandlerSum = 0;
  perf.diceHandlerCount = 0;

  if (perf.useFrameCupCount > 0) {
    perf.useFrameCupAvg = perf.useFrameCupSum / perf.useFrameCupCount;
  }
  perf.useFrameCupSum = 0;
  perf.useFrameCupCount = 0;

  if (perf.useFrameDiceCount > 0) {
    perf.useFrameDiceAvg = perf.useFrameDiceSum / perf.useFrameDiceCount;
  }
  perf.useFrameDiceSum = 0;
  perf.useFrameDiceCount = 0;

  const line = `[${new Date().toLocaleTimeString()}] ${perf.snapshot().replace(/\n/g, ' | ')}`;
  perf.logBuffer.push(line);
  if (perf.logBuffer.length > 120) perf.logBuffer.shift();
}, 1000);

// Track touch events globally
if (typeof window !== 'undefined') {
  window.addEventListener('touchmove', () => { perf.touchCount++; }, { passive: true });
  window.addEventListener('pointermove', () => { perf.touchCount++; }, { passive: true });
}
