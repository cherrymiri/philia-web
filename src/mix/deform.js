// Slime deformation engine. A deformer is a pure function of (x, y, z) driven by springy
// amounts, so the surface, the pigment sheet and the parts all bend the same way.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const SPRING = { k: 190, damping: 13 };   // under-damped: the gel wobbles a little when it returns
const FOLLOW = { k: 420, damping: 30 };   // while held

class Spring {
  constructor(v = 0) { this.v = v; this.vel = 0; this.goal = v; }
  step(dt, s) {
    const a = s.k * (this.goal - this.v) - s.damping * this.vel;
    this.vel += a * dt;
    this.v += this.vel * dt;
  }
}

class Deformer {
  constructor(type, params) {
    Object.assign(this, { type, held: true, ...params });
    this.a = new Spring();   // main amount
    this.b = new Spring();   // second axis for stretch
  }
  settled() {
    return !this.held && Math.abs(this.a.v) + Math.abs(this.b.v) < 1e-4 && Math.abs(this.a.vel) + Math.abs(this.b.vel) < 1e-3;
  }
  step(dt) {
    const s = this.held ? FOLLOW : SPRING;
    this.a.step(dt, s);
    this.b.step(dt, s);
  }
  apply(p, content = false) {
    if (this.type === 'press') press(this, p);
    else if (this.type === 'stretch') stretch(this, p);
    else fold(this, p, content);
  }
}

function press(d, p) {
  const depth = d.a.v;
  const dx = p.x - d.x;
  const dz = p.z - d.z;
  const r = Math.hypot(dx, dz) || 1e-6;
  const R = d.R || 0.017;
  const f = smooth(0.001, 0.016, p.y);        // the underside stays on the table
  const dent = Math.exp(-(r * r) / (R * R));
  const ring = Math.exp(-(((r - 2 * R) / (0.95 * R)) ** 2));
  p.y += (-depth * dent + 0.3 * depth * ring) * f;
  const push = depth * 0.55 * (r / R) * Math.exp(-(r * r) / (1.8 * 1.8 * R * R));
  p.x += (dx / r) * push;
  p.z += (dz / r) * push;
}

function stretch(d, p) {
  const ox = d.a.v;
  const oz = d.b.v;
  const len = Math.hypot(ox, oz);
  const q = Math.hypot(p.x - d.x, p.z - d.z);
  const sigma = 0.03 + len * 0.5;
  const w = Math.exp(-(q * q) / (sigma * sigma));
  p.x += ox * (w + 0.07);
  p.z += oz * (w + 0.07);
  const mid = 0.008;
  p.y = mid + (p.y - mid) * (1 - 0.5 * w * Math.min(1, len / 0.05));
}

// Page-curl around a hinge line. The flap rolls up over the top and lies back on the gel,
// so the surface really overlaps itself and keeps its thickness.
export const FOLD_HINGE = 0.72;   // the hinge travels this share of the drag

function fold(d, p, content) {
  const D = d.a.v;
  if (D < 1e-5) return;
  const s = p.x * d.nx + p.z * d.nz;
  const t = -p.x * d.nz + p.z * d.nx;
  const s0 = d.grab - D * FOLD_HINGE + 0.07 * t * t / 0.05;
  const over = s - s0;
  if (over <= 0) return;
  const bend = 0.011;                         // tightness of the roll
  const axisY = 0.033;                        // hinge runs along the top of the gel
  const taper = 0.72 + 0.28 * Math.exp(-(t * t) / (0.04 * 0.04));
  const thetaMax = Math.min(1, D / 0.03) * 2.98 * taper;
  const th = Math.min(over / bend, thetaMax);
  const rho = (axisY - p.y) * (1 - 0.52 * smooth(0, 1.8, th)); // flap thins as it rolls, but keeps a body
  const rest = Math.max(0, over - th * bend);
  // Deep points of the shell swing out as it rolls. Contents ride a fixed radius instead,
  // so inside the gel everything only ever travels with the drag.
  const ns = (content ? bend : rho) * Math.sin(th) + rest * Math.cos(th);
  const ny = axisY - rho * Math.cos(th) + rest * Math.sin(th);
  p.x += (s0 + ns - s) * d.nx;
  p.z += (s0 + ns - s) * d.nz;
  p.y = ny;
  p.turn = th;       // how far this point has rolled over, parts turn with it
  p.nx = d.nx;
  p.nz = d.nz;
}

export class DeformEngine {
  constructor(geometry) {
    this.geometry = geometry;
    this.position = geometry.attributes.position;
    this.rest = Float32Array.from(this.position.array);      // never modified
    this.plastic = new Float32Array(this.rest.length);       // what stays behind after release
    this.list = [];
    this.p = { x: 0, y: 0, z: 0 };
    this.buildNeighbours(geometry.index.array);
    geometry.boundingSphere = null;
    geometry.computeBoundingSphere();
    geometry.boundingSphere.radius *= 2;
  }
  buildNeighbours(index) {
    const n = this.position.count;
    const sets = Array.from({ length: n }, () => new Set());
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
      sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
    }
    this.neighbours = sets.map((s) => [...s]);
  }
  add(type, params) {
    if (this.list.length >= 18) { const i = this.list.findIndex((d) => !d.held); if (i >= 0) this.list.splice(i, 1); }
    const d = new Deformer(type, params);
    this.list.push(d);
    return d;
  }
  get active() { return this.list.length > 0; }
  // Everything bends through this one function: surface, pigment sheet and parts.
  // content=true skips a fold that was let go: the shell unrolls, what was inside has landed.
  map(p, content = false) {
    for (const d of this.list) if (!(content && d.detached)) d.apply(p, content);
    return p;
  }
  step(dt) {
    const h = Math.min(dt, 1 / 30);
    const n = Math.ceil(h / (1 / 240));
    for (const d of this.list) for (let i = 0; i < n; i++) d.step(h / n);
    this.list = this.list.filter((d) => !d.settled());
    this.write();
  }
  write() {
    const { rest, plastic, p } = this;
    const out = this.position.array;
    for (let i = 0; i < out.length; i += 3) {
      p.x = rest[i] + plastic[i];
      p.y = rest[i + 1] + plastic[i + 1];
      p.z = rest[i + 2] + plastic[i + 2];
      this.map(p);
      out[i] = p.x; out[i + 1] = p.y; out[i + 2] = p.z;
    }
    this.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
  // Keep a little of the shape: a soft, smoothed memory of where the gel was worked.
  remember(d) {
    const { rest, plastic, p } = this;
    const n = this.position.count;
    const add = new Float32Array(n * 3);
    const gain = 0.05;
    for (let v = 0; v < n; v++) {
      const i = v * 3;
      p.x = rest[i]; p.y = rest[i + 1]; p.z = rest[i + 2];
      d.apply(p);
      add[i] = (p.x - rest[i]) * gain; add[i + 1] = (p.y - rest[i + 1]) * gain; add[i + 2] = (p.z - rest[i + 2]) * gain;
    }
    for (let pass = 0; pass < 3; pass++) {
      const src = add.slice();
      for (let v = 0; v < n; v++) {
        const nb = this.neighbours[v];
        for (let c = 0; c < 3; c++) {
          let sum = src[v * 3 + c] * 2;
          for (const m of nb) sum += src[m * 3 + c];
          add[v * 3 + c] = sum / (nb.length + 2);
        }
      }
    }
    const lim = 0.0018;
    for (let i = 0; i < plastic.length; i++) plastic[i] = Math.max(-lim, Math.min(lim, plastic[i] + add[i]));
  }
  reset() {
    this.list = [];
    this.plastic.fill(0);
    this.write();
  }
  serialize() {
    const b = new Int8Array(this.plastic.length);
    for (let i = 0; i < b.length; i++) b[i] = Math.round(this.plastic[i] / 0.00002);
    return encode(b);
  }
  restore(text) {
    const b = decode(text);
    if (b.length !== this.plastic.length) return;
    for (let i = 0; i < b.length; i++) this.plastic[i] = b[i] * 0.00002;
    this.write();
  }
}

function encode(int8) {
  let s = '';
  const u = new Uint8Array(int8.buffer);
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return btoa(s);
}
function decode(text) {
  const s = atob(text);
  const u = new Int8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) << 24 >> 24;
  return u;
}
