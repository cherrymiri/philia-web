import * as THREE from 'three';

// Surface finish for the parts, applied to the GLB's materials in the browser.

// One step of smooth subdivision: edge midpoints are pulled onto the curved surface the normals
// describe, so low-poly cup parts lose their facets without any new modelling.
export function subdivide(source) {
  const pos = source.attributes.position;
  const nor = source.attributes.normal;
  const index = source.index.array;
  const P = Array.from(pos.array);
  const N = Array.from(nor.array);
  const edges = new Map();
  const a = new THREE.Vector3(); const b = new THREE.Vector3();
  const na = new THREE.Vector3(); const nb = new THREE.Vector3();
  const m = new THREE.Vector3(); const pa = new THREE.Vector3(); const pb = new THREE.Vector3();
  const mid = (i, j) => {
    const k = i < j ? `${i}_${j}` : `${j}_${i}`;
    if (edges.has(k)) return edges.get(k);
    a.fromArray(P, i * 3); b.fromArray(P, j * 3);
    na.fromArray(N, i * 3); nb.fromArray(N, j * 3);
    m.addVectors(a, b).multiplyScalar(0.5);
    pa.copy(m).addScaledVector(na, -m.clone().sub(a).dot(na));
    pb.copy(m).addScaledVector(nb, -m.clone().sub(b).dot(nb));
    const q = m.clone().multiplyScalar(0.25).add(pa.add(pb).multiplyScalar(0.375));
    const n = na.clone().add(nb).normalize();
    const id = P.length / 3;
    P.push(q.x, q.y, q.z); N.push(n.x, n.y, n.z);
    edges.set(k, id);
    return id;
  };
  const out = [];
  for (let t = 0; t < index.length; t += 3) {
    const [i, j, k] = [index[t], index[t + 1], index[t + 2]];
    const [ij, jk, ki] = [mid(i, j), mid(j, k), mid(k, i)];
    out.push(i, ij, ki, ij, j, jk, ki, jk, k, ij, jk, ki);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(out);
  return g;
}

// Parts have to stay opaque for three to show them through glass, so translucency is suggested:
// edges pick up their own colour, the way light gathers at the rim of a resin bead.
function resin(m, edge) {
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float fr = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.1);
        totalEmissiveRadiance += diffuseColor.rgb * (fr * ${edge.toFixed(2)} + 0.1); }`);
  };
  m.needsUpdate = true;
}

const LOOK = {
  MAT_PART_STAR: { color: '#f9e6b4', roughness: 0.17, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.4, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 320], edge: 0.8, env: 1.5 },
  MAT_PART_HEART: { color: '#fbaec6', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 0.25, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 300], edge: 0.9, env: 1.5 },
  MAT_PART_RIBBON: { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.55, iridescenceIOR: 1.35, iridescenceThicknessRange: [200, 420], edge: 1.0, env: 1.6 },
  MAT_PART_PEARL: { color: '#f7f0e4', roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.14, sheen: 1, sheenRoughness: 0.4, sheenColor: '#ffe8f2', iridescence: 0.8, iridescenceIOR: 1.45, iridescenceThicknessRange: [180, 420], edge: 0.35, env: 1.5 },
  MAT_PART_SEQUIN: { color: '#e9ecf8', metalness: 0.72, roughness: 0.2, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [240, 620], edge: 0.3, env: 2 },
  MAT_PART_AURORA: { color: '#f1e9fb', metalness: 0.28, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 1, iridescenceIOR: 1.5, iridescenceThicknessRange: [220, 560], edge: 0.9, env: 1.8 },
  MAT_PART_GLITTER: { color: '#f4f4fa', metalness: 0.9, roughness: 0.14, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [240, 560], edge: 0.2, env: 2.4 },
};

export function refine({ root, studio, subdivideFills }) {
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
    m.envMapIntensity = env;
    resin(m, edge);
  });
  if (!subdivideFills) return;
  for (const [fill, also] of [['STAR', 1], ['HEART', 1], ['PEARL', 1], ['RIBBON', 1]]) {
    const o = root.getObjectByName(`FILL_${fill}_DISPLAY`);
    if (o?.isInstancedMesh && also) o.geometry = subdivide(o.geometry);
  }
}
