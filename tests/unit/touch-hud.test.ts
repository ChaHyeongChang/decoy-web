// 터치 판 배치 (M12, MOBILE_PLAN M12 1 · 2번): layoutFor 터치 분기(화면비 규칙 · 세로 입력은 가로로 · 맵이 화면 안 · 띠 규칙),
// 터치 글자 크기(CSS 12px 이상, 주요 14 이상 — 높이 293 · 320 · 360), 터치 HUD 부품이 맵 · 서로 · 엄지 영역(터치 화면 대상 ·
// 이동 스틱 그림)과 겹치지 않음, 배너 자리 · 맨 아래 안내 줄이 터치 대상과 겹치지 않음. PC는 언제나 1920×1080 그대로.
// 판 중 창이 낮아지면(M12 검토) 엄지 버튼이 덮는 HUD 부품을 찾는다(hudCovered → 미니맵을 숨긴다)
// 거점 줄 게이지(플레이테스트 a-7): 줄들이 예전 링 게이지 한 쌍과 같은 사각형을 채우고, 줄 수를 인자로 받는다
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { computeRenderSize } from '../../client/src/render/resolution';
import * as L from '../../client/src/ui/layout';
import {
  CAP_BELOW,
  hudCovered,
  thumbAvoidBoxes,
  touchLayout,
  type Box,
} from '../../client/src/ui/touchControls';

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
  ['iPad 가로 Split View 1/2', 820, 590],
  ['4:3 작은 창', 800, 600],
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

/**
 * 이동 영역이 최소 높이(이동 스틱 그림 + 24px, 화면 높이의 38~38.4%)인 화면 · 역할 (거점 셋 — 플레이테스트 b). 360 안팎 괴물은 오른쪽 칸이
 * 좁아(포효 · 시야 줄) 타이머를 옮기면 옆 칸 미니맵이 없어져 맵을 가리므로 왼쪽 칸에 타이머 · 게이지 · 카드를 다 둔다. Galaxy S9+ 괴물은
 * 왼쪽 칸 89px · 오른쪽 칸 45px라 어떻게 놓아도 그렇다. 생존자는 모두 40% 이상
 */
const ZONE_MIN = new Set([
  'Pixel 7 브라우저 괴물',
  'Galaxy S9+ 괴물',
  'Galaxy S8 괴물',
  'iPhone 14 + 노치 안전 영역 괴물',
  '21:9 괴물',
]);

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
        expect(ids).toEqual(
          expect.arrayContaining(['timer', 'gaugeA', 'gaugeB', 'gaugeC', 'card0', 'card1', 'card2']),
        );
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
        // 이동 영역은 이동 스틱 그림을 품고, 화면 높이의 40% 이상. ZONE_MIN(거점 셋 — 플레이테스트 b)만 이동 영역 최소 높이(이동 스틱
        // 그림 + 24px): 줄 게이지 셋 · 팀 카드 셋이 왼쪽 칸에 쌓여 이동 영역 위 끝을 밀지만 겹치지는 않는다
        expect(T.zone.y).toBeLessThanOrEqual(ghost.y);
        const tight = ZONE_MIN.has(`${name} ${monster ? '괴물' : '생존자'}`);
        expect(T.zone.h).toBeGreaterThanOrEqual(tight ? T.moveR * 2 + 24 : h * 0.4);
        if (tight) expect(T.zone.h).toBeLessThan(h * 0.4);
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

  it('작은 화면 규칙: 오른쪽 칸에 자리가 없으면 미니맵을 숨기고, 왼쪽 칸이 모자라면 타이머나 거점 게이지를 오른쪽 칸으로', () => {
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
    // 좁은 칸 · 낮은 화면 (거점 셋): 괴물은 게이지를 왼쪽 칸에 두고 타이머를 오른쪽 칸(시스템 버튼 아래)으로, 생존자는 오른쪽 칸이
    // 넉넉해 게이지를 오른쪽 칸으로 (괴물은 옆 칸 미니맵 자리가 원래 없다)
    const s9 = plan(658, 320, true);
    const s9L = L.HUD.touch!.L;
    expect(s9.gauges[0]!.x / s9L).toBeLessThan(658 / 2);
    expect(s9.timer.x / s9L).toBeGreaterThan(658 / 2);
    const s9s = plan(658, 320, false);
    expect(s9s.gauges[0]!.x / L.HUD.touch!.L).toBeGreaterThan(658 / 2);
    expect(s9s.timer.x / L.HUD.touch!.L).toBeLessThan(658 / 2);
    // 태블릿 4:3: 위 띠에 모두 (좌우 칸 없음), 미니맵 없음
    L.applyLayout(L.layoutFor(1024, 768, true));
    expect(L.HUD.touch!.mode).toBe('band');
    expect(L.HUD.touch!.monster.minimap).toBeNull();
    for (const r of L.HUD.touch!.monster.rects) expect(r.rect.y + r.rect.h).toBeLessThanOrEqual(L.MAP_RECT.y);
  });

  it('따라가는 카메라: 옆 칸에 미니맵 자리가 없으면 맵 창 안 미니맵 자리가 있다 — 틀까지 맵 안, 터치 버튼 · 다른 HUD 부품과 안 겹침', () => {
    const art = L.TOUCH_UI.art;
    const pad = L.TOUCH_PART.minimap.pad * art;
    const title = L.TOUCH_PART.minimap.title * art;
    let insets = 0;
    // 낮은 16:9 브라우저 크기 (검토 반영: 괴물이 옆 칸 · 안쪽 미니맵을 둘 다 못 받던 크기)
    const LOW_16_9: [string, number, number][] = [
      ['16:9 낮음 592×280', 592, 280],
      ['16:9 낮음 568×270', 568, 270],
      ['16:9 낮음 600×300', 600, 300],
      ['534×300', 534, 300],
    ];
    for (const [name, w, h] of [...SCREENS, ...LOW_16_9]) {
      L.applyLayout(L.layoutFor(w, h, true));
      const t = L.HUD.touch!;
      const k = t.L;
      const map = { x: L.MAP_RECT.x / k, y: L.MAP_RECT.y / k, w: L.MAP_RECT.w / k, h: L.MAP_RECT.h / k };
      for (const monster of [true, false]) {
        const p = monster ? t.monster : t.survivor;
        const label = `${name} ${monster ? '괴물' : '생존자'}`;
        // 옆 칸 미니맵이 있으면 안쪽 미니맵은 없다. 16:9 · 태블릿처럼 옆 칸이 없으면 반드시 있다
        if (p.minimap) {
          expect(p.minimapInset, label).toBeNull();
          continue;
        }
        expect(p.minimapInset, label).not.toBeNull();
        insets += 1;
        const i = p.minimapInset!;
        const f = {
          x: i.x / k - pad,
          y: i.y / k - title,
          w: i.w / k + pad * 2,
          h: ((i.w / k) * 2) / 3 + title + pad,
        };
        expect(i.w / k, label).toBeGreaterThanOrEqual(L.MINIMAP_INSET.min);
        expect(f.x, label).toBeGreaterThanOrEqual(map.x - 0.01);
        expect(f.y, label).toBeGreaterThanOrEqual(map.y - 0.01);
        expect(f.x + f.w, label).toBeLessThanOrEqual(map.x + map.w + 0.01);
        expect(f.y + f.h, label).toBeLessThanOrEqual(map.y + map.h + 0.01);
        const lay = touchLayout(w, h, { l: 0, r: 0, t: 0, b: 0 }, monster, true);
        for (const b of [lay.aim, ...Object.values(lay.buttons)])
          if (b) expect(overlaps(f, b), `${label} ↔ 버튼`).toBe(false);
        for (const r of p.rects)
          expect(
            overlaps(f, { x: r.rect.x / k, y: r.rect.y / k, w: r.rect.w / k, h: r.rect.h / k }),
            `${label} ↔ ${r.id}`,
          ).toBe(false);
      }
    }
    expect(insets).toBeGreaterThan(8);
  });

  // ── 거점 줄 게이지 (플레이테스트 a-7) ──

  /** 줄 게이지를 보는 화면 격자: 아이폰 14 Chrome(750×369 · 주소창 750×300) · 안드로이드 360 높이 · 16:9 · 낮은 화면 · 태블릿 */
  const GAUGE_GRID: [number, number][] = [
    [863, 360],
    [740, 360],
    [750, 369],
    [750, 300],
    [658, 320],
    [640, 360],
    [667, 375],
    [844, 390],
    [802, 293],
    [1024, 768],
    [1280, 800],
    [640, 320],
    [568, 320],
    [758, 277],
    [915, 412],
    [820, 590],
    [800, 600],
    [900, 600],
  ];
  /**
   * 거점 셋(플레이테스트 b)의 줄 게이지 자리 (판과 같은 조정, CSS px): [쌓기 | 가로 한 줄, 첫 줄 x · y, 타이머 틀 왼쪽 위 x · y].
   * 세 줄은 두 줄보다 17.7px 높아 360 안팎 휴대폰 왼쪽 칸에 타이머 · 게이지 · 카드가 다 들어가면 이동 영역이 최소가 된다:
   * 생존자는 타이머를 오른쪽 칸 미니맵 아래로(④), 괴물은 오른쪽 칸이 좁아(포효 줄) 타이머를 옮기면 옆 칸 미니맵이 없어지므로 왼쪽 칸에
   * 다 두고 이동 영역을 최소로(②). 낮은 16:9 · 태블릿은 위 띠에 가로 한 줄(⑤ · 태블릿은 PC처럼 A · B · 타이머 · C), 낮은 넓은 화면은
   * 왼쪽 칸 두 열(⑥ — 타이머 + 게이지 | 팀 카드), 가장 낮은 휴대폰은 괴물 ④(타이머가 오른쪽 칸 남는 자리 가운데) · 생존자 ③(게이지가
   * 오른쪽 칸). 좌우 칸이 없는 좁은 태블릿 창(폭 약 920 미만 — 위 띠 한 줄이 판 중 시스템 버튼 왼쪽에 들어가지 않는다)은 띠를 두 줄로
   * 키워 아랫줄에 가로 한 줄(820×590 · 800×600 — 타이머 아래 가운데), 그만큼 띠를 키우면 좌우 칸이 생기는 화면은 좌우 칸 배치(900×600).
   * 바꾸면 이 표를 고친다 (자리가 바뀌는 것을 모르고 넘기지 않게)
   */
  const GAUGE_SPOT: Readonly<Record<string, readonly ['stack' | 'run', number, number, number, number]>> = {
    '863×360 monster': ['stack', 43.34, 35.12, 30.74, 6],
    '863×360 survivor': ['stack', 43.34, 6, 732.21, 184.61],
    '740×360 monster': ['stack', 12.61, 35.12, 6, 6],
    '740×360 survivor': ['stack', 12.61, 6, 646.02, 143.64],
    '750×369 monster': ['stack', 11.73, 35.12, 6, 6],
    '750×369 survivor': ['stack', 11.73, 6, 657.76, 143.47],
    '750×300 monster': ['stack', 37.6, 6, 625, 66.44],
    '750×300 survivor': ['stack', 637.6, 64, 25, 6],
    '658×320 monster': ['stack', 7.14, 6, 575.08, 74.94],
    '658×320 survivor': ['stack', 576.21, 64, 6, 6],
    '640×360 monster': ['stack', 7.09, 6, 269.97, 1.44],
    '640×360 survivor': ['stack', 7.09, 6, 269.97, 1.44],
    '667×375 monster': ['stack', 8.23, 6, 283.52, 1.44],
    '667×375 survivor': ['stack', 8.23, 6, 283.52, 1.44],
    '844×390 monster': ['stack', 27.33, 35.12, 14.73, 6],
    '844×390 survivor': ['stack', 27.33, 35.12, 14.73, 6],
    '802×293 monster': ['stack', 12.84, 35.12, 12.24, 6],
    '802×293 survivor': ['stack', 12.84, 35.12, 12.24, 6],
    '1024×768 monster': ['run', 294.54, 13.16, 462.14, 10.44],
    '1024×768 survivor': ['run', 294.54, 13.16, 462.14, 10.44],
    '1280×800 monster': ['stack', 6.67, 6, 590.13, 4.44],
    '1280×800 survivor': ['stack', 6.67, 6, 590.13, 4.44],
    '640×320 monster': ['run', 6, 4.16, 269.94, 1.44],
    '640×320 survivor': ['run', 6, 4.16, 269.94, 1.44],
    '568×320 monster': ['run', 6, 5.83, 485.98, 74.94],
    '568×320 survivor': ['run', 6, 5.83, 485.98, 121.94],
    '758×277 monster': ['stack', 7.82, 35.12, 7.22, 6],
    '758×277 survivor': ['stack', 7.82, 35.12, 7.22, 6],
    '915×412 monster': ['stack', 36.82, 35.12, 24.22, 6],
    '915×412 survivor': ['stack', 36.82, 35.12, 24.22, 6],
    '820×590 monster': ['run', 291.68, 41.92, 359.88, 9.4],
    '820×590 survivor': ['run', 291.68, 41.92, 359.88, 9.4],
    '800×600 monster': ['run', 281.91, 41.92, 350.11, 9.4],
    '800×600 survivor': ['run', 281.91, 41.92, 350.11, 9.4],
    '900×600 monster': ['stack', 6.58, 6, 399.96, 17.77],
    '900×600 survivor': ['stack', 6.58, 6, 399.96, 17.77],
  };
  /** 판과 같은 배치 (main.ts applyMatchLayout: 시스템 버튼 세 칸 · 내 팀) */
  const matchPlan = (w: number, h: number, team: 'monster' | 'survivor', rows?: number) => {
    const l = L.layoutFor(w, h, true, { sysSlots: L.SYS_SLOTS_MENU, team });
    const t = L.touchHudPlan(l, rows)!;
    return { l, t, plan: t[team], k: 1 / t.L };
  };

  it('거점 줄 게이지 세 줄: 화면마다 정한 자리 — 세로로 쌓으면 맞닿고, 가로 한 줄이면 같은 높이 · 틈 6px로 왼쪽부터 A · B · C (화면 격자 × 두 역할)', () => {
    expect(L.GAUGE_IDS).toEqual(['A', 'B', 'C']);
    expect(L.TOUCH_PART.gaugeRow).toEqual({ w: 110, h: 26 });
    const rowW = 110 * L.TOUCH_UI.art;
    const rowH = 26 * L.TOUCH_UI.art;
    let checked = 0;
    for (const [w, h] of GAUGE_GRID)
      for (const team of ['monster', 'survivor'] as const) {
        const label = `${w}×${h} ${team}`;
        const { plan, k } = matchPlan(w, h, team);
        const want = GAUGE_SPOT[label];
        expect(want, label).toBeDefined();
        if (!want) continue;
        const [kind, x0, y0, tx, ty] = want;
        const rows = plan.gauges.map((r) => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }));
        expect(rows.length, label).toBe(3);
        expect(rows[0]!.x, `${label} 첫 줄 x`).toBeCloseTo(x0, 1);
        expect(rows[0]!.y, `${label} 첫 줄 y`).toBeCloseTo(y0, 1);
        expect((plan.timer.x - plan.timer.w / 2) * k, `${label} 타이머 x`).toBeCloseTo(tx, 1);
        expect((plan.timer.y - plan.timer.h / 2) * k, `${label} 타이머 y`).toBeCloseTo(ty, 1);
        rows.forEach((r, i) => {
          expect(r.w, `${label} 줄 ${i} 폭`).toBeCloseTo(rowW, 6);
          expect(r.h, `${label} 줄 ${i} 높이`).toBeCloseTo(rowH, 6);
          if (i === 0) return;
          const q = rows[i - 1]!;
          if (kind === 'stack') {
            expect(r.x, `${label} 줄 ${i} x`).toBeCloseTo(q.x, 6);
            expect(r.y, `${label} 줄 ${i} y (맞닿음)`).toBeCloseTo(q.y + q.h, 6);
          } else {
            expect(r.y, `${label} 줄 ${i} y`).toBeCloseTo(q.y, 6);
            // 틈 6 (태블릿은 A · B와 C 사이에 타이머)
            expect(r.x, `${label} 줄 ${i} x`).toBeGreaterThanOrEqual(q.x + q.w + L.TOUCH_UI.gap - 1e-6);
          }
        });
        // 늘 떠 있는 부품 목록의 gaugeA · gaugeB · gaugeC가 같은 줄 사각형이다 (이동 영역 · 조작 배치 편집이 피하는 자리)
        L.GAUGE_IDS.forEach((id, i) => {
          const rect = plan.rects.find((r) => r.id === `gauge${id}`)?.rect;
          expect(rect, `${label} gauge${id}`).toEqual(plan.gauges[i]);
        });
        checked += 1;
      }
    expect(checked).toBe(GAUGE_GRID.length * 2);
    // 태블릿 4:3 위 띠는 PC처럼 A · B · 타이머 · C
    const tab = matchPlan(1024, 768, 'monster').plan;
    const timerL = tab.timer.x - tab.timer.w / 2;
    expect(tab.gauges[1]!.x + tab.gauges[1]!.w).toBeLessThan(timerL);
    expect(tab.gauges[2]!.x).toBeGreaterThan(tab.timer.x + tab.timer.w / 2);
  });

  it('위 띠 두 줄: 한 줄(팀 카드 · 타이머 · 게이지 셋)이 시스템 버튼 왼쪽에 들어가지 않는 창은 띠를 두 줄 높이로 키워 게이지를 아랫줄에 — 띠를 키워 좌우 칸이 생기면 좌우 칸 배치, 들어가는 창은 띠 44 한 줄 그대로', () => {
    const U = L.TOUCH_UI;
    // 두 줄 띠 = 위 · 아래 여백 + 팀 카드 줄 + 간격 + 게이지 줄 (CSS)
    const two = U.edge * 2 + U.gap + (L.TOUCH_PART.card.h + L.TOUCH_PART.gaugeRow.h) * U.art;
    const cases: [number, number, 'band' | 'column', number, 'two' | 'one'][] = [
      [820, 590, 'band', two, 'two'],
      [800, 600, 'band', two, 'two'],
      [720, 540, 'band', two, 'two'],
      // 맵이 폭에 들어가려면 원래 띠가 더 높다 (띠는 그대로, 두 줄은 띠 가운데)
      [820, 780, 'band', (780 * 1.5 - 820) / 3, 'two'],
      // 두 줄 띠면 좌우 칸이 팀 카드 폭 이상 → 좌우 칸이 팀 카드 폭이 되는 띠의 좌우 칸 배치 (맵이 더 크다)
      [900, 600, 'column', (600 * 1.5 - 900 + 2 * U.minSide) / 3, 'one'],
      // 한 줄에 들어간다 (그대로)
      [1024, 768, 'band', U.bandStack, 'one'],
      [1194, 834, 'band', U.bandStack, 'one'],
    ];
    for (const [w, h, mode, band, rows] of cases)
      for (const team of ['monster', 'survivor'] as const) {
        const label = `${w}×${h} ${team}`;
        const { l, t, plan, k } = matchPlan(w, h, team);
        expect(t.mode, label).toBe(mode);
        expect(l.hudBand * k, label).toBeCloseTo(band, 4);
        if (mode !== 'band') continue;
        const g = plan.gauges.map((r) => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }));
        const cardsBottom = (plan.cards.y + plan.cards.h) * k;
        const timerBottom = (plan.timer.y + plan.timer.h / 2) * k;
        if (rows === 'two') {
          // 아랫줄: 팀 카드 · 타이머 아래, 띠 안. 타이머 아래 가운데 (720은 시스템 버튼에 닿아 그 왼쪽)
          for (const r of g) {
            expect(r.y, label).toBeGreaterThanOrEqual(Math.max(cardsBottom, timerBottom) + U.gap - 1e-6);
            expect(r.y + r.h, label).toBeLessThanOrEqual(l.hudBand * k + 1e-6);
          }
          if (w !== 720) expect((g[0]!.x + g[2]!.x + g[2]!.w) / 2, label).toBeCloseTo(w / 2, 0);
        } else {
          // 한 줄: 게이지 가운데 높이 = 띠 가운데
          for (const r of g) expect(r.y + r.h / 2, label).toBeCloseTo(band / 2, 4);
        }
      }
  });

  it('거점 줄 게이지는 다른 HUD 부품 · 맵 · 터치 버튼 · 스틱과 겹치지 않는다 (화면 격자 × 두 역할, 판과 같은 조정)', () => {
    let pairs = 0;
    for (const [w, h] of GAUGE_GRID)
      for (const team of ['monster', 'survivor'] as const) {
        const label = `${w}×${h} ${team}`;
        const { l, plan, k } = matchPlan(w, h, team);
        const toCss = (r: Box): Box => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
        const rows = plan.gauges.map(toCss);
        const others = plan.rects
          .filter((r) => !/^gauge/.test(r.id))
          .map((r) => ({ id: r.id, css: toCss(r.rect) }));
        expect(others.length, label).toBeGreaterThanOrEqual(4);
        const map = toCss({ x: l.mapX, y: l.mapY, w: L.MAP_DRAW_W, h: L.MAP_DRAW_H });
        const T = touchLayout(
          w,
          h,
          { l: 0, r: 0, t: 0, b: 0 },
          team === 'monster',
          true,
          plan.rects.map((r) => toCss(r.rect)),
          { menu: true, sysRows: plan.sysRows, viewRatio: l.viewW / l.viewH },
        );
        const targets: [string, Box][] = [['move-zone', T.zone]];
        if (T.aim) targets.push(['aim-stick', T.aim]);
        for (const [id, b] of Object.entries(T.buttons)) if (b) targets.push([id, b]);
        targets.push([
          'move-ghost',
          { x: T.moveHome.x - T.moveR, y: T.moveHome.y - T.moveR, w: T.moveR * 2, h: T.moveR * 2 },
        ]);
        rows.forEach((r, i) => {
          expect(r.x, `${label} 줄 ${i} 화면 안`).toBeGreaterThanOrEqual(-1e-6);
          expect(r.y, `${label} 줄 ${i} 화면 안`).toBeGreaterThanOrEqual(-1e-6);
          expect(r.x + r.w, `${label} 줄 ${i} 화면 안`).toBeLessThanOrEqual(w + 1e-6);
          expect(r.y + r.h, `${label} 줄 ${i} 화면 안`).toBeLessThanOrEqual(h + 1e-6);
          expect(overlaps(r, map), `${label} 줄 ${i} ↔ 맵`).toBe(false);
          for (const o of others) {
            expect(overlaps(r, o.css), `${label} 줄 ${i} ↔ ${o.id}`).toBe(false);
            pairs += 1;
          }
          for (const [id, b] of targets) expect(overlaps(r, b), `${label} 줄 ${i} ↔ ${id}`).toBe(false);
          // 줄끼리도 겹치지 않는다 (맞닿기만 한다)
          rows
            .slice(i + 1)
            .forEach((q, j) => expect(overlaps(r, q), `${label} 줄 ${i} ↔ 줄 ${i + 1 + j}`).toBe(false));
        });
      }
    expect(pairs).toBeGreaterThan(150);
  });

  /**
   * 좌우 칸이 없는 좁은 태블릿 창 (CSS px, 폭 약 920 미만): 위 띠 한 줄에 팀 카드 · 타이머 · 게이지 셋(348px)이 판 중 시스템 버튼 세 칸
   * 왼쪽에 들어가지 않는다 — iPad 가로 Split View 1/2(820×590) · 4:3 작은 창 · 낮은 창. 예전 두 줄 덩어리는 띠 44에 세로로 들어갔다
   */
  const NARROW_BAND: [number, number][] = [
    [820, 590],
    [820, 780],
    [829, 690],
    [800, 600],
    [904, 690],
    [910, 700],
    [720, 540],
    [787, 501],
    [700, 600],
    [900, 600],
    [800, 540],
    [720, 480],
    [768, 694],
  ];

  it('좁은 태블릿 창(위 띠 한 줄에 다 들어가지 않는다): 거점 줄 게이지가 팀 카드 · 타이머 · 시스템 버튼 · 맵과 겹치지 않는다 (두 역할 · 좌우 반전 · 판 조정)', () => {
    let checked = 0;
    for (const [w, h] of NARROW_BAND)
      for (const team of ['monster', 'survivor'] as const)
        for (const mirror of [false, true]) {
          const label = `${w}×${h} ${team}${mirror ? ' 반전' : ''}`;
          const l = L.layoutFor(w, h, true, { sysSlots: L.SYS_SLOTS_MENU, team, mirror });
          const t = L.touchHudPlan(l)!;
          const plan = t[team];
          const k = 1 / t.L;
          const toCss = (r: Box): Box => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
          const rects = plan.rects.map((r) => ({ id: r.id, css: toCss(r.rect) }));
          const map = toCss({ x: l.mapX, y: l.mapY, w: L.MAP_DRAW_W, h: L.MAP_DRAW_H });
          const T = touchLayout(
            w,
            h,
            { l: 0, r: 0, t: 0, b: 0 },
            team === 'monster',
            true,
            rects.map((r) => r.css),
            {
              menu: true,
              sysRows: plan.sysRows,
              viewRatio: l.viewW / l.viewH,
              custom: mirror ? { mirror: true, items: {} } : null,
            },
          );
          const targets = Object.entries(T.buttons).filter((e): e is [string, Box] => e[1] !== undefined);
          if (T.aim) targets.push(['aim-stick', T.aim]);
          for (const [i, r] of rects.entries()) {
            expect(r.css.x, `${label} ${r.id} 화면 안`).toBeGreaterThanOrEqual(-1e-6);
            expect(r.css.y, `${label} ${r.id} 화면 안`).toBeGreaterThanOrEqual(-1e-6);
            expect(r.css.x + r.css.w, `${label} ${r.id} 화면 안`).toBeLessThanOrEqual(w + 1e-6);
            expect(overlaps(r.css, map), `${label} ${r.id} ↔ 맵`).toBe(false);
            for (const o of rects.slice(i + 1))
              expect(overlaps(r.css, o.css), `${label} ${r.id} ↔ ${o.id}`).toBe(false);
            for (const [id, b] of targets) expect(overlaps(r.css, b), `${label} ${r.id} ↔ ${id}`).toBe(false);
          }
          // 게이지는 읽는 차례(위 → 아래, 왼쪽 → 오른쪽)로 A · B · C
          const g = plan.gauges;
          for (let i = 1; i < g.length; i += 1)
            expect(g[i]!.y > g[i - 1]!.y + 1e-6 || g[i]!.x > g[i - 1]!.x, `${label} 게이지 차례`).toBe(true);
          checked += 1;
        }
    expect(checked).toBe(NARROW_BAND.length * 4);
  });

  it('낮은 넓은 휴대폰 괴물(높이 291): 어디에 두어도 넘치면 엄지 버튼 위 최소 간격 안으로만 들어가는 오른쪽 칸 타이머를 고른다 — 왼쪽 칸에 다 쌓아 팀 카드 둘이 이동 스틱 그림을 덮지 않는다 (타이머는 버튼과 겹치지 않는다)', () => {
    const cardH = L.TOUCH_PART.card.h * L.TOUCH_UI.art;
    for (const w of [613, 640, 658, 694]) {
      const h = 291;
      const label = `${w}×${h}`;
      const { l, plan, k } = matchPlan(w, h, 'monster');
      const toCss = (r: Box): Box => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
      const rects = plan.rects.map((r) => ({ id: r.id, css: toCss(r.rect) }));
      const T = touchLayout(
        w,
        h,
        { l: 0, r: 0, t: 0, b: 0 },
        true,
        true,
        rects.map((r) => r.css),
        { menu: true, sysRows: plan.sysRows, viewRatio: l.viewW / l.viewH },
      );
      const ghost = { x: T.moveHome.x - T.moveR, y: T.moveHome.y - T.moveR, w: T.moveR * 2, h: T.moveR * 2 };
      const timer = rects.find((r) => r.id === 'timer')!.css;
      // 타이머는 오른쪽 칸 (시스템 버튼 아래), 엄지 버튼 · 조준 스틱과 겹치지 않는다
      expect(timer.x, label).toBeGreaterThan(w / 2);
      for (const b of [T.aim!, ...Object.values(T.buttons)])
        if (b) expect(overlaps(timer, b), `${label} 타이머 ↔ 버튼`).toBe(false);
      // 이동 스틱 그림에 걸치는 팀 카드는 맨 아래 하나뿐이고, 걸친 깊이는 카드 높이보다 얕다
      const deep = rects
        .filter((r) => /^card/.test(r.id) && overlaps(r.css, ghost))
        .map((r) => ({ id: r.id, d: r.css.y + r.css.h - ghost.y }));
      expect(
        deep.map((d) => d.id),
        label,
      ).toEqual(['card2']);
      expect(deep[0]!.d, label).toBeLessThan(cardH);
    }
  });

  it('줄 수를 인자로 받는다: 한 줄 · 두 줄 · 네 줄도 같은 폭 · 같은 줄 높이로 쌓거나(왼쪽 · 오른쪽 칸) 가로 한 줄(위 띠), 기본값은 거점 수', () => {
    for (const [w, h] of [
      [844, 390],
      [802, 293],
      [640, 360],
      [1024, 768],
    ] as const) {
      const l = L.layoutFor(w, h, true);
      const base = L.touchHudPlan(l)!;
      expect(L.touchHudPlan(l, L.GAUGE_IDS.length)).toEqual(base);
      for (const n of [1, 2, 4]) {
        const t = L.touchHudPlan(l, n)!;
        for (const team of ['monster', 'survivor'] as const) {
          const rows = t[team].gauges;
          const first = rows[0]!;
          expect(rows.length, `${w}×${h} ${n}줄`).toBe(n);
          expect(first.w).toBeCloseTo(base[team].gauges[0]!.w, 6);
          expect(first.h).toBeCloseTo(base[team].gauges[0]!.h, 6);
          const run = t.mode === 'band';
          rows.forEach((r, i) => {
            expect([r.w, r.h]).toEqual([first.w, first.h]);
            if (run) {
              expect(r.y).toBe(first.y);
              if (i > 0) expect(r.x).toBeGreaterThan(rows[i - 1]!.x + r.w);
            } else {
              expect(r.x).toBe(first.x);
              expect(r.y).toBeCloseTo(first.y + i * first.h, 6);
            }
          });
          // 부품 목록에도 줄 수만큼 (이름은 거점 목록에서, 목록보다 많으면 차례 번호)
          const ids = t[team].rects.filter((r) => /^gauge/.test(r.id)).map((r) => r.id);
          expect(ids).toEqual(['gaugeA', 'gaugeB', 'gaugeC', 'gauge3'].slice(0, n));
        }
      }
    }
  });

  it('HUD를 넘기지 않으면 터치 화면 배치는 M11 그대로 (이동 영역 = 왼쪽 40% 전체 높이)', () => {
    const a = touchLayout(863, 360, { l: 0, r: 0, t: 0, b: 0 }, true, true);
    const b = touchLayout(863, 360, { l: 0, r: 0, t: 0, b: 0 }, true, true, []);
    expect(a).toEqual(b);
    expect(a.zone.y).toBe(0);
    expect(a.zone.h).toBe(360 - 24);
  });
});

describe('판 중 창이 낮아지면 엄지 버튼이 덮는 HUD 부품 hudCovered (M12 검토)', () => {
  /**
   * 판 시작 화면(w×h)으로 정한 HUD(논리 px)를 지금 창(w×nh)의 캔버스 자리로 옮겨(main.ts measure와 같은 computeRenderSize,
   * 기기 배율 1 — 판 중에는 논리 크기를 두고 캔버스만 줄인다) 그 창의 터치 화면(전체 화면 버튼까지)과 대조한다
   */
  const covered = (w: number, h: number, nh: number, monster: boolean): string[] => {
    const l = L.layoutFor(w, h, true);
    L.applyLayout(l);
    const plan = monster ? L.HUD.touch!.monster : L.HUD.touch!.survivor;
    const r = computeRenderSize({
      cssW: w,
      cssH: nh,
      dpr: 1,
      logicalW: l.viewW,
      logicalH: l.viewH,
      preset: { dprCap: 1, maxPixels: 1e12 },
      scaleOverride: null,
    });
    const k = r.dispH / l.viewH;
    const boxes = plan.rects.map(({ id, rect }) => ({
      id,
      b: { x: r.left + rect.x * k, y: r.top + rect.y * k, w: rect.w * k, h: rect.h * k },
    }));
    const T = touchLayout(
      w,
      nh,
      { l: 0, r: 0, t: 0, b: 0 },
      monster,
      true,
      boxes.map((x) => x.b),
    );
    return [...hudCovered(T, boxes)].sort();
  };

  it('판 시작 크기 그대로면 아무것도 덮지 않는다 (모든 시험 화면 · 두 역할)', () => {
    for (const [name, w, h] of SCREENS)
      for (const monster of [true, false])
        expect(covered(w, h, h, monster), `${name} ${monster}`).toEqual([]);
  });

  it('전체 화면이 꺼지거나 도구 막대가 나와 낮아지면 덮이는 것은 미니맵뿐 (괴물 915×412 → 356 · 330, 863×360 → 304, 생존자 802×293 → 250, 아이폰 14 주소창 750×369 → 300 두 역할)', () => {
    expect(covered(915, 412, 356, true)).toEqual(['minimap']);
    expect(covered(915, 412, 330, true)).toEqual(['minimap']);
    expect(covered(802, 293, 250, false)).toEqual(['minimap']);
    expect(covered(863, 360, 304, true)).toEqual(['minimap']);
    // 아이폰 14 Chrome: 주소창이 나와도 덮이는 것은 미니맵뿐 (거점 셋 — 생존자는 타이머가 오른쪽 칸 미니맵 아래라 덮이지 않는다)
    expect(covered(750, 369, 300, true)).toEqual(['minimap']);
    expect(covered(750, 369, 300, false)).toEqual(['minimap']);
    expect(covered(863, 360, 304, false)).toEqual(['minimap']);
    // 조금 낮아진 정도면 그대로 (자리 여유 8px 안)
    expect(covered(915, 412, 405, true)).toEqual([]);
  });

  it('따라가는 카메라: 덮인 미니맵은 숨기지 않고 맵 창 안 빈 구석으로 옮길 자리가 있다 — 맵 안, 그 창의 엄지 · 시스템 버튼과 안 겹침 (검토 반영)', () => {
    let checked = 0;
    for (const [w, h, nh, monster] of [
      [915, 412, 356, true],
      [915, 412, 330, true],
      [863, 360, 304, true],
      [802, 293, 250, false],
    ] as const) {
      // 판과 같게: 판 중 설정 버튼까지 시스템 버튼 세 칸 (설정 화면 통합 — 전체 화면 버튼이 맵 오른쪽 위에 걸칠 수 있다)
      const team = monster ? 'monster' : 'survivor';
      const l = L.layoutFor(w, h, true, { ...L.DEFAULT_TUNING, sysSlots: L.SYS_SLOTS_MENU, team });
      L.applyLayout(l);
      const plan = monster ? L.HUD.touch!.monster : L.HUD.touch!.survivor;
      // 처음부터 맵 창 안 미니맵이면(옆 칸에 시스템 버튼 세 칸 아래 자리가 없다) 엄지 버튼이 옆 칸 미니맵을 덮을 일이 없다
      if (!plan.minimap) {
        expect(plan.minimapInset, `${w}×${h} ${team} 맵 안 미니맵`).not.toBeNull();
        continue;
      }
      const mm = plan.minimap;
      const k0 = L.HUD.s;
      const frame = {
        w: mm.w + L.HUD.minimap.pad * k0 * 2,
        h: (mm.w * 2) / 3 + L.HUD.minimap.title * k0 + L.HUD.minimap.pad * k0,
      };
      const r = computeRenderSize({
        cssW: w,
        cssH: nh,
        dpr: 1,
        logicalW: l.viewW,
        logicalH: l.viewH,
        preset: { dprCap: 1, maxPixels: 1e12 },
        scaleOverride: null,
      });
      const k = r.dispH / l.viewH;
      const T = touchLayout(w, nh, { l: 0, r: 0, t: 0, b: 0 }, monster, true, [], {
        menu: true,
        sysRows: plan.sysRows,
      });
      // touchControls.onThumbs와 같은 식: 엄지 대상(이름표 · 이동 스틱 고리까지) 창 CSS px → 논리 px
      const thumbs = thumbAvoidBoxes(T).map((b) => ({
        x: (b.x - r.left) / k,
        y: (b.y - r.top) / k,
        w: b.w / k,
        h: b.h / k,
      }));
      const Lk = L.HUD.touch!.L;
      const spot = L.minimapFallback(L.MAP_RECT, frame, thumbs, L.MINIMAP_INSET.margin * Lk, L.MIN_GAP * Lk);
      const label = `${w}×${h} → ${nh} ${monster ? '괴물' : '생존자'}`;
      expect(spot, label).not.toBeNull();
      const f = { x: spot!.x, y: spot!.y, w: frame.w, h: frame.h };
      const m = L.MAP_RECT;
      expect(f.x, label).toBeGreaterThanOrEqual(m.x);
      expect(f.y, label).toBeGreaterThanOrEqual(m.y);
      expect(f.x + f.w, label).toBeLessThanOrEqual(m.x + m.w + 1e-6);
      expect(f.y + f.h, label).toBeLessThanOrEqual(m.y + m.h + 1e-6);
      for (const b of thumbs) expect(overlaps(f, b), `${label} ↔ 버튼`).toBe(false);
      checked += 1;
    }
    console.log(`[touch-hud] 옮길 자리 확인 ${checked}곳`);
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('thumbAvoidBoxes: 조준 · 버튼은 아래 이름표까지(CAP_BELOW), 시스템 버튼은 그대로, 이동 스틱 쉬는 고리도 (최종 촬영: 화살표가 구조 이름표에 가려짐)', () => {
    for (const monster of [false, true]) {
      const T = touchLayout(800, 360, { l: 0, r: 0, t: 0, b: 0 }, monster, true);
      const got = thumbAvoidBoxes(T);
      const want: Box[] = [];
      if (T.aim) want.push({ ...T.aim, h: T.aim.h + CAP_BELOW });
      for (const [id, b] of Object.entries(T.buttons))
        if (b) want.push({ ...b, h: b.h + (id === 'scoreboard' || id === 'fullscreen' ? 0 : CAP_BELOW) });
      const r = T.moveR;
      want.push({ x: T.moveHome.x - r, y: T.moveHome.y - r, w: 2 * r, h: 2 * r + CAP_BELOW });
      expect(got).toEqual(want);
      // 생존자 구조 · 괴물 조준은 이름표가 있는 버튼이다
      expect(got.length).toBe(Object.values(T.buttons).filter(Boolean).length + (T.aim ? 1 : 0) + 1);
    }
  });

  it('CAP_BELOW = style.css 이름표가 버튼 아래로 나오는 길이 (top · line-height · padding)', () => {
    const css = readFileSync('client/src/style.css', 'utf8');
    const block = (sel: string): string => {
      const i = css.indexOf(`${sel} {`);
      if (i < 0) throw new Error(`${sel} 없음`);
      return css.slice(i, css.indexOf('}', i));
    };
    const cap = block('.tc-cap');
    const top = /top: calc\(100% - (\d+(?:\.\d+)?)px\)/.exec(cap);
    const lh = /line-height: (\d+(?:\.\d+)?)px/.exec(cap);
    const pad = /padding: (\d+)px \d+px (\d+)px;/.exec(cap);
    expect(top && lh && pad).toBeTruthy();
    const below = Number(lh?.[1]) + Number(pad?.[1]) + Number(pad?.[2]) - Number(top?.[1]);
    expect(below).toBe(CAP_BELOW);
    // 이동 스틱 이름표: 고리 아래 끝(var(--mr))에서 같은 만큼 위로 올려 둔다
    expect(block('.tc-move > .tc-cap')).toContain(`top: calc(var(--mr) - ${top?.[1]}px)`);
    // 시스템 버튼 이름표는 버튼 안 (아래에서 띄움)
    expect(block('.tc-sys > .tc-cap')).toMatch(/top: auto;[\s\S]*bottom: \d+px;/);
  });

  it('minimapFallback: 맵 창 안 오른쪽 위, 시스템 버튼이 걸치면 그 아래 · 맵 왼쪽 위 구석 · 막은 것의 왼쪽, 모두 막히거나 맵보다 크면 null', () => {
    const map = { x: 100, y: 50, w: 900, h: 600 };
    const frame = { w: 200, h: 150 };
    expect(L.minimapFallback(map, frame, [], 10, 8)).toEqual({ x: 790, y: 60 });
    // 오른쪽 위 구석에 걸친 시스템 버튼 → 그 아래 (오른쪽 끝 그대로)
    const tr = { x: 760, y: 40, w: 100, h: 100 };
    expect(L.minimapFallback(map, frame, [tr], 10, 8)).toEqual({ x: 790, y: 148 });
    // 아래가 엄지 버튼으로 막히면 → 맵 왼쪽 위 구석 (플레이테스트 a-5: 예전에는 막은 것의 왼쪽 { x: 552 } — 맵 위 가운데 쪽이었다)
    const thumb = { x: 760, y: 200, w: 200, h: 400 };
    expect(L.minimapFallback(map, frame, [tr, thumb], 10, 8)).toEqual({ x: 110, y: 60 });
    // 막은 것의 왼쪽이 막혀도(또는 맵 왼쪽 절반까지 가야 해도) 왼쪽 위 구석이 비어 있으면 거기
    expect(L.minimapFallback(map, frame, [tr, thumb, { x: 500, y: 40, w: 60, h: 60 }], 10, 8)).toEqual({
      x: 110,
      y: 60,
    });
    expect(L.minimapFallback(map, frame, [{ x: 600, y: 40, w: 400, h: 60 }, thumb], 10, 8)).toEqual({
      x: 110,
      y: 60,
    });
    // 왼쪽 위 구석이 이동 영역에 걸치면 → 막은 것의 왼쪽 (맵 위 끝, 맵 오른쪽 절반 안)
    const zone = { x: 0, y: 150, w: 400, h: 500 };
    expect(L.minimapFallback(map, frame, [tr, thumb], 10, 8, zone)).toEqual({ x: 552, y: 60 });
    // 그 왼쪽도 막히면(또는 맵 왼쪽 절반까지 가야 하면) null
    expect(
      L.minimapFallback(map, frame, [tr, thumb, { x: 500, y: 40, w: 60, h: 60 }], 10, 8, zone),
    ).toBeNull();
    expect(L.minimapFallback(map, frame, [{ x: 600, y: 40, w: 400, h: 60 }, thumb], 10, 8, zone)).toBeNull();
    // 왼쪽 위 구석에 버튼이 있어도 (좌우 반전의 시스템 버튼) 마찬가지
    const tl = { x: 90, y: 40, w: 100, h: 60 };
    expect(L.minimapFallback(map, frame, [tr, thumb, tl, { x: 500, y: 40, w: 60, h: 60 }], 10, 8)).toBeNull();
    // 간격(gap) 밖이면 상관없다
    expect(L.minimapFallback(map, frame, [{ x: 600, y: 300, w: 100, h: 100 }], 10, 8)).toEqual({
      x: 790,
      y: 60,
    });
    expect(L.minimapFallback(map, { w: 900, h: 100 }, [], 10, 8)).toBeNull();
  });

  it('닿기만 하면 덮은 것이 아니다', () => {
    const T = touchLayout(863, 360, { l: 0, r: 0, t: 0, b: 0 }, true, false);
    const sb = T.buttons.scoreboard!;
    const touching = [
      { id: 'left', b: { x: sb.x - 20, y: sb.y, w: 20, h: sb.h } },
      { id: 'below', b: { x: sb.x, y: sb.y + sb.h, w: sb.w, h: 30 } },
      { id: 'in', b: { x: sb.x - 20, y: sb.y, w: 20.5, h: sb.h } },
    ];
    expect([...hudCovered(T, touching)]).toEqual(['in']);
  });
});
