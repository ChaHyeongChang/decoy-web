// 터치 입력 상태 기계 (M11, MOBILE_PLAN M11 5번 조작 규칙): 손가락별 추적 · 데드존 · 길이 1 · 조준 스틱 발사 대기 ·
// 짧은 탭 · 취소 · 돌진 끌기 · 탭 · 누르기 버튼 · 취소 이벤트.
// 플레이테스트 반영 a-2: 조준 시작 문턱(데드존과 별개, 손가락마다) · 짧은 탭 0.4초 · '누르면 바로'(fire) · 탭 공격 조준 보정 대기
import { describe, expect, it, vi } from 'vitest';
import { BTN, DEG, angleDiff, turnToward } from '@decoy/shared';
import { TOUCH, TouchInput, aimStartOf, type TouchFrameCtx } from '../../client/src/touchInput';
import { MIN_TARGET } from '../../client/src/ui/touchControls';

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
  opts: { turn?: boolean; canAttack?: boolean; canDash?: boolean; assist?: (base: number) => number } = {},
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
    if (opts.assist) c.assist = opts.assist;
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
  it('수치: 데드존 15% · ±10° · 발사 대기 최대 0.35초 (MOBILE_PLAN M11 5번) · 짧은 탭 0.4초 · 조준 시작 문턱 30%(14~24px) · 보정 대기 ±0.5° (플레이테스트 반영 a-2)', () => {
    expect(TOUCH).toMatchObject({
      deadZone: 0.15,
      maxFireWaitMs: 350,
      shortTapMs: 400,
      aimStart: 0.3,
      aimStartMinPx: 14,
      aimStartMaxPx: 24,
    });
    expect(TOUCH.aimTolerance).toBeCloseTo(10 * DEG, 12);
    expect(TOUCH.assistTolerance).toBeCloseTo(0.5 * DEG, 12);
    // 조준 시작 문턱은 데드존보다 넓고, 보정 대기는 끌어 놓기 대기보다 훨씬 좁다(±10°면 보정한 조준이 서버에 닿기 전에 나간다)
    expect(TOUCH.aimStart).toBeGreaterThan(TOUCH.deadZone);
    expect(TOUCH.assistTolerance).toBeLessThan(TOUCH.aimTolerance / 10);
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

  it('조준을 시작하지 않고 0.4초 안에 떼면(짧은 탭) 지금 방향으로 ATTACK 1번, 더 길게 누르면 0번', () => {
    const tap = new TouchInput();
    tap.stickStart(5, 'aim', 0);
    tap.stickMove(5, 0.05, 0.05);
    tap.stickEnd(5, TOUCH.shortTapMs - 10);
    const r = run(tap, { nowMs: 390, face: 1.0 }, 20, { turn: false });
    expect(count(r.frames, BTN.ATTACK)).toBe(1);
    expect(r.frames[0]!.pressed).toBe(BTN.ATTACK);

    // 0.35초: 예전 0.25초 기준으로는 나가지 않던 탭 (쫓는 중 엄지 탭은 0.25초를 자주 넘긴다)
    const slow = new TouchInput();
    slow.stickStart(5, 'aim', 0);
    slow.stickEnd(5, 350);
    expect(count(run(slow, { nowMs: 350, face: 1.0 }, 20).frames, BTN.ATTACK)).toBe(1);
    // 경계(0.4초)는 탭
    const edge = new TouchInput();
    edge.stickStart(5, 'aim', 0);
    edge.stickEnd(5, TOUCH.shortTapMs);
    expect(count(run(edge, { nowMs: 400, face: 1.0 }, 20).frames, BTN.ATTACK)).toBe(1);

    // 0.45초: 길게 누르다 끌지 않고 떼면 아무것도 하지 않는다 (손을 얹고 쉬다 떼도 공격이 나가지 않게)
    const long = new TouchInput();
    long.stickStart(5, 'aim', 0);
    long.stickEnd(5, 450);
    expect(count(run(long, { nowMs: 450, face: 1.0 }, 20).frames, BTN.ATTACK)).toBe(0);
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

describe('터치 입력: 조준 시작 문턱 (플레이테스트 반영 a-2 — 탭이 조준으로 읽히지 않게)', () => {
  /** 오른쪽(0°)으로 걷는 중: 이동 손가락 1 */
  function walkingEast(): TouchInput {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 1, 0);
    return t;
  }

  it('조준 손가락이 반지름의 25%까지 움직여도 조준이 아니다: 그동안 aim = 이동 방향, 떼면 다음 프레임에 지금 방향으로 ATTACK', () => {
    const t = walkingEast();
    let s = run(t, { nowMs: 0, face: 0 }, 3);
    // 누른 자리가 중심이라 누른 직후는 (0, 0). 탭하는 동안 엄지가 왼쪽 아래로 0.25(≈ 14px) 밀렸다 — 예전 데드존(0.15) 밖
    t.stickStart(2, 'aim', s.nowMs);
    t.stickMove(2, 0, 0);
    t.stickMove(2, -0.2, 0.15);
    expect(Math.hypot(-0.2, 0.15)).toBeGreaterThan(TOUCH.deadZone);
    s = run(t, s, 3);
    expect(s.frames.map((f) => f.aim)).toEqual([0, 0, 0]);
    expect(s.frames.every((f) => f.pressed === 0)).toBe(true);
    t.stickEnd(2, s.nowMs);
    const r = run(t, s, 20);
    expect(r.frames[0]!.pressed).toBe(BTN.ATTACK);
    expect(count(r.frames, BTN.ATTACK)).toBe(1);
    // 어느 프레임도 밀린 쪽(143°)으로 돌지 않았다
    expect(r.frames.every((f) => f.aim === 0)).toBe(true);
    expect(r.frames[0]!.face).toBe(0);
  });

  it('문턱(30%)을 넘게 끌면 조준이다: 그 각도를 보내고, 놓으면 그 방향으로 발사 대기 · 문턱과 같은 길이는 아직 안', () => {
    const t = walkingEast();
    t.stickStart(2, 'aim', 0);
    t.stickMove(2, 0, TOUCH.aimStart);
    expect(frame(t, ctx(10)).aim).toBe(0);
    t.stickMove(2, 0, 0.31);
    expect(frame(t, ctx(20)).aim).toBe(Math.PI / 2);
    t.stickEnd(2, 30);
    const r = run(t, { nowMs: 30, face: 0 }, 20);
    const k = r.frames.findIndex((f) => (f.pressed & BTN.ATTACK) !== 0);
    expect(k).toBeGreaterThan(0);
    expect(r.frames[k]!.aim).toBe(Math.PI / 2);
    expect(count(r.frames, BTN.ATTACK)).toBe(1);
  });

  it('문턱 하나를 시작 · 각도 갱신 · 취소 구역에 같이 쓴다: 조준 중 25%로 돌아오면 각도는 그대로, 거기서 떼면 취소', () => {
    const t = new TouchInput();
    t.stickStart(2, 'aim', 0);
    t.stickMove(2, 0.8, 0);
    // 문턱 안(예전 데드존 밖)에서는 각도를 갱신하지 않는다
    t.stickMove(2, 0, 0.25);
    expect(frame(t, ctx(10)).aim).toBe(0);
    t.stickEnd(2, 20);
    expect(count(run(t, { nowMs: 20, face: 0 }, 20).frames, BTN.ATTACK)).toBe(0);
  });

  it('손가락마다 문턱을 든다: stickStart에 넘긴 값이 그 손가락에만 쓰이고, 이동 · 돌진은 데드존 15% 그대로', () => {
    const t = new TouchInput();
    // 작게 줄인 조준 스틱(r 32px → 14px = 0.4375): 0.4는 조준이 아니고 0.45는 조준
    t.stickStart(2, 'aim', 0, aimStartOf(32));
    t.stickMove(2, 0.4, 0);
    expect(frame(t, ctx(10)).aim).toBeNull();
    t.stickMove(2, 0.45, 0);
    expect(frame(t, ctx(20)).aim).toBe(0);
    // 이동: 0.2면 길이 1
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 0, 0.2);
    expect(t.moveVector()).toEqual({ x: 0, y: 1 });
    // 돌진: 0.2 끌기는 끌기 (그 각도로 발사 대기)
    const d = new TouchInput();
    d.stickStart(3, 'dash', 0);
    d.stickMove(3, 0, -0.2);
    d.stickEnd(3, 10);
    const r = run(d, { nowMs: 10, face: 0 }, 20);
    const k = r.frames.findIndex((f) => (f.pressed & BTN.DASH) !== 0);
    expect(k).toBeGreaterThan(0);
    expect(r.frames[k]!.aim).toBe(-Math.PI / 2);
  });

  it('aimStartOf: 반지름의 30%를 14~24px로 자른다 (작게 줄인 스틱 14px · 기본 15~19px · 크게 키운 스틱 24px), 가장 작은 터치 대상에서도 조준할 수 있다', () => {
    const px = (r: number): number => aimStartOf(r) * r;
    expect([32, 40, 50, 57, 63, 82, 123].map((r) => Number(px(r).toFixed(1)))).toEqual([
      14, 14, 15, 17.1, 18.9, 24, 24,
    ]);
    // 스틱 값은 길이 1로 잘린다: 문턱이 1 이상이면 조준을 시작할 수 없다. 터치 대상 최소 크기(지름 48px)에서도 손잡이가 닿는 0.6 아래
    expect(aimStartOf(MIN_TARGET / 2)).toBeLessThan(0.6);
    // 넓은 스틱일수록 비율은 작아지지만 데드존보다는 넓다
    for (const r of [24, 32, 57, 82, 123]) expect(aimStartOf(r), `r ${r}`).toBeGreaterThan(TOUCH.deadZone);
  });
});

describe("터치 입력: 공격 버튼 '누르면 바로' (fire)", () => {
  it('누른 다음 프레임에 지금 방향으로 ATTACK 1번: 떼는 동작이 없고, 누르고 있어도 다시 나가지 않는다', () => {
    const t = new TouchInput();
    t.stickStart(1, 'move', 0);
    t.stickMove(1, 0, -1);
    let s = run(t, { nowMs: 0, face: 0 }, 6);
    expect(s.face).toBe(-Math.PI / 2);
    t.fire(BTN.ATTACK);
    s = run(t, s, 30);
    expect(s.frames[0]!.pressed).toBe(BTN.ATTACK);
    expect(count(s.frames, BTN.ATTACK)).toBe(1);
    // 조준은 계속 이동 방향이다 (조준 스틱이 없다)
    expect(s.frames.every((f) => f.aim === -Math.PI / 2)).toBe(true);
  });

  it('할 수 없는 순간(쿨타임 · 행동 불가)에 누르면 버린다: 나중에 풀려도 나가지 않는다', () => {
    const t = new TouchInput();
    t.fire(BTN.ATTACK);
    const blocked = run(t, { nowMs: 0, face: 0 }, 1, { canAttack: false });
    const later = run(t, blocked, 30);
    expect(count([...blocked.frames, ...later.frames], BTN.ATTACK)).toBe(0);
  });

  it('reset은 아직 내지 않은 누름도 비운다', () => {
    const t = new TouchInput();
    t.fire(BTN.ATTACK);
    t.reset();
    expect(count(run(t, { nowMs: 0, face: 0 }, 10).frames, BTN.ATTACK)).toBe(0);
  });
});

describe('터치 입력: 탭 공격 조준 보정 대기 (ctx.assist)', () => {
  const plus =
    (deg: number) =>
    (base: number): number =>
      base + deg * DEG;

  /** 탭 공격 하나를 넣는다: 짧은 탭(조준 스틱) 또는 누르면 바로 */
  const TAPS: [string, (t: TouchInput, nowMs: number) => void][] = [
    [
      '짧은 탭',
      (t, nowMs) => {
        t.stickStart(5, 'aim', nowMs - 100);
        t.stickEnd(5, nowMs);
      },
    ],
    ['누르면 바로', (t) => t.fire(BTN.ATTACK)],
  ];

  for (const [name, tap] of TAPS) {
    it(`${name}: 보정한 각도가 다르면 그 각도를 한 프레임 먼저 보내고, face가 온 다음 프레임에 ATTACK 1번`, () => {
      const t = new TouchInput();
      tap(t, 1000);
      const r = run(t, { nowMs: 1000, face: 0.3 }, 20, { assist: plus(10) });
      // 첫 프레임: 공격 없이 보정한 aim만
      expect(r.frames[0]!.pressed).toBe(0);
      expect(r.frames[0]!.aim).toBeCloseTo(0.3 + 10 * DEG, 12);
      // 둘째 프레임: 예측 face가 보정한 각도에 왔고(10° < 한 프레임 18°) 공격을 낸다. 그 프레임 aim도 보정한 각도
      expect(r.frames[1]!.pressed).toBe(BTN.ATTACK);
      expect(r.frames[1]!.face).toBeCloseTo(0.3 + 10 * DEG, 12);
      expect(r.frames[1]!.aim).toBeCloseTo(0.3 + 10 * DEG, 12);
      expect(count(r.frames, BTN.ATTACK)).toBe(1);
    });

    it(`${name}: 보정이 지금 방향 그대로면 예전처럼 그 프레임에 ATTACK (공격을 늦추지 않는다)`, () => {
      const t = new TouchInput();
      tap(t, 1000);
      const assist = vi.fn((base: number) => base);
      const r = run(t, { nowMs: 1000, face: 0.3 }, 20, { assist });
      expect(r.frames[0]!.pressed).toBe(BTN.ATTACK);
      expect(count(r.frames, BTN.ATTACK)).toBe(1);
      // 탭 하나에 한 번만, 지금 방향(예측 face)을 넘겨 부른다
      expect(assist.mock.calls).toEqual([[0.3]]);
    });
  }

  it('보정은 공격을 앞당기지 않는다: 보정이 있으면 같은 프레임이거나 한 프레임 뒤', () => {
    const at = (assist?: (b: number) => number): number => {
      const t = new TouchInput();
      t.fire(BTN.ATTACK);
      const r = run(t, { nowMs: 0, face: 0 }, 20, assist ? { assist } : {});
      return r.frames.findIndex((f) => (f.pressed & BTN.ATTACK) !== 0);
    };
    expect(at()).toBe(0);
    expect(at(plus(0))).toBe(0);
    expect(at(plus(0.4))).toBe(0); // 허용 오차(0.5°) 안은 바로
    expect(at(plus(4))).toBe(1);
    expect(at(plus(-12))).toBe(1);
  });

  it('끌어 놓기 · 돌진 탭 · 돌진 끌기에서는 보정을 부르지 않는다', () => {
    const assist = vi.fn((base: number) => base + 10 * DEG);
    // 끌어 놓기 (조준 스틱)
    const drag = new TouchInput();
    drag.stickStart(5, 'aim', 0);
    drag.stickMove(5, 0, 0.8);
    drag.stickEnd(5, 100);
    const a = run(drag, { nowMs: 100, face: 0 }, 20, { assist });
    expect(count(a.frames, BTN.ATTACK)).toBe(1);
    expect(a.frames.find((f) => (f.pressed & BTN.ATTACK) !== 0)!.aim).toBe(Math.PI / 2);
    // 돌진 탭
    const dashTap = new TouchInput();
    dashTap.stickStart(6, 'dash', 0);
    dashTap.stickEnd(6, 50);
    const b = run(dashTap, { nowMs: 50, face: 0 }, 20, { assist });
    expect(b.frames[0]!.pressed).toBe(BTN.DASH);
    // 돌진 끌기
    const dashDrag = new TouchInput();
    dashDrag.stickStart(7, 'dash', 0);
    dashDrag.stickMove(7, -0.7, 0);
    dashDrag.stickEnd(7, 50);
    const c = run(dashDrag, { nowMs: 50, face: 0 }, 20, { assist });
    expect(count(c.frames, BTN.DASH)).toBe(1);
    expect(assist).not.toHaveBeenCalled();
  });

  it('할 수 없는 순간의 탭은 보정을 부르지도 않고, 보정 대기 중 행동 불가가 되면 버린다', () => {
    const assist = vi.fn((base: number) => base + 10 * DEG);
    const t = new TouchInput();
    t.fire(BTN.ATTACK);
    const r = run(t, { nowMs: 0, face: 0 }, 5, { canAttack: false, assist });
    expect(assist).not.toHaveBeenCalled();
    expect(count(r.frames, BTN.ATTACK)).toBe(0);
    // 보정 대기에 들어간 다음 프레임에 기절: 내지 않는다
    const w = new TouchInput();
    w.fire(BTN.ATTACK);
    const first = run(w, { nowMs: 0, face: 0 }, 1, { assist });
    expect(first.frames[0]!.pressed).toBe(0);
    const stunned = run(w, first, 1, { canAttack: false, assist });
    const after = run(w, stunned, 30, { assist });
    expect(count([...stunned.frames, ...after.frames], BTN.ATTACK)).toBe(0);
  });

  it('face가 보정한 각도로 돌지 못해도(예측이 어긋남) 0.35초 뒤에는 ATTACK 1번', () => {
    const t = new TouchInput();
    t.fire(BTN.ATTACK);
    const r = run(t, { nowMs: 0, face: 0 }, 30, { turn: false, assist: plus(10) });
    expect(count(r.frames, BTN.ATTACK)).toBe(1);
    const fired = r.frames.find((f) => (f.pressed & BTN.ATTACK) !== 0)!;
    expect(fired.nowMs).toBeLessThan(TOUCH.maxFireWaitMs + 2 * FRAME_MS);
  });

  it('다른 발사 대기(돌진 끌어 놓기)가 있으면 그것을 덮지 않는다: 보정 없이 바로 ATTACK, 돌진 대기는 그대로', () => {
    const assist = vi.fn((base: number) => base + 10 * DEG);
    const t = new TouchInput();
    t.stickStart(7, 'dash', 0);
    t.stickMove(7, 0, 1);
    t.stickEnd(7, 10);
    t.fire(BTN.ATTACK);
    const r = run(t, { nowMs: 10, face: 0 }, 20, { assist });
    expect(r.frames[0]!.pressed & BTN.ATTACK).toBe(BTN.ATTACK);
    expect(assist).not.toHaveBeenCalled();
    expect(count(r.frames, BTN.DASH)).toBe(1);
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
