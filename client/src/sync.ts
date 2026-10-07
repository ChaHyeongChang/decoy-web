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
  /** 보정으로 생긴 화면상 어긋남 (서서히 0으로) */
  private errX = 0;
  private errY = 0;
  /** 최근 보정 크기 (디버그용, 타일) */
  lastCorrection = 0;
  lastAck = 0;

  constructor(
    private readonly balance: Balance,
    private readonly dt: number,
  ) {}

  reset(): void {
    this.pending = [];
    this.state = null;
    this.errX = 0;
    this.errY = 0;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** 입력을 보내는 순간 바로 움직인다 */
  applyLocal(frame: InputFrame, env: MoveEnv): void {
    if (!this.state) return;
    this.pending.push(frame);
    if (this.pending.length > 120) this.pending.shift();
    stepMovement(this.state, frame, env, this.balance, this.dt);
  }

  /** 서버 상태를 받으면 그 이후 입력을 다시 적용해 맞춘다 */
  reconcile(server: MoveState, ack: number, env: MoveEnv): void {
    this.lastAck = ack;
    this.pending = this.pending.filter((f) => f.seq > ack);
    const prev = this.state;
    const next = cloneMoveState(server);
    for (const f of this.pending) stepMovement(next, f, env, this.balance, this.dt);
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

  /** 화면에 그릴 위치 (보정 어긋남을 correctionSmoothMs 동안 줄인다) */
  renderPos(frameMs: number): { x: number; y: number; face: number } | null {
    if (!this.state) return null;
    const tau = Math.max(1, this.balance.network.correctionSmoothMs);
    const k = Math.exp(-frameMs / (tau / 3));
    this.errX *= k;
    this.errY *= k;
    if (Math.abs(this.errX) < 1e-4) this.errX = 0;
    if (Math.abs(this.errY) < 1e-4) this.errY = 0;
    return { x: this.state.x + this.errX, y: this.state.y + this.errY, face: this.state.face };
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
