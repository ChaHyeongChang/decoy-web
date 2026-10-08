// 자리 토큰 저장 (DECISIONS D2).
// 탭마다 따로인 sessionStorage가 주 토큰이고(새로고침해도 유지), localStorage는 탭을 닫았다 다시 열 때를 위한 보조다.
// 서버는 보조 토큰을 "지금 끊겨 있는 자리"와 맞을 때만 복귀시키므로 같은 브라우저의 탭 4개가 섞이지 않는다.

const SEAT_KEY = (room: string): string => `decoy:seat:${room}`;
const ALT_KEY = 'decoy:seats';
const NAME_KEY = 'decoy:name';

function safe<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

export function getSeatToken(room: string): string | null {
  return safe(() => sessionStorage.getItem(SEAT_KEY(room)), null);
}

export function getAltTokens(room: string): string[] {
  return safe(() => {
    const all = JSON.parse(localStorage.getItem(ALT_KEY) ?? '{}') as Record<string, string[]>;
    return Array.isArray(all[room]) ? all[room].slice(0, 8) : [];
  }, []);
}

export function saveSeatToken(room: string, token: string): void {
  safe(() => {
    sessionStorage.setItem(SEAT_KEY(room), token);
    const all = JSON.parse(localStorage.getItem(ALT_KEY) ?? '{}') as Record<string, string[]>;
    const list = (all[room] ?? []).filter((t) => t !== token);
    list.unshift(token);
    all[room] = list.slice(0, 4);
    // 오래된 방은 정리 (최근 10개 방만)
    const rooms = Object.keys(all);
    for (const r of rooms.slice(0, Math.max(0, rooms.length - 10))) delete all[r];
    localStorage.setItem(ALT_KEY, JSON.stringify(all));
  }, undefined);
}

export function getSavedName(): string {
  return safe(() => localStorage.getItem(NAME_KEY) ?? '', '');
}

export function saveName(name: string): void {
  safe(() => localStorage.setItem(NAME_KEY, name), undefined);
}
