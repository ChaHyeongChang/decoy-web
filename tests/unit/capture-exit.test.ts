import { describe, expect, it } from 'vitest';
import { Driver, place, readyGame } from '../helpers/fixtures';

function farMonster(game: ReturnType<typeof readyGame>): void {
  place(game, 'p1', 45, 28);
}

describe('거점 점령 (GAME_DESIGN 7장)', () => {
  it('1명이면 40초, 2명 이상이면 1.5배(약 26.7초)', () => {
    const one = readyGame();
    const d1 = new Driver(one);
    farMonster(one);
    place(one, 'p2', 8, 16);
    place(one, 'p3', 30, 18.5);
    place(one, 'p4', 30, 19.5);
    d1.run(d1.seconds(39.9));
    expect(one.points[0]!.done).toBe(false);
    d1.run(d1.seconds(0.2));
    expect(one.points[0]!.done).toBe(true);

    const two = readyGame();
    const d2 = new Driver(two);
    farMonster(two);
    place(two, 'p2', 8, 16);
    place(two, 'p3', 8.5, 16.5);
    place(two, 'p4', 30, 19.5);
    d2.run(d2.seconds(40 / 1.5 - 0.1));
    expect(two.points[0]!.done).toBe(false);
    d2.run(d2.seconds(0.2));
    expect(two.points[0]!.done).toBe(true);
  });

  it('괴물이 안에 있으면 멈추고, 5초 넘게 지키면 다시 진행된다 (거점 지키기 방지)', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p2', 8, 16);
    place(game, 'p1', 9, 17.5);
    place(game, 'p3', 30, 18.5);
    place(game, 'p4', 30, 19.5);
    d.run(d.seconds(4));
    expect(game.points[0]!.progress).toBe(0);
    expect(game.points[0]!.blocked).toBe(true);
    d.run(d.seconds(2));
    expect(game.points[0]!.progress).toBeGreaterThan(0.5);
    expect(game.points[0]!.blocked).toBe(false);
  });

  it('생존자가 없어도 게이지는 줄지 않는다', () => {
    const game = readyGame();
    const d = new Driver(game);
    farMonster(game);
    place(game, 'p2', 8, 16);
    d.run(d.seconds(10));
    const p = game.points[0]!.progress;
    place(game, 'p2', 20, 18.5);
    d.run(d.seconds(10));
    expect(game.points[0]!.progress).toBeCloseTo(p, 6);
  });

  it('점령 시작은 괴물에게만 알리고(쿨다운 동안 반복하지 않음), 완료는 양쪽에, 메모는 점령 순서대로', () => {
    const game = readyGame();
    const d = new Driver(game);
    farMonster(game);
    place(game, 'p2', 40, 16); // B부터
    d.run(2);
    const mEvents = game.drainOutbox('p1');
    expect(mEvents.some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_START' && e.point === 'B')).toBe(
      true,
    );
    expect(game.drainOutbox('p2').some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_START')).toBe(false);
    // 잠깐 나갔다 들어와도 쿨다운 안이면 다시 알리지 않는다
    place(game, 'p2', 30, 16);
    d.run(3);
    place(game, 'p2', 40, 16);
    d.run(3);
    expect(game.drainOutbox('p1').some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_START')).toBe(false);
    d.run(d.seconds(41));
    const sEv = game.drainOutbox('p2');
    expect(sEv.some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_DONE' && e.point === 'B')).toBe(true);
    const note = sEv.find((e) => e.k === 'text' && e.id === 'NOTE_FIRST');
    expect(note && note.k === 'text' && note.code).toBe(game.codes[0]);
    expect(game.drainOutbox('p1').some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_DONE')).toBe(true);
  });
});

describe('탈출구 (GAME_DESIGN 8장)', () => {
  function bothDone() {
    const game = readyGame();
    for (const p of game.points) {
      p.progress = game.balance.capturePoint.captureTime - game.dt;
    }
    place(game, 'p2', 8, 16);
    place(game, 'p3', 40, 16);
    place(game, 'p4', 24, 20);
    farMonster(game);
    const d = new Driver(game);
    d.run(2);
    return { game, d };
  }

  it('두 거점을 모두 점령하기 전에는 비활성, 점령하면 활성', () => {
    const game = readyGame();
    expect(game.exits.every((e) => e.state === 'inactive')).toBe(true);
    const r = bothDone();
    expect(r.game.exits.every((e) => e.state === 'active')).toBe(true);
  });

  it('두 명이 함께 3초 머물러야 열리고, 한 명이 나가면 0으로 돌아간다', () => {
    const { game, d } = bothDone();
    place(game, 'p2', 23.5, 2.5);
    place(game, 'p3', 24.5, 2.5);
    d.run(d.seconds(2));
    expect(game.exits[0]!.progress).toBeGreaterThan(1.9);
    place(game, 'p3', 24.5, 6);
    d.run(1);
    expect(game.exits[0]!.progress).toBe(0);
    place(game, 'p3', 24.5, 2.5);
    d.run(d.seconds(3) + 1);
    expect(game.exits[0]!.state).toBe('open');
    expect(game.exits[1]!.state).toBe('active');
  });

  it('혼자서는 열리지 않는다', () => {
    const { game, d } = bothDone();
    place(game, 'p2', 24, 2.5);
    d.run(d.seconds(5));
    expect(game.exits[0]!.state).toBe('active');
  });

  it('괴물이 있어도 개방은 멈추지 않는다', () => {
    const { game, d } = bothDone();
    place(game, 'p2', 23.5, 2.5);
    place(game, 'p3', 24.5, 2.5);
    place(game, 'p1', 26, 2.5);
    d.run(d.seconds(3) + 1);
    expect(game.exits[0]!.state).toBe('open');
  });

  it('열린 문 칸으로 걸어 들어가면 탈출, 괴물은 문을 지나갈 수 없다', () => {
    const { game, d } = bothDone();
    place(game, 'p2', 23.5, 2.5);
    place(game, 'p3', 24.5, 2.5);
    d.run(d.seconds(3) + 1);
    d.run(d.seconds(1), { p2: [0, -1] });
    expect(game.survivorById('p2')!.status).toBe('escaped');
    place(game, 'p1', 24, 2);
    d.run(d.seconds(1), { p1: [0, -1] });
    expect(game.monster.move.y).toBeGreaterThanOrEqual(1 + game.balance.monster.radius - 1e-6);
  });
});
