// 실전 봇 두뇌: 괴물 (M13b, 플레이테스트 반영 c에서 practiceBrains.ts에서 나눔).
// 두뇌는 decide()로 받은 것 — 자기에게 온(정보 차단된) 스냅샷 · MatchInfo · Balance — 과 공개 지도만 본다.
// 결정적이다: 같은 seed + 같은 스냅샷이면 같은 입력 (시드 난수 Rng만, 괴물 화면 생존자 배열 순서 · 임시 ID에 기대지 않는다)
import {
  BTN,
  CAPTURE_POINTS,
  POINT_IDS,
  EXITS,
  PRISON_RECT,
  RESCUE_POINT,
  angleDiff,
  distToRect,
  emptyInput,
  type Balance,
  type InputFrame,
  type MatchInfo,
  type PointId,
  type Rng,
  type Snapshot,
  type SurvivorView,
  type Vec2,
  type VisionModeId,
} from '../index';
import { Walker, aimAt, dist, type BotBrain } from './botBrains';
import {
  brainRng,
  clearPath,
  EXIT_INWARD,
  fieldFrom,
  MONSTER_CROSS,
  MONSTER_EXIT_LOOP,
  MONSTER_LOOP,
  pathDist,
  pointOpen,
  snapToFloor,
  STUCK_MOVE,
  STUCK_TICKS,
  unit,
  walkableAt,
  WATCH_SPOTS,
  WATCH_TOLERANCE,
} from './practiceMap';

// ───────────────────────── 괴물 ─────────────────────────

/** 공격: 준비(0.4초) 끝 예상 거리가 사거리 + 생존자 반지름 - 이 여유 안이면 누른다 (타일) */
const ATTACK_MARGIN = 0.25;
/** 공격을 누를 때 조준과 표적 방향의 최대 차이 (라디안). 준비 중에는 조준이 고정된다 */
const ATTACK_FACING = 0.4;
/** 공격은 지금 거리가 사거리 + 이만큼(타일) 안일 때만 (다가오는 속도 추정이 틀려 헛치지 않게) */
const ATTACK_NOW_SLACK = 0.55;
/** 다가오는 속도는 이만큼(타일/초)까지만 믿는다 (방향을 자주 바꾼다) */
const APPROACH_TRUST = 1.0;
/** 돌진: 표적까지 이 거리 범위에서만 (타일). 돌진 4타일 뒤 바로 공격할 수 있는 거리 */
const DASH_MIN = 2.8;
const DASH_MAX = 4.4;
/** 돌진 주사위 확률 (최소 + 시드 범위): 사람처럼 매번 쓰지는 않는다 */
const DASH_CHANCE_MIN = 0.45;
const DASH_CHANCE_SPAN = 0.3;
/** 새로 보인 생존자에게 공격 · 돌진하기까지 반응 시간 (초) */
const REACT_TIME = 0.25;
/** 돌진 조준 허용 오차 (라디안). 돌진은 지금 조준 방향으로 나간다 */
const DASH_FACING = 0.12;
/** 돌진은 공격 쿨이 이만큼 이하로 남았을 때만 (돌진 끝에 바로 때리게, 초) */
const DASH_ATTACK_CD_MAX = 0.4;
/** 돌진 기회를 놓쳤으면(주사위 실패) 다시 굴릴 때까지 (초) */
const DASH_REROLL = 2.0;
/** 이 거리 안이고 직선이 비어 있으면 길찾기 없이 곧장 쫓는다 (타일) */
const DIRECT_CHASE = 3.5;
/** 추적 중 표적의 이동을 내다보는 최대 시간 (초) */
const CHASE_LEAD_MAX = 0.35;
/** 보호 중인 생존자는 이만큼 먼 것으로 친다 (타일): 다른 표적이 있으면 그쪽 */
const PROTECTED_PENALTY = 8;
/** 지금 쫓는 표적을 유지하는 덤 (타일): 비슷하면 표적을 바꾸지 않는다 */
const KEEP_TARGET_BONUS = 1.5;
/** 놓친 표적: 마지막 위치에서 이만큼 앞(초)을 찾아간다. 최대 거리(타일) */
const LOST_LEAD = 0.8;
const LOST_LEAD_MAX = 4;
/** 놓친 표적을 찾는 시간 (초) */
const LOST_TIME = 4;
/** 조사 지점에 닿은 뒤 둘러보는 시간 (초) */
const LOOK_TIME = 1.8;
/** 거점에 닿았는데 아무도 없으면 반경 바로 바깥에서 기다리는 시간 (초, 최소 + 시드 범위) */
const AMBUSH_MIN = 6;
const AMBUSH_SPAN = 6;
/** 기다리는 자리: 거점 반경에서 이만큼 바깥 (타일) */
const AMBUSH_OUT = 0.7;
/** 조사 지점까지 가는 시간 한도 (초) */
const GOAL_TIME = 25;
/** 조사 지점에 닿아 아무도 없을 때 포효할 확률 */
const ROAR_AT_LOOK_PROB = 0.35;
/** 쫓던 생존자를 놓쳤을 때 바로 포효할 확률 (반경 안이면 다시 찾는다) */
const ROAR_ON_LOST_PROB = 0.5;
/** 아무도 못 본 채 이만큼(초, 최소 + 시드 범위) 지나면 포효 */
const ROAR_IDLE_MIN = 14;
const ROAR_IDLE_SPAN = 14;
/** 순찰 중 가운데 모퉁이에 들를 확률 (지점마다) */
const DETOUR_PROB = 0.3;
/** 거점이 남아 있으면 순찰 대신 안 끝난 거점을 번갈아 지킬 확률 (할 일이 없을 때마다) */
const POINT_PATROL_PROB = 0.65;
/** 순찰을 고르면 이만큼(순찰 지점 수, 최소 + 시드 범위) 돈 뒤 다시 고른다 */
const PATROL_LEGS_MIN = 1;
const PATROL_LEGS_SPAN = 3;
/** 감옥 감시: 서 있는 시간(초, 최소 + 시드 범위), 다음 감시까지 (초, 최소 + 시드 범위) */
const WATCH_MIN = 4;
const WATCH_SPAN = 4;
const WATCH_GAP_MIN = 12;
const WATCH_GAP_SPAN = 12;
/** 생존자를 가둔 직후 감옥 감시로 갈 확률 (구조하러 올 것이다) */
const WATCH_AFTER_JAIL_PROB = 0.85;
/** 감옥 캠핑 경고 전에 스스로 나가는 시간 (초, 규칙의 경고 3초 · 감속 5초보다 앞) */
const CAMP_LEAVE = 2.5;
/** 거점 안에 이만큼(초) 있으면 반경 밖으로 한 번 나갔다 온다 (규칙의 유예 5초보다 앞) */
const POINT_STAY_MAX = 3.5;
/** 시야 버튼을 다시 누르기까지 최소 틱 (스냅샷에 바뀐 모드가 오기 전에 또 눌러 되돌리지 않게) */
const MODE_PRESS_GAP = 10;
/** 조사하러 가는 길: 목표가 이보다 멀면 추적 시야 (타일) */
const GOAL_HUNT_DIST = 6;
/** 둘러보기 · 순찰 조준 흔들기 폭 (라디안)과 속도 (라디안/틱) */
const SWEEP_AMP_LOOK = 1.1;
const SWEEP_AMP_PATROL = 0.45;
const SWEEP_RATE = 0.09;

interface Sighting {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tick: number;
  prot: boolean;
  /** 이번에 처음 보인 틱 (반응 시간) */
  since: number;
}

type GoalKind = 'lost' | 'point' | 'roar' | 'exit' | 'rescue' | 'watch';

interface Goal {
  kind: GoalKind;
  x: number;
  y: number;
  /** 이 틱까지 못 닿으면 포기 */
  until: number;
  /** 닿은 뒤 둘러보기 끝 틱 (아직 안 닿았으면 null) */
  lookUntil: number | null;
  /** 둘러볼 중심 방향 (null이면 닿을 때의 조준) */
  aim: number | null;
  /** 닿은 뒤 포효 주사위를 굴렸는가 */
  rolled: boolean;
}

const GOAL_PRIORITY: Readonly<Record<GoalKind, number>> = {
  watch: 0,
  rescue: 1,
  point: 2,
  roar: 2,
  exit: 2,
  lost: 3,
};

export class PracticeMonsterBrain implements BotBrain {
  private readonly rng: Rng;
  private readonly walker = new Walker();
  private hz = 30;
  private lastObserved = -1;
  private now = 0;
  /** 임시 ID별 최근 모습 (속도 추정용). 결정은 위치로만 하고 ID 값 자체에는 기대지 않는다 */
  private readonly tracks = new Map<string, Sighting>();
  private chase: Sighting | null = null;
  private lastSawFree = 0;
  private goal: Goal | null = null;
  private loopIdx: number;
  private readonly loopStep: 1 | -1;
  private detour: Vec2 | null = null;
  private modePressSeq = -1e9;
  private roarIdle: number;
  private campTicks = 0;
  private readonly pointTicks: Record<PointId, number> = { A: 0, B: 0, C: 0 };
  private stepOut: { x: number; y: number; until: number } | null = null;
  private nextWatchAt = 0;
  private readonly dashChance: number;
  private dashBlockedUntil = 0;
  private sweep = 0;
  private stuckFrom: { x: number; y: number; tick: number } | null = null;
  /** 남은 순찰 구간 수 (0이면 할 일이 없을 때 거점 지키기와 순찰 중에 다시 고른다) */
  private patrolLegs = 0;
  private lastGuarded: PointId | null = null;
  /** 다음 기회에 포효 (쫓던 생존자를 놓쳤을 때) */
  private roarNow = false;

  constructor(seed: number) {
    this.rng = brainRng(seed, 'monster');
    this.loopIdx = this.rng.int(MONSTER_LOOP.length);
    this.loopStep = this.rng.next() < 0.5 ? 1 : -1;
    this.roarIdle = ROAR_IDLE_MIN + this.rng.next() * ROAR_IDLE_SPAN;
    this.dashChance = DASH_CHANCE_MIN + this.rng.next() * DASH_CHANCE_SPAN;
    this.sweep = this.rng.next() * Math.PI * 2;
  }

  private sec(s: number): number {
    return Math.round(s * this.hz);
  }

  decide(snap: Snapshot, info: MatchInfo, b: Balance, seq: number): InputFrame {
    const mon = snap.you.mon;
    if (!mon) return emptyInput(seq);
    this.hz = info.tickHz > 0 ? info.tickHz : b.network.serverTickHz;
    this.observe(snap, b);
    const me = snap.you.move;
    const out: InputFrame = { seq, mx: 0, my: 0, aim: me.face, held: 0, pressed: 0 };
    const firstStop = MONSTER_LOOP[this.loopIdx] ?? MONSTER_LOOP[0] ?? me;
    if (snap.world.monsterWait > 0 || me.frozen > 0) {
      out.aim = aimAt(me, firstStop);
      return out;
    }
    this.sweep += SWEEP_RATE;
    let mode: VisionModeId = 'search';
    const target = this.pickTarget(snap);
    const slowedInCamp = snap.world.imprisoned > 0 && mon.camp >= 2;
    if (target && !slowedInCamp) {
      this.chaseTarget(snap, b, target, out);
      mode = 'hunt';
    } else {
      mode = this.roam(snap, b, out);
    }
    // 시야 모드: 원하는 모드와 다르면 한 번 누르고, 스냅샷에 반영될 때까지 다시 누르지 않는다
    if (mon.mode !== mode && me.stun <= 0 && seq - this.modePressSeq >= MODE_PRESS_GAP) {
      out.pressed |= BTN.MODE;
      this.modePressSeq = seq;
    }
    return out;
  }

  /** 새 스냅샷일 때만: 이벤트 · 보이는 생존자 기록 */
  private observe(snap: Snapshot, b: Balance): void {
    if (snap.tick === this.lastObserved) return;
    const prevTick = this.lastObserved;
    const elapsed = prevTick >= 0 ? snap.tick - prevTick : 0;
    this.lastObserved = snap.tick;
    this.now = snap.tick;
    const me = snap.you.move;
    for (const ev of snap.events) {
      if (ev.k === 'roarPings') {
        // 감옥 안(수감자)은 빼고 가장 가까운 핑
        let best: Vec2 | null = null;
        for (const p of ev.pts) {
          if (distToRect(p, PRISON_RECT) <= 0.3) continue;
          if (!best || dist(me, p) < dist(me, best) - 1e-9) best = p;
        }
        if (best) this.setGoal('roar', snapToFloor(best), null);
      } else if (ev.k === 'text') {
        if (ev.id === 'ALERT_CAPTURE_START' && ev.point) this.pointGoal(ev.point, me, b);
        else if (ev.id === 'ALERT_EXIT_OPEN' && ev.exit) {
          const c = EXITS[ev.exit].center;
          this.setGoal('exit', { x: c.x, y: c.y + EXIT_INWARD[ev.exit] * 1.5 }, null);
        } else if (ev.id === 'ALERT_RESCUED') {
          this.setGoal('rescue', { x: RESCUE_POINT.x, y: RESCUE_POINT.y + 2 }, null);
        }
      } else if (ev.k === 'imprisoned') {
        // 방금 가둔 표적은 놓친 것이 아니다. 구조하러 올 테니 자주 곧장 감옥 감시로
        this.chase = null;
        if (this.rng.next() < WATCH_AFTER_JAIL_PROB) this.goal = this.watchGoal(me);
      }
    }
    // 보이는 생존자: 같은 임시 ID가 이어서 보이면 속도를 잰다
    const dtSec = elapsed / this.hz;
    const seenNow = new Set<string>();
    for (const s of snap.survivors) {
      if (s.status !== 'free') continue;
      seenNow.add(s.id);
      const prev = this.tracks.get(s.id);
      let vx = 0;
      let vy = 0;
      if (prev && dtSec > 0 && snap.tick - prev.tick <= 3) {
        const k = 0.6;
        vx = prev.vx * (1 - k) + ((s.x - prev.x) / dtSec) * k;
        vy = prev.vy * (1 - k) + ((s.y - prev.y) / dtSec) * k;
        const sp = Math.hypot(vx, vy);
        const cap = b.survivor.moveSpeed * b.roles.runner.sprintMultiplier;
        if (sp > cap) {
          vx = (vx / sp) * cap;
          vy = (vy / sp) * cap;
        }
      }
      const since = prev ? prev.since : snap.tick;
      this.tracks.set(s.id, { id: s.id, x: s.x, y: s.y, vx, vy, tick: snap.tick, prot: s.protected, since });
      this.lastSawFree = snap.tick;
    }
    for (const [id, t] of this.tracks)
      if (!seenNow.has(id) && snap.tick - t.tick > 30) this.tracks.delete(id);
    // 놓친 표적: 마지막 모습에서 조금 앞을 찾아간다
    if (this.chase && !seenNow.has(this.chase.id)) {
      const c = this.chase;
      let lx = c.vx * LOST_LEAD;
      let ly = c.vy * LOST_LEAD;
      const l = Math.hypot(lx, ly);
      if (l > LOST_LEAD_MAX) {
        lx = (lx / l) * LOST_LEAD_MAX;
        ly = (ly / l) * LOST_LEAD_MAX;
      }
      const ahead = { x: c.x + lx, y: c.y + ly };
      const spot = clearPath(c, ahead, 0.2) ? snapToFloor(ahead) : snapToFloor(c);
      this.chase = null;
      this.setGoal('lost', spot, l > 0.1 ? Math.atan2(ly, lx) : null, LOST_TIME);
      this.roarNow = this.rng.next() < ROAR_ON_LOST_PROB;
    }
    // 거점 안 머문 시간 (규칙: 거점 반경 안 연속 시간)
    for (const id of POINT_IDS) {
      const inside = dist(me, CAPTURE_POINTS[id]) <= b.capturePoint.radius;
      this.pointTicks[id] = inside ? this.pointTicks[id] + elapsed : 0;
    }
    const inCamp = distToRect(me, PRISON_RECT) <= b.prison.campRadius;
    this.campTicks = snap.world.imprisoned > 0 && inCamp ? this.campTicks + elapsed : 0;
  }

  /** 거점 조사: 반경 바로 바깥, 내가 오는 쪽에 서서 거점을 바라본다 */
  private pointGoal(id: PointId, me: Vec2, b: Balance): void {
    const c = CAPTURE_POINTS[id];
    const u = unit(me.x - c.x, me.y - c.y);
    const dir = u.x === 0 && u.y === 0 ? { x: 1, y: 0 } : u;
    const r = b.capturePoint.radius + AMBUSH_OUT;
    const at = snapToFloor({ x: c.x + dir.x * r, y: c.y + dir.y * r });
    this.setGoal('point', at, aimAt(at, c));
  }

  private setGoal(kind: GoalKind, at: Vec2, aim: number | null, seconds = GOAL_TIME): void {
    const cur = this.goal;
    if (cur && GOAL_PRIORITY[cur.kind] > GOAL_PRIORITY[kind] && cur.until > this.now) return;
    this.goal = {
      kind,
      x: at.x,
      y: at.y,
      until: this.now + this.sec(seconds),
      lookUntil: null,
      aim,
      rolled: false,
    };
    this.stuckFrom = null;
  }

  /** 쫓을 생존자: 가까운 자유 생존자, 보호 중이면 뒤로. 같으면 위치 순 (배열 순서 · 임시 ID에 기대지 않는다) */
  private pickTarget(snap: Snapshot): Sighting | null {
    const me = snap.you.move;
    let best: SurvivorView | null = null;
    let bestScore = Infinity;
    for (const s of snap.survivors) {
      if (s.status !== 'free') continue;
      let score = dist(me, s) + (s.protected ? PROTECTED_PENALTY : 0);
      if (this.chase && this.chase.id === s.id) score -= KEEP_TARGET_BONUS;
      const tie = Math.abs(score - bestScore) <= 1e-9;
      if (score < bestScore - 1e-9 || (tie && best && (s.x < best.x || (s.x === best.x && s.y < best.y)))) {
        best = s;
        bestScore = score;
      }
    }
    if (!best) return null;
    const t = this.tracks.get(best.id) ?? {
      id: best.id,
      x: best.x,
      y: best.y,
      vx: 0,
      vy: 0,
      tick: this.now,
      prot: best.protected,
      since: this.now,
    };
    if (!this.chase || this.chase.id !== t.id) this.dashBlockedUntil = 0;
    this.chase = t;
    // 쫓는 동안 조사 목표는 잊는다 (놓치면 새로 정한다)
    if (this.goal && this.goal.kind !== 'watch') this.goal = null;
    return t;
  }

  private chaseTarget(snap: Snapshot, b: Balance, t: Sighting, out: InputFrame): void {
    const me = snap.you.move;
    const mon = snap.you.mon;
    if (!mon) return;
    const d = dist(me, t);
    const lead = Math.min(CHASE_LEAD_MAX, d / b.monster.moveSpeed);
    const predRaw = { x: t.x + t.vx * lead, y: t.y + t.vy * lead };
    const pred = walkableAt(predRaw) ? predRaw : { x: t.x, y: t.y };
    if (d < DIRECT_CHASE && clearPath(me, pred, b.monster.radius)) {
      const u = unit(pred.x - me.x, pred.y - me.y);
      out.mx = u.x;
      out.my = u.y;
    } else {
      const w = this.walker.toward(snap, pred, 0.2);
      out.mx = w.mx;
      out.my = w.my;
    }
    const wind = b.monster.attack.windup;
    const strike = { x: t.x + t.vx * wind, y: t.y + t.vy * wind };
    out.aim = aimAt(me, strike);
    const canAct = me.stun <= 0 && me.dash <= 0 && mon.windup <= 0;
    if (!canAct || t.prot || this.now - t.since < this.sec(REACT_TIME)) return;
    // 공격: 준비가 끝날 때 예상 거리 (표적이 멀어지는 속도만큼 덜 따라잡는다)
    const u = unit(t.x - me.x, t.y - me.y);
    const away = Math.max(-APPROACH_TRUST, t.vx * u.x + t.vy * u.y);
    const closing = b.monster.moveSpeed * b.monster.attack.windupMoveMultiplier - away;
    const contact = b.monster.radius + b.survivor.radius;
    const gap = Math.max(contact, d - closing * wind);
    const reach = b.monster.attack.range + b.survivor.radius - ATTACK_MARGIN;
    const facing = Math.abs(angleDiff(me.face, aimAt(me, strike)));
    if (mon.attackCd <= 0 && gap <= reach && d <= reach + ATTACK_NOW_SLACK && facing <= ATTACK_FACING) {
      out.pressed |= BTN.ATTACK;
      return;
    }
    // 돌진: 중간 거리 · 직선 · 조준이 맞을 때, 공격이 곧 준비되면 (주사위로 가끔)
    if (mon.dashCd > 0 || mon.attackCd > DASH_ATTACK_CD_MAX) return;
    if (d < DASH_MIN || d > DASH_MAX) return;
    const dur = b.monster.dash.duration;
    const after = { x: t.x + t.vx * dur, y: t.y + t.vy * dur };
    const dashDir = aimAt(me, after);
    out.aim = dashDir;
    if (Math.abs(angleDiff(me.face, dashDir)) > DASH_FACING) return;
    const reachEnd = Math.min(b.monster.dash.distance, dist(me, after));
    const end = { x: me.x + Math.cos(dashDir) * reachEnd, y: me.y + Math.sin(dashDir) * reachEnd };
    if (!clearPath(me, end, b.monster.radius)) return;
    if (this.now < this.dashBlockedUntil) return;
    if (this.rng.next() < this.dashChance) out.pressed |= BTN.DASH;
    else this.dashBlockedUntil = this.now + this.sec(DASH_REROLL);
  }

  /** 아무도 안 보일 때: 캠핑 · 거점 유예 피하기 → 조사 → 감옥 감시 → 순찰. 원하는 시야 모드를 돌려준다 */
  private roam(snap: Snapshot, b: Balance, out: InputFrame): VisionModeId {
    const me = snap.you.move;
    const mon = snap.you.mon;
    if (!mon) return 'search';
    const ready = me.stun <= 0 && me.dash <= 0 && mon.windup <= 0;
    // 한동안 아무도 못 봤거나 방금 놓쳤으면 포효
    if (
      ready &&
      mon.roarCd <= 0 &&
      (this.roarNow || this.now - this.lastSawFree >= this.sec(this.roarIdle))
    ) {
      out.pressed |= BTN.ROAR;
      this.lastSawFree = this.now;
      this.roarIdle = ROAR_IDLE_MIN + this.rng.next() * ROAR_IDLE_SPAN;
    }
    this.roarNow = false;
    // 감옥 캠핑: 경고 전에 감시 자리로 나간다 (감시 자리는 반경 밖)
    if (snap.world.imprisoned > 0 && (mon.camp >= 1 || this.campTicks >= this.sec(CAMP_LEAVE))) {
      if (!this.goal || this.goal.kind !== 'watch') this.goal = this.watchGoal(me);
    }
    // 거점 지키기 유예 (안 끝난 거점만 해당): 반경 밖으로 한 번 나갔다 온다
    if (!this.stepOut) {
      for (const id of POINT_IDS) {
        if (this.pointTicks[id] < this.sec(POINT_STAY_MAX)) continue;
        if (snap.world.points.some((p) => p.id === id && !pointOpen(p.state))) continue;
        const c = CAPTURE_POINTS[id];
        const u = unit(me.x - c.x, me.y - c.y);
        const dir = u.x === 0 && u.y === 0 ? { x: 1, y: 0 } : u;
        const r = b.capturePoint.radius + 1.0;
        const p = snapToFloor({ x: c.x + dir.x * r, y: c.y + dir.y * r });
        this.stepOut = { x: p.x, y: p.y, until: this.now + this.sec(1.5) };
      }
    }
    if (this.stepOut) {
      const s = this.stepOut;
      const w = this.walker.toward(snap, s, 0.3);
      out.mx = w.mx;
      out.my = w.my;
      out.aim = w.mx !== 0 || w.my !== 0 ? Math.atan2(w.my, w.mx) : me.face;
      if (w.arrived || this.now >= s.until) this.stepOut = null;
      return 'search';
    }
    // 둘 이상 갇혀 있으면 감옥 감시가 먼저 (한 명만 더 잡으면 이긴다)
    const guardPrison = snap.world.imprisoned >= 2;
    if (guardPrison && (!this.goal || this.goal.kind === 'point') && this.now >= this.nextWatchAt) {
      this.goal = this.watchGoal(me);
    }
    // 점령 중인 거점 (괴물 화면 배지): 진행이 많은 쪽으로
    if (!this.goal || (this.goal.kind === 'watch' && !guardPrison)) {
      let best: PointId | null = null;
      let bestProgress = -1;
      for (const p of snap.world.points) {
        if ((p.state === 'capturing' || p.state === 'blocked') && p.progress > bestProgress) {
          best = p.id;
          bestProgress = p.progress;
        }
      }
      if (best) this.pointGoal(best, me, b);
    }
    // 감옥 감시: 갇힌 사람이 있고 할 일이 없으면 가끔
    if (!this.goal && snap.world.imprisoned > 0 && this.now >= this.nextWatchAt) {
      this.goal = this.watchGoal(me);
    }
    // 할 일이 없으면: 안 끝난 거점을 번갈아 지키거나, 순찰을 몇 구간 돈다
    const exitsOn = snap.world.exits.some((e) => e.state !== 'inactive');
    if (!this.goal && this.patrolLegs <= 0 && !exitsOn) {
      const undone = snap.world.points.filter((p) => pointOpen(p.state)).map((p) => p.id);
      if (undone.length > 0 && this.rng.next() < POINT_PATROL_PROB) {
        const next = nextGuarded(undone, this.lastGuarded);
        this.lastGuarded = next;
        this.pointGoal(next, me, b);
      } else {
        this.patrolLegs = PATROL_LEGS_MIN + this.rng.int(PATROL_LEGS_SPAN);
      }
    }
    if (this.goal) return this.followGoal(snap, this.goal, out, ready);
    return this.patrol(snap, out);
  }

  private watchGoal(me: Vec2): Goal {
    let best = WATCH_SPOTS[0] ?? RESCUE_POINT;
    let bestD = Infinity;
    for (const s of WATCH_SPOTS) {
      const d = pathDist(fieldFrom(s), me);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = s;
      }
    }
    this.nextWatchAt =
      this.now + this.sec(WATCH_MIN + WATCH_SPAN + WATCH_GAP_MIN + this.rng.next() * WATCH_GAP_SPAN);
    return {
      kind: 'watch',
      x: best.x,
      y: best.y,
      until: this.now + this.sec(GOAL_TIME),
      lookUntil: null,
      aim: aimAt(best, RESCUE_POINT),
      rolled: true,
    };
  }

  private followGoal(snap: Snapshot, g: Goal, out: InputFrame, ready: boolean): VisionModeId {
    const me = snap.you.move;
    const mon = snap.you.mon;
    if (g.lookUntil === null) {
      const w = this.walker.toward(snap, g, g.kind === 'watch' ? WATCH_TOLERANCE : 0.6);
      out.mx = w.mx;
      out.my = w.my;
      const moving = w.mx !== 0 || w.my !== 0;
      out.aim = moving ? Math.atan2(w.my, w.mx) + Math.sin(this.sweep) * SWEEP_AMP_PATROL : me.face;
      if (w.arrived || this.stuck(me, moving)) {
        const look =
          g.kind === 'watch'
            ? WATCH_MIN + this.rng.next() * WATCH_SPAN
            : g.kind === 'point'
              ? AMBUSH_MIN + this.rng.next() * AMBUSH_SPAN
              : LOOK_TIME;
        g.lookUntil = this.now + this.sec(look);
        if (g.aim === null) g.aim = me.face;
      } else if (this.now >= g.until) {
        this.goal = null;
      }
      return dist(me, g) > GOAL_HUNT_DIST || g.kind === 'lost' ? 'hunt' : 'search';
    }
    // 둘러보기
    const base = g.aim ?? me.face;
    if (g.kind === 'watch' || g.kind === 'point') {
      out.aim = base + Math.sin(this.sweep) * (g.kind === 'watch' ? 0.3 : 0.7);
    } else {
      out.aim = base + Math.sin(this.sweep * 1.4) * SWEEP_AMP_LOOK;
      if (!g.rolled) {
        g.rolled = true;
        if (ready && mon && mon.roarCd <= 0 && this.rng.next() < ROAR_AT_LOOK_PROB) {
          out.pressed |= BTN.ROAR;
          this.lastSawFree = this.now;
        }
      }
    }
    if (this.now >= g.lookUntil) this.goal = null;
    return g.kind === 'watch' || g.kind === 'point' ? 'hunt' : 'search';
  }

  private patrol(snap: Snapshot, out: InputFrame): VisionModeId {
    const me = snap.you.move;
    const exitsOn = snap.world.exits.some((e) => e.state !== 'inactive');
    const loop = exitsOn ? MONSTER_EXIT_LOOP : MONSTER_LOOP;
    const n = loop.length;
    const idx = ((this.loopIdx % n) + n) % n;
    const stop = this.detour ?? loop[idx] ?? me;
    const w = this.walker.toward(snap, stop, 1.0);
    out.mx = w.mx;
    out.my = w.my;
    const moving = w.mx !== 0 || w.my !== 0;
    out.aim = moving ? Math.atan2(w.my, w.mx) + Math.sin(this.sweep) * SWEEP_AMP_PATROL : me.face + 0.1;
    if (w.arrived || this.stuck(me, moving)) {
      if (this.detour) this.detour = null;
      else {
        this.patrolLegs -= 1;
        this.loopIdx = idx + this.loopStep;
        if (!exitsOn && snap.world.imprisoned === 0 && this.rng.next() < DETOUR_PROB) {
          this.detour = this.rng.pick(MONSTER_CROSS);
        }
      }
      this.stuckFrom = null;
    }
    return 'search';
  }

  /** 움직이려는데 STUCK_TICKS 동안 거의 못 움직였는가 */
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

/** 괴물이 할 일 없을 때 번갈아 지킬 다음 거점: 지난번 거점 다음 id (A → B → C → A 순환, 열린 곳만) */
export function nextGuarded(open: readonly PointId[], last: PointId | null): PointId {
  const first = open[0] ?? 'A';
  if (last === null) return first;
  const at = POINT_IDS.indexOf(last);
  for (let k = 1; k <= POINT_IDS.length; k += 1) {
    const id = POINT_IDS[(at + k) % POINT_IDS.length] as PointId;
    if (open.includes(id)) return id;
  }
  return first;
}
