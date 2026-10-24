// 지연 대응: 내 캐릭터 예측 + 보정, 다른 캐릭터 100ms 보간
import { writePiece, type TravelPiece } from './art/anim';
import {
  angleDiff,
  cloneMoveState,
  normalizeAngle,
  stepMovement,
  type Balance,
  type InputFrame,
  type MoveEnv,
  type MoveState,
} from '@decoy/shared';

/** 보정 어긋남이 이보다 작으면 0으로 본다 (타일) */
const ERR_EPSILON = 1e-4;

/**
 * 내 캐릭터 예측기. 그리는 자리 = 직전 틱 상태(prev) → 지금 틱 상태(state)를 그 틱의 명목 시각(stepAt)부터 틱 길이 동안 보간한
 * 자리 + 보정 어긋남(서서히 0으로). 내 움직임 고르기(2026-10-24):
 *  - 보간 비율은 입력 틱을 실제로 처리한 시각이 아니라 명목 시각(입력 틱 격자, applyLocal의 atMs)부터 잰다. 처리 시각으로 재면
 *    타이머가 늦게 깬 만큼 멈췄다가 다음 틱이 일찍 와서 앞으로 튀었다
 *  - 보정 뒤에도 보간 구간을 지킨다: 서버가 마지막 입력까지 처리해 다시 적용할 입력이 없으면 직전 틱 상태를 모르므로, 예전
 *    직전 상태를 보정량만큼 옮겨 쓴다(예전에는 prev = state가 되어 남은 구간만큼 앞으로 튀고 다음 틱까지 멈췄다 — 기기 안 연습은
 *    거의 늘 그랬다). 보정 어긋남은 '그 순간 그린 자리'끼리의 차이로 잡아 한 번에 튀지 않고 줄어든다
 *  - 한 틱 앞 구간도 들고 있다(prev2 → prev, stepAt2): 타이머가 프레임의 vsync 뒤 · 콜백 앞에 깨어 마지막 틱의 명목 시각이 그리는
 *    시각보다 늦으면, 마지막 구간 처음(prev)이 아니라 그 앞 구간에서 그 시각 자리를 그린다(느린 기기에서 한 프레임 앞서 보였다가
 *    다음 프레임에 멈칫하던 것)
 */
export class Predictor {
  private pending: InputFrame[] = [];
  state: MoveState | null = null;
  /** 마지막 입력을 적용하기 직전 상태 (틱 사이를 부드럽게 그리기 위해) */
  private prev: MoveState | null = null;
  /** 마지막으로 적용한 입력 틱의 명목 시각 (그린 자리가 prev → state로 가기 시작하는 시각). 모르면 null */
  private stepAt: number | null = null;
  /** 그 앞 입력 틱: 직전 상태(prev)를 만들기 직전 상태와 그 틱의 명목 시각 (prev2 → prev 구간). 모르면 null */
  private prev2: MoveState | null = null;
  private stepAt2: number | null = null;
  private readonly dtMs: number;
  /**
   * 보정으로 생긴 화면상 어긋남 (서서히 0으로): errAt 시각의 값. 지금 값 = 그 값 × e^(−(지금 − errAt) / (τ / 3)).
   * 렌더링 최적화: 프레임마다 곱해 가면 보정이 생긴 프레임에 그 전 시간까지 줄어들어 fps마다 달랐다. 보정 순간부터 잰다
   */
  private errX = 0;
  private errY = 0;
  private errAt = 0;
  /** renderPos가 시각(nowMs)을 받았는가. 받지 않으면(단위 시험 · 옛 호출) 넘겨준 프레임 간격을 더한 시계를 쓴다 */
  private timed = false;
  /** 프레임 간격을 더한 시계 (timed가 아닐 때) */
  private frameClock = 0;
  /** 최근 보정 크기 (디버그용, 타일) */
  lastCorrection = 0;
  lastAck = 0;
  /**
   * 서버 판정을 기다리지 않고 내 화면에 먼저 보여 줄 행동 (입력 seq → 이동 상태 변경, 예: 공격 준비 조준 고정 · 돌진).
   * 그 입력을 서버가 처리했다고 알려 오면 지운다. 판정은 여전히 서버가 하고, 어긋나면 보정된다
   */
  private actions = new Map<number, (s: MoveState) => void>();

  /** clock: reconcile 순간의 시각 (renderPos가 시각을 받을 때 같은 시계, 기본 performance.now) */
  constructor(
    private readonly balance: Balance,
    private readonly dt: number,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.dtMs = dt * 1000;
  }

  reset(): void {
    this.pending = [];
    this.actions.clear();
    this.state = null;
    this.prev = null;
    this.stepAt = null;
    this.prev2 = null;
    this.stepAt2 = null;
    this.errX = 0;
    this.errY = 0;
    this.errAt = this.timed ? this.clock() : this.frameClock;
  }

  /** 시각 t의 보간 비율 (0~1): 명목 시각을 모르면 1(지금 틱 상태) */
  alphaAt(t: number): number {
    if (this.stepAt === null) return 1;
    return Math.max(0, Math.min(1, (t - this.stepAt) / this.dtMs));
  }

  /** 마지막 입력 틱의 명목 시각 (모르면 null, 디버그 · 시험) */
  get lastStepAt(): number | null {
    return this.stepAt;
  }

  /** baseAt이 돌려주는 값 (프레임마다 새로 만들지 않는다: 받은 쪽은 바로 읽고 버린다) */
  private readonly baseNow = { x: 0, y: 0, face: 0 };

  /**
   * 시각 t의 보간 자리 (보정 어긋남 빼고). t가 마지막 틱 명목 시각 뒤면 prev → state, 앞이면 그 앞 구간 prev2 → prev.
   * 명목 시각을 모르면 alpha(없으면 1)로 prev → state. 순간이동(snapDistance 넘게)한 구간은 보간하지 않고 끝 자리
   */
  private baseAt(t: number, alpha?: number): { x: number; y: number; face: number } {
    const out = this.baseNow;
    const s = this.state;
    if (!s) return out;
    let a: MoveState = this.prev ?? s;
    let b: MoveState = s;
    let k: number;
    if (alpha !== undefined || this.stepAt === null) {
      k = Math.max(0, Math.min(1, alpha ?? 1));
    } else if (t < this.stepAt && this.prev2 && this.stepAt2 !== null && this.prev) {
      a = this.prev2;
      b = this.prev;
      k = Math.max(0, Math.min(1, (t - this.stepAt2) / this.dtMs));
    } else {
      k = this.alphaAt(t);
    }
    if (Math.hypot(b.x - a.x, b.y - a.y) > this.balance.network.snapDistance) k = 1;
    out.x = lerpNum(a.x, b.x, k);
    out.y = lerpNum(a.y, b.y, k);
    out.face = k >= 1 ? b.face : lerpAngle(a.face, b.face, k);
    return out;
  }

  /** errAtTime이 돌려주는 값 (프레임마다 새로 만들지 않는다: 받은 쪽은 바로 읽고 버린다) */
  private readonly errNow = { x: 0, y: 0 };

  /** 시각 t의 보정 어긋남 (errAt부터 지수로 줄어든다, 아주 작으면 0) */
  private errAtTime(t: number): { readonly x: number; readonly y: number } {
    const tau = Math.max(1, this.balance.network.correctionSmoothMs);
    const k = Math.exp(-Math.max(0, t - this.errAt) / (tau / 3));
    const x = this.errX * k;
    const y = this.errY * k;
    this.errNow.x = Math.abs(x) < ERR_EPSILON ? 0 : x;
    this.errNow.y = Math.abs(y) < ERR_EPSILON ? 0 : y;
    return this.errNow;
  }

  /** applyLocal 전에 부른다: 이 입력을 적용할 때 이동 상태에 먼저 반영할 행동 */
  predictAction(seq: number, apply: (s: MoveState) => void): void {
    this.actions.set(seq, apply);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** 그리는 자리가 이번 틱 사이에 직선으로 가는 거리 (직전 틱 상태 → 지금 상태, 타일): 내 캐릭터 걷기 위상 */
  get stepDistance(): number {
    const s = this.state;
    if (!s) return 0;
    const p = this.prev ?? s;
    const jump = Math.hypot(s.x - p.x, s.y - p.y);
    // 순간이동(수감 · 스폰)한 틱은 보간하지 않으므로 걷지 않는다 (renderPos와 같은 판단)
    return jump > this.balance.network.snapDistance ? 0 : jump;
  }

  /**
   * 입력을 보내는 순간 바로 움직인다. atMs = 이 입력 틱의 명목 시각(입력 틱 격자 위 — 늦게 깬 타이머의 처리 시각이 아니다):
   * 그린 자리는 이 시각부터 틱 길이 동안 직전 상태 → 새 상태로 간다. 주지 않으면(단위 시험 · 옛 호출) renderPos에 준 비율을 쓴다
   */
  applyLocal(frame: InputFrame, env: MoveEnv, atMs?: number): void {
    if (!this.state) return;
    this.pending.push(frame);
    if (this.pending.length > 120) this.pending.shift();
    this.prev2 = this.prev;
    this.prev = cloneMoveState(this.state);
    this.actions.get(frame.seq)?.(this.state);
    stepMovement(this.state, frame, env, this.balance, this.dt);
    if (atMs !== undefined && Number.isFinite(atMs)) {
      this.stepAt2 = this.stepAt;
      this.stepAt = atMs;
    }
  }

  /** 서버 상태를 받으면 그 이후 입력을 다시 적용해 맞춘다 */
  reconcile(server: MoveState, ack: number, env: MoveEnv): void {
    this.lastAck = ack;
    this.pending = this.pending.filter((f) => f.seq > ack);
    for (const seq of this.actions.keys()) if (seq <= ack) this.actions.delete(seq);
    const old = this.state;
    const oldPrev = this.prev ?? old;
    const oldPrev2 = this.prev2;
    const at = this.timed ? this.clock() : this.frameClock;
    // 보정 직전에 그리던 자리 (같은 시각 · 같은 입력 틱 구간에서 견준다)
    const errBefore = this.errAtTime(at);
    const shown = this.baseAt(at);
    const shownX = shown.x + errBefore.x;
    const shownY = shown.y + errBefore.y;
    // 서버 상태부터 대기 입력을 다시 적용한 상태들: 마지막이 지금 상태, 그 앞 둘이 직전 · 그 앞 (있으면)
    const chain: MoveState[] = [cloneMoveState(server)];
    for (const f of this.pending) {
      const nextState = cloneMoveState(chain[chain.length - 1] ?? server);
      this.actions.get(f.seq)?.(nextState);
      stepMovement(nextState, f, env, this.balance, this.dt);
      chain.push(nextState);
    }
    const n = chain.length;
    const next = chain[n - 1] ?? cloneMoveState(server);
    // 순간이동(수감 · 스폰, snapDistance 넘게)은 잇지 않는다 — 새 자리에 바로 서고 걷지 않는다
    const keep =
      old !== null &&
      oldPrev !== null &&
      Math.hypot(next.x - old.x, next.y - old.y) <= this.balance.network.snapDistance;
    // 다시 적용할 입력이 모자라면(서버가 마지막 입력까지 처리) 앞 상태는 예전 상태를 같은 틱의 보정량만큼 옮겨 구간을 잇는다
    const prev =
      chain[n - 2] ?? (keep && old && oldPrev ? shifted(oldPrev, old, next) : cloneMoveState(next));
    this.prev = prev;
    this.prev2 = chain[n - 3] ?? (keep && oldPrev2 && oldPrev ? shifted(oldPrev2, oldPrev, prev) : null);
    this.state = next;
    if (old) {
      // 그리던 자리 − 보정 뒤 같은 시각에 그릴 자리 = 이번 어긋남(지금 보이던 어긋남 포함). 이 순간부터 다시 줄어든다
      const after = this.baseAt(at);
      const dx = shownX - after.x;
      const dy = shownY - after.y;
      const d = Math.hypot(dx, dy);
      this.lastCorrection = Math.hypot(old.x - next.x, old.y - next.y);
      if (d > this.balance.network.snapDistance) {
        this.errX = 0;
        this.errY = 0;
      } else {
        this.errX = dx;
        this.errY = dy;
      }
      this.errAt = at;
    }
  }

  /**
   * 화면에 그릴 위치. alpha(0~1)로 직전 틱과 지금 틱 사이를 보간하고(30Hz 계단 방지),
   * 보정 어긋남은 correctionSmoothMs 동안 줄인다. nowMs(이 프레임 시각)를 주면 보정 순간부터 잰 시간으로 줄이고
   * (프레임 수와 무관, 렌더링 최적화), 주지 않으면 프레임 간격 frameMs를 더한 시계로 줄인다.
   * alpha를 주지 않으면 nowMs와 마지막 입력 틱의 명목 시각으로 잰다(alphaAt, 명목 시각을 모르면 1)
   */
  renderPos(frameMs: number, alpha?: number, nowMs?: number): { x: number; y: number; face: number } | null {
    let t: number;
    if (nowMs !== undefined) {
      // 처음 시각을 받으면 지금까지의 어긋남을 이 순간 값으로 둔다
      if (!this.timed) {
        const err = this.errAtTime(this.frameClock);
        this.errX = err.x;
        this.errY = err.y;
        this.errAt = nowMs;
        this.timed = true;
      }
      t = nowMs;
    } else {
      this.frameClock += Math.max(0, frameMs);
      t = this.frameClock;
    }
    if (!this.state) return null;
    const err = this.errAtTime(t);
    // 순간이동(수감 · 스폰)처럼 크게 바뀐 틱은 보간하지 않는다 (baseAt)
    const base = this.baseAt(t, alpha);
    return { x: base.x + err.x, y: base.y + err.y, face: base.face };
  }
}

/**
 * 보정한 이력 칸 하나: 예전 상태 s를 그다음 칸의 보정량(예전 from → 새 to)만큼 옮긴 복사본 (자리 · 바라보는 방향만 옮기고 나머지는 새 칸 것)
 */
function shifted(s: MoveState, from: MoveState, to: MoveState): MoveState {
  const p = cloneMoveState(to);
  p.x = s.x + (to.x - from.x);
  p.y = s.y + (to.y - from.y);
  p.face = normalizeAngle(s.face + angleDiff(from.face, to.face));
  return p;
}

export interface InterpSample<T> {
  t: number;
  v: T;
}

/** 엔티티 하나의 보간 버퍼 */
class Track<T> {
  samples: InterpSample<T>[] = [];
  /** 마지막으로 받은 스냅샷 번호 */
  lastSeen = -1;
}

export interface Lerpable {
  x: number;
  y: number;
}

/**
 * 다른 캐릭터 보간기. renderTime(= 서버 시각 − 100ms)에서 앞뒤 두 스냅샷 사이를 보간한다.
 * 스냅샷에서 빠졌다가 다시 나타나면 버퍼를 새로 시작한다 (안개 속을 미끄러지며 경로가 드러나지 않게).
 */
export class Interpolator<T extends Lerpable> {
  private tracks = new Map<string, Track<T>>();
  private snapIndex = 0;

  constructor(private readonly lerp: (a: T, b: T, k: number) => T) {}

  /** 스냅샷 하나에 들어 있던 엔티티들을 넣는다 */
  push(t: number, entities: ReadonlyArray<{ id: string; v: T }>): void {
    this.snapIndex += 1;
    for (const e of entities) {
      let track = this.tracks.get(e.id);
      if (!track) {
        track = new Track<T>();
        this.tracks.set(e.id, track);
      }
      if (track.lastSeen !== this.snapIndex - 1) track.samples = [];
      track.lastSeen = this.snapIndex;
      track.samples.push({ t, v: e.v });
      if (track.samples.length > 40) track.samples.shift();
    }
    for (const [id, track] of this.tracks) {
      if (this.snapIndex - track.lastSeen > 40) this.tracks.delete(id);
    }
  }

  clear(): void {
    this.tracks.clear();
  }

  /** 렌더 시각 r0 → r1 사이에 id가 보간 경로를 따라 움직인 조각들 (travelOf): 쓴 조각 수, 트랙이 없으면 −1 */
  travel(id: string, r0: number, r1: number, out: TravelPiece[]): number {
    const track = this.tracks.get(id);
    return track ? travelOf(track.samples, r0, r1, out) : -1;
  }

  /**
   * 렌더 시각 (r0, r1] 사이에 id의 상태(위치 말고 보간하지 않는 값: 뒤 표본 값)가 바뀔 수 있었던 마지막 경계 (렌더 시각).
   * sample은 [a.t, b.t) 동안 뒤 표본 b의 값을 쓰므로 표본 시각 a.t(마지막 표본 제외)마다 바뀐다. 사라진 엔티티는 마지막 표본 시각.
   * 경계를 지나지 않았으면 null (새로 나타난 트랙처럼 스냅샷을 받은 순간 바뀐 것)
   */
  edgeAt(id: string, r0: number, r1: number): number | null {
    const track = this.tracks.get(id);
    if (!track) return null;
    const s = track.samples;
    const last = s[s.length - 1];
    if (!last) return null;
    if (track.lastSeen !== this.snapIndex && last.t >= r0 && last.t < r1) return last.t;
    for (let i = s.length - 2; i >= 0; i -= 1) {
      const t = s[i]?.t;
      if (t === undefined || t <= r0) break;
      if (t <= r1) return t;
    }
    return null;
  }

  /** renderTime 시점의 엔티티들. 이미 사라진 엔티티는 마지막 표본 시각이 지나면 빠진다 */
  sample(renderTime: number): Map<string, T> {
    const out = new Map<string, T>();
    for (const [id, track] of this.tracks) {
      const s = track.samples;
      const first = s[0];
      const last = s[s.length - 1];
      if (!first || !last) continue;
      const gone = track.lastSeen !== this.snapIndex;
      if (gone && renderTime > last.t) continue;
      if (renderTime <= first.t) {
        // 버퍼가 새로 시작된 엔티티: 첫 표본에 바로 둔다
        if (!gone || renderTime >= first.t - 1000) out.set(id, first.v);
        continue;
      }
      if (renderTime >= last.t) {
        out.set(id, last.v);
        continue;
      }
      for (let i = s.length - 2; i >= 0; i -= 1) {
        const a = s[i];
        const b = s[i + 1];
        if (!a || !b) continue;
        if (a.t <= renderTime) {
          const k = b.t > a.t ? (renderTime - a.t) / (b.t - a.t) : 1;
          out.set(id, this.lerp(a.v, b.v, k));
          break;
        }
      }
    }
    return out;
  }
}

/**
 * 보간 경로 위치를 into에 쓴다 (sample과 같은 식: 첫 표본 전 · 마지막 표본 뒤는 그 표본 자리, 사이는 앞뒤 표본의 직선 보간).
 * travel이 꺾인 점 사이를 잴 때 쓴다. 표본이 없으면 false
 */
function pathPos<T extends Lerpable>(s: readonly InterpSample<T>[], r: number, into: Lerpable): boolean {
  const first = s[0];
  const last = s[s.length - 1];
  if (!first || !last) return false;
  let x = first.v.x;
  let y = first.v.y;
  if (r >= last.t) {
    x = last.v.x;
    y = last.v.y;
  } else if (r > first.t) {
    for (let i = s.length - 2; i >= 0; i -= 1) {
      const a = s[i];
      const b = s[i + 1];
      if (!a || !b) continue;
      if (a.t <= r) {
        const k = b.t > a.t ? (r - a.t) / (b.t - a.t) : 1;
        x = lerpNum(a.v.x, b.v.x, k);
        y = lerpNum(a.v.y, b.v.y, k);
        break;
      }
    }
  }
  into.x = x;
  into.y = y;
  return true;
}

/** travelOf가 꺾인 점 둘을 번갈아 쓰는 자리 (호출 안에서만 쓰고 밖에 내주지 않는다) */
const PATH_A: Lerpable = { x: 0, y: 0 };
const PATH_B: Lerpable = { x: 0, y: 0 };

/**
 * 보간 경로를 따라 렌더 시각 r0 → r1 사이에 움직인 조각들 (렌더링 최적화: 걷기 위상 · 자세를 프레임 수와 무관하게).
 * 표본 시각(꺾인 점)마다 나눠서, 프레임 사이 직선(현)으로 재면 모퉁이를 깎아 120fps가 더 멀리 걸은 것으로 되던 것을 없앤다.
 * 조각은 시간 순서 { ms(렌더 시간), dist(타일) }로 out 앞에서부터 쓰고(writePiece) 쓴 수를 돌려준다. 표본이 없으면 −1
 */
export function travelOf<T extends Lerpable>(
  samples: readonly InterpSample<T>[],
  r0: number,
  r1: number,
  out: TravelPiece[],
): number {
  if (samples.length === 0) return -1;
  if (!(r1 > r0)) return 0;
  let n = 0;
  let t = r0;
  let p = PATH_A;
  let q = PATH_B;
  pathPos(samples, r0, p);
  for (const smp of samples) {
    if (smp.t <= t) continue;
    if (smp.t >= r1) break;
    pathPos(samples, smp.t, q);
    writePiece(out, n++, smp.t - t, Math.hypot(q.x - p.x, q.y - p.y));
    t = smp.t;
    const swap = p;
    p = q;
    q = swap;
  }
  pathPos(samples, r1, q);
  writePiece(out, n++, r1 - t, Math.hypot(q.x - p.x, q.y - p.y));
  return n;
}

export function lerpNum(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

export function lerpAngle(a: number, b: number, k: number): number {
  return normalizeAngle(a + angleDiff(a, b) * k);
}

/**
 * 스냅샷 시계: (스냅샷 서버 시각 − 도착 시각)의 최근 2초 최댓값을 오프셋으로 쓴다.
 * ping으로 잰 서버 시각과 달리 단방향 지연이 포함되므로, renderTime = 지금 + 오프셋 − 100ms 가
 * 항상 받은 스냅샷 사이에 떨어진다 (lag 200에서도 보간이 꺼지지 않는다).
 */
export class SnapshotClock {
  private samples: { at: number; v: number }[] = [];
  offset = 0;

  add(serverMs: number, localMs: number): void {
    this.samples.push({ at: localMs, v: serverMs - localMs });
    while (this.samples.length > 0 && localMs - (this.samples[0]?.at ?? localMs) > 2000) this.samples.shift();
    let best = -Infinity;
    for (const s of this.samples) if (s.v > best) best = s.v;
    this.offset = best;
  }

  reset(): void {
    this.samples = [];
  }

  now(localMs: number): number {
    return localMs + this.offset;
  }
}
