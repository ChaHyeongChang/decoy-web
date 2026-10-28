// 계정 경로 시험 도우미 (선택형 구글 로그인): 계정 기능 묶음(server/src/account/system.ts)을 실제 http 서버(0번 포트)에 얹어
// fetch로 두드린다. 쿠키 상자 · 가짜 구글 로그인 흐름(start → /test/google/authorize → callback)도 여기
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createAccountSystem,
  type AccountSystem,
  type AccountSystemOptions,
} from '../../server/src/account/system';

export const TEST_SECRET = 'test-session-secret-0123456789abcdef-xyz';
export const TEST_CLIENT_ID = 'decoy-test-client';

/** 로그인 켜짐 + 메모리 저장소 + 가짜 구글 (시험 훅 모드) */
export const LOGIN_ENV: Readonly<Record<string, string>> = {
  DECOY_LOGIN: '1',
  GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
  DECOY_SESSION_SECRET: TEST_SECRET,
  DECOY_ACCOUNT_STORE: 'memory',
};

/** 계정 경로를 두드릴 서버 주소 (시험 안 http 서버 · 실제 서버 프로세스) */
export interface AccountEndpoint {
  base: string;
  /** 서버가 보는 출처 (Origin 머리로 쓴다) */
  origin: string;
}

export interface AccountTestServer extends AccountEndpoint {
  system: AccountSystem;
  logs: string[];
  close(): Promise<void>;
}

export async function startAccountServer(
  opts: Partial<Omit<AccountSystemOptions, 'log'>> = {},
): Promise<AccountTestServer> {
  const logs: string[] = [];
  const system = createAccountSystem({
    env: opts.env ?? LOGIN_ENV,
    testHooks: opts.testHooks ?? true,
    dev: opts.dev ?? false,
    contact: opts.contact ?? null,
    now: opts.now,
    store: opts.store,
    keys: opts.keys,
    service: opts.service,
    log: (m) => logs.push(m),
  });
  await system.start();
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // 계정 경로가 아니면 정적 파일 자리 (시험에서는 표시만)
    if (!system.handle(req, res, url)) res.writeHead(200, { 'x-static': '1' }).end('static');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    origin: base,
    system,
    logs,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** 아주 작은 쿠키 상자 (이름 → 값, Max-Age=0이면 지운다) */
export class CookieJar {
  readonly values = new Map<string, string>();

  store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = (pair ?? '').indexOf('=');
      if (eq < 0) continue;
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const gone = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (gone || value === '') this.values.delete(name);
      else this.values.set(name, value);
    }
  }

  header(): string {
    return [...this.values].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name: string): string | undefined {
    return this.values.get(name);
  }
}

/** Set-Cookie 줄 가운데 이름이 맞는 것 */
export function setCookieLine(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((l) => l.startsWith(`${name}=`));
}

/** 숨은 입력 칸 (가짜 구글 페이지 · 삭제 페이지) */
export function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    out[m[1]!] = m[2]!
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
  }
  return out;
}

export interface LoginFlowOptions {
  sub?: string;
  next?: 'delete';
  /** 가짜 구글의 나쁜 토큰 · 취소 */
  testToken?: string;
  testError?: string;
  /** 콜백 직전에 form을 바꾼다 (state 바꾸기 등) */
  tamper?: (form: URLSearchParams) => void;
  /** 콜백에 oauth 쿠키를 싣지 않는다 */
  dropOauthCookie?: boolean;
  /** 비율 제한 열쇠 (x-forwarded-for). 없으면 부를 때마다 무작위 — 시험끼리 /auth 제한을 나눠 쓰지 않게 */
  ip?: string;
}

/** 무작위 사설 IP (비율 제한 열쇠) */
export function randomIp(): string {
  const n = (): number => Math.floor(Math.random() * 250) + 1;
  return `10.${n()}.${n()}.${n()}`;
}

/** 가짜 구글로 로그인 흐름 전체: start → authorize → callback. 콜백 응답(303)을 돌려준다 */
export async function loginFlow(
  srv: AccountEndpoint,
  jar: CookieJar,
  o: LoginFlowOptions = {},
): Promise<Response> {
  const q = new URLSearchParams();
  if (o.next) q.set('next', o.next);
  q.set('test_sub', o.sub ?? 'user-1');
  if (o.testToken) q.set('test_token', o.testToken);
  if (o.testError) q.set('test_error', o.testError);
  const ip = o.ip ?? randomIp();
  const start = await fetch(`${srv.base}/auth/google/start?${q}`, {
    redirect: 'manual',
    headers: { cookie: jar.header(), 'x-forwarded-for': ip },
  });
  if (start.status !== 302) throw new Error(`start ${start.status}`);
  jar.store(start);
  const authorize = await fetch(new URL(start.headers.get('location')!, srv.base), { redirect: 'manual' });
  if (authorize.status !== 200) throw new Error(`authorize ${authorize.status}`);
  const html = await authorize.text();
  const action = /<form method="post" action="([^"]+)"/.exec(html)?.[1];
  const form = new URLSearchParams(hiddenFields(html));
  o.tamper?.(form);
  const cookie = o.dropOauthCookie
    ? [...jar.values]
        .filter(([k]) => k !== 'decoy_oauth')
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    : jar.header();
  const cb = await fetch(new URL(action ?? '/auth/google/callback', srv.base), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, 'x-forwarded-for': ip },
    body: form.toString(),
  });
  jar.store(cb);
  return cb;
}

/** 계정 API POST (표시 헤더 · 같은 출처 Origin · 쿠키). headers의 값이 ''이면 그 머리를 빼고 보낸다 */
export function apiPost(
  srv: AccountEndpoint,
  jar: CookieJar,
  path: string,
  body: unknown = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  const all: Record<string, string> = {
    'content-type': 'application/json',
    'x-decoy-account': '1',
    origin: srv.origin,
    cookie: jar.header(),
    ...headers,
  };
  for (const [k, v] of Object.entries(all)) if (v === '') delete all[k];
  return fetch(`${srv.base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: all,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
