// 이 기기 계정 표시 `decoy:account` (선택형 구글 로그인, docs/ACCOUNT_PLAN.md 7절): JSON {v:1, tag}. tag는 서버가 계정 ID에서
// 만든 불투명한 값이다(구글 ID · 이메일이 아니다). 있으면 부팅 때 계정 기록을 먼저 읽고, 계정 tag와 같으면 이 기기 기록 올리기를
// 다시 묻지 않는다. 저장소 접근은 storageKeys.ts만 (막혀 있으면 표시 없음 = 게스트)
import { readKey, removeKey, writeKey, type StorageLike } from '../storageKeys';
import { TAG_RE } from './api';

export interface AccountMark {
  read(): string | null;
  write(tag: string): boolean;
  clear(): boolean;
}

/** 저장소를 주지 않으면(undefined) 브라우저 저장소 — 시험은 가짜를 넣는다 */
export function accountMark(storage?: StorageLike | null): AccountMark {
  return {
    read() {
      try {
        const o: unknown = JSON.parse(readKey('account', '', storage) ?? 'null');
        const { v, tag } = (o ?? {}) as { v?: unknown; tag?: unknown };
        return v === 1 && typeof tag === 'string' && TAG_RE.test(tag) ? tag : null;
      } catch {
        return null;
      }
    },
    write: (tag) => writeKey('account', JSON.stringify({ v: 1, tag }), '', storage),
    clear: () => removeKey('account', '', storage),
  };
}
