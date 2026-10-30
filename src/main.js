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
import { createNotes, LANE_X } from './notes.js';
import { Duet, LEAD } from './walk.js';
import { Rhythm } from './rhythm.js';

// ---------------------------------------------------------------------------
// 색
// ---------------------------------------------------------------------------
const BUTTER = new THREE.Color('#ffd27a');
const PEACH = new THREE.Color('#ffa88c');
const WARM_WHITE = new THREE.Color('#fff0e0');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** SYNC(0~100) → 색 혼합. 0%: 화이트, 30%: 아주 은은, 60%: 점점 선명, 100%: 완성 */
function colorMix(sync) {
  const t = clamp(sync / 100, 0, 1);
  const knots = [[0, 0], [0.3, 0.16], [0.6, 0.5], [1, 1]];
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1], [x1, y1] = knots[i];
    if (t <= x1) { const k = (t - x0) / (x1 - x0); return lerp(y0, y1, k * k * (3 - 2 * k)); }
  }
  return 1;
}

// ---------------------------------------------------------------------------
// 렌더러 / 품질
// ---------------------------------------------------------------------------
const isMobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const params = new URLSearchParams(location.search);
const LITE = params.has('lite');          // 저사양 확인용: 블룸 끔
let NORENDER = params.has('norender');    // 자동 테스트용: 그리기만 생략 (게임 로직은 그대로)
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio, isMobile ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.02, 60);
const envMap = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

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
// 바닥 · 걸어온 발자국 · 리듬 노트
// ---------------------------------------------------------------------------
const floor = createFloor();
scene.add(floor.mesh);
const prints = createFootprints();
scene.add(prints.mesh);
const notes = createNotes();
scene.add(notes.mesh, notes.line);

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const ui = {
  hint: $('.hint'), prompt: $('.prompt'), controls: $('.controls'), fill: $('.sync-fill'), pct: $('.sync-pct'),
  ending: $('.ending'), again: $('#btn-again'), loader: $('.loader'), loaderBar: $('.loader span'),
  btn: [$('#btn-left'), $('#btn-right')], judge: $('.judge'),
};

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------
const state = {
  phase: 'loading',      // loading → ready → play → finishing → ending
  shownSync: 0,
  endT: -1, finalStepped: false,
  textShown: false, againShown: false,
  camZ: 0, lineZ: -0.32, lineFade: 1,
  playStart: -1, endTime: -1,
};

let duet = null, band = null, mats = null;
const lastLand = [null, null];
const clock = () => performance.now() / 1000;
const rhythm = new Rhythm({ onJudge, onStray, onEvent, onIdle });

// ---------------------------------------------------------------------------
// GLB 로드
// ---------------------------------------------------------------------------
new GLTFLoader().load(
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

  // 뒤에서 앞(-Z)을 보는 카메라 기준 왼쪽부터: Shoe_B_L · Shoe_B_R · Shoe_A_L · Shoe_A_R
  // 왼쪽 사람(관람객) = 버터 옐로우, 오른쪽 사람(친구) = 피치 핑크
  mats = {
    left: createGlass({ envMap }), right: createGlass({ envMap }), band: createGlass({ envMap, gradient: true, rimStrength: 1.5 }),
    leftR: createGlass({ envMap, opacity: 0.04, rimStrength: 0.45, reflection: true }),
    rightR: createGlass({ envMap, opacity: 0.04, rimStrength: 0.45, reflection: true }),
    bandR: createGlass({ envMap, opacity: 0.04, rimStrength: 0.4, gradient: true, reflection: true }),
  };
  for (const k of ['left', 'leftR']) { const u = mats[k].userData.uniforms; u.uTintA.value.copy(BUTTER); u.uTintB.value.copy(BUTTER); }
  for (const k of ['right', 'rightR']) { const u = mats[k].userData.uniforms; u.uTintA.value.copy(PEACH); u.uTintB.value.copy(PEACH); }
  for (const k of ['band', 'bandR']) { const u = mats[k].userData.uniforms; u.uTintA.value.copy(BUTTER); u.uTintB.value.copy(PEACH); }

  // 그룹 0 = 왼발 버튼(바깥 발 2개), 그룹 1 = 오른발 버튼(묶인 가운데 발 2개)
  const defs = [
    { name: 'Shoe_B_L', group: 0, viewer: true, person: 'left' },
    { name: 'Shoe_B_R', group: 1, viewer: true, person: 'left' },
    { name: 'Shoe_A_L', group: 1, viewer: false, person: 'right' },
    { name: 'Shoe_A_R', group: 0, viewer: false, person: 'right' },
  ];
  const shoes = defs.map((d) => {
    const obj = get(d.name);
    obj.material = mats[d.person];
    obj.renderOrder = 4;
    return { ...d, obj, foot: obj.userData.foot || d.name.slice(-1) };
  });

  const mirror = new THREE.Group();
  mirror.scale.y = -1;
  scene.add(mirror);
  for (const s of shoes) {
    const r = new THREE.Mesh(s.obj.geometry, mats[s.person + 'R']);
    r.matrixAutoUpdate = false;
    mirror.add(r);
    s.reflection = r;
  }

  band = setupBand(get('Band_Link'), shoes[1], shoes[2]);
  const bandR = new THREE.Mesh(band.mesh.geometry, mats.bandR);
  bandR.matrixAutoUpdate = false;
  mirror.add(bandR);
  for (const n of ['Anchor_A_L', 'Anchor_B_R']) { const a = root.getObjectByName(n); if (a) a.visible = false; }

  duet = new Duet(shoes, onLand);
  duet.update(clock(), 0);
  band.update(0, 0);
  syncReflections();

  window.__philia = { duet, rhythm, state, prints, floor, shoes, band, scene, notes, setRender: (v) => { NORENDER = !v; } }; // 테스트용

  ui.loader.classList.add('done');
  state.phase = 'ready';
  state.camZ = duet.centerZ();
  bindInput();
}

// ---------------------------------------------------------------------------
// 연결 밴드: 두 신발을 따라 휘어지고, 어긋나면 팽팽해짐
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
  const lag = new THREE.Vector3(), lagVel = new THREE.Vector3(), target = new THREE.Vector3(), f = new THREE.Vector3();
  const pL = new THREE.Vector3(), pR = new THREE.Vector3();
  let snap = 0;

  function update(dt, tension) {
    const mL = shoeL.obj.matrix, mR = shoeR.obj.matrix;
    target.set(0, (shoeL.obj.position.y + shoeR.obj.position.y) * 0.5, (shoeL.obj.position.z + shoeR.obj.position.z) * 0.5);
    if (dt > 0) {
      const k = 120, d = 14, h = Math.min(dt, 0.05);
      f.copy(target).sub(lag).multiplyScalar(k).addScaledVector(lagVel, -d);
      lagVel.addScaledVector(f, h);
      lag.addScaledVector(lagVel, h);
    } else { lag.copy(target); lagVel.set(0, 0, 0); }
    // 팽팽해지는 순간 짧게 '탱' 떨림
    snap = Math.max(snap * 0.9, tension);
    const oy = lag.y - target.y, oz = lag.z - target.z;
    const dz = Math.abs(shoeR.obj.position.z - shoeL.obj.position.z);
    const taut = clamp(Math.max(dz / 0.06, tension), 0, 1);
    const twang = Math.sin((performance.now() / 1000) * 38) * 0.004 * snap;
    const a = pos.array;
    for (let i = 0; i < n; i++) {
      pL.fromArray(localL, i * 3).applyMatrix4(mL);
      pR.fromArray(localR, i * 3).applyMatrix4(mR);
      pL.lerp(pR, w[i]);
      // 팽팽할수록 가운데 처짐이 펴지며 살짝 들림
      a[i * 3] = pL.x;
      a[i * 3 + 1] = pL.y + arc[i] * (oy * 0.8 + 0.008 * taut + twang);
      a[i * 3 + 2] = pL.z + arc[i] * (oz * 0.8);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }
  return { mesh, update };
}

function syncReflections() {
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
  const col = personColor(s.person, k);
  if (kind === 'shuffle') { floor.addRipple(s.x, s.z, time, 0.25, col.clone().multiplyScalar(0.5)); return; }
  const big = kind === 'final' || kind === 'help';
  prints.add(s.x, s.z, s.yaw, s.foot === 'L', col.clone().multiplyScalar(big ? 0.85 : kind === 'brace' ? 0.5 : 0.45 + 0.25 * k), time);
  const g = s.group;
  const prev = lastLand[g];
  if (prev && prev.shoe !== s && time - prev.time < 0.09) {
    // 함께 착지 → 두 물결이 만나 하나의 큰 파동
    const mid = WARM_WHITE.clone().lerp(BUTTER, 0.5 * k).lerp(PEACH, 0.35 * k);
    floor.addRipple((prev.x + s.x) / 2, (prev.z + s.z) / 2, time, big ? 2.6 : 1.9, big ? mid.multiplyScalar(1.25) : mid);
    floor.addRipple(s.x, s.z, time, 0.7, col);
    lastLand[g] = null;
  } else {
    floor.addRipple(s.x, s.z, time, kind === 'brace' ? 0.8 : big ? 1.4 : 1.0, col);
    lastLand[g] = { shoe: s, time, x: s.x, z: s.z };
  }
}

// ---------------------------------------------------------------------------
// 리듬 판정 → 움직임
// ---------------------------------------------------------------------------
function onJudge(note, grade, info) {
  const now = info.real;
  if (grade === 'miss') {
    duet.stumble(note.lane, now, info.recover);
    showJudge('MISS', info.pressedLane ?? note.lane, 'miss');
    return;
  }
  duet.step(note.lane, now, grade, info.offset || 0);
  notes.pulse(note.lane, grade === 'perfect' ? 1 : 0.6);
  showJudge(grade === 'perfect' ? 'PERFECT' : 'GOOD', note.lane, grade);
}

function onStray(lane) {
  duet.shuffle(lane, clock());
}

function onEvent(type, real) {
  if (type === 'slip') {
    duet.slip(real);
    ui.prompt.classList.add('show');
  } else if (type === 'help') {
    duet.help(real);
    ui.prompt.classList.remove('show');
    notes.pulse(1, 1);
  }
}

function onIdle() {
  ui.hint.classList.remove('quiet');
}

let judgeTimer = 0;
const projV = new THREE.Vector3();
function showJudge(text, lane, cls) {
  projV.set(LANE_X[lane], 0.07, state.lineZ).project(camera);
  const x = (projV.x * 0.5 + 0.5) * innerWidth, y = (-projV.y * 0.5 + 0.5) * innerHeight;
  const el = ui.judge;
  el.textContent = text;
  el.className = `judge ${cls}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  void el.offsetWidth; // 애니메이션 재시작
  el.classList.add('show');
  clearTimeout(judgeTimer);
  judgeTimer = setTimeout(() => el.classList.remove('show'), 650);
}

// ---------------------------------------------------------------------------
// 입력 — pointerdown 즉시 처리 (마우스·터치 동일)
// ---------------------------------------------------------------------------
function press(lane, touch) {
  if (!duet || (state.phase !== 'ready' && state.phase !== 'play')) return;
  flash(ui.btn[lane]);
  const now = clock();
  const r = rhythm.press(lane, now, touch);
  duet.update(now, rhythm.sync);               // 같은 순간 바로 움직임 반영
  if (r.type === 'start') {
    state.phase = 'play';
    if (state.playStart < 0) state.playStart = now;
    ui.hint.classList.add('quiet');
  }
  return r;
}

function flash(btn) {
  btn.classList.add('pressed');
  clearTimeout(btn._t);
  btn._t = setTimeout(() => btn.classList.remove('pressed'), 140);
}

let inputBound = false;
function bindInput() {
  if (inputBound) return;
  inputBound = true;
  ui.btn.forEach((btn, lane) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      press(lane, e.pointerType === 'touch');
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyF') press(0, false);
    if (e.code === 'ArrowRight' || e.code === 'KeyJ') press(1, false);
  });
  ui.again.addEventListener('click', restart);
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// 엔딩 / 다시 걷기
// ---------------------------------------------------------------------------
function startEnding(now) {
  state.phase = 'ending';
  state.endT = now;
  // 앞으로 이어지는 길은 몇 걸음만 아주 희미하게 암시
  for (let i = 1; i <= 2; i++) {
    const g = i % 2 === 1 ? 0 : 1;
    for (const s of duet.shoes) {
      if (s.group !== g) continue;
      const col = personColor(s.person, 1).multiplyScalar(0.36 * (1 - i / 3.2));
      prints.add(s.rest.x, duet.centerZ() - 0.05 - i * LEAD * 1.05, 0, s.foot === 'L', col, now + 1.6 + i * 0.35, 1);
    }
  }
}

function restart() {
  if (state.phase !== 'ending') return;
  rhythm.reset();
  duet.reset();
  prints.clear();
  floor.clearRipples();
  lastLand[0] = lastLand[1] = null;
  Object.assign(state, {
    phase: 'ready', shownSync: 0, endT: -1, finalStepped: false, textShown: false, againShown: false,
    lineFade: 1, playStart: -1, endTime: -1,
  });
  state.camZ = duet.centerZ();
  band.update(0, 0);
  ui.ending.classList.remove('show');
  ui.ending.setAttribute('aria-hidden', 'true');
  ui.again.classList.remove('show');
  ui.hint.classList.remove('quiet');
  ui.prompt.classList.remove('show');
  ui.controls.classList.remove('disabled');
  applyColors(0, 0);
  updateGauge(0);
}

// ---------------------------------------------------------------------------
// 색 · 게이지 · 버튼 강조
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

let cueLane = -1, cueStrong = false;
function updateCue() {
  let lane = -1, amount = 0, strong = false;
  if (state.phase === 'play') {
    if (rhythm.state === 'event') { lane = rhythm.eventLane; amount = 1; strong = true; }
    else if (rhythm.state === 'play') {
      const u = rhythm.upcoming();
      if (u && u.dt < 0.75) { lane = u.lane; amount = smooth(0.75, 0.1, u.dt); }
    }
  }
  notes.cue(lane, amount);
  if (lane !== cueLane || strong !== cueStrong) {
    ui.btn.forEach((b, i) => { b.classList.toggle('cue', i === lane); b.classList.toggle('cue-strong', i === lane && strong); });
    cueLane = lane; cueStrong = strong;
  }
}

// ---------------------------------------------------------------------------
// 카메라
// ---------------------------------------------------------------------------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), endPos = new THREE.Vector3(), endLook = new THREE.Vector3();
function placeCamera(dt, now) {
  const target = duet ? duet.centerZ() : 0;
  state.camZ = dt > 0 ? lerp(state.camZ, target, 1 - Math.exp(-dt * 2.6)) : target;
  const z = state.camZ;
  const aspect = innerWidth / innerHeight;
  const vfov = THREE.MathUtils.degToRad(40); // 기본 시야 기준으로 거리 계산 (엔딩의 시야 변화와 무관)
  const hfovHalf = Math.atan(Math.tan(vfov / 2) * aspect);
  const fit = Math.max(1, 0.36 / (Math.tan(hfovHalf) * 1.18));
  // 세로 화면에서는 하단 버튼에 가리지 않도록 신발을 조금 위쪽에
  const ahead = lerp(0.35, 0.62, clamp((aspect - 0.6) / 0.9, 0, 1));
  camPos.set(0, 1.0 * fit, z + 1.35 * fit);
  camLook.set(0, 0, z - ahead * fit);
  if (state.phase === 'ending') {
    // 천천히 높아지며 뒤로 → 신발은 화면 아래쪽, 함께 걸어온 발자국이 그 뒤로 이어짐
    const e = smooth(0.4, 5.5, now - state.endT);
    // 신발은 문구 아래쪽, 그 뒤로 함께 걸어온 발자국이 화면 아래까지 이어짐
    endPos.set(0, 2.7 * fit, z + 1.9 * fit);
    endLook.set(0, 0, z - 1.05 * fit);
    camPos.lerp(endPos, e);
    camLook.lerp(endLook, e);
    // 시야를 살짝 넓혀 문구·버튼 아래에 신발, 그 뒤로 걸어온 길이 함께 담기도록
    const fov = 40 + 6 * e;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  } else if (camera.fov !== 40) {
    camera.fov = 40; camera.updateProjectionMatrix();
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------------------------------------------------------------------------
// 루프
// ---------------------------------------------------------------------------
let last = clock();
const perf = { frames: 0, t0: -1, checked: false };
function frame() {
  requestAnimationFrame(frame);
  const now = clock();
  const dt = Math.min(0.1, now - last);
  last = now;
  floor.uniforms.uTime.value = now;
  prints.uniforms.uTime.value = now;

  if (duet) {
    rhythm.update(now, dt);
    duet.update(now, rhythm.sync);
    band.update(dt, duet.tension);
    syncReflections();

    // 게이지는 판정 결과(rhythm.sync)를 부드럽게 따라감
    const target = rhythm.sync;
    state.shownSync += (target - state.shownSync) * (1 - Math.exp(-dt * 4));
    if (Math.abs(target - state.shownSync) < 0.2) state.shownSync = target;
    updateGauge(state.shownSync);

    // 판정선: 신발 앞쪽 바닥
    state.lineZ = state.camZ - 0.36;
    // 친구의 실수 이벤트 동안에는 노트를 흐리게 → 신발과 '도와주기'에 집중
    const lineTarget = state.phase === 'play' || state.phase === 'ready' ? (rhythm.state === 'event' || rhythm.state === 'help' ? 0.3 : 1) : 0;
    state.lineFade = lerp(state.lineFade, lineTarget, 1 - Math.exp(-dt * 4));
    notes.update(rhythm, state.lineZ, state.lineFade, now);
    updateCue();

    // 100% → 마지막 걸음을 함께 → 엔딩
    if (state.phase === 'play' && rhythm.state === 'done') {
      state.phase = 'finishing';
      ui.controls.classList.add('disabled');
      ui.prompt.classList.remove('show');
    }
    if (state.phase === 'finishing' && !state.finalStepped && !duet.busy) {
      state.finalStepped = true;
      const zA = duet.shoe(0, true).z, zB = duet.shoe(1, true).z;
      duet.step(zA > zB ? 0 : 1, now, 'final');
      state.endTime = now - state.playStart;
    }
    if (state.phase === 'finishing' && state.finalStepped && !duet.busy) startEnding(now);

    const k = colorMix(state.shownSync);
    let glow = 0;
    if (state.phase === 'ending') {
      const t = now - state.endT;
      glow = 0.04 * smooth(0, 2, t) * (0.8 + 0.2 * Math.sin(t * 1.5));
      prints.uniforms.uReveal.value = smooth(0.5, 3.5, t);
      floor.uniforms.uReveal.value = smooth(0.5, 3.5, t);
      if (!state.textShown && t > 3.0) { state.textShown = true; ui.ending.classList.add('show'); ui.ending.setAttribute('aria-hidden', 'false'); }
      if (!state.againShown && t > 4.6) { state.againShown = true; ui.again.classList.add('show'); }
    } else {
      prints.uniforms.uReveal.value = 0;
      floor.uniforms.uReveal.value = 0;
    }
    applyColors(k, glow);
    floor.uniforms.uCenter.value.set(0, duet.centerZ());
  }

  placeCamera(dt, now);
  floor.mesh.position.set(camera.position.x, 0, camera.position.z - 6);
  if (NORENDER) return;
  if (useBloom) composer.render(dt); else renderer.render(scene, camera);
  autoQuality(now);
}
requestAnimationFrame(frame);

// 프레임이 부족하면 해상도·블룸을 자동으로 낮춤
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
