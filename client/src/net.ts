// 서버 연결: WebSocket, 인위적 지연(?lag), 시계 동기화(ping), 메시지 전달.
// 언제 연결 · 재연결 · 감시로 끊을지는 lifecycle.ts LinkKeeper가 정한다(M12). 여기서는 소켓 하나를 열고 버린다
import { LagQueue, type ClientMessage, type ServerMessage } from '@decoy/shared';

export type NetListener = (msg: ServerMessage) => void;

export interface NetOptions {
  /** 왕복 지연 ms (보낼 때 · 받을 때 절반씩) */
  lag: number;
  jitterMs: number;
}

/** 연결이 이만큼 열리지 않으면 끊고 다시 시도한다 (잠든 서버가 깨는 동안 요청이 걸려 있는 경우) */
export const CONNECT_TIMEOUT_MS = 20_000;
/** 연결 · 시계 다시 맞추기 직후 빠른 ping 수 (200ms 간격), 그 뒤는 1초마다 */
export const FAST_PINGS = 5;

interface ClockSample {
  rtt: number;
  offset: number;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private connectTimer: number | null = null;
  private readonly listeners = new Set<NetListener>();
  private readonly outbound: LagQueue<string>;
  private readonly inbound: LagQueue<string>;
  private samples: ClockSample[] = [];
  private pingTimer: number | null = null;
  private pingCount = 0;
  /** 이 시각(performance.now) 전에 보낸 ping의 pong은 시계 표본으로 쓰지 않는다 (숨김에서 돌아와 다시 맞추는 중) */
  private sampleSince = -Infinity;
  /** 시계를 다시 맞추는 중이다: 새 표본이 오면 옛 표본을 버린다 */
  private resyncing = false;
  /** 서버 시각 ≈ performance.now() + offset */
  offset = 0;
  rtt = 0;
  connected = false;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  /** 서버 메시지가 소켓에 도착했다 (지연 큐 전, 수신 감시) */
  onHeard: (() => void) | null = null;
  /** 다시 맞추기 뒤 첫 시계 표본을 받았다 */
  onResynced: (() => void) | null = null;

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
    this.connectTimer = window.setTimeout(() => {
      if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) this.drop();
    }, CONNECT_TIMEOUT_MS);
    // 버린 소켓(drop)의 늦은 이벤트는 무시한다
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.clearConnectTimer();
      this.connected = true;
      this.samples = [];
      this.resyncing = false;
      this.sampleSince = -Infinity;
      this.startPings();
      this.onOpen?.();
    });
    ws.addEventListener('message', (ev: MessageEvent<string>) => {
      if (this.ws !== ws) return;
      this.onHeard?.();
      this.inbound.push(ev.data);
    });
    ws.addEventListener('close', () => {
      if (this.ws === ws) this.finish();
    });
  }

  /** 지금 소켓을 버린다 (수신 감시 · 나가기 · 연결 시간 초과). 반쯤 열린 소켓은 닫힘 응답이 오지 않으므로 기다리지 않고 onClose를 부른다 */
  drop(): void {
    const ws = this.ws;
    if (!ws) return;
    this.finish();
    try {
      ws.close();
    } catch {
      // 이미 닫힘
    }
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

  /** 시계가 지금 믿을 만한가: 다시 맞추는 중(숨김 · 잠자기에서 돌아온 직후, 첫 pong 전)이면 false */
  get clockFresh(): boolean {
    return this.synced && !this.resyncing;
  }

  /** 추정한 지금 서버 시각 (ms) */
  serverNow(): number {
    return performance.now() + this.offset;
  }

  /**
   * 즉시 ping + 빠른 ping 5번으로 시계를 다시 맞춘다 (숨김에서 돌아옴 · 정지 뒤). 기기가 잠들면 performance.now가 멈춰
   * 서버 시계와의 차이가 바뀌므로, 새 표본이 오면 그 전 표본은 버린다. 새 표본 전까지는 지금 값을 그대로 쓴다
   */
  resync(): void {
    if (!this.connected) return;
    this.resyncing = true;
    this.sampleSince = performance.now();
    this.startPings();
  }

  private finish(): void {
    const wasConnected = this.connected || this.ws !== null;
    this.ws = null;
    this.connected = false;
    this.clearConnectTimer();
    if (this.pingTimer !== null) window.clearTimeout(this.pingTimer);
    this.pingTimer = null;
    if (wasConnected) this.onClose?.();
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private startPings(): void {
    if (this.pingTimer !== null) window.clearTimeout(this.pingTimer);
    this.pingCount = 0;
    this.schedulePing(0);
  }

  private schedulePing(delay: number): void {
    this.pingTimer = window.setTimeout(() => {
      if (!this.connected) return;
      this.send({ t: 'ping', c: performance.now() });
      this.pingCount += 1;
      // 처음 몇 번은 빠르게, 이후 1초마다
      this.schedulePing(this.pingCount < FAST_PINGS ? 200 : 1000);
    }, delay);
  }

  private dispatch(text: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    if (msg.t === 'pong' && msg.c >= this.sampleSince) {
      const now = performance.now();
      const rtt = now - msg.c;
      if (this.resyncing) {
        this.resyncing = false;
        this.samples = [];
        this.onResynced?.();
      }
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
