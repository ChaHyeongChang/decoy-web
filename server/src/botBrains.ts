// 봇 두뇌. 모든 두뇌는 자기에게 온(정보 차단된) 스냅샷만 보고 입력을 정한다.
//  - 개발용(?bots=1, GAME_DESIGN 11장): 괴물은 제자리 회전 · 순찰, 생존자는 정해진 경로 순찰
//  - 시나리오용(테스트): 따라가서 공격, 거점 머물기, 구조, 탈출 같은 스크립트 행동
import {
  BTN,
  CAPTURE_POINTS,
  EXITS,
  RESCUE_POINT,
  emptyInput,
  type Balance,
  type GameEvent,
  type InputFrame,
  type MatchInfo,
  type MoverContext,
  type Snapshot,
  type SurvivorView,
  type Vec2,
} from '@decoy/shared';
import { PathFollower } from './pathfind';

/** 봇 두뇌: 스냅샷을 보고 다음 입력을 정한다 */
export interface BotBrain {
  decide(snap: Snapshot, info: MatchInfo, balance: Balance, seq: number): InputFrame;
}

export const idleBrain: BotBrain = {
  decide: (_snap, _info, _balance, seq) => emptyInput(seq),
};

export function moverOf(snap: Snapshot): MoverContext {
  const kind = snap.you.role === 'monster' ? 'monster' : 'survivor';
  return {
    kind,
    imprisoned: snap.you.surv?.status === 'imprisoned',
    openExits: {
      N: snap.world.exits.some((e) => e.id === 'N' && e.state === 'open'),
      S: snap.world.exits.some((e) => e.id === 'S' && e.state === 'open'),
    },
  };
}

export function aimAt(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 경로를 따라 목표로 가는 입력 */
/** 도착 판정 여유: 한 번 도착하면 이만큼 더 밀려나야 다시 걷는다 (지연된 스냅샷으로 제자리에서 흔들리지 않게) */
const HOLD_HYSTERESIS = 0.5;
/** 목표 이 거리 안에서는 입력 크기를 줄여 천천히 다가간다 (지연 때문에 목표를 지나치지 않게) */
const SLOW_RADIUS = 1.0;

export class Walker {
  private readonly follower = new PathFollower();
  private holding = false;
  private lastTarget: Vec2 | null = null;

  toward(snap: Snapshot, target: Vec2, tolerance = 0.25): { mx: number; my: number; arrived: boolean } {
    const me = snap.you.move;
    if (!this.lastTarget || dist(this.lastTarget, target) > 1e-6) this.holding = false;
    this.lastTarget = target;
    const d = dist(me, target);
    if (d <= (this.holding ? tolerance + HOLD_HYSTERESIS : tolerance)) {
      this.holding = true;
      return { mx: 0, my: 0, arrived: true };
    }
    this.holding = false;
    const v = this.follower.moveToward(me, target, moverOf(snap), snap.tick);
    const k = Math.max(0.25, Math.min(1, d / SLOW_RADIUS));
    return { mx: v.x * k, my: v.y * k, arrived: false };
  }
}

// ───────────────────────── 개발용 봇 (?bots=1) ─────────────────────────

/** 괴물 봇: 순찰 지점을 돌면서 조준을 천천히 돌린다. 공격하지 않는다 */
export class PatrolMonsterBrain implements BotBrain {
  private readonly walker = new Walker();
  private idx = 0;
  constructor(
    private readonly points: Vec2[] = [
      { x: 40, y: 16 },
      { x: 34, y: 26 },
      { x: 24, y: 24 },
      { x: 14, y: 26 },
      { x: 8, y: 16 },
      { x: 14, y: 6 },
      { x: 24, y: 9 },
      { x: 34, y: 6 },
    ],
  ) {}

  decide(snap: Snapshot, _info: MatchInfo, _b: Balance, seq: number): InputFrame {
    const target = this.points[this.idx % this.points.length] ?? { x: 24, y: 24 };
    const w = this.walker.toward(snap, target, 0.8);
    if (w.arrived) this.idx += 1;
    const aim = snap.you.move.face + 0.08;
    return { seq, mx: w.mx, my: w.my, aim, held: 0, pressed: 0 };
  }
}

/** 생존자 봇: 정해진 경로를 순찰한다 */
export class PatrolSurvivorBrain implements BotBrain {
  private readonly walker = new Walker();
  private idx = 0;
  constructor(private readonly points: Vec2[]) {}

  decide(snap: Snapshot, _info: MatchInfo, _b: Balance, seq: number): InputFrame {
    const target = this.points[this.idx % this.points.length] ?? { x: 24, y: 20 };
    const w = this.walker.toward(snap, target, 0.6);
    if (w.arrived) this.idx += 1;
    return { seq, mx: w.mx, my: w.my, aim: Number.NaN, held: 0, pressed: 0 };
  }
}

export function devBotBrain(role: string): BotBrain {
  switch (role) {
    case 'monster':
      return new PatrolMonsterBrain();
    case 'runner':
      return new PatrolSurvivorBrain([
        { x: 24, y: 20 },
        { x: 14, y: 22 },
        { x: 8, y: 26 },
        { x: 4, y: 16 },
      ]);
    case 'guard':
      return new PatrolSurvivorBrain([
        { x: 24, y: 20 },
        { x: 34, y: 18 },
        { x: 40, y: 12 },
        { x: 44, y: 20 },
      ]);
    default:
      return new PatrolSurvivorBrain([
        { x: 24, y: 20 },
        { x: 24, y: 26 },
        { x: 18, y: 29 },
        { x: 30, y: 29 },
      ]);
  }
}

// ───────────────────────── 시나리오 봇 ─────────────────────────

export interface HuntOptions {
  /** 보호 중인 생존자도 공격할지 (보호 무효 확인용) */
  attackProtected?: boolean;
  /** 아무도 안 보일 때 갈 곳 */
  patrol?: Vec2[];
  /** 공격 사거리 여유 (타일) */
  reach?: number;
}

/** 괴물 사냥 봇: 보이는 생존자 중 가장 가까운 자유 생존자를 쫓아 공격한다 */
export class HunterBrain implements BotBrain {
  private readonly walker = new Walker();
  private idx = 0;
  constructor(private readonly opts: HuntOptions = {}) {}

  pickTarget(snap: Snapshot): SurvivorView | null {
    const me = snap.you.move;
    let best: SurvivorView | null = null;
    for (const s of snap.survivors) {
      if (s.status !== 'free') continue;
      if (s.protected && !this.opts.attackProtected) continue;
      if (!best || dist(me, s) < dist(me, best)) best = s;
    }
    return best;
  }

  decide(snap: Snapshot, _info: MatchInfo, b: Balance, seq: number): InputFrame {
    const me = snap.you.move;
    const mon = snap.you.mon;
    const target = this.pickTarget(snap);
    if (target) {
      const d = dist(me, target);
      const reach = b.monster.attack.range + b.survivor.radius - (this.opts.reach ?? 0.25);
      const w = d > 0.8 ? this.walker.toward(snap, target, 0.5) : { mx: 0, my: 0 };
      const ready = mon !== null && mon.attackCd <= 0 && mon.windup <= 0;
      const facing =
        Math.abs(Math.atan2(Math.sin(aimAt(me, target) - me.face), Math.cos(aimAt(me, target) - me.face))) <
        0.35;
      const pressed = ready && d <= reach && facing ? BTN.ATTACK : 0;
      return { seq, mx: w.mx, my: w.my, aim: aimAt(me, target), held: 0, pressed };
    }
    const patrol = this.opts.patrol ?? [{ x: 24, y: 22 }];
    const goal = patrol[this.idx % patrol.length] ?? { x: 24, y: 22 };
    const w = this.walker.toward(snap, goal, 0.8);
    if (w.arrived) this.idx += 1;
    // 순찰 중에는 이동 방향으로, 멈춰 있으면 천천히 돌며 훑는다
    const aim = w.mx !== 0 || w.my !== 0 ? Math.atan2(w.my, w.mx) : me.face + 0.25;
    return { seq, mx: w.mx, my: w.my, aim, held: 0, pressed: 0 };
  }
}

/** 한 지점으로 가서 서 있는다 (버튼을 누른 채로) */
export class GoAndHoldBrain implements BotBrain {
  private readonly walker = new Walker();
  constructor(
    private readonly at: Vec2,
    private readonly held = 0,
    private readonly tolerance = 0.3,
  ) {}

  decide(snap: Snapshot, _info: MatchInfo, _b: Balance, seq: number): InputFrame {
    const w = this.walker.toward(snap, this.at, this.tolerance);
    return { seq, mx: w.mx, my: w.my, aim: Number.NaN, held: w.arrived ? this.held : 0, pressed: 0 };
  }
}

/** 단계별 두뇌: 조건이 맞으면 다음 단계로 */
export interface Phase {
  brain: BotBrain;
  /** 이 단계를 끝낼 조건 (마지막 단계는 없어도 된다) */
  until?: (snap: Snapshot, events: readonly GameEvent[]) => boolean;
}

export class PhasedBrain implements BotBrain {
  private idx = 0;
  private readonly seen: GameEvent[] = [];
  constructor(private readonly phases: Phase[]) {}

  get phase(): number {
    return this.idx;
  }

  decide(snap: Snapshot, info: MatchInfo, b: Balance, seq: number): InputFrame {
    this.seen.push(...snap.events);
    let p = this.phases[this.idx];
    while (p?.until && p.until(snap, this.seen) && this.idx < this.phases.length - 1) {
      this.idx += 1;
      this.seen.length = 0;
      p = this.phases[this.idx];
    }
    return p ? p.brain.decide(snap, info, b, seq) : emptyInput(seq);
  }
}

/** 자주 쓰는 지점 */
export const SPOTS = {
  rescue: RESCUE_POINT,
  pointA: CAPTURE_POINTS.A,
  pointB: CAPTURE_POINTS.B,
  exitN: EXITS.N.center,
  exitS: EXITS.S.center,
  exitNDoor: { x: 24, y: 0.5 },
  exitSDoor: { x: 24, y: 31.5 },
} as const;
