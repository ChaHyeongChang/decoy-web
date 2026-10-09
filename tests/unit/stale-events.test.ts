// 오래된 이벤트 거르기 (client/src/scenes/staleEvents.ts): 빠른 기기 2초, 느린 기기는 프레임 간격의 3배, 멈춤은 프레임 속도로 치지 않는다
import { describe, expect, it } from 'vitest';
import {
  STALE_EVENT_FRAMES,
  STALE_EVENT_MS,
  STALL_FRAME_MS,
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
