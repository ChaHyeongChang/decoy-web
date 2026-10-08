import { describe, expect, it } from 'vitest';
import { BTN, type MoveEnv } from '@decoy/shared';
import { applyDashStart, applyWindupLock, predictMonsterPress } from '../../client/src/localActions';
import { Interpolator, Predictor, lerpNum } from '../../client/src/sync';
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
