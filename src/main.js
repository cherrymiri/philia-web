import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';
import { INGREDIENTS, PART, PIGMENT, BLOB, POUR, CAMERA, MAX_VISIBLE } from './config.js';
import { DeformEngine } from './mix/deform.js';
import { PigmentEngine } from './mix/pigment.js';
import { PartEngine } from './mix/parts.js';
import { MixEngine } from './mix/engine.js';
import { attachPointer } from './input.js';
import { HandInput } from './hand.js';
import { makeName } from './naming.js';
import { renderStill, composeCard, saveCanvas } from './save.js';
import * as store from './state.js';
import { animate, wait, ease, stepTweens } from './tween.js';
import { applyGel, buildVolume } from './gel.js';
import { PartLayer, Ripples } from './layers.js';

const app = document.getElementById('app');
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(0.05, 0.4, 0.2);
scene.add(key);
const camera = new THREE.PerspectiveCamera(13, 1, 0.02, 8);

const items = new Map();       // id -> { def, node, home, proxy, label, busy }
const layers = {};             // part type -> PartLayer
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rand = (a, b) => a + Math.random() * (b - a);
let slime, volume, inside, ripples, portrait = false;
let deform, pigment, partEngine, mix;
let mode = 'add';              // add | mix | ending | moving
let stage, hand;
let swayTime = 0;
const pending = new Set();     // falling parts/drops still animating

/* ---------- layout ---------- */
function wideSlots() {
  return [
    [-0.205, 0.045], [-0.163, -0.012], [-0.128, -0.078],                  // serums
    [-0.076, -0.104], [-0.026, -0.11], [0.026, -0.11], [0.076, -0.104],    // back row
    [0.128, -0.078], [0.166, -0.012], [0.205, 0.045],                     // right side
  ];
}
function portraitSlots() {
  const xs = [-0.098, -0.049, 0, 0.049, 0.098];
  return [...xs.map((x) => [x, 0.118]), ...xs.map((x) => [x, 0.222])]; // serums first, so they sit nearest the gel
}
function cameraPose(m) {
  const c = portrait ? CAMERA.portrait : CAMERA.wide;
  const v = m === 'mix' ? (portrait ? CAMERA.mixPortrait : CAMERA.mix) : m === 'ending' ? (portrait ? CAMERA.endingPortrait : CAMERA.ending) : c;
  const tanV = Math.tan(THREE.MathUtils.degToRad(13 / 2));
  const dist = Math.max(v.halfH / tanV, v.halfW / (tanV * camera.aspect));
  const e = THREE.MathUtils.degToRad(v.elevation);
  const t = v3(...v.target);
  return { target: t, position: v3(t.x, t.y + Math.sin(e) * dist, t.z + Math.cos(e) * dist) };
}
const lookTarget = v3();
function setCamera(pos, target) {
  camera.position.copy(pos);
  lookTarget.copy(target);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
function placeCamera() {
  const p = cameraPose('add');
  setCamera(p.position, p.target);
}
function applyLayout() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, w < 700 ? 1.5 : 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  portrait = w / h < 0.9;
  app.classList.toggle('portrait', portrait);
  placeCamera();             // labels are always measured from the add view
  const slots = portrait ? portraitSlots() : wideSlots();
  const pxPerM = h / (2 * camera.position.distanceTo(v3(...(portrait ? CAMERA.portrait : CAMERA.wide).target)) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const labelW = portrait ? Math.floor((w - 16) / 5) - 2 : Math.min(150, Math.max(104, pxPerM * 0.048));
  app.style.setProperty('--w', `${labelW}px`);
  app.style.setProperty('--name', portrait ? '11.5px' : '15px');
  app.style.setProperty('--mean', portrait ? '10.5px' : '12.5px');
  INGREDIENTS.forEach((def, i) => {
    const it = items.get(def.id);
    if (!it) return;
    it.home.set(slots[i][0], 0, slots[i][1]);
    if (!it.busy) it.node.position.copy(it.home);
    it.proxy.position.set(it.home.x, it.height / 2, it.home.z);
    const p = v3(it.home.x, 0, it.home.z + it.radius).project(camera);
    const x = (p.x * 0.5 + 0.5) * w;
    const y = (-p.y * 0.5 + 0.5) * h;
    const lx = THREE.MathUtils.clamp(x - labelW / 2, 4, w - labelW - 4);
    it.label.style.transform = `translate(${lx}px, ${y + 3}px)`;
  });
  if (mode === 'mix' || mode === 'ending') {
    const p = cameraPose(mode);
    setCamera(p.position, p.target);
  }
}

/* ---------- placement inside the gel ---------- */
const landing = [];  // spots claimed by pieces still in the air
function findSpot(type, cx, cz, spread) {
  const cfg = PART[type];
  const r = cfg.radius * (type === 'GLITTER' ? 1 : 1);
  for (const slack of [1, 0.8, 0.6, 0.4, 0.2]) {
    for (let t = 0; t < 40; t++) {
      const a = rand(0, Math.PI * 2);
      const q = spread * Math.sqrt(Math.random());
      let x = cx + q * Math.cos(a);
      let z = cz + q * Math.sin(a);
      if (t > 20) { const b = rand(0, Math.PI * 2); const c = 0.044 * Math.sqrt(Math.random()); x = c * Math.cos(b); z = c * Math.sin(b); }
      if (!volume.fits(x, z, r)) continue;
      const s = volume.at(x, z);
      const lo = s.bottom + r + 0.0012;
      const hi = s.top - r - 0.0012;
      if (hi <= lo) continue;
      const y = lo + (hi - lo) * Math.random() ** 1.3 * 0.9;
      const p = v3(x, y, z);
      const clearOf = (o) => o.type === 'GLITTER' || o.base.distanceTo(p) > (o.cfg.radius + r) * slack;
      if (partEngine.list.every(clearOf) && (type === 'GLITTER' || landing.every((o) => o.distanceTo(p) > 2 * r * slack))) return p;
    }
  }
  return null;
}
function restRotation(type) {
  const cfg = PART[type];
  const spin = rand(-0.5, 0.5);
  const tilt = THREE.MathUtils.degToRad(cfg.restTilt + rand(-9, 9));
  const q = new THREE.Quaternion();
  if (type === 'PEARL') return q;
  if (type === 'GLITTER') return q.setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)));
  q.setFromEuler(new THREE.Euler(tilt, 0, 0));
  q.multiply(new THREE.Quaternion().setFromAxisAngle(cfg.upright ? v3(0, 0, 1) : v3(0, 1, 0), cfg.upright ? spin : rand(-3.1, 3.1)));
  return q;
}
function restorePart(rec) {
  const layer = layers[rec.type];
  const scale = PART[rec.type].scale;
  if (rec.type === 'GLITTER') {
    const seedRand = mulberry(rec.seed);
    (rec.particles || []).forEach((pos, sub) => {
      const p = v3(...pos);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(seedRand() * 6, seedRand() * 6, seedRand() * 6));
      const i = layer.take();
      layer.set(i, p, q, scale);
      partEngine.add(rec.type, i, p, q, rec, sub);
    });
    return;
  }
  const p = v3(...rec.position);
  const q = new THREE.Quaternion(...rec.rotation);
  const i = layer.take();
  layer.set(i, p, q, scale);
  partEngine.add(rec.type, i, p, q, rec);
}
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- a falling piece ---------- */
function dropPiece(type, from, target, finalQ, startScale, finalScale, opts = {}) {
  const rec = opts.rec;
  const layer = layers[type];
  const i = layer.take();
  const s = volume.at(target.x, target.z);
  const hit = v3(target.x + rand(-0.001, 0.001), s.top, target.z + rand(-0.001, 0.001));
  const h = Math.max(from.y - hit.y, 0.005);
  const T = Math.sqrt((2 * h) / POUR.gravity);
  const axis = v3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
  const spin = rand(5, 11);
  const p = v3();
  const q = new THREE.Quaternion();
  const startQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)));
  const landed = new THREE.Quaternion();
  const job = (async () => {
    await animate(T, (_, u) => {
      p.lerpVectors(from, hit, u);
      p.y = from.y - h * u * u;
      q.setFromAxisAngle(axis, spin * T * u).premultiply(startQ);
      layer.set(i, p, q, THREE.MathUtils.lerp(startScale, finalScale * 0.82, u));
    }, ease.linear);
    landed.copy(q);
    if (!opts.quiet) ripples.fire(hit, 0.0055);
    await animate(POUR.sink, (e) => {
      p.lerpVectors(hit, target, e);
      q.slerpQuaternions(landed, finalQ, e);
      layer.set(i, p, q, THREE.MathUtils.lerp(finalScale * 0.82, finalScale, e));
    }, ease.out);
    partEngine.add(type, i, target, finalQ, rec || opts.getRec?.(), opts.sub);
  })();
  pending.add(job);
  job.finally(() => pending.delete(job));
  return job;
}

/* ---------- cups ---------- */
const CUP_R = 0.0175;
const CUP_H = 0.03;
async function pour(it) {
  const { def, node } = it;
  const type = def.id;
  const cfg = PART[type];
  it.busy = true;
  it.label.classList.add('is-active');
  store.logAction(type);
  setMovingGlass(node, true);

  const a = rand(0, 6.283);
  const c = 0.03 * Math.sqrt(Math.random());
  const cx = c * Math.cos(a);
  const cz = c * Math.sin(a) * 0.9;
  const th = POUR.tilt;
  const up = CUP_H * Math.cos(th) - CUP_R * Math.sin(th);
  const fwd = CUP_H * Math.sin(th) + CUP_R * Math.cos(th);
  const hover = v3(cx - fwd, POUR.rimHeight - up, cz);
  const from = node.position.clone();
  const lifted = from.clone().setY(0.05);
  const mid = lifted.clone().lerp(hover, 0.5).setY(0.082);

  await animate(0.42, (e) => node.position.lerpVectors(from, lifted, e));
  const q0 = lifted.clone();
  await animate(0.72, (e) => {
    const u = 1 - e;
    node.position.set(0, 0, 0)
      .addScaledVector(q0, u * u).addScaledVector(mid, 2 * u * e).addScaledVector(hover, e * e);
  });
  await animate(0.42, (e) => { node.rotation.z = -th * e; });

  const jobs = [];
  const rimWorld = v3();
  const glitter = type === 'GLITTER';
  const seed = Math.floor(Math.random() * 1e9);
  let pinch = null;
  for (let n = 0; n < cfg.perPour; n++) {
    await wait(glitter ? rand(0.012, 0.03) : rand(0.08, 0.13)); // pieces slide out on their own
    // rim lowest point, cup is tilted to the right
    node.updateMatrixWorld();
    rimWorld.set(CUP_R, CUP_H, rand(-0.008, 0.008)).applyMatrix4(node.matrixWorld);
    const spot = findSpot(type, cx, cz, glitter ? cfg.spread : 0.017);
    if (!spot) continue;
    const q = restRotation(type);
    landing.push(spot);
    if (glitter) {
      if (!pinch) {
        pinch = { type, position: spot.toArray(), rotation: [0, 0, 0, 1], scale: cfg.scale, count: 0, seed, particles: [], action: store.snapshot().sequence.length };
        store.addPart(pinch);
      }
      pinch.particles.push(spot.toArray().map((v) => +v.toFixed(4)));
      pinch.count = pinch.particles.length;
      jobs.push(dropPiece(type, rimWorld.clone(), spot, q, cfg.scale * 0.6, cfg.scale, { quiet: n % 8, rec: pinch, sub: pinch.count - 1 }));
    } else {
      const rec = { type, position: spot.toArray(), rotation: q.toArray(), scale: cfg.scale, action: store.snapshot().sequence.length };
      store.addPart(rec);
      jobs.push(dropPiece(type, rimWorld.clone(), spot, q, 1, cfg.scale, { rec }));
    }
  }
  store.touch();

  await wait(0.22);
  await animate(0.4, (e) => { node.rotation.z = -th * (1 - e); });
  const q1 = node.position.clone();
  const backTop = it.home.clone().setY(0.05);
  const backMid = q1.clone().lerp(backTop, 0.5).setY(0.082);
  await animate(0.72, (e) => {
    const u = 1 - e;
    node.position.set(0, 0, 0)
      .addScaledVector(q1, u * u).addScaledVector(backMid, 2 * u * e).addScaledVector(backTop, e * e);
  });
  const land = node.position.clone();
  await animate(0.4, (e) => node.position.lerpVectors(land, it.home, e));
  node.position.copy(it.home);
  node.rotation.set(0, 0, 0);
  setMovingGlass(node, false);
  it.busy = false;
  it.label.classList.remove('is-active');
  await Promise.all(jobs);
  landing.length = 0;
}

// three's transmission can't see other transmissive objects, so glass that passes over the
// gel switches to plain alpha glass while it moves. Otherwise the gel vanishes behind it.
const alphaGlass = new Map();
function setMovingGlass(root, on) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material || !/^MAT_GLASS/.test(o.material.name)) return;
    if (on) {
      o.userData.baseMaterial = o.material;
      if (!alphaGlass.has(o.material)) {
        const m = o.material.clone();
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.2;
        m.depthWrite = false;
        alphaGlass.set(o.material, m);
      }
      o.material = alphaGlass.get(o.material);
    } else if (o.userData.baseMaterial) {
      o.material = o.userData.baseMaterial;
    }
  });
}

/* ---------- serum dropper ---------- */
const dropMode = { it: null, aim: null, done: null, chain: Promise.resolve(), goal: v3() };
const dropbar = document.getElementById('dropbar');
const DROPPER_Y = 0.104;

async function useDropper(it) {
  const { def } = it;
  const d = it.dropper;
  it.busy = true;
  it.label.classList.add('is-active');
  store.logAction(def.id);
  scene.attach(d);
  setMovingGlass(d, true);
  const from = d.position.clone();
  const lifted = from.clone().add(v3(0, 0.062, 0));
  await animate(0.6, (e) => d.position.lerpVectors(from, lifted, e));
  const start = v3(0, DROPPER_Y, 0.004);
  const q0 = lifted.clone();
  const mid = q0.clone().lerp(start, 0.5).setY(Math.max(q0.y, DROPPER_Y) + 0.018);
  await animate(0.75, (e) => {
    const u = 1 - e;
    d.position.set(0, 0, 0).addScaledVector(q0, u * u).addScaledVector(mid, 2 * u * e).addScaledVector(start, e * e);
  });
  dropMode.it = it;
  dropMode.goal.copy(start);
  dropMode.chain = Promise.resolve();
  dropbar.hidden = false;
  await new Promise((resolve) => { dropMode.done = resolve; });
  dropbar.hidden = true;
  dropMode.it = null;
  await dropMode.chain;
  const back = d.position.clone();
  const parent = it.node;
  const homeWorld = it.home.clone().add(it.dropperLocal);
  const top = homeWorld.clone().setY(homeWorld.y + 0.062);
  const mid2 = back.clone().lerp(top, 0.5).setY(Math.max(back.y, top.y) + 0.018);
  await animate(0.75, (e) => {
    const u = 1 - e;
    d.position.set(0, 0, 0).addScaledVector(back, u * u).addScaledVector(mid2, 2 * u * e).addScaledVector(top, e * e);
  });
  await animate(0.6, (e) => d.position.lerpVectors(top, homeWorld, e));
  parent.attach(d);
  d.position.copy(it.dropperLocal);
  d.quaternion.identity();
  setMovingGlass(d, false);
  it.busy = false;
  it.label.classList.remove('is-active');
}
function finishDropper() { if (dropMode.done) { const f = dropMode.done; dropMode.done = null; f(); } }

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const aimPlane = new THREE.Plane(v3(0, 1, 0), -0.02);
function pointerOnGel(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.ray.intersectPlane(aimPlane, v3());
  return hit && volume.fits(hit.x, hit.z, BLOB.radius * BLOB.flat) ? hit : null;
}
function pickProxy(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([...items.values()].map((i) => i.proxy), false);
  return hits.length ? items.get(hits[0].object.userData.id) : null;
}
function squeezeAndDrop(it, spot) {
  const type = it.def.id;
  const d = it.dropper;
  const bulb = d.getObjectByName(`DROPPER_${type}_BULB`);
  const tip = d.getObjectByName(`TIP_${type}`);
  // tip sits straight below the dropper origin
  const tipOffset = tip.position.y;
  dropMode.chain = dropMode.chain.then(async () => {
    dropMode.goal.set(spot.x, DROPPER_Y, spot.z);
    const from = d.position.clone();
    await animate(0.16, (e) => d.position.lerpVectors(from, dropMode.goal, e));
    await animate(0.16, (_, u) => {
      const k = Math.sin(u * Math.PI);
      bulb.scale.set(1 + 0.08 * k, 1 - 0.14 * k, 1 + 0.08 * k);
    }, ease.linear);
    bulb.scale.setScalar(1);
    const s = volume.at(spot.x, spot.z);
    const target = v3(spot.x, s.bottom + (s.top - s.bottom) * 0.46, spot.z);
    store.addPigment({ type, position: target.toArray(), action: store.snapshot().sequence.length });
    const job = fallDroplet(it, v3(spot.x, DROPPER_Y + tipOffset, spot.z), target, s.top);
    pending.add(job);
    job.finally(() => pending.delete(job));
  });
}
const dropletPool = [];
async function fallDroplet(it, from, target, surfaceY) {
  const type = it.def.id;
  const color = new THREE.Color(PIGMENT[type].color);
  const m = dropletPool.pop() || new THREE.Mesh(items.dropletGeometry, items.dropletMaterial.clone());
  m.material.color.copy(color);
  m.position.copy(from);
  m.scale.setScalar(0.1);
  scene.add(m);
  await animate(0.12, (e) => m.scale.setScalar(0.1 + 1.5 * e));
  const h = from.y - surfaceY;
  const T = Math.sqrt((2 * h) / POUR.gravity);
  await animate(T, (_, u) => {
    m.position.y = from.y - h * u * u;
    const v = 1 + 0.35 * u;
    m.scale.set(1.6 / Math.sqrt(v), 1.6 * v, 1.6 / Math.sqrt(v));
  }, ease.linear);
  ripples.fire(m.position, 0.0075, 0.5);
  pigment.splat(target.x, target.z, type);
  pigment.remeasure();
  scheduleSave();
  const hit = m.position.clone();
  await animate(0.4, (e) => {
    m.position.lerpVectors(hit, target, e);
    m.scale.setScalar(1.6 * (1 - e));
  }, ease.out);
  scene.remove(m);
  dropletPool.push(m);
}

/* ---------- input queue ---------- */
const queue = [];
let working = false;
async function runQueue() {
  if (working) { return; }
  working = true;
  setLocked(true);
  syncButtons();
  while (queue.length) {
    const job = queue.shift();
    await job();
  }
  await Promise.all([...pending]);
  working = false;
  setLocked(false);
  syncButtons();
}
function setLocked(on) {
  app.classList.toggle('is-locked', on);
  items.forEach((x) => { x.label.setAttribute('aria-disabled', on); });
}
// One ingredient at a time. While it is being added, every other choice is ignored.
function select(id) {
  const it = items.get(id);
  if (dropMode.it === it) { finishDropper(); return; }
  if (working || mode !== 'add') return;
  queue.push(() => (it.def.kind === 'part' ? pour(it) : useDropper(it)));
  runQueue();
}
function resetAll() {
  if (mode === 'moving' || (working && !dropMode.it)) return; // wait for the running animation
  hand?.stop();
  finishDropper();
  queue.push(async () => {
    await Promise.all([...pending]);
    store.reset();
    Object.values(layers).forEach((l) => l.clear());
    mix.reset();
    clearSaved();
    if (mode !== 'add') await setMode('add');
  });
  runQueue();
}

canvas.addEventListener('pointermove', (ev) => {
  if (mode !== 'add') return;
  if (dropMode.it) {
    const p = pointerOnGel(ev);
    if (p) dropMode.goal.set(p.x, DROPPER_Y, p.z);
    canvas.style.cursor = p ? 'crosshair' : 'default';
    return;
  }
  const it = ev.pointerType === 'mouse' && !working ? pickProxy(ev) : null;
  items.forEach((x) => x.label.classList.toggle('is-hover', x === it));
  canvas.style.cursor = it ? 'pointer' : 'default';
});
canvas.addEventListener('pointerup', (ev) => {
  if (mode !== 'add') return;
  if (dropMode.it) {
    const hit = pickProxy(ev);
    if (hit && !pointerOnGel(ev)) { select(hit.def.id); return; }
    const p = pointerOnGel(ev);
    if (p) squeezeAndDrop(dropMode.it, p);
    return;
  }
  const it = pickProxy(ev);
  if (it) select(it.def.id);
});
document.getElementById('dropdone').addEventListener('click', finishDropper);
document.getElementById('reset').addEventListener('click', resetAll);
addEventListener('resize', applyLayout);

/* ---------- modes ---------- */
const $ = (id) => document.getElementById(id);
const guide = $('guide');
let guideTimer;
function syncButtons() {
  $('mixbtn').hidden = mode !== 'add' || working;
  $('mixbar').hidden = mode !== 'mix';
  $('reset').hidden = mode === 'moving' || mode === 'ending';
  app.dataset.mode = mode;
}
async function setMode(next) {
  if (mode === 'moving' || mode === next) return;
  const prev = mode;
  const from = camera.position.clone();
  const fromT = lookTarget.clone();
  const to = cameraPose(next);
  mode = 'moving';
  syncButtons();
  guide.hidden = true;
  if (prev === 'ending') $('ending').hidden = true;
  const t = v3();
  app.classList.toggle('mixing', next !== 'add');
  const retreat = (u) => items.forEach((it) => {
    it.node.position.set(it.home.x * (1 + 0.9 * u), 0, it.home.z * (1 + 0.9 * u) - 0.05 * u);
    it.node.scale.setScalar(1 - 0.35 * u);
  });
  if (next === 'add') items.forEach((it) => { it.node.visible = true; });
  const spin = stage.rotation.y;
  await animate(0.9, (e) => {
    camera.position.lerpVectors(from, to.position, e);
    t.lerpVectors(fromT, to.target, e);
    lookTarget.copy(t);
    camera.lookAt(t);
    stage.rotation.y = spin * (1 - e);
    if (prev === 'add') retreat(e);
    if (next === 'add') retreat(1 - e);
  });
  if (next !== 'add') items.forEach((it) => { it.node.visible = false; });
  mode = next;
  swayTime = 0;
  syncButtons();
  clearTimeout(guideTimer);
  if (next === 'mix') {
    guide.hidden = false;
    guide.classList.remove('gone');
    guideTimer = setTimeout(() => guide.classList.add('gone'), 4500);
  }
  if (next === 'ending') showEnding();
  else if (hand?.on && next !== 'mix') hand.stop();
}
$('mixbtn').addEventListener('click', () => { if (!working) setMode('mix'); });
$('addbtn').addEventListener('click', () => { if (!mix.busy) setMode('add'); });
$('donebtn').addEventListener('click', () => { if (!mix.busy) { hand?.stop(); setMode('ending'); } });

/* ---------- ending ---------- */
function usedText() {
  const s = store.summary();
  return s.ingredients.map((i) => i.name).join(' · ') || '투명한 말랑이';
}
function showEnding() {
  const sum = store.summary();
  $('endname').textContent = makeName(sum);
  $('endused').textContent = usedText();
  $('ending').hidden = false;
  $('savemsg').textContent = '';
}
const CARD_W = () => Math.min(renderer.capabilities.maxTextureSize, portrait ? 2400 : 3600);
async function saveImage(kind) {
  const msg = $('savemsg');
  msg.textContent = '이미지를 만들고 있어요.';
  await new Promise((r) => setTimeout(r, 40));
  try {
    await document.fonts.ready;
    const w = CARD_W();
    const still = renderStill({ renderer, scene, camera, width: w, height: w });
    const name = $('endname').textContent;
    if (kind === 'card') {
      const card = composeCard(still, { title: 'PHILIA', heading: '당신의 우정 말랑이', name, used: usedText() });
      await saveCanvas(card, 'PHILIA_우정말랑이_카드.png');
    } else {
      await saveCanvas(still, 'PHILIA_우정말랑이.png');
    }
    msg.textContent = '';
  } catch (e) {
    console.error(e);
    msg.textContent = '저장하지 못했어요. 다시 눌러 주세요.';
  }
}
$('savecard').addEventListener('click', () => saveImage('card'));
$('saveobject').addEventListener('click', () => saveImage('object'));
$('again').addEventListener('click', () => resetAll());

/* ---------- saving the mix ---------- */
const FIELD_KEY = 'philia.field.v1';
const PLASTIC_KEY = 'philia.plastic.v1';
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(FIELD_KEY, pigment.serialize());
      localStorage.setItem(PLASTIC_KEY, deform.serialize());
    } catch { /* storage unavailable: keep in memory */ }
  }, 300);
}
function clearSaved() {
  clearTimeout(saveTimer);
  try { localStorage.removeItem(FIELD_KEY); localStorage.removeItem(PLASTIC_KEY); } catch { /* ignore */ }
}
function readSaved(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/* ---------- boot ---------- */
function handUI() {
  const video = $('camvideo');
  const dots = $('camdots');
  const pointerEl = $('handpointer');
  const box = $('cam');
  const g = dots.getContext('2d');
  let previewOn = true;
  const refresh = () => {
    const on = hand?.on;
    box.hidden = !on;
    box.classList.toggle('collapsed', !previewOn);
    $('camtoggle').textContent = previewOn ? '카메라 숨기기' : '카메라 보기';
    $('handbtn').hidden = !!on;
  };
  $('camtoggle').addEventListener('click', () => { previewOn = !previewOn; refresh(); });
  $('handoff').addEventListener('click', () => { hand.stop(); refresh(); });
  $('handbtn').addEventListener('click', () => hand.start().then(refresh));
  return {
    video,
    status: (t) => { $('handmsg').textContent = t; $('handmsg').hidden = !t; },
    showPreview: () => setTimeout(refresh),
    previewVisible: () => previewOn,
    pointer(p) {
      if (!p) { pointerEl.hidden = true; return; }
      pointerEl.hidden = false;
      pointerEl.classList.toggle('pinching', p.pinching);
      pointerEl.style.transform = `translate(${(p.x * 0.5 + 0.5) * app.clientWidth}px, ${(-p.y * 0.5 + 0.5) * app.clientHeight}px)`;
    },
    drawHand(lm) {
      g.clearRect(0, 0, dots.width, dots.height);
      if (!lm || !previewOn) return;
      g.fillStyle = '#ffffff';
      for (const i of [4, 8]) {
        g.beginPath();
        g.arc((1 - lm[i].x) * dots.width, lm[i].y * dots.height, 5, 0, 7);
        g.fill();
      }
    },
  };
}

function setup(gltf) {
  const root = gltf.scene;
  scene.add(root);
  root.getObjectByName('MASTERS').visible = false;
  slime = root.getObjectByName('SLIME_BASE');
  slime.position.set(0, 0, 0);
  stage = new THREE.Group();     // gel and contents turn together at the end
  scene.add(stage);
  stage.add(slime);
  slime.getObjectByName('SLIME_BUBBLES').visible = false;
  applyGel(slime);
  volume = buildVolume(slime.geometry);
  inside = new THREE.Group();
  inside.name = 'MIX_CONTENTS';
  stage.add(inside);
  ripples = new Ripples(scene);

  root.traverse((o) => {
    if (o.material && /^MAT_GLASS/.test(o.material.name)) o.material.depthWrite = false; // serum liquid is alpha blended
  });

  const labelBox = document.getElementById('labels');
  const proxyMat = new THREE.MeshBasicMaterial();
  for (const def of INGREDIENTS) {
    const isPart = def.kind === 'part';
    const node = root.getObjectByName(`${isPart ? 'CUP' : 'SERUM'}_${def.id}`);
    const height = isPart ? 0.034 : 0.09;
    const radius = isPart ? 0.019 : 0.015;
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.25, radius * 1.25, height, 12), proxyMat);
    proxy.visible = false;
    proxy.userData.id = def.id;
    scene.add(proxy);
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'label';
    label.innerHTML = `<b>${def.name}</b><span>${def.meaning}</span>`;
    label.setAttribute('aria-label', `${def.name}, ${def.meaning}`);
    label.addEventListener('click', () => select(def.id));
    label.addEventListener('pointerenter', () => label.classList.add('is-hover'));
    label.addEventListener('pointerleave', () => label.classList.remove('is-hover'));
    labelBox.append(label);
    const it = { def, node, home: v3(), proxy, label, busy: false, height, radius };
    if (!isPart) {
      it.dropper = node.getObjectByName(`DROPPER_${def.id}`);
      it.dropperLocal = it.dropper.position.clone();
    }
    items.set(def.id, it);
  }
  for (const [type, cfg] of Object.entries(PART)) {
    const master = root.getObjectByName(`PART_${type}_MASTER`);
    layers[type] = new PartLayer(inside, master.geometry, master.material, MAX_VISIBLE[type] || MAX_VISIBLE.default);
    cfg.master = master.name;
  }
  const droplet = root.getObjectByName('DROPLET_MASTER');
  items.dropletGeometry = droplet.geometry;
  items.dropletMaterial = droplet.material;

  deform = new DeformEngine(slime.geometry);
  pigment = new PigmentEngine(renderer, inside, volume, app.clientWidth < 700 ? 340 : 512);
  partEngine = new PartEngine(layers, volume, PART);
  mix = new MixEngine({
    deform, pigment, parts: partEngine, volume,
    onCommit: () => { store.touch(); scheduleSave(); },
  });
  attachPointer({ canvas, camera, engine: mix, enabled: () => mode === 'mix' });
  hand = new HandInput({ camera, engine: mix, enabled: () => mode === 'mix', ui: handUI() });

  applyLayout();
  const saved = store.load();
  saved.parts.forEach(restorePart);
  const field = readSaved(FIELD_KEY);
  const restored = field && pigment.restore(field);
  if (!restored) saved.pigments.forEach((r) => pigment.splat(r.position[0], r.position[2], r.type));
  pigment.remeasure();
  const plastic = readSaved(PLASTIC_KEY);
  if (plastic) { deform.restore(plastic); pigment.bend(deform); }
  syncButtons();
  window.PHILIA = {
    ready: true, scene, camera, items, select, finishDropper, resetAll,
    state: store.snapshot, summary: store.summary, volume, layers, setMode, makeName, get hand() { return hand; }, get mode() { return mode; }, get mix() { return mix; },
    get pigment() { return pigment; }, get parts() { return partEngine; }, get deform() { return deform; },
    THREE, slime, idle: () => !working && !queue.length && !pending.size,
    debug: () => ({ working, queue: queue.length, pending: pending.size, active: [...items.values()].filter((i) => i.busy).map((i) => i.def.id), dropper: !!dropMode.it }),
    dropAt: (x, z) => { if (dropMode.it) squeezeAndDrop(dropMode.it, v3(x, 0, z)); },
    inDropper: () => !!dropMode.it,
  };
}

const b64 = window.PHILIA_GLB_B64;
const loader = new GLTFLoader();
const fail = (e) => {
  console.error(e);
  document.getElementById('loaderror').hidden = false;
};
if (b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  loader.parse(bytes.buffer, '', setup, fail);
} else {
  loader.load(`${import.meta.env.BASE_URL}PHILIA_objects.glb`, setup, undefined, fail);
}

// ?maxfps=1&speed=4 are for slow software-rendering test machines only.
const query = new URLSearchParams(location.search);
const maxFps = Number(query.get('maxfps')) || 0;
const testSpeed = Number(query.get('speed')) || 1;
const clock = new THREE.Clock();
let sinceDraw = 0;
renderer.setAnimationLoop(() => {
  const raw = clock.getDelta();
  sinceDraw += raw;
  if (maxFps && sinceDraw < 1 / maxFps) return;
  const dt = Math.min(maxFps ? sinceDraw : raw, maxFps ? 0.5 : 0.1);
  sinceDraw = 0;
  stepTweens(dt * testSpeed);
  if (stage && mode === 'ending') { swayTime += dt; stage.rotation.y = Math.sin(swayTime * 0.22) * 0.28; }
  if (mix) mix.step(dt * testSpeed);
  if (ripples) ripples.step(dt);
  if (dropMode.it && dropMode.done) {
    const d = dropMode.it.dropper;
    const k = 1 - Math.exp(-dt * 12);
    d.position.x += (dropMode.goal.x - d.position.x) * k;
    d.position.z += (dropMode.goal.z - d.position.z) * k;
  }
  const t0 = performance.now();
  if (query.has('norender')) scene.updateMatrixWorld(); else renderer.render(scene, camera);
  window.PHILIA_FRAME_MS = performance.now() - t0;
});
