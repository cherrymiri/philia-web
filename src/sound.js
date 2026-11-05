// Gel sounds. Everything here is generated in the browser with Web Audio: no audio files, samples
// or sound libraries. There is no continuous layer at all; each sound is one short event built from
// two ingredients, and nothing is scheduled unless the gel is actually being moved.
//   pop:  a sine that sweeps quickly, like a small air pocket closing
//   tack: a few milliseconds of band-passed noise, like a sticky surface letting go
const KEY = 'philia.sound';
const LEVEL = 0.5;
const MAX_VOICES = 7;      // two hands together can't stack up into something loud
const MIN_GAP = 0.026;     // seconds between any two events

const vary = (v, amount) => v * (1 + (Math.random() * 2 - 1) * amount);
const between = (a, b) => a + Math.random() * (b - a);

function shortNoise(c) {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * 0.08), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function pop(c, out, t, { from, to, dur, gain }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.005);
}
function tack(c, out, t, noise, { freq, q, dur, gain }) {
  const s = c.createBufferSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  s.buffer = noise;
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.03, dur + 0.005);
}

// One recipe for each kind of touch. `k` is 0..1 strength.
export const RECIPES = {
  press(c, out, t, noise, k) {          // soft compressed "bbok"
    pop(c, out, t, { from: vary(250, 0.1), to: vary(125, 0.1), dur: 0.07, gain: 0.46 + 0.18 * k });
    pop(c, out, t + vary(0.03, 0.2), { from: vary(320, 0.14), to: vary(640, 0.14), dur: 0.03, gain: 0.26 });
    tack(c, out, t, noise, { freq: vary(900, 0.15), q: 1.4, dur: 0.012, gain: 0.3 });
    return 0.11;
  },
  bubble(c, out, t, noise, k) {         // one small air pocket
    const f = between(340, 680);
    pop(c, out, t, { from: f, to: f * between(1.5, 2.1), dur: between(0.018, 0.034), gain: 0.14 + 0.16 * k });
    return 0.04;
  },
  stick(c, out, t, noise, k) {          // gel peeling from itself while it stretches
    tack(c, out, t, noise, { freq: between(1000, 1900), q: 2.2, dur: between(0.012, 0.03), gain: 0.5 + 0.4 * k });
    if (Math.random() < 0.3) pop(c, out, t + 0.006, { from: between(240, 340), to: between(380, 520), dur: 0.024, gain: 0.08 });
    return 0.04;
  },
  fold(c, out, t, noise, k) {           // a run of little pops, tighter when folded fast
    pop(c, out, t, { from: vary(260, 0.1), to: vary(130, 0.1), dur: 0.075, gain: 0.42 });
    const count = 4 + Math.round(3 * k + Math.random() * 2);
    let at = t + 0.03;
    for (let i = 0; i < count; i++) {
      RECIPES.bubble(c, out, at, noise, 0.8 - 0.5 * i / count);
      at += between(0.022, 0.07) * (1.25 - 0.5 * k);
    }
    return at - t + 0.04;
  },
  release(c, out, t, noise, k) {        // finger coming away
    pop(c, out, t, { from: vary(260, 0.14), to: vary(470, 0.14), dur: 0.03, gain: 0.14 + 0.1 * k });
    tack(c, out, t + 0.004, noise, { freq: vary(1300, 0.2), q: 2, dur: 0.012, gain: 0.25 });
    return 0.05;
  },
};

export class GelSound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(KEY) === 'off'; } catch { /* default on */ }
    this.next = 0;          // earliest time for the next event
    this.voices = 0;
    this.travel = 0;        // distance moved since the last movement sound
    this.step = 0.006;
    this.speed = 0;
    this.stretching = 0;
    const unlock = () => this.start();
    addEventListener('pointerdown', unlock, { passive: true });
    addEventListener('keydown', unlock);
  }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const c = this.ctx = new Ctx();
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : LEVEL;
    const soft = c.createBiquadFilter();   // takes the edge off anything high
    soft.type = 'lowpass';
    soft.frequency.value = 3400;
    soft.Q.value = 0.5;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.ratio.value = 6;
    this.master.connect(soft).connect(comp).connect(c.destination);
    this.noise = shortNoise(c);
  }
  setMuted(on) {
    this.muted = on;
    try { localStorage.setItem(KEY, on ? 'off' : 'on'); } catch { /* not remembered */ }
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0 : LEVEL, this.ctx.currentTime, 0.02);
  }
  // Every sound in the piece goes through here, whatever the input device.
  play(name, k = 0.5, urgent = false) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (this.voices >= MAX_VOICES) return;
    if (now < this.next && !urgent) return;
    const t = Math.max(now, this.next);
    const out = this.ctx.createGain();
    out.gain.value = vary(1, 0.12);
    out.connect(this.master);
    const length = RECIPES[name](this.ctx, out, t, this.noise, k);
    this.next = t + MIN_GAP;
    this.voices += 1;
    setTimeout(() => { this.voices -= 1; out.disconnect(); }, (t - now + length + 0.05) * 1000);
  }
  press() { this.play('press', Math.min(1, this.speed * 300) * 0.5 + 0.3, true); }
  stretch() { this.stretching += 1; this.play('stick', 0.6); }
  fold() { this.play('fold', Math.min(1, this.speed * 260), true); }
  release() {
    this.stretching = Math.max(0, this.stretching - 1);
    this.play('release', 0.5);
  }
  // Called once per frame with how far the gel moved. Sounds are spaced by distance travelled, at
  // uneven steps, so faster hands mean more of them and a still hand means none.
  motion(move) {
    this.speed = this.speed * 0.8 + move * 0.2;
    if (move <= 0.00005) { this.travel = 0; return; }
    this.travel += move;
    if (this.travel < this.step) return;
    this.travel = 0;
    const k = Math.min(1, move * 260);
    if (this.stretching) {
      this.step = between(0.006, 0.014);
      this.play('stick', k);
    } else {
      this.step = between(0.005, 0.016);
      this.play(Math.random() < 0.72 ? 'bubble' : 'stick', k);
    }
  }
}
