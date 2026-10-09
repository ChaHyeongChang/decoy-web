// 애니메이션 곡선 (M10b, VISUAL_SPEC 6장): 규칙 시간은 balance.json을 따르고, 장식은 2% · 80ms 같은 그래픽 상수 안이다.
// 괴물 화면 생존자 그리기는 역할 · 체력 · 능력 인자를 받지 않는다(흰색 위장 R7 — 타입으로 막는다).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBalance } from '../../shared/src/balance';
import {
  ANIM,
  advanceWalk,
  breathScale,
  cloakFrame,
  dashStretch,
  fadeOut,
  footfall,
  frameCount,
  hiddenSurvivorPose,
  hitReact,
  protectBlink,
  quantizePhase,
  walkPose,
  windupFill,
  windupFillFromRemaining,
} from '../../client/src/art/anim';
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
