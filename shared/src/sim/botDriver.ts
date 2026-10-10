// 같은 프로세스 봇 (M13b): 기기 안 연습(client/src/localServer.ts)과 서버 빠른 매칭 봇 방(M13c)이 쓴다.
// 봇 자리에 가짜 연결(BotConn)을 붙여 그 자리에 오는 메시지 — 정보 차단된 자기 스냅샷 — 만 받고,
// 틱마다(RoomHooks.beforeStep) 봇마다 입력 하나를 넣는다. 스냅샷은 20Hz라 사이 틱에는 아직 처리 안 된 입력으로
// 내 위치를 예측해 정한다(predictSelf, WebSocket 봇과 같은 방식). ?bots=1 개발용 WebSocket 봇은 그대로다
import {
  emptyInput,
  type Balance,
  type InputFrame,
  type MatchInfo,
  type ServerMessage,
  type Snapshot,
} from '../index';
import type { BotBrain } from './botBrains';
import { predictSelf } from './predict';
import type { Conn, Room, RoomHooks, Seat } from './room';

/** 판이 시작되면 봇 자리의 역할로 두뇌를 고른다 */
export type BrainFactory = (info: MatchInfo, seat: Seat, room: Room) => BotBrain;

/** 아직 처리 안 된 입력을 이만큼까지 기억한다 (예측용, WebSocket 봇과 같다) */
const MAX_PENDING = 60;

/** 봇 연결 id는 음수 (사람 연결 id와 겹치지 않게) */
let nextBotConnId = -1;

export class BotSeat implements Conn {
  readonly id = nextBotConnId--;
  info: MatchInfo | null = null;
  brain: BotBrain | null = null;
  lastSnap: Snapshot | null = null;
  pending: InputFrame[] = [];
  seq = 0;
  closed = false;
  /** 넣은 입력 수 (시험: 틱당 하나) */
  inputs = 0;

  constructor(
    readonly seat: Seat,
    private readonly onMatch: (bot: BotSeat, info: MatchInfo) => void,
  ) {}

  send(msg: ServerMessage): void {
    if (this.closed) return;
    if (msg.t === 'match') {
      this.info = msg.info;
      this.lastSnap = null;
      this.pending = [];
      this.onMatch(this, msg.info);
    } else if (msg.t === 'snap') this.lastSnap = msg.s;
  }

  close(): void {
    this.closed = true;
  }
}

export class BotDriver {
  private readonly bots = new WeakMap<Room, Map<string, BotSeat>>();

  constructor(
    private readonly brainFor: BrainFactory,
    private readonly balance: Balance,
  ) {}

  /** RoomHooks에 그대로 넣는다 */
  hooks(): Required<Pick<RoomHooks, 'spawnBot' | 'beforeStep'>> {
    return {
      spawnBot: (room, seat) => this.attach(room, seat),
      beforeStep: (room) => this.beforeStep(room),
    };
  }

  /** 봇 자리에 같은 프로세스 연결을 붙인다 (판 시작 직전, 'match' 전) */
  attach(room: Room, seat: Seat): void {
    let map = this.bots.get(room);
    if (!map) {
      map = new Map();
      this.bots.set(room, map);
    }
    const bot = new BotSeat(seat, (b, info) => {
      b.brain = this.brainFor(info, seat, room);
    });
    map.set(seat.id, bot);
    room.attach(seat, bot);
  }

  /** 이 방의 붙어 있는 봇 (시험 · 측정용) */
  botsOf(room: Room): BotSeat[] {
    return [...(this.bots.get(room)?.values() ?? [])];
  }

  /** 틱마다: 판에 있는 봇 자리마다 입력 하나. 괴물 재접속 대기(판 정지) 중에는 넣지 않는다 */
  beforeStep(room: Room): void {
    const map = this.bots.get(room);
    const game = room.game;
    if (!map || !game) return;
    for (const [id, bot] of map) {
      // 다시 하기 · 방 정리로 닫힌 연결은 잊는다
      if (bot.closed || bot.seat.conn !== bot) {
        map.delete(id);
        continue;
      }
      if (game.paused !== null || !game.players.has(id)) continue;
      bot.seq += 1;
      const snap = bot.lastSnap;
      let input: InputFrame;
      if (!snap || !bot.info || !bot.brain) input = emptyInput(bot.seq);
      else {
        bot.pending = bot.pending.filter((f) => f.seq > snap.ack);
        const view = predictSelf(snap, bot.pending, this.balance);
        input = bot.brain.decide(view, bot.info, this.balance, bot.seq);
      }
      bot.pending.push(input);
      if (bot.pending.length > MAX_PENDING) bot.pending.shift();
      game.queueInput(id, [input]);
      bot.inputs += 1;
    }
  }
}
