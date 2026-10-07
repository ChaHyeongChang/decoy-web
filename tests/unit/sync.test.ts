import { describe, expect, it } from 'vitest';
import type { MoveEnv } from '@decoy/shared';
import { Interpolator, Predictor, lerpNum } from '../../client/src/sync';
import { frame, loadTestBalance, newGame } from '../helpers/fixtures';

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
