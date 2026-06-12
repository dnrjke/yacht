// Mobile PWA cold-start fix: on iOS/Android standalone launch, vh/dvh units and
// window.innerHeight can be computed from a pre-stabilized viewport, and no resize
// event follows — only an orientation change forces a recompute, leaving content
// undersized until the user rotates the device.
// visualViewport reports correct dimensions in those cases, so we mirror it into
// a CSS variable (--app-height) that index.css uses ahead of the dvh fallback.

export function initViewportSync() {
  const root = document.documentElement;

  const sync = () => {
    const vv = window.visualViewport;
    const h = vv?.height ?? window.innerHeight;
    const w = vv?.width ?? window.innerWidth;
    root.style.setProperty('--app-height', `${Math.round(h)}px`);
    root.style.setProperty('--app-width', `${Math.round(w)}px`);
  };

  sync();
  window.visualViewport?.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  window.addEventListener('resize', sync);

  // Some iOS versions stabilize the viewport shortly after launch without
  // firing any event — re-measure a couple of times as insurance.
  setTimeout(sync, 250);
  setTimeout(sync, 1000);
}
