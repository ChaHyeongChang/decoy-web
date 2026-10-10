// 메시지 전송 (M13b): 서버 WebSocket(NetClient)과 기기 안 연습 서버(LocalTransport)가 같은 모양이다.
// 판 화면 · 디버그 훅은 지금 쓰는 전송만 본다 (app.link). 연결 유지 · 재연결 · 수신 감시 · 다른 탭 처리는 'net'에만 있다
import type { ClientMessage, ServerMessage } from '@decoy/shared';

export type TransportKind = 'net' | 'local';

export interface Transport {
  /** net = 서버 WebSocket, local = 기기 안 연습(서버에 가지 않는다) */
  readonly kind: TransportKind;
  send(msg: ClientMessage): void;
  /** 받은 메시지 구독. 돌려준 함수로 끊는다 */
  subscribe(listener: (msg: ServerMessage) => void): () => void;
  /** 전송을 닫는다 (net: 지금 소켓을 버림, local: 기기 안 서버를 멈춤) */
  close(): void;
  /** 서버 시계를 한 번이라도 맞췄는가 (local은 같은 시계라 늘 true) */
  readonly synced: boolean;
  /** 왕복 시간 ms (local 0) */
  readonly rtt: number;
  /** 서버 시각 ≈ performance.now() + offset (local 0) */
  readonly offset: number;
  /** 추정한 지금 서버 시각 (ms) */
  serverNow(): number;
}
