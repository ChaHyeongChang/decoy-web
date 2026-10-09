// 터치 판 배치 (M12, MOBILE_PLAN M12 1 · 2번): layoutFor 터치 분기(화면비 규칙 · 세로 입력은 가로로 · 맵이 화면 안 · 띠 규칙),
// 터치 글자 크기(CSS 12px 이상, 주요 14 이상 — 높이 293 · 320 · 360), 터치 HUD 부품이 맵 · 서로 · 엄지 영역(터치 화면 대상 ·
// 이동 스틱 그림)과 겹치지 않음, 배너 자리 · 맨 아래 안내 줄이 터치 대상과 겹치지 않음. PC는 언제나 1920×1080 그대로
import { afterEach, describe, expect, it } from 'vitest';
import * as L from '../../client/src/ui/layout';
import { touchLayout, type Box } from '../../client/src/ui/touchControls';

afterEach(() => L.applyLayout(L.pcLayout()));

/** 휴대폰 가로(높이 293~412, 안전 영역을 뺀 크기 포함) · 16:9 · 태블릿 (CSS px) */
const SCREENS: [string, number, number][] = [
  ['Pixel 7 전체 화면', 915, 412],
  ['Pixel 7 브라우저', 863, 360],
  ['Galaxy S9+', 658, 320],
  ['Pixel 5', 802, 293],
  ['Galaxy S8', 740, 360],
  ['iPhone 12', 750, 340],
  ['iPhone 14 + 노치 안전 영역', 750, 369],
  ['Pixel 5 + 안전 영역', 758, 277],
  ['정확히 2:1', 720, 360],
  ['2:1 · 낮음', 640, 320],
  ['21:9', 840, 360],
  ['16:9 휴대폰', 640, 360],
  ['16:9', 960, 540],
  ['iPhone SE', 568, 320],
  ['iPhone 8', 667, 375],
  ['Galaxy Tab S9', 1024, 640],
  ['16:10 태블릿', 1280, 800],
  ['4:3 태블릿', 1024, 768],
  ['iPad Pro 11', 1194, 834],
  ['iPad Pro 12.9', 1366, 1024],
];

/** 겹치는가 (닿기만 하면 아니다) */
function overlaps(a: Box, b: Box, eps = 0.01): boolean {
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

const cssOf = (l: L.LayoutInfo): number => l.viewH / (l.uiScale / L.TOUCH_UI.art);

describe('터치 배치 layoutFor', () => {
  it('PC는 화면과 상관없이 언제나 1920×1080 (터치 HUD 자리 없음)', () => {
    for (const [, w, h] of SCREENS) {
      expect(L.layoutFor(w, h, false)).toEqual(L.pcLayout());
      expect(L.touchHudPlan(L.layoutFor(w, h, false))).toBeNull();
    }
    L.applyLayout(L.pcLayout());
    expect(L.HUD.touch).toBeNull();
    expect(L.HUD.s).toBe(1);
  });

  it('화면비 규칙: 2:1 이상(좌우 칸이 팀 카드 폭 이상)은 넓은 배치 · 맵이 높이 가득, 그보다 좁으면 위 · 아래 띠', () => {
    const kinds = Object.fromEntries(SCREENS.map(([n, w, h]) => [n, L.layoutFor(w, h, true).kind]));
    expect(kinds).toMatchObject({
      'Pixel 7 전체 화면': 'touchWide',
      'Pixel 7 브라우저': 'touchWide',
      'Galaxy S9+': 'touchWide',
      'Pixel 5': 'touchWide',
      '정확히 2:1': 'touchWide',
      '16:9 휴대폰': 'touchNarrow',
      '16:9': 'touchNarrow',
      'iPhone SE': 'touchNarrow',
      'Galaxy Tab S9': 'touchNarrow',
      '4:3 태블릿': 'touchNarrow',
    });
    // 2:1이어도 좌우 칸이 팀 카드 폭보다 좁으면(높이 320) 16:9 배치
    expect(kinds['2:1 · 낮음']).toBe('touchNarrow');
    for (const [name, w, h] of SCREENS) {
      const l = L.layoutFor(w, h, true);
      // 논리 크기는 화면비 그대로 (캔버스가 화면을 가득 채운다)
      expect(l.viewW / l.viewH, name).toBeCloseTo(w / h, 2);
      // 맵 배율은 고정, 맵은 화면 안 가운데
      expect(l.mapX, name).toBeGreaterThanOrEqual(0);
      expect(l.mapX * 2 + L.MAP_DRAW_W, name).toBeCloseTo(l.viewW, 6);
      expect(l.mapY + L.MAP_DRAW_H, name).toBeLessThanOrEqual(l.viewH + 1e-6);
      if (l.kind === 'touchWide') {
        expect([l.hudBand, l.mapY, l.viewH], name).toEqual([0, 0, L.MAP_DRAW_H]);
        // 좌우 칸 ≥ 팀 카드 폭 (CSS)
        expect((l.mapX * h) / l.viewH, name).toBeGreaterThanOrEqual(L.TOUCH_UI.minSide - 1e-6);
      } else {
        // 위 · 아래 띠는 같은 높이, CSS 26px 이상 (타이머 한 줄)
        expect(l.mapY, name).toBeCloseTo(l.hudBand, 9);
        expect(l.viewH, name).toBeCloseTo(L.MAP_DRAW_H + l.hudBand * 2, 6);
        expect((l.hudBand * h) / l.viewH, name).toBeGreaterThanOrEqual(L.TOUCH_UI.band - 1e-6);
      }
      // uiScale = 그림 단위 CSS px × 논리/CSS
      expect(cssOf(l), name).toBeCloseTo(h, 6);
    }
  });

  it('휴대폰 2:1~2.4:1의 논리 폭은 1920~2400 (더 넓은 화면은 좌우 칸이 넓어진다)', () => {
    for (const [w, h] of [
      [720, 360],
      [844, 390],
      [915, 412],
      [863, 360],
    ] as const) {
      const l = L.layoutFor(w, h, true);
      expect(l.viewW).toBeGreaterThanOrEqual(1900);
      expect(l.viewW).toBeLessThanOrEqual(2400);
    }
    const tall = L.layoutFor(802, 293, true);
    expect(tall.viewW).toBeGreaterThan(2400);
    expect(tall.viewH).toBe(L.MAP_DRAW_H);
  });

  it('세로로 받은 크기는 긴 변을 폭으로 본다 (세로로 열었다 돌려 판을 시작)', () => {
    for (const [, w, h] of SCREENS) expect(L.layoutFor(h, w, true)).toEqual(L.layoutFor(w, h, true));
  });
});

describe('터치 글자 크기', () => {
  // 화면 높이 293 · 320 · 360 (그리고 모든 시험 화면)에서 글자 크기 × 배율 ≥ 12 CSS px, 주요 글자 ≥ 14
  const MAIN = [
    'gaugeLetter',
    'timer',
    'cardName',
    'banner',
    'bannerRow',
    'note',
    'boardTitle',
    'boardRow',
  ] as const;
  it('보조 글자 12px 이상 · 주요 글자 14px 이상 (CSS)', () => {
    const heights = new Set<number>();
    for (const [name, w, h] of SCREENS) {
      const l = L.layoutFor(w, h, true);
      L.applyLayout(l);
      heights.add(h);
      const css = (logical: number): number => (logical * h) / l.viewH;
      for (const [key, px] of Object.entries(L.HUD.font)) {
        if (key === 'noteLine') continue;
        expect(css(px), `${name} ${key}`).toBeGreaterThanOrEqual(L.TOUCH_UI.font.small);
      }
      for (const key of MAIN) expect(css(L.HUD.font[key]), `${name} ${key}`).toBeGreaterThanOrEqual(14);
    }
    for (const h of [293, 320, 360]) expect(heights.has(h)).toBe(true);
  });
});

describe('터치 HUD 자리 touchHudPlan', () => {
  for (const [name, w, h] of SCREENS)
    for (const monster of [true, false])
      it(`${name} ${w}×${h} ${monster ? '괴물' : '생존자'}: 맵 · 서로 · 엄지 영역과 겹치지 않고 화면 안`, () => {
        const l = L.layoutFor(w, h, true);
        L.applyLayout(l);
        const t = L.HUD.touch!;
        expect(t).not.toBeNull();
        const plan = monster ? t.monster : t.survivor;
        const k = 1 / t.L;
        const toCss = (r: Box): Box => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
        const rects = plan.rects.map((r) => ({ id: r.id, css: toCss(r.rect), rect: r.rect }));
        const ids = rects.map((r) => r.id);
        expect(ids).toEqual(expect.arrayContaining(['timer', 'gaugeA', 'gaugeB', 'card0', 'card1', 'card2']));
        for (const r of rects) {
          // 화면 안
          expect(r.rect.x, `${r.id} 왼쪽`).toBeGreaterThanOrEqual(-1e-6);
          expect(r.rect.y, `${r.id} 위`).toBeGreaterThanOrEqual(-1e-6);
          expect(r.rect.x + r.rect.w, `${r.id} 오른쪽`).toBeLessThanOrEqual(l.viewW + 1e-6);
          expect(r.rect.y + r.rect.h, `${r.id} 아래`).toBeLessThanOrEqual(l.viewH + 1e-6);
          // 맵과 겹치지 않는다
          expect(overlaps(r.rect, L.MAP_RECT), `${r.id} ↔ 맵`).toBe(false);
        }
        for (let i = 0; i < rects.length; i += 1)
          for (let j = i + 1; j < rects.length; j += 1)
            expect(overlaps(rects[i]!.css, rects[j]!.css), `${rects[i]!.id} ↔ ${rects[j]!.id}`).toBe(false);
        // 터치 화면(전체 화면 버튼까지)을 HUD를 비켜 배치하면 모든 대상 · 이동 스틱 그림과 겹치지 않는다
        const T = touchLayout(
          w,
          h,
          { l: 0, r: 0, t: 0, b: 0 },
          monster,
          true,
          rects.map((r) => r.css),
        );
        const targets: [string, Box][] = [['move-zone', T.zone]];
        if (T.aim) targets.push(['aim-stick', T.aim]);
        for (const [id, b] of Object.entries(T.buttons)) if (b) targets.push([id, b]);
        const ghost = {
          x: T.moveHome.x - T.moveR,
          y: T.moveHome.y - T.moveR,
          w: T.moveR * 2,
          h: T.moveR * 2,
        };
        targets.push(['move-ghost', ghost]);
        for (const r of rects)
          for (const [id, b] of targets) expect(overlaps(r.css, b), `${r.id} ↔ ${id}`).toBe(false);
        // 이동 영역은 이동 스틱 그림을 품고, 화면 아래쪽 절반 이상 높이
        expect(T.zone.y).toBeLessThanOrEqual(ghost.y);
        expect(T.zone.h).toBeGreaterThanOrEqual(h * 0.4);
        // 맨 아래 안내 줄 (가장자리 띠 안)은 어떤 터치 대상과도 겹치지 않는다
        const hint = { x: 0, y: (t.hint.y - t.hint.h / 2) * k, w, h: t.hint.h * k };
        for (const [id, b] of targets)
          if (id !== 'move-ghost') expect(overlaps(hint, b), `안내 줄 ↔ ${id}`).toBe(false);
        expect(hint.y + hint.h).toBeLessThanOrEqual(h);
        // 배너 · 메모 자리는 맵 안, 오른쪽 위 버튼이 맵에 걸치면 그 아래
        expect(t.overlay.x0).toBeGreaterThanOrEqual(L.MAP_RECT.x);
        expect(t.overlay.x1).toBeLessThanOrEqual(L.MAP_RECT.x + L.MAP_RECT.w);
        const sys = [T.buttons.scoreboard!, T.buttons.fullscreen!];
        const band = {
          x: t.overlay.x0 * k,
          y: t.overlay.top * k,
          w: (t.overlay.x1 - t.overlay.x0) * k,
          h: 1,
        };
        for (const b of sys)
          expect(band.y >= b.y + b.h || !overlaps({ ...band, y: b.y, h: b.h }, b)).toBe(true);
      });

  it('작은 화면 규칙: 오른쪽 칸에 자리가 없으면 미니맵을 숨기고, 왼쪽 칸이 모자라면 거점 게이지를 오른쪽 칸으로', () => {
    const plan = (w: number, h: number, monster: boolean) => {
      L.applyLayout(L.layoutFor(w, h, true));
      const t = L.HUD.touch!;
      return monster ? t.monster : t.survivor;
    };
    // 넓은 휴대폰: 미니맵 있음
    expect(plan(915, 412, true).minimap).not.toBeNull();
    expect(plan(915, 412, false).minimap).not.toBeNull();
    // 가장 낮은 휴대폰 괴물: 버튼 무리가 오른쪽 칸을 채워 미니맵 없음, 생존자는 있음
    expect(plan(802, 293, true).minimap).toBeNull();
    expect(plan(802, 293, false).minimap).not.toBeNull();
    // 좁은 칸 · 낮은 화면: 게이지가 오른쪽 칸(화면 오른쪽 절반)
    const s9 = plan(658, 320, true);
    expect(s9.gaugeA.x / L.HUD.touch!.L).toBeGreaterThan(658 / 2);
    // 태블릿 4:3: 위 띠에 모두 (좌우 칸 없음), 미니맵 없음
    L.applyLayout(L.layoutFor(1024, 768, true));
    expect(L.HUD.touch!.mode).toBe('band');
    expect(L.HUD.touch!.monster.minimap).toBeNull();
    for (const r of L.HUD.touch!.monster.rects) expect(r.rect.y + r.rect.h).toBeLessThanOrEqual(L.MAP_RECT.y);
  });

  it('HUD를 넘기지 않으면 터치 화면 배치는 M11 그대로 (이동 영역 = 왼쪽 40% 전체 높이)', () => {
    const a = touchLayout(863, 360, { l: 0, r: 0, t: 0, b: 0 }, true, true);
    const b = touchLayout(863, 360, { l: 0, r: 0, t: 0, b: 0 }, true, true, []);
    expect(a).toEqual(b);
    expect(a.zone.y).toBe(0);
    expect(a.zone.h).toBe(360 - 24);
  });
});
