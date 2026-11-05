// Gel sounds. Everything here is generated in the browser with Web Audio: no audio files, samples
// or sound libraries, and no noise of any kind, because a stream of filtered noise is what reads as
// waves. Every sound is a handful of very short decaying sine pops with silence between them.
const KEY = 'philia.sound';
const LEVEL = 0.55;
const MAX_VOICES = 6;      // two hands together can't stack up into something loud
const MIN_GAP = 0.055;     // seconds of space between events: separate pops, never a stream

const vary = (v, amount) => v * (1 + (Math.random() * 2 - 1) * amount);
const between = (a, b) => a + Math.random() * (b - a);

function pop(c, out, t, { from, to, dur, gain }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.0012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.004);
}

// One recipe for each kind of touch. `k` is 0..1 strength.
export const RECIPES = {
  press(c, out, t, k) {                 // soft compressed "bbok"
    pop(c, out, t, { from: vary(280, 0.1), to: vary(130, 0.1), dur: 0.06, gain: 0.5 + 0.18 * k });
    pop(c, out, t + vary(0.034, 0.2), { from: vary(520, 0.15), to: vary(900, 0.15), dur: 0.022, gain: 0.3 });
    return 0.09;
  },
  bubble(c, out, t, k) {                // one small air pocket closing
    const f = between(480, 1050);
    pop(c, out, t, { from: f, to: f * between(1.4, 1.9), dur: between(0.014, 0.026), gain: 0.2 + 0.2 * k });
    return 0.03;
  },
  stick(c, out, t, k) {                 // two tiny clicks: gel sticking, then letting go
    const f = between(800, 1500);
    pop(c, out, t, { from: f, to: f * 0.8, dur: between(0.007, 0.011), gain: 0.2 + 0.14 * k });
    pop(c, out, t + between(0.012, 0.03), { from: f * 1.25, to: f * 1.7, dur: between(0.01, 0.016), gain: 0.24 + 0.16 * k });
    return 0.05;
  },
  fold(c, out, t, k) {                  // a run of little pops, tighter when folded fast
    pop(c, out, t, { from: vary(280, 0.1), to: vary(135, 0.1), dur: 0.065, gain: 0.46 });
    const count = 4 + Math.round(3 * k + Math.random() * 2);
    let at = t + 0.05;
    for (let i = 0; i < count; i++) {
      RECIPES.bubble(c, out, at, 0.9 - 0.5 * i / count);
      at += between(0.038, 0.1) * (1.25 - 0.5 * k);
    }
    return at - t + 0.03;
  },
  release(c, out, t, k) {               // finger coming away
    pop(c, out, t, { from: vary(420, 0.14), to: vary(760, 0.14), dur: 0.024, gain: 0.2 + 0.1 * k });
    return 0.03;
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
    this.step = 0.012;
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
    const length = RECIPES[name](this.ctx, out, t, k);
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
      this.step = Math.random() < 0.25 ? between(0.024, 0.04) : between(0.01, 0.018);
      this.play('stick', k);
    } else {
      this.step = Math.random() < 0.3 ? between(0.022, 0.04) : between(0.008, 0.018);
      this.play(Math.random() < 0.72 ? 'bubble' : 'stick', k);
    }
  }
}
