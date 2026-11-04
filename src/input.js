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
  let id = null;
  const onGel = (ev) => {
    const r = canvas.getBoundingClientRect();
    return gelPoint(camera, ((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  };
  canvas.addEventListener('pointerdown', (ev) => {
    if (!enabled() || id !== null) return;
    const p = onGel(ev);
    if (p && engine.press(p)) {
      id = ev.pointerId;
      canvas.setPointerCapture(id);
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== id) return;
    const p = onGel(ev);
    if (p) engine.drag(p);
  });
  const end = (ev) => {
    if (ev.pointerId !== id) return;
    id = null;
    engine.release();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
