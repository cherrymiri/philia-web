import * as THREE from 'three';

/**
 * 우윳빛 반투명 유리 + 얇게 빛나는 외곽선.
 * Blender(Cycles)의 Layer Weight(Facing) 발광 노드는 glTF 로 내보내지지 않으므로
 * MeshStandardMaterial 에 Fresnel 외곽선 발광과 시야각에 따른 불투명도를 주입해 재현합니다.
 *
 * uniforms.uTintA / uTintB : 사람 색 (밴드는 A→B 그라디언트, 신발은 A=B)
 * uniforms.uMix            : 0 = 우윳빛 화이트, 1 = 완성 색
 */
export const MILKY = new THREE.Color('#f6f1e8');

export function createGlass({ envMap, opacity = 0.09, rimStrength = 2.0, rimPower = 2.6, gradient = false, reflection = false } = {}) {
  const uniforms = {
    uTintA: { value: new THREE.Color('#ffffff') },
    uTintB: { value: new THREE.Color('#ffffff') },
    uMix: { value: 0 },
    uRimStrength: { value: rimStrength },
    uRimPower: { value: rimPower },
    uGlow: { value: 0 },
    uGradMin: { value: -0.042 },
    uGradMax: { value: 0.042 },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: MILKY,
    roughness: 0.12,
    metalness: 0.0,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMap,
    envMapIntensity: reflection ? 0.2 : 0.6,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (gradient) shader.defines = { ...(shader.defines || {}), GLASS_GRADIENT: '' };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        #ifdef GLASS_GRADIENT
          attribute float aRestX;
          varying float vRestX;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef GLASS_GRADIENT
          vRestX = aRestX;
        #endif`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uTintA;
        uniform vec3 uTintB;
        uniform float uMix;
        uniform float uRimStrength;
        uniform float uRimPower;
        uniform float uGlow;
        uniform float uGradMin;
        uniform float uGradMax;
        #ifdef GLASS_GRADIENT
          varying float vRestX;
        #endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef GLASS_GRADIENT
          float gT = smoothstep(uGradMin, uGradMax, vRestX);
        #else
          float gT = 0.0;
        #endif
        vec3 personTint = mix(uTintA, uTintB, gT);
        diffuseColor.rgb = mix(diffuseColor.rgb, personTint, uMix);`)
      .replace('#include <opaque_fragment>', `
        // --- 얇은 유리 외곽선: 표면이 시선과 평행해지는 곳만 빛남 ---
        vec3 vDir = normalize(vViewPosition);
        float facing = abs(dot(normalize(normal), vDir));
        float rim = pow(1.0 - facing, uRimPower);
        vec3 rimCol = mix(vec3(1.0, 0.95, 0.88), personTint * vec3(1.0, 0.97, 0.94), 0.35 + 0.55 * uMix);
        outgoingLight += rimCol * rim * uRimStrength;
        // 색이 차오를수록 안에서 은은하게 빛남
        outgoingLight += personTint * (0.02 + 0.09 * uMix + uGlow) * (0.4 + 0.6 * (1.0 - facing));
        diffuseColor.a = clamp(diffuseColor.a + rim * 0.7, 0.0, 1.0);
        #include <opaque_fragment>`);
  };
  // 같은 셰이더 프로그램을 공유하도록 (그라디언트 여부만 구분)
  mat.customProgramCacheKey = () => `philia-glass-${gradient ? 'g' : 's'}`;
  mat.userData.uniforms = uniforms;
  mat.userData.reflection = reflection;
  return mat;
}
