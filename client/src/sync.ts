// 지연 대응: 내 캐릭터 예측 + 보정, 다른 캐릭터 100ms 보간
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

/** 내 캐릭터 예측기 */
export class Predictor {
  private pending: InputFrame[] = [];
  state: MoveState | null = null;
  /** 마지막 입력을 적용하기 직전 상태 (틱 사이를 부드럽게 그리기 위해) */
  private prev: MoveState | null = null;
  /** 보정으로 생긴 화면상 어긋남 (서서히 0으로) */
  private errX = 0;
  private errY = 0;
  /** 최근 보정 크기 (디버그용, 타일) */
  lastCorrection = 0;
  lastAck = 0;
  /**
   * 서버 판정을 기다리지 않고 내 화면에 먼저 보여 줄 행동 (입력 seq → 이동 상태 변경, 예: 공격 준비 조준 고정 · 돌진).
   * 그 입력을 서버가 처리했다고 알려 오면 지운다. 판정은 여전히 서버가 하고, 어긋나면 보정된다
   */
  private actions = new Map<number, (s: MoveState) => void>();

  constructor(
    private readonly balance: Balance,
    private readonly dt: number,
  ) {}

  reset(): void {
    this.pending = [];
    this.actions.clear();
    this.state = null;
    this.prev = null;
    this.errX = 0;
    this.errY = 0;
  }

  /** applyLocal 전에 부른다: 이 입력을 적용할 때 이동 상태에 먼저 반영할 행동 */
  predictAction(seq: number, apply: (s: MoveState) => void): void {
    this.actions.set(seq, apply);
  }

  get pendingCount(): number {
    return this.pending.length;
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
      const dx = prev.x + this.errX - next.x;
      const dy = prev.y + this.errY - next.y;
      const d = Math.hypot(dx, dy);
      this.lastCorrection = Math.hypot(prev.x - next.x, prev.y - next.y);
      if (d > this.balance.network.snapDistance) {
        this.errX = 0;
        this.errY = 0;
      } else {
        this.errX = dx;
        this.errY = dy;
      }
    }
    this.state = next;
  }

  /**
   * 화면에 그릴 위치. alpha(0~1)로 직전 틱과 지금 틱 사이를 보간하고(30Hz 계단 방지),
   * 보정 어긋남은 correctionSmoothMs 동안 줄인다
   */
  renderPos(frameMs: number, alpha = 1): { x: number; y: number; face: number } | null {
    if (!this.state) return null;
    const tau = Math.max(1, this.balance.network.correctionSmoothMs);
    const k = Math.exp(-frameMs / (tau / 3));
    this.errX *= k;
    this.errY *= k;
    if (Math.abs(this.errX) < 1e-4) this.errX = 0;
    if (Math.abs(this.errY) < 1e-4) this.errY = 0;
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
    return { x: base.x + this.errX, y: base.y + this.errY, face: base.face };
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
