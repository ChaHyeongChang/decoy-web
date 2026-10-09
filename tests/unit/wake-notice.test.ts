// '서버 깨우는 중' 안내: 언제 보이고 언제 사라지는가
import { describe, expect, it } from 'vitest';
import { WAKE_NOTICE_DELAY_MS, WakeNoticeState } from '../../client/src/wakeNotice';

describe('서버 깨우기 안내', () => {
  it('처음 연결을 기다린 지 잠깐(WAKE_NOTICE_DELAY_MS)이 지나야 보인다', () => {
    const s = new WakeNoticeState();
    s.connecting(1000);
    expect(s.view(1000 + WAKE_NOTICE_DELAY_MS - 1).visible).toBe(false);
    const v = s.view(1000 + WAKE_NOTICE_DELAY_MS);
    expect(v.visible).toBe(true);
    expect(v.variant).toBe('waking');
  });

  it('연결되면 사라진다', () => {
    const s = new WakeNoticeState();
    s.connecting(0);
    expect(s.view(5000).visible).toBe(true);
    s.opened();
    expect(s.view(6000).visible).toBe(false);
  });

  it('기다린 시간은 처음 시도부터 센다 (다시 시도해도 0으로 돌아가지 않는다)', () => {
    const s = new WakeNoticeState();
    s.connecting(0);
    s.closed(1000);
    s.connecting(2000);
    s.closed(30_000);
    expect(s.view(42_500).seconds).toBe(42);
  });

  it('연결됐다가 끊기면 "다시 연결하는 중"으로 보이고, 기다린 시간은 끊긴 때부터', () => {
    const s = new WakeNoticeState();
    s.connecting(0);
    s.opened();
    s.closed(100_000);
    expect(s.view(100_000 + WAKE_NOTICE_DELAY_MS - 1).visible).toBe(false);
    const v = s.view(110_000);
    expect(v.visible).toBe(true);
    expect(v.variant).toBe('reconnecting');
    expect(v.seconds).toBe(10);
  });

  it('다른 탭이 자리를 가져가 다시 연결하지 않으면 보이지 않는다', () => {
    const s = new WakeNoticeState();
    s.connecting(0);
    s.opened();
    s.closed(1000);
    s.stop();
    expect(s.view(60_000).visible).toBe(false);
    s.closed(61_000);
    expect(s.view(120_000).visible).toBe(false);
  });

  it('오프라인이면 본문을 인터넷 연결 안내로 바꾸라고 알리고, 다시 온라인이면 원래대로 (M12)', () => {
    const s = new WakeNoticeState();
    s.connecting(0);
    expect(s.view(WAKE_NOTICE_DELAY_MS).offline).toBe(false);
    s.setOffline(true);
    const v = s.view(WAKE_NOTICE_DELAY_MS + 1000);
    expect(v.visible).toBe(true);
    expect(v.offline).toBe(true);
    s.setOffline(false);
    expect(s.view(WAKE_NOTICE_DELAY_MS + 2000).offline).toBe(false);
  });
});
