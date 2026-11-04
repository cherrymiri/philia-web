import { gelPoint } from './input.js';

// Webcam hand tracking. Runs entirely in the browser; no frame leaves the page.
// A pinch becomes the same press / drag / release as a mouse button.
const BASE = import.meta.env.BASE_URL;
const MODEL_LOCAL = `${BASE}models/hand_landmarker.task`;
const MODEL_REMOTE = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PINCH_ON = 0.3;    // thumb-index gap relative to palm size
const PINCH_OFF = 0.45;
const LOST_MS = 350;     // keep the grip through short tracking gaps
const REACH = 1.45;      // the middle of the camera view covers the whole screen

class OneEuro {
  constructor(minCut = 1.6, beta = 12) { Object.assign(this, { minCut, beta, x: null, dx: 0, t: 0 }); }
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

export class HandInput {
  constructor({ camera, engine, enabled, ui }) {
    Object.assign(this, { camera, engine, enabled, ui, on: false, stream: null, landmarker: null, pinching: false, grabbed: false, lastSeen: 0, running: false });
    this.fx = new OneEuro();
    this.fy = new OneEuro();
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
    const opts = { runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath, delegate: 'GPU' }, ...opts });
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath, delegate: 'CPU' }, ...opts });
    }
  }
  loop() {
    if (!this.running) return;
    const video = this.ui.video;
    const next = () => {
      if (!this.running) return;
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => this.loop());
      else setTimeout(() => this.loop(), 33);
    };
    if (this.landmarker && video.readyState >= 2 && !video.paused) {
      const now = performance.now();
      try {
        const r = this.landmarker.detectForVideo(video, now);
        this.feed(r.landmarks?.[0] || null, now);
      } catch (e) {
        console.error(e);
        this.feed(null, now);
      }
    }
    next();
  }
  // One frame of landmarks (or null). Public so it can be driven by recorded data.
  feed(lm, now) {
    if (!lm) {
      this.ui.drawHand(null);
      if (now - this.lastSeen > LOST_MS) {
        this.letGo();
        this.ui.pointer(null);
        this.fx.reset(); this.fy.reset();
      }
      return;
    }
    this.lastSeen = now;
    this.ui.drawHand(lm);
    const [wrist, thumb, index, knuckle] = [lm[0], lm[4], lm[8], lm[9]];
    const palm = Math.hypot(wrist.x - knuckle.x, wrist.y - knuckle.y) || 1e-3;
    const gap = Math.hypot(thumb.x - index.x, thumb.y - index.y) / palm;
    if (!this.pinching && gap < PINCH_ON) this.pinching = true;
    else if (this.pinching && gap > PINCH_OFF) this.pinching = false;
    // mirrored like a selfie, so moving right moves right on screen
    const mx = 1 - (thumb.x + index.x) / 2;
    const my = (thumb.y + index.y) / 2;
    const x = Math.max(-1, Math.min(1, this.fx.filter((mx - 0.5) * 2 * REACH, now)));
    const y = Math.max(-1, Math.min(1, -this.fy.filter((my - 0.5) * 2 * REACH, now)));
    this.ui.pointer({ x, y, pinching: this.pinching });
    const p = gelPoint(this.camera, x, y);
    if (!this.enabled() || !p) { this.letGo(); return; }
    if (this.pinching && !this.grabbed) this.grabbed = this.engine.press(p);
    else if (this.pinching && this.grabbed) this.engine.drag(p);
    else this.letGo();
  }
  letGo() {
    if (this.grabbed) { this.grabbed = false; this.engine.release(); }
    this.pinching = false;
  }
  stop() {
    this.running = false;
    this.letGo();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.on = false;
    if (this.ui) {
      this.ui.video.srcObject = null;
      this.ui.showPreview(false);
      this.ui.pointer(null);
      this.ui.drawHand(null);
    }
  }
}
