// 개발 · 테스트용 봇. 실제 WebSocket 클라이언트로 접속해 자기에게 온 (걸러진) 스냅샷만 보고 움직인다.
import WebSocket from 'ws';
import {
  emptyInput,
  validateBalance,
  type Balance,
  type ClientMessage,
  type InputFrame,
  type MatchInfo,
  type ServerMessage,
  type Snapshot,
} from '@decoy/shared';

/** 봇 두뇌: 스냅샷을 보고 다음 입력을 정한다 */
export interface BotBrain {
  decide(snap: Snapshot, info: MatchInfo, balance: Balance, seq: number): InputFrame;
}

/** 기본 두뇌: 가만히 있는다 */
export const idleBrain: BotBrain = {
  decide: (_snap, _info, _balance, seq) => emptyInput(seq),
};

export interface BotClientOptions {
  url: string;
  room: string;
  token: string | null;
  name?: string;
  brain?: BotBrain;
  onMessage?: (msg: ServerMessage) => void;
}

/** WebSocket 봇 클라이언트. 서버 틱과 같은 주기로 입력을 보낸다 */
export class BotClient {
  private ws: WebSocket;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
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
        room: opts.room,
        create: false,
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
    const brain = this.opts.brain ?? idleBrain;
    const input = brain.decide(this.lastSnap, this.info, this.balance, this.seq);
    this.send({ t: 'input', frames: [input] });
  }

  stop(): void {
    this.closed = true;
    this.stopLoop();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close();
  }
}

/** ?bots=1 방의 빈자리를 채우는 봇을 띄운다 */
export function spawnLocalBot(url: string, room: string, token: string): BotClient {
  return new BotClient({ url, room, token, name: '봇' });
}
