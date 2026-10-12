// 연결 처리와 틱 스케줄러 (M13a). 서버(server/src/index.ts: HTTP · ws 소켓 · setInterval)와
// 기기 안 연습(M13b)이 같은 코드를 쓴다. 소켓 · 타이머는 바깥이 맡고, 여기서는 받은 원문을 방에 잇고 틱을 돌린다
import type { ClientMessage } from '../types';
import { RoomManager, type Conn, type Room, type RoomConfig, type RoomHooks, type Seat } from './room';

/** 한 번에 따라잡는 최대 틱 수. 그보다 밀리면 시간을 버린다 */
export const MAX_CATCHUP_TICKS = 5;

/** 연결 하나: 바깥(소켓 · 기기 안 전송)이 받은 원문을 넣고, 닫히면 알린다 */
export interface CoreLink {
  /** 받은 원문(JSON 문자열) 하나를 처리한다. 닫힌 뒤에 온 것은 버린다 */
  receive(raw: string): void;
  /** 연결이 닫혔다: 붙어 있던 자리를 끊긴 상태로 */
  close(): void;
}

export class ServerCore {
  readonly manager: RoomManager;
  /** 틱 길이 (ms) */
  readonly tickMs: number;
  private nextTickAt: number;
  /** 서버 빌드 ID (M13d, 없으면 null) */
  private readonly buildId: string | null;

  constructor(
    config: RoomConfig,
    hooks: RoomHooks,
    /** 단조 시계 (ms). 서버는 performance.now */
    private readonly now: () => number,
  ) {
    this.manager = new RoomManager(config, hooks);
    this.buildId = config.buildId ?? null;
    this.tickMs = 1000 / config.balance.network.serverTickHz;
    this.nextTickAt = now() + this.tickMs;
  }

  /**
   * 새 연결. join 전에는 join과 ping만 받고, 묶인 뒤에는 그 자리가 지금도 이 연결일 때만 방에 넘긴다
   * (다른 탭이 자리를 넘겨받은 뒤 옛 연결의 메시지는 무시). 메시지 하나의 오류는 onError로 넘긴다
   */
  connect(conn: Conn, onError: (err: unknown) => void): CoreLink {
    let bound: { room: Room; seat: Seat } | null = null;
    let closed = false;

    const handle = (raw: string): void => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw) as ClientMessage;
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;
      const now = this.now();
      // 지금도 이 연결이 그 자리에 붙어 있는가 (다른 연결이 넘겨받았거나 대기열에서 빠졌으면 풀린 것으로 본다)
      const live = bound && bound.seat.conn?.id === conn.id ? bound : null;
      if (msg.t === 'join' || msg.t === 'quick') {
        if (live) return;
        const r =
          msg.t === 'join' ? this.manager.join(conn, msg, now) : this.manager.quick(conn, msg.name, now);
        if ('error' in r) {
          conn.send(r.error);
          return;
        }
        bound = r;
        r.room.welcome(r.seat);
        return;
      }
      if (msg.t === 'ping' && !live) {
        conn.send({ t: 'pong', c: msg.c, s: now, build: this.buildId });
        return;
      }
      if (!live) return;
      // 빠른 매칭은 판 뒤 방을 해산한다: 다시 하기는 누른 사람만 다시 대기열로 (다른 사람은 결과에 그대로, M13c)
      if (msg.t === 'rematch' && live.room.kind === 'quick' && live.room.phase === 'result') {
        const name = live.seat.name;
        live.room.leave(live.seat, now);
        // 마지막 사람이 떠난 결과 방은 바로 지운다 (남은 봇 연결도 닫는다)
        this.manager.dropIfAbandoned(live.room);
        const r = this.manager.quick(conn, name, now);
        bound = r;
        r.room.welcome(r.seat);
        return;
      }
      live.room.handle(live.seat, msg, now);
      // 나가기: 자리와의 묶음을 푼다 (같은 연결로 다른 방에 들어갈 수 있다). 사람이 남지 않은 로비 · 결과 방은 바로
      // 지운다 — 안 그러면 연결 하나가 만들기 · 나가기를 되풀이해 빈 방을 60초씩 쌓는다 (출시 전 검토)
      if (msg.t === 'leave') {
        bound = null;
        this.manager.dropIfAbandoned(live.room);
      }
    };

    return {
      receive: (raw) => {
        // 지연 큐 때문에 연결이 닫힌 뒤에 도착한 메시지는 버린다 (유령 자리 방지)
        if (closed) return;
        try {
          handle(raw);
        } catch (err) {
          onError(err);
        }
      },
      close: () => {
        closed = true;
        if (bound && bound.seat.conn?.id === conn.id) bound.room.detach(bound.seat, this.now());
      },
    };
  }

  /**
   * 고정 틱 스케줄러: 지금까지 와야 했던 틱을 명목 시각(시작 + n × 틱 길이)으로 돌려 스냅샷 시각 간격이 고르게 한다.
   * 한 번에 최대 MAX_CATCHUP_TICKS까지 따라잡고, 그보다 밀리면 시간을 버린다. 돌린 틱 수를 돌려준다
   */
  advance(nowMs: number = this.now()): number {
    let n = 0;
    while (nowMs >= this.nextTickAt && n < MAX_CATCHUP_TICKS) {
      this.manager.tick(this.nextTickAt);
      this.nextTickAt += this.tickMs;
      n += 1;
    }
    if (nowMs >= this.nextTickAt) this.nextTickAt = nowMs + this.tickMs;
    return n;
  }

  /** 다음 틱의 명목 시각 (ms). 기기 안 연습 루프가 이 시각에 맞춰 깨어난다 */
  get nextTickDue(): number {
    return this.nextTickAt;
  }

  /** 다음 틱을 지금부터 한 틱 뒤로 맞춘다 (멈췄다 돌아왔을 때 따라잡기 없이 이어 가기) */
  resync(nowMs: number = this.now()): void {
    this.nextTickAt = nowMs + this.tickMs;
  }
}
