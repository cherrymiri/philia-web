/**
 * 2인 3각 신발 움직임
 *
 * 그룹 0 (왼발 레인)  : 양쪽 바깥 발 2개
 * 그룹 1 (오른발 레인): 밴드로 묶인 가운데 발 2개
 * 관람객 = 왼쪽 사람, 가상의 친구 = 오른쪽 사람
 *
 * 각 신발의 최종 자세 = 걸음(기본 자세) + 연출 오프셋(휘청거림·버팀·회복)
 * 오프셋은 바닥에 파묻히지 않도록 기울기만큼 들어 올려 적용하고, 가운데 두 발은
 * 항상 같은 방향으로만 옆으로 밀리게 해 서로 겹치지 않습니다.
 */

export const LEAD = 0.13;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const rand = (s = 1) => (Math.random() * 2 - 1) * s;
const ZERO = () => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 });

export class Duet {
  constructor(shoes, onLand) {
    this.shoes = shoes;
    this.onLand = onLand;
    for (const s of shoes) {
      s.rest = { x: s.obj.position.x, z: s.obj.position.z };
      s.half = 0.135;
    }
    this.byName = Object.fromEntries(shoes.map((s) => [s.name, s]));
    this.reset();
  }

  reset() {
    for (const s of this.shoes) {
      s.x = s.rest.x; s.z = s.rest.z; s.yaw = 0;
      s.anim = null;
      s.off = ZERO();
      this.#apply(s, { x: s.x, y: 0, z: s.z, pitch: 0, yaw: 0, roll: 0 });
    }
    this.effect = null;      // { type: 'stumble' | 'slip' | 'help', start, dur, amp, ... }
    this.tension = 0;        // 밴드 팽팽함 0~1
    this.sync = 0;
  }

  shoe(group, viewer) { return this.shoes.find((s) => s.group === group && s.viewer === viewer); }
  #ref(group, viewer = true) { const s = this.shoe(group, viewer); return s.anim ? s.anim.toZ : s.z; }
  get busy() { return this.shoes.some((s) => s.anim) || !!this.effect; }

  /**
   * 성공 판정 → 해당 그룹 두 발이 함께 한 걸음
   * @param quality 'perfect' | 'good' | 'final' | 'help'
   * @param offset  입력 시차 (초, GOOD 이면 친구 발이 그만큼 어긋남)
   */
  step(group, now, quality = 'perfect', offset = 0) {
    // 반대 그룹이 공중이면 빠르게 착지시켜 꼬임 방지
    for (const s of this.shoes) if (s.group !== group && s.anim) this.#rush(s, now);
    const other = 1 - group;
    const loose = 1 - clamp(this.sync / 90, 0, 1);
    const ahead = Math.min(this.#ref(group, true), this.#ref(other, true));
    const toZ = (quality === 'final' ? this.#ref(other, true) : ahead - LEAD);
    const dur = quality === 'final' ? 0.62 : 0.4;
    const v = this.shoe(group, true), f = this.shoe(group, false);
    const jitterZ = quality === 'good' ? rand(0.018) * (0.5 + loose) : rand(0.006) * loose;
    this.#start(v, now, { toX: v.rest.x, toZ, toYaw: rand(0.03 * loose), dur, lift: 0.042 });
    // 친구: PERFECT 는 같은 순간, GOOD 은 약간의 시간차
    const delay = quality === 'good' ? clamp(Math.abs(offset) * 0.7 + 0.05, 0.05, 0.16) : 0;
    this.#start(f, now + delay, { toX: f.rest.x, toZ: toZ + jitterZ, toYaw: rand(0.04 * loose), dur: dur * (quality === 'good' ? 1.08 : 1), lift: 0.042, kind: quality === 'final' ? 'final' : quality === 'help' ? 'help' : 'step' });
    if (quality === 'final') v.anim.kind = 'final';
    if (quality === 'help') v.anim.kind = 'help';
  }

  /** 노트와 상관없는 입력: 제자리에서 살짝 머뭇 */
  shuffle(group, now) {
    const v = this.shoe(group, true);
    if (v.anim || this.effect) return;
    this.#start(v, now, { toX: v.x, toZ: v.z, toYaw: v.yaw, dur: 0.24, lift: 0.01, kind: 'shuffle', pitch: 0.35 });
  }

  /**
   * MISS → 발이 엉켜 넘어질 뻔 → 친구가 한 걸음 나와 버팀 → 다시 나란히
   * @param group 실수한 레인의 그룹
   * @param dur   회복 전체 시간 (리듬 시계가 그동안 멈춤)
   */
  stumble(group, now, dur) {
    for (const s of this.shoes) if (s.anim) this.#rush(s, now);
    const amp = lerp(1.0, 0.45, clamp(this.sync / 85, 0, 1));    // 낮은 SYNC: 크게, 높은 SYNC: 작게
    this.effect = { type: 'stumble', start: now, dur, amp, group, braced: false };
  }

  /** 친구의 실수: 친구의 안쪽 발이 헛디뎌 기울어진 채로, 관람객이 도와줄 때까지 버팀 */
  slip(now) {
    for (const s of this.shoes) if (s.anim) this.#rush(s, now);
    this.effect = { type: 'slip', start: now, dur: Infinity, amp: 1 };
  }

  /** 관람객이 친구를 도와줌: 관람객의 안쪽 발이 친구 쪽으로 받쳐 주며 함께 착지 */
  help(now) {
    const prev = this.effect && this.effect.type === 'slip' ? this.effect : null;
    this.effect = { type: 'help', start: now, dur: 0.9, from: prev ? this.#slipPose(now - prev.start) : null };
    this.step(1, now + 0.05, 'help');
  }

  // ---------------------------------------------------------------- 연출 오프셋
  #stumblePose(t, e) {
    // t: 0~1. a) 잘못 디딤 0~0.2  b) 넘어질 뻔한 자세로 멈칫 0.2~0.42  c) 친구가 버팀 0.42~0.68  d) 복귀 0.68~1
    const A = e.amp;
    const viewerGroup = e.group;
    const rise = smooth(0.0, 0.2, t);
    const wob = Math.sin(t * 34) * 0.18 * (1 - smooth(0.2, 0.5, t));
    const fallFriend = smooth(0.42, 0.75, t);      // 친구가 먼저 안정됨
    const fallViewer = smooth(0.55, 0.95, t);
    const settle = Math.sin(smooth(0.8, 1.0, t) * Math.PI) * 0.12;   // 마지막에 살짝 출렁
    const out = {};
    for (const s of this.shoes) {
      const isLurcher = s.viewer && s.group === viewerGroup;
      const w = rise * (1 - (s.viewer ? fallViewer : fallFriend)) + settle * (s.viewer ? 1 : 0.5);
      const o = ZERO();
      if (isLurcher) {
        // 잘못된 타이밍에 앞으로 튀어나가 앞코가 쏠림
        // (묶인 발은 회전시키면 뒤꿈치가 친구 발 쪽으로 돌아가므로 회전 없이 앞·옆으로만)
        o.z = -0.075 * A; o.y = 0.018 * A; o.pitch = -0.42 * A; o.yaw = (s.group === 1 ? 0 : -0.12) * A; o.roll = 0.16 * A;
      } else if (s.viewer) {
        // 관람객의 다른 발: 끌려가며 바깥쪽으로 기울어짐
        o.z = -0.02 * A; o.pitch = -0.16 * A; o.roll = 0.24 * A; o.x = -0.008 * A;
      } else {
        // 친구 발: 함께 끌려가 같은 방향으로 기울어짐
        o.z = -0.015 * A; o.pitch = -0.12 * A; o.roll = 0.18 * A;
      }
      // 묶인 두 발은 함께 관람객 쪽(-X)으로 당겨짐 → 같은 방향이라 겹치지 않음
      if (s.group === 1) o.x += -0.016 * A;
      for (const k in o) o[k] *= w * (1 + wob);
      out[s.name] = o;
    }
    return out;
  }

  #slipPose(age) {
    // 친구의 안쪽 발이 헛디뎌 앞·바깥으로 쏠림 → 묶인 관람객 발도 끌려감, 밴드 팽팽
    const rise = smooth(0, 0.35, age);
    const sway = Math.sin(age * 5.2) * 0.22 + Math.sin(age * 11.0) * 0.06;  // 균형을 잡으려 흔들흔들
    const out = {};
    for (const s of this.shoes) {
      const o = ZERO();
      if (s.name === 'Shoe_A_L') { o.z = -0.06; o.y = 0.012; o.pitch = -0.36; o.yaw = -0.24; o.roll = -0.3; o.x = 0.016; }
      else if (s.name === 'Shoe_A_R') { o.z = -0.025; o.pitch = -0.14; o.roll = -0.2; o.x = 0.01; }
      else if (s.name === 'Shoe_B_R') { o.z = -0.02; o.pitch = -0.1; o.roll = -0.16; o.x = 0.016; }
      else { o.roll = -0.06; }
      const k = rise * (1 + sway * (s.viewer ? 0.4 : 1));
      for (const key in o) o[key] *= k;
      out[s.name] = o;
    }
    return out;
  }

  #effectPose(now) {
    const e = this.effect;
    if (!e) return null;
    const age = now - e.start;
    if (e.type === 'stumble') {
      const t = clamp(age / e.dur, 0, 1);
      // 친구가 한 걸음 나와 버팀 (실제 걸음 → 착지 물결)
      if (!e.braced && t >= 0.4) {
        e.braced = true;
        const f = this.shoe(0, false);   // 친구의 바깥 발
        // 바깥쪽·앞으로 크게 한 걸음 디뎌 버팀 (다음 걸음 때 원래 폭으로 돌아감)
        if (!f.anim) this.#start(f, now, { toX: f.rest.x + 0.03 * e.amp, toZ: f.z - 0.1 * e.amp - 0.04, toYaw: 0.1 * e.amp, dur: 0.32, lift: 0.045, kind: 'brace' });
      }
      this.tension = Math.max(this.tension, smooth(0.05, 0.2, t) * (1 - smooth(0.55, 0.9, t)));
      if (t >= 1) { this.effect = null; return null; }
      return this.#stumblePose(t, e);
    }
    if (e.type === 'slip') {
      this.tension = Math.max(this.tension, smooth(0, 0.3, age));
      return this.#slipPose(age);
    }
    if (e.type === 'help') {
      const t = clamp(age / e.dur, 0, 1);
      this.tension = Math.max(this.tension, 1 - smooth(0.1, 0.6, t));
      if (t >= 1) { this.effect = null; return null; }
      if (!e.from) return null;
      const k = 1 - smoother(clamp(t / 0.75, 0, 1));
      const out = {};
      for (const [n, o] of Object.entries(e.from)) { const c = {}; for (const key in o) c[key] = o[key] * k; out[n] = c; }
      return out;
    }
    return null;
  }

  // ---------------------------------------------------------------- 걸음
  #rush(s, now) {
    const a = s.anim;
    if (!a) return;
    const u = (now - a.start) / a.dur;
    if (u < 0) { a.start = now; a.dur = 0.1; return; }
    if (u >= 1) return;
    a.dur = 0.07 / (1 - u);
    a.start = now - u * a.dur;
  }

  #start(s, start, o) {
    if (s.anim) this.#finish(s, start, false);
    s.anim = { fromX: s.x, fromZ: s.z, fromYaw: s.yaw, toX: o.toX, toZ: o.toZ, toYaw: o.toYaw, start, dur: o.dur, lift: o.lift, kind: o.kind || 'step', pitch: o.pitch ?? 1 };
  }

  #finish(s, now, emit = true) {
    const a = s.anim;
    s.x = a.toX; s.z = a.toZ; s.yaw = a.toYaw;
    s.anim = null;
    if (emit) this.onLand(s, a.kind, now);
  }

  update(now, sync = this.sync) {
    this.sync = sync;
    this.tension *= 0.86;
    const fx = this.#effectPose(now);
    for (const s of this.shoes) {
      let base = { x: s.x, y: 0, z: s.z, pitch: 0, yaw: s.yaw, roll: 0 };
      const a = s.anim;
      if (a) {
        const u = (now - a.start) / a.dur;
        if (u >= 1) this.#finish(s, a.start + a.dur);
        else if (u >= 0) {
          const h = smoother(u);
          const env = Math.sin(Math.PI * u);
          const pitch = a.pitch * env * (-0.34 * (1 - smooth(0.3, 0.62, u)) + 0.22 * smooth(0.42, 0.8, u));
          base = {
            x: lerp(a.fromX, a.toX, h), z: lerp(a.fromZ, a.toZ, h), yaw: lerp(a.fromYaw, a.toYaw, h),
            y: a.lift * Math.pow(env, 0.85), pitch, roll: 0.03 * env * (s.person === 'left' ? -1 : 1) * a.pitch,
          };
        }
        if (s.anim === null) base = { x: s.x, y: 0, z: s.z, pitch: 0, yaw: s.yaw, roll: 0 };
      }
      const o = fx ? fx[s.name] || ZERO() : ZERO();
      s.off = o;
      this.#apply(s, {
        x: base.x + o.x, y: base.y + o.y, z: base.z + o.z,
        pitch: base.pitch + o.pitch, yaw: base.yaw + o.yaw, roll: base.roll + o.roll,
      });
    }
  }

  #apply(s, p) {
    // 기울어진 만큼 들어 올려 앞코·뒤꿈치·옆면이 바닥 아래로 파묻히지 않게
    const lift = s.half * Math.abs(Math.sin(p.pitch)) + 0.048 * Math.abs(Math.sin(p.roll));
    s.obj.position.set(p.x, Math.max(0, p.y) + lift, p.z);
    s.obj.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
    s.obj.updateMatrix();
  }

  centerZ() {
    let z = 0;
    for (const s of this.shoes) z += s.z;
    return z / this.shoes.length;
  }
}
