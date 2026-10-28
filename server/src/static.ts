// 빌드된 클라이언트(client/dist)를 서빙한다.
// M12: 받는 쪽이 gzip을 받으면(Accept-Encoding) 텍스트 자산을 압축해 보낸다. 파일마다 한 번만 압축해 메모리에 두고
// (수정 시각 · 크기가 바뀌면 다시), 압축은 스레드 풀에서 해 판 틱 루프를 멈추지 않는다. 이미 압축된 형식(png · woff2 등)은 그대로.
// 텍스트 자산 응답에는 압축 여부와 상관없이 `Vary: Accept-Encoding`을 붙여 중간 캐시가 압축본을 못 받는 쪽에 주지 않게 한다.
// M13d: 확장자가 있는 경로의 파일이 없으면 404(예전에는 index.html 200 — 배포 전환 순간 HTML이 JS 자리에 캐시될 수 있었다),
// 확장자가 없는 경로만 index.html. 약한 ETag(크기-수정 시각) + If-None-Match 304, 폰트 · 문서 · manifest MIME.
// 번들 줄이기: 빌드가 텍스트 자산 옆에 미리 압축한 사본(`<파일>.br` brotli 11 · `<파일>.gz` gzip 9, client/shellBuild.ts)을 두면
// 받는 쪽이 brotli를 받으면 .br, 아니면 gzip을 받으면 .gz를 그대로 보낸다(요청마다 압축하지 않는다). 사본은 처음 한 번 풀어
// 원본과 같은지 확인한다(파일을 바꾸면 다시) — 원본만 바꾼 폴더(시험의 빌드 B 등)에 옛 사본을 보내지 않는다. 사본이 없거나
// 다르면 예전처럼 gzip을 만들어 보낸다
import { createReadStream, existsSync, statSync, type Stats } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliDecompress, constants as zlibConstants, gunzip, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const brotliDecompressAsync = promisify(brotliDecompress);

export const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** 약한 ETag: 크기-수정 시각 (내용 해시를 매번 읽지 않는다. gzip 여부와 상관없이 같은 표현으로 본다) */
export function weakEtag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

/** If-None-Match가 이 ETag와 맞는가 (여러 값 · `*` · 약한 비교) */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  if (raw.trim() === '') return false;
  const bare = (t: string): string => t.trim().replace(/^W\//, '');
  return raw.split(',').some((t) => t.trim() === '*' || bare(t) === bare(etag));
}

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

/** 압축본 캐시 · 미리 압축한 사본 확인 결과 비우기 (테스트용) */
export function clearGzipCache(): void {
  gzCache.clear();
  preCache.clear();
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

/** 보낼 수 있는 압축 방식 */
export type ContentCoding = 'br' | 'gzip';

/**
 * 받는 쪽이 받는 압축 방식을 고를 순서대로 (RFC 9110 12.5.3). q가 큰 것 먼저, 같으면 brotli 먼저(더 작다).
 * 따로 적지 않은 방식은 `*`의 q를 따른다. q=0은 거절. 아무것도 받지 않으면 빈 목록(원본)
 */
export function acceptedCodings(header: string | string[] | undefined): ContentCoding[] {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  const q = new Map<string, number>();
  for (const part of raw.split(',')) {
    const [name = '', ...params] = part.trim().toLowerCase().split(';');
    let v = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) v = Number(m[1]);
    }
    if (!Number.isFinite(v)) v = 0;
    const token = name.trim() === 'x-gzip' ? 'gzip' : name.trim();
    if (token !== '') q.set(token, Math.max(q.get(token) ?? 0, v));
  }
  const star = q.get('*') ?? 0;
  const of = (c: ContentCoding): number => q.get(c) ?? star;
  return (['br', 'gzip'] as const).filter((c) => of(c) > 0).sort((a, b) => of(b) - of(a));
}

/** 미리 압축한 사본의 확장자 */
const PRE_EXT: Readonly<Record<ContentCoding, string>> = { br: '.br', gzip: '.gz' };

interface PreEntry {
  /** 원본 · 사본의 크기-수정 시각 (바뀌면 다시 확인) */
  key: string;
  /** 사본을 풀면 원본과 같은가 */
  ok: Promise<boolean>;
}

/** 사본 경로 → 원본과 같은지 확인한 결과 (파일마다 한 번) */
const preCache = new Map<string, PreEntry>();

/** 사본을 풀어 원본과 같은지 (스레드 풀에서 — 판 틱 루프를 멈추지 않는다). 읽기 · 풀기에 실패하면 false */
function precompressedMatches(
  original: string,
  orig: Stats,
  sibling: string,
  sib: Stats,
  coding: ContentCoding,
): Promise<boolean> {
  const key = `${orig.size}-${orig.mtimeMs}-${sib.size}-${sib.mtimeMs}`;
  const hit = preCache.get(sibling);
  if (hit && hit.key === key) return hit.ok;
  const ok = Promise.all([readFile(original), readFile(sibling)])
    .then(async ([raw, packed]) => {
      const unpacked = coding === 'br' ? await brotliDecompressAsync(packed) : await gunzipAsync(packed);
      return unpacked.equals(raw);
    })
    .catch(() => false);
  preCache.set(sibling, { key, ok });
  return ok;
}

/** 받는 쪽이 받는 방식 가운데 쓸 수 있는 미리 압축한 사본 (고를 순서대로 처음 맞는 것). 없으면 null */
async function pickPrecompressed(
  target: string,
  orig: Stats,
  codings: readonly ContentCoding[],
): Promise<{ coding: ContentCoding; path: string; size: number } | null> {
  for (const coding of codings) {
    const path = `${target}${PRE_EXT[coding]}`;
    let sib: Stats;
    try {
      sib = statSync(path);
    } catch {
      continue;
    }
    if (!sib.isFile() || sib.size >= orig.size) continue;
    if (await precompressedMatches(target, orig, path, sib, coding)) return { coding, path, size: sib.size };
  }
  return null;
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
  // 요청한 경로 자체의 확장자 ('/'는 없음 — index.html로 바꾸기 전에 본다)
  const requestedExt = extname(pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(normalize(root + sep)) && filePath !== normalize(root)) {
    res.writeHead(403).end();
    return;
  }
  const exists = existsSync(filePath) && statSync(filePath).isFile();
  // 확장자가 있는 경로(자산)가 없으면 404: 게임 HTML을 JS · 이미지 자리에 주지 않는다 (서비스 워커 사전 캐시 검사와 짝)
  if (!exists && requestedExt !== '') {
    res
      .writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      .end('not found');
    return;
  }
  const target = exists ? filePath : join(root, 'index.html');
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
  headers.etag = weakEtag(st.size, st.mtimeMs);
  if (isCompressible(target, st.size)) headers.vary = 'Accept-Encoding';
  if (etagMatches(res.req?.headers['if-none-match'], headers.etag)) {
    res.writeHead(304, headers).end();
    return;
  }
  if (!isCompressible(target, st.size)) {
    streamRaw(target, res, headers);
    return;
  }
  const codings = acceptedCodings(acceptEncoding);
  if (codings.length === 0) {
    streamRaw(target, res, headers);
    return;
  }
  pickPrecompressed(target, st, codings).then(
    (pre) => {
      if (res.destroyed) return;
      if (pre) {
        sendFile(pre.path, res, {
          ...headers,
          'content-encoding': pre.coding,
          'content-length': String(pre.size),
        });
        return;
      }
      if (codings.includes('gzip')) sendGzipped(target, st, res, headers);
      else streamRaw(target, res, headers);
    },
    () => {
      if (!res.destroyed) streamRaw(target, res, headers);
    },
  );
}

/** 파일 그대로 흘려보낸다 (헤더를 정해 받는다 — 미리 압축한 사본) */
function sendFile(path: string, res: ServerResponse, headers: Record<string, string>): void {
  res.writeHead(200, headers);
  const stream = createReadStream(path);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** 그 자리에서 gzip으로 압축해 보낸다 (미리 압축한 사본이 없을 때, 파일마다 한 번 압축해 캐시) */
function sendGzipped(target: string, st: Stats, res: ServerResponse, headers: Record<string, string>): void {
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
