import * as THREE from 'three';

/**
 * 2인 3각 걷기 + 가상의 친구 + SYNC.
 *
 * 그룹 0 (왼발 버튼)  : 양쪽 바깥 발 2개
 * 그룹 1 (오른발 버튼): 밴드로 묶인 가운데 발 2개
 * 각 그룹 = 관람객의 발 1개 + 친구의 발 1개. 관람객 = 왼쪽 사람, 친구 = 오른쪽 사람.
 *
 * 관람객의 발은 입력 즉시 움직이고, 친구의 발은 처음엔 조금 늦게·어긋나게 따라오다가
 * 호흡이 맞을수록(SYNC↑) 같은 순간에 같은 보폭으로 내딛게 됩니다.
 */

export const LEAD = 0.13;             // 내딛는 그룹이 다른 그룹보다 앞서는 거리 (m)
const SYNC_RATE = 2.7;                // 정상 리듬에서 초당 SYNC 증가량 (%) → 약 33~38초
const MAX_INTERVAL = 1.6;             // 이보다 긴 쉼은 그 이상 보상하지 않음
const SPAM_INTERVAL = 0.16;           // 이보다 빠른 연타는 거의 인정하지 않음

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const rand = (s = 1) => (Math.random() * 2 - 1) * s;

export class Duet {
  /**
   * @param shoes [{ obj, name, group, viewer, person:'left'|'right', foot:'L'|'R' }]
   * @param onLand (shoe, kind, time) => void
   */
  constructor(shoes, onLand) {
    this.shoes = shoes;
    this.onLand = onLand;
    for (const s of shoes) {
      s.rest = { x: s.obj.position.x, y: s.obj.position.y, z: s.obj.position.z };
      s.half = 0.135; // 신발 반 길이 (뒤꿈치/앞코가 바닥에 닿은 채 구르도록)
    }
    this.reset();
  }

  reset() {
    for (const s of this.shoes) {
      s.x = s.rest.x; s.z = s.rest.z; s.yaw = 0;
      s.anim = null;
      this.#apply(s, s.x, 0, s.z, 0, 0, 0);
    }
    this.sync = 0;               // 0~100 (목표값 — 화면 게이지는 부드럽게 따라옴)
    this.lastGroup = -1;
    this.lastValidTime = -1;
    this.avgInterval = 0.62;
    this.streak = 0;
    this.stall = false;
    this.confusion = 0;          // 실수 직후 친구가 잠시 기다리는 정도
    this.steps = 0;
    this.misses = 0;
    this.locked = false;
  }

  /** 친구가 관람객 리듬에 적응한 정도 0~1 */
  get adapt() {
    return clamp(smooth(4, 78, this.sync) * (1 - 0.5 * this.confusion), 0, 1);
  }

  /** 그룹의 관람객 발 위치 (움직이는 중이면 도착 지점) */
  #refZ(group, viewer = true) {
    const s = this.shoes.find((x) => x.group === group && x.viewer === viewer);
    return s.anim ? s.anim.toZ : s.z;
  }

  #groupMoving(g) { return this.shoes.some((s) => s.group === g && s.anim && s.anim.kind !== 'shuffle'); }

  /** 반대 그룹이 공중에 있으면 남은 동작을 0.07초 안에 마무리 → 입력 누락·꼬임 방지 */
  #rush(g, now) {
    for (const s of this.shoes) {
      if (s.group !== g || !s.anim) continue;
      const a = s.anim;
      const u = (now - a.start) / a.dur;
      if (u < 0) { a.start = now; a.dur = 0.12; continue; }
      if (u >= 1) continue;
      const remain = 0.07;
      a.dur = remain / (1 - u);
      a.start = now - u * a.dur;
    }
  }

  /**
   * 버튼 입력. 즉시 관람객의 발 애니메이션을 시작한다.
   * @returns {{type:'step'|'repeat'|'locked', gain:number}}
   */
  press(group, now) {
    if (this.locked) return { type: 'locked', gain: 0 };
    const other = 1 - group;
    const repeat = group === this.lastGroup;
    this.lastGroup = group;

    if (repeat) {
      // 같은 버튼 반복: 걷기로 인정하지 않음. 제자리에서 살짝 머뭇거리고, 친구는 기다려 줌.
      const v = this.shoes.find((s) => s.group === group && s.viewer);
      if (!v.anim) this.#startAnim(v, now, { toX: v.x, toZ: v.z, toYaw: v.yaw, dur: 0.26, lift: 0.012, kind: 'shuffle', pitch: 0.35 });
      // 같은 버튼을 연달아 여러 번 눌러도 감소는 첫 실수 한 번, 아주 조금만 (초기화되지 않음)
      if (!this.stall) this.sync = Math.max(0, this.sync - 0.3);
      this.streak = 0;
      this.stall = true;
      this.confusion = Math.min(1, this.confusion + 0.45);
      this.misses++;
      return { type: 'repeat', gain: 0 };
    }

    // 반대 그룹이 아직 공중이면 빠르게 착지시킴
    if (this.#groupMoving(other)) this.#rush(other, now);

    // ---- SYNC 계산 (최근 입력 간격으로 리듬 판단) ----
    let gain = 0;
    const dt = this.lastValidTime < 0 ? this.avgInterval : now - this.lastValidTime;
    this.lastValidTime = now;
    const dtc = clamp(dt, 0.12, 2.5);
    const stability = 1 - clamp(Math.abs(dtc - this.avgInterval) / this.avgInterval, 0, 1);
    this.avgInterval = clamp(lerp(this.avgInterval, dtc, 0.3), 0.25, 1.4);
    this.streak++;
    let quality = 0.72 + 0.28 * stability + 0.14 * Math.min(this.streak, 8) / 8;
    if (stability < 0.25) { quality *= 0.5; this.streak = 0; }  // 리듬이 크게 어긋나면 증가가 잠시 느려짐
    if (this.stall) { quality *= 0.7; this.stall = false; }     // 실수 직후 첫 걸음은 조금 덜
    if (dt < SPAM_INTERVAL) quality *= 0.25;                       // 연타 방지
    gain = SYNC_RATE * clamp(dt, 0.2, MAX_INTERVAL) * quality;
    if (this.steps === 0) gain = 0.8;
    this.sync = Math.min(100, this.sync + gain);
    this.confusion *= 0.55;                                        // 친구가 다시 호흡을 맞춤
    this.steps++;

    // ---- 발걸음 ----
    const adapt = this.adapt;
    const dur = clamp(this.avgInterval * 0.62, 0.26, 0.5);
    const loose = 1 - adapt;
    const viewer = this.shoes.find((s) => s.group === group && s.viewer);
    const friend = this.shoes.find((s) => s.group === group && !s.viewer);
    const inner = group === 1;

    // 관람객 발: 입력 즉시 출발
    const vToZ = this.#refZ(other, true) - LEAD + rand(0.022 * loose);
    const vToX = viewer.rest.x + (inner ? -Math.abs(rand(0.006 * loose)) : rand(0.012 * loose));
    this.#startAnim(viewer, now, { toX: vToX, toZ: vToZ, toYaw: rand(0.05 * loose), dur, lift: 0.042 });

    // 친구 발: 처음엔 늦고 보폭도 조금 다르게 → 점점 같은 순간, 같은 보폭
    const delay = Math.max(0, 0.2 * loose + 0.14 * this.confusion + rand(0.04 * loose));
    let fToZ = lerp(this.#refZ(other, false) - LEAD, vToZ, 0.45 + 0.55 * adapt) + rand(0.05 * loose);
    if (inner) fToZ = clamp(fToZ, vToZ - 0.035, vToZ + 0.035);   // 밴드로 묶인 두 발은 멀어지지 않음
    const fToX = friend.rest.x + (inner ? Math.abs(rand(0.006 * loose)) : rand(0.014 * loose));
    this.#startAnim(friend, now + delay, {
      toX: fToX, toZ: fToZ, toYaw: rand(0.08 * loose),
      dur: dur * (1 + 0.22 * loose * Math.random()), lift: 0.042 * (1 + rand(0.15 * loose)),
    });

    return { type: 'step', gain };
  }

  /** 엔딩: 뒤에 있는 그룹이 앞 그룹 옆으로 마지막 발걸음을 함께 내딛고, 네 발이 나란히 멈춤 */
  finalStep(now) {
    this.locked = true;
    const zA = this.#refZ(0), zB = this.#refZ(1);
    const back = zA > zB ? 0 : 1;
    const frontZ = Math.min(zA, zB);
    const landZ = frontZ - 0.02;
    for (const s of this.shoes) {
      if (s.group === back) {
        this.#startAnim(s, now, { toX: s.rest.x, toZ: landZ, toYaw: 0, dur: 0.62, lift: 0.05, kind: 'final' });
      } else {
        // 앞 그룹은 제자리에서 가볍게 자세만 정돈
        this.#startAnim(s, now + 0.08, { toX: s.rest.x, toZ: landZ, toYaw: 0, dur: 0.5, lift: 0.01, kind: 'settle', pitch: 0.2 });
      }
    }
    return landZ;
  }

  get busy() { return this.shoes.some((s) => s.anim); }

  #startAnim(s, start, o) {
    if (s.anim) this.#finish(s, start, false);
    s.anim = {
      fromX: s.x, fromZ: s.z, fromYaw: s.yaw,
      toX: o.toX, toZ: o.toZ, toYaw: o.toYaw,
      start, dur: o.dur, lift: o.lift, kind: o.kind || 'step', pitch: o.pitch ?? 1,
    };
  }

  #finish(s, now, emit = true) {
    const a = s.anim;
    s.x = a.toX; s.z = a.toZ; s.yaw = a.toYaw;
    s.anim = null;
    this.#apply(s, s.x, 0, s.z, s.yaw, 0, 0);
    if (emit) this.onLand(s, a.kind, now);
  }

  update(now) {
    for (const s of this.shoes) {
      const a = s.anim;
      if (!a) continue;
      const u = (now - a.start) / a.dur;
      if (u < 0) continue;
      if (u >= 1) { this.#finish(s, a.start + a.dur); continue; }
      const h = smoother(u);
      const x = lerp(a.fromX, a.toX, h);
      const z = lerp(a.fromZ, a.toZ, h);
      const yaw = lerp(a.fromYaw, a.toYaw, h);
      const env = Math.sin(Math.PI * u);
      const lift = a.lift * Math.pow(env, 0.85);
      // 발뒤꿈치가 먼저 들리고(앞코로 구름) → 착지 직전엔 앞코가 들려 뒤꿈치부터 내려앉음
      const pitch = a.pitch * env * (-0.34 * (1 - smooth(0.3, 0.62, u)) + 0.22 * smooth(0.42, 0.8, u));
      const roll = 0.035 * env * (s.person === 'left' ? -1 : 1) * a.pitch;
      const y = lift + s.half * Math.abs(Math.sin(pitch));
      this.#apply(s, x, y, z, yaw, pitch, roll);
    }
  }

  #apply(s, x, y, z, yaw, pitch, roll) {
    s.obj.position.set(x, y, z);
    s.obj.rotation.set(pitch, yaw, roll, 'YXZ');
    s.obj.updateMatrix();
  }

  /** 네 발의 중심 z (카메라 추적용) */
  centerZ() {
    let z = 0;
    for (const s of this.shoes) z += s.obj.position.z;
    return z / this.shoes.length;
  }
}

/** SYNC(0~100) → 색 혼합 정도. 0%: 화이트, 30%: 아주 은은, 60%: 점점 선명, 100%: 완성 */
export function colorMix(sync) {
  const t = clamp(sync / 100, 0, 1);
  const knots = [[0, 0], [0.3, 0.16], [0.6, 0.5], [1, 1]];
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1], [x1, y1] = knots[i];
    if (t <= x1) {
      const k = (t - x0) / (x1 - x0);
      return lerp(y0, y1, k * k * (3 - 2 * k));
    }
  }
  return 1;
}

export { clamp, lerp, smooth };
export const _v = new THREE.Vector3();
