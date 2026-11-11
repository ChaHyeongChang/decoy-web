// 실전 생존자 봇 두뇌 (플레이테스트 반영 c): 사람 수준 반응 · 서 있지 않기 · 역할에 묶이지 않는 자리 · 카운트다운
//  - 공격 준비를 본 뒤 옆걸음은 0.25~0.35초(가끔 미리 읽고 0.10~0.15초) 뒤, 가끔 못 비킴 · 반대쪽, 같은 시드는 같은 결과, 역할과 무관한 분포
//  - 질주 · 밀치기도 조건이 처음 참이 된 뒤 0.2~0.35초 (조건이 풀리면 취소)
//  - 쫓기지 않을 때 할 일이 남았으면 목표 구역 밖에서 1.5초 넘게 서 있지 않다 (실전 괴물 봇 · 거점 밖에 선 괴물 · 감옥 남쪽에 선 괴물)
//  - 거점 밖에 서 있는 괴물 상대로도 판이 진행된다 (다른 거점 점령)
//  - 거점 · 탈출구에서 서는 자리와 미끼 순서는 역할에 묶이지 않는다 (판 시드로 섞음 — 괴물 화면 단서 없음)
//  - 스카우트 탐지 대기는 시작 카운트다운 동안 세지 않는다
//  - 처음 괴물을 해 보는 사람 흉내(novice) 대 생존자 봇 셋: 판당 수감 2~4.5번, 0번인 판은 드물다
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BTN,
  CAPTURE_POINTS,
  EXITS,
  POINT_IDS,
  RESCUE_POINT,
  blocksMove,
  emptyInput,
  monsterSees,
  type Balance,
  type InputFrame,
  type MatchInfo,
  type PointId,
  type RoleId,
  type Snapshot,
  type Vec2,
} from '@decoy/shared';
import {
  FLEE_SPOTS,
  PracticeSurvivorBrain,
  SimMatch,
  WATCH_SPOTS,
  idleBrain,
  practiceBrain,
  preparePracticeMap,
  survivorPlan,
  type BotBrain,
  type Game,
} from '@decoy/shared/sim';
import { decoyOrder, splitOrder, standSlot } from '../../shared/src/sim/practiceSurvivor';
import { NOVICE, humanMonster } from '../helpers/humanMonster';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
const HZ = balance.network.serverTickHz;
const ROLES: readonly RoleId[] = ['runner', 'guard', 'scout'];
/** 자유 생존자 · 괴물이 함께 다닐 수 있는 칸 (탈출구 닫힘) */
const OPEN_CTX = { kind: 'monster' as const, imprisoned: false, openExits: { N: false, S: false } };
/** SimMatch.roles()의 자리: 괴물 p1, 러너 p2, 가드 p3, 스카우트 p4 */
const SEAT: Readonly<Record<RoleId, string>> = { runner: 'p2', guard: 'p3', scout: 'p4' };

beforeAll(() => {
  preparePracticeMap();
});

/** 손으로 맞추는 장면: 준 두뇌 말고는 모두 가만히 있고, 괴물 시작 정지는 없다 */
function scene(seed: number, brains: Readonly<Record<string, BotBrain>> = {}): SimMatch {
  const setup = SimMatch.roles();
  const sim = new SimMatch(
    setup,
    balance,
    new Map(setup.map((p) => [p.id, brains[p.id] ?? idleBrain])),
    seed,
  );
  sim.game.monster.move.frozen = 0;
  return sim;
}

/** 손으로 바꾼 판 상태가 스냅샷에 담길 때까지 (스냅샷은 20Hz라 틱마다 오지 않는다) */
function refreshSnapshots(sim: SimMatch): void {
  const before = sim.lastSnap.get('p1');
  for (let i = 0; i < 4 && sim.lastSnap.get('p1') === before; i += 1) sim.step();
}

function far(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 한 역할의 스냅샷 · MatchInfo (괴물이 me에서 동쪽 gap 타일, 다른 생존자는 멀리) */
function closeUp(role: RoleId, gap: number): { snap: Snapshot; info: MatchInfo; me: Vec2; mon: Vec2 } {
  const sim = scene(1);
  const g = sim.game;
  // 넓은 남쪽 홀 (동쪽 3타일까지 바닥, 벽 · 기둥 없음)
  const me = { x: 30.5, y: 24.5 };
  const mon = { x: me.x + gap, y: me.y };
  for (const r of ROLES)
    if (r !== role) place(g, SEAT[r], r === 'guard' ? 5.5 : 4.5, r === 'scout' ? 28.5 : 4.5);
  place(g, SEAT[role], me.x, me.y);
  place(g, 'p1', mon.x, mon.y, Math.PI);
  for (const s of g.survivors) s.abilityCd = 30;
  refreshSnapshots(sim);
  const snap = sim.lastSnap.get(SEAT[role]);
  const info = sim.infos.get(SEAT[role]);
  if (!snap || !info || !snap.monster) throw new Error('장면 스냅샷 없음');
  return { snap, info, me, mon };
}

/** 같은 스냅샷을 틱만 올려 보낸다 (monster를 바꿔 끼울 수 있다) */
function at(snap: Snapshot, tick: number, monster: Snapshot['monster'], abilityCd?: number): Snapshot {
  const surv = snap.you.surv && abilityCd !== undefined ? { ...snap.you.surv, abilityCd } : snap.you.surv;
  return { ...snap, tick, monster, events: [], you: { ...snap.you, surv } };
}

interface Reaction {
  /** 옆걸음 시작까지 (초), 못 비켰으면 null */
  sec: number | null;
  /** 비킨 쪽이 조준선에서 멀어지는 쪽인가 */
  correctSide: boolean | null;
}

/**
 * 공격 준비를 본 뒤 옆걸음이 시작되기까지: 괴물이 1타일 앞에서 나를 조준(조금 비껴)하고, 준비 0.4초를 보인 스냅샷부터
 * 틱마다 같은 스냅샷을 보낸다. 이동 방향이 준비 전(곧장 반대쪽)에서 0.2라디안 넘게 돌면 옆걸음 시작
 */
function windupReaction(role: RoleId, seed: number): Reaction {
  const { snap, info, me, mon } = closeUp(role, 1.0);
  const brain = new PracticeSurvivorBrain(role, seed);
  const base = snap.monster;
  if (!base) throw new Error('괴물 없음');
  // 조준은 나를 향해 0.1라디안 비껴: 나는 조준선 오른쪽(시계 방향)에 있다 → 바른 옆걸음은 시계 방향으로 돈다
  const aim = Math.atan2(me.y - mon.y, me.x - mon.x) + 0.1;
  const t0 = snap.tick + 10;
  const calm = brain.decide(at(snap, t0, { ...base, windup: 0, aim }), info, balance, 1);
  const angle0 = Math.atan2(calm.my, calm.mx);
  const seen = t0 + 1;
  for (let k = 0; k <= 20; k += 1) {
    const out = brain.decide(at(snap, seen + k, { ...base, windup: 0.4, aim }), info, balance, 2 + k);
    const d = Math.atan2(
      Math.sin(Math.atan2(out.my, out.mx) - angle0),
      Math.cos(Math.atan2(out.my, out.mx) - angle0),
    );
    if (Math.abs(d) > 0.2) return { sec: k / HZ, correctSide: d < 0 };
  }
  return { sec: null, correctSide: null };
}

describe('생존자 봇: 공격 준비에 사람 수준으로 반응한다', () => {
  const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);
  const byRole = new Map<RoleId, Reaction[]>();
  beforeAll(() => {
    for (const role of ROLES)
      byRole.set(
        role,
        SEEDS.map((s) => windupReaction(role, s)),
      );
  });

  it('옆걸음은 준비를 본 뒤 0.25~0.35초(미리 읽은 경우 0.10초 이상)에 시작한다 — 1~2틱(33~67ms)에 비키지 않는다', () => {
    for (const role of ROLES) {
      const rs = byRole.get(role) ?? [];
      const secs = rs.flatMap((r) => (r.sec === null ? [] : [r.sec]));
      expect(secs.length).toBeGreaterThan(rs.length / 2);
      for (const s of secs) {
        expect(s).toBeGreaterThanOrEqual(0.1 - 1e-9);
        expect(s).toBeLessThanOrEqual(0.35 + 1 / HZ + 1e-9);
      }
      // 대부분은 사람 반응 시간 0.25초 이상, 미리 읽은 경우(0.10~0.17초)도 가끔 있다
      const human = secs.filter((s) => s >= 0.25 - 1e-9).length / secs.length;
      expect(human).toBeGreaterThan(0.65);
      expect(human).toBeLessThan(0.95);
      expect(secs.some((s) => s < 0.2)).toBe(true);
    }
  });

  it('매번 완벽하게 피하지는 않는다: 못 비키는 판 · 조준선 쪽으로 잘못 비키는 판이 있다', () => {
    for (const role of ROLES) {
      const rs = byRole.get(role) ?? [];
      const skip = rs.filter((r) => r.sec === null).length / rs.length;
      expect(skip).toBeGreaterThan(0.05);
      expect(skip).toBeLessThan(0.3);
      const dodged = rs.filter((r) => r.correctSide !== null);
      const wrong = dodged.filter((r) => r.correctSide === false).length / dodged.length;
      expect(wrong).toBeGreaterThan(0);
      expect(wrong).toBeLessThan(0.2);
    }
  });

  it('반응 분포는 역할과 무관하다 (괴물 화면에서 반응 시간으로 역할을 가리지 못하게)', () => {
    const stats = ROLES.map((role) => {
      const rs = byRole.get(role) ?? [];
      const secs = rs.flatMap((r) => (r.sec === null ? [] : [r.sec]));
      return {
        skip: rs.filter((r) => r.sec === null).length / rs.length,
        mean: secs.reduce((a, b) => a + b, 0) / secs.length,
      };
    });
    for (const a of stats) {
      for (const b of stats) {
        expect(Math.abs(a.skip - b.skip)).toBeLessThan(0.12);
        expect(Math.abs(a.mean - b.mean)).toBeLessThan(0.04);
      }
    }
  });

  it('같은 시드는 같은 반응 (시드 난수만 쓴다)', () => {
    for (const seed of [3, 17, 42])
      expect(windupReaction('scout', seed)).toEqual(windupReaction('scout', seed));
  });
});

/** 조건이 참인 스냅샷을 틱마다 보내 능력 버튼을 누르기까지 (초). gapAt(k)가 null이면 그 틱에 괴물이 안 보인다 */
function abilityPress(
  role: RoleId,
  seed: number,
  gap: number,
  hidden: (k: number) => boolean,
): number | null {
  const { snap, info } = closeUp(role, gap);
  const brain = new PracticeSurvivorBrain(role, seed);
  const base = snap.monster;
  if (!base) throw new Error('괴물 없음');
  const t0 = snap.tick + 10;
  for (let k = 0; k <= 40; k += 1) {
    const out = brain.decide(
      at(snap, t0 + k, hidden(k) ? null : { ...base, windup: 0 }, 0),
      info,
      balance,
      1 + k,
    );
    if ((out.pressed & BTN.ABILITY) !== 0) return k / HZ;
  }
  return null;
}

describe('생존자 봇: 질주 · 밀치기도 사람 반응 시간 뒤에 누른다', () => {
  it('러너 질주(괴물 2.5타일) · 가드 밀치기(괴물 1.4타일)는 조건이 처음 참이 된 뒤 0.2~0.35초', () => {
    const cases: [RoleId, number][] = [
      ['runner', 2.5],
      ['guard', 1.4],
    ];
    for (const [role, gap] of cases) {
      const presses = Array.from({ length: 40 }, (_, i) => abilityPress(role, i + 1, gap, () => false));
      for (const p of presses) {
        expect(p).not.toBeNull();
        expect(p ?? 0).toBeGreaterThanOrEqual(0.2 - 1e-9);
        expect(p ?? 1).toBeLessThanOrEqual(0.35 + 1 / HZ + 1e-9);
      }
      // 한 값에 몰리지 않는다 (시드로 흩뜨린다)
      expect(new Set(presses).size).toBeGreaterThan(2);
    }
  });

  it('조건이 풀리면 취소하고 다시 참이 된 때부터 센다 (괴물이 0.1초 사라졌다 다시 보임)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const straight = abilityPress('runner', seed, 2.5, () => false);
      // 4~6틱 동안 괴물이 안 보이면 (질주 조건 거짓) 처음부터: 누르는 때가 다시 보인 틱(7)부터의 지연 뒤
      const broken = abilityPress('runner', seed, 2.5, (k) => k >= 4 && k <= 6);
      expect(straight).not.toBeNull();
      expect(broken).not.toBeNull();
      expect(broken ?? 0).toBeGreaterThanOrEqual(7 / HZ + 0.2 - 1e-9);
    }
  });
});

describe('생존자 봇: 스카우트 탐지 대기는 시작 카운트다운 동안 세지 않는다', () => {
  /** 스카우트가 계획 첫 거점 안에서 점령 중, 괴물은 안 보인다. startTick부터 틱마다 스냅샷 (countdownUntil 전은 카운트다운) */
  function firstTrack(startTick: number, countdownUntil: number): number {
    const sim = scene(1);
    const a = CAPTURE_POINTS[survivorPlan(7, 'scout')[0] ?? 'A'];
    place(sim.game, 'p4', a.x, a.y);
    place(sim.game, 'p1', 45, 28);
    refreshSnapshots(sim);
    const snap = sim.lastSnap.get('p4');
    const info = sim.infos.get('p4');
    if (!snap || !info) throw new Error('스냅샷 없음');
    const brain = new PracticeSurvivorBrain('scout', 7);
    for (let tick = startTick; tick < startTick + 40 * HZ; tick += 1) {
      const countdown = tick < countdownUntil ? (countdownUntil - tick) / HZ : 0;
      const s: Snapshot = {
        ...snap,
        tick,
        monster: null,
        marks: [],
        events: [],
        world: { ...snap.world, countdown },
        you: { ...snap.you, surv: snap.you.surv ? { ...snap.you.surv, abilityCd: 0 } : null },
      };
      const out = brain.decide(s, info, balance, tick + 1);
      if ((out.pressed & BTN.ABILITY) !== 0) return tick;
    }
    return -1;
  }

  it('카운트다운 3초가 있으면 첫 탐지가 판 시간으로 같은 때(카운트다운이 끝난 틱 + 대기)에 나온다', () => {
    const countdown = balance.match.startCountdown * HZ;
    const plain = firstTrack(0, 0);
    expect(plain).toBeGreaterThan(0);
    // 카운트다운 스냅샷부터 받은 두뇌 · 카운트다운이 끝난 뒤 첫 스냅샷부터 받은 두뇌(BotDriver는 카운트다운 중 부르지 않는다)
    expect(firstTrack(0, countdown) - plain).toBe(countdown);
    expect(firstTrack(countdown, countdown) - plain).toBe(countdown);
  });
});

describe('생존자 봇: 거점 · 탈출구 자리와 미끼 순서는 역할에 묶이지 않는다', () => {
  it('standSlot: 장소마다 세 역할이 서로 다른 자리, 시드에 따라 각 역할이 세 자리 모두에 선다', () => {
    const places: (PointId | 'N' | 'S')[] = [...POINT_IDS, 'N', 'S'];
    for (const place of places) {
      const seen = new Map<RoleId, Set<number>>(ROLES.map((r) => [r, new Set<number>()]));
      for (let seed = 1; seed <= 60; seed += 1) {
        const slots = ROLES.map((r) => standSlot(seed, place, r));
        expect(new Set(slots).size).toBe(3);
        ROLES.forEach((r, i) => seen.get(r)?.add(slots[i] ?? -1));
      }
      for (const r of ROLES) expect([...(seen.get(r) ?? [])].sort()).toEqual([0, 1, 2]);
    }
    // 한 판 안에서도 거점마다 배정이 다르다 (같은 역할이 늘 같은 쪽에 서지 않는다)
    let differs = 0;
    for (let seed = 1; seed <= 30; seed += 1)
      if (new Set(POINT_IDS.map((p) => standSlot(seed, p, 'runner'))).size > 1) differs += 1;
    expect(differs).toBeGreaterThan(15);
  });

  it('두뇌가 거점에서 가는 자리는 standSlot 배정을 따른다 (역할별 고정 자리가 아니다)', () => {
    const targets = new Map<RoleId, Set<string>>(ROLES.map((r) => [r, new Set<string>()]));
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const role of ROLES) {
        const sim = scene(seed);
        const g = sim.game;
        place(g, 'p1', 45, 28);
        const plan = practiceBrain(role, seed) as PracticeSurvivorBrain;
        refreshSnapshots(sim);
        const snap = sim.lastSnap.get(SEAT[role]);
        const info = sim.infos.get(SEAT[role]);
        if (!snap || !info) throw new Error('스냅샷 없음');
        plan.decide(snap, info, balance, 1);
        const d = plan.debugState();
        expect(d?.kind).toBe('capture');
        const goal = POINT_IDS.find((p) => far(CAPTURE_POINTS[p], d?.anchor ?? { x: 0, y: 0 }) < 1e-6);
        if (!goal || !d) throw new Error('거점 목표 아님');
        const c = CAPTURE_POINTS[goal];
        const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
        const off = { x: r2(d.target.x - c.x), y: r2(d.target.y - c.y) };
        const slot = standSlot(seed, goal, role);
        expect(off).toEqual(
          [
            { x: -0.8, y: 0 },
            { x: 0.8, y: 0 },
            { x: 0, y: 0.8 },
          ][slot],
        );
        targets.get(role)?.add(`${off.x},${off.y}`);
      }
    }
    for (const r of ROLES) expect(targets.get(r)?.size ?? 0).toBeGreaterThan(1);
  });

  it('달아나기 시작하는 거리는 역할과 무관하다 (괴물이 6.2타일에 보이면 셋 다 달아나고, 6.8타일이면 셋 다 하던 일을 한다)', () => {
    for (const gap of [6.2, 6.8]) {
      const fled = ROLES.map((role) => {
        const { snap, info } = closeUp(role, 1.0);
        const base = snap.monster;
        if (!base) throw new Error('괴물 없음');
        const monster = { ...base, x: snap.you.move.x + gap, windup: 0 };
        const brain = new PracticeSurvivorBrain(role, 5);
        // 괴물이 나를 보고 있지는 않다 (발각이면 거리와 무관하게 달아난다)
        const s = at(snap, snap.tick + 1, monster);
        const surv = s.you.surv ? { ...s.you.surv, spotted: false } : null;
        brain.decide({ ...s, you: { ...s.you, surv } }, info, balance, 1);
        return brain.debugState()?.fleeing ?? null;
      });
      expect(fled, `괴물 ${gap}타일`).toEqual(ROLES.map(() => gap < 6.5));
    }
  });

  it('함께 달아나는 둘이 갈라지는 쪽은 역할이 아니라 판 시드로 정한다 (자리 ID 순서가 아니다)', () => {
    // 러너 · 가드가 나란히 서 있고 괴물이 1.5타일 동쪽: 러너가 왼쪽(반시계)으로 비스듬히 가는지 오른쪽으로 가는지
    const side = (seed: number): number => {
      const sim = scene(seed);
      const g = sim.game;
      place(g, 'p2', 30.5, 24.5);
      place(g, 'p3', 30.5, 25.5);
      place(g, 'p4', 4.5, 28.5);
      place(g, 'p1', 32, 25, Math.PI);
      for (const s of g.survivors) s.abilityCd = 30;
      refreshSnapshots(sim);
      const snap = sim.lastSnap.get('p2');
      const info = sim.infos.get('p2');
      if (!snap?.monster || !info) throw new Error('스냅샷 없음');
      const out = new PracticeSurvivorBrain('runner', seed).decide(
        at(snap, snap.tick, { ...snap.monster, windup: 0 }),
        info,
        balance,
        1,
      );
      // 괴물 → 나 방향과 이동 방향의 외적 부호 (+면 왼쪽)
      const ax = snap.you.move.x - snap.monster.x;
      const ay = snap.you.move.y - snap.monster.y;
      return Math.sign(ax * out.my - ay * out.mx);
    };
    const bySeed = new Map<number, number>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const order = splitOrder(seed);
      expect([...order].sort()).toEqual([...ROLES].sort());
      const want = order.indexOf('runner') < order.indexOf('guard') ? 1 : -1;
      bySeed.set(seed, side(seed));
      expect(side(seed), `seed ${seed}`).toBe(want);
    }
    expect(new Set(bySeed.values()).size).toBe(2);
  });

  it('지켜지는 구조 지점에 들어갈지는 역할과 무관하다 (밀치기가 준비된 가드도 다른 역할처럼 기다린다)', () => {
    const kinds = ROLES.map((role) => {
      const { snap, info } = closeUp(role, 1.0);
      const base = snap.monster;
      if (!base) throw new Error('괴물 없음');
      // 동료 둘은 갇혔고(할 일이 구조뿐), 괴물은 구조 지점 남쪽 2타일에서 보였다가 안 보인다. 능력은 모두 준비됨
      const survivors = snap.survivors.map((v, i) => ({
        ...v,
        status: 'imprisoned' as const,
        x: 23.5 + i,
        y: 15.5,
      }));
      const view = (tick: number, monster: Snapshot['monster']): Snapshot => ({
        ...at(snap, tick, monster, 0),
        survivors,
      });
      const brain = new PracticeSurvivorBrain(role, 9);
      brain.decide(
        view(100, { ...base, x: RESCUE_POINT.x, y: RESCUE_POINT.y + 2, windup: 0 }),
        info,
        balance,
        1,
      );
      brain.decide(view(101, null), info, balance, 2);
      return brain.debugState()?.kind ?? null;
    });
    expect(kinds).toEqual(['wait', 'wait', 'wait']);
  });

  it('미끼 순서: 시드에 따라 세 역할 모두 첫 미끼가 된다', () => {
    const firsts = new Set<RoleId>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const order = decoyOrder(seed);
      expect([...order].sort()).toEqual([...ROLES].sort());
      firsts.add(order[0] ?? 'runner');
    }
    expect([...firsts].sort()).toEqual([...ROLES].sort());
  });
});

// ───────────────────────── 서 있기 한도 ─────────────────────────

/** 한자리에 서서 anchor를 보고, 닿는 생존자가 보이면 친다 (사람 괴물이 한곳에 서 있기만 한 경우의 대역) */
class StandMonster implements BotBrain {
  constructor(
    private readonly spot: Vec2,
    private readonly look: Vec2,
  ) {}

  decide(snap: Snapshot, _info: MatchInfo, b: Balance, seq: number): InputFrame {
    const me = snap.you.move;
    const out: InputFrame = { ...emptyInput(seq), aim: Math.atan2(this.look.y - me.y, this.look.x - me.x) };
    const d = far(me, this.spot);
    if (d > 0.3) {
      out.mx = (this.spot.x - me.x) / d;
      out.my = (this.spot.y - me.y) / d;
    }
    const reach = b.monster.attack.range + b.survivor.radius - 0.2;
    for (const s of snap.survivors) {
      if (s.status !== 'free' || far(me, s) > reach) continue;
      out.aim = Math.atan2(s.y - me.y, s.x - me.x);
      if ((snap.you.mon?.attackCd ?? 1) <= 0 && (snap.you.mon?.windup ?? 1) <= 0) out.pressed |= BTN.ATTACK;
    }
    return out;
  }
}

interface StandRun {
  /** 쫓기지 않고 할 일이 남았는데 목표 구역 밖에서 두뇌가 스스로(이동 입력 0) 연속으로 서 있던 가장 긴 시간 (초), 생존자별 */
  longest: Record<string, number>;
  /** 그런 연속 정지 중 가장 긴 것이 시작된 판 시각 · 자리 (실패 메시지용) */
  worst: string;
  pointsDone: PointId[];
  winner: string | null;
}

/** 쫓김: 괴물에게 보이는 중이거나 괴물이 이 거리(타일) 안 (scripts/bot-stats.ts 와 같은 정의, 두뇌 내부와 무관) */
const CHASE_DIST = 6;

/**
 * 생존자 봇 셋을 판에 넣고 seconds초(또는 판 끝)까지 돌리며 '쫓기지 않음 + 구역 밖 + 할 일 남음'인 연속 정지를 잰다.
 * 구역 = 안 끝난 거점 반경 · 누가 갇혔을 때 구조 구역 · 켜진 탈출구 원. 정지 = 두뇌의 이동 입력 0이고 한 틱 이동 0.02타일 미만.
 * 두뇌 내부를 읽지 않고 두뇌가 낸 입력만 본다 (옛 두뇌에도 같은 잣대)
 */
function standRun(seed: number, monster: BotBrain | null, seconds: number, monsterAt?: Vec2): StandRun {
  const brains: Record<string, BotBrain> = {};
  const inputs = new Map<string, InputFrame>();
  for (const role of ROLES) {
    const id = SEAT[role];
    const inner = practiceBrain(role, seed);
    brains[id] = {
      decide: (snap, info, b, seq) => {
        const out = inner.decide(snap, info, b, seq);
        inputs.set(id, out);
        return out;
      },
    };
  }
  brains.p1 = monster ?? practiceBrain('monster', seed);
  const sim = monster
    ? scene(seed, brains)
    : new SimMatch(SimMatch.roles(), balance, new Map(Object.entries(brains)), seed);
  const g: Game = sim.game;
  if (monsterAt) place(g, 'p1', monsterAt.x, monsterAt.y);
  const run = new Map<string, number>();
  const longest: Record<string, number> = {};
  let worst = '';
  let worstLen = 0;
  const prev = new Map(
    g.survivors.map((s) => [s.id, { x: s.move.x, y: s.move.y, free: s.status === 'free' }]),
  );
  const limit = Math.round(seconds * HZ);
  for (let t = 0; t < limit && !g.end; t += 1) {
    inputs.clear();
    sim.step();
    const m = g.monster;
    const jailed = g.survivors.some((s) => s.status === 'imprisoned');
    for (const s of g.survivors) {
      const p = prev.get(s.id);
      const input = inputs.get(s.id);
      const moved = p ? Math.hypot(s.move.x - p.x, s.move.y - p.y) : 1;
      const chased =
        far(s.move, m.move) <= CHASE_DIST || monsterSees(balance, m.move, m.move.face, m.blend, s.move);
      const inZone =
        g.points.some(
          (q) => !q.done && !q.off && far(s.move, CAPTURE_POINTS[q.id]) <= balance.capturePoint.radius,
        ) ||
        (jailed && far(s.move, RESCUE_POINT) <= balance.prison.rescueRadius) ||
        g.exits.some((e) => e.state !== 'inactive' && far(s.move, EXITS[e.id].center) <= balance.exit.radius);
      const still = input !== undefined && input.mx === 0 && input.my === 0 && moved < 0.02;
      if (s.status === 'free' && p?.free === true && !chased && !inZone && still) {
        const n = (run.get(s.id) ?? 0) + 1;
        run.set(s.id, n);
        longest[s.id] = Math.max(longest[s.id] ?? 0, n / HZ);
        if (n > worstLen) {
          worstLen = n;
          worst = `${s.id} ${(g.time - n / HZ).toFixed(1)}초부터 (${s.move.x.toFixed(1)}, ${s.move.y.toFixed(1)})`;
        }
      } else run.set(s.id, 0);
      prev.set(s.id, { x: s.move.x, y: s.move.y, free: s.status === 'free' });
    }
  }
  return {
    longest,
    worst,
    pointsDone: g.points.filter((q) => q.done).map((q) => q.id),
    winner: g.end?.winner ?? null,
  };
}

const STAND_LIMIT = 1.5;

describe('생존자 봇: 할 일이 남았으면 쫓기지 않을 때 구역 밖에서 서 있지 않는다 (1.5초 넘게)', () => {
  it('실전 괴물 봇 상대 (시드 6개, 판 끝까지)', () => {
    for (const seed of [1, 2, 4, 7, 9, 10]) {
      const r = standRun(seed, null, balance.match.timeLimit);
      const max = Math.max(0, ...Object.values(r.longest));
      expect(max, `seed ${seed}: ${r.worst}`).toBeLessThanOrEqual(STAND_LIMIT);
    }
  });

  it('괴물이 거점 A 반경 바로 밖에 서서 A를 본다 (사람이 한곳에 서 있기만 한 경우): 서 있지 않고, 다른 거점 둘을 점령해 판이 진행된다', () => {
    const a = CAPTURE_POINTS.A;
    const spot = { x: a.x + balance.capturePoint.radius + 0.7, y: a.y };
    for (const seed of [1, 2, 3, 4]) {
      const r = standRun(seed, new StandMonster(spot, a), 240, spot);
      const max = Math.max(0, ...Object.values(r.longest));
      expect(max, `seed ${seed}: ${r.worst}`).toBeLessThanOrEqual(STAND_LIMIT);
      // 지켜지는 A는 버리고 B · C를 끝내 탈출구를 켠다 (시간 초과로 끝나지 않는다)
      expect(r.pointsDone.sort(), `seed ${seed}`).toEqual(['B', 'C']);
      expect(r.winner, `seed ${seed}`).toBe('survivors');
    }
  });

  it('괴물이 감옥 남쪽 감시 자리에 서서 구조 지점을 본다: 서 있지 않고 판이 진행된다', () => {
    const spot = WATCH_SPOTS[0] ?? { x: 24, y: 23.5 };
    for (const seed of [1, 2, 3, 4]) {
      const r = standRun(seed, new StandMonster(spot, RESCUE_POINT), 240, spot);
      const max = Math.max(0, ...Object.values(r.longest));
      expect(max, `seed ${seed}: ${r.worst}`).toBeLessThanOrEqual(STAND_LIMIT);
      expect(r.pointsDone.length, `seed ${seed}`).toBe(balance.capturePoint.required);
      expect(r.winner, `seed ${seed}`).toBe('survivors');
    }
  });
});

describe('생존자 봇: 남은 할 일이 모두 지켜지면 서성이며 기다리다 들어가 본다', () => {
  it('동료 둘이 갇히고 괴물이 구조 지점 남쪽 3.5타일에 서서 구조 지점을 본다 (할 일이 구조뿐): 서 있지 않고 기다리는 자리 여러 곳을 오가며, 기다림 한도 뒤 들어가 본다', () => {
    const spot = { x: RESCUE_POINT.x, y: RESCUE_POINT.y + 3.5 };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const runner = practiceBrain('runner', seed);
      const inputs: InputFrame[] = [];
      const sim = scene(seed, {
        p1: new StandMonster(spot, RESCUE_POINT),
        p2: {
          decide: (snap, info, b, seq) => {
            const out = runner.decide(snap, info, b, seq);
            inputs.push(out);
            return out;
          },
        },
      });
      const g = sim.game;
      place(g, 'p1', spot.x, spot.y);
      place(g, 'p2', 9.5, 25.5);
      const slots = [
        { x: 23.5, y: 15.5 },
        { x: 24.5, y: 15.5 },
      ];
      for (const [i, id] of ['p3', 'p4'].entries()) {
        const s = g.survivorById(id);
        const slot = slots[i];
        if (!s || !slot) throw new Error('자리 없음');
        s.status = 'imprisoned';
        s.move.x = slot.x;
        s.move.y = slot.y;
      }
      const me = g.survivorById('p2');
      if (!me) throw new Error('자리 없음');
      let still = 0;
      let longest = 0;
      let path = 0;
      const kinds = new Set<string>();
      const cells = new Set<string>();
      for (let t = 0; t < 40 * HZ && !g.end && me.status === 'free'; t += 1) {
        const px = me.move.x;
        const py = me.move.y;
        sim.step();
        const moved = Math.hypot(me.move.x - px, me.move.y - py);
        path += moved;
        const out = inputs[inputs.length - 1];
        const chased =
          far(me.move, g.monster.move) <= CHASE_DIST ||
          monsterSees(balance, g.monster.move, g.monster.move.face, g.monster.blend, me.move);
        const inZone = far(me.move, RESCUE_POINT) <= balance.prison.rescueRadius;
        still = out && out.mx === 0 && out.my === 0 && moved < 0.02 && !chased && !inZone ? still + 1 : 0;
        longest = Math.max(longest, still / HZ);
        const d = (runner as PracticeSurvivorBrain).debugState?.();
        if (d) kinds.add(d.probe ? 'probe' : d.kind);
        if (d?.kind === 'wait') cells.add(`${Math.round(d.target.x)},${Math.round(d.target.y)}`);
      }
      expect(longest, `seed ${seed}`).toBeLessThanOrEqual(STAND_LIMIT);
      // 서성인다: 기다리는 자리를 여러 곳 오가고, 기다림 한도가 지나면 (혼자라 미끼 차례) 들어가 본다
      expect(kinds.has('wait'), `seed ${seed}`).toBe(true);
      expect(cells.size, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(kinds.has('probe'), `seed ${seed}`).toBe(true);
      expect(path, `seed ${seed}`).toBeGreaterThan(20);
    }
  });
});

describe('생존자 봇: 가는 길에 괴물이 있으면 돌아간다 (서지 않는다)', () => {
  it('거쳐 갈 곳 가까이(0.6타일) 오면 닿은 것으로 알고 서 버리지 않는다 — 구조 담당이라 한 틱에 구조 지점 · 거점 길을 차례로 볼 때도', () => {
    // 검토 재현(mid 흉내 seed 238 스카우트): 구조 지점 길이 막혀 거점으로 넘어가는 틱마다 거쳐 갈 곳을 하나만 기억해 서로 덮어써,
    // 닿은 거쳐 갈 곳을 다시 골라 1.6초 서 있었다
    const { snap, info } = closeUp('scout', 1.0);
    const base = snap.monster;
    if (!base) throw new Error('괴물 없음');
    // 러너는 갇혀 있고 가드는 멀리 자유 (스카우트가 구조 담당, 거점이 남아 있어 구조 길이 막히면 점령으로 넘어간다)
    const survivors = snap.survivors.map((v) =>
      v.role === 'runner' ? { ...v, status: 'imprisoned' as const, x: 23.5, y: 15.5 } : v,
    );
    const view = (tick: number, monster: Snapshot['monster'], p: Vec2): Snapshot => ({
      ...at(snap, tick, monster),
      survivors,
      you: { ...snap.you, move: { ...snap.you.move, x: p.x, y: p.y } },
    });
    const offsets = [
      { x: 0.6, y: 0 },
      { x: -0.6, y: 0 },
      { x: 0, y: 0.6 },
      { x: 0, y: -0.6 },
    ];
    let checked = 0;
    for (const me0 of FLEE_SPOTS) {
      for (const t1 of FLEE_SPOTS) {
        const d1 = far(me0, t1);
        if (d1 < 3 || d1 > 9) continue;
        // ① 괴물을 보고(다음 스냅샷에는 안 보임) 거쳐 갈 곳 V를 고른다
        const start = (): PracticeSurvivorBrain => {
          const br = new PracticeSurvivorBrain('scout', 3);
          br.decide(view(100, { ...base, x: t1.x, y: t1.y, windup: 0 }, me0), info, balance, 1);
          br.decide(view(101, null, me0), info, balance, 2);
          return br;
        };
        const first = start().debugState();
        if (!first?.via) continue;
        const v = first.target;
        // ② V 0.6타일 앞까지 왔다 (괴물 기억은 그대로)
        for (const o of offsets) {
          const me1 = { x: v.x + o.x, y: v.y + o.y };
          if (blocksMove(Math.floor(me1.x), Math.floor(me1.y), OPEN_CTX)) continue;
          const br = start();
          br.decide(view(130, null, me1), info, balance, 3);
          br.decide(view(131, null, me1), info, balance, 4);
          const st = br.debugState();
          checked += 1;
          if (st?.via)
            expect(far(st.target, me1), `나 (${me1.x}, ${me1.y}) 괴물 (${t1.x}, ${t1.y})`).toBeGreaterThan(
              1.5,
            );
        }
      }
    }
    // 검사가 헛돌지 않게
    expect(checked).toBeGreaterThan(50);
  });
});

// ───────────────────────── 처음 괴물을 해 보는 사람 흉내 ─────────────────────────

describe('생존자 봇: 처음 괴물을 해 보는 사람(novice 흉내)도 한 판에 두세 번은 가둔다', () => {
  it('novice 대 생존자 봇 셋 20판: 판당 수감 평균 2~4.5번, 0번인 판은 20판 중 3판 이하, 명중률은 절반 넘게', () => {
    let jails = 0;
    let zero = 0;
    let strikes = 0;
    let hits = 0;
    const n = 20;
    for (let seed = 1; seed <= n; seed += 1) {
      const setup = SimMatch.roles();
      const brains = new Map<string, BotBrain>(
        setup.map((p) => [
          p.id,
          p.role === 'monster' ? humanMonster(NOVICE, seed) : practiceBrain(p.role, seed),
        ]),
      );
      const sim = new SimMatch(setup, balance, brains, seed);
      const g = sim.game;
      const status = new Map(g.survivors.map((s) => [s.id, s.status]));
      let cd = g.monster.attackCd;
      let landed = g.monster.stats.hitsLanded;
      let mine = 0;
      const limit = Math.ceil(balance.match.timeLimit / g.dt) + 2;
      for (let t = 0; t < limit && !g.end; t += 1) {
        sim.step();
        for (const s of g.survivors) {
          if (status.get(s.id) === 'free' && s.status === 'imprisoned') mine += 1;
          status.set(s.id, s.status);
        }
        // 휘두름 = 공격 쿨이 새로 걸린 틱, 명중 = 그 틱에 맞힌 수가 늘었다
        if (g.monster.attackCd > cd + 1e-9) {
          strikes += 1;
          if (g.monster.stats.hitsLanded > landed) hits += 1;
        }
        cd = g.monster.attackCd;
        landed = g.monster.stats.hitsLanded;
      }
      jails += mine;
      if (mine === 0) zero += 1;
    }
    const avg = jails / n;
    expect(avg).toBeGreaterThanOrEqual(2);
    expect(avg).toBeLessThanOrEqual(4.5);
    expect(zero).toBeLessThanOrEqual(3);
    // 준비 동작에 1~2틱 만에 비키던 옛 봇은 novice 명중률 41% (b 최종 100판) — 사람 반응이면 절반을 넘는다
    expect(hits / Math.max(1, strikes)).toBeGreaterThan(0.6);
  });
});
