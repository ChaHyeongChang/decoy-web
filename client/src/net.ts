// 서버 연결: WebSocket, 인위적 지연(?lag), 시계 동기화(ping), 메시지 전달
import { LagQueue, type ClientMessage, type ServerMessage } from '@decoy/shared';

export type NetListener = (msg: ServerMessage) => void;

export interface NetOptions {
  /** 왕복 지연 ms (보낼 때 · 받을 때 절반씩) */
  lag: number;
  jitterMs: number;
}

interface ClockSample {
  rtt: number;
  offset: number;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<NetListener>();
  private readonly outbound: LagQueue<string>;
  private readonly inbound: LagQueue<string>;
  private samples: ClockSample[] = [];
  private pingTimer: number | null = null;
  private pingCount = 0;
  /** 서버 시각 ≈ performance.now() + offset */
  offset = 0;
  rtt = 0;
  connected = false;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(
    private readonly url: string,
    readonly options: NetOptions,
  ) {
    const half = options.lag / 2;
    const jitter = options.lag > 0 ? options.jitterMs : 0;
    this.outbound = new LagQueue<string>(half, jitter, (text) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
    });
    this.inbound = new LagQueue<string>(half, jitter, (text) => this.dispatch(text));
  }

  connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.connected = true;
      this.pingCount = 0;
      this.samples = [];
      this.schedulePing(0);
      this.onOpen?.();
    });
    ws.addEventListener('message', (ev: MessageEvent<string>) => this.inbound.push(ev.data));
    ws.addEventListener('close', () => {
      this.connected = false;
      if (this.pingTimer !== null) window.clearTimeout(this.pingTimer);
      this.onClose?.();
    });
  }

  close(): void {
    this.ws?.close();
  }

  on(listener: NetListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(msg: ClientMessage): void {
    this.outbound.push(JSON.stringify(msg));
  }

  /** ping으로 서버 시계를 한 번이라도 맞췄는가 */
  get synced(): boolean {
    return this.samples.length > 0;
  }

  /** 추정한 지금 서버 시각 (ms) */
  serverNow(): number {
    return performance.now() + this.offset;
  }

  private schedulePing(delay: number): void {
    this.pingTimer = window.setTimeout(() => {
      if (!this.connected) return;
      this.send({ t: 'ping', c: performance.now() });
      this.pingCount += 1;
      // 처음 몇 번은 빠르게, 이후 1초마다
      this.schedulePing(this.pingCount < 5 ? 200 : 1000);
    }, delay);
  }

  private dispatch(text: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    if (msg.t === 'pong') {
      const now = performance.now();
      const rtt = now - msg.c;
      this.samples.push({ rtt, offset: msg.s + rtt / 2 - now });
      if (this.samples.length > 12) this.samples.shift();
      // 왕복이 가장 짧았던 표본이 가장 정확하다
      const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      this.offset = best.offset;
      this.rtt = this.samples.slice(-5).reduce((sum, s) => sum + s.rtt, 0) / Math.min(5, this.samples.length);
    }
    for (const l of this.listeners) l(msg);
  }
}

export function defaultWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}
