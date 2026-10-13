// 앱 생명주기 (MOBILE_PLAN M12 8 · 9번): 재연결 정책(1 → 2 → 4 → 5초, 숨김 · 오프라인이면 0회, 보임 · online이면 즉시),
// 수신 감시(4초 무응답이면 끊고 바로 다시, 60초 숨김 뒤 1초 안에 pong이 오면 재연결 0회), 마지막 방 30초 · in-progress 2초 재시도,
// 화면 꺼짐 방지, 뒤로 가기 항목, 새 소켓의 시계 다시 맞추기(net.ts). 시계 · 타이머는 가짜(FakeClock)로 주입한다
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BackGuard,
  LAST_ROOM_MS,
  LinkKeeper,
  RECONNECT_MAX_MS,
  RECV_TIMEOUT_MS,
  REJOIN_RETRY_MS,
  SETTLE_FALLBACK_MS,
  ScreenAwake,
  WATCH_TICK_MS,
  encodeLastRoom,
  freshLastRoom,
  isActivationEvent,
  practiceEntry,
  reconnectDelay,
  rejoinRetryDelay,
  returnTarget,
  staleAfterLeave,
  type Clock,
  type WakeLockLike,
} from '../../client/src/lifecycle';
import { NetClient } from '../../client/src/net';

/** 가짜 시계: advance(ms) 동안 때가 된 타이머를 순서대로 부른다. freeze(ms)는 타이머 없이 시간만 흐른다(정지한 페이지) */
class FakeClock implements Clock {
  t = 0;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): number {
    this.seq += 1;
    this.timers.set(this.seq, { at: this.t + Math.max(0, ms), fn });
    return this.seq;
  }

  clearTimeout(id: number): void {
    this.timers.delete(id);
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      // 늦은 타이머(멈춘 동안 때가 지난 것)는 지금 시각에 돈다
      this.t = Math.max(this.t, next[1].at);
      next[1].fn();
    }
    this.t = end;
  }

  /** 페이지가 멈춰 타이머가 돌지 않은 채 시간만 흐른다 */
  freeze(ms: number): void {
    this.t += ms;
  }
}

/** 소켓 흉내: connect를 세고, 시험이 opened · closed를 부른다. drop은 실제처럼 closed를 바로 부른다 */
function setup(env = { visible: true, online: true }) {
  const clock = new FakeClock();
  const log = { connects: 0, drops: 0, resyncs: 0 };
  let keeper: LinkKeeper | null = null;
  keeper = new LinkKeeper(
    {
      connect: () => (log.connects += 1),
      drop: () => {
        log.drops += 1;
        keeper?.closed();
      },
      resync: () => (log.resyncs += 1),
    },
    { visible: () => env.visible, online: () => env.online },
    clock,
  );
  return { clock, log, keeper, env };
}

describe('재연결 간격', () => {
  it('1 → 2 → 4초, 최대 5초', () => {
    expect([0, 1, 2, 3, 4, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 5000, 5000, 5000]);
    expect(RECONNECT_MAX_MS).toBe(5000);
  });

  it('끊길 때마다 간격을 늘리고, 열리면 처음으로', () => {
    const { clock, log, keeper } = setup();
    keeper.start();
    expect(log.connects).toBe(1);
    const waits: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      keeper.closed();
      const before = log.connects;
      let waited = 0;
      while (log.connects === before) {
        clock.advance(100);
        waited += 100;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1000, 2000, 4000, 5000, 5000]);
    keeper.opened();
    keeper.closed();
    clock.advance(999);
    expect(log.connects).toBe(6);
    clock.advance(1);
    expect(log.connects).toBe(7);
  });

  it('숨겨진 동안은 시도 0회, 보이게 되면 바로', () => {
    const { clock, log, keeper, env } = setup();
    keeper.start();
    keeper.opened();
    env.visible = false;
    keeper.visibility(false);
    keeper.closed();
    clock.advance(60_000);
    expect(log.connects).toBe(1);
    env.visible = true;
    keeper.visibility(true);
    expect(log.connects).toBe(2);
  });

  it('기다리는 중에 숨겨지면 멈춘다', () => {
    const { clock, log, keeper, env } = setup();
    keeper.start();
    keeper.closed();
    env.visible = false;
    keeper.visibility(false);
    clock.advance(30_000);
    expect(log.connects).toBe(1);
  });

  it('오프라인 동안은 시도 0회, online이면 바로 (pageshow도 같다)', () => {
    const { clock, log, keeper, env } = setup();
    keeper.start();
    keeper.opened();
    env.online = false;
    keeper.offline();
    keeper.closed();
    clock.advance(60_000);
    expect(log.connects).toBe(1);
    env.online = true;
    keeper.kick();
    expect(log.connects).toBe(2);
    // 이미 연결을 시도하는 중이면 kick은 아무것도 하지 않는다
    keeper.kick();
    expect(log.connects).toBe(2);
  });

  it('기다리는 중에 오프라인이 되면 걸어 둔 시도를 거둔다', () => {
    const { clock, log, keeper, env } = setup();
    keeper.start();
    keeper.closed();
    env.online = false;
    keeper.offline();
    clock.advance(30_000);
    expect(log.connects).toBe(1);
  });

  it('처음부터 오프라인이면 연결하지 않고 online을 기다린다', () => {
    const { log, keeper, env } = setup({ visible: true, online: false });
    keeper.start();
    expect(log.connects).toBe(0);
    env.online = true;
    keeper.kick();
    expect(log.connects).toBe(1);
  });

  it('다른 탭이 가져가면(stop) 다시 연결하지 않고, resume하면 바로', () => {
    const { clock, log, keeper } = setup();
    keeper.start();
    keeper.opened();
    keeper.stop();
    keeper.closed();
    clock.advance(60_000);
    keeper.kick();
    expect(log.connects).toBe(1);
    keeper.resume();
    expect(log.connects).toBe(2);
  });

  it('restart(나가기)는 지금 소켓을 버리고 기다리지 않고 다시 연결한다', () => {
    const { clock, log, keeper } = setup();
    keeper.start();
    keeper.opened();
    keeper.restart();
    expect(log.drops).toBe(1);
    clock.advance(0);
    expect(log.connects).toBe(2);
  });
});

describe('수신 감시', () => {
  it('서버가 1초마다 답하면 끊지 않는다', () => {
    const { clock, log, keeper } = setup();
    keeper.start();
    keeper.opened();
    for (let i = 0; i < 30; i += 1) {
      clock.advance(1000);
      keeper.heard();
    }
    expect(log.drops).toBe(0);
  });

  it('보이는 동안 4초 무응답이면 끊고 바로 다시 연결', () => {
    const { clock, log, keeper } = setup();
    keeper.start();
    keeper.opened();
    clock.advance(RECV_TIMEOUT_MS - 100);
    expect(log.drops).toBe(0);
    clock.advance(WATCH_TICK_MS + 100);
    expect(log.drops).toBe(1);
    expect(keeper.watchdogDrops).toBe(1);
    clock.advance(0);
    expect(log.connects).toBe(2);
  });

  it('60초 숨겼다 돌아와 1초 안에 pong이 오면 재연결 0회 (돌아오면 바로 ping)', () => {
    const { clock, log, keeper, env } = setup();
    keeper.start();
    keeper.opened();
    env.visible = false;
    keeper.visibility(false);
    // 숨겨진 동안은 메시지가 오지 않거나(백그라운드) 타이머가 멈춘다 — 어느 쪽이든 끊지 않는다
    clock.advance(30_000);
    clock.freeze(30_000);
    expect(log.drops).toBe(0);
    env.visible = true;
    keeper.visibility(true);
    expect(log.resyncs).toBe(1);
    clock.advance(800);
    keeper.heard();
    // 그 뒤로는 평소처럼 1초마다
    for (let i = 0; i < 10; i += 1) {
      clock.advance(1000);
      keeper.heard();
    }
    expect(log.drops).toBe(0);
    expect(log.connects).toBe(1);
  });

  it('숨김에서 돌아와 4초 안에 아무 응답이 없으면 끊는다', () => {
    const { clock, log, keeper, env } = setup();
    keeper.start();
    keeper.opened();
    env.visible = false;
    keeper.visibility(false);
    clock.freeze(60_000);
    env.visible = true;
    keeper.visibility(true);
    clock.advance(RECV_TIMEOUT_MS - 200);
    expect(log.drops).toBe(0);
    clock.advance(WATCH_TICK_MS + 200);
    expect(log.drops).toBe(1);
  });

  it('보이는 채로 페이지가 멈췄다 돌아오면(정지 · 버벅임) 끊지 않고 확인 ping부터', () => {
    const { clock, log, keeper } = setup();
    keeper.start();
    keeper.opened();
    clock.advance(1000);
    keeper.heard();
    clock.freeze(10_000);
    clock.advance(WATCH_TICK_MS);
    expect(log.drops).toBe(0);
    expect(log.resyncs).toBe(1);
    clock.advance(300);
    keeper.heard();
    clock.advance(3000);
    expect(log.drops).toBe(0);
  });
});

describe('마지막 방 (터치 · 설치 앱)', () => {
  it('30초 창은 서버 재접속 유예와 같다', () => {
    const balance = JSON.parse(readFileSync('config/balance.json', 'utf8')) as {
      match: { reconnectGrace: number };
    };
    expect(LAST_ROOM_MS).toBe(balance.match.reconnectGrace * 1000);
  });

  it('30초 안이면 그 방, 지났거나 깨졌으면 없음', () => {
    const raw = encodeLastRoom('ABCD', 100_000);
    expect(freshLastRoom(raw, 100_000)).toEqual({ room: 'ABCD', at: 100_000 });
    expect(freshLastRoom(raw, 130_000)?.room).toBe('ABCD');
    expect(freshLastRoom(raw, 130_001)).toBeNull();
    // 기기 시계를 되돌렸으면(미래 시각) 믿지 않는다
    expect(freshLastRoom(raw, 99_000)).toBeNull();
    expect(freshLastRoom(null, 0)).toBeNull();
    expect(freshLastRoom('{', 0)).toBeNull();
    expect(freshLastRoom('{"room":"ab","at":0}', 0)).toBeNull();
    expect(freshLastRoom('{"room":"ABCD"}', 0)).toBeNull();
  });

  it('옛 소켓이 남아 거절되면 30초 창 안에서 2초 간격으로 다시', () => {
    const last = { room: 'ABCD', at: 0 };
    expect(REJOIN_RETRY_MS).toBe(2000);
    const tries: number[] = [];
    let now = 1500;
    for (;;) {
      const ms = rejoinRetryDelay(last, now);
      if (ms === null) break;
      now += ms;
      tries.push(now);
    }
    expect(tries[0]).toBe(3500);
    expect(tries.every((t, i) => i === 0 || t - tries[i - 1]! === 2000)).toBe(true);
    expect(tries.at(-1)!).toBeLessThanOrEqual(LAST_ROOM_MS);
    expect(tries.at(-1)! + REJOIN_RETRY_MS).toBeGreaterThan(LAST_ROOM_MS);
    expect(rejoinRetryDelay(last, 28_000)).toBe(2000);
    expect(rejoinRetryDelay(last, 28_001)).toBeNull();
  });

  it('주소에 방이 없거나 같은 방 주소로 다시 열면 복귀(거절되면 다시 시도), 다른 방 주소면 아님', () => {
    const last = { room: 'ABCD', at: 0 };
    expect(returnTarget(null, last)).toBe(last);
    // 같은 방 초대 링크 · 기록으로 다시 엶 (welcome마다 주소에 ?room=이 붙는다)
    expect(returnTarget('ABCD', last)).toBe(last);
    expect(returnTarget('WXYZ', last)).toBeNull();
    expect(returnTarget(null, null)).toBeNull();
    expect(returnTarget('ABCD', null)).toBeNull();
  });

  it('?practice=1이 방 링크 없이 오면 30초 안 마지막 방보다 연습이 우선, 방 링크와 함께면 방 링크가 이긴다 (검토 반영 F12)', () => {
    const last = { room: 'ABCD', at: 0 };
    // 깨우기 화면의 "봇과 연습"(방 코드를 뺀 ?practice=1): 방 복귀 대신 역할 고르기
    expect(returnTarget(null, last, true)).toBeNull();
    expect(practiceEntry(true, null)).toBe(true);
    // 방 링크 + practice: 지금처럼 방 링크(같은 방이면 복귀)
    expect(returnTarget('ABCD', last, true)).toBe(last);
    expect(practiceEntry(true, 'ABCD')).toBe(false);
    // practice가 없으면 그대로
    expect(returnTarget(null, last, false)).toBe(last);
    expect(practiceEntry(false, null)).toBe(false);
  });
});

describe('방을 나온 뒤 늦게 온 메시지 (검토 반영 F07)', () => {
  it("'leave' 뒤 다음 welcome 전의 lobby · match · snap · result는 버리고, pong · error · welcome은 통과", () => {
    for (const t of ['lobby', 'match', 'snap', 'result']) expect(staleAfterLeave(true, t), t).toBe(true);
    for (const t of ['pong', 'error', 'welcome']) expect(staleAfterLeave(true, t), t).toBe(false);
  });

  it('나가지 않았거나 다음 welcome을 받은 뒤에는 모두 통과', () => {
    for (const t of ['lobby', 'match', 'snap', 'result', 'pong', 'error', 'welcome'])
      expect(staleAfterLeave(false, t), t).toBe(false);
  });
});

describe('화면 꺼짐 방지', () => {
  function fakeApi(fail = false) {
    const calls: string[] = [];
    const sentinels: { released: boolean; release(): Promise<void> }[] = [];
    const api: WakeLockLike = {
      request: () => {
        calls.push('request');
        if (fail) return Promise.reject(new DOMException('denied', 'NotAllowedError'));
        const s = {
          released: false,
          release: () => {
            s.released = true;
            calls.push('release');
            return Promise.resolve();
          },
        };
        sentinels.push(s);
        return Promise.resolve(s);
      },
    };
    return { api, calls, sentinels };
  }
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it('판 시작 때 요청, 숨겨져 풀린 뒤 다시 보이면 재요청, 끝나면 해제', async () => {
    const { api, calls, sentinels } = fakeApi();
    let visible = true;
    const a = new ScreenAwake(
      () => api,
      () => visible,
    );
    a.set(true);
    await flush();
    a.shown();
    await flush();
    expect(calls).toEqual(['request']);
    // 숨겨지면 브라우저가 스스로 놓는다
    visible = false;
    sentinels[0]!.released = true;
    a.shown();
    expect(calls).toEqual(['request']);
    visible = true;
    a.shown();
    await flush();
    expect(calls).toEqual(['request', 'request']);
    a.set(false);
    expect(calls).toEqual(['request', 'request', 'release']);
    a.shown();
    await flush();
    expect(calls.filter((c) => c === 'request')).toHaveLength(2);
  });

  it('지원하지 않거나 거부되면 조용히 (예외 없음), 다음 기회에 다시', async () => {
    const none = new ScreenAwake(
      () => null,
      () => true,
    );
    expect(() => none.set(true)).not.toThrow();
    const { api, calls } = fakeApi(true);
    const a = new ScreenAwake(
      () => api,
      () => true,
    );
    a.set(true);
    await flush();
    a.shown();
    await flush();
    expect(calls).toEqual(['request', 'request']);
  });

  it('요청을 기다리는 사이 판이 끝나면 받자마자 놓는다', async () => {
    const { api, calls } = fakeApi();
    const a = new ScreenAwake(
      () => api,
      () => true,
    );
    a.set(true);
    a.set(false);
    await flush();
    expect(calls).toEqual(['request', 'release']);
  });
});

describe('뒤로 가기 (터치 · 설치 앱)', () => {
  function guard() {
    const calls: string[] = [];
    let backs = 0;
    const g = new BackGuard(
      {
        pushState: () => calls.push('push'),
        back: () => calls.push('back'),
      },
      () => (backs += 1),
    );
    return { g, calls, backs: () => backs };
  }

  it('판 안 첫 사용자 탭에서 항목을 한 번 넣고, 뒤로 가기면 확인 창 · "계속"에서 다시 넣는다', () => {
    const { g, calls, backs } = guard();
    g.gesture();
    expect(calls).toEqual([]);
    g.arm();
    g.gesture();
    g.gesture();
    expect(calls).toEqual(['push']);
    expect(g.popped()).toBe(true);
    expect(backs()).toBe(1);
    expect(g.guarding).toBe(false);
    g.gesture();
    expect(calls).toEqual(['push', 'push']);
  });

  it('판이 끝나면 넣어 둔 항목을 걷어 내고 그 popstate는 무시한다', () => {
    const { g, calls, backs } = guard();
    g.arm();
    g.gesture();
    g.disarm();
    expect(calls).toEqual(['push', 'back']);
    expect(g.popped()).toBe(true);
    expect(backs()).toBe(0);
    // 그 뒤의 뒤로 가기는 브라우저 동작 그대로
    expect(g.popped()).toBe(false);
  });

  it('판 중 새로고침 · 탭 폐기 뒤 복원: 지금 항목이 이미 내 항목이면 하나 더 넣지 않고, 판이 끝나면 그것을 걷어 낸다', () => {
    const calls: string[] = [];
    let backs = 0;
    const make = (state: unknown): BackGuard =>
      new BackGuard(
        { pushState: () => calls.push('push'), back: () => calls.push('back') },
        () => (backs += 1),
        state,
      );
    const g = make({ decoyGuard: 1 });
    expect(g.guarding).toBe(true);
    g.arm();
    g.gesture();
    expect(calls).toEqual([]);
    // 뒤로 가기 → 확인 창, "계속"에서 다시 넣는다
    expect(g.popped()).toBe(true);
    expect(backs).toBe(1);
    g.gesture();
    expect(calls).toEqual(['push']);
    // 판에 다시 들어가지 못했어도(arm 없이) 결과 · 첫 화면에서 옛 항목을 걷어 낸다
    calls.length = 0;
    const h = make({ decoyGuard: 1 });
    h.disarm();
    expect(calls).toEqual(['back']);
    expect(h.popped()).toBe(true);
    expect(backs).toBe(1);
    // 다른 기록 상태는 내 항목이 아니다
    for (const other of [null, undefined, 'x', 1, {}, { decoyGuard: 2 }]) {
      calls.length = 0;
      const o = make(other);
      expect(o.guarding).toBe(false);
      o.disarm();
      expect(calls).toEqual([]);
    }
  });

  it('PC(넣지 않음)는 뒤로 가기를 건드리지 않는다', () => {
    const { g, calls } = guard();
    expect(g.popped()).toBe(false);
    g.disarm();
    expect(calls).toEqual([]);
  });

  // 수정 검토: 판 중 새로고침 · 탭 복원으로 남은 항목을 '첫 화면으로'에서 걷어 낼 때, 주소의 room을 순회 전에 지우면
  // 걷어 낼 항목의 주소만 바뀌고 순회 뒤 아래 항목의 /?room=이 돌아왔다
  describe('걷어 내는 순회가 끝난 뒤에 주소를 고친다 (whenSettled)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** 명세처럼 동작하는 기록: pushState · replaceState는 바로, back은 작업 큐에 넣었다가 순회 뒤 popstate */
    function browser(entries: { url: string; state: unknown }[], start: number) {
      let index = start;
      const pops: (() => void)[] = [];
      const history = {
        pushState: (state: unknown) => {
          entries.splice(index + 1);
          entries.push({ url: entries[index]!.url, state });
          index += 1;
        },
        back: () => {
          globalThis.setTimeout(() => {
            index = Math.max(0, index - 1);
            for (const pop of pops) pop();
          }, 0);
        },
      };
      return {
        history,
        onPop: (fn: () => void) => pops.push(fn),
        url: () => entries[index]!.url,
        replace: (url: string) => {
          entries[index]!.url = url;
        },
      };
    }

    it('새로고침 뒤 남은 내 항목: 순회 전에는 고치지 않고, 순회 뒤 아래 항목의 room을 지운다', () => {
      vi.useFakeTimers();
      const guardState = { decoyGuard: 1 };
      const b = browser(
        [
          { url: '/?room=ABCD', state: null },
          { url: '/?room=ABCD', state: guardState },
        ],
        1,
      );
      const g = new BackGuard(b.history, () => undefined, guardState);
      b.onPop(() => void g.popped());
      g.disarm();
      g.whenSettled(() => b.replace('/'));
      expect(b.url()).toBe('/?room=ABCD');
      vi.advanceTimersByTime(0);
      expect(b.url()).toBe('/');
      // 대조: 순회 전에 바로 고치면 아래 항목의 room이 남는다 (고치기 전 동작)
      const c = browser(
        [
          { url: '/?room=ABCD', state: null },
          { url: '/?room=ABCD', state: guardState },
        ],
        1,
      );
      const h = new BackGuard(c.history, () => undefined, guardState);
      c.onPop(() => void h.popped());
      h.disarm();
      c.replace('/');
      vi.advanceTimersByTime(0);
      expect(c.url()).toBe('/?room=ABCD');
    });

    it('걷어 낼 항목이 없으면 바로, popstate가 오지 않으면 대신 시간이 지난 뒤 부른다', () => {
      vi.useFakeTimers();
      const { g } = guard();
      const calls: string[] = [];
      g.whenSettled(() => calls.push('now'));
      expect(calls).toEqual(['now']);
      g.arm();
      g.gesture();
      g.disarm();
      g.whenSettled(() => calls.push('late'));
      vi.advanceTimersByTime(SETTLE_FALLBACK_MS - 1);
      expect(calls).toEqual(['now']);
      vi.advanceTimersByTime(1);
      expect(calls).toEqual(['now', 'late']);
      // 늦게 온 popstate는 무시하고 다시 부르지 않는다
      expect(g.popped()).toBe(true);
      expect(calls).toEqual(['now', 'late']);
    });
  });

  it('사용자 활성화가 생기는 입력: 키 · click · 마우스가 아닌 pointerup', () => {
    expect(isActivationEvent('pointerup', 'touch')).toBe(true);
    expect(isActivationEvent('pointerup', 'pen')).toBe(true);
    expect(isActivationEvent('pointerup', 'mouse')).toBe(false);
    expect(isActivationEvent('pointerdown', 'touch')).toBe(false);
    expect(isActivationEvent('click', undefined)).toBe(true);
    expect(isActivationEvent('keydown', undefined)).toBe(true);
  });
});

// ───────────── 새 소켓의 시계 다시 맞추기 (net.ts, 진동이 풀리는 조건) ─────────────

/** WebSocket 흉내: 시험이 open · message · close를 낸다 */
class FakeWs {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static all: FakeWs[] = [];
  readyState = FakeWs.CONNECTING;
  readonly sent: string[] = [];
  private readonly handlers = new Map<string, ((ev: { data?: string }) => void)[]>();

  constructor(readonly url: string) {
    FakeWs.all.push(this);
  }

  addEventListener(type: string, fn: (ev: { data?: string }) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.readyState = 3;
  }

  fire(type: 'open' | 'message' | 'close', data?: string): void {
    if (type === 'open') this.readyState = FakeWs.OPEN;
    for (const fn of this.handlers.get(type) ?? []) fn({ data });
  }

  /** 이 소켓으로 보낸 마지막 ping의 c */
  lastPing(): number {
    const pings = this.sent
      .map((t) => JSON.parse(t) as { t: string; c: number })
      .filter((m) => m.t === 'ping');
    const c = pings.at(-1)?.c;
    if (c === undefined) throw new Error('ping 없음');
    return c;
  }
}

describe('새 소켓의 시계 다시 맞추기 (net.ts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWs.all = [];
  });

  const pong = (c: number): string => JSON.stringify({ t: 'pong', c, s: c + 5000 });
  /** 첫 ping은 setTimeout(0) 뒤에 나간다 */
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

  it('새 소켓이 열리면 첫 pong에서 onResynced: 다시 맞추는 중 끊겨(감시 · 숨김 중 OS) 새로 연결해도 진동 시계가 풀린다', async () => {
    vi.stubGlobal('WebSocket', FakeWs);
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    });
    const net = new NetClient('ws://test/ws', { lag: 0, jitterMs: 0 });
    let resynced = 0;
    net.onResynced = () => (resynced += 1);
    net.connect();
    const ws1 = FakeWs.all[0]!;
    ws1.fire('open');
    expect(net.clockFresh).toBe(false);
    await flush();
    ws1.fire('message', pong(ws1.lastPing()));
    expect(resynced).toBe(1);
    expect(net.clockFresh).toBe(true);
    // 보임 → 다시 맞추기 시작 → 응답 없이 끊김 (반쯤 열린 소켓을 감시가 버림 · 숨김 중 OS가 닫음)
    net.resync();
    expect(net.clockFresh).toBe(false);
    const oldPing = ws1.lastPing();
    net.drop();
    net.connect();
    const ws2 = FakeWs.all[1]!;
    ws2.fire('open');
    expect(net.clockFresh).toBe(false);
    // 지연 큐에 남아 새 소켓으로 나간 옛 ping의 pong은 표본이 아니다
    ws2.fire('message', pong(oldPing));
    expect(resynced).toBe(1);
    expect(net.clockFresh).toBe(false);
    await flush();
    ws2.fire('message', pong(ws2.lastPing()));
    expect(resynced).toBe(2);
    expect(net.clockFresh).toBe(true);
    net.drop();
  });

  it('버린(drop) 소켓의 늦은 open · message · close는 무시한다: 새 소켓의 연결 상태 · 알림 · 메시지를 건드리지 않는다 (net.ts 가드)', () => {
    vi.stubGlobal('WebSocket', FakeWs);
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    });
    const net = new NetClient('ws://test/ws', { lag: 0, jitterMs: 0 });
    const got: string[] = [];
    net.on((m) => got.push(m.t));
    let opens = 0;
    let closes = 0;
    let heard = 0;
    net.onOpen = () => (opens += 1);
    net.onClose = () => (closes += 1);
    net.onHeard = () => (heard += 1);
    // 옛 소켓: 열리기 전에 버림(연결 시간 초과 · 감시 · 나가기) → 새 소켓이 열림
    net.connect();
    const ws1 = FakeWs.all[0]!;
    net.drop();
    expect(closes).toBe(1);
    net.connect();
    const ws2 = FakeWs.all[1]!;
    ws2.fire('open');
    expect([opens, net.connected]).toEqual([1, true]);
    // 옛 소켓에서 늦게 온 이벤트
    const lobby = JSON.stringify({ t: 'lobby', lobby: { room: 'OLDR' } });
    ws1.fire('open');
    ws1.fire('message', lobby);
    ws1.fire('close');
    expect(opens).toBe(1);
    expect(got).toEqual([]);
    expect(heard).toBe(0);
    expect(closes).toBe(1);
    expect(net.connected).toBe(true);
    // 새 소켓은 그대로 받는다
    ws2.fire('message', lobby);
    expect(got).toEqual(['lobby']);
    expect(heard).toBe(1);
    net.drop();
  });
});
