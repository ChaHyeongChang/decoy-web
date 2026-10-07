import { describe, expect, it } from 'vitest';
import type { ClientMessage, Role } from '@decoy/shared';
import { RoomManager, type Room, type Seat } from '../../server/src/room';
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
