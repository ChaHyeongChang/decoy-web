// 계정 저장소의 PostgreSQL 구현 (선택형 구글 로그인, docs/ACCOUNT_PLAN.md · DECISIONS 15절). 배포는 Neon 무료(싱가포르)에서 시작하고,
// 표준 Postgres 접속만 쓰므로 Render Postgres 등으로 옮길 때 DATABASE_URL만 바꾼다(docs/LOGIN_GUIDE.md '유료 DB로 옮기기').
// - 표는 서버가 시작할 때 만든다(CREATE TABLE IF NOT EXISTS) — 사람이 표를 만들 일이 없다
// - Neon 무료는 5분 쉬면 compute가 잠들고 다음 첫 요청에서 깬다. 시도 하나(접속 + 질의)는 4.5초(접속은 4초), 연결 오류면 0.3초 뒤
//   한 번 더 — 둘을 합쳐 9초 예산 안에서만(서비스의 호출 제한 10초보다 먼저 끝나 늦은 쓰기가 다음 일을 덮지 않는다). 시도 시간이 넘으면
//   그 연결 묶음을 버리고 새로 만든다(멈춘 연결 · 드라이버의 끝없는 다시 접속을 끊는다). 두 시도가 다 시간을 넘기면 15초부터 늘려 가며
//   DB를 쉰다(그동안 계정 요청은 바로 503). 쉬는 연결은 60초 뒤 닫는다(연결을 붙잡아 compute를 깨워 두지 않게)
// - 무료 한도를 넘으면(compute 시간 · 저장 용량) 오류를 그대로 올린다(다시 시도하지 않는다) → 계정 요청 503, 화면은 게스트로, 판은 그대로
// - 로그에는 오류 코드와 짧은 힌트만 (DB 주소 · 비밀번호 · 호스트를 찍지 않는다)
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { AccountConflict, newAccountId, type AccountRecord, type AccountStore } from './store';

/** 접속 제한 (초, 드라이버 connect_timeout) — 잠든 compute가 깨는 시간 */
export const PG_CONNECT_TIMEOUT_S = 4;
/** 시도 하나(접속 + 질의)의 제한 (ms). 넘으면 연결 묶음을 버리고 새로 만든다 */
export const PG_ATTEMPT_TIMEOUT_MS = 4_500;
/** 저장소 호출 하나(시도 + 한 번 더)의 예산 (ms). 서비스의 호출 제한보다 짧아 저장소가 먼저 끝난다 */
export const PG_RUN_BUDGET_MS = 9_000;
/** 한 번 더 하려면 예산이 이만큼은 남아야 한다 (ms) */
export const PG_RETRY_MIN_LEFT_MS = 1_000;
/** 저장소 호출 하나의 제한 (ms, AccountService가 잰다). 예산 9초 + 여유 */
export const PG_CALL_TIMEOUT_MS = 10_000;
/** 연결 오류 뒤 한 번 더 하기 전 기다림 (ms) */
export const PG_RETRY_WAIT_MS = 300;
/** 두 시도가 다 시간을 넘긴 뒤 DB를 쉬는 시간: 15초부터 두 배씩, 최대 5분. 성공하면 처음으로 */
export const PG_PAUSE_MS = 15_000;
export const PG_PAUSE_MAX_MS = 300_000;
/** 쉬는 연결을 닫는 시간 (초) */
export const PG_IDLE_TIMEOUT_S = 60;
/** 연결 수 상한 (서버 인스턴스 1개, 계정 요청은 드물다) */
export const PG_MAX_CONNECTIONS = 2;
/** 연결 하나를 쓰는 최대 시간 (초) */
export const PG_MAX_LIFETIME_S = 30 * 60;
/** 같은 오류 코드 로그는 이 간격에 한 번 (ms) */
export const PG_LOG_EVERY_MS = 60_000;
/** 기본 표 이름 */
export const PG_TABLE = 'decoy_accounts';

/**
 * TLS: disable 암호화 없음 · prefer TLS를 먼저 시도하고 서버가 거절하면 암호화 없이(인증서 확인 없음 — libpq 기본과 같다, Render
 * 내부 주소처럼 sslmode가 없는 주소) · verify TLS + 인증서 확인(require · verify-ca · verify-full — libpq의 require보다 엄격하다.
 * Neon은 공인 인증서라 된다. 자체 인증 기관을 쓰는 DB는 sslrootcert=<인증서 파일 절대 경로>)
 */
export type PgSsl = 'disable' | 'prefer' | 'verify';

/** 접속 값 (DATABASE_URL을 풀어 둔 것). 로그 · 오류에 넣지 않는다 */
export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: PgSsl;
  /** 인증서 확인에 쓸 인증 기관 파일(절대 경로, sslrootcert). 없으면 공인 인증서(Node 기본) */
  caFile: string | null;
}

const SSL_MODES: Readonly<Record<string, PgSsl>> = {
  disable: 'disable',
  allow: 'prefer',
  prefer: 'prefer',
  require: 'verify',
  'verify-ca': 'verify',
  'verify-full': 'verify',
};

/**
 * DATABASE_URL → 접속 값 (모양이 틀리면 null — 왜 틀렸는지도 값을 담지 않는다).
 * postgres:// · postgresql://, 호스트 이름 하나(여러 호스트 · IPv6 숫자 주소는 받지 않는다 — 드라이버가 ':'로 다시 나눠 서버가
 * 죽는다), 사용자 필수. 데이터베이스가 없으면 사용자 이름(libpq와 같다). sslmode · sslrootcert 말고 다른 값(channel_binding ·
 * options 등)은 무시한다 — channel_binding은 드라이버가 지원하지 않고, 대신 인증서를 확인한다
 */
export function parseDatabaseUrl(raw: string): PgConfig | null {
  const text = raw.trim();
  if (!/^postgres(ql)?:\/\//i.test(text)) return null;
  // 여러 호스트(a,b)는 URL로 풀리지 않거나 뜻이 달라진다
  const authority = text.replace(/^postgres(ql)?:\/\//i, '').split(/[/?#]/)[0] ?? '';
  if (authority.slice(authority.lastIndexOf('@') + 1).includes(',')) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  try {
    const host = url.hostname;
    // IPv6 숫자 주소([::1])는 드라이버가 ':'로 다시 나눠 잘못된 포트로 접속하다 서버를 죽인다
    if (host === '' || host.includes(':') || host.startsWith('[')) return null;
    const port = url.port === '' ? 5432 : Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const user = decodeURIComponent(url.username);
    if (user === '') return null;
    const password = decodeURIComponent(url.password);
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (path.includes('/')) return null;
    const database = path === '' ? user : path;
    let ssl: PgSsl = 'prefer';
    const mode = url.searchParams.get('sslmode');
    if (mode !== null) {
      const m = SSL_MODES[mode];
      if (!m) return null;
      ssl = m;
    }
    // sslrootcert: 'system'이면 공인 인증서로(libpq 16), 파일 절대 경로면 그 인증 기관으로 확인. disable은 그대로 암호화 없음
    let caFile: string | null = null;
    const root = url.searchParams.get('sslrootcert');
    if (root !== null && root !== '') {
      if (root !== 'system') {
        if (!root.startsWith('/')) return null;
        caFile = root;
      }
      if (ssl !== 'disable') ssl = 'verify';
    }
    return { host, port, user, password, database, ssl, caFile };
  } catch {
    // decodeURIComponent: 깨진 % 글자
    return null;
  }
}

/** 질의 결과 (행 · 바뀐 행 수) */
export interface PgResult {
  rows: Record<string, unknown>[];
  count: number;
}

/** 질의 하나를 보내는 연결 묶음 (드라이버를 감싼다 — 단위 시험은 가짜로 바꿔 끼운다) */
export interface PgClient {
  /** timeoutMs 안에 끝나지 않으면 code 'QUERY_TIMEOUT'으로 실패하고, 그 연결 묶음은 버린다 */
  query(text: string, params: readonly (string | number | null)[], timeoutMs: number): Promise<PgResult>;
  end(): Promise<void>;
}

/**
 * postgres.js 접속 설정 (값은 conf 그대로 — 환경 변수 PG*로 빈 곳이 채워지지 않게 드라이버가 읽는 값을 되도록 모두 적는다).
 * ca: sslrootcert 파일 내용
 */
export function postgresOptions(
  conf: PgConfig,
  ca: string | null = null,
): postgres.Options<Record<string, postgres.PostgresType>> {
  return {
    host: conf.host,
    port: conf.port,
    user: conf.user,
    pass: conf.password,
    database: conf.database,
    // 'verify-full' · 객체: 드라이버가 인증서 확인을 끄지 않는다(Node 기본 — 인증 기관 · 호스트 이름 확인, SNI는 호스트 이름).
    // 'prefer'는 확인하지 않는다
    ssl:
      conf.ssl === 'disable'
        ? false
        : conf.ssl === 'prefer'
          ? 'prefer'
          : ca !== null
            ? { ca, rejectUnauthorized: true }
            : 'verify-full',
    max: PG_MAX_CONNECTIONS,
    idle_timeout: PG_IDLE_TIMEOUT_S,
    connect_timeout: PG_CONNECT_TIMEOUT_S,
    max_lifetime: PG_MAX_LIFETIME_S,
    // 접속 실패 뒤 드라이버가 다음 접속을 미루는 시간(기본은 실패할수록 늘어 10~20초까지) 없이: 다시 하기는 저장소가 한 번만 한다.
    // 장애 · 한도 초과 동안 계정 요청이 제한 시간까지 매달리지 않고 바로 503이 되게
    backoff: () => 0,
    keep_alive: 60,
    // 질의 · 값을 오류에 싣지 않는다 (PGDEBUG가 있어도)
    debug: false,
    // Neon 풀러(PgBouncer)에서도 되게 이름 붙은 준비 문장을 쓰지 않는다. 배열 타입 읽기 질의도 건너뛴다(접속이 한 번 줄어든다)
    prepare: false,
    fetch_types: false,
    onnotice: () => undefined,
    connection: { application_name: 'decoy' },
  };
}

const noop = (): void => undefined;

/**
 * postgres.js 연결 묶음. 접속은 첫 질의 때 한다. 질의가 timeoutMs 안에 끝나지 않으면 그 묶음을 버리고(end timeout 0 — 접속 중 ·
 * 질의 중 연결을 모두 끊는다) 다음 질의부터 새 묶음을 쓴다: 소리 없이 죽은 연결에 질의가 매달리거나, 서버가 오류 없이 접속을 닫을 때
 * 드라이버가 끝없이 다시 접속하는 것(접속 제한도 매번 새로 잰다)을 끊는다. 버린 질의의 늦은 실패는 삼킨다.
 * sslrootcert 파일을 읽지 못하면 예외 (만드는 쪽이 로그인을 끈다)
 */
export function createPostgresClient(conf: PgConfig): PgClient {
  const ca = conf.caFile !== null ? readFileSync(conf.caFile, 'utf8') : null;
  const make = (): postgres.Sql => postgres(postgresOptions(conf, ca));
  let sql = make();
  let closed = false;
  const drop = (old: postgres.Sql): void => {
    if (sql === old && !closed) sql = make();
    old.end({ timeout: 0 }).catch(noop);
  };
  return {
    async query(text, params, timeoutMs) {
      const cur = sql;
      const run = cur.unsafe(text, [...params]).then((res) => ({
        rows: [...res] as Record<string, unknown>[],
        count: res.count,
      }));
      // 시간을 넘겨 버린 질의가 나중에 실패해도 처리되지 않은 거부가 되지 않게
      run.catch(noop);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          drop(cur);
          reject(Object.assign(new Error('계정 DB: 응답 없음'), { code: 'QUERY_TIMEOUT' }));
        }, timeoutMs);
      });
      try {
        return await Promise.race([run, expired]);
      } finally {
        clearTimeout(timer);
      }
    },
    async end() {
      closed = true;
      await sql.end({ timeout: 2 });
    },
  };
}

/** 오류 분류 (로그 · 다시 시도). code는 SQLSTATE 5자리 · 연결 오류 이름(대문자)만 — 메시지 · 주소는 담지 않는다 */
export interface PgErrorInfo {
  code: string;
  /** 연결 오류라 한 번 더 해 볼 만하다 (잠든 compute가 끊은 연결 · 접속 시간 넘김) */
  retry: boolean;
  /** DB 업체 한도 초과 (Neon: compute 시간 · 전송량 · 저장 용량) — 다시 해도 소용없다 */
  quota: boolean;
  /** 시간 넘김 (접속 · 시도) — 두 시도가 다 이것이면 DB를 잠시 쉰다 */
  timeout: boolean;
  hint: string;
}

const RETRY_CODES = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECT_TIMEOUT',
  'QUERY_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  // 서버가 닫는 중 · 시작하는 중 · 연결이 꽉 참
  '57P01',
  '57P02',
  '57P03',
  '53300',
]);

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const TIMEOUT_CODES = new Set(['CONNECT_TIMEOUT', 'QUERY_TIMEOUT']);

const HINTS: Readonly<Record<string, string>> = {
  CONNECT_TIMEOUT: 'DB가 깨는 중이거나 닿지 않음',
  QUERY_TIMEOUT: 'DB 응답 없음 (연결을 새로 만든다)',
  '28P01': 'DB 사용자 · 비밀번호가 틀림 (DATABASE_URL 확인)',
  '28000': 'DB 사용자 · 비밀번호가 틀림 (DATABASE_URL 확인)',
  '3D000': 'DB 이름이 틀림',
  ENOTFOUND: 'DB 주소(호스트)를 찾을 수 없음',
};

/** 한도 초과 문구 (Neon: "…exceeded the compute time quota…", "…data transfer quota…", "…project size limit…") */
const QUOTA_TEXT = /quota|size limit/i;

export function classifyPgError(err: unknown): PgErrorInfo {
  const o = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
  const rawCode = typeof o.code === 'string' ? o.code : '';
  const code = /^[A-Z0-9_]{1,40}$/.test(rawCode) ? rawCode : 'unknown';
  const message = typeof o.message === 'string' ? o.message : '';
  if (QUOTA_TEXT.test(message) || code === '53100')
    return { code, retry: false, quota: true, timeout: false, hint: 'DB 무료 한도 초과 (Neon 사용량 확인)' };
  // 연결 오류는 SQLSTATE 08xxx도
  const retry = RETRY_CODES.has(code) || code.startsWith('08');
  const hint = TLS_CODES.has(code)
    ? 'DB 인증서 확인 실패 (sslmode 확인)'
    : (HINTS[code] ?? (retry ? '연결 끊김' : ''));
  return { code, retry, quota: false, timeout: TIMEOUT_CODES.has(code), hint };
}

export interface PgStoreOptions {
  /** 표 이름 (시험이 따로 쓴다). 기본 decoy_accounts */
  table?: string;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 시험: 시도 제한 · 예산 · 쉬는 시간 (기본 PG_ATTEMPT_TIMEOUT_MS · PG_RUN_BUDGET_MS · PG_PAUSE_MS) */
  attemptTimeoutMs?: number;
  budgetMs?: number;
  pauseMs?: number;
}

const TABLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(v: unknown): number {
  // bigint 열은 드라이버가 글자로 준다
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error('계정 DB: 숫자 열이 숫자가 아님');
  return n;
}

function toRecord(row: Record<string, unknown> | undefined): AccountRecord | null {
  if (!row) return null;
  const { id, sub, profile } = row;
  if (typeof id !== 'string' || typeof sub !== 'string') throw new Error('계정 DB: 행 모양이 틀림');
  if (profile !== null && typeof profile !== 'string') throw new Error('계정 DB: 행 모양이 틀림');
  return {
    id,
    sub,
    profile,
    created: toNumber(row.created),
    updated: toNumber(row.updated),
    rev: toNumber(row.rev),
  };
}

/**
 * PostgreSQL 계정 저장소. 같은 계정의 읽기-고치기-쓰기 순서는 AccountService가 줄 세운다 — 여기는 행 하나씩만.
 * 모든 쓰기는 다시 해도 같은 결과가 되게 짠다(연결 오류 뒤 한 번 더 할 때: 만들기는 sub 충돌이면 있는 행을 읽고, 기록 쓰기는 같은 값).
 * 한 번 더는 예산(9초) 안에서만 한다 — 서비스가 포기한 뒤(10초) 옛 쓰기를 다시 보내 그 사이의 새 기록을 덮지 않게
 */
export class PgAccountStore implements AccountStore {
  readonly kind = 'postgres';
  readonly callTimeoutMs = PG_CALL_TIMEOUT_MS;
  private readonly table: string;
  private readonly log: (msg: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly loggedAt = new Map<string, number>();
  private readonly attemptTimeoutMs: number;
  private readonly budgetMs: number;
  private readonly pauseMs: number;
  /** 이 시각까지 DB를 쉰다 (계정 요청은 바로 실패) */
  private pausedUntil = Number.NEGATIVE_INFINITY;
  /** 잇달아 쉰 횟수 (쉬는 시간을 두 배씩) */
  private pauses = 0;

  constructor(
    private readonly client: PgClient,
    opts: PgStoreOptions = {},
  ) {
    const table = opts.table ?? PG_TABLE;
    if (!TABLE_NAME.test(table)) throw new Error('계정 DB: 표 이름이 틀림');
    this.table = table;
    this.log = opts.log ?? (() => undefined);
    this.sleep = opts.sleep ?? delay;
    this.now = opts.now ?? Date.now;
    this.attemptTimeoutMs = opts.attemptTimeoutMs ?? PG_ATTEMPT_TIMEOUT_MS;
    this.budgetMs = opts.budgetMs ?? PG_RUN_BUDGET_MS;
    this.pauseMs = opts.pauseMs ?? PG_PAUSE_MS;
  }

  async init(): Promise<void> {
    await this.run(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
        id text PRIMARY KEY,
        sub text NOT NULL UNIQUE,
        profile text,
        created bigint NOT NULL,
        updated bigint NOT NULL,
        rev bigint NOT NULL DEFAULT 0
      )`,
      [],
    );
  }

  async findBySub(sub: string): Promise<AccountRecord | null> {
    const r = await this.run(
      `SELECT id, sub, profile, created, updated, rev FROM ${this.table} WHERE sub = $1`,
      [sub],
    );
    return toRecord(r.rows[0]);
  }

  async get(id: string): Promise<AccountRecord | null> {
    const r = await this.run(
      `SELECT id, sub, profile, created, updated, rev FROM ${this.table} WHERE id = $1`,
      [id],
    );
    return toRecord(r.rows[0]);
  }

  async create(sub: string, nowMs: number): Promise<AccountRecord> {
    const r = await this.run(
      `INSERT INTO ${this.table} (id, sub, profile, created, updated) VALUES ($1, $2, NULL, $3, $3)
       ON CONFLICT (sub) DO NOTHING RETURNING id, sub, profile, created, updated, rev`,
      [newAccountId(), sub, nowMs],
    );
    const made = toRecord(r.rows[0]);
    if (made) return made;
    // 같은 sub가 이미 있다 (동시에 두 번 첫 로그인 · 다시 한 번 한 만들기)
    const have = await this.findBySub(sub);
    if (!have) throw new Error('계정 DB: 만든 계정을 찾지 못함');
    return have;
  }

  async saveProfile(id: string, profile: string, nowMs: number, expectRev?: number): Promise<boolean> {
    if (expectRev === undefined) {
      const r = await this.run(
        `UPDATE ${this.table} SET profile = $2, updated = $3, rev = rev + 1 WHERE id = $1`,
        [id, profile, nowMs],
      );
      return r.count > 0;
    }
    // 조건부: 읽은 rev일 때만. 안 맞으면 지워졌는지 · 앞 시도가 이미 같은 글을 썼는지 · 그새 바뀌었는지
    const r = await this.run(
      `UPDATE ${this.table} SET profile = $2, updated = $3, rev = rev + 1 WHERE id = $1 AND rev = $4`,
      [id, profile, nowMs, expectRev],
    );
    if (r.count > 0) return true;
    const now = await this.run(`SELECT profile FROM ${this.table} WHERE id = $1`, [id]);
    const cur = now.rows[0];
    if (!cur) return false;
    if (cur.profile === profile) return true;
    throw new AccountConflict();
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.run(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
    return r.count > 0;
  }

  close(): Promise<void> {
    return this.client.end();
  }

  /**
   * 질의 하나: 시도마다 4.5초 제한, 연결 오류(잠든 compute가 끊은 연결 · 깨는 중 시간 넘김)면 0.3초 뒤 한 번 더 — 예산 9초가 1초 넘게
   * 남을 때만. 한도 초과 · 비밀번호 틀림 등은 바로 올린다. 두 시도가 다 시간을 넘기면 DB를 잠시 쉰다(PAUSED)
   */
  private async run(text: string, params: readonly (string | number | null)[]): Promise<PgResult> {
    const start = this.now();
    if (start < this.pausedUntil) throw Object.assign(new Error('계정 DB: 잠시 쉼'), { code: 'PAUSED' });
    const deadline = start + this.budgetMs;
    let timeouts = 0;
    for (let attempt = 0; ; attempt += 1) {
      const left = Math.max(1, deadline - this.now());
      try {
        const res = await this.client.query(text, params, Math.min(this.attemptTimeoutMs, left));
        this.pauses = 0;
        return res;
      } catch (err) {
        const info = classifyPgError(err);
        if (info.timeout) timeouts += 1;
        const again =
          attempt === 0 && info.retry && deadline - this.now() - PG_RETRY_WAIT_MS >= PG_RETRY_MIN_LEFT_MS;
        if (again) this.report(info, true);
        else if (info.timeout && timeouts === attempt + 1) this.pause(info);
        else this.report(info, false);
        if (!again) throw err;
      }
      await this.sleep(PG_RETRY_WAIT_MS);
    }
  }

  /** 모든 시도가 시간을 넘겼다: 15초 · 30초 · 1분 … 최대 5분 동안 DB를 쉰다 (같은 일이 계속되면 접속 시도를 줄인다) */
  private pause(info: PgErrorInfo): void {
    const ms = Math.min(this.pauseMs * 2 ** this.pauses, PG_PAUSE_MAX_MS);
    this.pauses += 1;
    this.pausedUntil = this.now() + ms;
    this.log(
      `계정 DB 오류 ${info.code} — 응답이 없어 ${Math.round(ms / 1000)}초 동안 DB를 쉰다 (계정 요청은 503, 판은 그대로)`,
    );
  }

  /** 오류 로그: 코드와 힌트만, 같은 코드는 1분에 한 번 */
  private report(info: PgErrorInfo, retrying: boolean): void {
    const key = `${info.code}:${retrying ? 'r' : ''}`;
    const now = this.now();
    const last = this.loggedAt.get(key);
    if (last !== undefined && now - last < PG_LOG_EVERY_MS) return;
    this.loggedAt.set(key, now);
    const hint = info.hint === '' ? '' : ` — ${info.hint}`;
    this.log(`계정 DB 오류 ${info.code}${hint}${retrying ? ' (한 번 더 시도)' : ''}`);
  }
}
