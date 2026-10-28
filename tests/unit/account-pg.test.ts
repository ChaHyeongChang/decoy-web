// 계정 저장소 PostgreSQL 구현 (server/src/account/pgStore.ts, Neon 무료 싱가포르 · DECISIONS 15절): DB 없이 도는 부분.
// - DATABASE_URL 해석: Neon 접속 문자열 · sslmode → TLS(require도 인증서 확인) · 틀린 모양은 null(값을 담지 않는다)
// - 드라이버 설정: 접속 4초 · 쉬는 연결 60초 · 연결 2개 · 준비 문장 끔 · 디버그 끔 · sslrootcert 인증 기관
// - 오류 분류: 연결 오류만 한 번 더 · 한도 초과는 바로 실패 · 로그에는 코드와 힌트만(1분에 한 번)
// - 가짜 연결로 저장소: 행 모양 · 만들기 충돌 · 다시 하기는 예산(9초) 안에서만 · 시도 제한 4.5초 · 두 시도가 다 시간을 넘기면 DB를
//   쉼(15초부터 두 배) · 서비스가 저장소의 호출 제한(10초)을 쓴다
// - 실제 드라이버: 닫힌 포트(장애) · 오류 없이 접속을 닫는 서버(드라이버의 끝없는 다시 접속을 끊는다) · 답하지 않는 서버
// - 계정 기능 묶음: 닿지 않는 DB면 서버는 뜨고 계정 요청만 503(db), 적립은 실패 알림 — 판은 그대로. 인증서를 확인하지 않는 주소는
//   시작 로그에 경고, 저장소를 만들 수 없으면(sslrootcert 파일) 로그인을 끈 채로
// 실제 PostgreSQL 시험은 account-pg-live.test.ts (DECOY_TEST_DATABASE_URL이 있을 때)
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MatchRating } from '@decoy/shared';
import { ACCOUNT_TIMEOUT_MS } from '../../client/src/account/api';
import {
  PG_ATTEMPT_TIMEOUT_MS,
  PG_CALL_TIMEOUT_MS,
  PG_CONNECT_TIMEOUT_S,
  PG_IDLE_TIMEOUT_S,
  PG_LOG_EVERY_MS,
  PG_PAUSE_MAX_MS,
  PG_PAUSE_MS,
  PG_RETRY_MIN_LEFT_MS,
  PG_RETRY_WAIT_MS,
  PG_RUN_BUDGET_MS,
  PgAccountStore,
  classifyPgError,
  createPostgresClient,
  parseDatabaseUrl,
  postgresOptions,
  type PgClient,
  type PgConfig,
  type PgResult,
} from '../../server/src/account/pgStore';
import { emptyProfile, parseProfile, serializeProfile } from '@decoy/shared/meta';
import { AccountService, AccountUnavailable, DB_TIMEOUT_MS } from '../../server/src/account/service';
import { signSession } from '../../server/src/account/session';
import { AccountConflict, MemoryAccountStore, type AccountStore } from '../../server/src/account/store';
import { DB_TLS_WARNINGS, createAccountSystem } from '../../server/src/account/system';
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
      caFile: null,
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
    // sslrootcert=<절대 경로>: 그 인증 기관으로 확인 (자체 인증 기관을 쓰는 DB). 상대 경로는 받지 않는다, disable은 그대로
    expect(parseDatabaseUrl('postgres://u:p@db.example.com/d?sslrootcert=/etc/secrets/ca.pem')).toMatchObject(
      {
        ssl: 'verify',
        caFile: '/etc/secrets/ca.pem',
      },
    );
    expect(parseDatabaseUrl('postgres://u:p@db.example.com/d?sslrootcert=ca.pem')).toBeNull();
    expect(at('?sslmode=disable&sslrootcert=system')).toBe('disable');
    expect(parseDatabaseUrl('postgres://u:p@db.example.com/d?sslrootcert=system')?.caFile).toBeNull();
  });

  it('% 글자 풀기 · 포트 · DB가 없으면 사용자 이름', () => {
    expect(parseDatabaseUrl('postgres://us%40er:p%2Fw%3A@127.0.0.1:6543/my%20db')).toMatchObject({
      user: 'us@er',
      password: 'p/w:',
      port: 6543,
      database: 'my db',
    });
    expect(parseDatabaseUrl('postgres://owner:pw@db.example.com')?.database).toBe('owner');
    expect(parseDatabaseUrl('postgres://owner:pw@db.example.com/')?.database).toBe('owner');
    // 비밀번호의 @ · : (인코딩 없이)
    expect(parseDatabaseUrl('postgres://u:p@ss:w@db.example.com/d')).toMatchObject({ password: 'p@ss:w' });
    // 비밀번호 없음도 받는다 (내부망 · 시험)
    expect(parseDatabaseUrl('postgres://u@h/d')?.password).toBe('');
  });

  it('틀린 모양은 null: 다른 스킴 · 사용자 없음 · 여러 호스트 · IPv6 숫자 주소(드라이버가 잘못 나눠 서버가 죽는다) · 포트 범위 · 깨진 % · 경로 두 단계 · 빈 글', () => {
    for (const bad of [
      '',
      'not a url',
      'mysql://u:p@h/d',
      'https://u:p@h/d',
      'postgres://h/d',
      'postgres://:p@h/d',
      'postgres://u:p@h1,h2/d',
      'postgres://u:p@h1:5432,h2:5432/d',
      'postgres://u:p@[::1]:5433/d',
      'postgres://u:p@[2001:db8::1]/d',
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
  it('접속 4초 · 쉬는 연결 60초 · 연결 2개 · 준비 문장 끔 · 타입 읽기 끔 · 디버그 끔, TLS 모드 → 드라이버 값', () => {
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
      debug: false,
    });
    // 드라이버가 접속을 미루지 않는다 (다시 하기는 저장소가 한 번)
    expect(typeof o.backoff === 'function' ? o.backoff(8) : o.backoff).toBe(0);
    expect(PG_CONNECT_TIMEOUT_S).toBe(4);
    expect(PG_IDLE_TIMEOUT_S).toBe(60);
    // Neon 무료는 5분 쉬면 잠든다: 쉬는 연결은 그보다 먼저 닫는다
    expect(PG_IDLE_TIMEOUT_S).toBeLessThan(5 * 60);
    expect(postgresOptions({ ...conf, ssl: 'prefer' }).ssl).toBe('prefer');
    expect(postgresOptions({ ...conf, ssl: 'disable' }).ssl).toBe(false);
    // sslrootcert 파일 내용 → 그 인증 기관으로 확인 (인증서 확인을 끄지 않는다)
    expect(postgresOptions(conf, 'PEM').ssl).toEqual({ ca: 'PEM', rejectUnauthorized: true });
  });

  it('sslrootcert 파일을 읽지 못하면 연결 묶음을 만들지 않는다 (예외 — 계정 기능 묶음이 로그인을 끈다)', () => {
    const conf = parseDatabaseUrl('postgres://u:p@db.example.com/d?sslrootcert=/nonexistent/decoy-ca.pem')!;
    expect(() => createPostgresClient(conf)).toThrow();
  });

  it('시간 제한 사슬: 접속 4초 < 시도 4.5초, 시도 + 0.3초 + 시도 ≤ 예산 9초 < 호출 제한 10초 < 화면 요청 제한 12초, 메모리 저장소는 3초 그대로', () => {
    expect(PG_ATTEMPT_TIMEOUT_MS).toBe(4_500);
    expect(PG_RUN_BUDGET_MS).toBe(9_000);
    expect(PG_CALL_TIMEOUT_MS).toBe(10_000);
    expect(PG_CONNECT_TIMEOUT_S * 1000).toBeLessThan(PG_ATTEMPT_TIMEOUT_MS);
    // 첫 시도가 시간을 다 써도 한 번 더 할 시간이 남는다
    expect(PG_RUN_BUDGET_MS - PG_ATTEMPT_TIMEOUT_MS - PG_RETRY_WAIT_MS).toBeGreaterThanOrEqual(
      PG_RETRY_MIN_LEFT_MS,
    );
    // 저장소가 서비스보다 먼저 끝난다 (서비스가 포기한 뒤 늦은 쓰기가 없다)
    expect(PG_RUN_BUDGET_MS).toBeLessThan(PG_CALL_TIMEOUT_MS);
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
      'QUERY_TIMEOUT',
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
      // compute 시간이면 그달 모두 멈추고, 저장 용량이면 쓰기만 실패한다 — 어느 쪽인지는 Neon 사용량에서 본다
      expect(info.hint).toBe('DB 무료 한도 초과 (Neon 사용량 확인)');
    }
    expect(classifyPgError(Object.assign(new Error('disk full'), { code: '53100' })).quota).toBe(true);
  });

  it('힌트: 접속 시간 넘김 · 비밀번호 · DB 이름 · 인증서 · 호스트. 코드 모양이 이상하면 unknown (메시지 · 주소는 담지 않는다)', () => {
    const hint = (code: string) => classifyPgError(Object.assign(new Error('x'), { code })).hint;
    expect(hint('CONNECT_TIMEOUT')).toContain('깨는 중');
    expect(hint('QUERY_TIMEOUT')).toContain('응답 없음');
    expect(classifyPgError(err('QUERY_TIMEOUT')).timeout).toBe(true);
    expect(classifyPgError(err('CONNECT_TIMEOUT')).timeout).toBe(true);
    expect(classifyPgError(err('ECONNRESET')).timeout).toBe(false);
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

/** 가짜 연결이 돌려줄 것: 결과 · 오류, 또는 { took, then }(가짜 시계를 took만큼 옮긴 뒤 then) */
type Answer = PgResult | Error | { took: number; then: PgResult | Error };

/** 가짜 시계 */
class Clock {
  t = 0;
  readonly now = (): number => this.t;
}

/** 가짜 연결: 질의 · 시도 제한을 적고, 차례대로 정한 결과 · 오류를 돌려준다 */
class FakeClient implements PgClient {
  readonly calls: { text: string; params: readonly (string | number | null)[]; timeoutMs: number }[] = [];
  ended = false;
  constructor(
    private readonly answers: Answer[] = [],
    private readonly clock = new Clock(),
  ) {}

  query(text: string, params: readonly (string | number | null)[], timeoutMs: number): Promise<PgResult> {
    this.calls.push({ text, params, timeoutMs });
    let a = this.answers.shift() ?? { rows: [], count: 0 };
    if ('took' in a) {
      this.clock.t += a.took;
      a = a.then;
    }
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
  return {
    id: 'a'.repeat(32),
    sub: 'sub-1',
    profile: null,
    created: '1000',
    updated: '2000',
    rev: '0',
    ...over,
  };
}

function rig(answers: Answer[], clock = new Clock()) {
  const client = new FakeClient(answers, clock);
  const logs: string[] = [];
  const waits: number[] = [];
  const store = new PgAccountStore(client, {
    log: (m) => logs.push(m),
    sleep: (ms) => {
      waits.push(ms);
      clock.t += ms;
      return Promise.resolve();
    },
    now: clock.now,
  });
  return { client, logs, waits, store, clock };
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
    expect(client.calls[0]!.text).toMatch(/rev bigint NOT NULL DEFAULT 0/);
    const sub = "x'; DROP TABLE decoy_accounts; --";
    expect(await store.findBySub(sub)).toEqual({
      id: 'a'.repeat(32),
      sub: 'sub-1',
      profile: null,
      created: 1000,
      updated: 2000,
      rev: 0,
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

  it('조건부 쓰기(읽은 rev): 맞으면 쓰고 rev+1, 안 맞으면 지워졌는지(false) · 앞 시도가 같은 글을 이미 썼는지(true) · 그새 바뀌었는지(AccountConflict)', async () => {
    const ok = rig([{ rows: [], count: 1 }]);
    expect(await ok.store.saveProfile('i', 'P', 9, 3)).toBe(true);
    expect(ok.client.calls[0]!.text).toMatch(
      /SET profile = \$2, updated = \$3, rev = rev \+ 1 WHERE id = \$1 AND rev = \$4/,
    );
    expect(ok.client.calls[0]!.params).toEqual(['i', 'P', 9, 3]);
    const gone = rig([
      { rows: [], count: 0 },
      { rows: [], count: 0 },
    ]);
    expect(await gone.store.saveProfile('i', 'P', 9, 3)).toBe(false);
    const same = rig([
      { rows: [], count: 0 },
      { rows: [{ profile: 'P' }], count: 1 },
    ]);
    expect(await same.store.saveProfile('i', 'P', 9, 3)).toBe(true);
    const moved = rig([
      { rows: [], count: 0 },
      { rows: [{ profile: 'NEWER' }], count: 1 },
    ]);
    await expect(moved.store.saveProfile('i', 'OLD', 9, 3)).rejects.toBeInstanceOf(AccountConflict);
    // rev 없이 쓰면 조건 없이 (시험 · 도구용)
    const plain = rig([{ rows: [], count: 1 }]);
    await plain.store.saveProfile('i', 'P', 9);
    expect(plain.client.calls[0]!.text).not.toContain('AND rev');
  });

  it('메모리 저장소도 같은 조건부 쓰기', async () => {
    const m = new MemoryAccountStore();
    const rec = await m.create('s', 1);
    expect(rec.rev).toBe(0);
    expect(await m.saveProfile(rec.id, 'A', 2, 0)).toBe(true);
    expect((await m.get(rec.id))?.rev).toBe(1);
    // 옛 rev로: 같은 글이면 이미 쓴 것, 다른 글이면 충돌 (새 기록 그대로)
    expect(await m.saveProfile(rec.id, 'A', 3, 0)).toBe(true);
    await expect(m.saveProfile(rec.id, 'OLD', 3, 0)).rejects.toBeInstanceOf(AccountConflict);
    expect((await m.get(rec.id))?.profile).toBe('A');
    expect(await m.saveProfile('0'.repeat(32), 'A', 3, 0)).toBe(false);
  });

  it('행 모양이 틀리면 예외 (서비스가 503으로)', async () => {
    for (const bad of [
      row({ id: 5 }),
      row({ profile: 3 }),
      row({ created: 'abc' }),
      row({ sub: null }),
      row({ rev: undefined }),
    ]) {
      const { store } = rig([{ rows: [bad], count: 1 }]);
      await expect(store.get('i')).rejects.toThrow();
    }
  });

  it('연결 오류면 0.3초 뒤 한 번 더 — 잠든 compute가 끊은 연결 · 깨는 중 시간 넘김. 시도마다 4.5초 제한(예산 남은 만큼)', async () => {
    const { client, store, waits, logs } = rig([err('CONNECTION_CLOSED'), { rows: [row()], count: 1 }]);
    expect((await store.get('i'))?.created).toBe(1000);
    expect(client.calls).toHaveLength(2);
    expect(client.calls.map((c) => c.timeoutMs)).toEqual([PG_ATTEMPT_TIMEOUT_MS, PG_ATTEMPT_TIMEOUT_MS]);
    expect(waits).toEqual([PG_RETRY_WAIT_MS]);
    expect(PG_RETRY_WAIT_MS).toBe(300);
    expect(logs).toEqual(['계정 DB 오류 CONNECTION_CLOSED — 연결 끊김 (한 번 더 시도)']);
  });

  it('한 번 더 해도 안 되면 그 오류를 올린다 (두 번까지만)', async () => {
    const { client, store, logs } = rig([
      err('CONNECTION_CLOSED'),
      err('ECONNRESET'),
      { rows: [], count: 0 },
    ]);
    await expect(store.get('i')).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(client.calls).toHaveLength(2);
    expect(logs).toEqual([
      '계정 DB 오류 CONNECTION_CLOSED — 연결 끊김 (한 번 더 시도)',
      '계정 DB 오류 ECONNRESET — 연결 끊김',
    ]);
  });

  it('첫 시도가 시간을 다 쓰면(깨는 중) 두 번째 시도는 예산의 남은 만큼만, 예산이 1초 넘게 남지 않으면 한 번 더 하지 않는다 — 서비스가 포기한 뒤 옛 쓰기를 다시 보내지 않게', async () => {
    // 첫 시도 4.5초 시간 넘김 → 0.3초 쉬고 → 두 번째 시도는 9 - 4.5 - 0.3 = 4.2초
    const slow = rig([
      { took: PG_ATTEMPT_TIMEOUT_MS, then: err('CONNECT_TIMEOUT') },
      { rows: [], count: 1 },
    ]);
    expect(await slow.store.saveProfile('i', 'P', 1)).toBe(true);
    expect(slow.client.calls.map((c) => c.timeoutMs)).toEqual([
      PG_ATTEMPT_TIMEOUT_MS,
      PG_RUN_BUDGET_MS - PG_ATTEMPT_TIMEOUT_MS - PG_RETRY_WAIT_MS,
    ]);
    // 연결 오류가 늦게(8.5초 뒤) 왔다: 예산이 0.5초뿐이라 다시 보내지 않는다
    const late = rig([
      { took: 8_500, then: err('ETIMEDOUT') },
      { rows: [], count: 1 },
    ]);
    await expect(late.store.saveProfile('i', 'OLD', 1)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(late.client.calls).toHaveLength(1);
    expect(late.waits).toEqual([]);
  });

  it('두 시도가 다 시간을 넘기면 DB를 쉰다: 그동안 바로 실패(PAUSED, 접속 없음) · 15초부터 두 배씩 최대 5분 · 성공하면 처음으로', async () => {
    const clock = new Clock();
    const timeout = (): Answer => ({ took: PG_ATTEMPT_TIMEOUT_MS, then: err('QUERY_TIMEOUT') });
    const { client, store, logs } = rig(
      [timeout(), timeout(), timeout(), timeout(), { rows: [row()], count: 1 }, timeout(), timeout()],
      clock,
    );
    await expect(store.get('i')).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    expect(logs.at(-1)).toBe(
      '계정 DB 오류 QUERY_TIMEOUT — 응답이 없어 15초 동안 DB를 쉰다 (계정 요청은 503, 판은 그대로)',
    );
    expect(client.calls).toHaveLength(2);
    // 쉬는 동안: 접속하지 않고 바로 실패 (로그도 더 남기지 않는다)
    const before = logs.length;
    await expect(store.get('i')).rejects.toMatchObject({ code: 'PAUSED' });
    expect(classifyPgError(err('PAUSED')).retry).toBe(false);
    expect(client.calls).toHaveLength(2);
    expect(logs).toHaveLength(before);
    // 15초 뒤 다시 해 보고 또 안 되면 30초
    clock.t += PG_PAUSE_MS;
    await expect(store.get('i')).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    expect(logs.at(-1)).toContain('30초 동안 DB를 쉰다');
    // 30초 뒤 성공 → 다음 쉬기는 다시 15초부터
    clock.t += 2 * PG_PAUSE_MS;
    expect(await store.get('i')).not.toBeNull();
    await expect(store.get('i')).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    expect(logs.at(-1)).toContain('15초 동안 DB를 쉰다');
    expect(PG_PAUSE_MAX_MS).toBe(300_000);
  });

  it('쉬는 시간은 5분을 넘지 않는다, 시간 넘김이 한 번뿐이면(두 번째는 다른 오류 · 성공) 쉬지 않는다', async () => {
    const clock = new Clock();
    const timeout = (): Answer => ({ took: PG_ATTEMPT_TIMEOUT_MS, then: err('QUERY_TIMEOUT') });
    const answers: Answer[] = [];
    for (let i = 0; i < 7; i += 1) answers.push(timeout(), timeout());
    const { store, logs } = rig(answers, clock);
    for (let i = 0; i < 7; i += 1) {
      await expect(store.get('i')).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
      clock.t += PG_PAUSE_MAX_MS;
    }
    expect(logs.filter((l) => l.includes('DB를 쉰다')).map((l) => /(\d+)초 동안/.exec(l)?.[1])).toEqual([
      '15',
      '30',
      '60',
      '120',
      '240',
      '300',
      '300',
    ]);
    const mixed = rig([timeout(), err('ECONNRESET'), { rows: [], count: 0 }]);
    await expect(mixed.store.get('i')).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(mixed.logs.join('\n')).not.toContain('DB를 쉰다');
    expect(await mixed.store.get('i')).toBeNull();
  });

  it('한도 초과 · 비밀번호 틀림은 다시 하지 않고 바로 올린다', async () => {
    const quota = rig([err('XX000', 'Your account or project has exceeded the compute time quota.')]);
    await expect(quota.store.saveProfile('i', 'P', 1)).rejects.toThrow();
    expect(quota.client.calls).toHaveLength(1);
    expect(quota.waits).toEqual([]);
    expect(quota.logs).toEqual(['계정 DB 오류 XX000 — DB 무료 한도 초과 (Neon 사용량 확인)']);
    const auth = rig([err('28P01', 'password authentication failed for user "neondb_owner"')]);
    await expect(auth.store.get('i')).rejects.toThrow();
    expect(auth.client.calls).toHaveLength(1);
    // 로그에 메시지(사용자 이름)를 넣지 않는다
    expect(auth.logs.join('\n')).not.toContain('neondb_owner');
  });

  it('같은 오류 로그는 1분에 한 번', async () => {
    const clock = new Clock();
    const answers = Array.from({ length: 6 }, () => err('28P01'));
    const { store, logs } = rig(answers, clock);
    await store.get('i').catch(() => undefined);
    clock.t = 1000;
    await store.get('i').catch(() => undefined);
    expect(logs).toHaveLength(1);
    clock.t = PG_LOG_EVERY_MS + 1;
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

  it('시간을 넘겨 버린 옛 쓰기가 다음 일(의상 해금)보다 늦게 도착해도 새 기록을 덮지 않는다 (조건부 쓰기)', async () => {
    /** 첫 기록 쓰기를 붙잡아 두었다가 나중에 놓는 메모리 저장소 */
    class HeldStore extends MemoryAccountStore {
      held: (() => void) | null = null;
      private holdNext = false;
      hold(): void {
        this.holdNext = true;
      }
      override async saveProfile(
        id: string,
        profile: string,
        nowMs: number,
        expectRev?: number,
      ): Promise<boolean> {
        if (this.holdNext) {
          this.holdNext = false;
          await new Promise<void>((resolve) => (this.held = resolve));
        }
        return super.saveProfile(id, profile, nowMs, expectRev);
      }
    }
    const store = new HeldStore();
    const T0 = Date.UTC(2026, 9, 28, 3, 0, 0);
    const svc = new AccountService({
      store,
      timeZone: 'Asia/Seoul',
      now: () => T0,
      dbTimeoutMs: 30,
      settleMaxMs: 30,
    });
    const id = await svc.login('stale');
    const rich = parseProfile(serializeProfile({ ...emptyProfile(T0), coins: 500 }, {}), T0);
    await svc.importDevice(id, {
      choice: 'device',
      device: serializeProfile(rich.status === 'ok' ? rich.profile : emptyProfile(T0), {}),
    });
    // 일 A: 접속 보상 받기 — 쓰기가 붙잡혀 시간을 넘긴다 (503)
    store.hold();
    await expect(svc.claimLogin(id)).rejects.toBeInstanceOf(AccountUnavailable);
    // 일 B: 의상 해금 (줄은 A의 쓰기를 30ms만 기다리고 넘어간다)
    const bought = await svc.costume(id, { action: 'buy', team: 'survivor', id: 'scarf' });
    expect(bought?.result).toBe('ok');
    const afterBuy = (await store.get(id))!;
    // A의 옛 쓰기가 이제 도착: 읽은 rev가 지나서 쓰지 않는다
    store.held?.();
    await new Promise((r) => setTimeout(r, 20));
    const final = (await store.get(id))!;
    expect(final.rev).toBe(afterBuy.rev);
    expect(final.profile).toBe(afterBuy.profile);
    const p = parseProfile(final.profile, T0);
    expect(p.status === 'ok' && p.profile.owned).toContain('scarf');
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

/**
 * 가짜 DB 서버: 'close'는 받자마자 오류 없이 닫는다(드라이버가 시작 중 닫힘을 보고 끝없이 다시 접속하는 경우),
 * 'silent'는 받고 아무 답도 하지 않는다(소리 없이 멈춘 연결)
 */
async function fakePg(mode: 'close' | 'silent') {
  const open = new Set<Socket>();
  let accepted = 0;
  const srv = createServer((sock) => {
    accepted += 1;
    open.add(sock);
    sock.on('close', () => open.delete(sock));
    sock.on('error', () => undefined);
    if (mode === 'close') sock.end();
    // 받은 것은 읽어 버린다 (진짜 서버처럼 — 상대가 닫으면 이쪽도 닫힌다)
    else sock.resume();
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return {
    port: (srv.address() as AddressInfo).port,
    accepted: () => accepted,
    open: () => open.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of open) s.destroy();
        srv.close(() => resolve());
      }),
  };
}

function localConf(port: number): PgConfig {
  return {
    host: '127.0.0.1',
    port,
    user: 'u',
    password: 'never-log-pw',
    database: 'd',
    ssl: 'disable',
    caFile: null,
  };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const store = new PgAccountStore(createPostgresClient(localConf(port)), { log: (m) => logs.push(m) });
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

describe('멈춘 DB (실제 드라이버 · 가짜 서버)', () => {
  it('오류 없이 접속을 닫는 서버: 드라이버의 끝없는 다시 접속을 시도 제한에서 끊고(묶음을 버림), 두 시도가 다 넘기면 DB를 쉬어 접속하지 않는다', async () => {
    const pg = await fakePg('close');
    const logs: string[] = [];
    const store = new PgAccountStore(createPostgresClient(localConf(pg.port)), {
      log: (m) => logs.push(m),
      attemptTimeoutMs: 300,
      budgetMs: 1_700,
      pauseMs: 60_000,
    });
    try {
      const t0 = Date.now();
      await expect(store.get('a'.repeat(32))).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
      expect(Date.now() - t0).toBeLessThan(2_000);
      // 끊기 전에는 드라이버가 쉬지 않고 다시 접속했다
      expect(pg.accepted()).toBeGreaterThan(2);
      // 버린 묶음은 더 접속하지 않는다
      await pause(100);
      const settled = pg.accepted();
      await pause(400);
      expect(pg.accepted() - settled).toBeLessThanOrEqual(1);
      expect(logs.at(-1)).toMatch(/^계정 DB 오류 QUERY_TIMEOUT — 응답이 없어 60초 동안 DB를 쉰다/);
      // 쉬는 동안: 바로 실패, 접속 없음
      const n = pg.accepted();
      await expect(store.get('a'.repeat(32))).rejects.toMatchObject({ code: 'PAUSED' });
      await pause(100);
      expect(pg.accepted()).toBe(n);
    } finally {
      await store.close().catch(() => undefined);
      await pg.close();
    }
  });

  it('답하지 않는 서버: 시도 제한에서 그 연결을 끊는다 (매달린 연결 · 소켓이 남지 않는다)', async () => {
    const pg = await fakePg('silent');
    const store = new PgAccountStore(createPostgresClient(localConf(pg.port)), {
      attemptTimeoutMs: 200,
      budgetMs: 1_600,
    });
    try {
      await expect(store.saveProfile('a'.repeat(32), 'P', 1)).rejects.toMatchObject({
        code: 'QUERY_TIMEOUT',
      });
      expect(pg.accepted()).toBe(2);
      for (let i = 0; i < 50 && pg.open() > 0; i += 1) await pause(20);
      expect(pg.open()).toBe(0);
    } finally {
      await store.close().catch(() => undefined);
      await pg.close();
    }
  });
});

describe('계정 기능 묶음: DB 주소 확인', () => {
  const base = { DECOY_LOGIN: '1', GOOGLE_CLIENT_ID: TEST_CLIENT_ID, DECOY_SESSION_SECRET: TEST_SECRET };

  it('인증서를 확인하지 않는 주소는 시작 로그에 경고 (처리방침 10번과 다르다), Neon 주소(sslmode=require)는 경고 없음', () => {
    const logsFor = (url: string): string[] => {
      const logs: string[] = [];
      const sys = createAccountSystem({
        env: { ...base, DATABASE_URL: url },
        testHooks: true,
        dev: false,
        log: (m) => logs.push(m),
      });
      expect(sys.on).toBe(true);
      void sys.close();
      return logs;
    };
    expect(logsFor('postgres://u:p@db.example.invalid/d')).toContain(DB_TLS_WARNINGS.prefer);
    expect(logsFor('postgres://u:p@db.example.invalid/d?sslmode=disable')).toContain(DB_TLS_WARNINGS.disable);
    const neon = logsFor(NEON).join('\n');
    expect(neon).not.toContain('계정 DB 연결');
    expect(neon).not.toMatch(/npg_S3cretPw|neondb_owner|neon\.tech/);
  });

  it('저장소를 만들 수 없으면(sslrootcert 파일이 없다) 로그인을 끈 채로 뜬다 — 예외 없이, 값 없이', () => {
    const logs: string[] = [];
    const sys = createAccountSystem({
      env: {
        ...base,
        DATABASE_URL: 'postgres://u:secret-pw@db.example.invalid/d?sslrootcert=/nonexistent/ca.pem',
      },
      testHooks: true,
      dev: false,
      log: (m) => logs.push(m),
    });
    expect(sys.on).toBe(false);
    expect(sys.service).toBeNull();
    expect(sys.summary).toBe('계정 로그인: 꺼짐 (DATABASE_URL 틀림)');
    expect(logs).toContain('계정 저장소를 만들지 못함 (DATABASE_URL 확인)');
    expect(logs.join('\n')).not.toMatch(/secret-pw|nonexistent|example\.invalid/);
  });

  it('sslrootcert 파일이 있으면 그 인증 기관으로 만든다 (Render 비밀 파일 등)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decoy-ca-'));
    try {
      const file = join(dir, 'ca.pem');
      writeFileSync(file, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
      const sys = createAccountSystem({
        env: { ...base, DATABASE_URL: `postgres://u:p@db.example.invalid/d?sslrootcert=${file}` },
        testHooks: true,
        dev: false,
        log: () => undefined,
      });
      expect(sys.on).toBe(true);
      expect(sys.config.enabled && sys.config.store).toEqual({ kind: 'postgres', ssl: 'verify' });
      void sys.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IPv6 숫자 주소는 설정에서 거절한다 (드라이버가 잘못 나눠 서버를 죽이지 않게) — 로그인 꺼짐, 서버는 뜬다', () => {
    const sys = createAccountSystem({
      env: { ...base, DATABASE_URL: 'postgres://u:p@[2001:db8::1]:5432/d?sslmode=require' },
      testHooks: true,
      dev: false,
      log: () => undefined,
    });
    expect(sys.on).toBe(false);
    expect(sys.summary).toBe('계정 로그인: 꺼짐 (DATABASE_URL 틀림)');
  });
});
