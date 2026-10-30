import * as THREE from 'three';

export const MAX_RIPPLES = 16;

/**
 * 어두운 유리/잔잔한 수면 바닥.
 * - 버터 옐로우·피치의 노을빛이 은은하게 번지는 표면 (강한 거울 반사 없음)
 * - 바닥 아래의 반사 신발이 살짝 비쳐 보이도록 반투명
 * - 착지 위치에서 퍼지는 빛의 물결(셰이더, 오브젝트 생성 없음)
 */
export function createFloor() {
  const ripples = [];
  for (let i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector4(0, 0, -1000, 0));
  const rippleColors = [];
  for (let i = 0; i < MAX_RIPPLES; i++) rippleColors.push(new THREE.Color(1, 1, 1));

  const uniforms = {
    uTime: { value: 0 },
    uRip: { value: ripples },
    uRipCol: { value: rippleColors },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uWarmL: { value: new THREE.Color('#ffd27a') },
    uWarmR: { value: new THREE.Color('#ffa88c') },
    uSync: { value: 0 },
    uReveal: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      #define MAX_RIPPLES ${MAX_RIPPLES}
      uniform float uTime;
      uniform vec4 uRip[MAX_RIPPLES];
      uniform vec3 uRipCol[MAX_RIPPLES];
      uniform vec2 uCenter;
      uniform vec3 uWarmL;
      uniform vec3 uWarmR;
      uniform float uSync;
      uniform float uReveal;
      varying vec3 vWorld;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }

      void main() {
        vec2 p = vWorld.xz;
        vec3 V = normalize(cameraPosition - vWorld);
        float grazing = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);

        // 노을빛 웜톤: 왼쪽 사람 쪽은 옐로우, 오른쪽은 피치
        vec2 d0 = p - uCenter;
        float side = smoothstep(-0.35, 0.35, d0.x);
        vec3 warm = mix(uWarmL, uWarmR, side);

        // 아주 잔잔한 수면 결
        float n = noise(p * 3.2 + vec2(uTime * 0.05, -uTime * 0.035)) * 0.6 + noise(p * 9.0 - uTime * 0.06) * 0.4;

        vec3 col = vec3(0.0025, 0.002, 0.0024);
        float pool = exp(-dot(d0 * vec2(1.0, 0.55), d0 * vec2(1.0, 0.55)) / 0.55);
        col += warm * pool * (0.008 + 0.014 * uSync) * (0.75 + 0.5 * n);
        col += warm * grazing * (0.003 + 0.005 * uSync) * (0.6 + 0.8 * n);
        col += warm * uReveal * 0.018 * exp(-abs(d0.x) * 1.6);

        // 물결
        float press = 0.0;
        for (int i = 0; i < MAX_RIPPLES; i++) {
          vec4 r = uRip[i];
          float age = uTime - r.z;
          if (age < 0.0 || age > 2.8) continue;
          float dist = length(p - r.xy);
          float big = step(1.5, r.w);                 // 두 발이 함께 닿을 때의 큰 파동
          float speed = mix(0.30, 0.42, big);
          float rad = age * speed;
          float width = 0.010 + age * 0.012;
          float life = pow(1.0 - age / 2.8, 2.2);
          float ring = exp(-pow((dist - rad) / width, 2.0));
          float ring2 = exp(-pow((dist - rad * 0.6) / (width * 0.8), 2.0)) * 0.35;
          float glow = exp(-dist * dist / 0.0025) * exp(-age * 6.0);   // 착지 순간의 빛
          float amt = (ring + ring2) * life * min(r.w, 2.0) * 0.15 + glow * min(r.w, 1.2) * 0.3;
          col += uRipCol[i] * amt;
          press += exp(-dist * dist / 0.006) * exp(-age * 7.0) * min(r.w, 1.0);
        }
        col *= 1.0 - press * 0.35;   // 표면이 아주 살짝 눌리는 듯한 반응

        // 멀어질수록 검정으로
        float far = length(vWorld.xz - cameraPosition.xz);
        float fade = 1.0 - smoothstep(4.0, 14.0, far);
        col *= fade;

        // 반투명: 바닥 아래 반사된 신발이 희미하게 비침
        float alpha = mix(0.78, 0.9, grazing);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;

  let next = 0;
  function addRipple(x, z, time, strength, color) {
    const i = next;
    next = (next + 1) % MAX_RIPPLES;
    ripples[i].set(x, z, time, strength);
    rippleColors[i].copy(color);
  }
  function clearRipples() {
    for (const r of ripples) r.set(0, 0, -1000, 0);
    next = 0;
  }

  return { mesh, uniforms, addRipple, clearRipples };
}
