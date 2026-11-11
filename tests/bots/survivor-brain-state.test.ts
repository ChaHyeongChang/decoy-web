// 실전 생존자 봇 두뇌 (플레이테스트 반영 c 검토 반영): 두뇌가 기억하는 상태가 끝날 때를 지킨다
//  - 두뇌 시계는 판이 흐른 시간만 센다: 판 정지(괴물 재접속 대기) 동안 두뇌를 부르지 않아 스냅샷 틱이 건너뛰어도
//    탐지 대기 · 지켜짐 기억 · 기다림 차례가 정지가 없을 때와 같다
//  - 질주 · 밀치기 반응 대기는 갇히면 처음부터 (풀려난 첫 틱에 반응 시간 없이 누르지 않는다)
//  - 미끼 차례는 연습 방(봇 여부를 아는 방)의 사람 동료를 건너뛴다. 빠른 매칭은 남의 봇 여부를 모르니 순서 그대로
//  - 미끼가 들어가 보기는 한 번에 한 번 다가가기: 다음 라운드가 다시 걸지 않고(5초 뒤 끝), 달아나기 시작하면 끝난다 —
//    괴물이 지켜 서 있기만 해도 도주 반경 경계에서 들어가 보기 ↔ 도주를 끝없이 되풀이하던 것
//  - 돌아가는 길 기억(거쳐 갈 곳 · 이미 돌아감)은 그 접근 동안만: 오래전 · 다른 자리에서 만든 결정을 다시 쓰지 않는다
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BTN,
  CAPTURE_POINTS,
  RESCUE_POINT,
  emptyInput,
  type Balance,
  type InputFrame,
  type MatchInfo,
  type RoleId,
  type Snapshot,
  type Vec2,
} from '@decoy/shared';
import {
  FLEE_SPOTS,
  PracticeSurvivorBrain,
  SimMatch,
  idleBrain,
  preparePracticeMap,
  survivorPlan,
  type BotBrain,
} from '@decoy/shared/sim';
import { decoyOrder } from '../../shared/src/sim/practiceSurvivor';
import { loadTestBalance, place } from '../helpers/fixtures';

const balance = loadTestBalance();
const HZ = balance.network.serverTickHz;
const ROLES: readonly RoleId[] = ['runner', 'guard', 'scout'];
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

/** 한 역할의 스냅샷 · MatchInfo (괴물이 나(30.5, 24.5)에서 동쪽 gap 타일, 다른 생존자는 멀리) */
function closeUp(role: RoleId, gap: number): { snap: Snapshot; info: MatchInfo } {
  const sim = scene(1);
  const g = sim.game;
  for (const r of ROLES)
    if (r !== role) place(g, SEAT[r], r === 'guard' ? 5.5 : 4.5, r === 'scout' ? 28.5 : 4.5);
  place(g, SEAT[role], 30.5, 24.5);
  place(g, 'p1', 30.5 + gap, 24.5, Math.PI);
  for (const s of g.survivors) s.abilityCd = 30;
  refreshSnapshots(sim);
  const snap = sim.lastSnap.get(SEAT[role]);
  const info = sim.infos.get(SEAT[role]);
  if (!snap || !info || !snap.monster) throw new Error('장면 스냅샷 없음');
  return { snap, info };
}

/** 같은 스냅샷을 틱만 올려 보낸다 (monster를 바꿔 끼울 수 있다) */
function at(snap: Snapshot, tick: number, monster: Snapshot['monster']): Snapshot {
  return { ...snap, tick, monster, events: [] };
}

/** 입력 · 두뇌 상태를 한 줄로 (두 두뇌의 결정이 같은지 견주기) */
function trace(out: InputFrame, brain: PracticeSurvivorBrain): string {
  const d = brain.debugState();
  const r = (v: number): string => v.toFixed(3);
  const st = d
    ? `${d.kind}${d.probe ? '+probe' : ''}${d.fleeing ? '+flee' : ''} → (${r(d.target.x)}, ${r(d.target.y)})`
    : '-';
  return `${r(out.mx)},${r(out.my)} p${out.pressed} h${out.held} ${st}`;
}

// ───────────────────────── 판 정지 ─────────────────────────

describe('생존자 봇: 판 정지(괴물 재접속 대기)로 틱이 건너뛰어도 두뇌 시계는 판 시간으로 센다', () => {
  /**
   * 스카우트가 계획 첫 거점 안에서 점령 중, 괴물은 안 보인다. pause가 있으면 그 틱 구간 동안 두뇌를 부르지 않는다
   * (BotDriver · 서버 봇이 정지 중에 하는 대로 — 스냅샷 틱은 정지 중에도 오른다). 첫 탐지의 판 시각(틱, 정지 구간 뺌)
   */
  function firstTrack(pause: { from: number; len: number } | null): number {
    const sim = scene(1);
    const a = CAPTURE_POINTS[survivorPlan(7, 'scout')[0] ?? 'A'];
    place(sim.game, 'p4', a.x, a.y);
    place(sim.game, 'p1', 45, 28);
    refreshSnapshots(sim);
    const snap = sim.lastSnap.get('p4');
    const info = sim.infos.get('p4');
    if (!snap || !info) throw new Error('스냅샷 없음');
    const brain = new PracticeSurvivorBrain('scout', 7);
    let paused = 0;
    for (let tick = 0; tick < 60 * HZ; tick += 1) {
      if (pause && tick >= pause.from && tick < pause.from + pause.len) {
        paused += 1;
        continue;
      }
      const s: Snapshot = {
        ...snap,
        tick,
        monster: null,
        marks: [],
        events: [],
        you: { ...snap.you, surv: snap.you.surv ? { ...snap.you.surv, abilityCd: 0 } : null },
      };
      const out = brain.decide(s, info, balance, tick + 1);
      if ((out.pressed & BTN.ABILITY) !== 0) return tick - paused;
    }
    return -1;
  }

  it('정지 20초가 끼어도 스카우트 첫 탐지는 판 시간으로 같은 때 (재개 첫 틱에 바로 쓰지 않는다)', () => {
    const plain = firstTrack(null);
    expect(plain).toBeGreaterThan(10 * HZ);
    expect(firstTrack({ from: 10 * HZ, len: 20 * HZ })).toBe(plain);
    expect(firstTrack({ from: 3 * HZ, len: 30 * HZ })).toBe(plain);
  });

  it('정지 앞뒤로 지켜짐 기억 · 기다리기 · 들어가 보기 결정이 정지가 없을 때와 판 시간으로 같다', () => {
    // 동료 둘은 갇혔고(할 일이 구조뿐), 괴물은 구조 지점 남쪽 2타일에서 보였다가 안 보인다 → 지켜짐 기억(8초) 동안 기다린다
    for (const role of ROLES) {
      const { snap, info } = closeUp(role, 1.0);
      const base = snap.monster;
      if (!base) throw new Error('괴물 없음');
      const survivors = snap.survivors.map((v, i) => ({
        ...v,
        status: 'imprisoned' as const,
        x: 23.5 + i,
        y: 15.5,
      }));
      const run = (pauseLen: number): string[] => {
        const brain = new PracticeSurvivorBrain(role, 9);
        const lines: string[] = [];
        let tick = 100;
        for (let k = 0; k < 14 * HZ; k += 1) {
          // 1초째에서 정지 (정지 중 두뇌를 부르지 않는다)
          if (k === HZ) tick += pauseLen;
          const seen = k < 2;
          const s: Snapshot = {
            ...at(snap, tick, seen ? { ...base, x: RESCUE_POINT.x, y: RESCUE_POINT.y + 2, windup: 0 } : null),
            survivors,
            you: { ...snap.you, surv: snap.you.surv ? { ...snap.you.surv, spotted: false } : null },
          };
          const out = brain.decide(s, info, balance, k + 1);
          lines.push(`${(k / HZ).toFixed(2)}초 ${trace(out, brain)}`);
          tick += 1;
        }
        return lines;
      };
      const plain = run(0);
      // 검사가 헛돌지 않게: 정지가 없으면 기억이 남은 동안 기다리고(wait), 기억이 끝난 뒤에는 구조하러 간다
      expect(
        plain.some((l) => l.includes(' wait')),
        role,
      ).toBe(true);
      expect(
        plain.some((l) => l.includes(' rescue')),
        role,
      ).toBe(true);
      expect(run(20 * HZ), role).toEqual(plain);
    }
  });
});

// ───────────────────────── 질주 · 밀치기 반응 대기 ─────────────────────────

describe('생존자 봇: 질주 · 밀치기 반응 대기는 갇히면 처음부터', () => {
  it('조건이 참인 채로 갇혔다 풀려나도(감옥 앞 괴물) 풀려난 뒤 0.2초 넘게 기다려 누른다', () => {
    const cases: [RoleId, number][] = [
      ['guard', 1.4],
      ['runner', 2.5],
    ];
    for (const [role, gap] of cases) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const { snap, info } = closeUp(role, gap);
        const base = snap.monster;
        if (!base) throw new Error('괴물 없음');
        const brain = new PracticeSurvivorBrain(role, seed);
        const view = (tick: number, status: 'free' | 'imprisoned'): Snapshot => ({
          ...at(snap, tick, { ...base, windup: 0 }),
          you: { ...snap.you, surv: snap.you.surv ? { ...snap.you.surv, abilityCd: 0, status } : null },
        });
        // 조건이 참이 된 뒤 누르기 전(2틱)에 갇힌다 → 10초 갇힘 → 풀려남 (괴물은 그대로 사거리 안)
        for (let k = 0; k < 2; k += 1) {
          const out = brain.decide(view(100 + k, 'free'), info, balance, 1 + k);
          expect(out.pressed & BTN.ABILITY, `${role} seed ${seed} 갇히기 전`).toBe(0);
        }
        for (let k = 0; k < 10 * HZ; k += 1) brain.decide(view(102 + k, 'imprisoned'), info, balance, 3 + k);
        let press = -1;
        for (let k = 0; k < HZ && press < 0; k += 1) {
          const out = brain.decide(view(102 + 10 * HZ + k, 'free'), info, balance, 1000 + k);
          if ((out.pressed & BTN.ABILITY) !== 0) press = k;
        }
        expect(press, `${role} seed ${seed}`).toBeGreaterThanOrEqual(Math.round(0.2 * HZ));
      }
    }
  });
});

// ───────────────────────── 미끼 차례 ─────────────────────────

describe('생존자 봇: 미끼 차례는 연습 방의 사람 동료를 건너뛴다', () => {
  /**
   * 미끼 순서 첫째가 러너인 판: 러너는 자유(멀리), 나는 미끼 순서 둘째, 셋째는 갇힘. 거점은 모두 끝나 할 일은 구조뿐이고,
   * 괴물은 구조 지점 바로 남쪽에 계속 보인다(지켜짐). 러너를 사람으로 볼지는 roster 의 bot 값. 첫 들어가 보기 시각(초)
   */
  function firstProbe(runnerBot: boolean, othersKnown: boolean): number {
    let seed = 1;
    while ((decoyOrder(seed)[0] ?? '') !== 'runner') seed += 1;
    const role = decoyOrder(seed)[1] ?? 'scout';
    const { snap, info } = closeUp(role, 1.0);
    const base = snap.monster;
    if (!base) throw new Error('괴물 없음');
    // 연습 방: 봇 여부가 정확하다. 빠른 매칭: 내 자리 말고는 모두 bot false 로 온다 (room.ts matchInfo)
    const roster = info.roster.map((r) => {
      if (r.id === info.you) return r;
      if (!othersKnown) return { ...r, bot: false };
      return r.id === SEAT.runner ? { ...r, bot: runnerBot } : r;
    });
    const brain = new PracticeSurvivorBrain(role, seed);
    for (let k = 0; k < 20 * HZ; k += 1) {
      const s: Snapshot = {
        ...at(snap, 100 + k, { ...base, x: RESCUE_POINT.x, y: RESCUE_POINT.y + 1, windup: 0 }),
        survivors: snap.survivors.map((v) =>
          v.role === 'runner'
            ? { ...v, x: 4.5, y: 4.5 }
            : { ...v, status: 'imprisoned' as const, x: 23.5, y: 15.5 },
        ),
        world: { ...snap.world, points: snap.world.points.map((p) => ({ ...p, state: 'done' as const })) },
        you: { ...snap.you, surv: snap.you.surv ? { ...snap.you.surv, spotted: false } : null },
      };
      brain.decide(s, { ...info, roster }, balance, k + 1);
      if (brain.debugState()?.probe) return k / HZ;
    }
    return -1;
  }

  it('연습 방에서 미끼 순서 첫째가 사람이면 다음 봇이 첫 기다림 한도(3~4초) 뒤 들어가 본다', () => {
    const t = firstProbe(false, true);
    expect(t).toBeGreaterThanOrEqual(3 - 1e-9);
    expect(t).toBeLessThanOrEqual(4 + 1 / HZ);
  });

  it('미끼 순서 첫째가 봇이면 그 봇 차례라 나는 기다린다 · 빠른 매칭(남의 봇 여부를 모름)은 순서 그대로', () => {
    // 3라운드(기다림 한도 셋, 9초 이상)부터는 모두 들어가 본다
    expect(firstProbe(true, true)).toBeGreaterThanOrEqual(9 - 1e-9);
    expect(firstProbe(false, false)).toBeGreaterThanOrEqual(9 - 1e-9);
  });
});

// ───────────────────────── 들어가 보기 ─────────────────────────

/** 한자리에 서서 look 쪽을 보기만 한다 (치지 않는다 — 사람 괴물이 감옥 · 거점 앞에서 지키고 서 있는 경우) */
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

describe('생존자 봇: 미끼가 들어가 보기는 한 번에 한 번 다가가기 (괴물이 서 있기만 해도 떨지 않는다)', () => {
  it('동료 둘이 갇히고 괴물이 구조 지점 남쪽 3.5타일에 서서 보기만 한다: 들어가 보기 ↔ 도주를 되풀이하지 않고 기다리는 자리로 돌아온다', () => {
    const spot = { x: RESCUE_POINT.x, y: RESCUE_POINT.y + 3.5 };
    for (const seed of [1, 2, 3, 4, 5]) {
      const runner = new PracticeSurvivorBrain('runner', seed);
      const sim = scene(seed, { p1: new WatchMonster(spot, RESCUE_POINT), p2: runner });
      const g = sim.game;
      place(g, 'p1', spot.x, spot.y);
      place(g, 'p2', 9.5, 25.5);
      for (const [i, id] of ['p3', 'p4'].entries()) {
        const s = g.survivorById(id);
        if (!s) throw new Error('자리 없음');
        s.status = 'imprisoned';
        s.move.x = 23.5 + i;
        s.move.y = 15.5;
      }
      const seq: string[] = [];
      for (let t = 0; t < 30 * HZ && !g.end; t += 1) {
        sim.step();
        const now = tag(runner);
        if (seq[seq.length - 1]?.split('@')[0] !== now) seq.push(`${now}@${(t / HZ).toFixed(1)}`);
      }
      const kinds = seq.map((e) => e.split('@')[0]);
      let flees = 0;
      let fleeToProbe = 0;
      for (let i = 1; i < kinds.length; i += 1) {
        if (kinds[i] === 'flee') flees += 1;
        if (kinds[i - 1] === 'flee' && kinds[i] === 'probe') fleeToProbe += 1;
      }
      const msg = `seed ${seed}: ${seq.join(' ')}`;
      // 들어가 보기는 있다 (혼자라 미끼 차례)
      expect(kinds.includes('probe'), msg).toBe(true);
      // 달아난 뒤 곧바로 다시 들어가지 않는다 (기다리는 자리로 돌아와 다음 기다림 한도를 기다린다)
      expect(fleeToProbe, msg).toBe(0);
      // 달아나기는 들어가 볼 때(기다림 한도 3~4초마다 한 번)만 — 30초에 8번 넘지 않는다. 옛 코드는 0.3~0.4초마다
      // 들어가 보기 ↔ 도주, 들어가 보기만 고치면 도주 반경 안에 고른 기다리는 자리에서 기다리기 ↔ 도주였다
      expect(flees, msg).toBeLessThanOrEqual(8);
    }
  });

  it('괴물이 계속 보이는 지켜진 구조 지점: 들어가 보기는 PROBE_TIME(5초) 뒤 끝나 기다리기로 돌아온다 (다음 라운드가 다시 걸지 않는다)', () => {
    const { snap, info } = closeUp('runner', 1.0);
    const base = snap.monster;
    if (!base) throw new Error('괴물 없음');
    const survivors = snap.survivors.map((v, i) => ({
      ...v,
      status: 'imprisoned' as const,
      x: 23.5 + i,
      y: 15.5,
    }));
    for (const seed of [1, 2, 3, 9]) {
      const brain = new PracticeSurvivorBrain('runner', seed);
      const spans: { from: number; to: number }[] = [];
      for (let k = 0; k < 30 * HZ; k += 1) {
        const s: Snapshot = {
          ...at(snap, 100 + k, { ...base, x: RESCUE_POINT.x, y: RESCUE_POINT.y + 1, windup: 0 }),
          survivors,
          you: { ...snap.you, surv: snap.you.surv ? { ...snap.you.surv, spotted: false } : null },
        };
        brain.decide(s, info, balance, k + 1);
        const probe = brain.debugState()?.probe === true;
        const last = spans[spans.length - 1];
        if (probe && (!last || last.to >= 0)) spans.push({ from: k, to: -1 });
        else if (!probe && last && last.to < 0) last.to = k;
      }
      const msg = `seed ${seed}: ${spans.map((p) => `${(p.from / HZ).toFixed(2)}~${(p.to / HZ).toFixed(2)}`).join(' ')}`;
      expect(spans.length, msg).toBeGreaterThanOrEqual(2);
      for (const p of spans.slice(0, -1)) {
        expect(p.to - p.from, msg).toBe(Math.round(5 * HZ));
      }
    }
  });
});

// ───────────────────────── 돌아가는 길 기억 ─────────────────────────

describe('생존자 봇: 돌아가는 길 기억(거쳐 갈 곳 · 이미 돌아감)은 그 접근 동안만', () => {
  /** 스카우트 장면: 러너는 갇혔고(스카우트가 구조 담당) 가드는 멀리 자유. 괴물이 나를 보고 있지는 않다 */
  function viaScene(): (tick: number, monster: Snapshot['monster'], p: Vec2) => Snapshot {
    const { snap } = closeUp('scout', 1.0);
    const survivors = snap.survivors.map((v) =>
      v.role === 'runner' ? { ...v, status: 'imprisoned' as const, x: 23.5, y: 15.5 } : v,
    );
    return (tick, monster, p) => ({
      ...at(snap, tick, monster),
      survivors,
      you: {
        ...snap.you,
        move: { ...snap.you.move, x: p.x, y: p.y },
        surv: snap.you.surv ? { ...snap.you.surv, spotted: false } : null,
      },
    });
  }
  const scoutInfo = (): MatchInfo => closeUp('scout', 1.0).info;
  const monsterAt = (p: Vec2): Snapshot['monster'] => {
    const base = closeUp('scout', 1.0).snap.monster;
    if (!base) throw new Error('괴물 없음');
    return { ...base, x: p.x, y: p.y, windup: 0 };
  };

  /** tick에 괴물을 보고 그 뒤 70틱(괴물 안 보임) 같은 자리 — 두뇌가 고른 할 일 */
  function seeThenHold(
    brain: PracticeSurvivorBrain,
    view: ReturnType<typeof viaScene>,
    info: MatchInfo,
    me: Vec2,
    t1: Vec2,
    tick: number,
  ): ReturnType<PracticeSurvivorBrain['debugState']> {
    brain.decide(view(tick, monsterAt(t1), me), info, balance, tick);
    for (let k = 1; k <= 70; k += 1) brain.decide(view(tick + k, null, me), info, balance, tick + k);
    return brain.debugState();
  }

  /** 3~9타일 떨어진 (나, 괴물) 도주 후보 쌍 (step개마다 하나 — 시험 시간) */
  function pairs(step: number): [Vec2, Vec2][] {
    const out: [Vec2, Vec2][] = [];
    let i = 0;
    for (const me of FLEE_SPOTS)
      for (const t of FLEE_SPOTS) {
        const d = Math.hypot(me.x - t.x, me.y - t.y);
        if (d < 3 || d > 9) continue;
        if (i++ % step === 0) out.push([me, t]);
      }
    return out;
  }

  it('거쳐 갈 곳에 닿은 뒤 6초 지나 같은 자리의 괴물을 다시 만나면 새 두뇌처럼 다시 돌아간다 (옛 결정으로 곧장 가지 않는다)', () => {
    const view = viaScene();
    const info = scoutInfo();
    const later = 104 + 6 * HZ;
    let cases = 0;
    const wrong: string[] = [];
    for (const [me0, t1] of pairs(2)) {
      const fresh = seeThenHold(new PracticeSurvivorBrain('scout', 3), view, info, me0, t1, later);
      if (!fresh?.via || fresh.fleeing) continue;
      const br = new PracticeSurvivorBrain('scout', 3);
      br.decide(view(100, monsterAt(t1), me0), info, balance, 1);
      br.decide(view(101, null, me0), info, balance, 2);
      const first = br.debugState();
      if (!first?.via) continue;
      // 거쳐 갈 곳에 닿는다 (이 괴물 자리에 대해서는 돌아갔다) → 처음 자리로 돌아와 6초 (괴물 안 보임)
      br.decide(view(102, null, first.target), info, balance, 3);
      br.decide(view(103, null, first.target), info, balance, 4);
      for (let k = 104; k < later; k += 1) br.decide(view(k, null, me0), info, balance, k);
      const stale = seeThenHold(br, view, info, me0, t1, later);
      cases += 1;
      if (!stale?.via) wrong.push(`나 (${me0.x}, ${me0.y}) 괴물 (${t1.x}, ${t1.y}): ${stale?.kind}`);
    }
    expect(cases).toBeGreaterThan(50);
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it('6초 뒤 다른 자리에서 같은 자리의 괴물을 다시 만나면 거쳐 갈 곳을 지금 자리에서 다시 고른다 (새 두뇌와 같은 곳)', () => {
    const view = viaScene();
    const info = scoutInfo();
    let compared = 0;
    let firsts = 0;
    const wrong: string[] = [];
    for (const [me0, t1] of pairs(3)) {
      if (firsts >= 40) break;
      const probe = seeThenHold(new PracticeSurvivorBrain('scout', 3), view, info, me0, t1, 100);
      if (!probe?.via || probe.fleeing) continue;
      firsts += 1;
      let tried = 0;
      for (const me2 of FLEE_SPOTS) {
        const d2 = Math.hypot(me2.x - t1.x, me2.y - t1.y);
        if (me2 === me0 || d2 < 3 || d2 > 9 || tried >= 4) continue;
        const later = 171 + 6 * HZ;
        const fresh = seeThenHold(new PracticeSurvivorBrain('scout', 3), view, info, me2, t1, later);
        if (!fresh?.via || fresh.fleeing) continue;
        tried += 1;
        const br = new PracticeSurvivorBrain('scout', 3);
        seeThenHold(br, view, info, me0, t1, 100);
        for (let k = 171; k < later; k += 1) br.decide(view(k, null, me2), info, balance, k);
        const stale = seeThenHold(br, view, info, me2, t1, later);
        if (!stale || stale.anchor.x !== fresh.anchor.x || stale.anchor.y !== fresh.anchor.y) continue;
        compared += 1;
        if (!stale.via || stale.target.x !== fresh.target.x || stale.target.y !== fresh.target.y)
          wrong.push(
            `처음 나 (${me0.x}, ${me0.y}) → 나 (${me2.x}, ${me2.y}), 괴물 (${t1.x}, ${t1.y}): 새 두뇌 (${fresh.target.x}, ${fresh.target.y}) / ${stale.via ? `(${stale.target.x}, ${stale.target.y})` : stale.kind}`,
          );
      }
    }
    expect(compared).toBeGreaterThan(50);
    expect(wrong.slice(0, 5)).toEqual([]);
  });
});
