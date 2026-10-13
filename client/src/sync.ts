// 지연 대응: 내 캐릭터 예측 + 보정, 다른 캐릭터 100ms 보간
import type { TravelPiece } from './art/anim';
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

/** 내 캐릭터 예측기 */
export class Predictor {
  private pending: InputFrame[] = [];
  state: MoveState | null = null;
  /** 마지막 입력을 적용하기 직전 상태 (틱 사이를 부드럽게 그리기 위해) */
  private prev: MoveState | null = null;
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
  ) {}

  reset(): void {
    this.pending = [];
    this.actions.clear();
    this.state = null;
    this.prev = null;
    this.errX = 0;
    this.errY = 0;
    this.errAt = this.timed ? this.clock() : this.frameClock;
  }

  /** 시각 t의 보정 어긋남 (errAt부터 지수로 줄어든다, 아주 작으면 0) */
  private errAtTime(t: number): { x: number; y: number } {
    const tau = Math.max(1, this.balance.network.correctionSmoothMs);
    const k = Math.exp(-Math.max(0, t - this.errAt) / (tau / 3));
    const x = this.errX * k;
    const y = this.errY * k;
    return { x: Math.abs(x) < ERR_EPSILON ? 0 : x, y: Math.abs(y) < ERR_EPSILON ? 0 : y };
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

  /** 입력을 보내는 순간 바로 움직인다 */
  applyLocal(frame: InputFrame, env: MoveEnv): void {
    if (!this.state) return;
    this.pending.push(frame);
    if (this.pending.length > 120) this.pending.shift();
    this.prev = cloneMoveState(this.state);
    this.actions.get(frame.seq)?.(this.state);
    stepMovement(this.state, frame, env, this.balance, this.dt);
  }

  /** 서버 상태를 받으면 그 이후 입력을 다시 적용해 맞춘다 */
  reconcile(server: MoveState, ack: number, env: MoveEnv): void {
    this.lastAck = ack;
    this.pending = this.pending.filter((f) => f.seq > ack);
    for (const seq of this.actions.keys()) if (seq <= ack) this.actions.delete(seq);
    const prev = this.state;
    const next = cloneMoveState(server);
    let before = cloneMoveState(next);
    for (const f of this.pending) {
      before = cloneMoveState(next);
      this.actions.get(f.seq)?.(next);
      stepMovement(next, f, env, this.balance, this.dt);
    }
    this.prev = before;
    if (prev) {
      // 지금 보이는 어긋남(보정 순간까지 줄어든 값)에 이번 보정을 더한다. 이 순간부터 다시 줄어든다
      const at = this.timed ? this.clock() : this.frameClock;
      const err = this.errAtTime(at);
      const dx = prev.x + err.x - next.x;
      const dy = prev.y + err.y - next.y;
      const d = Math.hypot(dx, dy);
      this.lastCorrection = Math.hypot(prev.x - next.x, prev.y - next.y);
      if (d > this.balance.network.snapDistance) {
        this.errX = 0;
        this.errY = 0;
      } else {
        this.errX = dx;
        this.errY = dy;
      }
      this.errAt = at;
    }
    this.state = next;
  }

  /**
   * 화면에 그릴 위치. alpha(0~1)로 직전 틱과 지금 틱 사이를 보간하고(30Hz 계단 방지),
   * 보정 어긋남은 correctionSmoothMs 동안 줄인다. nowMs(이 프레임 시각)를 주면 보정 순간부터 잰 시간으로 줄이고
   * (프레임 수와 무관, 렌더링 최적화), 주지 않으면 프레임 간격 frameMs를 더한 시계로 줄인다
   */
  renderPos(frameMs: number, alpha = 1, nowMs?: number): { x: number; y: number; face: number } | null {
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
    const a = Math.max(0, Math.min(1, alpha));
    const p = this.prev ?? this.state;
    // 순간이동(수감 · 스폰)처럼 크게 바뀐 틱은 보간하지 않는다
    const jump = Math.hypot(this.state.x - p.x, this.state.y - p.y) > this.balance.network.snapDistance;
    const base = jump
      ? this.state
      : {
          x: lerpNum(p.x, this.state.x, a),
          y: lerpNum(p.y, this.state.y, a),
          face: lerpAngle(p.face, this.state.face, a),
        };
    return { x: base.x + err.x, y: base.y + err.y, face: base.face };
  }
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

  /** 렌더 시각 r0 → r1 사이에 id가 보간 경로를 따라 움직인 조각들 (travelOf). 트랙이 없으면 false */
  travel(id: string, r0: number, r1: number, out: TravelPiece[]): boolean {
    const track = this.tracks.get(id);
    if (!track) {
      out.length = 0;
      return false;
    }
    return travelOf(track.samples, r0, r1, out);
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
 * 보간 경로 위치 (sample과 같은 식: 첫 표본 전 · 마지막 표본 뒤는 그 표본 자리, 사이는 앞뒤 표본의 직선 보간).
 * travel이 꺾인 점 사이를 잴 때 쓴다
 */
function pathPos<T extends Lerpable>(s: readonly InterpSample<T>[], r: number): Lerpable | null {
  const first = s[0];
  const last = s[s.length - 1];
  if (!first || !last) return null;
  if (r <= first.t) return first.v;
  if (r >= last.t) return last.v;
  for (let i = s.length - 2; i >= 0; i -= 1) {
    const a = s[i];
    const b = s[i + 1];
    if (!a || !b) continue;
    if (a.t <= r) {
      const k = b.t > a.t ? (r - a.t) / (b.t - a.t) : 1;
      return { x: lerpNum(a.v.x, b.v.x, k), y: lerpNum(a.v.y, b.v.y, k) };
    }
  }
  return first.v;
}

/**
 * 보간 경로를 따라 렌더 시각 r0 → r1 사이에 움직인 조각들 (렌더링 최적화: 걷기 위상 · 자세를 프레임 수와 무관하게).
 * 표본 시각(꺾인 점)마다 나눠서, 프레임 사이 직선(현)으로 재면 모퉁이를 깎아 120fps가 더 멀리 걸은 것으로 되던 것을 없앤다.
 * 조각은 시간 순서 { ms(렌더 시간), dist(타일) }. 트랙이 없으면 false
 */
export function travelOf<T extends Lerpable>(
  samples: readonly InterpSample<T>[],
  r0: number,
  r1: number,
  out: TravelPiece[],
): boolean {
  out.length = 0;
  if (samples.length === 0) return false;
  if (!(r1 > r0)) return true;
  let t = r0;
  let p = pathPos(samples, r0);
  for (const smp of samples) {
    if (smp.t <= t) continue;
    if (smp.t >= r1) break;
    const q = pathPos(samples, smp.t);
    if (p && q) out.push({ ms: smp.t - t, dist: Math.hypot(q.x - p.x, q.y - p.y) });
    t = smp.t;
    p = q;
  }
  const q = pathPos(samples, r1);
  if (p && q) out.push({ ms: r1 - t, dist: Math.hypot(q.x - p.x, q.y - p.y) });
  return true;
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
