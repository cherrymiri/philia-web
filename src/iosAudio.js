// iPhone/iPad: Web Audio alone is muted by the ring/silent switch. Playing the final mix through an ordinary
// <audio> element (media playback, like music or a video) ignores the switch — the same reason EROS is heard
// (its microphone switches the phone into 'call' audio). Same code in every When Love Responds work.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const routes = [];

// Connect the final node of a work's mix to speakerOut(ctx) instead of ctx.destination.
export function speakerOut(ctx) {
  if (!IOS || !ctx.createMediaStreamDestination) return ctx.destination;
  const old = routes.find((r) => r.ctx === ctx);
  if (old) return old.bus;
  const bus = ctx.createGain();
  const dest = ctx.createMediaStreamDestination();
  bus.connect(dest);
  const el = new Audio(); el.srcObject = dest.stream; el.setAttribute('playsinline', '');
  const r = { ctx, bus, el, fallback: false };
  routes.push(r);
  wake();
  return bus;
}
function wake() {
  for (const r of routes) {
    if (r.fallback || !r.el.paused) continue;
    // if the phone refuses this route, fall back to normal output (then sound needs the switch off)
    r.el.play().catch((e) => { if (e && e.name === 'NotAllowedError') return; r.fallback = true; r.bus.connect(r.ctx.destination); });
  }
}
if (IOS) {
  for (const e of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']) window.addEventListener(e, wake, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
}
