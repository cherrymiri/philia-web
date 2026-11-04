const running = new Set();
const speed = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.5 : 1;

export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t,
};
export function animate(seconds, fn, e = ease.inOut) {
  return new Promise((resolve) => {
    running.add({ t: 0, d: Math.max(seconds * speed, 0.001), fn, e, resolve });
  });
}
export const wait = (seconds) => animate(seconds, () => {}, ease.linear);
export function stepTweens(dt) {
  for (const a of [...running]) {
    a.t = Math.min(a.t + dt, a.d);
    const u = a.t / a.d;
    a.fn(a.e(u), u);
    if (u >= 1) { running.delete(a); a.resolve(); }
  }
}
