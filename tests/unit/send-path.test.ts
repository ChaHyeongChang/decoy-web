// 실제 송신 경로 (M12 검토 반영): 방이 만든 스냅샷이 연결별 송신 큐(createSender)와 소켓 bufferedAmount를 거쳐
// 무엇이 나가는지 본다. 밀린 연결(256KB 초과)에는 스냅샷을 건너뛰지만, 거점 메모(비밀번호)가 든 스냅샷은
// 그 메모가 다시 오지 않으므로 보낸다. 스냅샷이 아닌 메시지는 늘 보내고, 8MB를 넘으면 끊는다
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_POINTS,
  type ClientMessage,
  type GameEvent,
  type Role,
  type ServerMessage,
  type Snapshot,
} from '@decoy/shared';
import { RoomManager, type Conn, type Room, type Seat } from '@decoy/shared/sim';
import {
  SKIP_SNAPSHOTS_ABOVE,
  TERMINATE_ABOVE,
  createSender,
  type SendSocket,
} from '../../server/src/sendPolicy';
import { FakeConn } from '../helpers/fakeConn';
import { loadTestBalance } from '../helpers/fixtures';

const balance = loadTestBalance();

/** ws WebSocket 흉내: 보낸 글자를 모으고, 쌓인 바이트(bufferedAmount)는 시험이 정한다 */
class FakeSocket implements SendSocket {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: ServerMessage[] = [];
  closed = false;
  terminated = false;
  send(text: string): void {
    this.sent.push(JSON.parse(text) as ServerMessage);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }
  snaps(): Snapshot[] {
    return this.sent.flatMap((m) => (m.t === 'snap' ? [m.s] : []));
  }
}

function joinMsg(room: string | null): Extract<ClientMessage, { t: 'join' }> {
  return { t: 'join', room, create: room === null, name: '', token: null, altTokens: [], bots: false };
}

const hasNote = (events: GameEvent[]): boolean =>
  events.some((e) => e.k === 'text' && (e.id === 'NOTE_FIRST' || e.id === 'NOTE_SECOND'));

/**
 * 판 중인 방. 생존자(runner) 자리는 실제 송신 경로(지연 없음)와 가짜 소켓에 붙이고,
 * 방이 그 자리에 만든 메시지는 built에 모은다(무엇을 만들었고 무엇이 나갔는지 비교)
 */
function playingRoom(): { room: Room; runner: Seat; socket: FakeSocket; built: ServerMessage[] } {
  const mgr = new RoomManager({ balance, seed: 5, testHooks: false }, {});
  const socket = new FakeSocket();
  const sender = createSender(socket, 0, 0, Math.random);
  const built: ServerMessage[] = [];
  const conn: Conn = {
    id: 1,
    send: (msg) => {
      built.push(msg);
      sender.send(msg);
    },
    close: sender.close,
  };
  const first = mgr.join(new FakeConn(), joinMsg(null));
  if ('error' in first) throw new Error('create failed');
  const seats = [first.seat];
  for (const c of [conn, new FakeConn(), new FakeConn()]) {
    const r = mgr.join(c, joinMsg(first.room.code));
    if ('error' in r) throw new Error('join failed');
    seats.push(r.seat);
  }
  const room = first.room;
  const roles: Role[] = ['monster', 'runner', 'guard', 'scout'];
  seats.forEach((s, i) => room.handle(s, { t: 'role', role: roles[i]! }, 0));
  seats.forEach((s) => room.handle(s, { t: 'ready', ready: true }, 0));
  room.handle(seats[0]!, { t: 'start' }, 0);
  return { room, runner: seats[1]!, socket, built };
}

let clock = 0;
function run(room: Room, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) room.tick((clock += 1000 / balance.network.serverTickHz));
}

const builtSnaps = (built: ServerMessage[]): Snapshot[] =>
  built.flatMap((m) => (m.t === 'snap' ? [m.s] : []));

describe('송신 경로: 방 → 연결별 송신 큐 → 소켓', () => {
  it('밀리지 않으면 방이 만든 메시지를 모두 순서대로 보낸다', () => {
    const { room, socket, built } = playingRoom();
    run(room, 30);
    expect(builtSnaps(built).length).toBeGreaterThanOrEqual(15);
    expect(socket.sent).toEqual(built);
  });

  it('밀린 동안 거점 점령이 끝나면: 메모(비밀번호)가 든 스냅샷은 보내고 나머지 스냅샷은 건너뛴다', () => {
    const { room, runner, socket, built } = playingRoom();
    run(room, 10);
    const game = room.game!;
    socket.sent.length = 0;
    built.length = 0;
    socket.bufferedAmount = SKIP_SNAPSHOTS_ABOVE + 1;
    // 첫 거점을 한 틱 남기고 그 안에 생존자를 세운다 → 다음 틱에 점령 완료(capture.ts가 NOTE_FIRST를 보낸다)
    const point = game.points[0]!;
    point.progress = balance.capturePoint.captureTime - game.dt / 2;
    const me = game.survivorById(runner.id)!;
    me.move.x = CAPTURE_POINTS[point.id].x;
    me.move.y = CAPTURE_POINTS[point.id].y;
    run(room, 30);
    expect(point.done).toBe(true);

    // 방은 그동안 스냅샷을 여럿 만들었고, 메모는 그중 하나에만 들었다
    const made = builtSnaps(built);
    expect(made.length).toBeGreaterThanOrEqual(15);
    expect(made.filter((s) => hasNote(s.events))).toHaveLength(1);
    // 소켓으로 나간 스냅샷은 메모가 든 그것 하나뿐이고, 비밀번호 앞자리가 그대로 들어 있다
    const out = socket.snaps();
    expect(out).toHaveLength(1);
    const note = out[0]!.events.find((e) => e.k === 'text' && e.id === 'NOTE_FIRST');
    expect(note && note.k === 'text' && note.code).toBe(game.codes[0]);
    expect(out[0]!.events.some((e) => e.k === 'text' && e.id === 'ALERT_CAPTURE_DONE')).toBe(true);

    // 밀림이 풀리면 스냅샷이 다시 나간다
    socket.bufferedAmount = 0;
    run(room, 6);
    expect(socket.snaps().length).toBeGreaterThan(1);
  });

  it('밀린 동안 두 번째 메모(NOTE_SECOND)도 나간다', () => {
    const { room, runner, socket } = playingRoom();
    run(room, 10);
    const game = room.game!;
    socket.sent.length = 0;
    socket.bufferedAmount = SKIP_SNAPSHOTS_ABOVE + 1;
    const me = game.survivorById(runner.id)!;
    game.emitTo(me, { k: 'text', id: 'ALERT_EXITS_ON' });
    run(room, 6);
    expect(socket.snaps()).toHaveLength(0);
    game.emitTo(me, { k: 'text', id: 'NOTE_SECOND', code: '34' });
    run(room, 6);
    const out = socket.snaps();
    expect(out).toHaveLength(1);
    expect(out[0]!.events).toContainEqual({ k: 'text', id: 'NOTE_SECOND', code: '34' });
  });

  it('밀려도 스냅샷이 아닌 메시지는 넣은 순서대로 보내고, 8MB를 넘으면 끊는다', () => {
    const { room, socket } = playingRoom();
    run(room, 3);
    const snap = socket.snaps()[0]!;
    const plain: Snapshot = { ...snap, events: [] };
    const socket2 = new FakeSocket();
    const sender = createSender(socket2, 0, 0, Math.random);
    socket2.bufferedAmount = SKIP_SNAPSHOTS_ABOVE + 1;
    sender.send({ t: 'snap', s: plain });
    sender.send({ t: 'pong', c: 1, s: 2 });
    sender.send({ t: 'snap', s: { ...plain, events: [{ k: 'text', id: 'NOTE_FIRST', code: '12' }] } });
    sender.send({ t: 'error', code: 'replaced', message: 'x' });
    expect(socket2.sent.map((m) => m.t)).toEqual(['pong', 'snap', 'error']);
    expect(socket2.terminated).toBe(false);
    socket2.bufferedAmount = TERMINATE_ABOVE + 1;
    sender.send({ t: 'snap', s: { ...plain, events: [{ k: 'text', id: 'NOTE_SECOND', code: '34' }] } });
    expect(socket2.terminated).toBe(true);
    expect(socket2.sent).toHaveLength(3);
  });

  it('닫기는 앞서 넣은 메시지를 보낸 뒤에 하고, 닫힌 소켓에는 보내지 않는다', () => {
    const socket = new FakeSocket();
    const sender = createSender(socket, 0, 0, Math.random);
    sender.send({ t: 'error', code: 'replaced', message: 'x' });
    sender.close();
    sender.send({ t: 'pong', c: 1, s: 2 });
    expect(socket.sent.map((m) => m.t)).toEqual(['error']);
    expect(socket.closed).toBe(true);
  });
});
