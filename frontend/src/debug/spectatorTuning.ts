import GUI from 'lil-gui';

export const spectatorTuning = {
  shakeInterpolationDelayMs: 180,
  opponentShakeHoldMs: 700,
  spectatorPourBufferMs: 250,
  extrapolation: true,
  smoothLerp: true,
  smoothLerpAlpha: 0.35,
};

let gui: GUI | null = null;

export function initSpectatorTuningGui(): void {
  if (gui) return;
  gui = new GUI({ title: 'Spectator Lag Tuning' });
  gui.add(spectatorTuning, 'shakeInterpolationDelayMs', 0, 300, 10).name('Shake Interp Delay');
  gui.add(spectatorTuning, 'opponentShakeHoldMs', 0, 1000, 50).name('Shake Hold');
  gui.add(spectatorTuning, 'spectatorPourBufferMs', 0, 500, 10).name('Pour Buffer');
  gui.add(spectatorTuning, 'extrapolation').name('Extrapolation');
  gui.add(spectatorTuning, 'smoothLerp').name('Smooth Lerp');
  gui.add(spectatorTuning, 'smoothLerpAlpha', 0.05, 1, 0.05).name('Lerp Alpha');
}
