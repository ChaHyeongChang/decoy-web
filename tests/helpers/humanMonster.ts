// 사람 흉내 괴물 (플레이테스트 반영 c): "처음 괴물을 해 보는 사람"이 봇전 한 판에 몇 번 가두는지 재는 대역.
// docs/playtest/c-bots.md 2.2절 정의를 옮겼다 — 실전 봇 두뇌(practiceMonster.ts)와 따로, 자기 스냅샷만 본다.
//  - novice (처음 해 보는 사람): 탐색 시야만(시야 버튼을 누르지 않는다), 돌진 · 포효 없음, 표적의 지금 자리로 걷고,
//    조준은 0.1초쯤 늦게 따라가며 ±8° 오차, 사거리 안이라고 본 뒤 0.3초 지나 누른다. 안 보이면 거점을 돌고,
//    점령 알림이 오면 그 거점으로 간다
//  - mid (조금 해 본 사람): 이동 중 멀면 추적 시야, 0.2초에 누름, 0.3초 앞질러 조준, 2.6~4.6타일 직선이면 돌진
// 실제 사람보다 길찾기 · 추적은 낫고(막히지 않는 최단 경로) 숨은 곳 짐작 · 속임은 못한다 — 절대값이 아니라 봇 변경 전후를 견주는 잣대다.
// "처음 하는 사람이 두세 번"은 사람이 확인한다(docs/HUMAN_CHECKS.md)
import {
  BTN,
  CAPTURE_POINTS,
  POINT_IDS,
  Rng,
  angleDiff,
  emptyInput,
  lineOfSight,
  type Balance,
  type InputFrame,
  type MatchInfo,
  type PointId,
  type Snapshot,
  type SurvivorView,
  type Vec2,
  type VisionModeId,
} from '@decoy/shared';
import { MONSTER_LOOP, Walker, aimAt, dist, type BotBrain } from '@decoy/shared/sim';

export interface HumanMonsterProfile {
  name: 'novice' | 'mid';
  /** 사거리 안이라고 본 뒤 공격을 누르기까지 (초) */
  pressDelay: number;
  /** 조준이 원하는 방향을 따라가는 시간 상수 (초) */
  aimLag: number;
  /** 조준 오차 (±라디안, 균등). AIM_ERROR_HOLD초마다 다시 뽑는다 */
  aimError: number;
  /** 표적 이동을 내다보는 시간 (초, 0이면 지금 자리) */
  lead: number;
  /** 돌진 쓰는 표적 거리 범위 (타일, null이면 돌진 안 함) */
  dash: readonly [number, number] | null;
  /** 이동 중 표적이 이보다 멀면 추적 시야 (null이면 늘 탐색 시야 — 시야 버튼을 안 누른다) */
  huntBeyond: number | null;
  /** '닿는다'고 보는 거리: 사거리 + 생존자 반지름에서 이만큼 안쪽 (타일) */
  reachMargin: number;
  /** 아무도 안 보일 때 다음 갈 곳으로 안 끝난 거점을 고를 확률 (아니면 맵 둘레 순찰 지점 하나) */
  pointBias: number;
}

export const NOVICE: HumanMonsterProfile = {
  name: 'novice',
  pressDelay: 0.3,
  aimLag: 0.1,
  aimError: (8 * Math.PI) / 180,
  lead: 0,
  dash: null,
  huntBeyond: null,
  reachMargin: 0.3,
  pointBias: 0.5,
};

export const MID: HumanMonsterProfile = {
  name: 'mid',
  pressDelay: 0.2,
  aimLag: 0.08,
  aimError: (5 * Math.PI) / 180,
  lead: 0.3,
  dash: [2.6, 4.6],
  huntBeyond: 4,
  reachMargin: 0.1,
  pointBias: 0.6,
};

/** 조준 오차를 다시 뽑는 간격 (초) */
const AIM_ERROR_HOLD = 0.5;
/** 놓친 자리를 찾아가는 시간 한도 (초) — 마지막으로 본 자리까지 가 보고 없으면 거점 순회로 */
const LOST_SEC = 4.5;
/** 알림 받은 거점까지 가는 시간 한도 (초) */
const ALERT_SEC = 20;
/** 막힘: 이 틱 동안 이만큼(타일)도 못 움직이면 다음 지점으로 */
const STUCK_TICKS = 45;
const STUCK_MOVE = 0.3;

interface Seen {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tick: number;
}

export class HumanMonsterBrain implements BotBrain {
  private readonly rng: Rng;
  private readonly walker = new Walker();
  private hz = 30;
  private aim: number | null = null;
  private aimErr = 0;
  private aimErrUntil = 0;
  private inRangeSince: number | null = null;
  private lastObserved = -1;
  private readonly tracks = new Map<string, Seen>();
  private lastSeen: { x: number; y: number; until: number } | null = null;
  private alert: { id: PointId; until: number } | null = null;
  /** 아무도 안 보일 때 가는 곳 (거점이면 id, 아니면 순찰 지점) */
  private roam: { id: PointId | null; at: Vec2 } | null = null;
  private stuckFrom: { x: number; y: number; tick: number } | null = null;
  private modePressSeq = -1e9;

  constructor(
    readonly profile: HumanMonsterProfile,
    seed: number,
  ) {
    this.rng = new Rng((Math.imul(seed | 0, 0x27d4eb2d) ^ 0x165667b1) >>> 0);
  }

  decide(snap: Snapshot, info: MatchInfo, b: Balance, seq: number): InputFrame {
    const mon = snap.you.mon;
    if (!mon) return emptyInput(seq);
    this.hz = info.tickHz > 0 ? info.tickHz : b.network.serverTickHz;
    const me = snap.you.move;
    this.observe(snap);
    const out: InputFrame = { seq, mx: 0, my: 0, aim: this.aim ?? me.face, held: 0, pressed: 0 };
    if (snap.world.monsterWait > 0 || me.frozen > 0) return out;
    const target = this.pickTarget(snap);
    let want: VisionModeId = 'search';
    let goal: Vec2;
    let tol = 0.6;
    if (target) {
      const t = this.tracks.get(target.id);
      const vx = t?.vx ?? 0;
      const vy = t?.vy ?? 0;
      const ahead = { x: target.x + vx * this.profile.lead, y: target.y + vy * this.profile.lead };
      goal = this.profile.lead > 0 ? ahead : { x: target.x, y: target.y };
      tol = 0.2;
      const d = dist(me, target);
      if (this.profile.huntBeyond !== null && d > this.profile.huntBeyond) want = 'hunt';
      this.steerAim(snap, aimAt(me, goal));
      this.lastSeen = { x: target.x, y: target.y, until: snap.tick + this.sec(LOST_SEC) };
      // 공격: 닿는다고 본 뒤 pressDelay가 지나면 누른다
      const reach = b.monster.attack.range + b.survivor.radius - this.profile.reachMargin;
      const canAct = me.stun <= 0 && me.dash <= 0 && mon.windup <= 0;
      if (d <= reach && !target.protected) {
        if (this.inRangeSince === null) this.inRangeSince = snap.tick;
        if (
          canAct &&
          mon.attackCd <= 0 &&
          snap.tick - this.inRangeSince >= this.sec(this.profile.pressDelay)
        ) {
          out.pressed |= BTN.ATTACK;
          this.inRangeSince = null;
        }
      } else {
        this.inRangeSince = null;
        const dr = this.profile.dash;
        if (
          dr &&
          canAct &&
          mon.dashCd <= 0 &&
          d >= dr[0] &&
          d <= dr[1] &&
          lineOfSight(me, target) &&
          Math.abs(angleDiff(me.face, aimAt(me, goal))) < 0.15
        ) {
          out.pressed |= BTN.DASH;
        }
      }
    } else {
      this.inRangeSince = null;
      goal = this.roamGoal(snap);
      tol = 0.8;
      if (this.profile.huntBeyond !== null) want = 'hunt';
    }
    const w = this.walker.toward(snap, goal, tol);
    out.mx = w.mx;
    out.my = w.my;
    const moving = w.mx !== 0 || w.my !== 0;
    if (!target) {
      // 걷는 쪽을 본다 (사람은 가는 쪽을 본다)
      if (moving) this.steerAim(snap, Math.atan2(w.my, w.mx));
      if (w.arrived || this.stuck(snap, moving)) this.arrived();
    }
    out.aim = this.aim ?? me.face;
    if (mon.mode !== want && me.stun <= 0 && seq - this.modePressSeq >= 10) {
      out.pressed |= BTN.MODE;
      this.modePressSeq = seq;
    }
    return out;
  }

  private sec(s: number): number {
    return Math.round(s * this.hz);
  }

  private observe(snap: Snapshot): void {
    if (snap.tick === this.lastObserved) return;
    const dt = this.lastObserved >= 0 ? (snap.tick - this.lastObserved) / this.hz : 0;
    this.lastObserved = snap.tick;
    for (const s of snap.survivors) {
      if (s.status !== 'free') continue;
      const p = this.tracks.get(s.id);
      const vx = p && dt > 0 && snap.tick - p.tick <= 3 ? (s.x - p.x) / dt : 0;
      const vy = p && dt > 0 && snap.tick - p.tick <= 3 ? (s.y - p.y) / dt : 0;
      this.tracks.set(s.id, { x: s.x, y: s.y, vx, vy, tick: snap.tick });
    }
    for (const [id, t] of this.tracks) if (snap.tick - t.tick > 30) this.tracks.delete(id);
    for (const ev of snap.events) {
      if (ev.k === 'text' && ev.id === 'ALERT_CAPTURE_START' && ev.point) {
        this.alert = { id: ev.point, until: snap.tick + this.sec(ALERT_SEC) };
      }
    }
  }

  /** 가까운 자유 생존자 (보호 중이면 뒤로). 같으면 자리 순 */
  private pickTarget(snap: Snapshot): SurvivorView | null {
    const me = snap.you.move;
    let best: SurvivorView | null = null;
    let bestScore = Infinity;
    for (const s of snap.survivors) {
      if (s.status !== 'free') continue;
      const score = dist(me, s) + (s.protected ? 6 : 0);
      if (
        score < bestScore - 1e-9 ||
        (Math.abs(score - bestScore) <= 1e-9 && best && (s.x < best.x || (s.x === best.x && s.y < best.y)))
      ) {
        best = s;
        bestScore = score;
      }
    }
    return best;
  }

  /** 아무도 안 보일 때 갈 곳: 놓친 자리 → 알림 받은 거점 → 안 끝난 거점이나 맵 둘레 순찰 지점 하나 (시드 난수로 고른다) */
  private roamGoal(snap: Snapshot): Vec2 {
    if (this.lastSeen && snap.tick < this.lastSeen.until) return this.lastSeen;
    this.lastSeen = null;
    const open = (id: PointId): boolean => {
      const st = snap.world.points.find((p) => p.id === id)?.state;
      // 스냅샷에 없는 거점(거점 수가 다른 옛 규칙 코드)도 뺀다
      return st !== undefined && st !== 'done' && st !== 'off';
    };
    if (this.alert && snap.tick < this.alert.until && open(this.alert.id))
      return CAPTURE_POINTS[this.alert.id];
    this.alert = null;
    if (this.roam && (this.roam.id === null || open(this.roam.id))) return this.roam.at;
    const points = POINT_IDS.filter(open);
    if (points.length > 0 && this.rng.next() < this.profile.pointBias) {
      const id = points[this.rng.int(points.length)] ?? 'A';
      this.roam = { id, at: CAPTURE_POINTS[id] };
    } else {
      this.roam = { id: null, at: MONSTER_LOOP[this.rng.int(MONSTER_LOOP.length)] ?? CAPTURE_POINTS.A };
    }
    return this.roam.at;
  }

  private arrived(): void {
    if (this.lastSeen) this.lastSeen = null;
    else if (this.alert) this.alert = null;
    else this.roam = null;
  }

  /** 조준: 원하는 방향 + 오차를 시간 상수 aimLag로 따라간다 */
  private steerAim(snap: Snapshot, desired: number): void {
    if (snap.tick >= this.aimErrUntil) {
      this.aimErr = (this.rng.next() * 2 - 1) * this.profile.aimError;
      this.aimErrUntil = snap.tick + this.sec(AIM_ERROR_HOLD);
    }
    const goal = desired + this.aimErr;
    const cur = this.aim ?? snap.you.move.face;
    const k = 1 - Math.exp(-1 / (this.hz * Math.max(1e-3, this.profile.aimLag)));
    this.aim = cur + angleDiff(cur, goal) * k;
  }

  private stuck(snap: Snapshot, moving: boolean): boolean {
    const me = snap.you.move;
    if (!moving) {
      this.stuckFrom = null;
      return false;
    }
    const s = this.stuckFrom;
    if (!s || dist(s, me) > STUCK_MOVE) {
      this.stuckFrom = { x: me.x, y: me.y, tick: snap.tick };
      return false;
    }
    if (snap.tick - s.tick >= STUCK_TICKS) {
      this.stuckFrom = null;
      return true;
    }
    return false;
  }
}

export function humanMonster(profile: HumanMonsterProfile, seed: number): BotBrain {
  return new HumanMonsterBrain(profile, seed);
}
