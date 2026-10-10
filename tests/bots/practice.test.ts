// 실전 봇 두뇌 (M13b 2번): 봇 4명 판을 시드 6개로 끝까지.
// 시간 초과가 아닌 종료 · 양쪽 승리 · 실제 공격 · 수감 · 점령 · 구조 · 탈출, 괴물 봇이 받은 스냅샷에 시야 밖 생존자 0,
// 틱 비용, 같은 시드는 같은 판, 기기 안 연습 방(BotDriver)에서 틱당 입력 1개
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PRISON_RECT,
  RESCUE_POINT,
  blocksMove,
  distToRect,
  lineOfSight,
  monsterSees,
  type ClientMessage,
  type Role,
  type Snapshot,
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
  practiceBrain,
  preparePracticeMap,
  type BotBrain,
  type Game,
} from '@decoy/shared/sim';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
const SEEDS = [1, 2, 3, 4, 5, 6];
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
      raw({ t: 'join', room: null, create: true, name: '나', token: null, altTokens: [], bots: true }),
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
    const ticks = 20 * balance.network.serverTickHz;
    for (let t = 1; t <= ticks && !game.end; t += 1) {
      clock.t += core.tickMs;
      core.advance(clock.t);
      for (const b of bots) {
        expect(b.inputs).toBe(t);
        expect(game.players.get(b.seat.id)?.starved).toBe(0);
      }
    }
    for (const b of bots) {
      const p = game.players.get(b.seat.id);
      const s = start.get(b.seat.id);
      if (!p || !s || s.x === undefined || s.y === undefined) throw new Error('자리 없음');
      expect(Math.hypot(p.move.x - s.x, p.move.y - s.y)).toBeGreaterThan(3);
    }
    // 괴물 봇이 받은 MatchInfo 명단에는 자기 자신만 있다
    const monsterBot = bots.find((b) => b.seat.role === 'monster');
    expect(monsterBot?.info?.roster.map((r) => r.role)).toEqual(['monster']);
  });
});
