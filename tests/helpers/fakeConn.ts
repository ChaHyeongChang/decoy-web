// 소켓 없이 방 로직을 시험하기 위한 가짜 연결
import type { ServerMessage } from '@decoy/shared';
import type { Conn } from '@decoy/shared/sim';

let counter = 1000;

export class FakeConn implements Conn {
  readonly id = ++counter;
  readonly inbox: ServerMessage[] = [];
  /** 로그인한 계정 키 (선택형 구글 로그인 — 서버가 세션 쿠키로 둔다, 게스트는 null) */
  constructor(readonly account: string | null = null) {}
  closed = false;
  send(msg: ServerMessage): void {
    this.inbox.push(msg);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i -= 1) {
      const m = this.inbox[i];
      if (m && m.t === t) return m as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
  count(t: ServerMessage['t']): number {
    return this.inbox.filter((m) => m.t === t).length;
  }
}
