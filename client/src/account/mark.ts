// 이 기기 계정 표시 `decoy:account` (선택형 구글 로그인, docs/ACCOUNT_PLAN.md 7절): JSON {v:1, tag, off?}. tag는 서버가 계정 ID에서
// 만든 불투명한 값이다(구글 ID · 이메일이 아니다). 있으면 부팅 때 계정 기록을 먼저 읽고, 계정 tag와 같으면 이 기기 기록 올리기를
// 다시 묻지 않는다. tag ''는 '로그인 시도 중'(로그인하고 돌아와 첫 로그인을 아직 마치지 못함 — account/boot.ts): 부팅 때 읽고, 어느
// 계정 tag와도 달라 첫 로그인으로 본다. off는 '로그인 기능이 꺼진 것을 이미 알렸다': 다음 부팅부터 꺼짐 안내 · 레벨 칩 기다림 없이
// 상태만 뒤에서 읽어 다시 켜졌는지 본다(켜져 같은 계정이면 지운다). 저장소 접근은 storageKeys.ts만 (막혀 있으면 표시 없음 = 게스트)
import { readKey, removeKey, writeKey, type StorageLike } from '../storageKeys';
import { TAG_RE } from './api';

export interface AccountMark {
  read(): string | null;
  /** 로그인 기능이 꺼진 것을 이미 알렸다 */
  off(): boolean;
  write(tag: string, off?: boolean): boolean;
  clear(): boolean;
}

/** 저장소를 주지 않으면(undefined) 브라우저 저장소 — 시험은 가짜를 넣는다 */
export function accountMark(storage?: StorageLike | null): AccountMark {
  const get = (): { tag: string; off?: unknown } | null => {
    try {
      const o = JSON.parse(readKey('account', '', storage) ?? 'null') as {
        v?: unknown;
        tag?: unknown;
        off?: unknown;
      } | null;
      const tag = o?.tag;
      return o?.v === 1 && typeof tag === 'string' && (tag === '' || TAG_RE.test(tag)) ? { ...o, tag } : null;
    } catch {
      return null;
    }
  };
  return {
    read: () => get()?.tag ?? null,
    off: () => get()?.off === true,
    write: (tag, off) =>
      writeKey('account', JSON.stringify(off ? { v: 1, tag, off } : { v: 1, tag }), '', storage),
    clear: () => removeKey('account', '', storage),
  };
}
