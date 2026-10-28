// 선택형 구글 로그인 계약 (docs/ACCOUNT_PLAN.md): 계정 날짜(시간대 자정) · 빈 기록 · 방이 계정을 자리에 들고 판 끝에 넘기되
// 어떤 메시지에도 싣지 않는다(정보 숨김 — 로그인 여부가 괴물 · 빠른 매칭에 사람 단서가 되지 않게)
import { describe, expect, it } from 'vitest';
import { type ClientMessage, type MatchRating, type Role, type ServerMessage } from '@decoy/shared';
import {
  PROGRESSION,
  applyRating,
  dayKeyInZone,
  emptyProfile,
  isBlankProfile,
  isTimeZone,
  msToMidnightInZone,
} from '@decoy/shared/meta';
import { BotDriver, RoomManager, devBotBrain, type Room, type Seat } from '@decoy/shared/sim';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
const ROLES: Role[] = ['monster', 'runner', 'guard', 'scout'];
const ACCOUNT = '0123456789abcdef0123456789abcdef';

describe('계정 날짜 (시간대 자정)', () => {
  // 2026-10-28 14:59:59.500 UTC = 23:59:59.500 KST
  const t = Date.UTC(2026, 9, 28, 14, 59, 59, 500);
  it('서울은 UTC+9 자정에 바뀐다', () => {
    expect(dayKeyInZone(t, 'Asia/Seoul')).toBe('2026-10-28');
    expect(dayKeyInZone(t + 500, 'Asia/Seoul')).toBe('2026-10-29');
    expect(dayKeyInZone(t, 'UTC')).toBe('2026-10-28');
    expect(dayKeyInZone(Date.UTC(2026, 0, 1, 2, 0, 0), 'America/Los_Angeles')).toBe('2025-12-31');
  });
  it('다음 자정까지 ms', () => {
    expect(msToMidnightInZone(t, 'Asia/Seoul')).toBe(500);
    expect(msToMidnightInZone(t + 500, 'Asia/Seoul')).toBe(86_400_000);
    expect(msToMidnightInZone(Date.UTC(2026, 9, 28, 0, 0, 0), 'UTC')).toBe(86_400_000);
  });
  it('시간대 이름 검사', () => {
    expect(isTimeZone('Asia/Seoul')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone(9)).toBe(false);
  });
});

describe('빈 기록', () => {
  it('새 기록은 비었고, 판 하나를 적립하면 비지 않았다', () => {
    const p = emptyProfile(1);
    expect(isBlankProfile(p)).toBe(true);
    const rating: MatchRating = {
      matchId: 'ABCD.1.x',
      role: 'runner',
      outcome: 'lose',
      durationSec: 100,
      emblems: [],
      stats: {},
    };
    const r = applyRating(p, rating, 2, PROGRESSION, '2026-10-28');
    expect(r).not.toBeNull();
    expect(isBlankProfile(r!.profile)).toBe(false);
    expect(isBlankProfile({ ...p, coins: 5 })).toBe(false);
    expect(isBlankProfile({ ...p, owned: ['s-scarf'] })).toBe(false);
    expect(isBlankProfile({ ...p, login: { last: '2026-10-28', streak: 1 } })).toBe(false);
  });
});

function joinMsg(room: string | null): Extract<ClientMessage, { t: 'join' }> {
  return { t: 'join', room, create: room === null, name: '', token: null, altTokens: [], bots: false };
}

interface Started {
  room: Room;
  seats: Seat[];
  conns: FakeConn[];
  rated: { seat: Seat; account: string | null; rating: MatchRating }[];
}

/** 넷이 방에 들어와 시작 — accounts[i]가 그 자리 연결의 계정 */
function startRoom(accounts: (string | null)[]): Started {
  const rated: Started['rated'] = [];
  const mgr = new RoomManager(
    { balance, seed: 9, testHooks: true },
    { rated: (_room, seat, rating) => rated.push({ seat, account: seat.account, rating }) },
  );
  const conns = accounts.map((a) => new FakeConn(a));
  const first = mgr.join(conns[0]!, joinMsg(null));
  if ('error' in first) throw new Error('create failed');
  const seats = [first.seat];
  for (let i = 1; i < conns.length; i += 1) {
    const r = mgr.join(conns[i]!, joinMsg(first.room.code));
    if ('error' in r) throw new Error('join failed');
    seats.push(r.seat);
  }
  seats.forEach((s, i) => first.room.handle(s, { t: 'role', role: ROLES[i]! }, 0));
  seats.forEach((s) => first.room.handle(s, { t: 'ready', ready: true }, 0));
  first.room.handle(seats[0]!, { t: 'start' }, 0);
  return { room: first.room, seats, conns, rated };
}

function finish(s: Started): void {
  let clock = 0;
  for (let t = 0; t < 60; t += 1) s.room.tick((clock += 33));
  s.room.handle(s.seats[0]!, { t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }, clock);
  for (let t = 0; t < 5; t += 1) s.room.tick((clock += 33));
  expect(s.room.phase).toBe('result');
}

/** 시각 · 무작위 이름 · 자리 토큰처럼 판마다 달라지는 값을 지운 메시지 원문 */
function shape(m: ServerMessage): string {
  return JSON.stringify(m)
    .replace(/"token":"[^"]*"/g, '"token":"-"')
    .replace(/"matchId":"[^"]*"/g, '"matchId":"-"');
}

describe('방: 계정은 자리에만 (메시지에 없음)', () => {
  it('자리에 연결의 계정을 들고, 판이 끝나 결과를 보낸 뒤 사람 자리마다 rated 훅으로 넘긴다', () => {
    const s = startRoom([null, ACCOUNT, null, null]);
    expect(s.seats.map((x) => x.account)).toEqual([null, ACCOUNT, null, null]);
    finish(s);
    expect(s.rated.map((r) => r.account)).toEqual([null, ACCOUNT, null, null]);
    // 결과를 보낸 뒤 (훅이 불릴 때 그 자리 연결은 이미 결과를 받았다)
    for (const r of s.rated) expect(r.rating.matchId).toBe(s.conns[0]!.last('result')!.rating!.matchId);
  });

  it('계정 ID는 어느 연결이 받은 메시지에도 없다 (로비 · 판 시작 · 스냅샷 · 결과)', () => {
    const s = startRoom([ACCOUNT, ACCOUNT, ACCOUNT, ACCOUNT]);
    finish(s);
    for (const c of s.conns) {
      expect(c.inbox.length).toBeGreaterThan(20);
      for (const m of c.inbox) {
        const raw = JSON.stringify(m);
        expect(raw).not.toContain(ACCOUNT);
        expect(raw).not.toMatch(/"account"\s*:/);
      }
    }
  });

  it('로그인 여부만 다른 두 판: 모든 자리가 받는 메시지가 같다 (괴물 · 다른 생존자에게 단서 없음)', () => {
    const a = startRoom([null, null, null, null]);
    const b = startRoom([ACCOUNT, ACCOUNT, null, ACCOUNT]);
    finish(a);
    finish(b);
    for (let i = 0; i < 4; i += 1) {
      expect(b.conns[i]!.inbox.map(shape), ROLES[i]).toEqual(a.conns[i]!.inbox.map(shape));
    }
  });

  it('다시 붙은 연결의 계정을 따른다 (로그아웃한 탭이 다시 붙으면 null)', () => {
    const s = startRoom([ACCOUNT, null, null, null]);
    const seat = s.seats[0]!;
    s.room.attach(seat, new FakeConn(null));
    expect(seat.account).toBeNull();
    s.room.attach(seat, new FakeConn(ACCOUNT));
    expect(seat.account).toBe(ACCOUNT);
  });
});

interface QuickRun {
  room: Room;
  conns: FakeConn[];
  rated: { account: string | null; rating: MatchRating }[];
}

/**
 * 빠른 매칭 두 사람(accounts[i]가 그 연결의 계정) → 대기 시간이 지나 빈자리 둘을 봇으로 채워 시작 → 판 끝(시험 setTime).
 * 봇 두뇌는 quick-match.test.ts와 같이 같은 프로세스 봇 드라이버(hooks.spawnBot · beforeStep)로 붙인다. canFillBots는 기본(늘 허용)
 */
function quickRun(accounts: (string | null)[]): QuickRun {
  const rated: QuickRun['rated'] = [];
  const driver = new BotDriver((info) => devBotBrain(info.role), balance);
  const mgr = new RoomManager(
    { balance, seed: 9, testHooks: true, devBots: true },
    { ...driver.hooks(), rated: (_room, seat, rating) => rated.push({ account: seat.account, rating }) },
  );
  const tickMs = 1000 / balance.network.serverTickHz;
  const waitMs = balance.matchmaking.quickMatchWait * 1000;
  let clock = 1000;
  const conns = accounts.map((a) => new FakeConn(a));
  const joined = conns.map((c, i) => mgr.quick(c, `사람${i}`, clock));
  const room = joined[0]!.room;
  expect(joined.every((j) => j.room === room)).toBe(true);
  // 대기 시간이 지날 때까지 사람은 1초마다 ping (클라이언트처럼 — 소식이 없는 자리는 자동 시작 때 대기열에서 빠진다)
  let nextPing = clock;
  while (room.phase === 'lobby') {
    clock += tickMs;
    if (clock >= nextPing) {
      for (const j of joined) room.handle(j.seat, { t: 'ping', c: clock }, clock);
      nextPing += 1000;
    }
    mgr.tick(clock);
    if (clock > 1000 + waitMs + 2000) throw new Error('빠른 매칭이 시작하지 않았다');
  }
  expect(room.kind).toBe('quick');
  expect(room.seats.filter((s) => s.bot)).toHaveLength(2);
  expect(driver.botsOf(room)).toHaveLength(2);
  for (let t = 0; t < 90; t += 1) mgr.tick((clock += tickMs));
  room.handle(joined[0]!.seat, { t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }, clock);
  for (let t = 0; t < 5; t += 1) mgr.tick((clock += tickMs));
  expect(room.phase).toBe('result');
  return { room, conns, rated };
}

describe('빠른 매칭: 로그인 여부가 단서가 되지 않는다', () => {
  it('로그인 여부만 다른 두 판(봇으로 채운 빠른 매칭): 사람 자리 둘이 받은 메시지가 같고, 계정 ID가 없고, 적립은 계정 자리만', () => {
    const guest = quickRun([null, null]);
    const mixed = quickRun([ACCOUNT, null]);
    for (let i = 0; i < 2; i += 1) {
      const a = guest.conns[i]!.inbox;
      const b = mixed.conns[i]!.inbox;
      // 로비 · 판 시작 명단 · 스냅샷 · 결과까지 받았다
      for (const t of ['lobby', 'match', 'snap', 'result'] as const)
        expect(mixed.conns[i]!.count(t), t).toBeGreaterThan(0);
      expect(b.map(shape), `사람 ${i}`).toEqual(a.map(shape));
      for (const m of b) {
        const raw = JSON.stringify(m);
        expect(raw).not.toContain(ACCOUNT);
        expect(raw).not.toMatch(/"account"\s*:/);
      }
    }
    // rated 훅: 사람 자리 둘만, 계정은 로그인한 자리만 (봇 자리는 평가하지 않는다)
    expect(mixed.rated.map((r) => r.account)).toEqual([ACCOUNT, null]);
    expect(guest.rated.map((r) => r.account)).toEqual([null, null]);
    expect(mixed.rated.map((r) => r.rating.role)).toEqual(guest.rated.map((r) => r.rating.role));
  });
});
