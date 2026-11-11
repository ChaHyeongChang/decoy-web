// 실전 생존자 봇 두뇌 (플레이테스트 반영 c 검토 반영): '들어가면 · 가는 길에 곧 달아나게 되는 자리'는 막힘 · 피할 자리로 본다
//  - 구조 지점에서 5~6타일(지켜짐 반경 5 밖, 도주 반경 6.5 안)에 괴물이 서 있으면 구조하러 들어가자마자 달아나고, 도주가 끝나면
//    다시 들어가 0.7초마다 구조 ↔ 도주를 끝없이 되풀이했다 (기다리기 · 들어가 보기로도 넘어가지 않았다)
//  - 기다리는 자리는 그 봇의 실제 도주 반경(부상 · 마지막 목숨 덤)과 이력 밖, 그리 가는 길도 도주 반경을 지나지 않는 곳으로 고른다.
//    다친 마지막 목숨 봇(도주 반경 9)이 8~9타일 자리 · 그리 가는 길에서 기다리기 ↔ 도주를 되풀이했다
import { beforeAll, describe, expect, it } from 'vitest';
import {
  RESCUE_POINT,
  emptyInput,
  type Balance,
  type InputFrame,
  type MatchInfo,
  type Snapshot,
  type Vec2,
} from '@decoy/shared';
import {
  PracticeSurvivorBrain,
  SimMatch,
  idleBrain,
  preparePracticeMap,
  type BotBrain,
} from '@decoy/shared/sim';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
const HZ = balance.network.serverTickHz;

beforeAll(() => {
  preparePracticeMap();
});

/** 한자리에 서서 look 쪽을 보기만 한다 (치지 않는다 — 사람 괴물이 감옥 앞에서 지키고 서 있는 경우) */
class WatchMonster implements BotBrain {
  constructor(
    private readonly spot: Vec2,
    private readonly look: Vec2,
  ) {}

  decide(snap: Snapshot, _info: MatchInfo, _b: Balance, seq: number): InputFrame {
    const me = snap.you.move;
    const out: InputFrame = { ...emptyInput(seq), aim: Math.atan2(this.look.y - me.y, this.look.x - me.x) };
    const d = Math.hypot(this.spot.x - me.x, this.spot.y - me.y);
    if (d > 0.3) {
      out.mx = (this.spot.x - me.x) / d;
      out.my = (this.spot.y - me.y) / d;
    }
    return out;
  }
}

/** 두뇌 상태 꼬리표: 도주 · 들어가 보기 · 할 일 종류 */
function tag(brain: PracticeSurvivorBrain): string {
  const d = brain.debugState();
  return d ? (d.fleeing ? 'flee' : d.probe ? 'probe' : d.kind) : 'none';
}

interface WatchRun {
  /** 상태가 바뀐 차례 ('flee@3.0' 꼴) */
  seq: string[];
  /** 도주 시작 수 · 기다리기에서 곧바로 도주로 넘어간 수 */
  flees: number;
  waitToFlee: number;
  /** 갇힌 동료가 풀려났나 */
  rescued: boolean;
  /** 기다리기 할 일의 목표(기다리는 자리) 중 괴물에게서 가장 가까운 거리 (타일, 기다리기가 없으면 Infinity) */
  nearestWaitSpot: number;
}

/**
 * 러너 봇 혼자 자유(동료 둘은 갇힘 — 할 일은 구조), 괴물은 spot에 서서 구조 지점을 보기만 한다. 30초 동안 러너 두뇌 상태를 센다.
 * caught · hp로 러너의 수감 횟수 · 체력을 정한다 (조심 단계)
 */
function watchRun(seed: number, spot: Vec2, caught = 0, hp = balance.survivor.maxHp): WatchRun {
  const runner = new PracticeSurvivorBrain('runner', seed);
  const setup = SimMatch.roles();
  const brains = new Map<string, BotBrain>(
    setup.map((p) => [
      p.id,
      p.id === 'p1' ? new WatchMonster(spot, RESCUE_POINT) : p.id === 'p2' ? runner : idleBrain,
    ]),
  );
  const sim = new SimMatch(setup, balance, brains, seed);
  const g = sim.game;
  g.monster.move.frozen = 0;
  place(g, 'p1', spot.x, spot.y);
  place(g, 'p2', 9.5, 25.5);
  const me = g.survivorById('p2');
  if (!me) throw new Error('자리 없음');
  me.imprisonCount = caught;
  me.hp = hp;
  const jailed = ['p3', 'p4'].map((id, i) => {
    const s = g.survivorById(id);
    if (!s) throw new Error('자리 없음');
    s.status = 'imprisoned';
    s.move.x = 23.5 + i;
    s.move.y = 15.5;
    return s;
  });
  const seq: string[] = [];
  let flees = 0;
  let waitToFlee = 0;
  let rescued = false;
  let nearestWaitSpot = Infinity;
  let prev = '';
  for (let t = 0; t < 30 * HZ && !g.end; t += 1) {
    sim.step();
    const now = tag(runner);
    if (now !== prev) {
      seq.push(`${now}@${(t / HZ).toFixed(1)}`);
      if (now === 'flee') flees += 1;
      if (now === 'flee' && prev === 'wait') waitToFlee += 1;
    }
    const d = runner.debugState();
    if (d && d.kind === 'wait' && !d.probe) {
      const m = g.monster.move;
      nearestWaitSpot = Math.min(nearestWaitSpot, Math.hypot(d.target.x - m.x, d.target.y - m.y));
    }
    if (jailed.some((s) => s.status === 'free')) rescued = true;
    prev = now;
  }
  return { seq, flees, waitToFlee, rescued, nearestWaitSpot };
}

/** 구조 지점에서 각도(도, 0 = 동쪽 · 90 = 남쪽) · 거리(타일)인 자리 */
function around(deg: number, d: number): Vec2 {
  const a = (deg * Math.PI) / 180;
  return { x: RESCUE_POINT.x + d * Math.cos(a), y: RESCUE_POINT.y + d * Math.sin(a) };
}

describe('생존자 봇: 들어가면 곧 달아나게 되는 목표(괴물에게서 내 도주 반경 안)는 막힘으로 본다', () => {
  it('괴물이 구조 지점 남쪽 5.5타일(지켜짐 반경 밖 · 도주 반경 안)에 서 있다: 구조 ↔ 도주를 되풀이하지 않고 기다리기 · 들어가 보기로 넘어간다', () => {
    const spot = { x: RESCUE_POINT.x, y: RESCUE_POINT.y + 5.5 };
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = watchRun(seed, spot);
      const msg = `seed ${seed}: ${r.seq.join(' ')}`;
      // 옛 코드: 0.7초마다 구조 → 도주, 30초에 20번 · 기다리기 · 들어가 보기 0번 · 구조 0
      expect(r.flees, msg).toBeLessThanOrEqual(8);
      expect(r.rescued || r.seq.some((e) => e.startsWith('wait@') || e.startsWith('probe@')), msg).toBe(true);
    }
  });

  it('5~6타일 띠의 여러 방향에서도 같다 (남쪽 한 점만의 일이 아니다)', () => {
    const spots: [number, number][] = [
      [90, 5.2],
      [60, 5.8],
      [0, 5.5],
      [180, 5.5],
      [240, 5.5],
    ];
    for (const [deg, d] of spots) {
      for (const seed of [1, 2, 3]) {
        const r = watchRun(seed, around(deg, d));
        const msg = `${deg}° ${d}타일 seed ${seed}: ${r.seq.join(' ')}`;
        expect(r.flees, msg).toBeLessThanOrEqual(8);
        expect(r.rescued || r.seq.some((e) => e.startsWith('wait@') || e.startsWith('probe@')), msg).toBe(
          true,
        );
      }
    }
  });
});

describe('생존자 봇: 막힘으로 보는 것은 서 있는 괴물뿐 (움직이는 괴물은 다가가다 달아나기를 도주가 맡는다)', () => {
  /**
   * 러너 혼자 자유(동료 둘은 갇힘), 러너는 멀리 (9.5, 25.5). 괴물이 seen(k)틱 동안 monsterAt(k) 자리에 보이고 그 뒤 안 보인다.
   * 마지막으로 본 틱의 다음 틱에 러너가 고른 할 일
   */
  function kindAfter(ticks: number, monsterAt: (k: number) => Vec2): string {
    const setup = SimMatch.roles();
    const sim = new SimMatch(setup, balance, new Map(setup.map((p) => [p.id, idleBrain])), 1);
    const g = sim.game;
    g.monster.move.frozen = 0;
    place(g, 'p2', 9.5, 25.5);
    place(g, 'p1', 40, 5);
    for (let i = 0; i < 4; i += 1) sim.step();
    const snap = sim.lastSnap.get('p2');
    const info = sim.infos.get('p2');
    if (!snap || !info) throw new Error('스냅샷 없음');
    const survivors = snap.survivors.map((v, i) =>
      v.id === 'p2' ? v : { ...v, status: 'imprisoned' as const, x: 23.5 + i, y: 15.5 },
    );
    const base = {
      x: 0,
      y: 0,
      aim: 0,
      mode: 'search' as const,
      blend: 0,
      windup: 0,
      stunned: false,
      dashing: false,
      seesSomeone: false,
    };
    const brain = new PracticeSurvivorBrain('runner', 1);
    for (let k = 0; k <= ticks; k += 1) {
      const m = k < ticks ? { ...base, ...monsterAt(k) } : null;
      const s: Snapshot = { ...snap, tick: 100 + k, monster: m, marks: [], events: [], survivors };
      brain.decide(s, info, balance, k + 1);
    }
    return tag(brain);
  }

  it('구조 지점 남쪽 5.2타일에 3초 서 있던 괴물: 막힘 (기다린다)', () => {
    expect(kindAfter(3 * HZ, () => around(90, 5.2))).toBe('wait');
  });

  it('잠깐 멈춘 괴물(괴물 봇 감시 자리 1.2~2초 · 밀치기 기절 1.5초) · 한 번만 보인 괴물 · 지나간 괴물: 막지 않는다 (구조하러 간다)', () => {
    expect(kindAfter(2 * HZ, () => around(90, 5.2))).toBe('rescue');
    expect(kindAfter(1, () => around(90, 5.2))).toBe('rescue');
    // 동쪽에서 서쪽으로 3초 동안 지나간다 (초속 4타일)
    expect(kindAfter(3 * HZ, (k) => ({ x: 34 - (4 * k) / HZ, y: around(90, 5.2).y }))).toBe('rescue');
  });
});

describe('생존자 봇: 기다리는 자리 · 그리 가는 길은 그 봇의 도주 반경(조심 단계 덤 포함) 밖', () => {
  it('다친 마지막 목숨 봇(도주 반경 9), 괴물이 구조 지점 남쪽 2타일 · 3.5타일에 서 있다: 기다리기 ↔ 도주를 되풀이하지 않는다', () => {
    const last = balance.survivor.maxImprisonments;
    for (const dy of [2, 3.5]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const r = watchRun(seed, { x: RESCUE_POINT.x, y: RESCUE_POINT.y + dy }, last, 1);
        const msg = `남쪽 ${dy}타일 seed ${seed}: ${r.seq.join(' ')}`;
        // 옛 코드: 2타일 시드 1은 도주 28번 · 기다리기 → 도주 23번 (기다리는 자리로 가는 길이 괴물에게서 8.7타일)
        expect(r.waitToFlee, msg).toBeLessThanOrEqual(2);
        expect(r.flees, msg).toBeLessThanOrEqual(8);
      }
    }
  });

  it('구조 지점 북쪽 5.8타일, 다친 마지막 목숨(도주 반경 9): 구조 ↔ 도주 · 기다리기 → 도주를 되풀이하지 않는다', () => {
    // 옛 코드는 구조 ↔ 도주를 0.3초마다 끝없이. 기다리는 자리로 가다(머물다) 달아나면 그 자리를 피하는 안전망(burned)은 이
    // 장면을 가르지 않는다 (빼도 통과 — 장면 훑기 480판 중 서쪽(180°) 5.8타일 다친 마지막 목숨 두 판에서 도주 9 → 8번 정도만 줄인다)
    const last = balance.survivor.maxImprisonments;
    for (const seed of [1, 2]) {
      const r = watchRun(seed, around(270, 5.8), last, 1);
      const msg = `seed ${seed}: ${r.seq.join(' ')}`;
      expect(r.waitToFlee, msg).toBeLessThanOrEqual(2);
      expect(r.flees, msg).toBeLessThanOrEqual(8);
    }
  });

  it('조심 단계마다 기다리는 자리는 괴물에게서 그 봇의 도주 반경 + 이력(건강 8 · 부상 9 · 마지막 목숨 9.5 · 둘 다 10.5타일) 밖', () => {
    const last = balance.survivor.maxImprisonments;
    const max = balance.survivor.maxHp;
    // [수감 횟수, 체력, 도주 반경 + 이력]
    const stages: [number, number, number][] = [
      [0, max, 6.5 + 1.5],
      [0, 1, 6.5 + 1 + 1.5],
      [last, max, 6.5 + 1.5 + 1.5],
      [last, 1, 6.5 + 1 + 1.5 + 1.5],
    ];
    for (const [caught, hp, radius] of stages) {
      for (const seed of [1, 2, 3]) {
        const r = watchRun(seed, { x: RESCUE_POINT.x, y: RESCUE_POINT.y + 3.5 }, caught, hp);
        const msg = `수감 ${caught} 체력 ${hp} seed ${seed}: ${r.seq.join(' ')}`;
        expect(
          r.seq.some((e) => e.startsWith('wait@')),
          msg,
        ).toBe(true);
        // 괴물이 기둥에 걸려 0.3타일쯤 비켜 설 수 있다
        expect(r.nearestWaitSpot, msg).toBeGreaterThanOrEqual(radius - 0.3);
      }
    }
  });
});

describe('생존자 봇: 서 있는 괴물에게 쫓겨난 목표는 그 괴물이 그 자리에 있는 동안 막힘 (동료가 있어 점령으로 넘어가는 팀 장면)', () => {
  /**
   * 괴물은 spot에 서서 구조 지점을 보기만 하고, p4는 갇혀 있고, p2 · p3는 실전 두뇌 (자유 동료와 남은 거점이 있어 구조가 막히면
   * 점령으로 넘어간다 — 기다리기를 거치지 않는다). secs초 동안 봇마다 도주를 시작한 수
   */
  function teamRun(seed: number, spot: Vec2, secs: number): Map<string, number> {
    const setup = SimMatch.roles();
    const brains = new Map<string, BotBrain>();
    const survivors = new Map<string, PracticeSurvivorBrain>();
    for (const p of setup) {
      if (p.role === 'monster') {
        brains.set(p.id, new WatchMonster(spot, RESCUE_POINT));
        continue;
      }
      const brain = new PracticeSurvivorBrain(p.role, seed);
      brains.set(p.id, brain);
      survivors.set(p.id, brain);
    }
    const sim = new SimMatch(setup, balance, brains, seed);
    const g = sim.game;
    g.monster.move.frozen = 0;
    place(g, 'p1', spot.x, spot.y);
    const jailed = g.survivorById('p4');
    if (!jailed) throw new Error('자리 없음');
    jailed.status = 'imprisoned';
    jailed.move.x = 23.5;
    jailed.move.y = 15.5;
    const flees = new Map<string, number>();
    const prev = new Map<string, boolean>();
    for (let t = 0; t < secs * HZ && !g.end; t += 1) {
      sim.step();
      for (const [id, brain] of survivors) {
        const fleeing = brain.debugState()?.fleeing === true;
        if (fleeing && !prev.get(id)) flees.set(id, (flees.get(id) ?? 0) + 1);
        prev.set(id, fleeing);
      }
    }
    return flees;
  }

  it('괴물이 구조 지점 남쪽 5.2 · 5.5타일에 서 있다: 구조 ↔ 도주를 3초마다 되풀이하지 않는다 (봇마다 90초에 도주 12번 이하)', () => {
    // 옛 코드: 달아난 뒤 구조가 막히면 점령으로 넘어가고(기다리기의 sticky를 거치지 않음), 괴물을 본 지 2초가 지나면 '서 있음'
    // 막힘이 풀려 다시 구조하러 가다 감옥 벽 너머에서 괴물이 보이자마자 달아나기를 3.2초마다 (남쪽 5.5 시드 1: p2 29번,
    // 5.2 시드 2: p3 26번. 06300ec는 47~62번)
    for (const dy of [5.2, 5.5]) {
      for (const seed of [1, 2, 3, 4]) {
        const flees = teamRun(seed, { x: RESCUE_POINT.x, y: RESCUE_POINT.y + dy }, 90);
        for (const id of ['p2', 'p3']) {
          expect(flees.get(id) ?? 0, `남쪽 ${dy}타일 seed ${seed} ${id}`).toBeLessThanOrEqual(12);
        }
      }
    }
  });
});

describe('생존자 봇: 막다른 구석에서 기다리는 자리를 다시 골라도 한자리에 1초 넘게 서 있지 않는다', () => {
  /**
   * 러너가 s0(구석)에서 시작하고 괴물은 spot에 서서 구석 반대쪽을 본다. mode 'capture'는 동료 둘이 멀리 자유롭게 서 있고(할 일은
   * 점령), 'rescue'는 동료 둘이 갇혀 있다(할 일은 구조). secs초 동안 움직이지 않은 기다리기(들어가 보기 · 도주 아님)의 가장 긴 구간 (초)
   */
  function longestStill(
    mode: 'capture' | 'rescue',
    s0: Vec2,
    spot: Vec2,
    caught: number,
    hp: number,
    secs: number,
  ): { still: number; seq: string[] } {
    const runner = new PracticeSurvivorBrain('runner', 1);
    const setup = SimMatch.roles();
    const look = { x: 2 * spot.x - s0.x, y: 2 * spot.y - s0.y };
    const brains = new Map<string, BotBrain>(
      setup.map((p) => [
        p.id,
        p.id === 'p1' ? new WatchMonster(spot, look) : p.id === 'p2' ? runner : idleBrain,
      ]),
    );
    const sim = new SimMatch(setup, balance, brains, 1);
    const g = sim.game;
    g.monster.move.frozen = 0;
    place(g, 'p1', spot.x, spot.y);
    place(g, 'p2', s0.x, s0.y);
    const me = g.survivorById('p2');
    if (!me) throw new Error('자리 없음');
    me.imprisonCount = caught;
    me.hp = hp;
    if (mode === 'rescue') {
      ['p3', 'p4'].forEach((id, i) => {
        const s = g.survivorById(id);
        if (!s) throw new Error('자리 없음');
        s.status = 'imprisoned';
        s.move.x = 23.5 + i;
        s.move.y = 15.5;
      });
    } else {
      place(g, 'p3', 2.5, 30.5);
      place(g, 'p4', 45.5, 30.5);
    }
    let px = me.move.x;
    let py = me.move.y;
    let run = 0;
    let longest = 0;
    const seq: string[] = [];
    let prev = '';
    for (let t = 0; t < secs * HZ && !g.end; t += 1) {
      sim.step();
      const moved = Math.hypot(me.move.x - px, me.move.y - py);
      px = me.move.x;
      py = me.move.y;
      const d = runner.debugState();
      const now = tag(runner);
      if (now !== prev) seq.push(`${now}@${(t / HZ).toFixed(1)}`);
      prev = now;
      if (me.status === 'free' && d && d.kind === 'wait' && !d.probe && !d.fleeing && moved < 0.005) {
        run += 1;
        longest = Math.max(longest, run);
      } else run = 0;
    }
    return { still: longest / HZ, seq };
  }

  it('점령 장면: 북동 구석 (46.5, 2.5), 괴물이 (39.5, 7.5)에 서 있다 (갈 수 있는 다음 자리마다 길이 도주 반경을 지난다)', () => {
    // 옛 코드: 머물기가 끝나 다음 자리로 가는 길이 도주 반경을 지나면 다시 고르고, 가장 가까운 지금 자리가 첫 자리가 되어
    // 이어 머물기(0틱) → 또 다시 고르기를 매 틱 되풀이하며 2.8초씩 섰다 (60초 중 20초)
    const r = longestStill(
      'capture',
      { x: 46.5, y: 2.5 },
      { x: 39.5, y: 7.5 },
      0,
      balance.survivor.maxHp,
      60,
    );
    expect(r.still, r.seq.join(' ')).toBeLessThanOrEqual(1.0);
  });

  it('구조 장면: 남동 구석 (46.5, 30.5), 괴물이 (38.5, 23.5)에 서 있다, 다친 마지막 목숨', () => {
    const r = longestStill(
      'rescue',
      { x: 46.5, y: 30.5 },
      { x: 38.5, y: 23.5 },
      balance.survivor.maxImprisonments,
      1,
      60,
    );
    expect(r.still, r.seq.join(' ')).toBeLessThanOrEqual(1.0);
  });
});
