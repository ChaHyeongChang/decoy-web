// 입력 → 이동. 서버 시뮬레이션과 클라이언트 예측이 이 함수 하나를 같이 쓴다.
// 이동에 영향을 주는 모든 타이머(질주, 기절, 돌진, 회전 감속, 캠핑, 시작 대기, 공격 준비)는
// MoveState 안에 있고 여기서만 줄어든다. 그래서 보정 때 서버 상태에서 입력을 다시 적용하면
// 서버와 같은 결과가 나온다. 능력 '발동'은 서버가 MoveState 값을 설정하는 것으로 반영된다.
import type { Balance, RoleId } from './balance';
import {
  DEG,
  angleBetweenDirs,
  resolveCircleVsCircles,
  resolveCircleVsTiles,
  turnToward,
  type Circle,
  type Vec2,
} from './geometry';
import { PRISON_RECT, blocksMove, distToRect, type MoverContext } from './map';
import type { InputFrame } from './types';

export interface MoveState {
  x: number;
  y: number;
  /** 생존자: 바라보는(이동) 방향, 괴물: 조준 방향(회전 상한 적용 후). 라디안 */
  face: number;
  /** 괴물 시작 대기 남은 시간 (이동 불가, 조준은 가능) */
  frozen: number;
  /** 기절 남은 시간 (이동 · 조준 불가) */
  stun: number;
  /** 돌진 남은 시간과 남은 거리, 방향 */
  dash: number;
  dashLeft: number;
  dashDx: number;
  dashDy: number;
  /** 공격 준비 중 조준 고정 남은 시간 */
  aimLock: number;
  /** 러너 질주 남은 시간 */
  sprint: number;
  /** 회전 감속 남은 시간 */
  turnSlow: number;
  /** 최근 0이 아닌 입력 방향 기록 [dx, dy, age, dx, dy, age, …] */
  dirHist: number[];
  /** 감옥 캠핑 반경 안에 머문 시간 */
  camp: number;
}

export interface MoveEnv {
  kind: 'survivor' | 'monster';
  role: RoleId | null;
  mover: MoverContext;
  /** 캠핑 시간을 셀지 (수감자가 있을 때만) */
  campActive: boolean;
  /** 통과할 수 없는 다른 몸들 (이 틱 시작 위치의 정지한 원) */
  obstacles: readonly Circle[];
}

/** 한 번에 움직이는 최대 거리 (벽을 뚫지 않게) */
const MAX_SUBSTEP = 0.2;

export function createMoveState(pos: Vec2, face: number): MoveState {
  return {
    x: pos.x,
    y: pos.y,
    face,
    frozen: 0,
    stun: 0,
    dash: 0,
    dashLeft: 0,
    dashDx: 0,
    dashDy: 0,
    aimLock: 0,
    sprint: 0,
    turnSlow: 0,
    dirHist: [],
    camp: 0,
  };
}

export function cloneMoveState(s: MoveState): MoveState {
  return { ...s, dirHist: s.dirHist.slice() };
}

export function bodyRadius(kind: 'survivor' | 'monster', balance: Balance): number {
  return kind === 'monster' ? balance.monster.radius : balance.survivor.radius;
}

/** 입력 벡터를 길이 1 이하로 */
export function normalizeMove(mx: number, my: number): Vec2 {
  const len = Math.hypot(mx, my);
  if (len < 1e-6) return { x: 0, y: 0 };
  return len > 1 ? { x: mx / len, y: my / len } : { x: mx, y: my };
}

/** 괴물 이동 속도 배율 (회전 감속 · 캠핑 감속 · 공격 준비) */
export function monsterSpeedMultiplier(s: MoveState, env: MoveEnv, balance: Balance): number {
  let mult = 1;
  if (s.turnSlow > 0) mult *= balance.monster.turnSlowMultiplier;
  if (env.campActive && s.camp > balance.prison.campGrace) mult *= balance.prison.campSlowMultiplier;
  if (s.aimLock > 0) mult *= balance.monster.attack.windupMoveMultiplier;
  return mult;
}

/** 원 하나를 (dx, dy)만큼 움직인다. 막히면 미끄러지고, 막혔는지 돌려준다 */
function moveBody(
  s: MoveState,
  dx: number,
  dy: number,
  radius: number,
  env: MoveEnv,
): { blocked: boolean; moved: number } {
  const total = Math.hypot(dx, dy);
  if (total < 1e-12) return { blocked: false, moved: 0 };
  const steps = Math.max(1, Math.ceil(total / MAX_SUBSTEP));
  const sx = dx / steps;
  const sy = dy / steps;
  const blockedTile = (i: number, j: number): boolean => blocksMove(i, j, env.mover);
  let blocked = false;
  let moved = 0;
  for (let k = 0; k < steps; k += 1) {
    const want = { x: s.x + sx, y: s.y + sy };
    let p = resolveCircleVsTiles(want, radius, blockedTile);
    p = resolveCircleVsCircles(p, radius, env.obstacles);
    p = resolveCircleVsTiles(p, radius, blockedTile);
    const err = Math.hypot(p.x - want.x, p.y - want.y);
    moved += Math.hypot(p.x - s.x, p.y - s.y);
    s.x = p.x;
    s.y = p.y;
    if (err > 1e-6) blocked = true;
  }
  return { blocked, moved };
}

/**
 * 한 틱(dt) 이동. s를 직접 바꾼다.
 * 순서: 조준 → 돌진 또는 일반 이동(회전 감속 판정 포함) → 타이머 감소 → 캠핑 시간
 */
export function stepMovement(
  s: MoveState,
  input: InputFrame,
  env: MoveEnv,
  balance: Balance,
  dt: number,
): void {
  const m = balance.monster;
  const radius = bodyRadius(env.kind, balance);

  // 조준 (괴물): 기절 · 공격 준비 중에는 고정
  if (env.kind === 'monster' && s.stun <= 0 && s.aimLock <= 0 && Number.isFinite(input.aim)) {
    s.face = turnToward(s.face, input.aim, m.aimTurnRateDeg * DEG * dt);
  }

  if (env.kind === 'monster' && s.dash > 0 && s.stun <= 0) {
    // 돌진: 입력 이동은 무시, 감속 배율 적용 안 함. 벽이나 몸에 닿으면 그 자리에서 끝
    const speed = m.dash.distance / m.dash.duration;
    const want = Math.min(s.dashLeft, speed * dt);
    const r = moveBody(s, s.dashDx * want, s.dashDy * want, radius, env);
    s.dashLeft -= r.moved;
    s.dash -= dt;
    if (r.blocked || s.dash <= 1e-9 || s.dashLeft <= 1e-6) {
      s.dash = 0;
      s.dashLeft = 0;
    }
  } else if (s.stun <= 0 && s.frozen <= 0) {
    const dir = normalizeMove(input.mx, input.my);
    const moving = dir.x !== 0 || dir.y !== 0;
    let speed: number;
    if (env.kind === 'monster') {
      if (moving) {
        const len = Math.hypot(dir.x, dir.y);
        const ux = dir.x / len;
        const uy = dir.y / len;
        // 회전 감속: 최근 기록 중 하나라도 turnSlowAngle을 넘게 차이 나면 발동
        const limit = m.turnSlowAngle * DEG;
        for (let k = 0; k + 2 < s.dirHist.length; k += 3) {
          const hx = s.dirHist[k] ?? 0;
          const hy = s.dirHist[k + 1] ?? 0;
          if (angleBetweenDirs(ux, uy, hx, hy) > limit + 1e-6) {
            s.turnSlow = m.turnSlowDuration;
            s.dirHist.length = 0;
            break;
          }
        }
        s.dirHist.push(ux, uy, 0);
      }
      speed = m.moveSpeed * monsterSpeedMultiplier(s, env, balance);
    } else {
      speed = balance.survivor.moveSpeed;
      if (s.sprint > 0 && env.role === 'runner') speed *= balance.roles.runner.sprintMultiplier;
      if (moving) s.face = Math.atan2(dir.y, dir.x);
    }
    if (moving) moveBody(s, dir.x * speed * dt, dir.y * speed * dt, radius, env);
  }

  // 타이머 감소 (남은 시간 > 0인 틱까지 효과 유지)
  s.frozen = Math.max(0, s.frozen - dt);
  s.stun = Math.max(0, s.stun - dt);
  s.aimLock = Math.max(0, s.aimLock - dt);
  s.sprint = Math.max(0, s.sprint - dt);
  s.turnSlow = Math.max(0, s.turnSlow - dt);
  if (s.dirHist.length > 0) {
    const kept: number[] = [];
    for (let k = 0; k + 2 < s.dirHist.length; k += 3) {
      const age = (s.dirHist[k + 2] ?? 0) + dt;
      if (age < m.turnSlowWindow - 1e-9) kept.push(s.dirHist[k] ?? 0, s.dirHist[k + 1] ?? 0, age);
    }
    s.dirHist = kept;
  }

  // 감옥 캠핑 시간 (괴물, 수감자가 있을 때만, 철창 바깥 경계에서 campRadius 이내)
  if (env.kind === 'monster') {
    const inside = env.campActive && distToRect(s, PRISON_RECT) <= balance.prison.campRadius;
    s.camp = inside ? s.camp + dt : 0;
  }
}
