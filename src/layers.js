import * as THREE from 'three';

const dummy = new THREE.Object3D();

// One instanced draw per part type. Grows on demand; past `max` the oldest display slot is reused.
export class PartLayer {
  constructor(parent, geometry, material, max) {
    Object.assign(this, { parent, geometry, material, max, count: 0, next: 0, cap: 0, mesh: null });
    this.grow(32);
  }
  grow(cap) {
    const m = new THREE.InstancedMesh(this.geometry, this.material, cap);
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.mesh) {
      m.instanceMatrix.array.set(this.mesh.instanceMatrix.array);
      this.parent.remove(this.mesh);
      this.mesh.dispose();
    }
    m.count = this.count;
    this.parent.add(m);
    this.mesh = m;
    this.cap = cap;
  }
  take() {
    if (this.count < this.max) {
      if (this.count === this.cap) this.grow(Math.min(this.cap * 2, this.max));
      this.mesh.count = ++this.count;
      return this.count - 1;
    }
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    return i;
  }
  set(i, position, quaternion, scale) {
    dummy.position.copy(position);
    dummy.quaternion.copy(quaternion);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    this.mesh.setMatrixAt(i, dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() {
    this.count = 0;
    this.next = 0;
    this.mesh.count = 0;
  }
}

// Pigment: soft-edged liquid pockets. Each drop stays where it fell, colours stay separate.
export class BlobLayer {
  constructor(parent) {
    this.cap = 512;
    const geo = new THREE.SphereGeometry(1, 24, 16);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vC;
        void main(){ vec4 p = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-p.xyz);
          vC = instanceColor; gl_Position = projectionMatrix * p; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vC;
        void main(){ float a = abs(dot(normalize(vN), normalize(vV)));
          float body = smoothstep(0.0, 0.85, a);
          vec3 c = mix(vC, vC * 1.1 + 0.06, a * a);
          gl_FragColor = vec4(c, body * 0.72);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, this.cap);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    parent.add(this.mesh);
    this.count = 0;
    this.next = 0;
  }
  take() {
    if (this.count < this.cap) { this.mesh.count = ++this.count; return this.count - 1; }
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    return i;
  }
  set(i, position, rx, ry, rz, color) {
    dummy.position.copy(position);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(Math.max(rx, 1e-5), Math.max(ry, 1e-5), Math.max(rz, 1e-5));
    dummy.updateMatrix();
    this.mesh.setMatrixAt(i, dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (color) { this.mesh.setColorAt(i, color); this.mesh.instanceColor.needsUpdate = true; }
  }
  clear() { this.count = 0; this.next = 0; this.mesh.count = 0; }
}

// Small ring where something enters the surface.
export class Ripples {
  constructor(scene, n = 10) {
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 40),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.pool.push({ m, t: 1, d: 0.42, size: 0.005 });
    }
    this.i = 0;
  }
  fire(position, size = 0.005, strength = 0.42) {
    const r = this.pool[this.i];
    this.i = (this.i + 1) % this.pool.length;
    Object.assign(r, { t: 0, size, strength });
    r.m.position.copy(position);
    r.m.position.y += 0.0004;
    r.m.visible = true;
  }
  step(dt) {
    for (const r of this.pool) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.d);
      const s = r.size * (0.25 + r.t * 0.85);
      r.m.scale.set(s, s, 1);
      r.m.material.opacity = (1 - r.t) * r.strength;
      if (r.t >= 1) r.m.visible = false;
    }
  }
}
