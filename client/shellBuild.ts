// 앱 셸 빌드 도우미 (M13d, client/vite.config.ts가 빌드 끝에 쓴다 · 단위 시험이 같이 쓴다).
// dist 전체 파일 목록을 모으고, public/sw.js의 자리 표시 두 줄(빌드 ID · 셸 목록)을 빌드 값으로 바꾼다.
// 번들 줄이기: 텍스트 자산마다 미리 압축한 brotli(.br) · gzip(.gz) 사본을 옆에 만든다(precompressDist — 서버가 받는 쪽에 맞춰 고른다)
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

/** 앱 셸 사전 캐시에서 빼는 dist 파일: 워커 자신, 깨우기 화면(따로 캐시), 서버가 읽는 빌드 ID 파일 */
export const SHELL_EXCLUDE: readonly string[] = ['sw.js', 'wake.html', 'build-id.json'];

/**
 * 앱 셸에서 빼는 dist 폴더(앞부분): manifest 아이콘(icons/). 화면 · 오프라인 진입이 쓰지 않고, 설치할 때는 브라우저 · OS가
 * 직접 받으며, 안드로이드 앱(TWA)은 APK 안의 아이콘을 쓴다. 넣으면 첫 방문 · 배포마다 약 0.54MB를 더 받는다
 */
export const SHELL_EXCLUDE_PREFIX: readonly string[] = ['icons/'];

const BUILD_LINE = /^const BUILD = null;.*$/m;
const SHELL_LINE = /^const SHELL = \[\];.*$/m;

/** sw.js 원문에 빌드 ID와 셸 목록을 넣는다. 자리 표시가 없으면 빌드를 멈춘다(워커가 옛 모양으로 나가지 않게) */
export function swWithBuild(source: string, id: string, shell: readonly string[]): string {
  if (!BUILD_LINE.test(source) || !SHELL_LINE.test(source))
    throw new Error('sw.js에 빌드 자리 표시(const BUILD = null; · const SHELL = [];)가 없습니다');
  return source
    .replace(BUILD_LINE, `const BUILD = ${JSON.stringify(id)};`)
    .replace(SHELL_LINE, `const SHELL = ${JSON.stringify(shell)};`);
}

/** 미리 압축한 사본의 확장자 (셸 목록 · 다시 압축에서 뺀다 — 서비스 워커는 원본 주소로 받고 브라우저가 풀어 둔다) */
export const PRECOMPRESSED_EXT: readonly string[] = ['.br', '.gz'];

/** dist 아래 모든 파일(하위 폴더 포함, '/' 구분 상대 경로, 정렬) */
function listAll(outDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(outDir, full).split(sep).join('/'));
    }
  };
  walk(outDir);
  return files.sort();
}

/** dist 아래 모든 파일에서 SHELL_EXCLUDE · SHELL_EXCLUDE_PREFIX · 미리 압축한 사본(.br · .gz)을 뺀 앱 셸 목록 */
export function listShellFiles(outDir: string): string[] {
  return listAll(outDir).filter(
    (f) =>
      !SHELL_EXCLUDE.includes(f) &&
      !SHELL_EXCLUDE_PREFIX.some((p) => f.startsWith(p)) &&
      !PRECOMPRESSED_EXT.some((e) => f.endsWith(e)),
  );
}

/**
 * 미리 압축할 텍스트 자산 (확장자). 서버가 압축해 보내는 것(server/src/static.ts COMPRESSIBLE_EXT)과 같은 목록이다 —
 * 단위 시험이 둘을 맞춰 본다. png · woff2 같은 이미 압축된 형식은 넣지 않는다
 */
export const PRECOMPRESS_EXT: readonly string[] = [
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
];

/** 이보다 작은 파일은 미리 압축하지 않는다 (서버 GZIP_MIN_BYTES와 같다) */
export const PRECOMPRESS_MIN_BYTES = 256;

/**
 * dist의 텍스트 자산마다 brotli(최고 수준 11)와 gzip(9) 사본을 `<파일>.br` · `<파일>.gz`로 쓴다. 원본보다 작을 때만 쓴다.
 * 빌드 끝(sw.js에 빌드 ID · 셸 목록을 넣은 뒤)에 부른다 — 사본은 그 마지막 내용이어야 한다. 쓴 사본 수를 돌려준다
 */
export function precompressDist(outDir: string): number {
  let written = 0;
  for (const f of listAll(outDir)) {
    if (PRECOMPRESSED_EXT.some((e) => f.endsWith(e))) continue;
    if (!PRECOMPRESS_EXT.includes(extname(f).toLowerCase())) continue;
    const full = join(outDir, f);
    const raw = readFileSync(full);
    if (raw.length < PRECOMPRESS_MIN_BYTES) continue;
    const br = brotliCompressSync(raw, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    const gz = gzipSync(raw, { level: zlibConstants.Z_BEST_COMPRESSION });
    if (br.length < raw.length) {
      writeFileSync(`${full}.br`, br);
      written += 1;
    }
    if (gz.length < raw.length) {
      writeFileSync(`${full}.gz`, gz);
      written += 1;
    }
  }
  return written;
}
