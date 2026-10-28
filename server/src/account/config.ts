// 선택형 구글 로그인 설정 (docs/ACCOUNT_PLAN.md 3절): 환경 변수를 읽어 켤 수 있는지 판단한다. 기본은 꺼짐.
// DECOY_LOGIN=1인데 하나라도 빠지거나 틀리면 꺼진 채로 두고, 문제가 된 환경 변수 '이름'만 돌려준다(값은 로그에 찍지 않는다).
// 가짜 구글 · 메모리 저장소는 시험 훅(--test-hooks)에서만 — 배포 서버(훅 없음)는 받지 않는다
import { isTimeZone } from '@decoy/shared/meta';
import { ACCOUNT_ENV, describeProblems, type AccountMode, type ConfigProblem } from './env';
import { chooseAccountStore, type StoreChoice } from './storeFactory';

export const DEFAULT_ACCOUNT_TIMEZONE = 'Asia/Seoul';
/** 세션 서명 비밀 최소 길이 (render.yaml generateValue는 이보다 길다) */
export const SESSION_SECRET_MIN_LENGTH = 32;
/** 구글 클라우드 OAuth 클라이언트 ID 모양 (웹 애플리케이션 유형) */
export const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$/;

export type AccountConfig =
  | {
      enabled: false;
      /** DECOY_LOGIN=1이었는가 (켜려 했는데 문제가 있었다) */
      requested: boolean;
      problems: ConfigProblem[];
    }
  | {
      enabled: true;
      requested: true;
      problems: [];
      clientId: string;
      sessionSecret: string;
      timeZone: string;
      store: StoreChoice;
      /** 가짜 구글 (/test/google/authorize, 시험 키로 서명) — 시험 훅 모드에서만 */
      testIdp: boolean;
    };

type Env = Readonly<Record<string, string | undefined>>;

function read(env: Env, name: string): string {
  return (env[name] ?? '').trim();
}

/** 환경 변수 → 계정 설정 (순수 함수: 값을 바꾸거나 찍지 않는다) */
export function readAccountConfig(env: Env, mode: AccountMode): AccountConfig {
  if (read(env, ACCOUNT_ENV.login) !== '1') return { enabled: false, requested: false, problems: [] };
  const problems: ConfigProblem[] = [];

  // 로그인 제공자: 시험 훅 모드 기본값은 가짜 구글, 배포 서버는 구글만
  const idpRaw = read(env, ACCOUNT_ENV.idp);
  let testIdp = false;
  if (idpRaw === '') testIdp = mode.testHooks;
  else if (idpRaw === 'test') {
    if (mode.testHooks) testIdp = true;
    else problems.push({ name: ACCOUNT_ENV.idp, kind: 'not-allowed' });
  } else if (idpRaw !== 'google') problems.push({ name: ACCOUNT_ENV.idp, kind: 'invalid' });

  // 클라이언트 ID: 가짜 구글이면 비지 않은 아무 값(시험), 아니면 구글 모양
  const clientId = read(env, ACCOUNT_ENV.clientId);
  if (clientId === '') problems.push({ name: ACCOUNT_ENV.clientId, kind: 'missing' });
  else if (!testIdp && !GOOGLE_CLIENT_ID_PATTERN.test(clientId))
    problems.push({ name: ACCOUNT_ENV.clientId, kind: 'invalid' });

  const sessionSecret = read(env, ACCOUNT_ENV.sessionSecret);
  if (sessionSecret === '') problems.push({ name: ACCOUNT_ENV.sessionSecret, kind: 'missing' });
  else if (sessionSecret.length < SESSION_SECRET_MIN_LENGTH)
    problems.push({ name: ACCOUNT_ENV.sessionSecret, kind: 'invalid' });

  // 시간대: 없으면 기본값, 있는데 모르는 이름이면 켜지 않는다(하루가 엉뚱한 때 바뀌지 않게)
  const tzRaw = read(env, ACCOUNT_ENV.timeZone);
  const timeZone = tzRaw === '' ? DEFAULT_ACCOUNT_TIMEZONE : tzRaw;
  if (!isTimeZone(timeZone)) problems.push({ name: ACCOUNT_ENV.timeZone, kind: 'invalid' });

  const store = chooseAccountStore(env, mode);
  if (!store.ok) problems.push(...store.problems);

  if (problems.length > 0 || !store.ok) return { enabled: false, requested: true, problems };
  return {
    enabled: true,
    requested: true,
    problems: [],
    clientId,
    sessionSecret,
    timeZone,
    store: store.choice,
    testIdp,
  };
}

/** 서버 시작 로그 한 줄: "계정 로그인: 켜짐 (memory)" · "계정 로그인: 꺼짐 (GOOGLE_CLIENT_ID 없음)". 값은 넣지 않는다 */
export function describeAccountConfig(cfg: AccountConfig): string {
  if (cfg.enabled) return `계정 로그인: 켜짐 (${cfg.store.kind}${cfg.testIdp ? ', 가짜 구글' : ''})`;
  if (!cfg.requested) return `계정 로그인: 꺼짐 (${ACCOUNT_ENV.login})`;
  return `계정 로그인: 꺼짐 (${describeProblems(cfg.problems)})`;
}
