// 연결별 송신 정책 (M12): 받는 쪽이 못 따라올 때(휴대폰이 잠깐 멈춤 · 느린 망 · 큰 프레임에 붙잡힌 브라우저)
// 송신 버퍼가 쌓이면 오래된 스냅샷은 건너뛴다. 스냅샷은 그 틱의 전체 상태라 최신 것만 보내면 따라잡는다.
// 스냅샷이 아닌 메시지(welcome · lobby · match · result · error · pong)는 절대 건너뛰지 않는다.
// 거점 메모(비밀번호)가 든 스냅샷도 건너뛰지 않는다: 메모는 그 스냅샷의 일회성 이벤트로만 한 번 나간다.
// 다른 일회성 이벤트(소리 · 배너 등)는 건너뛴 스냅샷과 함께 버려진다. 받는 쪽에서도 오래돼 버릴 것들이다(staleEvents).
// 끊는 것은 버퍼가 훨씬 크게 쌓였을 때만(반쯤 열린 연결은 하트비트가 먼저 잡는다).
// 판정과 무관한 망 처리 값이라 balance.json이 아니라 여기 둔다 (DECISIONS M12)
import { LagQueue, isKeptNote, type ServerMessage } from '@decoy/shared';

/**
 * 이 바이트보다 많이 쌓여 있으면 스냅샷을 건너뛴다.
 * 스냅샷 20Hz(balance.network.snapshotHz) × JSON 약 1.2KB(봇 판 측정, 최대 약 1.6KB) 기준 약 8~11초 분량
 */
export const SKIP_SNAPSHOTS_ABOVE = 256 * 1024;
/** 이 바이트보다 많이 쌓이면 끊는다 (스냅샷을 건너뛰는데도 쌓이는 것은 망가진 연결이다) */
export const TERMINATE_ABOVE = 8 * 1024 * 1024;

export type SendAction = 'send' | 'skip' | 'terminate';

/** 지금 쌓인 바이트와 건너뛰어도 되는 메시지인지(isSkippableSnapshot)로 할 일을 정한다 */
export function sendAction(buffered: number, skippable: boolean): SendAction {
  if (buffered > TERMINATE_ABOVE) return 'terminate';
  if (skippable && buffered > SKIP_SNAPSHOTS_ABOVE) return 'skip';
  return 'send';
}

/** 밀릴 때 건너뛰어도 되는 메시지인가: 스냅샷만, 단 거점 메모가 든 스냅샷은 아니다 */
export function isSkippableSnapshot(msg: ServerMessage): boolean {
  return msg.t === 'snap' && !msg.s.events.some(isKeptNote);
}

/** 송신 경로가 쓰는 소켓의 부분 (ws의 WebSocket이 그대로 맞는다) */
export interface SendSocket {
  readonly readyState: number;
  readonly OPEN: number;
  readonly bufferedAmount: number;
  send(text: string): void;
  close(): void;
  terminate(): void;
}

/**
 * 연결 하나의 송신 경로: 메시지를 넣은 순서대로 (시험용 지연 큐를 거쳐) 소켓에 보내고, 보낼 때마다 sendAction을 따른다.
 * close()는 앞서 넣은 메시지(예: 'replaced' 알림)를 모두 보낸 뒤 닫는다
 */
export function createSender(
  socket: SendSocket,
  lagMs: number,
  jitterMs: number,
  random: () => number,
): { send(msg: ServerMessage): void; close(): void } {
  // null = 닫기 표식
  const queue = new LagQueue<{ text: string; skippable: boolean } | null>(
    lagMs,
    jitterMs,
    (out) => {
      if (socket.readyState !== socket.OPEN) return;
      if (out === null) {
        socket.close();
        return;
      }
      const action = sendAction(socket.bufferedAmount, out.skippable);
      if (action === 'terminate') socket.terminate();
      else if (action === 'send') socket.send(out.text);
    },
    random,
  );
  return {
    send: (msg) => queue.push({ text: JSON.stringify(msg), skippable: isSkippableSnapshot(msg) }),
    close: () => queue.push(null),
  };
}
