// 연결별 송신 정책 (M12): 받는 쪽이 못 따라올 때(휴대폰이 잠깐 멈춤 · 느린 망 · 큰 프레임에 붙잡힌 브라우저)
// 송신 버퍼가 쌓이면 오래된 스냅샷은 건너뛴다. 스냅샷은 그 틱의 전체 상태라 최신 것만 보내면 따라잡는다.
// 스냅샷이 아닌 메시지(welcome · lobby · match · result · error · pong)는 절대 건너뛰지 않는다.
// 끊는 것은 버퍼가 훨씬 크게 쌓였을 때만(반쯤 열린 연결은 하트비트가 먼저 잡는다).
// 판정과 무관한 망 처리 값이라 balance.json이 아니라 여기 둔다 (DECISIONS M12)

/** 이 바이트보다 많이 쌓여 있으면 스냅샷을 건너뛴다 (30Hz × 약 3KB 기준 2~3초 분량) */
export const SKIP_SNAPSHOTS_ABOVE = 256 * 1024;
/** 이 바이트보다 많이 쌓이면 끊는다 (스냅샷을 건너뛰는데도 쌓이는 것은 망가진 연결이다) */
export const TERMINATE_ABOVE = 8 * 1024 * 1024;

export type SendAction = 'send' | 'skip' | 'terminate';

/** 지금 쌓인 바이트와 메시지 종류로 할 일을 정한다 */
export function sendAction(buffered: number, isSnapshot: boolean): SendAction {
  if (buffered > TERMINATE_ABOVE) return 'terminate';
  if (isSnapshot && buffered > SKIP_SNAPSHOTS_ABOVE) return 'skip';
  return 'send';
}
