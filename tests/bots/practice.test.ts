// 실전 봇 두뇌 (M13b 2번): 봇 4명 판을 시드 6개로 끝까지.
// 시간 초과가 아닌 종료 · 양쪽 승리 · 실제 공격 · 수감 · 점령 · 구조 · 탈출, 괴물 봇이 받은 스냅샷에 시야 밖 생존자 0,
// 틱 비용, 같은 시드는 같은 판, 기기 안 연습 방(BotDriver)에서 틱당 입력 1개
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  CAPTURE_POINTS,
  POINT_IDS,
  PRISON_RECT,
  PRISON_SLOTS,
  RESCUE_POINT,
  blocksMove,
  distToRect,
  lineOfSight,
  monsterSees,
  type ClientMessage,
  type PointId,
  type PointState,
  type Role,
  type RoleId,
  type Snapshot,
  type Vec2,
} from '@decoy/shared';
import {
  BotDriver,
  FLEE_SPOTS,
  MONSTER_CROSS,
  MONSTER_EXIT_LOOP,
  MONSTER_LOOP,
  ServerCore,
  SimMatch,
  WATCH_SPOTS,
  buildResult,
  computeVisibility,
  findPath,
  idleBrain,
  nextGuarded,
  pickPoint,
  pointOpen,
  practiceBrain,
  preparePracticeMap,
  survivorPlan,
  teamPlan,
  type BotBrain,
  type Game,
} from '@decoy/shared/sim';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
/**
 * 시드 6개: 생존자 승리 셋(1 · 7 · 9)과 괴물 승리 셋(2 · 4 · 10). 플레이테스트 반영 b(거점 세 곳 중 두 곳 · 목표 거점 이력)
 * 규칙 · 두뇌로 1~60을 조사하면 생존자가 40판 안팎 · 시간 초과 0이다(괴물 화면 임시 ID가 암호 난수라 시드 한둘은 실행마다 뒤집힌다).
 * 판은 혼돈스러워 규칙 · 길찾기 · 두뇌가 조금만 바뀌어도 시드별 결과가 뒤집힐 수 있어, 한쪽에 하나만 걸지 않게 셋씩 고른다
 * (바뀌면 다시 조사해 셋씩 맞추고 이 주석도 고친다)
 */
const SEEDS = [1, 2, 4, 7, 9, 10];
/** 평균 틱 비용 상한 (ms): 봇 4명 판 SimMatch.step(판 진행 + 스냅샷 + 두뇌) */
const TICK_BUDGET_MS = 0.3;

interface MatchRun {
  seed: number;
  winner: string;
  reason: string;
  durationSec: number;
  escaped: number;
  hits: number;
  imprisonments: number;
  rescues: number;
  deaths: number;
  captures: number;
  ticks: number;
  stepMs: number;
  /** 괴물이 받은 스냅샷 수와 그중 생존자가 보인 스냅샷 수 */
  monsterSnaps: number;
  snapsWithSurvivors: number;
  /** 괴물 스냅샷에 있었지만 그 틱에 괴물 시야 밖이던 생존자 수 (0이어야 한다) */
  leaks: number;
  /** 같은 시드 재실행 비교용 */
  fingerprint: string;
}

/** 스냅샷의 생존자(소수 셋째 자리 반올림)와 같은 자리의 실제 생존자 */
function realSurvivorAt(game: Game, x: number, y: number): Game['survivors'][number] | undefined {
  return game.survivors.find(
    (s) =>
      (s.status === 'free' || s.status === 'imprisoned') &&
      Math.abs(s.move.x - x) <= 6e-4 &&
      Math.abs(s.move.y - y) <= 6e-4,
  );
}

/** 실전 두뇌 넷으로 한 판을 끝까지 (또는 12분 제한까지) */
function playMatch(seed: number): MatchRun {
  const setup = SimMatch.roles();
  const brains = new Map<string, BotBrain>(setup.map((p) => [p.id, practiceBrain(p.role, seed)]));
  const sim = new SimMatch(setup, balance, brains, seed);
  const g = sim.game;
  const monsterId = setup.find((p) => p.role === 'monster')?.id ?? 'p1';
  const limitTicks = Math.ceil(balance.match.timeLimit / g.dt) + 2;
  const run = {
    imprisonments: 0,
    rescues: 0,
    deaths: 0,
    captures: 0,
    monsterSnaps: 0,
    snapsWithSurvivors: 0,
    leaks: 0,
  };
  let prev: Snapshot | undefined = sim.lastSnap.get(monsterId);
  let stepMs = 0;
  let ticks = 0;
  while (!g.end && ticks < limitTicks) {
    const t0 = performance.now();
    sim.step();
    stepMs += performance.now() - t0;
    ticks += 1;
    const snap = sim.lastSnap.get(monsterId);
    if (!snap || snap === prev) continue;
    prev = snap;
    // 괴물이 이번 틱에 받은 스냅샷: 그 안의 생존자는 모두 지금 괴물 시야 안의 실제 생존자여야 한다
    run.monsterSnaps += 1;
    if (snap.survivors.length > 0) run.snapsWithSurvivors += 1;
    const facts = computeVisibility(g);
    run.leaks += Math.max(0, snap.survivors.length - facts.monsterSees.size);
    const m = g.monster.move;
    for (const v of snap.survivors) {
      const real = realSurvivorAt(g, v.x, v.y);
      if (
        !real ||
        !facts.monsterSees.has(real.id) ||
        !monsterSees(balance, m, m.face, g.monster.blend, real.move)
      ) {
        run.leaks += 1;
      }
    }
    // 괴물이 받는 이벤트로 판의 일을 센다 (수감 · 구조 · 사망 · 점령 완료)
    for (const ev of snap.events) {
      if (ev.k === 'imprisoned') run.imprisonments += 1;
      else if (ev.k === 'rescued') run.rescues += 1;
      else if (ev.k === 'died') run.deaths += 1;
      else if (ev.k === 'text' && ev.id === 'ALERT_CAPTURE_DONE') run.captures += 1;
    }
  }
  const r = buildResult(g);
  const hits = r.players.find((p) => p.role === 'monster')?.hitsLanded ?? 0;
  const fingerprint = JSON.stringify({
    tick: g.tick,
    end: g.end,
    result: r,
    pos: [...g.players.values()].map((p) => [Math.round(p.move.x * 1000), Math.round(p.move.y * 1000)]),
  });
  return {
    seed,
    winner: g.end?.winner ?? 'none',
    reason: g.end?.reason ?? 'none',
    durationSec: r.durationSec,
    escaped: r.escaped,
    hits,
    ...run,
    ticks,
    stepMs,
    fingerprint,
  };
}

function summary(r: MatchRun): string {
  return (
    `seed ${r.seed}: ${r.winner} (${r.reason}) ${r.durationSec}s, 탈출 ${r.escaped}, 적중 ${r.hits}, ` +
    `수감 ${r.imprisonments}, 사망 ${r.deaths}, 구조 ${r.rescues}, 점령 ${r.captures}, ` +
    `${(r.stepMs / r.ticks).toFixed(3)}ms/틱`
  );
}

describe('실전 봇 두뇌: 봇 4명 판 (시드 6개)', () => {
  let runs: MatchRun[] = [];
  let avgTickMs = Infinity;

  beforeAll(() => {
    // 지도 준비(도주 후보 길 거리 필드)는 두뇌를 만들 때 한 번: 틱 비용과 따로 잰다
    const prepStart = performance.now();
    preparePracticeMap();
    const prepMs = performance.now() - prepStart;
    runs = SEEDS.map(playMatch);
    const totalMs = runs.reduce((a, r) => a + r.stepMs, 0);
    const totalTicks = runs.reduce((a, r) => a + r.ticks, 0);
    avgTickMs = totalMs / totalTicks;
    for (const r of runs) console.log(summary(r));
    console.log(
      `평균 틱 ${avgTickMs.toFixed(4)}ms (${totalTicks}틱), 지도 준비 ${prepMs.toFixed(1)}ms, ` +
        `판 길이 ${runs.map((r) => r.durationSec).join('/')}초`,
    );
  });

  it('대부분(6판 중 4판 이상)이 12분 시간 초과가 아니라 승패로 끝난다', () => {
    const decided = runs.filter((r) => r.winner !== 'none' && r.reason !== 'timeout');
    expect(decided.length).toBeGreaterThanOrEqual(4);
  });

  it('생존자 승리와 괴물 승리가 모두 나온다', () => {
    expect(runs.some((r) => r.winner === 'survivors')).toBe(true);
    expect(runs.some((r) => r.winner === 'monster')).toBe(true);
  });

  it('괴물이 실제로 맞히고 가두며, 생존자가 점령 · 구조 · 탈출한다', () => {
    const sum = (k: 'hits' | 'imprisonments' | 'rescues' | 'captures' | 'escaped'): number =>
      runs.reduce((a, r) => a + r[k], 0);
    expect(sum('hits')).toBeGreaterThan(0);
    expect(sum('imprisonments')).toBeGreaterThan(0);
    expect(sum('captures')).toBeGreaterThan(0);
    expect(sum('rescues')).toBeGreaterThanOrEqual(1);
    expect(sum('escaped')).toBeGreaterThanOrEqual(1);
    // 생존자가 이긴 판은 두 거점을 모두 점령하고 두 명 이상 탈출했다
    for (const r of runs.filter((x) => x.winner === 'survivors')) {
      expect(r.captures).toBe(2);
      expect(r.escaped).toBeGreaterThanOrEqual(2);
    }
  });

  it('판이 몇 초 만에 끝나지 않는다 (가운데 판 길이 1분 30초 이상, 가장 짧은 판도 45초 넘게)', () => {
    const d = runs.map((r) => r.durationSec).sort((a, b) => a - b);
    const median = ((d[2] ?? 0) + (d[3] ?? 0)) / 2;
    expect(median).toBeGreaterThanOrEqual(90);
    expect(d[0]).toBeGreaterThan(45);
  });

  it('정보 차단: 괴물 봇이 받은 모든 스냅샷의 생존자는 그 틱에 괴물 시야 안이다 (시야 밖 0)', () => {
    for (const r of runs) {
      expect(r.leaks).toBe(0);
      expect(r.monsterSnaps).toBeGreaterThan(100);
    }
    // 검사가 헛돌지 않게: 생존자가 실제로 보인 스냅샷이 있었다
    expect(runs.reduce((a, r) => a + r.snapsWithSurvivors, 0)).toBeGreaterThan(0);
  });

  it(`평균 틱 비용이 ${TICK_BUDGET_MS}ms 미만`, () => {
    expect(avgTickMs).toBeLessThan(TICK_BUDGET_MS);
  });

  it('같은 시드는 같은 판 (임시 ID · 배열 순서가 달라도 결정이 같다)', () => {
    const first = runs[3];
    if (!first) throw new Error('판 없음');
    const again = playMatch(first.seed);
    expect(again.fingerprint).toBe(first.fingerprint);
  });
});

describe('실전 봇 두뇌: 규칙', () => {
  it('두뇌는 시드 난수만 쓰고 판 상태 모듈을 들이지 않는다 (자기 스냅샷 · MatchInfo · Balance · 공개 지도만)', () => {
    const src = readFileSync('shared/src/sim/practiceBrains.ts', 'utf8');
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    // 공용 모듈(지도 · 규칙 수치 · 기하)과 두뇌 도구만. 판 상태(game · state · interest · room · core · truth · systems)는 금지
    const allowed = ['../index', './botBrains', './pathfind', './predict'];
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '');
    expect(imports.length).toBeGreaterThan(0);
    for (const from of imports) expect(allowed).toContain(from);
  });

  it('순찰 · 감시 · 도주 지점은 모두 바닥이고 서로 닿으며, 감시 자리는 감옥 캠핑 반경 밖이다', () => {
    const ctx = { kind: 'monster' as const, imprisoned: false, openExits: { N: false, S: false } };
    const spots = [...MONSTER_LOOP, ...MONSTER_CROSS, ...MONSTER_EXIT_LOOP, ...WATCH_SPOTS, ...FLEE_SPOTS];
    const from = MONSTER_LOOP[0] ?? { x: 0, y: 0 };
    for (const p of spots) {
      expect(blocksMove(Math.floor(p.x), Math.floor(p.y), ctx)).toBe(false);
      expect(findPath(from, p, ctx).length).toBeGreaterThan(0);
    }
    for (const w of WATCH_SPOTS) {
      // 도착 판정 여유(0.3)만큼 감옥 쪽으로 서도 반경 밖
      expect(distToRect(w, PRISON_RECT)).toBeGreaterThan(balance.prison.campRadius + 0.3);
      expect(lineOfSight(w, RESCUE_POINT)).toBe(true);
    }
  });

  it('같은 역할 · 시드는 같은 입력, 시드가 다르면 다르게 움직인다', () => {
    const setup = SimMatch.roles();
    const snap = new SimMatch(setup, balance, new Map(), 5).lastSnap.get('p2');
    if (!snap) throw new Error('스냅샷 없음');
    const info = { you: 'p2', role: 'runner' as Role, roster: [], tickHz: 30, firstMatch: false };
    expect(practiceBrain('runner', 5).decide(snap, info, balance, 1)).toEqual(
      practiceBrain('runner', 5).decide(snap, info, balance, 1),
    );
    // 같은 판(게임 시드)에 두뇌 시드만 바꾸면 20초 뒤 자리가 달라진다
    const positions = (brainSeed: number): string => {
      const brains = new Map<string, BotBrain>(setup.map((p) => [p.id, practiceBrain(p.role, brainSeed)]));
      const sim = new SimMatch(setup, balance, brains, 1);
      sim.runUntil(() => false, 20);
      return JSON.stringify(
        [...sim.game.players.values()].map((p) => [p.move.x.toFixed(2), p.move.y.toFixed(2)]),
      );
    };
    expect(positions(1)).not.toBe(positions(2));
  });
});

describe('실전 봇 두뇌: 기기 안 연습 방 (BotDriver)', () => {
  const raw = (msg: ClientMessage): string => JSON.stringify(msg);

  it('사람 1명 + 실전 봇 3명: 봇 자리마다 틱당 입력 1개 · 굶주림 0, 봇이 움직인다', () => {
    const clock = { t: 0 };
    const driver = new BotDriver((info) => practiceBrain(info.role, 7), balance);
    const core = new ServerCore(
      { balance, seed: 7, testHooks: true, practice: true },
      driver.hooks(),
      () => clock.t,
    );
    const conn = new FakeConn();
    const link = core.connect(conn, (err) => {
      throw err;
    });
    link.receive(
      raw({
        t: 'join',
        proto: PROTOCOL_VERSION,
        room: null,
        create: true,
        name: '나',
        token: null,
        altTokens: [],
        bots: true,
      }),
    );
    link.receive(raw({ t: 'role', role: 'scout' }));
    link.receive(raw({ t: 'ready', ready: true }));
    link.receive(raw({ t: 'start' }));
    const room = [...core.manager.rooms.values()][0];
    const game = room?.game;
    if (!room || !game) throw new Error('판 없음');
    const bots = driver.botsOf(room);
    expect(bots.map((b) => b.seat.role).sort()).toEqual(['guard', 'monster', 'runner']);
    const start = new Map(bots.map((b) => [b.seat.id, { ...game.players.get(b.seat.id)?.move }]));
    // 20초 동안 시작 자리에서 가장 멀리 간 거리 (끝 순간 자리는 수감되면 감옥 옆이라 보지 않는다)
    const farthest = new Map<string, number>();
    const ticks = 20 * balance.network.serverTickHz;
    for (let t = 1; t <= ticks && !game.end; t += 1) {
      clock.t += core.tickMs;
      core.advance(clock.t);
      for (const b of bots) {
        expect(b.inputs).toBe(t);
        expect(game.players.get(b.seat.id)?.starved).toBe(0);
        const p = game.players.get(b.seat.id);
        const s = start.get(b.seat.id);
        if (!p || !s || s.x === undefined || s.y === undefined) throw new Error('자리 없음');
        const d = Math.hypot(p.move.x - s.x, p.move.y - s.y);
        farthest.set(b.seat.id, Math.max(farthest.get(b.seat.id) ?? 0, d));
      }
    }
    for (const b of bots) expect(farthest.get(b.seat.id) ?? 0).toBeGreaterThan(3);
    // 괴물 봇이 받은 MatchInfo 명단에는 자기 자신만 있다
    const monsterBot = bots.find((b) => b.seat.role === 'monster');
    expect(monsterBot?.info?.roster.map((r) => r.role)).toEqual(['monster']);
  });
});

const SURVIVOR_ROLES: readonly RoleId[] = ['runner', 'guard', 'scout'];
/** SimMatch.roles()의 자리: 괴물 p1, 러너 p2, 가드 p3, 스카우트 p4 */
const SEAT: Readonly<Record<RoleId, string>> = { runner: 'p2', guard: 'p3', scout: 'p4' };

/** 손으로 맞추는 장면: 준 두뇌 말고는 모두 가만히 있고, 괴물 시작 정지는 없다 (두뇌는 나중에 sim.brains에 넣어도 된다) */
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

/** 손으로 바꾼 판 상태가 스냅샷에 담길 때까지 (스냅샷은 20Hz라 틱마다 오지 않는다). 두뇌 없는 장면에서 부른다 */
function refreshSnapshots(sim: SimMatch): void {
  const before = sim.lastSnap.get('p1');
  for (let i = 0; i < 4 && sim.lastSnap.get('p1') === before; i += 1) sim.step();
}

/** 두 곳(A · B)이 끝나 셋째(C)가 꺼지고 탈출구가 켜진 판 (C 진행은 cProgress, 0~1) */
function twoDone(g: Game, cProgress: number): void {
  for (const p of g.points) {
    if (p.id === 'C') {
      p.off = true;
      p.progress = balance.capturePoint.captureTime * cProgress;
    } else {
      p.done = true;
      p.progress = balance.capturePoint.captureTime;
    }
  }
  g.capturedCount = 2;
  for (const e of g.exits) e.state = 'active';
}

/** 가드 · 스카우트를 감옥에 가둔다 */
function jailGuardAndScout(g: Game): void {
  for (const [i, id] of ['p3', 'p4'].entries()) {
    const s = g.survivorById(id);
    const slot = PRISON_SLOTS[i];
    if (!s || !slot) throw new Error('자리 없음');
    s.status = 'imprisoned';
    s.move.x = slot.x;
    s.move.y = slot.y;
  }
}

function far(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('실전 봇: 거점 세 곳 중 두 곳 (플레이테스트 반영 b)', () => {
  it('팀 계획: 거점 순서는 시드로 섞이고, 어느 역할이든 세 거점 모두가 첫 거점이 될 수 있으며 혼자 가는 역할도 셋 다 나온다 (역할을 거점에 묶지 않는다 — 괴물 화면 단서). 두뇌가 쓰는 survivorPlan으로 센다', () => {
    const firstOf = new Map<string, Set<string>>();
    const solos = new Set<string>();
    for (let seed = 1; seed <= 300; seed += 1) {
      const plan = teamPlan(seed);
      expect([...plan.order].sort()).toEqual([...POINT_IDS].sort());
      const firsts = SURVIVOR_ROLES.map((role) => {
        const order = survivorPlan(seed, role);
        expect([...order].sort()).toEqual([...POINT_IDS].sort());
        return order[0] ?? '';
      });
      SURVIVOR_ROLES.forEach((role, i) => {
        const first = firsts[i] ?? '';
        const set = firstOf.get(role) ?? new Set<string>();
        set.add(first);
        firstOf.set(role, set);
      });
      // 혼자 가는 역할 = 첫 거점이 다른 둘과 다른 역할 (셋이 함께면 없다). 팀 계획의 solo와 같아야 한다
      const solo = SURVIVOR_ROLES.filter((_, i) => firsts.filter((f) => f === firsts[i]).length === 1);
      expect(solo).toEqual(plan.solo ? [plan.solo] : []);
      for (const r of solo) solos.add(r);
    }
    expect([...solos].sort()).toEqual(['guard', 'runner', 'scout']);
    for (const role of SURVIVOR_ROLES) expect([...(firstOf.get(role) ?? [])].sort()).toEqual(['A', 'B', 'C']);
  });

  it('두뇌가 판 시작에 처음 들어가는 거점은 survivorPlan의 첫 거점이다 (역할마다 세 거점이 모두 첫 거점인 시드들로)', () => {
    preparePracticeMap();
    const seeds = [1, 2, 3, 4, 5, 6];
    // 헛돌지 않게: 이 시드들에서 역할마다 첫 거점이 세 곳 모두 나온다 (역할에 거점을 묶는 두뇌면 어딘가 어긋난다)
    for (const role of SURVIVOR_ROLES)
      expect(new Set(seeds.map((s) => survivorPlan(s, role)[0])).size).toBe(3);
    for (const seed of seeds) {
      for (const role of SURVIVOR_ROLES) {
        const id = SEAT[role];
        const sim = scene(seed, { [id]: practiceBrain(role, seed) });
        const me = sim.game.survivorById(id);
        if (!me) throw new Error('자리 없음');
        const inPoint = (): PointId | undefined =>
          POINT_IDS.find((p) => far(me.move, CAPTURE_POINTS[p]) <= balance.capturePoint.radius);
        expect(sim.runUntil(() => inPoint() !== undefined, 15)).toBe(true);
        expect(`${seed} ${role} ${inPoint() ?? ''}`).toBe(
          `${seed} ${role} ${survivorPlan(seed, role)[0] ?? ''}`,
        );
      }
    }
  });

  it('거점 열림(pointOpen): 끝났거나 꺼진 거점은 할 일이 아니다', () => {
    const open: Record<PointState, boolean> = {
      idle: true,
      capturing: true,
      blocked: true,
      done: false,
      off: false,
    };
    for (const [state, want] of Object.entries(open)) expect(pointOpen(state as PointState)).toBe(want);
  });

  it('점령 목표 고르기(pickPoint): 계획 첫 곳 → 지켜지면 계획 순서 앞쪽의 안전한 곳(둘째도 위험하면 셋째) → 모두 위험하면 가장 가까운 곳', () => {
    const hot = (s: string): Record<PointId, boolean> => ({
      A: s.includes('A'),
      B: s.includes('B'),
      C: s.includes('C'),
    });
    const near: Record<PointId, number> = { A: 10, B: 5, C: 20 };
    const plan: PointId[] = ['C', 'B', 'A'];
    expect(pickPoint(plan, hot(''), near, null, false)).toBe('C');
    expect(pickPoint(plan, hot('A'), near, null, false)).toBe('C');
    expect(pickPoint(plan, hot('C'), near, null, false)).toBe('B');
    expect(pickPoint(plan, hot('CB'), near, null, false)).toBe('A');
    expect(pickPoint(plan, hot('CA'), near, null, false)).toBe('B');
    expect(pickPoint(plan, hot('CBA'), near, null, false)).toBe('B');
    expect(pickPoint(plan, hot('CBA'), { A: 3, B: 5, C: 20 }, null, false)).toBe('A');
    // 끝났거나 꺼진 곳이 빠진 계획, 하나만 남으면 위험해도 그곳
    expect(pickPoint(['B', 'A'], hot('B'), near, null, false)).toBe('A');
    expect(pickPoint(['C'], hot('C'), near, null, false)).toBe('C');
  });

  it("점령 목표 이력(pickPoint): 지금 목표가 안전하면 그대로 간다('가는 길' 위험 깜빡임에 안전한 곳끼리 · 계획 첫 곳으로 오가지 않는다). 위험해지면 안전한 곳으로 바로, 모두 위험할 때 가까운 곳으로는 유지 시간 뒤", () => {
    const hot = (s: string): Record<PointId, boolean> => ({
      A: s.includes('A'),
      B: s.includes('B'),
      C: s.includes('C'),
    });
    const near: Record<PointId, number> = { A: 10, B: 5, C: 20 };
    const plan: PointId[] = ['C', 'B', 'A'];
    // C 위험 · B 위험으로 A를 골랐다 → B가 다시 안전해져도, C까지 안전해져도 A로 간다 (유지 시간이 지났어도)
    expect(pickPoint(plan, hot('C'), near, 'A', false)).toBe('A');
    expect(pickPoint(plan, hot(''), near, 'A', false)).toBe('A');
    // 지금 목표가 위험해지면 유지 시간 안이어도 계획 순서 앞쪽의 안전한 곳으로
    expect(pickPoint(plan, hot('CA'), near, 'A', true)).toBe('B');
    expect(pickPoint(plan, hot('A'), near, 'A', true)).toBe('C');
    // 모두 위험: 유지 시간 안이면 지금 목표, 지나면 가장 가까운 곳
    expect(pickPoint(plan, hot('CBA'), near, 'A', true)).toBe('A');
    expect(pickPoint(plan, hot('CBA'), near, 'A', false)).toBe('B');
    // 지금 목표가 끝났으면(남은 곳에 없으면) 이력 없이 규칙대로
    expect(pickPoint(['C', 'B'], hot('C'), near, 'A', true)).toBe('B');
  });

  it("목표 이력 장면: 계획 첫 곳(C)이 지켜지고 둘째(B)의 '가는 길' 위험이 내 자리에 따라 깜빡여도 제자리 왕복하지 않고 안전한 셋째(A)로 간다", () => {
    preparePracticeMap();
    // 검토 재현(시드 18 스카우트): 괴물이 C 옆에 보이고, 스카우트는 B '가는 길' 문턱(괴물에게서 약 9타일)에 서 있다.
    // 옛 두뇌는 B ↔ A를 1~3틱마다 바꿔 4초에 20타일을 걷고도 1.2타일만 나아갔다
    let seed = 1;
    while (survivorPlan(seed, 'scout').join('') !== 'CBA') seed += 1;
    const sim = scene(seed, { p4: practiceBrain('scout', seed) });
    const g = sim.game;
    place(g, 'p1', 26.9, 6.6, 0);
    // 괴물을 팀 시야에 두는 동료 (가만히 서 있다, C 반경 밖)
    place(g, 'p2', 25.5, 4.5);
    place(g, 'p4', 20.2, 12.6);
    const scout = g.survivorById('p4');
    if (!scout) throw new Error('자리 없음');
    const start = { x: scout.move.x, y: scout.move.y };
    let walked = 0;
    for (let t = 0; t < 4 * balance.network.serverTickHz; t += 1) {
      const px = scout.move.x;
      const py = scout.move.y;
      sim.step();
      walked += Math.hypot(scout.move.x - px, scout.move.y - py);
    }
    // 장면이 헛돌지 않게: 괴물이 끝까지 스카우트 화면(팀 시야)에 보인다
    expect(sim.lastSnap.get('p4')?.monster).toBeTruthy();
    expect(scout.status).toBe('free');
    const a = CAPTURE_POINTS.A;
    expect(far(scout.move, a)).toBeLessThan(far(start, a) - 8);
    expect(far(scout.move, start)).toBeGreaterThan(0.6 * walked);
  });

  it('생존자 봇: 꺼진 거점(진행 0.9) 안에 혼자 남고 동료 둘이 갇혔으면 마무리로 보지 않고 구조하러 간다', () => {
    preparePracticeMap();
    const seed = 1;
    const sim = scene(seed);
    const g = sim.game;
    twoDone(g, 0.9);
    jailGuardAndScout(g);
    place(g, 'p1', 45, 28);
    // 러너가 C에서 서는 자리 (C 가운데에서 왼쪽으로 0.8): 꺼진 C를 마무리할 곳으로 보면 이 자리가 목표라 서 있는다
    const c = CAPTURE_POINTS.C;
    place(g, 'p2', c.x - 0.8, c.y);
    refreshSnapshots(sim);
    const snap = sim.lastSnap.get('p2');
    const info = sim.infos.get('p2');
    if (!snap || !info) throw new Error('스냅샷 없음');
    expect(snap.world.points.map((p) => p.state)).toEqual(['done', 'done', 'off']);
    expect(snap.world.points.find((p) => p.id === 'C')?.progress ?? 0).toBeGreaterThanOrEqual(0.8);
    const brain = practiceBrain('runner', seed);
    // 결정: 이 스냅샷에서 바로 움직인다
    const out = brain.decide(snap, info, balance, 1);
    expect(Math.hypot(out.mx, out.my)).toBeGreaterThan(0.5);
    // 판: C를 떠나 두 동료를 풀어 준다
    sim.brains.set('p2', brain);
    const runner = g.survivorById('p2');
    const mates = ['p3', 'p4'].map((id) => g.survivorById(id));
    expect(sim.runUntil(() => mates.every((s) => s?.status === 'free'), 10)).toBe(true);
    if (!runner) throw new Error('자리 없음');
    expect(far(runner.move, c)).toBeGreaterThan(balance.capturePoint.radius);
  });

  it('생존자 봇: 꺼진 거점은 끝난 거점과 똑같이 본다 — 열린 A가 남은 손으로 만든 스냅샷 둘(꺼진 C 안 진행 0.9 · 동료 수감 / 계획 첫 곳이 꺼진 C)에서 결정이 C가 끝났을 때와 같다', () => {
    // 규칙에서는 꺼진 거점과 열린 거점이 함께 있지 않다(두 곳이 끝나는 틱에 나머지가 꺼진다). 그래서 위 장면은 할 일 목록과
    // 마무리 판단이 함께 꺼짐을 놓칠 때만 잡는다. 하나만 놓쳐도 잡도록 열린 A를 남긴다 (대조: C가 열려 있으면 결정이 달라진다)
    preparePracticeMap();
    const decisions = (
      seed: number,
      setupGame: (g: Game) => void,
    ): Record<'off' | 'done' | 'idle', string> => {
      const sim = scene(seed);
      const g = sim.game;
      for (const p of g.points) {
        if (p.id === 'B') {
          p.done = true;
          p.progress = balance.capturePoint.captureTime;
        } else if (p.id === 'C') {
          p.off = true;
          p.progress = balance.capturePoint.captureTime * 0.9;
        }
      }
      g.capturedCount = 1;
      place(g, 'p1', 45, 28);
      setupGame(g);
      refreshSnapshots(sim);
      const snap = sim.lastSnap.get('p2');
      const info = sim.infos.get('p2');
      if (!snap || !info) throw new Error('스냅샷 없음');
      expect(snap.world.points.map((p) => p.state)).toEqual(['idle', 'done', 'off']);
      const decideWith = (state: PointState): string => {
        const points = snap.world.points.map((p) => (p.id === 'C' ? { ...p, state } : p));
        const o = practiceBrain('runner', seed).decide(
          { ...snap, world: { ...snap.world, points } },
          info,
          balance,
          1,
        );
        return JSON.stringify([o.mx, o.my, o.held, o.pressed]);
      };
      return { off: decideWith('off'), done: decideWith('done'), idle: decideWith('idle') };
    };
    const c = CAPTURE_POINTS.C;
    // ① 마무리 판단: 꺼진 C 안(진행 0.9)에 서 있고 동료 둘이 갇혔다 — 마무리 중으로 보면 구조를 건너뛰고 A로 향한다
    const inC = decisions(1, (g) => {
      jailGuardAndScout(g);
      place(g, 'p2', c.x - 0.8, c.y);
    });
    expect(inC.off).toBe(inC.done);
    expect(inC.idle).not.toBe(inC.done);
    // ② 할 일 목록: 러너 계획의 첫 곳이 C인 시드, A와 C 사이(A는 서쪽, C는 동쪽으로 첫걸음)에서 — 꺼진 C를 남은 거점으로
    //    보면 A 대신 C로 향한다
    let seed = 1;
    while (survivorPlan(seed, 'runner')[0] !== 'C') seed += 1;
    const planC = decisions(seed, (g) => place(g, 'p2', 14.5, 9.5));
    expect(planC.off).toBe(planC.done);
    expect(planC.idle).not.toBe(planC.done);
  });

  it('괴물 봇: 끝났거나 꺼진 거점 안에서는 지키기 유예 비켜 서기를 하지 않는다 (안 끝난 거점에서만)', () => {
    preparePracticeMap();
    const seed = 3;
    const sim = scene(seed);
    const g = sim.game;
    twoDone(g, 0.5);
    // 괴물은 C 안에서 북쪽을 본다. 생존자는 멀리(괴물에게 안 보인다)
    const c = CAPTURE_POINTS.C;
    const me = { x: c.x + 0.6, y: c.y + 0.4 };
    place(g, 'p1', me.x, me.y, -Math.PI / 2);
    place(g, 'p2', 2.5, 29.5);
    place(g, 'p3', 3.5, 29.5);
    place(g, 'p4', 2.5, 28.5);
    refreshSnapshots(sim);
    const base = sim.lastSnap.get('p1');
    const info = sim.infos.get('p1');
    if (!base || !info) throw new Error('스냅샷 없음');
    expect(base.survivors).toEqual([]);
    expect(base.world.monsterWait).toBe(0);
    // 같은 자리 · 같은 스냅샷에 C 상태만 바꿔 5초 동안 (자리는 그대로 두어 C 안에 계속 머문다)
    const run = (state: PointState): string[] => {
      const brain = practiceBrain('monster', seed);
      const points = base.world.points.map((p) => (p.id === 'C' ? { ...p, state } : p));
      const outs: string[] = [];
      for (let k = 1; k <= 5 * balance.network.serverTickHz; k += 1) {
        const snap: Snapshot = { ...base, tick: base.tick + k, events: [], world: { ...base.world, points } };
        const o = brain.decide(snap, info, balance, k);
        outs.push(JSON.stringify([o.mx, o.my, o.aim, o.pressed]));
      }
      return outs;
    };
    const off = run('off');
    const done = run('done');
    const open = run('idle');
    expect(off).toEqual(done);
    // 대조: 안 끝난 거점이면 유예 전에 반경 밖으로 비켜 선다 — 처음 달라지는 틱에 C에서 멀어지는 쪽으로 움직인다
    const k = open.findIndex((o, i) => o !== done[i]);
    expect(k).toBeGreaterThan(balance.network.serverTickHz);
    const [mx, my] = JSON.parse(open[k] ?? '[0,0]') as [number, number];
    expect(mx * (me.x - c.x) + my * (me.y - c.y)).toBeGreaterThan(0);
  });

  it('괴물이 번갈아 지킬 거점: 지난번 다음 id로 돈다 (A → B → C → A), 끝나거나 꺼진 곳은 건너뛴다', () => {
    expect(nextGuarded(['A', 'B', 'C'], null)).toBe('A');
    expect(nextGuarded(['A', 'B', 'C'], 'A')).toBe('B');
    expect(nextGuarded(['A', 'B', 'C'], 'B')).toBe('C');
    expect(nextGuarded(['A', 'B', 'C'], 'C')).toBe('A');
    expect(nextGuarded(['A', 'C'], 'A')).toBe('C');
    expect(nextGuarded(['B'], 'B')).toBe('B');
  });

  // 꺼진 거점에 남지 않는 것은 위 손으로 만든 장면 시험이 본다 (봇끼리 판에서는 그 갈래에 거의 닿지 않고, 숨어 기다리기처럼
  // 정상인 서 있기가 꺼진 반경 안에 걸리기도 해 판 전체 수로는 지킬 수 없다)
  it('봇끼리 판(시드 1~24): 생존자가 이긴 판의 끝난 거점 조합이 AB에 묶이지 않고(C가 든 조합도 나온다), 끝난 거점은 언제나 두 곳 이하다', () => {
    preparePracticeMap();
    const combos = new Set<string>();
    for (let seed = 1; seed <= 24; seed += 1) {
      const setup = SimMatch.roles();
      const brains = new Map<string, BotBrain>(setup.map((p) => [p.id, practiceBrain(p.role, seed)]));
      const sim = new SimMatch(setup, balance, brains, seed);
      const g = sim.game;
      const limit = Math.ceil(balance.match.timeLimit / g.dt) + 2;
      for (let t = 0; t < limit && !g.end; t += 1) sim.step();
      // 끝난 거점은 언제나 두 곳 이하, 셋째는 끝나지 않는다
      const done = g.points.filter((p) => p.done).map((p) => p.id);
      expect(done.length).toBeLessThanOrEqual(balance.capturePoint.required);
      if (g.end?.winner === 'survivors') combos.add(done.join(''));
    }
    expect(combos.size).toBeGreaterThanOrEqual(2);
    expect([...combos].some((c) => c.includes('C'))).toBe(true);
  });
});
