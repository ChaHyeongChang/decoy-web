// 실전 괴물 봇 두뇌 (플레이테스트 반영 c, docs/playtest/c-bots.md 3.3절 M1~M7): 행동마다 시험.
// 손으로 만든 스냅샷(합성)이나 손으로 맞춘 장면(SimMatch + 가만히 있는 생존자)으로 두뇌 하나의 결정을 보고,
// 봇끼리 판으로 '한자리 2.5초(서 있기 감시 + 0.1초) 넘게 서지 않기' · 결정성(임시 ID 값 · 배열 순서와 무관)을 본다.
// 새 동작은 하나씩 꺼 보면 그 동작의 시험이 실패하도록 장면을 골랐다 (둘레 돌기 · 옆걸음 · 핑 차례 · 알림 바꾸기 문턱 · 감시 반복 ·
// 가운데 보기 · 빈 알림 포효 · 서 있기 감시 · 도주 후보 수색)
// 두뇌는 자기 스냅샷만 받는다 — 시험이 만든 스냅샷도 괴물 화면 모양 그대로(임시 ID · 역할 없음 · 부상 정보 없음)다
import { describe, expect, it } from 'vitest';
import {
  BTN,
  CAPTURE_POINTS,
  POINT_IDS,
  PRISON_RECT,
  RESCUE_POINT,
  distToRect,
  lineOfSight,
  type GameEvent,
  type InputFrame,
  type MatchInfo,
  type PointId,
  type PointState,
  type PointView,
  type Snapshot,
  type SurvivorView,
  type Vec2,
} from '@decoy/shared';
import {
  PracticeMonsterBrain,
  SimMatch,
  WATCH_SPOTS,
  buildResult,
  findPath,
  idleBrain,
  practiceBrain,
  preparePracticeMap,
  type AliasBook,
  type BotBrain,
} from '@decoy/shared/sim';
import { fieldFrom, pathDist } from '../../shared/src/sim/practiceMap';
import { chaseVisionBand, ringSpots, searchSpots } from '../../shared/src/sim/practiceMonster';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
const HZ = balance.network.serverTickHz;
/** 서 있기 감시 문턱 (practiceMonster.ts STAND_LIMIT, 초) */
const STAND_LIMIT = 2.4;

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
  /** 거점 상태 (없으면 바탕 스냅샷 그대로: 모두 idle) */
  points?: PointView[];
  imprisoned?: number;
  roarCd?: number;
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
        roarCd: f.roarCd ?? 0,
        mode: f.mode ?? 'hunt',
        camp: 0,
      },
    },
    survivors: f.survivors ?? [],
    events: f.events ?? [],
    world: {
      ...base.world,
      countdown: f.countdown ?? 0,
      monsterWait: 0,
      imprisoned: f.imprisoned ?? 0,
      points: f.points ?? base.world.points,
    },
  };
}

const pressed = (o: InputFrame, btn: number): boolean => (o.pressed & btn) !== 0;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 거점 상태: 준 것만 바꾸고 나머지는 idle 0 */
function pointsWith(over: Partial<Record<PointId, { state: PointState; progress: number }>>): PointView[] {
  return POINT_IDS.map((id) => ({ id, state: over[id]?.state ?? 'idle', progress: over[id]?.progress ?? 0 }));
}

/** 계측 필드(act)를 읽으려고 두뇌 클래스로 만든다 (practiceBrain('monster', seed)와 같은 두뇌) */
function monsterBrain(seed: number): PracticeMonsterBrain {
  preparePracticeMap();
  return new PracticeMonsterBrain(seed);
}

interface DriveTick {
  k: number;
  out: InputFrame;
  /** 이 틱 입력대로 옮긴 뒤 괴물 자리 */
  at: Vec2;
  act: string;
}

/**
 * 합성 스냅샷으로 두뇌를 돌린다: 괴물 자리는 두뇌 입력대로 옮긴다 (입력 크기 1 = 이동 속도, 벽 충돌 없이 — 두뇌가 길찾기로 간다).
 * frame(k)로 틱마다 스냅샷 내용을 바꾸고, stop이 참이면 멈춘다
 */
function drive(
  brain: PracticeMonsterBrain,
  base: Snapshot,
  info: MatchInfo,
  me: { x: number; y: number; face: number },
  from: number,
  ticks: number,
  frame: (k: number) => Omit<SynthFrame, 'tick' | 'me'> = () => ({}),
  stop: (t: DriveTick) => boolean = () => false,
): DriveTick[] {
  const log: DriveTick[] = [];
  for (let k = 0; k < ticks; k += 1) {
    const out = brain.decide(synth(base, { ...frame(k), tick: from + k, me }), info, balance, from + k);
    const sp = Math.hypot(out.mx, out.my);
    const scale = (sp > 1 ? 1 / sp : 1) * (balance.monster.moveSpeed / HZ);
    me.x += out.mx * scale;
    me.y += out.my * scale;
    me.face = out.aim;
    const t: DriveTick = { k, out, at: { x: me.x, y: me.y }, act: brain.act };
    log.push(t);
    if (stop(t)) break;
  }
  return log;
}

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

  it('거리 좁히기 돌진 주사위는 새 행동 흐름에서 뽑는다 (예전 흐름 순서를 밀지 않는다)', () => {
    const { snap: base, info } = baseSnap();
    /** 예전 흐름(this.rng)의 다음 값: 두뇌 안을 들여다본다 (시험만) */
    const peek = (b: PracticeMonsterBrain): number =>
      (b as unknown as { rng: { next(): number } }).rng.next();
    const step = 4.5 / HZ;
    for (const seed of [1, 2, 3]) {
      const brain = monsterBrain(seed);
      let dashes = 0;
      // 괴물과 표적이 같은 속도로 +x: 거리 5타일 그대로, 표적이 멀어진다 → 거리 좁히기 기회만 (가까운 창 · 공격 없음)
      for (let k = 0; k < 90; k += 1) {
        const mx = 35.5 + step * (k % 20);
        const o = brain.decide(
          synth(base, {
            tick: 100 + k,
            me: { x: mx, y: 19.5, face: 0 },
            survivors: [seen('s', mx + 5, 19.5)],
          }),
          info,
          balance,
          100 + k,
        );
        if (pressed(o, BTN.DASH)) dashes += 1;
      }
      expect(dashes, `seed ${seed}`).toBeGreaterThan(0);
      expect(peek(brain), `seed ${seed}`).toBe(peek(monsterBrain(seed)));
    }
  });

  it('추적 중 표적이 3.5타일 안이면 탐색 시야(넓게)로 바꾸고, 탐색 시야 사거리 조금 안쪽을 넘어 멀어지면 놓치기 전에 추적 시야로 (M6)', () => {
    const { snap: base, info } = baseSnap();
    const searchRange = balance.monster.visionModes.search.range;
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
    // 실제로 생기는 장면: 탐색 시야(사거리 5.0, 하드 컷)로 쫓는 표적이 사거리 가까이(4.5~4.9) 멀어진다 — 탐색 시야에서는 5.0 밖의
    // 표적이 스냅샷에 오지 않으므로, 넓은 시야를 거두는 거리가 사거리 안쪽이어야 놓치기 전에 추적 시야로 바꾼다
    expect(modePress(4.7, 'search')).toBe(true);
    expect(modePress(searchRange - 0.1, 'search')).toBe(true);
    expect(modePress(4.7, 'hunt')).toBe(false);
    expect(modePress(6.5, 'hunt')).toBe(false);
    // 사이(4.2타일)에서는 지금 모드를 그대로 둔다 (오가며 누르지 않게)
    expect(modePress(4.2, 'hunt')).toBe(false);
    expect(modePress(4.2, 'search')).toBe(false);
  });

  it('M6 문턱: 넓은 시야를 거두는 거리는 탐색 시야 사거리(balance)보다 여유 있게 안쪽이고, 넓히는 거리보다 바깥 (닿지 않는 갈래가 없게)', () => {
    const band = chaseVisionBand(balance);
    expect(band.far).toBeLessThan(balance.monster.visionModes.search.range - 0.3);
    expect(band.far).toBeGreaterThan(band.near + 0.5);
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

  /** M7 장면: B 방 북문(x 39~41, y 9)으로 북쪽(-y)으로 달아난 표적. 괴물은 B 방 안 (40.5, 14.5)에서 본다 */
  const M7_FROM = { x: 40.5, y: 14.5 };
  const M7_SPEED = 4.5;
  const M7_LAST = { x: 40.5, y: 11 - (M7_SPEED / HZ) * 11, vx: 0, vy: -M7_SPEED };

  it('도주 후보 고르기 (M7): 마지막 위치에서 길 거리 4~8 · 달아나던 쪽 · 괴물에게 안 보임 · 서로 3타일 넘게, 둘까지', () => {
    preparePracticeMap();
    const spots = searchSpots(M7_LAST, M7_FROM);
    expect(spots.length).toBe(2);
    for (const p of spots) {
      const pd = pathDist(fieldFrom(p), M7_LAST);
      expect(pd, `(${p.x}, ${p.y}) 길 거리`).toBeGreaterThanOrEqual(4);
      expect(pd).toBeLessThanOrEqual(8);
      expect(p.y - M7_LAST.y, '달아나던 쪽(북)').toBeLessThan(0);
      expect(lineOfSight(M7_FROM, p), '괴물에게 안 보인다').toBe(false);
    }
    const [a, b] = spots;
    if (a && b) expect(dist(a, b)).toBeGreaterThan(3);
    // 북문 바로 위 (39.5, 6.5) · (41.5, 6.5)는 길 거리 4 미만이라 빠진다
    expect(spots.some((p) => dist(p, { x: 39.5, y: 6.5 }) < 0.6 || dist(p, { x: 41.5, y: 6.5 }) < 0.6)).toBe(
      false,
    );
    // 멈춰 있던 표적은 괴물 반대쪽으로 본다: 같은 자리 · 속도 0 → 북쪽 후보
    const still = searchSpots({ ...M7_LAST, vx: 0, vy: 0 }, M7_FROM);
    expect(still.length).toBeGreaterThan(0);
    for (const p of still) expect(p.y).toBeLessThan(M7_LAST.y);
    // 앞쪽 후보가 모두 괴물에게 보이면 없다 (B 방 남쪽 줄에서 동쪽으로 달아남 — 방 안이 다 보인다)
    expect(searchSpots({ x: 40.65, y: 19.5, vx: 4.5, vy: 0 }, { x: 36, y: 19.5 })).toEqual([]);
  });

  it('놓친 곳을 둘러봐도 없으면 달아나던 쪽의 안 보이는 도주 후보 둘을 차례로 찾고 (놓친 곳과 다른 자리), 그래도 없으면 포효한다', () => {
    const { snap: base, info } = baseSnap();
    preparePracticeMap();
    const spots = searchSpots(M7_LAST, M7_FROM);
    // 놓친 곳 = 마지막 위치 + 속도 × 0.8초 (40.5, 5.75). 후보는 그곳에서 3타일 넘게 떨어져 놓친 곳만 가서는 닿지 않는다
    const lostSpot = { x: M7_LAST.x, y: M7_LAST.y - M7_SPEED * 0.8 };
    expect(spots.length).toBe(2);
    for (const p of spots) expect(dist(p, lostSpot)).toBeGreaterThan(3);
    for (const seed of [1, 2, 3, 4]) {
      const brain = monsterBrain(seed);
      const me = { ...M7_FROM, face: -Math.PI / 2 };
      // 표적이 북문으로 달려 나간다 (괴물 자리는 그대로)
      for (let k = 0; k < 12; k += 1)
        brain.decide(
          synth(base, {
            tick: 100 + k,
            me,
            dashCd: 5,
            attackCd: 1,
            survivors: [seen('s', 40.5, 11 - (M7_SPEED / HZ) * k)],
          }),
          info,
          balance,
          100 + k,
        );
      // 사라진 뒤: 두뇌 입력대로 움직인다
      const reached = spots.map(() => -1);
      let roarAt = -1;
      drive(
        brain,
        base,
        info,
        me,
        112,
        15 * HZ,
        () => ({ dashCd: 5, attackCd: 1 }),
        (t) => {
          spots.forEach((p, i) => {
            if (reached[i] === -1 && dist(t.at, p) <= 1.2) reached[i] = t.k;
          });
          if (pressed(t.out, BTN.ROAR)) roarAt = t.k;
          return roarAt >= 0;
        },
      );
      const [first, second] = reached;
      expect(roarAt, `seed ${seed}: 수색 뒤 포효`).toBeGreaterThan(0);
      expect(first, `seed ${seed}: 첫 후보 ${JSON.stringify(spots[0])}`).toBeGreaterThan(0);
      expect(second, `seed ${seed}: 둘째 후보 ${JSON.stringify(spots[1])}`).toBeGreaterThan(first ?? 0);
      expect(roarAt, `seed ${seed}: 후보를 다 본 뒤 포효`).toBeGreaterThan(second ?? 0);
    }
  });
});

describe('실전 괴물 봇: 알림 · 핑 · 거점 · 감시 행동 하나씩 (합성 스냅샷, 두뇌 입력대로 움직인다)', () => {
  const A = CAPTURE_POINTS.A;
  const R = balance.capturePoint.radius;
  const alertA: GameEvent = { k: 'text', id: 'ALERT_CAPTURE_START', point: 'A' };
  const alertB: GameEvent = { k: 'text', id: 'ALERT_CAPTURE_START', point: 'B' };

  it('알림 거점으로 가는 중 다른 거점 알림: 진행이 비슷하고 길이 조금만 짧으면 가던 곳, 진행이 0.1 넘게 많거나 길이 6타일 넘게 짧으면 바꾼다 (M4)', () => {
    const { snap: base, info } = baseSnap();
    preparePracticeMap();
    const fA = fieldFrom(A);
    const fB = fieldFrom(CAPTURE_POINTS.B);
    /** A 알림 → 3틱 뒤 B 알림 → 1.5초 걸은 뒤 A · B까지 길 거리가 줄어든 만큼 */
    const run = (seed: number, from: Vec2, progA: number, progB: number): { toA: number; toB: number } => {
      const brain = monsterBrain(seed);
      const me = { ...from, face: 0 };
      const dA = pathDist(fA, me);
      const dB = pathDist(fB, me);
      drive(brain, base, info, me, 100, Math.round(1.5 * HZ), (k) => ({
        events: k === 0 ? [alertA] : k === 3 ? [alertB] : [],
        points: pointsWith({
          A: { state: 'capturing', progress: progA },
          B: { state: k >= 3 ? 'capturing' : 'idle', progress: k >= 3 ? progB : 0 },
        }),
      }));
      return { toA: dA - pathDist(fA, me), toB: dB - pathDist(fB, me) };
    };
    // 가운데 위쪽 (25.5, 12.5): A까지 18.7 · B까지 16.7 (B가 2타일 가깝다), 두 길은 처음부터 반대쪽(서 · 동)
    const mid = { x: 25.5, y: 12.5 };
    expect(pathDist(fA, mid) - pathDist(fB, mid)).toBeGreaterThan(1);
    expect(pathDist(fA, mid) - pathDist(fB, mid)).toBeLessThan(6);
    // B 쪽으로 더 가서 (29.5, 12.5): B가 10타일 가깝다 (A 쪽으로 3틱 걸은 뒤에도 6타일 넘게)
    const east = { x: 29.5, y: 12.5 };
    expect(pathDist(fA, east) - pathDist(fB, east)).toBeGreaterThan(8);
    for (const seed of [1, 2, 3]) {
      const keep = run(seed, mid, 0.3, 0.35);
      expect(keep.toA, `seed ${seed}: 진행 비슷 · 길 조금 짧음 → A로`).toBeGreaterThan(4);
      const prog = run(seed, mid, 0.3, 0.45);
      expect(prog.toB, `seed ${seed}: B 진행이 많다 → B로`).toBeGreaterThan(4);
      const near = run(seed, east, 0.3, 0.3);
      expect(near.toB, `seed ${seed}: B가 훨씬 가깝다 → B로`).toBeGreaterThan(4);
    }
  });

  it('둘 이상 갇혀 있으면 할 일이 없을 때 감시 한 번에 감옥 감시 자리 셋을 모두 오간다 (그동안 거점 · 순찰로 떠나지 않는다)', () => {
    // 감시를 마친 뒤 다음 감시는 감시 간격 뒤다 (통합 조정 d — tests/bots/tune-td.test.ts). 여기서는 감시 한 번만 본다
    const { snap: base, info } = baseSnap();
    for (const seed of [1, 2, 3]) {
      const brain = monsterBrain(seed);
      const me = { x: 24, y: 26.5, face: 0 };
      const seenSpots = new Set<number>();
      let arrived = false;
      let farthest = 0;
      drive(
        brain,
        base,
        info,
        me,
        100,
        25 * HZ,
        () => ({ imprisoned: 2 }),
        (t) => {
          if (t.act !== 'go:watch' && t.act !== 'look:watch') return true;
          WATCH_SPOTS.forEach((w, i) => {
            if (dist(t.at, w) <= 0.6) {
              seenSpots.add(i);
              arrived = true;
            }
          });
          if (arrived) farthest = Math.max(farthest, dist(t.at, RESCUE_POINT));
          return false;
        },
      );
      expect(seenSpots.size, `seed ${seed}: 감시 자리 셋을 모두`).toBe(WATCH_SPOTS.length);
      expect(farthest, `seed ${seed}: 감옥 둘레를 떠나지 않는다`).toBeLessThan(9);
    }
  });

  it('점령 중 배지가 켜져 있는데 가장자리에서 아무도 안 보이면 거점 가운데(반경 안)로 들어가 본다 (M5)', () => {
    const { snap: base, info } = baseSnap();
    for (const seed of [1, 2, 3]) {
      const brain = monsterBrain(seed);
      const me = { x: 14.5, y: 16.5, face: Math.PI };
      const log = drive(brain, base, info, me, 100, 8 * HZ, () => ({
        points: pointsWith({ A: { state: 'capturing', progress: 0.4 } }),
      }));
      const inside = log.findIndex((t) => dist(t.at, A) <= R);
      expect(inside, `seed ${seed}: 8초 안에 반경 안`).toBeGreaterThan(0);
    }
  });

  it('포효 핑이 여럿이면 가까운 것부터 차례로 들른다 (배열 순서와 무관, M3)', () => {
    const { snap: base, info } = baseSnap();
    const near = { x: 38.5, y: 21.5 };
    const far = { x: 44.5, y: 21.5 };
    for (const seed of [1, 2, 3]) {
      for (const pts of [
        [far, near],
        [near, far],
      ]) {
        const brain = monsterBrain(seed);
        const me = { x: 36, y: 19.5, face: 0 };
        let nearAt = -1;
        let farAt = -1;
        drive(
          brain,
          base,
          info,
          me,
          100,
          12 * HZ,
          (k) => ({ events: k === 0 ? [{ k: 'roarPings', pts }] : [] }),
          (t) => {
            if (nearAt < 0 && dist(t.at, near) <= 1.0) nearAt = t.k;
            if (farAt < 0 && dist(t.at, far) <= 1.0) farAt = t.k;
            return nearAt >= 0 && farAt >= 0;
          },
        );
        expect(nearAt, `seed ${seed}: 가까운 핑`).toBeGreaterThan(0);
        expect(farAt, `seed ${seed}: 그다음 먼 핑`).toBeGreaterThan(nearAt);
      }
    }
  });

  it('알림으로 온 거점을 훑었는데 아무도 없으면 곧 포효한다 (오래 못 봤을 때보다 훨씬 일찍, M3)', () => {
    const { snap: base, info } = baseSnap();
    for (const seed of [1, 2, 3, 4]) {
      const brain = monsterBrain(seed);
      const me = { x: 14.5, y: 16.5, face: Math.PI };
      let roar: DriveTick | null = null;
      drive(
        brain,
        base,
        info,
        me,
        100,
        6 * HZ,
        (k) => ({ events: k === 0 ? [alertA] : [] }),
        (t) => {
          if (pressed(t.out, BTN.ROAR)) roar = t;
          return roar !== null;
        },
      );
      const r = roar as DriveTick | null;
      expect(r, `seed ${seed}: 6초 안에 포효 (아무도 못 본 시간 포효는 14초부터)`).not.toBeNull();
      if (r) expect(dist(r.at, A), `seed ${seed}: A 가장자리에서`).toBeLessThan(R + 1.5);
    }
  });

  it('거점을 훑은 뒤 둘레 자리를 차례로 돌며 거점 쪽을 본다 (M5)', () => {
    const { snap: base, info } = baseSnap();
    preparePracticeMap();
    const ring = ringSpots('A', balance);
    for (const seed of [1, 2, 3, 4]) {
      const brain = monsterBrain(seed);
      const me = { x: 14.5, y: 16.5, face: Math.PI };
      const order: number[] = [];
      drive(
        brain,
        base,
        info,
        me,
        100,
        12 * HZ,
        (k) => ({ events: k === 0 ? [alertA] : [] }),
        (t) => {
          if (t.act !== 'look:ring') return false;
          const i = ring.findIndex((p) => dist(p, t.at) <= 1.1);
          if (i >= 0 && order[order.length - 1] !== i) order.push(i);
          return false;
        },
      );
      expect(new Set(order).size, `seed ${seed}: 둘레 자리 ${JSON.stringify(order)}`).toBeGreaterThanOrEqual(
        3,
      );
      // 한 방향으로 돈다: 이웃 자리(방향 순 번호 차 1)로 이어 간다
      for (let j = 1; j < order.length; j += 1) {
        const step = Math.abs((order[j] ?? 0) - (order[j - 1] ?? 0));
        expect(Math.min(step, ring.length - step), `seed ${seed}: ${JSON.stringify(order)}`).toBe(1);
      }
    }
  });

  it('거점 가장자리 · 둘레에서 둘러보는 동안 얼어붙지 않고 거점을 보며 옆걸음한다 (M5)', () => {
    const { snap: base, info } = baseSnap();
    for (const seed of [1, 2, 3, 4]) {
      const brain = monsterBrain(seed);
      const me = { x: 14.5, y: 16.5, face: Math.PI };
      let looks = 0;
      let side = 0;
      drive(
        brain,
        base,
        info,
        me,
        100,
        10 * HZ,
        (k) => ({ events: k === 0 ? [alertA] : [] }),
        (t) => {
          if (t.act !== 'look:point' && t.act !== 'look:ring') return false;
          looks += 1;
          const sp = Math.hypot(t.out.mx, t.out.my);
          const before = {
            x: t.at.x - (t.out.mx * balance.monster.moveSpeed) / HZ,
            y: t.at.y - (t.out.my * balance.monster.moveSpeed) / HZ,
          };
          const rx = before.x - A.x;
          const ry = before.y - A.y;
          const cos = sp > 0 ? (t.out.mx * rx + t.out.my * ry) / (sp * Math.hypot(rx, ry)) : 1;
          if (sp > 0.2 && sp < 0.4 && Math.abs(cos) < 0.15) side += 1;
          return false;
        },
      );
      expect(looks, `seed ${seed}: 둘러보기 틱`).toBeGreaterThan(20);
      expect(side / looks, `seed ${seed}: 옆걸음 비율 (${side}/${looks})`).toBeGreaterThan(0.4);
    }
  });

  it('서 있기 감시: 같은 자리 목표가 거듭 와서 둘러보기가 이어져도 한자리에 STAND_LIMIT(2.4초) 넘게 서 있지 않는다 (M5)', () => {
    const { snap: base, info } = baseSnap();
    const rescued: GameEvent = { k: 'text', id: 'ALERT_RESCUED' };
    for (const seed of [1, 2, 3]) {
      const brain = monsterBrain(seed);
      // 구조 알림이 오면 가는 자리 (구조 지점 남쪽 2타일)에 이미 서 있다. 1.5초마다 구조 알림
      const me = { x: RESCUE_POINT.x, y: RESCUE_POINT.y + 2, face: -Math.PI / 2 };
      let run = 0;
      let longest = 0;
      let moves = 0;
      let prev = { x: me.x, y: me.y };
      drive(
        brain,
        base,
        info,
        me,
        100,
        15 * HZ,
        (k) => ({ events: k % 45 === 0 ? [rescued] : [] }),
        (t) => {
          if (dist(t.at, prev) < 1e-3) run += 1;
          else {
            run = 0;
            moves += 1;
          }
          prev = t.at;
          longest = Math.max(longest, run / HZ);
          return false;
        },
      );
      expect(longest, `seed ${seed}`).toBeLessThanOrEqual(STAND_LIMIT + 0.2);
      expect(moves, `seed ${seed}: 다시 움직인다`).toBeGreaterThan(2 * HZ);
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

  /**
   * 한자리에 서 있어도 되는 가장 긴 시간: 서 있기 감시(STAND_LIMIT 2.4초) + 0.1초. 보통 판에서는 둘러보기가 모두 2초 이하라
   * 서 있기 감시 · 옆걸음을 꺼도 2.1초를 넘지 않는다 — 그 둘은 아래 '같은 자리 목표가 거듭 오는 판'과 행동별 시험이 지킨다
   */
  const STAND_MAX = STAND_LIMIT + 0.1;

  it('봇끼리 판: 추적 · 시작 대기 · 기절이 아니면 한자리에 2.5초 넘게 서지 않는다', () => {
    preparePracticeMap();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const setup = SimMatch.roles();
      const brains = new Map<string, BotBrain>(setup.map((p) => [p.id, practiceBrain(p.role, seed)]));
      const sim = new SimMatch(setup, balance, brains, seed);
      const { longest } = longestStand(sim, balance.match.timeLimit);
      expect(longest, `seed ${seed}`).toBeLessThanOrEqual(STAND_MAX);
    }
  });

  it('같은 자리 목표가 거듭 오는 판 (실제 판, 구조 알림 1.5초마다): 둘러보기가 이어져도 2.5초 넘게 서지 않는다', () => {
    preparePracticeMap();
    for (const seed of [1, 2, 3]) {
      const setup = SimMatch.roles();
      const sim = new SimMatch(
        setup,
        balance,
        new Map(setup.map((p) => [p.id, p.role === 'monster' ? practiceBrain('monster', seed) : idleBrain])),
        seed,
      );
      sim.game.monster.move.frozen = 0;
      place(sim.game, 'p1', RESCUE_POINT.x, RESCUE_POINT.y + 2, -Math.PI / 2);
      place(sim.game, 'p2', 0.5, 0.5);
      place(sim.game, 'p3', 47.5, 0.5);
      place(sim.game, 'p4', 0.5, 31.5);
      const g = sim.game;
      const brainStep = sim.step.bind(sim);
      let n = 0;
      sim.step = (): void => {
        if (n % 45 === 0) g.emitTo(g.monster, { k: 'text', id: 'ALERT_RESCUED' });
        n += 1;
        brainStep();
      };
      const { longest } = longestStand(sim, 20);
      expect(longest, `seed ${seed}`).toBeLessThanOrEqual(STAND_MAX);
    }
  });

  it('생존자가 숨어 안 나오는 판: 2.5초 넘게 서지 않고, 2분 30초 안에 세 거점을 모두 들른다', () => {
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
      expect(longest, `seed ${seed}`).toBeLessThanOrEqual(STAND_MAX);
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
   * 실제 자리로 정해(두뇌에는 안 간다) 두 판이 서로 반대 순서를 받게 한다.
   * 동점은 시험이 만든다 (판 흐름의 우연에 기대지 않게): 괴물에게 자유 생존자가 둘 이상 보이기 시작하면 그들에게 새 임시 ID를 주고
   * MERGE_SNAPS 스냅샷 동안 실제 번호(p2 < p3 < p4)가 가장 앞선 생존자 자리에 함께 둔다 — 두뇌에는 같은 때 처음 보인 · 같은 자리 ·
   * 같은 속도의 생존자 여럿으로 보인다 (b 최종 시드 36에서 구조로 함께 풀려난 둘이 (24.594, 18.493)에 겹친 것과 같은 꼴).
   * 두 판에 같은 변환을 하므로(실제 자리로 정한다) 다른 것은 배열 순서 · 임시 ID 값뿐이다. b 최종 두뇌로는 이 시험이 실패한다
   */
  it('같은 시드는 임시 ID 값 · 배열 순서가 달라도 같은 판 (괴물에게 보이는 생존자 둘 이상을 같은 자리에 겹쳐도)', () => {
    preparePracticeMap();
    const MERGE_SNAPS = 12;
    const MERGE_GAP = 10 * HZ;
    const MERGES = 3;
    const tiesBySeed: number[] = [];
    for (const seed of [36, 1, 2]) {
      const tiesOf: number[] = [];
      const play = (prefix: string, desc: boolean): string => {
        const setup = SimMatch.roles();
        let ties = 0;
        const holder: { sim: SimMatch | null } = { sim: null };
        const inner = practiceBrain('monster', seed);
        const fresh = new Map<string, string>();
        const seq = new Map<string, number>();
        let merge: { left: number; anchor: string; members: ReadonlySet<string> } | null = null;
        let merges = 0;
        let mergeEnd = -MERGE_GAP;
        let memo: { tick: number; list: SurvivorView[] } | null = null;
        const rename = (alias: string, real: string): string => {
          const k = (seq.get(real) ?? 0) + 1;
          seq.set(real, k);
          const id = `${prefix}-${real}-${k}`;
          fresh.set(alias, id);
          return id;
        };
        const transform = (snap: Snapshot): SurvivorView[] => {
          // 시험만 아는 실제 자리 (두뇌에는 새 임시 ID만 간다)
          const book = (holder.sim as unknown as { aliases: AliasBook } | null)?.aliases;
          const realOf = (alias: string): string =>
            ['p2', 'p3', 'p4'].find((id) => book?.get(id) === alias) ?? 'p?';
          const rows = snap.survivors.map((s) => ({ s, real: realOf(s.id) }));
          const free = rows.filter((r) => r.s.status === 'free');
          if (!merge && merges < MERGES && free.length >= 2 && snap.tick - mergeEnd >= MERGE_GAP) {
            merges += 1;
            const members = new Set(free.map((r) => r.real));
            const anchor = [...members].sort()[0] ?? 'p2';
            for (const r of free) rename(r.s.id, r.real);
            merge = { left: MERGE_SNAPS, anchor, members };
          }
          const cur = merge;
          const at = cur ? free.find((r) => r.real === cur.anchor)?.s : undefined;
          const list = rows.map(({ s, real }) => {
            const id = fresh.get(s.id) ?? rename(s.id, real);
            return at && cur?.members.has(real) && s.status === 'free'
              ? { ...s, id, x: at.x, y: at.y, face: at.face }
              : { ...s, id };
          });
          if (cur) {
            cur.left -= 1;
            if (!at || cur.left <= 0) {
              merge = null;
              mergeEnd = snap.tick;
            }
          }
          const shown = list.filter((v) => v.status === 'free');
          for (let i = 0; i < shown.length; i += 1)
            for (let j = i + 1; j < shown.length; j += 1)
              if (shown[i]?.x === shown[j]?.x && shown[i]?.y === shown[j]?.y) ties += 1;
          list.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) * (desc ? -1 : 1));
          return list;
        };
        const wrapped: BotBrain = {
          decide: (snap, info, b, n) => {
            // 스냅샷(20Hz)이 같으면 틱(30Hz)마다 같은 변환
            if (!memo || memo.tick !== snap.tick) memo = { tick: snap.tick, list: transform(snap) };
            return inner.decide({ ...snap, survivors: memo.list }, info, b, n);
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
        tiesOf.push(ties);
        return JSON.stringify({
          tick: g.tick,
          end: g.end,
          result: buildResult(g),
          pos: [...g.players.values()].map((p) => [Math.round(p.move.x * 1000), Math.round(p.move.y * 1000)]),
        });
      };
      expect(play('k', true), `seed ${seed}`).toBe(play('q', false));
      tiesBySeed.push(tiesOf[0] ?? 0);
    }
    // 검사가 헛돌지 않게: 같은 자리에 겹친 생존자를 괴물이 실제로 봤다 (시드마다)
    for (const t of tiesBySeed) expect(t, `겹친 스냅샷 수 ${JSON.stringify(tiesBySeed)}`).toBeGreaterThan(0);
  });
});
