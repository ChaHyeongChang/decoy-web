// 진동 판단 (MOBILE_PLAN M12 10번): 내 피격 한 번, 발각 꺼짐 → 켜짐 때 두 번(이어지는 동안 0번), 2초 넘게 지난 일 0번,
// 사용자 활성화 전 0번, 설정을 끄면 0번, 숨김에서 돌아와 시계를 다시 맞추기 전 0번
import { describe, expect, it } from 'vitest';
import {
  HAPTIC_MAX_AGE_MS,
  HIT_PATTERN,
  Haptics,
  SPOTTED_PATTERN,
  hapticAllowed,
  parseHapticsSetting,
  spottedRose,
  type HapticEnv,
} from '../../client/src/haptics';

const OK: HapticEnv = { enabled: true, activated: true, visible: true, clockOk: true };

function device(activated = true) {
  const calls: number[][] = [];
  const env = { activated, visible: true };
  const h = new Haptics({
    vibrate: (p) => {
      calls.push(p);
      return true;
    },
    activated: () => env.activated,
    visible: () => env.visible,
  });
  return { h, calls, env };
}

describe('진동 판단 (순수)', () => {
  it('켜짐 · 활성화 · 보임 · 시계 · 2초 안이어야 울린다', () => {
    expect(hapticAllowed(0, OK)).toBe(true);
    expect(hapticAllowed(HAPTIC_MAX_AGE_MS, OK)).toBe(true);
    expect(hapticAllowed(HAPTIC_MAX_AGE_MS + 1, OK)).toBe(false);
    // 시계 오차로 음수는 방금 일
    expect(hapticAllowed(-30, OK)).toBe(true);
    expect(hapticAllowed(Number.NaN, OK)).toBe(false);
    expect(hapticAllowed(0, { ...OK, enabled: false })).toBe(false);
    expect(hapticAllowed(0, { ...OK, activated: false })).toBe(false);
    expect(hapticAllowed(0, { ...OK, visible: false })).toBe(false);
    expect(hapticAllowed(0, { ...OK, clockOk: false })).toBe(false);
  });

  it('발각은 꺼짐 → 켜짐일 때만', () => {
    expect(spottedRose(false, true)).toBe(true);
    expect(spottedRose(true, true)).toBe(false);
    expect(spottedRose(true, false)).toBe(false);
    expect(spottedRose(false, false)).toBe(false);
  });

  it('설정 저장값: 0이면 끔, 없거나 그 밖이면 켬', () => {
    expect(parseHapticsSetting('0')).toBe(false);
    expect(parseHapticsSetting('1')).toBe(true);
    expect(parseHapticsSetting(null)).toBe(true);
  });
});

describe('진동 (Haptics)', () => {
  it('피격 한 번 = 한 번 울림, 오래된 피격은 0번', () => {
    const { h, calls } = device();
    h.hit(0);
    expect(calls).toEqual([[...HIT_PATTERN]]);
    h.hit(2500);
    expect(calls).toHaveLength(1);
  });

  it('발각 전환에 짧게 두 번 (이어지는 동안 0번, 꺼졌다 다시 켜지면 또)', () => {
    const { h, calls } = device();
    h.spotted(false);
    h.spotted(true);
    h.spotted(true);
    h.spotted(true);
    expect(calls).toEqual([[...SPOTTED_PATTERN]]);
    expect(SPOTTED_PATTERN.filter((_, i) => i % 2 === 0)).toHaveLength(2);
    h.spotted(false);
    h.spotted(true);
    expect(calls).toHaveLength(2);
  });

  it('오래된 발각 전환은 울리지 않지만 상태는 따라간다 (돌아온 뒤 이어지는 발각에 울리지 않는다)', () => {
    const { h, calls } = device();
    h.spotted(true, 5000);
    h.spotted(true, 0);
    expect(calls).toHaveLength(0);
  });

  it('사용자가 화면을 누르기 전에는 부르지 않는다', () => {
    const { h, calls, env } = device(false);
    h.hit(0);
    h.spotted(true);
    expect(calls).toHaveLength(0);
    env.activated = true;
    h.hit(0);
    expect(calls).toHaveLength(1);
  });

  it('설정을 끄면 0번 (저장이 막혀도 이번 접속에는 적용)', () => {
    const { h, calls } = device();
    expect(h.enabled).toBe(true);
    // 단위 테스트(node)에는 저장소가 없다: 저장 실패 = false
    expect(h.setEnabled(false)).toBe(false);
    expect(h.enabled).toBe(false);
    h.hit(0);
    h.spotted(true);
    expect(calls).toHaveLength(0);
    h.setEnabled(true);
    h.hit(0);
    expect(calls).toHaveLength(1);
  });

  it('숨겨져 있거나, 숨김에서 돌아와 시계를 다시 맞추기 전이면 0번 (멈췄다 돌아온 뒤 지난 일)', () => {
    const { h, calls, env } = device();
    env.visible = false;
    h.hit(0);
    expect(calls).toHaveLength(0);
    h.holdClock();
    env.visible = true;
    // 돌아온 직전 밀린 스냅샷의 피격: 시계를 믿을 수 없어 나이가 작게 잡혀도 울리지 않는다
    h.hit(100);
    h.spotted(true, 100);
    expect(calls).toHaveLength(0);
    h.clockSynced();
    h.hit(0);
    expect(calls).toHaveLength(1);
  });

  it('새 판이면 발각 상태를 처음으로', () => {
    const { h, calls } = device();
    h.spotted(true);
    h.reset();
    h.spotted(true);
    expect(calls).toHaveLength(2);
  });

  it('진동이 없는 기기(아이폰 사파리)에서는 아무것도 하지 않는다', () => {
    const h = new Haptics({ vibrate: null, activated: () => true, visible: () => true });
    expect(h.supported).toBe(false);
    expect(() => h.hit(0)).not.toThrow();
    expect(h.log).toHaveLength(0);
  });
});
