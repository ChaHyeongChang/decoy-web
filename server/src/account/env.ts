// 선택형 구글 로그인의 환경 변수 이름 (docs/ACCOUNT_PLAN.md 3절) · 설정 문제 표시. 값은 Render 대시보드에만 둔다(공개 저장소).
// 로그 · 오류에는 이 '이름'만 쓴다 — 값(클라이언트 ID · 비밀 · DB 주소)을 찍지 않는다

export const ACCOUNT_ENV = {
  /** '1'이면 로그인을 켠다 (기본 꺼짐 — Play 데이터 보안 신고를 고친 뒤 사용자가 켠다) */
  login: 'DECOY_LOGIN',
  /** 구글 클라우드 OAuth 클라이언트 ID (…apps.googleusercontent.com) */
  clientId: 'GOOGLE_CLIENT_ID',
  /** 세션 쿠키 서명 비밀 (32자 이상, render.yaml generateValue) */
  sessionSecret: 'DECOY_SESSION_SECRET',
  /** 계정 하루가 바뀌는 시간대 (IANA, 기본 Asia/Seoul) */
  timeZone: 'DECOY_ACCOUNT_TIMEZONE',
  /** 시험 · 개발 전용 저장소 고르기 ('memory' — --test-hooks · --dev일 때만) */
  store: 'DECOY_ACCOUNT_STORE',
  /** 로그인 제공자 ('google' · 'test' — 가짜 구글은 --test-hooks일 때만, 시험 훅 모드 기본값) */
  idp: 'DECOY_ACCOUNT_IDP',
  /**
   * DB 접속 주소 (DB 구현이 끼울 자리: 사용자가 DB를 고르면 그 DB의 이름으로 바꾼다 — DECISIONS 15절).
   * 지금은 값이 있어도 'DB 구현 대기'로 로그인을 켜지 않는다
   */
  dbUrl: 'DATABASE_URL',
} as const;

/**
 * 설정 문제 하나: 환경 변수 이름과 종류만 (값은 넣지 않는다).
 * missing 빠짐 · invalid 모양이 틀림 · not-allowed 이 모드에서 쓸 수 없음(배포 서버의 메모리 저장소 · 가짜 구글) ·
 * pending DB 구현 대기
 */
export interface ConfigProblem {
  name: string;
  kind: 'missing' | 'invalid' | 'not-allowed' | 'pending';
}

const KIND_TEXT: Record<ConfigProblem['kind'], string> = {
  missing: '없음',
  invalid: '틀림',
  'not-allowed': '이 서버에서 못 씀',
  pending: 'DB 구현 대기',
};

/** 로그용 글: "GOOGLE_CLIENT_ID 없음, DATABASE_URL DB 구현 대기" (이름 · 종류만) */
export function describeProblems(problems: readonly ConfigProblem[]): string {
  return problems.map((p) => `${p.name} ${KIND_TEXT[p.kind]}`).join(', ');
}

/** 서버 실행 모드 (server/src/config.ts parseOptions) */
export interface AccountMode {
  /** --test-hooks (시험 전용 명령 · 가짜 구글 · 메모리 저장소 허용) */
  testHooks: boolean;
  /** --dev (개발 서버: 메모리 저장소 허용) */
  dev: boolean;
}
