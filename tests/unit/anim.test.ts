// 애니메이션 곡선 (M10b, VISUAL_SPEC 6장): 규칙 시간은 balance.json을 따르고, 장식은 2% · 80ms 같은 그래픽 상수 안이다.
// 괴물 화면 생존자 그리기는 역할 · 체력 · 능력 인자를 받지 않는다(흰색 위장 R7 — 타입으로 막는다).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBalance } from '../../shared/src/balance';
import {
  ANIM,
  LinearRamp,
  WALK_REF_MS,
  advanceWalk,
  breathScale,
  cloakFrame,
  dashStretch,
  fadeOut,
  footfall,
  frameCount,
  hiddenSurvivorPose,
  hitReact,
  isWalking,
  protectBlink,
  quantizePhase,
  selfPieces,
  stepGait,
  walkPose,
  windupFill,
  windupFillFromRemaining,
} from '../../client/src/art/anim';
import type { GaitState, SelfStep, TravelPiece } from '../../client/src/art/anim';
import type { drawHiddenSurvivor } from '../../client/src/render/characters';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));

describe('규칙 시간 곡선 (balance)', () => {
  it('공격 준비 채움은 attack.windup에 맞춰 0 → 100% (정확히 windup에 1)', () => {
    const w = balance.monster.attack.windup;
    expect(windupFill(0, w)).toBe(0);
    expect(windupFill(w / 2, w)).toBeCloseTo(0.5, 9);
    expect(windupFill(w - 1e-6, w)).toBeLessThan(1);
    expect(windupFill(w, w)).toBe(1);
    expect(windupFill(w * 3, w)).toBe(1);
    // 서버 값(남은 시간)으로 잰 채움과 같다
    for (const t of [0, 0.1, 0.25, w])
      expect(windupFillFromRemaining(w - t, w)).toBeCloseTo(windupFill(t, w), 9);
  });

  it('돌진 늘어남은 dash.duration 동안만 (끝나면 0)', () => {
    const d = balance.monster.dash.duration;
    expect(dashStretch(0, d)).toBe(1);
    expect(dashStretch(d / 2, d)).toBeCloseTo(0.5, 9);
    expect(dashStretch(d, d)).toBe(0);
    expect(dashStretch(d * 2, d)).toBe(0);
  });

  it('보호 깜빡임은 지금 규칙(150ms)', () => {
    expect(protectBlink(0)).toBe(true);
    expect(protectBlink(ANIM.protectBlinkMs)).toBe(false);
    expect(protectBlink(ANIM.protectBlinkMs * 2)).toBe(true);
  });
});

describe('장식 곡선', () => {
  it('숨쉬기는 크기 2% 이내', () => {
    for (let t = 0; t < 10; t += 0.07) {
      const s = breathScale(t, 1.3);
      expect(Math.abs(s - 1)).toBeLessThanOrEqual(0.02);
    }
  });

  it('걷기 위상은 이동 거리로만 진행한다 (멈추면 그대로, 같은 거리면 프레임 수와 무관)', () => {
    expect(advanceWalk(1.2, 0)).toBe(1.2);
    let a = 0;
    for (let i = 0; i < 10; i += 1) a = advanceWalk(a, 0.05);
    const b = advanceWalk(0, 0.5);
    expect(a).toBeCloseTo(b, 9);
    // 멈추면 발이 나란히, 기울기 0
    const still = walkPose(1.1, 0);
    expect(still.lean).toBe(0);
    expect(still.feet[0].x).toBe(0);
    expect(Math.abs(walkPose(Math.PI / 2, 1).lean)).toBeCloseTo((ANIM.leanDeg * Math.PI) / 180, 9);
    expect(footfall(Math.PI / 2 - 0.1, Math.PI / 2 + 0.1)).toBe(true);
    expect(footfall(0.1, 0.2)).toBe(false);
  });

  it('발먼지: 한 걸음 주기(두 발, strideTiles)에 정확히 두 번 — 위상 2π → 0 넘김에서 더 생기지 않는다', () => {
    // 감싼 위상(advanceWalk)을 그대로 이어 붙여 걷는다. 시작 위상 · 프레임 이동 거리를 여러 개로
    for (const start of [0.05, 1, 2.5, 4, 5.5, 6.2, 6.28]) {
      for (const step of [0.013, 0.05, 0.11, 0.27, 0.6]) {
        let phase = start;
        let walked = 0;
        let falls = 0;
        // 한 주기 = strideTiles. 마지막 조각은 남은 거리만큼
        while (walked < ANIM.strideTiles - 1e-9) {
          const d = Math.min(step, ANIM.strideTiles - walked);
          const next = advanceWalk(phase, d);
          if (footfall(phase, next)) falls += 1;
          phase = next;
          walked += d;
        }
        expect(falls, `시작 ${start} · 한 프레임 ${step}타일`).toBe(2);
      }
    }
    // 넘김 바로 앞뒤 (π/2 · 3π/2를 지나지 않음)
    expect(footfall(6.2, 0.05)).toBe(false);
    // 넘기면서 π/2를 지남
    expect(footfall(6.2, 1.7)).toBe(true);
  });

  it('피격: 흰 번쩍 80ms · 찌그러짐 120ms 뒤 0', () => {
    expect(hitReact(0).flash).toBe(1);
    expect(hitReact(ANIM.hitFlashMs).flash).toBe(0);
    expect(hitReact(60).squash).toBeGreaterThan(0);
    expect(hitReact(ANIM.squashMs).squash).toBe(0);
    expect(fadeOut(ANIM.escapeFadeMs, ANIM.escapeFadeMs)).toBe(0);
  });

  it('품질 낮음은 프레임 절반', () => {
    expect(frameCount(ANIM.cloakFrames, false)).toBe(8);
    expect(frameCount(ANIM.cloakFrames, true)).toBe(4);
    for (let t = 0; t < 5; t += 0.13) {
      const f = cloakFrame(t, t > 2, 4);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(4);
    }
    expect(quantizePhase(0.4, 4)).toBe(0);
  });

  it('장식 연출 시간은 이벤트 효과 한도(0.4초) 안', () => {
    for (const ms of [
      ANIM.hitFlashMs,
      ANIM.squashMs,
      ANIM.imprisonDissolveMs,
      ANIM.imprisonAppearMs,
      ANIM.escapeFadeMs,
      ANIM.deathGrayMs + ANIM.deathFadeMs,
      ANIM.slashMs,
    ])
      expect(ms).toBeLessThanOrEqual(400);
  });
});

describe('괴물 화면 생존자 (흰색 위장)', () => {
  it('그리기 값은 역할과 무관하게 같은 그림 · 크기 · 그림자 · 걷기 곡선', () => {
    const a = hiddenSurvivorPose(10, 11, 0.4, 1.7, 1, false, null, 12_345, 0.5);
    const b = hiddenSurvivorPose(10, 11, 0.4, 1.7, 1, false, null, 12_345, 0.5);
    expect(a).toEqual(b);
    expect(a.sprite).toBe('survivor-hidden');
    expect(a.foot).toBe('foot-hidden');
    expect(a.shadow).toBe('shadow-survivor');
    // 다른 자리 · 같은 시각: 크기(숨쉬기 위상)가 같다 (위상 차이로도 구분되지 않게)
    const c = hiddenSurvivorPose(30, 5, 2, 0.2, 0, false, null, 12_345, 0.5);
    expect(c.scale).toBe(a.scale);
    // 노출 창에만 역할이 붙는다 (테두리 + 문양). 그림 키는 그대로
    const r = hiddenSurvivorPose(10, 11, 0.4, 1.7, 1, false, 'guard', 12_345, 0.5);
    expect(r.sprite).toBe('survivor-hidden');
    expect(r.reveal).toBe('guard');
  });

  it('그리기 함수는 역할 · 체력 · 능력 인자를 받지 않는다 (타입 검사)', () => {
    // 실행하지 않는 함수: tsc -p tests가 @ts-expect-error 줄에 타입 에러가 있는지(= 인자가 없는지) 확인한다
    const typeOnly = (
      draw: typeof drawHiddenSurvivor,
      rig: Parameters<typeof drawHiddenSurvivor>[0],
    ): void => {
      draw(rig, 1, 2, 0, 0, 0, false, null, 0, 0.3);
      // @ts-expect-error 역할을 넘길 자리가 없다
      draw(rig, 1, 2, 0, 0, 0, false, null, 0, 0.3, 'runner');
      // @ts-expect-error 체력(hp)을 넘길 자리가 없다
      draw(rig, 1, 2, 0, 0, 0, false, null, 0, 0.3, 2);
      // @ts-expect-error reveal 자리에 역할이 아닌 값(능력 상태 등)을 넣을 수 없다
      draw(rig, 1, 2, 0, 0, 0, false, { abilityActive: 3 }, 0, 0.3);
    };
    expect(typeof typeOnly).toBe('function');
    // 순수 함수도 역할 인자가 없다: 9개 (x, y, face, walkPhase, stepping, protected, reveal, clock, protectedAlpha)
    expect(hiddenSurvivorPose.length).toBe(9);
  });
});

// ───────────── 렌더링 최적화: 프레임 독립성 (60 · 120fps에서 같은 시각에 같은 값) ─────────────

/** hz로 from → to 사이 프레임 시각 (to 포함, 가상 시계처럼 k × 1000 / hz) */
function frameTimes(hz: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let k = Math.floor((from * hz) / 1000) + 1; (k * 1000) / hz <= to + 1e-9; k += 1)
    out.push((k * 1000) / hz);
  return out;
}

/** 위상(라디안)이 2π로 감싼 것까지 같은가 */
function samePhase(a: number | undefined, b: number): void {
  const d = (((((a ?? Number.NaN) - b) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  expect(Math.abs(d)).toBeLessThan(1e-9);
}

/** 시각 → 위치(타일, 1차원)인 경로를 hz 프레임으로 잘라 조각들로 (프레임 사이 직선) */
function chordPieces(path: (t: number) => number, times: readonly number[], from: number): TravelPiece[][] {
  let prevT = from;
  return times.map((t) => {
    const piece = { ms: t - prevT, dist: Math.abs(path(t) - path(prevT)) };
    prevT = t;
    return [piece];
  });
}

describe('걷기 판단 · 자세 섞기 (프레임 독립성)', () => {
  it('걷기 판단은 시간당 빠르기: 60fps 한 프레임이면 예전 판단(거리 0.002 초과 · 1 미만)과 같다', () => {
    expect(WALK_REF_MS).toBeCloseTo(16.667, 3);
    expect(isWalking(0.0021, WALK_REF_MS)).toBe(true);
    expect(isWalking(0.0019, WALK_REF_MS)).toBe(false);
    expect(isWalking(0.99, WALK_REF_MS)).toBe(true);
    expect(isWalking(1.01, WALK_REF_MS)).toBe(false);
    // 120fps: 같은 빠르기면 거리 절반이어도 걷는 중 (예전 거리 판단은 0.0015에서 멈춤으로 봤다)
    expect(isWalking(0.0015, WALK_REF_MS / 2)).toBe(true);
    expect(isWalking(0.0009, WALK_REF_MS / 2)).toBe(false);
    // 120fps 한 프레임에 0.6타일 = 60fps 한 프레임에 1.2타일 빠르기: 순간이동
    expect(isWalking(0.6, WALK_REF_MS / 2)).toBe(false);
    expect(isWalking(0, 10)).toBe(false);
    expect(isWalking(0.1, 0)).toBe(false);
  });

  it('같은 경로를 60fps · 120fps 조각으로 걸으면 같은 시각에 위상 · 자세 섞기 · 발 닿는 순간이 같다', () => {
    // 4타일/초로 걷다가 700ms에 멈추고 1000ms에 다시 걷는다 (멈춤 · 출발이 60Hz 프레임 사이에 있다)
    const path = (t: number): number => (t < 700 ? t * 0.004 : t < 1000 ? 2.8 : 2.8 + (t - 1000) * 0.004);
    const run = (hz: number): { t: number; phase: number; stepping: number; falls: number[] }[] => {
      const g: GaitState = { phase: 0, stepping: 0 };
      const times = frameTimes(hz, 0, 1500);
      const pieces = chordPieces(path, times, 0);
      const out: { t: number; phase: number; stepping: number; falls: number[] }[] = [];
      const falls: number[] = [];
      let prevT = 0;
      times.forEach((t, i) => {
        const fall = stepGait(g, pieces[i] ?? []);
        if (fall !== null) falls.push(prevT + fall);
        prevT = t;
        out.push({ t, phase: g.phase, stepping: g.stepping, falls: falls.slice() });
      });
      return out;
    };
    const a = run(60);
    const b = run(120);
    for (const s of a) {
      const o = b.find((x) => Math.abs(x.t - s.t) < 1e-6);
      if (!o) throw new Error(`120fps에 ${s.t} 프레임이 없다`);
      samePhase(o.phase, s.phase);
      // 멈춤 · 출발 순간이 60Hz 프레임 사이면 그 프레임 하나는 판단이 다를 수 있다: 직선 경로를 프레임 조각 하나로 넘기면
      // 시간 비율만큼만 걸은 것으로 보지 못한다. 월드 렌더러는 보간 경로를 표본 시각에서 나눈 조각을 넘겨 이 차이가 없다
      expect(Math.abs(o.stepping - s.stepping)).toBeLessThanOrEqual(WALK_REF_MS / ANIM.stepOutMs + 1e-9);
      expect(o.falls.length).toBe(s.falls.length);
      o.falls.forEach((f, i) => expect(f).toBeCloseTo(s.falls[i] ?? Number.NaN, 6));
    }
  });

  it('꺾인 점에서 나눈 조각을 넘기면 자세 섞기까지 정확히 같다 (보간 경로 조각)', () => {
    // 멈춤 700ms · 출발 1000ms에서 나눈 조각: 60fps 프레임 (683.3, 700]은 그대로, (983.3, 1000]도 그대로라 경계가 프레임 안에 오게 690 · 990
    const path = (t: number): number => (t < 690 ? t * 0.004 : t < 990 ? 2.76 : 2.76 + (t - 990) * 0.004);
    const cuts = [690, 990];
    const run = (hz: number): Map<number, GaitState> => {
      const g: GaitState = { phase: 0, stepping: 0 };
      const out = new Map<number, GaitState>();
      let prevT = 0;
      for (const t of frameTimes(hz, 0, 1500)) {
        const pts = [prevT, ...cuts.filter((c) => c > prevT && c < t), t];
        const pieces = pts.slice(1).map((p, i) => ({
          ms: p - (pts[i] ?? p),
          dist: Math.abs(path(p) - path(pts[i] ?? p)),
        }));
        stepGait(g, pieces);
        out.set(Math.round(t * 1000), { ...g });
        prevT = t;
      }
      return out;
    };
    const a = run(60);
    const b = run(120);
    for (const [t, s] of a) {
      const o = b.get(t);
      samePhase(o?.phase, s.phase);
      expect(o?.stepping).toBeCloseTo(s.stepping, 9);
    }
  });

  it('걷기 자세 섞기는 걷는 동안 stepInMs, 멈춘 동안 stepOutMs에 걸쳐 바뀐다', () => {
    const g: GaitState = { phase: 0, stepping: 0 };
    stepGait(g, [{ ms: ANIM.stepInMs / 2, dist: 0.2 }]);
    expect(g.stepping).toBeCloseTo(0.5, 9);
    stepGait(g, [{ ms: ANIM.stepInMs, dist: 0.4 }]);
    expect(g.stepping).toBe(1);
    stepGait(g, [{ ms: ANIM.stepOutMs / 4, dist: 0 }]);
    expect(g.stepping).toBeCloseTo(0.75, 9);
    // 입력 틱에서 정한 걷기(walk)는 그린 거리가 0이어도(보정 순간 멈춤) 걷는 중으로 둔다
    stepGait(g, [{ ms: 30, dist: 0, walk: true }]);
    expect(g.stepping).toBeCloseTo(1, 9);
    // 순간이동 빠르기면 walk가 있어도 걷지 않는다
    const before = g.phase;
    stepGait(g, [{ ms: 8, dist: 3, walk: true }]);
    expect(g.phase).toBe(before);
  });

  it('내 캐릭터 조각: 입력 틱 · 보정 · 보간이 다 간 순간에서 나누고, 거리는 예측 보간 빠르기로', () => {
    const tick = 1000 / 30;
    const steps: SelfStep[] = [
      { t: 0, speed: 0.004, until: tick, walk: true },
      // 보정: 보낸 입력을 서버가 모두 처리해 그린 자리가 다음 틱까지 멈춤 (빠르기 0, 걷기 판단은 틱 그대로)
      { t: 20, speed: 0, until: tick, walk: true },
      { t: tick, speed: 0.004, until: tick * 2, walk: false },
    ];
    const out: TravelPiece[] = [];
    expect(selfPieces(steps, 10, 40, out)).toBe(true);
    expect(out.map((p) => [p.ms, p.dist, p.walk])).toEqual(
      [
        [10, 0.04, true],
        [tick - 20, 0, true],
        [40 - tick, (40 - tick) * 0.004, false],
      ].map(([ms, d, w]) => [expect.closeTo(ms as number, 9), expect.closeTo(d as number, 9), w]),
    );
    // 60fps · 120fps로 잘라도 같은 합
    const total = (hz: number): { ms: number; dist: number; walkMs: number } => {
      let ms = 0;
      let dist = 0;
      let walkMs = 0;
      let prev = 0;
      for (const t of frameTimes(hz, 0, 50)) {
        selfPieces(steps, prev, t, out);
        for (const p of out) {
          ms += p.ms;
          dist += p.dist;
          if (p.walk) walkMs += p.ms;
        }
        prev = t;
      }
      return { ms, dist, walkMs };
    };
    const a = total(60);
    const b = total(120);
    expect(b.ms).toBeCloseTo(a.ms, 9);
    expect(b.dist).toBeCloseTo(a.dist, 9);
    expect(b.walkMs).toBeCloseTo(a.walkMs, 9);
    // 시작 전 기록이 없으면 모른다 (프레임 사이 직선으로 대신)
    expect(selfPieces(steps, -5, 3, out)).toBe(false);
  });
});

describe('시간 곡선 (괴물 시야 모드 보간 등)', () => {
  it('목표가 바뀐 순간부터 잰다: 60 · 120fps 어느 프레임에서 읽어도 같은 시각에 같은 값', () => {
    const r = new LinearRamp(0, 400);
    // 70ms에 받은 스냅샷이 목표를 1로 (60Hz 프레임 66.7 · 83.3 사이, 120Hz 프레임 66.7 · 75 사이)
    r.setTarget(1, 70);
    expect(r.valueAt(60)).toBe(0);
    expect(r.valueAt(83.333)).toBeCloseTo(13.333 / 400, 6);
    expect(r.valueAt(270)).toBeCloseTo(0.5, 9);
    // 절반에서 다시 0으로: 그 순간 값에서 이어 간다
    r.setTarget(0, 270);
    expect(r.valueAt(370)).toBeCloseTo(0.25, 9);
    expect(r.valueAt(1000)).toBe(0);
    // 같은 목표는 다시 정하지 않는다 (시작 시각이 밀리지 않게)
    r.setTarget(0, 500);
    expect(r.valueAt(500)).toBe(0);
    r.jump(0.8, 600);
    expect(r.valueAt(650)).toBeCloseTo(0.675, 9);
    expect(r.goal).toBe(0);
  });

  it('올라가기 · 내려가기 시간이 다를 수 있다 (부채꼴 빨강 0.1초 · 0.4초)', () => {
    const r = new LinearRamp(0, 100, 400);
    r.setTarget(1, 0);
    expect(r.valueAt(50)).toBeCloseTo(0.5, 9);
    r.setTarget(0, 100);
    expect(r.valueAt(200)).toBeCloseTo(0.75, 9);
  });
});
