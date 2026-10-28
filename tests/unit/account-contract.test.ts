// 선택형 구글 로그인 계약 (docs/ACCOUNT_PLAN.md 5 · 6절): 계정 날짜(시간대 자정) · 빈 기록 · 자리 계정은 화면이 join · quick ·
// rematch에서 밝힌 tag가 그 연결의 세션 쿠키 tag와 같을 때만(새 자리 · 재접속 · 다시 하기) · 방은 계정을 자리에 들고 판 끝에 넘기되
// 본인 welcome · 본인 result(판 끝에 적립한 계정 — 결과 단계에 다시 붙어도 그대로) 말고는 어떤 메시지에도 싣지 않는다(정보 숨김 —
// 로그인 여부가 괴물 · 빠른 매칭에 사람 단서가 되지 않게)
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
import { BotDriver, ServerCore, devBotBrain, type CoreLink, type Room, type Seat } from '@decoy/shared/sim';
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

const TAG = 'TagOfAccount0001';
const OTHER_TAG = 'TagOfAccount0002';

/**
 * 연결 하나: 세션 쿠키의 계정(account · tag — 서버가 WebSocket을 열 때 쿠키로 둔다)과 join · quick에 밝히는 tag(declare — 화면이
 * 계정 모드일 때만 보낸다. 없으면 밝히지 않음)
 */
interface Player {
  account: string | null;
  tag: string | null;
  declare?: string;
}

const GUEST: Player = { account: null, tag: null };
const SIGNED: Player = { account: ACCOUNT, tag: TAG, declare: TAG };

/** n번째 로그인한 사람 (계정마다 다른 키 · tag) */
function signed(n: number): Player {
  const tag = `TagOfAccount${String(n).padStart(4, '0')}`;
  return { account: String(n).repeat(32).slice(0, 32), tag, declare: tag };
}

function joinMsg(
  room: string | null,
  account?: string,
  token: string | null = null,
): Extract<ClientMessage, { t: 'join' }> {
  const m: Extract<ClientMessage, { t: 'join' }> = {
    t: 'join',
    room,
    create: room === null,
    name: '',
    token,
    altTokens: [],
    bots: false,
  };
  if (account !== undefined) m.account = account;
  return m;
}

const fail = (err: unknown): never => {
  throw err;
};

interface Started {
  core: ServerCore;
  room: Room;
  seats: Seat[];
  conns: FakeConn[];
  rated: { seat: Seat; account: string | null; rating: MatchRating }[];
}

/** 넷이 서버 연결 처리(ServerCore — 실제 서버 · 기기 안 연습과 같은 길)로 친구 방에 들어와 시작 */
function startRoom(players: Player[]): Started {
  const rated: Started['rated'] = [];
  const core = new ServerCore(
    { balance, seed: 9, testHooks: true },
    { rated: (_room, seat, rating) => rated.push({ seat, account: seat.account, rating }) },
    () => 0,
  );
  const conns = players.map((p) => new FakeConn(p.account, p.tag));
  const links = conns.map((c) => core.connect(c, fail));
  links[0]!.receive(JSON.stringify(joinMsg(null, players[0]!.declare)));
  const code = conns[0]!.last('welcome')!.room;
  for (let i = 1; i < links.length; i += 1)
    links[i]!.receive(JSON.stringify(joinMsg(code, players[i]!.declare)));
  const room = core.manager.rooms.get(code)!;
  const seats = conns.map((c) => room.seatById(c.last('welcome')!.you)!);
  seats.forEach((s, i) => room.handle(s, { t: 'role', role: ROLES[i]! }, 0));
  seats.forEach((s) => room.handle(s, { t: 'ready', ready: true }, 0));
  room.handle(seats[0]!, { t: 'start' }, 0);
  return { core, room, seats, conns, rated };
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

/**
 * 본인 welcome · 본인 result의 계정 칸만 뺀 원문 (그 밖의 모든 메시지 — 다른 참가자에게서 비롯된 것 — 은 그대로 비교한다).
 * 받는 사람별로 만드는 메시지라 그 칸은 늘 받는 사람 자기 것이다
 */
function shapeExceptOwnAccount(m: ServerMessage): string {
  return shape(m.t === 'welcome' || m.t === 'result' ? { ...m, account: undefined } : m);
}

/** "account" 칸은 본인 welcome · 본인 result에만 */
const OWN_ACCOUNT_KINDS: readonly ServerMessage['t'][] = ['welcome', 'result'];

describe('자리 계정 = 화면이 밝힌 tag와 그 연결의 세션 쿠키 tag가 같을 때만 (ServerCore)', () => {
  it('같음 → 계정 자리, 다름 · 안 밝힘 · 쿠키 없음 → 게스트 자리. welcome.account는 받아들인 tag, rated 훅은 그 계정만', () => {
    const s = startRoom([
      SIGNED,
      { account: ACCOUNT, tag: TAG, declare: OTHER_TAG },
      { account: ACCOUNT, tag: TAG },
      { account: null, tag: null, declare: TAG },
    ]);
    expect(s.seats.map((x) => x.account)).toEqual([ACCOUNT, null, null, null]);
    expect(s.seats.map((x) => x.accountTag)).toEqual([TAG, null, null, null]);
    expect(s.conns.map((c) => c.last('welcome')!.account)).toEqual([TAG, null, null, null]);
    finish(s);
    expect(s.rated.map((r) => r.account)).toEqual([ACCOUNT, null, null, null]);
    // 결과를 보낸 뒤 (훅이 불릴 때 그 자리 연결은 이미 결과를 받았다)
    for (const r of s.rated) expect(r.rating.matchId).toBe(s.conns[0]!.last('result')!.rating!.matchId);
  });

  it('재접속(자리 토큰)은 그때 밝힌 계정으로 다시 정한다: 안 밝히면 게스트, 다시 밝히면 계정, 쿠키가 다른 계정이면 게스트 — 판 끝 적립은 마지막 것', () => {
    const s = startRoom([SIGNED, GUEST, GUEST, GUEST]);
    const seat = s.seats[0]!;
    const rejoin = (p: Player): FakeConn => {
      const c = new FakeConn(p.account, p.tag);
      s.core.connect(c, fail).receive(JSON.stringify(joinMsg(s.room.code, p.declare, seat.token)));
      expect(seat.conn).toBe(c);
      return c;
    };
    // 같은 쿠키인데 화면이 게스트 모드 (그사이 다른 탭에서 로그아웃 → 이 탭은 표시를 잃음)
    const quiet = rejoin({ account: ACCOUNT, tag: TAG });
    expect(seat.account).toBeNull();
    expect(quiet.last('welcome')!.account).toBeNull();
    // 다시 계정 모드로 밝힘
    const back = rejoin(SIGNED);
    expect(seat.account).toBe(ACCOUNT);
    expect(back.last('welcome')!.account).toBe(TAG);
    // 다른 계정 쿠키로 옛 tag를 밝힘 (다른 탭에서 계정을 바꿈) — 받아들이지 않는다
    const swapped = rejoin({ account: '9'.repeat(32), tag: OTHER_TAG, declare: TAG });
    expect(seat.account).toBeNull();
    expect(seat.accountTag).toBeNull();
    expect(swapped.last('welcome')!.account).toBeNull();
    finish(s);
    expect(s.rated[0]!.account).toBeNull();
  });
});

describe('정보 숨김: 계정은 자리에만 — 다른 참가자에게 가는 메시지는 그대로', () => {
  it('계정 키는 어느 연결이 받은 메시지에도 없고, "account" 칸은 본인 welcome · 본인 result에만 (자기 tag) — 다른 자리 tag도 없다', () => {
    const players = [signed(1), signed(2), signed(3), signed(4)];
    const s = startRoom(players);
    finish(s);
    s.conns.forEach((c, i) => {
      expect(c.inbox.length).toBeGreaterThan(20);
      for (const m of c.inbox) {
        const raw = JSON.stringify(m);
        for (const p of players) expect(raw).not.toContain(p.account!);
        for (const [j, p] of players.entries()) if (j !== i) expect(raw).not.toContain(p.tag!);
        if (!OWN_ACCOUNT_KINDS.includes(m.t)) expect(raw).not.toMatch(/"account"\s*:/);
      }
      expect(c.last('welcome')!.account).toBe(players[i]!.tag);
      expect(c.last('result')!.account).toBe(players[i]!.tag);
    });
  });

  it('로그인 여부만 다른 두 판: 모든 자리가 받는 메시지가 본인 welcome · result의 account 말고는 같다 (괴물 · 다른 생존자에게 단서 없음)', () => {
    const a = startRoom([GUEST, GUEST, GUEST, GUEST]);
    const b = startRoom([signed(1), signed(2), GUEST, signed(3)]);
    finish(a);
    finish(b);
    for (let i = 0; i < 4; i += 1) {
      expect(b.conns[i]!.inbox.map(shapeExceptOwnAccount), ROLES[i]).toEqual(
        a.conns[i]!.inbox.map(shapeExceptOwnAccount),
      );
    }
    // 게스트 자리(guard)는 글자 하나 다르지 않다
    expect(b.conns[2]!.inbox.map(shape)).toEqual(a.conns[2]!.inbox.map(shape));
    // 본인 welcome · result만 다르다
    for (const t of ['welcome', 'result'] as const) {
      expect(b.conns.map((c) => c.last(t)!.account)).toEqual([
        signed(1).tag,
        signed(2).tag,
        null,
        signed(3).tag,
      ]);
      expect(a.conns.map((c) => c.last(t)!.account)).toEqual([null, null, null, null]);
    }
  });
});

interface QuickRun {
  core: ServerCore;
  room: Room;
  conns: FakeConn[];
  links: CoreLink[];
  rated: { account: string | null; rating: MatchRating }[];
}

/**
 * 빠른 매칭 두 사람(players[i] — 그 연결의 쿠키 계정 · 밝힌 tag)이 서버 연결 처리(ServerCore)로 대기열에 → 대기 시간이 지나 빈자리
 * 둘을 봇으로 채워 시작 → 판 끝(시험 setTime). 봇 두뇌는 quick-match.test.ts와 같이 같은 프로세스 봇 드라이버(hooks.spawnBot ·
 * beforeStep)로 붙인다. canFillBots는 기본(늘 허용)
 */
function quickRun(players: Player[]): QuickRun {
  const rated: QuickRun['rated'] = [];
  const driver = new BotDriver((info) => devBotBrain(info.role), balance);
  const tickMs = 1000 / balance.network.serverTickHz;
  const waitMs = balance.matchmaking.quickMatchWait * 1000;
  let clock = 1000;
  const core = new ServerCore(
    { balance, seed: 9, testHooks: true, devBots: true },
    { ...driver.hooks(), rated: (_room, seat, rating) => rated.push({ account: seat.account, rating }) },
    () => clock,
  );
  const conns = players.map((p) => new FakeConn(p.account, p.tag));
  const links = conns.map((c) => core.connect(c, fail));
  links.forEach((l, i) => {
    const quick: Extract<ClientMessage, { t: 'quick' }> = { t: 'quick', name: `사람${i}` };
    if (players[i]!.declare !== undefined) quick.account = players[i]!.declare;
    l.receive(JSON.stringify(quick));
  });
  const room = core.manager.rooms.get(conns[0]!.last('welcome')!.room)!;
  expect(conns.every((c) => c.last('welcome')!.room === room.code)).toBe(true);
  // 대기 시간이 지날 때까지 사람은 1초마다 ping (클라이언트처럼 — 소식이 없는 자리는 자동 시작 때 대기열에서 빠진다)
  let nextPing = clock;
  while (room.phase === 'lobby') {
    clock += tickMs;
    if (clock >= nextPing) {
      for (const l of links) l.receive(JSON.stringify({ t: 'ping', c: clock }));
      nextPing += 1000;
    }
    core.manager.tick(clock);
    if (clock > 1000 + waitMs + 2000) throw new Error('빠른 매칭이 시작하지 않았다');
  }
  expect(room.kind).toBe('quick');
  expect(room.seats.filter((s) => s.bot)).toHaveLength(2);
  expect(driver.botsOf(room)).toHaveLength(2);
  for (let t = 0; t < 90; t += 1) core.manager.tick((clock += tickMs));
  links[0]!.receive(JSON.stringify({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }));
  for (let t = 0; t < 5; t += 1) core.manager.tick((clock += tickMs));
  expect(room.phase).toBe('result');
  return { core, room, conns, links, rated };
}

describe('빠른 매칭: 로그인 여부가 단서가 되지 않는다', () => {
  it('로그인 여부만 다른 두 판(봇으로 채운 빠른 매칭): 사람 자리 둘이 받은 메시지가 본인 welcome · result의 account 말고는 같고, 계정 키가 없고, 적립은 계정 자리만', () => {
    const guest = quickRun([GUEST, GUEST]);
    const mixed = quickRun([SIGNED, GUEST]);
    for (let i = 0; i < 2; i += 1) {
      const a = guest.conns[i]!.inbox;
      const b = mixed.conns[i]!.inbox;
      // 로비 · 판 시작 명단 · 스냅샷 · 결과까지 받았다
      for (const t of ['lobby', 'match', 'snap', 'result'] as const)
        expect(mixed.conns[i]!.count(t), t).toBeGreaterThan(0);
      expect(b.map(shapeExceptOwnAccount), `사람 ${i}`).toEqual(a.map(shapeExceptOwnAccount));
      for (const m of b) {
        const raw = JSON.stringify(m);
        expect(raw).not.toContain(ACCOUNT);
        if (!OWN_ACCOUNT_KINDS.includes(m.t)) expect(raw).not.toMatch(/"account"\s*:/);
      }
    }
    // 게스트 자리는 글자 하나 다르지 않다 (로그인한 사람의 tag도 오지 않는다)
    expect(mixed.conns[1]!.inbox.map(shape)).toEqual(guest.conns[1]!.inbox.map(shape));
    expect(JSON.stringify(mixed.conns[1]!.inbox)).not.toContain(TAG);
    expect(mixed.conns.map((c) => c.last('welcome')!.account)).toEqual([TAG, null]);
    expect(mixed.conns.map((c) => c.last('result')!.account)).toEqual([TAG, null]);
    // rated 훅: 사람 자리 둘만, 계정은 로그인한 자리만 (봇 자리는 평가하지 않는다)
    expect(mixed.rated.map((r) => r.account)).toEqual([ACCOUNT, null]);
    expect(guest.rated.map((r) => r.account)).toEqual([null, null]);
    expect(mixed.rated.map((r) => r.rating.role)).toEqual(guest.rated.map((r) => r.rating.role));
  });

  it('다시 하기(재대기열)는 그때 rematch가 밝힌 계정으로 새 자리를 묶는다: 같은 tag면 계정, 밝히지 않은 연결은 게스트 그대로', () => {
    const q = quickRun([SIGNED, GUEST]);
    q.links[0]!.receive(JSON.stringify({ t: 'rematch', account: TAG }));
    q.links[1]!.receive(JSON.stringify({ t: 'rematch' }));
    const next = q.core.manager.rooms.get(q.conns[0]!.last('welcome')!.room)!;
    expect(next).not.toBe(q.room);
    expect(next.kind).toBe('quick');
    const seats = q.conns.map((c) => next.seatById(c.last('welcome')!.you)!);
    expect(seats.map((s) => s.account)).toEqual([ACCOUNT, null]);
    expect(q.conns.map((c) => c.last('welcome')!.account)).toEqual([TAG, null]);
  });

  it('결과에서 로그아웃 · 계정 삭제 뒤 다시 하기(rematch에 tag 없음)는 들어올 때 밝힌 옛 계정이 아니라 게스트 자리로 — 쿠키와 다른 tag도 게스트', () => {
    for (const declare of [undefined, OTHER_TAG]) {
      const q = quickRun([SIGNED, GUEST]);
      const msg: Extract<ClientMessage, { t: 'rematch' }> = { t: 'rematch' };
      if (declare !== undefined) msg.account = declare;
      q.links[0]!.receive(JSON.stringify(msg));
      const welcome = q.conns[0]!.last('welcome')!;
      const next = q.core.manager.rooms.get(welcome.room)!;
      expect(next).not.toBe(q.room);
      expect(next.seatById(welcome.you)!.account, String(declare)).toBeNull();
      expect(welcome.account, String(declare)).toBeNull();
    }
  });
});

describe('결과의 계정 = 판 끝에 적립한 계정 (result.account — 결과 단계에 다시 붙어 welcome.account가 바뀌어도 그대로)', () => {
  /** 결과 단계에서 그 자리 토큰으로 다시 붙는다 (새로고침 · 다른 탭 넘겨받기 · 재연결) */
  const rejoin = (s: Started, seat: Seat, p: Player): FakeConn => {
    const c = new FakeConn(p.account, p.tag);
    s.core.connect(c, fail).receive(JSON.stringify(joinMsg(s.room.code, p.declare, seat.token)));
    expect(seat.conn).toBe(c);
    return c;
  };

  it('계정 자리 판 끝 → 결과 단계에 tag 없이 다시 붙음: welcome.account는 null(다음 판용)이지만 다시 받은 result.account는 적립한 TAG', () => {
    const s = startRoom([SIGNED, GUEST, GUEST, GUEST]);
    finish(s);
    expect(s.conns.map((c) => c.last('result')!.account)).toEqual([TAG, null, null, null]);
    expect(s.rated.map((r) => r.account)).toEqual([ACCOUNT, null, null, null]);
    for (const p of [{ account: ACCOUNT, tag: TAG }, GUEST]) {
      const c = rejoin(s, s.seats[0]!, p);
      expect(c.last('welcome')!.account).toBeNull();
      expect(c.last('result')!.account).toBe(TAG);
      expect(c.last('result')!.rating!.matchId).toBe(s.conns[0]!.last('result')!.rating!.matchId);
    }
    // 다시 붙어도 서버 적립은 판 끝 한 번 그대로
    expect(s.rated.map((r) => r.account)).toEqual([ACCOUNT, null, null, null]);
  });

  it('게스트 자리 판 끝 → 결과 단계에 tag를 밝혀 다시 붙음: welcome.account는 TAG지만 result.account는 null (서버는 적립하지 않았다 — 화면은 기기 기록에)', () => {
    const s = startRoom([{ account: ACCOUNT, tag: TAG }, GUEST, GUEST, GUEST]);
    finish(s);
    expect(s.conns[0]!.last('result')!.account).toBeNull();
    const c = rejoin(s, s.seats[0]!, SIGNED);
    expect(c.last('welcome')!.account).toBe(TAG);
    expect(c.last('result')!.account).toBeNull();
    expect(s.rated.map((r) => r.account)).toEqual([null, null, null, null]);
  });

  it('다시 하기로 로비에 돌아가면 결과의 계정은 남지 않고, 다음 판은 그때 자리 계정으로', () => {
    const s = startRoom([SIGNED, GUEST, GUEST, GUEST]);
    finish(s);
    // 결과 단계에 tag 없이 다시 붙은 자리 (다음 판은 게스트 자리)
    const c = rejoin(s, s.seats[0]!, { account: ACCOUNT, tag: TAG });
    s.room.handle(s.seats[0]!, { t: 'rematch' }, 0);
    expect(s.room.phase).toBe('lobby');
    s.seats.forEach((x) => s.room.handle(x, { t: 'ready', ready: true }, 0));
    s.room.handle(s.seats[0]!, { t: 'start' }, 0);
    finish(s);
    expect(c.last('result')!.account).toBeNull();
    expect(s.rated.slice(4).map((r) => r.account)).toEqual([null, null, null, null]);
  });
});
