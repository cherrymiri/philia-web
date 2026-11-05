import * as THREE from 'three';
import { tint, GEL_REST } from '../gel.js';

// Pigment field: one texture over the gel, R/G/B = how much peach/mint/lavender is at each spot.
// Only user gestures and drops change it, so every result depends on what the visitor did.
export const SPAN = 0.124;              // metres covered by the texture
const SAVE_SIZE = 160;
const SAVE_SCALE = 6;
const CHANNEL = { PEACH: 0, MINT: 1, LAVENDER: 2 };

const quadVS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const stepFS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D map;
uniform float span, px, seed, diffuse;
uniform vec2 pressAt; uniform float pressAmt, petals;
uniform vec2 smearAt, smearBy; uniform float smearSize, combAmt;
uniform float curl;
uniform vec2 curlAt;
uniform int swirlCount; uniform vec3 swirl[6];
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ return noise(p) + 0.5*noise(p*2.1) + 0.25*noise(p*4.3); }
vec2 curlNoise(vec2 p){ float e = 0.35; float a = fbm(p+vec2(0,e)), b = fbm(p-vec2(0,e)), c = fbm(p+vec2(e,0)), d = fbm(p-vec2(e,0));
  return vec2(a-b, -(c-d)) / (2.0*e); }
void main(){
  vec2 w = (vUv - 0.5) * span;
  vec2 v = vec2(0.0);
  if (pressAmt != 0.0) { vec2 d = w - pressAt; float r = length(d) + 1e-5; float R = 0.02;
    float petal = 1.0 + 0.75*sin(atan(d.y, d.x)*petals + seed) + 0.4*sin(r*420.0 + seed);
    v += d / r * pressAmt * petal * exp(-r*r/(R*R)) * smoothstep(0.0, 0.006, r); }
  if (smearSize > 0.0) { vec2 d = w - smearAt; float g = exp(-dot(d,d)/(smearSize*smearSize));
    // pulling tines through the colour: speed varies across the stroke, so colour draws out in threads
    vec2 side = vec2(-smearBy.y, smearBy.x) / (length(smearBy) + 1e-7); float across = dot(w, side);
    float teeth = 1.0 + combAmt*(0.6*sin(across*260.0 + seed) + 0.4*sin(across*610.0 + seed*1.7));
    v += smearBy * g * teeth; }
  if (curl != 0.0) { vec2 d = w - curlAt; v += curlNoise(w*62.0 + seed) * curl * exp(-dot(d,d)/(0.03*0.03)); }
  for (int i = 0; i < swirlCount; i++) { vec2 d = w - swirl[i].xy; v += vec2(-d.y, d.x) * swirl[i].z * exp(-dot(d,d)/(0.007*0.007)); }
  float keep = 1.0 - smoothstep(0.034, 0.046, length(w));
  v *= keep;
  vec2 uv = vUv - v / span;
  vec4 c = texture2D(map, uv);
  if (diffuse > 0.0) {
    vec4 n = texture2D(map, uv+vec2(px,0.)) + texture2D(map, uv-vec2(px,0.)) + texture2D(map, uv+vec2(0.,px)) + texture2D(map, uv-vec2(0.,px));
    c = mix(c, n*0.25, diffuse);
  }
  gl_FragColor = min(c, vec4(7.0));
}`;
const splatFS = `
precision highp float;
varying vec2 vUv; uniform sampler2D map; uniform float span; uniform vec2 at; uniform float radius; uniform vec3 amount;
void main(){ vec2 d = (vUv-0.5)*span - at; float g = exp(-dot(d,d)/(radius*radius));
  vec4 c = texture2D(map, vUv); c.rgb += amount*g; gl_FragColor = c; }`;

// Colours mix by their real amounts in OKLab, a perceptual space, so meeting pigments give a
// clean in-between tone. No colour is painted in for any pair. Thin areas stay see-through.
const sheetFS = `
precision highp float;
varying vec2 vUv; varying float vEdge; uniform sampler2D map, haze; uniform float px, layer, tintAmt; uniform vec3 tintColor;
const vec3 P = vec3(1.0, 0.159, 0.262), M = vec3(0.028, 0.672, 0.565), L = vec3(0.376, 0.153, 0.913);
vec3 toLab(vec3 c){
  vec3 l = vec3(0.4122*c.r+0.5363*c.g+0.0514*c.b, 0.2119*c.r+0.6807*c.g+0.1074*c.b, 0.0883*c.r+0.2817*c.g+0.6300*c.b);
  l = pow(l, vec3(1.0/3.0));
  return vec3(0.2105*l.x+0.7937*l.y-0.0041*l.z, 1.9780*l.x-2.4286*l.y+0.4506*l.z, 0.0259*l.x+0.7828*l.y-0.8087*l.z);
}
vec3 fromLab(vec3 c){
  vec3 l = vec3(c.x+0.3963*c.y+0.2158*c.z, c.x-0.1056*c.y-0.0639*c.z, c.x-0.0895*c.y-1.2915*c.z);
  l = l*l*l;
  return vec3(4.0767*l.x-3.3077*l.y+0.2310*l.z, -1.2684*l.x+2.6098*l.y-0.3413*l.z, -0.0042*l.x-0.7034*l.y+1.7076*l.z);
}
float amount(vec2 uv){ vec3 c = texture2D(map, uv).rgb; return c.r+c.g+c.b; }
vec3 pigmentColour(vec3 c, float sum){
  vec3 w = c/max(sum, 1e-4);
  vec3 lab = w.r*toLab(P) + w.g*toLab(M) + w.b*toLab(L);
  lab.yz *= mix(0.86, 1.1, smoothstep(0.1, 2.5, sum));
  lab.x += 0.06 * (1.0 - smoothstep(0.0, 1.5, sum));
  return clamp(fromLab(lab), 0.0, 1.0);
}
void main(){
  vec3 c = texture2D(map, vUv).rgb; float sum = c.r+c.g+c.b;
  vec3 h = texture2D(haze, vUv).rgb; float hs = h.r+h.g+h.b;
  // back to front: the gel's overall colour, soft clouds of soaked-in colour, then the threads
  vec3 col = tintColor; float a = tintAmt * 0.26;
  if (hs > 0.004) { float ca = (1.0 - exp(-hs*3.4)) * 0.5; col = mix(col, pigmentColour(h, hs), ca / max(ca + a*(1.0-ca), 1e-3)); a = ca + a*(1.0-ca); }
  if (sum > 0.012) {
    float la = (1.0 - exp(-sum*1.45)) * layer;
    vec3 lc = pigmentColour(c, sum);
    // liquid sheen from the density slope, so colour reads as fluid and not as paint
    vec2 g = vec2(amount(vUv+vec2(px,0.))-amount(vUv-vec2(px,0.)), amount(vUv+vec2(0.,px))-amount(vUv-vec2(0.,px)));
    vec3 n = normalize(vec3(-g.x*2.5, 1.0, -g.y*2.5));
    lc += pow(max(dot(n, normalize(vec3(0.25, 0.9, 0.35))), 0.0), 40.0) * 0.16 * smoothstep(0.1, 1.2, sum);
    col = mix(col, lc, la / max(la + a*(1.0-la), 1e-3)); a = la + a*(1.0-la);
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a * vEdge);
  #include <colorspace_fragment>
}`;
const sheetVS = `attribute float edge; varying vec2 vUv; varying float vEdge; uniform float span, lift;
void main(){ vEdge = edge; vUv = uv + vec2(0.0, lift*0.5); vec3 p = position; p.y += lift * edge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`;

export class PigmentEngine {
  constructor(renderer, parent, volume, size = 512) {
    this.renderer = renderer;
    this.volume = volume;
    const SIZE = size;
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
    this.a = new THREE.WebGLRenderTarget(SIZE, SIZE, opt);
    this.b = new THREE.WebGLRenderTarget(SIZE, SIZE, opt);
    this.cam = new THREE.Camera();
    this.quadScene = new THREE.Scene();
    this.stepMat = new THREE.ShaderMaterial({
      vertexShader: quadVS, fragmentShader: stepFS, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        map: { value: null }, span: { value: SPAN }, px: { value: 1 / SIZE }, seed: { value: 0 }, diffuse: { value: 0 },
        pressAt: { value: new THREE.Vector2() }, pressAmt: { value: 0 },
        smearAt: { value: new THREE.Vector2() }, smearBy: { value: new THREE.Vector2() }, smearSize: { value: 0 }, combAmt: { value: 0 }, petals: { value: 7 },
        curl: { value: 0 }, curlAt: { value: new THREE.Vector2() },
        swirlCount: { value: 0 }, swirl: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
              },
    });
    this.splatMat = new THREE.ShaderMaterial({
      vertexShader: quadVS, fragmentShader: splatFS, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { map: { value: null }, span: { value: SPAN }, at: { value: new THREE.Vector2() }, radius: { value: 0.006 }, amount: { value: new THREE.Vector3() } },
    });
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: quadVS, depthTest: false, depthWrite: false, toneMapped: false,
      fragmentShader: 'varying vec2 vUv; uniform sampler2D map; uniform vec3 scale; void main(){ gl_FragColor = vec4(texture2D(map, vUv).rgb*scale, 1.0); }',
      uniforms: { map: { value: null }, scale: { value: new THREE.Vector3(1, 1, 1) } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.stepMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.seed = Math.random() * 50;
    this.mapU = { value: this.a.texture };
    this.counts = { PEACH: 0, MINT: 0, LAVENDER: 0 };
    this.work = 0;
    const hazeOpt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.hazeA = new THREE.WebGLRenderTarget(72, 72, hazeOpt);
    this.hazeB = new THREE.WebGLRenderTarget(72, 72, hazeOpt);
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: quadVS, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { map: { value: null }, dir: { value: new THREE.Vector2() } },
      fragmentShader: `varying vec2 vUv; uniform sampler2D map; uniform vec2 dir;
        void main(){ vec4 c = vec4(0.0); float t = 0.0;
          for (int i = -6; i <= 6; i++) { float w = exp(-float(i*i)/14.0); c += texture2D(map, vUv + dir*float(i))*w; t += w; }
          gl_FragColor = c/t; }`,
    });
    this.mass = [0, 0, 0];
    this.clear();
    this.buildSheet(parent);
  }
  buildSheet(parent) {
    const rings = 64; const segs = 160;
    const pos = []; const uv = []; const edge = []; const idx = [];
    for (let j = 0; j <= rings; j++) {
      const u = j / rings;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const rim = this.volume.rim(Math.cos(a), Math.sin(a)) * 0.95;
        const x = Math.cos(a) * rim * u; const z = Math.sin(a) * rim * u;
        const s = this.volume.at(x, z);
        const y = s ? s.bottom + (s.top - s.bottom) * 0.46 : 0.004;
        pos.push(x, y, z);
        uv.push(x / SPAN + 0.5, z / SPAN + 0.5);
        edge.push(1 - THREE.MathUtils.smoothstep(u, 0.86, 1));
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * segs + i; const b = j * segs + (i + 1) % segs;
        idx.push(a, b + segs, b, a, a + segs, b + segs);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
    g.setIndex(idx);
    this.rest = Float32Array.from(pos);
    const layerMat = (layer, lift) => new THREE.ShaderMaterial({
      vertexShader: sheetVS, fragmentShader: sheetFS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { map: this.mapU, haze: { value: this.hazeA.texture }, span: { value: SPAN }, px: { value: 2 / this.a.width }, layer: { value: layer }, lift: { value: lift }, ...tint },
    });
    this.sheet = new THREE.Mesh(g, layerMat(0.8, 0));
    this.sheet.name = 'PIGMENT_SHEET';
    this.sheet.frustumCulled = false;
    this.sheet.renderOrder = 2;
    parent.add(this.sheet);
    // A second, fainter layer higher in the gel gives the colour depth.
    this.sheet2 = new THREE.Mesh(g, layerMat(0.4, 0.0065));
    this.sheet2.name = 'PIGMENT_SHEET_UPPER';
    this.sheet2.frustumCulled = false;
    this.sheet2.renderOrder = 3;
    parent.add(this.sheet2);
    // Top-down copy of the bent sheet, used to bake a fold into the field.
    this.bakeMesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      uniforms: { map: { value: null }, span: { value: SPAN } },
      vertexShader: 'varying vec2 vUv; uniform float span; void main(){ vUv = uv; gl_Position = vec4(position.x*2.0/span, position.z*2.0/span, 0.0, 1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform sampler2D map; void main(){ gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }',
    }));
    this.bakeMesh.frustumCulled = false;
    this.bakeScene = new THREE.Scene();
    this.bakeScene.add(this.bakeMesh);
  }
  // Whatever the sheet looks like from above right now becomes the field. The fold's own
  // geometry does the moving, so colour cannot end up anywhere the eye did not see it go.
  bakeSheet(fold) {
    const r = this.renderer;
    this.bendWith(fold);
    const prev = r.getRenderTarget();
    const tm = r.toneMapping;
    const clearC = r.getClearColor(new THREE.Color());
    const clearA = r.getClearAlpha();
    r.toneMapping = THREE.NoToneMapping;
    this.bakeMesh.material.uniforms.map.value = this.a.texture;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.b);
    r.clear();
    r.render(this.bakeScene, this.cam);
    r.setRenderTarget(prev);
    r.setClearColor(clearC, clearA);
    r.toneMapping = tm;
    this.swap();
  }
  draw(mat, target) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const tm = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    this.quad.material = mat;
    r.setRenderTarget(target);
    r.render(this.quadScene, this.cam);
    r.setRenderTarget(prev);
    r.toneMapping = tm;
  }
  swap() {
    [this.a, this.b] = [this.b, this.a];
    this.mapU.value = this.a.texture;
  }
  clear() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const c = r.getClearColor(new THREE.Color());
    const al = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const t of [this.a, this.b]) { r.setRenderTarget(t); r.clear(); }
    r.setRenderTarget(prev);
    r.setClearColor(c, al);
  }
  splat(x, z, type, amount = 2.6, radius = 0.0052) {
    const u = this.splatMat.uniforms;
    u.map.value = this.a.texture;
    u.at.value.set(x, z);
    u.radius.value = radius;
    const v = [0, 0, 0];
    v[CHANNEL[type]] = amount;
    u.amount.value.fromArray(v);
    this.draw(this.splatMat, this.b);
    this.swap();
  }
  // One advection step. `g` holds this frame's gesture, in metres per frame.
  advect(g) {
    const u = this.stepMat.uniforms;
    u.map.value = this.a.texture;
    u.seed.value = g.seed ?? this.seed;
    u.diffuse.value = g.diffuse || 0;
    u.pressAmt.value = g.press ? g.press.amount : 0;
    if (g.press) u.pressAt.value.set(g.press.x, g.press.z);
    u.smearSize.value = g.smear ? g.smear.size : 0;
    u.combAmt.value = g.smear?.comb || 0;
    u.petals.value = g.press?.petals || 7;
    if (g.smear) { u.smearAt.value.set(g.smear.x, g.smear.z); u.smearBy.value.set(g.smear.dx, g.smear.dz); }
    u.curl.value = g.curl ? g.curl.amount : 0;
    if (g.curl) u.curlAt.value.set(g.curl.x, g.curl.z);
    const sw = (g.swirls || []).slice(0, 6);
    u.swirlCount.value = sw.length;
    sw.forEach((s, i) => u.swirl.value[i].set(s.x, s.z, s.spin));
    this.draw(this.stepMat, this.b);
    this.swap();
  }
  bendWith(d) {
    const out = this.sheet.geometry.attributes.position;
    const { rest } = this;
    const p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < rest.length; i += 3) {
      p.x = rest[i]; p.y = rest[i + 1]; p.z = rest[i + 2];
      d.apply(p, true);
      out.array[i] = p.x; out.array[i + 1] = p.y; out.array[i + 2] = p.z;
    }
    out.needsUpdate = true;
  }
  // Colour soaking into the gel: a wide blur of the field, plus one tone for the whole body.
  updateHaze() {
    const u = this.blurMat.uniforms;
    const spread = 1 / 72 * (1.4 + Math.min(2.6, this.work * 0.35));
    u.map.value = this.a.texture; u.dir.value.set(spread, 0);
    this.draw(this.blurMat, this.hazeB);
    u.map.value = this.hazeB.texture; u.dir.value.set(0, spread);
    this.draw(this.blurMat, this.hazeA);
  }
  setCounts(counts) { this.counts = { PEACH: counts.PEACH || 0, MINT: counts.MINT || 0, LAVENDER: counts.LAVENDER || 0 }; this.refreshTint(); }
  setWork(work) { this.work = work; this.refreshTint(); }
  refreshTint() {
    const { PEACH: p, MINT: m, LAVENDER: l } = this.counts;
    const total = p + m + l;
    this.updateHaze();
    tint.tintAmt.value = total ? (1 - Math.exp(-total / 3.5)) * (0.34 + 0.66 * (1 - Math.exp(-this.work / 1.6))) : 0;
    if (!total) { tint.gel?.color.set(GEL_REST); return; }
    // light adds: three tones blend to a clear pastel and never to mud
    const c = new THREE.Color(0, 0, 0);
    const add = (hex, k) => { const t = new THREE.Color(hex); c.r += t.r * k; c.g += t.g * k; c.b += t.b * k; };
    add('#ff6f8c', p / total); add('#2fd6c6', m / total); add('#a56df5', l / total);
    const top = Math.max(c.r, c.g, c.b) || 1;
    tint.tintColor.value.setRGB(c.r / top, c.g / top, c.b / top);
    tint.gel?.color.set(GEL_REST).lerp(tint.tintColor.value, tint.tintAmt.value * 0.45);
  }
  // The sheet bends with the gel.
  bend(deform) {
    const out = this.sheet.geometry.attributes.position;
    const { rest } = this;
    const p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < rest.length; i += 3) {
      p.x = rest[i]; p.y = rest[i + 1]; p.z = rest[i + 2];
      deform.map(p, true);
      out.array[i] = p.x; out.array[i + 1] = p.y; out.array[i + 2] = p.z;
    }
    out.needsUpdate = true;
  }
  // Stretching thins the field numerically. Each colour keeps its total, so a drop never
  // fades away just because the gel was worked.
  conserve() {
    const now = this.stats().sum;
    const gain = [1, 1, 1];
    now.forEach((v, c) => {
      if (!this.mass[c]) { this.mass[c] = v; return; }
      gain[c] = v > 0 ? Math.min(1.6, Math.max(0.6, this.mass[c] / v)) : 1;
    });
    if (gain.some((g) => Math.abs(g - 1) > 0.01)) {
      this.copyMat.uniforms.map.value = this.a.texture;
      this.copyMat.uniforms.scale.value.fromArray(gain);
      this.draw(this.copyMat, this.b);
      this.copyMat.uniforms.scale.value.setScalar(1);
      this.swap();
    }
  }
  // Call after a drop lands so the new total becomes the reference.
  remeasure() { this.mass = this.stats().sum; }
  // Coverage per channel, used by tests and available for later result naming.
  measure() {
    const n = SAVE_SIZE;
    const t = this.saveTarget || (this.saveTarget = new THREE.WebGLRenderTarget(n, n, { type: THREE.UnsignedByteType, depthBuffer: false }));
    this.copyMat.uniforms.map.value = this.a.texture;
    this.copyMat.uniforms.scale.value.setScalar(1 / SAVE_SCALE);
    this.draw(this.copyMat, t);
    const px = new Uint8Array(n * n * 4);
    this.renderer.readRenderTargetPixels(t, 0, 0, n, n, px);
    return px;
  }
  stats() {
    const px = this.measure();
    const n = px.length / 4;
    const out = { sum: [0, 0, 0], area: [0, 0, 0], mixed: 0 };
    for (let i = 0; i < n; i++) {
      let on = 0;
      for (let c = 0; c < 3; c++) {
        out.sum[c] += px[i * 4 + c];
        if (px[i * 4 + c] > 3) { out.area[c]++; on++; }
      }
      if (on > 1) out.mixed++;
    }
    return out;
  }
  serialize() {
    const px = this.measure();
    const rgb = new Uint8Array((px.length / 4) * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
    let s = '';
    for (let i = 0; i < rgb.length; i += 8192) s += String.fromCharCode.apply(null, rgb.subarray(i, i + 8192));
    return btoa(s);
  }
  restore(text) {
    const s = atob(text);
    const n = SAVE_SIZE;
    if (s.length !== n * n * 3) return false;
    const data = new Float32Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      for (let c = 0; c < 3; c++) data[i * 4 + c] = (s.charCodeAt(i * 3 + c) / 255) * SAVE_SCALE;
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.copyMat.uniforms.map.value = tex;
    this.copyMat.uniforms.scale.value.setScalar(1);
    this.draw(this.copyMat, this.a);
    tex.dispose();
    return true;
  }
}
