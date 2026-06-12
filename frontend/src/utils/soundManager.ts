type SoundName = 'make' | 'yacht' | 'score' | 'rolling_dice' | 'pouring_dice' | 'victory' | 'tap' | 'tap_smooth' | 'reroll';

const BASE = import.meta.env.BASE_URL ?? '/';

const SOUND_FILES: Record<SoundName, string> = {
  make: `${BASE}sounds/make.mp3`,
  yacht: `${BASE}sounds/yacht.mp3`,
  score: `${BASE}sounds/score.mp3`,
  rolling_dice: `${BASE}sounds/rolling_dice.mp3`,
  pouring_dice: `${BASE}sounds/pouring_dice.mp3`,
  victory: `${BASE}sounds/victory.mp3`,
  tap: `${BASE}sounds/tap.mp3`,
  tap_smooth: `${BASE}sounds/tap_smooth.mp3`,
  reroll: `${BASE}sounds/reroll.mp3`,
};

const STORAGE_KEY = 'yacht_master_volume';

function loadVolume(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const v = parseFloat(stored);
      if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
    }
  } catch {}
  return 1;
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private loops = new Map<SoundName, { source: AudioBufferSourceNode; gain: GainNode }>();
  private unlocked = false;
  private _masterVolume = loadVolume();

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private getMasterGain(): GainNode {
    this.getContext();
    return this.masterGain!;
  }

  get masterVolume(): number {
    return this._masterVolume;
  }

  setMasterVolume(volume: number) {
    this._masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this._masterVolume;
    }
    try {
      localStorage.setItem(STORAGE_KEY, String(this._masterVolume));
    } catch {}
  }

  ensureUnlocked() {
    if (this.unlocked) return;
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    this.unlocked = true;
  }

  async preload() {
    const ctx = this.getContext();
    const entries = Object.entries(SOUND_FILES) as [SoundName, string][];
    await Promise.all(
      entries.map(async ([name, url]) => {
        try {
          const res = await fetch(url);
          const arrayBuf = await res.arrayBuffer();
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          this.buffers.set(name, audioBuf);
        } catch (e) {
          console.warn(`[SoundManager] Failed to load ${name}:`, e);
        }
      })
    );
  }

  play(name: SoundName, options?: { delay?: number; playbackRate?: number; volume?: number }) {
    this.ensureUnlocked();
    const ctx = this.getContext();
    const buffer = this.buffers.get(name);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (options?.playbackRate) source.playbackRate.value = options.playbackRate;

    const gain = ctx.createGain();
    gain.gain.value = options?.volume ?? 1;
    source.connect(gain).connect(this.getMasterGain());

    const delay = (options?.delay ?? 0) / 1000;
    source.start(ctx.currentTime + delay);
  }

  startLoop(name: SoundName, volume = 0) {
    this.ensureUnlocked();
    if (this.loops.has(name)) return;

    const ctx = this.getContext();
    const buffer = this.buffers.get(name);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.getMasterGain());
    source.start();

    this.loops.set(name, { source, gain });
  }

  setLoopVolume(name: SoundName, volume: number) {
    const entry = this.loops.get(name);
    if (!entry) return;
    entry.gain.gain.value = Math.max(0, Math.min(1, volume));
  }

  stopLoop(name: SoundName, fadeOut = 0) {
    const entry = this.loops.get(name);
    if (!entry) return;

    if (fadeOut > 0) {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
      entry.gain.gain.linearRampToValueAtTime(0, now + fadeOut / 1000);
      entry.source.stop(now + fadeOut / 1000);
    } else {
      entry.source.stop();
    }

    this.loops.delete(name);
  }

  stopAll() {
    for (const [name] of this.loops) {
      this.stopLoop(name);
    }
  }
}

export const soundManager = new SoundManager();
