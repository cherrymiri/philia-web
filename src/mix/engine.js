import * as THREE from 'three';
import { FOLD_HINGE } from './deform.js';

// Mixing engine. Input code only ever calls press / drag / stretch / fold / release, with
// positions on the gel in slime-local metres. A hand tracker can call the same methods.
const DRAG_START = 0.007;

export class MixEngine {
  constructor({ deform, pigment, parts, volume, sound, onCommit }) {
    Object.assign(this, { deform, pigment, parts, volume, sound, onCommit, frameMove: 0 });
    this.contacts = new Map();   // one entry per finger, pointer or hand
    this.quiet = 0;
    this.heartClock = 0;
    this.work = 0;               // how much the gel has been worked, drives the overall tint
    this.hazeClock = 0;
  }

  /* ---------- common commands ---------- */
  press(pt, id = 'pointer') {
    if (this.contacts.has(id)) return true;
    const r = Math.hypot(pt.x, pt.z) || 1e-6;
    const rim = this.volume.rim(pt.x, pt.z);
    if (r > rim * 1.14) return false;
    const inner = pt.x * Math.min(1, (rim * 0.94) / r);
    const innerZ = pt.z * Math.min(1, (rim * 0.94) / r);
    const edge = r > rim * 0.64;
    const d = this.deform.add('press', { x: inner, z: innerZ });
    d.a.goal = 0.008;
    this.sound?.press();
    this.contacts.set(id, { kind: 'press', edge, start: { x: pt.x, z: pt.z }, last: { x: pt.x, z: pt.z }, now: { x: pt.x, z: pt.z }, d, held: 0 });
    return true;
  }
  // Light contact from part of a hand: a fingertip or the palm. It dents and carries what is
  // under it, but never turns into a stretch or a fold.
  touch(pt, id, { depth, radius }) {
    const g = this.contacts.get(id);
    if (g) {
      g.now = { x: pt.x, z: pt.z };
      g.depth = depth;
      return true;
    }
    if (!this.volume.fits(pt.x, pt.z, 0.0005)) return false;
    const d = this.deform.add('press', { x: pt.x, z: pt.z, R: radius });
    this.contacts.set(id, { kind: 'touch', light: true, depth, radius, start: { ...pt }, last: { x: pt.x, z: pt.z }, now: { x: pt.x, z: pt.z }, d, held: 0 });
    return true;
  }
  drag(pt, id = 'pointer') {
    const g = this.contacts.get(id);
    if (!g) return;
    g.now = { x: pt.x, z: pt.z };
    const tx = pt.x - g.start.x;
    const tz = pt.z - g.start.z;
    const len = Math.hypot(tx, tz);
    if (g.kind === 'press' && g.edge && len > DRAG_START) {
      const r = Math.hypot(g.start.x, g.start.z) || 1;
      const out = (tx * g.start.x + tz * g.start.z) / r;
      if (out >= 0) this.stretch(id); else this.fold(id);
    } else if (g.kind === 'press') {
      g.d.x = pt.x; g.d.z = pt.z;
    }
  }
  stretch(id = 'pointer') {
    const g = this.contacts.get(id);
    g.d.held = false; g.d.a.goal = 0;
    const d = this.deform.add('stretch', { x: g.start.x, z: g.start.z });
    this.sound?.stretch();
    Object.assign(g, { kind: 'stretch', d, seed: Math.random() * 40 });
  }
  fold(id = 'pointer') {
    const g = this.contacts.get(id);
    g.d.held = false; g.d.a.goal = 0;
    // The flap is whatever lies opposite the drag, so all directions work the same.
    const tx = g.now.x - g.start.x;
    const tz = g.now.z - g.start.z;
    const len = Math.hypot(tx, tz) || 1;
    const n = { x: -tx / len, z: -tz / len };
    const grab = g.start.x * n.x + g.start.z * n.z;
    const d = this.deform.add('fold', { nx: n.x, nz: n.z, grab });
    Object.assign(g, { kind: 'fold', d, n, grab, seed: Math.random() * 40 });
  }
  release(id = 'pointer') {
    const g = this.contacts.get(id);
    if (!g) return;
    this.contacts.delete(id);
    const folded = g.kind === 'fold' && g.d.a.v > 0.008;
    if (folded) {
      // Bake where this fold put things, then let only the shell unroll.
      this.sound?.fold();
      this.parts.landFold(this.deform, g.d);
      this.settle = 70;   // the fold's pile-up relaxes over the next second, never in one jump
      this.pigment.bakeSheet(g.d);
      g.d.detached = true;
      this.pigment.bend(this.deform);
      const s0 = g.d.grab - g.d.a.v * FOLD_HINGE;
      this.comb = { x: g.n.x * s0, z: g.n.z * s0, tx: -g.n.z, tz: g.n.x, left: 12, seed: g.seed };
      this.work += 0.5;
    }
    if (g.kind !== 'fold' && !g.light) this.deform.remember(g.d);
    g.d.held = false;
    g.d.a.goal = 0;
    g.d.b.goal = 0;
    if (!g.light) this.sound?.release();
    this.quiet = 1;
    this.parts.awake = Math.max(this.parts.awake, 1);
  }

  /* ---------- per frame ---------- */
  step(dt) {
    this.frameMove = 0;
    this.stirMove = 0;
    for (const g of this.contacts.values()) this.applyGesture(g, dt);
    if (this.stirMove > 0) this.parts.stir(Math.min(1, this.stirMove * 200));
    this.sound?.motion(this.frameMove);
    if (this.settle > 0) { this.settle -= 1; this.parts.stir(0.25); }
    if (this.comb) this.runComb();
    const live = this.deform.active;
    if (live) { this.deform.step(dt); this.pigment.bend(this.deform); }
    this.parts.step(dt, this.deform);
    if (this.contacts.size && ++this.hazeClock % 6 === 0) this.pigment.setWork(this.work);
    if (!live && !this.contacts.size && !this.comb && this.quiet > 0) {
      this.quiet = 0;
      this.deform.write();
      this.pigment.bend(this.deform);
      this.pigment.conserve();
      this.pigment.setWork(this.work);
      this.parts.commit();
      this.onCommit();
    }
  }
  // Layers that just met drag through each other along the fold line, like a comb through marbling.
  runComb() {
    const c = this.comb;
    this.pigment.advect({
      smear: { x: c.x, z: c.z, dx: c.tx * 0.0001, dz: c.tz * 0.0001, size: 0.05, comb: 3.2 },
      curl: { x: c.x, z: c.z, amount: 0.00028 },
      seed: c.seed,
    });
    if (--c.left <= 0) this.comb = null;
  }
  applyGesture(g, dt) {
    const dx = g.now.x - g.last.x;
    const dz = g.now.z - g.last.z;
    const move = Math.hypot(dx, dz);
    this.frameMove += move;
    if (g.kind !== 'fold') this.stirMove += move;   // a fold carries parts along, it doesn't scatter them
    g.last = { ...g.now };
    g.held += dt;
    this.work += move * 9;
    if (g.kind === 'touch') this.applyTouch(g, dt, dx, dz, move);
    else if (g.kind === 'press') this.applyPress(g, dt, dx, dz, move);
    else if (g.kind === 'stretch') this.applyStretch(g, dx, dz, move);
    else this.applyFold(g);
  }
  applyTouch(g, dt, dx, dz, move) {
    const d = g.d;
    if (!this.volume.fits(g.now.x, g.now.z, 0.0005)) { d.a.goal = 0; return; }
    d.x += dx; d.z += dz;
    d.a.goal = g.depth;
    this.work += dt * 0.02 * (g.depth / 0.004);
    if (move < 0.00015 && g.depth < 0.008) return;
    const reach = g.radius * 1.5;
    const c = { x: d.x, z: d.z };
    const pushing = (g.depth / 0.0125) * dt * 0.006;
    this.parts.push((p) => {
      const ox = p.base.x - c.x; const oz = p.base.z - c.z;
      const r = Math.hypot(ox, oz) || 1e-5;
      const w = Math.exp(-(r * r) / (reach * reach));
      if (w < 0.04) return null;
      return { x: (ox / r) * pushing * w + dx * w * 0.3, z: (oz / r) * pushing * w + dz * w * 0.3, size: move * 0.2 * w, dirX: ox, dirZ: oz };
    });
    this.pigment.advect({
      press: g.depth >= 0.008 ? { x: c.x, z: c.z, amount: 0.00012, petals: 5 } : null,
      smear: move > 0 ? { x: c.x, z: c.z, dx: dx * 0.7, dz: dz * 0.7, size: g.radius, comb: 1 } : null,
      diffuse: 0.002,
    });
  }
  applyPress(g, dt, dx, dz, move) {
    const d = g.d;
    d.a.goal = Math.min(0.0145, 0.008 + g.held * 0.009);
    this.work += dt * 0.12;
    const c = { x: d.x, z: d.z };
    const pushing = Math.min(1, 0.25 + g.held) * (1 + move * 300);
    this.parts.push((p) => {
      const ox = p.base.x - c.x; const oz = p.base.z - c.z;
      const r = Math.hypot(ox, oz) || 1e-5;
      const w = Math.exp(-(r * r) / (0.024 * 0.024));
      if (w < 0.02) return null;
      const f = 0.007 * w * dt * pushing;
      return { x: (ox / r) * f + dx * w * 0.35, z: (oz / r) * f + dz * w * 0.35, size: f + move * 0.2 * w, dirX: ox, dirZ: oz };
    });
    this.parts.separate();
    this.pigment.advect({
      press: { x: c.x, z: c.z, amount: 0.00017 * Math.min(1, 0.3 + g.held) * (g.held < 2.5 ? 1 : 0.15), petals: 7 },
      smear: move > 0 ? { x: c.x, z: c.z, dx: dx * 0.8, dz: dz * 0.8, size: 0.016, comb: 1.2 } : null,
      curl: move > 0 ? { x: c.x, z: c.z, amount: move * 0.05 } : null,
      swirls: this.ribbonSwirls(c, move),
      diffuse: 0.004,
    });
    this.hearts(c);
  }
  applyStretch(g, dx, dz, move) {
    const d = g.d;
    const tx = g.now.x - g.start.x;
    const tz = g.now.z - g.start.z;
    const len = Math.hypot(tx, tz);
    const k = Math.min(1, 0.056 / (len || 1));
    d.a.goal = tx * k; d.b.goal = tz * k;
    const sx = g.start.x; const sz = g.start.z;
    const reach = 0.034 + len * 0.6;
    const rlen = move || 1;
    this.parts.push((p) => {
      const ox = p.base.x - sx; const oz = p.base.z - sz;
      const w = Math.exp(-(ox * ox + oz * oz) / (reach * reach));
      if (w < 0.02 || move === 0) return null;
      return { x: dx * w * 0.42, z: dz * w * 0.42, size: move * w * 0.3, dirX: dx / rlen, dirZ: dz / rlen };
    });
    this.parts.separate();
    if (move > 0) {
      this.pigment.advect({
        smear: { x: sx * 0.72, z: sz * 0.72, dx: dx * 0.42, dz: dz * 0.42, size: reach, comb: 1.6 },
        curl: { x: sx * 0.6, z: sz * 0.6, amount: move * 0.03 },
        seed: g.seed,
        swirls: this.ribbonSwirls({ x: sx, z: sz }, move),
        diffuse: 0.002,
      });
      this.hearts({ x: sx, z: sz });
    }
  }
  // While folding nothing is advected: surface, sheet and parts are all bent by the same map.
  applyFold(g) {
    const tx = g.now.x - g.start.x;
    const tz = g.now.z - g.start.z;
    g.d.a.goal = Math.max(0, Math.min(0.074, -(tx * g.n.x + tz * g.n.z)));
    this.parts.awake = 1;
  }
  ribbonSwirls(c, move) {
    if (move <= 0) return [];
    return this.parts.near(new THREE.Vector3(c.x, 0.012, c.z), 0.04)
      .filter((p) => p.type === 'RIBBON').slice(0, 6)
      .map((p, i) => ({ x: p.base.x, z: p.base.z, spin: (i % 2 ? -1 : 1) * Math.min(0.7, move * 50) }));
  }
  // Hearts that are being moved leave a faint pink wake.
  hearts(c) {
    this.heartClock++;
    if (this.heartClock % 6) return;
    const near = this.parts.near(new THREE.Vector3(c.x, 0.012, c.z), 0.03).filter((p) => p.type === 'HEART').slice(0, 2);
    for (const p of near) this.pigment.splat(p.base.x, p.base.z, 'PEACH', 0.05, 0.0042);
  }
  get busy() { return this.contacts.size > 0 || this.deform.active || !!this.comb; }
  reset() {
    this.contacts.clear(); this.comb = null; this.quiet = 0; this.work = 0;
    this.deform.reset();
    this.pigment.clear();
    this.pigment.mass = [0, 0, 0];
    this.pigment.bend(this.deform);
    this.parts.clear();
  }
}
