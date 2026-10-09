// 터치 입력 상태 기계 (M11, MOBILE_PLAN M11 5번 조작 규칙): 손가락별 추적 · 데드존 · 길이 1 · 조준 스틱 발사 대기 ·
// 짧은 탭 · 취소 · 돌진 끌기 · 탭 · 누르기 버튼 · 취소 이벤트
import { describe, expect, it } from 'vitest';
import { BTN, DEG, angleDiff, turnToward } from '@decoy/shared';
import { TOUCH, TouchInput, type TouchFrameCtx } from '../../client/src/touchInput';

const FRAME_MS = 1000 / 30;
/** 괴물 조준 회전 (balance.json monster.aimTurnRateDeg = 540) 한 프레임 */
const TURN_STEP = 540 * DEG * (FRAME_MS / 1000);

const ctx = (nowMs: number, face = 0, canAttack = true, canDash = true): TouchFrameCtx => ({
  nowMs,
  face,
  canAttack,
  canDash,
});

/** 한 입력 프레임 (InputSampler와 같은 순서: takePressed 먼저, 그다음 aimAngle) */
function frame(t: TouchInput, c: TouchFrameCtx): { pressed: number; aim: number | null } {
  const pressed = t.takePressed(c);
  return { pressed, aim: t.aimAngle(c) };
}

/**
 * 예측처럼 face를 돌리며 n프레임 진행한다: aim 쪽으로 프레임마다 최대 18°, 공격을 낸 뒤에는 조준 고정.
 * turn = false면 face가 돌지 않는다 (0.35초 상한 확인용)
 */
function run(
  t: TouchInput,
  start: { nowMs: number; face: number },
  n: number,
  opts: { turn?: boolean; canAttack?: boolean; canDash?: boolean } = {},
): {
  frames: { pressed: number; aim: number | null; face: number; nowMs: number }[];
  face: number;
  nowMs: number;
} {
  let { nowMs, face } = start;
  let locked = false;
  const frames: { pressed: number; aim: number | null; face: number; nowMs: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    nowMs += FRAME_MS;
    const c = ctx(nowMs, face, opts.canAttack ?? true, opts.canDash ?? true);
    const f = frame(t, c);
    frames.push({ ...f, face, nowMs });
    if ((f.pressed & BTN.ATTACK) !== 0) locked = true;
    if (!locked && (opts.turn ?? true) && f.aim !== null) face = turnToward(face, f.aim, TURN_STEP);
  }
  return { frames, face, nowMs };
}

const count = (frames: { pressed: number }[], bit: number): number =>
  frames.filter((f) => (f.pressed & bit) !== 0).length;

describe('터치 입력: 손가락 · 데드존 · 이동', () => {
  it('데드존 15% 안은 (0,0), 밖은 방향 그대로 길이 1 (360°, 8방향으로 자르지 않음)', () => {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    expect(t.moveVector()).toEqual({ x: 0, y: 0 });
    t.stickMove(1, 0.1, 0.1); // 길이 0.141
    expect(t.moveVector()).toEqual({ x: 0, y: 0 });
    t.stickMove(1, TOUCH.deadZone, 0); // 경계는 안
    expect(t.moveVector()).toEqual({ x: 0, y: 0 });
    t.stickMove(1, 0.2, 0);
    expect(t.moveVector()).toEqual({ x: 1, y: 0 });
    t.stickMove(1, 0.3, -0.4);
    const v = t.moveVector();
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 12);
    expect(v.x).toBeCloseTo(0.6, 12);
    expect(v.y).toBeCloseTo(-0.8, 12);
    // 17° 같은 사잇각도 그대로 (키보드는 45° 단위)
    const a = 17 * DEG;
    t.stickMove(1, Math.cos(a) * 0.5, Math.sin(a) * 0.5);
    const w = t.moveVector();
    expect(Math.atan2(w.y, w.x)).toBeCloseTo(a, 12);
    expect(Math.hypot(w.x, w.y)).toBeCloseTo(1, 12);
  });

  it('스틱 가장자리를 넘어도 길이 1로 자른다', () => {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 3, 4);
    const v = t.moveVector();
    expect(v.x).toBeCloseTo(0.6, 12);
    expect(v.y).toBeCloseTo(0.8, 12);
  });

  it('손가락별로 따로 추적한다: 조준 스틱을 움직여도 이동은 그대로, 이동 손가락을 떼도 조준은 그대로', () => {
    const t = new TouchInput();
    t.stickStart(7, 'move', 0);
    t.stickMove(7, 0, -1);
    t.stickStart(9, 'aim', 10);
    t.stickMove(9, 1, 0);
    expect(t.moveVector()).toEqual({ x: 0, y: -1 });
    expect(frame(t, ctx(20, Math.PI / 2)).aim).toBe(0);
    t.stickMove(9, -1, 0);
    expect(t.moveVector()).toEqual({ x: 0, y: -1 });
    t.stickEnd(7, 30);
    expect(t.moveVector()).toEqual({ x: 0, y: 0 });
    expect(frame(t, ctx(40, Math.PI)).aim).toBe(Math.PI);
    // 모르는 손가락의 움직임 · 뗌은 무시
    t.stickMove(99, 1, 1);
    t.stickEnd(99, 50);
    expect(t.moveVector()).toEqual({ x: 0, y: 0 });
  });

  it('이동 손가락이 둘이면 나중 것을 쓰고, 그 손가락을 떼면 남은 손가락으로 돌아간다', () => {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 1, 0);
    t.stickStart(2, 'move', 5);
    t.stickMove(2, 0, 1);
    expect(t.moveVector()).toEqual({ x: 0, y: 1 });
    t.stickEnd(2, 10);
    expect(t.moveVector()).toEqual({ x: 1, y: 0 });
  });

  it('이동 스틱만 끌어도 ATTACK · DASH · MODE는 나가지 않는다 (오입력 회귀)', () => {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 0.7, -0.7);
    const r = run(t, { nowMs: 0, face: 0 }, 60);
    t.stickEnd(1, r.nowMs);
    const r2 = run(t, r, 30);
    expect([...r.frames, ...r2.frames].every((f) => f.pressed === 0)).toBe(true);
  });
});

describe('터치 입력: 조준 스틱 발사 대기', () => {
  it('계획의 수치 그대로: 데드존 15% · ±10° · 발사 대기 최대 0.35초 · 짧은 탭 0.25초 (MOBILE_PLAN M11 5번)', () => {
    expect(TOUCH).toMatchObject({ deadZone: 0.15, maxFireWaitMs: 350, shortTapMs: 250 });
    expect(TOUCH.aimTolerance).toBeCloseTo(10 * DEG, 12);
  });

  /** 조준 스틱을 각도 theta 쪽으로 끌어 둔 상태 (face는 아직 그대로). 스틱이 정한 각도(atan2)를 돌려준다 */
  function aimAt(t: TouchInput, theta: number, nowMs = 0, id = 5): number {
    const x = Math.cos(theta) * 0.8;
    const y = Math.sin(theta) * 0.8;
    t.stickStart(id, 'aim', nowMs);
    t.stickMove(id, x, y);
    return Math.atan2(y, x);
  }

  it('예측 face가 이미 θ ±10° 안이면 뗀 다음 프레임에 ATTACK 정확히 1번, 그 프레임 aim = θ', () => {
    const t = new TouchInput();
    const theta = aimAt(t, 30 * DEG);
    t.stickEnd(5, 100);
    const r = run(t, { nowMs: 100, face: theta + 9 * DEG }, 20, { turn: false });
    expect(count(r.frames, BTN.ATTACK)).toBe(1);
    expect(r.frames[0]!.pressed).toBe(BTN.ATTACK);
    expect(r.frames[0]!.aim).toBe(theta);
  });

  it('face가 멀면 수렴하는 프레임에 ATTACK 정확히 1번 (그 전까지 aim = θ)', () => {
    const t = new TouchInput();
    const theta = aimAt(t, 120 * DEG);
    t.stickEnd(5, 0);
    const r = run(t, { nowMs: 0, face: -30 * DEG }, 30);
    expect(count(r.frames, BTN.ATTACK)).toBe(1);
    const k = r.frames.findIndex((f) => (f.pressed & BTN.ATTACK) !== 0);
    // 150° 차이: 18°씩 돌아 8프레임 뒤 ±10° 안 (0.35초 = 10.5프레임보다 먼저)
    expect(k).toBe(8);
    expect(Math.abs(angleDiff(r.frames[k]!.face, theta))).toBeLessThanOrEqual(TOUCH.aimTolerance);
    for (let i = 0; i <= k; i += 1) expect(r.frames[i]!.aim).toBe(theta);
    expect(r.frames[k - 1]!.nowMs).toBeLessThan(TOUCH.maxFireWaitMs);
  });

  it('face가 따라오지 못해도 0.35초에 ATTACK 정확히 1번', () => {
    const t = new TouchInput();
    const theta = Math.PI;
    aimAt(t, theta);
    t.stickEnd(5, 1000);
    const r = run(t, { nowMs: 1000, face: 0 }, 30, { turn: false });
    expect(count(r.frames, BTN.ATTACK)).toBe(1);
    const fired = r.frames.find((f) => (f.pressed & BTN.ATTACK) !== 0)!;
    expect(fired.nowMs - 1000).toBeGreaterThanOrEqual(350);
    expect(fired.nowMs - 1000).toBeLessThan(350 + FRAME_MS);
  });

  it('데드존 안에서는 aim을 갱신하지 않고 마지막 바깥 각도를 유지한다', () => {
    const t = new TouchInput();
    const theta = aimAt(t, 45 * DEG);
    expect(theta).toBeCloseTo(45 * DEG, 12);
    t.stickMove(5, 0.05, -0.05);
    expect(frame(t, ctx(10)).aim).toBe(theta);
    t.stickMove(5, -0.1, 0);
    expect(frame(t, ctx(20)).aim).toBe(theta);
  });

  it('조준 중 가운데(데드존)로 돌아와 떼면 취소: ATTACK 0번', () => {
    const t = new TouchInput();
    aimAt(t, 60 * DEG);
    t.stickMove(5, 0.05, 0);
    t.stickEnd(5, 500);
    const r = run(t, { nowMs: 500, face: 60 * DEG }, 40);
    expect(count(r.frames, BTN.ATTACK)).toBe(0);
  });

  it('데드존을 벗어나지 않고 0.25초 안에 떼면(짧은 탭) 지금 방향으로 ATTACK 1번, 더 길게 누르면 0번', () => {
    const tap = new TouchInput();
    tap.stickStart(5, 'aim', 0);
    tap.stickMove(5, 0.05, 0.05);
    tap.stickEnd(5, TOUCH.shortTapMs - 10);
    const r = run(tap, { nowMs: 240, face: 1.0 }, 20, { turn: false });
    expect(count(r.frames, BTN.ATTACK)).toBe(1);
    expect(r.frames[0]!.pressed).toBe(BTN.ATTACK);

    const long = new TouchInput();
    long.stickStart(5, 'aim', 0);
    long.stickEnd(5, 400);
    expect(count(run(long, { nowMs: 400, face: 1.0 }, 20).frames, BTN.ATTACK)).toBe(0);
  });

  it('발사 대기 동안 이동 입력이 있어도 aim = θ, ATTACK을 낸 다음 프레임부터 이동 방향', () => {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 0, -1); // 위 (-90°)
    const theta = aimAt(t, 10 * DEG, 0, 2);
    t.stickEnd(2, 50);
    const r = run(t, { nowMs: 50, face: -150 * DEG }, 20);
    const k = r.frames.findIndex((f) => (f.pressed & BTN.ATTACK) !== 0);
    expect(k).toBeGreaterThan(0);
    for (let i = 0; i <= k; i += 1) expect(r.frames[i]!.aim).toBe(theta);
    expect(r.frames[k + 1]!.aim).toBe(-Math.PI / 2);
    expect(count(r.frames, BTN.ATTACK)).toBe(1);
  });

  it('쿨타임 · 행동 불가(canAttack 거짓)면 발사 대기에 들어가지 않는다: 나중에 가능해져도 ATTACK 0번, aim도 θ에 묶이지 않음', () => {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 1, 0);
    aimAt(t, Math.PI / 2, 0, 2);
    t.stickEnd(2, 100);
    const blocked = run(t, { nowMs: 100, face: 0 }, 1, { canAttack: false });
    expect(blocked.frames[0]!.pressed).toBe(0);
    expect(blocked.frames[0]!.aim).toBe(0); // 이동 방향
    const later = run(t, blocked, 30, { canAttack: true });
    expect(count(later.frames, BTN.ATTACK)).toBe(0);
    // 짧은 탭도 할 수 없는 순간이면 보내지 않는다
    const tap = new TouchInput();
    tap.stickStart(3, 'aim', 0);
    tap.stickEnd(3, 100);
    const r = run(tap, { nowMs: 100, face: 0 }, 1, { canAttack: false });
    const r2 = run(tap, r, 20);
    expect(count([...r.frames, ...r2.frames], BTN.ATTACK)).toBe(0);
  });

  it('기다리는 동안 행동 불가가 되면(기절) 내지 않고 버린다', () => {
    const t = new TouchInput();
    aimAt(t, Math.PI);
    t.stickEnd(5, 0);
    const a = run(t, { nowMs: 0, face: 0 }, 3, { turn: false });
    const b = run(t, a, 1, { canAttack: false });
    const c = run(t, b, 30);
    expect(count([...a.frames, ...b.frames, ...c.frames], BTN.ATTACK)).toBe(0);
  });
});

describe('터치 입력: 조준 방향 (스틱을 놓고 있을 때)', () => {
  it('아직 아무것도 정하지 않았으면 null (마우스 조준을 쓴다)', () => {
    const t = new TouchInput();
    expect(frame(t, ctx(0, 1.2)).aim).toBeNull();
  });

  it('이동 방향을 보고, 멈추면 마지막 방향을 유지한다', () => {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, -1, 0);
    expect(frame(t, ctx(10)).aim).toBe(Math.PI);
    t.stickMove(1, 0.05, 0); // 데드존: 멈춤
    expect(frame(t, ctx(20)).aim).toBe(Math.PI);
    t.stickEnd(1, 30);
    expect(frame(t, ctx(40)).aim).toBe(Math.PI);
  });

  it('조준 스틱으로 공격한 뒤 멈춰 있으면 마지막 조준 방향을 계속 본다', () => {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 1, 0);
    t.stickEnd(1, 10);
    t.stickStart(2, 'aim', 20);
    t.stickMove(2, 0, 1);
    t.stickEnd(2, 30);
    const r = run(t, { nowMs: 30, face: Math.PI / 2 }, 5);
    expect(r.frames.every((f) => f.aim === Math.PI / 2)).toBe(true);
  });
});

describe('터치 입력: 돌진 버튼', () => {
  it('끌어서 놓으면 끈 방향으로 발사 대기를 거쳐 DASH 1번: 위로 이동하면서 오른쪽(90° 다른 쪽)으로', () => {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 0, -1);
    // 움직이는 동안 이동 방향을 보고 있었다
    let s = run(t, { nowMs: 0, face: 0 }, 10);
    expect(s.face).toBe(-Math.PI / 2);
    t.stickStart(2, 'dash', s.nowMs);
    t.stickMove(2, 0.6, 0);
    s = run(t, s, 2);
    expect(s.frames.every((f) => f.aim === 0 && f.pressed === 0)).toBe(true);
    t.stickEnd(2, s.nowMs);
    const r = run(t, s, 20);
    expect(count(r.frames, BTN.DASH)).toBe(1);
    const k = r.frames.findIndex((f) => (f.pressed & BTN.DASH) !== 0);
    expect(r.frames[k]!.aim).toBe(0);
    expect(Math.abs(angleDiff(r.frames[k]!.face, 0))).toBeLessThanOrEqual(TOUCH.aimTolerance);
    expect(t.moveVector()).toEqual({ x: 0, y: -1 }); // 이동은 계속
    expect(count(r.frames, BTN.ATTACK)).toBe(0);
  });

  it('끌지 않고 떼면 지금 방향으로 바로 DASH (다음 프레임)', () => {
    const t = new TouchInput();
    t.stickStart(2, 'dash', 0);
    t.stickEnd(2, 600); // 오래 눌러도 끌지 않았으면 탭
    const r = run(t, { nowMs: 600, face: 2 }, 10, { turn: false });
    expect(r.frames[0]!.pressed).toBe(BTN.DASH);
    expect(count(r.frames, BTN.DASH)).toBe(1);
  });

  it('다른 손가락으로 조준 스틱을 잡고 있으면 그 각도로 DASH', () => {
    const t = new TouchInput();
    const theta = -100 * DEG;
    t.stickStart(1, 'aim', 0);
    t.stickMove(1, Math.cos(theta), Math.sin(theta));
    t.stickStart(2, 'dash', 10);
    t.stickEnd(2, 20);
    const r = run(t, { nowMs: 20, face: 0 }, 20);
    const k = r.frames.findIndex((f) => (f.pressed & BTN.DASH) !== 0);
    expect(k).toBeGreaterThan(0);
    expect(r.frames[k]!.aim).toBe(theta);
    expect(Math.abs(angleDiff(r.frames[k]!.face, theta))).toBeLessThanOrEqual(TOUCH.aimTolerance);
    expect(count(r.frames, BTN.DASH)).toBe(1);
    expect(count(r.frames, BTN.ATTACK)).toBe(0); // 조준 스틱은 아직 잡고 있다
  });

  it('끌었다가 가운데로 돌아와 떼면 취소 (조준 스틱과 같게)', () => {
    const t = new TouchInput();
    t.stickStart(2, 'dash', 0);
    t.stickMove(2, 0, 1);
    t.stickMove(2, 0.02, 0.02);
    t.stickEnd(2, 100);
    expect(count(run(t, { nowMs: 100, face: 0 }, 20).frames, BTN.DASH)).toBe(0);
  });

  it('canDash가 거짓이면 보내지 않는다 (탭 · 끌기 모두)', () => {
    const t = new TouchInput();
    t.stickStart(2, 'dash', 0);
    t.stickEnd(2, 10);
    t.stickStart(3, 'dash', 20);
    t.stickMove(3, 1, 0);
    t.stickEnd(3, 30);
    const r = run(t, { nowMs: 30, face: 0 }, 1, { canDash: false });
    const r2 = run(t, r, 20);
    expect(count([...r.frames, ...r2.frames], BTN.DASH)).toBe(0);
  });
});

describe('터치 입력: 탭 · 누르기 버튼', () => {
  it('탭(포효 · 시야 모드 · 능력)은 다음 프레임 pressed 한 번', () => {
    const t = new TouchInput();
    t.tap(BTN.ROAR);
    t.tap(BTN.MODE);
    expect(t.takePressed(ctx(0))).toBe(BTN.ROAR | BTN.MODE);
    expect(t.takePressed(ctx(33))).toBe(0);
    t.tap(BTN.ABILITY);
    expect(t.takePressed(ctx(66))).toBe(BTN.ABILITY);
    expect(t.heldBits()).toBe(0);
  });

  it('구조는 누르는 동안 held RESCUE, 누른 순간 pressed 한 번', () => {
    const t = new TouchInput();
    t.hold(BTN.RESCUE, true);
    expect(t.takePressed(ctx(0))).toBe(BTN.RESCUE);
    expect(t.heldBits()).toBe(BTN.RESCUE);
    expect(t.takePressed(ctx(33))).toBe(0);
    expect(t.heldBits()).toBe(BTN.RESCUE);
    t.hold(BTN.RESCUE, false);
    expect(t.heldBits()).toBe(0);
  });
});

describe('터치 입력: 취소 이벤트마다 이동 · RESCUE 0, 발사하지 않음', () => {
  function busy(): TouchInput {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 1, 0);
    t.hold(BTN.RESCUE, true);
    t.takePressed(ctx(0));
    t.stickStart(2, 'aim', 0);
    t.stickMove(2, 0, 1);
    return t;
  }

  it('stickCancel(이동 손가락): 이동 0 · RESCUE 0', () => {
    const t = busy();
    t.stickCancel(1);
    expect(t.moveVector()).toEqual({ x: 0, y: 0 });
    expect(t.heldBits()).toBe(0);
  });

  it('stickCancel(조준 손가락): 조준 중이어도 발사 대기에 가지 않는다', () => {
    const t = busy();
    t.stickCancel(2);
    expect(t.heldBits()).toBe(0);
    const r = run(t, { nowMs: 0, face: Math.PI / 2 }, 20);
    expect(count(r.frames, BTN.ATTACK)).toBe(0);
  });

  it('reset: 모든 손가락 · RESCUE · 발사 대기 · 눌림을 비운다', () => {
    const t = busy();
    t.tap(BTN.ROAR);
    t.stickStart(3, 'dash', 0);
    t.stickMove(3, 1, 0);
    t.stickEnd(3, 10); // 발사 대기
    t.reset();
    expect(t.moveVector()).toEqual({ x: 0, y: 0 });
    expect(t.heldBits()).toBe(0);
    const r = run(t, { nowMs: 10, face: 0 }, 20);
    expect(r.frames.every((f) => f.pressed === 0 && f.aim === null)).toBe(true);
    // 끝난 손가락은 다시 움직여도 반응하지 않는다
    t.stickMove(1, 1, 0);
    expect(t.moveVector()).toEqual({ x: 0, y: 0 });
  });

  it('이미 뗀 손가락의 취소(뗀 뒤 오는 lostpointercapture)는 발사 대기 · 다른 손가락 구조를 건드리지 않는다', () => {
    const t = busy();
    t.stickEnd(2, 10); // 조준 스틱 놓기 → 발사 대기
    t.stickCancel(2);
    t.stickEnd(1, 10);
    t.stickCancel(1);
    expect(t.heldBits()).toBe(BTN.RESCUE);
    const r = run(t, { nowMs: 10, face: Math.PI / 2 }, 5);
    expect(count(r.frames, BTN.ATTACK)).toBe(1);
  });
});
