import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LagQueue, Rng } from '@decoy/shared';

describe('지연 큐 (--lag / ?lag)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('흔들림이 있어도 넣은 순서대로 전달한다', () => {
    const got: number[] = [];
    const rng = new Rng(7);
    const q = new LagQueue<number>(
      100,
      20,
      (v) => got.push(v),
      () => rng.next(),
      () => Date.now(),
    );
    for (let i = 0; i < 200; i += 1) {
      q.push(i);
      // 같은 틱에 여러 개를 넣는 경우도 섞는다
      if (i % 3 === 0) vi.advanceTimersByTime(7);
    }
    vi.advanceTimersByTime(500);
    expect(got).toEqual([...Array(200).keys()]);
  });

  it('첫 메시지는 base − jitter ~ base + jitter 사이에 도착한다', () => {
    const got: number[] = [];
    const q = new LagQueue<number>(
      100,
      20,
      (v) => got.push(v),
      () => 0,
      () => Date.now(),
    );
    q.push(1);
    vi.advanceTimersByTime(78);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(3);
    expect(got).toEqual([1]);
  });

  it('지연 0이면 바로 전달', () => {
    const got: number[] = [];
    const q = new LagQueue<number>(0, 20, (v) => got.push(v));
    q.push(3);
    expect(got).toEqual([3]);
  });
});
