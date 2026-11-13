import * as THREE from 'three';

// Print export (not part of the visitor UI): the finished gel exactly as the ending renders it, cut
// out with an alpha channel. The gel is light on black, so its opacity is read from its brightness
// (dark, see-through areas become transparent, highlights stay solid); the parts are rendered once
// more on their own over black and white to give them a solid mask. Colour is divided by opacity,
// so laid back over black the cutout is identical to the web image. The camera is the ending
// camera; a view offset only crops.
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const LIN = Array.from({ length: 256 }, (_, i) => toLin(i));

function shoot(renderer, scene, camera, w, h, bg) {
  scene.background = new THREE.Color(bg);
  renderer.setClearColor(bg, 1);   // the glass pass sees the clear colour, not the background
  renderer.setSize(w, h, false);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(renderer.domElement, 0, 0);
  return g.getImageData(0, 0, w, h);
}
// eslint-disable-next-line no-unused-vars
function matte(black, white) {
  const out = new ImageData(black.width, black.height);
  const b = black.data; const w = white.data; const o = out.data;
  for (let i = 0; i < b.length; i += 4) {
    let a = 0;
    for (let k = 0; k < 3; k++) a += 1 - (LIN[w[i + k]] - LIN[b[i + k]]);
    a = Math.min(1, Math.max(0, a / 3));
    o[i + 3] = Math.round(a * 255);
    if (a > 0.002) for (let k = 0; k < 3; k++) o[i + k] = Math.round(Math.min(255, toSrgb(Math.min(1, LIN[b[i + k]] / a))));
  }
  return out;
}
function bounds(img, min = 3) {
  let x0 = img.width; let y0 = img.height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.data[(y * img.width + x) * 4 + 3] >= min) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return { x0, y0, x1, y1 };
}

function cutout(full, partsBlack, partsWhite) {
  const out = new ImageData(full.width, full.height);
  const f = full.data; const pb = partsBlack.data; const pw = partsWhite.data; const o = out.data;
  for (let i = 0; i < f.length; i += 4) {
    let solid = 0;
    for (let k = 0; k < 3; k++) solid += 1 - (LIN[pw[i + k]] - LIN[pb[i + k]]);
    solid = Math.min(1, Math.max(0, solid / 3));
    const glow = Math.max(f[i], f[i + 1], f[i + 2]) / 255;
    const a = Math.max(solid, glow);
    o[i + 3] = Math.round(a * 255);
    if (a > 0.002) for (let k = 0; k < 3; k++) o[i + k] = Math.round(Math.min(255, f[i + k] / a));
  }
  return out;
}

export function exportCutout({ renderer, scene, camera, keep, gel, longSide = 3600, elevation = null }) {
  // optional viewing angle: the ending camera swung up or down around the gel, same distance
  const pose = { p: camera.position.clone(), q: camera.quaternion.clone() };
  if (elevation != null) {
    const target = new THREE.Vector3(0, 0.006, 0.022);
    const r = camera.position.distanceTo(target);
    const e = THREE.MathUtils.degToRad(elevation);
    camera.position.set(target.x, target.y + r * Math.sin(e), target.z + r * Math.cos(e));
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  const saved = {
    size: renderer.getSize(new THREE.Vector2()), ratio: renderer.getPixelRatio(), aspect: camera.aspect,
    bg: scene.background, clear: renderer.getClearColor(new THREE.Color()), clearAlpha: renderer.getClearAlpha(), rot: keep.rotation.y, hidden: [],
  };
  for (const o of scene.children) if (o !== keep && !o.isLight && o.visible) { o.visible = false; saved.hidden.push(o); }
  keep.rotation.y = 0;
  renderer.setPixelRatio(1);
  const shots = (w, h) => {
    const full = shoot(renderer, scene, camera, w, h, 0x000000);
    gel.visible = false;
    const pb = shoot(renderer, scene, camera, w, h, 0x000000);
    const pw = shoot(renderer, scene, camera, w, h, 0xffffff);
    gel.visible = true;
    return cutout(full, pb, pw);
  };
  try {
    // find the gel in a square frame, then render only that rectangle at print size
    const S = 900;
    camera.aspect = 1;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const bb = bounds(shots(S, S), 4);
    const pad = Math.round(0.03 * Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0));
    const x = Math.max(0, bb.x0 - pad); const y = Math.max(0, bb.y0 - pad);
    const w = Math.min(S, bb.x1 + pad + 1) - x; const h = Math.min(S, bb.y1 + pad + 1) - y;
    const k = longSide / Math.max(w, h);
    const W = Math.round(w * k); const H = Math.round(h * k);
    camera.setViewOffset(S * k, S * k, x * k, y * k, W, H);
    camera.updateProjectionMatrix();
    const img = shots(W, H);
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    out.getContext('2d').putImageData(img, 0, 0);
    return out;
  } finally {
    gel.visible = true;
    camera.position.copy(pose.p);
    camera.quaternion.copy(pose.q);
    camera.updateMatrixWorld();
    camera.clearViewOffset();
    camera.aspect = saved.aspect;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(saved.ratio);
    renderer.setSize(saved.size.x, saved.size.y, false);
    scene.background = saved.bg;
    renderer.setClearColor(saved.clear, saved.clearAlpha);
    keep.rotation.y = saved.rot;
    for (const o of saved.hidden) o.visible = true;
  }
}
