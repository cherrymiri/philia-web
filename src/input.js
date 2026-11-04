import * as THREE from 'three';

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.014);
const hit = new THREE.Vector3();

// Screen position (-1..1) to a point on the gel. Mouse, touch and hands all go through here.
export function gelPoint(camera, x, y) {
  ndc.set(x, y);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
}

// Mouse and touch: only turns pointers into engine commands.
export function attachPointer({ canvas, camera, engine, enabled }) {
  const active = new Set();
  const onGel = (ev) => {
    const r = canvas.getBoundingClientRect();
    return gelPoint(camera, ((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  };
  const key = (ev) => `pointer${ev.pointerId}`;
  canvas.addEventListener('pointerdown', (ev) => {
    if (!enabled()) return;
    const p = onGel(ev);
    if (p && engine.press(p, key(ev))) {
      active.add(ev.pointerId);
      canvas.setPointerCapture(ev.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!active.has(ev.pointerId)) return;
    const p = onGel(ev);
    if (p) engine.drag(p, key(ev));
  });
  const end = (ev) => {
    if (!active.delete(ev.pointerId)) return;
    engine.release(key(ev));
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
