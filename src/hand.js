import { gelPoint } from './input.js';

// Webcam hand tracking. Runs entirely in the browser; no frame leaves the page.
// A pinch becomes the same press / drag / release as a mouse button.
const BASE = import.meta.env.BASE_URL;
const MODEL_LOCAL = `${BASE}models/hand_landmarker.task`;
const MODEL_REMOTE = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PINCH_ON = 0.038;   // thumb-index gap in metres, from MediaPipe's 3D landmarks
const PINCH_OFF = 0.062;
const PINCH_ON_2D = 0.42;  // fallback, relative to palm size
const PINCH_OFF_2D = 0.62;
const FRAMES_ON = 2;       // a pinch must hold this many frames, a stray frame cannot grab or drop
const FRAMES_OFF = 3;
const LOST_MS = 500;       // keep the grip through short tracking gaps
const REACH = 1.5;         // the middle of the camera view covers the whole screen
const HANDS = 2;

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
    Object.assign(this, { id, fx: new OneEuro(), fy: new OneEuro(), x: 0, y: 0, raw: null, seen: -1e9, pinching: false, grabbed: false, onCount: 0, offCount: 0 });
  }
  clear() { this.fx.reset(); this.fy.reset(); this.raw = null; this.pinching = false; this.onCount = 0; this.offCount = 0; }
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
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
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
      status('');
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
    if (this.landmarker && video.readyState >= 2 && !video.paused) {
      const now = performance.now();
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
    this.ui.drawHands(hands.map((h) => h.lm));
    const free = new Set(this.trackers);
    // keep each hand on its own tracker by position; MediaPipe's left/right label can swap
    const seen = hands.map((h) => {
      const [t, i] = [h.lm[4], h.lm[8]];
      return { ...h, mx: 1 - (t.x + i.x) / 2, my: (t.y + i.y) / 2 };
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
        this.ui.pointer(t.id, null);
      }
    }
  }
  update(t, h, now) {
    t.seen = now;
    t.raw = { x: h.mx, y: h.my };
    const closed = this.isClosed(h, t.pinching);
    t.onCount = closed ? t.onCount + 1 : 0;
    t.offCount = closed ? 0 : t.offCount + 1;
    if (!t.pinching && t.onCount >= FRAMES_ON) t.pinching = true;
    else if (t.pinching && t.offCount >= FRAMES_OFF) t.pinching = false;
    // mirrored like a selfie, so moving right moves right on screen
    const x = Math.max(-1, Math.min(1, t.fx.filter((h.mx - 0.5) * 2 * REACH, now)));
    const y = Math.max(-1, Math.min(1, -t.fy.filter((h.my - 0.5) * 2 * REACH, now)));
    this.ui.pointer(t.id, { x, y, pinching: t.pinching });
    const p = gelPoint(this.camera, x, y);
    if (!this.enabled() || !p) { this.letGo(t); return; }
    if (t.pinching && !t.grabbed) t.grabbed = this.engine.press(p, t.id);
    else if (t.pinching) this.engine.drag(p, t.id);
    else this.letGo(t);
  }
  isClosed(h, pinching) {
    const w = h.world;
    if (w) return Math.hypot(w[4].x - w[8].x, w[4].y - w[8].y, w[4].z - w[8].z) < (pinching ? PINCH_OFF : PINCH_ON);
    const { lm } = h;
    const palm = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 1e-3;
    return Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / palm < (pinching ? PINCH_OFF_2D : PINCH_ON_2D);
  }
  letGo(t) {
    if (t.grabbed) { t.grabbed = false; this.engine.release(t.id); }
  }
  stop() {
    this.running = false;
    this.trackers.forEach((t) => { this.letGo(t); t.clear(); this.ui?.pointer(t.id, null); });
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.on = false;
    if (this.ui) {
      this.ui.video.srcObject = null;
      this.ui.showPreview(false);
      this.ui.drawHands([]);
    }
  }
}
