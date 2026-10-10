// 개발 · 테스트용 봇. 실제 WebSocket 클라이언트로 접속해 자기에게 온 (걸러진) 스냅샷만 보고 움직인다.
import WebSocket from 'ws';
import {
  validateBalance,
  type Balance,
  type ClientMessage,
  type InputFrame,
  type MatchInfo,
  type ServerMessage,
  type Snapshot,
} from '@decoy/shared';
import { devBotBrain, idleBrain, predictSelf, type BotBrain } from '@decoy/shared/sim';

/** 서버가 아직 처리하지 않은 입력을 이만큼까지 기억한다 (예측용) */
const MAX_PENDING = 60;

export interface BotClientOptions {
  url: string;
  room: string;
  token: string | null;
  name?: string;
  /** 새 방을 만든다 (room은 무시) */
  create?: boolean;
  /** 판이 시작되면 역할을 보고 두뇌를 고른다 */
  brain?: (info: MatchInfo) => BotBrain;
  onMessage?: (msg: ServerMessage) => void;
}

/** WebSocket 봇 클라이언트. 서버 틱과 같은 주기로 입력을 보낸다 */
export class BotClient {
  private ws: WebSocket;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private brain: BotBrain = idleBrain;
  private pending: InputFrame[] = [];
  info: MatchInfo | null = null;
  balance: Balance | null = null;
  lastSnap: Snapshot | null = null;
  you: string | null = null;
  closed = false;

  constructor(private readonly opts: BotClientOptions) {
    this.ws = new WebSocket(opts.url);
    this.ws.on('open', () => {
      this.send({
        t: 'join',
        room: opts.create ? null : opts.room,
        create: opts.create === true,
        name: opts.name ?? '봇',
        token: opts.token,
        altTokens: [],
        bots: false,
      });
    });
    this.ws.on('message', (data) => this.onMessage(JSON.parse(data.toString()) as ServerMessage));
    this.ws.on('close', () => this.stop());
    this.ws.on('error', () => this.stop());
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(msg: ServerMessage): void {
    this.opts.onMessage?.(msg);
    switch (msg.t) {
      case 'welcome':
        this.you = msg.you;
        this.balance = validateBalance(msg.balance);
        return;
      case 'match':
        this.info = msg.info;
        this.pending = [];
        this.lastSnap = null;
        this.brain = this.opts.brain ? this.opts.brain(msg.info) : idleBrain;
        this.startLoop();
        return;
      case 'snap':
        this.lastSnap = msg.s;
        return;
      case 'result':
      case 'lobby':
        if (msg.t === 'lobby' && msg.lobby.phase !== 'playing') this.stopLoop();
        return;
      default:
        return;
    }
  }

  private startLoop(): void {
    this.stopLoop();
    const hz = this.balance?.network.serverTickHz ?? 30;
    this.timer = setInterval(() => this.tick(), 1000 / hz);
  }

  private stopLoop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (!this.info || !this.balance || !this.lastSnap) return;
    this.seq += 1;
    const snap = this.lastSnap;
    // 괴물 재접속 대기(판 정지) 중에는 서버가 입력을 처리하지 않으므로 보내지 않는다
    if (snap.world.paused !== null) return;
    this.pending = this.pending.filter((f) => f.seq > snap.ack);
    const view = predictSelf(snap, this.pending, this.balance);
    const input = this.brain.decide(view, this.info, this.balance, this.seq);
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    this.send({ t: 'input', frames: [input] });
  }

  stop(): void {
    this.closed = true;
    this.stopLoop();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close();
  }
}

/** ?bots=1 방의 빈자리를 채우는 봇을 띄운다 (GAME_DESIGN 11장: 순찰 봇) */
export function spawnLocalBot(url: string, room: string, token: string): BotClient {
  return new BotClient({ url, room, token, name: '봇', brain: (info) => devBotBrain(info.role) });
}
