import { gelPoint } from './input.js';

// Webcam hand tracking. Runs entirely in the browser; no frame leaves the page.
// A pinch becomes the same press / drag / release as a mouse button.
const BASE = import.meta.env.BASE_URL;
const MODEL_LOCAL = `${BASE}models/hand_landmarker.task`;
const MODEL_REMOTE = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PINCH_ON = 0.32;   // thumb-index gap relative to palm size
const PINCH_OFF = 0.5;
// 다섯 손가락으로 움켜쥐기: 손끝 다섯 개가 한데 모이면(손을 오므리면) 잡기. 손바닥 길이 대비 손끝들의 퍼짐.
const GRASP_ON = 0.5;    // 이보다 모이면 잡음
const GRASP_OFF = 0.66;  // 이보다 다시 펴지면 놓음 (사이를 두어 조물조물해도 끊기지 않게)
const STEADY = 3;        // a hand shape must hold this many frames before it counts
const STEADY_MS = 90;    // ...or this long, so slow phone cameras don't add lag
const LOST_MS = 500;     // keep the grip through short tracking gaps
const REACH = 1.35;      // a little gain so the edges are easy to reach
const FINGER = 0.75;     // hand drawn at a calmer size around the palm
const HANDS = 2;
const TIPS = [4, 8, 12, 16, 20];
const PALM = [0, 5, 9, 13, 17];
const LIGHT_FINGER = { depth: 0.0038, radius: 0.0075 };  // an open hand resting on the gel
const LIGHT_PALM = { depth: 0.0028, radius: 0.02 };
const HAND_GRAB = { reach: 1.3, edgeAt: 0.3, foldAt: 9, dragStart: 0.02 }; // 손: 늘리기·주무르기만, 접기(뒤집힘) 없음 / 손떨림으로 늘어나지 않게 조금 움직여야 시작           // like the sandwich: grab almost anywhere and pull to stretch
// Moving the hand toward the camera makes it bigger in the picture: that is a push.
const PUSH_FROM = 1.1;   // hand size over its resting size where a push starts
const PUSH_FULL = 1.4;   // ...and where it is a full press
const PUSH_ON = 0.4;     // an open hand pushed this far takes hold, like a mouse button
const PUSH_OFF = 0.18;
export const CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

class OneEuro {
  constructor(minCut = 1.3, beta = 9) { Object.assign(this, { minCut, beta, x: null, dx: 0, t: 0 }); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max((t - this.t) / 1000, 1 / 120);
    const a = (c) => { const r = 2 * Math.PI * c * dt; return r / (r + 1); };
    this.dx += a(1) * ((v - this.x) / dt - this.dx);
    this.x += a(this.minCut + this.beta * Math.abs(this.dx)) * (v - this.x);
    this.t = t;
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}

class Tracker {
  constructor(id) {
    Object.assign(this, { id, fx: new OneEuro(), fy: new OneEuro(), offsets: null, raw: null, seen: -1e9, shape: 'open', candidate: 'open', steady: 0, pinched: false, held: new Set(), screen: null, rest: 0, size: 0, push: 0, pushing: false });
  }
  clear() {
    this.fx.reset(); this.fy.reset();
    Object.assign(this, { offsets: null, raw: null, shape: 'open', candidate: 'open', steady: 0, pinched: false, screen: null, rest: 0, size: 0, push: 0, pushing: false });
  }
}

export class HandInput {
  constructor({ camera, engine, enabled, ui }) {
    Object.assign(this, { camera, engine, enabled, ui, on: false, stream: null, landmarker: null, running: false });
    this.trackers = Array.from({ length: HANDS }, (_, i) => new Tracker(`hand${i}`));
    addEventListener('pagehide', () => this.stop());
  }
  async start() {
    if (this.on) return;
    const { status } = this.ui;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      status('이 주소에서는 카메라를 쓸 수 없어요. 마우스나 터치로 이용해 주세요.');
      return;
    }
    status('카메라를 준비하고 있어요.');
    try {
      // Small frames: the model works at about 224 px anyway, and phones keep their frame rate up.
      const phone = matchMedia('(pointer: coarse)').matches;
      const video = { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 30 } };   // 작은 프레임으로 충분 (모델은 약 224px로 봄)
      this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      this.stream = null;
      status(e.name === 'NotAllowedError' ? '카메라 권한이 없어요. 마우스나 터치로 이용해 주세요.' : '카메라를 찾지 못했어요. 마우스나 터치로 이용해 주세요.');
      return;
    }
    const video = this.ui.video;
    video.srcObject = this.stream;
    await video.play().catch(() => {});
    this.on = true;
    this.ui.showPreview(true);
    try {
      status('손 인식을 불러오고 있어요.');
      await this.load();
      status('동그라미가 손이 닿는 곳이에요. 주먹을 쥐거나 엄지·검지로 집어서 쭈욱 당겨 보세요.');
      setTimeout(() => status(''), 6000);
    } catch (e) {
      console.error(e);
      this.stop();
      status('손 인식을 불러오지 못했어요. 마우스나 터치로 이용해 주세요.');
      return;
    }
    if (!this.on) return;
    this.running = true;
    this.loop();
  }
  // 손 인식 간격(ms): 매 카메라 프레임마다 돌리면 화면 그리기와 GPU를 다퉈 렉이 걸림 → PC 약 20번/초, 휴대폰 약 16번/초
  get gap() { return matchMedia('(pointer: coarse)').matches ? 60 : 48; }
  async load() {
    if (this.landmarker) return;
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
    const local = await fetch(MODEL_LOCAL, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
    const modelAssetPath = local ? MODEL_LOCAL : MODEL_REMOTE;
    const opts = { runningMode: 'VIDEO', numHands: HANDS, minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4 };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath, delegate: 'GPU' }, ...opts });
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath, delegate: 'CPU' }, ...opts });
    }
  }
  loop() {
    if (!this.running) return;
    const video = this.ui.video;
    // one inference per new camera frame, never twice on the same picture
    const now = performance.now();
    if (this.landmarker && video.readyState >= 2 && !video.paused && video.currentTime !== this.lastFrame && now - (this.lastDetect || 0) >= this.gap) {
      this.lastFrame = video.currentTime;
      this.lastDetect = now;
      try {
        const r = this.landmarker.detectForVideo(video, now);
        this.feed(r.landmarks.map((lm, i) => ({ lm, world: r.worldLandmarks?.[i] })), now);
      } catch (e) {
        console.error(e);
        this.feed([], now);
      }
    }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => this.loop());
    else setTimeout(() => this.loop(), 33);
  }
  // One frame of hands. Public so recorded or simulated data can drive it.
  feed(hands, now) {
    const free = new Set(this.trackers);
    // keep each hand on its own tracker by position; MediaPipe's left/right label can swap
    const seen = hands.map((h) => {
      const n = PALM.length;
      const px = PALM.reduce((v, i) => v + h.lm[i].x, 0) / n;
      const py = PALM.reduce((v, i) => v + h.lm[i].y, 0) / n;
      return { ...h, mx: 1 - px, my: py };
    });
    for (const h of seen) {
      let best = null; let bd = 0.45;
      for (const t of free) {
        if (!t.raw) continue;
        const d = Math.hypot(t.raw.x - h.mx, t.raw.y - h.my);
        if (d < bd) { bd = d; best = t; }
      }
      h.tracker = best;
      if (best) free.delete(best);
    }
    for (const h of seen) {
      if (!h.tracker) { h.tracker = [...free][0]; free.delete(h.tracker); }
      if (h.tracker) this.update(h.tracker, h, now);
    }
    for (const t of free) {
      if (now - t.seen > LOST_MS) {
        this.letGo(t);
        t.clear();
      }
    }
    const live = this.trackers.filter((t) => t.screen);
    this.ui.drawHands(seen.filter((h) => h.tracker).map((h) => ({ lm: h.lm, shape: h.tracker.shape })));
    this.ui.overlay(live.map((t) => ({ pts: t.screen, shape: t.shape, cursor: t.cursor, holding: t.holding })));
  }
  // What the whole hand is doing, from all five fingers.
  readShape(lm, t) {
    const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
    const palm = d(0, 9) || 1e-3;
    const gap = d(4, 8) / palm;
    // five fingertips gathered toward each other = a natural whole-hand grab (조물조물 / 쭈욱 늘리기)
    const tips = TIPS.map((i) => lm[i]);
    const cx = tips.reduce((v, p) => v + p.x, 0) / 5, cy = tips.reduce((v, p) => v + p.y, 0) / 5;
    const spread = tips.reduce((v, p) => v + Math.hypot(p.x - cx, p.y - cy), 0) / 5 / palm;
    // ...and curled in toward the palm (a flat hand with fingers together is NOT a grab)
    const pcx = PALM.reduce((v, i) => v + lm[i].x, 0) / 5, pcy = PALM.reduce((v, i) => v + lm[i].y, 0) / 5;
    const curl = tips.reduce((v, p) => v + Math.hypot(p.x - pcx, p.y - pcy), 0) / 5 / palm;
    t.grasped = t.grasped ? spread < GRASP_OFF && curl < 0.95 : spread < GRASP_ON && curl < 0.78;
    t.spread = spread;
    if (t.grasped) return 'grasp';
    t.pinched = t.pinched ? gap < PINCH_OFF : gap < PINCH_ON;
    if (t.pinched) return 'pinch';
    const out = (tip, pip) => d(tip, 0) > d(pip, 0) * 1.12;
    const [index, middle, ring, little] = [out(8, 6), out(12, 10), out(16, 14), out(20, 18)];
    const count = [index, middle, ring, little].filter(Boolean).length;
    if (count === 0) return 'fist';
    if (index && count === 1) return 'poke';
    return 'open';
  }
  update(t, h, now) {
    t.seen = now;
    t.raw = { x: h.mx, y: h.my };
    const shape = this.readShape(h.lm, t);
    if (shape === t.candidate) t.steady++;
    else { t.candidate = shape; t.steady = 1; t.since = now; }
    if (t.steady >= STEADY || (t.steady >= 2 && now - t.since >= STEADY_MS)) t.shape = shape;
    // Palm follows the hand with a steady filter, fingers ride on it, so the hand holds its shape.
    const video = this.ui.video;
    const videoAspect = (video.videoWidth || 4) / (video.videoHeight || 3);
    const screenAspect = this.camera.aspect;
    // Same as the sandwich piece: the camera picture is spread over the whole screen, so small
    // hand moves reach every part of it, up-and-down as easily as sideways.
    const ky = 1;
    const kxFinger = videoAspect / screenAspect;
    const cx = t.fx.filter((h.mx - 0.5) * 2 * REACH, now);
    const cy = t.fy.filter(-(h.my - 0.5) * 2 * REACH * ky, now);
    if (!t.offsets) t.offsets = h.lm.map(() => ({ x: 0, y: 0 }));
    const follow = t.screen ? 0.62 : 1;
    t.screen = h.lm.map((p, i) => {
      const o = t.offsets[i];
      // 손가락은 손바닥 기준으로 실제 손 크기에 가깝게 (예전엔 REACH만큼 커져 손이 화면을 덮고 닿는 점이 흩어졌음)
      o.x += (-(p.x - (1 - h.mx)) * 2 * FINGER * kxFinger - o.x) * follow;
      o.y += (-(p.y - h.my) * 2 * FINGER * ky - o.y) * follow;
      return { x: cx + o.x, y: cy + o.y };
    });
    // Hand size in camera pixels (palm length, wrist to middle knuckle). The resting size follows
    // quickly when the hand draws back and only slowly when it comes closer, so a push reads as a
    // push for a few seconds and then quietly becomes the new rest.
    const vw = video.videoWidth || 640; const vh = video.videoHeight || 480;
    const size = Math.hypot((h.lm[0].x - h.lm[9].x) * vw, (h.lm[0].y - h.lm[9].y) * vh);
    t.size = t.size ? t.size + (size - t.size) * 0.5 : size;
    if (!t.rest) t.rest = t.size;
    t.rest += (t.size - t.rest) * (t.size < t.rest ? 0.12 : 0.012);
    const ratio = t.size / t.rest;
    t.push = Math.min(1, Math.max(0, (ratio - PUSH_FROM) / (PUSH_FULL - PUSH_FROM)));
    t.pushing = t.pushing ? t.push > PUSH_OFF : t.push > PUSH_ON;
    this.act(t);
  }
  // Turn the hand shape into contacts. Everything ends up as the same engine commands.
  act(t) {
    const want = new Map();
    if (this.enabled()) {
      const at = (i) => t.screen[i];
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const palm = PALM.map(at).reduce((v, p) => ({ x: v.x + p.x / 5, y: v.y + p.y / 5 }), { x: 0, y: 0 });
      // Holding: pinch, pointed finger, fist, or an open hand pushed toward the screen. A hold
      // that starts near the rim and moves outward stretches the gel; inward it folds.
      if (t.shape === 'grasp') {
        const tipsMid = TIPS.map(at).reduce((v, p) => ({ x: v.x + p.x / 5, y: v.y + p.y / 5 }), { x: 0, y: 0 });
        want.set('grab', { pos: mid(tipsMid, palm) });
      } else if (t.shape === 'pinch') want.set('grab', { pos: mid(at(4), at(8)) });
      else if (t.shape === 'poke') want.set('grab', { pos: at(8) });
      else if (t.shape === 'fist' || t.pushing) want.set('grab', { pos: palm });
      // one clear point per hand, drawn as a ring on screen, so you can see where you will touch
      t.cursor = want.get('grab')?.pos || (t.shape === 'fist' ? palm : at(8));
      t.holding = false;
      if (!want.has('grab')) {
        // resting open hand: soft contacts that deepen as the hand comes closer
        const k = 1 + t.push * 2.5;
        want.set('palm', { pos: palm, light: { depth: LIGHT_PALM.depth * k, radius: LIGHT_PALM.radius } });
        TIPS.forEach((tip, i) => want.set(`tip${i}`, { pos: at(tip), light: LIGHT_FINGER }));
      }
    }
    for (const key of [...t.held]) {
      if (!want.has(key)) { this.engine.release(`${t.id}:${key}`); t.held.delete(key); }
    }
    for (const [key, w] of want) {
      const p = gelPoint(this.camera, w.pos.x, w.pos.y);
      const id = `${t.id}:${key}`;
      if (!p) { if (t.held.has(key)) { this.engine.release(id); t.held.delete(key); } continue; }
      if (w.light) {
        if (this.engine.touch(p, id, w.light)) t.held.add(key);
        else if (t.held.has(key)) { this.engine.release(id); t.held.delete(key); }
      } else if (t.held.has(key)) this.engine.drag(p, id);
      else if (this.engine.press(p, id, HAND_GRAB)) t.held.add(key);
      if (key === 'grab' && t.held.has(key)) t.holding = true;
    }
  }
  letGo(t) {
    for (const key of t.held) this.engine.release(`${t.id}:${key}`);
    t.held.clear();
  }
  stop() {
    this.running = false;
    this.trackers.forEach((t) => { this.letGo(t); t.clear(); });
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.on = false;
    if (this.ui) {
      this.ui.video.srcObject = null;
      this.ui.showPreview(false);
      this.ui.drawHands([]);
      this.ui.overlay([]);
    }
  }
}
