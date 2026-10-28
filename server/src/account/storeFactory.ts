// 계정 저장소 고르기 · 만들기 — DB 구현이 끼울 자리 (docs/ACCOUNT_PLAN.md, DB는 사용자가 고른다 · DECISIONS 15절).
// DB가 정해지면: (1) StoreChoice에 그 종류를 더하고 (2) chooseAccountStore가 그 DB의 접속 환경 변수를 읽어 고르게 하고
// (3) createAccountStore가 그 구현(store.ts AccountStore 모양)을 만든다. 만들기는 접속하지 않는다 — 접속 확인은 init()
import { ACCOUNT_ENV, type AccountMode, type ConfigProblem } from './env';
import { MemoryAccountStore, type AccountStore } from './store';

/** 고른 저장소 (값은 들지 않는다 — 만들 때 환경 변수에서 다시 읽는다) */
export type StoreChoice = { kind: 'memory' };

export type StoreSelection = { ok: true; choice: StoreChoice } | { ok: false; problems: ConfigProblem[] };

/**
 * 환경 변수로 저장소를 고른다. DECOY_ACCOUNT_STORE=memory는 --test-hooks · --dev에서만(배포 서버는 거절 — 다시 띄우면
 * 기록이 사라진다). 그 밖에는 DB인데, 아직 DB 구현이 없어 접속 값이 있어도 'DB 구현 대기'로 켜지 않는다
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
  return { ok: false, problems: [{ name: ACCOUNT_ENV.dbUrl, kind: dbUrl === '' ? 'missing' : 'pending' }] };
}

/** 고른 저장소를 만든다 (접속은 하지 않는다 — AccountStore.init) */
export function createAccountStore(
  choice: StoreChoice,
  _env: Readonly<Record<string, string | undefined>>,
): AccountStore {
  switch (choice.kind) {
    case 'memory':
      return new MemoryAccountStore();
  }
}
