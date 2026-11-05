import * as THREE from 'three';

// Part engine. `base` is the lasting position; what you see is base run through the current
// deformation, with a little lag so parts feel carried by the gel. Scale and shape never change.
const up = new THREE.Vector3(0, 1, 0);
const a1 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();
const flat = new THREE.Vector3();

const BEHAVIOUR = {
  STAR: { move: 1, spin: 5 },
  HEART: { move: 1, spin: 3 },
  RIBBON: { move: 0.9, spin: 3 },
  PEARL: { move: 1.5, spin: 0, roll: true },
  SEQUIN: { move: 1.1, spin: 14 },
  AURORA: { move: 1, spin: 2, align: true },
  GLITTER: { move: 2.2, spin: 20, scatter: 1 },
};

export class PartEngine {
  constructor(layers, volume, cfg) {
    Object.assign(this, { layers, volume, cfg, list: [], slots: new Map(), awake: 0, settle: 0 });
  }
  add(type, slot, position, quaternion, rec, sub) {
    const key = `${type}:${slot}`;
    const old = this.slots.get(key);
    if (old) this.list.splice(this.list.indexOf(old), 1);   // display slot reused past the cap
    const p = {
      type, slot, rec, sub, cfg: this.cfg[type], b: BEHAVIOUR[type],
      base: position.clone(), vis: position.clone(), q: quaternion.clone(), trail: 0,
    };
    this.list.push(p);
    this.slots.set(key, p);
    return p;
  }
  near(pos, radius) {
    const r2 = radius * radius;
    return this.list.filter((p) => p.base.distanceToSquared(pos) < r2);
  }
  clamp(p) {
    const r = p.cfg.radius;
    const v = this.volume;
    for (let i = 0; i < 24 && !v.fits(p.base.x, p.base.z, r); i++) { p.base.x *= 0.96; p.base.z *= 0.96; }
    const s = v.at(p.base.x, p.base.z);
    if (!s) { p.base.x *= 0.5; p.base.z *= 0.5; return; }
    p.base.y = Math.min(s.top - r - 0.0012, Math.max(s.bottom + r + 0.0012, p.base.y));
  }
  // Move parts by a gesture field. move(p) returns dx, dz, dy for this frame.
  push(field) {
    const moved = [];
    for (const p of this.list) {
      const m = field(p);
      if (!m) continue;
      const k = p.b.move;
      const n = p.b.scatter ? (Math.random() - 0.5) * m.size * 1.4 : 0;
      const dx = m.x * k + n;
      const dz = m.z * k + (p.b.scatter ? (Math.random() - 0.5) * m.size * 1.4 : 0);
      p.base.x += dx;
      p.base.z += dz;
      p.base.y += (m.y || 0);
      this.turn(p, dx, dz, m.dirX, m.dirZ);
      this.clamp(p);
      if (Math.abs(dx) + Math.abs(dz) > 1e-5) moved.push(p);
    }
    this.awake = 0.6;
    return moved;
  }
  turn(p, dx, dz, dirX, dirZ) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    if (p.b.roll) {
      a1.set(dz, 0, -dx).normalize();
      p.q.premultiply(q1.setFromAxisAngle(a1, len / (p.cfg.radius || 0.002)));
    } else if (p.b.spin) {
      a1.set(Math.sin(p.slot * 1.7), 0.7, Math.cos(p.slot * 2.3)).normalize();
      p.q.premultiply(q1.setFromAxisAngle(a1, len * p.b.spin * 40));
    }
    if (p.b.align && dirX !== undefined) {
      flat.set(dirX, 0, dirZ).normalize();
      const yaw = Math.atan2(-flat.z, flat.x);
      q2.setFromAxisAngle(up, yaw).multiply(q1.setFromAxisAngle(a1.set(1, 0, 0), 0.6));
      p.q.slerp(q2, Math.min(1, len * 90));
    }
  }
  separate() {
    const cell = 0.009;
    const grid = new Map();
    const key = (x, y, z) => (Math.floor(x / cell) + 64) * 16129 + (Math.floor(y / cell) + 8) * 127 + Math.floor(z / cell) + 64;
    const solid = this.list.filter((p) => p.type !== 'GLITTER');
    for (const p of solid) {
      const k = key(p.base.x, p.base.y, p.base.z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
    }
    for (const p of solid) {
      const cx = Math.floor(p.base.x / cell); const cy = Math.floor(p.base.y / cell); const cz = Math.floor(p.base.z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const list = grid.get((cx + i + 64) * 16129 + (cy + j + 8) * 127 + cz + k + 64);
        if (!list) continue;
        for (const o of list) {
          if (o === p) continue;
          const min = (p.cfg.radius + o.cfg.radius) * 0.9;
          a1.subVectors(p.base, o.base);
          const d = a1.length();
          if (d >= min || d < 1e-6) continue;
          a1.multiplyScalar(((min - d) * 0.25) / d);
          p.base.add(a1); o.base.sub(a1);
        }
      }
    }
    for (const p of solid) this.clamp(p);
  }
  // Fold let go: parts stay exactly where the fold carried them. Same map as the surface,
  // so nothing can move the other way. The gel then settles around them.
  landFold(deform, fold) {
    const t = { x: 0, y: 0, z: 0, turn: 0, nx: 0, nz: 0 };
    for (const p of this.list) {
      t.x = p.base.x; t.y = p.base.y; t.z = p.base.z; t.turn = 0;
      fold.apply(t, true);
      if (!t.turn) continue;
      // Rolled over: what was near the bottom of the flap now lies near the top, spread through
      // the full depth instead of piling up under the surface.
      const below = this.volume.at(t.x, t.z);
      let y = t.y;
      if (below) {
        const from = this.volume.at(p.base.x, p.base.z);
        const rel = from ? (p.base.y - from.bottom) / Math.max(from.top - from.bottom, 1e-4) : 0.5;
        y = below.bottom + (1 - rel) * (below.top - below.bottom);
      }
      p.base.set(t.x, y, t.z);
      a1.set(t.nz, 0, -t.nx);
      if (p.type !== 'PEARL') p.q.premultiply(q1.setFromAxisAngle(a1, t.turn));
      this.clamp(p);
    }
    this.settle = 40;
    this.awake = 1.2;
  }
  // Visible positions follow the deformation.
  step(dt, deform) {
    if (!deform.active && this.awake <= 0) return false;
    this.awake = Math.max(0, this.awake - dt);
    if (this.settle > 0) { this.settle--; this.separate(); }
    const k = 1 - Math.exp(-dt * 20);
    const t = { x: 0, y: 0, z: 0, turn: 0, nx: 0, nz: 0 };
    for (const p of this.list) {
      t.x = p.base.x; t.y = p.base.y; t.z = p.base.z; t.turn = 0;
      deform.map(t, true);
      p.vis.x += (t.x - p.vis.x) * k;
      p.vis.y += (t.y - p.vis.y) * k;
      p.vis.z += (t.z - p.vis.z) * k;
      let q = p.q;
      if (t.turn && p.type !== 'PEARL') {
        a1.set(t.nz, 0, -t.nx);
        q = q2.setFromAxisAngle(a1, t.turn).multiply(p.q);
      }
      this.layers[p.type].set(p.slot, p.vis, q, p.cfg.scale);
    }
    return true;
  }
  // Working the gel evens things out: parts drift out of crowded spots and through the depth,
  // a little at a time, so kneading really distributes them.
  stir(amount) {
    if (amount <= 0 || !this.list.length) return;
    const cell = 0.012;
    const grid = new Map();
    const key = (i, j) => (i + 32) * 97 + j + 32;
    for (const p of this.list) {
      if (p.type === 'GLITTER') continue;
      const k = key(Math.floor(p.base.x / cell), Math.floor(p.base.z / cell));
      grid.set(k, (grid.get(k) || 0) + 1);
    }
    const at = (i, j) => grid.get(key(i, j)) || 0;
    for (const p of this.list) {
      const i = Math.floor(p.base.x / cell); const j = Math.floor(p.base.z / cell);
      const gx = at(i + 1, j) - at(i - 1, j);
      const gz = at(i, j + 1) - at(i, j - 1);
      const crowd = at(i, j);
      const rx = Math.random() - 0.5; const rz = Math.random() - 0.5;
      const scale = p.type === 'GLITTER' ? 1.8 : 1;
      p.base.x += (-gx * 0.00028 + rx * (0.00022 + crowd * 0.00016)) * amount * scale;
      p.base.z += (-gz * 0.00028 + rz * (0.00022 + crowd * 0.00016)) * amount * scale;
      p.base.y += (Math.random() - 0.5) * 0.0005 * amount * scale;
      this.clamp(p);
    }
    this.awake = Math.max(this.awake, 0.5);
  }
  // Write lasting positions back to the record.
  commit() {
    for (const p of this.list) {
      if (!p.rec) continue;
      if (p.type === 'GLITTER') {
        if (p.rec.particles) p.rec.particles[p.sub] = p.base.toArray().map((v) => +v.toFixed(4));
      } else {
        p.rec.position = p.base.toArray();
        p.rec.rotation = p.q.toArray();
      }
    }
  }
  clear() {
    this.list.length = 0;
    this.slots.clear();
  }
}
