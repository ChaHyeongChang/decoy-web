import { describe, expect, it } from 'vitest';
import { BTN, PRISON_RECT, countdown, inRect } from '@decoy/shared';
import { Driver, place, readyGame } from '../helpers/fixtures';

const ATTACK = { pressed: BTN.ATTACK };

function setup() {
  const game = readyGame();
  const d = new Driver(game);
  // 괴물 (30,18.5) 동쪽을 봄, 러너는 바로 앞 1타일. 나머지는 멀리
  place(game, 'p1', 30, 18.5, 0);
  place(game, 'p2', 31, 18.5);
  place(game, 'p3', 8, 16);
  place(game, 'p4', 8, 17);
  return { game, d, m: game.monster, runner: game.survivorById('p2')!, guard: game.survivorById('p3')! };
}

describe('괴물 공격 (GAME_DESIGN 5.1)', () => {
  it('준비 0.4초 뒤 범위 안 생존자가 맞아 부상(체력 2 → 1)', () => {
    const { d, m, runner } = setup();
    d.run(1, { p1: [0, 0, ATTACK] });
    expect(m.windupLeft).toBeGreaterThan(0);
    d.run(d.seconds(0.4) - 2);
    expect(runner.hp).toBe(2);
    d.run(2);
    expect(runner.hp).toBe(1);
    expect(m.attackCd).toBeGreaterThan(1.4);
  });

  it('준비 중에 범위 밖(옆)으로 나가면 피한다', () => {
    const { d, runner } = setup();
    d.run(1, { p1: [0, 0, ATTACK] });
    d.run(d.seconds(0.4), { p2: [0, 1] });
    expect(runner.hp).toBe(2);
  });

  it('준비 중 조준은 고정되고(이동은 가능), 쿨타임 1.5초 동안 다시 공격할 수 없다', () => {
    const { game, d, m } = setup();
    d.run(1, { p1: [0, 0, ATTACK] });
    d.run(5, { p1: [0, 1, { aim: Math.PI / 2 }] });
    expect(m.move.face).toBeCloseTo(0, 6);
    expect(m.move.y).toBeGreaterThan(18.5);
    d.run(d.seconds(0.4));
    d.run(1, { p1: [0, 0, ATTACK] });
    expect(m.windupLeft).toBe(0);
    d.run(d.seconds(1.5));
    d.run(1, { p1: [0, 0, ATTACK] });
    expect(m.windupLeft).toBeGreaterThan(0);
    void game;
  });

  it('입력이 한 틱에 몰려 처리돼도 조준 고정은 타격 틱까지 유지되고, 타격 뒤에는 바로 풀린다', () => {
    const { game, d, m } = setup();
    const others = (): void => {
      for (const id of ['p2', 'p3', 'p4']) d.input(id, 0, 0);
    };
    // 괴물 입력이 3틱 끊겨 크레딧이 쌓인 뒤, 공격 + 아래쪽 조준 입력 3개가 한 틱에 도착
    for (let t = 0; t < 3; t += 1) {
      others();
      game.step();
    }
    d.input('p1', 0, 0, { pressed: BTN.ATTACK, aim: 0 });
    d.input('p1', 0, 0, { aim: Math.PI / 2 });
    d.input('p1', 0, 0, { aim: Math.PI / 2 });
    others();
    game.step();
    expect(m.windupLeft).toBeGreaterThan(0);
    let ticks = 0;
    while (m.windupLeft > 0 && ticks < 30) {
      d.input('p1', 0, 0, { aim: Math.PI / 2 });
      others();
      game.step();
      ticks += 1;
      expect(m.move.face).toBeCloseTo(0, 9);
    }
    expect(m.windupLeft).toBe(0);
    expect(m.move.aimLock).toBe(0);
    d.run(1, { p1: [0, 0, { aim: Math.PI / 2 }] });
    expect(m.move.face).toBeGreaterThan(0.1);
  });

  it('시작 대기 중에는 공격할 수 없다', () => {
    const { d, m } = setup();
    m.move.frozen = 2;
    d.run(1, { p1: [0, 0, ATTACK] });
    expect(m.windupLeft).toBe(0);
  });

  it('범위 안 여러 명이 함께 맞고, 벽 너머는 맞지 않는다', () => {
    const { game, d, runner, guard } = setup();
    place(game, 'p3', 31, 19.2);
    d.run(1, { p1: [0, 0, ATTACK] });
    d.run(d.seconds(0.4));
    expect(runner.hp).toBe(1);
    expect(guard.hp).toBe(1);
    // 벽(타일 27–28 × 20–23) 너머
    place(game, 'p1', 26.4, 21.5, 0);
    place(game, 'p2', 29.3, 21.5);
    game.monster.attackCd = 0;
    d.run(1, { p1: [0, 0, ATTACK] });
    d.run(d.seconds(0.4));
    expect(runner.hp).toBe(1);
  });

  it('두 번 맞으면 감옥으로 즉시 이동하고 수감 횟수가 오른다', () => {
    const { game, d, runner } = setup();
    for (let i = 0; i < 2; i += 1) {
      game.monster.attackCd = 0;
      place(game, 'p2', 31, 18.5);
      d.run(1, { p1: [0, 0, ATTACK] });
      d.run(d.seconds(0.4));
    }
    expect(runner.status).toBe('imprisoned');
    expect(runner.imprisonCount).toBe(1);
    expect(inRect(runner.move, PRISON_RECT)).toBe(true);
  });

  it('수감 2회 뒤 세 번째로 잡히면 사망', () => {
    const { game, d, runner } = setup();
    runner.imprisonCount = 2;
    runner.hp = 1;
    game.monster.attackCd = 0;
    d.run(1, { p1: [0, 0, ATTACK] });
    d.run(d.seconds(0.4));
    expect(runner.status).toBe('dead');
  });

  it('수감 · 보호 중 생존자는 맞지 않는다', () => {
    const { d, runner } = setup();
    runner.protectLeft = 2;
    d.run(1, { p1: [0, 0, ATTACK] });
    d.run(d.seconds(0.4));
    expect(runner.hp).toBe(2);
  });
});

describe('구조 (GAME_DESIGN 6.2)', () => {
  function prisoners() {
    const { game, d, m, runner, guard } = setup();
    for (const s of [runner, guard]) {
      s.status = 'imprisoned';
      s.hp = 0;
      s.imprisonCount = 1;
    }
    place(game, 'p2', 23.5, 15.5);
    place(game, 'p3', 24.5, 15.5);
    place(game, 'p4', 24, 18.6);
    place(game, 'p1', 40, 16);
    return { game, d, m, runner, guard, scout: game.survivorById('p4')! };
  }

  it('문 앞에서 E를 3초 누르면 감옥 안 전원이 풀려나 체력 2 · 4초 보호로 문 밖에 선다', () => {
    const { d, runner, guard, scout } = prisoners();
    d.run(d.seconds(3) - 2, { p4: [0, 0, { held: BTN.RESCUE }] });
    expect(runner.status).toBe('imprisoned');
    d.run(2, { p4: [0, 0, { held: BTN.RESCUE }] });
    for (const s of [runner, guard]) {
      expect(s.status).toBe('free');
      expect(s.hp).toBe(2);
      expect(s.protectLeft).toBeGreaterThan(3.9);
      expect(s.move.y).toBeGreaterThan(PRISON_RECT.y1);
    }
    expect(scout.stats.rescues).toBe(1);
  });

  it('E를 떼거나 구역을 벗어나면 진행이 0으로 돌아간다', () => {
    const { d, scout } = prisoners();
    d.run(d.seconds(2), { p4: [0, 0, { held: BTN.RESCUE }] });
    expect(scout.rescueProgress).toBeGreaterThan(1.9);
    d.run(1);
    expect(scout.rescueProgress).toBe(0);
  });

  it('구조 중 공격받아 체력이 깎이면 중단된다', () => {
    const { game, d, scout } = prisoners();
    d.run(d.seconds(2), { p4: [0, 0, { held: BTN.RESCUE }] });
    place(game, 'p1', 24, 19.8, -Math.PI / 2);
    d.run(1, { p1: [0, 0, ATTACK], p4: [0, 0, { held: BTN.RESCUE }] });
    d.run(d.seconds(0.4), { p4: [0, 0, { held: BTN.RESCUE }] });
    expect(scout.hp).toBe(1);
    expect(scout.rescueProgress).toBeLessThan(0.5);
  });

  it('풀려나는 자리는 감옥 안 위치 순으로 정해진다 (자리 순서로 정해지면 괴물이 정체를 좁힌다)', () => {
    const { game, d, runner, guard } = prisoners();
    // 이번에는 가드(뒤 자리)가 서쪽, 러너(앞 자리)가 동쪽에 갇혀 있다
    place(game, 'p2', 24.5, 15.5);
    place(game, 'p3', 23.5, 15.5);
    d.run(d.seconds(3), { p4: [0, 0, { held: BTN.RESCUE }] });
    expect(guard.status).toBe('free');
    expect(guard.move.x).toBeLessThan(runner.move.x);
  });

  it('맞은 틱의 E 누름은 구조 진행으로 치지 않는다 (진행은 그 틱 끝에 정확히 0)', () => {
    const { game, d, scout } = prisoners();
    d.run(d.seconds(2), { p4: [0, 0, { held: BTN.RESCUE }] });
    place(game, 'p1', 24, 19.8, -Math.PI / 2);
    d.run(1, { p1: [0, 0, ATTACK], p4: [0, 0, { held: BTN.RESCUE }] });
    let ticks = 0;
    while (scout.hp === 2 && ticks < 30) {
      d.run(1, { p4: [0, 0, { held: BTN.RESCUE }] });
      ticks += 1;
    }
    expect(scout.hp).toBe(1);
    expect(scout.rescueProgress).toBe(0);
  });

  it('풀려날 자리가 괴물 몸과 겹치면 예비 자리로 놓인다 (순간이동으로 몸을 통과하지 않는다)', () => {
    const { game, d, m, runner, guard } = prisoners();
    // 괴물이 기본 자리 두 곳 사이를 막고 서 있다
    place(game, 'p1', 23.6, 19.1, -Math.PI / 2);
    d.run(d.seconds(3), { p4: [0, 0, { held: BTN.RESCUE }] });
    const gap = game.balance.survivor.radius + game.balance.monster.radius;
    for (const s of [runner, guard]) {
      expect(s.status).toBe('free');
      expect(Math.hypot(s.move.x - m.move.x, s.move.y - m.move.y)).toBeGreaterThanOrEqual(gap);
      expect(s.move.y).toBeGreaterThan(PRISON_RECT.y1);
    }
  });

  it('보호 4초와 시작 대기 5초는 정확히 120틱 · 150틱 (1/30을 빼는 오차로 한 틱 늘지 않는다)', () => {
    const dt = 1 / 30;
    let protect = 4;
    for (let k = 0; k < 119; k += 1) protect = countdown(protect, dt);
    expect(protect).toBeGreaterThan(0);
    expect(countdown(protect, dt)).toBe(0);
    let frozen = 5;
    for (let k = 0; k < 150; k += 1) frozen = countdown(frozen, dt);
    expect(frozen).toBe(0);
  });

  it('보호 4초 동안은 맞지 않고, 끝나면 다시 맞는다', () => {
    const { game, d, runner } = prisoners();
    d.run(d.seconds(3), { p4: [0, 0, { held: BTN.RESCUE }] });
    place(game, 'p1', runner.move.x - 1, runner.move.y, 0);
    d.run(1, { p1: [0, 0, ATTACK] });
    d.run(d.seconds(0.4));
    expect(runner.hp).toBe(2);
    d.run(d.seconds(4));
    place(game, 'p1', runner.move.x - 1, runner.move.y, 0);
    d.run(1, { p1: [0, 0, ATTACK] });
    d.run(d.seconds(0.4));
    expect(runner.hp).toBe(1);
  });

  it('감옥이 비어 있으면 E는 아무 효과가 없다 (자유 생존자는 회복되지 않는다)', () => {
    const game = readyGame();
    const d = new Driver(game);
    const s = game.survivorById('p2')!;
    s.hp = 1;
    place(game, 'p2', 24, 18.6);
    d.run(d.seconds(3.5), { p2: [0, 0, { held: BTN.RESCUE }] });
    expect(s.hp).toBe(1);
    expect(s.rescueProgress).toBe(0);
  });
});

describe('감옥 캠핑 방지 (GAME_DESIGN 5.4)', () => {
  it('수감자가 있을 때 감옥 근처 5초 넘게 머물면 70% 속도, 3초부터 경고, 벗어나면 즉시 복구', () => {
    const game = readyGame();
    const d = new Driver(game);
    const s = game.survivorById('p2')!;
    s.status = 'imprisoned';
    place(game, 'p2', 24, 16);
    place(game, 'p3', 8, 16);
    place(game, 'p4', 8, 17);
    place(game, 'p1', 24, 20.5);
    const m = game.monster;
    d.run(d.seconds(3.1));
    expect(m.move.camp).toBeGreaterThan(3);
    d.run(d.seconds(2));
    const x0 = m.move.x;
    d.run(3, { p1: [1, 0] });
    expect(m.move.x - x0).toBeCloseTo(
      3 * game.dt * game.balance.monster.moveSpeed * game.balance.prison.campSlowMultiplier,
      4,
    );
    // 반경 밖으로 (철창 경계에서 4타일 넘게)
    place(game, 'p1', 31, 20.5);
    d.run(1, { p1: [1, 0] });
    expect(m.move.camp).toBe(0);
  });

  it('수감자가 없으면 캠핑 시간을 세지 않는다', () => {
    const game = readyGame();
    const d = new Driver(game);
    place(game, 'p1', 24, 20.5);
    d.run(d.seconds(6));
    expect(game.monster.move.camp).toBe(0);
  });
});

describe('3명 동시 수감 → 괴물 승리', () => {
  it('세 명이 모두 수감되면 즉시 괴물 승리, 시작 틱에는 승패가 나지 않는다', () => {
    const game = readyGame();
    const d = new Driver(game);
    d.run(1);
    expect(game.end).toBeNull();
    for (const s of game.survivors) s.status = 'imprisoned';
    d.run(1);
    expect(game.end?.winner).toBe('monster');
    expect(game.end?.reason).toBe('allImprisoned');
  });
});
