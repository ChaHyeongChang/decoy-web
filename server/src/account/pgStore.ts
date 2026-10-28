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
import { connect as netConnect, type Socket } from 'node:net';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';
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
/**
 * 다시 접속 폭주 막기 ('시작 중 오류 없이 닫는 서버'에 드라이버가 질의를 붙든 채 끝없이 다시 접속하는 것 — 접속 제한도 매번 새로 잰다).
 * 두 신호 가운데 하나면 새로 여는 연결을 바로 끝낸다(RECONNECT_LOOP):
 * - 빠른 신호: 어떤 질의도 끝나지 않은(성공 · 실패 모두 없이) 채 이 묶음이 연결을 다섯 번 넘게 열었다. 질의마다 실패가 오는
 *   경우(비밀번호 틀림 · 한도 초과 · 접속 거절 · 서버 쪽 강제 종료)는 질의가 끝나 다시 세므로 걸리지 않는다
 * - 늦은 신호(한 연결만 그러고 다른 연결은 정상으로 질의를 끝내 빠른 신호가 계속 지워질 때): 가장 오래 기다린 질의가 기다리는
 *   동안 묶음이 연결을 예순 번 넘게 열었다. 정상이면 연결 둘을 다시 쓰므로 한 질의가 기다리는 4.5초 동안 그만큼 열 일이 없다.
 *   그동안 실패로 끝난 질의 수만큼은 빼고 센다 — 접속마다 오류가 오면(비밀번호 틀림 · 접속 거절 등) 접속 하나가 질의 하나를
 *   실패시키므로, 한꺼번에 예순 넘게 줄 선 질의가 차례로 실패하는 것은 폭주가 아니다
 */
export const PG_STORM_SOCKETS = 5;
export const PG_STORM_BACKSTOP = 60;
/**
 * 버린 묶음에서 TLS로 감싼 연결이 우아하게 닫히기를 기다리는 시간 (ms). 넘기면 TLS 쪽부터 부순다 — 상대가 얼어(읽지도 · 닫지도
 * 않음) 반쯤 열린 연결이 서버에 쌓이지 않게
 */
export const PG_TLS_CLOSE_GRACE_MS = 5_000;
/**
 * 망가진 연결 자리 알아채기 (ms): 접속(TCP)이 된 뒤 이만큼 지나도 드라이버가 그 소켓에 한 바이트도 쓰지 않았으면 묶음을 버린다(아래
 * createPostgresClient 설명). 성한 자리는 드라이버가 소켓을 받자마자 시작 글(SSLRequest · StartupMessage) 쓰기를 setImmediate로 예약해, 접속과 같은 루프 차례에 이 타이머보다 먼저 쓴다(빠른 접속이면 접속 뒤 1ms 안 — 루프가 막혀도 순서는 같다. 드라이버 3.4.9의 동작이라 server/package.json에 정확히 고정한다)
 */
export const PG_STALL_CHECK_MS = 100;
/** 호출 하나의 시도 수 상한 (다른 요청이 연결 묶음을 버려 함께 끊긴 시도 포함) */
export const PG_MAX_TRIES = 5;
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
  // 인증서 확인: 인증 기관(공인 · sslrootcert)과 호스트 이름을 Node가 확인한다. 이름은 DATABASE_URL의 호스트로 직접 비교한다 —
  // 드라이버는 IP 주소 호스트면 servername을 비워 Node가 'localhost'와 비교하게 되므로
  const verify = {
    rejectUnauthorized: true,
    checkServerIdentity: (_name: string, cert: PeerCertificate) => checkServerIdentity(conf.host, cert),
    ...(ca !== null ? { ca } : {}),
  };
  return {
    host: conf.host,
    port: conf.port,
    user: conf.user,
    pass: conf.password,
    database: conf.database,
    // 'prefer'는 확인하지 않는다 (sslmode가 없는 주소 — 시작 로그가 경고한다)
    ssl: conf.ssl === 'disable' ? false : conf.ssl === 'prefer' ? 'prefer' : verify,
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
 * 날 소켓에 다는 우리 'error' 리스너 (이 함수 그대로 — 드라이버가 TLS를 시작하며 날 소켓의 리스너를 모두 지우면 이것도 사라지므로,
 * 남아 있는지로 TLS로 감쌌는지 안다. Node의 TLS는 날 소켓에 자기 'error' 리스너를 따로 달아 리스너 수로는 알 수 없다)
 */
const rawErrorGuard = (): void => undefined;

/** 드라이버가 이 날 소켓을 TLS로 감쌌는가 (우리 리스너가 지워졌다) */
function wrappedByTls(sock: Socket): boolean {
  return !sock.listeners('error').includes(rawErrorGuard);
}

function codeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** 연결 묶음 하나: 드라이버 · 이 묶음이 연 소켓 · 최근에 연 시각 */
interface Pool {
  sql: postgres.Sql;
  /** 이 묶음이 연 소켓 (TLS면 드라이버가 우리 리스너를 지우므로 닫힌 것은 열 때마다 걸러 낸다) */
  sockets: Set<Socket>;
  /** 이 묶음이 지금까지 연 연결 수 */
  opened: number;
  /** 마지막으로 질의가 끝난 뒤 연 연결 수 */
  sinceSettle: number;
  /** 이 묶음에서 실패로 끝난 질의 수 (늦은 신호에서 뺀다) */
  failed: number;
  /** 기다리는 질의 → 그 질의를 보낼 때의 opened · failed */
  waiting: Map<number, { opened: number; failed: number }>;
  dropped: boolean;
}

/**
 * postgres.js 연결 묶음. 접속은 첫 질의 때 한다. 소켓은 이 함수가 직접 연다(드라이버 socket 설정):
 * - 질의가 timeoutMs 안에 끝나지 않으면 그 묶음을 버린다 — 드라이버를 끝내고(end timeout 0) 그 묶음의 소켓을 닫는다(드라이버는
 *   우아하게 닫기만 해서, 멈춘 서버 쪽 연결이 끝없이 남는다). TLS로 감싸지 않은 소켓은 바로 부수고, 감싼 것은 우아하게 닫히기를
 *   5초 기다린 뒤 TLS 쪽부터 부순다(forceClose). 다음 질의부터 새 묶음
 * - 망가진 연결 자리도 묶음을 버린다: 드라이버(3.4.9)는 소켓이 닫히는 같은 차례에 그 연결로 질의를 쓰면 쓰기 예약을 지우고도
 *   '예약됨'으로 남겨, 그 연결 자리의 다음 접속들이 시작 글을 영영 보내지 못하고 접속 제한(4초)마다 실패한다(검증에서 재현). 표지는
 *   '접속이 됐는데 0.1초가 지나도 드라이버가 한 바이트도 쓰지 않음'이다 — 성한 자리는 접속과 같은 루프 차례에 시작 글을 쓴다(PG_STALL_CHECK_MS). 접속 제한마다
 *   묶음을 버리면 새 연결만 느린 DB(DNS · 바쁜 프록시)나 8초 넘게 걸려 깨는 DB에서 멀쩡한 질의까지 함께 끊었다(6차 검증)
 * - 서버가 시작 중 오류 없이 접속을 닫으면 드라이버가 쉬지 않고 다시 접속한다(접속 제한도 매번 새로 잰다): 어떤 질의도 끝나지
 *   않은 채 다섯 번 넘게 열면 그 시도를 바로 끝낸다(RECONNECT_LOOP — 질의가 하나라도 끝나면 다시 센다)
 * - 다른 질의가 묶음을 버려 함께 끊긴 질의는 POOL_DROPPED로 알린다(저장소가 한 번 더의 몫을 쓰지 않고 새 묶음으로 다시 한다)
 * 버린 질의의 늦은 실패는 삼킨다. sslrootcert 파일을 읽지 못하면 예외 (만드는 쪽이 로그인을 끈다)
 */
/**
 * 연결 묶음 + 진단 (시험): openSockets 지금 묶음이 들고 있는 소켓 수(다시 접속이 쌓여 새지 않는지 — 마지막으로 연 뒤 닫힌 것도
 * 센다) · liveSockets 이 클라이언트가 연 소켓 가운데 아직 닫히지 않은 것(버린 묶음 포함)
 */
export type PostgresClient = PgClient & { openSockets(): number; liveSockets(): number };

/** 시험용 설정 */
export interface PostgresClientOptions {
  /** 버린 묶음의 TLS 연결을 기다리는 시간 (기본 PG_TLS_CLOSE_GRACE_MS) */
  tlsCloseGraceMs?: number;
  /** 연 소켓마다 부른다 (드라이버가 받기 전 — 시험이 연결을 직접 끊어 본다) */
  onSocket?: (sock: Socket) => void;
}

export function createPostgresClient(conf: PgConfig, opts: PostgresClientOptions = {}): PostgresClient {
  const ca = conf.caFile !== null ? readFileSync(conf.caFile, 'utf8') : null;
  const tlsGraceMs = opts.tlsCloseGraceMs ?? PG_TLS_CLOSE_GRACE_MS;
  let closed = false;
  let drops = 0;
  let queryIds = 0;
  /** 이 클라이언트가 연 모든 소켓 (버린 묶음 포함 — 닫기 · 진단. 닫힌 것은 열 때마다 걸러 낸다) */
  const everything = new Set<Socket>();

  /**
   * 드라이버가 접속마다 부른다. 언제나 접속 중인 실제 소켓을 돌려준다 — 드라이버는 받은 소켓의 'error' · 'close'로 그 연결 자리를
   * 정리하므로(여기서 예외를 던지면 그 자리가 '접속 중'에 영영 묶여 묶음이 멈춘다). 버린 묶음이거나 다시 접속 폭주면 드라이버가
   * 소켓을 받은 다음 차례에 그 소켓을 우리 오류 코드로 부순다
   */
  const openSocket = (pool: Pool): Socket => {
    const sock = Object.assign(netConnect({ host: conf.host, port: conf.port }), {
      // 드라이버가 TLS SNI · 오류 문구에 쓴다
      host: conf.host,
      port: conf.port,
    });
    // 오류는 드라이버가 받는다 — 그 사이 · 그 뒤에도 처리되지 않은 'error'로 서버가 죽지 않게
    sock.on('error', rawErrorGuard);
    for (const old of pool.sockets) if (old.destroyed) pool.sockets.delete(old);
    for (const old of everything) if (old.destroyed) everything.delete(old);
    pool.sockets.add(sock);
    everything.add(sock);
    sock.once('close', () => pool.sockets.delete(sock));
    // 망가진 연결 자리: 접속이 됐는데 드라이버가 아무것도 쓰지 않았다 (위 설명. 타이머는 프로세스를 붙잡지 않는다)
    sock.once('connect', () => {
      setTimeout(() => {
        if (!sock.destroyed && sock.bytesWritten === 0 && !pool.dropped && !closed) drop(pool);
      }, PG_STALL_CHECK_MS).unref();
    });
    opts.onSocket?.(sock);
    pool.opened += 1;
    pool.sinceSettle += 1;
    // 늦은 신호: 기다리는 질의마다 (그 뒤 연 연결 수 - 그 뒤 실패로 끝난 질의 수)의 가장 큰 값
    let behind = 0;
    for (const at of pool.waiting.values())
      behind = Math.max(behind, pool.opened - at.opened - (pool.failed - at.failed));
    const why =
      pool.dropped || closed
        ? codeError('CONNECTION_DESTROYED', '계정 DB: 버린 연결 묶음')
        : pool.sinceSettle > PG_STORM_SOCKETS || behind > PG_STORM_BACKSTOP
          ? codeError('RECONNECT_LOOP', '계정 DB: 서버가 오류 없이 연결을 거듭 닫음')
          : null;
    // 드라이버가 소켓을 받은 다음 차례에 (TLS로 감싸기 전이다 — 감쌌으면 우리 리스너가 지워져 있어 건드리지 않는다)
    if (why) setImmediate(() => !wrappedByTls(sock) && sock.destroy(why));
    return sock;
  };

  const make = (): Pool => {
    // socket: 드라이버 설정이지만 타입 정의에 없다 (Options와 교차 타입으로 넘긴다). 드라이버는 첫 질의 때 부른다
    const options: postgres.Options<Record<string, postgres.PostgresType>> & {
      socket: () => Promise<Socket>;
    } = { ...postgresOptions(conf, ca), socket: () => Promise.resolve(openSocket(pool)) };
    const pool: Pool = {
      sql: postgres(options),
      sockets: new Set(),
      opened: 0,
      sinceSettle: 0,
      failed: 0,
      waiting: new Map(),
      dropped: false,
    };
    return pool;
  };

  let current = make();

  /**
   * 소켓을 바로 닫는다. TLS로 감싸지 않은 것은 부순다. 드라이버가 TLS로 감싼 날 소켓은 직접 부수지 않는다: 감싼 TLS 소켓에 아직 못
   * 보낸 쓰기가 있으면 닫힌 fd에 쓰다 오류(EBADF · ECANCELED)가 나는데, 그때는 드라이버가 TLS 소켓의 리스너를 이미 지워 처리되지 않은
   * 'error'로 서버 프로세스가 끝난다(검증에서 재현). 감쌌는지는 우리 리스너(rawErrorGuard)가 남았는지로 안다. 감싼 것은 날 소켓에
   * 'close'를 낸다 — Node TLS가 날 소켓에 단 '날 소켓이 닫히면 TLS 소켓도 부순다' 리스너가 TLS 소켓을 먼저 부수고(못 보낸 쓰기는
   * 버린다) 이어서 날 소켓을 닫는다(Node 22에서 확인: 쓰기가 밀린 채로도 처리되지 않은 오류 없음). 그 리스너가 없는 Node면 아무 일도
   * 없고 드라이버의 끝내기(TLS end)에 맡긴 채 남는다
   */
  const forceClose = (sock: Socket): void => {
    if (sock.destroyed) return;
    if (!wrappedByTls(sock)) sock.destroy();
    else sock.emit('close', false);
  };

  /**
   * 감싸지 않은 것은 바로 부수고, TLS로 감싼 것은 우아하게 닫히기를 tlsGraceMs 기다린 뒤 forceClose (기다림은 프로세스를 붙잡지
   * 않는다. 0이면 바로 — 시험이 날 소켓을 부수던 때와 같은 차례에 닫아 본다)
   */
  const closeSoon = (sock: Socket): void => {
    if (tlsGraceMs <= 0 || !wrappedByTls(sock)) forceClose(sock);
    else if (!sock.destroyed) setTimeout(() => forceClose(sock), tlsGraceMs).unref();
  };

  const drop = (pool: Pool): void => {
    if (pool.dropped) return;
    pool.dropped = true;
    drops += 1;
    if (current === pool && !closed) current = make();
    // 드라이버가 먼저 연결을 끝낸 뒤(시작 중 질의를 지운 뒤) 소켓을 닫는다 — 먼저 부수면 드라이버가 시작 중 닫힘으로 보고 한 번 더 접속한다
    void pool.sql
      .end({ timeout: 0 })
      .catch(noop)
      .finally(() => {
        for (const sock of pool.sockets) closeSoon(sock);
      });
  };

  return {
    async query(text, params, timeoutMs) {
      if (closed) throw codeError('CONNECTION_ENDED', '계정 DB: 닫힘');
      const pool = current;
      const startDrops = drops;
      const id = (queryIds += 1);
      pool.waiting.set(id, { opened: pool.opened, failed: pool.failed });
      const run = pool.sql.unsafe(text, [...params]).then(
        (res) => {
          pool.waiting.delete(id);
          pool.sinceSettle = 0;
          return { rows: [...res] as Record<string, unknown>[], count: res.count };
        },
        (e: unknown) => {
          pool.waiting.delete(id);
          pool.sinceSettle = 0;
          pool.failed += 1;
          // 다른 질의가 묶음을 버려 함께 끊겼다 (이 질의 탓이 아니다)
          throw drops !== startDrops
            ? codeError('POOL_DROPPED', '계정 DB: 다른 요청이 연결 묶음을 새로 만듦')
            : e;
        },
      );
      // 시간을 넘겨 버린 질의가 나중에 실패해도 처리되지 않은 거부가 되지 않게
      run.catch(noop);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(codeError('QUERY_TIMEOUT', '계정 DB: 응답 없음'));
          drop(pool);
        }, timeoutMs);
      });
      try {
        return await Promise.race([run, expired]);
      } finally {
        clearTimeout(timer);
      }
    },
    // 걸러 내지 않은 그대로 (마지막으로 연 뒤 닫힌 것까지 — 열 때마다 걸러 내는지 보는 시험용)
    openSockets: () => current.sockets.size,
    liveSockets: () => [...everything].filter((sock) => !sock.destroyed).length,
    async end() {
      closed = true;
      await current.sql.end({ timeout: 2 }).catch(noop);
      // 드라이버가 2초 안에 닫지 못한 것(얼어 버린 상대) · 버린 묶음에서 아직 기다리는 것까지 모두
      for (const sock of everything) forceClose(sock);
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
  'RECONNECT_LOOP',
  'POOL_DROPPED',
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
/** 시도 실패지만 이 시도 탓이 아니다 — 한 번 더의 몫을 쓰지 않고, 로그도 남기지 않는다 */
const VICTIM_CODE = 'POOL_DROPPED';

const HINTS: Readonly<Record<string, string>> = {
  CONNECT_TIMEOUT: 'DB가 깨는 중이거나 닿지 않음',
  QUERY_TIMEOUT: 'DB 응답 없음 (연결을 새로 만든다)',
  RECONNECT_LOOP: 'DB가 오류 없이 연결을 거듭 끊음 (DATABASE_URL · DB 상태 확인)',
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
  /** 마지막으로 질의가 성공한 시각 (그 뒤에 시작한 호출의 실패만 쉬기를 부른다) */
  private lastOkAt = Number.NEGATIVE_INFINITY;

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
   * 남을 때만. 다른 요청이 연결 묶음을 버려 함께 끊긴 시도(POOL_DROPPED)는 그 한 번 더의 몫을 쓰지 않고 새 묶음으로 바로 다시
   * (예산 안, 모두 다섯 번까지). 한도 초과 · 비밀번호 틀림 등은 바로 올린다. 이 호출의 시도가 모두 시간을 넘기면 DB를 잠시 쉰다(PAUSED)
   */
  private async run(text: string, params: readonly (string | number | null)[]): Promise<PgResult> {
    const start = this.now();
    if (start < this.pausedUntil) throw Object.assign(new Error('계정 DB: 잠시 쉼'), { code: 'PAUSED' });
    const deadline = start + this.budgetMs;
    let tries = 0;
    let victims = 0;
    let timeouts = 0;
    let retried = false;
    /** 이 호출 자신의 마지막 오류 (함께 끊긴 시도 말고 — 쉬기 로그에 쓴다) */
    let own: PgErrorInfo | null = null;
    for (;;) {
      tries += 1;
      const left = Math.max(1, deadline - this.now());
      try {
        const res = await this.client.query(text, params, Math.min(this.attemptTimeoutMs, left));
        this.succeeded();
        return res;
      } catch (err) {
        const info = classifyPgError(err);
        const victim = info.code === VICTIM_CODE;
        if (victim) victims += 1;
        else own = info;
        if (info.timeout) timeouts += 1;
        const room = deadline - this.now();
        const again =
          tries < PG_MAX_TRIES &&
          (victim
            ? room >= PG_RETRY_MIN_LEFT_MS
            : !retried && info.retry && room - PG_RETRY_WAIT_MS >= PG_RETRY_MIN_LEFT_MS);
        if (again) {
          if (!victim) {
            retried = true;
            this.report(info, true);
            await this.sleep(PG_RETRY_WAIT_MS);
          }
          continue;
        }
        // 함께 끊긴 시도는 로그에 남기지 않는다: 쉬기 · 로그의 코드는 이 호출 자신의 마지막 오류
        if (own && timeouts > 0 && timeouts === tries - victims) this.pause(own, start);
        else if (!victim) this.report(info, false);
        throw err;
      }
    }
  }

  /** 질의가 됐다: 쉬기를 풀고 처음으로 */
  private succeeded(): void {
    this.pauses = 0;
    this.pausedUntil = Number.NEGATIVE_INFINITY;
    this.lastOkAt = this.now();
  }

  /**
   * 이 호출의 시도가 모두 시간을 넘겼다: 15초 · 30초 · 1분 … 최대 5분 동안 DB를 쉰다(같은 일이 계속되면 접속 시도를 줄인다).
   * 한 장애에 한 번만: 이미 쉬는 중이거나(동시에 실패한 다른 호출이 시작했다) 이 호출이 시작한 뒤 다른 질의가 됐으면(DB가 돌아왔다)
   * 쉬지 않는다
   */
  private pause(info: PgErrorInfo, runStart: number): void {
    const now = this.now();
    if (now < this.pausedUntil || this.lastOkAt > runStart) {
      this.report(info, false);
      return;
    }
    const ms = Math.min(this.pauseMs * 2 ** this.pauses, PG_PAUSE_MAX_MS);
    this.pauses += 1;
    this.pausedUntil = now + ms;
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
