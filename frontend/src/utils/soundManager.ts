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
  private _masterVolume = loadVolume();
  private listenersInitialized = false;

  private getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.createContext();
    }
    return this.ctx!;
  }

  private createContext() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._masterVolume;
    this.masterGain.connect(this.ctx.destination);
    // 이전 컨텍스트에 묶인 루프 소스는 모두 무효 — 맵만 비운다.
    // 디코딩된 AudioBuffer는 컨텍스트 독립적이므로 재로드 불필요.
    this.loops.clear();
    this.initLifecycleHandlers();
  }

  // 모바일에서 장시간 백그라운드 후 복귀 시 오디오 세션이 OS에 의해 회수될 수 있다.
  // resume()이 실패하거나 응답이 없으면 컨텍스트를 재생성해야 소리가 돌아온다.
  private async resumeOrRecreate() {
    if (!this.ctx) return;
    if (this.ctx.state === 'closed') {
      this.createContext();
      return;
    }
    if ((this.ctx.state as string) !== 'running') {
      await Promise.race([
        this.ctx.resume().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);
      if (this.ctx && (this.ctx.state as string) !== 'running') {
        this.createContext();
      }
    }
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
    const ctx = this.getContext();
    if ((ctx.state as string) !== 'running') {
      ctx.resume().catch(() => {});
    }
  }

  private initLifecycleHandlers() {
    if (this.listenersInitialized) return;
    this.listenersInitialized = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.resumeOrRecreate();
      }
    });

    // iOS는 백그라운드 복귀 후 사용자 제스처 시점에만 resume을 허용하는 경우가 있다.
    // 'interrupted'(iOS 비표준 상태) 포함, running이 아니면 터치 시 복구 시도.
    const onGesture = () => {
      if (this.ctx && (this.ctx.state as string) !== 'running') {
        this.resumeOrRecreate();
      }
    };
    document.addEventListener('touchstart', onGesture, { passive: true });
    document.addEventListener('pointerdown', onGesture, { passive: true });
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
