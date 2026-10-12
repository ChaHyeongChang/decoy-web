// 출시 전 검토: 연결 하나로 방을 끝없이 쌓지 못한다 (나가기로 사람이 남지 않은 로비 · 결과 방은 바로 지운다)
import { describe, expect, it } from 'vitest';
import type { ClientMessage } from '@decoy/shared';
import { ServerCore, type RoomConfig, type RoomHooks } from '@decoy/shared/sim';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
const raw = (msg: ClientMessage): string => JSON.stringify(msg);
const create = (bots = false): string =>
  raw({ t: 'join', room: null, create: true, name: '시험', token: null, altTokens: [], bots });

function newCore(
  extra: Partial<RoomConfig> = {},
  hooks: RoomHooks = {},
): { core: ServerCore; clock: { t: number } } {
  const clock = { t: 1000 };
  const core = new ServerCore({ balance, seed: 11, testHooks: false, ...extra }, hooks, () => clock.t);
  return { core, clock };
}

function connect(core: ServerCore): { conn: FakeConn; link: ReturnType<ServerCore['connect']> } {
  const conn = new FakeConn();
  const link = core.connect(conn, (err) => {
    throw err;
  });
  return { conn, link };
}

describe('나가기로 빈 방 정리 (연결 하나가 방을 쌓지 못하게)', () => {
  it('연결 하나로 방 만들기 · 나가기를 100번 되풀이해도 방이 쌓이지 않는다', () => {
    const { core } = newCore();
    const { conn, link } = connect(core);
    for (let i = 0; i < 100; i += 1) {
      link.receive(create());
      link.receive(raw({ t: 'leave' }));
    }
    expect(conn.count('welcome')).toBe(100);
    expect(core.manager.rooms.size).toBeLessThanOrEqual(1);
  });

  it('연결 하나로 빠른 매칭 · 나가기를 100번 되풀이해도 방이 쌓이지 않는다', () => {
    const { core } = newCore();
    const { conn, link } = connect(core);
    for (let i = 0; i < 100; i += 1) {
      link.receive(raw({ t: 'quick', name: '시험' }));
      link.receive(raw({ t: 'leave' }));
    }
    expect(conn.count('welcome')).toBe(100);
    expect(core.manager.rooms.size).toBeLessThanOrEqual(1);
  });

  it('두 사람 방에서 한 명이 나가면 방은 남고(방장 넘김), 마지막 사람이 나가면 바로 지운다', () => {
    const { core } = newCore();
    const a = connect(core);
    const b = connect(core);
    a.link.receive(create());
    const code = a.conn.last('welcome')?.room ?? '';
    b.link.receive(
      raw({ t: 'join', room: code, create: false, name: '손님', token: null, altTokens: [], bots: false }),
    );
    const room = core.manager.rooms.get(code);
    expect(room?.seats).toHaveLength(2);
    a.link.receive(raw({ t: 'leave' }));
    expect(core.manager.rooms.get(code)).toBe(room);
    expect(room?.hostId).toBe(room?.seats[0]?.id);
    b.link.receive(raw({ t: 'leave' }));
    expect(core.manager.rooms.has(code)).toBe(false);
  });

  it('끊겨서 유예 중인 사람 자리가 남은 방은 다른 사람이 나가도 지우지 않는다 (돌아올 수 있게)', () => {
    const { core } = newCore();
    const a = connect(core);
    const b = connect(core);
    a.link.receive(create());
    const code = a.conn.last('welcome')?.room ?? '';
    b.link.receive(
      raw({ t: 'join', room: code, create: false, name: '손님', token: null, altTokens: [], bots: false }),
    );
    const token = b.conn.last('welcome')?.token ?? null;
    b.link.close();
    a.link.receive(raw({ t: 'leave' }));
    expect(core.manager.rooms.has(code)).toBe(true);
    const back = connect(core);
    back.link.receive(
      raw({ t: 'join', room: code, create: false, name: '손님', token, altTokens: [], bots: false }),
    );
    expect(back.conn.last('welcome')?.room).toBe(code);
  });
});
