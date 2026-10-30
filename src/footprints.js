import * as THREE from 'three';

const CAPACITY = 220;

/** 오른발 맨발 자국(위에서 본 모습, 발가락이 위쪽)을 캔버스에 그림 → 왼발은 좌우 반전으로 사용 */
export function makeFootTexture() {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  function shape(ctx) {
    ctx.beginPath();
    // 뒤꿈치
    ctx.ellipse(W * 0.52, H * 0.80, W * 0.20, H * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // 바깥쪽 아치(오른발 → 바깥쪽 = 화면 오른쪽)
    ctx.beginPath();
    ctx.ellipse(W * 0.62, H * 0.58, W * 0.12, H * 0.16, -0.08, 0, Math.PI * 2);
    ctx.fill();
    // 앞꿈치(볼)
    ctx.beginPath();
    ctx.ellipse(W * 0.50, H * 0.36, W * 0.27, H * 0.12, -0.18, 0, Math.PI * 2);
    ctx.fill();
    // 발가락 5개 (엄지 = 안쪽 = 화면 왼쪽)
    const toes = [
      [0.30, 0.165, 0.095, 0.070],
      [0.47, 0.150, 0.060, 0.050],
      [0.59, 0.165, 0.053, 0.044],
      [0.69, 0.190, 0.047, 0.040],
      [0.77, 0.225, 0.040, 0.034],
    ];
    for (const [x, y, rx, ry] of toes) {
      ctx.beginPath();
      ctx.ellipse(W * x, H * y, W * rx, H * ry, -0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  // 번지는 빛
  g.filter = 'blur(18px)';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  shape(g);
  g.filter = 'blur(6px)';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  shape(g);
  // 또렷한 중심
  g.filter = 'blur(1.5px)';
  g.fillStyle = 'rgba(255,255,255,1)';
  g.save();
  g.translate(W * 0.5, H * 0.5);
  g.scale(0.9, 0.95);
  g.translate(-W * 0.5, -H * 0.5);
  shape(g);
  g.restore();
  g.filter = 'none';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createFootprints() {
  const geo = new THREE.PlaneGeometry(0.105, 0.21);
  geo.rotateX(-Math.PI / 2); // 바닥에 눕힘, 텍스처 윗부분(발가락) → -Z(진행 방향)

  const aColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  const aBirth = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY).fill(-1000), 1);
  const aKind = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  aColor.setUsage(THREE.DynamicDrawUsage);
  aBirth.setUsage(THREE.DynamicDrawUsage);
  aKind.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aColor', aColor);
  geo.setAttribute('aBirth', aBirth);
  geo.setAttribute('aKind', aKind);

  const uniforms = {
    uTex: { value: makeFootTexture() },
    uTime: { value: 0 },
    uReveal: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aBirth;
      attribute float aKind;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vBirth;
      varying float vKind;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vColor = aColor;
        vBirth = aBirth;
        vKind = aKind;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform float uTime;
      uniform float uReveal;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vBirth;
      varying float vKind;
      varying vec3 vWorld;
      void main() {
        float a = texture2D(uTex, vUv).r;
        float age = uTime - vBirth;
        if (age < 0.0) discard;
        float k;
        if (vKind < 0.5) {
          // 실제 발자국: 착지 순간 밝게 → 은은하게 남음 → 오래된 것은 희미하게
          float appear = smoothstep(0.0, 0.12, age);
          float flash = 1.0 + 0.9 * exp(-age * 3.0);
          // 오래된 발자국은 자연스럽게 사라져 화면이 복잡해지지 않음
          float settle = mix(0.85, 0.0, smoothstep(8.0, 18.0, age));
          // 엔딩: 최근에 함께 걸어온 구간만 다시 은은하게 떠오름
          float recentPath = 1.0 - smoothstep(14.0, 24.0, age);
          k = appear * flash * max(settle, uReveal * 0.7 * recentPath);
        } else {
          // 엔딩 이후 멀리 이어지는 발자국 길
          k = smoothstep(0.0, 1.2, age) * 0.5;
        }
        float far = length(vWorld.xz - cameraPosition.xz);
        k *= 1.0 - smoothstep(5.0, 16.0, far);
        gl_FragColor = vec4(vColor * a * k, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.count = 0;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let next = 0;

  function add(x, z, yaw, isLeftFoot, color, time, kind = 0) {
    const i = next;
    next = (next + 1) % CAPACITY;
    mesh.count = Math.max(mesh.count, i + 1);
    q.setFromAxisAngle(up, yaw);
    s.set(isLeftFoot ? -1 : 1, 1, 1);
    pos.set(x, 0.0015 + (i % 7) * 0.00005, z);
    m.compose(pos, q, s);
    mesh.setMatrixAt(i, m);
    aColor.setXYZ(i, color.r, color.g, color.b);
    aBirth.setX(i, time);
    aKind.setX(i, kind);
    mesh.instanceMatrix.needsUpdate = true;
    aColor.needsUpdate = true;
    aBirth.needsUpdate = true;
    aKind.needsUpdate = true;
  }

  function clear() {
    aBirth.array.fill(-1000);
    aBirth.needsUpdate = true;
    mesh.count = 0;
    next = 0;
  }

  return { mesh, uniforms, add, clear };
}
