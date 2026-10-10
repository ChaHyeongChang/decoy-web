import { describe, expect, it } from 'vitest';
import type { ClientMessage, Role } from '@decoy/shared';
import { RoomManager, type Room, type Seat } from '@decoy/shared/sim';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();

function joinMsg(
  room: string | null,
  extra: Partial<Extract<ClientMessage, { t: 'join' }>> = {},
): Extract<ClientMessage, { t: 'join' }> {
  return {
    t: 'join',
    room,
    create: room === null,
    name: '',
    token: null,
    altTokens: [],
    bots: false,
    ...extra,
  };
}

function setupRoom(): { mgr: RoomManager; room: Room; seats: Seat[]; conns: FakeConn[] } {
  const mgr = new RoomManager({ balance, seed: 3, testHooks: false }, {});
  const conns = [new FakeConn(), new FakeConn(), new FakeConn(), new FakeConn()];
  const first = mgr.join(conns[0]!, joinMsg(null));
  if ('error' in first) throw new Error('create failed');
  const seats = [first.seat];
  for (let i = 1; i < 4; i += 1) {
    const r = mgr.join(conns[i]!, joinMsg(first.room.code));
    if ('error' in r) throw new Error('join failed');
    seats.push(r.seat);
  }
  return { mgr, room: first.room, seats, conns };
}

describe('방과 로비', () => {
  it('방 코드는 4글자이고, 4명까지 들어오며 5번째는 거부한다', () => {
    const { mgr, room } = setupRoom();
    expect(room.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    const r = mgr.join(new FakeConn(), joinMsg(room.code));
    expect('error' in r && r.error.code).toBe('room-full');
  });

  it('같은 역할은 중복해서 고를 수 없다', () => {
    const { room, seats } = setupRoom();
    room.handle(seats[0]!, { t: 'role', role: 'monster' }, 0);
    room.handle(seats[1]!, { t: 'role', role: 'monster' }, 0);
    expect(seats[0]!.role).toBe('monster');
    expect(seats[1]!.role).toBeNull();
  });

  it('4명이 역할을 고르고 준비해야 방장이 시작할 수 있다', () => {
    const { room, seats } = setupRoom();
    const roles: Role[] = ['monster', 'runner', 'guard', 'scout'];
    seats.forEach((s, i) => room.handle(s, { t: 'role', role: roles[i]! }, 0));
    seats.slice(0, 3).forEach((s) => room.handle(s, { t: 'ready', ready: true }, 0));
    expect(room.startCheck().ok).toBe(false);
    room.handle(seats[3]!, { t: 'ready', ready: true }, 0);
    expect(room.startCheck().ok).toBe(true);
    room.handle(seats[1]!, { t: 'start' }, 0); // 방장이 아니면 무시
    expect(room.phase).toBe('lobby');
    room.handle(seats[0]!, { t: 'start' }, 0);
    expect(room.phase).toBe('playing');
  });

  it('새로고침(같은 탭 토큰)은 같은 자리로, 보조 토큰은 끊긴 자리에만 붙는다', () => {
    const { mgr, room, seats } = setupRoom();
    const s1 = seats[1]!;
    // 같은 탭 토큰: 연결 중이어도 새 연결로 교체
    const c = new FakeConn();
    const r = mgr.join(c, joinMsg(room.code, { token: s1.token }));
    expect('seat' in r && r.seat.id).toBe(s1.id);
    // 다른 탭이 보조 토큰만 들고 오면, 그 자리가 연결 중이므로 새 자리 요청 → 가득 참
    const r2 = mgr.join(new FakeConn(), joinMsg(room.code, { altTokens: [s1.token] }));
    expect('error' in r2).toBe(true);
    // 끊긴 뒤에는 보조 토큰으로 돌아올 수 있다
    room.detach(s1, 0);
    const r3 = mgr.join(new FakeConn(), joinMsg(room.code, { altTokens: [s1.token] }));
    expect('seat' in r3 && r3.seat.id).toBe(s1.id);
  });

  it('스냅샷은 초당 20번(30Hz 틱 중), 받는 사람마다 따로 간다', () => {
    const { room, seats, conns } = setupRoom();
    const roles: Role[] = ['monster', 'runner', 'guard', 'scout'];
    seats.forEach((s, i) => room.handle(s, { t: 'role', role: roles[i]! }, 0));
    seats.forEach((s) => room.handle(s, { t: 'ready', ready: true }, 0));
    room.handle(seats[0]!, { t: 'start' }, 0);
    for (let t = 0; t < 30; t += 1) room.tick(t * 33);
    for (const c of conns) expect(c.count('snap')).toBe(20);
    const snap = conns[1]!.last('snap')!.s;
    expect(snap.you.id).toBe(seats[1]!.id);
  });

  it('방장이 나가고 유예가 지나면 다음 사람이 방장이 된다', () => {
    const { room, seats } = setupRoom();
    room.detach(seats[0]!, 0);
    room.tick(balance.match.reconnectGrace * 1000 + 10);
    expect(room.hostId).toBe(seats[1]!.id);
    expect(room.seats).toHaveLength(3);
  });
});

describe('판 중 접속 끊김 (GAME_DESIGN 9장, DECISIONS D1)', () => {
  function playingRoom(
    roles: Role[] = ['monster', 'runner', 'guard', 'scout'],
  ): ReturnType<typeof setupRoom> {
    const r = setupRoom();
    r.seats.forEach((s, i) => r.room.handle(s, { t: 'role', role: roles[i]! }, 0));
    r.seats.forEach((s) => r.room.handle(s, { t: 'ready', ready: true }, 0));
    r.room.handle(r.seats[0]!, { t: 'start' }, 0);
    return r;
  }
  const graceTicks = Math.round(balance.match.reconnectGrace * balance.network.serverTickHz);
  const run = (room: Room, n: number): void => {
    for (let t = 0; t < n; t += 1) room.tick(t * 33);
  };

  it('괴물이 끊기면 판 전체가 멈추고(시간 · 타이머), 유예 안에 돌아오면 그대로 이어진다', () => {
    const { mgr, room, seats, conns } = playingRoom();
    run(room, 10);
    const game = room.game!;
    const t0 = game.time;
    const left0 = game.timeLeft;
    room.detach(seats[0]!, 0);
    run(room, graceTicks - 30);
    expect(game.time).toBe(t0);
    expect(game.timeLeft).toBe(left0);
    expect(game.paused).toBeGreaterThan(0.5);
    // 생존자 화면에 남은 대기 시간이 간다
    expect(conns[1]!.last('snap')!.s.world.paused).toBeGreaterThan(0.5);
    const back = new FakeConn();
    const r = mgr.join(back, joinMsg(room.code, { token: seats[0]!.token }));
    expect('seat' in r && r.seat.id).toBe(seats[0]!.id);
    run(room, 60);
    expect(game.paused).toBeNull();
    expect(game.time).toBeGreaterThan(t0 + 1.5);
    expect(room.phase).toBe('playing');
  });

  it('괴물이 유예(30초) 안에 돌아오지 않으면 판은 무효', () => {
    const { room, seats, conns } = playingRoom();
    run(room, 10);
    room.detach(seats[0]!, 0);
    run(room, graceTicks + 2);
    expect(room.phase).toBe('result');
    const res = conns[1]!.last('result')!.result;
    expect(res.winner).toBe('void');
    expect(res.ending).toBe('END_VOID');
    expect(res.grade).toBeNull();
  });

  it('생존자가 끊기면 판은 계속되고 제자리에 남으며, 유예가 지나면 사망 처리된다', () => {
    const { room, seats } = playingRoom();
    run(room, 10);
    const game = room.game!;
    const runner = game.survivorById(seats[1]!.id)!;
    room.detach(seats[1]!, 0);
    const t0 = game.time;
    run(room, graceTicks - 5);
    expect(game.paused).toBeNull();
    expect(game.time).toBeGreaterThan(t0 + balance.match.reconnectGrace - 1);
    expect(runner.status).toBe('free');
    run(room, 10);
    expect(runner.status).toBe('dead');
    expect(room.phase).toBe('playing');
  });

  it('모두 함께 끊기면 자리 순서와 상관없이 무효 (괴물을 먼저 본다)', () => {
    // 괴물이 세 번째 자리, 생존자 하나는 이미 사망
    const { room, seats } = playingRoom(['runner', 'guard', 'monster', 'scout']);
    run(room, 10);
    room.game!.survivorById(seats[3]!.id)!.status = 'dead';
    for (const s of seats) room.detach(s, 0);
    run(room, graceTicks + 2);
    expect(room.phase).toBe('result');
    expect((room.lastResult as { result: { winner: string } }).result.winner).toBe('void');
  });

  it('괴물이 없는 동안 생존자 유예가 끝나면 사망 처리만 하고, 판정은 괴물이 돌아와 판이 흐를 때 한다', () => {
    const { mgr, room, seats } = playingRoom();
    run(room, 10);
    const game = room.game!;
    game.survivorById(seats[3]!.id)!.status = 'dead';
    room.detach(seats[1]!, 0);
    run(room, Math.round(graceTicks * 0.6));
    room.detach(seats[0]!, 0);
    run(room, Math.round(graceTicks * 0.5));
    // 러너는 유예가 끝나 사망(사망 2명)이지만 괴물이 없으므로 아직 끝나지 않는다
    expect(game.survivorById(seats[1]!.id)!.status).toBe('dead');
    expect(game.end).toBeNull();
    mgr.join(new FakeConn(), joinMsg(room.code, { token: seats[0]!.token }));
    run(room, 3);
    expect(game.end).toMatchObject({ winner: 'monster', reason: 'deaths' });
  });

  it('괴물의 대기 시간은 판마다 합산한다 (끊고 붙기를 되풀이해 판을 무기한 멈추지 못한다)', () => {
    const { mgr, room, seats } = playingRoom();
    run(room, 10);
    for (let k = 0; k < 3; k += 1) {
      room.detach(seats[0]!, 0);
      run(room, Math.round(graceTicks * 0.4));
      if (room.phase !== 'playing') break;
      mgr.join(new FakeConn(), joinMsg(room.code, { token: seats[0]!.token }));
      run(room, 30);
    }
    expect(room.phase).toBe('result');
    expect((room.lastResult as { result: { winner: string } }).result.winner).toBe('void');
  });

  it('끊기면 큐에 남은 입력을 버리고, 다시 붙으면 끊긴 동안 쌓인 일회성 알림은 버린다 (거점 메모는 남김)', () => {
    const { mgr, room, seats } = playingRoom();
    run(room, 10);
    const game = room.game!;
    const runner = game.survivorById(seats[1]!.id)!;
    game.queueInput(runner.id, [{ seq: 999, mx: 1, my: 0, aim: Number.NaN, held: 0, pressed: 8 }]);
    room.detach(seats[1]!, 0);
    expect(runner.queue).toHaveLength(0);
    game.emitTo(runner, { k: 'hit', you: true, x: 1, y: 1 });
    game.emitTo(runner, { k: 'text', id: 'ALERT_CAPTURE_DONE', point: 'A' });
    game.emitTo(runner, { k: 'text', id: 'NOTE_FIRST', code: '12' });
    mgr.join(new FakeConn(), joinMsg(room.code, { token: seats[1]!.token }));
    expect(runner.outbox).toEqual([{ k: 'text', id: 'NOTE_FIRST', code: '12' }]);
  });

  it('생존자가 유예 안에 돌아오면 그대로 이어서 한다', () => {
    const { mgr, room, seats } = playingRoom();
    run(room, 10);
    const game = room.game!;
    const runner = game.survivorById(seats[1]!.id)!;
    room.detach(seats[1]!, 0);
    run(room, graceTicks - 30);
    mgr.join(new FakeConn(), joinMsg(room.code, { token: seats[1]!.token }));
    run(room, 60);
    expect(runner.status).toBe('free');
    expect(runner.connected).toBe(true);
  });
});

describe('방 견고성 (M1 검토 반영)', () => {
  function playing(testHooks = false): ReturnType<typeof setupRoom> {
    const r = setupRoom();
    const roles: Role[] = ['monster', 'runner', 'guard', 'scout'];
    r.seats.forEach((s, i) => r.room.handle(s, { t: 'role', role: roles[i]! }, 0));
    r.seats.forEach((s) => r.room.handle(s, { t: 'ready', ready: true }, 0));
    (r.room.config as { testHooks: boolean }).testHooks = testHooks;
    r.room.handle(r.seats[0]!, { t: 'start' }, 0);
    return r;
  }

  it('잘못된 input 프레임(null, 숫자 아님)은 무시하고 서버가 죽지 않는다', () => {
    const { room, seats } = playing();
    const bad = { t: 'input', frames: [null, 3, { seq: 'x' }] } as unknown as ClientMessage;
    expect(() => room.handle(seats[1]!, bad, 0)).not.toThrow();
    expect(() => room.tick(33)).not.toThrow();
  });

  it('cmd 없는 test 메시지도 무시한다', () => {
    const { room, seats } = playing(true);
    expect(() => room.handle(seats[1]!, { t: 'test' } as unknown as ClientMessage, 0)).not.toThrow();
  });

  it('자리 토큰은 시드와 무관한 무작위 값이다', () => {
    const a = setupRoom();
    const b = setupRoom();
    expect(a.seats[0]!.token).not.toBe(b.seats[0]!.token);
    expect(a.seats[0]!.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it('다른 탭이 자리를 넘겨받으면 이전 연결에 알리고 닫는다', () => {
    const { mgr, room, seats, conns } = setupRoom();
    mgr.join(new FakeConn(), joinMsg(room.code, { token: seats[2]!.token }));
    expect(conns[2]!.last('error')?.code).toBe('replaced');
    expect(conns[2]!.closed).toBe(true);
  });

  it('주 토큰이 있는 탭은 보조 토큰으로 남의 자리를 가져가지 않는다', () => {
    const { mgr, room, seats } = setupRoom();
    room.detach(seats[3]!, 0);
    const r = mgr.join(
      new FakeConn(),
      joinMsg(room.code, { token: 'gone-token', altTokens: [seats[3]!.token] }),
    );
    expect('seat' in r && r.seat.id).not.toBe(seats[3]!.id);
  });

  it('판 중 생존자가 끊기거나 다시 붙어도 괴물에게는 lobby 메시지가 가지 않는다 (도착 자체가 신호)', () => {
    const { mgr, room, seats, conns } = playing();
    const before = conns[0]!.count('lobby');
    const survivorBefore = conns[1]!.count('lobby');
    room.detach(seats[3]!, 10);
    const back = new FakeConn();
    const r = mgr.join(back, joinMsg(room.code, { token: seats[3]!.token }));
    expect('seat' in r && r.seat.id).toBe(seats[3]!.id);
    if ('seat' in r) room.welcome(r.seat);
    expect(conns[0]!.count('lobby')).toBe(before);
    // 생존자 팀은 접속 변화를 본다
    expect(conns[1]!.count('lobby')).toBeGreaterThan(survivorBefore);
    // 다시 붙은 본인은 로비 상태를 받는다
    expect(back.count('lobby')).toBeGreaterThan(0);
  });

  it('판 중 로비 메시지는 괴물에게 다른 사람의 역할 · 접속 상태를 보내지 않는다', () => {
    const { room, seats, conns } = playing();
    room.detach(seats[3]!, 10);
    const toMonster = conns[0]!.last('lobby')!.lobby;
    for (const p of toMonster.players) {
      if (p.id === seats[0]!.id) continue;
      expect(p.role).toBeNull();
      expect(p.connected).toBe(true);
    }
    const toSurvivor = conns[1]!.last('lobby')!.lobby;
    expect(toSurvivor.players.find((p) => p.id === seats[3]!.id)?.connected).toBe(false);
  });
});
