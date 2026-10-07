import { describe, expect, it } from 'vitest';
import { BTN, MONSTER_SPAWN, PRISON_RECT, inRect } from '@decoy/shared';
import { Driver, newGame } from '../helpers/fixtures';

describe('스폰과 시작 대기', () => {
  it('생존자는 감옥 안, 괴물은 (45,28)에서 시작한다', () => {
    const game = newGame();
    for (const s of game.survivors) expect(inRect(s.move, PRISON_RECT)).toBe(true);
    expect(game.monster.move.x).toBe(MONSTER_SPAWN.x);
    expect(game.monster.move.y).toBe(MONSTER_SPAWN.y);
  });

  it('시작 틱에는 세 명이 감옥 안이지만 수감 상태가 아니다 (자유)', () => {
    const game = newGame();
    expect(game.survivors.every((s) => s.status === 'free')).toBe(true);
  });

  it('괴물은 처음 5초 동안 움직일 수 없다', () => {
    const game = newGame();
    const d = new Driver(game);
    const m = game.monster;
    d.run(d.seconds(4.9), { [m.id]: [0, -1] });
    expect(m.move.y).toBe(MONSTER_SPAWN.y);
    d.run(d.seconds(0.3), { [m.id]: [0, -1] });
    expect(m.move.y).toBeLessThan(MONSTER_SPAWN.y);
  });

  it('생존자는 바로 움직여 감옥 문으로 나갈 수 있다', () => {
    const game = newGame();
    const d = new Driver(game);
    const s = game.survivors[2]!; // 문 바로 위 (24, 16.5)
    d.run(d.seconds(1), { [s.id]: [0, 1] });
    expect(s.move.y).toBeGreaterThan(PRISON_RECT.y1);
  });
});

describe('괴물 시야 모드 전환 (우클릭, 0.4초)', () => {
  it('우클릭으로 탐색 ↔ 추적이 바뀌고 0.4초에 걸쳐 모양이 바뀐다', () => {
    const game = newGame();
    const d = new Driver(game);
    const m = game.monster;
    expect(m.mode).toBe('search');
    d.run(1, { [m.id]: [0, 0, { pressed: BTN.MODE }] });
    expect(m.mode).toBe('hunt');
    d.run(d.seconds(0.2) - 1);
    expect(m.blend).toBeCloseTo(0.5, 5);
    d.run(d.seconds(0.2));
    expect(m.blend).toBe(1);
  });

  it('전환 중 다시 누르면 현재 모양에서 반대로 돌아간다', () => {
    const game = newGame();
    const d = new Driver(game);
    const m = game.monster;
    d.run(1, { [m.id]: [0, 0, { pressed: BTN.MODE }] });
    d.run(d.seconds(0.1) - 1);
    const mid = m.blend;
    d.run(1, { [m.id]: [0, 0, { pressed: BTN.MODE }] });
    expect(m.mode).toBe('search');
    expect(m.blend).toBeLessThan(mid + 1e-9);
    d.run(d.seconds(0.2));
    expect(m.blend).toBe(0);
  });

  it('시작 대기 중에도 모드 전환은 된다, 기절 중에는 안 된다', () => {
    const game = newGame();
    const d = new Driver(game);
    const m = game.monster;
    expect(m.move.frozen).toBeGreaterThan(0);
    d.run(1, { [m.id]: [0, 0, { pressed: BTN.MODE }] });
    expect(m.mode).toBe('hunt');
    m.move.stun = 1;
    d.run(1, { [m.id]: [0, 0, { pressed: BTN.MODE }] });
    expect(m.mode).toBe('hunt');
  });
});
