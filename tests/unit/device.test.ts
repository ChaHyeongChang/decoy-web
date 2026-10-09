// 기기 감지 · 세로 안내 · 브라우저 기본 동작 막기 (M11, MOBILE_PLAN M11 3 · 6 · 7번)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICONS } from '../../client/src/art/icons';
import { TOUCH_TEXT } from '../../client/src/data/storyText';
import { PORTRAIT_QUERY, detectInBrowser, detectTouchMode } from '../../client/src/device';

const html = readFileSync('client/index.html', 'utf8');
const css = readFileSync('client/src/style.css', 'utf8');
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('터치 모드 감지 detectTouchMode', () => {
  it('?touch=1 · ?touch=0이 기기 판단보다 우선한다', () => {
    for (const coarse of [true, false])
      for (const hoverNone of [true, false]) {
        expect(detectTouchMode({ touchParam: '1', coarse, hoverNone })).toBe(true);
        expect(detectTouchMode({ touchParam: '0', coarse, hoverNone })).toBe(false);
      }
  });

  it('값이 없으면 (pointer: coarse) 그리고 (hover: none)일 때만 (마우스 달린 터치 노트북 · PC는 아님)', () => {
    expect(detectTouchMode({ touchParam: null, coarse: true, hoverNone: true })).toBe(true);
    expect(detectTouchMode({ touchParam: null, coarse: true, hoverNone: false })).toBe(false);
    expect(detectTouchMode({ touchParam: null, coarse: false, hoverNone: true })).toBe(false);
    expect(detectTouchMode({ touchParam: null, coarse: false, hoverNone: false })).toBe(false);
  });

  it('1 · 0이 아닌 값은 없는 것과 같다', () => {
    for (const raw of ['', 'yes', 'true', '2'])
      expect(detectTouchMode({ touchParam: raw, coarse: false, hoverNone: false }), raw).toBe(false);
    expect(detectTouchMode({ touchParam: 'true', coarse: true, hoverNone: true })).toBe(true);
  });
});

describe('브라우저 안인가 detectInBrowser ("전체 화면" 버튼)', () => {
  it('설치 앱 · TWA(display-mode standalone · fullscreen) · iOS 홈 화면 앱이면 아니다', () => {
    expect(detectInBrowser({ standalone: false, fullscreen: false, iosStandalone: false })).toBe(true);
    expect(detectInBrowser({ standalone: true, fullscreen: false, iosStandalone: false })).toBe(false);
    expect(detectInBrowser({ standalone: false, fullscreen: true, iosStandalone: false })).toBe(false);
    expect(detectInBrowser({ standalone: false, fullscreen: false, iosStandalone: true })).toBe(false);
  });
});

describe('세로 안내 (JS 없이도 뜨는 정적 마크업)', () => {
  it('index.html에 storyText와 같은 문구가 있다', () => {
    expect(html).toContain('data-testid="rotate-notice"');
    expect(squash(html)).toContain(`<p class="rotate-title">${TOUCH_TEXT.rotateTitle}</p>`);
    expect(squash(html)).toContain(`<p class="rotate-body"> ${TOUCH_TEXT.rotateBody} </p>`);
    expect(squash(html)).toContain(`${TOUCH_TEXT.fullscreen} </button>`);
  });

  it('전체 화면 버튼 아이콘은 icons.ts fullscreen과 같은 그림이고, 처음에는 숨김 (JS가 터치 · 브라우저 안일 때만 연다)', () => {
    const d = ICONS.fullscreen[0]?.d ?? '';
    expect(d.length).toBeGreaterThan(0);
    expect(html).toContain(`d="${d}"`);
    expect(squash(html)).toMatch(/id="rotate-fullscreen"[^>]*hidden>/);
  });

  it('CSS: 세로 안내는 device.ts와 같은 미디어 쿼리에서만 보이고(PC 좁은 창 제외), 그 밖에는 display: none', () => {
    expect(PORTRAIT_QUERY).toBe('(orientation: portrait) and (pointer: coarse)');
    expect(css).toMatch(/\.rotate-notice \{\s*display: none;\s*\}/);
    const at = css.indexOf(`@media ${PORTRAIT_QUERY}`);
    expect(at).toBeGreaterThan(0);
    expect(css.slice(at, at + 200)).toMatch(/\.rotate-notice \{\s*position: fixed;/);
  });
});

describe('브라우저 기본 동작 막기', () => {
  it('viewport: 확대 막기 (maximum-scale=1, user-scalable=no)', () => {
    const meta = /<meta name="viewport" content="([^"]+)"/.exec(html)?.[1] ?? '';
    const parts = meta.split(',').map((s) => s.trim());
    expect(parts).toEqual(
      expect.arrayContaining([
        'width=device-width',
        'initial-scale=1',
        'maximum-scale=1',
        'user-scalable=no',
      ]),
    );
  });

  it('html · body는 당겨서 새로고침 · 선택 · 길게 누르기 메뉴 · 탭 강조가 없고, 입력칸은 선택된다', () => {
    const body = /html,\s*body \{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const rule of [
      'overscroll-behavior: none',
      'user-select: none',
      '-webkit-touch-callout: none',
      '-webkit-tap-highlight-color: transparent',
    ])
      expect(body, rule).toContain(rule);
    expect(css).toMatch(/input,\s*select \{\s*user-select: text;/);
  });

  it('게임 영역 · 터치 레이어는 touch-action: none, 로비 · 결과는 세로 스크롤만(pan-y)', () => {
    const block = (sel: string): string =>
      new RegExp(`(?:^|\\n)${sel.replace(/[.#]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(block('#game-root')).toContain('touch-action: none');
    expect(block('.touch-layer')).toContain('touch-action: none');
    expect(block('.touch-layer')).toContain('-webkit-touch-callout: none');
    expect(block('.lobby')).toContain('touch-action: pan-y');
    expect(block('.result')).toContain('touch-action: pan-y');
  });

  it('쌓는 순서: 터치 레이어(5) < 로비 · 결과(20) < 세로 안내(80)', () => {
    const z = (sel: string): number => {
      const m = new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.#]/g, '\\$&')} \\{[^}]*z-index: (\\d+)`).exec(css);
      return Number(m?.[1] ?? NaN);
    };
    expect(z('.touch-layer')).toBe(5);
    expect(z('.lobby')).toBe(20);
    expect(z('.result')).toBe(20);
    expect(z('.rotate-notice')).toBe(80);
  });
});
