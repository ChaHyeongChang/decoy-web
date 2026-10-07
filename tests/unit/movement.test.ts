import { describe, expect, it } from 'vitest';
import { createMoveState, stepMovement, type MoveEnv, type MoveState } from '@decoy/shared';
import { frame, loadTestBalance } from '../helpers/fixtures';

const b = loadTestBalance();
const dt = 1 / b.network.serverTickHz;
const openFloor = { x: 30, y: 16.5 }; // 감옥 오른쪽 넓은 바닥

function env(kind: 'survivor' | 'monster', extra: Partial<MoveEnv> = {}): MoveEnv {
  return {
    kind,
    role: kind === 'survivor' ? 'runner' : null,
    mover: { kind, imprisoned: false, openExits: { N: false, S: false } },
    campActive: false,
    obstacles: [],
    ...extra,
  };
}

function run(s: MoveState, e: MoveEnv, ticks: number, mx: number, my: number, aim = Number.NaN): void {
  for (let i = 0; i < ticks; i += 1) stepMovement(s, frame(i + 1, mx, my, { aim }), e, b, dt);
}

describe('이동 속도', () => {
  it('생존자 5타일/초, 괴물 5.5타일/초 (110%)', () => {
    const s = createMoveState({ x: 20, y: 18.5 }, 0);
    run(s, env('survivor'), 30, 1, 0);
    expect(s.x - 20).toBeCloseTo(b.survivor.moveSpeed, 5);
    const m = createMoveState({ x: 20, y: 18.5 }, 0);
    run(m, env('monster'), 30, 1, 0);
    expect(m.x - 20).toBeCloseTo(b.monster.moveSpeed, 5);
    expect(b.monster.moveSpeed / b.survivor.moveSpeed).toBeCloseTo(1.1);
  });

  it('대각선 입력도 속도는 같다', () => {
    const s = createMoveState({ x: 28, y: 12.5 }, 0);
    run(s, env('survivor'), 15, 1, 1);
    expect(Math.hypot(s.x - 28, s.y - 12.5)).toBeCloseTo(b.survivor.moveSpeed / 2, 5);
  });
});

describe('충돌', () => {
  it('벽을 뚫지 않고 멈춘다 (원-타일)', () => {
    // 괴물 시작점에서 위로: y=23 벽(타일 41–46 × 23)에서 멈춘다
    const m = createMoveState({ x: 45, y: 28 }, 0);
    run(m, env('monster'), 60, 0, -1);
    expect(m.y).toBeCloseTo(24 + b.monster.radius, 3);
  });

  it('벽에 비스듬히 부딪히면 벽을 따라 미끄러진다', () => {
    const m = createMoveState({ x: 44, y: 25 }, 0);
    run(m, env('monster'), 10, -0.7071, -0.7071);
    expect(m.y).toBeCloseTo(24 + b.monster.radius, 3);
    expect(m.x).toBeLessThan(44 - 0.5);
  });

  it('생존자와 괴물은 서로 통과하지 않는다', () => {
    const s = createMoveState({ x: 28, y: 12.5 }, 0);
    const monsterBody = { x: 30, y: 12.5, r: b.monster.radius };
    run(s, env('survivor', { obstacles: [monsterBody] }), 30, 1, 0);
    expect(30 - s.x).toBeGreaterThanOrEqual(b.monster.radius + b.survivor.radius - 1e-6);
  });

  it('빠른 이동(돌진 속도)에도 1타일 벽을 뚫지 않는다', () => {
    const m = createMoveState({ x: 18, y: 9.5 }, 0); // 타일 19–20 × 8–11 벽 왼쪽
    m.dash = b.monster.dash.duration;
    m.dashLeft = b.monster.dash.distance;
    m.dashDx = 1;
    m.dashDy = 0;
    run(m, env('monster'), 10, 0, 0);
    expect(m.x).toBeLessThanOrEqual(19 - b.monster.radius + 1e-6);
  });
});

describe('괴물 시작 대기와 조준', () => {
  it('시작 대기 중에는 움직일 수 없지만 조준은 된다', () => {
    const m = createMoveState({ x: 30, y: 16.5 }, 0);
    m.frozen = b.match.monsterStartDelay;
    run(m, env('monster'), 30, -1, 0, Math.PI / 2);
    expect(m.x).toBe(30);
    expect(m.face).toBeCloseTo(Math.PI / 2, 5);
    run(m, env('monster'), Math.round(b.match.monsterStartDelay / dt), 0, 0);
    expect(m.frozen).toBe(0);
    run(m, env('monster'), 3, -1, 0);
    expect(m.x).toBeLessThan(30);
  });

  it('조준 회전은 초당 540°로 제한된다 (180° 돌리는 데 1/3초)', () => {
    const m = createMoveState(openFloor, 0);
    run(m, env('monster'), 5, 0, 0, Math.PI - 0.001);
    expect(Math.abs(m.face)).toBeCloseTo(((b.monster.aimTurnRateDeg * Math.PI) / 180) * 5 * dt, 5);
    run(m, env('monster'), 5, 0, 0, Math.PI - 0.001);
    expect(Math.abs(m.face)).toBeCloseTo(Math.PI - 0.001, 5);
  });

  it('기절 · 공격 준비 중에는 조준이 고정된다', () => {
    const m = createMoveState(openFloor, 0);
    m.stun = 0.5;
    run(m, env('monster'), 5, 1, 0, 1);
    expect(m.face).toBe(0);
    expect(m.x).toBe(openFloor.x);
    const w = createMoveState(openFloor, 0);
    w.aimLock = 0.4;
    run(w, env('monster'), 5, 0, 0, 1);
    expect(w.face).toBe(0);
  });
});

describe('괴물 회전 감속 (GAME_DESIGN 4장)', () => {
  const ticks = (s: number): number => Math.round(s / dt);

  function turned(first: [number, number], second: [number, number], gapTicks = 0): MoveState {
    const m = createMoveState({ x: 30, y: 13 }, 0);
    const e = env('monster');
    run(m, e, 10, first[0], first[1]);
    if (gapTicks > 0) run(m, e, gapTicks, 0, 0);
    run(m, e, 1, second[0], second[1]);
    return m;
  }

  it('반대 방향(180°)으로 틀면 0.35초 동안 60% 속도', () => {
    const m = turned([1, 0], [-1, 0]);
    expect(m.turnSlow).toBeGreaterThan(0);
    const x0 = m.x;
    const e = env('monster');
    run(m, e, 3, -1, 0);
    expect(x0 - m.x).toBeCloseTo(3 * dt * b.monster.moveSpeed * b.monster.turnSlowMultiplier, 5);
    run(m, e, ticks(b.monster.turnSlowDuration), -1, 0);
    expect(m.turnSlow).toBe(0);
  });

  it('135°로 틀어도 감속', () => {
    expect(turned([1, 0], [-0.7071, 0.7071]).turnSlow).toBeGreaterThan(0);
  });

  it('정확히 90°는 감속하지 않는다 ("90° 넘게")', () => {
    expect(turned([1, 0], [0, 1]).turnSlow).toBe(0);
  });

  it('45°씩 굴려도 0.25초 안에 90°를 넘게 돌면 감속 (대각선 우회 차단)', () => {
    const m = createMoveState({ x: 30, y: 13 }, 0);
    const e = env('monster');
    run(m, e, 10, 1, 0);
    run(m, e, 1, 0.7071, 0.7071);
    run(m, e, 1, 0, 1);
    expect(m.turnSlow).toBe(0);
    run(m, e, 1, -0.7071, 0.7071);
    expect(m.turnSlow).toBeGreaterThan(0);
  });

  it('키를 잠깐 떼었다 반대로 눌러도 감속 (입력 0 틱 우회 차단)', () => {
    expect(turned([1, 0], [-1, 0], 2).turnSlow).toBeGreaterThan(0);
  });

  it('충분히 멈춘 뒤 방향을 바꾸면 감속하지 않는다', () => {
    expect(turned([1, 0], [-1, 0], ticks(b.monster.turnSlowWindow) + 2).turnSlow).toBe(0);
  });

  it('생존자는 회전 감속이 없다', () => {
    const s = createMoveState({ x: 30, y: 13 }, 0);
    run(s, env('survivor'), 5, 1, 0);
    const x0 = s.x;
    run(s, env('survivor'), 1, -1, 0);
    expect(x0 - s.x).toBeCloseTo(dt * b.survivor.moveSpeed, 6);
  });
});
