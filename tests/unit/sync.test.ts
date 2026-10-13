import { describe, expect, it } from 'vitest';
import { BTN, type MoveEnv } from '@decoy/shared';
import { applyDashStart, applyWindupLock, predictMonsterPress } from '../../client/src/localActions';
import type { TravelPiece } from '../../client/src/art/anim';
import { Interpolator, Predictor, lerpNum, travelOf } from '../../client/src/sync';
import { frame, loadTestBalance, newGame, readyGame } from '../helpers/fixtures';

const balance = loadTestBalance();
const dt = 1 / balance.network.serverTickHz;

describe('내 캐릭터 예측 + 보정', () => {
  it('서버가 늦게 처리해도 보정 후 위치가 서버 결과와 같다', () => {
    const game = newGame();
    const me = game.survivors[0]!;
    const env = (): MoveEnv => game.moveEnvFor(me);
    const pred = new Predictor(balance, dt);
    pred.reconcile(me.move, 0, env());
    const sent = [];
    // 클라이언트가 20프레임을 보내는 동안 서버는 5프레임 늦게 처리한다
    for (let seq = 1; seq <= 20; seq += 1) {
      const f = frame(seq, seq < 12 ? 0 : 1, 1);
      sent.push(f);
      pred.applyLocal(f, env());
      if (seq > 5) {
        game.queueInput(me.id, [sent[seq - 6]!]);
        game.step();
        pred.reconcile(game.survivors[0]!.move, me.ack, env());
      }
    }
    // 나머지 처리
    game.queueInput(me.id, sent.slice(15));
    for (let i = 0; i < 6; i += 1) game.step();
    const before = { ...pred.state! };
    pred.reconcile(me.move, me.ack, env());
    expect(me.ack).toBe(20);
    expect(Math.hypot(pred.state!.x - me.move.x, pred.state!.y - me.move.y)).toBeLessThan(1e-9);
    // 보정 전 예측도 이미 서버와 같았다 (같은 이동 코드)
    expect(Math.hypot(before.x - me.move.x, before.y - me.move.y)).toBeLessThan(1e-9);
  });

  it('괴물이 공격 준비(조준 고정)와 돌진을 서버 확인 전에 먼저 보여 줘도, 예측이 서버 결과와 같다', () => {
    const game = readyGame();
    const m = game.monster;
    m.move.x = 30;
    m.move.y = 20;
    const env = (): MoveEnv => game.moveEnvFor(m);
    const pred = new Predictor(balance, dt);
    pred.reconcile(m.move, 0, env());
    const sent = [];
    const predicted = new Map<number, { x: number; y: number; face: number }>();
    const server = new Map<number, { x: number; y: number; face: number }>();
    const stepServer = (frames: ReturnType<typeof frame>[], survSeq: number): void => {
      game.queueInput(m.id, frames);
      for (const sv of game.survivors) game.queueInput(sv.id, [frame(survSeq)]);
      game.step();
      server.set(m.ack, { x: m.move.x, y: m.move.y, face: m.move.face });
    };
    for (let seq = 1; seq <= 50; seq += 1) {
      const pressed = seq === 3 ? BTN.ATTACK : seq === 30 ? BTN.DASH : 0;
      const f = frame(seq, 0.3, 1, { aim: seq * 0.08, pressed });
      if (seq === 3) pred.predictAction(seq, applyWindupLock(balance));
      if (seq === 30) pred.predictAction(seq, applyDashStart(balance));
      sent.push(f);
      pred.applyLocal(f, env());
      predicted.set(seq, { x: pred.state!.x, y: pred.state!.y, face: pred.state!.face });
      // 서버는 5프레임 늦게 처리하고, 그 결과로 예측을 보정한다
      if (seq > 5) {
        stepServer([sent[seq - 6]!], seq - 5);
        pred.reconcile(m.move, m.ack, env());
      }
    }
    for (let k = 45; k < 50; k += 1) stepServer([sent[k]!], k + 1);
    expect(m.ack).toBe(50);
    expect(m.dashCd).toBeGreaterThan(0);
    for (let seq = 1; seq <= 50; seq += 1) {
      const p = predicted.get(seq)!;
      const sv = server.get(seq)!;
      expect(Math.hypot(p.x - sv.x, p.y - sv.y), `seq ${seq} 위치`).toBeLessThan(1e-9);
      expect(Math.abs(p.face - sv.face), `seq ${seq} 조준`).toBeLessThan(1e-9);
    }
  });

  it('크게 어긋나면(순간이동) 바로 맞추고, 작으면 서서히 줄인다', () => {
    const game = newGame();
    const me = game.survivors[0]!;
    const pred = new Predictor(balance, dt);
    pred.reconcile(me.move, 0, game.moveEnvFor(me));
    const far = { ...me.move, x: me.move.x + 5 };
    pred.reconcile(far, 0, game.moveEnvFor(me));
    expect(pred.renderPos(16)!.x).toBeCloseTo(far.x, 6);
    const near = { ...far, x: far.x + 0.3 };
    pred.reconcile(near, 0, game.moveEnvFor(me));
    const p1 = pred.renderPos(16)!.x;
    expect(p1).toBeLessThan(near.x);
    for (let i = 0; i < 60; i += 1) pred.renderPos(16);
    expect(pred.renderPos(16)!.x).toBeCloseTo(near.x, 3);
  });
});

describe('괴물 행동 즉시 피드백 어림 (M8)', () => {
  const game = readyGame();
  const mon = {
    attackCd: 0,
    windup: 0,
    dashCd: 0,
    roarCd: 0,
    mode: 'search' as const,
    blend: 0,
    camp: 0 as const,
    blockWarn: null,
  };
  const base = { move: game.monster.move, mon, balance, ageSec: 0.05, localWindupActive: false };

  it('쿨타임이 끝났고 행동할 수 있으면 공격 · 돌진을 먼저 보여 준다', () => {
    expect(predictMonsterPress({ ...base, pressed: BTN.ATTACK })).toEqual({ attack: true, dash: false });
    expect(predictMonsterPress({ ...base, pressed: BTN.DASH })).toEqual({ attack: false, dash: true });
  });

  it('같은 입력에 공격과 돌진이 함께 눌리면 서버처럼 공격만 (준비 중 돌진 불가)', () => {
    expect(predictMonsterPress({ ...base, pressed: BTN.ATTACK | BTN.DASH })).toEqual({
      attack: true,
      dash: false,
    });
  });

  it('쿨타임 · 시작 대기 · 기절 · 돌진 · 준비 중이면 예측하지 않는다', () => {
    const p = BTN.ATTACK;
    expect(predictMonsterPress({ ...base, pressed: p, mon: { ...mon, attackCd: 0.5 } }).attack).toBe(false);
    expect(predictMonsterPress({ ...base, pressed: p, mon: { ...mon, attackCd: 0.03 } }).attack).toBe(true);
    expect(predictMonsterPress({ ...base, pressed: p, move: { ...base.move, frozen: 1 } }).attack).toBe(
      false,
    );
    expect(predictMonsterPress({ ...base, pressed: p, move: { ...base.move, stun: 1 } }).attack).toBe(false);
    expect(predictMonsterPress({ ...base, pressed: p, move: { ...base.move, dash: 0.1 } }).attack).toBe(
      false,
    );
    expect(predictMonsterPress({ ...base, pressed: p, mon: { ...mon, windup: 0.2 } }).attack).toBe(false);
    expect(predictMonsterPress({ ...base, pressed: p, localWindupActive: true }).attack).toBe(false);
  });
});

describe('다른 캐릭터 100ms 보간', () => {
  type P = { x: number; y: number };
  const lerp = (a: P, b: P, k: number): P => ({ x: lerpNum(a.x, b.x, k), y: lerpNum(a.y, b.y, k) });

  it('두 스냅샷 사이를 보간한다', () => {
    const it = new Interpolator<P>(lerp);
    it.push(1000, [{ id: 'a', v: { x: 0, y: 0 } }]);
    it.push(1050, [{ id: 'a', v: { x: 1, y: 0 } }]);
    expect(it.sample(1025).get('a')!.x).toBeCloseTo(0.5);
  });

  it('스냅샷에서 빠졌다가 다시 나타나면 중간 위치를 그리지 않는다', () => {
    const it = new Interpolator<P>(lerp);
    it.push(1000, [{ id: 'm', v: { x: 0, y: 0 } }]);
    it.push(1050, []);
    it.push(1100, []);
    it.push(1150, [{ id: 'm', v: { x: 10, y: 0 } }]);
    it.push(1200, [{ id: 'm', v: { x: 10.5, y: 0 } }]);
    // 다시 나타난 직후: 0→10 사이를 미끄러지지 않고 새 위치에서 시작
    expect(it.sample(1120).get('m')!.x).toBeCloseTo(10);
  });

  it('사라진 엔티티는 마지막 표본 시각이 지나면 그리지 않는다', () => {
    const it = new Interpolator<P>(lerp);
    it.push(1000, [{ id: 'm', v: { x: 0, y: 0 } }]);
    it.push(1050, [{ id: 'm', v: { x: 1, y: 0 } }]);
    it.push(1100, []);
    expect(it.sample(1040).has('m')).toBe(true);
    expect(it.sample(1060).has('m')).toBe(false);
  });
});

describe('스냅샷 시계 (M1 검토 반영)', () => {
  it('단방향 지연이 커도 보간 시각이 받은 스냅샷 두 개 사이에 떨어진다', async () => {
    const { SnapshotClock } = await import('../../client/src/sync');
    const clock = new SnapshotClock();
    // 서버가 50ms 간격으로 보낸 스냅샷이 100±20ms 늦게 도착
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const arrivals: { st: number; at: number }[] = [];
    for (let i = 0; i < 80; i += 1)
      arrivals.push({ st: 10_000 + i * 50, at: 5_000 + i * 50 + 100 + (rnd() * 40 - 20) });
    let inside = 0;
    let total = 0;
    let lastIdx = -1;
    for (let now = 5_200; now < 9_000; now += 16) {
      while (lastIdx + 1 < arrivals.length && arrivals[lastIdx + 1]!.at <= now) {
        lastIdx += 1;
        clock.add(arrivals[lastIdx]!.st, arrivals[lastIdx]!.at);
      }
      if (lastIdx < 2) continue;
      const renderTime = clock.now(now) - 100;
      total += 1;
      if (renderTime >= arrivals[0]!.st && renderTime <= arrivals[lastIdx]!.st) inside += 1;
    }
    expect(inside / total).toBeGreaterThan(0.95);
  });
});

// ───────────── 렌더링 최적화: 프레임 독립성 ─────────────

/** hz 프레임 시각 (k × 1000 / hz) */
const frameTimes = (hz: number, to: number): number[] =>
  Array.from({ length: Math.floor((to * hz) / 1000) }, (_, k) => ((k + 1) * 1000) / hz);

describe('보정 어긋남은 보정 순간부터 줄어든다 (프레임 독립성)', () => {
  /** 78ms에 서버가 0.3타일 앞을, 195ms에 제자리를 알려 온다 (둘 다 120Hz 프레임이 60Hz보다 하나 더 지난 뒤). 프레임마다 그린 자리 */
  const run = (hz: number, timed: boolean): Map<number, number> => {
    const game = newGame();
    const me = game.survivors[0]!;
    let clock = 0;
    const pred = new Predictor(balance, dt, () => clock);
    pred.reconcile(me.move, 0, game.moveEnvFor(me));
    const near = { ...me.move, x: me.move.x + 0.3 };
    const events = [78, 195];
    let prev = 0;
    const out = new Map<number, number>();
    pred.renderPos(0, 1, timed ? 0 : undefined);
    for (const t of frameTimes(hz, 600)) {
      for (const e of events)
        if (e > prev && e <= t) {
          clock = e;
          pred.reconcile(e === 78 ? near : me.move, 0, game.moveEnvFor(me));
        }
      clock = t;
      const p = pred.renderPos(t - prev, 1, timed ? t : undefined);
      out.set(Math.round(t * 1000), p?.x ?? Number.NaN);
      prev = t;
    }
    return out;
  };

  it('보정이 60Hz 프레임 사이에 와도 60 · 120fps가 같은 시각에 같은 자리를 그린다', () => {
    const a = run(60, true);
    const b = run(120, true);
    for (const [t, x] of a) expect(b.get(t)).toBeCloseTo(x, 12);
  });

  it('예전처럼 프레임 간격으로 줄이면 보정 직후 자리가 fps마다 달랐다 (보정 전 시간까지 줄어듦)', () => {
    const a = run(60, false);
    const b = run(120, false);
    let worst = 0;
    for (const [t, x] of a) worst = Math.max(worst, Math.abs((b.get(t) ?? x) - x));
    expect(worst).toBeGreaterThan(1e-3);
  });

  it('그리는 자리가 틱 사이 직선으로 가는 거리 (내 걷기 위상): 순간이동한 틱은 0', () => {
    const game = newGame();
    const me = game.survivors[0]!;
    const pred = new Predictor(balance, dt);
    expect(pred.stepDistance).toBe(0);
    pred.reconcile(me.move, 0, game.moveEnvFor(me));
    expect(pred.stepDistance).toBe(0);
    pred.applyLocal(frame(1, 1, 0), game.moveEnvFor(me));
    pred.applyLocal(frame(2, 1, 0), game.moveEnvFor(me));
    expect(pred.stepDistance).toBeGreaterThan(0.05);
    expect(pred.stepDistance).toBeLessThan(0.3);
    pred.reconcile({ ...me.move, x: me.move.x + 6 }, 2, game.moveEnvFor(me));
    expect(pred.stepDistance).toBe(0);
  });
});

describe('보간 경로 조각 · 상태 경계 (프레임 독립성)', () => {
  const samples = [
    { t: 0, v: { x: 0, y: 0 } },
    { t: 50, v: { x: 1, y: 0 } },
    { t: 100, v: { x: 1, y: 1 } },
  ];

  it('표본 시각(꺾인 점)에서 나눈다: 모퉁이를 현으로 깎지 않는다', () => {
    const out: TravelPiece[] = [];
    expect(travelOf(samples, 40, 60, out)).toBe(2);
    expect(out).toHaveLength(2);
    expect(out[0]?.ms).toBeCloseTo(10, 9);
    expect(out[0]?.dist).toBeCloseTo(0.2, 9);
    expect(out[1]?.dist).toBeCloseTo(0.2, 9);
    // 프레임 사이 직선이면 0.283
    expect((out[0]?.dist ?? 0) + (out[1]?.dist ?? 0)).toBeGreaterThan(Math.hypot(0.2, 0.2) + 0.1);
    // 첫 표본 전 · 마지막 표본 뒤는 그 자리에 서 있다
    travelOf(samples, -30, 10, out);
    expect(out.map((p) => p.dist)).toEqual([0, expect.closeTo(0.2, 9)]);
    travelOf(samples, 90, 130, out);
    expect(out.map((p) => p.dist)).toEqual([expect.closeTo(0.2, 9), 0]);
    expect(travelOf([], 0, 10, out)).toBe(-1);
    // 조각 객체는 다시 쓰고 쓴 수만 돌려준다 (프레임마다 새로 만들지 않는다)
    const kept = out[0];
    expect(travelOf(samples, 10, 20, out)).toBe(1);
    expect(out[0]).toBe(kept);
    expect(out[0]?.dist).toBeCloseTo(0.2, 9);
  });

  it('60 · 120fps로 나눠도 걸은 거리 · 시간의 합이 같다', () => {
    const sum = (hz: number): { ms: number; dist: number } => {
      const out: TravelPiece[] = [];
      let ms = 0;
      let dist = 0;
      let prev = -20;
      for (const t of frameTimes(hz, 150).map((x) => x - 20)) {
        const n = travelOf(samples, prev, t, out);
        for (const p of out.slice(0, n)) {
          ms += p.ms;
          dist += p.dist;
        }
        prev = t;
      }
      return { ms, dist };
    };
    const a = sum(60);
    const b = sum(120);
    expect(b.ms).toBeCloseTo(a.ms, 9);
    expect(b.dist).toBeCloseTo(a.dist, 9);
    expect(a.dist).toBeCloseTo(2, 9);
  });

  it('보간하지 않는 값(뒤 표본 값)이 바뀌는 경계: 지난 프레임 뒤 첫 경계 시각, 사라진 엔티티는 마지막 표본', () => {
    const interp = new Interpolator<{ x: number; y: number }>((a, b, k) => ({
      x: lerpNum(a.x, b.x, k),
      y: lerpNum(a.y, b.y, k),
    }));
    for (const smp of samples) interp.push(smp.t, [{ id: 'a', v: smp.v }]);
    expect(interp.edgeAt('a', 40, 60)).toBe(50);
    expect(interp.edgeAt('a', 50, 60)).toBeNull();
    expect(interp.edgeAt('a', -10, 5)).toBe(0);
    expect(interp.edgeAt('a', 60, 200)).toBeNull();
    expect(interp.edgeAt('b', 0, 100)).toBeNull();
    const out: TravelPiece[] = [];
    expect(interp.travel('a', 40, 60, out)).toBe(2);
    expect(interp.travel('b', 40, 60, out)).toBe(-1);
    // 다음 스냅샷에 없으면 사라진다: 마지막 표본 시각이 경계
    interp.push(150, []);
    expect(interp.edgeAt('a', 95, 105)).toBe(100);
  });
});
