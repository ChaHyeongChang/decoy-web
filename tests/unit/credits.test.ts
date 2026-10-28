// 에셋 출처 (M10c, VISUAL_SPEC 11장 · docs/CREDITS.md): 저장소의 이미지 · 폰트 · 소리 파일이 모두 CREDITS 표에
// 경로 · 출처 · 라이선스와 함께 있고(새 파일이 들어오면 실패), CREDITS에 적은 파일이 실제로 있으며,
// 폰트 저작권 줄 · 원본 주소 · 결과 파일 해시가 실제 파일과 같은지 본다. artifacts/(게임 화면 스크린샷)는 대상이 아니다.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CREDITS_PATH = 'docs/CREDITS.md';
/** 에셋을 찾는 곳 (빌드 결과 dist · node_modules는 건너뛴다) */
const ROOTS = ['client/public', 'client/src', 'docs'];
const SKIP_DIRS = new Set(['node_modules', 'dist']);
/** 이미지 · 폰트 · 소리 파일 */
const ASSET_EXT = /\.(png|jpe?g|webp|gif|avif|ico|svg|woff2?|ttf|otf|mp3|ogg|wav|m4a)$/i;
const FONT_PATH = 'client/public/fonts/noto-sans-kr-ui.woff2';
const OFL_PATH = 'client/public/fonts/OFL.txt';
const FONT_SOURCE_URL = 'https://github.com/google/fonts/tree/main/ofl/notosanskr';

const credits = readFileSync(CREDITS_PATH, 'utf8');

/** 디렉터리 아래 파일 (저장소 기준 경로, '/' 구분) */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** 표의 행 (첫 칸이 `경로`인 줄) → 칸 목록. 칸 안의 \| 는 나누지 않는다 */
function tableRows(md: string): string[][] {
  return md
    .split('\n')
    .filter((l) => l.trimStart().startsWith('|'))
    .map((l) =>
      l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.replace(/\\\|/g, '|').trim()),
    );
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const assets = ROOTS.flatMap((r) => (existsSync(r) ? walk(r) : [])).filter((p) => ASSET_EXT.test(p));
const rows = tableRows(credits);

describe('저장소 에셋 ↔ docs/CREDITS.md', () => {
  it('찾는 곳에 에셋이 있다 (빈 검사가 아님: 로고 · 폰트 · 컨셉 이미지)', () => {
    expect(assets).toContain('docs/images/logo_decoy.png');
    expect(assets).toContain('client/public/logo.svg');
    expect(assets).toContain(FONT_PATH);
    expect(assets.length).toBeGreaterThanOrEqual(9);
  });

  it('모든 이미지 · 폰트 · 소리 파일이 CREDITS 표에 경로 · 무엇 · 출처 · 라이선스와 함께 있다', () => {
    const missing: string[] = [];
    for (const path of assets) {
      const row = rows.find((cells) => cells[0] === `\`${path}\``);
      if (!row) {
        missing.push(`${path}: CREDITS 1절 표에 줄이 없다`);
        continue;
      }
      const [, what, source, license] = row;
      if (!what || !source || !license) missing.push(`${path}: 무엇 · 출처 · 라이선스 칸이 비었다`);
    }
    expect(missing, '새 에셋은 docs/CREDITS.md 1절 표에 한 줄을 더한다').toEqual([]);
  });

  it('CREDITS에 적은 저장소 경로는 모두 실제로 있다 (지운 파일이 남지 않게)', () => {
    const paths = [...credits.matchAll(/`((?:client|docs|scripts|server|shared|tests)\/[^`\s]+)`/g)].map(
      (m) => m[1] ?? '',
    );
    expect(paths.length).toBeGreaterThan(10);
    const gone = paths.filter((p) => !existsSync(p));
    expect(gone).toEqual([]);
  });
});

describe('UI 폰트 출처 · 라이선스', () => {
  const ofl = readFileSync(OFL_PATH, 'utf8');

  it("저작권 줄이 OFL.txt(원본 name 표)와 같고 예약 글꼴 이름 'Source'를 밝힌다", () => {
    const inCredits = /저작권 줄[^`\n]*`(Copyright [^`]+)`/.exec(credits)?.[1];
    const inOfl = ofl.split('\n').find((l) => l.startsWith('Copyright '));
    expect(inCredits).toBeDefined();
    expect(inCredits).toBe(inOfl);
    expect(inCredits).toContain("Reserved Font Name 'Source'");
  });

  it('원본 주소 · 라이선스 이름 · 라이선스 전문 위치가 적혀 있고, OFL.txt가 전문이다', () => {
    expect(credits).toContain(FONT_SOURCE_URL);
    expect(ofl).toContain(FONT_SOURCE_URL);
    expect(credits).toContain('SIL Open Font License 1.1');
    expect(credits).toContain(`\`${OFL_PATH}\``);
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('CREDITS에 적은 서브셋 결과 파일 sha256이 실제 폰트 파일과 같다 (다시 만들면 CREDITS도 고친다)', () => {
    const hashes = [...credits.matchAll(/결과 파일 sha256 `([0-9a-f]{64})`/g)].map((m) => m[1]);
    expect(hashes).toEqual([sha256(FONT_PATH)]);
  });

  it("구글 로그인 단추의 공식 'G' 로고: 네 가지 색 그대로 · 정사각형 격자, 단추는 가이드라인 값(흰 바탕 · 테두리 · 글자색 · 여백), 6절에 출처 · 조건", () => {
    const code = readFileSync('client/src/ui/account.ts', 'utf8');
    const svg = /GOOGLE_G_SVG\s*=([\s\S]*?);\n/.exec(code)?.[1] ?? '';
    const fills = [...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
    expect(fills).toEqual(['#EA4335', '#4285F4', '#FBBC05', '#34A853']);
    expect(svg).toContain('viewBox="0 0 48 48"');
    expect(svg).toContain('width="20" height="20"');
    const css = readFileSync('client/src/ui/account.css', 'utf8');
    const btn = /\.gsi-btn \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(btn).toContain('background: #ffffff;');
    expect(btn).toContain('border: 1px solid #747775;');
    expect(btn).toContain('color: #1f1f1f;');
    expect(btn).toContain('gap: 10px;');
    expect(btn).toContain('padding: 0 12px;');
    expect(btn).toContain('border-radius: 4px;');
    const sec = credits.slice(credits.indexOf("## 6. 구글 로그인 단추의 'G' 로고"));
    expect(sec).toContain('https://developers.google.com/identity/branding-guidelines');
    expect(sec).toContain('Google LLC의 상표');
    expect(sec).toContain('2026-10-28');
  });
});
