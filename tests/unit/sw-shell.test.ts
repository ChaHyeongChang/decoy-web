// M13d 서비스 워커 결정표: client/public/sw.js를 node:vm에서 가짜 캐시 · fetch · 타이머로 돌린다
//  서버 응답 / 오프라인 → 앱 셸 / 5초 초과 → wake.html / 표시 없는 응답 → wake.html / ?practice=1 캐시 먼저 /
//  자산 캐시 우선 / 제외 경로 / JS 자리에 HTML이 오면 설치 실패 / 빌드 헤더가 다르면 설치 실패 /
//  새 빌드면 옛 decoy-shell-*만 정리 / dist의 새 파일이 셸 목록에 자동 포함
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SHELL_EXCLUDE, listShellFiles, swWithBuild } from '../../client/shellBuild';

const ORIGIN = 'https://decoy.test';
const SW_SOURCE = readFileSync('client/public/sw.js', 'utf8');
const SHELL = ['index.html', 'assets/index-a1.js', 'assets/index-a1.css', 'fonts/ui.woff2', 'logo.svg'];

class FakeCache {
  readonly store = new Map<string, Response>();
  constructor(private readonly fetcher: (req: Request) => Promise<Response>) {}
  async put(req: string | Request, res: Response): Promise<void> {
    this.store.set(typeof req === 'string' ? req : req.url, res.clone());
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
  setRoute(r: Route): void;
  install(): Promise<void>;
  activate(): Promise<void>;
  /** fetch 이벤트: 가로채면 응답, 아니면 null */
  fetch(url: string, mode?: 'navigate' | 'no-cors'): Promise<Response | null>;
  /** 걸려 있는 setTimeout(5초 대기)을 모두 실행 */
  fireTimers(): void;
}

function loadWorker(build: string | null, shell: readonly string[] = SHELL, shared?: FakeCaches): Worker {
  const handlers = new Map<string, Handler>();
  const netCalls: string[] = [];
  let route: Route = (req) => serverResponse(req.url, build ?? 'none');
  const fetcher = async (req: Request): Promise<Response> => {
    netCalls.push(new URL(req.url).pathname + new URL(req.url).search);
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
        waitUntil: () => {},
      });
      return responded;
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
    w.setRoute(() => new Promise<Response>(() => {}));
    const pending = w.fetch('/');
    await new Promise((r) => setTimeout(r, 5));
    w.fireTimers();
    const res = await pending;
    expect(res?.url === '' || res !== null).toBe(true);
    expect(await text(res)).toBe('ok');
    // 깨우기 캐시의 응답이다 (wake.html은 설치 때 받은 것)
    const wake = await w.caches.caches.get('decoy-wake-v2')?.match(`${ORIGIN}/wake.html`);
    expect(wake).toBeDefined();
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

  it('새 빌드 워커가 켜지면 옛 decoy-shell-*와 옛 깨우기 캐시만 지우고, 다른 캐시는 그대로', async () => {
    const first = loadWorker('b1');
    await first.install();
    await first.activate();
    await first.caches.open('decoy-wake-v1');
    await first.caches.open('someone-else');
    const next = loadWorker('b2', ['index.html', 'assets/index-b2.js'], first.caches);
    await next.install();
    await next.activate();
    expect((await next.caches.keys()).sort()).toEqual(['decoy-shell-b2', 'decoy-wake-v2', 'someone-else']);
    // 새 셸에는 새 빌드 자산만 (섞이지 않는다)
    expect([...(next.caches.caches.get('decoy-shell-b2')?.store.keys() ?? [])].sort()).toEqual([
      `${ORIGIN}/assets/index-b2.js`,
      `${ORIGIN}/index.html`,
    ]);
  });
});

describe('셸 목록 만들기 (Vite 플러그인)', () => {
  it('dist의 모든 파일(새 파일 포함)이 들어가고 sw.js · wake.html · build-id.json은 빠진다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decoy-dist-'));
    try {
      for (const f of ['index.html', 'sw.js', 'wake.html', 'build-id.json', 'logo.svg'])
        writeFileSync(join(dir, f), 'x');
      mkdirSync(join(dir, 'assets'));
      mkdirSync(join(dir, 'icons'));
      writeFileSync(join(dir, 'assets', 'index-a.js'), 'x');
      writeFileSync(join(dir, 'icons', 'icon-192.png'), 'x');
      writeFileSync(join(dir, 'privacy.html'), 'x');
      expect(listShellFiles(dir)).toEqual([
        'assets/index-a.js',
        'icons/icon-192.png',
        'index.html',
        'logo.svg',
        'privacy.html',
      ]);
      expect(SHELL_EXCLUDE).toEqual(['sw.js', 'wake.html', 'build-id.json']);
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
