// M13b 기기 안 연습 서버(LocalTransport)와 첫 화면 상태 줄(serverStatus). 가짜 시계로 30Hz 루프 · 숨김 · JSON 왕복을 본다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@decoy/shared';
import { LocalTransport } from '../../client/src/localServer';
import { PRACTICE_BALANCE } from '../../client/src/practiceBalance';
import { UNREACHABLE_AFTER_MS, serverStatus } from '../../client/src/serverStatus';
import { loadTestBalance } from '../helpers/fixtures';

describe('첫 화면 서버 상태 줄', () => {
  const base = { connected: false, offline: false, waitingSince: 1000, nowMs: 1000 };
  it('연결됨 > 오프라인 > 90초까지 깨우는 중 > 그 뒤 연결할 수 없음', () => {
    expect(serverStatus({ ...base, connected: true, offline: true })).toEqual({
      status: 'connected',
      seconds: 0,
    });
    expect(serverStatus({ ...base, offline: true, nowMs: 500_000 })).toEqual({
      status: 'offline',
      seconds: 0,
    });
    expect(serverStatus({ ...base, nowMs: 1000 + 4_999 })).toEqual({ status: 'waking', seconds: 4 });
    expect(serverStatus({ ...base, nowMs: 1000 + UNREACHABLE_AFTER_MS })).toEqual({
      status: 'waking',
      seconds: 90,
    });
    expect(serverStatus({ ...base, nowMs: 1000 + UNREACHABLE_AFTER_MS + 1 })).toEqual({
      status: 'unreachable',
      seconds: 90,
    });
    // 기다리는 중이 아니면(시작 직전) 0초 깨우는 중
    expect(serverStatus({ ...base, waitingSince: null })).toEqual({ status: 'waking', seconds: 0 });
  });
});

describe('기기 안 연습 서버 (LocalTransport)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'queueMicrotask'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function start(role: 'runner' | 'monster' = 'runner'): { local: LocalTransport; inbox: ServerMessage[] } {
    const local = new LocalTransport({ testHooks: true, seed: 5 });
    const inbox: ServerMessage[] = [];
    local.subscribe((m) => inbox.push(m));
    local.send({ t: 'join', room: null, create: true, name: '나', token: null, altTokens: [], bots: true });
    local.send({ t: 'role', role });
    local.send({ t: 'ready', ready: true });
    local.send({ t: 'start' });
    return { local, inbox };
  }

  it('빌드에 넣은 balance.json 수치를 쓴다 (서버와 같은 값)', () => {
    expect(PRACTICE_BALANCE).toEqual(loadTestBalance());
  });

  it('역할을 고르고 시작하면 welcome · match를 받고 30Hz로 돌며 스냅샷 20Hz, 메시지는 JSON 왕복(새 객체)', async () => {
    const { local, inbox } = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.map((m) => m.t)).toContain('welcome');
    expect(inbox.find((m) => m.t === 'match')).toMatchObject({ info: { role: 'runner' } });
    const welcome = inbox.find((m) => m.t === 'welcome');
    expect(welcome?.t === 'welcome' && welcome.room.startsWith('P-')).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(local.ticks).toBeGreaterThanOrEqual(59);
    expect(local.ticks).toBeLessThanOrEqual(61);
    const snaps = inbox.filter((m) => m.t === 'snap');
    expect(snaps.length).toBeGreaterThanOrEqual(39);
    expect(snaps.length).toBeLessThanOrEqual(41);
    // 서버 시각 = 이 기기 시계 (시계 맞추기 없음)
    const last = snaps.at(-1);
    expect(last?.t === 'snap' && Math.abs(local.serverNow() - last.s.st)).toBeLessThan(40);
    expect(local.synced).toBe(true);
    expect(local.kind).toBe('local');
    local.close();
  });

  it('숨김(pause) 동안은 판이 멈추고, 다시 보이면(resume) 따라잡기 없이 이어 간다', async () => {
    const { local, inbox } = start();
    await vi.advanceTimersByTimeAsync(1000);
    const t1 = local.ticks;
    local.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(local.ticks).toBe(t1);
    const snaps = inbox.filter((m) => m.t === 'snap').length;
    local.resume();
    await vi.advanceTimersByTimeAsync(1000);
    expect(local.ticks - t1).toBeGreaterThanOrEqual(29);
    expect(local.ticks - t1).toBeLessThanOrEqual(31);
    // 판은 정지 표시 없이 그대로 (자리를 끊지 않았다)
    const last = inbox.filter((m) => m.t === 'snap').at(-1);
    expect(last?.t === 'snap' && last.s.world.paused).toBeNull();
    expect(inbox.filter((m) => m.t === 'snap').length - snaps).toBeGreaterThan(15);
    local.close();
  });

  it('닫으면 루프가 멈추고 더 받지 않으며, 보낸 것도 버린다', async () => {
    const { local, inbox } = start();
    await vi.advanceTimersByTimeAsync(500);
    local.close();
    const n = inbox.length;
    const ticks = local.ticks;
    local.send({ t: 'ping', c: 1 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(inbox.length).toBe(n);
    expect(local.ticks).toBe(ticks);
  });

  it('디버그 정답 상태와 테스트 명령(시간 끝내기 → 결과)', async () => {
    const { local, inbox } = start('monster');
    await vi.advanceTimersByTimeAsync(300);
    const truth = local.truth();
    expect(truth?.players).toHaveLength(4);
    expect(truth?.room).toMatch(/^P-/);
    local.send({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } });
    await vi.advanceTimersByTimeAsync(300);
    expect(inbox.some((m) => m.t === 'result')).toBe(true);
    local.close();
  });
});
