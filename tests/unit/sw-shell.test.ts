// M13d 서비스 워커 결정표: client/public/sw.js를 node:vm에서 가짜 캐시 · fetch · 타이머로 돌린다
//  서버 응답 / 오프라인 → 앱 셸 / 5초 초과 → wake.html / 표시 없는 응답 → wake.html / ?practice=1 캐시 먼저 /
//  /privacy 네트워크 먼저 + 같은 빌드면 셸 사본 갱신, 실패 · 느림 · 표시 없음이면 셸 사본 /
//  자산 캐시 우선 / 제외 경로 / JS 자리에 HTML이 오면 설치 실패 / 빌드 헤더가 다르면 설치 실패 / 사전 캐시는 'no-cache' 재검증 /
//  새 빌드면 바로 앞 빌드 셸 하나만 남기고 더 옛 decoy-shell-*를 정리 · 옛 화면의 옛 조각(assets/)은 앞 빌드 셸에서 /
//  dist의 새 파일이 셸 목록에 자동 포함(icons/ · 미리 압축한 .br · .gz 제외) /
//  로그인 · 계정 경로(/api/ · /auth/ · /account/ — 공용 ACCOUNT_PASS_PREFIXES)는 가로채지 않음
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  PRECOMPRESS_EXT,
  PRECOMPRESS_MIN_BYTES,
  SHELL_EXCLUDE,
  SHELL_EXCLUDE_PREFIX,
  listShellFiles,
  precompressDist,
  swWithBuild,
} from '../../client/shellBuild';
import { COMPRESSIBLE_EXT, GZIP_MIN_BYTES } from '../../server/src/static';
import {
  ACCOUNT_API,
  ACCOUNT_DELETE_PATH,
  ACCOUNT_PASS_PREFIXES,
  AUTH_START_PATH,
} from '../../shared/src/account';

const ORIGIN = 'https://decoy.test';
const SW_SOURCE = readFileSync('client/public/sw.js', 'utf8');
const SHELL = ['index.html', 'assets/index-a1.js', 'assets/index-a1.css', 'fonts/ui.woff2', 'logo.svg'];

class FakeCache {
  readonly store = new Map<string, Response>();
  constructor(private readonly fetcher: (req: Request) => Promise<Response>) {}
  /**
   * 실제 Cache.put처럼 본문을 다 읽어 저장하고, 이미 읽힌 본문이면 TypeError (수정 검토: clone()만 저장하면 sw.js가 화면으로 보낸
   * 응답을 복제하지 않고 넘기는 회귀 — 처리방침 사본이 조용히 갱신되지 않음 — 를 잡지 못했다)
   */
  async put(req: string | Request, res: Response): Promise<void> {
    if (res.bodyUsed) throw new TypeError('Cache.put: 이미 읽힌 응답 본문');
    const body = await res.arrayBuffer();
    const stored = new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    this.store.set(typeof req === 'string' ? req : req.url, stored);
  }
  async add(req: string | Request): Promise<void> {
    const r = typeof req === 'string' ? new Request(req) : req;
    const res = await this.fetcher(r);
    if (!res.ok) throw new Error(`add 실패 ${r.url}`);
    await this.put(r, res);
  }
  async match(req: string | Request, opts?: { ignoreSearch?: boolean }): Promise<Response | undefined> {
    let url = typeof req === 'string' ? req : req.url;
    if (opts?.ignoreSearch) url = url.split('?')[0] ?? url;
    return this.store.get(url)?.clone();
  }
}

class FakeCaches {
  readonly caches = new Map<string, FakeCache>();
  constructor(private readonly fetcher: (req: Request) => Promise<Response>) {}
  async open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new FakeCache(this.fetcher);
      this.caches.set(name, c);
    }
    return c;
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
  async match(req: string | Request): Promise<Response | undefined> {
    for (const c of this.caches.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

type Handler = (e: unknown) => void;
type Route = (req: Request) => Promise<Response> | Response;

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  woff2: 'font/woff2',
  svg: 'image/svg+xml',
};

/** 이 서버의 정상 응답 (표시 헤더 + 빌드 헤더 + 확장자에 맞는 content-type) */
function serverResponse(url: string, build: string, body = 'ok', type?: string): Response {
  const ext = /\.([a-z0-9]+)$/.exec(new URL(url).pathname)?.[1] ?? 'html';
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': type ?? TYPES[ext] ?? 'text/html',
      'x-decoy-server': '1',
      'x-decoy-build': build,
    },
  });
}

interface Worker {
  caches: FakeCaches;
  netCalls: string[];
  /** 네트워크로 간 요청의 경로와 HTTP 캐시 방식 (Request.cache) */
  netModes: { path: string; cache: RequestCache }[];
  setRoute(r: Route): void;
  install(): Promise<void>;
  activate(): Promise<void>;
  /** fetch 이벤트: 가로채면 응답, 아니면 null */
  fetch(url: string, mode?: 'navigate' | 'no-cors'): Promise<Response | null>;
  /** fetch 이벤트들이 waitUntil로 맡긴 뒷일(늦은 응답 · 사본 갱신)이 모두 끝날 때까지 */
  settle(): Promise<void>;
  /** 걸려 있는 setTimeout(5초 대기)을 모두 실행 */
  fireTimers(): void;
}

function loadWorker(build: string | null, shell: readonly string[] = SHELL, shared?: FakeCaches): Worker {
  const handlers = new Map<string, Handler>();
  const netCalls: string[] = [];
  const netModes: { path: string; cache: RequestCache }[] = [];
  const pendingWork: Promise<unknown>[] = [];
  let route: Route = (req) => serverResponse(req.url, build ?? 'none');
  const fetcher = async (req: Request): Promise<Response> => {
    netCalls.push(new URL(req.url).pathname + new URL(req.url).search);
    netModes.push({ path: new URL(req.url).pathname, cache: req.cache });
    return route(req);
  };
  const caches = shared ?? new FakeCaches(fetcher);
  // 공유 캐시 저장소를 쓰는 새 워커도 자기 fetch를 쓰게
  (caches as unknown as { fetcher: typeof fetcher }).fetcher = fetcher;
  const timers: (() => void)[] = [];
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, h: Handler) => handlers.set(type, h),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const source = build ? swWithBuild(SW_SOURCE, build, shell) : SW_SOURCE;
  const ctx = vm.createContext({
    self,
    caches,
    fetch: (input: string | Request) => fetcher(typeof input === 'string' ? new Request(input) : input),
    Request,
    Response,
    URL,
    Promise,
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    console,
  });
  vm.runInContext(source, ctx);
  const lifecycle = async (type: string): Promise<void> => {
    const waits: Promise<unknown>[] = [];
    handlers.get(type)?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return {
    caches,
    netCalls,
    netModes,
    setRoute: (r) => {
      route = r;
    },
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    fireTimers: () => {
      for (const t of timers.splice(0)) t();
    },
    fetch: async (url, mode = 'navigate') => {
      let responded: Promise<Response> | null = null;
      const request = new Request(`${ORIGIN}${url}`, mode === 'navigate' ? {} : {});
      Object.defineProperty(request, 'mode', { value: mode });
      handlers.get('fetch')?.({
        request,
        respondWith: (p: Promise<Response>) => {
          responded = p;
        },
        waitUntil: (p: Promise<unknown>) => pendingWork.push(p),
      });
      return responded;
    },
    settle: async () => {
      await Promise.all(pendingWork.splice(0));
    },
  };
}

async function text(res: Response | null): Promise<string> {
  return res ? res.text() : '(가로채지 않음)';
}

describe('앱 셸 사전 캐시 (설치)', () => {
  it('셸 목록을 모두 받아 decoy-shell-<빌드>에 넣는다 (깨우기 화면은 따로)', async () => {
    const w = loadWorker('b1');
    await w.install();
    const shell = w.caches.caches.get('decoy-shell-b1');
    expect([...(shell?.store.keys() ?? [])].sort()).toEqual(SHELL.map((p) => `${ORIGIN}/${p}`).sort());
    expect(w.caches.caches.get('decoy-wake-v2')?.store.has(`${ORIGIN}/wake.html`)).toBe(true);
  });

  it('JS 자리에 HTML이 오면(배포 전환 중 등) 설치가 실패하고 셸 캐시를 만들지 않는다', async () => {
    const w = loadWorker('b1');
    w.setRoute((req) =>
      req.url.endsWith('.js')
        ? serverResponse(req.url, 'b1', '<html>', 'text/html; charset=utf-8')
        : serverResponse(req.url, 'b1'),
    );
    await expect(w.install()).rejects.toThrow(/앱 셸 사전 캐시 실패: assets\/index-a1\.js/);
    expect(w.caches.caches.has('decoy-shell-b1')).toBe(false);
  });

  it('빌드 헤더가 다르거나(다른 빌드 서버) 응답이 200이 아니면 설치 실패', async () => {
    const other = loadWorker('b1');
    other.setRoute((req) => serverResponse(req.url, 'b2'));
    await expect(other.install()).rejects.toThrow(/앱 셸 사전 캐시 실패/);
    const missing = loadWorker('b1');
    missing.setRoute((req) =>
      req.url.endsWith('.css') ? new Response('not found', { status: 404 }) : serverResponse(req.url, 'b1'),
    );
    await expect(missing.install()).rejects.toThrow(/index-a1\.css/);
  });

  it("사전 캐시는 'no-cache'(조건부 재검증)로 받는다 — 페이지가 방금 받은 파일을 'reload'로 다시 받지 않게", async () => {
    const w = loadWorker('b1');
    await w.install();
    const shellPaths = new Set(SHELL.map((p) => `/${p}`));
    const precache = w.netModes.filter((m) => shellPaths.has(m.path));
    expect(precache.map((m) => m.path).sort()).toEqual([...shellPaths].sort());
    for (const m of precache) expect(m.cache, m.path).toBe('no-cache');
  });

  it('빌드하지 않은 원본(BUILD null)은 셸 없이 깨우기 화면만', async () => {
    const w = loadWorker(null);
    await w.install();
    expect([...w.caches.caches.keys()]).toEqual(['decoy-wake-v2']);
  });
});

describe('페이지 이동 세 갈래', () => {
  async function installed(): Promise<Worker> {
    const w = loadWorker('b1');
    await w.install();
    w.setRoute((req) => serverResponse(req.url, 'b1', 'fresh'));
    return w;
  }

  it('5초 안에 이 서버가 답하면 그 응답 그대로', async () => {
    const w = await installed();
    const res = await w.fetch('/?room=ABCD');
    expect(res?.headers.get('x-decoy-server')).toBe('1');
    expect(await text(res)).toBe('fresh');
  });

  it('네트워크 자체가 실패(오프라인 · 서버 꺼짐)하면 캐시한 앱 셸 index.html', async () => {
    const w = await installed();
    w.setRoute(() => Promise.reject(new TypeError('Failed to fetch')));
    const res = await w.fetch('/');
    expect(await text(res)).toBe('ok');
    expect(res?.headers.get('content-type')).toContain('text/html');
    expect(res?.headers.get('x-decoy-build')).toBe('b1');
  });

  it('5초 넘게 답이 없으면 깨우기 화면', async () => {
    const w = await installed();
    // 앱 셸(index.html, 본문 'ok')과 구별되게 깨우기 화면 본문을 바꿔 둔다
    await w.caches.caches
      .get('decoy-wake-v2')
      ?.put(`${ORIGIN}/wake.html`, new Response('WAKE', { headers: { 'content-type': 'text/html' } }));
    w.setRoute(() => new Promise<Response>(() => {}));
    const pending = w.fetch('/');
    await new Promise((r) => setTimeout(r, 5));
    w.fireTimers();
    expect(await text(await pending)).toBe('WAKE');
  });

  it('표시 없는 응답(잠든 Render의 503 대기 화면)이면 깨우기 화면, 앱 셸이 아니다', async () => {
    const w = await installed();
    const wakeCache = w.caches.caches.get('decoy-wake-v2');
    await wakeCache?.put(
      `${ORIGIN}/wake.html`,
      new Response('WAKE', { headers: { 'content-type': 'text/html' } }),
    );
    w.setRoute(() => new Response('Service waking up', { status: 503 }));
    expect(await text(await w.fetch('/'))).toBe('WAKE');
    w.setRoute(() => Promise.reject(new TypeError('offline')));
    expect(await text(await w.fetch('/'))).toBe('ok');
  });

  it('?practice=1은 네트워크를 기다리지 않고 앱 셸 (잠든 서버에서 봇과 연습)', async () => {
    const w = await installed();
    w.setRoute(() => new Promise<Response>(() => {}));
    const before = w.netCalls.length;
    const res = await w.fetch('/?practice=1');
    expect(await text(res)).toBe('ok');
    expect(w.netCalls.length).toBe(before);
  });

  it('/ws · /healthz · /test/* · /.well-known/*는 가로채지 않는다', async () => {
    const w = await installed();
    for (const p of ['/ws', '/healthz', '/test/state?room=AB', '/.well-known/assetlinks.json'])
      expect(await w.fetch(p, 'no-cors'), p).toBeNull();
    for (const p of ['/healthz', '/test/stall']) expect(await w.fetch(p), p).toBeNull();
  });
});

describe('로그인 · 계정 요청은 가로채지 않는다 (선택형 구글 로그인)', () => {
  it('sw.js PASS가 공용 ACCOUNT_PASS_PREFIXES(/api/ · /auth/ · /account/)를 모두 담는다', () => {
    const m = /const PASS = (\[[^\]]*\]);/.exec(SW_SOURCE);
    const pass = JSON.parse((m?.[1] ?? '[]').replace(/'/g, '"')) as string[];
    expect(pass.length).toBeGreaterThan(0);
    for (const p of ACCOUNT_PASS_PREFIXES) expect(pass, p).toContain(p);
  });

  it('구글 로그인 시작(페이지 이동)이 잠든 서버 · 오프라인에서도 깨우기 화면 · 앱 셸로 바뀌지 않고, 계정 API · 삭제 페이지도 캐시 없이 네트워크로', async () => {
    const w = loadWorker('b1');
    await w.install();
    await w.caches.caches
      .get('decoy-wake-v2')
      ?.put(`${ORIGIN}/wake.html`, new Response('WAKE', { headers: { 'content-type': 'text/html' } }));
    // 잠든 서버(표시 없는 응답) · 오프라인 어느 쪽이든 워커는 손대지 않는다 (가로채면 WAKE · 앱 셸이 나왔다)
    for (const route of [
      () => new Response('Service waking up', { status: 503 }),
      () => Promise.reject(new TypeError('offline')),
    ]) {
      w.setRoute(route);
      for (const p of [AUTH_START_PATH, `${AUTH_START_PATH}?next=delete`, ACCOUNT_DELETE_PATH])
        expect(await w.fetch(p), p).toBeNull();
      expect(await w.fetch(ACCOUNT_API.status, 'no-cors')).toBeNull();
    }
    // 앞부분이 같은 다른 경로는 그대로 앱 셸 갈래 (지나치게 넓게 비키지 않는다)
    w.setRoute(() => Promise.reject(new TypeError('offline')));
    expect(await text(await w.fetch('/accounting'))).toBe('ok');
  });
});

describe('처리방침 /privacy (네트워크 먼저 + 셸 사본)', () => {
  /** b1로 설치(처리방침 본문 CONTACT=default)한 워커 */
  async function installedPrivacy(): Promise<Worker> {
    const w = loadWorker('b1', [...SHELL, 'privacy.html']);
    w.setRoute((req) =>
      serverResponse(req.url, 'b1', req.url.endsWith('/privacy.html') ? 'CONTACT=default' : 'ok'),
    );
    await w.install();
    return w;
  }

  /** 서버가 같은 빌드 b1에서 이 본문을 낸다 (/privacy · /privacy.html 모두) */
  const privacyServer =
    (body: string, build = 'b1'): Route =>
    (req) =>
      serverResponse(req.url, build, body, 'text/html; charset=utf-8');

  async function shellCopy(w: Worker): Promise<string> {
    return text((await w.caches.caches.get('decoy-shell-b1')?.match(`${ORIGIN}/privacy.html`)) ?? null);
  }

  it('같은 빌드에서 문의처만 바뀌면(환경 변수만 바꾼 재배포) 그 열람에 새 본문, 셸 사본도 새 본문 → 오프라인이면 갱신된 사본', async () => {
    const w = await installedPrivacy();
    expect(await shellCopy(w)).toBe('CONTACT=default');
    w.setRoute(privacyServer('CONTACT=me@x.y'));
    expect(await text(await w.fetch('/privacy'))).toBe('CONTACT=me@x.y');
    await w.settle();
    expect(await shellCopy(w)).toBe('CONTACT=me@x.y');
    w.setRoute(() => Promise.reject(new TypeError('offline')));
    expect(await text(await w.fetch('/privacy'))).toBe('CONTACT=me@x.y');
    expect(await text(await w.fetch('/privacy.html'))).toBe('CONTACT=me@x.y');
  });

  it('다른 빌드 · 오류 응답은 그대로 보여 주되 셸 사본을 바꾸지 않는다', async () => {
    const w = await installedPrivacy();
    w.setRoute(privacyServer('CONTACT=new-build', 'b2'));
    expect(await text(await w.fetch('/privacy'))).toBe('CONTACT=new-build');
    // 이 서버 · 같은 빌드지만 오류 응답
    w.setRoute(
      () =>
        new Response('oops', {
          status: 500,
          headers: { 'content-type': 'text/html', 'x-decoy-server': '1', 'x-decoy-build': 'b1' },
        }),
    );
    expect(await text(await w.fetch('/privacy'))).toBe('oops');
    await w.settle();
    expect(await shellCopy(w)).toBe('CONTACT=default');
  });

  it('실패 · 5초 넘게 답 없음 · 표시 없는 응답이면 깨우기 화면이 아니라 셸 사본', async () => {
    const w = await installedPrivacy();
    await w.caches.caches
      .get('decoy-wake-v2')
      ?.put(`${ORIGIN}/wake.html`, new Response('WAKE', { headers: { 'content-type': 'text/html' } }));
    // 표시 없는 응답 (잠든 Render의 대기 화면)
    w.setRoute(() => new Response('Service waking up', { status: 503 }));
    expect(await text(await w.fetch('/privacy'))).toBe('CONTACT=default');
    // 네트워크 실패
    w.setRoute(() => Promise.reject(new TypeError('offline')));
    expect(await text(await w.fetch('/privacy'))).toBe('CONTACT=default');
    await w.settle();
    expect(await shellCopy(w)).toBe('CONTACT=default');
    // 5초 넘게 답이 없다 (끝나지 않는 요청이라 뒷일은 기다리지 않는다)
    w.setRoute(() => new Promise<Response>(() => {}));
    const pending = w.fetch('/privacy');
    await new Promise((r) => setTimeout(r, 5));
    w.fireTimers();
    expect(await text(await pending)).toBe('CONTACT=default');
  });
});

describe('자산 · 업데이트', () => {
  it('셸에 있는 자산은 캐시 먼저(네트워크 안 감), 없는 자산은 네트워크', async () => {
    const w = loadWorker('b1');
    await w.install();
    w.setRoute(() => Promise.reject(new TypeError('offline')));
    const before = w.netCalls.length;
    expect(await text(await w.fetch('/assets/index-a1.js', 'no-cors'))).toBe('ok');
    expect(w.netCalls.length).toBe(before);
    // 셸에 없는 자산은 네트워크로 간다 (오프라인이면 그대로 네트워크 오류)
    await expect(w.fetch('/assets/index-zz.js', 'no-cors')).rejects.toThrow(/offline/);
    expect(w.netCalls.at(-1)).toBe('/assets/index-zz.js');
  });

  it('새 빌드 워커가 켜지면 바로 앞 빌드 셸 하나만 남기고 더 옛 셸 · 옛 깨우기 캐시를 지운다, 다른 캐시는 그대로', async () => {
    const first = loadWorker('b1');
    await first.install();
    await first.activate();
    await first.caches.open('decoy-wake-v1');
    await first.caches.open('someone-else');
    const next = loadWorker('b2', ['index.html', 'assets/index-b2.js'], first.caches);
    await next.install();
    await next.activate();
    expect((await next.caches.keys()).sort()).toEqual([
      'decoy-shell-b1',
      'decoy-shell-b2',
      'decoy-wake-v2',
      'someone-else',
    ]);
    // 새 셸에는 새 빌드 자산만 (섞이지 않는다)
    expect([...(next.caches.caches.get('decoy-shell-b2')?.store.keys() ?? [])].sort()).toEqual([
      `${ORIGIN}/assets/index-b2.js`,
      `${ORIGIN}/index.html`,
    ]);
    // 한 번 더 배포: 바로 앞(b2)만 남고 b1은 지운다
    const third = loadWorker('b3', ['index.html', 'assets/index-b3.js'], first.caches);
    await third.install();
    await third.activate();
    expect((await third.caches.keys()).sort()).toEqual([
      'decoy-shell-b2',
      'decoy-shell-b3',
      'decoy-wake-v2',
      'someone-else',
    ]);
  });

  it('배포 직후 옛 화면이 찾는 옛 조각(assets/)은 앞 빌드 셸에서 준다 — 새 서버에는 없다(404)', async () => {
    const first = loadWorker('b1', [...SHELL, 'assets/settingsPanel-a1.js']);
    await first.install();
    await first.activate();
    const next = loadWorker(
      'b2',
      ['index.html', 'assets/index-b2.js', 'assets/settingsPanel-b2.js'],
      first.caches,
    );
    await next.install();
    await next.activate();
    // 새 서버: 옛 빌드 파일은 404
    next.setRoute((req) =>
      new URL(req.url).pathname.includes('-a1.')
        ? new Response('not found', { status: 404 })
        : serverResponse(req.url, 'b2'),
    );
    const before = next.netCalls.length;
    const old = await next.fetch('/assets/settingsPanel-a1.js', 'no-cors');
    expect(old?.status).toBe(200);
    expect(old?.headers.get('x-decoy-build')).toBe('b1');
    expect(next.netCalls.length).toBe(before);
    // 새 빌드 조각은 새 셸에서
    expect((await next.fetch('/assets/settingsPanel-b2.js', 'no-cors'))?.headers.get('x-decoy-build')).toBe(
      'b2',
    );
    // assets/ 밖(이름에 해시 없음)은 앞 빌드 셸에서 주지 않는다: 지금 셸에 없으면 네트워크
    const logo = await next.fetch('/logo.svg', 'no-cors');
    expect(next.netCalls.at(-1)).toBe('/logo.svg');
    expect(logo?.headers.get('x-decoy-build')).toBe('b2');
    // 앞 빌드 셸에도 없는 자산은 네트워크 (404 그대로 — 화면의 조각 실패 대처로 간다)
    expect((await next.fetch('/assets/hub-a1.js', 'no-cors'))?.status).toBe(404);
  });
});

describe('셸 목록 만들기 (Vite 플러그인)', () => {
  it('dist의 모든 파일(새 파일 포함)이 들어가고 sw.js · wake.html · build-id.json · icons/는 빠진다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decoy-dist-'));
    try {
      for (const f of ['index.html', 'sw.js', 'wake.html', 'build-id.json', 'logo.svg'])
        writeFileSync(join(dir, f), 'x');
      mkdirSync(join(dir, 'assets'));
      mkdirSync(join(dir, 'icons'));
      writeFileSync(join(dir, 'assets', 'index-a.js'), 'x');
      writeFileSync(join(dir, 'icons', 'icon-192.png'), 'x');
      writeFileSync(join(dir, 'icons', 'maskable-512.png'), 'x');
      writeFileSync(join(dir, 'privacy.html'), 'x');
      writeFileSync(join(dir, 'manifest.webmanifest'), 'x');
      // 미리 압축한 사본은 셸에 넣지 않는다 (워커는 원본 주소로 받고 브라우저가 풀어 둔다)
      writeFileSync(join(dir, 'assets', 'index-a.js.br'), 'x');
      writeFileSync(join(dir, 'assets', 'index-a.js.gz'), 'x');
      writeFileSync(join(dir, 'index.html.br'), 'x');
      expect(listShellFiles(dir)).toEqual([
        'assets/index-a.js',
        'index.html',
        'logo.svg',
        'manifest.webmanifest',
        'privacy.html',
      ]);
      expect(SHELL_EXCLUDE).toEqual(['sw.js', 'wake.html', 'build-id.json']);
      // manifest 아이콘은 화면 · 오프라인 진입이 쓰지 않는다 (설치 때 브라우저 · OS가 받고, TWA는 APK 안의 것)
      expect(SHELL_EXCLUDE_PREFIX).toEqual(['icons/']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('미리 압축: 텍스트 자산(256B 이상)마다 .br · .gz 사본, 풀면 원본과 같다. png · woff2 · 작은 파일 · 사본은 건너뛴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decoy-dist-'));
    try {
      const js = `export const decoy = 1;\n${'const a = "생존자 셋과 괴물 하나";\n'.repeat(200)}`;
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'assets', 'index-a.js'), js);
      writeFileSync(join(dir, 'index.html'), `<!doctype html>${'<p>DECOY</p>'.repeat(100)}`);
      writeFileSync(join(dir, 'sw.js'), `const SHELL = [];\n${'// 셸\n'.repeat(100)}`);
      writeFileSync(join(dir, 'build-id.json'), '{"id":"abc"}');
      writeFileSync(join(dir, 'logo.png'), Buffer.alloc(4000, 0));
      writeFileSync(join(dir, 'ui.woff2'), Buffer.alloc(4000, 7));
      const n = precompressDist(dir);
      const files = readdirSync(dir, { recursive: true }).map(String).sort();
      expect(files.filter((f) => /\.(br|gz)$/.test(f))).toEqual([
        join('assets', 'index-a.js.br'),
        join('assets', 'index-a.js.gz'),
        'index.html.br',
        'index.html.gz',
        'sw.js.br',
        'sw.js.gz',
      ]);
      expect(n).toBe(6);
      const raw = readFileSync(join(dir, 'assets', 'index-a.js'));
      expect(brotliDecompressSync(readFileSync(join(dir, 'assets', 'index-a.js.br'))).equals(raw)).toBe(true);
      expect(gunzipSync(readFileSync(join(dir, 'assets', 'index-a.js.gz'))).equals(raw)).toBe(true);
      // brotli가 gzip보다 작다 (같은 글)
      expect(readFileSync(join(dir, 'assets', 'index-a.js.br')).length).toBeLessThan(
        readFileSync(join(dir, 'assets', 'index-a.js.gz')).length,
      );
      // 두 번 불러도 사본의 사본을 만들지 않는다
      precompressDist(dir);
      expect(
        readdirSync(dir, { recursive: true })
          .map(String)
          .filter((f) => /\.(br|gz)\.(br|gz)$/.test(f)),
      ).toEqual([]);
      // 서버가 압축해 보내는 확장자 · 최소 크기와 같다
      expect([...PRECOMPRESS_EXT].sort()).toEqual([...COMPRESSIBLE_EXT].sort());
      expect(PRECOMPRESS_MIN_BYTES).toBe(GZIP_MIN_BYTES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sw.js 자리 표시 두 줄을 바꾸고, 자리 표시가 없으면 빌드를 멈춘다', () => {
    const out = swWithBuild(SW_SOURCE, 'abc123', ['index.html']);
    expect(out).toContain('const BUILD = "abc123";');
    expect(out).toContain('const SHELL = ["index.html"];');
    expect(out).not.toContain('const BUILD = null;');
    expect(() => swWithBuild('const X = 1;', 'abc123', [])).toThrow(/자리 표시/);
  });
});
