// 기기 저장 키 목록 (MOBILE_PLAN M12 12번 · 제안 14). localStorage · sessionStorage는 여기서만 쓴다:
// 다른 파일에서 쓰면 단위 테스트가 실패한다(tests/unit/storage-keys.test.ts). 개인정보 처리방침(M15)의 '기기에 저장하는 것'
// 표는 이 목록과 대조한다. 키를 더하면 설명 · 보관 기간을 같이 적는다.
// 저장소는 사생활 보호 모드 · 차단 · iframe · 가득 참에서 접근만으로 예외가 날 수 있어 모든 접근을 감싼다.

export type StorageArea = 'local' | 'session';

export interface StorageKeyInfo {
  /** 실제 키 (방마다 다른 키는 접두사 + 방 코드) */
  key: string;
  area: StorageArea;
  /** 무엇을 저장하는가 (처리방침 표에 그대로 쓴다) */
  what: string;
  /** 얼마나 두는가 */
  keep: string;
  /** 키가 접두사인가 (뒤에 방 코드가 붙는다) */
  prefix?: boolean;
}

export const STORAGE_KEYS = {
  quality: {
    key: 'decoy:quality',
    area: 'local',
    what: '그래픽 품질 선택 (자동이면 저장하지 않음)',
    keep: '사용자가 바꾸거나 브라우저 데이터를 지울 때까지',
  },
  name: {
    key: 'decoy:name',
    area: 'local',
    what: '로비에 입력한 이름',
    keep: '사용자가 바꾸거나 브라우저 데이터를 지울 때까지',
  },
  seat: {
    key: 'decoy:seat:',
    area: 'session',
    prefix: true,
    what: '방 자리 토큰 (새로고침해도 같은 자리로 돌아가기)',
    keep: '탭을 닫을 때까지',
  },
  seats: {
    key: 'decoy:seats',
    area: 'local',
    what: '최근 방 10개의 자리 토큰 (탭을 닫았다 다시 열 때 같은 자리로)',
    keep: '최근 방 10개만, 오래된 것부터 지움',
  },
  lastRoom: {
    key: 'decoy:lastRoom',
    area: 'local',
    what: '마지막 방 코드와 시각 (터치 · 설치 앱에서 30초 안에 같은 자리로 복귀)',
    keep: '다음에 앱을 열 때 30초가 지났으면 지움(나가기를 누르면 바로)',
  },
  haptics: {
    key: 'decoy:haptics',
    area: 'local',
    what: '진동 켜기 · 끄기 설정',
    keep: '사용자가 바꾸거나 브라우저 데이터를 지울 때까지',
  },
  touchTutorial: {
    key: 'decoy:touchTutorial',
    area: 'local',
    what: '터치 조작 안내를 본 적 있는가',
    keep: '사용자가 다시 보기를 누르거나 브라우저 데이터를 지울 때까지',
  },
  wakeReloads: {
    key: 'decoy:wakeReloads',
    area: 'session',
    what: '서버 깨우기 화면의 자동 새로고침 시각 (1분 안에 3번 넘으면 멈춤)',
    keep: '탭을 닫을 때까지',
  },
  perf: {
    key: 'decoy:perf',
    area: 'local',
    what: '판 중 측정한 FPS로 정한 품질 (온라인 · 연습 따로)',
    keep: '사용자가 품질을 고르거나 브라우저 데이터를 지울 때까지',
  },
} as const satisfies Record<string, StorageKeyInfo>;

export type StorageKeyId = keyof typeof STORAGE_KEYS;

/** 저장소 하나 (테스트에서 가짜를 넣을 수 있게 최소 모양) */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 브라우저 저장소 (막혀 있으면 null) */
export function browserStorage(area: StorageArea = 'local'): StorageLike | null {
  try {
    if (area === 'session') return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function fullKey(id: StorageKeyId, suffix: string): string {
  return STORAGE_KEYS[id].key + suffix;
}

/** 읽기 (없거나 읽을 수 없으면 null). suffix는 접두사 키의 뒷부분(방 코드) */
export function readKey(
  id: StorageKeyId,
  suffix = '',
  storage: StorageLike | null = browserStorage(STORAGE_KEYS[id].area),
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(fullKey(id, suffix));
  } catch {
    return null;
  }
}

/** 쓰기 (못 쓰면 false) */
export function writeKey(
  id: StorageKeyId,
  value: string,
  suffix = '',
  storage: StorageLike | null = browserStorage(STORAGE_KEYS[id].area),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(fullKey(id, suffix), value);
    return true;
  } catch {
    return false;
  }
}

/** 지우기 (못 지우면 false) */
export function removeKey(
  id: StorageKeyId,
  suffix = '',
  storage: StorageLike | null = browserStorage(STORAGE_KEYS[id].area),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(fullKey(id, suffix));
    return true;
  } catch {
    return false;
  }
}
