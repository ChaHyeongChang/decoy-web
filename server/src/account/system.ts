// 계정 기능 묶음 (docs/ACCOUNT_PLAN.md): 설정 → 저장소 · 서비스 · 공개 키 · 가짜 구글 · HTTP 경로 · 연결 모음을 한 번에 만든다.
// server/src/index.ts는 이것만 잇는다(HTTP 경로를 정적 파일보다 먼저 · WebSocket 연결의 계정 · RoomHooks.rated · 종료).
// 로그인이 꺼져 있으면(기본) 저장소 · 서비스를 만들지 않고, 계정 경로는 '꺼짐'으로만 답한다 — 판은 지금과 똑같다
import type { IncomingMessage } from 'node:http';
import type { MatchRating } from '@decoy/shared';
import { SESSION_COOKIE } from '@decoy/shared';
import type { Conn } from '@decoy/shared/sim';
import { describeAccountConfig, readAccountConfig, type AccountConfig } from './config';
import { ACCOUNT_ENV } from './env';
import { readCookie } from './cookies';
import { GoogleJwks, type KeyProvider } from './googleToken';
import { createAccountRoutes, originMatchesHost, type AccountHandler } from './routes';
import { AccountService, type AccountServiceOptions, type CreditMessage } from './service';
import { accountTag, verifySession } from './session';
import { createAccountStore } from './storeFactory';
import { MemoryAccountStore, type AccountStore } from './store';
import { TestIdp } from './testIdp';

/** 계정마다 지금 열린 게임 연결 (같은 사람의 여러 탭) — 적립 결과(credit)를 그 계정의 연결에만 보낸다 */
export class AccountConnections {
  private readonly byAccount = new Map<string, Set<Conn>>();

  add(conn: Conn): void {
    if (!conn.account) return;
    let set = this.byAccount.get(conn.account);
    if (!set) {
      set = new Set();
      this.byAccount.set(conn.account, set);
    }
    set.add(conn);
  }

  remove(conn: Conn): void {
    if (!conn.account) return;
    const set = this.byAccount.get(conn.account);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.byAccount.delete(conn.account);
  }

  /** 그 계정의 연결 모두에 보낸다. 보낸 수 */
  send(accountId: string, msg: CreditMessage): number {
    const set = this.byAccount.get(accountId);
    if (!set) return 0;
    for (const c of set) c.send(msg);
    return set.size;
  }

  count(accountId: string): number {
    return this.byAccount.get(accountId)?.size ?? 0;
  }
}

export interface AccountSystemOptions {
  env: Readonly<Record<string, string | undefined>>;
  testHooks: boolean;
  dev: boolean;
  /** 처리방침과 같은 문의처 조각 (privacy.ts contactHtml) */
  contact?: string | null;
  /** 서버 시계 (ms, 기본 Date.now) */
  now?: () => number;
  log?: (msg: string) => void;
  /** 시험: 저장소 · 공개 키 공급자 · 서비스 시간 값 바꿔 끼우기 */
  store?: AccountStore;
  keys?: KeyProvider;
  service?: Pick<AccountServiceOptions, 'dbTimeoutMs' | 'settleMaxMs' | 'retryDelaysMs' | 'sleep'>;
}

export interface AccountSystem {
  readonly config: AccountConfig;
  /** 로그인이 켜졌는가 */
  readonly on: boolean;
  /** 서버 시작 로그 한 줄 (값 없이 켜짐 · 꺼짐 이유 이름만) */
  readonly summary: string;
  readonly service: AccountService | null;
  readonly store: AccountStore | null;
  readonly testIdp: TestIdp | null;
  readonly conns: AccountConnections;
  /** HTTP: 계정 경로면 처리하고 true */
  readonly handle: AccountHandler;
  /** 저장소 시작 (실패해도 예외 없이 — 서버는 뜨고 계정 요청만 503) */
  start(): Promise<void>;
  /**
   * WebSocket 업그레이드 요청의 세션 쿠키 계정 (서명만 확인 — DB 조회 없음): 계정 키와 표시 tag. 꺼짐 · 게스트 · 다른 출처면 null.
   * 이것만으로는 적립하지 않는다 — 화면이 join · quick에서 같은 tag를 밝혀야 자리의 계정이 된다(ServerCore.connect)
   */
  accountOf(req: IncomingMessage): { id: string; tag: string } | null;
  /** 판이 끝나 평가가 나왔다 (RoomHooks.rated): 계정이 있으면 서버가 적립하고 결과를 그 계정 연결에 보낸다 */
  rated(account: string | null, rating: MatchRating): void;
  close(): Promise<void>;
}

/** DB 연결이 인증서를 확인하지 않을 때 시작 로그 (처리방침 10번은 TLS + 인증서 확인 — DATABASE_URL의 sslmode=require) */
export const DB_TLS_WARNINGS: Readonly<Record<'prefer' | 'disable', string>> = {
  prefer: '계정 DB 연결: 인증서를 확인하지 않음 (DATABASE_URL에 sslmode=require가 없다 — 처리방침 10번 확인)',
  disable: '계정 DB 연결: 암호화하지 않음 (DATABASE_URL이 sslmode=disable — 처리방침 10번 확인)',
};

/**
 * 계정 DB 드라이버 안쪽의 비동기 오류(예: DB 쪽이 보낸 깨진 인증 메시지 — 드라이버가 기다리지 않는 약속에서 난다)가 처리되지 않은
 * 거부로 서버 프로세스를 끝내 모든 판을 죽이지 않게 한다. PostgreSQL 저장소를 쓸 때만 건다(server/src/index.ts). 로그에는 오류
 * 이름 · 코드만 (값 · 메시지 · 주소 없이)
 */
export function unhandledRejectionLine(reason: unknown): string {
  const o = typeof reason === 'object' && reason !== null ? (reason as Record<string, unknown>) : {};
  const code = typeof o.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(o.code) ? o.code : null;
  const name = reason instanceof Error ? reason.name : typeof reason;
  return `서버: 처리되지 않은 비동기 오류 (${code ?? name}) — 판은 그대로 계속`;
}

export function guardUnhandledRejections(log: (msg: string) => void): void {
  process.on('unhandledRejection', (reason) => log(unhandledRejectionLine(reason)));
}

/** 소켓 수준 오류 코드 (닫힌 · 끊긴 연결에 쓰거나 읽다 난 것) — 계정 DB 연결에서만 나도 판에는 영향이 없다 */
const SOCKET_ERROR_CODES = new Set([
  'EBADF',
  'EPIPE',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_WRITE_AFTER_END',
  'ERR_SOCKET_CLOSED',
]);

/** 처리되지 않은 예외가 소켓 수준 오류인가 (TLS · SSL 오류 포함) */
export function isSocketError(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' && (SOCKET_ERROR_CODES.has(code) || /^ERR_(SSL|TLS)_/.test(code));
}

/**
 * 계정 DB 드라이버의 소켓 처리에서 듣는 이 없는 'error'가 나도(드라이버는 연결을 닫을 때 소켓 리스너를 모두 지운다) 서버 프로세스를
 * 끝내지 않는다 — 판은 그대로. 소켓 수준 오류만 삼키고 로그 `서버: 처리되지 않은 소켓 오류 (<코드>) — 판은 그대로 계속`, 그 밖의
 * 예외는 Node 기본처럼 찍고 끝낸다. PostgreSQL 저장소를 쓸 때만 건다(server/src/index.ts)
 */
export function guardSocketErrors(log: (msg: string) => void): void {
  process.on('uncaughtException', (err) => {
    if (isSocketError(err)) {
      log(
        `서버: 처리되지 않은 소켓 오류 (${String((err as Error & { code?: unknown }).code)}) — 판은 그대로 계속`,
      );
      return;
    }
    console.error(err);
    process.exit(1);
  });
}

export function createAccountSystem(opts: AccountSystemOptions): AccountSystem {
  let config = readAccountConfig(opts.env, { testHooks: opts.testHooks, dev: opts.dev });
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => console.log(m));
  const conns = new AccountConnections();
  let store: AccountStore | null = null;
  if (config.enabled) {
    try {
      store = opts.store ?? createAccountStore(config.store, opts.env, log);
    } catch {
      // 저장소를 만들 수 없다(sslrootcert 파일 등): 로그인을 끈 채로 뜬다 — 판은 그대로
      log(`계정 저장소를 만들지 못함 (${ACCOUNT_ENV.dbUrl} 확인)`);
      config = { enabled: false, requested: true, problems: [{ name: ACCOUNT_ENV.dbUrl, kind: 'invalid' }] };
    }
  }
  if (config.enabled && config.store.kind === 'postgres' && config.store.ssl !== 'verify')
    log(DB_TLS_WARNINGS[config.store.ssl]);
  const secret = config.enabled ? config.sessionSecret : '';
  let service: AccountService | null = null;
  let keys: KeyProvider | null = null;
  let testIdp: TestIdp | null = null;
  if (config.enabled && store) {
    service = new AccountService({
      store,
      timeZone: config.timeZone,
      now,
      log,
      push: (id, msg) => conns.send(id, msg),
      tag: (id) => accountTag(id, secret),
      ...opts.service,
    });
    if (config.testIdp) testIdp = new TestIdp(config.clientId);
    keys = opts.keys ?? testIdp?.keys ?? new GoogleJwks({ now });
  }
  const handle = createAccountRoutes({
    config,
    service,
    keys,
    testIdp,
    testHooks: opts.testHooks,
    memoryStore: opts.testHooks && store instanceof MemoryAccountStore ? store : null,
    contact: opts.contact ?? null,
    now,
    log,
  });

  return {
    config,
    on: config.enabled,
    summary: describeAccountConfig(config),
    service,
    store,
    testIdp,
    conns,
    handle,
    start: async () => {
      await service?.init();
    },
    accountOf: (req) => {
      if (!config.enabled) return null;
      // 다른 사이트 페이지가 연 소켓에는 계정을 붙이지 않는다 (게스트로는 그대로 받는다)
      if (!originMatchesHost(req)) return null;
      const id = verifySession(readCookie(req.headers.cookie, SESSION_COOKIE), secret, now())?.accountId;
      return id ? { id, tag: accountTag(id, secret) } : null;
    },
    rated: (account, rating) => {
      if (!account || !service) return;
      // 결과를 보낸 뒤 비동기로 (다른 사람에게 가는 메시지의 시각 · 순서를 바꾸지 않는다). 실패해도 판은 그대로
      service.credit(account, rating).catch(() => log('계정 적립 처리 오류'));
    },
    close: async () => {
      await store?.close().catch(() => undefined);
    },
  };
}
