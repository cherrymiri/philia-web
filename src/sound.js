// Gel sounds. Real recordings (all CC0 on Freesound), trimmed and levelled:
//   squeeze_a  "Slime 27.wav" by Archos            freesound.org/s/433840
//   squeeze_d  "Wet Squishy sound" by ricexzeeb    freesound.org/s/151184
//   slip_a     "Slime 7.wav" by Archos             freesound.org/s/433827
//   slip_b     "slime - squishing sounds" by rubberduck9999  freesound.org/s/680447
//   drop       "water drop" by florianreichelt  freesound.org/s/683102
//   glitter    "Dropping handful of seeds / pills / beads" by Wigglesworth  freesound.org/s/833732
//   part_a     "Water Click" by Mafon2              freesound.org/s/371274
//   part_e     "soft-plastic-pings.aif" by alienistcog  freesound.org/s/125166
// Browsers only allow sound after a tap or click, so the first one unlocks it (PC and phones alike).
const NAMES = ['squeeze_a', 'squeeze_d', 'slip_a', 'slip_b', 'drop', 'glitter', 'part_a', 'part_e'];
const LEVEL = { squeeze_a: 0.9, squeeze_d: 1, slip_a: 1, slip_b: 1, drop: 0.5, glitter: 0.9, part_a: 0.32, part_e: 0.9 };
const SQUEEZES = ['squeeze_a', 'squeeze_d'];
const MAX_VOICES = 4;

let ctx = null; let out = null; let voices = 0; let lastSqueeze = -1; let lastPick = ''; let lastPart = -1;
const bufs = {};

function decode(data) {
  return new Promise((ok, fail) => {
    const p = ctx.decodeAudioData(data, ok, fail);
    if (p && p.then) p.then(ok, fail);
  });
}
function setup() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  out = ctx.createGain();
  out.gain.value = 0.8;
  out.connect(comp).connect(ctx.destination);
  for (const n of NAMES) {
    fetch(`sfx/${n}.mp3`).then((r) => r.arrayBuffer()).then(decode).then((b) => { bufs[n] = b; }).catch(() => {});
  }
}
function unlock() {
  setup();
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  // iOS wakes up only after something actually plays inside the gesture.
  const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
}
for (const e of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(e, unlock, { capture: true, passive: true });

function play(name, { gain = 1, rate = 1, lp = 18000 } = {}) {
  if (!ctx || ctx.state !== 'running' || !bufs[name] || voices >= MAX_VOICES) return;
  const s = ctx.createBufferSource();
  s.buffer = bufs[name];
  s.playbackRate.value = rate;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const g = ctx.createGain(); g.gain.value = gain * LEVEL[name];
  s.connect(f).connect(g).connect(out);
  voices++;
  s.onended = () => { voices--; };
  s.start();
}
const clamp = (v) => Math.max(0, Math.min(1, v));

export const sfx = {
  get now() { return ctx ? ctx.currentTime : 0; },
  // strength 0..1: softer and duller when light, louder and fuller when hard.
  squeeze(strength, gap = 0.12) {
    if (!ctx) return false;
    if (ctx.currentTime - lastSqueeze < gap) return false;
    const k = clamp(strength);
    let n = SQUEEZES[Math.floor(Math.random() * SQUEEZES.length)];
    if (n === lastPick) n = SQUEEZES[(SQUEEZES.indexOf(n) + 1) % SQUEEZES.length];   // never the same one twice in a row
    lastPick = n; lastSqueeze = ctx.currentTime;
    play(n, { gain: 0.22 + 0.78 * k, lp: 1600 + k * 14000, rate: 1.07 - 0.1 * k + (Math.random() - 0.5) * 0.06 });
    return true;
  },
  // A pigment drop meets the gel.
  drop() { play('drop', { rate: 0.95 + Math.random() * 0.1 }); },
  // Glitter pours out all at once: one sound per pour.
  glitter() { play('glitter'); },
  // A part lands on the gel: mostly part_a, now and then part_e.
  part() {
    if (!ctx || ctx.currentTime - lastPart < 0.035) return;
    lastPart = ctx.currentTime;
    const r = Math.random();
    const n = r < 0.8 ? 'part_a' : 'part_e';
    play(n, { gain: 0.7 + Math.random() * 0.3, rate: 0.94 + Math.random() * 0.12 });
  },
  // A stretch slides out long (slip_a); a fold or a let-go is the stickier slip_b.
  slip(name, strength) {
    const k = clamp(strength);
    play(name, { gain: 0.25 + 0.75 * k, lp: 2200 + k * 13000, rate: 1 + (Math.random() - 0.5) * 0.05 });
  },
};
