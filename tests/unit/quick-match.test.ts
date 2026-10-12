// M13c 빠른 매칭 (GAME_DESIGN 11장): 가짜 연결 + 수동 시계로 대기열 · 자동 시작 · 역할 배정 · 판 뒤 해산 ·
// 이름 가림 · 판 중 나가기 · 봇 방 상한 · 서버 로그
import { describe, expect, it } from 'vitest';
import type { ClientMessage, Role, ServerMessage } from '@decoy/shared';
import {
  BotDriver,
  QUICK_STALE_MS,
  ROOM_IDLE_TIMEOUT_MS,
  ServerCore,
  WAITING_HUMANS_ONLY,
  devBotBrain,
  type CoreLink,
  type Room,
  type RoomHooks,
} from '@decoy/shared/sim';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
const WAIT_MS = balance.matchmaking.quickMatchWait * 1000;
const raw = (msg: ClientMessage): string => JSON.stringify(msg);

interface Client {
  conn: FakeConn;
  link: CoreLink;
  name: string;
}

function setup(opts: { canFillBots?: (room: Room) => boolean } = {}): {
  core: ServerCore;
  clock: { t: number };
  logs: string[];
  driver: BotDriver;
  client(name: string): Client;
  run(ms: number, pingers?: Client[]): void;
} {
  const clock = { t: 1000 };
  const logs: string[] = [];
  const driver = new BotDriver((info) => devBotBrain(info.role), balance);
  const hooks: RoomHooks = {
    ...driver.hooks(),
    log: (m) => logs.push(m),
    ...(opts.canFillBots ? { canFillBots: opts.canFillBots } : {}),
  };
  const core = new ServerCore({ balance, seed: 21, testHooks: true }, hooks, () => clock.t);
  const client = (name: string): Client => {
    const conn = new FakeConn();
    const link = core.connect(conn, (err) => {
      throw err;
    });
    return { conn, link, name };
  };
  /** 시계를 ms만큼 틱 단위로 흘린다. pingers는 1초마다 ping을 보낸다 (클라이언트처럼) */
  const run = (ms: number, pingers: Client[] = []): void => {
    const end = clock.t + ms;
    let nextPing = clock.t;
    while (clock.t < end) {
      clock.t = Math.min(end, clock.t + core.tickMs);
      if (clock.t >= nextPing) {
        for (const p of pingers) p.link.receive(raw({ t: 'ping', c: clock.t }));
        nextPing += 1000;
      }
      core.advance(clock.t);
    }
  };
  return { core, clock, logs, driver, client, run };
}

function quick(c: Client): void {
  c.link.receive(raw({ t: 'quick', name: c.name }));
}

function roomOf(core: ServerCore, c: Client): Room {
  const welcome = c.conn.last('welcome');
  const room = welcome ? core.manager.rooms.get(welcome.room) : undefined;
  if (!room) throw new Error(`${c.name}: 방 없음`);
  return room;
}

/** 소켓을 닫고 새 연결로 같은 자리 토큰을 들고 돌아온다 (새로고침 · 재연결) */
function rejoin(env: ReturnType<typeof setup>, c: Client, code: string): Client {
  const token = c.conn.last('welcome')?.token ?? null;
  c.link.close();
  const fresh = env.client(c.name);
  fresh.link.receive(
    raw({ t: 'join', room: code, create: false, name: c.name, token, altTokens: [], bots: false }),
  );
  return fresh;
}

/** 서버(server/src/index.ts)와 같은 방식으로 센 '봇을 채워 판 중인 빠른 매칭 방' 수 */
function botRoomsPlaying(core: ServerCore, except: Room | null = null): number {
  let n = 0;
  for (const r of core.manager.rooms.values())
    if (r !== except && r.kind === 'quick' && r.phase === 'playing' && r.seats.some((s) => s.bot)) n += 1;
  return n;
}

const GRACE_MS = balance.match.reconnectGrace * 1000;

describe('빠른 매칭: 대기열 · 자동 시작', () => {
  it('둘이 들어오면 같은 방, 대기 시간이 지나면 봇 2명과 시작 (역할을 안 고른 사람은 남은 역할 중 하나)', () => {
    const { core, client, run } = setup();
    const a = client('가나');
    const b = client('다라');
    quick(a);
    quick(b);
    const room = roomOf(core, a);
    expect(roomOf(core, b)).toBe(room);
    expect(room.kind).toBe('quick');
    const lobby = a.conn.last('lobby')?.lobby;
    expect(lobby?.kind).toBe('quick');
    expect(lobby?.autoStartAt).toBe(1000 + WAIT_MS);
    a.link.receive(raw({ t: 'role', role: 'monster' }));
    run(WAIT_MS - 200, [a, b]);
    expect(room.phase).toBe('lobby');
    run(400, [a, b]);
    expect(room.phase).toBe('playing');
    const roles = room.seats.map((s) => s.role).sort();
    expect(roles).toEqual(['guard', 'monster', 'runner', 'scout']);
    expect(room.seats.filter((s) => s.bot)).toHaveLength(2);
    expect(a.conn.last('match')?.info.role).toBe('monster');
    expect(['runner', 'guard', 'scout']).toContain(b.conn.last('match')?.info.role);
  });

  it('4명이 모이면 대기 시간 전에도 바로 시작하고, 고른 역할은 그대로 · 중복은 거절', () => {
    const { core, client, run } = setup();
    const cs = ['하나', '둘', '셋', '넷'].map((n) => client(n));
    cs.forEach(quick);
    const room = roomOf(core, cs[0]!);
    cs[0]!.link.receive(raw({ t: 'role', role: 'scout' }));
    cs[1]!.link.receive(raw({ t: 'role', role: 'scout' }));
    expect(room.seats.find((s) => s.name === '둘')?.role).toBeNull();
    run(100, cs);
    expect(room.phase).toBe('playing');
    expect(room.seats.find((s) => s.name === '하나')?.role).toBe('scout');
    expect(new Set(room.seats.map((s) => s.role)).size).toBe(4);
    expect(room.seats.some((s) => s.bot)).toBe(false);
    // 다섯 번째는 새 방
    const e = client('다섯');
    quick(e);
    expect(roomOf(core, e)).not.toBe(room);
  });

  it('준비 · 방장 시작은 없다 (보내도 무시)', () => {
    const { core, client } = setup();
    const a = client('가');
    quick(a);
    a.link.receive(raw({ t: 'role', role: 'runner' }));
    a.link.receive(raw({ t: 'ready', ready: true }));
    a.link.receive(raw({ t: 'start' }));
    const room = roomOf(core, a);
    expect(room.phase).toBe('lobby');
    expect(room.seats[0]?.ready).toBe(false);
    expect(a.conn.last('lobby')?.lobby.canStart).toBe(false);
  });

  it('자동 시작 순간 최근 3초 안에 ping이 없던 자리는 빼고(대기열에서 빠짐 알림) 봇으로 채운다', () => {
    const { core, client, run } = setup();
    const a = client('살아');
    const b = client('멈춤');
    quick(a);
    quick(b);
    const room = roomOf(core, a);
    // b는 처음 몇 초만 ping을 보내고 멈춘다
    run(2000, [a, b]);
    run(WAIT_MS, [a]);
    expect(room.phase).toBe('playing');
    expect(room.seats.some((s) => s.name === '멈춤')).toBe(false);
    expect(room.seats.filter((s) => s.bot)).toHaveLength(3);
    expect(b.conn.last('error')?.code).toBe('queue-dropped');
    // 빠진 연결은 다시 대기열에 들어갈 수 있다
    quick(b);
    expect(roomOf(core, b)).not.toBe(room);
    expect(QUICK_STALE_MS).toBe(3000);
  });

  // 출시 전 검토: 대기열에서 빠진 연결이 지운 방 객체(다른 사람 닉네임 포함)를 연결이 닫힐 때까지 붙잡던 문제
  it('대기열에서 빠진 연결은 다음 메시지(첫 화면 ping)에서 그 방을 놓고, 방이 지워진 뒤에도 붙잡지 않는다', () => {
    const { core, client, run } = setup();
    const a = client('살아');
    const b = client('멈춤');
    quick(a);
    quick(b);
    const room = roomOf(core, a);
    run(2000, [a, b]);
    run(WAIT_MS, [a]);
    expect(b.conn.last('error')?.code).toBe('queue-dropped');
    expect(room.phase).toBe('playing');
    expect(a.link.boundRoom).toBe(room.code);
    b.link.receive(raw({ t: 'ping', c: 1 }));
    expect(b.conn.last('pong')).toBeDefined();
    expect(b.link.boundRoom).toBeNull();
    // 남은 사람도 나가 방이 지워진 뒤: 어느 연결도 그 방을 가리키지 않는다
    a.link.receive(raw({ t: 'leave' }));
    run(ROOM_IDLE_TIMEOUT_MS + 1000, [b]);
    expect(core.manager.rooms.has(room.code)).toBe(false);
    expect(a.link.boundRoom).toBeNull();
    expect(b.link.boundRoom).toBeNull();
  });

  it('방 코드 방은 매칭에 섞이지 않고, 빠른 매칭 방에는 코드로 새로 들어갈 수 없다', () => {
    const { core, client } = setup();
    const host = client('방장');
    host.link.receive(
      raw({ t: 'join', room: null, create: true, name: '방장', token: null, altTokens: [], bots: false }),
    );
    const codeRoom = roomOf(core, host);
    const q = client('매칭');
    quick(q);
    expect(roomOf(core, q)).not.toBe(codeRoom);
    const quickRoom = roomOf(core, q);
    const intruder = client('끼어들기');
    intruder.link.receive(
      raw({
        t: 'join',
        room: quickRoom.code,
        create: false,
        name: '끼어',
        token: null,
        altTokens: [],
        bots: false,
      }),
    );
    expect(intruder.conn.last('error')?.code).toBe('not-allowed');
    expect(quickRoom.seats).toHaveLength(1);
  });

  // 출시 전 검토: 대기 방에 들어온 모르는 사람이 내용 없는 메시지를 되풀이해 다른 사람 대기 화면에 lobby를 쏟아붓던 문제
  // (받을 때마다 화면을 다시 그려 역할 카드 · 취소를 누를 수 없었다). 같은 내용은 어느 단계든 다시 보내지 않는다
  it('같은 이름 · 남이 가진 역할 · start를 100번씩 보내도 다른 사람에게 lobby가 다시 가지 않고, 실제로 바뀌면 간다', () => {
    const { core, client } = setup();
    // 흔드는 쪽이 먼저 들어와 방장이다 (빠른 매칭에는 방장 시작이 없어 start는 늘 거절된다)
    const b = client('흔들기');
    const a = client('기다림');
    quick(b);
    quick(a);
    const room = roomOf(core, a);
    expect(roomOf(core, b)).toBe(room);
    expect(room.hostId).toBe(b.conn.last('welcome')?.you);
    a.link.receive(raw({ t: 'role', role: 'monster' }));
    const aBefore = a.conn.count('lobby');
    const bBefore = b.conn.count('lobby');
    for (let i = 0; i < 100; i += 1) {
      b.link.receive(raw({ t: 'name', name: b.name }));
      b.link.receive(raw({ t: 'role', role: 'monster' }));
      b.link.receive(raw({ t: 'start' }));
    }
    // 빠른 매칭에서 남의 이름은 익명이라, b가 이름을 바꿔도 a가 받을 내용은 같다
    b.link.receive(raw({ t: 'name', name: '새이름' }));
    expect(a.conn.count('lobby')).toBe(aBefore);
    expect(room.phase).toBe('lobby');
    // 요청한 사람에게는 늘 답한다 (거절된 역할 · 시작 → 지금 상태로 화면을 되돌린다)
    expect(b.conn.count('lobby') - bBefore).toBeGreaterThanOrEqual(200);
    expect(room.seats.find((s) => s.name === '새이름')?.role).toBeNull();
    // 실제로 바뀌면 간다
    b.link.receive(raw({ t: 'role', role: 'guard' }));
    expect(a.conn.count('lobby')).toBe(aBefore + 1);
    const aId = a.conn.last('welcome')?.you;
    const other = a.conn.last('lobby')?.lobby.players.find((p) => p.id !== aId);
    expect(other?.role).toBe('guard');
    expect(other?.name).toMatch(/^플레이어 [1-4]$/);
  });

  it('대기 중 나가기(숨김 · 취소)는 자리를 지운다', () => {
    const { core, client } = setup();
    const a = client('가');
    const b = client('나');
    quick(a);
    quick(b);
    const room = roomOf(core, a);
    b.link.receive(raw({ t: 'leave' }));
    expect(room.seats).toHaveLength(1);
    expect(a.conn.last('lobby')?.lobby.players).toHaveLength(1);
  });
});

// 출시 전 검토: 3초 안에 소식은 있었지만 자동 시작 직전에 소켓이 닫힌 자리는 판에 남되, 판에서도 '끊김'으로 시작한다
// (9장 유예). 옛 코드는 '연결됨'으로 시작해 괴물이면 판이 멈추지도 무효가 되지도 않았다
describe('빠른 매칭: 자동 시작 직전에 소켓이 닫힌 자리 (9장 유예)', () => {
  function closedBeforeStart(closer: 'monster' | 'survivor'): ReturnType<typeof setup> & {
    mon: Client;
    sur: Client;
    room: Room;
  } {
    const env = setup();
    const mon = env.client('괴물');
    const sur = env.client('생존');
    quick(mon);
    quick(sur);
    mon.link.receive(raw({ t: 'role', role: 'monster' }));
    sur.link.receive(raw({ t: 'role', role: 'runner' }));
    const room = roomOf(env.core, mon);
    env.run(WAIT_MS - 1500, [mon, sur]);
    const gone = closer === 'monster' ? mon : sur;
    const stays = closer === 'monster' ? sur : mon;
    gone.link.close();
    env.run(2000, [stays]);
    expect(room.phase).toBe('playing');
    // 빠지지 않고 판에 남았다 (봇으로 바뀌지 않음)
    const seat = room.seats.find((s) => s.name === gone.name);
    expect(seat?.bot).toBe(false);
    expect(room.game?.players.get(seat?.id ?? '')?.connected).toBe(false);
    return { ...env, mon, sur, room };
  }

  it('괴물 자리면 판이 멈추고, 유예(30초)가 지나도 돌아오지 않으면 무효', () => {
    const { sur, room, run } = closedBeforeStart('monster');
    expect(room.game?.paused).not.toBeNull();
    run(GRACE_MS + 1000, [sur]);
    expect(room.phase).toBe('result');
    expect(sur.conn.last('result')?.result.winner).toBe('void');
  });

  it('생존자 자리면 판은 흐르고, 유예가 지나면 사망 처리', () => {
    const { mon, room, run } = closedBeforeStart('survivor');
    expect(room.game?.paused).toBeNull();
    const id = room.seats.find((s) => s.name === '생존')?.id ?? '';
    run(GRACE_MS + 1000, [mon]);
    expect(room.game?.survivorById(id)?.status).toBe('dead');
  });

  it('유예 안에 같은 토큰으로 돌아오면 이어서 한다 (판 정지가 풀린다)', () => {
    const env = closedBeforeStart('monster');
    const { sur, room, run } = env;
    run(5000, [sur]);
    expect(room.game?.paused).not.toBeNull();
    const back = rejoin(env, env.mon, room.code);
    run(100, [back, sur]);
    expect(room.phase).toBe('playing');
    expect(room.game?.monster.connected).toBe(true);
    expect(room.game?.paused).toBeNull();
    expect(back.conn.last('match')?.info.role).toBe('monster');
  });

  it('4명이 차 바로 시작하는 경로에서도 직전에 닫힌 자리는 끊김으로 시작한다', () => {
    const { core, client, run } = setup();
    const cs = ['하나', '둘', '셋'].map((n) => client(n));
    cs.forEach(quick);
    cs[0]!.link.receive(raw({ t: 'role', role: 'monster' }));
    const room = roomOf(core, cs[0]!);
    run(1000, cs);
    cs[1]!.link.close();
    const fourth = client('넷');
    quick(fourth);
    expect(roomOf(core, fourth)).toBe(room);
    run(100, [cs[0]!, cs[2]!, fourth]);
    expect(room.phase).toBe('playing');
    expect(room.seats.some((s) => s.bot)).toBe(false);
    const seat = room.seats.find((s) => s.name === '둘');
    expect(room.game?.players.get(seat?.id ?? '')?.connected).toBe(false);
    for (const name of ['하나', '셋', '넷']) {
      const s = room.seats.find((q) => q.name === name);
      expect(room.game?.players.get(s?.id ?? '')?.connected).toBe(true);
    }
  });
});

describe('빠른 매칭: 판 중 · 판 뒤', () => {
  function startedPair(): ReturnType<typeof setup> & { a: Client; b: Client; room: Room } {
    const env = setup();
    const a = env.client('가나');
    const b = env.client('다라');
    quick(a);
    quick(b);
    a.link.receive(raw({ t: 'role', role: 'monster' }));
    b.link.receive(raw({ t: 'role', role: 'runner' }));
    env.run(WAIT_MS + 100, [a, b]);
    const room = roomOf(env.core, a);
    expect(room.phase).toBe('playing');
    return { ...env, a, b, room };
  }

  it('판 중 생존자가 나가면 유예 없이 바로 사망 처리, 괴물이 나가면 바로 무효', () => {
    const { a, b, room, run } = startedPair();
    const runner = room.seats.find((s) => s.name === '다라');
    b.link.receive(raw({ t: 'leave' }));
    expect(room.game?.survivorById(runner?.id ?? '')?.status).toBe('dead');
    run(100, [a]);
    expect(room.phase).toBe('playing');
    a.link.receive(raw({ t: 'leave' }));
    run(100);
    expect(room.phase).toBe('result');
    expect(room.lastResult?.result.winner).toBe('void');
  });

  it('한 명만 다시 하기를 누르면 그 사람만 새 대기열로 가고, 다른 사람은 결과 화면에 그대로', () => {
    const { core, a, b, room, run } = startedPair();
    a.link.receive(raw({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }));
    run(200, [a, b]);
    expect(room.phase).toBe('result');
    const bInbox = b.conn.inbox.length;
    a.link.receive(raw({ t: 'rematch' }));
    const next = roomOf(core, a);
    expect(next).not.toBe(room);
    expect(next.kind).toBe('quick');
    expect(next.phase).toBe('lobby');
    // 역할 선택은 초기화
    expect(next.seats[0]?.role).toBeNull();
    expect(room.phase).toBe('result');
    expect(room.seats.some((s) => s.name === '가나')).toBe(false);
    // b에게는 새 판 · 새 방이 가지 않고, 로비 갱신(나간 사람)이 와도 결과 단계 그대로다 (화면은 결과에 머무름)
    const later = b.conn.inbox.slice(bInbox);
    expect(later.filter((m) => m.t === 'match' || m.t === 'welcome')).toEqual([]);
    for (const m of later) if (m.t === 'lobby') expect(m.lobby.phase).toBe('result');
  });

  it('로비 · match · 결과 메시지 원문 어디에도 다른 사람 닉네임이 없다 (본인 화면에만 내 닉네임)', () => {
    const { a, b, room, run } = startedPair();
    a.link.receive(raw({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }));
    run(200, [a, b]);
    expect(room.phase).toBe('result');
    for (const [me, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const text = JSON.stringify(me.conn.inbox.filter((m) => m.t !== 'snap'));
      expect(text).not.toContain(other.name);
      expect(text).toContain(me.name);
      // 결과에는 봇 표시가 있고, 다른 사람은 "플레이어 n"
      const result = me.conn.last('result')?.result;
      expect(result?.players.filter((p) => p.bot)).toHaveLength(2);
      for (const p of result?.players ?? [])
        if (p.name !== me.name) expect(p.name).toMatch(/^플레이어 [1-4]$/);
    }
  });

  // 출시 전 검토: 봇 표시는 결과 화면에서만 (GAME_DESIGN 11장, DECISIONS M13c). 괴물 쪽만 보던 시험을 생존자 명단 · 로비까지
  it('결과 전에는 생존자의 match 명단 · 로비 원문에 다른 자리의 봇 여부가 없다 (괴물 쪽도)', () => {
    const { a, b, room } = startedPair();
    const botIds = room.seats.filter((s) => s.bot).map((s) => s.id);
    expect(botIds).toHaveLength(2);
    // b = 생존자: 4자리 명단을 받지만 자기 말고는 모두 봇 아님으로 보인다 (봇 자리 둘이 명단에 있다)
    const info = b.conn.last('match')?.info;
    expect(info?.role).toBe('runner');
    expect(info?.roster).toHaveLength(4);
    expect(info?.roster.filter((r) => botIds.includes(r.id))).toHaveLength(2);
    for (const r of info?.roster ?? []) if (r.id !== info?.you) expect(r.bot).toBe(false);
    for (const me of [a, b]) {
      const beforeResult = me.conn.inbox.filter((m) => m.t !== 'snap' && m.t !== 'result');
      expect(beforeResult.filter((m) => m.t === 'lobby').length).toBeGreaterThan(0);
      expect(JSON.stringify(beforeResult)).not.toContain('"bot":true');
    }
  });

  // 출시 전 검토: 결과 단계에서 자리가 지워진 뒤(다시 하기 · 나가기 · 유예 만료) 다시 보내는 결과에 그 사람 실제 닉네임이 갔다
  it.each(['none', 'rematch', 'leave', 'drop'] as const)(
    '결과 단계에서 다른 사람 자리가 지워져도(%s) 다시 접속해 받은 원문에 그 사람 닉네임이 없다',
    (how) => {
      const env = startedPair();
      const { a, b, room, run } = env;
      a.link.receive(raw({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }));
      run(200, [a, b]);
      expect(room.phase).toBe('result');
      const aId = room.seats.find((s) => s.name === a.name)?.id ?? '';
      const bId = room.seats.find((s) => s.name === b.name)?.id ?? '';
      const seenAlias = b.conn.last('result')?.result.players.find((p) => p.id === aId)?.name;
      expect(seenAlias).toMatch(/^플레이어 [1-4]$/);
      if (how === 'rematch') a.link.receive(raw({ t: 'rematch' }));
      else if (how === 'leave') a.link.receive(raw({ t: 'leave' }));
      else if (how === 'drop') {
        a.link.close();
        run(GRACE_MS + 1000, [b]);
      }
      expect(room.seats.some((s) => s.id === aId)).toBe(how === 'none');
      const fresh = rejoin(env, b, room.code);
      const text = JSON.stringify(fresh.conn.inbox);
      expect(text).not.toContain(a.name);
      const result = fresh.conn.last('result')?.result;
      expect(result?.players).toHaveLength(4);
      for (const p of result?.players ?? []) if (p.id !== bId) expect(p.name).toMatch(/^플레이어 [1-4]$/);
      // 처음 받은 결과와 같은 익명 이름, 봇 표시도 그대로
      expect(result?.players.find((p) => p.id === aId)).toMatchObject({ name: seenAlias, bot: false });
      expect(result?.players.filter((p) => p.bot)).toHaveLength(2);
      expect(result?.players.find((p) => p.id === bId)?.name).toBe(b.name);
    },
  );

  // 출시 전 검토: 생존자 승리가 확정된 '최후의 30초'에 괴물이 나가거나 끊겨도 무효가 아니라 생존자 승리 (9장)
  function graceStarted(): ReturnType<typeof startedPair> {
    const env = startedPair();
    for (const s of env.room.seats.filter((q) => q.bot))
      env.a.link.receive(raw({ t: 'test', cmd: { kind: 'setSurvivor', target: s.id, status: 'escaped' } }));
    env.run(200, [env.a, env.b]);
    expect(env.room.phase).toBe('playing');
    expect(env.room.game?.grace).not.toBeNull();
    return env;
  }

  it('최후의 30초 중 괴물이 나가면 무효가 아니라 생존자 승리 (탈출 2명 → 탈출 성공)', () => {
    const { a, b, room, run } = graceStarted();
    a.link.receive(raw({ t: 'leave' }));
    run(100, [b]);
    expect(room.phase).toBe('result');
    expect(room.lastResult?.result.winner).toBe('survivors');
    expect(b.conn.last('result')?.result).toMatchObject({
      winner: 'survivors',
      grade: 'success',
      escaped: 2,
    });
  });

  it('최후의 30초 중 괴물이 끊기면 판은 멈추고(유예 동안), 돌아오지 않으면 생존자 승리', () => {
    const { a, b, room, run } = graceStarted();
    const grace = room.game?.grace ?? 0;
    a.link.close();
    run(1000, [b]);
    expect(room.phase).toBe('playing');
    expect(room.game?.paused).not.toBeNull();
    expect(room.game?.grace).toBeCloseTo(grace, 1);
    run(GRACE_MS, [b]);
    expect(room.phase).toBe('result');
    expect(b.conn.last('result')?.result).toMatchObject({ winner: 'survivors', grade: 'success' });
  });

  it('빠른 매칭 시작 직후 괴물이 받은 모든 메시지 원문에 다른 자리의 역할 문자열과 봇 여부가 없다', () => {
    const env = setup();
    const a = env.client('괴물');
    const b = env.client('생존');
    quick(a);
    quick(b);
    a.link.receive(raw({ t: 'role', role: 'monster' }));
    env.run(WAIT_MS - 50, [a, b]);
    const before = a.conn.inbox.length;
    env.run(1500, [a, b]);
    const after = a.conn.inbox.slice(before);
    expect(after.some((m) => m.t === 'match')).toBe(true);
    const text = JSON.stringify(after);
    for (const role of ['runner', 'guard', 'scout'] as Role[]) expect(text).not.toContain(`"${role}"`);
    expect(text).not.toContain('"bot":true');
    expect(text).not.toContain('봇');
    expect(text).not.toContain('생존');
    // 판 중 로비: 다른 자리는 익명 · 역할 없음 · 봇 아님으로 보인다
    const lobby = [...after]
      .reverse()
      .find((m): m is Extract<ServerMessage, { t: 'lobby' }> => m.t === 'lobby');
    for (const p of lobby?.lobby.players ?? []) {
      if (p.name === '괴물') continue;
      expect(p).toMatchObject({ role: null, bot: false });
      expect(p.name).toMatch(/^플레이어 [1-4]$/);
    }
  });

  it('서버 로그에 닉네임이 없다 (사람 · 봇 수와 방 종류만)', () => {
    const { logs, a, b, run } = startedPair();
    a.link.receive(raw({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }));
    run(200, [a, b]);
    expect(logs.length).toBeGreaterThanOrEqual(2);
    for (const line of logs) {
      expect(line).not.toContain('가나');
      expect(line).not.toContain('다라');
    }
    expect(logs[0]).toMatch(/판 시작 \(quick, 사람 2 · 봇 2\)/);
  });
});

// 출시 전 검토: 사람이 모두 나간 빠른 매칭 판은 봇끼리 60초를 돌며 봇 방 상한 한 칸을 차지하지 않고 바로 무효로 끝난다.
// 끊김(30초 유예) 중인 사람이 있으면 그대로 기다린다. 사람이 남지 않은 결과 방은 바로 지운다
describe('빠른 매칭: 사람이 모두 나간 판 · 방', () => {
  function soloPlaying(cap = Infinity): ReturnType<typeof setup> & { a: Client; room: Room } {
    const env = setup({ canFillBots: (room) => botRoomsPlaying(env.core, room) < cap });
    const a = env.client('혼자');
    quick(a);
    a.link.receive(raw({ t: 'role', role: 'runner' }));
    env.run(WAIT_MS + 100, [a]);
    const room = roomOf(env.core, a);
    expect(room.phase).toBe('playing');
    expect(room.seats.filter((s) => s.bot)).toHaveLength(3);
    return { ...env, a, room };
  }

  it('혼자 봇 셋과 하다가 나가면 곧 무효로 끝나고, 봇 방으로 세지 않는다', () => {
    const { core, a, room, run } = soloPlaying();
    expect(botRoomsPlaying(core)).toBe(1);
    a.link.receive(raw({ t: 'leave' }));
    run(100);
    expect(room.phase).toBe('result');
    expect(room.lastResult?.result.winner).toBe('void');
    expect(botRoomsPlaying(core)).toBe(0);
  });

  it('혼자 하던 사람이 끊긴 채 유예(30초)가 지나면 그때 무효 (유예 동안은 그대로)', () => {
    const { a, room, run } = soloPlaying();
    a.link.close();
    run(GRACE_MS - 1000);
    expect(room.phase).toBe('playing');
    run(2000);
    expect(room.phase).toBe('result');
    expect(room.lastResult?.result.winner).toBe('void');
  });

  it('끊김 유예 중인 사람이 남아 있으면 다른 사람이 나가도 판은 계속되고, 그 사람은 돌아올 수 있다', () => {
    const env = setup();
    const a = env.client('나감');
    const b = env.client('끊김');
    quick(a);
    quick(b);
    a.link.receive(raw({ t: 'role', role: 'runner' }));
    b.link.receive(raw({ t: 'role', role: 'guard' }));
    env.run(WAIT_MS + 100, [a, b]);
    const room = roomOf(env.core, a);
    expect(room.phase).toBe('playing');
    b.link.close();
    a.link.receive(raw({ t: 'leave' }));
    env.run(5000);
    expect(room.phase).toBe('playing');
    const back = rejoin(env, b, room.code);
    env.run(100, [back]);
    expect(room.phase).toBe('playing');
    const seat = room.seats.find((s) => s.name === '끊김');
    expect(room.game?.players.get(seat?.id ?? '')?.connected).toBe(true);
  });

  it('봇 방 상한 1: 앞사람이 나간 방이 상한을 붙잡지 않아 다음 사람이 바로 봇과 시작한다', () => {
    const env = soloPlaying(1);
    const { a, client, run, core } = env;
    a.link.receive(raw({ t: 'leave' }));
    const b = client('다음');
    quick(b);
    const next = roomOf(core, b);
    expect(next).not.toBe(env.room);
    run(WAIT_MS + 200, [b]);
    expect(next.phase).toBe('playing');
    expect(next.seats.filter((s) => s.bot)).toHaveLength(3);
    expect(b.conn.last('lobby')?.lobby.waitingFor).not.toBe(WAITING_HUMANS_ONLY);
  });

  it.each(['rematch', 'leave'] as const)(
    '결과 단계에서 마지막 사람이 %s를 보내면 옛 방은 바로 지워지고 봇 연결도 닫힌다',
    (how) => {
      const { a, core, driver, room, run } = soloPlaying();
      a.link.receive(raw({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }));
      run(200, [a]);
      expect(room.phase).toBe('result');
      const bots = driver.botsOf(room);
      expect(bots).toHaveLength(3);
      a.link.receive(raw({ t: how }));
      expect(core.manager.rooms.has(room.code)).toBe(false);
      expect(bots.every((bot) => bot.closed)).toBe(true);
      // 다시 하기는 새 대기열 방 하나만 남는다
      expect(core.manager.rooms.size).toBe(how === 'rematch' ? 1 : 0);
    },
  );

  it('결과 단계에서 다른 사람이 남아 있으면 한 사람이 나가도 방은 남고, 마지막 사람까지 나가면 지운다', () => {
    const env = setup();
    const a = env.client('가');
    const b = env.client('나');
    quick(a);
    quick(b);
    env.run(WAIT_MS + 100, [a, b]);
    const room = roomOf(env.core, a);
    a.link.receive(raw({ t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }));
    env.run(200, [a, b]);
    expect(room.phase).toBe('result');
    a.link.receive(raw({ t: 'leave' }));
    expect(env.core.manager.rooms.get(room.code)).toBe(room);
    b.link.receive(raw({ t: 'leave' }));
    expect(env.core.manager.rooms.has(room.code)).toBe(false);
  });
});

describe('빠른 매칭: 동시 봇 방 상한', () => {
  it('상한이면 봇을 채우지 않고 "사람만 기다리는 중", 4명이 모이면 시작', () => {
    const { core, client, run } = setup({ canFillBots: () => false });
    const a = client('가');
    quick(a);
    const room = roomOf(core, a);
    run(WAIT_MS + 200, [a]);
    expect(room.phase).toBe('lobby');
    const lobby = a.conn.last('lobby')?.lobby;
    expect(lobby?.waitingFor).toBe(WAITING_HUMANS_ONLY);
    expect(lobby?.autoStartAt).toBeNull();
    const others = ['나', '다', '라'].map((n) => client(n));
    others.forEach(quick);
    run(100, [a, ...others]);
    expect(room.phase).toBe('playing');
    expect(room.seats.some((s) => s.bot)).toBe(false);
  });

  it('상한이 풀리면 다음 틱에 빈자리를 봇으로 채워 시작한다 ("사람만 기다리는 중" → 봇과 판)', () => {
    let allow = false;
    const { core, client, run } = setup({ canFillBots: () => allow });
    const a = client('가');
    quick(a);
    const room = roomOf(core, a);
    run(WAIT_MS + 200, [a]);
    expect(room.phase).toBe('lobby');
    expect(a.conn.last('lobby')?.lobby).toMatchObject({ waitingFor: WAITING_HUMANS_ONLY, autoStartAt: null });
    expect(a.conn.count('match')).toBe(0);
    allow = true;
    run(100, [a]);
    expect(room.phase).toBe('playing');
    expect(room.seats.filter((s) => s.bot)).toHaveLength(3);
    expect(a.conn.count('match')).toBe(1);
    expect(a.conn.last('lobby')?.lobby.waitingFor).not.toBe(WAITING_HUMANS_ONLY);
  });
});

describe('봇 이름 (?bots=1 방 코드 방도)', () => {
  it('봇 이름에 역할이 들어가지 않는다', () => {
    const { core, client, run } = setup();
    const host = client('방장');
    host.link.receive(
      raw({ t: 'join', room: null, create: true, name: '방장', token: null, altTokens: [], bots: true }),
    );
    host.link.receive(raw({ t: 'role', role: 'monster' }));
    host.link.receive(raw({ t: 'ready', ready: true }));
    host.link.receive(raw({ t: 'start' }));
    run(100, [host]);
    const room = roomOf(core, host);
    const bots = room.seats.filter((s) => s.bot);
    expect(bots).toHaveLength(3);
    for (const s of bots) {
      expect(s.name).toMatch(/^봇 [1-4]$/);
      for (const r of ['runner', 'guard', 'scout', 'monster']) expect(s.name).not.toContain(r);
    }
  });
});
