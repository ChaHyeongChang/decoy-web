// 의상을 방이 보낸다 (GAME_DESIGN 12.5, 정보 숨김): 판 시작 명단에만 — 생존자 명단에 생존자끼리 의상 · 괴물 의상, 괴물 명단은 자기
// 의상뿐. 로비 · 결과 메시지에는 아무에게도 의상 칸이 없다. 받은 값은 거르고(모르는 값 = 기본), 판 중에는 바꾸지 않는다
import { describe, expect, it } from 'vitest';
import type { ClientMessage, CostumeChoice, Role, ServerMessage } from '@decoy/shared';
import { RoomManager, type Room, type Seat } from '@decoy/shared/sim';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
const ROLES: Role[] = ['monster', 'runner', 'guard', 'scout'];
/** 자리마다 고른 의상 (괴물 자리는 생존자 의상도 골라 두었다 — 괴물 역할이면 쓰지 않는다) */
const CHOICES: CostumeChoice[] = [
  { survivor: 'pack', monster: 'chains' },
  { survivor: 'scarf', monster: 'feathers' },
  { survivor: 'cape', monster: 'hood' },
  { survivor: 'basic', monster: 'basic' },
];
const SURVIVOR_IDS = /"(scarf|pack|cape)"/;
const COSTUME_KEY = /"costume"\s*:/;

function joinMsg(room: string | null, costume?: unknown): Extract<ClientMessage, { t: 'join' }> {
  return {
    t: 'join',
    room,
    create: room === null,
    name: '',
    token: null,
    altTokens: [],
    bots: false,
    ...(costume === undefined ? {} : { costume: costume as CostumeChoice }),
  };
}

function lobbyRoom(choices: CostumeChoice[] = CHOICES): {
  mgr: RoomManager;
  room: Room;
  seats: Seat[];
  conns: FakeConn[];
} {
  const mgr = new RoomManager({ balance, seed: 9, testHooks: true }, {});
  const conns = [new FakeConn(), new FakeConn(), new FakeConn(), new FakeConn()];
  const first = mgr.join(conns[0]!, joinMsg(null, choices[0]));
  if ('error' in first) throw new Error('create failed');
  const seats = [first.seat];
  for (let i = 1; i < 4; i += 1) {
    const r = mgr.join(conns[i]!, joinMsg(first.room.code, choices[i]));
    if ('error' in r) throw new Error('join failed');
    seats.push(r.seat);
  }
  seats.forEach((s, i) => first.room.handle(s, { t: 'role', role: ROLES[i]! }, 0));
  seats.forEach((s) => first.room.handle(s, { t: 'ready', ready: true }, 0));
  return { mgr, room: first.room, seats, conns };
}

function startRoom(): ReturnType<typeof lobbyRoom> {
  const r = lobbyRoom();
  r.room.handle(r.seats[0]!, { t: 'start' }, 0);
  return r;
}

let clock = 0;
const run = (room: Room, n: number): void => {
  for (let t = 0; t < n; t += 1) room.tick((clock += 33));
};

function matchOf(conn: FakeConn): Extract<ServerMessage, { t: 'match' }> {
  const m = conn.last('match');
  if (!m) throw new Error('match 없음');
  return m;
}

describe('판 시작 명단의 의상', () => {
  it('생존자는 동료 셋의 생존자 의상과 괴물 의상을 받는다 (기본이면 칸 없음)', () => {
    const { conns } = startRoom();
    for (const i of [1, 2, 3]) {
      const roster = matchOf(conns[i]!).info.roster;
      const by = new Map(roster.map((e) => [e.role, e]));
      expect(by.get('monster')?.costume, `${ROLES[i]}이 받은 괴물 의상`).toBe('chains');
      expect(by.get('runner')?.costume).toBe('scarf');
      expect(by.get('guard')?.costume).toBe('cape');
      expect(by.get('scout') && 'costume' in by.get('scout')!).toBe(false);
    }
  });

  it('괴물은 자기 괴물 의상만 받는다: 명단에 생존자가 없고, 받은 모든 메시지에 생존자 의상 id가 없다', () => {
    const { room, conns } = startRoom();
    run(room, 90);
    const monster = conns[0]!;
    const roster = matchOf(monster).info.roster;
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ role: 'monster', costume: 'chains' });
    // 괴물 자리도 생존자 의상(pack)을 골라 두었지만 괴물 역할이라 어디에도 오지 않는다
    for (const m of monster.inbox) expect(JSON.stringify(m), m.t).not.toMatch(SURVIVOR_IDS);
    // 판 시작 명단 밖(로비 · 스냅샷)에는 의상 칸 자체가 없다
    for (const m of monster.inbox.filter((x) => x.t !== 'match'))
      expect(JSON.stringify(m), m.t).not.toMatch(COSTUME_KEY);
  });

  it('로비 · 결과 메시지에는 누구에게도 의상 칸이 없다 (판 전 로비에는 괴물이 될 사람도 있다)', () => {
    const { room, seats, conns } = startRoom();
    run(room, 30);
    room.handle(seats[0]!, { t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }, clock);
    run(room, 5);
    expect(room.phase).toBe('result');
    for (const c of conns)
      for (const m of c.inbox.filter((x) => x.t === 'lobby' || x.t === 'result'))
        expect(JSON.stringify(m), m.t).not.toMatch(COSTUME_KEY);
  });

  it('스냅샷에는 의상 칸이 없다 (그리는 쪽은 판 시작 명단으로 정한다)', () => {
    const { room, conns } = startRoom();
    run(room, 60);
    for (const c of conns)
      for (const m of c.inbox.filter((x) => x.t === 'snap'))
        expect(JSON.stringify(m)).not.toMatch(COSTUME_KEY);
  });

  it('받은 값을 믿지 않는다: 모르는 의상 · 다른 팀 id · 이상한 모양은 기본', () => {
    const { room, seats, conns } = (() => {
      const r = lobbyRoom([
        { survivor: 'basic', monster: 'basic' },
        { survivor: 'chains', monster: 'cape' } as unknown as CostumeChoice,
        'cape' as unknown as CostumeChoice,
        { survivor: 'crown', monster: 'hood' } as unknown as CostumeChoice,
      ]);
      r.room.handle(r.seats[0]!, { t: 'start' }, 0);
      return r;
    })();
    void room;
    void seats;
    const roster = matchOf(conns[1]!).info.roster;
    for (const e of roster) expect(e, e.role).not.toHaveProperty('costume');
  });

  it('봇 자리는 기본 의상', () => {
    const mgr = new RoomManager({ balance, seed: 3, testHooks: true, devBots: true }, {});
    const conn = new FakeConn();
    const r = mgr.join(conn, { ...joinMsg(null, { survivor: 'scarf', monster: 'chains' }), bots: true });
    if ('error' in r) throw new Error('create failed');
    r.room.handle(r.seat, { t: 'role', role: 'runner' }, 0);
    r.room.handle(r.seat, { t: 'ready', ready: true }, 0);
    r.room.handle(r.seat, { t: 'start' }, 0);
    const roster = matchOf(conn).info.roster;
    expect(roster).toHaveLength(4);
    for (const e of roster.filter((x) => x.id !== r.seat.id)) expect(e).not.toHaveProperty('costume');
    expect(roster.find((x) => x.id === r.seat.id)?.costume).toBe('scarf');
  });

  it('판 중에 다시 들어와도 의상은 판 시작 그대로, 로비에서 다시 들어오면 새 의상', () => {
    const { mgr, room, seats, conns } = startRoom();
    run(room, 10);
    const runner = seats[1]!;
    const again = new FakeConn();
    const r = mgr.join(again, {
      ...joinMsg(room.code, { survivor: 'cape', monster: 'basic' }),
      token: runner.token,
    });
    if ('error' in r) throw new Error('rejoin failed');
    r.room.welcome(r.seat);
    expect(matchOf(again).info.roster.find((e) => e.role === 'runner')?.costume).toBe('scarf');
    void conns;
    // 로비 방에서 다시 들어오면 바뀐다
    const lobby = lobbyRoom();
    const tab = new FakeConn();
    const r2 = lobby.mgr.join(tab, {
      ...joinMsg(lobby.room.code, { survivor: 'pack', monster: 'basic' }),
      token: lobby.seats[1]!.token,
    });
    if ('error' in r2) throw new Error('rejoin failed');
    expect(r2.seat.costume).toEqual({ survivor: 'pack', monster: 'basic' });
  });

  it('로비에서 옷장으로 바꾼 의상(costume 메시지)이 판 시작 명단에 실린다 · 아무에게도 알리지 않는다 · 판 중에는 무시', () => {
    const { room, seats, conns } = lobbyRoom();
    const before = conns.map((c) => c.inbox.length);
    room.handle(seats[1]!, { t: 'costume', costume: { survivor: 'pack', monster: 'basic' } }, 0);
    // 로비에 의상 칸이 없으니 보낼 것도 없다
    expect(conns.map((c) => c.inbox.length)).toEqual(before);
    room.handle(seats[0]!, { t: 'start' }, 0);
    expect(matchOf(conns[2]!).info.roster.find((e) => e.role === 'runner')?.costume).toBe('pack');
    run(room, 5);
    room.handle(seats[1]!, { t: 'costume', costume: { survivor: 'cape', monster: 'basic' } }, clock);
    expect(seats[1]!.costume.survivor).toBe('pack');
    // 이상한 값은 기본
    const other = lobbyRoom();
    other.room.handle(other.seats[2]!, { t: 'costume', costume: 'crown' as unknown as CostumeChoice }, 0);
    expect(other.seats[2]!.costume).toEqual({ survivor: 'basic', monster: 'basic' });
  });

  it('빠른 매칭: 남의 의상은 판 시작 명단에 싣지 않는다 (봇 자리는 늘 기본이라 의상이 사람이라는 단서가 된다) — 내 의상만', () => {
    const mgr = new RoomManager({ balance, seed: 6, testHooks: true, devBots: true }, {});
    const human = new FakeConn();
    const q = mgr.quick(human, '나', 0, { survivor: 'scarf', monster: 'chains' });
    const other = new FakeConn();
    const q2 = mgr.quick(other, '너', 0, { survivor: 'cape', monster: 'hood' });
    q.room.handle(q.seat, { t: 'role', role: 'runner' }, 0);
    // 기다림이 끝나면 빈 자리를 봇으로 채워 시작한다 (기다리는 동안 핑으로 살아 있음을 알린다)
    for (let now = 0; now < 120_000 && q.room.phase === 'lobby'; now += 250) {
      for (const s of [q.seat, q2.seat]) q.room.handle(s, { t: 'ping', c: now }, now);
      mgr.tick(now);
    }
    expect(q.room.phase).toBe('playing');
    // 두 사람이 같은 방이고 남은 자리는 봇이다 (봇 자리가 있어야 이 시험이 뜻이 있다)
    expect(q2.room).toBe(q.room);
    expect(q.room.seats.filter((s) => s.bot).length).toBeGreaterThan(0);
    for (const conn of [human, other]) {
      const info = matchOf(conn).info;
      for (const e of info.roster)
        if (e.id !== info.you) expect(e, `${e.role} 남의 자리`).not.toHaveProperty('costume');
      const mine = info.roster.find((e) => e.id === info.you)!;
      expect(mine.costume, '내 의상').toBeDefined();
    }
  });

  it('빠른 매칭: 대기열에 넣을 때 받은 의상이 판 시작 명단에 실린다', () => {
    const mgr = new RoomManager({ balance, seed: 4, testHooks: true }, {});
    const conn = new FakeConn();
    const q = mgr.quick(conn, '나', 0, { survivor: 'cape', monster: 'hood' });
    expect(q.seat.costume).toEqual({ survivor: 'cape', monster: 'hood' });
  });
});
