import * as THREE from 'three';
import { makeFootTexture } from './footprints.js';
import { APPROACH } from './rhythm.js';

/**
 * 다가오는 리듬 노트(맨발 자국) + 미니멀한 판정선.
 * - 왼쪽 레인 = 왼발 버튼(왼발 자국, 버터빛), 오른쪽 레인 = 오른발 버튼(오른발 자국, 피치빛)
 * - 노트는 신발 앞쪽 영역에서만 움직이고, 판정 후 사라짐 → 실제 걸어온 발자국(신발 뒤쪽)과 겹치지 않음
 */
export const LANE_X = [-0.125, 0.125];
export const TRAVEL = 1.55;                // 노트가 이동하는 거리 (m)
const SPEED = TRAVEL / APPROACH;
const CAP = 24;
const TILT = 0.85;                         // 노트를 세우는 각도 (rad)
const X_AXIS = new THREE.Vector3(1, 0, 0);
const COL = [new THREE.Color('#ffe2a0'), new THREE.Color('#ffc0aa')];

export function createNotes() {
  const geo = new THREE.PlaneGeometry(0.12, 0.24);
  geo.rotateX(-Math.PI / 2);
  const aColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
  aColor.setUsage(THREE.DynamicDrawUsage);
  aAlpha.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aColor', aColor);
  geo.setAttribute('aAlpha', aAlpha);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: makeFootTexture() } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
      void main() {
        vUv = uv; vColor = aColor; vAlpha = aAlpha;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
      void main() {
        float a = texture2D(uTex, vUv).r;
        gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.count = 0;

  // ---- 판정선: 바닥 위의 얇은 빛의 선 + 레인마다 은은한 원형 영역 ----
  const lineUniforms = {
    uPulse: { value: new THREE.Vector2(0, 0) },     // 레인별 반짝임 (판정 시)
    uCue: { value: new THREE.Vector2(0, 0) },       // 레인별 '지금 누를 곳' 강조
    uFade: { value: 1 },
    uTime: { value: 0 },
  };
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.22).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: lineUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uPulse; uniform vec2 uCue; uniform float uFade; uniform float uTime;
        varying vec2 vP;
        void main(){
          vec3 warm = vec3(1.0, 0.86, 0.66);
          float edge = 1.0 - smoothstep(0.22, 0.31, abs(vP.x));
          float line = exp(-pow(vP.y / 0.0032, 2.0)) * 0.55 * edge;
          vec3 col = warm * line;
          for (int i = 0; i < 2; i++) {
            float lx = i == 0 ? ${LANE_X[0].toFixed(3)} : ${LANE_X[1].toFixed(3)};
            vec3 lc = i == 0 ? vec3(1.0, 0.86, 0.55) : vec3(1.0, 0.72, 0.62);
            float d = length((vP - vec2(lx, 0.0)) * vec2(1.0, 0.75));
            float ring = exp(-pow((d - 0.052) / 0.005, 2.0)) * 0.28;
            float cue = i == 0 ? uCue.x : uCue.y;
            float pulse = i == 0 ? uPulse.x : uPulse.y;
            ring *= 1.0 + cue * (1.2 + 0.6 * sin(uTime * 7.0));
            float flash = exp(-d * d / 0.0035) * pulse * 0.9 + exp(-pow((d - 0.052 - (1.0 - pulse) * 0.06) / 0.008, 2.0)) * pulse * 0.6;
            col += lc * (ring + flash);
          }
          gl_FragColor = vec4(col * uFade, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  line.position.y = 0.0025;
  line.renderOrder = 3;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();

  /** 노트 배치. lineZ = 판정선의 월드 z, gameT = 리듬 게임 시각 */
  function update(rhythm, lineZ, fade, now) {
    line.position.z = lineZ;
    lineUniforms.uFade.value = fade;
    lineUniforms.uTime.value = now;
    lineUniforms.uPulse.value.multiplyScalar(0.9);
    let i = 0;
    for (const n of rhythm.notes) {
      if (i >= CAP) break;
      const dt = n.t - rhythm.gameT;                 // 판정선 도착까지 남은 시간
      if (dt > APPROACH + 0.05) continue;
      let alpha;
      if (n.judged) {
        if (n.grade === 'miss' || n.grade === 'skip') {
          // 놓친 노트: 판정선을 조금 지나며 희미하게 사라짐
          const past = rhythm.gameT - n.t;
          alpha = (n.grade === 'skip' ? 0 : 0.5) * (1 - clamp01(past / 0.45));
          if (alpha <= 0.01) continue;
        } else continue;                              // 성공한 노트는 즉시 사라지고 판정선에서 빛남
      } else {
        // 멀리서 서서히 나타나고, 판정선에 가까울수록 또렷하게
        const far = clamp01(dt / APPROACH);
        alpha = (1 - smooth(0.8, 1.0, far)) * (0.95 + 0.55 * (1 - far));
        if (dt < 0) alpha *= 1 - clamp01(-dt / 0.3);
      }
      const z = lineZ - Math.max(dt, -0.25) * SPEED;
      // 바닥에 누운 채로는 멀리서 거의 보이지 않으므로 관람객 쪽으로 비스듬히 세움
      p.set(LANE_X[n.lane], 0.004 + 0.1 * Math.sin(TILT) * 0.5, z);
      q.setFromAxisAngle(X_AXIS, TILT);
      s.set(n.lane === 0 ? -1 : 1, 1, 1);           // 왼쪽 레인 = 왼발 모양
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
      const c = COL[n.lane];
      aColor.setXYZ(i, c.r, c.g, c.b);
      aAlpha.setX(i, alpha * fade);
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    aColor.needsUpdate = true;
    aAlpha.needsUpdate = true;
  }

  function pulse(lane, amount = 1) {
    if (lane === 0) lineUniforms.uPulse.value.x = amount; else lineUniforms.uPulse.value.y = amount;
  }
  function cue(lane, amount) {
    lineUniforms.uCue.value.set(lane === 0 ? amount : 0, lane === 1 ? amount : 0);
  }

  return { mesh, line, update, pulse, cue };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
