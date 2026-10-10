// 거점 메모 판별 (M12 검토 반영). 판정이 아닌 분류 함수다.
// 거점 메모(NOTE_FIRST · NOTE_SECOND)는 비밀번호 두 자리를 담아 판에 두 번, 이 일회성 이벤트로만 전해진다.
// 그래서 다른 일회성 이벤트를 버리는 곳(재접속 때 쌓인 알림 비우기 · 송신 밀림 때 스냅샷 건너뛰기 ·
// 오래된 스냅샷의 연출 건너뛰기)에서도 이것만은 남긴다
import type { GameEvent } from './types';

/** 버리면 안 되는 거점 메모인가 */
export function isKeptNote(ev: GameEvent): boolean {
  return ev.k === 'text' && (ev.id === 'NOTE_FIRST' || ev.id === 'NOTE_SECOND');
}
