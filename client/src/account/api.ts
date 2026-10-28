// 계정 API 요청 (선택형 구글 로그인, docs/ACCOUNT_PLAN.md 4절). 첫 묶음에는 요청 하나를 보내는 이 부분만 둔다 — 응답 모양 읽기와
// 엔드포인트별 부르기는 나눠 받는 조각 쪽 account/calls.ts. 모든 요청은 5초 제한(AbortController) · 같은 출처 쿠키 · 캐시 없음.
// POST는 표시 헤더(x-decoy-account: 1) + JSON. 실패(네트워크 · 시간 초과 · 4xx · 5xx · 모양이 틀린 응답)도 예외 없이 결과로
// 돌려준다 — 판은 그대로 간다
import { ACCOUNT_HEADER, type AccountErrorCode } from '@decoy/shared';

/** 요청 하나의 제한 시간 (ms) */
export const ACCOUNT_TIMEOUT_MS = 5000;

/** 실패 이유: 서버 오류 코드 · 네트워크 · 시간 초과 · 모양이 틀린 응답 */
export type AccountFail = AccountErrorCode | 'net' | 'timeout' | 'bad';

export type AccountCall<T> = { ok: true; body: T } | { ok: false; status: number; error: AccountFail };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const ERRORS: readonly string[] = ['off', 'auth', 'csrf', 'bad-request', 'rate', 'db'];

/** 이 기기 표시 tag 모양 (서버가 계정 ID에서 만든 불투명한 값) */
export const TAG_RE = /^[\w-]{1,64}$/;

export class AccountApi {
  constructor(
    private readonly fetcher: FetchLike = (url, init) => fetch(url, init),
    private readonly timeoutMs = ACCOUNT_TIMEOUT_MS,
  ) {}

  /** 요청 하나: body가 null이면 GET, 아니면 POST(JSON + 표시 헤더). read가 null을 돌려주면 모양이 틀린 응답 */
  async request<T>(path: string, body: unknown, read: (b: unknown) => T | null): Promise<AccountCall<T>> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    const init: RequestInit = { credentials: 'same-origin', cache: 'no-store', signal: abort.signal };
    if (body !== null) {
      init.method = 'POST';
      init.headers = { 'content-type': 'application/json', [ACCOUNT_HEADER]: '1' };
      init.body = JSON.stringify(body);
    }
    try {
      const res = await this.fetcher(path, init);
      const data: unknown = await res.json().catch(() => null);
      const v = res.ok && data !== null ? read(data) : null;
      if (v !== null) return { ok: true, body: v };
      const code = String((data as { error?: unknown } | null)?.error);
      return {
        ok: false,
        status: res.status,
        error: ERRORS.includes(code) ? (code as AccountErrorCode) : res.status === 401 ? 'auth' : 'bad',
      };
    } catch {
      return { ok: false, status: 0, error: abort.signal.aborted ? 'timeout' : 'net' };
    } finally {
      clearTimeout(timer);
    }
  }
}
