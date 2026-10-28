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
   * 계정 기록 DB(PostgreSQL) 접속 주소 — Neon 대시보드 Connect의 접속 문자열 그대로 (postgresql://…?sslmode=require…).
   * 다른 Postgres로 옮길 때 이 값만 바꾼다 (docs/LOGIN_GUIDE.md)
   */
  dbUrl: 'DATABASE_URL',
} as const;

/**
 * 설정 문제 하나: 환경 변수 이름과 종류만 (값은 넣지 않는다).
 * missing 빠짐 · invalid 모양이 틀림 · not-allowed 이 모드에서 쓸 수 없음(배포 서버의 메모리 저장소 · 가짜 구글)
 */
export interface ConfigProblem {
  name: string;
  kind: 'missing' | 'invalid' | 'not-allowed';
}

const KIND_TEXT: Record<ConfigProblem['kind'], string> = {
  missing: '없음',
  invalid: '틀림',
  'not-allowed': '이 서버에서 못 씀',
};

/** 로그용 글: "GOOGLE_CLIENT_ID 없음, DATABASE_URL 틀림" (이름 · 종류만) */
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
