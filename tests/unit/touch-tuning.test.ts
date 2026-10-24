// 판 배치 조정 (설정 화면 통합): layout.configureLayout의 tuning — 조이스틱 크기(stickScale) · UI 크기(uiScale) · 좌우 반전(mirror) ·
// 시스템 버튼 칸(sysSlots, 판 중 설정 버튼). 기본값이면 예전 배치와 같고, 어떤 조정에서도 터치 HUD가 맵 · 서로 · 터치 대상(설정
// 버튼 · 전체 화면 버튼까지)과 겹치지 않고 화면 안, 글자는 CSS 12 · 14px 이상이고 UI 크기만큼 커진다, 좌우 반전이면 HUD도 뒤집힌다
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import * as L from '../../client/src/ui/layout';
import { CAP_BELOW, thumbAvoidBoxes, touchLayout, type Box } from '../../client/src/ui/touchControls';

afterEach(() => L.applyLayout(L.pcLayout()));

const SCREENS: [string, number, number][] = [
  ['Pixel 7 전체 화면', 915, 412],
  ['Pixel 7 브라우저', 863, 360],
  ['Galaxy S9+', 658, 320],
  ['Pixel 5', 802, 293],
  ['800×360', 800, 360],
  ['21:9', 1080, 412],
  ['21:9 낮음', 840, 360],
  ['16:9 휴대폰', 640, 360],
  ['16:9', 960, 540],
  ['iPhone SE', 568, 320],
  ['iPhone 8', 667, 375],
  ['16:9 낮음', 534, 300],
  ['Galaxy Tab S9', 1024, 640],
  ['4:3 태블릿', 1024, 768],
  ['iPad Pro 11', 1194, 834],
  ['iPad Pro 12.9', 1366, 1024],
];

const TUNINGS: [string, Partial<L.LayoutTuning>][] = [
  ['설정 버튼', { sysSlots: L.SYS_SLOTS_MENU }],
  ['설정 버튼 · 좌우 반전', { sysSlots: L.SYS_SLOTS_MENU, mirror: true }],
  ['UI 크게', { sysSlots: L.SYS_SLOTS_MENU, uiScale: 1.15 }],
  ['UI 아주 크게', { sysSlots: L.SYS_SLOTS_MENU, uiScale: 1.3 }],
  ['UI 아주 크게 · 반전', { sysSlots: L.SYS_SLOTS_MENU, uiScale: 1.3, mirror: true }],
  ['조이스틱 130%', { sysSlots: L.SYS_SLOTS_MENU, stickScale: 1.3 }],
  ['조이스틱 80%', { sysSlots: L.SYS_SLOTS_MENU, stickScale: 0.8 }],
  ['모두 크게', { sysSlots: L.SYS_SLOTS_MENU, stickScale: 1.3, uiScale: 1.3, mirror: true }],
];

function overlaps(a: Box, b: Box, eps = 0.01): boolean {
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

describe('판 배치 조정 기본값 = 예전 배치', () => {
  it('tuning 없음 · 기본값 · 빈 객체는 같은 배치, tuning 칸도 없다', () => {
    for (const [, w, h] of SCREENS) {
      const a = L.layoutFor(w, h, true);
      expect(L.layoutFor(w, h, true, L.DEFAULT_TUNING)).toEqual(a);
      expect(L.layoutFor(w, h, true, {})).toEqual(a);
      expect('tuning' in a).toBe(false);
      expect(L.thumbReserve(w, h, true, L.DEFAULT_TUNING)).toEqual(L.thumbReserve(w, h, true));
      expect(L.thumbMetrics(h, 1)).toEqual(L.thumbMetrics(h));
    }
  });

  it('PC는 tuning을 무시한다', () => {
    expect(L.layoutFor(915, 412, false, { uiScale: 1.3, mirror: true })).toEqual(L.pcLayout());
    expect(L.configureLayout(915, 412, false, { uiScale: 1.3 })).toEqual(L.pcLayout());
  });

  it('이상한 값은 정리한다 (수가 아니면 기본값, 범위 밖은 자른다)', () => {
    expect(L.cleanTuning({ stickScale: Number.NaN, uiScale: 9, sysSlots: 2.6 })).toEqual({
      stickScale: 1,
      uiScale: 1.5,
      mirror: false,
      sysSlots: 3,
    });
    expect(L.cleanTuning(null)).toEqual(L.DEFAULT_TUNING);
  });
});

describe('판 배치 조정: 터치 HUD가 맵 · 서로 · 터치 대상과 겹치지 않고 화면 안', () => {
  for (const [tname, tuning] of TUNINGS)
    for (const [name, w, h] of SCREENS)
      for (const monster of [true, false])
        it(`${tname} · ${name} ${w}×${h} ${monster ? '괴물' : '생존자'}`, () => {
          // 내 팀을 같이 넘긴다 (배너 · 점수판이 피할 시스템 버튼 줄은 팀마다 다를 수 있다)
          const l = L.layoutFor(w, h, true, { ...tuning, team: monster ? 'monster' : 'survivor' });
          L.applyLayout(l);
          const t = L.HUD.touch!;
          const T = L.tuningOf(l);
          expect(t.mirror).toBe(tuning.mirror === true);
          expect(T.uiScale).toBeLessThanOrEqual(tuning.uiScale ?? 1);
          const plan = monster ? t.monster : t.survivor;
          const k = 1 / t.L;
          const css = (r: Box): Box => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
          const rects = plan.rects.map((r) => ({ id: r.id, css: css(r.rect), rect: r.rect }));
          for (const r of rects) {
            expect(r.rect.x, `${r.id} 왼쪽`).toBeGreaterThanOrEqual(-1e-6);
            expect(r.rect.y, `${r.id} 위`).toBeGreaterThanOrEqual(-1e-6);
            expect(r.rect.x + r.rect.w, `${r.id} 오른쪽`).toBeLessThanOrEqual(l.viewW + 1e-6);
            expect(r.rect.y + r.rect.h, `${r.id} 아래`).toBeLessThanOrEqual(l.viewH + 1e-6);
            expect(overlaps(r.rect, L.MAP_RECT), `${r.id} ↔ 맵`).toBe(false);
          }
          for (let i = 0; i < rects.length; i += 1)
            for (let j = i + 1; j < rects.length; j += 1)
              expect(overlaps(rects[i]!.css, rects[j]!.css), `${rects[i]!.id} ↔ ${rects[j]!.id}`).toBe(false);
          // 같은 조정의 터치 화면 (전체 화면 · 설정 버튼까지, 좌우 반전이면 뒤집은 기본 배치)
          const TL = touchLayout(
            w,
            h,
            { l: 0, r: 0, t: 0, b: 0 },
            monster,
            true,
            rects.map((r) => r.css),
            {
              stickScale: T.stickScale,
              menu: T.sysSlots >= L.SYS_SLOTS_MENU,
              custom: { mirror: T.mirror, items: {} },
              sysRows: plan.sysRows,
            },
          );
          expect(TL.fallback).toBeUndefined();
          // 시스템 버튼 둘째 줄: 전체 화면이 점수판 아래 (그때만)
          expect(TL.buttons.fullscreen!.y > TL.buttons.scoreboard!.y).toBe(plan.sysRows === 2);
          if (T.sysSlots >= L.SYS_SLOTS_MENU) expect(TL.buttons.menu).toBeDefined();
          const ghost = {
            x: TL.moveHome.x - TL.moveR,
            y: TL.moveHome.y - TL.moveR,
            w: TL.moveR * 2,
            h: TL.moveR * 2,
          };
          const targets: [string, Box][] = [
            ['move-zone', TL.zone],
            ['move-ghost', ghost],
          ];
          if (TL.aim) targets.push(['aim-stick', TL.aim]);
          for (const [id, b] of Object.entries(TL.buttons)) if (b) targets.push([id, b]);
          for (const r of rects)
            for (const [id, b] of targets) expect(overlaps(r.css, b), `${r.id} ↔ ${id}`).toBe(false);
          // 이동 영역은 이동 스틱 그림을 품는다 (반전이면 오른쪽)
          expect(TL.zone.y).toBeLessThanOrEqual(ghost.y);
          expect(TL.zone.x).toBeLessThanOrEqual(ghost.x);
          expect(TL.zone.x + TL.zone.w).toBeGreaterThanOrEqual(ghost.x + ghost.w);
          expect(TL.zone.x + TL.zone.w / 2 > w / 2).toBe(T.mirror);
          // 맵 창 안 미니맵: 틀까지 맵 안, 터치 대상 · 다른 부품과 안 겹침
          const i = plan.minimapInset;
          if (i) {
            const f = css(L.minimapInsetFrame(i, L.HUD.s));
            const m = css(L.MAP_RECT);
            expect(f.x).toBeGreaterThanOrEqual(m.x - 0.01);
            expect(f.y).toBeGreaterThanOrEqual(m.y - 0.01);
            expect(f.x + f.w).toBeLessThanOrEqual(m.x + m.w + 0.01);
            expect(f.y + f.h).toBeLessThanOrEqual(m.y + m.h + 0.01);
            for (const [id, b] of targets)
              if (id !== 'move-zone') expect(overlaps(f, b), `맵 안 미니맵 ↔ ${id}`).toBe(false);
            for (const r of rects) expect(overlaps(f, r.css), `맵 안 미니맵 ↔ ${r.id}`).toBe(false);
          }
          // 점수판이 시스템 버튼과 가로로 걸치면 그 아래: 반전이면 sysRight 왼쪽 버튼 줄 오른쪽 끝
          const sys = [TL.buttons.scoreboard!, TL.buttons.menu, TL.buttons.fullscreen].filter(
            (b): b is Box => b !== undefined,
          );
          const sysL = Math.min(...sys.map((b) => b.x));
          const sysR = Math.max(...sys.map((b) => b.x + b.w));
          if (T.mirror) expect(t.score.sysRight * k).toBeGreaterThanOrEqual(sysR - 0.01);
          else expect(t.score.sysLeft * k).toBeLessThanOrEqual(sysL + 0.01);
          expect(t.score.sysBottom * k).toBeGreaterThanOrEqual(Math.max(...sys.map((b) => b.y + b.h)) - 0.01);
          // 배너 · 메모 자리는 맵 안, 시스템 버튼이 맵에 걸치면 그 아래 (touch-hud 시험과 같은 검사)
          const band = {
            x: t.overlay.x0 * k,
            y: t.overlay.top * k,
            w: (t.overlay.x1 - t.overlay.x0) * k,
            h: 1,
          };
          for (const b of sys)
            expect(
              band.y >= b.y + b.h || !overlaps({ ...band, y: b.y, h: b.h }, b),
              '배너 ↔ 시스템 버튼',
            ).toBe(true);
        });
});

describe('시스템 버튼 둘째 줄 (sysRows)', () => {
  it('설정 버튼까지 세 칸이 맵에 걸치고 두 칸이면 옆 칸에 들어가는 낮은 넓은 화면: 생존자는 전체 화면을 점수판 아래로 — 배너 자리가 설정 버튼 없을 때와 같다 (m12-hud 메모 ↔ 감옥)', () => {
    const before = L.touchHudPlan(L.layoutFor(802, 293, true))!;
    const after = L.touchHudPlan(L.layoutFor(802, 293, true, { sysSlots: 3, team: 'survivor' }))!;
    expect(after.survivor.sysRows).toBe(2);
    expect(after.overlay).toEqual(before.overlay);
    // 괴물은 버튼 무리가 높아 둘째 줄 자리가 없다 → 한 줄 세 칸 (배너가 그 아래로)
    expect(after.monster.sysRows).toBe(1);
    // 기본(두 칸)은 늘 한 줄
    for (const [w, h] of [
      [802, 293],
      [915, 412],
      [658, 320],
    ] as const) {
      const p = L.touchHudPlan(L.layoutFor(w, h, true))!;
      expect([p.monster.sysRows, p.survivor.sysRows]).toEqual([1, 1]);
    }
  });
});

describe('UI 크기 (uiScale)', () => {
  it('글자 CSS px = 기본 × 적용한 UI 크기 (12 · 14px 아래로 안 내려감), 그림 단위도 같은 배율', () => {
    let grew = 0;
    for (const [name, w, h] of SCREENS)
      for (const ui of [1.15, 1.3]) {
        const base = L.layoutFor(w, h, true);
        L.applyLayout(base);
        const f0 = { ...L.HUD.font };
        const css0 = (px: number): number => (px * h) / base.viewH;
        const l = L.layoutFor(w, h, true, { uiScale: ui });
        L.applyLayout(l);
        const applied = L.tuningOf(l).uiScale;
        expect(applied, name).toBeGreaterThanOrEqual(1);
        expect(applied, name).toBeLessThanOrEqual(ui);
        if (applied > 1) grew += 1;
        const css = (px: number): number => (px * h) / l.viewH;
        for (const [key, px] of Object.entries(L.HUD.font)) {
          if (key === 'noteLine') continue;
          expect(css(px), `${name} ${key}`).toBeGreaterThanOrEqual(L.TOUCH_UI.font.small);
          expect(css(px), `${name} ${key}`).toBeCloseTo(css0(f0[key as keyof typeof f0]) * applied, 0);
        }
        for (const key of ['timer', 'cardName', 'gaugeLetter', 'boardRow'] as const)
          expect(css(L.HUD.font[key]), `${name} ${key}`).toBeGreaterThanOrEqual(14);
        // 그림 1단위 CSS px = art × UI 크기
        expect(L.HUD.s / L.HUD.touch!.L).toBeCloseTo(L.TOUCH_UI.art * applied, 9);
        // 맨 아래 안내 줄은 UI 크기와 상관없이 CSS hintH (가장자리 띠 24px 안)
        expect(L.HUD.hint.h * L.HUD.s * (h / l.viewH)).toBeCloseTo(L.TOUCH_UI.hintH, 6);
        // 점수판(가장 넓은 덮개)이 화면 폭 안
        expect(L.TOUCH_BOARD_W * L.TOUCH_UI.art * applied + L.TOUCH_UI.edge * 2).toBeLessThanOrEqual(
          w + 1e-6,
        );
      }
    // 대부분의 화면에서 실제로 커진다
    expect(grew).toBeGreaterThan(SCREENS.length);
  });

  it('흔한 휴대폰(800×360 · 915×412)은 아주 크게(1.3)를 그대로 받는다', () => {
    for (const [w, h] of [
      [800, 360],
      [915, 412],
    ] as const)
      expect(L.tuningOf(L.layoutFor(w, h, true, { uiScale: 1.3, sysSlots: 3 })).uiScale).toBe(1.3);
  });

  it('TOUCH_BOARD_W = overlays.ts 생존자 점수판 표 폭 + 좌우 여백', () => {
    const src = readFileSync('client/src/ui/overlays.ts', 'utf8');
    const w = /COLS_TEAM_TOUCH = \{[^}]*\bw: (\d+)/.exec(src);
    const pad = /TOUCH_BOARD = \{ pad: (\d+)/.exec(src);
    expect(w && pad).toBeTruthy();
    expect(Number(w?.[1]) + Number(pad?.[1]) * 2).toBe(L.TOUCH_BOARD_W);
  });
});

describe('조이스틱 크기 (stickScale) · 시스템 버튼 칸 (sysSlots)', () => {
  it('stickScale은 이동 · 조준 스틱 반지름만 바꾸고 버튼은 그대로', () => {
    for (const h of [293, 360, 412, 640]) {
      const a = L.thumbMetrics(h);
      const b = L.thumbMetrics(h, 1.3);
      const c = L.thumbMetrics(h, 0.8);
      expect(b.moveR).toBe(Math.round(60 * a.k * 1.3));
      expect(c.aimR).toBe(Math.round(60 * a.k * 0.8));
      expect({ ...b, moveR: 0, aimR: 0 }).toEqual({ ...a, moveR: 0, aimR: 0 });
      // 작게 해도 조준 스틱 지름은 터치 대상 최소 크기 이상
      expect(c.aimR * 2).toBeGreaterThanOrEqual(L.MIN_TARGET);
    }
    const T = touchLayout(800, 360, { l: 0, r: 0, t: 0, b: 0 }, true, false, [], { stickScale: 1.3 });
    const D = touchLayout(800, 360, { l: 0, r: 0, t: 0, b: 0 }, true, false);
    expect(T.aim!.w).toBeGreaterThan(D.aim!.w);
    expect(T.moveR).toBeGreaterThan(D.moveR);
    expect(T.buttons.dash!.w).toBe(D.buttons.dash!.w);
    // 엄지 자리 예약도 같은 크기 (조준 스틱이 커지면 버튼 무리 위 끝이 올라간다)
    expect(L.thumbReserve(800, 360, true, { stickScale: 1.3 }).clusterTop).toBe(
      Math.min(T.aim!.y, ...[T.buttons.dash!, T.buttons.mode!, T.buttons.roar!].map((b) => b.y)),
    );
  });

  it('판 중 설정 버튼: 점수판 바로 왼쪽, 전체 화면은 그 왼쪽 — 예약한 시스템 버튼 칸(sysLeft)이 세 버튼을 모두 담는다', () => {
    for (const [, w, h] of SCREENS) {
      const T = touchLayout(w, h, { l: 0, r: 0, t: 0, b: 0 }, false, true, [], { menu: true });
      const sb = T.buttons.scoreboard!;
      const menu = T.buttons.menu!;
      const fs = T.buttons.fullscreen!;
      expect(menu.y).toBe(sb.y);
      expect(menu.x + menu.w).toBeLessThan(sb.x);
      if (fs.y === sb.y) expect(fs.x + fs.w).toBeLessThan(menu.x);
      const r = L.thumbReserve(w, h, false, { sysSlots: L.SYS_SLOTS_MENU });
      for (const b of [sb, menu, ...(fs.y === sb.y ? [fs] : [])]) {
        expect(b.x).toBeGreaterThanOrEqual(r.sysLeft - 1e-6);
        expect(b.y + b.h).toBeLessThanOrEqual(r.sysBottom + 1e-6);
      }
      // 설정 버튼이 없으면 예전 배치 그대로
      const D = touchLayout(w, h, { l: 0, r: 0, t: 0, b: 0 }, false, true);
      expect(D.buttons.menu).toBeUndefined();
    }
  });

  it('thumbAvoidBoxes: 설정 버튼은 시스템 버튼이라 이름표가 아래로 나오지 않는다', () => {
    const T = touchLayout(800, 360, { l: 0, r: 0, t: 0, b: 0 }, false, true, [], { menu: true });
    const got = thumbAvoidBoxes(T);
    expect(got).toContainEqual(T.buttons.menu);
    expect(got).toContainEqual({ ...T.buttons.ability!, h: T.buttons.ability!.h + CAP_BELOW });
  });
});

describe('좌우 반전 (mirror)', () => {
  it('HUD 부품이 화면 가운데로 뒤집힌다 (게이지 A가 왼쪽 그대로, 팀 카드 순서도 왼쪽부터)', () => {
    for (const [name, w, h] of SCREENS) {
      const a = L.touchHudPlan(L.layoutFor(w, h, true, { sysSlots: 3 }))!;
      const lb = L.layoutFor(w, h, true, { sysSlots: 3, mirror: true });
      const b = L.touchHudPlan(lb)!;
      const W = lb.viewW;
      for (const role of ['monster', 'survivor'] as const) {
        const p = a[role];
        const q = b[role];
        expect(q.timer.x, name).toBeCloseTo(W - p.timer.x, 6);
        expect(q.timer.y, name).toBeCloseTo(p.timer.y, 6);
        expect(q.gaugeA.x, name).toBeCloseTo(W - p.gaugeB.x, 6);
        expect(q.gaugeB.x, name).toBeCloseTo(W - p.gaugeA.x, 6);
        expect(q.gaugeA.x).toBeLessThan(q.gaugeB.x);
        const gridW = p.cards.cols * p.cards.w + (p.cards.cols - 1) * p.cards.gap;
        expect(q.cards.x, name).toBeCloseTo(W - p.cards.x - gridW, 6);
        if (p.minimap) expect(q.minimap!.x).toBeCloseTo(W - p.minimap.x - p.minimap.w, 6);
        if (p.minimapInset) expect(q.minimapInset!.x).toBeCloseTo(W - p.minimapInset.x - p.minimapInset.w, 6);
        // 사각형 목록: 같은 id가 뒤집힌 자리 (게이지는 맞바꾼 자리)
        for (const r of p.rects) {
          const id = r.id === 'gaugeA' ? 'gaugeB' : r.id === 'gaugeB' ? 'gaugeA' : r.id;
          const m = q.rects.find((x) => x.id === id)!;
          if (r.id.startsWith('card')) continue;
          expect(m.rect.x, `${name} ${r.id}`).toBeCloseTo(W - r.rect.x - r.rect.w, 6);
          expect(m.rect.w).toBeCloseTo(r.rect.w, 6);
        }
        expect(q.rects.map((r) => r.id)).toEqual(p.rects.map((r) => r.id));
      }
      // 배너 자리 · 안내 줄 · 점수판 세로 범위는 대칭이라 그대로
      expect(b.overlay).toEqual(a.overlay);
      expect(b.hint).toEqual(a.hint);
      expect(b.score.sysBottom).toBe(a.score.sysBottom);
      expect(b.score.sysRight).toBeCloseTo(W - a.score.sysLeft, 6);
    }
  });
});
