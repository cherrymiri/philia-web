// Surface finish for the parts, applied to the GLB's materials in the browser.

// Parts have to stay opaque for three to show them through glass, so translucency is suggested:
// edges pick up their own colour, the way light gathers at the rim of a resin bead.
function resin(m, edge) {
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float fr = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.1);
        totalEmissiveRadiance += diffuseColor.rgb * (fr * ${edge.toFixed(2)} + 0.04); }`);
  };
  m.needsUpdate = true;
}

const LOOK = {
  MAT_PART_STAR: { color: '#f9e6b4', roughness: 0.17, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.4, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 320], edge: 0.35, env: 1.5 },
  MAT_PART_HEART: { color: '#fbaec6', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 0.25, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 300], edge: 0.4, env: 1.5 },
  MAT_PART_RIBBON: { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.55, iridescenceIOR: 1.35, iridescenceThicknessRange: [200, 420], edge: 0.6, env: 1.6 },
  MAT_PART_PEARL: { color: '#f7f0e4', roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.14, sheen: 1, sheenRoughness: 0.4, sheenColor: '#ffe8f2', iridescence: 0.8, iridescenceIOR: 1.45, iridescenceThicknessRange: [180, 420], edge: 0.18, env: 1.5 },
  MAT_PART_SEQUIN: { color: '#e9ecf8', metalness: 0.72, roughness: 0.2, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [240, 620], edge: 0.3, env: 2 },
  MAT_PART_AURORA: { color: '#f1e9fb', metalness: 0.28, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 1, iridescenceIOR: 1.5, iridescenceThicknessRange: [220, 560], edge: 0.9, env: 1.8 },
  MAT_PART_GLITTER: { color: '#fdf6fb', metalness: 0.75, roughness: 0.18, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [240, 560], edge: 0.2, env: 2.4 },
};

export function refine({ root, studio }) {
  const seen = new Set();
  root.traverse((o) => {
    const m = o.material;
    if (!o.isMesh || !m || seen.has(m) || !LOOK[m.name]) return;
    seen.add(m);
    const { color, sheenColor, edge, env, ...rest } = LOOK[m.name];
    if (color) m.color.set(color);
    if (sheenColor) m.sheenColor.set(sheenColor);
    Object.assign(m, rest);
    m.envMap = studio;
    m.envMapIntensity = env * (m.metalness > 0.5 ? 0.9 : 0.75);
    resin(m, edge);
  });
}
