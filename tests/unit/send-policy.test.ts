// 연결별 송신 정책 (M12): 밀린 연결에는 오래된 스냅샷을 건너뛰고, 다른 메시지는 늘 보내며, 아주 크게 쌓일 때만 끊는다
import { describe, expect, it } from 'vitest';
import { SKIP_SNAPSHOTS_ABOVE, TERMINATE_ABOVE, sendAction } from '../../server/src/sendPolicy';

describe('송신 정책', () => {
  it('버퍼가 비었거나 조금 쌓였으면 무엇이든 보낸다', () => {
    expect(sendAction(0, true)).toBe('send');
    expect(sendAction(SKIP_SNAPSHOTS_ABOVE, true)).toBe('send');
    expect(sendAction(SKIP_SNAPSHOTS_ABOVE, false)).toBe('send');
  });

  it('밀리면 스냅샷만 건너뛰고, 결과 · 로비 · 오류 같은 메시지는 보낸다', () => {
    expect(sendAction(SKIP_SNAPSHOTS_ABOVE + 1, true)).toBe('skip');
    expect(sendAction(SKIP_SNAPSHOTS_ABOVE + 1, false)).toBe('send');
    expect(sendAction(TERMINATE_ABOVE, false)).toBe('send');
  });

  it('스냅샷을 건너뛰는데도 아주 크게 쌓이면 끊는다 (M11 전의 1MB보다 훨씬 늦게)', () => {
    expect(sendAction(TERMINATE_ABOVE + 1, true)).toBe('terminate');
    expect(sendAction(TERMINATE_ABOVE + 1, false)).toBe('terminate');
    expect(TERMINATE_ABOVE).toBeGreaterThan(1024 * 1024);
    expect(SKIP_SNAPSHOTS_ABOVE).toBeLessThan(1024 * 1024);
  });
});
