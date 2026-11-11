// 실전 괴물 봇 두뇌 (플레이테스트 반영 c, docs/playtest/c-bots.md 3.3절 M1~M7): 행동마다 시험.
// 손으로 만든 스냅샷(합성)이나 손으로 맞춘 장면(SimMatch + 가만히 있는 생존자)으로 두뇌 하나의 결정을 보고,
// 봇끼리 판으로 '한자리 3초 넘게 서지 않기' · 결정성(임시 ID 값 · 배열 순서와 무관)을 본다.
// 두뇌는 자기 스냅샷만 받는다 — 시험이 만든 스냅샷도 괴물 화면 모양 그대로(임시 ID · 역할 없음 · 부상 정보 없음)다
import { describe, expect, it } from 'vitest';
import {
  BTN,
  CAPTURE_POINTS,
  POINT_IDS,
  PRISON_RECT,
  distToRect,
  lineOfSight,
  type GameEvent,
  type InputFrame,
  type MatchInfo,
  type Snapshot,
  type SurvivorView,
  type Vec2,
} from '@decoy/shared';
import {
  SimMatch,
  buildResult,
  findPath,
  idleBrain,
  practiceBrain,
  preparePracticeMap,
  type AliasBook,
  type BotBrain,
} from '@decoy/shared/sim';
import { ringSpots } from '../../shared/src/sim/practiceMonster';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
const HZ = balance.network.serverTickHz;

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

/** 손으로 바꾼 판 상태가 괴물 스냅샷에 담길 때까지 */
function refresh(sim: SimMatch): void {
  const before = sim.lastSnap.get('p1');
  for (let i = 0; i < 4 && sim.lastSnap.get('p1') === before; i += 1) sim.step();
}

/** 합성 스냅샷의 바탕: 시작 대기 없는 괴물 스냅샷 (생존자 셋은 멀리, 안 보인다) */
function baseSnap(): { snap: Snapshot; info: MatchInfo } {
  const sim = scene(1);
  place(sim.game, 'p2', 2.5, 29.5);
  place(sim.game, 'p3', 3.5, 29.5);
  place(sim.game, 'p4', 2.5, 28.5);
  refresh(sim);
  const snap = sim.lastSnap.get('p1');
  const info = sim.infos.get('p1');
  if (!snap || !info || !snap.you.mon) throw new Error('스냅샷 없음');
  return { snap, info };
}

/** 괴물 화면의 생존자 한 명 (임시 ID · 역할 없음) */
function seen(id: string, x: number, y: number): SurvivorView {
  return {
    id,
    x,
    y,
    face: 0,
    role: null,
    status: 'free',
    protected: false,
    hp: null,
    imprisonCount: null,
    abilityCd: null,
    rescue: null,
    spotted: null,
    connected: null,
  };
}

interface SynthFrame {
  tick: number;
  me: { x: number; y: number; face: number; dash?: number };
  survivors?: SurvivorView[];
  attackCd?: number;
  dashCd?: number;
  mode?: 'search' | 'hunt';
  countdown?: number;
  events?: GameEvent[];
}

/** 바탕 스냅샷에 자리 · 쿨 · 생존자 · 이벤트만 바꾼 괴물 스냅샷 */
function synth(base: Snapshot, f: SynthFrame): Snapshot {
  const mon = base.you.mon;
  if (!mon) throw new Error('괴물 아님');
  return {
    ...base,
    tick: f.tick,
    you: {
      ...base.you,
      move: {
        ...base.you.move,
        x: f.me.x,
        y: f.me.y,
        face: f.me.face,
        dash: f.me.dash ?? 0,
        stun: 0,
        frozen: 0,
      },
      mon: {
        ...mon,
        attackCd: f.attackCd ?? 0,
        dashCd: f.dashCd ?? 0,
        windup: 0,
        mode: f.mode ?? 'hunt',
        camp: 0,
      },
    },
    survivors: f.survivors ?? [],
    events: f.events ?? [],
    world: { ...base.world, countdown: f.countdown ?? 0, monsterWait: 0, imprisoned: 0 },
  };
}

const pressed = (o: InputFrame, btn: number): boolean => (o.pressed & btn) !== 0;

describe('실전 괴물 봇: 추격 (M1 돌진 → 공격, M2 거리 좁히기 돌진, M6 가까우면 넓은 시야)', () => {
  // B 방 남쪽의 동서로 트인 줄 (y 19.5, x 35~46 바닥): 괴물 (35.5, 19.5)에서 +x 쪽을 본다
  const Y = 19.5;

  it('돌진이 끝나는 첫 틱에 거리 · 조준이 호 안이면 바로 공격한다 (돌진 직후에만 보통 조건보다 조금 느슨하게)', () => {
    const { snap: base, info } = baseSnap();
    let tried = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      const brain = practiceBrain('monster', seed);
      // 1) 4.33타일 앞에 선 표적: 반응 시간 뒤 돌진 (가까운 창 2.8~4.4, 공격 쿨 0)
      const start = { x: 35.5, y: Y };
      const target0 = 39.83;
      let t = 100;
      let dashAt = -1;
      for (let k = 0; k < 20 && dashAt < 0; k += 1, t += 1) {
        const o = brain.decide(
          synth(base, { tick: t, me: { ...start, face: 0 }, survivors: [seen('s', target0, Y)] }),
          info,
          balance,
          t,
        );
        if (pressed(o, BTN.DASH)) dashAt = t;
      }
      if (dashAt < 0) continue; // 돌진 주사위(0.85 이상)가 실패한 시드: 다른 시드로
      tried += 1;
      // 2) 돌진 8틱 (0.5타일/틱), 표적은 4.75타일/초로 멀어진다
      const v = 4.75 / HZ;
      for (let k = 1; k <= 8; k += 1) {
        const o = brain.decide(
          synth(base, {
            tick: dashAt + k,
            me: { x: start.x + 0.5 * k, y: Y, face: 0, dash: 0.1 },
            survivors: [seen('s', target0 + v * k, Y)],
          }),
          info,
          balance,
          dashAt + k,
        );
        expect(pressed(o, BTN.ATTACK)).toBe(false);
      }
      // 3) 돌진 끝: 거리 1.6, 멀어지는 중 (준비 0.4초 뒤 예상 간격 1.3 — 보통 조건 1.25 밖, 사거리 + 반지름 1.5 안),
      //    조준이 표적 방향에서 0.45라디안 (보통 조건 0.4 밖, 호 ±45° 안) → 2틱 안에 공격
      let attackAt = -1;
      for (let k = 9; k <= 10 && attackAt < 0; k += 1) {
        const tx = target0 + v * k;
        const o = brain.decide(
          synth(base, {
            tick: dashAt + k,
            me: { x: tx - 1.6, y: Y, face: 0.45 },
            survivors: [seen('s', tx, Y)],
          }),
          info,
          balance,
          dashAt + k,
        );
        if (pressed(o, BTN.ATTACK)) attackAt = k;
      }
      expect(attackAt, `seed ${seed}`).toBeGreaterThan(0);
    }
    expect(tried).toBeGreaterThanOrEqual(5);
  });

  it('가까운 창 돌진은 끝나자마자 칠 수 있을 때만 (공격 쿨이 돌진 시간보다 길면 돌진하지 않는다)', () => {
    const { snap: base, info } = baseSnap();
    for (const [cd, expectDash] of [
      [0.35, false],
      [0.2, true],
    ] as const) {
      let any = false;
      for (let seed = 1; seed <= 6; seed += 1) {
        const brain = practiceBrain('monster', seed);
        for (let t = 100; t < 120; t += 1) {
          const o = brain.decide(
            synth(base, {
              tick: t,
              me: { x: 35.5, y: Y, face: 0 },
              attackCd: cd,
              survivors: [seen('s', 39.3, Y)],
            }),
            info,
            balance,
            t,
          );
          if (pressed(o, BTN.DASH)) any = true;
        }
      }
      expect(any, `공격 쿨 ${cd}`).toBe(expectDash);
    }
  });

  it('멀어지는 표적에게 4.4타일 밖에서 거리 좁히기 돌진 (M2), 다가오는 표적에게는 쓰지 않는다', () => {
    const { snap: base, info } = baseSnap();
    const step = 4.5 / HZ;
    /** 괴물과 표적이 같은 속도로 같은 쪽(dir)으로 움직여 거리는 5타일 그대로 — dir 1이면 표적이 멀어지고 -1이면 다가온다 */
    const run = (dir: 1 | -1): boolean => {
      let any = false;
      for (let seed = 1; seed <= 6; seed += 1) {
        const brain = practiceBrain('monster', seed);
        const m0 = dir === 1 ? 35.5 : 40;
        for (let k = 0; k < 20; k += 1) {
          const mx = m0 + dir * step * k;
          const o = brain.decide(
            synth(base, { tick: 100 + k, me: { x: mx, y: Y, face: 0 }, survivors: [seen('s', mx + 5, Y)] }),
            info,
            balance,
            100 + k,
          );
          if (pressed(o, BTN.DASH)) any = true;
        }
      }
      return any;
    };
    expect(run(1)).toBe(true);
    expect(run(-1)).toBe(false);
  });

  it('추적 중 표적이 3.5타일 안이면 탐색 시야(넓게)로 바꾸고, 5타일 밖이면 추적 시야로 (M6)', () => {
    const { snap: base, info } = baseSnap();
    const modePress = (d: number, mode: 'search' | 'hunt'): boolean => {
      const brain = practiceBrain('monster', 3);
      let any = false;
      for (let t = 100; t < 106; t += 1) {
        const o = brain.decide(
          synth(base, {
            tick: t,
            me: { x: 35.5, y: Y, face: 0 },
            mode,
            attackCd: 1,
            dashCd: 5,
            survivors: [seen('s', 35.5 + d, Y)],
          }),
          info,
          balance,
          t,
        );
        if (pressed(o, BTN.MODE)) any = true;
      }
      return any;
    };
    expect(modePress(2.5, 'hunt')).toBe(true);
    expect(modePress(2.5, 'search')).toBe(false);
    expect(modePress(6.5, 'search')).toBe(true);
    expect(modePress(6.5, 'hunt')).toBe(false);
    // 사이(4.2타일)에서는 지금 모드를 그대로 둔다 (오가며 누르지 않게)
    expect(modePress(4.2, 'hunt')).toBe(false);
    expect(modePress(4.2, 'search')).toBe(false);
  });
});

describe('실전 괴물 봇: 놓친 뒤 · 포효 · 알림 (M3 · M4 · M7)', () => {
  /** 괴물이 p2를 쫓게 만든 장면 (B 방 남쪽, 다른 생존자는 남서 구석) */
  function chasing(seed: number): SimMatch {
    const sim = scene(seed, { p1: practiceBrain('monster', seed) });
    const g = sim.game;
    place(g, 'p1', 36, 19.5, 0);
    place(g, 'p2', 39, 19.5);
    place(g, 'p3', 2.5, 29.5);
    place(g, 'p4', 3.5, 29.5);
    sim.runUntil(() => false, 0.3);
    return sim;
  }

  it('포효 핑이 오면 방금 놓친 곳(놓친 곳 수색)보다 핑 쪽으로 간다', () => {
    for (const seed of [1, 2, 3]) {
      const sim = chasing(seed);
      const g = sim.game;
      // 쫓던 생존자가 사라진다 (먼 구석으로) → 놓친 곳 수색이 시작된다
      place(g, 'p2', 46.5, 2.5);
      sim.runUntil(() => false, 0.2);
      // 그 뒤 포효 핑 (서쪽, 놓친 곳의 반대쪽)
      const ping = { x: 30.5, y: 18.5 };
      g.emitTo(g.monster, { k: 'roarPings', pts: [ping] });
      const d0 = Math.hypot(g.monster.move.x - ping.x, g.monster.move.y - ping.y);
      sim.runUntil(() => false, 1.5);
      const d1 = Math.hypot(g.monster.move.x - ping.x, g.monster.move.y - ping.y);
      expect(d0 - d1, `seed ${seed}`).toBeGreaterThan(4);
    }
  });

  it('쫓는 동안 받은 점령 알림을 기억했다가 추적이 끝나면 그 거점부터 간다 (점령이 멈춰 배지가 꺼져도)', () => {
    for (const seed of [1, 2, 3]) {
      const sim = chasing(seed);
      const g = sim.game;
      // 쫓는 중에 A 점령이 시작된다 (알림) → 곧 멈춘다 (배지 꺼짐)
      place(g, 'p3', CAPTURE_POINTS.A.x, CAPTURE_POINTS.A.y);
      sim.runUntil(() => false, 0.4);
      place(g, 'p3', 2.5, 29.5);
      sim.runUntil(() => false, 0.2);
      // 쫓던 생존자가 사라진다 (동쪽 끝 위 — A의 반대쪽)
      place(g, 'p2', 46.5, 2.5);
      const a = CAPTURE_POINTS.A;
      const d0 = Math.hypot(g.monster.move.x - a.x, g.monster.move.y - a.y);
      sim.runUntil(() => false, 1.0);
      const d1 = Math.hypot(g.monster.move.x - a.x, g.monster.move.y - a.y);
      expect(d0 - d1, `seed ${seed}: 1초 안에 A 쪽으로`).toBeGreaterThan(3);
      const reached = sim.runUntil(
        (gg) =>
          Math.hypot(gg.monster.move.x - a.x, gg.monster.move.y - a.y) <= balance.capturePoint.radius + 1.5,
        12,
      );
      expect(reached, `seed ${seed}: 12초 안에 A 가장자리`).toBe(true);
    }
  });

  it('놓친 곳을 둘러봐도 없으면 달아나던 쪽의 안 보이는 곳을 더 찾고, 그래도 없으면 포효한다', () => {
    const { snap: base, info } = baseSnap();
    for (const seed of [1, 2, 3, 4]) {
      const brain = practiceBrain('monster', seed);
      // 표적이 +x로 달리다 사라진다. 그 뒤 괴물 자리는 시험이 따라 옮긴다 (두뇌 입력대로 5.5타일/초)
      const me = { x: 36, y: 19.5, face: 0 };
      let t = 100;
      for (let k = 0; k < 12; k += 1, t += 1) {
        brain.decide(
          synth(base, {
            tick: t,
            me,
            dashCd: 5,
            attackCd: 1,
            survivors: [seen('s', 39 + (4.5 / HZ) * k, 19.5)],
          }),
          info,
          balance,
          t,
        );
      }
      const visited: Vec2[] = [];
      let roarAt = -1;
      for (let k = 0; k < 15 * HZ && roarAt < 0; k += 1, t += 1) {
        const o = brain.decide(synth(base, { tick: t, me, dashCd: 5, attackCd: 1 }), info, balance, t);
        if (pressed(o, BTN.ROAR)) roarAt = t;
        const sp = Math.hypot(o.mx, o.my);
        if (sp > 0) {
          me.x += (o.mx / Math.max(1, sp)) * (5.5 / HZ);
          me.y += (o.my / Math.max(1, sp)) * (5.5 / HZ);
        }
        me.face = o.aim;
        visited.push({ x: me.x, y: me.y });
      }
      expect(roarAt, `seed ${seed}: 수색 뒤 포효`).toBeGreaterThan(0);
      // 놓친 곳(동쪽 41 근처)보다 더 간 곳 — 달아나던 쪽(+x)으로 마지막 위치에서 4타일 넘게
      expect(Math.max(...visited.map((p) => p.x)), `seed ${seed}`).toBeGreaterThan(43);
    }
  });
});

describe('실전 괴물 봇: 서지 않기 · 세 거점 (M5)', () => {
  /** 괴물이 한자리에 서 있던 가장 긴 시간 (초): 시작 대기 · 기절 · 보이는 자유 생존자가 있을 때(추적) 빼고 */
  function longestStand(sim: SimMatch, seconds: number): { longest: number; visits: Set<string> } {
    const g = sim.game;
    const m = g.monster;
    let run = 0;
    let longest = 0;
    let px = m.move.x;
    let py = m.move.y;
    const visits = new Set<string>();
    const limit = Math.ceil(seconds * HZ);
    for (let t = 0; t < limit && !g.end; t += 1) {
      sim.step();
      const moved = Math.hypot(m.move.x - px, m.move.y - py);
      px = m.move.x;
      py = m.move.y;
      const snap = sim.lastSnap.get('p1');
      const chasing = !!snap && snap.survivors.some((s) => s.status === 'free');
      const excused = m.move.frozen > 0 || m.move.stun > 0 || chasing || m.windupLeft > 0;
      if (!excused && moved < 1e-3) run += 1;
      else run = 0;
      longest = Math.max(longest, run / HZ);
      for (const id of POINT_IDS) {
        const c = CAPTURE_POINTS[id];
        if (Math.hypot(m.move.x - c.x, m.move.y - c.y) <= balance.capturePoint.radius + 2) visits.add(id);
      }
    }
    return { longest, visits };
  }

  it('봇끼리 판: 추적 · 시작 대기 · 기절이 아니면 한자리에 3초 넘게 서지 않는다', () => {
    preparePracticeMap();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const setup = SimMatch.roles();
      const brains = new Map<string, BotBrain>(setup.map((p) => [p.id, practiceBrain(p.role, seed)]));
      const sim = new SimMatch(setup, balance, brains, seed);
      const { longest } = longestStand(sim, balance.match.timeLimit);
      expect(longest, `seed ${seed}`).toBeLessThanOrEqual(3);
    }
  });

  it('생존자가 숨어 안 나오는 판: 3초 넘게 서지 않고, 2분 30초 안에 세 거점을 모두 들른다', () => {
    preparePracticeMap();
    for (const seed of [1, 2, 3, 4]) {
      const setup = SimMatch.roles();
      const sim = new SimMatch(
        setup,
        balance,
        new Map(setup.map((p) => [p.id, p.role === 'monster' ? practiceBrain('monster', seed) : idleBrain])),
        seed,
      );
      // 생존자 셋은 바깥벽 칸 안 (괴물은 못 보고 못 닿는다 — 점령도 하지 않아 알림이 없다)
      place(sim.game, 'p2', 0.5, 0.5);
      place(sim.game, 'p3', 47.5, 0.5);
      place(sim.game, 'p4', 0.5, 31.5);
      const { longest, visits } = longestStand(sim, 150);
      expect(longest, `seed ${seed}`).toBeLessThanOrEqual(3);
      expect([...visits].sort(), `seed ${seed}`).toEqual([...POINT_IDS].sort());
    }
  });

  it('거점 둘레 자리: 거점마다 넷 이상, 바닥 · 길이 닿음 · 거점 반경과 감옥 캠핑 반경 밖 · 거점 가운데가 보임', () => {
    preparePracticeMap();
    const ctx = { kind: 'monster' as const, imprisoned: false, openExits: { N: false, S: false } };
    for (const id of POINT_IDS) {
      const c = CAPTURE_POINTS[id];
      const ring = ringSpots(id, balance);
      expect(ring.length, id).toBeGreaterThanOrEqual(4);
      for (const p of ring) {
        expect(findPath(c, p, ctx).length, `${id} (${p.x}, ${p.y})`).toBeGreaterThan(0);
        expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeGreaterThan(balance.capturePoint.radius + 0.5);
        expect(distToRect(p, PRISON_RECT)).toBeGreaterThan(balance.prison.campRadius);
        expect(lineOfSight(p, c)).toBe(true);
      }
    }
  });
});

describe('실전 괴물 봇: 시간 · 결정성', () => {
  it("'아무도 못 본 시간'(포효 대기)은 판 시작 카운트다운이 끝난 때부터 센다", () => {
    const { snap: base, info } = baseSnap();
    const START = 3 * HZ;
    /** 아무도 안 보이는 판: 처음 ROAR를 누른 틱 (판이 흐른 틱부터 센 값) */
    const firstRoar = (offset: number, countdownTicks: number): number => {
      const brain = practiceBrain('monster', 4);
      for (let t = 0; t < countdownTicks; t += 1) {
        brain.decide(
          synth(base, { tick: t, me: { x: 36, y: 19.5, face: 0 }, countdown: (countdownTicks - t) / HZ }),
          info,
          balance,
          t + 1,
        );
      }
      for (let k = 0; k < 40 * HZ; k += 1) {
        const o = brain.decide(
          synth(base, { tick: offset + k, me: { x: 36, y: 19.5, face: 0 } }),
          info,
          balance,
          offset + k + 1,
        );
        if (pressed(o, BTN.ROAR)) return k;
      }
      return -1;
    };
    const plain = firstRoar(0, 0);
    expect(plain).toBeGreaterThan(0);
    // 실제 방: 카운트다운 동안은 두뇌를 부르지 않고(BotDriver) 판 틱은 카운트다운만큼 앞서 있다
    expect(firstRoar(START, 0)).toBe(plain);
    // 카운트다운 중 스냅샷을 받는 경우도 같다
    expect(firstRoar(START, START)).toBe(plain);
  });

  it('표적 동점: 같은 자리 · 같은 속도 · 같이 처음 본 생존자 둘은 임시 ID 값 · 배열 순서와 무관하게 같은 결정 (손으로 만든 스냅샷)', () => {
    const { snap: base, info } = baseSnap();
    const me = { x: 36, y: 19.5, face: 0 };
    // 다섯 스냅샷 동안 둘이 같은 자리, 그 뒤 갈라진다 (덤 1.5 안의 거리 차)
    const frames: Array<{ s: Vec2; t: Vec2 }> = [];
    for (let k = 0; k < 5; k += 1) frames.push({ s: { x: 39, y: 19.5 }, t: { x: 39, y: 19.5 } });
    for (let k = 1; k <= 10; k += 1)
      frames.push({
        s: { x: 39 + 0.04 * k, y: 19.5 - 0.1 * k },
        t: { x: 39 + 0.02 * k, y: 19.5 + 0.09 * k },
      });
    const run = (ids: [string, string], reverse: boolean): string[] => {
      const brain = practiceBrain('monster', 2);
      const outs: string[] = [];
      frames.forEach((f, k) => {
        const list = [seen(ids[0], f.s.x, f.s.y), seen(ids[1], f.t.x, f.t.y)];
        if (reverse) list.reverse();
        const o = brain.decide(
          synth(base, { tick: 200 + k, me, attackCd: 1, dashCd: 5, survivors: list }),
          info,
          balance,
          k + 1,
        );
        outs.push(JSON.stringify([o.mx, o.my, o.aim, o.pressed]));
      });
      return outs;
    };
    const a = run(['a1', 'a2'], false);
    expect(run(['zz', 'yy'], true)).toEqual(a);
    expect(run(['b7', 'c3'], true)).toEqual(a);
    expect(run(['q9', 'q3'], false)).toEqual(a);
  });

  /**
   * 봇끼리 판: 괴물 두뇌가 받는 임시 ID를 다른 값으로 바꾸고 배열 순서를 뒤집어도 판이 지문까지 같다.
   * 같은 임시 ID는 판 내내 같은 새 값이고, 새 임시 ID(시야에 다시 들어옴)는 새 값을 받는다. 바꿔 끼우는 값 · 순서는 시험이
   * 실제 자리로 정해(두뇌에는 안 간다) 두 판이 서로 반대 순서를 받게 한다. 동점(같은 자리 둘)이 실제로 생기는 시드를 넣는다:
   * 36은 b 최종 두뇌에서 구조로 함께 풀려난 둘이 (24.594, 18.493)에 겹친 시드(그 두뇌로는 이 시험이 실패한다),
   * 120 · 141은 c 괴물 두뇌에서 겹치는 시드 (두뇌가 바뀌어 겹침이 없어지면 다시 찾아 고른다)
   */
  it('같은 시드는 임시 ID 값 · 배열 순서가 달라도 같은 판 (생존자 둘이 같은 자리에 겹치는 판 포함)', () => {
    preparePracticeMap();
    let ties = 0;
    for (const seed of [36, 120, 141]) {
      const play = (prefix: string, desc: boolean): string => {
        const setup = SimMatch.roles();
        const counter = { ties: 0 };
        const holder: { sim: SimMatch | null } = { sim: null };
        const inner = practiceBrain('monster', seed);
        const fresh = new Map<string, string>();
        const seq = new Map<string, number>();
        const wrapped: BotBrain = {
          decide: (snap, info, b, n) => {
            // 시험만 아는 실제 자리 (두뇌에는 새 임시 ID만 간다)
            const book = (holder.sim as unknown as { aliases: AliasBook } | null)?.aliases;
            const realOf = (alias: string): string =>
              ['p2', 'p3', 'p4'].find((id) => book?.get(id) === alias) ?? 'p?';
            const free = snap.survivors.filter((s) => s.status === 'free');
            for (let i = 0; i < free.length; i += 1)
              for (let j = i + 1; j < free.length; j += 1)
                if (free[i]?.x === free[j]?.x && free[i]?.y === free[j]?.y) counter.ties += 1;
            const list = snap.survivors.map((s) => {
              let id = fresh.get(s.id);
              if (!id) {
                const real = realOf(s.id);
                const k = (seq.get(real) ?? 0) + 1;
                seq.set(real, k);
                id = `${prefix}-${real}-${k}`;
                fresh.set(s.id, id);
              }
              return { ...s, id };
            });
            list.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) * (desc ? -1 : 1));
            return inner.decide({ ...snap, survivors: list }, info, b, n);
          },
        };
        const brains = new Map<string, BotBrain>(
          setup.map((p) => [p.id, p.role === 'monster' ? wrapped : practiceBrain(p.role, seed)]),
        );
        const sim = new SimMatch(setup, balance, brains, seed);
        holder.sim = sim;
        const g = sim.game;
        const limit = Math.ceil(balance.match.timeLimit / g.dt) + 2;
        for (let t = 0; t < limit && !g.end; t += 1) sim.step();
        ties += counter.ties;
        return JSON.stringify({
          tick: g.tick,
          end: g.end,
          result: buildResult(g),
          pos: [...g.players.values()].map((p) => [Math.round(p.move.x * 1000), Math.round(p.move.y * 1000)]),
        });
      };
      expect(play('k', true), `seed ${seed}`).toBe(play('q', false));
    }
    // 검사가 헛돌지 않게: 같은 자리에 겹친 생존자를 괴물이 실제로 봤다
    expect(ties).toBeGreaterThan(0);
  });
});
