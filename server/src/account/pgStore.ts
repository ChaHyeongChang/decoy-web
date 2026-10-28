// 계정 저장소의 PostgreSQL 구현 (선택형 구글 로그인, docs/ACCOUNT_PLAN.md · DECISIONS 15절). 배포는 Neon 무료(싱가포르)에서 시작하고,
// 표준 Postgres 접속만 쓰므로 Render Postgres 등으로 옮길 때 DATABASE_URL만 바꾼다(docs/LOGIN_GUIDE.md '유료 DB로 옮기기').
// - 표는 서버가 시작할 때 만든다(CREATE TABLE IF NOT EXISTS) — 사람이 표를 만들 일이 없다
// - Neon 무료는 5분 쉬면 compute가 잠들고 다음 첫 요청에서 깬다: 접속 제한 6초 · 호출 하나 10초(서비스가 잰다) · 연결 오류면
//   0.3초 뒤 한 번 더. 쉬는 연결은 60초 뒤 닫는다(연결을 붙잡아 compute를 깨워 두지 않게)
// - 무료 한도를 넘어 그달 compute가 멈추면 오류를 그대로 올린다(다시 시도하지 않는다) → 계정 요청 503, 화면은 게스트로, 판은 그대로
// - 로그에는 오류 코드와 짧은 힌트만 (DB 주소 · 비밀번호 · 호스트를 찍지 않는다)
import postgres from 'postgres';
import { newAccountId, type AccountRecord, type AccountStore } from './store';

/** 접속 제한 (초, 드라이버 connect_timeout) — 잠든 compute가 깨는 시간을 넉넉히 */
export const PG_CONNECT_TIMEOUT_S = 6;
/** 저장소 호출 하나의 제한 (ms, AccountService가 잰다). 접속 6초 + 다시 한 번을 담는다 */
export const PG_CALL_TIMEOUT_MS = 10_000;
/** 연결 오류 뒤 한 번 더 하기 전 기다림 (ms) */
export const PG_RETRY_WAIT_MS = 300;
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
 * Neon은 공인 인증서라 된다)
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
 * postgres:// · postgresql://, 호스트 하나(여러 호스트는 받지 않는다), 사용자 필수. 데이터베이스가 없으면 사용자 이름(libpq와 같다).
 * sslmode 말고 다른 값(channel_binding · options 등)은 무시한다 — channel_binding은 드라이버가 지원하지 않고, 대신 인증서를 확인한다
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
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    if (host === '') return null;
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
    // libpq 16: sslrootcert=system이면 공인 인증서로 확인
    if (url.searchParams.get('sslrootcert') === 'system') ssl = 'verify';
    return { host, port, user, password, database, ssl };
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
  query(text: string, params: readonly (string | number | null)[]): Promise<PgResult>;
  end(): Promise<void>;
}

/** postgres.js 접속 설정 (값은 conf 그대로 — 환경 변수 PG*로 빈 곳을 채우지 않게 모두 적는다) */
export function postgresOptions(conf: PgConfig): postgres.Options<Record<string, postgres.PostgresType>> {
  return {
    host: conf.host,
    port: conf.port,
    user: conf.user,
    pass: conf.password,
    database: conf.database,
    // 'verify-full': 드라이버가 인증서 확인을 끄지 않는다(Node 기본 — 공인 인증서 · 호스트 이름 확인). 'prefer'는 확인하지 않는다
    ssl: conf.ssl === 'disable' ? false : conf.ssl === 'prefer' ? 'prefer' : 'verify-full',
    max: PG_MAX_CONNECTIONS,
    idle_timeout: PG_IDLE_TIMEOUT_S,
    connect_timeout: PG_CONNECT_TIMEOUT_S,
    max_lifetime: PG_MAX_LIFETIME_S,
    // 접속 실패 뒤 드라이버가 다음 접속을 미루는 시간(기본은 실패할수록 늘어 10~20초까지) 없이: 다시 하기는 저장소가 한 번만 한다.
    // 장애 · 한도 초과 동안 계정 요청이 제한 시간까지 매달리지 않고 바로 503이 되게
    backoff: () => 0,
    // Neon 풀러(PgBouncer)에서도 되게 이름 붙은 준비 문장을 쓰지 않는다. 배열 타입 읽기 질의도 건너뛴다(접속이 한 번 줄어든다)
    prepare: false,
    fetch_types: false,
    onnotice: () => undefined,
    connection: { application_name: 'decoy' },
  };
}

/** postgres.js 연결 묶음. 접속은 첫 질의 때 한다 */
export function createPostgresClient(conf: PgConfig): PgClient {
  const sql = postgres(postgresOptions(conf));
  return {
    async query(text, params) {
      const res = await sql.unsafe(text, [...params]);
      return { rows: [...res] as Record<string, unknown>[], count: res.count };
    },
    end: () => sql.end({ timeout: 2 }),
  };
}

/** 오류 분류 (로그 · 다시 시도). code는 SQLSTATE 5자리 · 연결 오류 이름(대문자)만 — 메시지 · 주소는 담지 않는다 */
export interface PgErrorInfo {
  code: string;
  /** 연결 오류라 한 번 더 해 볼 만하다 (잠든 compute가 끊은 연결 · 접속 시간 넘김) */
  retry: boolean;
  /** DB 업체 한도 초과 (Neon: compute 시간 · 전송량 · 저장 용량) — 다시 해도 소용없다 */
  quota: boolean;
  hint: string;
}

const RETRY_CODES = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECT_TIMEOUT',
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

const HINTS: Readonly<Record<string, string>> = {
  CONNECT_TIMEOUT: 'DB가 깨는 중이거나 닿지 않음',
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
    return { code, retry: false, quota: true, hint: 'DB 무료 한도 초과 (그달 compute 정지)' };
  // 연결 오류는 SQLSTATE 08xxx도
  const retry = RETRY_CODES.has(code) || code.startsWith('08');
  const hint = TLS_CODES.has(code)
    ? 'DB 인증서 확인 실패 (sslmode 확인)'
    : (HINTS[code] ?? (retry ? '연결 끊김' : ''));
  return { code, retry, quota: false, hint };
}

export interface PgStoreOptions {
  /** 표 이름 (시험이 따로 쓴다). 기본 decoy_accounts */
  table?: string;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
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
  return { id, sub, profile, created: toNumber(row.created), updated: toNumber(row.updated) };
}

/**
 * PostgreSQL 계정 저장소. 같은 계정의 읽기-고치기-쓰기 순서는 AccountService가 줄 세운다 — 여기는 행 하나씩만.
 * 모든 쓰기는 다시 해도 같은 결과가 되게 짠다(연결 오류 뒤 한 번 더 할 때: 만들기는 sub 충돌이면 있는 행을 읽고, 기록 쓰기는 같은 값)
 */
export class PgAccountStore implements AccountStore {
  readonly kind = 'postgres';
  readonly callTimeoutMs = PG_CALL_TIMEOUT_MS;
  private readonly table: string;
  private readonly log: (msg: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly loggedAt = new Map<string, number>();

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
  }

  async init(): Promise<void> {
    await this.run(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
        id text PRIMARY KEY,
        sub text NOT NULL UNIQUE,
        profile text,
        created bigint NOT NULL,
        updated bigint NOT NULL
      )`,
      [],
    );
  }

  async findBySub(sub: string): Promise<AccountRecord | null> {
    const r = await this.run(`SELECT id, sub, profile, created, updated FROM ${this.table} WHERE sub = $1`, [
      sub,
    ]);
    return toRecord(r.rows[0]);
  }

  async get(id: string): Promise<AccountRecord | null> {
    const r = await this.run(`SELECT id, sub, profile, created, updated FROM ${this.table} WHERE id = $1`, [
      id,
    ]);
    return toRecord(r.rows[0]);
  }

  async create(sub: string, nowMs: number): Promise<AccountRecord> {
    const r = await this.run(
      `INSERT INTO ${this.table} (id, sub, profile, created, updated) VALUES ($1, $2, NULL, $3, $3)
       ON CONFLICT (sub) DO NOTHING RETURNING id, sub, profile, created, updated`,
      [newAccountId(), sub, nowMs],
    );
    const made = toRecord(r.rows[0]);
    if (made) return made;
    // 같은 sub가 이미 있다 (동시에 두 번 첫 로그인 · 다시 한 번 한 만들기)
    const have = await this.findBySub(sub);
    if (!have) throw new Error('계정 DB: 만든 계정을 찾지 못함');
    return have;
  }

  async saveProfile(id: string, profile: string, nowMs: number): Promise<boolean> {
    const r = await this.run(`UPDATE ${this.table} SET profile = $2, updated = $3 WHERE id = $1`, [
      id,
      profile,
      nowMs,
    ]);
    return r.count > 0;
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.run(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
    return r.count > 0;
  }

  close(): Promise<void> {
    return this.client.end();
  }

  /** 질의 하나: 연결 오류면 0.3초 뒤 한 번 더 (잠든 compute가 끊은 연결 · 깨는 중 시간 넘김). 한도 초과 등은 바로 올린다 */
  private async run(text: string, params: readonly (string | number | null)[]): Promise<PgResult> {
    try {
      return await this.client.query(text, params);
    } catch (err) {
      const info = classifyPgError(err);
      this.report(info, info.retry);
      if (!info.retry) throw err;
    }
    await this.sleep(PG_RETRY_WAIT_MS);
    try {
      return await this.client.query(text, params);
    } catch (err) {
      this.report(classifyPgError(err), false);
      throw err;
    }
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
