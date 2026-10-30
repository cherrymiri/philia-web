/**
 * PHILIA 리듬 엔진 (화면과 분리된 순수 로직 — 시뮬레이션 테스트 가능)
 *
 * 레인 0 = 왼발 버튼 = 양쪽 바깥 발 2개
 * 레인 1 = 오른발 버튼 = 밴드로 묶인 가운데 발 2개
 *
 * - 미리 설계한 리듬 패턴을 SYNC 구간(초반/중반/후반)과 관람객 상태에 맞춰 이어 붙임
 * - PERFECT / GOOD / MISS 판정 (실수가 이어지면 판정 범위 확대 + 쉬운 패턴)
 * - 회복 모션·친구 이벤트 동안 게임 시계(노트 진행·판정 타이머) 정지
 * - SYNC 는 판정 결과로만 증가 (클릭 수와 무관, 시간만 흘러도 증가 없음)
 */

export const APPROACH = 2.0;        // 노트가 나타나서 판정선에 닿기까지 (초)
export const WIN_PERFECT = 0.12;    // ±120ms
export const WIN_GOOD = 0.25;       // ±250ms
const EARLY_MISS = 0.5;             // 판정 범위 밖이지만 이 안에서 먼저 누르면 '너무 이른 입력' = MISS
const TOUCH_OFFSET = 0.025;         // 모바일 터치 지연 보정
const GRACE = 1.05;                 // 회복·이벤트 후 다음 노트까지 최소 여유 (초)

const GAIN_PERFECT = 2.0;
const GAIN_GOOD = 1.7;
const COMBO_BONUS = 0.12;           // PERFECT·GOOD 연속 1회당 (최대 8연속)
const HELP_BONUS = 4;               // 친구를 도와준 유대감 보너스

const EVENT_MIN = 50, EVENT_MAX = 62;

// 패턴: [레인, 박자 위치] , len = 패턴 길이(박자). beat = 박자 길이(초)
const L = 0, R = 1;
const PATTERNS = {
  early: [
    { beat: 0.76, len: 4, notes: [[L, 0], [R, 1], [L, 2], [R, 3]] },
    { beat: 0.76, len: 4, notes: [[R, 0], [L, 1], [R, 2], [L, 3]] },
  ],
  mid: [
    { beat: 0.62, len: 4, notes: [[L, 0], [R, 1], [L, 2], [R, 3]] },
    { beat: 0.62, len: 4, notes: [[L, 0], [L, 1], [R, 2]] },               // 왼 → 왼 → 오른 → (쉬기)
    { beat: 0.62, len: 5, notes: [[R, 0], [L, 1], [R, 2], [R, 3]] },       // 오른 → 왼 → 오른 → 오른 → (쉬기)
    { beat: 0.62, len: 4, notes: [[L, 0], [R, 2]] },                       // 왼 → 잠깐 쉬기 → 오른
    { beat: 0.62, len: 4, notes: [[R, 0], [L, 1], [L, 2], [R, 3]] },
  ],
  late: [
    { beat: 0.6, len: 4, notes: [[L, 0], [R, 1], [L, 2], [R, 3]] },
    { beat: 0.6, len: 4, notes: [[R, 0], [L, 1], [R, 2], [L, 3]] },
    { beat: 0.6, len: 4, notes: [[L, 0], [R, 1], [R, 2], [L, 3]] },
  ],
};

export class Rhythm {
  constructor(hooks = {}, rng = Math.random) {
    this.hooks = hooks;   // onJudge(note, grade, info), onStray(lane), onEvent(type), onIdle()
    this.rng = rng;
    this.reset();
  }

  reset() {
    this.state = 'idle';          // idle → play ⇄ recover / event / help → done
    this.gameT = 0;
    this.notes = [];
    this.nextPatternT = 0;
    this.sync = 0;
    this.combo = 0;
    this.missStreak = 0;
    this.recent = [];             // 최근 판정 (난이도 조절)
    this.pauseUntil = 0;          // 실제 시각 기준
    this.eventDone = false;
    this.eventPending = -1;       // 이벤트 시작 예정 (게임 시각)
    this.eventLane = R;
    this.timeoutsWithoutInput = 0;
    this.stats = { perfect: 0, good: 0, miss: 0, stray: 0, presses: 0 };
    this.started = false;
    this.lastPatternIdx = -1;
  }

  get phase() {
    if (this.sync < 22) return 'early';
    if (this.sync < 78) return 'mid';
    return 'late';
  }

  get struggling() {
    const r = this.recent.slice(-6);
    const misses = r.filter((g) => g === 'miss').length;
    return this.missStreak >= 2 || (r.length >= 4 && misses >= 3);
  }

  windows() {
    const widen = Math.min(0.12, 0.05 * this.missStreak) + (this.struggling ? 0.05 : 0);
    return { perfect: WIN_PERFECT + widen * 0.6, good: WIN_GOOD + widen };
  }

  /** 첫 입력: 체험 시작 (판정하지 않음) */
  start() {
    if (this.started) return;
    this.started = true;
    this.state = 'play';
    this.nextPatternT = this.gameT + APPROACH + 0.4;
    this.#fill();
  }

  #fill() {
    // 앞으로 APPROACH + 1.5초까지의 노트를 미리 준비
    while (this.nextPatternT < this.gameT + APPROACH + 1.5) {
      const phase = this.struggling ? 'early' : this.phase;
      const list = PATTERNS[phase];
      let i = Math.floor(this.rng() * list.length);
      if (list.length > 1 && i === this.lastPatternIdx) i = (i + 1) % list.length;
      this.lastPatternIdx = i;
      const p = list[i];
      // 직전 노트와 너무 붙지 않도록
      const lastNote = this.notes[this.notes.length - 1];
      let t0 = this.nextPatternT;
      if (lastNote && t0 - lastNote.t < p.beat) t0 = lastNote.t + p.beat;
      for (const [lane, b] of p.notes) this.notes.push({ lane, t: t0 + b * p.beat, judged: false, grade: null, id: this.notes.length });
      this.nextPatternT = t0 + p.len * p.beat;
    }
  }

  /** 현재 게임 시각 (프레임 사이 입력도 정확히) */
  #now(real) {
    return this.state === 'play' ? this.gameT + Math.max(0, real - this.lastReal) : this.gameT;
  }

  /**
   * 버튼 입력 — 반환값의 type 으로 화면이 즉시 반응
   * @returns {{type:'start'|'hit'|'miss'|'stray'|'help'|'wait'|'ignored', grade?, lane, note?}}
   */
  press(lane, real, touch = false) {
    this.stats.presses++;
    this.timeoutsWithoutInput = 0;
    if (this.state === 'done') return { type: 'ignored', lane };
    if (!this.started) { this.start(); return { type: 'start', lane }; }
    if (this.state === 'idle') { this.#resume(real); return { type: 'start', lane }; }
    if (this.state === 'event') {
      if (lane !== this.eventLane) return { type: 'wait', lane };   // 잘못 눌러도 MISS 아님
      this.state = 'help';
      this.pauseUntil = real + 0.95;
      this.sync = Math.min(100, this.sync + HELP_BONUS);
      this.hooks.onEvent?.('help', real);
      return { type: 'help', lane };
    }
    if (this.state !== 'play') return { type: 'ignored', lane };   // 회복 중 입력은 무시 (연속 MISS 방지)

    const t = this.#now(real) - (touch ? TOUCH_OFFSET : 0);
    const w = this.windows();
    const open = this.notes.filter((n) => !n.judged);
    const same = open.filter((n) => n.lane === lane).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
    const other = open.filter((n) => n.lane !== lane).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];

    if (same && Math.abs(same.t - t) <= w.good) {
      const d = t - same.t;
      const grade = Math.abs(d) <= w.perfect ? 'perfect' : 'good';
      return this.#judge(same, grade, real, { offset: d });
    }
    if (other && Math.abs(other.t - t) <= w.good) {
      return this.#judge(other, 'miss', real, { reason: 'wrong-foot', pressedLane: lane });
    }
    if (same && same.t - t > 0 && same.t - t <= EARLY_MISS) {
      return this.#judge(same, 'miss', real, { reason: 'early', pressedLane: lane });
    }
    // 노트와 상관없는 입력: 진행에 아무 영향 없음 (연타해도 이득 없음)
    this.stats.stray++;
    this.hooks.onStray?.(lane, real);
    return { type: 'stray', lane };
  }

  #judge(note, grade, real, info = {}) {
    note.judged = true;
    note.grade = grade;
    note.judgedAt = this.gameT;
    this.recent.push(grade);
    if (this.recent.length > 12) this.recent.shift();
    if (grade === 'miss') {
      this.stats.miss++;
      this.combo = 0;
      this.missStreak++;
      // 회복 모션 동안 시계 정지 — SYNC 가 높을수록 빨리 회복
      const dur = this.recoverDuration();
      this.state = 'recover';
      this.pauseUntil = real + dur;
      info.recover = dur;
    } else {
      this.stats[grade]++;
      this.missStreak = 0;
      this.combo++;
      const base = grade === 'perfect' ? GAIN_PERFECT : GAIN_GOOD;
      const bonus = (grade === 'perfect' ? COMBO_BONUS : COMBO_BONUS * 0.5) * Math.min(this.combo - 1, 8);
      // 서툰 관람객이 너무 오래 반복하지 않도록: 실수가 많았던 만큼, 그리고 함께 걸은 시간이 길어질수록
      // 성공 1회의 무게를 늘림 (성공해야만 오르므로 시간만으로는 완료되지 않음)
      const mercy = (1 + 0.06 * Math.min(this.stats.miss, 12)) * (1 + 0.025 * Math.min(Math.max(0, this.gameT - 32), 24));
      this.sync = Math.min(100, this.sync + (base + bonus) * mercy);
      // 친구의 실수 이벤트: SYNC 50~62% 구간에서 단 한 번, 정상 판정 '직후'에 시작
      if (!this.eventDone && this.sync >= EVENT_MIN && this.sync <= EVENT_MAX + 6 && this.eventPending < 0) {
        this.eventPending = this.gameT + 0.42;
      }
      if (this.sync >= 100) this.state = 'done';
    }
    this.hooks.onJudge?.(note, grade, { ...info, real, sync: this.sync });
    return { type: grade === 'miss' ? 'miss' : 'hit', grade, lane: note.lane, note, info };
  }

  recoverDuration() {
    return 1.3 - 0.4 * Math.min(1, this.sync / 80);    // 1.3s → 0.9s (SYNC 가 높을수록 빨리 회복)
  }

  #resume(real) {
    this.state = 'play';
    this.lastReal = real;
    const next = this.notes.filter((n) => !n.judged).sort((a, b) => a.t - b.t)[0];
    if (next && next.t - this.gameT < GRACE) {
      const shift = GRACE - (next.t - this.gameT);
      for (const n of this.notes) if (!n.judged) n.t += shift;
      this.nextPatternT += shift;
    }
  }

  /** 매 프레임 */
  update(real, dtReal) {
    if (this.lastReal === undefined) this.lastReal = real;
    if (this.state === 'play') this.gameT += Math.min(dtReal, 0.1);
    this.lastReal = real;

    if ((this.state === 'recover' || this.state === 'help') && real >= this.pauseUntil) {
      if (this.state === 'help') { this.eventDone = true; this.hooks.onEvent?.('resume', real); }
      if (this.sync >= 100) this.state = 'done'; else this.#resume(real);
    }
    if (this.state !== 'play') return;

    // 친구의 실수 이벤트 시작
    if (this.eventPending >= 0 && this.gameT >= this.eventPending) {
      this.eventPending = -1;
      this.state = 'event';
      this.eventDone = true;
      this.hooks.onEvent?.('slip', real);
      return;
    }

    // 지나쳐 버린 노트 = MISS
    const w = this.windows();
    for (const n of this.notes) {
      if (!n.judged && this.gameT - n.t > w.good) {
        this.timeoutsWithoutInput++;
        if (this.timeoutsWithoutInput >= 3) {
          // 아무도 입력하지 않으면 실수를 반복하지 않고 대기 상태로 (시간만으로는 완료되지 않음)
          n.judged = true; n.grade = 'skip';
          this.state = 'idle';
          this.hooks.onIdle?.(real);
          return;
        }
        this.#judge(n, 'miss', real, { reason: 'late' });
        return;
      }
    }
    this.#fill();
    // 오래된 노트 정리
    if (this.notes.length > 60) this.notes = this.notes.filter((n) => !n.judged || this.gameT - n.t < 2);
  }

  /** 다음에 눌러야 할 노트 (버튼 강조용) */
  upcoming() {
    if (this.state === 'event') return { lane: this.eventLane, dt: 0 };
    const n = this.notes.filter((x) => !x.judged).sort((a, b) => a.t - b.t)[0];
    return n ? { lane: n.lane, dt: n.t - this.gameT } : null;
  }
}
