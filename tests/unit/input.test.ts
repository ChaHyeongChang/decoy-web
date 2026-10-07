import { describe, expect, it } from 'vitest';
import { frame, newGame } from '../helpers/fixtures';

describe('서버 입력 처리 (seq, 틱당 소비)', () => {
  it('이미 처리한 seq와 중복은 버린다', () => {
    const game = newGame();
    const s = game.survivors[0]!;
    game.queueInput(s.id, [frame(1, 0, 1), frame(2, 0, 1)]);
    game.queueInput(s.id, [frame(2, 0, 1), frame(1, 0, 1)]);
    expect(s.queue.map((f) => f.seq)).toEqual([1, 2]);
  });

  it('한꺼번에 많이 보내도 틱당 최대 3개, 평균 1개만 처리한다 (속도 핵 방지)', () => {
    const game = newGame();
    const s = game.survivors[0]!;
    // 매 틱 3개씩 보내는 조작된 클라이언트
    let seq = 0;
    for (let t = 0; t < 60; t += 1) {
      const frames = [];
      for (let k = 0; k < 3; k += 1) frames.push(frame(++seq, 1, 0));
      game.queueInput(s.id, frames);
      game.step();
    }
    // 60틱 동안 처리한 입력은 크레딧 상한을 더해도 60 + 4 이하
    expect(s.processed).toBeLessThanOrEqual(64);
    expect(s.processed).toBeGreaterThanOrEqual(60);
  });

  it('입력이 잠깐 늦으면 기다렸다가 따라잡고, 오래 끊기면 시간만 흐른다', () => {
    const game = newGame();
    const m = game.monster;
    m.move.frozen = 0.5;
    for (let t = 0; t < 3; t += 1) game.step();
    // 3틱 동안 입력이 없었다: 아직 시간을 흘리지 않음
    expect(m.move.frozen).toBeCloseTo(0.5);
    game.queueInput(m.id, [frame(1), frame(2), frame(3)]);
    game.step();
    expect(m.ack).toBe(3);
    expect(m.move.frozen).toBeCloseTo(0.5 - 3 * game.dt);
    for (let t = 0; t < 20; t += 1) game.step();
    // 오래 끊기면 빈 입력으로 타이머가 흐른다
    expect(m.move.frozen).toBe(0);
  });

  it('알 수 없는 버튼 비트와 범위 밖 값은 잘라낸다', () => {
    const game = newGame();
    const s = game.survivors[0]!;
    game.queueInput(s.id, [{ seq: 1, mx: 50, my: -9, aim: Number.NaN, held: 0xffff, pressed: 0xffff }]);
    const f = s.queue[0]!;
    expect(f.mx).toBe(1);
    expect(f.my).toBe(-1);
    expect(f.held).toBe(63);
  });
});

describe('입력 막힘 뒤 회복 (M1 검토 반영)', () => {
  it('200ms 막혔다가 몰려 와도 밀림이 남지 않는다', () => {
    const game = newGame();
    const s = game.survivors[0]!;
    let seq = 0;
    // 평소: 틱마다 1개
    for (let t = 0; t < 30; t += 1) {
      game.queueInput(s.id, [frame(++seq, 0, 0)]);
      game.step();
    }
    // 6틱 동안 막힘 → 7개가 한꺼번에 도착
    for (let t = 0; t < 6; t += 1) game.step();
    const burst = [];
    for (let k = 0; k < 7; k += 1) burst.push(frame(++seq, 0, 0));
    game.queueInput(s.id, burst);
    game.step();
    // 이후 다시 틱마다 1개: 몇 틱 안에 밀림이 0으로 돌아온다
    for (let t = 0; t < 10; t += 1) {
      game.queueInput(s.id, [frame(++seq, 0, 0)]);
      game.step();
    }
    expect(seq - s.ack).toBe(0);
    expect(s.queue.length).toBe(0);
  });

  it('사망 · 탈출 뒤에는 입력을 버리되 ack는 올린다 (관전 중 예측이 쌓이지 않게)', () => {
    const game = newGame();
    const s = game.survivors[0]!;
    s.status = 'dead';
    game.queueInput(s.id, [frame(1), frame(2), frame(3)]);
    game.step();
    expect(s.ack).toBe(3);
  });
});
