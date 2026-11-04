import * as THREE from 'three';

// Same look as the approved philia-webtest2 build. Only depthWrite is new: pigment
// blobs sit inside the gel and would otherwise fail the depth test.
const GEL_BODY = { center: 0.018, rim: 0.2, power: 2.6, floorFade: 0.12 }; // neutral grey, no hue

export function applyGel(slime) {
  const gel = slime.material;
  gel.thickness = 0.0015;
  gel.attenuationDistance = Infinity;
  gel.emissive.setScalar(0);
  gel.color.setScalar(1);
  gel.roughness = 0.14;
  gel.specularIntensity = 0.55;
  gel.depthWrite = false;
  slime.geometry = slime.geometry.clone(); // working copy, the loaded source stays as it is

  const body = new THREE.Mesh(slime.geometry, new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      center: { value: GEL_BODY.center }, rim: { value: GEL_BODY.rim },
      power: { value: GEL_BODY.power }, floorFade: { value: GEL_BODY.floorFade },
    },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vDown;
      void main(){ vDown = smoothstep(0.35, 0.9, -normal.y); vec4 p = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform float center; uniform float rim; uniform float power; uniform float floorFade; varying vec3 vN; varying vec3 vV; varying float vDown;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), power);
        gl_FragColor = vec4(vec3(mix(center, rim, f) * mix(1.0, floorFade, vDown)), 1.0); }`,
  }));
  body.name = 'GEL_BODY';
  slime.add(body);
}

// Height field of the gel, slime-local. Lets parts land on the real surface and rest inside it.
export function buildVolume(geometry) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const cell = 0.0035;
  const half = 0.062;
  const n = Math.ceil((half * 2) / cell);
  const top = new Float32Array(n * n).fill(NaN);
  const bot = new Float32Array(n * n).fill(NaN);
  const bins = 72;
  const rim = new Float32Array(bins);
  const idx = (x, z) => {
    const i = Math.floor((x + half) / cell);
    const j = Math.floor((z + half) / cell);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };
  const bin = (x, z) => Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * bins) % bins;
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v);
    const y = pos.getY(v);
    const z = pos.getZ(v);
    const k = idx(x, z);
    if (k < 0) continue;
    const b = bin(x, z);
    rim[b] = Math.max(rim[b], Math.hypot(x, z));
    const field = nor.getY(v) > 0 ? top : bot;
    field[k] = Number.isNaN(field[k]) ? y : field === top ? Math.max(field[k], y) : Math.min(field[k], y);
  }
  // Vertices are sparse in places: fill gaps from neighbours, separately for each surface.
  const fill = (f) => {
    for (let pass = 0; pass < 24; pass++) {
      const src = f.slice();
      for (let j = 1; j < n - 1; j++) {
        for (let i = 1; i < n - 1; i++) {
          const k = j * n + i;
          if (!Number.isNaN(src[k])) continue;
          const nb = [k - 1, k + 1, k - n, k + n].map((m) => src[m]).filter((h) => !Number.isNaN(h));
          if (nb.length) f[k] = nb.reduce((a, b) => a + b, 0) / nb.length;
        }
      }
    }
  };
  fill(top);
  fill(bot);
  const at = (x, z) => {
    const k = idx(x, z);
    if (k < 0 || Math.hypot(x, z) >= rim[bin(x, z)]) return null;
    return Number.isNaN(top[k]) || Number.isNaN(bot[k]) ? null : { top: top[k], bottom: bot[k] };
  };
  const gap = (x, z) => {
    const c = at(x, z);
    return c ? c.top - c.bottom : 0;
  };
  // Inside only if the footprint around the point also has gel.
  const fits = (x, z, r) => {
    const m = r + 0.003;
    return [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].every(([a, b]) => gap(x + a, z + b) > 2 * r + 0.0018);
  };
  const rimAt = (x, z) => rim[bin(x, z)] || 0.05;
  return { at, fits, rim: rimAt };
}
