// Gel sounds, generated entirely in this file: no recordings, audio files or sound libraries.
// A small bank of varied sounds is computed when audio starts. Each is a wet squelch: noise that
// sticks and slips in irregular chunks, shaped by two resonances that open and close like a mouth,
// with a few bubbles sucked through it and a very short echo for thickness.
const KEY = 'philia.sound';
const LEVEL = 0.6;
const MAX_VOICES = 4;      // two hands together can't stack up into something loud
const MIN_GAP = 0.13;      // seconds between events

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

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
function bubble(sr, from, to, dur) {
  const n = Math.floor(dur * sr);
  const y = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    ph += 2 * Math.PI * from * (to / from) ** t / sr;
    y[i] = Math.sin(ph) * Math.min(1, i / (0.004 * sr)) * (1 - t) ** 2;
  }
  return y;
}
function squelch(sr, { dur, low, high, bubbles }) {
  const n = Math.floor(dur * sr);
  const x = new Float32Array(n);
  let gate = 0; let target = 1; let next = 0;
  for (let i = 0; i < n; i++) {
    if (i >= next) {                         // stick, slip, stick
      target = Math.random() < 0.6 ? rand(0.5, 1) : rand(0, 0.08);
      next = i + Math.floor(rand(0.006, 0.03) * sr);
    }
    gate += (target - gate) * 0.012;
    x[i] = (Math.random() * 2 - 1) * gate;
  }
  const peakAt = rand(0.3, 0.6);
  const shape = (t) => {                     // opens, then closes
    const u = t < peakAt ? t / peakAt : (1 - t) / (1 - peakAt);
    return low * (high / low) ** u;
  };
  const a = resonate(x, sr, shape, 5);
  const b = resonate(x, sr, (t) => shape(t) * 2.4, 4);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = (a[i] + b[i] * 0.4) * Math.min(1, i / (0.01 * sr)) * (1 - t) ** 1.2;
  }
  let top = 1e-6;
  for (const v of out) top = Math.max(top, Math.abs(v));
  for (let i = 0; i < n; i++) out[i] /= top;
  for (let k = 0; k < bubbles; k++) {
    const f = rand(280, 520);
    const b2 = bubble(sr, f, f * rand(1.5, 2.2), rand(0.025, 0.055));
    const at = Math.floor(rand(0, 0.8) * n);
    for (let i = 0; i < b2.length && at + i < n; i++) out[at + i] += b2[i] * 0.35;
  }
  return out;
}
function finish(sr, d) {
  const out = new Float32Array(d.length + Math.floor(0.03 * sr));
  const e1 = Math.floor(0.009 * sr); const e2 = Math.floor(0.017 * sr);
  for (let i = 0; i < d.length; i++) {       // thickens without sounding like a room
    out[i] += d[i]; out[i + e1] += d[i] * 0.3; out[i + e2] += d[i] * 0.18;
  }
  let low = 0; let peak = 1e-6;
  const k = 1 - Math.exp(-2 * Math.PI * 1900 / sr);
  for (let i = 0; i < out.length; i++) { low += k * (out[i] - low); out[i] = low; peak = Math.max(peak, Math.abs(low)); }
  for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}
const MAKE = {
  press: (sr) => squelch(sr, { dur: rand(0.16, 0.24), low: rand(240, 300), high: rand(620, 800), bubbles: 1 }),
  stretch: (sr) => squelch(sr, { dur: rand(0.3, 0.46), low: rand(300, 380), high: rand(800, 1050), bubbles: 2 }),
  knead: (sr) => squelch(sr, { dur: rand(0.17, 0.28), low: rand(260, 340), high: rand(650, 950), bubbles: 2 }),
  fold: (sr) => squelch(sr, { dur: rand(0.42, 0.56), low: rand(230, 290), high: rand(700, 900), bubbles: 4 }),
  release: (sr) => squelch(sr, { dur: rand(0.09, 0.13), low: rand(380, 460), high: rand(800, 1000), bubbles: 0 }),
};
export const VOLUME = { press: 0.5, stretch: 0.34, knead: 0.36, fold: 0.5, release: 0.2 };
export function makeBank(sr) {
  const bank = {};
  for (const [name, make] of Object.entries(MAKE)) bank[name] = Array.from({ length: 8 }, () => finish(sr, make(sr)));
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
    this.step = 0.02;
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
      this.step = rand(0.022, 0.05);
      this.play('stretch', k);
    } else {
      this.step = rand(0.018, 0.045);
      this.play('knead', k);
    }
  }
}
