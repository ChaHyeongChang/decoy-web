// 판 평가를 방이 보낸다 (GAME_DESIGN 12장, 정보 숨김): 판이 끝날 때 받는 사람 자기 평가만, 판 중에는 누구에게도 평가 · 레벨 칸이 없다
import { describe, expect, it } from 'vitest';
import {
  MONSTER_EMBLEMS,
  SURVIVOR_EMBLEMS,
  type ClientMessage,
  type Role,
  type ServerMessage,
} from '@decoy/shared';
import { RoomManager, type Room, type Seat } from '@decoy/shared/sim';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
const ROLES: Role[] = ['monster', 'runner', 'guard', 'scout'];

function joinMsg(room: string | null, bots = false): Extract<ClientMessage, { t: 'join' }> {
  return { t: 'join', room, create: room === null, name: '', token: null, altTokens: [], bots };
}

function startRoom(): { mgr: RoomManager; room: Room; seats: Seat[]; conns: FakeConn[] } {
  const mgr = new RoomManager({ balance, seed: 9, testHooks: true }, {});
  const conns = [new FakeConn(), new FakeConn(), new FakeConn(), new FakeConn()];
  const first = mgr.join(conns[0]!, joinMsg(null));
  if ('error' in first) throw new Error('create failed');
  const seats = [first.seat];
  for (let i = 1; i < 4; i += 1) {
    const r = mgr.join(conns[i]!, joinMsg(first.room.code));
    if ('error' in r) throw new Error('join failed');
    seats.push(r.seat);
  }
  seats.forEach((s, i) => first.room.handle(s, { t: 'role', role: ROLES[i]! }, 0));
  seats.forEach((s) => first.room.handle(s, { t: 'ready', ready: true }, 0));
  first.room.handle(seats[0]!, { t: 'start' }, 0);
  return { mgr, room: first.room, seats, conns };
}

let clock = 0;
const run = (room: Room, n: number): void => {
  for (let t = 0; t < n; t += 1) room.tick((clock += 33));
};

/** 판 결과 전에 받은 메시지 (평가가 새면 안 되는 구간) */
function beforeResult(conn: FakeConn): ServerMessage[] {
  const i = conn.inbox.findIndex((m) => m.t === 'result');
  return i < 0 ? conn.inbox : conn.inbox.slice(0, i);
}

const META_KEYS = /"(rating|emblems|xp|level|matchId|stats)"\s*:/;

describe('판 평가 보내기', () => {
  it('판이 끝나면 사람마다 자기 평가만 (역할 · 팀 항목 넷 · 같은 판 ID), 판 중에는 평가 · 레벨 칸이 하나도 없다', () => {
    const { room, seats, conns } = startRoom();
    run(room, 60);
    room.handle(seats[0]!, { t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }, clock);
    run(room, 5);
    expect(room.phase).toBe('result');
    const ids = new Set<string>();
    seats.forEach((seat, i) => {
      const conn = conns[i]!;
      const res = conn.last('result');
      expect(res, `${ROLES[i]} 결과`).toBeDefined();
      const r = res!.rating!;
      expect(r.role).toBe(ROLES[i]);
      expect(r.emblems.map((e) => e.id)).toEqual(
        ROLES[i] === 'monster' ? [...MONSTER_EMBLEMS] : [...SURVIVOR_EMBLEMS],
      );
      expect(r.outcome).toBe(ROLES[i] === 'monster' ? 'win' : 'lose');
      ids.add(r.matchId);
      // 판 중 메시지(로비 · 판 시작 · 스냅샷)에는 평가 · 레벨 · 판 기록 칸이 없다
      const before = beforeResult(conn);
      expect(before.length).toBeGreaterThan(20);
      for (const m of before) expect(JSON.stringify(m), `${ROLES[i]} ${m.t}`).not.toMatch(META_KEYS);
      void seat;
    });
    expect(ids.size).toBe(1);
    // 괴물이 받은 결과에는 생존자 평가가 없다 (자기 것 하나)
    const monsterRes = JSON.stringify(conns[0]!.last('result'));
    for (const id of SURVIVOR_EMBLEMS) expect(monsterRes).not.toContain(`"${id}"`);
  });

  it('결과 단계에 다시 붙으면 같은 평가(같은 판 ID)를 다시 받는다 — 보상은 클라이언트가 판 ID로 한 번만', () => {
    const { mgr, room, seats, conns } = startRoom();
    run(room, 30);
    room.handle(seats[0]!, { t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }, clock);
    run(room, 5);
    const first = conns[2]!.last('result')!.rating!;
    room.detach(seats[2]!, clock);
    const back = new FakeConn();
    const r = mgr.join(back, { ...joinMsg(room.code), token: seats[2]!.token });
    if (!('seat' in r)) throw new Error('다시 붙기 실패');
    // 연결 처리(ServerCore)가 붙인 뒤 welcome을 보낸다: 결과 단계면 결과(자기 평가 포함)를 다시
    room.welcome(r.seat);
    expect(back.last('result')?.rating).toEqual(first);
  });

  it('다음 판은 다른 판 ID', () => {
    const { room, seats, conns } = startRoom();
    run(room, 30);
    room.handle(seats[0]!, { t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }, clock);
    run(room, 5);
    const a = conns[1]!.last('result')!.rating!.matchId;
    room.handle(seats[0]!, { t: 'rematch' }, clock);
    seats.forEach((s) => room.handle(s, { t: 'ready', ready: true }, clock));
    room.handle(seats[0]!, { t: 'start' }, clock);
    run(room, 30);
    room.handle(seats[0]!, { t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }, clock);
    run(room, 5);
    const b = conns[1]!.last('result')!.rating!.matchId;
    expect(b).not.toBe(a);
  });

  it('봇 판: 사람은 평가를 받고 봇 자리는 평가하지 않는다', () => {
    const mgr = new RoomManager({ balance, seed: 4, testHooks: true, devBots: true }, {});
    const conn = new FakeConn();
    const j = mgr.join(conn, joinMsg(null, true));
    if ('error' in j) throw new Error('create failed');
    j.room.handle(j.seat, { t: 'role', role: 'scout' }, 0);
    j.room.handle(j.seat, { t: 'ready', ready: true }, 0);
    j.room.handle(j.seat, { t: 'start' }, 0);
    run(j.room, 30);
    j.room.handle(j.seat, { t: 'test', cmd: { kind: 'setTime', timeLeft: 0.05 } }, clock);
    run(j.room, 5);
    const res = conn.last('result');
    expect(res?.rating?.role).toBe('scout');
    const ratings = (j.room as unknown as { ratings: Map<string, unknown> }).ratings;
    expect([...ratings.keys()]).toEqual([j.seat.id]);
  });
});
