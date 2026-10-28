// 계정 저장소 PostgreSQL 구현 (server/src/account/pgStore.ts, Neon 무료 싱가포르 · DECISIONS 15절): DB 없이 도는 부분.
// - DATABASE_URL 해석: Neon 접속 문자열 · sslmode → TLS(require도 인증서 확인) · 틀린 모양은 null(값을 담지 않는다)
// - 드라이버 설정: 접속 6초 · 쉬는 연결 60초 · 연결 2개 · 준비 문장 끔 · 환경 변수 PG*로 빈 곳을 채우지 않음
// - 오류 분류: 연결 오류만 한 번 더 · 한도 초과는 바로 실패 · 로그에는 코드와 힌트만(1분에 한 번)
// - 가짜 연결로 저장소: 행 모양 · 만들기 충돌 · 다시 하기 · 서비스가 저장소의 호출 제한(10초)을 쓴다
// - 닿지 않는 DB(닫힌 포트): 서버는 뜨고 계정 요청만 503(db), 적립은 실패 알림 — 판은 그대로
// 실제 PostgreSQL 시험은 account-pg-live.test.ts (DECOY_TEST_DATABASE_URL이 있을 때)
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { MatchRating } from '@decoy/shared';
import { ACCOUNT_TIMEOUT_MS } from '../../client/src/account/api';
import {
  PG_CALL_TIMEOUT_MS,
  PG_CONNECT_TIMEOUT_S,
  PG_IDLE_TIMEOUT_S,
  PG_LOG_EVERY_MS,
  PG_RETRY_WAIT_MS,
  PgAccountStore,
  classifyPgError,
  createPostgresClient,
  parseDatabaseUrl,
  postgresOptions,
  type PgClient,
  type PgResult,
} from '../../server/src/account/pgStore';
import { AccountService, AccountUnavailable, DB_TIMEOUT_MS } from '../../server/src/account/service';
import { signSession } from '../../server/src/account/session';
import type { AccountStore } from '../../server/src/account/store';
import {
  CookieJar,
  TEST_CLIENT_ID,
  TEST_SECRET,
  loginFlow,
  startAccountServer,
} from '../helpers/accountServer';

const NEON =
  'postgresql://neondb_owner:npg_S3cretPw@ep-cool-name-a1b2c3d4-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

describe('DATABASE_URL 해석', () => {
  it('Neon 접속 문자열: 호스트 · 기본 포트 · 사용자 · 비밀번호 · DB, sslmode=require → 인증서 확인, channel_binding은 무시', () => {
    expect(parseDatabaseUrl(NEON)).toEqual({
      host: 'ep-cool-name-a1b2c3d4-pooler.ap-southeast-1.aws.neon.tech',
      port: 5432,
      user: 'neondb_owner',
      password: 'npg_S3cretPw',
      database: 'neondb',
      ssl: 'verify',
    });
    // 앞뒤 공백 · postgres:// · 대문자 스킴
    expect(parseDatabaseUrl(`  ${NEON.replace('postgresql', 'POSTGRES')}\n`)?.host).toContain('neon.tech');
  });

  it('sslmode: 없거나 prefer · allow → prefer(시도), disable → 암호화 없음, require · verify-ca · verify-full · sslrootcert=system → 확인', () => {
    const at = (q: string) => parseDatabaseUrl(`postgres://u:p@db.example.com/d${q}`)?.ssl;
    expect(at('')).toBe('prefer');
    expect(at('?sslmode=prefer')).toBe('prefer');
    expect(at('?sslmode=allow')).toBe('prefer');
    expect(at('?sslmode=disable')).toBe('disable');
    for (const m of ['require', 'verify-ca', 'verify-full']) expect(at(`?sslmode=${m}`)).toBe('verify');
    expect(at('?sslrootcert=system')).toBe('verify');
    expect(at('?sslmode=nope')).toBeUndefined();
  });

  it('% 글자 풀기 · 포트 · DB가 없으면 사용자 이름 · IPv6', () => {
    expect(parseDatabaseUrl('postgres://us%40er:p%2Fw%3A@127.0.0.1:6543/my%20db')).toMatchObject({
      user: 'us@er',
      password: 'p/w:',
      port: 6543,
      database: 'my db',
    });
    expect(parseDatabaseUrl('postgres://owner:pw@db.example.com')?.database).toBe('owner');
    expect(parseDatabaseUrl('postgres://owner:pw@db.example.com/')?.database).toBe('owner');
    expect(parseDatabaseUrl('postgres://u:p@[::1]:5433/d')).toMatchObject({ host: '::1', port: 5433 });
    // 비밀번호 없음도 받는다 (내부망 · 시험)
    expect(parseDatabaseUrl('postgres://u@h/d')?.password).toBe('');
  });

  it('틀린 모양은 null: 다른 스킴 · 사용자 없음 · 여러 호스트 · 포트 범위 · 깨진 % · 경로 두 단계 · 빈 글', () => {
    for (const bad of [
      '',
      'not a url',
      'mysql://u:p@h/d',
      'https://u:p@h/d',
      'postgres://h/d',
      'postgres://:p@h/d',
      'postgres://u:p@h1,h2/d',
      'postgres://u:p@h1:5432,h2:5432/d',
      'postgres://u:p@h:0/d',
      'postgres://u:p@h:70000/d',
      'postgres://u:p%zz@h/d',
      'postgres://u:p@h/a/b',
      'postgres://u:p@/d',
    ])
      expect(parseDatabaseUrl(bad), bad).toBeNull();
  });
});

describe('드라이버 설정', () => {
  it('접속 6초 · 쉬는 연결 60초 · 연결 2개 · 준비 문장 끔 · 타입 읽기 끔, TLS 모드 → 드라이버 값', () => {
    const conf = parseDatabaseUrl(NEON)!;
    const o = postgresOptions(conf);
    expect(o).toMatchObject({
      host: conf.host,
      port: 5432,
      user: 'neondb_owner',
      pass: 'npg_S3cretPw',
      database: 'neondb',
      ssl: 'verify-full',
      max: 2,
      idle_timeout: PG_IDLE_TIMEOUT_S,
      connect_timeout: PG_CONNECT_TIMEOUT_S,
      prepare: false,
      fetch_types: false,
    });
    // 드라이버가 접속을 미루지 않는다 (다시 하기는 저장소가 한 번)
    expect(typeof o.backoff === 'function' ? o.backoff(8) : o.backoff).toBe(0);
    expect(PG_CONNECT_TIMEOUT_S).toBe(6);
    expect(PG_IDLE_TIMEOUT_S).toBe(60);
    // Neon 무료는 5분 쉬면 잠든다: 쉬는 연결은 그보다 먼저 닫는다
    expect(PG_IDLE_TIMEOUT_S).toBeLessThan(5 * 60);
    expect(postgresOptions({ ...conf, ssl: 'prefer' }).ssl).toBe('prefer');
    expect(postgresOptions({ ...conf, ssl: 'disable' }).ssl).toBe(false);
  });

  it('시간 제한 사슬: 접속 제한 < 호출 제한(10초) < 화면 요청 제한(12초), 메모리 저장소는 3초 그대로', () => {
    expect(PG_CALL_TIMEOUT_MS).toBe(10_000);
    expect(PG_CONNECT_TIMEOUT_S * 1000).toBeLessThan(PG_CALL_TIMEOUT_MS);
    expect(ACCOUNT_TIMEOUT_MS).toBe(12_000);
    expect(ACCOUNT_TIMEOUT_MS).toBeGreaterThan(PG_CALL_TIMEOUT_MS);
    expect(DB_TIMEOUT_MS).toBe(3000);
  });
});

describe('오류 분류', () => {
  it('연결 오류(끊김 · 접속 시간 넘김 · 거절 · SQLSTATE 08 · 서버 재시작 중)만 한 번 더', () => {
    for (const code of [
      'CONNECTION_CLOSED',
      'CONNECTION_ENDED',
      'CONNECTION_DESTROYED',
      'CONNECT_TIMEOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      '08006',
      '08001',
      '57P01',
      '57P03',
    ])
      expect(classifyPgError(Object.assign(new Error('x'), { code })).retry, code).toBe(true);
    for (const code of ['28P01', '3D000', '42P01', '23505', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ENOTFOUND'])
      expect(classifyPgError(Object.assign(new Error('x'), { code })).retry, code).toBe(false);
  });

  it('Neon 한도 초과(compute 시간 · 전송량 · 용량)는 다시 하지 않는다', () => {
    for (const message of [
      'Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.',
      'Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.',
      'could not extend file because project size limit (512 MB) has been exceeded',
    ]) {
      const info = classifyPgError(Object.assign(new Error(message), { code: 'XX000' }));
      expect(info).toMatchObject({ quota: true, retry: false, code: 'XX000' });
      expect(info.hint).toContain('한도 초과');
    }
    expect(classifyPgError(Object.assign(new Error('disk full'), { code: '53100' })).quota).toBe(true);
  });

  it('힌트: 접속 시간 넘김 · 비밀번호 · DB 이름 · 인증서 · 호스트. 코드 모양이 이상하면 unknown (메시지 · 주소는 담지 않는다)', () => {
    const hint = (code: string) => classifyPgError(Object.assign(new Error('x'), { code })).hint;
    expect(hint('CONNECT_TIMEOUT')).toContain('깨는 중');
    expect(hint('28P01')).toContain('DATABASE_URL');
    expect(hint('3D000')).toContain('DB 이름');
    expect(hint('ERR_TLS_CERT_ALTNAME_INVALID')).toContain('인증서');
    expect(hint('ENOTFOUND')).toContain('호스트');
    const odd = classifyPgError(
      Object.assign(new Error('write ECONNRESET secret.host:5432'), { code: 'bad code!' }),
    );
    expect(odd.code).toBe('unknown');
    expect(JSON.stringify(odd)).not.toContain('secret.host');
    expect(classifyPgError('string error').code).toBe('unknown');
    expect(classifyPgError(null).code).toBe('unknown');
  });
});

/** 가짜 연결: 질의를 적고, 차례대로 정한 결과 · 오류를 돌려준다 */
class FakeClient implements PgClient {
  readonly calls: { text: string; params: readonly (string | number | null)[] }[] = [];
  ended = false;
  constructor(private readonly answers: (PgResult | Error)[] = []) {}

  query(text: string, params: readonly (string | number | null)[]): Promise<PgResult> {
    this.calls.push({ text, params });
    const a = this.answers.shift() ?? { rows: [], count: 0 };
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  }

  end(): Promise<void> {
    this.ended = true;
    return Promise.resolve();
  }
}

function err(code: string, message = 'x'): Error {
  return Object.assign(new Error(message), { code });
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  // bigint 열은 드라이버가 글자로 준다
  return { id: 'a'.repeat(32), sub: 'sub-1', profile: null, created: '1000', updated: '2000', ...over };
}

function rig(answers: (PgResult | Error)[], now = () => 0) {
  const client = new FakeClient(answers);
  const logs: string[] = [];
  const waits: number[] = [];
  const store = new PgAccountStore(client, {
    log: (m) => logs.push(m),
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    now,
  });
  return { client, logs, waits, store };
}

describe('PgAccountStore (가짜 연결)', () => {
  it('표 만들기 · 행 읽기(bigint 글자 → 수) · 질의는 자리표시자($1)로만 값을 넘긴다', async () => {
    const { client, store } = rig([
      { rows: [], count: 0 },
      { rows: [row()], count: 1 },
      { rows: [], count: 0 },
    ]);
    expect(store.kind).toBe('postgres');
    expect(store.callTimeoutMs).toBe(PG_CALL_TIMEOUT_MS);
    await store.init();
    expect(client.calls[0]!.text).toMatch(/CREATE TABLE IF NOT EXISTS decoy_accounts/);
    expect(client.calls[0]!.text).toMatch(/sub text NOT NULL UNIQUE/);
    const sub = "x'; DROP TABLE decoy_accounts; --";
    expect(await store.findBySub(sub)).toEqual({
      id: 'a'.repeat(32),
      sub: 'sub-1',
      profile: null,
      created: 1000,
      updated: 2000,
    });
    expect(client.calls[1]!.text).not.toContain(sub);
    expect(client.calls[1]!.params).toEqual([sub]);
    expect(await store.get('b'.repeat(32))).toBeNull();
  });

  it('만들기: 새 행이면 그 행, 같은 sub가 있으면(ON CONFLICT DO NOTHING) 있는 행을 읽어 돌려준다', async () => {
    const made = rig([{ rows: [row({ sub: 's' })], count: 1 }]);
    expect((await made.store.create('s', 5)).sub).toBe('s');
    expect(made.client.calls[0]!.text).toMatch(/ON CONFLICT \(sub\) DO NOTHING RETURNING/);
    const [id, sub, now] = made.client.calls[0]!.params;
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect([sub, now]).toEqual(['s', 5]);

    const clash = rig([
      { rows: [], count: 0 },
      { rows: [row({ id: 'c'.repeat(32), sub: 's' })], count: 1 },
    ]);
    expect((await clash.store.create('s', 5)).id).toBe('c'.repeat(32));
    // 둘 다 없으면(바로 지워짐) 예외 → 서비스가 503
    const gone = rig([
      { rows: [], count: 0 },
      { rows: [], count: 0 },
    ]);
    await expect(gone.store.create('s', 5)).rejects.toThrow();
  });

  it('기록 쓰기 · 지우기: 바뀐 행 수로 있었는지', async () => {
    const { client, store } = rig([
      { rows: [], count: 1 },
      { rows: [], count: 0 },
      { rows: [], count: 1 },
      { rows: [], count: 0 },
    ]);
    expect(await store.saveProfile('i', 'P', 9)).toBe(true);
    expect(client.calls[0]!.params).toEqual(['i', 'P', 9]);
    expect(await store.saveProfile('i', 'P', 9)).toBe(false);
    expect(await store.delete('i')).toBe(true);
    expect(await store.delete('i')).toBe(false);
    await store.close();
    expect(client.ended).toBe(true);
  });

  it('행 모양이 틀리면 예외 (서비스가 503으로)', async () => {
    for (const bad of [row({ id: 5 }), row({ profile: 3 }), row({ created: 'abc' }), row({ sub: null })]) {
      const { store } = rig([{ rows: [bad], count: 1 }]);
      await expect(store.get('i')).rejects.toThrow();
    }
  });

  it('연결 오류면 0.3초 뒤 한 번 더 — 잠든 compute가 끊은 연결 · 깨는 중 시간 넘김', async () => {
    const { client, store, waits, logs } = rig([err('CONNECTION_CLOSED'), { rows: [row()], count: 1 }]);
    expect((await store.get('i'))?.created).toBe(1000);
    expect(client.calls).toHaveLength(2);
    expect(waits).toEqual([PG_RETRY_WAIT_MS]);
    expect(PG_RETRY_WAIT_MS).toBe(300);
    expect(logs).toEqual(['계정 DB 오류 CONNECTION_CLOSED — 연결 끊김 (한 번 더 시도)']);
  });

  it('한 번 더 해도 안 되면 그 오류를 올린다 (두 번까지만)', async () => {
    const { client, store, logs } = rig([
      err('CONNECT_TIMEOUT'),
      err('CONNECT_TIMEOUT'),
      { rows: [], count: 0 },
    ]);
    await expect(store.get('i')).rejects.toMatchObject({ code: 'CONNECT_TIMEOUT' });
    expect(client.calls).toHaveLength(2);
    expect(logs).toEqual([
      '계정 DB 오류 CONNECT_TIMEOUT — DB가 깨는 중이거나 닿지 않음 (한 번 더 시도)',
      '계정 DB 오류 CONNECT_TIMEOUT — DB가 깨는 중이거나 닿지 않음',
    ]);
  });

  it('한도 초과 · 비밀번호 틀림은 다시 하지 않고 바로 올린다', async () => {
    const quota = rig([err('XX000', 'Your account or project has exceeded the compute time quota.')]);
    await expect(quota.store.saveProfile('i', 'P', 1)).rejects.toThrow();
    expect(quota.client.calls).toHaveLength(1);
    expect(quota.waits).toEqual([]);
    expect(quota.logs).toEqual(['계정 DB 오류 XX000 — DB 무료 한도 초과 (그달 compute 정지)']);
    const auth = rig([err('28P01', 'password authentication failed for user "neondb_owner"')]);
    await expect(auth.store.get('i')).rejects.toThrow();
    expect(auth.client.calls).toHaveLength(1);
    // 로그에 메시지(사용자 이름)를 넣지 않는다
    expect(auth.logs.join('\n')).not.toContain('neondb_owner');
  });

  it('같은 오류 로그는 1분에 한 번', async () => {
    let t = 0;
    const answers = Array.from({ length: 6 }, () => err('28P01'));
    const { store, logs } = rig(answers, () => t);
    await store.get('i').catch(() => undefined);
    t = 1000;
    await store.get('i').catch(() => undefined);
    expect(logs).toHaveLength(1);
    t = PG_LOG_EVERY_MS + 1;
    await store.get('i').catch(() => undefined);
    expect(logs).toHaveLength(2);
  });

  it('표 이름은 정한 모양만 (질의에 끼워 넣으므로)', () => {
    expect(() => new PgAccountStore(new FakeClient(), { table: 'decoy_accounts; DROP' })).toThrow();
    expect(() => new PgAccountStore(new FakeClient(), { table: 'Upper' })).toThrow();
    expect(() => new PgAccountStore(new FakeClient(), { table: 't_1' })).not.toThrow();
  });
});

describe('서비스 시간 제한: 저장소가 밝힌 값', () => {
  /** 절대 끝나지 않는 저장소 (DB가 깨지 않는다) */
  function hangingStore(callTimeoutMs?: number): AccountStore {
    const never = (): Promise<never> => new Promise<never>(() => undefined);
    return {
      kind: 'hang',
      callTimeoutMs,
      init: never,
      findBySub: never,
      get: never,
      create: never,
      saveProfile: never,
      delete: never,
      close: () => Promise.resolve(),
    };
  }

  it('callTimeoutMs가 있으면 그 값, 없으면 3초', async () => {
    const svc = new AccountService({ store: hangingStore(30), timeZone: 'Asia/Seoul', settleMaxMs: 10 });
    const t0 = Date.now();
    await expect(svc.status('a'.repeat(32))).rejects.toMatchObject({ why: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(2000);
    // dbTimeoutMs를 직접 주면 그 값이 이긴다 (시험)
    const forced = new AccountService({
      store: hangingStore(60_000),
      timeZone: 'Asia/Seoul',
      dbTimeoutMs: 20,
      settleMaxMs: 10,
    });
    await expect(forced.status('a'.repeat(32))).rejects.toBeInstanceOf(AccountUnavailable);
  });
});

/** 아무도 듣지 않는 포트 (잠깐 열었다 닫는다) */
async function closedPort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = (srv.address() as AddressInfo).port;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

function rating(matchId: string): MatchRating {
  return {
    matchId,
    role: 'runner',
    outcome: 'win',
    durationSec: 300,
    emblems: [
      { id: 'capture', tier: 2, score: 30 },
      { id: 'rescue', tier: 1, score: 5 },
      { id: 'survive', tier: 3, score: 45 },
      { id: 'evade', tier: 0, score: 1 },
    ],
    stats: { captureSec: 30, escaped: 1 },
  };
}

describe('닿지 않는 DB (닫힌 포트 — 장애 · 한도 초과로 멈춘 compute 흉내)', () => {
  it('실제 드라이버: 접속 거절 → 한 번 더 → 예외, 거듭 실패해도 드라이버가 접속을 미루지 않는다, 로그에 주소가 없다', async () => {
    const port = await closedPort();
    const logs: string[] = [];
    const store = new PgAccountStore(
      createPostgresClient({
        host: '127.0.0.1',
        port,
        user: 'u',
        password: 'never-log-pw',
        database: 'd',
        ssl: 'disable',
      }),
      { log: (m) => logs.push(m) },
    );
    await expect(store.init()).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(logs[0]).toMatch(/^계정 DB 오류 ECONNREFUSED/);
    // 장애 동안 요청마다 바로 실패 (드라이버 기본 backoff면 실패가 쌓일수록 몇 초씩 늦어진다)
    const t0 = Date.now();
    for (let i = 0; i < 6; i += 1) await expect(store.get('a'.repeat(32))).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(6 * (PG_RETRY_WAIT_MS + 400));
    expect(logs.join('\n')).not.toMatch(/127\.0\.0\.1|never-log-pw/);
    await store.close();
  });

  it('서버는 뜨고, 게스트 상태 읽기는 DB 없이 200 · 로그인한 사람은 503(db) · 로그인은 db로 돌아오고 · 적립은 실패 알림으로 끝난다', async () => {
    const port = await closedPort();
    const srv = await startAccountServer({
      env: {
        DECOY_LOGIN: '1',
        GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
        DECOY_SESSION_SECRET: TEST_SECRET,
        DATABASE_URL: `postgres://u:never-log-pw@127.0.0.1:${port}/d?sslmode=disable`,
      },
      service: { retryDelaysMs: [1, 1, 1], sleep: () => Promise.resolve() },
    });
    try {
      expect(srv.system.on).toBe(true);
      expect(srv.system.store?.kind).toBe('postgres');
      expect(srv.system.service?.isReady).toBe(false);
      expect(srv.logs).toContain('계정 저장소 시작 실패 (계정 요청은 503, 판은 그대로)');
      // 로그인하지 않은 사람의 상태 읽기는 DB에 닿지 않는다 (게스트가 페이지를 열 때마다 DB를 깨우지 않는다)
      const guest = await fetch(`${srv.base}/api/account`);
      expect(guest.status).toBe(200);
      expect(await guest.json()).toEqual({ on: true, signedIn: false });
      // 로그인한 사람은 503(db) → 화면은 이번 접속을 게스트(이 기기 기록)로
      const sid = signSession('f'.repeat(32), TEST_SECRET, Date.now());
      const signed = await fetch(`${srv.base}/api/account`, { headers: { cookie: `decoy_sid=${sid}` } });
      expect(signed.status).toBe(503);
      expect(await signed.json()).toEqual({ error: 'db' });
      // 로그인 시도는 db로 끝나 화면이 게스트로 계속한다
      const jar = new CookieJar();
      const cb = await loginFlow(srv, jar, { sub: 'pg-down' });
      expect(cb.status).toBe(303);
      expect(cb.headers.get('location')).toContain('login=db');
      // 판 적립: 실패 알림(credit ok:false)만 — 예외 없이
      const pushed: unknown[] = [];
      const fake = { account: 'f'.repeat(32), send: (m: unknown) => pushed.push(m) };
      srv.system.conns.add(fake as never);
      srv.system.rated('f'.repeat(32), rating('m-down'));
      for (let i = 0; i < 100 && pushed.length === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
      expect(pushed).toEqual([expect.objectContaining({ t: 'credit', matchId: 'm-down', ok: false })]);
      expect(srv.logs.join('\n')).not.toMatch(/never-log-pw|127\.0\.0\.1/);
    } finally {
      await srv.close();
      await srv.system.close();
    }
  });
});
