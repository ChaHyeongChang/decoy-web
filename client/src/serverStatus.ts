// 첫 화면 서버 상태 줄 (M13b, 렌더링과 분리된 순수 로직). 첫 화면은 연결과 상관없이 바로 그리고,
// 가운데 깨우기 패널 대신 이 한 줄로 알린다(패널은 방 · 판 화면에서만). 봇과 연습은 어느 상태에서나 된다
//  - 연결됨
//  - 서버를 깨우는 중… n초 (처음 시도부터 UNREACHABLE_AFTER_MS 동안) — 무료 서버가 깨어나는 데 1분쯤 걸린다
//  - 서버에 연결할 수 없어요 (인터넷은 되는데 그보다 오래 못 붙음 — 운영 종료 · 장애. '깨우는 중'이 끝없이 오르지 않게)
//  - 인터넷 연결이 없어요 (기기가 오프라인)

/** 이만큼 넘게 못 붙으면 '깨우는 중' 대신 '연결할 수 없어요' (깨우기 화면 wake.html의 90초와 같다) */
export const UNREACHABLE_AFTER_MS = 90_000;

export type ServerStatus = 'connected' | 'waking' | 'unreachable' | 'offline';

export interface ServerStatusView {
  status: ServerStatus;
  /** 기다린 시간 (초, 내림). connected · offline이면 0 */
  seconds: number;
}

export interface ServerStatusInput {
  /** 서버와 연결이 열려 있다 */
  connected: boolean;
  /** 기기가 오프라인이다 (navigator.onLine · online/offline 이벤트) */
  offline: boolean;
  /** 연결을 기다리기 시작한 시각 (ms). 기다리는 중이 아니면 null */
  waitingSince: number | null;
  nowMs: number;
}

export function serverStatus(i: ServerStatusInput): ServerStatusView {
  if (i.connected) return { status: 'connected', seconds: 0 };
  if (i.offline) return { status: 'offline', seconds: 0 };
  const waited = i.waitingSince === null ? 0 : Math.max(0, i.nowMs - i.waitingSince);
  const seconds = Math.floor(waited / 1000);
  return { status: waited > UNREACHABLE_AFTER_MS ? 'unreachable' : 'waking', seconds };
}
