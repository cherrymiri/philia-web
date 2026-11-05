// Gel sounds, all synthesised, no audio files. Starts after the first touch, as browsers require.
const KEY = 'philia.sound';

export class GelSound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(KEY) === 'off'; } catch { /* default on */ }
    this.last = {};
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
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    // soft noise, darker than white noise
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < d.length; i++) { v = v * 0.86 + (Math.random() * 2 - 1) * 0.14; d[i] = v * 3; }
    this.noise = buf;
    // continuous wet movement, only audible while the gel is being worked
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    this.bed = c.createBiquadFilter();
    this.bed.type = 'bandpass'; this.bed.frequency.value = 380; this.bed.Q.value = 1.6;
    this.bedGain = c.createGain();
    this.bedGain.gain.value = 0;
    src.connect(this.bed).connect(this.bedGain).connect(this.master);
    src.start();
  }
  setMuted(on) {
    this.muted = on;
    try { localStorage.setItem(KEY, on ? 'off' : 'on'); } catch { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(on ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }
  ready(name, gap) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return false;
    const t = this.ctx.currentTime;
    if (t - (this.last[name] || 0) < gap) return false;
    this.last[name] = t;
    return true;
  }
  burst({ from, to, q, time, level }) {
    const c = this.ctx; const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + time);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t + time);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5, time + 0.05);
  }
  thump(from, to, time, level) {
    const c = this.ctx; const t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + time);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + time);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + time + 0.02);
  }
  vary() { return 0.88 + Math.random() * 0.24; }
  press() {
    if (!this.ready('press', 0.09)) return;
    const k = this.vary();
    this.burst({ from: 760 * k, to: 230 * k, q: 2.6, time: 0.2, level: 0.34 });
    this.thump(150 * k, 72 * k, 0.16, 0.1);
  }
  stretch() {
    if (!this.ready('stretch', 0.12)) return;
    const k = this.vary();
    this.burst({ from: 260 * k, to: 720 * k, q: 3, time: 0.3, level: 0.2 });
  }
  fold() {
    if (!this.ready('fold', 0.15)) return;
    const k = this.vary();
    this.burst({ from: 320 * k, to: 980 * k, q: 3.4, time: 0.34, level: 0.24 });
  }
  release() {
    if (!this.ready('release', 0.1)) return;
    const k = this.vary();
    this.burst({ from: 520 * k, to: 180 * k, q: 2.2, time: 0.15, level: 0.16 });
    this.thump(210 * k, 105 * k, 0.1, 0.06);
  }
  // speed: metres of gel moved this frame, across all contacts
  motion(speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, speed * 260);
    this.bedGain.gain.setTargetAtTime(this.muted ? 0 : s * 0.13, t, 0.05);
    this.bed.frequency.setTargetAtTime(300 + s * 520, t, 0.06);
    if (s > 0.12 && Math.random() < s * 0.16 && this.ready('plip', 0.05)) {
      this.thump(620 + Math.random() * 760, 340, 0.045, 0.022);
    }
  }
}
