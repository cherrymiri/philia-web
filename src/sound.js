// Gel sounds, generated entirely in this file: no recordings, audio files or sound libraries.
// A small bank of varied sounds is computed when audio starts. Each one models what happens in
// slime: a few irregular air pulses pushed through a soft cavity whose resonance sweeps as the gel
// deforms. Low, rounded and damped, so it reads as squishing rather than a click, and made of
// separate short events, so it never runs together into a wash.
const KEY = 'philia.sound';
const LEVEL = 0.6;
const MAX_VOICES = 6;      // two hands together can't stack up into something loud
const MIN_GAP = 0.07;      // seconds between events

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Resonant filter whose frequency moves over time.
function resonate(x, sr, freqAt, q) {
  const y = new Float32Array(x.length);
  let low = 0; let band = 0;
  for (let i = 0; i < x.length; i++) {
    const f = 2 * Math.sin(Math.PI * Math.min(freqAt(i / x.length), sr / 6) / sr);
    low += f * band;
    const high = x[i] - low - band / q;
    band += f * high;
    y[i] = band;
  }
  return y;
}
function squelch(sr, { dur, from, to, q, count, attack = 0.005 }) {
  const n = Math.floor(dur * sr);
  const x = new Float32Array(n);
  let at = 0.002;
  for (let p = 0; p < count; p++) {         // uneven soft pulses of air
    const w = Math.floor(rand(0.001, 0.0028) * sr);
    const start = Math.floor(at * sr);
    const amp = rand(0.5, 1);
    for (let i = 0; i < w && start + i < n; i++) x[start + i] += amp * Math.sin(Math.PI * i / w);
    at += (dur * 0.8 / count) * rand(0.45, 1.55);
  }
  const sweep = (t) => from * (to / from) ** t;
  const a = resonate(x, sr, sweep, q);
  const b = resonate(x, sr, (t) => sweep(t) * 2.3, q * 0.7);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.min(1, i / (attack * sr)) ** 2 * (1 - t) ** 1.4;
    out[i] = Math.tanh((a[i] + b[i] * 0.3) * 40) * env;
  }
  return out;
}
function mix(sr, seconds, parts) {
  const out = new Float32Array(Math.floor(seconds * sr));
  for (const [at, sound, gain] of parts) {
    const o = Math.floor(at * sr);
    for (let i = 0; i < sound.length && o + i < out.length; i++) out[o + i] += sound[i] * gain;
  }
  let low = 0; let peak = 1e-6;
  const k = 1 - Math.exp(-2 * Math.PI * 2400 / sr);   // nothing bright or sharp gets through
  for (let i = 0; i < out.length; i++) { low += k * (out[i] - low); out[i] = low; peak = Math.max(peak, Math.abs(low)); }
  for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}
const air = (sr) => squelch(sr, { dur: rand(0.03, 0.06), from: rand(240, 420), to: rand(420, 760), q: 6, count: 1 });
const MAKE = {
  press: (sr) => mix(sr, 0.17, [
    [0, squelch(sr, { dur: 0.11, from: rand(130, 165), to: rand(290, 360), q: 7, count: 1, attack: 0.008 }), 1],
    [rand(0.03, 0.045), squelch(sr, { dur: 0.05, from: rand(280, 340), to: rand(480, 580), q: 5, count: 2 }), 0.5],
  ]),
  stretch: (sr) => mix(sr, 0.18, [[0, squelch(sr, { dur: rand(0.07, 0.16), from: rand(420, 600), to: rand(230, 320), q: 4.5, count: 3 + Math.floor(rand(1, 6)) }), 1]]),
  knead: (sr) => mix(sr, 0.13, [[0, squelch(sr, { dur: rand(0.05, 0.11), from: rand(220, 380), to: rand(340, 620), q: 5, count: 2 + Math.floor(rand(0, 3)) }), 1]]),
  fold: (sr) => {
    const parts = [[0, squelch(sr, { dur: 0.12, from: rand(125, 155), to: rand(270, 330), q: 7, count: 1, attack: 0.008 }), 1]];
    let at = 0.07;
    const count = 5 + Math.floor(rand(0, 4));
    for (let i = 0; i < count; i++) {
      parts.push([at, air(sr), 0.7 - 0.4 * i / count]);
      at += rand(0.035, 0.09);
    }
    return mix(sr, at + 0.08, parts);
  },
  release: (sr) => mix(sr, 0.08, [[0, squelch(sr, { dur: 0.06, from: rand(460, 560), to: rand(230, 290), q: 4, count: 3 }), 1]]),
};
export const VOLUME = { press: 0.5, stretch: 0.3, knead: 0.3, fold: 0.48, release: 0.2 };
export function makeBank(sr) {
  const bank = {};
  for (const [name, make] of Object.entries(MAKE)) bank[name] = Array.from({ length: name === 'fold' ? 6 : 10 }, () => make(sr));
  return bank;
}

export class GelSound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(KEY) === 'off'; } catch { /* default on */ }
    this.next = 0;          // earliest time for the next event
    this.voices = 0;
    this.travel = 0;        // distance moved since the last movement sound
    this.step = 0.012;
    this.bank = null;
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
    soft.frequency.value = 2800;
    soft.Q.value = 0.5;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.ratio.value = 6;
    this.master.connect(soft).connect(comp).connect(c.destination);
    this.bank = {};
    for (const [name, sounds] of Object.entries(makeBank(c.sampleRate))) {
      this.bank[name] = sounds.map((d) => { const b = c.createBuffer(1, d.length, c.sampleRate); b.copyToChannel(d, 0); return b; });
    }
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
    const src = this.ctx.createBufferSource();
    const out = this.ctx.createGain();
    src.buffer = pick(this.bank[name]);
    src.playbackRate.value = rand(0.93, 1.07);          // same sound never quite repeats
    out.gain.value = VOLUME[name] * (0.7 + 0.45 * k) * rand(0.9, 1.1);
    src.connect(out).connect(this.master);
    src.start(t);
    this.next = t + MIN_GAP;
    this.voices += 1;
    src.onended = () => { this.voices -= 1; out.disconnect(); };
  }
  press() { this.play('press', Math.min(1, this.speed * 300) * 0.5 + 0.3, true); }
  stretch() { this.stretching += 1; this.play('stretch', 0.6); }
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
      this.play('stretch', k);
    } else {
      this.step = Math.random() < 0.3 ? between(0.022, 0.04) : between(0.008, 0.018);
      this.play('knead', k);
    }
  }
}
