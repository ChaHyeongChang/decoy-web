// UI 폰트 (M10c, VISUAL_SPEC 10장): Noto Sans KR 서브셋 파일 · 글자 목록 · 라이선스 · CSS 연결 · 불러오기 동작
import { readFileSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHARS_FILE,
  FONT_DIR,
  FONT_FILE,
  charsOf,
  ksx1001Hangul,
  woff2Codepoints,
  woff2Tables,
} from '../../scripts/font-subset.mjs';
import * as story from '../../client/src/data/storyText';
import type * as fontsModule from '../../client/src/ui/fonts';
import { UI_FONT, UI_FONT_FAMILY } from '../../client/src/ui/fonts';

const font = readFileSync(FONT_FILE);
const listed = readFileSync(CHARS_FILE, 'utf8').replace(/\n$/, '');
const css = readFileSync('client/src/style.css', 'utf8');

/** 값 안의 모든 문자열 (객체 · 배열을 따라 들어간다) */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

describe('UI 폰트 파일', () => {
  it('WOFF2이고 크기가 서브셋 범위다 (전체 10MB가 아니라 수백 KB)', () => {
    expect(font.subarray(0, 4).toString('latin1')).toBe('wOF2');
    const size = statSync(FONT_FILE).size;
    expect(size).toBeGreaterThan(150 * 1024);
    expect(size).toBeLessThan(400 * 1024);
  });

  it('폰트의 cmap이 글자 목록 파일과 정확히 같다', () => {
    expect(charsOf(woff2Codepoints(font))).toBe(listed);
  });

  it('ASCII · KS X 1001 한글 2,350자 · 게임 문구(storyText)의 모든 글자가 들어 있다', () => {
    const have = new Set(listed);
    const hangul = ksx1001Hangul();
    expect([...hangul].length).toBe(2350);
    const need = new Set<string>();
    for (let c = 0x20; c < 0x7f; c += 1) need.add(String.fromCharCode(c));
    for (const ch of hangul) need.add(ch);
    for (const s of strings(story)) for (const ch of s) need.add(ch);
    const missing = [...need].filter((ch) => !have.has(ch));
    expect(missing, `목록 밖 글자 → npm run font:subset으로 다시 만든다: ${missing.join('')}`).toEqual([]);
  });

  it('가변 굵기 축 wght 100~900이 남아 있다 (굵기마다 파일을 따로 받지 않음)', () => {
    const fvar = woff2Tables(font).get('fvar');
    expect(fvar).toBeDefined();
    const b = Buffer.from(fvar!);
    expect(b.readUInt16BE(8)).toBe(1);
    const axis = b.readUInt16BE(4);
    expect(b.toString('latin1', axis, axis + 4)).toBe('wght');
    expect(b.readInt32BE(axis + 4) / 65536).toBe(100);
    expect(b.readInt32BE(axis + 12) / 65536).toBe(900);
  });

  it('글꼴 이름에 예약 글꼴 이름(Reserved Font Name) "Source"를 쓰지 않는다 (OFL 3항)', () => {
    const name = Buffer.from(woff2Tables(font).get('name')!);
    const count = name.readUInt16BE(2);
    const strOff = name.readUInt16BE(4);
    const families: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const r = 6 + i * 12;
      const [pid, , lid, nid, len, off] = [0, 2, 4, 6, 8, 10].map((k) => name.readUInt16BE(r + k));
      if (pid !== 3 || lid !== 0x409 || ![1, 4, 6, 16].includes(nid!)) continue;
      const raw = name.subarray(strOff + off!, strOff + off! + len!);
      let s = '';
      for (let j = 0; j < raw.length; j += 2) s += String.fromCharCode(raw.readUInt16BE(j));
      families.push(s);
    }
    expect(families.length).toBeGreaterThan(0);
    for (const f of families) {
      expect(f.replace(/[\s-]/g, '')).toContain('NotoSansKR');
      expect(f).not.toMatch(/source/i);
    }
  });

  it('OFL.txt: 라이선스 전문 + 저작권 줄 + 서브셋(수정본) 안내', () => {
    const ofl = readFileSync(`${FONT_DIR}/OFL.txt`, 'utf8');
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
    expect(ofl).toContain(
      "Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.",
    );
    expect(ofl).toContain('noto-sans-kr-ui.woff2');
    // 전문의 조항 0~5와 면책 조항
    for (const s of ['PREAMBLE', 'DEFINITIONS', 'PERMISSION & CONDITIONS', 'TERMINATION', 'DISCLAIMER'])
      expect(ofl).toContain(s);
  });
});

describe('CSS 연결', () => {
  it('@font-face: 같은 이름 · 한 파일 · 가변 굵기 100~900 · font-display swap · unicode-range 없음', () => {
    const face = /@font-face\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(face).toContain(`font-family: '${UI_FONT_FAMILY}'`);
    expect(face).toContain("url('/fonts/noto-sans-kr-ui.woff2') format('woff2')");
    expect(face).toMatch(/font-weight:\s*100 900/);
    expect(face).toMatch(/font-display:\s*swap/);
    expect(face).not.toContain('unicode-range');
    expect(css.match(/@font-face/g)?.length).toBe(1);
  });

  it('CSS 글꼴 스택(--font)이 Phaser 글자의 UI_FONT와 같다', () => {
    const stack = /--font:\s*([^;]+);/.exec(css)?.[1];
    expect(stack).toBe(UI_FONT);
    expect(UI_FONT.startsWith(`'${UI_FONT_FAMILY}'`)).toBe(true);
  });

  it('index.html이 폰트를 미리 받는다 (같은 파일, crossorigin)', () => {
    const html = readFileSync('client/index.html', 'utf8');
    expect(html).toMatch(
      /<link rel="preload" href="\/fonts\/noto-sans-kr-ui\.woff2" as="font" type="font\/woff2" crossorigin \/>/,
    );
  });
});

// ───────────────────────── loadUiFonts 동작 (document.fonts 흉내) ─────────────────────────

type Fonts = typeof fontsModule;

interface FakeFonts {
  load: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
}

async function freshFonts(fonts: FakeFonts | null): Promise<Fonts> {
  vi.resetModules();
  vi.stubGlobal('window', { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) });
  vi.stubGlobal('document', fonts ? { fonts } : {});
  return import('../../client/src/ui/fonts');
}

describe('loadUiFonts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('굵기마다 불러 다 받으면 true, 준비됨. 여러 번 불러도 한 번만 받는다', async () => {
    const fake = { load: vi.fn(() => Promise.resolve([{}])), check: vi.fn(() => true) };
    const f = await freshFonts(fake);
    expect(f.uiFontsReady()).toBe(false);
    const p = f.loadUiFonts();
    expect(f.loadUiFonts()).toBe(p);
    expect(await p).toBe(true);
    expect(f.uiFontsReady()).toBe(true);
    expect(fake.load).toHaveBeenCalledTimes(f.UI_FONT_WEIGHTS.length);
    for (const w of f.UI_FONT_WEIGHTS)
      expect(fake.load).toHaveBeenCalledWith(`${w} 16px '${UI_FONT_FAMILY}'`, expect.any(String));
  });

  it('실패(거부 · 빈 결과)면 false로 끝나고 예외를 던지지 않는다', async () => {
    let f = await freshFonts({
      load: vi.fn(() => Promise.reject(new Error('net'))),
      check: vi.fn(() => true),
    });
    expect(await f.loadUiFonts()).toBe(false);
    expect(f.uiFontsReady()).toBe(false);
    f = await freshFonts({ load: vi.fn(() => Promise.resolve([])), check: vi.fn(() => true) });
    expect(await f.loadUiFonts()).toBe(false);
  });

  it('document.fonts가 없으면 false', async () => {
    const f = await freshFonts(null);
    expect(await f.loadUiFonts()).toBe(false);
  });

  it('시간 제한이 지나면 false로 끝나고(판은 대체 글꼴로 시작), 늦게 받으면 준비됨 + onUiFontsLate 한 번', async () => {
    vi.useFakeTimers();
    let finish: (v: unknown[]) => void = () => undefined;
    const pendingLoad = new Promise<unknown[]>((r) => (finish = r));
    const f = await freshFonts({ load: vi.fn(() => pendingLoad), check: vi.fn(() => true) });
    const late = vi.fn();
    f.onUiFontsLate(late);
    const p = f.loadUiFonts(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe(false);
    expect(f.uiFontsReady()).toBe(false);
    finish([{}]);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.uiFontsReady()).toBe(true);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('제한 안에 받으면 onUiFontsLate는 부르지 않는다', async () => {
    const f = await freshFonts({ load: vi.fn(() => Promise.resolve([{}])), check: vi.fn(() => true) });
    const late = vi.fn();
    f.onUiFontsLate(late);
    expect(await f.loadUiFonts()).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(late).not.toHaveBeenCalled();
  });
});
