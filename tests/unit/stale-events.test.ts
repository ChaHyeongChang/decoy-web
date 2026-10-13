// 오래된 이벤트 거르기 (client/src/scenes/staleEvents.ts): 빠른 기기 2초, 느린 기기는 프레임 간격의 3배, 멈춤은 프레임 속도로 치지 않는다
import { describe, expect, it } from 'vitest';
import {
  FRAME_MS_TAU,
  MAX_FRAME_DELTA_MS,
  STALE_EVENT_FRAMES,
  STALE_EVENT_MS,
  STALL_FRAME_MS,
  frameDeltaMs,
  staleEventLimitMs,
  trackFrameMs,
} from '../../client/src/scenes/staleEvents';

const run = (deltas: readonly number[], start = 0): number =>
  deltas.reduce((r, d) => trackFrameMs(r, d), start);
const frames = (delta: number, n: number): number[] => Array.from({ length: n }, () => delta);

describe('오래된 이벤트 한도', () => {
  it('60fps · 처음(측정 전)에는 2초', () => {
    expect(staleEventLimitMs(0)).toBe(STALE_EVENT_MS);
    expect(staleEventLimitMs(run(frames(16.7, 120)))).toBe(STALE_EVENT_MS);
  });

  it('느려지면 첫 느린 프레임부터 한도가 늘어난다 (느려진 직후 받은 이벤트를 버리지 않게)', () => {
    const r = run([...frames(16.7, 120), 1500]);
    expect(r).toBe(1500);
    expect(staleEventLimitMs(r)).toBe(STALE_EVENT_FRAMES * 1500);
    // CI 러너 · 1.5초 프레임 흉내에서 잰 실제 처리 지연(최대 3.3초)을 버리지 않는다
    expect(staleEventLimitMs(r)).toBeGreaterThan(3300);
  });

  it('다시 빨라지면 천천히 내려와 2초로 돌아온다', () => {
    const slow = run(frames(1500, 10));
    const after5 = run(frames(16.7, 5), slow);
    expect(after5).toBeLessThan(slow);
    expect(after5).toBeGreaterThan(16.7);
    expect(staleEventLimitMs(run(frames(16.7, 60), slow))).toBe(STALE_EVENT_MS);
  });

  it('백그라운드에서 10초 멈췄다 돌아온 프레임은 프레임 속도로 치지 않아 한도가 2초 그대로다', () => {
    const r = run([...frames(16.7, 120), 10_000]);
    expect(staleEventLimitMs(r)).toBe(STALE_EVENT_MS);
    // 10초 지난 타격은 거른다
    expect(10_000).toBeGreaterThan(staleEventLimitMs(r));
  });

  it('멈춤 경계 · 잘못된 값', () => {
    expect(trackFrameMs(100, STALL_FRAME_MS + 1)).toBe(100);
    expect(trackFrameMs(100, STALL_FRAME_MS)).toBe(STALL_FRAME_MS);
    expect(trackFrameMs(100, 0)).toBe(100);
    expect(trackFrameMs(100, Number.NaN)).toBe(100);
    expect(trackFrameMs(0, 40)).toBe(40);
    // 한도의 최댓값: 멈춤이 아닌 가장 느린 프레임의 3배
    expect(staleEventLimitMs(STALL_FRAME_MS)).toBe(STALE_EVENT_FRAMES * STALL_FRAME_MS);
  });
});

describe('프레임 간격 (렌더링 최적화: 프레임 독립성)', () => {
  it('빨라질 때 내려오는 빠르기는 시간 상수: 60fps에서는 예전과 같은 프레임당 10%', () => {
    expect(FRAME_MS_TAU).toBeCloseTo(158.2, 1);
    // 예전 식 recent + (delta − recent) × 0.1 과 같다 (60fps 한 프레임)
    expect(trackFrameMs(100, 1000 / 60)).toBeCloseTo(100 + (1000 / 60 - 100) * 0.1, 9);
  });

  it('같은 시간이 지나면 60fps 한 프레임과 120fps 두 프레임이 같은 만큼 내려온다 (목표가 같을 때)', () => {
    // 1.5초 프레임 뒤 빠른 프레임이 이어질 때: 내려가는 목표가 같으면(간격 d) 지수 감쇠는 나눠도 같다
    const d = 5;
    const one = trackFrameMs(1500, d * 2);
    const half = 1500 + (d * 2 - 1500) * (1 - Math.exp(-(d * 2) / FRAME_MS_TAU));
    expect(one).toBeCloseTo(half, 9);
    const k1 = 1 - Math.exp(-d / FRAME_MS_TAU);
    const two = 1500 + (d - 1500) * (1 - (1 - k1) * (1 - k1));
    expect(trackFrameMs(trackFrameMs(1500, d), d)).toBeCloseTo(two, 9);
    expect(1 - (1 - k1) ** 2).toBeCloseTo(1 - Math.exp(-(2 * d) / FRAME_MS_TAU), 12);
  });

  it('120fps에서도 1초 뒤에는 2초 한도로 돌아온다 (프레임 수가 아니라 시간)', () => {
    const slow = run(frames(1500, 10));
    const at60 = run(frames(1000 / 60, 60), slow);
    const at120 = run(frames(1000 / 120, 120), slow);
    expect(staleEventLimitMs(at60)).toBe(STALE_EVENT_MS);
    expect(staleEventLimitMs(at120)).toBe(STALE_EVENT_MS);
    // 예전 식(프레임당 10%)이면 120fps는 0.5초 만에 내려왔다: 시간으로 재면 둘이 비슷한 만큼 남는다
    const half60 = run(frames(1000 / 60, 15), slow);
    const half120 = run(frames(1000 / 120, 30), slow);
    expect(Math.abs(half60 - half120) / half60).toBeLessThan(0.1);
  });

  it('시간으로 쌓는 연출의 프레임 간격은 실제 간격(rawDelta)을 0 ~ 250ms로', () => {
    expect(frameDeltaMs(1000 / 120)).toBe(1000 / 120);
    expect(frameDeltaMs(16.7)).toBe(16.7);
    expect(frameDeltaMs(10_000)).toBe(MAX_FRAME_DELTA_MS);
    expect(frameDeltaMs(-3)).toBe(0);
    expect(frameDeltaMs(Number.NaN)).toBe(0);
  });
});
