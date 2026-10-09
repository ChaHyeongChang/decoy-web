// 자리 토큰 저장 (DECISIONS D2).
// 탭마다 따로인 sessionStorage가 주 토큰이고(새로고침해도 유지), localStorage는 탭을 닫았다 다시 열 때를 위한 보조다.
// 서버는 보조 토큰을 "지금 끊겨 있는 자리"와 맞을 때만 복귀시키므로 같은 브라우저의 탭 4개가 섞이지 않는다.
// 키 · 보관 기간은 storageKeys.ts (M12)
import { encodeLastRoom, freshLastRoom, type LastRoom } from './lifecycle';
import { readKey, removeKey, writeKey } from './storageKeys';

function readSeats(): Record<string, string[]> {
  try {
    const all: unknown = JSON.parse(readKey('seats') ?? '{}');
    return all !== null && typeof all === 'object' ? (all as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function getSeatToken(room: string): string | null {
  return readKey('seat', room);
}

export function getAltTokens(room: string): string[] {
  const list = readSeats()[room];
  return Array.isArray(list) ? list.slice(0, 8) : [];
}

export function saveSeatToken(room: string, token: string): void {
  writeKey('seat', token, room);
  const all = readSeats();
  const list = (Array.isArray(all[room]) ? all[room] : []).filter((t) => t !== token);
  list.unshift(token);
  all[room] = list.slice(0, 4);
  // 오래된 방은 정리 (최근 10개 방만)
  const rooms = Object.keys(all);
  for (const r of rooms.slice(0, Math.max(0, rooms.length - 10))) delete all[r];
  writeKey('seats', JSON.stringify(all));
}

export function getSavedName(): string {
  return readKey('name') ?? '';
}

export function saveName(name: string): void {
  writeKey('name', name);
}

// ───────────── 마지막 방 (M12, 터치 · 설치 앱만 쓴다) ─────────────

/** 지금 이 방에 있다 (방에 들어감 · 숨겨짐 · 페이지를 떠남마다 시각을 새로 적는다) */
export function saveLastRoom(room: string, now = Date.now()): void {
  writeKey('lastRoom', encodeLastRoom(room, now));
}

/** 30초 안에 있던 방 (지났거나 깨졌으면 지우고 null) */
export function loadLastRoom(now = Date.now()): LastRoom | null {
  const raw = readKey('lastRoom');
  const last = freshLastRoom(raw, now);
  if (!last && raw !== null) removeKey('lastRoom');
  return last;
}

export function clearLastRoom(): void {
  removeKey('lastRoom');
}
