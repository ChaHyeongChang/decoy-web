// 빌드된 클라이언트(client/dist)를 서빙한다.
// M12: 받는 쪽이 gzip을 받으면(Accept-Encoding) 텍스트 자산을 압축해 보낸다. 파일마다 한 번만 압축해 메모리에 두고
// (수정 시각 · 크기가 바뀌면 다시), 압축은 스레드 풀에서 해 판 틱 루프를 멈추지 않는다. 이미 압축된 형식(png · woff2 등)은 그대로.
// 텍스트 자산 응답에는 압축 여부와 상관없이 `Vary: Accept-Encoding`을 붙여 중간 캐시가 압축본을 못 받는 쪽에 주지 않게 한다
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { constants as zlibConstants, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

/** 압축할 텍스트 자산 (확장자). png · woff2 · jpg · webp 같은 이미 압축된 형식은 넣지 않는다 */
export const COMPRESSIBLE_EXT: ReadonlySet<string> = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.map',
  '.svg',
  '.txt',
  '.xml',
  '.webmanifest',
]);

/** 이보다 작은 파일은 압축하지 않는다 (gzip 머리 · 꼬리 18바이트와 CPU가 이득보다 크다) */
export const GZIP_MIN_BYTES = 256;

interface GzEntry {
  mtimeMs: number;
  size: number;
  /** 압축본. 압축해도 작아지지 않으면 null (원본을 보낸다) */
  body: Promise<Buffer | null>;
}

/** 파일 경로 → 압축본 (파일마다 한 번). client/dist 안 파일만 들어오므로 크기는 빌드 크기로 묶인다 */
const gzCache = new Map<string, GzEntry>();

/** 압축본 캐시 비우기 (테스트용) */
export function clearGzipCache(): void {
  gzCache.clear();
}

/** 지금 캐시에 든 파일 수 (테스트 · 진단용) */
export function gzipCacheSize(): number {
  return gzCache.size;
}

/**
 * Accept-Encoding이 gzip을 받는가 (RFC 9110 12.5.3). `gzip`(또는 `x-gzip`)이 q > 0으로 있거나,
 * gzip을 따로 적지 않고 `*`가 q > 0이면 받는다. `gzip;q=0`은 거절
 */
export function acceptsGzip(header: string | string[] | undefined): boolean {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  let gzipQ: number | null = null;
  let starQ: number | null = null;
  for (const part of raw.split(',')) {
    const [name = '', ...params] = part.trim().toLowerCase().split(';');
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!Number.isFinite(q)) q = 0;
    const token = name.trim();
    if (token === 'gzip' || token === 'x-gzip') gzipQ = Math.max(gzipQ ?? 0, q);
    else if (token === '*') starQ = Math.max(starQ ?? 0, q);
  }
  if (gzipQ !== null) return gzipQ > 0;
  return starQ !== null && starQ > 0;
}

/** 이 파일을 압축해 보낼 대상인가 (텍스트 자산 · 최소 크기 이상) */
export function isCompressible(filePath: string, size: number): boolean {
  return COMPRESSIBLE_EXT.has(extname(filePath).toLowerCase()) && size >= GZIP_MIN_BYTES;
}

/** 압축본 (캐시에서, 없거나 파일이 바뀌었으면 새로 압축) */
function gzipped(filePath: string, mtimeMs: number, size: number): Promise<Buffer | null> {
  const hit = gzCache.get(filePath);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.body;
  const body = readFile(filePath)
    .then((raw) => gzipAsync(raw, { level: zlibConstants.Z_BEST_COMPRESSION }))
    .then((gz) => (gz.length < size ? gz : null));
  const entry: GzEntry = { mtimeMs, size, body };
  gzCache.set(filePath, entry);
  // 실패한 압축은 캐시에 남기지 않는다 (다음 요청에서 다시 시도)
  body.catch(() => {
    if (gzCache.get(filePath) === entry) gzCache.delete(filePath);
  });
  return body;
}

/** 원본 그대로 흘려보낸다 */
function streamRaw(target: string, res: ServerResponse, headers: Record<string, string>): void {
  res.writeHead(200, headers);
  const stream = createReadStream(target);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.destroy();
  });
  stream.pipe(res);
}

/**
 * 정적 파일 응답. acceptEncoding은 요청의 Accept-Encoding (기본: res.req에서 읽는다).
 * 경로 처리 · 404 · 캐시 정책 · 앞서 붙인 헤더(x-decoy-server 등)는 압축과 상관없이 같다
 */
export function serveStatic(
  root: string,
  url: URL,
  res: ServerResponse,
  acceptEncoding: string | string[] | undefined = res.req?.headers['accept-encoding'],
): void {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(normalize(root + sep)) && filePath !== normalize(root)) {
    res.writeHead(403).end();
    return;
  }
  const target = existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(root, 'index.html');
  if (!existsSync(target)) {
    res
      .writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      .end('클라이언트 빌드가 없습니다. npm run build를 먼저 실행하세요.');
    return;
  }
  const type = MIME[extname(target)] ?? 'application/octet-stream';
  const cache = target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  const headers: Record<string, string> = { 'content-type': type, 'cache-control': cache };
  const st = statSync(target);
  if (!isCompressible(target, st.size)) {
    streamRaw(target, res, headers);
    return;
  }
  headers.vary = 'Accept-Encoding';
  if (!acceptsGzip(acceptEncoding)) {
    streamRaw(target, res, headers);
    return;
  }
  gzipped(target, st.mtimeMs, st.size).then(
    (gz) => {
      if (res.destroyed) return;
      if (!gz) {
        streamRaw(target, res, headers);
        return;
      }
      res
        .writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': String(gz.length) })
        .end(gz);
    },
    () => {
      // 압축에 실패하면 원본으로 (읽기 자체가 실패했으면 streamRaw가 500을 낸다)
      if (!res.destroyed) streamRaw(target, res, headers);
    },
  );
}
