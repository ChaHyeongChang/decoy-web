// 실전 봇 두뇌: 생존자 (M13b, 플레이테스트 반영 c에서 practiceBrains.ts에서 나눔).
// 두뇌는 decide()로 받은 것 — 자기에게 온 스냅샷 · MatchInfo · Balance — 과 공개 지도만 본다. 시드 난수 Rng만 쓴다
import {
  BTN,
  CAPTURE_POINTS,
  POINT_IDS,
  EXITS,
  RESCUE_POINT,
  Rng,
  blocksStrike,
  emptyInput,
  lineOfSight,
  segmentBlocked,
  type Balance,
  type ExitId,
  type InputFrame,
  type MatchInfo,
  type PointId,
  type RoleId,
  type Snapshot,
  type SurvivorView,
  type Vec2,
} from '../index';
import { Walker, dist, type BotBrain } from './botBrains';
import {
  brainRng,
  clearPath,
  EXIT_DOORS,
  EXIT_IDS,
  EXIT_INWARD,
  fieldFrom,
  FLEE_SPOTS,
  localPathDist,
  opennessOf,
  pathDist,
  pointOpen,
  snapToFloor,
  STUCK_MOVE,
  STUCK_TICKS,
  W,
  walkableAt,
} from './practiceMap';

// ───────────────────────── 생존자 ─────────────────────────

/** 괴물이 이 거리(타일) 안에 보이면 달아난다 (역할별) */
const FLEE_DIST: Readonly<Record<RoleId, number>> = { runner: 6.5, guard: 6.0, scout: 7.0 };
/** 부상(체력 1)이면 도주 거리에 더한다 (타일) */
const FLEE_INJURED_BONUS = 1.0;
/** 이미 달아나는 중이면 이만큼 더 멀어질 때까지 계속 (타일) */
const FLEE_HYST = 1.5;
/** 밀치기가 준비된 가드는 이 거리까지 버틴다 (타일) */
const GUARD_HOLD_DIST = 2.4;
/** 괴물이 안 보인 뒤에도 이만큼(초) 계속 달아난다 */
const FLEE_MEMORY = 2.0;
/** 괴물은 안 보이는데 내가 발각 중이면, 이만큼(초) 안에 본 괴물 위치에서 달아난다 */
const SPOTTED_MEMORY = 3.0;
/** 이보다 가까우면(타일) 길찾기 대신 곧장 반대쪽으로 */
const CLOSE_EVADE = 1.9;
/** 도주 지점 다시 고르는 간격 (틱)과 바꾸는 문턱 (점수) */
const FLEE_REPLAN_TICKS = 6;
const FLEE_KEEP = 1.5;
/** 도주 지점 점수: 괴물 길 거리 - 비율 × 내 길 거리 (괴물이 10% 빠르다) */
const FLEE_SPEED_RATIO = 1.15;
/** 도주 지점 점수: 괴물에게서 먼 곳 가중치, 괴물에게서 안 보이는 곳 덤 */
const FLEE_FAR_WEIGHT = 0.3;
const FLEE_HIDDEN_BONUS = 2.5;
/** 도주 지점은 내게서 최소 이만큼(타일) */
const FLEE_MIN_SPOT = 2.5;
/** 도주 · 기다리는 자리 점수: 열린 정도(이웃 후보 수) 가중치. 구석으로 몰리지 않게 */
const OPEN_WEIGHT = 0.6;
/** 함께 달아나는 동료가 이 거리(타일) 안이면 갈라진다 (한 번 휘두르기에 둘이 맞지 않게) */
const SPLIT_RADIUS = 3;
/** 갈라지기: ID 순서로 한쪽은 왼쪽, 한쪽은 오른쪽 도주 지점에 주는 점수 */
const SPLIT_BIAS = 4;
/** 괴물이 최근(초) 이 거리(타일) 안에서 보인 목표는 위험하다고 보고 피한다 */
const HOT_TIME = 10;
const HOT_RADIUS = 7;
/** 최근 본 괴물이 이 거리(타일) 안이고 목표에 나보다 가까우면(가는 길에 있으면) 그 목표도 위험 */
const ROUTE_DANGER = 9;
/** 모두 위험할 때 지금 점령 목표를 가장 가까운 곳으로 옮기기 전에 유지하는 시간 (초) — pickPoint */
const GOAL_KEEP = 1.5;
/** 기다리는 자리를 다시 고르는 간격 (틱) */
const LURK_REPLAN_TICKS = 30;
/** 위험한 목표 근처에서 기다리는 자리: 목표에서 이 길 거리쯤 (타일) */
const LURK_DIST = 10;
/** 기다리는 자리는 괴물보다 이만큼(점수: 괴물 길 거리 - 1.15 × 내 길 거리) 먼저 닿는 곳만 */
const LURK_SAFE = 3;
/** 구조 담당: 나보다 이만큼(타일) 넘게 가까운 동료가 있으면 그 동료에게 맡긴다 */
const RESCUE_SLACK = 2.5;
/** 이 진행도 이상이면 괴물이 와도 마무리한다 (구조 · 탈출구), 단 괴물이 이 거리(타일)보다 가까우면 달아난다 */
const COMMIT_RESCUE = 0.55;
const COMMIT_EXIT = 0.4;
const COMMIT_MIN_DIST = 1.8;
/** 열린 탈출구 문까지 이 거리(타일) 안이면 괴물을 무시하고 뛰어든다 */
const COMMIT_DOOR = 3.5;
/** 내가 있는 거점 진행도가 이 이상이면 구조보다 마무리를 먼저 */
const FINISH_POINT = 0.8;
/** 러너 질주: 달아나는 중 괴물이 이 거리(타일) 안이면 */
const SPRINT_DIST = 3.5;
/** 가드 밀치기: 사거리에서 이만큼(타일) 안쪽이면 (스냅샷이 1~2틱 늦다) */
const SHOVE_MARGIN = 0.25;
/** 스카우트 탐지: 괴물 정보가 이만큼(초, 최소 + 시드 범위) 없을 때 할 일 중이면 */
const TRACK_IDLE_MIN = 8;
const TRACK_IDLE_SPAN = 8;
/** 스카우트 탐지: 구조하러 가는 중에는 괴물 정보가 이만큼(초)만 없어도 */
const TRACK_RESCUE_IDLE = 3;
/** 탈출구 바꾸기: 고른 문에서 이 거리(타일) 안에 괴물이 보이고, 다른 문은 이보다 멀 때 (타일), 다시 바꾸기까지 (초) */
const EXIT_SWITCH_NEAR = 5;
const EXIT_SWITCH_FAR = 12;
const EXIT_SWITCH_GAP = 10;
/** 거점에서 역할별로 서는 자리 (가운데에서 조금씩 비켜, 모두 반경 안) */
const POINT_OFFSET: Readonly<Record<RoleId, Vec2>> = {
  runner: { x: -0.8, y: 0 },
  guard: { x: 0.8, y: 0 },
  scout: { x: 0, y: 0.8 },
};
/** 탈출구에서 서는 자리 (가로 비킴, 안쪽으로 들어온 거리) */
const EXIT_OFFSET: Readonly<Record<RoleId, Vec2>> = {
  runner: { x: -0.5, y: 0.3 },
  guard: { x: 0.5, y: 0.3 },
  scout: { x: 0, y: 0.6 },
};

interface Threat {
  x: number;
  y: number;
  tick: number;
}

interface Task {
  kind: 'capture' | 'rescue' | 'exit' | 'door' | 'lurk' | 'idle';
  target: Vec2;
  tol: number;
  held: number;
  /** 괴물이 와도 버틸 진행 (COMMIT_MIN_DIST보다 멀면 달아나지 않는다) */
  commit: boolean;
}

interface Danger {
  x: number;
  y: number;
  d: number;
  fresh: boolean;
}

/** 팀 계획에서 셋이 한 거점에 함께 갈 확률 (아니면 둘 · 하나로 나뉜다) */
const TEAM_TOGETHER_PROB = 0.5;

const SOLO_ROLES: readonly RoleId[] = ['runner', 'guard', 'scout'];

/**
 * 생존자 팀이 함께 쓰는 계획 (같은 seed면 세 봇이 같은 계획): 거점을 들를 순서(세 곳을 시드로 섞음 — 앞 두 곳이 먼저 갈 곳,
 * 셋째는 지켜질 때 갈 곳)와, 혼자 둘째 거점에 갈 역할(없으면 셋이 함께). 역할과 거점을 묶지 않는다 — 괴물 화면에서 자리로
 * 역할을 짐작할 단서가 생기지 않게 혼자 가는 역할도 셋 중 시드로 고른다(플레이테스트 반영 b)
 */
export function teamPlan(seed: number): { order: readonly PointId[]; solo: RoleId | null } {
  const r = new Rng((Math.imul(seed | 0, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0);
  const order = [...POINT_IDS];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = r.int(i + 1);
    const t = order[i] as PointId;
    order[i] = order[j] as PointId;
    order[j] = t;
  }
  const together = r.next() < TEAM_TOGETHER_PROB;
  const solo = SOLO_ROLES[r.int(SOLO_ROLES.length)] ?? 'runner';
  return { order, solo: together ? null : solo };
}

/**
 * 생존자 한 명이 거점을 들를 순서 (팀 계획에서, PracticeSurvivorBrain이 그대로 쓴다): 혼자 가는 역할은 둘째 거점부터,
 * 나머지는 첫 거점부터. 셋째는 둘 다 지켜질 때 갈 곳
 */
export function survivorPlan(seed: number, role: RoleId): readonly PointId[] {
  const plan = teamPlan(seed);
  const [first, second, third] = plan.order;
  return (plan.solo === role ? [second, first, third] : [first, second, third]).filter(
    (id): id is PointId => id !== undefined,
  );
}

/**
 * 점령할 거점 고르기. undone은 계획 순서로 남은 거점(비어 있지 않다), hot · near는 거점별 위험 · 내게서 거리, cur는 지금 목표,
 * held는 지금 목표를 고른 지 GOAL_KEEP초 안인가.
 * 규칙: 계획 첫 곳이 위험하면 계획 순서 앞쪽의 안전한 곳, 모두 위험하면 가장 가까운 곳(그 근처에서 기다린다).
 * 이력: '가는 길' 위험은 내 자리에 따라 깜빡이므로, 지금 목표가 안전하면 그대로 간다(안전한 곳끼리 · 계획 첫 곳으로 오가지 않는다).
 * 지금 목표가 위험해지면 안전한 곳으로 바로 바꾸고, 모두 위험할 때 가까운 곳으로 옮기는 것은 유지 시간이 지난 뒤
 */
export function pickPoint(
  undone: readonly PointId[],
  hot: Readonly<Record<PointId, boolean>>,
  near: Readonly<Record<PointId, number>>,
  cur: PointId | null,
  held: boolean,
): PointId {
  const first = undone[0] ?? 'A';
  let pick: PointId = first;
  if (hot[first] && undone.length > 1) {
    let safe: PointId | null = null;
    for (const id of undone) {
      if (!hot[id]) {
        safe = id;
        break;
      }
    }
    if (safe !== null) pick = safe;
    else for (const id of undone) if (near[id] < near[pick]) pick = id;
  }
  if (cur === null || cur === pick || !undone.includes(cur)) return pick;
  if (!hot[cur]) return cur;
  return hot[pick] && held ? cur : pick;
}

export class PracticeSurvivorBrain implements BotBrain {
  private readonly rng: Rng;
  private readonly walker = new Walker();
  private hz = 30;
  private lastObserved = -1;
  private now = 0;
  private threat: Threat | null = null;
  /** 괴물 정보(보임 · 탐지 · 포효)를 마지막으로 받은 틱 */
  private lastInfo = 0;
  private fleeing = false;
  private fleeSpot: Vec2 | null = null;
  private fleeReplanAt = 0;
  private exitChoice: ExitId | null = null;
  private exitSwitchedAt = -1e9;
  private readonly codes: string[] = [];
  /** 거점을 들를 순서 (팀 계획, 내 거점이 맨 앞) */
  private readonly plan: readonly PointId[];
  private trackIdle: number;
  private stuckFrom: { x: number; y: number; tick: number } | null = null;
  private wiggleUntil = 0;
  private wiggleDir: Vec2 = { x: 0, y: 0 };
  private lurk: { ax: number; ay: number; spot: Vec2; until: number } | null = null;
  private pathCache: { tick: number; cell: number; limit: number; d: number } | null = null;
  /** 고른 점령 목표와 고른 틱 (pickPoint의 이력) */
  private pointGoal: PointId | null = null;
  private pointGoalAt = -1e9;
  /** 이번 틱 거점별 위험 · 거리 (pickPoint에 넘긴다. 틱마다 새 객체를 만들지 않게 재사용) */
  private readonly hotNow: Record<PointId, boolean> = { A: false, B: false, C: false };
  private readonly nearNow: Record<PointId, number> = { A: 0, B: 0, C: 0 };

  constructor(
    private readonly role: RoleId,
    seed: number,
  ) {
    this.rng = brainRng(seed, role);
    this.plan = survivorPlan(seed, role);
    this.trackIdle = TRACK_IDLE_MIN + this.rng.next() * TRACK_IDLE_SPAN;
  }

  private sec(s: number): number {
    return Math.round(s * this.hz);
  }

  decide(snap: Snapshot, info: MatchInfo, b: Balance, seq: number): InputFrame {
    this.hz = info.tickHz > 0 ? info.tickHz : b.network.serverTickHz;
    // 갇혀 있어도(죽어도) 관찰은 한다: 탈출구 선택이 팀 전원에게 같게 유지되도록
    this.observe(snap);
    const surv = snap.you.surv;
    if (!surv || surv.status !== 'free') return emptyInput(seq);
    const me = snap.you.move;
    const out: InputFrame = { seq, mx: 0, my: 0, aim: Number.NaN, held: 0, pressed: 0 };
    const task = this.task(snap, info, b);
    const danger = this.danger(snap, b, task);
    out.pressed |= this.ability(snap, b, danger, task);
    let mv: { mx: number; my: number; arrived: boolean };
    if (danger) {
      mv = this.flee(snap, b, danger);
    } else {
      this.fleeSpot = null;
      mv = this.walker.toward(snap, task.target, task.tol);
      if (task.held !== 0 && (mv.arrived || dist(me, task.target) <= task.tol + 0.4)) out.held = task.held;
    }
    // 막힘: 움직이려는데 못 움직이면 잠깐 옆으로
    if (this.now < this.wiggleUntil) {
      mv = { mx: this.wiggleDir.x, my: this.wiggleDir.y, arrived: false };
    } else if (this.stuck(me, mv.mx !== 0 || mv.my !== 0)) {
      const a = Math.atan2(mv.my, mv.mx) + (this.rng.next() < 0.5 ? 1.6 : -1.6);
      this.wiggleDir = { x: Math.cos(a), y: Math.sin(a) };
      this.wiggleUntil = this.now + 10;
      this.fleeSpot = null;
    }
    out.mx = mv.mx;
    out.my = mv.my;
    return out;
  }

  /** 새 스냅샷일 때만: 괴물 위치 기억, 메모 비밀번호, 탈출구 선택 */
  private observe(snap: Snapshot): void {
    if (snap.tick === this.lastObserved) return;
    this.lastObserved = snap.tick;
    this.now = snap.tick;
    let pos: Vec2 | null = snap.monster ? { x: snap.monster.x, y: snap.monster.y } : null;
    if (!pos) {
      for (const m of snap.marks) {
        if (m.kind === 'track' || (m.kind === 'roarSelf' && !pos)) pos = { x: m.x, y: m.y };
      }
    }
    if (pos) {
      this.threat = { x: pos.x, y: pos.y, tick: snap.tick };
      this.lastInfo = snap.tick;
    }
    for (const ev of snap.events) {
      if (ev.k === 'text' && ev.code && (ev.id === 'NOTE_FIRST' || ev.id === 'NOTE_SECOND'))
        this.codes.push(ev.code);
    }
    // 탈출구: 활성화된 첫 스냅샷에서 한 번 고른다. 팀 모두가 같은 스냅샷 정보로 고르므로 같은 문이 나온다
    const active = snap.world.exits.some((e) => e.state !== 'inactive');
    if (!active) return;
    if (this.exitChoice === null) {
      this.exitChoice = this.chooseExit();
      return;
    }
    // 고른 문 바로 앞에 괴물이 보이면(팀 모두 같은 스냅샷) 다른 문으로
    const cur = this.exitChoice;
    const other: ExitId = cur === 'N' ? 'S' : 'N';
    const curOpen = snap.world.exits.some((e) => e.id === cur && e.state === 'open');
    if (
      snap.monster &&
      !curOpen &&
      snap.tick - this.exitSwitchedAt >= this.sec(EXIT_SWITCH_GAP) &&
      dist(snap.monster, EXITS[cur].center) < EXIT_SWITCH_NEAR &&
      dist(snap.monster, EXITS[other].center) > EXIT_SWITCH_FAR
    ) {
      this.exitChoice = other;
      this.exitSwitchedAt = snap.tick;
    }
  }

  /** 괴물을 마지막으로 본 곳에서 길이 더 먼 문. 본 적이 없으면 두 번째 메모 비밀번호의 홀짝 */
  private chooseExit(): ExitId {
    const t = this.threat;
    if (t) {
      const dn = pathDist(fieldFrom(EXITS.N.center), t);
      const ds = pathDist(fieldFrom(EXITS.S.center), t);
      if (Math.abs(dn - ds) > 1e-6) return dn > ds ? 'N' : 'S';
    }
    const code = this.codes[this.codes.length - 1] ?? '0';
    return Number(code.charAt(code.length - 1)) % 2 === 0 ? 'N' : 'S';
  }

  /** 최근 본 괴물이 목표 가까이에 있거나, 내 근처에서 목표 쪽(나보다 목표에 가까운 곳)에 있었는가 */
  private hot(anchor: Vec2, me: Vec2): boolean {
    const t = this.threat;
    if (!t || this.now - t.tick > this.sec(HOT_TIME)) return false;
    if (dist(t, anchor) < HOT_RADIUS) return true;
    if (dist(t, me) >= ROUTE_DANGER) return false;
    const f = fieldFrom(anchor);
    return pathDist(f, t) < pathDist(f, me) + 1;
  }

  /** 할 일: 탈출 → 구조 → 점령 */
  private task(snap: Snapshot, info: MatchInfo, b: Balance): Task {
    const me = snap.you.move;
    const mates = snap.survivors;
    const freeMates = mates.filter((s) => s.status === 'free');
    const jailed = mates.filter((s) => s.status === 'imprisoned');
    const escaped = mates.filter((s) => s.status === 'escaped').length;
    const exitsOn = snap.world.exits.some((e) => e.state !== 'inactive');
    const anyOpen = snap.world.exits.some((e) => e.state === 'open');
    // 탈출: 나와 자유 동료 + 이미 탈출한 수가 승리 인원 이상이고, 열린 문이 있거나 둘이 함께 열 수 있을 때
    const need = b.exit.requiredSurvivors;
    if (exitsOn && 1 + freeMates.length + escaped >= need && (anyOpen || 1 + freeMates.length >= need)) {
      return this.exitTask(snap, info, b);
    }
    // 내 거점 마무리가 거의 다 됐으면 먼저 끝낸다
    const here = this.pointHere(snap, b);
    const finishing = here !== null && here.progress >= FINISH_POINT;
    const open = new Set(snap.world.points.filter((p) => pointOpen(p.state)).map((p) => p.id));
    // 계획 순서대로 남은 거점 (끝났거나 꺼진 곳은 뺀다)
    const undone = this.plan.filter((id) => open.has(id));
    if (jailed.length > 0 && !finishing && this.isRescuer(snap, freeMates)) {
      const r = this.rescueTask(snap, b);
      // 감옥 근처가 위험하면 거점이 남아 있는 동안은 점령을 하다가 다시 본다 (모두 감옥 앞에서 기다리지 않게)
      if (r.kind !== 'lurk' || undone.length === 0 || freeMates.length === 0) return r;
    }
    if (undone.length > 0) {
      // 지켜지는 거점은 버리고 안전한 다른 거점으로 (계획 순서 앞쪽 먼저). 모두 위험하면 가장 가까운 곳 근처에서 기다린다
      for (const id of undone) {
        this.hotNow[id] = this.hot(CAPTURE_POINTS[id], me);
        this.nearNow[id] = dist(me, CAPTURE_POINTS[id]);
      }
      const held = this.now - this.pointGoalAt < this.sec(GOAL_KEEP);
      const goal = pickPoint(undone, this.hotNow, this.nearNow, this.pointGoal, held);
      if (goal !== this.pointGoal) {
        this.pointGoal = goal;
        this.pointGoalAt = this.now;
      }
      const c = CAPTURE_POINTS[goal];
      if (this.hotNow[goal] && dist(me, c) > b.capturePoint.radius) {
        return { kind: 'lurk', target: this.lurkSpot(c, me), tol: 0.8, held: 0, commit: false };
      }
      const o = POINT_OFFSET[this.role];
      return {
        kind: 'capture',
        target: snapToFloor({ x: c.x + o.x, y: c.y + o.y }),
        tol: 0.4,
        held: 0,
        commit: false,
      };
    }
    if (jailed.length > 0) return this.rescueTask(snap, b);
    return { kind: 'idle', target: { x: me.x, y: me.y }, tol: 1, held: 0, commit: false };
  }

  /** 지금 서 있는 (끝나지도 꺼지지도 않은) 거점 */
  private pointHere(snap: Snapshot, b: Balance): { id: PointId; progress: number } | null {
    for (const p of snap.world.points) {
      if (!pointOpen(p.state)) continue;
      if (dist(snap.you.move, CAPTURE_POINTS[p.id]) <= b.capturePoint.radius)
        return { id: p.id, progress: p.progress };
    }
    return null;
  }

  /** 구조 담당인가: 구조 지점에 가장 가까운 자유 생존자 (비슷하면 둘 다 간다 — 아무도 안 가는 것보다 낫다) */
  private isRescuer(snap: Snapshot, freeMates: readonly SurvivorView[]): boolean {
    if (freeMates.length === 0) return true;
    if (freeMates.some((s) => (s.rescue ?? 0) > 0)) return false;
    const f = fieldFrom(RESCUE_POINT);
    const mine = pathDist(f, snap.you.move);
    let others = Infinity;
    for (const s of freeMates) others = Math.min(others, pathDist(f, s));
    return mine <= others + RESCUE_SLACK;
  }

  private rescueTask(snap: Snapshot, b: Balance): Task {
    const me = snap.you.move;
    const surv = snap.you.surv;
    const progress = surv?.rescue ?? 0;
    const inZone = dist(me, RESCUE_POINT) <= b.prison.rescueRadius - 0.2;
    const brave = this.role === 'guard' && (surv?.abilityCd ?? 1) <= 0;
    if (this.hot(RESCUE_POINT, me) && !inZone && !brave) {
      return { kind: 'lurk', target: this.lurkSpot(RESCUE_POINT, me), tol: 0.8, held: 0, commit: false };
    }
    return {
      kind: 'rescue',
      target: RESCUE_POINT,
      tol: 0.3,
      held: BTN.RESCUE,
      commit: inZone && progress >= COMMIT_RESCUE,
    };
  }

  private exitTask(snap: Snapshot, info: MatchInfo, b: Balance): Task {
    const me = snap.you.move;
    const open = EXIT_IDS.filter((id) => snap.world.exits.some((e) => e.id === id && e.state === 'open'));
    let choice: ExitId = this.exitChoice ?? 'N';
    // 사람 동료가 이미 다른 탈출구에 서 있으면 그쪽으로 (봇끼리는 같은 문을 고른다)
    for (const s of snap.survivors) {
      if (s.status !== 'free') continue;
      const human = info.roster.some((r) => r.id === s.id && !r.bot);
      if (!human) continue;
      for (const id of EXIT_IDS) if (dist(s, EXITS[id].center) <= b.exit.radius + 0.5) choice = id;
    }
    if (open.length > 0) {
      const id = open.includes(choice) ? choice : (open[0] ?? choice);
      const door = EXIT_DOORS[id];
      return { kind: 'door', target: door, tol: 0.05, held: 0, commit: dist(me, door) <= COMMIT_DOOR };
    }
    const c = EXITS[choice].center;
    const o = EXIT_OFFSET[this.role];
    const stand = { x: c.x + o.x, y: c.y + EXIT_INWARD[choice] * o.y };
    const ex = snap.world.exits.find((e) => e.id === choice);
    const inside = dist(me, c) <= b.exit.radius - 0.2;
    if (this.hot(c, me) && !inside) {
      return { kind: 'lurk', target: this.lurkSpot(c, me), tol: 0.8, held: 0, commit: false };
    }
    return {
      kind: 'exit',
      target: stand,
      tol: 0.3,
      held: 0,
      commit: inside && (ex?.progress ?? 0) >= COMMIT_EXIT,
    };
  }

  /** 위험한 목표 근처에서 기다릴 곳 (LURK_REPLAN_TICKS마다 다시 고른다: 매 틱 바뀌면 길을 매번 다시 찾는다) */
  private lurkSpot(anchor: Vec2, me: Vec2): Vec2 {
    const c = this.lurk;
    if (c && c.ax === anchor.x && c.ay === anchor.y && this.now < c.until) return c.spot;
    const spot = this.pickLurkSpot(anchor, me);
    this.lurk = { ax: anchor.x, ay: anchor.y, spot, until: this.now + LURK_REPLAN_TICKS };
    return spot;
  }

  /** 괴물보다 먼저 닿는(안전한) 도주 후보 중 목표에서 LURK_DIST쯤, 괴물에게서 안 보이고, 내게서 가까운 곳 */
  private pickLurkSpot(anchor: Vec2, me: Vec2): Vec2 {
    const fa = fieldFrom(anchor);
    const t = this.threat;
    let best: Vec2 = me;
    let bestScore = -Infinity;
    for (let k = 0; k < FLEE_SPOTS.length; k += 1) {
      const s = FLEE_SPOTS[k];
      if (!s) continue;
      const fs = fieldFrom(s);
      const dMe = pathDist(fs, me);
      if (!Number.isFinite(dMe)) continue;
      const da = pathDist(fa, s);
      let score = -0.5 * Math.abs(da - LURK_DIST) - 0.3 * dMe + OPEN_WEIGHT * opennessOf(k);
      if (t) {
        const margin = pathDist(fs, t) - FLEE_SPEED_RATIO * dMe;
        if (margin < LURK_SAFE) score -= 20 + (LURK_SAFE - margin);
        if (lineOfSight(t, s)) score -= 4;
      }
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  /** 달아날 상황인가 */
  private danger(snap: Snapshot, b: Balance, task: Task): Danger | null {
    const t = this.threat;
    const surv = snap.you.surv;
    if (!t || !surv) {
      this.fleeing = false;
      return null;
    }
    const me = snap.you.move;
    const d = dist(me, t);
    const fresh = t.tick === this.now;
    if (task.commit && d > COMMIT_MIN_DIST) {
      this.fleeing = false;
      return null;
    }
    let radius = FLEE_DIST[this.role] + (surv.hp < b.survivor.maxHp ? FLEE_INJURED_BONUS : 0);
    if (this.role === 'guard' && surv.abilityCd <= 0 && !(snap.monster?.stunned ?? false)) {
      radius = Math.min(radius, GUARD_HOLD_DIST);
    }
    if (this.fleeing) radius += FLEE_HYST;
    const age = this.now - t.tick;
    let threatened = false;
    // 팀 시야에 보이는 괴물: 벽 너머라도 길 거리가 가까우면 달아난다
    if (fresh) threatened = d < radius && this.threatPathDist(me, radius) < radius;
    else threatened = this.fleeing && age <= this.sec(FLEE_MEMORY) && d < radius + 1;
    // 괴물이 나를 보고 있다(발각): 최근 본 괴물 위치에서 달아난다
    if (!threatened && surv.spotted && age <= this.sec(SPOTTED_MEMORY)) threatened = true;
    this.fleeing = threatened;
    return threatened ? { x: t.x, y: t.y, d, fresh } : null;
  }

  /** 괴물(이번 스냅샷 위치)에서 나까지 길 거리. 같은 스냅샷 · 같은 칸이면 다시 찾지 않는다 */
  private threatPathDist(me: Vec2, limit: number): number {
    const t = this.threat;
    if (!t) return Infinity;
    const cell = Math.floor(me.y) * W + Math.floor(me.x);
    const c = this.pathCache;
    if (c && c.tick === t.tick && c.cell === cell && c.limit === limit) return c.d;
    const d = localPathDist(t, me, limit);
    this.pathCache = { tick: t.tick, cell, limit, d };
    return d;
  }

  private flee(snap: Snapshot, b: Balance, dg: Danger): { mx: number; my: number; arrived: boolean } {
    const me = snap.you.move;
    if (dg.fresh && dg.d < CLOSE_EVADE && lineOfSight(me, dg)) {
      // 곧장 반대쪽으로. 공격 준비 중이면 고정된 조준에서 옆으로 비켜난다
      let ax = me.x - dg.x;
      let ay = me.y - dg.y;
      const split = this.splitSide(snap);
      if (split !== 0) {
        // 옆 동료와 반대쪽으로 비스듬히 (왼쪽 = 괴물 → 나 방향을 반시계로 돌린 쪽)
        const k = 0.6 * split;
        const rx = ax - ay * k;
        const ry = ay + ax * k;
        ax = rx;
        ay = ry;
      }
      const m = snap.monster;
      if (m && m.windup > 0) {
        const px = -Math.sin(m.aim);
        const py = Math.cos(m.aim);
        const side = (me.x - dg.x) * px + (me.y - dg.y) * py >= 0 ? 1 : -1;
        ax = ax / Math.max(dg.d, 0.1) + px * side * 0.8;
        ay = ay / Math.max(dg.d, 0.1) + py * side * 0.8;
      }
      const dir = freeDirection(me, Math.atan2(ay, ax), b.survivor.radius);
      if (dir) return { mx: dir.x, my: dir.y, arrived: false };
    }
    const split = this.splitSide(snap);
    if (!this.fleeSpot || this.now >= this.fleeReplanAt) {
      this.fleeSpot = this.chooseFleeSpot(me, dg, split);
      this.fleeReplanAt = this.now + FLEE_REPLAN_TICKS;
    }
    const w = this.walker.toward(snap, this.fleeSpot, 0.6);
    if (w.arrived) {
      // 닿았는데 아직 위험하면 지금 자리를 빼고 새로 고른다
      this.fleeSpot = this.chooseFleeSpot(me, dg, split, this.fleeSpot);
      this.fleeReplanAt = this.now + FLEE_REPLAN_TICKS;
      return this.walker.toward(snap, this.fleeSpot, 0.6);
    }
    return w;
  }

  /**
   * 가까이 있는 자유 동료와 갈라질 쪽: 내 ID가 작으면 왼쪽(+1), 크면 오른쪽(-1), 가까운 동료가 없으면 0.
   * 두 봇이 같은 ID 쌍을 보므로 서로 반대쪽을 고른다
   */
  private splitSide(snap: Snapshot): number {
    const me = snap.you.move;
    let mate: SurvivorView | null = null;
    for (const s of snap.survivors) {
      if (s.status !== 'free' || dist(s, me) > SPLIT_RADIUS) continue;
      if (!mate || dist(s, me) < dist(mate, me)) mate = s;
    }
    if (!mate) return 0;
    return snap.you.id < mate.id ? 1 : -1;
  }

  /** 괴물보다 먼저(괴물이 10% 빠름을 감안) 닿고, 괴물에게서 멀고 안 보이는 도주 후보. split이면 그쪽 옆으로 */
  private chooseFleeSpot(me: Vec2, dg: Danger, split: number, exclude: Vec2 | null = null): Vec2 {
    const ax = me.x - dg.x;
    const ay = me.y - dg.y;
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    let curScore = -Infinity;
    for (let k = 0; k < FLEE_SPOTS.length; k += 1) {
      const s = FLEE_SPOTS[k];
      if (!s || s === exclude) continue;
      const f = fieldFrom(s);
      const dMe = pathDist(f, me);
      if (!Number.isFinite(dMe) || dMe < FLEE_MIN_SPOT) continue;
      const dMon = pathDist(f, dg);
      let score =
        dMon - FLEE_SPEED_RATIO * dMe + FLEE_FAR_WEIGHT * Math.min(dMon, 20) + OPEN_WEIGHT * opennessOf(k);
      if (!lineOfSight(dg, s)) score += FLEE_HIDDEN_BONUS;
      if (split !== 0) {
        // 괴물 → 나 방향의 왼쪽(외적 > 0)이면 +1
        const cross = ax * (s.y - me.y) - ay * (s.x - me.x);
        score += cross * split > 0 ? SPLIT_BIAS : -SPLIT_BIAS;
      }
      if (s === this.fleeSpot) curScore = score;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (this.fleeSpot && this.fleeSpot !== exclude && curScore >= bestScore - FLEE_KEEP) return this.fleeSpot;
    return best ?? snapToFloor({ x: me.x + (me.x - dg.x), y: me.y + (me.y - dg.y) });
  }

  private ability(snap: Snapshot, b: Balance, dg: Danger | null, task: Task): number {
    const surv = snap.you.surv;
    if (!surv || surv.abilityCd > 0) return 0;
    const me = snap.you.move;
    const m = snap.monster;
    switch (this.role) {
      case 'runner':
        return dg && dg.fresh && dg.d < SPRINT_DIST ? BTN.ABILITY : 0;
      case 'guard': {
        if (!m || m.stunned) return 0;
        const d = dist(me, m);
        if (d > b.roles.guard.shoveRange - SHOVE_MARGIN) return 0;
        return segmentBlocked(me, m, blocksStrike) ? 0 : BTN.ABILITY;
      }
      case 'scout': {
        if (m) return 0;
        const idle = this.now - this.lastInfo;
        const rescuing = task.kind === 'rescue' && dist(me, task.target) <= 12;
        if (idle < this.sec(rescuing ? TRACK_RESCUE_IDLE : this.trackIdle)) return 0;
        const busy =
          task.kind === 'capture' || task.kind === 'rescue' || task.kind === 'exit' || task.kind === 'lurk';
        if (!busy || dist(me, task.target) > (rescuing ? 12 : 8)) return 0;
        this.trackIdle = TRACK_IDLE_MIN + this.rng.next() * TRACK_IDLE_SPAN;
        return BTN.ABILITY;
      }
      default:
        return 0;
    }
  }

  private stuck(me: Vec2, moving: boolean): boolean {
    if (!moving) {
      this.stuckFrom = null;
      return false;
    }
    const s = this.stuckFrom;
    if (!s || dist(s, me) > STUCK_MOVE) {
      this.stuckFrom = { x: me.x, y: me.y, tick: this.now };
      return false;
    }
    if (this.now - s.tick >= STUCK_TICKS) {
      this.stuckFrom = null;
      return true;
    }
    return false;
  }
}

/** angle 쪽으로 몸이 걸리지 않는 방향. 막혔으면 좌우로 약 30°씩 틀어 본다. 다 막혔으면 null */
function freeDirection(me: Vec2, angle: number, r: number): Vec2 | null {
  for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
    const a = angle + off;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const probe = { x: me.x + ux * (0.6 + r), y: me.y + uy * (0.6 + r) };
    if (walkableAt(probe) && clearPath(me, probe, r * 0.8)) return { x: ux, y: uy };
  }
  return null;
}
