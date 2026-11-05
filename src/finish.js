// Surface finish for the parts, applied to the GLB's materials in the browser.

// three cannot show transmissive parts through glass, so the look of pearl and resin is written
// into the shader: a thin-film sheen that shifts with angle, a glow that fills the shadow side the
// way light does inside a bead, and tight studio highlights.
function jewel(m, { film, freq, holo, glow, spark }) {
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 V = normalize(vViewPosition);
        vec3 N = normal;
        float ndv = saturate(dot(N, V));
        float rim = pow(1.0 - ndv, 2.0);
        // holographic pieces change colour across their surface, pearls only with angle
        float phase = ndv * ${freq.toFixed(2)} + dot(vViewPosition, vec3(310.0, 470.0, 260.0)) * ${holo.toFixed(2)};
        vec3 sheen = 0.5 + 0.5 * cos(6.2832 * (phase + vec3(0.0, 0.33, 0.67)));
        sheen = mix(vec3(1.0), sheen, 0.8);
        float lift = 0.45 + 0.55 * saturate(0.5 + 0.5 * N.y);
        vec3 glow = diffuseColor.rgb * lift * (${glow.toFixed(2)} + rim * 0.5);
        vec3 film = sheen * ${film.toFixed(2)} * (0.3 + 0.7 * rim) * mix(diffuseColor.rgb, vec3(1.0), 0.6);
        vec3 H1 = normalize(normalize(vec3(-0.45, 0.8, 0.55)) + V);
        vec3 H2 = normalize(normalize(vec3(0.6, 0.55, 0.6)) + V);
        float s1 = saturate(dot(N, H1)); float s2 = saturate(dot(N, H2));
        float hot = pow(s1, 220.0) * 3.2 + pow(s2, 320.0) * 2.4 + (pow(s1, 26.0) + pow(s2, 34.0) * 0.7) * 0.26;
        totalEmissiveRadiance += glow + film + vec3(hot) * ${spark.toFixed(2)};
      }`);
  };
  m.needsUpdate = true;
}

const LOOK = {
  MAT_PART_STAR: { color: '#fff0cf', metalness: 0.32, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, env: 1.3, fx: { film: 0.42, freq: 1.3, holo: 0, glow: 0.1, spark: 1.2 } },
  MAT_PART_HEART: { color: '#ffb4cd', metalness: 0.28, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03, env: 1.3, fx: { film: 0.3, freq: 1.1, holo: 0, glow: 0.14, spark: 1.2 } },
  MAT_PART_RIBBON: { metalness: 0.12, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.03, env: 1.4, fx: { film: 0.5, freq: 1.5, holo: 0, glow: 0.42, spark: 1.1 } },
  MAT_PART_PEARL: { color: '#fff5ea', metalness: 0.3, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04, env: 1.3, fx: { film: 0.62, freq: 1.6, holo: 0, glow: 0.3, spark: 1.1 } },
  MAT_PART_SEQUIN: { color: '#dcdcfa', metalness: 0.75, roughness: 0.16, env: 1.7, fx: { film: 0.8, freq: 1.2, holo: 0.5, glow: 0.2, spark: 1.2 } },
  MAT_PART_AURORA: { color: '#ece6fb', metalness: 0.35, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, env: 1.5, fx: { film: 0.85, freq: 1.4, holo: 0.28, glow: 0.3, spark: 1.1 } },
  MAT_PART_GLITTER: { color: '#fdf6fb', metalness: 0.75, roughness: 0.16, env: 2, fx: { film: 1, freq: 1.2, holo: 1.5, glow: 0.15, spark: 1.6 } },
};

export function refine({ root, studio }) {
  const seen = new Set();
  root.traverse((o) => {
    const m = o.material;
    if (!o.isMesh || !m || seen.has(m) || !LOOK[m.name]) return;
    seen.add(m);
    const { color, env, fx, ...rest } = LOOK[m.name];
    if (color) m.color.set(color);
    Object.assign(m, rest);
    m.envMap = studio;
    m.envMapIntensity = env;
    jewel(m, fx);
  });
}
