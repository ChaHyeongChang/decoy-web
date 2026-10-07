import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LagQueue, Rng } from '@decoy/shared';

describe('지연 큐 (--lag / ?lag)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('흔들림이 있어도 순서를 지키고 base ± jitter 뒤에 전달한다', () => {
    let now = 0;
    const got: number[] = [];
    const rng = new Rng(7);
    const q = new LagQueue<number>(
      100,
      20,
      (v) => got.push(v),
      () => rng.next(),
      () => now,
    );
    for (let i = 0; i < 50; i += 1) {
      q.push(i);
      now += 5;
      vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(200);
    expect(got).toEqual([...Array(50).keys()]);
  });

  it('첫 메시지는 80~120ms 사이에 도착한다', () => {
    let now = 0;
    const got: number[] = [];
    const q = new LagQueue<number>(
      100,
      20,
      (v) => got.push(v),
      () => 0,
      () => now,
    );
    q.push(1);
    now = 79;
    vi.advanceTimersByTime(79);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(got).toEqual([1]);
  });

  it('지연 0이면 바로 전달', () => {
    const got: number[] = [];
    const q = new LagQueue<number>(0, 20, (v) => got.push(v));
    q.push(3);
    expect(got).toEqual([3]);
  });
});
