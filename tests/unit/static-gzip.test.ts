// M12 정적 파일 gzip (server/src/static.ts): 임시 폴더의 가짜 빌드로 실제 HTTP 서버를 띄워 본다.
// 텍스트 자산은 Accept-Encoding에 gzip이 있을 때만 압축(content-encoding · Vary), png · woff2는 그대로,
// 지금의 헤더(x-decoy-server) · 캐시 정책 · 경로 처리(없는 경로 → index.html) · 404는 그대로
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GZIP_MIN_BYTES,
  acceptsGzip,
  clearGzipCache,
  gzipCacheSize,
  isCompressible,
  serveStatic,
} from '../../server/src/static';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

let root = '';
let emptyRoot = '';
let server: Server;
let port = 0;

const JS = `// 가짜 번들\n${'export const decoy = "생존자 셋과 괴물 하나";\n'.repeat(400)}`;
const HTML = `<!doctype html><html><body>${'<p>DECOY</p>'.repeat(200)}</body></html>`;
const CSS = `body{color:#0b1622}\n${'.hud{display:flex}\n'.repeat(200)}`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg">${'<circle r="1"/>'.repeat(200)}</svg>`;
const MANIFEST = JSON.stringify({
  name: 'DECOY',
  icons: Array.from({ length: 30 }, (_, i) => ({ src: `i${i}.png` })),
});
/** PNG 머리 + 압축이 잘 되는 바이트 (그래도 압축하지 않아야 한다) */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(4000, 0),
]);
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(4000, 7)]);
const SMALL_JS = 'self.x=1;';

function get(path: string, acceptEncoding?: string, srvPort = port): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (acceptEncoding !== undefined) headers['accept-encoding'] = acceptEncoding;
    const req = request({ host: '127.0.0.1', port: srvPort, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

/** server/src/index.ts처럼: 표시 헤더를 먼저 붙이고 정적 파일로 넘긴다 */
function makeServer(dir: string): Server {
  return createServer((req, res) => {
    res.setHeader('x-decoy-server', '1');
    serveStatic(dir, new URL(req.url ?? '/', 'http://localhost'), res);
  });
}

async function listen(s: Server): Promise<number> {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return (s.address() as AddressInfo).port;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'decoy-static-'));
  emptyRoot = mkdtempSync(join(tmpdir(), 'decoy-static-empty-'));
  mkdirSync(join(root, 'assets'));
  mkdirSync(join(root, 'fonts'));
  writeFileSync(join(root, 'index.html'), HTML);
  writeFileSync(join(root, 'assets', 'index-abc123.js'), JS);
  writeFileSync(join(root, 'assets', 'index-abc123.css'), CSS);
  writeFileSync(join(root, 'assets', 'logo-abc.png'), PNG);
  writeFileSync(join(root, 'logo.svg'), SVG);
  writeFileSync(join(root, 'manifest.webmanifest'), MANIFEST);
  writeFileSync(join(root, 'fonts', 'ui.woff2'), WOFF2);
  writeFileSync(join(root, 'sw.js'), SMALL_JS);
  server = makeServer(root);
  port = await listen(server);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(root, { recursive: true, force: true });
  rmSync(emptyRoot, { recursive: true, force: true });
});

beforeEach(() => clearGzipCache());

describe('Accept-Encoding 해석', () => {
  it('gzip · x-gzip · 와일드카드, q=0은 거절', () => {
    expect(acceptsGzip('gzip, deflate, br')).toBe(true);
    expect(acceptsGzip('br;q=1.0, gzip;q=0.8, *;q=0.1')).toBe(true);
    expect(acceptsGzip('x-gzip')).toBe(true);
    expect(acceptsGzip('GZIP')).toBe(true);
    expect(acceptsGzip('*')).toBe(true);
    expect(acceptsGzip('gzip;q=0')).toBe(false);
    expect(acceptsGzip('gzip;q=0, *')).toBe(false);
    expect(acceptsGzip('*;q=0')).toBe(false);
    expect(acceptsGzip('br, deflate')).toBe(false);
    expect(acceptsGzip('identity')).toBe(false);
    expect(acceptsGzip('')).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
    expect(acceptsGzip(['br', 'gzip'])).toBe(true);
  });

  it('압축 대상: 텍스트 자산만, 최소 크기 이상', () => {
    for (const f of [
      'a.js',
      'a.css',
      'a.html',
      'a.json',
      'a.svg',
      'a.txt',
      'manifest.webmanifest',
      'a.map',
      'A.JS',
    ])
      expect(isCompressible(f, 5000)).toBe(true);
    for (const f of ['a.png', 'a.woff2', 'a.jpg', 'a.webp', 'a.ico', 'a.bin'])
      expect(isCompressible(f, 5000)).toBe(false);
    expect(isCompressible('a.js', GZIP_MIN_BYTES - 1)).toBe(false);
  });
});

describe('정적 파일 gzip', () => {
  it('JS: gzip을 받으면 압축본(content-encoding · Vary · 길이), 헤더 · 캐시 정책 그대로', async () => {
    const r = await get('/assets/index-abc123.js', 'gzip, deflate, br');
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.headers.vary).toBe('Accept-Encoding');
    expect(r.headers['x-decoy-server']).toBe('1');
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Number(r.headers['content-length'])).toBe(r.body.length);
    expect(r.body.length).toBeLessThan(Buffer.byteLength(JS) / 5);
    expect(gunzipSync(r.body).toString('utf8')).toBe(JS);
  });

  it('압축을 받지 않는 클라이언트에는 원본 (Vary는 붙인다)', async () => {
    for (const ae of [undefined, 'identity', 'br', 'gzip;q=0']) {
      const r = await get('/assets/index-abc123.js', ae);
      expect(r.status).toBe(200);
      expect(r.headers['content-encoding']).toBeUndefined();
      expect(r.headers.vary).toBe('Accept-Encoding');
      expect(r.headers['x-decoy-server']).toBe('1');
      expect(r.body.toString('utf8')).toBe(JS);
    }
  });

  it('CSS · HTML · SVG · webmanifest도 압축한다', async () => {
    for (const [path, body] of [
      ['/assets/index-abc123.css', CSS],
      ['/index.html', HTML],
      ['/logo.svg', SVG],
      ['/manifest.webmanifest', MANIFEST],
    ] as const) {
      const r = await get(path, 'gzip');
      expect(r.headers['content-encoding'], path).toBe('gzip');
      expect(gunzipSync(r.body).toString('utf8'), path).toBe(body);
    }
  });

  it('png · woff2는 압축하지 않고 Vary도 붙이지 않는다', async () => {
    const png = await get('/assets/logo-abc.png', 'gzip');
    expect(png.status).toBe(200);
    expect(png.headers['content-encoding']).toBeUndefined();
    expect(png.headers.vary).toBeUndefined();
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['x-decoy-server']).toBe('1');
    expect(png.body.equals(PNG)).toBe(true);
    const font = await get('/fonts/ui.woff2', 'gzip');
    expect(font.headers['content-encoding']).toBeUndefined();
    expect(font.body.equals(WOFF2)).toBe(true);
  });

  it('아주 작은 텍스트 파일은 원본', async () => {
    const r = await get('/sw.js', 'gzip');
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.body.toString('utf8')).toBe(SMALL_JS);
  });

  it('없는 경로 · 폴더는 지금처럼 index.html (no-cache), 압축 받으면 압축본', async () => {
    for (const path of ['/', '/lobby/ABCD', '/nothing.js']) {
      const r = await get(path, 'gzip');
      expect(r.status, path).toBe(200);
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(r.headers['cache-control']).toBe('no-cache');
      expect(r.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(r.body).toString('utf8')).toBe(HTML);
    }
    const plain = await get('/lobby/ABCD');
    expect(plain.body.toString('utf8')).toBe(HTML);
  });

  it('파일마다 한 번만 압축해 메모리에 두고, 파일이 바뀌면 다시 압축한다', async () => {
    expect(gzipCacheSize()).toBe(0);
    const a = await get('/assets/index-abc123.js', 'gzip');
    const b = await get('/assets/index-abc123.js', 'gzip');
    // 동시에 여러 요청이 와도 압축은 한 번
    await Promise.all([get('/index.html', 'gzip'), get('/index.html', 'gzip'), get('/', 'gzip')]);
    expect(gzipCacheSize()).toBe(2);
    expect(b.body.equals(a.body)).toBe(true);
    // 다시 빌드한 파일 (크기 · 수정 시각이 바뀜)
    const file = join(root, 'logo.svg');
    const before = await get('/logo.svg', 'gzip');
    const next = `${SVG}<!-- rebuilt -->`;
    writeFileSync(file, next);
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const after = await get('/logo.svg', 'gzip');
    expect(gunzipSync(before.body).toString('utf8')).toBe(SVG);
    expect(gunzipSync(after.body).toString('utf8')).toBe(next);
    writeFileSync(file, SVG);
  });

  it('빌드가 없으면 지금처럼 404 안내 (압축과 상관없이)', async () => {
    const s = makeServer(emptyRoot);
    const p = await listen(s);
    try {
      const r = await get('/', 'gzip', p);
      expect(r.status).toBe(404);
      expect(r.headers['content-encoding']).toBeUndefined();
      expect(r.headers['x-decoy-server']).toBe('1');
      expect(r.body.toString('utf8')).toContain('npm run build');
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it('루트 밖 경로 · 잘못된 인코딩은 지금처럼 거절', async () => {
    const bad = await get('/%E0%A4%A', 'gzip');
    expect(bad.status).toBe(400);
    // URL 파서가 ..를 접어 루트 안으로 오므로(index.html), 인코딩된 구분자로 밖을 가리켜 본다
    const out = await get('/..%2f..%2fetc%2fpasswd', 'gzip');
    expect(out.status).toBe(403);
  });
});
