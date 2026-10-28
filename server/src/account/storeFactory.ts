// 계정 저장소 고르기 · 만들기 (docs/ACCOUNT_PLAN.md · DECISIONS 15절). 배포 서버는 PostgreSQL(DATABASE_URL — Neon 무료 싱가포르에서
// 시작, 표준 Postgres 접속이라 다른 곳으로 옮길 때 주소만 바꾼다). 메모리 저장소는 시험 · 개발 전용. 만들기는 접속하지 않는다 — 접속
// 확인은 init()
import { ACCOUNT_ENV, type AccountMode, type ConfigProblem } from './env';
import { PgAccountStore, createPostgresClient, parseDatabaseUrl, type PgSsl } from './pgStore';
import { MemoryAccountStore, type AccountStore } from './store';

/** 고른 저장소 (접속 값은 들지 않는다 — 만들 때 환경 변수에서 다시 읽는다). ssl: DB 연결 TLS 방식(시작 로그의 경고용) */
export type StoreChoice = { kind: 'memory' } | { kind: 'postgres'; ssl: PgSsl };

export type StoreSelection = { ok: true; choice: StoreChoice } | { ok: false; problems: ConfigProblem[] };

/**
 * 환경 변수로 저장소를 고른다. DECOY_ACCOUNT_STORE=memory는 --test-hooks · --dev에서만(배포 서버는 거절 — 다시 띄우면
 * 기록이 사라진다). 그 밖에는 DATABASE_URL의 PostgreSQL — 없으면 '없음', 모양이 틀리면 '틀림'(값은 찍지 않는다)
 */
export function chooseAccountStore(
  env: Readonly<Record<string, string | undefined>>,
  mode: AccountMode,
): StoreSelection {
  const want = (env[ACCOUNT_ENV.store] ?? '').trim();
  if (want === 'memory') {
    return mode.testHooks || mode.dev
      ? { ok: true, choice: { kind: 'memory' } }
      : { ok: false, problems: [{ name: ACCOUNT_ENV.store, kind: 'not-allowed' }] };
  }
  if (want !== '') return { ok: false, problems: [{ name: ACCOUNT_ENV.store, kind: 'invalid' }] };
  const dbUrl = (env[ACCOUNT_ENV.dbUrl] ?? '').trim();
  if (dbUrl === '') return { ok: false, problems: [{ name: ACCOUNT_ENV.dbUrl, kind: 'missing' }] };
  const conf = parseDatabaseUrl(dbUrl);
  if (!conf) return { ok: false, problems: [{ name: ACCOUNT_ENV.dbUrl, kind: 'invalid' }] };
  return { ok: true, choice: { kind: 'postgres', ssl: conf.ssl } };
}

/**
 * 고른 저장소를 만든다 (접속은 하지 않는다 — AccountStore.init). log: DB 오류 코드 로그.
 * 만들 수 없으면 예외(sslrootcert 파일을 읽지 못함 · 드라이버가 PG* 환경 변수 값을 거절) — 계정 기능 묶음이 로그인을 끈다
 */
export function createAccountStore(
  choice: StoreChoice,
  env: Readonly<Record<string, string | undefined>>,
  log?: (msg: string) => void,
): AccountStore {
  switch (choice.kind) {
    case 'memory':
      return new MemoryAccountStore();
    case 'postgres': {
      const conf = parseDatabaseUrl((env[ACCOUNT_ENV.dbUrl] ?? '').trim());
      // chooseAccountStore가 이미 확인했다
      if (!conf) throw new Error(`${ACCOUNT_ENV.dbUrl} 틀림`);
      return new PgAccountStore(createPostgresClient(conf), { log });
    }
  }
}
