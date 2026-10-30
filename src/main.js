import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createGlass } from './glass.js';
import { createFloor } from './floor.js';
import { createFootprints } from './footprints.js';
import { Duet, colorMix, clamp, lerp, smooth } from './walk.js';

// ---------------------------------------------------------------------------
// 색
// ---------------------------------------------------------------------------
const BUTTER = new THREE.Color('#ffd27a');
const PEACH = new THREE.Color('#ffa88c');
const WARM_WHITE = new THREE.Color('#fff0e0');

// ---------------------------------------------------------------------------
// 렌더러 / 품질
// ---------------------------------------------------------------------------
const isMobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const LITE = new URLSearchParams(location.search).has('lite'); // 저사양 확인용: 블룸 끔
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio, isMobile ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.02, 60);

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// 신발 외곽선에 맺히는 은은한 빛 (따뜻한 노을빛 림 라이트)
scene.add(new THREE.HemisphereLight(0xfff2e4, 0x120a08, 0.35));
const rimL = new THREE.DirectionalLight(0xffd9a0, 1.4); rimL.position.set(-1.2, 1.1, -1.6); scene.add(rimL);
const rimR = new THREE.DirectionalLight(0xffb8a0, 1.4); rimR.position.set(1.2, 1.1, -1.6); scene.add(rimR);
const key = new THREE.DirectionalLight(0xfff4ea, 0.5); key.position.set(0, 2, 1.5); scene.add(key);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), isMobile ? 0.55 : 0.7, 0.5, 0.5);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let useBloom = !LITE;
if (isMobile) bloom.resolution.set(innerWidth / 2, innerHeight / 2);

// ---------------------------------------------------------------------------
// 바닥 · 발자국
// ---------------------------------------------------------------------------
const floor = createFloor();
scene.add(floor.mesh);
const prints = createFootprints();
scene.add(prints.mesh);

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const ui = {
  hint: $('.hint'), controls: $('.controls'), fill: $('.sync-fill'), pct: $('.sync-pct'),
  ending: $('.ending'), again: $('#btn-again'), loader: $('.loader'), loaderBar: $('.loader span'),
  left: $('#btn-left'), right: $('#btn-right'),
};

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------
const state = {
  phase: 'loading',     // loading → ready → walking → finishing → ending
  shownSync: 0,
  started: false,
  finalLandZ: 0,
  endT: -1,
  textShown: false,
  againShown: false,
  camZ: 0,
  camEnd: 0,
};

let duet = null;
let band = null;
let mats = null;
const lastLand = [null, null];
const clock = () => performance.now() / 1000;

// ---------------------------------------------------------------------------
// GLB 로드
// ---------------------------------------------------------------------------
const loader = new GLTFLoader();
loader.load(
  `${import.meta.env.BASE_URL}models/PHILIA_model_v1.glb`,
  (gltf) => setup(gltf),
  (e) => { if (e.total) ui.loaderBar.style.width = `${(e.loaded / e.total) * 100}%`; },
  (err) => { console.error(err); ui.hint.textContent = '모델을 불러오지 못했습니다.'; },
);

function setup(gltf) {
  const root = gltf.scene.getObjectByName('PHILIA_Root') || gltf.scene;
  scene.add(gltf.scene);

  const get = (n) => {
    const o = root.getObjectByName(n);
    if (!o) throw new Error(`GLB 안에 ${n} 이(가) 없습니다`);
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    return o;
  };

  // 뒤에서 앞(-Z)을 바라보는 카메라 기준, 화면 왼쪽 = -X.
  //   1 첫 번째 사람 바깥 발 = Shoe_B_L (-0.194)  2 첫 번째 사람 안쪽 발 = Shoe_B_R (-0.054)
  //   3 두 번째 사람 안쪽 발 = Shoe_A_L (+0.054)   4 두 번째 사람 바깥 발 = Shoe_A_R (+0.194)
  // 왼쪽 사람(관람객) = 버터 옐로우, 오른쪽 사람(친구) = 피치 핑크
  mats = {
    left: createGlass({ envMap }), right: createGlass({ envMap }), band: createGlass({ envMap, gradient: true, rimStrength: 1.5 }),
    leftR: createGlass({ envMap, opacity: 0.04, rimStrength: 0.45, reflection: true }),
    rightR: createGlass({ envMap, opacity: 0.04, rimStrength: 0.45, reflection: true }),
    bandR: createGlass({ envMap, opacity: 0.04, rimStrength: 0.4, gradient: true, reflection: true }),
  };
  for (const k of ['left', 'leftR']) mats[k].userData.uniforms.uTintA.value.copy(BUTTER), mats[k].userData.uniforms.uTintB.value.copy(BUTTER);
  for (const k of ['right', 'rightR']) mats[k].userData.uniforms.uTintA.value.copy(PEACH), mats[k].userData.uniforms.uTintB.value.copy(PEACH);
  for (const k of ['band', 'bandR']) mats[k].userData.uniforms.uTintA.value.copy(BUTTER), mats[k].userData.uniforms.uTintB.value.copy(PEACH);

  const shoeDefs = [
    { name: 'Shoe_B_L', group: 0, viewer: true, person: 'left' },
    { name: 'Shoe_B_R', group: 1, viewer: true, person: 'left' },
    { name: 'Shoe_A_L', group: 1, viewer: false, person: 'right' },
    { name: 'Shoe_A_R', group: 0, viewer: false, person: 'right' },
  ];
  const shoes = shoeDefs.map((d) => {
    const obj = get(d.name);
    obj.material = mats[d.person];
    obj.renderOrder = 4;
    return { ...d, obj, foot: obj.userData.foot || d.name.slice(-1) };
  });

  // 반사(바닥 아래 거울상) — 같은 지오메트리, 더 옅은 재질
  const mirror = new THREE.Group();
  mirror.scale.y = -1;
  scene.add(mirror);
  for (const s of shoes) {
    const r = new THREE.Mesh(s.obj.geometry, mats[s.person + 'R']);
    r.matrixAutoUpdate = false;
    r.renderOrder = 0;
    mirror.add(r);
    s.reflection = r;
  }

  band = setupBand(get('Band_Link'), shoes.find((s) => s.name === 'Shoe_B_R'), shoes.find((s) => s.name === 'Shoe_A_L'));
  const bandR = new THREE.Mesh(band.mesh.geometry, mats.bandR);
  bandR.matrixAutoUpdate = false;
  bandR.renderOrder = 0;
  mirror.add(bandR);
  for (const n of ['Anchor_A_L', 'Anchor_B_R']) { const a = root.getObjectByName(n); if (a) a.visible = false; }

  duet = new Duet(shoes, onLand);
  duet.update(clock());
  band.update(0);
  syncReflections();

  window.__philia = { duet, state, prints, floor, shoes, band, scene }; // 테스트용

  ui.loader.classList.add('done');
  state.phase = 'ready';
  state.camZ = duet.centerZ();
  bindInput();
}

// ---------------------------------------------------------------------------
// 연결 밴드: 두 신발의 움직임을 따라 부드럽게 늘어나고 휘어짐
// ---------------------------------------------------------------------------
function setupBand(mesh, shoeL, shoeR) {
  mesh.material = mats.band;
  mesh.renderOrder = 5;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const n = pos.count;
  const rest = Float32Array.from(pos.array);
  geo.setAttribute('aRestX', new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => rest[i * 3]), 1));
  pos.setUsage(THREE.DynamicDrawUsage);

  const invL = shoeL.obj.matrix.clone().invert();
  const invR = shoeR.obj.matrix.clone().invert();
  const localL = new Float32Array(n * 3), localR = new Float32Array(n * 3), w = new Float32Array(n), arc = new Float32Array(n);
  const v = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < n; i++) { minX = Math.min(minX, rest[i * 3]); maxX = Math.max(maxX, rest[i * 3]); }
  for (let i = 0; i < n; i++) {
    v.fromArray(rest, i * 3).applyMatrix4(invL); v.toArray(localL, i * 3);
    v.fromArray(rest, i * 3).applyMatrix4(invR); v.toArray(localR, i * 3);
    const t = (rest[i * 3] - minX) / (maxX - minX);
    w[i] = t * t * (3 - 2 * t);
    arc[i] = Math.sin(Math.PI * t);
  }
  const restGap = shoeR.obj.position.x - shoeL.obj.position.x;
  const lag = new THREE.Vector3(), lagVel = new THREE.Vector3(), target = new THREE.Vector3();
  const pL = new THREE.Vector3(), pR = new THREE.Vector3();

  function update(dt) {
    const mL = shoeL.obj.matrix, mR = shoeR.obj.matrix;
    // 리본 가운데가 신발보다 아주 조금 늦게 따라오는 부드러운 흔들림 (스프링)
    target.set(0, (shoeL.obj.position.y + shoeR.obj.position.y) * 0.5, (shoeL.obj.position.z + shoeR.obj.position.z) * 0.5);
    if (dt > 0) {
      const k = 120, d = 14;
      const f = target.clone().sub(lag).multiplyScalar(k).sub(lagVel.clone().multiplyScalar(d));
      lagVel.addScaledVector(f, Math.min(dt, 0.05));
      lag.addScaledVector(lagVel, Math.min(dt, 0.05));
    } else { lag.copy(target); lagVel.set(0, 0, 0); }
    const off = lag.clone().sub(target);
    // 두 발이 앞뒤로 어긋나면 리본이 살짝 들리며 팽팽해짐
    const dz = Math.abs(shoeR.obj.position.z - shoeL.obj.position.z);
    const gap = shoeR.obj.position.x - shoeL.obj.position.x;
    const tension = clamp(dz / 0.06, 0, 1);
    const slack = clamp((restGap - gap) * 2, -0.01, 0.01);
    const a = pos.array;
    for (let i = 0; i < n; i++) {
      pL.fromArray(localL, i * 3).applyMatrix4(mL);
      pR.fromArray(localR, i * 3).applyMatrix4(mR);
      pL.lerp(pR, w[i]);
      a[i * 3] = pL.x;
      a[i * 3 + 1] = pL.y + arc[i] * (off.y * 0.8 + 0.006 * tension - slack);
      a[i * 3 + 2] = pL.z + arc[i] * off.z * 0.8;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }
  return { mesh, update };
}

function syncReflections() {
  // 밴드 반사는 지오메트리를 공유하므로 자동으로 함께 변형됨
  for (const s of duet.shoes) s.reflection.matrix.copy(s.obj.matrix);
}

// ---------------------------------------------------------------------------
// 착지 → 발자국 → 물결
// ---------------------------------------------------------------------------
function personColor(person, k) {
  return WARM_WHITE.clone().lerp(person === 'left' ? BUTTER : PEACH, 0.25 + 0.75 * k);
}

function onLand(s, kind, time) {
  const k = colorMix(state.shownSync);
  if (kind === 'shuffle') {
    floor.addRipple(s.x, s.z, time, 0.3, personColor(s.person, k).multiplyScalar(0.6));
    return;
  }
  if (kind === 'settle') return;
  const col = personColor(s.person, k);
  const glow = kind === 'final' ? 0.95 : 0.55 + 0.25 * k;
  prints.add(s.x, s.z, s.yaw, s.foot === 'L', col.clone().multiplyScalar(glow), time);

  // 같은 그룹의 두 발이 거의 동시에 닿으면 두 물결이 만나 하나의 큰 파동으로
  const g = s.group;
  const prev = lastLand[g];
  if (prev && prev.shoe !== s && time - prev.time < 0.09) {
    const mid = WARM_WHITE.clone().lerp(BUTTER, 0.5 * k).lerp(PEACH, 0.35 * k);
    floor.addRipple((prev.x + s.x) / 2, (prev.z + s.z) / 2, time, kind === 'final' ? 2.6 : 1.9, mid);
    floor.addRipple(s.x, s.z, time, 0.7, col);
    lastLand[g] = null;
  } else {
    floor.addRipple(s.x, s.z, time, kind === 'final' ? 1.4 : 1.0, col);
    lastLand[g] = { shoe: s, time, x: s.x, z: s.z };
  }
}

// ---------------------------------------------------------------------------
// 입력 — pointerdown 즉시 처리 (마우스·터치 동일)
// ---------------------------------------------------------------------------
function press(group, btn) {
  if (!duet || (state.phase !== 'ready' && state.phase !== 'walking')) return;
  const now = clock();
  flash(btn);
  const r = duet.press(group, now);
  duet.update(now); // 같은 프레임에 바로 자세 반영
  if (state.phase === 'ready') {
    state.phase = 'walking';
    ui.hint.classList.add('quiet');
  }
  return r;
}

function flash(btn) {
  if (!btn) return;
  btn.classList.add('pressed');
  clearTimeout(btn._t);
  btn._t = setTimeout(() => btn.classList.remove('pressed'), 140);
}

let inputBound = false;
function bindInput() {
  if (inputBound) return;
  inputBound = true;
  for (const btn of [ui.left, ui.right]) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      press(Number(btn.dataset.group), btn);
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyF') press(0, ui.left);
    if (e.code === 'ArrowRight' || e.code === 'KeyJ') press(1, ui.right);
  });
  ui.again.addEventListener('click', restart);
  // 모바일 확대/스크롤 방지
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// 엔딩 / 다시 걷기
// ---------------------------------------------------------------------------
function beginFinish() {
  state.phase = 'finishing';
  ui.controls.classList.add('disabled');
}

function startEnding(now) {
  state.phase = 'ending';
  state.endT = now;
  // 앞으로 멀리 이어지는 발자국 길 (관계가 계속된다는 느낌)
  const shoes = duet.shoes;
  const k = 1;
  for (let i = 1; i <= 34; i++) {
    const g = i % 2 === 1 ? 0 : 1;
    for (const s of shoes) {
      if (s.group !== g) continue;
      const col = personColor(s.person, k).multiplyScalar(0.75);
      prints.add(s.rest.x, state.finalLandZ - 0.06 - i * LEAD_GHOST, 0, s.foot === 'L', col, now + 1.1 + i * 0.16, 1);
    }
  }
}
const LEAD_GHOST = 0.135;

function restart() {
  if (state.phase !== 'ending') return;
  duet.reset();
  prints.clear();
  floor.clearRipples();
  lastLand[0] = lastLand[1] = null;
  state.phase = 'ready';
  state.shownSync = 0;
  state.endT = -1;
  state.textShown = state.againShown = false;
  state.camEnd = 0;
  state.camZ = duet.centerZ();
  band.update(0);
  ui.ending.classList.remove('show');
  ui.ending.setAttribute('aria-hidden', 'true');
  ui.again.classList.remove('show');
  ui.hint.classList.remove('quiet');
  ui.controls.classList.remove('disabled');
  applyColors(0, 0);
  updateGauge(0);
}

// ---------------------------------------------------------------------------
// 색 · 게이지
// ---------------------------------------------------------------------------
function applyColors(k, glow) {
  if (!mats) return;
  for (const m of Object.values(mats)) {
    const u = m.userData.uniforms;
    u.uMix.value = k;
    u.uGlow.value = m.userData.reflection ? 0 : glow;
  }
  floor.uniforms.uSync.value = k;
}

let gaugeShown = -1;
function updateGauge(v) {
  const p = Math.floor(v);
  ui.fill.style.width = `${v.toFixed(2)}%`;
  if (p !== gaugeShown) { ui.pct.textContent = `${p}%`; gaugeShown = p; }
}

// ---------------------------------------------------------------------------
// 카메라
// ---------------------------------------------------------------------------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function placeCamera(dt, now) {
  const target = duet ? duet.centerZ() : 0;
  state.camZ = dt > 0 ? lerp(state.camZ, target, 1 - Math.exp(-dt * 2.6)) : target;
  const z = state.camZ;

  // 세로 화면에서도 네 신발이 잘리지 않도록 거리 보정
  const aspect = innerWidth / innerHeight;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfovHalf = Math.atan(Math.tan(vfov / 2) * aspect);
  const fit = Math.max(1, 0.36 / (Math.tan(hfovHalf) * 1.18));

  // 세로 화면에서는 하단 버튼·안내문에 가리지 않도록 신발을 조금 위쪽에 둠
  const ahead = lerp(0.05, 0.62, clamp((aspect - 0.6) / 0.9, 0, 1));
  const followPos = new THREE.Vector3(0, 0.82 * fit, z + 1.12 * fit);
  const followLook = new THREE.Vector3(0, 0.0, z - ahead * fit);

  let e = 0;
  if (state.phase === 'ending') e = smooth(0.3, 5.0, now - state.endT);
  state.camEnd = e;
  // 위로 올라가며 뒤로 물러남 → 함께 걸어온 발자국과 앞으로 이어지는 길이 한 화면에
  const endPos = new THREE.Vector3(0, 3.6 * fit, z + 2.6 * fit);
  const endLook = new THREE.Vector3(0, 0, z - 0.8 * fit);
  camPos.lerpVectors(followPos, endPos, e);
  camLook.lerpVectors(followLook, endLook, e);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------------------------------------------------------------------------
// 루프
// ---------------------------------------------------------------------------
let last = clock();
let perf = { frames: 0, t0: -1, checked: false };
function frame() {
  requestAnimationFrame(frame);
  const now = clock();
  const dt = Math.min(0.1, now - last);
  last = now;

  floor.uniforms.uTime.value = now;
  prints.uniforms.uTime.value = now;

  if (duet) {
    duet.update(now);
    band.update(dt);
    syncReflections();

    // 게이지는 목표값을 부드럽게 따라감
    const target = duet.sync;
    state.shownSync += (target - state.shownSync) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(target - state.shownSync) < 0.25) state.shownSync = target;
    if (state.phase === 'walking' || state.phase === 'ready') {
      if (target >= 100 && state.shownSync > 99.5) { state.shownSync = 100; beginFinish(); }
    }
    updateGauge(state.shownSync);

    const k = colorMix(state.shownSync);
    let glow = 0;
    if (state.phase === 'finishing' && !duet.locked && !duet.busy) {
      state.finalLandZ = duet.finalStep(now);
    }
    if (state.phase === 'finishing' && duet.locked && !duet.busy) startEnding(now);
    if (state.phase === 'ending') {
      const t = now - state.endT;
      glow = 0.05 * smooth(0, 2, t) * (0.75 + 0.25 * Math.sin(t * 1.6));
      prints.uniforms.uReveal.value = smooth(0.4, 3.5, t);
      floor.uniforms.uReveal.value = smooth(0.4, 3.5, t);
      if (!state.textShown && t > 2.6) { state.textShown = true; ui.ending.classList.add('show'); ui.ending.setAttribute('aria-hidden', 'false'); }
      if (!state.againShown && t > 4.4) { state.againShown = true; ui.again.classList.add('show'); }
    } else {
      prints.uniforms.uReveal.value = 0;
      floor.uniforms.uReveal.value = 0;
    }
    applyColors(k, glow);
    floor.uniforms.uCenter.value.set(0, duet.centerZ());
  }

  placeCamera(dt, now);
  floor.mesh.position.set(camera.position.x, 0, camera.position.z - 6);

  if (useBloom) composer.render(dt); else renderer.render(scene, camera);
  autoQuality(now);
}
requestAnimationFrame(frame);

// 모바일 등에서 프레임이 부족하면 해상도·블룸을 자동으로 낮춤
function autoQuality(now) {
  if (perf.checked || state.phase === 'loading') return;
  if (perf.t0 < 0) { perf.t0 = now; perf.frames = 0; return; }
  perf.frames++;
  if (now - perf.t0 < 3) return;
  const fps = perf.frames / (now - perf.t0);
  perf.checked = true;
  if (fps < 45) {
    pixelRatio = Math.max(1, pixelRatio * 0.7);
    renderer.setPixelRatio(pixelRatio);
    composer.setPixelRatio(pixelRatio);
    bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  }
  if (fps < 28) useBloom = false;
  window.__philiaQuality = { fps: Math.round(fps), pixelRatio, bloom: useBloom };
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
camera.aspect = innerWidth / innerHeight;
camera.updateProjectionMatrix();
