// 프로토콜 관문 (docs/DEPLOY.md 7장, 플레이테스트 반영 b에서 넣음 — PROTOCOL_VERSION 1).
// 옛 화면과 맞지 않는 배포(맵 · 스냅샷 뜻 변경)에서 옛 화면이 판에 들어가 깨지지 않게, 서버는 join · quick의 proto가 없거나 다르면
// 자리에 묶지 않고 'update-required'로 거절한다. 기기 안 연습 서버(RoomConfig.practice)는 화면과 같은 빌드라 검사하지 않는다
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage } from '@decoy/shared';
import { ServerCore, UPDATE_REQUIRED_MESSAGE, type RoomConfig } from '@decoy/shared/sim';
import { UI_TEXT } from '../../client/src/data/storyText';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();
type Join = Extract<ClientMessage, { t: 'join' }>;
type Quick = Extract<ClientMessage, { t: 'quick' }>;

const join = (extra: Partial<Join> = {}): Join => ({
  t: 'join',
  proto: PROTOCOL_VERSION,
  room: null,
  create: true,
  name: '시험',
  token: null,
  altTokens: [],
  bots: false,
  ...extra,
});
const quick = (): Quick => ({ t: 'quick', proto: PROTOCOL_VERSION, name: '시험' });

/** proto를 빼거나 바꾼 원문 (옛 화면 · 다른 버전 화면이 보내는 것) */
function withProto(msg: Join | Quick, proto: unknown): string {
  const { proto: _drop, ...rest } = msg;
  void _drop;
  return JSON.stringify(proto === undefined ? rest : { ...rest, proto });
}

function newCore(extra: Partial<RoomConfig> = {}): ServerCore {
  const clock = { t: 1000 };
  return new ServerCore({ balance, seed: 5, testHooks: false, ...extra }, {}, () => clock.t);
}

function connect(core: ServerCore): { conn: FakeConn; link: ReturnType<ServerCore['connect']> } {
  const conn = new FakeConn();
  const link = core.connect(conn, (err) => {
    throw err;
  });
  return { conn, link };
}

const BAD: [string, unknown][] = [
  ['없음 (옛 화면)', undefined],
  ['하나 낮음', PROTOCOL_VERSION - 1],
  ['하나 높음', PROTOCOL_VERSION + 1],
  ['글자', String(PROTOCOL_VERSION)],
  ['null', null],
];

describe('프로토콜 관문 (docs/DEPLOY.md 7장)', () => {
  for (const [label, proto] of BAD) {
    for (const [kind, msg] of [
      ['join', join()],
      ['quick', quick()],
    ] as const) {
      it(`${kind}의 proto가 ${label}이면 자리에 묶지 않고 update-required로 거절한다 (방도 만들지 않는다)`, () => {
        const core = newCore();
        const { conn, link } = connect(core);
        link.receive(withProto(msg, proto));
        expect(conn.inbox).toEqual([
          { t: 'error', code: 'update-required', message: UPDATE_REQUIRED_MESSAGE },
        ]);
        expect(link.boundRoom).toBeNull();
        expect(core.manager.rooms.size).toBe(0);
        // 묶이지 않았으니 방 메시지는 버려진다
        link.receive(JSON.stringify({ t: 'ready', ready: true }));
        expect(conn.inbox).toHaveLength(1);
      });
    }
  }

  it('proto가 같으면 join · quick 모두 그대로 들어간다', () => {
    const core = newCore();
    const a = connect(core);
    a.link.receive(JSON.stringify(join()));
    expect(a.conn.count('welcome')).toBe(1);
    expect(a.conn.count('error')).toBe(0);
    expect(a.link.boundRoom).not.toBeNull();
    const b = connect(core);
    b.link.receive(JSON.stringify(quick()));
    expect(b.conn.count('welcome')).toBe(1);
    expect(b.conn.count('error')).toBe(0);
    expect(b.link.boundRoom).not.toBeNull();
  });

  it('거절된 연결도 새로고침한 화면처럼 맞는 proto로 다시 보내면 들어간다', () => {
    const core = newCore();
    const { conn, link } = connect(core);
    link.receive(withProto(join(), undefined));
    link.receive(JSON.stringify(join()));
    expect(conn.inbox.map((m) => m.t)).toEqual(['error', 'welcome', 'lobby']);
  });

  it('옛 화면이 남의 자리 토큰으로 다시 붙으려 해도 그 자리를 넘겨받지 않는다 (지금 연결은 그대로, replaced 없음)', () => {
    const core = newCore();
    const host = connect(core);
    host.link.receive(JSON.stringify(join()));
    const w = host.conn.last('welcome')!;
    const old = connect(core);
    old.link.receive(withProto(join({ room: w.room, create: false, token: w.token }), undefined));
    expect(old.conn.last('error')?.code).toBe('update-required');
    expect(old.link.boundRoom).toBeNull();
    expect(host.conn.count('error')).toBe(0);
    const seat = core.manager.rooms.get(w.room)!.seats.find((s) => s.id === w.you)!;
    expect(seat.conn).toBe(host.conn);
  });

  it('기기 안 연습 서버(RoomConfig.practice)는 proto를 보지 않는다 — 같은 빌드라 어긋날 수 없고 오프라인 연습이 막히지 않게', () => {
    for (const proto of [undefined, PROTOCOL_VERSION + 1]) {
      const core = newCore({ practice: true });
      const { conn, link } = connect(core);
      link.receive(withProto(join({ bots: true }), proto));
      expect(conn.count('error')).toBe(0);
      expect(conn.count('welcome')).toBe(1);
      expect(link.boundRoom).not.toBeNull();
    }
  });

  it('거절 문구는 화면 문구(UI_TEXT.updateRequired · docs/STORY_TEXT.md)와 같은 새로고침 안내다 — 옛 화면은 이 문구를 오류 줄에 그대로 띄운다', () => {
    expect(UPDATE_REQUIRED_MESSAGE).toBe(UI_TEXT.updateRequired);
    expect(UPDATE_REQUIRED_MESSAGE).toContain('새로고침');
  });

  it('PROTOCOL_VERSION은 1 이상의 정수다 (비호환 배포마다 1씩 올린다)', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });
});
