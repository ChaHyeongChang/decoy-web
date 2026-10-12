import { describe, expect, it } from 'vitest';
import { frame, newGame, readyGame } from '../helpers/fixtures';

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

  // 빚 루프 (출시 전 검토): 빚을 갚는 경로는 처리한 입력 수를 올리지 않아, 끊긴 뒤 입력이 틱당 하나씩 오면
  // 굶은 틱으로 다시 세어 빚이 도로 쌓였다 → 끊긴 순간부터 약 1초(31틱) 동안 이동 · 조준이 무시됐다
  it('판 시작 뒤 첫 입력이 8틱 늦게 와도, 입력이 온 그 틱(9틱째)부터 움직이고 조준이 돈다', () => {
    const game = newGame();
    const s = game.survivors[0]!;
    const m = game.monster;
    const x0 = s.move.x;
    const face0 = m.move.face;
    for (let t = 0; t < 8; t += 1) game.step();
    expect(s.move.x).toBe(x0);
    let seq = 0;
    let movedAt = -1;
    let turnedAt = -1;
    for (let t = 0; t < 40; t += 1) {
      seq += 1;
      game.queueInput(s.id, [frame(seq, 1, 0)]);
      game.queueInput(m.id, [frame(seq, 0, 0, { aim: face0 + Math.PI / 2 })]);
      game.step();
      if (movedAt < 0 && s.move.x > x0 + 1e-6) movedAt = t;
      if (turnedAt < 0 && Math.abs(m.move.face - face0) > 1e-6) turnedAt = t;
    }
    expect(movedAt).toBe(0);
    expect(turnedAt).toBe(0);
    expect(seq - s.ack).toBe(0);
    expect(s.debt).toBe(0);
  });

  it('판 중 10틱 끊겼다가 틱당 하나씩 다시 오면 바로 움직이고 괴물 face가 바뀐다', () => {
    const game = readyGame();
    const s = game.survivors[0]!;
    const m = game.monster;
    let seq = 0;
    for (let t = 0; t < 30; t += 1) {
      seq += 1;
      game.queueInput(s.id, [frame(seq, 0, 0)]);
      game.queueInput(m.id, [frame(seq, 0, 0, { aim: m.move.face })]);
      game.step();
    }
    for (let t = 0; t < 10; t += 1) game.step();
    const sx = s.move.x;
    const mx = m.move.x;
    const face0 = m.move.face;
    const trail: { sx: number; mx: number; face: number }[] = [];
    for (let t = 0; t < 5; t += 1) {
      seq += 1;
      game.queueInput(s.id, [frame(seq, 1, 0)]);
      game.queueInput(m.id, [frame(seq, 1, 0, { aim: face0 + Math.PI / 2 })]);
      game.step();
      trail.push({ sx: s.move.x, mx: m.move.x, face: m.move.face });
    }
    // 첫 틱부터: 생존자 · 괴물 모두 x가 늘고, 괴물 face가 조준 쪽으로 돈다
    expect(trail[0]!.sx).toBeGreaterThan(sx + 1e-6);
    expect(trail[0]!.mx).toBeGreaterThan(mx + 1e-6);
    expect(Math.abs(trail[0]!.face - face0)).toBeGreaterThan(1e-6);
    // 그 뒤로도 틱마다 계속 움직인다 (한 틱만 움직이고 다시 빚에 먹히지 않는다)
    for (let i = 1; i < trail.length; i += 1) expect(trail[i]!.sx).toBeGreaterThan(trail[i - 1]!.sx + 1e-6);
    expect(s.debt).toBe(0);
    expect(m.debt).toBe(0);
  });

  it.each([6, 8, 10, 12, 20])(
    '%i틱 끊긴 뒤 그동안의 입력이 한꺼번에 와도(큐 상한에 잘려도) 밀림 · 빚이 남지 않고 다시 움직인다',
    (gap) => {
      const game = newGame();
      const s = game.survivors[0]!;
      // 오른쪽으로 3타일 넘게 벽이 없는 자리
      s.move.x = 15;
      s.move.y = 30;
      let seq = 0;
      for (let t = 0; t < 30; t += 1) {
        seq += 1;
        game.queueInput(s.id, [frame(seq, 0, 0)]);
        game.step();
      }
      for (let t = 0; t < gap; t += 1) game.step();
      const burst = [];
      for (let k = 0; k < gap; k += 1) burst.push(frame(++seq, 0, 0));
      game.queueInput(s.id, burst);
      game.step();
      const x0 = s.move.x;
      for (let t = 0; t < 10; t += 1) {
        game.queueInput(s.id, [frame(++seq, 1, 0)]);
        game.step();
      }
      expect(seq - s.ack).toBe(0);
      expect(s.queue.length).toBe(0);
      expect(s.debt).toBe(0);
      // 이어 온 10개 중 적어도 9개는 이동으로 처리된다 (빚으로 먹힌 이동이 없다)
      const speed = (s.move.x - x0) / (10 * game.dt);
      expect(speed).toBeGreaterThan(game.balance.survivor.moveSpeed * 0.85);
    },
  );

  it('사망 · 탈출 뒤에는 입력을 버리되 ack는 올린다 (관전 중 예측이 쌓이지 않게)', () => {
    const game = newGame();
    const s = game.survivors[0]!;
    s.status = 'dead';
    game.queueInput(s.id, [frame(1), frame(2), frame(3)]);
    game.step();
    expect(s.ack).toBe(3);
  });
});
