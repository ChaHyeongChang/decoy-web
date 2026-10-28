// 선택형 구글 로그인 · 계정 저장의 경로 · 쿠키 · 주소 표시 (docs/ACCOUNT_PLAN.md). 서버 · 클라이언트 · 서비스 워커 · 시험이 같은 값을 쓴다.
// 메시지 · 응답 타입은 types.ts '계정' 절

/** 계정 API (JSON). 상태 읽기만 GET, 나머지는 POST + ACCOUNT_HEADER */
export const ACCOUNT_API = {
  status: '/api/account',
  import: '/api/account/import',
  claimLogin: '/api/account/claim-login',
  costume: '/api/account/costume',
  logout: '/api/account/logout',
  delete: '/api/account/delete',
} as const;

/** 구글 로그인 시작 (GET, 쿼리 next=delete면 끝나고 삭제 페이지로) · 구글이 ID 토큰을 POST로 돌려주는 곳 */
export const AUTH_START_PATH = '/auth/google/start';
export const AUTH_CALLBACK_PATH = '/auth/google/callback';

/** 계정 삭제 웹 페이지 (Play 데이터 보안 신고 '계정 삭제 URL'). GET 안내 · POST 삭제 */
export const ACCOUNT_DELETE_PATH = '/account/delete';
/** 삭제 페이지에서 로그인한 구글 계정으로 만든 DECOY 계정이 없을 때 돌아오는 주소 표시 (?none=1 — 계정을 만들지 않는다) */
export const DELETE_NONE_PARAM = 'none';

/**
 * 서비스 워커가 가로채지 않는 경로 앞부분 (로그인 · 계정 요청은 캐시하지 않는다 — 앱 셸 · 깨우기 화면으로 바꿔 주면 로그인이
 * 깨진다). client/public/sw.js의 PASS가 이 값을 포함해야 한다(tests/unit/sw-shell.test.ts)
 */
export const ACCOUNT_PASS_PREFIXES = ['/api/', '/auth/', '/account/'] as const;

/**
 * 계정 API의 POST에 붙이는 표시 헤더 (값 '1'). 다른 사이트의 스크립트는 이 헤더를 붙여 보낼 수 없다(CORS 사전 요청을 허락하지
 * 않는다) — 쿠키 세션의 요청 위조(CSRF) 막기. 서버는 Origin도 본다
 */
export const ACCOUNT_HEADER = 'x-decoy-account';

/** 세션 쿠키 (HttpOnly — 화면 스크립트가 읽지 못한다) · 로그인 중 state/nonce 쿠키 */
export const SESSION_COOKIE = 'decoy_sid';
export const OAUTH_COOKIE = 'decoy_oauth';
/**
 * 계정 삭제 페이지 전용 쿠키 (삭제 페이지에서 시작한 로그인 — next=delete). Path가 /account/delete라 게임 연결(/ws) · 계정 API(/api)에는
 * 실리지 않는다: 삭제하려고 로그인한 브라우저가 게임에서 몰래 계정 모드 · 계정 적립이 되지 않게. 10분, HttpOnly
 */
export const DELETE_COOKIE = 'decoy_del';

/** 로그인이 끝나고 돌아온 첫 화면 주소의 표시 (?login=…). 화면이 읽고 주소에서 지운다 */
export const LOGIN_RESULT_PARAM = 'login';
export type LoginResult =
  /** 로그인했다 */
  | 'ok'
  /** 구글 화면에서 취소했다 */
  | 'cancel'
  /** 토큰 · state 검증 실패 (다시 시도) */
  | 'fail'
  /** 로그인 기능이 꺼져 있다 */
  | 'off'
  /** 계정 저장소(DB)에 닿지 않는다 — 게스트로 계속 */
  | 'db';

export const LOGIN_RESULTS: readonly LoginResult[] = ['ok', 'cancel', 'fail', 'off', 'db'];

export function isLoginResult(v: unknown): v is LoginResult {
  return typeof v === 'string' && (LOGIN_RESULTS as readonly string[]).includes(v);
}
