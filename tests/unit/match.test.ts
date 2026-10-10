// 승패 조건 표 (GAME_DESIGN 9장)의 모든 줄 + DECISIONS 보충 규칙
import { describe, expect, it } from 'vitest';
import { applyDropExpired, buildResult, endingOf, evaluate, matchTick } from '@decoy/shared/sim';
import { Driver, readyGame } from '../helpers/fixtures';

function setStatus(
  game: ReturnType<typeof readyGame>,
  map: Record<string, 'free' | 'imprisoned' | 'dead' | 'escaped'>,
): void {
  for (const [id, st] of Object.entries(map)) game.survivorById(id)!.status = st;
}

describe('승패 조건', () => {
  it('생존자 2명 탈출 → 생존자 승리 확정, 남은 자유 생존자에게 최후의 30초 (12분 타이머 정지)', () => {
    const game = readyGame();
    setStatus(game, { p2: 'escaped', p3: 'escaped' });
    const t0 = game.timeLeft;
    matchTick(game);
    expect(game.end).toBeNull();
    expect(game.grace).toBeCloseTo(game.balance.match.lastSurvivorGrace - game.dt, 6);
    const d = new Driver(game);
    d.run(10);
    expect(game.timeLeft).toBeCloseTo(t0, 6);
    d.run(d.seconds(30));
    expect(game.end?.winner).toBe('survivors');
    const r = buildResult(game);
    expect(r.grade).toBe('success');
    expect(r.ending).toBe('END_TWO');
  });

  it('최후의 30초 안에 세 번째가 탈출하면 "완전 탈출"', () => {
    const game = readyGame();
    setStatus(game, { p2: 'escaped', p3: 'escaped' });
    matchTick(game);
    setStatus(game, { p4: 'escaped' });
    matchTick(game);
    expect(game.end?.winner).toBe('survivors');
    expect(buildResult(game).grade).toBe('full');
    expect(endingOf(game)).toBe('END_ALL');
  });

  it('최후의 30초 중 남은 생존자가 잡히면 바로 끝난다 ("탈출 성공")', () => {
    const game = readyGame();
    setStatus(game, { p2: 'escaped', p3: 'escaped' });
    matchTick(game);
    setStatus(game, { p4: 'imprisoned' });
    matchTick(game);
    expect(game.end?.winner).toBe('survivors');
    expect(buildResult(game).grade).toBe('success');
  });

  it('2명이 탈출한 순간 남은 생존자가 이미 수감 · 사망이면 기다리지 않고 끝난다', () => {
    const game = readyGame();
    setStatus(game, { p2: 'escaped', p3: 'escaped', p4: 'dead' });
    matchTick(game);
    expect(game.end?.winner).toBe('survivors');
  });

  it('생존자 2명 이상 사망 → 괴물 승리', () => {
    const game = readyGame();
    setStatus(game, { p2: 'dead', p3: 'dead' });
    evaluate(game);
    expect(game.end).toMatchObject({ winner: 'monster', reason: 'deaths' });
    expect(endingOf(game)).toBe('END_MONSTER');
    expect(buildResult(game).grade).toBe('fail');
  });

  it('생존자 3명 동시 수감 → 괴물 승리', () => {
    const game = readyGame();
    setStatus(game, { p2: 'imprisoned', p3: 'imprisoned', p4: 'imprisoned' });
    evaluate(game);
    expect(game.end).toMatchObject({ winner: 'monster', reason: 'allImprisoned' });
  });

  it('자유 생존자 0명(1명 사망 + 2명 수감, 1명 탈출 + 2명 수감) → 괴물 승리', () => {
    const a = readyGame();
    setStatus(a, { p2: 'dead', p3: 'imprisoned', p4: 'imprisoned' });
    evaluate(a);
    expect(a.end).toMatchObject({ winner: 'monster', reason: 'noFreeSurvivors' });
    const b = readyGame();
    setStatus(b, { p2: 'escaped', p3: 'imprisoned', p4: 'imprisoned' });
    evaluate(b);
    expect(b.end?.winner).toBe('monster');
    expect(endingOf(b)).toBe('END_MONSTER');
  });

  it('1명 사망만으로는 끝나지 않는다', () => {
    const game = readyGame();
    setStatus(game, { p2: 'dead' });
    evaluate(game);
    expect(game.end).toBeNull();
  });

  it('12분 경과 → 탈출 못 한 생존자 사망 처리 → 괴물 승리 (탈출 0명이면 END_TIMEOUT)', () => {
    const game = readyGame();
    game.timeLeft = game.dt * 3;
    const d = new Driver(game);
    d.run(5);
    expect(game.end).toMatchObject({ winner: 'monster', reason: 'timeout' });
    expect(game.survivors.every((s) => s.status === 'dead')).toBe(true);
    expect(endingOf(game)).toBe('END_TIMEOUT');
  });

  it('12분 타이머가 0이 되는 바로 그 틱에 끝난다 (한 틱 더 진행하지 않는다)', () => {
    const game = readyGame();
    game.timeLeft = game.dt * 3;
    const d = new Driver(game);
    d.run(2);
    expect(game.end).toBeNull();
    d.run(1);
    expect(game.timeLeft).toBe(0);
    expect(game.end).toMatchObject({ winner: 'monster', reason: 'timeout' });
  });

  it('1명 탈출 뒤 시간 초과면 결말은 END_MONSTER', () => {
    const game = readyGame();
    setStatus(game, { p2: 'escaped' });
    game.timeLeft = game.dt;
    new Driver(game).run(3);
    expect(game.end?.winner).toBe('monster');
    expect(endingOf(game)).toBe('END_MONSTER');
  });

  it('괴물 접속 끊김(유예 만료) → 판 무효', () => {
    const game = readyGame();
    applyDropExpired(game, 'p1');
    expect(game.end).toMatchObject({ winner: 'void', reason: 'monsterLeft' });
    expect(buildResult(game).grade).toBeNull();
    expect(endingOf(game)).toBe('END_VOID');
  });

  it('생존자 접속 끊김(유예 만료) → 사망 처리 후 판정', () => {
    const game = readyGame();
    applyDropExpired(game, 'p2');
    expect(game.survivorById('p2')!.status).toBe('dead');
    expect(game.end).toBeNull();
    applyDropExpired(game, 'p3');
    expect(game.end?.winner).toBe('monster');
  });

  it('결과에는 플레이어별 기록이 들어 있다', () => {
    const game = readyGame();
    game.survivorById('p2')!.stats.hitsTaken = 2;
    setStatus(game, { p2: 'dead', p3: 'dead' });
    evaluate(game);
    const r = buildResult(game);
    expect(r.players).toHaveLength(4);
    expect(r.players.find((p) => p.id === 'p2')).toMatchObject({ hitsTaken: 2, status: 'dead' });
  });
});
