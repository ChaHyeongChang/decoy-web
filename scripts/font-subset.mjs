// UI 폰트 서브셋 만들기 (M10c, VISUAL_SPEC 10장 · docs/CREDITS.md).
// Noto Sans KR 가변 폰트(SIL OFL 1.1)에서 UI · 문서 문자열 글자 + 상용 한글(KS X 1001 2,350자) + ASCII만 남긴
// 가변 굵기(100~900) woff2 한 파일을 만든다. 들어간 글자 목록(원본 폰트에 실제로 있는 글자만)을 같이 쓴다.
//
// 사용법 (저장소에 의존성을 더하지 않으려고 subset-font는 저장하지 않고 임시로 설치해 쓴다):
//   npm i --no-save subset-font@2.9.0
//   npm run font:subset -- <NotoSansKR[wght].ttf 경로>
//   (다른 곳에 설치했으면 SUBSET_FONT=<.../node_modules/subset-font> 환경 변수로 알려 준다)
// 원본: https://github.com/google/fonts/tree/main/ofl/notosanskr 의 NotoSansKR[wght].ttf
//   (확인한 파일 sha256 194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252)
// 결과: client/public/fonts/noto-sans-kr-ui.woff2 + noto-sans-kr-ui.txt(글자 목록). 라이선스 전문은 같은 폴더 OFL.txt
// 새 UI 문구에 목록 밖 글자가 생기면 tests/unit/fonts.test.ts가 실패한다 → 이 스크립트를 다시 돌린다.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

export const FONT_DIR = 'client/public/fonts';
export const FONT_FILE = join(FONT_DIR, 'noto-sans-kr-ui.woff2');
export const CHARS_FILE = join(FONT_DIR, 'noto-sans-kr-ui.txt');

/** 글자를 모을 소스 · 문서 (UI 문구 · 서버 오류 문구 · 깨우기 화면 · 문구 원본 문서) */
const SOURCE_DIRS = ['client/src', 'shared/src', 'server/src', 'client/public'];
const SOURCE_EXTS = ['.ts', '.html', '.css', '.js'];
const SOURCE_FILES = ['client/index.html', 'docs/STORY_TEXT.md'];
/** 문장 부호 · 기호 (소스에 아직 없어도 문구에 자주 쓰는 것) */
const EXTRA = '·…–—‘’“”•→←↑↓×✓★①②③④⑤%°±';

/** KS X 1001 한글 2,350자 (EUC-KR 0xB0A1~0xC8FE) */
export function ksx1001Hangul() {
  const dec = new TextDecoder('euc-kr');
  let s = '';
  for (let hi = 0xb0; hi <= 0xc8; hi += 1)
    for (let lo = 0xa1; lo <= 0xfe; lo += 1) s += dec.decode(new Uint8Array([hi, lo]));
  return s;
}

/** 넣고 싶은 글자 (원본 폰트에 없는 글자는 아직 거르지 않음) */
export function wantedChars() {
  const set = new Set();
  const add = (s) => {
    for (const ch of s) if (ch >= ' ' && ch !== '\u007f') set.add(ch);
  };
  for (let c = 0x20; c < 0x7f; c += 1) set.add(String.fromCharCode(c));
  add(ksx1001Hangul());
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (SOURCE_EXTS.some((e) => p.endsWith(e))) add(readFileSync(p, 'utf8'));
    }
  };
  for (const d of SOURCE_DIRS) walk(d);
  for (const f of SOURCE_FILES) add(readFileSync(f, 'utf8'));
  add(EXTRA);
  return set;
}

// ───────────────────────── 폰트 cmap 읽기 (단위 테스트도 쓴다) ─────────────────────────

/** cmap 표에서 글리프가 있는 코드 포인트 (형식 12 우선, 없으면 형식 4) */
export function cmapCodepoints(buf, off) {
  const n = buf.readUInt16BE(off + 2);
  let f12 = -1;
  let f4 = -1;
  for (let i = 0; i < n; i += 1) {
    const r = off + 4 + i * 8;
    const pid = buf.readUInt16BE(r);
    const eid = buf.readUInt16BE(r + 2);
    const sub = off + buf.readUInt32BE(r + 4);
    const format = buf.readUInt16BE(sub);
    if (format === 12 && (pid === 0 || (pid === 3 && eid === 10))) f12 = sub;
    if (format === 4 && (pid === 0 || (pid === 3 && eid === 1))) f4 = sub;
  }
  const out = new Set();
  if (f12 >= 0) {
    const groups = buf.readUInt32BE(f12 + 12);
    for (let g = 0; g < groups; g += 1) {
      const r = f12 + 16 + g * 12;
      const start = buf.readUInt32BE(r);
      const end = buf.readUInt32BE(r + 4);
      const glyph = buf.readUInt32BE(r + 8);
      for (let c = start; c <= end; c += 1) if (glyph + (c - start) !== 0) out.add(c);
    }
    return out;
  }
  if (f4 < 0) throw new Error('cmap에 유니코드 표(형식 4 · 12)가 없습니다');
  const seg = buf.readUInt16BE(f4 + 6) / 2;
  const ends = f4 + 14;
  const starts = ends + seg * 2 + 2;
  const deltas = starts + seg * 2;
  const ranges = deltas + seg * 2;
  for (let i = 0; i < seg; i += 1) {
    const start = buf.readUInt16BE(starts + i * 2);
    const end = buf.readUInt16BE(ends + i * 2);
    const delta = buf.readInt16BE(deltas + i * 2);
    const ro = buf.readUInt16BE(ranges + i * 2);
    for (let c = start; c <= end && c !== 0xffff; c += 1) {
      let g;
      if (ro === 0) g = (c + delta) & 0xffff;
      else {
        g = buf.readUInt16BE(ranges + i * 2 + ro + (c - start) * 2);
        if (g !== 0) g = (g + delta) & 0xffff;
      }
      if (g !== 0) out.add(c);
    }
  }
  return out;
}

/** TTF · OTF의 cmap 코드 포인트 */
export function sfntCodepoints(buf) {
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i += 1) {
    const r = 12 + i * 16;
    if (buf.toString('latin1', r, r + 4) === 'cmap') return cmapCodepoints(buf, buf.readUInt32BE(r + 8));
  }
  throw new Error('cmap 표가 없습니다');
}

/** WOFF2 표 이름 (알려진 표 번호 0~62, W3C WOFF2 5.1절) */
const WOFF2_TAGS = (
  'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH ' +
  'PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc ' +
  'bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
)
  .match(/.{4}\s?/g)
  .map((t) => t.slice(0, 4));

/** WOFF2를 풀어 표 이름 → 내용(변환된 glyf · loca는 변환된 그대로) */
export function woff2Tables(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('WOFF2가 아닙니다');
  const numTables = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i += 1) {
      const b = buf[p++];
      v = v * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
    throw new Error('UIntBase128가 너무 깁니다');
  };
  const dir = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[p++];
    const known = flags & 0x3f;
    let tag;
    if (known === 63) {
      tag = buf.toString('latin1', p, p + 4);
      p += 4;
    } else tag = WOFF2_TAGS[known];
    const version = flags >> 6;
    const orig = base128();
    const glyfLoca = tag === 'glyf' || tag === 'loca';
    const transformed = glyfLoca ? version === 0 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : orig });
  }
  const data = brotliDecompressSync(buf.subarray(p, p + compressed));
  const tables = new Map();
  let at = 0;
  for (const t of dir) {
    tables.set(t.tag, data.subarray(at, at + t.length));
    at += t.length;
  }
  return tables;
}

/** WOFF2의 cmap 코드 포인트 */
export function woff2Codepoints(buf) {
  const cmap = woff2Tables(buf).get('cmap');
  if (!cmap) throw new Error('cmap 표가 없습니다');
  return cmapCodepoints(Buffer.from(cmap), 0);
}

/** 코드 포인트 집합 → 정렬한 글자 문자열 */
export function charsOf(codepoints) {
  return [...codepoints]
    .sort((a, b) => a - b)
    .map((c) => String.fromCodePoint(c))
    .join('');
}

async function loadSubsetFont() {
  try {
    return (await import('subset-font')).default;
  } catch {
    const dir = process.env.SUBSET_FONT;
    if (!dir) return null;
    return (await import(pathToFileURL(join(dir, 'index.js')).href)).default;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = process.argv[2];
  if (!src) {
    console.error('쓰기: npm run font:subset -- <NotoSansKR[wght].ttf 경로>');
    process.exit(2);
  }
  const subsetFont = await loadSubsetFont();
  if (!subsetFont) {
    console.error('subset-font가 없습니다: npm i --no-save subset-font@2.9.0 (또는 SUBSET_FONT=<설치 경로>)');
    process.exit(1);
  }
  const source = readFileSync(src);
  const have = sfntCodepoints(source);
  const wanted = wantedChars();
  const missing = [...wanted].filter((ch) => !have.has(ch.codePointAt(0)));
  const keep = new Set([...wanted].map((ch) => ch.codePointAt(0)).filter((c) => have.has(c)));
  const text = charsOf(keep);
  const t0 = Date.now();
  const out = await subsetFont(source, text, { targetFormat: 'woff2' });
  const got = woff2Codepoints(out);
  const lost = [...keep].filter((c) => !got.has(c));
  if (lost.length > 0) throw new Error(`서브셋에서 빠진 글자: ${charsOf(lost)}`);
  mkdirSync(FONT_DIR, { recursive: true });
  writeFileSync(FONT_FILE, out);
  writeFileSync(CHARS_FILE, `${charsOf(got)}\n`);
  console.log(`${FONT_FILE} ${out.length}B · ${got.size}자 · ${Date.now() - t0}ms`);
  if (missing.length > 0)
    console.log(`원본 폰트에 없어 대체 글꼴로 남는 글자 ${missing.length}개: ${missing.join('')}`);
}
