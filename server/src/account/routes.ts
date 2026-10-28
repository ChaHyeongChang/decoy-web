// 계정 HTTP 경로 (docs/ACCOUNT_PLAN.md 2 · 4 · 8절): 구글 로그인 리디렉트 · 계정 API · 계정 삭제 페이지 · 시험 훅.
// - 출처는 x-forwarded-proto(Render) + Host로 만든다. POST API는 x-decoy-account: 1 + Origin(있으면 같은 출처) — 아니면 403 csrf
// - 본문 상한: import 32KB, 콜백 16KB, 그 밖 2KB(넘으면 413). 401은 세션 쿠키도 지운다. 모든 응답 cache-control: no-store
// - 꺼짐: GET /api/account는 200 {on:false}, 나머지 API는 404 off, /auth/*는 비율 제한(IP 담기) 없이 /?login=off로,
//   삭제 페이지는 '여기서 지울 수 없음 — 문의처'
// - 비율 제한: IP마다 /auth/* 1분 20번, 계정마다 POST 1분 60번 → 429 rate (열쇠는 늦어도 2분 안에 메모리에서 지운다)
// - 삭제 페이지는 referrer-policy same-origin (폼 POST의 Origin이 'null'이 되지 않게), 리디렉트는 no-referrer
// - 삭제 페이지에서 시작한 로그인(next=delete)은 계정을 만들지 않고(없으면 '계정 없음'), 게임 세션(decoy_sid) 대신 삭제 페이지에만
//   실리는 10분 쿠키(decoy_del)를 준다 — 삭제하려고 로그인한 브라우저가 게임에서 몰래 계정 모드 · 계정 적립이 되지 않게
// - 기기 기록 올리기(import에 기기 글)는 구글 로그인 뒤 10분 안만 받는다(403 relogin) — 오래된 화면 흐름이 계정 기록을 덮지 않게
// - 로그에는 실패 종류만 (토큰 · sub · 계정 ID를 찍지 않는다)
// 시험 훅(--test-hooks)이 없으면 /test/*는 404 (index.ts의 다른 시험 경로와 같다)
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ACCOUNT_DELETE_PATH,
  ACCOUNT_HEADER,
  AUTH_CALLBACK_PATH,
  AUTH_START_PATH,
  DELETE_COOKIE,
  DELETE_NONE_PARAM,
  LOGIN_RESULT_PARAM,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  type AccountErrorCode,
  type AccountStatus,
  type LoginResult,
} from '@decoy/shared';
import { PROGRESSION, emptyProfile, levelOf, parseProfile } from '@decoy/shared/meta';
import type { AccountConfig } from './config';
import { clearCookie, readCookie, setCookie } from './cookies';
import { DELETE_CSRF_FIELD, renderDeletePage, type DeletePageState } from './deletePage';
import { verifyIdToken, type KeyProvider } from './googleToken';
import { RateLimiter } from './rateLimit';
import {
  AccountBadRequest,
  AccountUnavailable,
  parseCostumeRequest,
  parseImportRequest,
  type AccountService,
} from './service';
import {
  DELETE_SESSION_MAX_AGE_SEC,
  IMPORT_WINDOW_SEC,
  SESSION_MAX_AGE_SEC,
  accountTag,
  csrfFor,
  safeEqual,
  signDeleteSession,
  signSession,
  verifyDeleteSession,
  verifySession,
} from './session';
import type { MemoryAccountStore } from './store';
import { isTestTokenFlaw, testAuthorizePage, type TestIdp } from './testIdp';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
/** 가짜 구글 (시험 훅) */
export const TEST_AUTHORIZE_PATH = '/test/google/authorize';
/** 시험 훅: 메모리 저장소 장애 흉내 (?fail=1|0) · 계정 목록 */
export const TEST_STORE_PATH = '/test/account-store';
export const TEST_ACCOUNTS_PATH = '/test/accounts';

export const IMPORT_BODY_MAX = 32 * 1024;
export const CALLBACK_BODY_MAX = 16 * 1024;
export const SMALL_BODY_MAX = 2 * 1024;
/** 로그인 중 state · nonce 쿠키 수명 (초) */
export const OAUTH_MAX_AGE_SEC = 600;
export const AUTH_RATE_PER_MIN = 20;
export const POST_RATE_PER_MIN = 60;
/** 비율 제한 창 (ms). 열쇠(IP · 계정 ID)는 늦어도 다음 창에 지운다 — 처리방침 3번 '최대 2분' */
export const RATE_WINDOW_MS = 60_000;
/** 상한을 넘은 본문을 이만큼까지는 읽어 버리고 413으로 답한다 (그보다 크면 연결을 닫는다) */
const DRAIN_MAX = 256 * 1024;

const API_ROOT = '/api/account';
type ApiOp = 'import' | 'claim-login' | 'costume' | 'logout' | 'delete';
const API_OPS: readonly ApiOp[] = ['import', 'claim-login', 'costume', 'logout', 'delete'];

export interface AccountRoutesContext {
  config: AccountConfig;
  /** 켜졌을 때만 (꺼짐이면 null) */
  service: AccountService | null;
  keys: KeyProvider | null;
  testIdp: TestIdp | null;
  testHooks: boolean;
  /** 시험 훅: 메모리 저장소 (장애 흉내 · 계정 목록). 아니면 null */
  memoryStore: MemoryAccountStore | null;
  /** 문의처 HTML 조각 (privacy.ts contactHtml) */
  contact: string | null;
  now: () => number;
  log: (msg: string) => void;
}

/** 계정 경로면 처리하고 true (응답은 비동기로), 아니면 false — 정적 파일로 넘긴다 */
export type AccountHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;

interface Origin {
  origin: string;
  secure: boolean;
}

const HOST = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

function firstHeader(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw?.split(',')[0]?.trim();
}

/** 요청이 온 출처 (x-forwarded-proto + Host). Host가 이상하면 null */
export function requestOrigin(req: IncomingMessage): Origin | null {
  const host = req.headers.host;
  if (typeof host !== 'string' || host.length > 255 || !HOST.test(host)) return null;
  const proto = firstHeader(req.headers['x-forwarded-proto'])?.toLowerCase() === 'https' ? 'https' : 'http';
  return { origin: `${proto}://${host.toLowerCase()}`, secure: proto === 'https' };
}

/**
 * Origin 머리가 이 서버(Host)에서 온 것인가 (없으면 true — 브라우저가 아닌 요청 · 같은 출처 GET). 요청 위조 막기는 호스트만 비교한다:
 * 프록시가 WebSocket 업그레이드에 x-forwarded-proto를 싣지 않아도 같은 사이트를 거절하지 않게(https/http 같은 호스트는 같은 서버)
 */
export function originMatchesHost(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  try {
    const u = new URL(origin);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.host === host.toLowerCase();
  } catch {
    return false;
  }
}

/** 비율 제한 열쇠: 첫 x-forwarded-for(Render가 붙인다), 없으면 소켓 주소 */
function clientIp(req: IncomingMessage): string {
  return firstHeader(req.headers['x-forwarded-for']) || req.socket.remoteAddress || '?';
}

type BodyResult = { ok: true; text: string } | { ok: false; status: 400 | 413; close: boolean };

/** 본문 읽기 (상한). 넘으면 DRAIN_MAX까지 읽어 버리고 413, 그보다 크면 더 읽지 않고 연결을 닫게 한다 */
function readBody(req: IncomingMessage, limit: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > DRAIN_MAX) {
      req.pause();
      resolve({ ok: false, status: 413, close: true });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (r: BodyResult): void => {
      if (done) return;
      done = true;
      resolve(r);
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
      else if (size > DRAIN_MAX) {
        req.pause();
        finish({ ok: false, status: 413, close: true });
      }
    });
    req.on('end', () =>
      finish(
        size > limit
          ? { ok: false, status: 413, close: false }
          : { ok: true, text: Buffer.concat(chunks).toString('utf8') },
      ),
    );
    req.on('error', () => finish({ ok: false, status: 400, close: true }));
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function headersWith(base: Record<string, string>, cookies: readonly string[], close: boolean) {
  const h: Record<string, string | string[]> = { ...base, 'cache-control': 'no-store' };
  if (cookies.length > 0) h['set-cookie'] = [...cookies];
  if (close) h.connection = 'close';
  return h;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  cookies: readonly string[] = [],
  close = false,
) {
  res
    .writeHead(status, headersWith({ 'content-type': 'application/json; charset=utf-8' }, cookies, close))
    .end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  status: number,
  error: AccountErrorCode,
  cookies: readonly string[] = [],
  close = false,
) {
  sendJson(res, status, { error }, cookies, close);
}

/** 삭제 페이지 · 가짜 구글 페이지: 스크립트 없는 페이지는 틀에 넣지 못하게 · 다른 곳으로 폼을 보내지 못하게 */
// img-src 'self': 브라우저가 스스로 받는 파비콘이 막혀 콘솔 오류가 나지 않게
const PAGE_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/**
 * referrer: 폼이 있는 페이지(삭제 페이지)는 'same-origin'. 'no-referrer'면 브라우저가 같은 출처 폼 POST의 Origin을 'null'로
 * 보내 출처 확인(originMatchesHost)이 늘 거절한다. 'same-origin'은 같은 출처에만 출처를 싣고 다른 사이트로는 보내지 않는다
 */
type PageReferrer = 'same-origin' | 'no-referrer';

function sendHtml(
  res: ServerResponse,
  status: number,
  html: string,
  referrer: PageReferrer,
  cookies: readonly string[] = [],
  close = false,
) {
  res
    .writeHead(
      status,
      headersWith(
        {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': PAGE_CSP,
          'x-frame-options': 'DENY',
          'referrer-policy': referrer,
        },
        cookies,
        close,
      ),
    )
    .end(html);
}

function redirect(res: ServerResponse, status: 302 | 303, location: string, cookies: readonly string[] = []) {
  res.writeHead(status, headersWith({ location, 'referrer-policy': 'no-referrer' }, cookies, false)).end();
}

function sendText(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, headersWith({ 'content-type': 'text/plain; charset=utf-8' }, [], false)).end(text);
}

interface OauthState {
  state: string;
  nonce: string;
  next: 'home' | 'delete';
}

const TOKEN_PART = /^[A-Za-z0-9_-]{16,64}$/;

function parseOauthCookie(v: string | null): OauthState | null {
  if (!v) return null;
  const [state, nonce, next, ...rest] = v.split('.');
  if (rest.length > 0 || !state || !nonce || !TOKEN_PART.test(state) || !TOKEN_PART.test(nonce)) return null;
  if (next !== 'home' && next !== 'delete') return null;
  return { state, nonce, next };
}

function randomToken(): string {
  return randomBytes(18).toString('base64url');
}

export function createAccountRoutes(ctx: AccountRoutesContext): AccountHandler {
  const cfg = ctx.config;
  const on = cfg.enabled && ctx.service !== null;
  const secret = cfg.enabled ? cfg.sessionSecret : '';
  const authRate = new RateLimiter(AUTH_RATE_PER_MIN, RATE_WINDOW_MS, ctx.now);
  const postRate = new RateLimiter(POST_RATE_PER_MIN, RATE_WINDOW_MS, ctx.now);

  /** 게임 세션 쿠키. loginMs = 구글 로그인을 마친 때 (새로 발급할 때 처음 로그인 때를 그대로 — 없으면 지금) */
  const sessionCookie = (accountId: string, o: Origin, loginMs?: number): string =>
    setCookie(SESSION_COOKIE, signSession(accountId, secret, ctx.now(), loginMs), {
      path: '/',
      maxAgeSec: SESSION_MAX_AGE_SEC,
      sameSite: 'Lax',
      secure: o.secure,
    });
  const clearSession = (o: Origin): string =>
    clearCookie(SESSION_COOKIE, { path: '/', sameSite: 'Lax', secure: o.secure });
  // 삭제 페이지 전용 (Path=/account/delete — /ws · /api에는 실리지 않는다)
  const deleteCookie = (accountId: string, o: Origin): string =>
    setCookie(DELETE_COOKIE, signDeleteSession(accountId, secret, ctx.now()), {
      path: ACCOUNT_DELETE_PATH,
      maxAgeSec: DELETE_SESSION_MAX_AGE_SEC,
      sameSite: 'Lax',
      secure: o.secure,
    });
  const clearDelete = (o: Origin): string =>
    clearCookie(DELETE_COOKIE, { path: ACCOUNT_DELETE_PATH, sameSite: 'Lax', secure: o.secure });
  // 구글에서 돌아오는 다른 사이트발 POST에 실려야 해서 HTTPS면 SameSite=None (http 개발 · 시험은 같은 출처 가짜 구글이라 Lax)
  const oauthCookie = (value: string, o: Origin): string =>
    setCookie(OAUTH_COOKIE, value, {
      path: '/auth',
      maxAgeSec: OAUTH_MAX_AGE_SEC,
      sameSite: o.secure ? 'None' : 'Lax',
      secure: o.secure,
    });
  const clearOauth = (o: Origin): string =>
    clearCookie(OAUTH_COOKIE, { path: '/auth', sameSite: o.secure ? 'None' : 'Lax', secure: o.secure });

  const hasSessionCookie = (req: IncomingMessage): boolean =>
    readCookie(req.headers.cookie, SESSION_COOKIE) !== null;
  const sessionOf = (req: IncomingMessage) => {
    if (!on) return null;
    const value = readCookie(req.headers.cookie, SESSION_COOKIE);
    const info = verifySession(value, secret, ctx.now());
    return info && value
      ? { value, accountId: info.accountId, renew: info.renew, loginSec: info.loginSec }
      : null;
  };
  /** 삭제 페이지 전용 쿠키의 계정 (10분 안) */
  const deleteSessionOf = (req: IncomingMessage) => {
    if (!on) return null;
    const value = readCookie(req.headers.cookie, DELETE_COOKIE);
    const info = verifyDeleteSession(value, secret, ctx.now());
    return info && value ? { value, accountId: info.accountId } : null;
  };

  /** POST API 요청 위조 막기: 표시 헤더 + Origin(있으면 이 서버) */
  const csrfOk = (req: IncomingMessage): boolean =>
    req.headers[ACCOUNT_HEADER] === '1' && originMatchesHost(req);

  // ───────── 계정 API ─────────

  async function status(req: IncomingMessage, res: ServerResponse, o: Origin): Promise<void> {
    if (!on || !ctx.service) {
      sendJson(res, 200, { on: false } satisfies AccountStatus);
      return;
    }
    const s = sessionOf(req);
    if (!s) {
      sendJson(
        res,
        200,
        { on: true, signedIn: false } satisfies AccountStatus,
        hasSessionCookie(req) ? [clearSession(o)] : [],
      );
      return;
    }
    if (!(await ctx.service.ensureReady())) {
      sendError(res, 503, 'db');
      return;
    }
    const st = await ctx.service.status(s.accountId);
    if (!st) {
      sendJson(res, 200, { on: true, signedIn: false } satisfies AccountStatus, [clearSession(o)]);
      return;
    }
    const body: AccountStatus = {
      on: true,
      signedIn: true,
      tag: accountTag(s.accountId, secret),
      fresh: st.fresh,
      profile: st.profile,
      day: st.day,
      timeZone: st.timeZone,
    };
    // 새로 발급해도 로그인 때는 그대로 (기기 기록 올리기 10분 창이 다시 열리지 않게)
    sendJson(res, 200, body, s.renew ? [sessionCookie(s.accountId, o, s.loginSec * 1000)] : []);
  }

  async function apiPost(op: ApiOp, req: IncomingMessage, res: ServerResponse, o: Origin): Promise<void> {
    const service = ctx.service;
    if (!on || !service) {
      sendError(res, 404, 'off');
      return;
    }
    if (!csrfOk(req)) {
      sendError(res, 403, 'csrf');
      return;
    }
    if (op === 'logout') {
      const body = await readBody(req, SMALL_BODY_MAX);
      if (!body.ok) {
        sendError(res, body.status, 'bad-request', [], body.close);
        return;
      }
      sendJson(res, 200, { ok: true }, [clearSession(o)]);
      return;
    }
    const s = sessionOf(req);
    if (!s) {
      sendError(res, 401, 'auth', [clearSession(o)]);
      return;
    }
    if (!postRate.take(s.accountId)) {
      sendError(res, 429, 'rate');
      return;
    }
    const body = await readBody(req, op === 'import' ? IMPORT_BODY_MAX : SMALL_BODY_MAX);
    if (!body.ok) {
      sendError(res, body.status, 'bad-request', [], body.close);
      return;
    }
    // 본문을 쓰는 것은 import · costume뿐 (claim-login · delete 본문은 읽기만 하고 무시 — 날짜 · 보상 값을 기기에서 받지 않는다)
    const importReq = op === 'import' ? parseImportRequest(parseJson(body.text)) : null;
    const costumeReq = op === 'costume' ? parseCostumeRequest(parseJson(body.text)) : null;
    if ((op === 'import' && !importReq) || (op === 'costume' && !costumeReq)) {
      sendError(res, 400, 'bad-request');
      return;
    }
    // 기기 글은 구글 로그인 뒤 10분 안만 믿는다 (첫 로그인 흐름이 아닌 오래된 화면 · 다시 시도가 계정 기록을 덮지 않게)
    if (importReq && importReq.device !== null && ctx.now() / 1000 - s.loginSec > IMPORT_WINDOW_SEC) {
      sendError(res, 403, 'relogin');
      return;
    }
    if (!(await service.ensureReady())) {
      sendError(res, 503, 'db');
      return;
    }
    const id = s.accountId;
    const out =
      op === 'import' && importReq
        ? await service.importDevice(id, importReq)
        : op === 'costume' && costumeReq
          ? await service.costume(id, costumeReq)
          : op === 'claim-login'
            ? await service.claimLogin(id)
            : { deleted: await service.delete(id) };
    if (op === 'delete') {
      sendJson(res, 200, out, [clearSession(o)]);
      return;
    }
    if (out === null) {
      sendError(res, 401, 'auth', [clearSession(o)]);
      return;
    }
    sendJson(res, 200, out);
  }

  async function api(sub: string, req: IncomingMessage, res: ServerResponse, o: Origin): Promise<void> {
    if (sub === '') {
      if (req.method !== 'GET' && req.method !== 'HEAD') sendError(res, 405, on ? 'bad-request' : 'off');
      else await status(req, res, o);
      return;
    }
    const op = API_OPS.find((x) => x === sub);
    if (!on) {
      sendError(res, 404, 'off');
      return;
    }
    if (!op) {
      sendError(res, 404, 'bad-request');
      return;
    }
    if (req.method !== 'POST') {
      sendError(res, 405, 'bad-request');
      return;
    }
    await apiPost(op, req, res, o);
  }

  // ───────── 구글 로그인 ─────────

  function authStart(req: IncomingMessage, res: ServerResponse, url: URL, o: Origin): void {
    if (!on || !cfg.enabled) {
      redirect(res, 302, `/?${LOGIN_RESULT_PARAM}=off`);
      return;
    }
    const state = randomToken();
    const nonce = randomToken();
    const next = url.searchParams.get('next') === 'delete' ? 'delete' : 'home';
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: `${o.origin}${AUTH_CALLBACK_PATH}`,
      response_type: 'id_token',
      response_mode: 'form_post',
      scope: 'openid',
      state,
      nonce,
      prompt: 'select_account',
    });
    let target = `${GOOGLE_AUTH_URL}?${params.toString()}`;
    if (ctx.testIdp) {
      // 가짜 구글: 시험이 고른 sub · 나쁜 토큰 · 취소를 넘겨 준다
      for (const k of ['test_sub', 'test_token', 'test_error']) {
        const v = url.searchParams.get(k);
        if (v !== null) params.set(k, v);
      }
      target = `${TEST_AUTHORIZE_PATH}?${params.toString()}`;
    }
    redirect(res, 302, target, [oauthCookie(`${state}.${nonce}.${next}`, o)]);
  }

  async function authCallback(req: IncomingMessage, res: ServerResponse, o: Origin): Promise<void> {
    const done = (result: LoginResult | 'delete' | 'delete-none', cookies: readonly string[] = []): void =>
      redirect(
        res,
        303,
        result === 'delete'
          ? ACCOUNT_DELETE_PATH
          : result === 'delete-none'
            ? `${ACCOUNT_DELETE_PATH}?${DELETE_NONE_PARAM}=1`
            : `/?${LOGIN_RESULT_PARAM}=${result}`,
        [clearOauth(o), ...cookies],
      );
    const service = ctx.service;
    if (!on || !service || !cfg.enabled || !ctx.keys) {
      done('off');
      return;
    }
    if (req.method !== 'POST') {
      done('fail');
      return;
    }
    const body = await readBody(req, CALLBACK_BODY_MAX);
    if (!body.ok) {
      ctx.log('로그인 실패: 본문');
      done('fail');
      return;
    }
    const form = new URLSearchParams(body.text);
    if (form.has('error')) {
      done('cancel');
      return;
    }
    const saved = parseOauthCookie(readCookie(req.headers.cookie, OAUTH_COOKIE));
    if (!saved) {
      ctx.log('로그인 실패: state 쿠키 없음');
      done('fail');
      return;
    }
    if (!safeEqual(form.get('state') ?? '', saved.state)) {
      ctx.log('로그인 실패: state');
      done('fail');
      return;
    }
    const check = await verifyIdToken(form.get('id_token'), {
      clientId: cfg.clientId,
      nonce: saved.nonce,
      nowMs: ctx.now(),
      keys: ctx.keys,
    });
    if (!check.ok) {
      ctx.log(`로그인 실패: 토큰 ${check.reason}`);
      done('fail');
      return;
    }
    if (!(await service.ensureReady())) {
      done('db');
      return;
    }
    const toDelete = saved.next === 'delete';
    let accountId: string | null;
    try {
      // 삭제 페이지에서 시작했으면 찾기만 한다 (없는 계정을 만들지 않는다)
      accountId = toDelete ? await service.find(check.sub) : await service.login(check.sub);
    } catch (err) {
      if (!(err instanceof AccountUnavailable)) throw err;
      done('db');
      return;
    }
    if (!accountId) done('delete-none');
    // 삭제 페이지: 게임 세션 대신 삭제 페이지 전용 쿠키 (게임 연결 · 계정 API에는 실리지 않는다)
    else if (toDelete) done('delete', [deleteCookie(accountId, o)]);
    else done('ok', [sessionCookie(accountId, o)]);
  }

  // ───────── 계정 삭제 페이지 ─────────

  /**
   * 삭제 페이지: 삭제 전용 쿠키(decoy_del)를 먼저, 없으면 게임 세션(decoy_sid)을 읽는다(CSRF 값도 그 쿠키 값으로). 삭제가 끝나거나
   * 401이면 두 쿠키를 모두 지운다. ?none=1(삭제 페이지 로그인 — 그 구글 계정으로 만든 계정 없음)이면 게임 세션이 있어도 그 안내
   */
  async function deletePage(req: IncomingMessage, res: ServerResponse, o: Origin, url: URL): Promise<void> {
    const page = (
      status: number,
      state: DeletePageState,
      cookies: readonly string[] = [],
      close = false,
    ): void => sendHtml(res, status, renderDeletePage(state, ctx.contact), 'same-origin', cookies, close);
    const service = ctx.service;
    if (!on || !service) {
      page(req.method === 'POST' ? 404 : 200, { kind: 'off' });
      return;
    }
    const get = req.method === 'GET' || req.method === 'HEAD';
    const del = deleteSessionOf(req);
    const none = get && !del && url.searchParams.get(DELETE_NONE_PARAM) === '1';
    const s = del ?? (none ? null : sessionOf(req));
    /** 남은 (끝난 · 위조) 쿠키 지우기 */
    const stale = (): string[] => [
      ...(hasSessionCookie(req) ? [clearSession(o)] : []),
      ...(readCookie(req.headers.cookie, DELETE_COOKIE) !== null ? [clearDelete(o)] : []),
    ];
    if (get) {
      if (none) {
        page(200, { kind: 'none' });
        return;
      }
      if (!s) {
        page(200, { kind: 'signed-out' }, stale());
        return;
      }
      if (!(await service.ensureReady())) {
        page(503, { kind: 'db' });
        return;
      }
      const st = await service.status(s.accountId);
      if (!st) {
        page(200, { kind: 'signed-out' }, [clearSession(o), clearDelete(o)]);
        return;
      }
      const p = st.profile === null ? emptyProfile(0) : parseProfile(st.profile, ctx.now()).profile;
      page(200, {
        kind: 'signed-in',
        level: levelOf(p.xp, PROGRESSION).level,
        played: p.played.survivor + p.played.monster,
        csrf: csrfFor(s.value, secret),
      });
      return;
    }
    if (req.method !== 'POST') {
      page(405, { kind: 'retry' });
      return;
    }
    if (!originMatchesHost(req)) {
      page(403, { kind: 'retry' });
      return;
    }
    if (!s) {
      page(401, { kind: 'signed-out' }, [clearSession(o), clearDelete(o)]);
      return;
    }
    if (!postRate.take(s.accountId)) {
      page(429, { kind: 'retry' });
      return;
    }
    const body = await readBody(req, SMALL_BODY_MAX);
    if (!body.ok) {
      page(body.status, { kind: 'retry' }, [], body.close);
      return;
    }
    const token = new URLSearchParams(body.text).get(DELETE_CSRF_FIELD) ?? '';
    if (!safeEqual(token, csrfFor(s.value, secret))) {
      page(403, { kind: 'retry' });
      return;
    }
    if (!(await service.ensureReady())) {
      page(503, { kind: 'db' });
      return;
    }
    const deleted = await service.delete(s.accountId);
    page(200, { kind: 'deleted', deleted }, [clearSession(o), clearDelete(o)]);
  }

  // ───────── 시험 훅 ─────────

  function testAuthorize(res: ServerResponse, url: URL, o: Origin): void {
    const idp = ctx.testIdp;
    if (!ctx.testHooks || !idp) {
      res.writeHead(404).end();
      return;
    }
    const q = url.searchParams;
    if (q.get('redirect_uri') !== `${o.origin}${AUTH_CALLBACK_PATH}` || q.get('client_id') !== idp.clientId) {
      sendText(res, 400, 'bad request');
      return;
    }
    const state = q.get('state') ?? '';
    const error = q.get('test_error');
    const flaw = q.get('test_token');
    const fields: Record<string, string> =
      error !== null
        ? { error: error.slice(0, 64), state }
        : {
            id_token: idp.idToken({
              sub: q.get('test_sub') ?? 'test-user',
              nonce: q.get('nonce') ?? '',
              nowMs: ctx.now(),
              flaw: isTestTokenFlaw(flaw) ? flaw : null,
            }),
            state,
          };
    res
      .writeHead(200, headersWith({ 'content-type': 'text/html; charset=utf-8' }, [], false))
      .end(testAuthorizePage(AUTH_CALLBACK_PATH, fields));
  }

  function testStore(res: ServerResponse, url: URL, list: boolean): void {
    const store = ctx.memoryStore;
    if (!ctx.testHooks || !store) {
      res.writeHead(404).end();
      return;
    }
    if (list) {
      sendJson(
        res,
        200,
        store.list().map((r) => ({ id: r.id, sub: r.sub, profile: r.profile })),
      );
      return;
    }
    const fail = url.searchParams.get('fail');
    if (fail === '1' || fail === '0') store.failing = fail === '1';
    sendJson(res, 200, { failing: store.failing });
  }

  // ───────── 나누기 ─────────

  async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname;
    const o = requestOrigin(req);
    if (!o) {
      sendText(res, 400, 'bad request');
      return;
    }
    if (path === TEST_AUTHORIZE_PATH) {
      testAuthorize(res, url, o);
      return;
    }
    if (path === TEST_STORE_PATH || path === TEST_ACCOUNTS_PATH) {
      testStore(res, url, path === TEST_ACCOUNTS_PATH);
      return;
    }
    if (path === API_ROOT || path.startsWith(`${API_ROOT}/`)) {
      await api(path.slice(API_ROOT.length + 1), req, res, o);
      return;
    }
    if (path.startsWith('/auth/')) {
      // 꺼짐이면 IP를 담지 않고 바로 off로 (authStart · authCallback이 먼저 꺼짐을 본다)
      if (on && !authRate.take(clientIp(req))) {
        sendText(res, 429, 'too many requests');
        return;
      }
      if (path === AUTH_START_PATH) authStart(req, res, url, o);
      else if (path === AUTH_CALLBACK_PATH) await authCallback(req, res, o);
      else sendText(res, 404, 'not found');
      return;
    }
    if (path === ACCOUNT_DELETE_PATH) {
      await deletePage(req, res, o, url);
      return;
    }
    sendText(res, 404, 'not found');
  }

  return (req, res, url) => {
    const path = url.pathname;
    const mine =
      path === API_ROOT ||
      path.startsWith(`${API_ROOT}/`) ||
      path.startsWith('/auth/') ||
      path.startsWith('/account/') ||
      path === TEST_AUTHORIZE_PATH ||
      path === TEST_STORE_PATH ||
      path === TEST_ACCOUNTS_PATH;
    if (!mine) return false;
    dispatch(req, res, url).catch((err: unknown) => {
      // 저장소 장애는 503 db (계정 요청만 — 판은 그대로). 그 밖의 오류는 종류만 남긴다
      const unavailable = err instanceof AccountUnavailable;
      const bad = err instanceof AccountBadRequest;
      if (!unavailable && !bad)
        ctx.log(`계정 요청 처리 오류: ${err instanceof Error ? err.name : 'unknown'}`);
      if (res.headersSent) {
        res.end();
        return;
      }
      if (path === ACCOUNT_DELETE_PATH) {
        sendHtml(
          res,
          unavailable ? 503 : 500,
          renderDeletePage({ kind: unavailable ? 'db' : 'retry' }, ctx.contact),
          'same-origin',
        );
        return;
      }
      const origin = requestOrigin(req);
      if (path === AUTH_CALLBACK_PATH && origin) {
        redirect(res, 303, `/?${LOGIN_RESULT_PARAM}=${unavailable ? 'db' : 'fail'}`, [clearOauth(origin)]);
        return;
      }
      sendError(res, bad ? 400 : unavailable ? 503 : 500, bad ? 'bad-request' : 'db');
    });
    return true;
  };
}
